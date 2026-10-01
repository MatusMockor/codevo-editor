import type { AgentCliKind, AgentTaskOutputStream } from "../agentTask";
import { isClaudeInformationalFrameNotice } from "./claudeStreamNotices";

const CODEX_STDIN_NOTICE = "reading additional input from stdin...";

export function isAgentRawOutputNoise(
  provider: AgentCliKind,
  stream: AgentTaskOutputStream,
  raw: string,
): boolean {
  if (provider === "claudeCode") {
    return stream === "stdout" && isClaudeInformationalFrameNotice(raw);
  }
  if (stream !== "stderr") return false;
  if (provider !== "codex") return false;

  return raw.trim().toLowerCase() === CODEX_STDIN_NOTICE;
}
