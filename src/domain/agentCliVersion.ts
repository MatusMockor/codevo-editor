import type { AgentCliKind } from "./agentTask";

const MAX_AGENT_CLI_VERSION_BYTES = 64;
const AGENT_CLI_VERSION_PATTERN = /^\d{1,6}(?:\.\d{1,6}){1,3}(?:-[0-9A-Za-z.]{1,32})?$/;
const MAX_AGENT_CLI_VERSION_SEGMENTS = 4;
const DIGITS_PATTERN = /^\d+$/;
const LEADING_ZEROS_PATTERN = /^0+/;

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

export function compareAgentCliVersions(left: unknown, right: unknown): -1 | 0 | 1 | null {
  const parsedLeft = canonicalAgentCliVersion(left);
  if (parsedLeft === null) return null;
  const parsedRight = canonicalAgentCliVersion(right);
  if (parsedRight === null) return null;
  const [leftNumeric, leftPrerelease] = splitAgentCliVersion(parsedLeft);
  const [rightNumeric, rightPrerelease] = splitAgentCliVersion(parsedRight);
  for (let index = 0; index < MAX_AGENT_CLI_VERSION_SEGMENTS; index += 1) {
    const order = compareDigits(leftNumeric[index] ?? "0", rightNumeric[index] ?? "0");
    if (order !== 0) return order;
  }
  if (leftPrerelease === null && rightPrerelease === null) return 0;
  if (leftPrerelease === null) return 1;
  if (rightPrerelease === null) return -1;
  return comparePrerelease(leftPrerelease.split("."), rightPrerelease.split("."));
}

function canonicalAgentCliVersion(value: unknown): string | null {
  const parsed = parseAgentCliVersion(value);
  if (parsed === null || parsed !== value) return null;
  return parsed;
}

function splitAgentCliVersion(version: string): [readonly string[], string | null] {
  const separator = version.indexOf("-");
  if (separator === -1) return [version.split("."), null];
  return [version.slice(0, separator).split("."), version.slice(separator + 1)];
}

function comparePrerelease(left: readonly string[], right: readonly string[]): -1 | 0 | 1 {
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index += 1) {
    const order = comparePrereleaseIdentifier(left[index]!, right[index]!);
    if (order !== 0) return order;
  }
  return compareNumbers(left.length, right.length);
}

function comparePrereleaseIdentifier(left: string, right: string): -1 | 0 | 1 {
  const leftNumeric = DIGITS_PATTERN.test(left);
  const rightNumeric = DIGITS_PATTERN.test(right);
  if (leftNumeric && rightNumeric) return compareDigits(left, right);
  if (leftNumeric) return -1;
  if (rightNumeric) return 1;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareDigits(left: string, right: string): -1 | 0 | 1 {
  const leftTrimmed = left.replace(LEADING_ZEROS_PATTERN, "");
  const rightTrimmed = right.replace(LEADING_ZEROS_PATTERN, "");
  const byLength = compareNumbers(leftTrimmed.length, rightTrimmed.length);
  if (byLength !== 0) return byLength;
  if (leftTrimmed === rightTrimmed) return 0;
  return leftTrimmed < rightTrimmed ? -1 : 1;
}

function compareNumbers(left: number, right: number): -1 | 0 | 1 {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function unsupportedKind(kind: never): never {
  throw new TypeError(`Unsupported agent CLI kind: ${String(kind)}`);
}
