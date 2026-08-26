import { useEffect, useState } from "react";
import {
  AGENT_APPEARANCE_VARIANTS,
  MAX_CONCURRENT_AGENT_TASKS_LIMIT,
  MIN_CONCURRENT_AGENT_TASKS_LIMIT,
  normalizeAgentCliPath,
  type AgentAppearanceVariant,
  type AgentCliKind,
  type AgentIsolationPolicy,
} from "../domain/agentSettings";
import type { AgentCliVersionGateway } from "../domain/agentCliVersion";
import {
  useAgentSettingsCliVersions,
  type AgentSettingsCliProbeState,
} from "../application/useAgentSettingsCliVersions";
import type { AppSettings, WorkspaceSettings } from "../domain/settings";
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
  readonly agentCliVersionGateway?: AgentCliVersionGateway | null;
  readonly hasWorkspace: boolean;
  readonly workspaceSettings: WorkspaceSettings;
  onChangeAgentCliPath(kind: AgentCliKind, value: string | null): void;
  onChangeAgentCliKind(value: AgentCliKind): void;
  onChangeAgentAppearanceVariant(value: AgentAppearanceVariant): void;
  onClearAgentModelFavorites(): void;
  onChangeMaxConcurrentAgentTasks(value: number): void;
  onChangeAgentIsolationPolicy(value: AgentIsolationPolicy): void;
}

export function AgentsSettingsSection({
  appSettings,
  agentCliVersionGateway = null,
  hasWorkspace,
  onChangeAgentAppearanceVariant,
  onChangeAgentCliKind,
  onChangeAgentCliPath,
  onClearAgentModelFavorites,
  onChangeAgentIsolationPolicy,
  onChangeMaxConcurrentAgentTasks,
  workspaceSettings,
}: AgentsSettingsSectionProps) {
  const versions = useAgentSettingsCliVersions(agentCliVersionGateway, appSettings.agentCliPaths);
  return (
    <div className="settings-group">
      <AgentCliPathField
        kind="claudeCode"
        label="Claude CLI path"
        onChange={onChangeAgentCliPath}
        path={appSettings.agentCliPaths.claudeCode}
        placeholder="/usr/local/bin/claude"
        probe={versions.claudeCode}
      />

      <AgentCliPathField
        kind="codex"
        label="Codex CLI path"
        onChange={onChangeAgentCliPath}
        path={appSettings.agentCliPaths.codex}
        placeholder="/usr/local/bin/codex"
        probe={versions.codex}
      />

      <p className="settings-hint">
        Absolute path to the agent CLI executable. Agents authenticate from your own environment;
        the IDE never stores API keys.
      </p>

      <label className="settings-field">
        <span>Agent CLI</span>
        <select
          onChange={(event) => {
            const value = event.currentTarget.value;
            if (!isAgentCliKind(value)) {
              return;
            }
            onChangeAgentCliKind(value);
          }}
          value={appSettings.agentCliKind}
        >
          {agentCliKindOptions.map((option) => (
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

function AgentCliPathField({
  kind,
  label,
  onChange,
  path,
  placeholder,
  probe,
}: {
  readonly kind: AgentCliKind;
  readonly label: string;
  readonly path: string | null;
  readonly placeholder: string;
  readonly probe: AgentSettingsCliProbeState;
  onChange(kind: AgentCliKind, value: string | null): void;
}) {
  const [draft, setDraft] = useState(path ?? "");
  useEffect(() => setDraft(path ?? ""), [path]);
  return (
    <label className="settings-field">
      <span>{label}</span>
      <input
        aria-describedby={`${kind}-cli-validation`}
        onBlur={() => onChange(kind, normalizeAgentCliPath(draft))}
        onChange={(event) => setDraft(event.currentTarget.value)}
        placeholder={placeholder}
        spellCheck={false}
        value={draft}
      />
      <span className="settings-hint" id={`${kind}-cli-validation`} role="status">
        {agentCliDraftLabel(draft, path, probe)}
      </span>
    </label>
  );
}

function agentCliProbeLabel(probe: AgentSettingsCliProbeState): string {
  switch (probe.kind) {
    case "notConfigured":
      return "Not configured";
    case "invalidPath":
      return "Enter an absolute executable path";
    case "probing":
      return "Checking version…";
    case "ready":
      return `Version ${probe.version}`;
    case "unknownVersion":
      return "Executable found; version unavailable";
    case "failed":
      return "Executable could not be validated";
    default:
      return unsupportedProbe(probe);
  }
}

function agentCliDraftLabel(
  draft: string,
  persistedPath: string | null,
  probe: AgentSettingsCliProbeState,
): string {
  if (draft.trim() === "") return "Not configured";
  const normalized = normalizeAgentCliPath(draft);
  if (normalized === null) return "Enter an absolute executable path";
  if (normalized !== persistedPath) return "Save the path to check its version";
  return agentCliProbeLabel(probe);
}

function unsupportedProbe(probe: never): never {
  throw new TypeError(`Unsupported agent CLI probe state: ${String(probe)}`);
}
