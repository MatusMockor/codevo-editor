export function historyDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function historyMessage(subject: string, body: string): string {
  const trimmed = body.trim();
  const firstBreak = trimmed.indexOf("\n");
  if (firstBreak < 0) return trimmed === subject.trim() ? "" : trimmed;
  if (trimmed.slice(0, firstBreak).trim() !== subject.trim()) return trimmed;
  return trimmed.slice(firstBreak + 1).trimStart();
}
