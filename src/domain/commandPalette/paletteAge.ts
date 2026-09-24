const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

export function compactAgeLabel(nowMs: number, thenMs: number): string {
  const elapsed = nowMs - thenMs;
  if (!Number.isFinite(elapsed) || elapsed < MINUTE) return "now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
  if (elapsed < WEEK) return `${Math.floor(elapsed / DAY)}d`;
  return `${Math.floor(elapsed / WEEK)}w`;
}
