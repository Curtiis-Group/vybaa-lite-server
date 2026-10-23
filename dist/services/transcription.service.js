"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TranscriptionService = exports.TranscriptionError = void 0;
exports.validateTranscriptionAudio = validateTranscriptionAudio;
exports.transcribeAudio = transcribeAudio;
const node_crypto_1 = require("node:crypto");
const zod_1 = require("zod");
const transcription_config_1 = require("../config/transcription.config");
class TranscriptionError extends Error {
    constructor(message, status, code) {
        super(message);
        this.status = status;
        this.code = code;
        this.name = "TranscriptionError";
    }
}
exports.TranscriptionError = TranscriptionError;
function validateTranscriptionAudio(body, contentType) {
    if (!Buffer.isBuffer(body) || !body.length) {
        throw new TranscriptionError("Choose a non-empty audio recording.", 400, "AUDIO_REQUIRED");
    }
    if (body.length > transcription_config_1.transcriptionConfig.maxBytes) {
        throw new TranscriptionError("Audio must be 12 MB or smaller.", 413, "AUDIO_TOO_LARGE");
    }
    const mimeType = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
    const head = body.subarray(0, 16);
    const ascii = head.toString("ascii");
    let extension;
    if (["audio/wav", "audio/wave", "audio/x-wav"].includes(mimeType) &&
        ascii.startsWith("RIFF") &&
        ascii.slice(8, 12) === "WAVE")
        extension = "wav";
    if (mimeType === "audio/webm" &&
        head.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])))
        extension = "webm";
    if (["audio/ogg", "application/ogg"].includes(mimeType) &&
        ascii.startsWith("OggS"))
        extension = "ogg";
    if (["audio/mp4", "audio/m4a", "audio/x-m4a", "audio/aac"].includes(mimeType) &&
        ascii.slice(4, 8) === "ftyp")
        extension = "m4a";
    if (mimeType === "audio/aac" &&
        head[0] === 0xff &&
        ((head[1] ?? 0) & 0xf6) === 0xf0)
        extension = "aac";
    if (["audio/mpeg", "audio/mp3"].includes(mimeType) &&
        (ascii.startsWith("ID3") ||
            (head[0] === 0xff && ((head[1] ?? 0) & 0xe0) === 0xe0)))
        extension = "mp3";
    if (["audio/flac", "audio/x-flac"].includes(mimeType) &&
        ascii.startsWith("fLaC"))
        extension = "flac";
    if (!extension) {
        throw new TranscriptionError("Use an M4A, AAC, MP3, WAV, WebM, OGG or FLAC audio file.", 415, "UNSUPPORTED_AUDIO");
    }
    return { bytes: body, mimeType, extension };
}
const providerResponse = zod_1.z.object({
    text: zod_1.z.string().max(50000),
    language_code: zod_1.z.string().nullable().optional(),
});
async function transcribeAudio(audio, signal, options = {}) {
    const apiKey = options.apiKey ?? process.env.ELEVENLABS_API_KEY;
    if (!apiKey?.trim()) {
        throw new TranscriptionError("Audio transcription is not configured yet.", 503, "TRANSCRIPTION_UNAVAILABLE");
    }
    const form = new FormData();
    form.set("model_id", transcription_config_1.transcriptionConfig.model);
    form.set("file", new Blob([new Uint8Array(audio.bytes)], { type: audio.mimeType }), `recording.${audio.extension}`);
    form.set("tag_audio_events", "false");
    form.set("diarize", "false");
    const timeout = AbortSignal.timeout(transcription_config_1.transcriptionConfig.timeoutMs);
    try {
        const response = await (options.fetcher ?? fetch)(transcription_config_1.transcriptionConfig.endpoint, {
            method: "POST",
            headers: { "xi-api-key": apiKey },
            body: form,
            signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
        if (!response.ok) {
            const invalid = response.status === 400 || response.status === 422;
            throw new TranscriptionError(invalid
                ? "This recording could not be read. Try another audio file."
                : "Transcription is temporarily unavailable. Your recording can be retried.", invalid ? 422 : 503, invalid ? "INVALID_AUDIO" : "TRANSCRIPTION_UNAVAILABLE");
        }
        const payload = await response.json();
        const parsed = providerResponse.safeParse(payload);
        if (!parsed.success)
            throw new TranscriptionError("The transcription service returned an invalid response. Please retry.", 502, "INVALID_TRANSCRIPT");
        const text = parsed.data.text.trim();
        if (!text)
            throw new TranscriptionError("No speech was detected. Try a clearer recording.", 422, "NO_SPEECH");
        return { text, language: parsed.data.language_code ?? null };
    }
    catch (error) {
        if (error instanceof TranscriptionError)
            throw error;
        if (signal?.aborted)
            throw new TranscriptionError("Transcription cancelled.", 499, "CANCELLED");
        if (timeout.aborted)
            throw new TranscriptionError("Transcription timed out. Retry your recording.", 504, "TRANSCRIPTION_TIMEOUT");
        throw new TranscriptionError("Could not reach the transcription service. Retry your recording.", 503, "TRANSCRIPTION_UNAVAILABLE");
    }
}
/** Short-lived, account-scoped deduplication; never persists source audio. */
class TranscriptionService {
    constructor(transcriber = transcribeAudio) {
        this.transcriber = transcriber;
        this.cache = new Map();
        this.activeUsers = new Set();
        this.attempts = new Map();
    }
    async create(userId, requestId, audio, signal) {
        const now = Date.now();
        for (const [key, entry] of this.cache)
            if (entry.expires <= now)
                this.cache.delete(key);
        for (const [key, entry] of this.attempts)
            if (entry.expires <= now)
                this.attempts.delete(key);
        const key = `${userId}:${requestId}`;
        const fingerprint = (0, node_crypto_1.createHash)("sha256")
            .update(audio.mimeType)
            .update(audio.bytes)
            .digest("hex");
        const cached = this.cache.get(key);
        if (cached) {
            if (cached.fingerprint !== fingerprint)
                throw new TranscriptionError("This request ID belongs to a different recording.", 409, "REQUEST_CONFLICT");
            return cached.result;
        }
        if (this.activeUsers.has(userId))
            throw new TranscriptionError("A transcription is already running. Please wait.", 409, "TRANSCRIPTION_IN_PROGRESS");
        if (this.activeUsers.size >= transcription_config_1.transcriptionConfig.maxConcurrent)
            throw new TranscriptionError("Transcription is busy. Please try again shortly.", 503, "TRANSCRIPTION_BUSY");
        const previous = this.attempts.get(userId);
        if ((previous?.count ?? 0) >= transcription_config_1.transcriptionConfig.requestsPerWindow ||
            this.attempts.size >= 10000)
            throw new TranscriptionError("Please wait before transcribing another recording.", 429, "TRANSCRIPTION_LIMIT");
        this.attempts.set(userId, {
            count: (previous?.count ?? 0) + 1,
            expires: previous?.expires ?? now + transcription_config_1.transcriptionConfig.rateWindowMs,
        });
        this.activeUsers.add(userId);
        try {
            const result = await this.transcriber(audio, signal);
            if (signal?.aborted)
                throw new TranscriptionError("Transcription cancelled.", 499, "CANCELLED");
            while (this.cache.size >= transcription_config_1.transcriptionConfig.maxCachedResults) {
                const oldest = this.cache.keys().next().value;
                if (oldest)
                    this.cache.delete(oldest);
            }
            this.cache.set(key, {
                fingerprint,
                expires: Date.now() + transcription_config_1.transcriptionConfig.retryWindowMs,
                result,
            });
            return result;
        }
        finally {
            this.activeUsers.delete(userId);
        }
    }
}
exports.TranscriptionService = TranscriptionService;
