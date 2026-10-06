export type AgentCliKind = "claudeCode" | "codex";
export type AgentTaskOutputStream = "stdout" | "stderr";

export const MAX_AGENT_SESSION_ID_BYTES = 128;
export const AGENT_SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/;

const UTF8_ENCODER = new TextEncoder();

export function isAgentSessionId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    UTF8_ENCODER.encode(value).byteLength <= MAX_AGENT_SESSION_ID_BYTES &&
    AGENT_SESSION_ID_PATTERN.test(value)
  );
}
