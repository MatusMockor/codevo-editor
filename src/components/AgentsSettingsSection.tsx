import {
  MAX_CONCURRENT_AGENT_TASKS_LIMIT,
  MIN_CONCURRENT_AGENT_TASKS_LIMIT,
  normalizeAgentCliPath,
  type AgentCliKind,
  type AgentIsolationPolicy,
} from "../domain/agentSettings";
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

function isAgentCliKind(value: string): value is AgentCliKind {
  return agentCliKindOptions.some((option) => option.id === value);
}

function isAgentIsolationPolicy(value: string): value is AgentIsolationPolicy {
  return agentIsolationPolicyOptions.some((option) => option.id === value);
}

export interface AgentsSettingsSectionProps {
  readonly appSettings: AppSettings;
  readonly hasWorkspace: boolean;
  readonly workspaceSettings: WorkspaceSettings;
  onChangeAgentCliPath(value: string | null): void;
  onChangeAgentCliKind(value: AgentCliKind): void;
  onChangeMaxConcurrentAgentTasks(value: number): void;
  onChangeAgentIsolationPolicy(value: AgentIsolationPolicy): void;
}

export function AgentsSettingsSection({
  appSettings,
  hasWorkspace,
  onChangeAgentCliKind,
  onChangeAgentCliPath,
  onChangeAgentIsolationPolicy,
  onChangeMaxConcurrentAgentTasks,
  workspaceSettings,
}: AgentsSettingsSectionProps) {
  return (
    <div className="settings-group">
      <label className="settings-field">
        <span>Agent CLI path</span>
        <input
          onBlur={(event) => onChangeAgentCliPath(normalizeAgentCliPath(event.currentTarget.value))}
          onChange={(event) => {
            const raw = event.currentTarget.value;
            onChangeAgentCliPath(raw === "" ? null : raw);
          }}
          placeholder="/usr/local/bin/claude"
          spellCheck={false}
          value={appSettings.agentCliPath ?? ""}
        />
      </label>

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
