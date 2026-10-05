import type { AgentProviderManagementSurface } from "../../application/useAgentProviderManagement";
import type { AgentFollowUpBehavior } from "../../domain/agentFollowUpBehavior";
import {
  defaultAgentNewThreadDefaults,
  type AgentNewThreadDefaults,
} from "../../domain/agentNewThreadDefaults";
import { defaultAgentProviderPreferences } from "../../domain/agentProviderSettings";
import {
  DEFAULT_MAX_CONCURRENT_AGENT_TASKS,
  type AgentCliKind,
  type AgentIsolationPolicy,
} from "../../domain/agentSettings";
import type { AppSettings, WorkspaceSettings } from "../../domain/settings";
import { useAgentClaudeModelCatalog } from "../agentMode/useAgentClaudeModelCatalog";
import { useAgentCodexModelCatalog } from "../agentMode/useAgentCodexModelCatalog";
import {
  agentProviderEnablement,
  NEW_THREAD_LAUNCH_SOURCE_OPTIONS,
  newThreadLaunchSourceDescription,
  newThreadModelContext,
  newThreadPreview,
  newThreadProviderSelection,
  withNewThreadLaunchSource,
} from "./agentNewThreadDefaultsPresentation";
import { AgentNewThreadPreview } from "./AgentNewThreadPreview";
import { AgentNewThreadStartTiles } from "./AgentNewThreadStartTiles";
import { SettingsButton } from "./primitives/SettingsButton";
import { SettingsRow } from "./primitives/SettingsRow";
import { SettingsSectionHeading } from "./primitives/SettingsSectionHeading";
import { SettingsSegmented } from "./primitives/SettingsSegmented";
import { SettingsSelect } from "./primitives/SettingsSelect";

interface IsolationOption {
  readonly label: string;
  readonly value: AgentIsolationPolicy;
}

const ISOLATION_OPTIONS: ReadonlyArray<IsolationOption> = [
  { label: "Automatic", value: "auto" },
  { label: "Always use a worktree", value: "worktree" },
  { label: "Prefer in-place", value: "in-place" },
];

export interface AgentThreadDefaultsRowsProps {
  readonly appSettings: AppSettings;
  readonly hasWorkspace: boolean;
  readonly management: AgentProviderManagementSurface;
  readonly workspaceSettings: WorkspaceSettings;
  onChangeFollowUpBehavior(behavior: AgentFollowUpBehavior): void;
  onChangeDefaultProvider(provider: AgentCliKind): void;
  onChangeIsolationPolicy(policy: AgentIsolationPolicy): void;
  onChangeNewThreadDefaults(defaults: AgentNewThreadDefaults): void;
  onClearFavorites(): void;
}

export function AgentThreadDefaultsRows({
  appSettings,
  hasWorkspace,
  management,
  onChangeDefaultProvider,
  onChangeFollowUpBehavior,
  onChangeIsolationPolicy,
  onChangeNewThreadDefaults,
  onClearFavorites,
  workspaceSettings,
}: AgentThreadDefaultsRowsProps) {
  const claudeCatalog = useAgentClaudeModelCatalog();
  const codexCatalog = useAgentCodexModelCatalog();
  const preferences = appSettings.agentProviderPreferences ?? defaultAgentProviderPreferences();
  const enabled = agentProviderEnablement(preferences);
  const selection = newThreadProviderSelection(appSettings.agentCliKind, enabled);
  const defaults = appSettings.agentNewThreadDefaults ?? defaultAgentNewThreadDefaults();
  const modelContext = newThreadModelContext(management, claudeCatalog, codexCatalog);
  const favoriteCount = appSettings.agentModelFavoriteKeys.length;

  return (
    <SettingsSectionHeading title="New threads">
      <AgentNewThreadStartTiles
        defaults={defaults}
        enabled={enabled}
        modelContext={modelContext}
        onChangeDefaults={onChangeNewThreadDefaults}
        onSelectProvider={(provider) => {
          if (!preferences[provider].enabled) return;

          onChangeDefaultProvider(provider);
        }}
        preview={
          selection.kind === "selected" ? (
            <AgentNewThreadPreview
              preview={newThreadPreview(selection.provider, defaults, modelContext)}
            />
          ) : null
        }
        selection={selection}
        views={management.providers}
      />

      <SettingsRow
        description={newThreadLaunchSourceDescription(defaults.source)}
        rowId="agents.newThreadLaunchSource"
      >
        <SettingsSegmented
          onChange={(value) => {
            const next = withNewThreadLaunchSource(defaults, value);

            if (next === null) return;

            onChangeNewThreadDefaults(next);
          }}
          options={NEW_THREAD_LAUNCH_SOURCE_OPTIONS}
          value={defaults.source}
        />
      </SettingsRow>

      <SettingsRow rowId="agents.followUpBehavior">
        <SettingsSelect
          onChange={(value) => {
            if (value === "queue" || value === "steer") onChangeFollowUpBehavior(value);
          }}
          options={[
            { label: "Queue for later", value: "queue" },
            { label: "Send now", value: "steer" },
          ]}
          value={appSettings.agentFollowUpBehavior}
          width="md"
        />
      </SettingsRow>

      <SettingsRow
        meta={<span className="settings-row__meta">{favoriteCount} pinned</span>}
        rowId="agents.favoriteModels"
      >
        <SettingsButton
          disabled={favoriteCount === 0}
          onClick={onClearFavorites}
          size="compact"
          variant="outline"
        >
          Clear favorites
        </SettingsButton>
      </SettingsRow>

      <SettingsRow rowId="agents.maxConcurrentTasks">
        <span className="settings-row__meta">Up to {DEFAULT_MAX_CONCURRENT_AGENT_TASKS}</span>
      </SettingsRow>

      <SettingsRow rowId="agents.isolationPolicy">
        <SettingsSelect
          disabled={!hasWorkspace}
          onChange={(value) => {
            const option = ISOLATION_OPTIONS.find((candidate) => candidate.value === value);

            if (option === undefined) return;

            onChangeIsolationPolicy(option.value);
          }}
          options={ISOLATION_OPTIONS}
          value={workspaceSettings.agentIsolationPolicy}
          width="md"
        />
      </SettingsRow>
    </SettingsSectionHeading>
  );
}
