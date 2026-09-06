import { RewindVoiceProvider } from "@prisma/client";

type RewindPersonaId = "ariel" | "ella" | "jake" | "lyra" | "neeja" | "tobi";

export type ElevenLabsRewindVoiceConfig = {
  similarityBoost: number;
  speed: number;
  stability: number;
  voiceId: string;
};

const ELEVENLABS_PERSONA_VOICES: Record<
  RewindPersonaId,
  ElevenLabsRewindVoiceConfig
> = {
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

export class RewindVoiceProviderConfigurationError extends Error {
  public readonly status = 503;

  public constructor(message: string) {
    super(message);
    this.name = "RewindVoiceProviderConfigurationError";
  }
}

export function getConfiguredRewindVoiceProvider(
  environment: NodeJS.ProcessEnv = process.env,
): RewindVoiceProvider {
  const configuredProvider =
    environment.REWIND_LIVE_VOICE_PROVIDER?.trim().toUpperCase();
  if (
    !configuredProvider ||
    configuredProvider === RewindVoiceProvider.GEMINI
  ) {
    return RewindVoiceProvider.GEMINI;
  }
  if (configuredProvider === RewindVoiceProvider.ELEVENLABS) {
    return RewindVoiceProvider.ELEVENLABS;
  }
  throw new RewindVoiceProviderConfigurationError(
    "REWIND_LIVE_VOICE_PROVIDER must be GEMINI or ELEVENLABS",
  );
}

export function assertRewindVoiceProviderConfigured(
  provider: RewindVoiceProvider,
  environment: NodeJS.ProcessEnv = process.env,
): void {
  if (provider === RewindVoiceProvider.GEMINI) {
    if (!environment.GEMINI_API_KEY?.trim()) {
      throw new RewindVoiceProviderConfigurationError(
        "GEMINI_API_KEY is required when Rewind uses Gemini Live",
      );
    }
    return;
  }

  if (
    !environment.ELEVENLABS_API_KEY?.trim() ||
    !environment.ELEVENLABS_AGENT_ID?.trim()
  ) {
    throw new RewindVoiceProviderConfigurationError(
      "ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID are required when Rewind uses ElevenLabs Live",
    );
  }
}

export function getElevenLabsVoiceConfig(
  personaId: RewindPersonaId,
  environment: NodeJS.ProcessEnv = process.env,
): ElevenLabsRewindVoiceConfig {
  const defaultConfig = ELEVENLABS_PERSONA_VOICES[personaId];
  const configuredVoiceId =
    environment[`ELEVENLABS_VOICE_${personaId.toUpperCase()}`]?.trim();
  return {
    ...defaultConfig,
    voiceId: configuredVoiceId || defaultConfig.voiceId,
  };
}
