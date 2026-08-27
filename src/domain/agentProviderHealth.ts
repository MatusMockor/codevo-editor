import { parseAgentCliVersion } from "./agentCliVersion";
import { normalizeAgentCliPath } from "./agentSettings";
import type { AgentCliKind } from "./agentTask";

export const MAX_AGENT_PROVIDER_AUTH_LABEL_BYTES = 256;
export const MIN_AGENT_PROVIDER_OPERATION_ID_BYTES = 8;
export const MAX_AGENT_PROVIDER_OPERATION_ID_BYTES = 128;
export const MAX_AGENT_PROVIDER_UPDATE_OUTPUT_TAIL_BYTES = 32 * 1024;

export type ClaudeAuthStatusCapability = "json" | "text" | "unavailable";

export type AgentProviderAuthState =
  | { readonly kind: "signedIn"; readonly label: string | null }
  | { readonly kind: "signedOut" }
  | { readonly kind: "unknown" };

export type AgentProviderInstaller =
  | { readonly kind: "npm"; readonly packageName: "@anthropic-ai/claude-code" | "@openai/codex" }
  | { readonly kind: "homebrew"; readonly cask: "claude-code" | "codex" }
  | { readonly kind: "unknown" };

export type AgentProviderUpdateAvailability =
  | { readonly kind: "checksDisabled" }
  | { readonly kind: "checking" }
  | { readonly kind: "current"; readonly installedVersion: string }
  | {
      readonly kind: "available";
      readonly installedVersion: string;
      readonly availableVersion: string;
      readonly installer: Exclude<AgentProviderInstaller, { readonly kind: "unknown" }>;
    }
  | {
      readonly kind: "unavailable";
      readonly reason: "unknownInstaller" | "unsupportedProbe" | "invalidVersion" | "probeFailed";
    };

export type AgentProviderPolicyRegistrationState =
  | { readonly kind: "unregistered" }
  | { readonly kind: "registering"; readonly settingsRevision: number }
  | {
      readonly kind: "registered";
      readonly settingsRevision: number;
      readonly providerGeneration: number;
    }
  | {
      readonly kind: "failed";
      readonly settingsRevision: number;
      readonly reason:
        "registrationFailed" | "revisionConflict" | "staleRevision" | "generationConflict";
    };

export type AgentProviderHealthState =
  | { readonly kind: "disabled" }
  | { readonly kind: "notConfigured" }
  | { readonly kind: "checking"; readonly generation: number }
  | {
      readonly kind: "ready";
      readonly installedVersion: string | null;
      readonly auth: AgentProviderAuthState;
      readonly update: AgentProviderUpdateAvailability;
      readonly checkedAtEpochMs: number;
    }
  | {
      readonly kind: "failed";
      readonly reason: "invalidPath" | "policyRegistrationFailed" | "probeFailed" | "timedOut";
      readonly checkedAtEpochMs: number | null;
    };

export type AgentProviderAdmissionAuthority =
  | {
      readonly provider: AgentCliKind;
      readonly revision: number;
      readonly disposition: { readonly kind: "ready" };
      readonly cliPath: string;
      readonly providerGeneration: number;
    }
  | {
      readonly provider: AgentCliKind;
      readonly revision: number;
      readonly disposition: { readonly kind: "disabled" };
    }
  | {
      readonly provider: AgentCliKind;
      readonly revision: number;
      readonly disposition: { readonly kind: "updating" };
      readonly cliPath: string;
      readonly providerGeneration: number;
    }
  | {
      readonly provider: AgentCliKind;
      readonly revision: number;
      readonly disposition: {
        readonly kind: "policyUnavailable";
        readonly reason: "unregistered" | "registrationFailed";
      };
    };

export interface AgentProviderPolicyRegistrationRequest {
  readonly provider: AgentCliKind;
  readonly settingsRevision: number;
  readonly expectedProviderGeneration: number | null;
  readonly enabled: boolean;
  readonly cliPath: string | null;
  readonly checkForUpdates: boolean;
}

export interface AgentProviderCurrentPolicyRequest {
  readonly provider: AgentCliKind;
}

export type AgentProviderCurrentPolicyResult =
  | { readonly kind: "unregistered" }
  | {
      readonly kind: "registered";
      readonly receipt: AgentProviderPolicyRegistrationReceipt;
      readonly enabled: boolean;
      readonly cliPath: string | null;
      readonly checkForUpdates: boolean;
    };

export interface AgentProviderPolicyRegistrationReceipt {
  readonly provider: AgentCliKind;
  readonly settingsRevision: number;
  readonly providerGeneration: number;
}

export interface AgentProviderGenerationRequest {
  readonly provider: AgentCliKind;
  readonly providerGeneration: number;
}

export interface AgentProviderHealthProbeResult {
  readonly installedVersion: string | null;
  readonly auth: AgentProviderAuthState;
  readonly update: Exclude<AgentProviderUpdateAvailability, { readonly kind: "checking" }>;
  readonly checkedAtEpochMs: number;
}

export interface AgentProviderPolicyGateway {
  currentAgentProviderPolicy(
    request: AgentProviderCurrentPolicyRequest,
  ): Promise<AgentProviderCurrentPolicyResult>;
  registerAgentProviderPolicy(
    request: AgentProviderPolicyRegistrationRequest,
  ): Promise<AgentProviderPolicyRegistrationReceipt>;
}

export interface AgentProviderHealthGateway {
  probeAgentProviderHealth(
    request: AgentProviderGenerationRequest,
  ): Promise<AgentProviderHealthProbeResult>;
}

export interface AgentProviderUpdateRequest extends AgentProviderGenerationRequest {
  readonly operationId: string;
}

export type AgentProviderUpdateFailureReason =
  "admissionRefused" | "spawnFailed" | "timedOut" | "outputLimitExceeded" | "exited" | "uncertain";

export type AgentProviderUpdateResult =
  | {
      readonly kind: "succeeded";
      readonly previousVersion: string;
      readonly installedVersion: string;
    }
  | {
      readonly kind: "failed";
      readonly reason: AgentProviderUpdateFailureReason;
      readonly outputTail: string;
      readonly outputTruncated: boolean;
    };

export type AgentProviderUpdateState =
  | { readonly kind: "idle" }
  | { readonly kind: "starting"; readonly operationId: string }
  | {
      readonly kind: "running";
      readonly operationId: string;
      readonly outputTail: string;
      readonly outputTruncated: boolean;
    }
  | {
      readonly kind: "succeeded";
      readonly previousVersion: string;
      readonly installedVersion: string;
    }
  | {
      readonly kind: "failed";
      readonly reason: AgentProviderUpdateFailureReason | "versionMismatch";
      readonly outputTail: string;
      readonly outputTruncated: boolean;
    };

export interface AgentProviderUpdateGateway {
  updateAgentProvider(request: AgentProviderUpdateRequest): Promise<AgentProviderUpdateResult>;
}

export function validateAgentProviderPolicyRegistrationRequest(
  value: unknown,
): AgentProviderPolicyRegistrationRequest {
  const request = object(value, "request");
  exactKeys(
    request,
    [
      "provider",
      "settingsRevision",
      "expectedProviderGeneration",
      "enabled",
      "cliPath",
      "checkForUpdates",
    ],
    "request",
  );
  return {
    provider: provider(request.provider, "request.provider"),
    settingsRevision: positiveInteger(request.settingsRevision, "request.settingsRevision"),
    expectedProviderGeneration: optionalPositiveInteger(
      request.expectedProviderGeneration,
      "request.expectedProviderGeneration",
    ),
    enabled: bool(request.enabled, "request.enabled"),
    cliPath: optionalPath(request.cliPath, "request.cliPath"),
    checkForUpdates: bool(request.checkForUpdates, "request.checkForUpdates"),
  };
}

export function validateAgentProviderCurrentPolicyRequest(
  value: unknown,
): AgentProviderCurrentPolicyRequest {
  const request = object(value, "request");
  exactKeys(request, ["provider"], "request");
  return { provider: provider(request.provider, "request.provider") };
}

export function parseAgentProviderCurrentPolicyResult(
  value: unknown,
): AgentProviderCurrentPolicyResult {
  const result = object(value, "result");
  if (result.kind === "unregistered") {
    exactKeys(result, ["kind"], "result");
    return { kind: "unregistered" };
  }
  if (result.kind === "registered") {
    exactKeys(result, ["kind", "receipt", "enabled", "cliPath", "checkForUpdates"], "result");
    return {
      kind: "registered",
      receipt: parseAgentProviderPolicyRegistrationReceipt(result.receipt),
      enabled: bool(result.enabled, "result.enabled"),
      cliPath: optionalPath(result.cliPath, "result.cliPath"),
      checkForUpdates: bool(result.checkForUpdates, "result.checkForUpdates"),
    };
  }
  return invalid("result.kind", "expected unregistered or registered");
}

export function parseAgentProviderPolicyRegistrationReceipt(
  value: unknown,
): AgentProviderPolicyRegistrationReceipt {
  const receipt = object(value, "receipt");
  exactKeys(receipt, ["provider", "settingsRevision", "providerGeneration"], "receipt");
  return {
    provider: provider(receipt.provider, "receipt.provider"),
    settingsRevision: positiveInteger(receipt.settingsRevision, "receipt.settingsRevision"),
    providerGeneration: positiveInteger(receipt.providerGeneration, "receipt.providerGeneration"),
  };
}

export function validateAgentProviderHealthProbeRequest(
  value: unknown,
): AgentProviderGenerationRequest {
  return generationRequest(value, "request");
}

export function parseAgentProviderHealthProbeResult(
  kind: AgentCliKind,
  value: unknown,
): AgentProviderHealthProbeResult {
  const result = object(value, "result");
  exactKeys(result, ["installedVersion", "auth", "update", "checkedAtEpochMs"], "result");
  const installedVersion = optionalVersion(result.installedVersion, "result.installedVersion");
  const update = updateAvailability(kind, result.update, "result.update");
  if (
    (update.kind === "current" || update.kind === "available") &&
    update.installedVersion !== installedVersion
  ) {
    return invalid("result.update.installedVersion", "expected the observed installed version");
  }
  return {
    installedVersion,
    auth: authState(result.auth, "result.auth"),
    update,
    checkedAtEpochMs: unsignedInteger(result.checkedAtEpochMs, "result.checkedAtEpochMs"),
  };
}

export function validateAgentProviderUpdateRequest(value: unknown): AgentProviderUpdateRequest {
  const request = object(value, "request");
  exactKeys(request, ["provider", "providerGeneration", "operationId"], "request");
  return {
    provider: provider(request.provider, "request.provider"),
    providerGeneration: positiveInteger(request.providerGeneration, "request.providerGeneration"),
    operationId: operationId(request.operationId, "request.operationId"),
  };
}

export function parseAgentProviderUpdateResult(value: unknown): AgentProviderUpdateResult {
  const result = object(value, "result");
  if (result.kind === "succeeded") {
    exactKeys(result, ["kind", "previousVersion", "installedVersion"], "result");
    return {
      kind: "succeeded",
      previousVersion: version(result.previousVersion, "result.previousVersion"),
      installedVersion: version(result.installedVersion, "result.installedVersion"),
    };
  }
  if (result.kind === "failed") {
    exactKeys(result, ["kind", "reason", "outputTail", "outputTruncated"], "result");
    const reason = failureReason(result.reason, "result.reason");
    const outputTruncated = bool(result.outputTruncated, "result.outputTruncated");
    if (reason === "outputLimitExceeded" && !outputTruncated) {
      return invalid("result.outputTruncated", "expected true after output cap exhaustion");
    }
    return {
      kind: "failed",
      reason,
      outputTail: boundedString(
        result.outputTail,
        MAX_AGENT_PROVIDER_UPDATE_OUTPUT_TAIL_BYTES,
        "result.outputTail",
        true,
      ),
      outputTruncated,
    };
  }
  return invalid("result.kind", "expected succeeded or failed");
}

function generationRequest(value: unknown, path: string): AgentProviderGenerationRequest {
  const request = object(value, path);
  exactKeys(request, ["provider", "providerGeneration"], path);
  return {
    provider: provider(request.provider, `${path}.provider`),
    providerGeneration: positiveInteger(request.providerGeneration, `${path}.providerGeneration`),
  };
}

function authState(value: unknown, path: string): AgentProviderAuthState {
  const auth = object(value, path);
  if (auth.kind === "signedIn") {
    exactKeys(auth, ["kind", "label"], path);
    if (auth.label === null) return { kind: "signedIn", label: null };
    const label = boundedString(auth.label, MAX_AGENT_PROVIDER_AUTH_LABEL_BYTES, `${path}.label`);
    for (const character of label) {
      const code = character.codePointAt(0) ?? 0;
      if (code < 32 || code === 127) return invalid(`${path}.label`, "expected display text");
    }
    return { kind: "signedIn", label };
  }
  if (auth.kind === "signedOut" || auth.kind === "unknown") {
    exactKeys(auth, ["kind"], path);
    return { kind: auth.kind };
  }
  return invalid(`${path}.kind`, "expected signedIn, signedOut, or unknown");
}

function updateAvailability(
  kind: AgentCliKind,
  value: unknown,
  path: string,
): Exclude<AgentProviderUpdateAvailability, { readonly kind: "checking" }> {
  const update = object(value, path);
  if (update.kind === "checksDisabled") {
    exactKeys(update, ["kind"], path);
    return { kind: "checksDisabled" };
  }
  if (update.kind === "current") {
    exactKeys(update, ["kind", "installedVersion"], path);
    return {
      kind: "current",
      installedVersion: version(update.installedVersion, `${path}.installedVersion`),
    };
  }
  if (update.kind === "available") {
    exactKeys(update, ["kind", "installedVersion", "availableVersion", "installer"], path);
    return {
      kind: "available",
      installedVersion: version(update.installedVersion, `${path}.installedVersion`),
      availableVersion: version(update.availableVersion, `${path}.availableVersion`),
      installer: knownInstaller(kind, update.installer, `${path}.installer`),
    };
  }
  if (update.kind === "unavailable") {
    exactKeys(update, ["kind", "reason"], path);
    return { kind: "unavailable", reason: unavailableReason(update.reason, `${path}.reason`) };
  }
  return invalid(`${path}.kind`, "expected a settled update state");
}

function knownInstaller(
  kind: AgentCliKind,
  value: unknown,
  path: string,
): Exclude<AgentProviderInstaller, { readonly kind: "unknown" }> {
  const installer = object(value, path);
  if (installer.kind === "npm") {
    exactKeys(installer, ["kind", "packageName"], path);
    const packageName = kind === "claudeCode" ? "@anthropic-ai/claude-code" : "@openai/codex";
    if (installer.packageName !== packageName)
      return invalid(`${path}.packageName`, "provider mismatch");
    return { kind: "npm", packageName };
  }
  if (installer.kind === "homebrew") {
    exactKeys(installer, ["kind", "cask"], path);
    const cask = kind === "claudeCode" ? "claude-code" : "codex";
    if (installer.cask !== cask) return invalid(`${path}.cask`, "provider mismatch");
    return { kind: "homebrew", cask };
  }
  return invalid(`${path}.kind`, "expected npm or homebrew");
}

function unavailableReason(
  value: unknown,
  path: string,
): "unknownInstaller" | "unsupportedProbe" | "invalidVersion" | "probeFailed" {
  if (
    value === "unknownInstaller" ||
    value === "unsupportedProbe" ||
    value === "invalidVersion" ||
    value === "probeFailed"
  ) {
    return value;
  }
  return invalid(path, "expected a supported update reason");
}

function failureReason(value: unknown, path: string): AgentProviderUpdateFailureReason {
  if (
    value === "admissionRefused" ||
    value === "spawnFailed" ||
    value === "timedOut" ||
    value === "outputLimitExceeded" ||
    value === "exited" ||
    value === "uncertain"
  ) {
    return value;
  }
  return invalid(path, "expected a supported update failure");
}

function provider(value: unknown, path: string): AgentCliKind {
  if (value === "claudeCode" || value === "codex") return value;
  return invalid(path, "expected claudeCode or codex");
}

function optionalPath(value: unknown, path: string): string | null {
  if (value === null) return null;
  const normalized = normalizeAgentCliPath(value);
  if (normalized === null || normalized !== value)
    return invalid(path, "expected an absolute CLI path");
  return normalized;
}

function optionalVersion(value: unknown, path: string): string | null {
  if (value === null) return null;
  return version(value, path);
}

function version(value: unknown, path: string): string {
  if (typeof value !== "string") return invalid(path, "expected a version");
  const parsed = parseAgentCliVersion(value);
  if (parsed === null || parsed !== value)
    return invalid(path, "expected a bounded semantic version");
  return parsed;
}

function operationId(value: unknown, path: string): string {
  if (typeof value !== "string") return invalid(path, "expected an operation id");
  if (
    value.length < MIN_AGENT_PROVIDER_OPERATION_ID_BYTES ||
    value.length > MAX_AGENT_PROVIDER_OPERATION_ID_BYTES ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    return invalid(path, "expected 8 to 128 ASCII letters, numbers, underscores, or hyphens");
  }
  return value;
}

function boundedString(value: unknown, maxBytes: number, path: string, allowEmpty = false): string {
  if (typeof value !== "string") return invalid(path, "expected a string");
  if (!allowEmpty && value === "") return invalid(path, "expected a non-empty string");
  if (new TextEncoder().encode(value).byteLength > maxBytes) {
    return invalid(path, `expected at most ${maxBytes} UTF-8 bytes`);
  }
  return value;
}

function unsignedInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return invalid(path, "expected a non-negative safe integer");
  }
  return value;
}

function positiveInteger(value: unknown, path: string): number {
  const parsed = unsignedInteger(value, path);
  if (parsed === 0) return invalid(path, "expected a positive safe integer");
  return parsed;
}

function optionalPositiveInteger(value: unknown, path: string): number | null {
  if (value === null) return null;
  return positiveInteger(value, path);
}

function bool(value: unknown, path: string): boolean {
  if (typeof value === "boolean") return value;
  return invalid(path, "expected a boolean");
}

function exactKeys(
  value: Record<string, unknown>,
  keys: ReadonlyArray<string>,
  path: string,
): void {
  const expected = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) invalid(`${path}.${key}`, "unexpected field");
  }
  for (const key of keys) {
    if (!(key in value)) invalid(`${path}.${key}`, "missing field");
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
  throw new TypeError(`Invalid agent provider value at ${path}: ${expectation}.`);
}
