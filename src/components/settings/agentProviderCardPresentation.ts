import type { AgentProviderManagementView } from "../../application/useAgentProviderManagement";
import type {
  AgentProviderAuthState,
  AgentProviderHealthState,
  AgentProviderPolicyRegistrationState,
} from "../../domain/agentProviderHealth";
import type { AgentProviderSignInState } from "../../domain/agentProviderSignIn";
import {
  DEFAULT_AGENT_PROVIDER_HEALTH_CHECK_INTERVAL_SECONDS,
  type AgentProviderPreference,
} from "../../domain/agentProviderSettings";
import type { AgentCliKind } from "../../domain/agentSettings";

export type AgentProviderStatusTone = "success" | "warning" | "danger" | "checking" | "dimmed";

export interface AgentProviderSignInPresentation {
  readonly role: "status" | "alert";
  readonly message: string;
}

export function providerLabel(provider: AgentCliKind): string {
  switch (provider) {
    case "claudeCode":
      return "Claude Code";
    case "codex":
      return "Codex";
    default:
      return unsupportedProviderValue(provider, "agent provider");
  }
}

export function providerExecutableName(provider: AgentCliKind): string {
  return provider === "claudeCode" ? "claude" : "codex";
}

export function providerPathPlaceholder(provider: AgentCliKind): string {
  return `/usr/local/bin/${providerExecutableName(provider)}`;
}

export function providerConfigured(view: AgentProviderManagementView): boolean {
  return view.executable.kind !== "notFound";
}

export function providerStatusTone(
  enabled: boolean,
  view: AgentProviderManagementView,
): AgentProviderStatusTone {
  if (!enabled) return "dimmed";

  switch (view.health.kind) {
    case "disabled":
      return "dimmed";
    case "checking":
      return "checking";
    case "notConfigured":
    case "failed":
      return "danger";
    case "ready":
      return view.health.auth.kind === "signedIn" ? "success" : "warning";
    default:
      return unsupportedProviderValue(view.health, "provider health state");
  }
}

export function providerVersionLabel(health: AgentProviderHealthState): string | null {
  if (health.kind !== "ready") return null;
  if (health.installedVersion === null) return null;

  return `v${health.installedVersion}`;
}

export function providerHeadline(view: AgentProviderManagementView, enabled: boolean): string {
  if (!enabled) return "Provider disabled.";
  if (view.health.kind !== "ready" && !providerConfigured(view)) {
    return "Not found - CLI not detected on PATH.";
  }
  if (view.health.kind !== "ready") {
    return `${providerHealthLabel(view.policy, view.health, providerConfigured(view))}.`;
  }

  return authHeadline(view.health.auth);
}

export function providerSignedOut(health: AgentProviderHealthState): boolean {
  return health.kind === "ready" && health.auth.kind === "signedOut";
}

export function providerHealthLabel(
  policy: AgentProviderPolicyRegistrationState,
  health: AgentProviderHealthState,
  configured: boolean,
): string {
  if (health.kind === "disabled") return "Provider disabled";
  if (configured && policy.kind !== "registered") {
    if (policy.kind === "failed")
      return "Health check unavailable until policy registration succeeds";
    return "Health check waiting for policy registration";
  }
  switch (health.kind) {
    case "notConfigured":
      return configured ? "Provider health not checked yet" : "CLI not found";
    case "checking":
      return "Checking provider…";
    case "ready":
      return health.installedVersion === null
        ? "Installed version unavailable"
        : `Version ${health.installedVersion}`;
    case "failed":
      return providerHealthFailureLabel(health.reason);
    default:
      return unsupportedProviderValue(health, "provider health state");
  }
}

export function providerAuthLabel(health: AgentProviderHealthState): string {
  if (health.kind !== "ready") return "Authentication unknown";

  switch (health.auth.kind) {
    case "signedIn":
      return health.auth.label === null ? "Signed in" : `Signed in · ${health.auth.label}`;
    case "signedOut":
      return "Signed out";
    case "unknown":
      return "Authentication unknown";
    default:
      return unsupportedProviderValue(health.auth, "provider auth state");
  }
}

export function providerCheckedAt(health: AgentProviderHealthState): number | null {
  if (health.kind === "ready") return health.checkedAtEpochMs;
  if (health.kind === "failed") return health.checkedAtEpochMs;

  return null;
}

export function providerCheckedLabel(health: AgentProviderHealthState, nowEpochMs: number): string {
  if (health.kind === "ready") {
    return `Checked ${boundedRelativeAge(health.checkedAtEpochMs, nowEpochMs)}`;
  }
  if (health.kind === "failed" && health.checkedAtEpochMs !== null) {
    return `Check failed ${boundedRelativeAge(health.checkedAtEpochMs, nowEpochMs)}`;
  }

  return "Not checked yet";
}

export function providerChecksSummaryLabel(
  healths: ReadonlyArray<AgentProviderHealthState>,
  nowEpochMs: number,
): string {
  let oldest: number | null = null;

  for (const health of healths) {
    const checkedAt = providerCheckedAt(health);

    if (checkedAt === null) return "Not checked yet";

    oldest = oldest === null ? checkedAt : Math.min(oldest, checkedAt);
  }

  if (oldest === null) return "Not checked yet";

  return `Checked ${boundedRelativeAge(oldest, nowEpochMs)}`;
}

export function providerSignInPresentation(
  state: AgentProviderSignInState,
  blockedReason: string | null,
): AgentProviderSignInPresentation | null {
  if (state.kind === "failed") {
    return { role: "alert", message: signInFailureLabel(state.reason) };
  }
  if (state.kind === "settled") {
    return { role: state.healthRefresh === "failed" ? "alert" : "status", message: settled(state) };
  }
  if (state.kind === "starting" || state.kind === "running") {
    return { role: "status", message: "Complete sign-in in the terminal." };
  }
  if (blockedReason === null) return null;

  return { role: "status", message: blockedReason };
}

export function providerSignInBusy(state: AgentProviderSignInState): boolean {
  return state.kind === "starting" || state.kind === "running";
}

export function providerSettingsAtDefault(
  path: string | null,
  preference: AgentProviderPreference,
): boolean {
  return (
    path === null &&
    preference.enabled &&
    preference.dismissedUpdateVersion === null &&
    preference.healthCheckIntervalSeconds === DEFAULT_AGENT_PROVIDER_HEALTH_CHECK_INTERVAL_SECONDS
  );
}

export function providerPolicyFailureLabel(
  reason: Extract<AgentProviderPolicyRegistrationState, { readonly kind: "failed" }>["reason"],
): string {
  switch (reason) {
    case "registrationFailed":
      return "Policy registration failed";
    case "revisionConflict":
      return "Policy settings changed during registration";
    case "staleRevision":
      return "Policy registration used stale settings";
    case "generationConflict":
      return "Provider changed during policy registration";
    default:
      return unsupportedProviderValue(reason, "provider policy failure");
  }
}

export function providerHealthFailureLabel(
  reason: Extract<AgentProviderHealthState, { readonly kind: "failed" }>["reason"],
): string {
  switch (reason) {
    case "invalidPath":
      return "Enter an absolute executable path";
    case "policyRegistrationFailed":
      return "Provider policy unavailable";
    case "probeFailed":
      return "Provider check failed";
    case "timedOut":
      return "Provider check timed out";
    default:
      return unsupportedProviderValue(reason, "provider health failure");
  }
}

function authHeadline(auth: AgentProviderAuthState): string {
  switch (auth.kind) {
    case "signedIn":
      return auth.label === null ? "Authenticated." : `Authenticated as ${auth.label}`;
    case "signedOut":
      return "Not authenticated - Sign in via the CLI to authenticate again.";
    case "unknown":
      return "Authentication unknown.";
    default:
      return unsupportedProviderValue(auth, "provider auth state");
  }
}

function settled(state: Extract<AgentProviderSignInState, { readonly kind: "settled" }>): string {
  const terminal =
    state.exitCode === 0
      ? "Sign-in terminal closed."
      : `Sign-in terminal exited${state.exitCode === null ? "." : ` with code ${state.exitCode}.`}`;
  const refresh =
    state.healthRefresh === "refreshing"
      ? "Refreshing authentication status…"
      : state.healthRefresh === "complete"
        ? "Authentication status refreshed."
        : "Authentication status could not be refreshed.";

  return `${terminal} ${refresh}`;
}

function signInFailureLabel(
  reason: Extract<AgentProviderSignInState, { readonly kind: "failed" }>["reason"],
): string {
  switch (reason) {
    case "disabled":
      return "Sign-in was refused because the provider is disabled.";
    case "notConfigured":
      return "Sign-in was refused because the CLI path is not configured.";
    case "turnActive":
      return "Sign-in was refused because a provider turn is running.";
    case "updating":
      return "Sign-in was refused because the provider is updating.";
    case "alreadySigningIn":
      return "A provider sign-in session is already running.";
    case "staleAuthority":
      return "Provider settings changed before sign-in could start.";
    case "spawnFailed":
      return "The sign-in terminal could not start.";
    case "uncertain":
      return "The sign-in result is uncertain. Refresh provider status before retrying.";
    default:
      return unsupportedProviderValue(reason, "provider sign-in failure");
  }
}

function boundedRelativeAge(checkedAtEpochMs: number, nowEpochMs: number): string {
  const ageMinutes = Math.floor(Math.max(0, nowEpochMs - checkedAtEpochMs) / 60_000);

  if (ageMinutes < 1) return "just now";
  if (ageMinutes < 60) return `${ageMinutes}m ago`;

  const ageHours = Math.floor(ageMinutes / 60);

  if (ageHours < 24) return `${ageHours}h ago`;

  return "over 24h ago";
}

export function unsupportedProviderValue(value: never, what: string): never {
  throw new TypeError(`Unsupported ${what}: ${String(value)}`);
}
