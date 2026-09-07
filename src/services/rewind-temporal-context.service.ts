import { DateTime } from "luxon";

export type RewindDayPhase = "afternoon" | "evening" | "morning" | "night";

export type RewindTemporalContext = {
  dayPhase: RewindDayPhase;
  localDateTime: string;
  timezone: string;
};

function getDayPhase(hour: number): RewindDayPhase {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

export function normalizeRewindContextTimezone(value: unknown): string {
  if (typeof value !== "string") return "UTC";
  const timezone = value.trim();
  if (!timezone || timezone.length > 64) return "UTC";
  return DateTime.now().setZone(timezone).isValid ? timezone : "UTC";
}

export function getRewindTemporalContext(
  timezone: unknown,
  now: Date = new Date(),
): RewindTemporalContext {
  const normalizedTimezone = normalizeRewindContextTimezone(timezone);
  const localNow = DateTime.fromJSDate(now, { zone: normalizedTimezone });
  const offset = localNow.offsetNameShort
    ? `, ${localNow.offsetNameShort}`
    : "";
  return {
    dayPhase: getDayPhase(localNow.hour),
    localDateTime: `${localNow.toFormat("cccc, LLLL d, yyyy 'at' h:mm a")} (${normalizedTimezone}${offset})`,
    timezone: normalizedTimezone,
  };
}

export function formatRewindTemporalContext(
  timezone: unknown,
  now: Date = new Date(),
): string {
  const context = getRewindTemporalContext(timezone, now);
  return (
    `Current local moment for the user: ${context.localDateTime}. It is ${context.dayPhase}. ` +
    "Use this quietly to understand today, yesterday, tomorrow, tonight, lateness, and what would feel natural now. Never recite the clock or force a time-of-day greeting unless it genuinely matters."
  );
}

export function formatRewindMessageMoment(
  value: Date | string,
  timezone: unknown,
  now: Date = new Date(),
): string {
  const normalizedTimezone = normalizeRewindContextTimezone(timezone);
  const parsed =
    value instanceof Date
      ? DateTime.fromJSDate(value, { zone: normalizedTimezone })
      : DateTime.fromISO(value, { setZone: true }).setZone(normalizedTimezone);
  if (!parsed.isValid) return "time unavailable";

  const elapsedMinutes = Math.floor(
    (now.getTime() - parsed.toMillis()) / (60 * 1000),
  );
  let relative = "just now";
  if (elapsedMinutes >= 24 * 60) {
    const days = Math.floor(elapsedMinutes / (24 * 60));
    relative = `${days}d ago`;
  } else if (elapsedMinutes >= 60) {
    relative = `${Math.floor(elapsedMinutes / 60)}h ago`;
  } else if (elapsedMinutes > 0) {
    relative = `${elapsedMinutes}m ago`;
  }

  return `${parsed.toFormat("ccc, LLL d 'at' h:mm a")} (${relative})`;
}
