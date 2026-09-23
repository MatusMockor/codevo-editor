export const MAX_RUNTIME_SUBAGENT_RECENT_ACTIVITY = 6;
export const MAX_RUNTIME_SUBAGENT_RECENT_ACTIVITY_CHARACTERS = 160;

export function appendAgentRuntimeSubagentActivity(
  history: ReadonlyArray<string>,
  summary: string | undefined,
): ReadonlyArray<string> {
  const line = recentActivityLine(summary);
  if (line === null) return history;
  if (history[history.length - 1] === line) return history;
  const next = [...history, line];
  if (next.length <= MAX_RUNTIME_SUBAGENT_RECENT_ACTIVITY) return next;
  return next.slice(next.length - MAX_RUNTIME_SUBAGENT_RECENT_ACTIVITY);
}

export function boundedAgentRuntimeSubagentActivity(
  history: ReadonlyArray<string> | undefined,
): ReadonlyArray<string> {
  if (history === undefined) return [];
  return history.reduce<ReadonlyArray<string>>(appendAgentRuntimeSubagentActivity, []);
}

export function sameAgentRuntimeSubagentActivity(
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
): boolean {
  return left.length === right.length && left.every((line, index) => line === right[index]);
}

function recentActivityLine(summary: string | undefined): string | null {
  if (summary === undefined) return null;
  const line = summary.trim().replace(/\s+/gu, " ");
  if (line === "") return null;
  const characters = [...line];
  if (characters.length <= MAX_RUNTIME_SUBAGENT_RECENT_ACTIVITY_CHARACTERS) return line;
  return `${characters.slice(0, MAX_RUNTIME_SUBAGENT_RECENT_ACTIVITY_CHARACTERS - 1).join("")}…`;
}
