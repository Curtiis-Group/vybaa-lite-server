// Non-secret provider and resource settings belong here, not in .env.
export const transcriptionConfig = {
  provider: "elevenlabs",
  endpoint: "https://api.elevenlabs.io/v1/speech-to-text",
  model: "scribe_v2",
  maxBytes: 12 * 1024 * 1024,
  timeoutMs: 60_000,
  retryWindowMs: 5 * 60_000,
  rateWindowMs: 10 * 60_000,
  requestsPerWindow: 10,
  maxConcurrent: 16,
  maxCachedResults: 200,
} as const;
