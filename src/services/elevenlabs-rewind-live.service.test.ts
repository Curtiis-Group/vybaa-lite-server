import assert from "node:assert/strict";
import test from "node:test";
import {
  buildElevenLabsInitiationPayload,
  getElevenLabsPcmMimeType,
  getElevenLabsSignedUrl,
  isTrustedElevenLabsSignedUrl,
} from "./elevenlabs-rewind-live.service";

test("ElevenLabs Live accepts only supported PCM output formats", () => {
  assert.equal(getElevenLabsPcmMimeType("pcm_16000"), "audio/pcm;rate=16000");
  assert.equal(getElevenLabsPcmMimeType("pcm_24000"), "audio/pcm;rate=24000");
  assert.equal(getElevenLabsPcmMimeType("mp3_44100_128"), null);
  assert.equal(getElevenLabsPcmMimeType("pcm_12345"), null);
});

test("ElevenLabs signed URLs are restricted to official secure hosts", () => {
  assert.equal(
    isTrustedElevenLabsSignedUrl(
      "wss://api.elevenlabs.io/v1/convai/conversation?token=secret",
    ),
    true,
  );
  assert.equal(
    isTrustedElevenLabsSignedUrl(
      "wss://api.eu.residency.elevenlabs.io/v1/convai/conversation?token=secret",
    ),
    true,
  );
  assert.equal(
    isTrustedElevenLabsSignedUrl(
      "wss://api.elevenlabs.io.attacker.example/conversation",
    ),
    false,
  );
  assert.equal(
    isTrustedElevenLabsSignedUrl("https://api.elevenlabs.io/conversation"),
    false,
  );
});

test("ElevenLabs initiation keeps credentials server-side and applies persona overrides", () => {
  const payload = buildElevenLabsInitiationPayload({
    dynamicVariables: { partner_name: "Neeja", user_name: "Nia" },
    firstMessage: "hey Nia, what's been on your mind?",
    prompt: "You are Neeja.",
    voiceConfig: {
      similarityBoost: 0.86,
      speed: 0.94,
      stability: 0.74,
      voiceId: "voice-neeja",
    },
  });
  const serialized = JSON.stringify(payload);

  assert.equal(payload.type, "conversation_initiation_client_data");
  assert.match(serialized, /voice-neeja/);
  assert.match(serialized, /You are Neeja/);
  assert.match(serialized, /similarity_boost/);
  assert.match(serialized, /0\.94/);
  assert.doesNotMatch(serialized, /api[_-]?key/i);
});

test("ElevenLabs signed URL request authenticates without exposing the API key in the URL", async () => {
  let requestedUrl = "";
  let requestedKey = "";
  const signedUrl = await getElevenLabsSignedUrl({
    agentId: "agent-1",
    apiKey: "private-key",
    fetcher: async (input, init) => {
      requestedUrl = String(input);
      requestedKey = String(new Headers(init?.headers).get("xi-api-key"));
      return new Response(
        JSON.stringify({
          signed_url:
            "wss://api.elevenlabs.io/v1/convai/conversation?token=short-lived",
        }),
        { status: 200 },
      );
    },
  });

  assert.match(requestedUrl, /agent_id=agent-1/);
  assert.doesNotMatch(requestedUrl, /private-key/);
  assert.equal(requestedKey, "private-key");
  assert.match(signedUrl, /^wss:\/\/api\.elevenlabs\.io/);
});
