export function relativeAge(epochSeconds: number, nowMs: number): string {
  const seconds = Math.max(0, Math.round(nowMs / 1000 - epochSeconds));
  if (seconds < 60) return "now";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}
