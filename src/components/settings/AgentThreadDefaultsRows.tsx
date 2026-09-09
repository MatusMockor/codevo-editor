import { defaultAgentProviderPreferences } from "../../domain/agentProviderSettings";
import {
  DEFAULT_MAX_CONCURRENT_AGENT_TASKS,
  type AgentCliKind,
  type AgentIsolationPolicy,
} from "../../domain/agentSettings";
import type { AppSettings, WorkspaceSettings } from "../../domain/settings";
import { SettingsButton } from "./primitives/SettingsButton";
import { SettingsRow } from "./primitives/SettingsRow";
import { SettingsSectionHeading } from "./primitives/SettingsSectionHeading";
import { SettingsSelect, type SettingsSelectOption } from "./primitives/SettingsSelect";
import { providerLabel } from "./agentProviderCardPresentation";
import { AGENT_PROVIDERS } from "./agentProviderSettingsPersistence";

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
  readonly workspaceSettings: WorkspaceSettings;
  onChangeDefaultProvider(provider: AgentCliKind): void;
  onChangeIsolationPolicy(policy: AgentIsolationPolicy): void;
  onClearFavorites(): void;
}

export function AgentThreadDefaultsRows({
  appSettings,
  hasWorkspace,
  onChangeDefaultProvider,
  onChangeIsolationPolicy,
  onClearFavorites,
  workspaceSettings,
}: AgentThreadDefaultsRowsProps) {
  const preferences = appSettings.agentProviderPreferences ?? defaultAgentProviderPreferences();
  const enabledProviders = AGENT_PROVIDERS.filter((provider) => preferences[provider].enabled);
  const selectedEnabled = enabledProviders.includes(appSettings.agentCliKind);
  const favoriteCount = appSettings.agentModelFavoriteKeys.length;
  const providerOptions: ReadonlyArray<SettingsSelectOption> = [
    ...(selectedEnabled
      ? []
      : [
          {
            disabled: true,
            label:
              enabledProviders.length === 0
                ? "No enabled providers"
                : "Selected provider is disabled",
            value: "",
          },
        ]),
    ...enabledProviders.map((provider) => ({ label: providerLabel(provider), value: provider })),
  ];

  return (
    <SettingsSectionHeading title="Defaults for new threads">
      <SettingsRow rowId="agents.defaultProvider">
        <SettingsSelect
          disabled={enabledProviders.length === 0}
          onChange={(value) => {
            const provider = AGENT_PROVIDERS.find((candidate) => candidate === value);

            if (provider === undefined) return;
            if (!preferences[provider].enabled) return;

            onChangeDefaultProvider(provider);
          }}
          options={providerOptions}
          value={selectedEnabled ? appSettings.agentCliKind : ""}
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
