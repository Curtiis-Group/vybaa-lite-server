import { randomUUID } from "node:crypto";
import { prisma } from "../config/db.config";
import { fromPrismaClientApp, type ClientApp } from "../types/client-app.type";
import { pushNotificationService } from "../services/push-notification.service";

type TestMode = "visible" | "silent";
type ClientFilter = ClientApp | "all";

interface ScriptOptions {
  allUsers: boolean;
  body: string;
  clientApp: ClientFilter;
  mode: TestMode;
  send: boolean;
  userId: string | null;
}

interface FcmTarget {
  clientApp: ClientApp;
  token: string;
}

interface UserFcmData {
  fcmDevices: Array<{ clientApp: "VYBAA" | "MYCOVE"; token: string }>;
  fcmTokens: string[];
  id: string;
}

function parseValue(args: string[], name: string): string | null {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = args.indexOf(`--${name}`);
  const next = args[index + 1];
  return index >= 0 && next && !next.startsWith("--") ? next : null;
}

function parseOptions(args: string[]): ScriptOptions {
  const clientAppValue = parseValue(args, "client-app") ?? "all";
  const modeValue = parseValue(args, "mode") ?? "visible";
  const clientApp: ClientFilter =
    clientAppValue === "all" ||
    clientAppValue === "vybaa" ||
    clientAppValue === "mycove"
      ? clientAppValue
      : (() => {
          throw new Error("--client-app must be vybaa, mycove, or all");
        })();
  const mode: TestMode =
    modeValue === "visible" || modeValue === "silent"
      ? modeValue
      : (() => {
          throw new Error("--mode must be visible or silent");
        })();

  return {
    allUsers: args.includes("--all"),
    body:
      parseValue(args, "body") ??
      "This is a delivery test from the Vybaa notification service.",
    clientApp,
    mode,
    send: args.includes("--send"),
    userId: parseValue(args, "user"),
  };
}

function getTargetKey(target: FcmTarget): string {
  return `${target.clientApp}:${target.token}`;
}

function collectTargets(
  users: UserFcmData[],
  clientFilter: ClientFilter,
): FcmTarget[] {
  const targets = new Map<string, FcmTarget>();

  for (const user of users) {
    for (const token of user.fcmTokens) {
      if (token && (clientFilter === "all" || clientFilter === "vybaa")) {
        const target: FcmTarget = { clientApp: "vybaa", token };
        targets.set(getTargetKey(target), target);
      }
    }

    for (const device of user.fcmDevices) {
      if (!device.token) continue;
      const target: FcmTarget = {
        clientApp: fromPrismaClientApp(device.clientApp),
        token: device.token,
      };
      if (clientFilter === "all" || clientFilter === target.clientApp) {
        targets.set(getTargetKey(target), target);
      }
    }
  }

  return [...targets.values()];
}

function printUsage(): void {
  console.log(`FCM delivery test harness

Preview registered targets without sending:
  npm run test:fcm

Send to one user's registered tokens:
  npm run test:fcm -- --user USER_ID --send

Send to every registered token (requires explicit confirmation):
  CONFIRM_FCM_BROADCAST=YES npm run test:fcm -- --all --send

Options:
  --user USER_ID             Limit the test to one user
  --all                      Allow all users as the target scope
  --client-app vybaa|mycove|all
  --mode visible|silent      Visible notification is the default
  --body "message"           Override the test message
  --send                     Actually send; preview is the default
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    return;
  }

  const options = parseOptions(args);
  if (options.send && !options.userId && !options.allUsers) {
    throw new Error("Sending requires --user USER_ID or --all");
  }
  if (
    options.send &&
    options.allUsers &&
    process.env.CONFIRM_FCM_BROADCAST !== "YES"
  ) {
    throw new Error(
      "Broadcast blocked. Set CONFIRM_FCM_BROADCAST=YES when using --all --send.",
    );
  }

  const users = await prisma.user.findMany({
    where: options.userId ? { id: options.userId } : undefined,
    select: {
      fcmDevices: { select: { clientApp: true, token: true } },
      fcmTokens: true,
      id: true,
    },
  });
  if (options.userId && users.length === 0) {
    throw new Error("User not found");
  }

  const targets = collectTargets(users, options.clientApp);
  const counts = targets.reduce<Record<ClientApp, number>>(
    (result, target) => {
      result[target.clientApp] += 1;
      return result;
    },
    { mycove: 0, vybaa: 0 },
  );
  console.log(
    `${options.send ? "Sending to" : "Found"} ${targets.length} unique FCM target(s): Vybaa=${counts.vybaa}, My Cove=${counts.mycove}, mode=${options.mode}`,
  );

  if (!options.send || targets.length === 0) return;

  const testId = randomUUID();
  const result = await pushNotificationService.sendFCMBatchMessages(
    targets.map((target) => ({
      body: options.body,
      clientApp: target.clientApp,
      payload: {
        fcmTestId: testId,
        route: "/app/notifications",
        type: "fcm_delivery_test",
      },
      silent: options.mode === "silent",
      title: "FCM delivery test",
      token: target.token,
    })),
  );

  console.log(
    `FCM test complete: sent=${result.successCount}, failed=${result.failureCount}`,
  );
}

void main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "FCM test failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
