"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.transcriptionConfig = void 0;
// Non-secret provider and resource settings belong here, not in .env.
exports.transcriptionConfig = {
    provider: "elevenlabs",
    endpoint: "https://api.elevenlabs.io/v1/speech-to-text",
    model: "scribe_v2",
    maxBytes: 12 * 1024 * 1024,
    timeoutMs: 60000,
    retryWindowMs: 5 * 60000,
    rateWindowMs: 10 * 60000,
    requestsPerWindow: 10,
    maxConcurrent: 16,
    maxCachedResults: 200,
};
