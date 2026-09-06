"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const elevenlabs_rewind_live_service_1 = require("../services/elevenlabs-rewind-live.service");
async function main() {
    const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
    const agentId = process.env.ELEVENLABS_AGENT_ID?.trim();
    if (!apiKey || !agentId) {
        throw new Error("Set ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID before running this check");
    }
    await (0, elevenlabs_rewind_live_service_1.getElevenLabsSignedUrl)({ agentId, apiKey });
    const configuredVoices = [
        "ELLA",
        "LYRA",
        "JAKE",
        "ARIEL",
        "TOBI",
        "NEEJA",
    ].filter((persona) => Boolean(process.env[`ELEVENLABS_VOICE_${persona}`]?.trim()));
    console.log("ElevenLabs agent authentication is ready.");
    console.log(configuredVoices.length
        ? `Configured partner voices: ${configuredVoices.join(", ")}`
        : "No partner voice overrides are configured; the agent default will be used.");
}
void main().catch((error) => {
    console.error(error instanceof Error ? error.message : "ElevenLabs check failed");
    process.exitCode = 1;
});
