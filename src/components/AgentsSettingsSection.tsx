import {
  AGENT_APPEARANCE_VARIANTS,
  MAX_CONCURRENT_AGENT_TASKS_LIMIT,
  MIN_CONCURRENT_AGENT_TASKS_LIMIT,
  type AgentAppearanceVariant,
  type AgentCliKind,
  type AgentIsolationPolicy,
} from "../domain/agentSettings";
import { defaultAgentProviderPreferences } from "../domain/agentProviderSettings";
import type { AppSettings, WorkspaceSettings } from "../domain/settings";
import { AgentProviderSettingsCard } from "./AgentProviderSettingsCard";
import type { AgentProviderManagementSurface } from "../application/useAgentProviderManagement";
import type { AgentProviderSignInSurface } from "../application/useAgentProviderSignIn";
import { boundedPositiveIntegerInputValue } from "./settingsDialogModel";

const agentCliKindOptions: ReadonlyArray<{ readonly id: AgentCliKind; readonly label: string }> = [
  { id: "claudeCode", label: "Claude Code" },
  { id: "codex", label: "Codex" },
];

const agentIsolationPolicyOptions: ReadonlyArray<{
  readonly id: AgentIsolationPolicy;
  readonly label: string;
}> = [
  { id: "auto", label: "Automatic" },
  { id: "worktree", label: "Always use a worktree" },
  { id: "in-place", label: "Prefer in-place" },
];

const agentAppearanceOptions: ReadonlyArray<{
  readonly id: AgentAppearanceVariant;
  readonly label: string;
}> = [
  { id: "current", label: "Current" },
  { id: "graphite", label: "Graphite" },
  { id: "paper", label: "Paper" },
  { id: "studio", label: "Studio" },
];

function isAgentCliKind(value: string): value is AgentCliKind {
  return agentCliKindOptions.some((option) => option.id === value);
}

function isAgentIsolationPolicy(value: string): value is AgentIsolationPolicy {
  return agentIsolationPolicyOptions.some((option) => option.id === value);
}

function isAgentAppearanceVariant(value: string): value is AgentAppearanceVariant {
  return AGENT_APPEARANCE_VARIANTS.some((variant) => variant === value);
}

export interface AgentsSettingsSectionProps {
  readonly appSettings: AppSettings;
  readonly providerManagement: AgentProviderManagementSurface;
  readonly providerSignIn?: AgentProviderSignInSurface;
  readonly hasWorkspace: boolean;
  readonly workspaceSettings: WorkspaceSettings;
  onChangeAgentCliPath(kind: AgentCliKind, value: string | null): void;
  onChangeAgentProviderCheckForUpdates(kind: AgentCliKind, value: boolean): void;
  onChangeAgentProviderEnabled(kind: AgentCliKind, value: boolean): void;
  onChangeAgentProviderHealthCheckInterval(kind: AgentCliKind, value: number): void;
  onChangeAgentCliKind(value: AgentCliKind): void;
  onChangeAgentAppearanceVariant(value: AgentAppearanceVariant): void;
  onClearAgentModelFavorites(): void;
  onChangeMaxConcurrentAgentTasks(value: number): void;
  onChangeAgentIsolationPolicy(value: AgentIsolationPolicy): void;
}

export function AgentsSettingsSection({
  appSettings,
  hasWorkspace,
  onChangeAgentAppearanceVariant,
  onChangeAgentCliKind,
  onChangeAgentCliPath,
  onChangeAgentProviderCheckForUpdates,
  onChangeAgentProviderEnabled,
  onChangeAgentProviderHealthCheckInterval,
  onClearAgentModelFavorites,
  onChangeAgentIsolationPolicy,
  onChangeMaxConcurrentAgentTasks,
  providerManagement,
  providerSignIn = unavailableProviderSignIn,
  workspaceSettings,
}: AgentsSettingsSectionProps) {
  const preferences = appSettings.agentProviderPreferences ?? defaultAgentProviderPreferences();
  const enabledAgentCliKindOptions = agentCliKindOptions.filter(
    (option) => preferences[option.id].enabled,
  );
  const selectedAgentCliKindIsEnabled = enabledAgentCliKindOptions.some(
    (option) => option.id === appSettings.agentCliKind,
  );
  const selectedAgentCliKind = selectedAgentCliKindIsEnabled ? appSettings.agentCliKind : "";
  return (
    <div className="settings-group">
      <div className="settings-subgroup agent-provider-settings">
        <span>Providers</span>
        <AgentProviderSettingsCard
          management={providerManagement}
          onChangeCheckForUpdates={(value) =>
            onChangeAgentProviderCheckForUpdates("claudeCode", value)
          }
          onChangeEnabled={(value) => onChangeAgentProviderEnabled("claudeCode", value)}
          onChangeHealthCheckIntervalSeconds={(value) =>
            onChangeAgentProviderHealthCheckInterval("claudeCode", value)
          }
          onChangePath={(value) => onChangeAgentCliPath("claudeCode", value)}
          path={appSettings.agentCliPaths.claudeCode}
          preference={preferences.claudeCode}
          provider="claudeCode"
          signIn={{
            blockedReason: providerSignIn.blockedReason("claudeCode"),
            state: providerSignIn.states.claudeCode,
            onSignIn: () => {
              providerSignIn.request("claudeCode");
            },
          }}
        />
        <AgentProviderSettingsCard
          management={providerManagement}
          onChangeCheckForUpdates={(value) => onChangeAgentProviderCheckForUpdates("codex", value)}
          onChangeEnabled={(value) => onChangeAgentProviderEnabled("codex", value)}
          onChangeHealthCheckIntervalSeconds={(value) =>
            onChangeAgentProviderHealthCheckInterval("codex", value)
          }
          onChangePath={(value) => onChangeAgentCliPath("codex", value)}
          path={appSettings.agentCliPaths.codex}
          preference={preferences.codex}
          provider="codex"
          signIn={{
            blockedReason: providerSignIn.blockedReason("codex"),
            state: providerSignIn.states.codex,
            onSignIn: () => {
              providerSignIn.request("codex");
            },
          }}
        />
        <p className="settings-hint">
          Provider commands authenticate from your environment. Codevo never stores API keys or
          tokens. Update checks stay offline unless you enable them for a provider.
        </p>
      </div>

      <label className="settings-field">
        <span>Agent CLI</span>
        <select
          disabled={enabledAgentCliKindOptions.length === 0}
          onChange={(event) => {
            const value = event.currentTarget.value;
            if (!isAgentCliKind(value)) {
              return;
            }
            if (!preferences[value].enabled) return;
            onChangeAgentCliKind(value);
          }}
          value={selectedAgentCliKind}
        >
          {!selectedAgentCliKindIsEnabled ? (
            <option disabled value="">
              {enabledAgentCliKindOptions.length === 0
                ? "No enabled providers"
                : "Selected provider is disabled"}
            </option>
          ) : null}
          {enabledAgentCliKindOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="settings-field">
        <span>Agent appearance</span>
        <select
          onChange={(event) => {
            const value = event.currentTarget.value;
            if (!isAgentAppearanceVariant(value)) return;
            onChangeAgentAppearanceVariant(value);
          }}
          value={appSettings.agentAppearanceVariant}
        >
          {agentAppearanceOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <div className="settings-field">
        <span>Favorite models</span>
        <button
          disabled={appSettings.agentModelFavoriteKeys.length === 0}
          onClick={onClearAgentModelFavorites}
          type="button"
        >
          Clear {appSettings.agentModelFavoriteKeys.length} favorites
        </button>
      </div>

      <label className="settings-field">
        <span>Max concurrent agent tasks</span>
        <input
          max={MAX_CONCURRENT_AGENT_TASKS_LIMIT}
          min={MIN_CONCURRENT_AGENT_TASKS_LIMIT}
          onChange={(event) => {
            const value = boundedPositiveIntegerInputValue(
              event.currentTarget.value,
              MIN_CONCURRENT_AGENT_TASKS_LIMIT,
              MAX_CONCURRENT_AGENT_TASKS_LIMIT,
            );

            if (value === null) {
              return;
            }

            onChangeMaxConcurrentAgentTasks(value);
          }}
          step={1}
          type="number"
          value={appSettings.maxConcurrentAgentTasks}
        />
      </label>

      <label className="settings-field">
        <span>Workspace isolation policy</span>
        <select
          disabled={!hasWorkspace}
          onChange={(event) => {
            const value = event.currentTarget.value;
            if (!isAgentIsolationPolicy(value)) {
              return;
            }
            onChangeAgentIsolationPolicy(value);
          }}
          value={workspaceSettings.agentIsolationPolicy}
        >
          {agentIsolationPolicyOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <p className="settings-hint">
        Automatic prefers an isolated worktree whenever the repository is busy, dirty, or has
        unsaved editors.
      </p>
    </div>
  );
}

const unavailableProviderSignIn: AgentProviderSignInSurface = {
  states: { claudeCode: { kind: "idle" }, codex: { kind: "idle" } },
  terminalIntents: { claudeCode: null, codex: null },
  blockedReason: () => "Provider sign-in is unavailable.",
  isActive: () => false,
  request: () => false,
  cancelStart: () => undefined,
  start: async () => null,
  settle: async () => undefined,
};
