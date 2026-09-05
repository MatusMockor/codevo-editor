import { BarChart3, GitBranch, LoaderCircle, RefreshCw, Settings } from "lucide-react";
import { useEffect, useRef, useState, type Ref } from "react";
import type { AgentProviderManagementSurface } from "../../application/useAgentProviderManagement";
import type {
  AgentProviderHealthState,
  AgentProviderPolicyRegistrationState,
} from "../../domain/agentProviderHealth";
import type { AgentCliKind } from "../../domain/agentTask";

export interface AgentProviderRailFooterProps {
  readonly management: AgentProviderManagementSurface;
  readonly providerEnabled: Readonly<Record<AgentCliKind, boolean>>;
  readonly usageButtonRef?: Ref<HTMLButtonElement>;
  readonly usageOpen: boolean;
  onOpenSourceControl(): void;
  onOpenSettings(): void;
  onOpenUsage(): void;
}

const PROVIDERS: ReadonlyArray<AgentCliKind> = ["claudeCode", "codex"];

export function AgentProviderRailFooter({
  management,
  onOpenSourceControl,
  onOpenSettings,
  onOpenUsage,
  providerEnabled,
  usageButtonRef,
  usageOpen,
}: AgentProviderRailFooterProps) {
  const enabled = PROVIDERS.filter((provider) => providerEnabled[provider]);
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refreshAll = (): void => {
    if (refreshing || enabled.length === 0) return;
    setRefreshing(true);
    void Promise.allSettled(enabled.map((provider) => management.refresh(provider))).then(() => {
      if (!mounted.current) return;
      setRefreshing(false);
    });
  };

  return (
    <footer className="agent-provider-footer">
      <div aria-label="Agent provider status" className="agent-provider-footer__providers">
        {enabled.map((provider) => (
          <ProviderFooterActions
            key={provider}
            management={management}
            onOpenSettings={onOpenSettings}
            provider={provider}
          />
        ))}
      </div>
      <nav aria-label="Agent navigation" className="agent-provider-footer__navigation">
        <button
          aria-label="Open provider settings"
          className="agent-iconbutton"
          onClick={onOpenSettings}
          title={providerSettingsTitle(management, enabled)}
          type="button"
        >
          <Settings aria-hidden="true" size={16} />
        </button>
        <button
          aria-label="Open Source Control"
          className="agent-iconbutton"
          onClick={onOpenSourceControl}
          title="Source Control"
          type="button"
        >
          <GitBranch aria-hidden="true" size={16} />
        </button>
        <button
          aria-controls={usageOpen ? "agent-usage-panel-dialog" : undefined}
          aria-expanded={usageOpen}
          aria-label="Open Usage"
          className="agent-iconbutton"
          onClick={onOpenUsage}
          ref={usageButtonRef}
          title="Usage"
          type="button"
        >
          <BarChart3 aria-hidden="true" size={16} />
        </button>
        <button
          aria-busy={refreshing}
          aria-label="Refresh provider status"
          className="agent-iconbutton agent-provider-footer__refresh"
          disabled={refreshing || enabled.length === 0}
          onClick={refreshAll}
          title={refreshing ? "Refreshing provider status…" : "Refresh provider status"}
          type="button"
        >
          <RefreshCw
            aria-hidden="true"
            className={refreshing ? "agent-provider-spin" : undefined}
            size={16}
          />
        </button>
      </nav>
    </footer>
  );
}

function ProviderFooterActions({
  management,
  onOpenSettings,
  provider,
}: {
  readonly management: AgentProviderManagementSurface;
  readonly onOpenSettings: () => void;
  readonly provider: AgentCliKind;
}) {
  const view = management.providers[provider];
  const updating = view.updateState.kind === "starting" || view.updateState.kind === "running";
  const registering = view.policy.kind === "registering";
  const available =
    view.health.kind === "ready" && view.health.update.kind === "available"
      ? view.health.update
      : null;
  const busyLabel = providerBusyLabel(provider, updating, registering);
  const manual =
    view.health.kind === "ready" &&
    view.health.update.kind === "manualUpdateAvailable" &&
    !updating;
  const register = view.policy.kind === "unregistered" || view.policy.kind === "failed";
  const offersUpdate = available !== null && !updating && view.policy.kind === "registered";

  if (busyLabel === null && !offersUpdate && !manual && !register) return null;

  return (
    <span className="agent-provider-footer__provider" data-provider={provider}>
      {busyLabel !== null ? (
        <LoaderCircle aria-label={busyLabel} className="agent-provider-spin" role="img" size={12} />
      ) : null}
      {!offersUpdate || available === null ? null : (
        <button
          aria-label={`Update ${providerLabel(provider)} to ${available.availableVersion}`}
          className="agent-provider-footer__action"
          disabled={view.liveTurnCount > 0}
          onClick={() => void management.update(provider, available.availableVersion)}
          title={
            view.liveTurnCount > 0
              ? `Stop running ${providerLabel(provider)} turns first.`
              : `Update to ${available.availableVersion}`
          }
          type="button"
        >
          Update
        </button>
      )}
      {manual && view.health.kind === "ready" ? (
        <button
          aria-label={`View ${providerLabel(provider)} update instructions`}
          className="agent-provider-footer__action"
          onClick={onOpenSettings}
          title={manualUpdateTitle(view.health)}
          type="button"
        >
          Update available
        </button>
      ) : null}
      {register ? (
        <button
          aria-label={`Retry ${providerLabel(provider)} policy registration`}
          className="agent-provider-footer__action"
          onClick={() => void management.retryRegistration(provider)}
          title={providerFooterDetail(view.policy, view.health)}
          type="button"
        >
          Register
        </button>
      ) : null}
    </span>
  );
}

function manualUpdateTitle(
  health: Extract<AgentProviderHealthState, { readonly kind: "ready" }>,
): string {
  if (health.update.kind !== "manualUpdateAvailable") return readyDetail(health);
  return `Version ${health.update.availableVersion} is available; update with the original installer.`;
}

function providerBusyLabel(
  provider: AgentCliKind,
  updating: boolean,
  registering: boolean,
): string | null {
  if (updating) return `Updating ${providerLabel(provider)}`;
  if (registering) return `Registering ${providerLabel(provider)}`;
  return null;
}

function providerSettingsTitle(
  management: AgentProviderManagementSurface,
  enabled: ReadonlyArray<AgentCliKind>,
): string {
  if (enabled.length === 0) return "Settings > Agents";
  const parts = enabled.map((provider) => {
    const view = management.providers[provider];
    return `${providerLabel(provider)} ${providerFooterLabel(view.policy, view.health)}`;
  });
  return `Settings > Agents · ${parts.join(" · ")}`;
}

function providerFooterLabel(
  policy: AgentProviderPolicyRegistrationState,
  health: AgentProviderHealthState,
): string {
  const policyLabel = providerPolicyLabel(policy);
  if (policyLabel !== null) return policyLabel;
  switch (health.kind) {
    case "disabled":
      return "Disabled";
    case "notConfigured":
      return "Not configured";
    case "checking":
      return "Checking…";
    case "ready":
      if (health.update.kind === "available" || health.update.kind === "manualUpdateAvailable")
        return `v${health.update.availableVersion}`;
      if (health.installedVersion !== null) return `v${health.installedVersion}`;
      return "Ready";
    case "failed":
      return "Check failed";
    default:
      return unsupportedHealth(health);
  }
}

function providerPolicyLabel(policy: AgentProviderPolicyRegistrationState): string | null {
  switch (policy.kind) {
    case "unregistered":
      return "Not registered";
    case "registering":
      return "Registering…";
    case "registered":
      return null;
    case "failed":
      return "Registration failed";
    default:
      return unsupportedPolicy(policy);
  }
}

function providerFooterDetail(
  policy: AgentProviderPolicyRegistrationState,
  health: AgentProviderHealthState,
): string {
  switch (policy.kind) {
    case "unregistered":
      return "Provider policy is not registered";
    case "registering":
      return "Registering provider policy";
    case "failed":
      return `Provider policy registration failed: ${policy.reason}`;
    case "registered":
      break;
    default:
      return unsupportedPolicy(policy);
  }
  switch (health.kind) {
    case "disabled":
      return "Provider disabled";
    case "notConfigured":
      return "CLI path not configured";
    case "checking":
      return "Checking provider health";
    case "ready":
      return readyDetail(health);
    case "failed":
      return `Provider check failed: ${health.reason}`;
    default:
      return unsupportedHealth(health);
  }
}

function readyDetail(
  health: Extract<AgentProviderHealthState, { readonly kind: "ready" }>,
): string {
  if (health.update.kind === "available") {
    return `Update available: ${health.update.availableVersion}`;
  }
  if (health.update.kind === "manualUpdateAvailable") {
    return `Update available: ${health.update.availableVersion}. Update with the original installer.`;
  }
  if (health.update.kind === "unavailable")
    return "CLI update check unavailable. Open Settings for details.";
  if (health.update.kind === "checksDisabled")
    return "CLI update checks are disabled in the current policy.";
  if (health.auth.kind === "signedOut") return "Signed out";
  if (health.auth.kind === "unknown") return "Authentication unknown";
  if (health.auth.label !== null) return `Signed in: ${health.auth.label}`;
  return "Signed in";
}

function providerLabel(provider: AgentCliKind): string {
  if (provider === "claudeCode") return "Claude Code";
  return "Codex";
}

function unsupportedHealth(health: never): never {
  throw new TypeError(`Unsupported provider health: ${String(health)}`);
}

function unsupportedPolicy(policy: never): never {
  throw new TypeError(`Unsupported provider policy: ${String(policy)}`);
}
