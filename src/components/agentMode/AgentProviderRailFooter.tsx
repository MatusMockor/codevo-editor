import { BarChart3, GitBranch, LoaderCircle, RefreshCw, Settings } from "lucide-react";
import type { Ref } from "react";
import type { AgentProviderManagementSurface } from "../../application/useAgentProviderManagement";
import type {
  AgentProviderHealthState,
  AgentProviderPolicyRegistrationState,
} from "../../domain/agentProviderHealth";
import type { AgentCliKind } from "../../domain/agentTask";
import { AgentProviderGlyph } from "./AgentProviderGlyph";

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
  return (
    <footer className="agent-provider-footer">
      <div aria-label="Agent provider status" className="agent-provider-footer__providers">
        {PROVIDERS.map((provider) => (
          <ProviderFooterRow
            enabled={providerEnabled[provider]}
            key={provider}
            management={management}
            provider={provider}
          />
        ))}
      </div>
      <nav aria-label="Agent navigation" className="agent-provider-footer__navigation">
        <button
          aria-label="Open Source Control"
          className="agent-iconbutton"
          onClick={onOpenSourceControl}
          title="Source Control"
          type="button"
        >
          <GitBranch aria-hidden="true" size={14} />
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
          <BarChart3 aria-hidden="true" size={14} />
        </button>
        <button
          aria-label="Open provider settings"
          className="agent-iconbutton"
          onClick={onOpenSettings}
          title="Settings > Agents"
          type="button"
        >
          <Settings aria-hidden="true" size={14} />
        </button>
      </nav>
    </footer>
  );
}

function ProviderFooterRow({
  enabled,
  management,
  provider,
}: {
  readonly enabled: boolean;
  readonly management: AgentProviderManagementSurface;
  readonly provider: AgentCliKind;
}) {
  const view = management.providers[provider];
  const updating = view.updateState.kind === "starting" || view.updateState.kind === "running";
  const registering = view.policy.kind === "registering";
  const available =
    view.health.kind === "ready" && view.health.update.kind === "available"
      ? view.health.update
      : null;
  const updateDisabled = view.liveTurnCount > 0 || updating;

  if (!enabled) return null;

  return (
    <span className="agent-provider-footer__provider" data-provider={provider}>
      <span aria-hidden="true" className="agent-provider-footer__glyph">
        <AgentProviderGlyph kind={provider} />
      </span>
      <span
        className="agent-provider-footer__label"
        title={providerFooterDetail(view.policy, view.health)}
      >
        {updating
          ? `Updating ${providerLabel(provider)}`
          : providerFooterLabel(view.policy, view.health)}
      </span>
      {updating || registering ? (
        <LoaderCircle aria-hidden="true" className="agent-provider-spin" size={12} />
      ) : null}
      {available === null || updating || view.policy.kind !== "registered" ? null : (
        <button
          aria-label={`Update ${providerLabel(provider)} to ${available.availableVersion}`}
          className="agent-provider-footer__action"
          disabled={updateDisabled}
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
      {view.policy.kind === "unregistered" || view.policy.kind === "failed" ? (
        <button
          aria-label={`Retry ${providerLabel(provider)} policy registration`}
          className="agent-provider-footer__action"
          onClick={() => void management.retryRegistration(provider)}
          type="button"
        >
          Register
        </button>
      ) : null}
      {view.health.kind === "failed" ? (
        <button
          aria-label={`Refresh ${providerLabel(provider)} status`}
          className="agent-provider-footer__action"
          onClick={() => void management.refresh(provider)}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={11} />
        </button>
      ) : null}
    </span>
  );
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
      if (health.update.kind === "available") return `v${health.update.availableVersion}`;
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
