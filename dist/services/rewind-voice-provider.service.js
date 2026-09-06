"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RewindVoiceProviderConfigurationError = void 0;
exports.getConfiguredRewindVoiceProvider = getConfiguredRewindVoiceProvider;
exports.assertRewindVoiceProviderConfigured = assertRewindVoiceProviderConfigured;
exports.getElevenLabsVoiceConfig = getElevenLabsVoiceConfig;
const client_1 = require("@prisma/client");
const ELEVENLABS_PERSONA_VOICES = {
    ariel: {
        similarityBoost: 0.84,
        speed: 0.88,
        stability: 0.68,
        voiceId: "EXAVITQu4vr4xnSDxMaL",
    },
    ella: {
        similarityBoost: 0.76,
        speed: 0.92,
        stability: 0.36,
        voiceId: "FGY2WhTYpPnrIDTdsKH5",
    },
    jake: {
        similarityBoost: 0.88,
        speed: 0.9,
        stability: 0.72,
        voiceId: "iP95p4xoKVk53GoZ742B",
    },
    lyra: {
        similarityBoost: 0.82,
        speed: 0.86,
        stability: 0.76,
        voiceId: "Xb7hH8MSUJpSbSDYk0k2",
    },
    neeja: {
        similarityBoost: 0.86,
        speed: 0.88,
        stability: 0.74,
        voiceId: "XrExE9yKIg1WjnnlVkGX",
    },
    tobi: {
        similarityBoost: 0.78,
        speed: 0.96,
        stability: 0.42,
        voiceId: "TX3LPaxmHKxFdv7VOQHJ",
    },
};
class RewindVoiceProviderConfigurationError extends Error {
    constructor(message) {
        super(message);
        this.status = 503;
        this.name = "RewindVoiceProviderConfigurationError";
    }
}
exports.RewindVoiceProviderConfigurationError = RewindVoiceProviderConfigurationError;
function getConfiguredRewindVoiceProvider(environment = process.env) {
    const configuredProvider = environment.REWIND_LIVE_VOICE_PROVIDER?.trim().toUpperCase();
    if (!configuredProvider ||
        configuredProvider === client_1.RewindVoiceProvider.GEMINI) {
        return client_1.RewindVoiceProvider.GEMINI;
    }
    if (configuredProvider === client_1.RewindVoiceProvider.ELEVENLABS) {
        return client_1.RewindVoiceProvider.ELEVENLABS;
    }
    throw new RewindVoiceProviderConfigurationError("REWIND_LIVE_VOICE_PROVIDER must be GEMINI or ELEVENLABS");
}
function assertRewindVoiceProviderConfigured(provider, environment = process.env) {
    if (provider === client_1.RewindVoiceProvider.GEMINI) {
        if (!environment.GEMINI_API_KEY?.trim()) {
            throw new RewindVoiceProviderConfigurationError("GEMINI_API_KEY is required when Rewind uses Gemini Live");
        }
        return;
    }
    if (!environment.ELEVENLABS_API_KEY?.trim() ||
        !environment.ELEVENLABS_AGENT_ID?.trim()) {
        throw new RewindVoiceProviderConfigurationError("ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID are required when Rewind uses ElevenLabs Live");
    }
}
function getElevenLabsVoiceConfig(personaId, environment = process.env) {
    const defaultConfig = ELEVENLABS_PERSONA_VOICES[personaId];
    const configuredVoiceId = environment[`ELEVENLABS_VOICE_${personaId.toUpperCase()}`]?.trim();
    return {
        ...defaultConfig,
        voiceId: configuredVoiceId || defaultConfig.voiceId,
    };
}
