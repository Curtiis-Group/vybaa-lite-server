# ElevenLabs Rewind Live

Rewind uses one authenticated live-session path. The backend chooses Gemini Live
or ElevenLabs Live for every normal scheduled Rewind from one environment
variable; provider credentials never reach the app.

## 1. Configure the ElevenLabs agent

Create one private ElevenLabs Agent. In its Security/Overrides settings, allow
overrides for:

- System prompt
- First message
- Voice ID

Configure user input as PCM 16 kHz and agent output as PCM 24 kHz. Keep
`Optimize streaming latency` at `0`; higher legacy optimization levels trade
away voice quality and make live output less clear. The Vybaa player reads the
output rate from ElevenLabs connection metadata, so input and output do not
need to use the same sample rate.

Enable these client events:

- `conversation_initiation_metadata`
- `audio`
- `user_transcript`
- `agent_response`
- `agent_response_correction`
- `agent_response_complete`
- `interruption`

The `agent_response_complete` event closes a spoken turn and allows Vybaa to
persist its transcript safely. A 15-second fallback remains for older agent
configurations.

## 2. Select the live provider

Use Gemini Live:

```dotenv
REWIND_LIVE_VOICE_PROVIDER=GEMINI
GEMINI_API_KEY=...
```

Use ElevenLabs Live:

```dotenv
REWIND_LIVE_VOICE_PROVIDER=ELEVENLABS
ELEVENLABS_API_KEY=...
ELEVENLABS_AGENT_ID=...
```

Restart the backend after changing the provider. Rewind records the selected
provider on the session when it creates the live token.

Vybaa includes a distinct, gender-matched voice and delivery profile for every
partner. Optional `ELEVENLABS_VOICE_ELLA`, `ELEVENLABS_VOICE_LYRA`, and other
partner values can recast an individual voice without changing its speed,
stability, or similarity tuning. Any replacement must first be available in
the ElevenLabs workspace.

Verify ElevenLabs authentication with:

```bash
npm run test:elevenlabs
```
