"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ElevenLabsRewindLiveConnection = void 0;
exports.getElevenLabsPcmMimeType = getElevenLabsPcmMimeType;
exports.isTrustedElevenLabsSignedUrl = isTrustedElevenLabsSignedUrl;
exports.buildElevenLabsInitiationPayload = buildElevenLabsInitiationPayload;
exports.getElevenLabsSignedUrl = getElevenLabsSignedUrl;
const ws_1 = __importDefault(require("ws"));
const ELEVENLABS_SIGNED_URL_ENDPOINT = "https://api.elevenlabs.io/v1/convai/conversation/get-signed-url";
const ELEVENLABS_REQUEST_TIMEOUT_MS = 10000;
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function getNestedString(value, containerKey, fieldKey) {
    const container = value[containerKey];
    if (!isRecord(container))
        return null;
    const field = container[fieldKey];
    return typeof field === "string" && field.trim() ? field.trim() : null;
}
function getElevenLabsPcmMimeType(format) {
    if (typeof format !== "string")
        return null;
    const match = /^pcm_(8000|16000|22050|24000|44100|48000)$/.exec(format);
    return match ? `audio/pcm;rate=${match[1]}` : null;
}
function isTrustedElevenLabsSignedUrl(value) {
    try {
        const url = new URL(value);
        const isTrustedHost = url.hostname === "api.elevenlabs.io" ||
            /^api\.(eu|in|sg)\.residency\.elevenlabs\.io$/.test(url.hostname);
        return url.protocol === "wss:" && isTrustedHost;
    }
    catch {
        return false;
    }
}
function buildElevenLabsInitiationPayload(options) {
    return {
        conversation_config_override: {
            agent: {
                first_message: options.firstMessage,
                language: "en",
                prompt: { prompt: options.prompt },
            },
            tts: {
                similarity_boost: options.voiceConfig.similarityBoost,
                speed: options.voiceConfig.speed,
                stability: options.voiceConfig.stability,
                voice_id: options.voiceConfig.voiceId,
            },
        },
        custom_llm_extra_body: {
            max_tokens: 512,
            temperature: 0.8,
        },
        dynamic_variables: options.dynamicVariables,
        type: "conversation_initiation_client_data",
    };
}
async function getElevenLabsSignedUrl(options) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ELEVENLABS_REQUEST_TIMEOUT_MS);
    try {
        const endpoint = new URL(ELEVENLABS_SIGNED_URL_ENDPOINT);
        endpoint.searchParams.set("agent_id", options.agentId);
        const response = await (options.fetcher ?? fetch)(endpoint, {
            headers: { "xi-api-key": options.apiKey },
            signal: controller.signal,
        });
        if (!response.ok) {
            throw new Error(`ElevenLabs signed URL request failed (${response.status})`);
        }
        const payload = await response.json();
        const signedUrl = isRecord(payload) && typeof payload.signed_url === "string"
            ? payload.signed_url.trim()
            : "";
        if (!signedUrl || !isTrustedElevenLabsSignedUrl(signedUrl)) {
            throw new Error("ElevenLabs returned an invalid signed URL");
        }
        return signedUrl;
    }
    finally {
        clearTimeout(timeout);
    }
}
class ElevenLabsRewindLiveConnection {
    constructor(options) {
        this.options = options;
        this.outputMimeType = "audio/pcm;rate=16000";
        this.socket = null;
    }
    async connect() {
        const signedUrl = await getElevenLabsSignedUrl({
            agentId: this.options.agentId,
            apiKey: this.options.apiKey,
        });
        await new Promise((resolve, reject) => {
            let settled = false;
            const socket = new ws_1.default(signedUrl);
            this.socket = socket;
            socket.once("open", () => {
                settled = true;
                socket.send(JSON.stringify(buildElevenLabsInitiationPayload({
                    dynamicVariables: this.options.dynamicVariables,
                    firstMessage: this.options.firstMessage,
                    prompt: this.options.prompt,
                    voiceConfig: this.options.voiceConfig,
                })));
                resolve();
            });
            socket.on("message", (data) => {
                this.handleMessage(data.toString());
            });
            socket.on("close", (code, reason) => {
                this.socket = null;
                this.options.handlers.onClose(code, reason.toString());
            });
            socket.on("error", (error) => {
                const message = error instanceof Error ? error.message : "Connection error";
                this.options.handlers.onError(message);
                if (!settled)
                    reject(error);
            });
        });
    }
    close() {
        this.socket?.close(1000, "Vybaa Rewind connection closed");
        this.socket = null;
    }
    sendAudio(data) {
        this.send({ user_audio_chunk: data });
    }
    sendUserMessage(text) {
        this.send({ text, type: "user_message" });
    }
    handleMessage(raw) {
        let event;
        try {
            event = JSON.parse(raw);
        }
        catch {
            this.options.handlers.onError("ElevenLabs returned malformed JSON");
            return;
        }
        if (!isRecord(event) || typeof event.type !== "string")
            return;
        if (event.type === "conversation_initiation_metadata") {
            const metadata = event.conversation_initiation_metadata_event;
            if (!isRecord(metadata)) {
                this.options.handlers.onError("ElevenLabs omitted conversation metadata");
                return;
            }
            const outputMimeType = getElevenLabsPcmMimeType(metadata.agent_output_audio_format);
            const inputMimeType = getElevenLabsPcmMimeType(metadata.user_input_audio_format);
            if (!outputMimeType || inputMimeType !== "audio/pcm;rate=16000") {
                this.options.handlers.onError("ElevenLabs agent audio must use 16 kHz PCM input and PCM output");
                this.close();
                return;
            }
            this.outputMimeType = outputMimeType;
            this.options.handlers.onReady(typeof metadata.conversation_id === "string"
                ? metadata.conversation_id
                : null);
            return;
        }
        if (event.type === "ping") {
            const ping = event.ping_event;
            if (isRecord(ping) && typeof ping.event_id === "number") {
                this.send({ event_id: ping.event_id, type: "pong" });
            }
            return;
        }
        if (event.type === "audio") {
            const audio = getNestedString(event, "audio_event", "audio_base_64");
            if (audio)
                this.options.handlers.onAudio(audio, this.outputMimeType);
            return;
        }
        if (event.type === "user_transcript") {
            const transcript = getNestedString(event, "user_transcription_event", "user_transcript");
            if (transcript)
                this.options.handlers.onUserTranscript(transcript);
            return;
        }
        if (event.type === "agent_response") {
            const response = getNestedString(event, "agent_response_event", "agent_response");
            if (response)
                this.options.handlers.onAgentResponse(response);
            return;
        }
        if (event.type === "agent_response_correction") {
            const correction = getNestedString(event, "agent_response_correction_event", "corrected_agent_response");
            if (correction)
                this.options.handlers.onAgentResponse(correction);
            return;
        }
        if (event.type === "agent_response_complete") {
            this.options.handlers.onAgentResponseComplete();
            return;
        }
        if (event.type === "interruption") {
            this.options.handlers.onInterrupted();
            return;
        }
        if (event.type === "client_error") {
            const message = getNestedString(event, "client_error", "message") ??
                "ElevenLabs reported a conversation error";
            this.options.handlers.onError(message);
        }
    }
    send(payload) {
        if (this.socket?.readyState !== ws_1.default.OPEN)
            return;
        this.socket.send(JSON.stringify(payload));
    }
}
exports.ElevenLabsRewindLiveConnection = ElevenLabsRewindLiveConnection;
