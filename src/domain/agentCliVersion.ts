import type { AgentCliKind } from "./agentTask";

const MAX_AGENT_CLI_VERSION_BYTES = 64;
const AGENT_CLI_VERSION_PATTERN = /^\d{1,6}(?:\.\d{1,6}){1,3}(?:-[0-9A-Za-z.]{1,32})?$/;

function agentCliProductLabel(kind: AgentCliKind): string {
  switch (kind) {
    case "claudeCode":
      return "Claude";
    case "codex":
      return "Codex";
    default:
      return unsupportedKind(kind);
  }
}

export function agentCliBinaryUnavailableMessage(kind: AgentCliKind): string {
  return `The ${agentCliProductLabel(kind)} CLI binary is missing or not executable (it may be updating). Retry in a moment.`;
}

export function parseAgentCliVersion(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "" || byteLength(trimmed) > MAX_AGENT_CLI_VERSION_BYTES) return null;
  if (!AGENT_CLI_VERSION_PATTERN.test(trimmed)) return null;
  return trimmed;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function unsupportedKind(kind: never): never {
  throw new TypeError(`Unsupported agent CLI kind: ${String(kind)}`);
}
