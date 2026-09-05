"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_crypto_1 = require("node:crypto");
const db_config_1 = require("../config/db.config");
const push_notification_service_1 = require("../services/push-notification.service");
const client_app_type_1 = require("../types/client-app.type");
const rewind_notification_personalization_util_1 = require("../utils/rewind-notification-personalization.util");
const TEST_PERSONA_NAMES = {
    ariel: "Ariel",
    ella: "Ella",
    jake: "Jake",
    lyra: "Lyra",
};
function parseValue(args, name) {
    const prefix = `--${name}=`;
    const inline = args.find((arg) => arg.startsWith(prefix));
    if (inline)
        return inline.slice(prefix.length);
    const index = args.indexOf(`--${name}`);
    const next = args[index + 1];
    return index >= 0 && next && !next.startsWith("--") ? next : null;
}
function parseOptions(args) {
    const clientAppValue = parseValue(args, "client-app") ?? "all";
    const kindValue = parseValue(args, "kind") ?? "delivery";
    const modeValue = parseValue(args, "mode") ?? "visible";
    const personaValue = parseValue(args, "persona") ?? "lyra";
    const clientApp = clientAppValue === "all" ||
        clientAppValue === "vybaa" ||
        clientAppValue === "mycove"
        ? clientAppValue
        : (() => {
            throw new Error("--client-app must be vybaa, mycove, or all");
        })();
    const mode = modeValue === "visible" || modeValue === "silent"
        ? modeValue
        : (() => {
            throw new Error("--mode must be visible or silent");
        })();
    const kind = kindValue === "delivery" || kindValue === "rewind-chat"
        ? kindValue
        : (() => {
            throw new Error("--kind must be delivery or rewind-chat");
        })();
    const persona = personaValue === "ariel" ||
        personaValue === "ella" ||
        personaValue === "jake" ||
        personaValue === "lyra"
        ? personaValue
        : (() => {
            throw new Error("--persona must be ariel, ella, jake, or lyra");
        })();
    return {
        allUsers: args.includes("--all"),
        body: parseValue(args, "body") ??
            (kind === "rewind-chat"
                ? "hey, you active? 👀"
                : "This is a delivery test from the Vybaa notification service."),
        clientApp,
        email: parseValue(args, "email")?.trim() || null,
        kind,
        mode,
        persona,
        send: args.includes("--send"),
        userId: parseValue(args, "user"),
    };
}
function getTargetKey(target) {
    return `${target.clientApp}:${target.token}`;
}
function collectTargets(users, clientFilter) {
    const targets = new Map();
    for (const user of users) {
        for (const token of user.fcmTokens) {
            if (token && (clientFilter === "all" || clientFilter === "vybaa")) {
                const target = { clientApp: "vybaa", token };
                targets.set(getTargetKey(target), target);
            }
        }
        for (const device of user.fcmDevices) {
            if (!device.token)
                continue;
            const target = {
                clientApp: (0, client_app_type_1.fromPrismaClientApp)(device.clientApp),
                token: device.token,
            };
            if (clientFilter === "all" || clientFilter === target.clientApp) {
                targets.set(getTargetKey(target), target);
            }
        }
    }
    return [...targets.values()];
}
function printUsage() {
    console.log(`FCM delivery test harness

Preview registered targets without sending:
  npm run test:fcm

Send to one user's registered tokens:
  npm run test:fcm -- --user USER_ID --send

Send by the account email:
  npm run test:fcm -- --email you@example.com --send

Preview a Rewind partner notification with avatar metadata:
  npm run test:fcm -- --kind rewind-chat --persona lyra

Send a Rewind partner notification to one user:
  npm run test:fcm -- --kind rewind-chat --persona lyra --user USER_ID --send

Send to every registered token (requires explicit confirmation):
  CONFIRM_FCM_BROADCAST=YES npm run test:fcm -- --all --send

Options:
  --user USER_ID             Limit the test to one user
  --email EMAIL              Limit the test to the user with this email
  --all                      Allow all users as the target scope
  --client-app vybaa|mycove|all
  --kind delivery|rewind-chat
  --persona ariel|ella|jake|lyra  Used by rewind-chat tests
  --mode visible|silent      Visible notification is the default
  --body "message"           Override the test message
  --send                     Actually send; preview is the default
`);
}
function buildTestPayload(testId, options) {
    const createdAt = new Date().toISOString();
    const id = `fcm-test-${testId}`;
    if (options.kind === "delivery") {
        return {
            createdAt,
            data: {
                fcmTestId: testId,
                route: "/notifications",
                type: "fcm_delivery_test",
            },
            id,
            message: options.body,
            title: "FCM delivery test",
            type: "fcm_delivery_test",
        };
    }
    const presentation = (0, rewind_notification_personalization_util_1.personalizeRewindNotification)({
        data: {
            chatId: `fcm-test-chat-${testId}`,
            messageId: id,
            route: "/notifications",
            sourcePersonaId: options.persona,
        },
        message: options.body,
        selectedPersonaId: null,
        title: TEST_PERSONA_NAMES[options.persona],
        type: "rewind_chat_message",
    });
    return {
        createdAt,
        data: presentation.data ?? {},
        id,
        message: presentation.message,
        title: presentation.title,
        type: "rewind_chat_message",
    };
}
async function main() {
    const args = process.argv.slice(2);
    if (args.includes("--help") || args.includes("-h")) {
        printUsage();
        return;
    }
    const options = parseOptions(args);
    const scopes = [options.userId, options.email, options.allUsers].filter(Boolean).length;
    if (scopes > 1) {
        throw new Error("Choose only one target scope: --user, --email, or --all");
    }
    if (options.send && scopes === 0) {
        throw new Error("Sending requires --user USER_ID, --email EMAIL, or --all");
    }
    if (options.send &&
        options.allUsers &&
        process.env.CONFIRM_FCM_BROADCAST !== "YES") {
        throw new Error("Broadcast blocked. Set CONFIRM_FCM_BROADCAST=YES when using --all --send.");
    }
    const users = await db_config_1.prisma.user.findMany({
        where: options.userId
            ? { id: options.userId }
            : options.email
                ? { email: options.email }
                : undefined,
        select: {
            fcmDevices: { select: { clientApp: true, token: true } },
            fcmTokens: true,
            id: true,
        },
    });
    if ((options.userId || options.email) && users.length === 0) {
        throw new Error(options.email
            ? `No user found for email ${options.email}`
            : "User not found");
    }
    const targets = collectTargets(users, options.clientApp);
    const counts = targets.reduce((result, target) => {
        result[target.clientApp] += 1;
        return result;
    }, { mycove: 0, vybaa: 0 });
    console.log(`${options.send ? "Sending to" : "Found"} ${targets.length} unique FCM target(s): Vybaa=${counts.vybaa}, My Cove=${counts.mycove}, kind=${options.kind}, mode=${options.mode}`);
    const testId = (0, node_crypto_1.randomUUID)();
    const payload = buildTestPayload(testId, options);
    console.log(JSON.stringify({
        body: payload.message,
        sender: payload.data.notificationSender ?? null,
        title: payload.title,
        type: payload.type,
    }, null, 2));
    if (!options.send || !targets.length)
        return;
    const result = await push_notification_service_1.pushNotificationService.sendFCMBatchMessages(targets.map((target) => ({
        body: payload.message,
        clientApp: target.clientApp,
        payload,
        silent: options.mode === "silent",
        title: payload.title,
        token: target.token,
    })));
    console.log(`FCM test complete: sent=${result.successCount}, failed=${result.failureCount}`);
}
void main()
    .catch((error) => {
    console.error(error instanceof Error ? error.message : "FCM test failed");
    process.exitCode = 1;
})
    .finally(async () => {
    await db_config_1.prisma.$disconnect();
});
