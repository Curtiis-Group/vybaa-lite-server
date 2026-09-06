"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.personalizeRewindNotification = personalizeRewindNotification;
const PERSONAS = {
    ariel: {
        avatarUrl: "https://res.cloudinary.com/dqdtazdda/image/upload/c_fill,f_png,g_auto,h_256,q_auto:good,w_256/v1/vybaa/rewind/partners/ariel",
        name: "Ariel",
        personaId: "ariel",
    },
    ella: {
        avatarUrl: "https://res.cloudinary.com/dqdtazdda/image/upload/c_fill,f_png,g_auto,h_256,q_auto:good,w_256/v1/vybaa/rewind/partners/ella",
        name: "Ella",
        personaId: "ella",
    },
    jake: {
        avatarUrl: "https://res.cloudinary.com/dqdtazdda/image/upload/c_fill,f_png,g_auto,h_256,q_auto:good,w_256/v1/vybaa/rewind/partners/jake",
        name: "Jake",
        personaId: "jake",
    },
    lyra: {
        avatarUrl: "https://res.cloudinary.com/dqdtazdda/image/upload/c_fill,f_png,g_auto,h_256,q_auto:good,w_256/v1/vybaa/rewind/partners/lyra",
        name: "Lyra",
        personaId: "lyra",
    },
    neeja: {
        avatarUrl: "https://res.cloudinary.com/dqdtazdda/image/upload/c_fill,f_png,g_auto,h_256,q_auto:good,w_256/v1/vybaa/rewind/partners/neeja",
        name: "Neeja",
        personaId: "neeja",
    },
    tobi: {
        avatarUrl: "https://res.cloudinary.com/dqdtazdda/image/upload/c_fill,f_png,g_auto,h_256,q_auto:good,w_256/v1/vybaa/rewind/partners/tobi",
        name: "Tobi",
        personaId: "tobi",
    },
};
function isNotificationPersonaId(value) {
    return (value === "ella" ||
        value === "lyra" ||
        value === "jake" ||
        value === "ariel" ||
        value === "tobi" ||
        value === "neeja");
}
function normalizeMessage(message) {
    const normalized = message
        .replace(/\s+[—–]\s+/g, ", ")
        .replace(/^(congratulations|amazing)!?\s*/i, "")
        .trim();
    if (!normalized)
        return message.trim();
    return `${normalized.charAt(0).toLowerCase()}${normalized.slice(1)}`;
}
function isPositiveNotification(type, title) {
    return (type === "goal_completed" ||
        type === "streak_milestone" ||
        /completed|milestone|achievement|streak/i.test(title));
}
function isReminderNotification(type, title) {
    return /reminder/.test(type) || /reminder|check.?in/i.test(title);
}
function getPartnerMessage(params) {
    const message = normalizeMessage(params.message);
    const positive = isPositiveNotification(params.type, params.title);
    const reminder = isReminderNotification(params.type, params.title);
    switch (params.personaId) {
        case "ella":
            if (positive)
                return `waittt, ${message} 🥹`;
            if (reminder)
                return `hey, ${message} 🥺`;
            return `${message} 👀`;
        case "lyra":
            if (positive)
                return `nice, ${message} 🙂`;
            return `btw, ${message}`;
        case "jake":
            if (positive)
                return `good. ${message}`;
            if (reminder)
                return `reminder. ${message}`;
            return `heads up. ${message}`;
        case "ariel":
            if (positive)
                return `look at u, ${message}. proud of u`;
            if (reminder)
                return `hey, ${message}. u got this`;
            return `hey, ${message}`;
        case "tobi":
            if (positive)
                return `oya nice one 😂 ${message}`;
            if (reminder)
                return `abeg no forget, ${message}`;
            return `yo, ${message}`;
        case "neeja":
            if (positive)
                return `hmm look at u 🤎 ${message}`;
            if (reminder)
                return `hey, quick reminder... ${message}`;
            return `btw, ${message} 👀`;
    }
}
function personalizeRewindNotification(input) {
    const sourcePersonaId = input.data?.sourcePersonaId;
    const sourcePersona = isNotificationPersonaId(sourcePersonaId)
        ? PERSONAS[sourcePersonaId]
        : null;
    if (input.type === "rewind_chat_message") {
        return {
            data: sourcePersona
                ? { ...input.data, notificationSender: sourcePersona }
                : input.data,
            message: input.message,
            title: sourcePersona?.name ?? input.title,
        };
    }
    if (!isNotificationPersonaId(input.selectedPersonaId)) {
        return {
            data: input.data,
            message: input.message,
            title: input.title,
        };
    }
    const persona = PERSONAS[input.selectedPersonaId];
    return {
        data: input.data,
        message: getPartnerMessage({
            message: input.message,
            personaId: persona.personaId,
            title: input.title,
            type: input.type,
        }),
        title: input.title,
    };
}
