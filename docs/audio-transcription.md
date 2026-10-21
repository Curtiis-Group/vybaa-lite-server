# Audio transcription

Journal, the legacy check-in sheet and Chill use the same record/import → transcribe → review → add-to-text control. Chill's existing feature flag is unchanged. Task audio attachments remain attachments; Rewind conversation transcripts are unaffected.

## Configuration

- Keep `ELEVENLABS_API_KEY` server-side in the existing environment.
- Provider, Scribe model, byte limit, timeout and abuse limits live in `src/config/transcription.config.ts`.
- Deploy the backend endpoint before shipping the corresponding app. No schema migration is needed.
- The installed native recorder returns `stopRecording().value`; the adapter unwraps this envelope. Browser capture uses MediaRecorder. Physical-device permission/interruption checks are still required before an app-store release.

## API

`POST /api/v1/transcriptions` (also mounted under `/mycove/v1/transcriptions` by the existing router).

Authenticated Bearer request, binary audio body, `Content-Type: audio/...` and a UUID `x-transcription-id`. Supports M4A/MP4 audio, AAC, MP3, WAV, WebM, OGG and FLAC. Source container signatures and a 12 MiB size limit are checked server-side. Live recordings stop at five minutes; imported files are byte-limited, not server duration-limited. No arbitrary remote URLs are accepted.

Success: `{ "msg": "Recording transcribed", "data": { "text": "Spoken words", "language": "eng" } }`.

Errors include invalid/empty audio (400/415/422), oversized audio (413), conflicting/in-flight requests (409), request limit (429), provider/configuration failure (503), and timeout (504). A failed recording stays local in the mounted control for explicit retry; do not automatically retry paid requests. Reuse its request ID when retrying the same bytes.

## Privacy and resource handling

- No source audio is persisted in Vybaa storage or sent to Cloudinary by this flow. The provider receives audio; this integration does not claim provider zero-retention.
- No audio body or transcript is logged. Results use `Cache-Control: private, no-store`.
- Successful transcripts are cached in process memory for up to five minutes (maximum 200 results), scoped to the authenticated account, request ID and audio hash. An ID reused with different bytes is rejected while cached. Failed requests are not cached.
- At most one active request per account and 16 globally per process; 10 paid attempts per account per ten-minute window. These are per-instance safeguards, not a durable distributed quota. For multi-instance deployments, back limits and retry results with the existing Redis service before promising global quotas/idempotency.
- Cancel/navigation aborts the client request and upstream fetch. Browser object URLs and owned microphones are released; cancelling one control cannot stop another control's recorder.
- Only reviewed text explicitly added to the editor is passed to its existing save operation. Length overflow requires editing, never silent truncation.

## Verification

Backend: `npx tsx --test src/services/transcription.service.test.ts src/routes/transcription.routes.test.ts`.

App: `npx vitest run src/components/common/audio-transcription.component.test.tsx src/shared/audio/recording-session.test.ts src/plugins/capacitor/plugins/voice-recorder.plugin.test.ts`.

Also check microphone denial, background/interruption, navigation while recording, each native OS, imports with missing MIME metadata, no-speech recordings, offline retries, text limits and save behaviour. The server needs Node Web Fetch/FormData/Blob and AbortSignal support, consistent with the existing supported Node runtime.
