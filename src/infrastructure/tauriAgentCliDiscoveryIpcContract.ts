import { parseAgentCliVersion } from "../domain/agentCliVersion";
import {
  normalizeAgentCliPath,
  type AgentCliDiscoveryRequest,
  type AgentCliDiscoveryResult,
  type AgentCliDiscoveryState,
} from "../domain/agentSettings";

export const DISCOVER_AGENT_CLIS_IPC_COMMAND = "discover_agent_clis" as const;

export type InvokeAgentCliDiscoveryCommand = (
  command: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

export async function invokeDiscoverAgentClisIpc(
  invokeCommand: InvokeAgentCliDiscoveryCommand,
  request: AgentCliDiscoveryRequest,
): Promise<AgentCliDiscoveryResult> {
  const validated = validateAgentCliDiscoveryRequest(request);
  return parseAgentCliDiscoveryResult(
    await invokeCommand(DISCOVER_AGENT_CLIS_IPC_COMMAND, { request: validated }),
  );
}

export function validateAgentCliDiscoveryRequest(value: unknown): AgentCliDiscoveryRequest {
  const request = record(value, "request");
  exactKeys(request, ["refresh"], "request");
  if (typeof request.refresh !== "boolean") {
    return invalid("request.refresh", "expected a boolean");
  }
  return { refresh: request.refresh };
}

export function parseAgentCliDiscoveryResult(value: unknown): AgentCliDiscoveryResult {
  const result = record(value, "result");
  exactKeys(result, ["claudeCode", "codex"], "result");
  return {
    claudeCode: discoveryState(result.claudeCode, "result.claudeCode"),
    codex: discoveryState(result.codex, "result.codex"),
  };
}

function discoveryState(value: unknown, path: string): AgentCliDiscoveryState {
  const state = record(value, path);
  if (state.kind === "notFound") {
    exactKeys(state, ["kind"], path);
    return { kind: "notFound" };
  }
  if (state.kind === "detected") {
    exactKeys(state, ["kind", "path", "version"], path);
    return {
      kind: "detected",
      path: absolutePath(state.path, `${path}.path`),
      version: optionalVersion(state.version, `${path}.version`),
    };
  }
  return invalid(`${path}.kind`, "expected detected or notFound");
}

function absolutePath(value: unknown, path: string): string {
  if (typeof value !== "string" || normalizeAgentCliPath(value) !== value) {
    return invalid(path, "expected a bounded absolute path");
  }
  return value;
}

function optionalVersion(value: unknown, path: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || parseAgentCliVersion(value) !== value) {
    return invalid(path, "expected a bounded semantic version or null");
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
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      invalid(`${path}.${key}`, "missing field");
    }
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid(path, "expected an object");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return invalid(path, "expected a plain object");
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return invalid(path, "unexpected symbol field");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      return invalid(`${path}.${key}`, "expected an enumerable data field");
    }
  }
  return value as Record<string, unknown>;
}

function invalid(path: string, expectation: string): never {
  throw new TypeError(`Invalid agent CLI discovery value at ${path}: ${expectation}.`);
}
