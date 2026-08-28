import type { AgentCliKind } from "./agentTask";

export const MAX_AGENT_PROVIDER_SIGN_IN_TERMINAL_DIMENSION = 65_535;

export interface AgentProviderSignInTerminalSize {
  readonly cols: number;
  readonly rows: number;
}

export interface AgentProviderSignInRequest {
  readonly provider: AgentCliKind;
  readonly providerGeneration: number;
  readonly size: AgentProviderSignInTerminalSize;
}

export type AgentProviderSignInRefusalReason =
  | "disabled"
  | "notConfigured"
  | "turnActive"
  | "updating"
  | "alreadySigningIn"
  | "staleAuthority"
  | "spawnFailed";

export type AgentProviderSignInResult =
  | {
      readonly kind: "started";
      readonly provider: AgentCliKind;
      readonly providerGeneration: number;
      readonly sessionId: number;
    }
  | {
      readonly kind: "refused";
      readonly provider: AgentCliKind;
      readonly providerGeneration: number;
      readonly reason: AgentProviderSignInRefusalReason;
    };

export type AgentProviderSignInState =
  | { readonly kind: "idle" }
  | {
      readonly kind: "starting";
      readonly provider: AgentCliKind;
      readonly providerGeneration: number;
    }
  | {
      readonly kind: "running";
      readonly provider: AgentCliKind;
      readonly providerGeneration: number;
      readonly sessionId: number;
    }
  | {
      readonly kind: "settled";
      readonly provider: AgentCliKind;
      readonly providerGeneration: number;
      readonly sessionId: number;
      readonly exitCode: number | null;
      readonly healthRefresh: "refreshing" | "complete" | "failed";
    }
  | {
      readonly kind: "failed";
      readonly provider: AgentCliKind;
      readonly providerGeneration: number;
      readonly reason: AgentProviderSignInRefusalReason | "uncertain";
    };

export interface AgentProviderSignInGateway {
  startAgentProviderSignIn(request: AgentProviderSignInRequest): Promise<AgentProviderSignInResult>;
}

export function validateAgentProviderSignInRequest(value: unknown): AgentProviderSignInRequest {
  const request = object(value, "request");
  exactKeys(request, ["provider", "providerGeneration", "size"], "request");
  return {
    provider: provider(request.provider, "request.provider"),
    providerGeneration: positiveInteger(request.providerGeneration, "request.providerGeneration"),
    size: terminalSize(request.size, "request.size"),
  };
}

export function parseAgentProviderSignInResult(value: unknown): AgentProviderSignInResult {
  const result = object(value, "result");
  if (result.kind === "started") {
    exactKeys(result, ["kind", "provider", "providerGeneration", "sessionId"], "result");
    return {
      kind: "started",
      provider: provider(result.provider, "result.provider"),
      providerGeneration: positiveInteger(result.providerGeneration, "result.providerGeneration"),
      sessionId: positiveInteger(result.sessionId, "result.sessionId"),
    };
  }
  if (result.kind === "refused") {
    exactKeys(result, ["kind", "provider", "providerGeneration", "reason"], "result");
    return {
      kind: "refused",
      provider: provider(result.provider, "result.provider"),
      providerGeneration: positiveInteger(result.providerGeneration, "result.providerGeneration"),
      reason: refusalReason(result.reason, "result.reason"),
    };
  }
  return invalid("result.kind", "expected started or refused");
}

function terminalSize(value: unknown, path: string): AgentProviderSignInTerminalSize {
  const size = object(value, path);
  exactKeys(size, ["cols", "rows"], path);
  return {
    cols: terminalDimension(size.cols, `${path}.cols`),
    rows: terminalDimension(size.rows, `${path}.rows`),
  };
}

function terminalDimension(value: unknown, path: string): number {
  const parsed = positiveInteger(value, path);
  if (parsed > MAX_AGENT_PROVIDER_SIGN_IN_TERMINAL_DIMENSION) {
    return invalid(path, `expected at most ${MAX_AGENT_PROVIDER_SIGN_IN_TERMINAL_DIMENSION}`);
  }
  return parsed;
}

function refusalReason(value: unknown, path: string): AgentProviderSignInRefusalReason {
  if (
    value === "disabled" ||
    value === "notConfigured" ||
    value === "turnActive" ||
    value === "updating" ||
    value === "alreadySigningIn" ||
    value === "staleAuthority" ||
    value === "spawnFailed"
  ) {
    return value;
  }
  return invalid(path, "expected a supported sign-in refusal reason");
}

function provider(value: unknown, path: string): AgentCliKind {
  if (value === "claudeCode" || value === "codex") return value;
  return invalid(path, "expected claudeCode or codex");
}

function positiveInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    return invalid(path, "expected a positive safe integer");
  }
  return value;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: ReadonlyArray<string>,
  path: string,
): void {
  const expected = new Set(keys);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") invalid(path, "unexpected symbol field");
    if (!expected.has(key)) invalid(`${path}.${key}`, "unexpected field");
    if (!Object.prototype.propertyIsEnumerable.call(value, key)) {
      invalid(`${path}.${key}`, "expected an enumerable field");
    }
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      invalid(`${path}.${key}`, "missing own field");
    }
  }
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid(path, "expected an object");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return invalid(path, "expected a plain object");
  }
  return value as Record<string, unknown>;
}

function invalid(path: string, expectation: string): never {
  throw new TypeError(`Invalid agent provider sign-in value at ${path}: ${expectation}.`);
}
