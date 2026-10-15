const RELATIVE_TIME_UNITS: ReadonlyArray<{ readonly label: string; readonly seconds: number }> = [
  { label: "year", seconds: 365 * 86400 },
  { label: "month", seconds: 30 * 86400 },
  { label: "week", seconds: 7 * 86400 },
  { label: "day", seconds: 86400 },
  { label: "hour", seconds: 3600 },
  { label: "minute", seconds: 60 },
];

// Human-readable relative time for a snapshot timestamp (in milliseconds),
// matching the "x minutes ago" phrasing used elsewhere for git history.
export function relativeTime(startedAtEpochMs: number, now: number): string {
  const elapsedSeconds = Math.max(0, Math.floor((now - startedAtEpochMs) / 1000));

  if (elapsedSeconds < 60) {
    return "just now";
  }

  for (const unit of RELATIVE_TIME_UNITS) {
    const value = Math.floor(elapsedSeconds / unit.seconds);

    if (value >= 1) {
      return `${value} ${unit.label}${value === 1 ? "" : "s"} ago`;
    }
  }

  return "just now";
}
