import assert from "node:assert/strict";
import test from "node:test";
import { RewindVoiceProvider } from "@prisma/client";
import {
  assertRewindVoiceProviderConfigured,
  getConfiguredRewindVoiceProvider,
  getElevenLabsVoiceConfig,
} from "./rewind-voice-provider.service";

const PERSONAS = ["ariel", "ella", "jake", "lyra", "neeja", "tobi"] as const;

test("Rewind live defaults to Gemini and accepts either provider switch", () => {
  assert.equal(
    getConfiguredRewindVoiceProvider({}),
    RewindVoiceProvider.GEMINI,
  );
  assert.equal(
    getConfiguredRewindVoiceProvider({
      REWIND_LIVE_VOICE_PROVIDER: "elevenlabs",
    }),
    RewindVoiceProvider.ELEVENLABS,
  );
  assert.throws(
    () =>
      getConfiguredRewindVoiceProvider({
        REWIND_LIVE_VOICE_PROVIDER: "unsupported",
      }),
    /must be GEMINI or ELEVENLABS/,
  );
});

test("the selected live provider requires its own credentials", () => {
  assert.doesNotThrow(() =>
    assertRewindVoiceProviderConfigured(RewindVoiceProvider.GEMINI, {
      GEMINI_API_KEY: "gemini-key",
    }),
  );
  assert.doesNotThrow(() =>
    assertRewindVoiceProviderConfigured(RewindVoiceProvider.ELEVENLABS, {
      ELEVENLABS_AGENT_ID: "agent-1",
      ELEVENLABS_API_KEY: "elevenlabs-key",
    }),
  );
  assert.throws(
    () =>
      assertRewindVoiceProviderConfigured(RewindVoiceProvider.ELEVENLABS, {}),
    /ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID/,
  );
});

test("each Rewind partner has a unique tuned ElevenLabs voice", () => {
  const voiceConfigs = PERSONAS.map((personaId) =>
    getElevenLabsVoiceConfig(personaId, {}),
  );

  assert.equal(
    new Set(voiceConfigs.map((config) => config.voiceId)).size,
    PERSONAS.length,
  );
  for (const config of voiceConfigs) {
    assert.ok(config.similarityBoost >= 0 && config.similarityBoost <= 1);
    assert.ok(config.speed >= 0.7 && config.speed <= 1.2);
    assert.ok(config.stability >= 0 && config.stability <= 1);
  }
});

test("an environment voice ID can recast one partner without losing tuning", () => {
  const voice = getElevenLabsVoiceConfig("ella", {
    ELEVENLABS_VOICE_ELLA: "custom-ella",
  });

  assert.equal(voice.voiceId, "custom-ella");
  assert.equal(voice.speed, 0.92);
  assert.equal(voice.stability, 0.36);
});
