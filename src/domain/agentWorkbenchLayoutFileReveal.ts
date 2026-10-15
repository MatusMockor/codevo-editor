export const MAX_AGENT_FILE_REVEAL_PATH_CHARS = 4_096;
export const MAX_AGENT_FILE_REVEAL_LINE = 10_000_000;

export interface AgentFileRevealTarget {
  readonly path: string;
  readonly line: number | null;
}

export interface AgentFileViewerReveal extends AgentFileRevealTarget {
  readonly sequence: number;
  readonly request?: number | null;
}

export function parseAgentFileRevealTarget(
  path: unknown,
  line: unknown,
): AgentFileRevealTarget | null {
  if (typeof path !== "string") return null;
  if (path.length === 0 || path.length > MAX_AGENT_FILE_REVEAL_PATH_CHARS) return null;
  if (path.includes("\u0000")) return null;
  return { path, line: parseRevealLine(line) };
}

function parseRevealLine(line: unknown): number | null {
  if (typeof line !== "number" || !Number.isInteger(line)) return null;
  if (line < 1 || line > MAX_AGENT_FILE_REVEAL_LINE) return null;
  return line;
}
