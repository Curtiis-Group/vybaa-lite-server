import "dotenv/config";
import { getElevenLabsSignedUrl } from "../services/elevenlabs-rewind-live.service";

async function main(): Promise<void> {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  const agentId = process.env.ELEVENLABS_AGENT_ID?.trim();
  if (!apiKey || !agentId) {
    throw new Error(
      "Set ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID before running this check",
    );
  }

  await getElevenLabsSignedUrl({ agentId, apiKey });
  const configuredVoices = [
    "ELLA",
    "LYRA",
    "JAKE",
    "ARIEL",
    "TOBI",
    "NEEJA",
  ].filter((persona) =>
    Boolean(process.env[`ELEVENLABS_VOICE_${persona}`]?.trim()),
  );
  console.log("ElevenLabs agent authentication is ready.");
  console.log(
    configuredVoices.length
      ? `Configured partner voices: ${configuredVoices.join(", ")}`
      : "No partner voice overrides are configured; the agent default will be used.",
  );
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "ElevenLabs check failed",
  );
  process.exitCode = 1;
});
