import { useEffect, useState } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import type {
  AgentProviderManagementSurface,
  AgentProviderManagementView,
} from "../application/useAgentProviderManagement";
import type {
  AgentProviderAuthState,
  AgentProviderHealthState,
  AgentProviderPolicyRegistrationState,
  AgentProviderUpdateAvailability,
  AgentProviderUpdateState,
} from "../domain/agentProviderHealth";
import {
  MAX_AGENT_PROVIDER_HEALTH_CHECK_INTERVAL_SECONDS,
  MIN_AGENT_PROVIDER_HEALTH_CHECK_INTERVAL_SECONDS,
  normalizeAgentProviderHealthCheckIntervalSeconds,
  type AgentProviderPreference,
} from "../domain/agentProviderSettings";
import { normalizeAgentCliPath, type AgentCliKind } from "../domain/agentSettings";

const PROVIDER_HEALTH_CLOCK_TICK_MS = 30_000;

export interface AgentProviderSettingsCardProps {
  readonly management: AgentProviderManagementSurface;
  readonly path: string | null;
  readonly preference: AgentProviderPreference;
  readonly provider: AgentCliKind;
  onChangeCheckForUpdates(value: boolean): void;
  onChangeEnabled(value: boolean): void;
  onChangeHealthCheckIntervalSeconds(value: number): void;
  onChangePath(value: string | null): void;
}

export function AgentProviderSettingsCard({
  management,
  onChangeCheckForUpdates,
  onChangeEnabled,
  onChangeHealthCheckIntervalSeconds,
  onChangePath,
  path,
  preference,
  provider,
}: AgentProviderSettingsCardProps) {
  const [draft, setDraft] = useState(path ?? "");
  const [nowEpochMs, setNowEpochMs] = useState(() => Date.now());
  const view = management.providers[provider];
  const checkedAtEpochMs = providerCheckedAt(view.health);
  const invalidPath = draft.trim() !== "" && normalizeAgentCliPath(draft) === null;
  const updating = view.updateState.kind === "starting" || view.updateState.kind === "running";
  const available = availableUpdate(view.health);
  const updateBlockedReason = providerUpdateBlockedReason(provider, view, available);

  useEffect(() => setDraft(path ?? ""), [path]);
  useEffect(() => {
    setNowEpochMs(Date.now());
    if (checkedAtEpochMs === null) return undefined;
    const timer = setInterval(() => setNowEpochMs(Date.now()), PROVIDER_HEALTH_CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, [checkedAtEpochMs]);

  return (
    <section aria-label={`${providerLabel(provider)} provider`} className="agent-provider-card">
      <header className="agent-provider-card__header">
        <span>
          <strong>{providerLabel(provider)}</strong>
          <small>{providerExecutableLabel(provider)}</small>
        </span>
        <label className="settings-toggle">
          <input
            aria-label={`Enable ${providerLabel(provider)}`}
            checked={preference.enabled}
            onChange={(event) => onChangeEnabled(event.currentTarget.checked)}
            type="checkbox"
          />
          <span>{preference.enabled ? "Enabled" : "Disabled"}</span>
        </label>
      </header>

      <label className="settings-field">
        <span>CLI path</span>
        <input
          aria-describedby={`${provider}-cli-health`}
          aria-invalid={invalidPath || undefined}
          disabled={!preference.enabled}
          onBlur={() => {
            const normalizedPath = normalizeAgentCliPath(draft);
            if (draft.trim() !== "" && normalizedPath === null) return;
            onChangePath(normalizedPath);
          }}
          onChange={(event) => setDraft(event.currentTarget.value)}
          placeholder={providerPlaceholder(provider)}
          spellCheck={false}
          value={draft}
        />
        {invalidPath ? <small>Enter an absolute executable path.</small> : null}
      </label>

      <div className="agent-provider-card__status" id={`${provider}-cli-health`} role="status">
        <span>{providerHealthLabel(view.policy, view.health, path !== null)}</span>
        <span>{providerAuthLabel(view.health)}</span>
        <span>{providerCheckedLabel(view.health, nowEpochMs)}</span>
      </div>

      <ProviderPolicyStatus
        disabled={!preference.enabled}
        onRetry={() => void management.retryRegistration(provider)}
        policy={view.policy}
      />

      <div className="agent-provider-card__controls">
        <label className="settings-field agent-provider-card__interval">
          <span>Health check interval</span>
          <span className="agent-provider-card__input-unit">
            <input
              aria-label={`${providerLabel(provider)} health check interval in seconds`}
              disabled={!preference.enabled}
              max={MAX_AGENT_PROVIDER_HEALTH_CHECK_INTERVAL_SECONDS}
              min={MIN_AGENT_PROVIDER_HEALTH_CHECK_INTERVAL_SECONDS}
              onChange={(event) => {
                const numeric = Number(event.currentTarget.value);
                if (!Number.isFinite(numeric)) return;
                onChangeHealthCheckIntervalSeconds(
                  normalizeAgentProviderHealthCheckIntervalSeconds(numeric),
                );
              }}
              step={1}
              type="number"
              value={preference.healthCheckIntervalSeconds}
            />
            <span>seconds</span>
          </span>
          <small>Set to 0 for manual checks only.</small>
        </label>

        <label className="settings-toggle agent-provider-card__updates-toggle">
          <input
            checked={preference.checkForUpdates}
            disabled={!preference.enabled}
            onChange={(event) => onChangeCheckForUpdates(event.currentTarget.checked)}
            type="checkbox"
          />
          <span>Check for updates</span>
        </label>
      </div>

      <div className="agent-provider-card__actions">
        <button
          aria-busy={view.health.kind === "checking" || undefined}
          disabled={!preference.enabled || view.health.kind === "checking" || updating}
          onClick={() => void management.refresh(provider)}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={13} />
          Refresh
        </button>
        {available === null ? null : (
          <button
            aria-busy={updating || undefined}
            disabled={updateBlockedReason !== null}
            onClick={() => void management.update(provider, available.availableVersion)}
            title={updateBlockedReason ?? undefined}
            type="button"
          >
            {updating ? (
              <LoaderCircle aria-hidden="true" className="agent-provider-spin" size={13} />
            ) : null}
            {updating
              ? `Updating ${providerLabel(provider)}`
              : `Update to ${available.availableVersion}`}
          </button>
        )}
      </div>

      <ProviderUpdateResult state={view.updateState} />
    </section>
  );
}

function ProviderPolicyStatus({
  disabled,
  onRetry,
  policy,
}: {
  readonly disabled: boolean;
  readonly policy: AgentProviderPolicyRegistrationState;
  onRetry(): void;
}) {
  switch (policy.kind) {
    case "unregistered":
      return (
        <div className="agent-provider-card__policy" role="status">
          <span>Policy not registered</span>
          <button disabled={disabled} onClick={onRetry} type="button">
            Register
          </button>
        </div>
      );
    case "registering":
      return (
        <div className="agent-provider-card__policy" role="status">
          <LoaderCircle aria-hidden="true" className="agent-provider-spin" size={13} />
          <span>Registering policy…</span>
        </div>
      );
    case "registered":
      return (
        <div className="agent-provider-card__policy" role="status">
          Policy registered
        </div>
      );
    case "failed":
      return (
        <div
          className="agent-provider-card__policy agent-provider-card__policy--failed"
          role="alert"
        >
          <span>{providerPolicyFailureLabel(policy.reason)}</span>
          <button disabled={disabled} onClick={onRetry} type="button">
            Retry registration
          </button>
        </div>
      );
    default:
      return unsupportedPolicyState(policy);
  }
}

function ProviderUpdateResult({ state }: { readonly state: AgentProviderUpdateState }) {
  switch (state.kind) {
    case "idle":
      return null;
    case "starting":
      return (
        <p className="agent-provider-card__result" role="status">
          Preparing update…
        </p>
      );
    case "running":
      return (
        <div className="agent-provider-card__result" role="status">
          <span>Installing update…</span>
          {state.outputTail === "" ? null : <pre>{state.outputTail}</pre>}
          {state.outputTruncated ? <small>Output was truncated.</small> : null}
        </div>
      );
    case "succeeded":
      return (
        <p
          className="agent-provider-card__result agent-provider-card__result--success"
          role="status"
        >
          Updated from {state.previousVersion} to {state.installedVersion}.
        </p>
      );
    case "failed":
      return (
        <div
          className="agent-provider-card__result agent-provider-card__result--failed"
          role="alert"
        >
          <span>{providerUpdateFailureLabel(state.reason)}</span>
          {state.outputTail === "" ? null : <pre>{state.outputTail}</pre>}
          {state.outputTruncated ? <small>Output was truncated.</small> : null}
        </div>
      );
    default:
      return unsupportedUpdateState(state);
  }
}

function availableUpdate(
  health: AgentProviderHealthState,
): Extract<AgentProviderUpdateAvailability, { readonly kind: "available" }> | null {
  if (health.kind !== "ready") return null;
  if (health.update.kind !== "available") return null;
  return health.update;
}

function providerUpdateBlockedReason(
  provider: AgentCliKind,
  view: AgentProviderManagementView,
  available: Extract<AgentProviderUpdateAvailability, { readonly kind: "available" }> | null,
): string | null {
  if (available === null) return "No update is available.";
  if (view.policy.kind !== "registered") return "Register the provider policy first.";
  if (view.liveTurnCount > 0) return `Stop running ${providerLabel(provider)} turns first.`;
  if (view.updateState.kind === "starting" || view.updateState.kind === "running") {
    return "The provider is already updating.";
  }
  return null;
}

function providerHealthLabel(
  policy: AgentProviderPolicyRegistrationState,
  health: AgentProviderHealthState,
  configured: boolean,
): string {
  if (health.kind === "disabled") return "Provider disabled";
  if (configured) {
    if (policy.kind === "unregistered") return "Health check waiting for policy registration";
    if (policy.kind === "registering") return "Health check waiting for policy registration";
    if (policy.kind === "failed")
      return "Health check unavailable until policy registration succeeds";
  }
  switch (health.kind) {
    case "notConfigured":
      return "CLI not configured";
    case "checking":
      return "Checking provider…";
    case "ready":
      return health.installedVersion === null
        ? "Installed version unavailable"
        : `Version ${health.installedVersion}`;
    case "failed":
      return providerHealthFailureLabel(health.reason);
    default:
      return unsupportedHealthState(health);
  }
}

function providerAuthLabel(health: AgentProviderHealthState): string {
  if (health.kind !== "ready") return "Authentication unknown";
  return authLabel(health.auth);
}

function authLabel(auth: AgentProviderAuthState): string {
  switch (auth.kind) {
    case "signedIn":
      return auth.label === null ? "Signed in" : `Signed in · ${auth.label}`;
    case "signedOut":
      return "Signed out";
    case "unknown":
      return "Authentication unknown";
    default:
      return unsupportedAuthState(auth);
  }
}

function providerCheckedLabel(health: AgentProviderHealthState, nowEpochMs: number): string {
  if (health.kind === "ready") {
    return `Checked ${boundedRelativeAge(health.checkedAtEpochMs, nowEpochMs)}`;
  }
  if (health.kind === "failed" && health.checkedAtEpochMs !== null) {
    return `Check failed ${boundedRelativeAge(health.checkedAtEpochMs, nowEpochMs)}`;
  }
  return "Not checked yet";
}

function providerCheckedAt(health: AgentProviderHealthState): number | null {
  if (health.kind === "ready") return health.checkedAtEpochMs;
  if (health.kind === "failed") return health.checkedAtEpochMs;
  return null;
}

function boundedRelativeAge(checkedAtEpochMs: number, nowEpochMs: number): string {
  const ageMs = Math.max(0, nowEpochMs - checkedAtEpochMs);
  const ageMinutes = Math.floor(ageMs / 60_000);
  if (ageMinutes < 1) return "just now";
  if (ageMinutes < 60) return `${ageMinutes}m ago`;
  const ageHours = Math.floor(ageMinutes / 60);
  if (ageHours < 24) return `${ageHours}h ago`;
  return "over 24h ago";
}

function providerPolicyFailureLabel(
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
      return unsupportedPolicyFailure(reason);
  }
}

function providerHealthFailureLabel(
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
      return unsupportedHealthFailure(reason);
  }
}

function providerUpdateFailureLabel(
  reason: Extract<AgentProviderUpdateState, { readonly kind: "failed" }>["reason"],
): string {
  switch (reason) {
    case "admissionRefused":
      return "The update was refused.";
    case "spawnFailed":
      return "The updater could not start.";
    case "timedOut":
      return "The update timed out.";
    case "outputLimitExceeded":
      return "The update exceeded its output limit.";
    case "exited":
      return "The updater exited before completing.";
    case "versionMismatch":
      return "The installed version did not match the requested update.";
    case "uncertain":
      return "The update result is uncertain. Refresh the provider status.";
    default:
      return unsupportedUpdateFailure(reason);
  }
}

function providerLabel(provider: AgentCliKind): string {
  switch (provider) {
    case "claudeCode":
      return "Claude Code";
    case "codex":
      return "Codex";
    default:
      return unsupportedProvider(provider);
  }
}

function providerExecutableLabel(provider: AgentCliKind): string {
  if (provider === "claudeCode") return "claude";
  return "codex";
}

function providerPlaceholder(provider: AgentCliKind): string {
  if (provider === "claudeCode") return "/usr/local/bin/claude";
  return "/usr/local/bin/codex";
}

function unsupportedProvider(provider: never): never {
  throw new TypeError(`Unsupported agent provider: ${String(provider)}`);
}

function unsupportedHealthState(state: never): never {
  throw new TypeError(`Unsupported provider health state: ${String(state)}`);
}

function unsupportedAuthState(state: never): never {
  throw new TypeError(`Unsupported provider auth state: ${String(state)}`);
}

function unsupportedPolicyState(state: never): never {
  throw new TypeError(`Unsupported provider policy state: ${String(state)}`);
}

function unsupportedPolicyFailure(reason: never): never {
  throw new TypeError(`Unsupported provider policy failure: ${String(reason)}`);
}

function unsupportedHealthFailure(reason: never): never {
  throw new TypeError(`Unsupported provider health failure: ${String(reason)}`);
}

function unsupportedUpdateState(state: never): never {
  throw new TypeError(`Unsupported provider update state: ${String(state)}`);
}

function unsupportedUpdateFailure(reason: never): never {
  throw new TypeError(`Unsupported provider update failure: ${String(reason)}`);
}
