export const FLEXX_DESIGN_CONFIG = {
  batchSize: 10,
  maxPages: 24,
  generationIntervalMs: 6 * 60 * 60 * 1000,
  maxCollections: 24,
  leaseMs: 60_000,
  failureRetryMs: 5 * 60 * 1000,
  timeoutMs: 18_000,
  maxOutputTokens: 4_400,
} as const;
