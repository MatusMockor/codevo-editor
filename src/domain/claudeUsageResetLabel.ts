import { isKnownTimeZone, zonedWallTimeToEpochMs, type WallTime } from "./calendarDateTime";

const MAX_LABEL_LENGTH = 200;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const RESET_LABEL =
  /^(?:([a-z]{3})[a-z]{0,6}\.? (\d{1,2})(?:, (\d{4}))? at )?(\d{1,2})(?::(\d{2}))? ?(am|pm) \(([A-Za-z0-9_+\-/]{1,64})\)$/iu;

interface ParsedResetLabel {
  readonly month: number | null;
  readonly day: number | null;
  readonly year: number | null;
  readonly hour: number;
  readonly minute: number;
  readonly timeZone: string;
}

export function claudeUsageResetEpochMs(label: string, nowEpochMs: number): number | null {
  if (!Number.isFinite(nowEpochMs)) return null;
  const parsed = parseResetLabel(label);
  if (parsed === null) return null;
  const candidates = candidateWallTimes(parsed, nowEpochMs)
    .map((wall) => zonedWallTimeToEpochMs(wall, parsed.timeZone))
    .filter((epochMs): epochMs is number => epochMs !== null);
  return nearest(candidates, nowEpochMs);
}

function parseResetLabel(label: string): ParsedResetLabel | null {
  if (label.length > MAX_LABEL_LENGTH) return null;
  const match = RESET_LABEL.exec(label.trim());
  if (match === null) return null;
  const [, monthName, day, year, hour, minute, meridiem, timeZone] = match;
  const clockHour = Number(hour);
  const clockMinute = minute === undefined ? 0 : Number(minute);
  if (clockHour < 1 || clockHour > 12 || clockMinute > 59) return null;
  if (timeZone === undefined || meridiem === undefined || !isKnownTimeZone(timeZone)) return null;
  const month = monthName === undefined ? null : MONTHS.indexOf(monthName.toLowerCase()) + 1;
  if (month === 0) return null;
  return {
    month,
    day: day === undefined ? null : Number(day),
    year: year === undefined ? null : Number(year),
    hour: (clockHour % 12) + (meridiem.toLowerCase() === "pm" ? 12 : 0),
    minute: clockMinute,
    timeZone,
  };
}

function candidateWallTimes(parsed: ParsedResetLabel, nowEpochMs: number): WallTime[] {
  const time = { hour: parsed.hour, minute: parsed.minute };
  const nowYear = new Date(nowEpochMs).getUTCFullYear();
  if (parsed.month === null || parsed.day === null) {
    return [-1, 0, 1].map((offset) => {
      const date = new Date(nowEpochMs + offset * 86_400_000);
      return {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
        ...time,
      };
    });
  }
  const { month, day } = parsed;
  const years = parsed.year === null ? [nowYear - 1, nowYear, nowYear + 1] : [parsed.year];
  return years.map((year) => ({ year, month, day, ...time }));
}

function nearest(candidates: readonly number[], nowEpochMs: number): number | null {
  let best: number | null = null;
  for (const candidate of candidates) {
    if (best === null || Math.abs(candidate - nowEpochMs) < Math.abs(best - nowEpochMs)) {
      best = candidate;
    }
  }
  return best;
}
