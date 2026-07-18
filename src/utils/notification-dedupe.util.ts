function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isNotificationDedupeConflict(
  error: unknown,
  dedupeKey: string | undefined,
): boolean {
  return Boolean(dedupeKey) && isRecord(error) && error.code === "P2002";
}
