"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.summarizeShortResponse = summarizeShortResponse;
exports.recordGuidedFlowResponse = recordGuidedFlowResponse;
exports.buildGuidedFlowInstruction = buildGuidedFlowInstruction;
exports.buildGuidedFlowSnapshot = buildGuidedFlowSnapshot;
exports.getPaginatedRewindSessions = getPaginatedRewindSessions;
exports.buildOpeningPrompt = buildOpeningPrompt;
exports.buildResumePrompt = buildResumePrompt;
exports.buildResumePromptWithGuidedState = buildResumePromptWithGuidedState;
exports.createLiveToken = createLiveToken;
exports.handleLiveConnection = handleLiveConnection;
const genai_1 = require("@google/genai");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const db_config_1 = require("../config/db.config");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
const GEMINI_LIVE_MODEL = "models/gemini-2.5-flash-native-audio-preview-09-2025";
const REWIND_WS_TOKEN_SECRET = process.env.JWT_SECRET || "your-secret-key-change-in-production";
const REWIND_WS_TOKEN_TTL = "10m";
const REWIND_GUIDED_QUESTIONS = [
    { id: "meaningful", question: "What felt most meaningful about your day today?" },
    { id: "draining", question: "What drained your energy the most?" },
    { id: "progress", question: "Did you move closer to what you want, even a little?" },
    { id: "different", question: "What’s one thing you wish you handled differently?" },
    {
        id: "tomorrow_need",
        question: "What do you need more of tomorrow — focus, rest, or courage?",
    },
];
function createConnectionId() {
    return `rewind_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
function createEmptyGuidedFlow() {
    return {
        openingAnswered: false,
        currentQuestionIndex: 0,
        completed: false,
        responses: {},
    };
}
function getDateString(date, timezone) {
    if (timezone) {
        const formatter = new Intl.DateTimeFormat("en-CA", {
            timeZone: timezone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        });
        return formatter.format(date);
    }
    return date.toISOString().split("T")[0];
}
function normalizeGuidedResponses(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        return {};
    }
    const normalized = {};
    for (const question of REWIND_GUIDED_QUESTIONS) {
        const rawEntry = input[question.id];
        if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
            continue;
        }
        const entry = rawEntry;
        normalized[question.id] = {
            questionId: question.id,
            shortSummary: typeof entry.shortSummary === "string" ? entry.shortSummary.trim() : "",
            score: typeof entry.score === "number" ? entry.score : null,
            updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : Date.now(),
        };
    }
    return normalized;
}
function normalizeGuidedFlow(input) {
    const maxQuestionIndex = REWIND_GUIDED_QUESTIONS.length;
    const rawIndex = typeof input.currentQuestionIndex === "number" ? input.currentQuestionIndex : 0;
    const currentQuestionIndex = Math.max(0, Math.min(maxQuestionIndex, rawIndex));
    return {
        openingAnswered: Boolean(input.openingAnswered),
        currentQuestionIndex,
        completed: Boolean(input.completed) || currentQuestionIndex >= maxQuestionIndex,
        responses: normalizeGuidedResponses(input.responses),
    };
}
function isValidPersonaId(value) {
    return value === "ella" || value === "lyra" || value === "jake" || value === "ariel";
}
function createRewindWsToken(userId, personaId, sessionId) {
    return jsonwebtoken_1.default.sign({ userId, personaId, sessionId, type: "rewind_ws" }, REWIND_WS_TOKEN_SECRET, { expiresIn: REWIND_WS_TOKEN_TTL });
}
function verifyRewindWsToken(token) {
    try {
        const decoded = jsonwebtoken_1.default.verify(token, REWIND_WS_TOKEN_SECRET);
        if (!decoded?.userId || decoded.type !== "rewind_ws") {
            return null;
        }
        return decoded;
    }
    catch {
        return null;
    }
}
async function loadRewindSession(params) {
    const where = params.sessionId
        ? { id: params.sessionId, userId: params.userId, personaId: params.personaId }
        : { userId: params.userId, personaId: params.personaId };
    const session = await db_config_1.prisma.rewindSession.findFirst({
        where,
        orderBy: { updatedAt: "desc" },
    });
    if (!session)
        return null;
    return {
        sessionId: session.id,
        userId: session.userId,
        personaId: session.personaId,
        sessionDateKey: session?.sessionDateKey,
        guidedFlow: normalizeGuidedFlow({
            openingAnswered: session.openingAnswered,
            currentQuestionIndex: session.currentQuestionIndex,
            completed: session.completed,
            responses: session.responses,
        }),
        updatedAt: session.updatedAt.getTime(),
    };
}
async function loadRewindSessionForDate(params) {
    const session = await db_config_1.prisma.rewindSession.findFirst({
        where: {
            userId: params.userId,
            personaId: params.personaId,
            sessionDateKey: params.sessionDateKey,
        },
        orderBy: { updatedAt: "desc" },
    });
    if (!session)
        return null;
    return {
        sessionId: session.id,
        userId: session.userId,
        personaId: session.personaId,
        sessionDateKey: session?.sessionDateKey || params?.sessionDateKey,
        guidedFlow: normalizeGuidedFlow({
            openingAnswered: session.openingAnswered,
            currentQuestionIndex: session.currentQuestionIndex,
            completed: session.completed,
            responses: session.responses,
        }),
        updatedAt: session.updatedAt.getTime(),
    };
}
async function loadPreviousRewindSession(params) {
    const session = await db_config_1.prisma.rewindSession.findFirst({
        where: {
            userId: params.userId,
            personaId: params.personaId,
            NOT: {
                sessionDateKey: params.currentSessionDateKey,
            },
        },
        orderBy: { createdAt: "desc" },
    });
    if (!session)
        return null;
    return {
        sessionId: session.id,
        sessionDateKey: session?.sessionDateKey,
        guidedFlow: normalizeGuidedFlow({
            openingAnswered: session.openingAnswered,
            currentQuestionIndex: session.currentQuestionIndex,
            completed: session.completed,
            responses: session.responses,
        }),
        updatedAt: session.updatedAt.getTime(),
    };
}
async function persistRewindSession(sessionState) {
    await db_config_1.prisma.rewindSession.upsert({
        where: { id: sessionState.sessionId },
        update: {
            personaId: sessionState.personaId,
            sessionDateKey: sessionState.sessionDateKey,
            openingAnswered: sessionState.guidedFlow.openingAnswered,
            currentQuestionIndex: sessionState.guidedFlow.currentQuestionIndex,
            completed: sessionState.guidedFlow.completed,
            responses: sessionState.guidedFlow.responses,
        },
        create: {
            id: sessionState.sessionId,
            userId: sessionState.userId,
            personaId: sessionState.personaId,
            sessionDateKey: sessionState.sessionDateKey,
            openingAnswered: sessionState.guidedFlow.openingAnswered,
            currentQuestionIndex: sessionState.guidedFlow.currentQuestionIndex,
            completed: sessionState.guidedFlow.completed,
            responses: sessionState.guidedFlow.responses,
        },
    });
}
async function getOrCreateRewindSession(params) {
    const sessionDateKey = getDateString(new Date(), params.timezone);
    const previousSession = await loadPreviousRewindSession({
        userId: params.userId,
        personaId: params.personaId,
        currentSessionDateKey: sessionDateKey,
    });
    if (params.requestedSessionId) {
        const existing = await loadRewindSession({
            userId: params.userId,
            personaId: params.personaId,
            sessionId: params.requestedSessionId,
        });
        if (existing) {
            return {
                sessionState: existing,
                restored: existing.guidedFlow.openingAnswered,
                previousSession,
            };
        }
    }
    const todaySession = await loadRewindSessionForDate({
        userId: params.userId,
        personaId: params.personaId,
        sessionDateKey,
    });
    if (todaySession) {
        return {
            sessionState: todaySession,
            restored: todaySession.guidedFlow.openingAnswered,
            previousSession,
        };
    }
    const sessionState = {
        sessionId: params.requestedSessionId || createConnectionId(),
        userId: params.userId,
        personaId: params.personaId,
        sessionDateKey,
        guidedFlow: createEmptyGuidedFlow(),
        updatedAt: Date.now(),
    };
    await persistRewindSession(sessionState);
    return { sessionState, restored: false, previousSession };
}
function summarizeShortResponse(text) {
    const compact = text.replace(/\s+/g, " ").trim();
    if (!compact)
        return "";
    const firstSentence = compact.split(/[.!?]/)[0]?.trim() || compact;
    const words = firstSentence.split(" ").filter(Boolean);
    const short = words.slice(0, 12).join(" ");
    if (short.length >= firstSentence.length) {
        return firstSentence;
    }
    return `${short}...`;
}
function recordGuidedFlowResponse(sessionState, userResponse) {
    const nextResponse = userResponse.trim();
    if (!nextResponse || sessionState.guidedFlow.completed)
        return;
    if (!sessionState.guidedFlow.openingAnswered) {
        sessionState.guidedFlow.openingAnswered = true;
        sessionState.updatedAt = Date.now();
        return;
    }
    const question = REWIND_GUIDED_QUESTIONS[sessionState.guidedFlow.currentQuestionIndex];
    if (!question) {
        sessionState.guidedFlow.completed = true;
        sessionState.updatedAt = Date.now();
        return;
    }
    sessionState.guidedFlow.responses[question.id] = {
        questionId: question.id,
        shortSummary: summarizeShortResponse(nextResponse),
        score: null,
        updatedAt: Date.now(),
    };
    sessionState.guidedFlow.currentQuestionIndex += 1;
    sessionState.guidedFlow.completed =
        sessionState.guidedFlow.currentQuestionIndex >= REWIND_GUIDED_QUESTIONS.length;
    sessionState.updatedAt = Date.now();
}
function buildGuidedFlowInstruction() {
    return (`After your opening "Hey, how are you?" exchange, guide the user through this rewind sequence. ` +
        `Ask one question at a time and do not skip, merge, or reorder the sequence. ` +
        `Do not sound like you are reading from a checklist or script. ` +
        `Keep the intent of each question, but vary the wording naturally and make it conversational when it helps. ` +
        `You may soften or rephrase the next question, but it must still clearly ask for the same reflection target as the sequence below. ` +
        `After each user answer, give at most one short acknowledgement sentence, then move to the next question naturally. ` +
        `After the fifth answer, give one short acknowledgement and stop asking new questions. ` +
        `The reflection sequence to preserve is:\n` +
        REWIND_GUIDED_QUESTIONS.map((entry, index) => `${index + 1}. ${entry.question}`).join("\n"));
}
function buildGuidedFlowSnapshot(sessionState) {
    const nextQuestion = REWIND_GUIDED_QUESTIONS[sessionState.guidedFlow.currentQuestionIndex];
    const savedResponses = Object.values(sessionState.guidedFlow.responses)
        .map((entry) => `${entry.questionId}: ${entry.shortSummary}`)
        .join("\n");
    return (`Guided rewind state:\n` +
        `- Opening answered: ${sessionState.guidedFlow.openingAnswered ? "yes" : "no"}\n` +
        `- Current question index: ${sessionState.guidedFlow.currentQuestionIndex}\n` +
        `- Completed: ${sessionState.guidedFlow.completed ? "yes" : "no"}\n` +
        `- Next exact question: ${nextQuestion?.question ?? "none"}\n` +
        `- Saved short responses:\n${savedResponses || "none"}`);
}
function buildRestoreContextSummary(sessionState) {
    const responses = Object.values(sessionState.guidedFlow.responses);
    if (responses.length === 0) {
        return "We had only just started the rewind and had not yet captured any guided answers.";
    }
    return (`We already captured these short rewind points:\n` +
        responses.map((entry) => `- ${entry.questionId}: ${entry.shortSummary}`).join("\n"));
}
function getRewindVoiceName(personaId) {
    switch (personaId) {
        case "ella":
            return "Kore";
        case "lyra":
            return "Aoede";
        case "jake":
            return "Puck";
        case "ariel":
            return "Kore";
        default:
            return "Kore";
    }
}
async function getPaginatedRewindSessions(req, res) {
    try {
        const userId = req.userId;
        const pageParam = Array.isArray(req.query.page) ? req.query.page[0] : req.query.page;
        const limitParam = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
        const parsedPage = Number(pageParam ?? "1");
        const parsedLimit = Number(limitParam ?? "10");
        const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
        const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 10;
        const skip = (page - 1) * limit;
        const [sessions, total] = await Promise.all([
            db_config_1.prisma.rewindSession.findMany({
                where: { userId },
                orderBy: { updatedAt: "desc" },
                skip,
                take: limit,
            }),
            db_config_1.prisma.rewindSession.count({
                where: { userId },
            }),
        ]);
        res.json({
            msg: "Rewind sessions retrieved successfully",
            data: {
                sessions,
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit),
                    hasMore: skip + sessions.length < total,
                },
            },
        });
    }
    catch (error) {
        logger_util_1.default.error("Get paginated rewind sessions error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
function summarizeLiveMessage(message) {
    return {
        hasServerContent: Boolean(message?.serverContent),
        hasSetupComplete: Boolean(message?.setupComplete),
        interrupted: Boolean(message?.serverContent?.interrupted),
        turnComplete: Boolean(message?.serverContent?.turnComplete),
        generationComplete: Boolean(message?.serverContent?.generationComplete),
        modelPartCount: message?.serverContent?.modelTurn?.parts?.length ?? 0,
        outputTranscriptionLength: message?.serverContent?.outputTranscription?.text?.length ??
            message?.outputTranscription?.text?.length ??
            0,
        inputTranscriptionLength: message?.serverContent?.inputTranscription?.text?.length ??
            message?.inputTranscription?.text?.length ??
            0,
    };
}
function getRewindSystemInstruction(personaId) {
    switch (personaId) {
        case "ella":
            return `You are Ella, the user's Rewind partner. You are warm, gentle, and reflective. Speak with soft clarity. Ask one thoughtful question at a time. Keep your spoken replies short. When the app opens a brand-new conversation or restores a previous one, follow the bootstrap instruction exactly. ${buildGuidedFlowInstruction()}`;
        case "lyra":
            return `You are Lyra, the user's Rewind partner. You are calm, poetic, and insight-oriented. Speak gently and keep your replies brief, grounded, and reflective. When the app opens a brand-new conversation or restores a previous one, follow the bootstrap instruction exactly. ${buildGuidedFlowInstruction()}`;
        case "jake":
            return `You are Jake, the user's Rewind partner. You are direct, energetic, and practical. Speak clearly, keep replies short, and help the user reflect with momentum. When the app opens a brand-new conversation or restores a previous one, follow the bootstrap instruction exactly. ${buildGuidedFlowInstruction()}`;
        case "ariel":
            return `You are Ariel, the user's Rewind partner. You are empathetic, optimistic, and grounded. Speak warmly, keep replies concise, and guide the user through a calm spoken rewind of their day. When the app opens a brand-new conversation or restores a previous one, follow the bootstrap instruction exactly. ${buildGuidedFlowInstruction()}`;
        default:
            return `You are the user's Rewind partner. Speak warmly, listen actively, and keep your spoken replies concise. When the app opens a brand-new conversation or restores a previous one, follow the bootstrap instruction exactly. ${buildGuidedFlowInstruction()}`;
    }
}
function buildOpeningPrompt(personaId, options) {
    const personaName = personaId.charAt(0).toUpperCase() + personaId.slice(1);
    if (options?.shouldIntroduce) {
        return (`This is the first time I am opening Rewind with you. ` +
            `Reply in exactly two short sentences. ` +
            `In the first sentence, introduce yourself as ${personaName}, my Rewind partner. ` +
            `In the second sentence, ask exactly: "Hey, how are you?"`);
    }
    return (`Open the conversation naturally in one short sentence and ask exactly: "Hey, how are you?" ` +
        `Do not introduce yourself again.`);
}
function buildResumePrompt() {
    return (`A previous Rewind session is being restored. ` +
        `Reply in exactly two short sentences. ` +
        `In the first sentence, briefly mention what we were just talking about or where we left off. ` +
        `In the second sentence, ask one simple follow-up question that continues from that point. ` +
        `Do not reintroduce yourself.`);
}
function buildResumePromptWithGuidedState(sessionState) {
    return (`A previous Rewind session is being restored. ` +
        `Reply in exactly two short sentences. ` +
        `In the first sentence, briefly mention where we left off using the saved rewind state below. ` +
        `In the second sentence, continue the guided flow by asking the correct next question from the saved state below. ` +
        `Do not reintroduce yourself, do not restart from question one, and do not skip ahead. ` +
        `Use this saved state as the source of truth:\n\n` +
        `${buildRestoreContextSummary(sessionState)}\n\n` +
        `${buildGuidedFlowSnapshot(sessionState)}`);
}
async function createLiveToken(req, res) {
    try {
        const userId = req.userId;
        const timezone = req.headers["x-user-tz"];
        const requestedPersonaId = req.body?.personaId;
        const personaId = isValidPersonaId(requestedPersonaId) ? requestedPersonaId : "ella";
        const requestedSessionId = typeof req.body?.sessionId === "string" && req.body.sessionId.trim()
            ? req.body.sessionId.trim()
            : undefined;
        const { sessionState } = await getOrCreateRewindSession({
            userId,
            personaId,
            requestedSessionId,
            timezone,
        });
        const token = createRewindWsToken(userId, personaId, sessionState.sessionId);
        res.json({
            msg: "Rewind live token created",
            data: {
                token,
                wsUrl: `/api/v1/rewind/live?token=${encodeURIComponent(token)}`,
                personaId,
                sessionId: sessionState.sessionId,
            },
        });
    }
    catch (error) {
        logger_util_1.default.error("Create rewind live token error", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
async function handleLiveConnection(ws, req) {
    const connectionId = createConnectionId();
    const wsToken = typeof req.query.token === "string" && req.query.token.trim()
        ? req.query.token.trim()
        : "";
    const auth = verifyRewindWsToken(wsToken);
    if (!auth?.userId) {
        ws.send(JSON.stringify({ type: "error", message: "Unauthorized Rewind websocket" }));
        ws.close();
        return;
    }
    const personaId = isValidPersonaId(auth.personaId) ? auth.personaId : "ella";
    const requestedSessionId = auth.sessionId?.trim() || undefined;
    const { sessionState, restored: shouldRestore, previousSession, } = await getOrCreateRewindSession({
        userId: auth.userId,
        personaId,
        requestedSessionId,
    });
    const voiceName = getRewindVoiceName(personaId);
    try {
        const apiKey = process.env.GEMINI_API_KEY;
        logger_util_1.default.info("Rewind live connection requested", {
            connectionId,
            personaId,
            sessionId: sessionState.sessionId,
            path: req.originalUrl,
            ip: req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown",
            userAgent: req.headers["user-agent"] || "unknown",
        });
        if (!apiKey) {
            logger_util_1.default.error("GEMINI_API_KEY is not set on the server", {
                connectionId,
                personaId,
            });
            ws.send(JSON.stringify({ type: "error", message: "GEMINI_API_KEY is not set on the server" }));
            ws.close();
            return;
        }
        const ai = new genai_1.GoogleGenAI({ apiKey });
        logger_util_1.default.info("Connecting rewind session to Gemini Live", {
            connectionId,
            personaId,
            sessionId: sessionState.sessionId,
            model: GEMINI_LIVE_MODEL,
            voiceName,
            responseModalities: ["AUDIO"],
        });
        let pendingUserTranscript = "";
        let pendingAssistantTranscript = "";
        const session = await ai.live.connect({
            model: GEMINI_LIVE_MODEL,
            config: {
                responseModalities: [genai_1.Modality.AUDIO],
                mediaResolution: genai_1.MediaResolution.MEDIA_RESOLUTION_LOW,
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: {
                            voiceName,
                        },
                    },
                },
                inputAudioTranscription: {},
                outputAudioTranscription: {},
                // realtimeInputConfig: {
                //   automaticActivityDetection: {
                //     disabled: false,
                //     startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_LOW,
                //     endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW,
                //     prefixPaddingMs: 20,
                //     silenceDurationMs: 120,
                //   },
                // },
                contextWindowCompression: {
                    triggerTokens: 104857,
                    slidingWindow: { targetTokens: 52428 },
                },
                realtimeInputConfig: {
                    automaticActivityDetection: {
                        disabled: false,
                        startOfSpeechSensitivity: genai_1.StartSensitivity.START_SENSITIVITY_HIGH,
                        endOfSpeechSensitivity: genai_1.EndSensitivity.END_SENSITIVITY_LOW,
                        prefixPaddingMs: 20,
                        silenceDurationMs: 100,
                    },
                    activityHandling: genai_1.ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
                },
                systemInstruction: {
                    parts: [{ text: getRewindSystemInstruction(personaId) }],
                },
                temperature: 0.7,
                maxOutputTokens: 256,
            },
            callbacks: {
                onopen: () => {
                    logger_util_1.default.info("Gemini Live session opened", {
                        connectionId,
                        personaId,
                        sessionId: sessionState.sessionId,
                    });
                },
                onmessage: async (message) => {
                    logger_util_1.default.debug("Gemini Live message received", {
                        connectionId,
                        personaId,
                        sessionId: sessionState.sessionId,
                        ...summarizeLiveMessage(message),
                    });
                    if (message.serverContent?.modelTurn?.parts) {
                        for (const part of message.serverContent.modelTurn.parts) {
                            if (part.inlineData?.data && ws.readyState === ws.OPEN) {
                                ws.send(JSON.stringify({
                                    type: "audio",
                                    mimeType: part.inlineData.mimeType || "audio/pcm;rate=24000",
                                    data: part.inlineData.data,
                                }));
                            }
                            if (part.text && ws.readyState === ws.OPEN) {
                                ws.send(JSON.stringify({ type: "text", content: part.text }));
                            }
                        }
                    }
                    const inputTranscript = message?.serverContent?.inputTranscription?.text ??
                        message?.inputTranscription?.text;
                    if (inputTranscript && ws.readyState === ws.OPEN) {
                        pendingUserTranscript = inputTranscript;
                        ws.send(JSON.stringify({ type: "input_transcription", content: inputTranscript }));
                    }
                    const outputTranscript = message?.serverContent?.outputTranscription?.text ??
                        message?.outputTranscription?.text;
                    if (outputTranscript && ws.readyState === ws.OPEN) {
                        pendingAssistantTranscript = outputTranscript;
                        ws.send(JSON.stringify({ type: "output_transcription", content: outputTranscript }));
                    }
                    if (message?.serverContent?.turnComplete && ws.readyState === ws.OPEN) {
                        recordGuidedFlowResponse(sessionState, pendingUserTranscript);
                        await persistRewindSession(sessionState);
                        pendingUserTranscript = "";
                        pendingAssistantTranscript = "";
                        ws.send(JSON.stringify({
                            type: "guided_flow_state",
                            guidedFlow: sessionState.guidedFlow,
                        }));
                        ws.send(JSON.stringify({ type: "turn_complete" }));
                    }
                    if (message?.setupComplete && ws.readyState === ws.OPEN) {
                        ws.send(JSON.stringify({
                            type: "ready",
                            sessionId: sessionState.sessionId,
                            sessionDateKey: sessionState.sessionDateKey,
                            restored: shouldRestore,
                            historyCount: Object.keys(sessionState.guidedFlow.responses).length,
                            guidedFlow: sessionState.guidedFlow,
                            previousSession,
                        }));
                        if (shouldRestore && sessionState.guidedFlow.openingAnswered) {
                            session.sendClientContent({
                                turns: [
                                    {
                                        role: "user",
                                        parts: [
                                            {
                                                text: buildResumePromptWithGuidedState(sessionState),
                                            },
                                        ],
                                    },
                                ],
                                turnComplete: true,
                            });
                        }
                        else {
                            const isFirstOpening = !sessionState.guidedFlow.openingAnswered;
                            session.sendClientContent({
                                turns: [
                                    {
                                        role: "user",
                                        parts: [
                                            {
                                                text: buildOpeningPrompt(personaId, {
                                                    shouldIntroduce: isFirstOpening,
                                                }),
                                            },
                                        ],
                                    },
                                ],
                                turnComplete: true,
                            });
                        }
                    }
                },
                onclose: (event) => {
                    console.log("Gemini Live session close", event);
                    logger_util_1.default.info("Gemini Live session closed", {
                        connectionId,
                        personaId,
                        sessionId: sessionState.sessionId,
                        event,
                    });
                    if (ws.readyState === ws.OPEN) {
                        ws.close();
                    }
                },
                onerror: (err) => {
                    console.log("Gemini Live session error", err);
                    logger_util_1.default.error("Gemini Live session error", {
                        connectionId,
                        personaId,
                        sessionId: sessionState.sessionId,
                        err,
                    });
                    if (ws.readyState === ws.OPEN) {
                        ws.send(JSON.stringify({ type: "error", message: "Gemini Live session error" }));
                        ws.close();
                    }
                },
            },
        });
        ws.on("message", (raw) => {
            try {
                const parsed = JSON.parse(raw.toString());
                if (parsed.type === "realtime_audio" && parsed.mimeType && parsed.data) {
                    logger_util_1.default.debug("Forwarding rewind realtime audio to Gemini", {
                        connectionId,
                        personaId,
                        sessionId: sessionState.sessionId,
                        mimeType: parsed.mimeType,
                        dataLength: parsed.data.length,
                    });
                    session.sendRealtimeInput({
                        audio: {
                            data: parsed.data,
                            mimeType: parsed.mimeType,
                        },
                    });
                    return;
                }
                if (parsed.type === "text" && parsed.content?.trim()) {
                    logger_util_1.default.info("Forwarding rewind text input to Gemini", {
                        connectionId,
                        personaId,
                        sessionId: sessionState.sessionId,
                        textLength: parsed.content.length,
                        preview: parsed.content.slice(0, 120),
                    });
                    session.sendClientContent({
                        turns: [{ role: "user", parts: [{ text: parsed.content }] }],
                        turnComplete: true,
                    });
                    return;
                }
                logger_util_1.default.warn("Ignoring unsupported rewind client payload", {
                    connectionId,
                    personaId,
                    sessionId: sessionState.sessionId,
                    type: parsed.type || "unknown",
                });
            }
            catch (err) {
                logger_util_1.default.error("Error processing message from rewind client", {
                    connectionId,
                    personaId,
                    sessionId: sessionState.sessionId,
                    err,
                });
                if (ws.readyState === ws.OPEN) {
                    ws.send(JSON.stringify({ type: "error", message: "Invalid live input payload" }));
                }
            }
        });
        ws.on("close", (code, reason) => {
            logger_util_1.default.info("Rewind client WebSocket closed", {
                connectionId,
                personaId,
                sessionId: sessionState.sessionId,
                code,
                reason: reason?.toString() || "",
            });
            try {
                if (typeof session.close === "function") {
                    session.close();
                }
            }
            catch (err) {
                logger_util_1.default.warn("Failed to close Gemini session after client disconnect", {
                    connectionId,
                    personaId,
                    sessionId: sessionState.sessionId,
                    err,
                });
            }
        });
        ws.on("error", (err) => {
            logger_util_1.default.error("Rewind client WebSocket error", {
                connectionId,
                personaId,
                sessionId: sessionState.sessionId,
                err,
            });
        });
    }
    catch (error) {
        logger_util_1.default.error("Create rewind live connection error", {
            connectionId,
            personaId,
            sessionId: typeof req.query.sessionId === "string" ? req.query.sessionId : undefined,
            error,
        });
        if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: "error", message: "Internal server error" }));
            ws.close();
        }
    }
}
