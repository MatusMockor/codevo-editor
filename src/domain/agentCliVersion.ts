import { MAX_AGENT_TASK_PATH_BYTES, type AgentCliKind } from "./agentTask";

export const MAX_AGENT_CLI_VERSION_BYTES = 64;
export const AGENT_CLI_VERSION_PATTERN = /^\d{1,6}(?:\.\d{1,6}){1,3}(?:-[0-9A-Za-z.]{1,32})?$/;

export interface AgentCliVersionProbeRequest {
  readonly agentCliPath: string;
  readonly agentCliKind: AgentCliKind;
}

export interface AgentCliBinaryFingerprint {
  readonly sizeBytes: number;
  readonly modifiedEpochMs: number;
}

export interface AgentCliVersionProbeResult {
  readonly version: string | null;
  readonly probedAtEpochMs: number;
  readonly binaryFingerprint: AgentCliBinaryFingerprint;
}

export interface AgentCliVersionGateway {
  probeAgentCliVersion(request: AgentCliVersionProbeRequest): Promise<AgentCliVersionProbeResult>;
}

export type AgentCliVersionComparison = "same" | "changed" | "unknown";

export function compareAgentCliVersions(
  previous: string | null,
  current: string | null,
): AgentCliVersionComparison {
  if (previous === null || current === null) return "unknown";
  if (previous === current) return "same";
  return "changed";
}

export function agentCliBinaryLabel(kind: AgentCliKind): string {
  switch (kind) {
    case "claudeCode":
      return "claude";
    case "codex":
      return "codex";
    default:
      return unsupportedKind(kind);
  }
}

export function agentCliProductLabel(kind: AgentCliKind): string {
  switch (kind) {
    case "claudeCode":
      return "Claude";
    case "codex":
      return "Codex";
    default:
      return unsupportedKind(kind);
  }
}

export function agentCliVersionLabel(kind: AgentCliKind, version: string | null): string | null {
  if (version === null) return null;
  return `${agentCliBinaryLabel(kind)} ${version}`;
}

export function agentCliVersionChangeMessage(
  kind: AgentCliKind,
  previous: string,
  current: string,
): string {
  return `${agentCliProductLabel(kind)} CLI updated ${previous} → ${current}. Turns now run on the new version.`;
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

export function validateAgentCliVersionProbeRequest(value: unknown): AgentCliVersionProbeRequest {
  const request = record(value, "request");
  exactKeys(request, ["agentCliPath", "agentCliKind"], "request");
  return {
    agentCliPath: absolutePath(request.agentCliPath, "request.agentCliPath"),
    agentCliKind: cliKind(request.agentCliKind, "request.agentCliKind"),
  };
}

export function parseAgentCliVersionProbeResult(value: unknown): AgentCliVersionProbeResult {
  const result = record(value, "result");
  exactKeys(result, ["version", "probedAtEpochMs", "binaryFingerprint"], "result");
  const fingerprint = record(result.binaryFingerprint, "result.binaryFingerprint");
  exactKeys(fingerprint, ["sizeBytes", "modifiedEpochMs"], "result.binaryFingerprint");
  return {
    version: optionalVersion(result.version, "result.version"),
    probedAtEpochMs: unsignedSafeInteger(result.probedAtEpochMs, "result.probedAtEpochMs"),
    binaryFingerprint: {
      sizeBytes: unsignedSafeInteger(fingerprint.sizeBytes, "result.binaryFingerprint.sizeBytes"),
      modifiedEpochMs: unsignedSafeInteger(
        fingerprint.modifiedEpochMs,
        "result.binaryFingerprint.modifiedEpochMs",
      ),
    },
  };
}

function optionalVersion(value: unknown, path: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") return invalid(path, "expected a version string or null");
  const version = parseAgentCliVersion(value);
  if (version === null || version !== value) {
    return invalid(path, "expected a bounded semantic version");
  }
  return version;
}

function absolutePath(value: unknown, path: string): string {
  if (typeof value !== "string" || value === "" || byteLength(value) > MAX_AGENT_TASK_PATH_BYTES) {
    return invalid(path, "expected a bounded path string");
  }
  if (!value.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(value)) {
    return invalid(path, "expected an absolute path");
  }
  return value;
}

function cliKind(value: unknown, path: string): AgentCliKind {
  if (value === "claudeCode" || value === "codex") return value;
  return invalid(path, "expected claudeCode or codex");
}

function unsignedSafeInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return invalid(path, "expected a non-negative safe integer");
  }
  return value;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: ReadonlyArray<string>,
  path: string,
): void {
  const present = Object.keys(value);
  const expected = new Set(keys);
  for (const key of present) {
    if (!expected.has(key)) invalid(`${path}.${key}`, "unexpected field");
  }
  for (const key of keys) {
    if (!(key in value)) invalid(`${path}.${key}`, "missing field");
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid(path, "expected an object");
  }
  return value as Record<string, unknown>;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function unsupportedKind(kind: never): never {
  throw new TypeError(`Unsupported agent CLI kind: ${String(kind)}`);
}

function invalid(path: string, expectation: string): never {
  throw new TypeError(`Invalid agent CLI version value at ${path}: ${expectation}.`);
}
