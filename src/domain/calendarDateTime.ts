const MAX_TIME_VALUE = 8_640_000_000_000_000;
const DAY_MS = 86_400_000;

export interface CalendarClock {
  readonly nowEpochMs: number;
  readonly locale?: string;
  readonly timeZone?: string;
}

export type CalendarDayRelation = "yesterday" | "today" | "tomorrow" | "sameYear" | "otherYear";

export interface CalendarDateTime {
  readonly relation: CalendarDayRelation;
  readonly day: string;
  readonly time: string;
  readonly title: string;
  readonly iso: string;
}

export interface WallTime {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

export function calendarDateTime(epochMs: number, clock: CalendarClock): CalendarDateTime | null {
  if (!isRepresentable(epochMs) || !isRepresentable(clock.nowEpochMs)) return null;
  if (clock.timeZone !== undefined && !isKnownTimeZone(clock.timeZone)) return null;
  const at = zonedWallTime(epochMs, clock.timeZone);
  const now = zonedWallTime(clock.nowEpochMs, clock.timeZone);
  const relation = dayRelation(at, now);
  const zone = { timeZone: clock.timeZone };
  return {
    relation,
    day: dayLabel(epochMs, relation, clock.locale, zone),
    time: new Intl.DateTimeFormat(clock.locale, {
      ...zone,
      hour: "2-digit",
      minute: "2-digit",
    }).format(epochMs),
    title: new Intl.DateTimeFormat(clock.locale, {
      ...zone,
      dateStyle: "full",
      timeStyle: "short",
    }).format(epochMs),
    iso: new Date(epochMs).toISOString(),
  };
}

export function zonedWallTimeToEpochMs(wall: WallTime, timeZone?: string): number | null {
  if (!isValidWallTime(wall)) return null;
  if (timeZone !== undefined && !isKnownTimeZone(timeZone)) return null;
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  const firstGuess = asUtc - zoneOffsetMs(asUtc, timeZone);
  const settled = asUtc - zoneOffsetMs(firstGuess, timeZone);
  return isRepresentable(settled) ? settled : null;
}

export function isKnownTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

function dayLabel(
  epochMs: number,
  relation: CalendarDayRelation,
  locale: string | undefined,
  zone: { readonly timeZone: string | undefined },
): string {
  switch (relation) {
    case "yesterday":
    case "today":
    case "tomorrow":
      return relation;
    case "sameYear":
      return new Intl.DateTimeFormat(locale, {
        ...zone,
        weekday: "short",
        day: "numeric",
        month: "short",
      }).format(epochMs);
    case "otherYear":
      return new Intl.DateTimeFormat(locale, {
        ...zone,
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(epochMs);
    default: {
      const unreachable: never = relation;
      return unreachable;
    }
  }
}

function dayRelation(at: WallTime, now: WallTime): CalendarDayRelation {
  const dayDelta = (civilDayMs(at) - civilDayMs(now)) / DAY_MS;
  if (dayDelta === 0) return "today";
  if (dayDelta === -1) return "yesterday";
  if (dayDelta === 1) return "tomorrow";
  return at.year === now.year ? "sameYear" : "otherYear";
}

function civilDayMs(wall: WallTime): number {
  return Date.UTC(wall.year, wall.month - 1, wall.day);
}

function zoneOffsetMs(epochMs: number, timeZone: string | undefined): number {
  const wall = zonedWallTime(epochMs, timeZone);
  const wallAsUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  return wallAsUtc - Math.floor(epochMs / 60_000) * 60_000;
}

function zonedWallTime(epochMs: number, timeZone: string | undefined): WallTime {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(epochMs);
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((entry) => entry.type === type)?.value);
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
  };
}

function isValidWallTime(wall: WallTime): boolean {
  const values = [wall.year, wall.month, wall.day, wall.hour, wall.minute];
  if (!values.every(Number.isInteger)) return false;
  if (wall.hour < 0 || wall.hour > 23 || wall.minute < 0 || wall.minute > 59) return false;
  const civil = new Date(Date.UTC(wall.year, wall.month - 1, wall.day));
  return (
    civil.getUTCFullYear() === wall.year &&
    civil.getUTCMonth() === wall.month - 1 &&
    civil.getUTCDate() === wall.day
  );
}

function isRepresentable(epochMs: number): boolean {
  return Number.isFinite(epochMs) && Math.abs(epochMs) <= MAX_TIME_VALUE;
}
