import { nextAgentModelFavoritesRevision, type AgentCliKind } from "../domain/agentSettings";
import {
  defaultAgentProviderPreferences,
  type AgentProviderPreference,
} from "../domain/agentProviderSettings";
import type { AgentProviderManagementSurface } from "../application/useAgentProviderManagement";
import type { AppSettings, WorkspaceSettings } from "../domain/settings";
import { AgentsSettingsSection } from "./AgentsSettingsSection";

export interface AgentsSettingsPanelProps {
  readonly providerManagement: AgentProviderManagementSurface;
  readonly appSettings: AppSettings;
  readonly hasWorkspace: boolean;
  readonly workspaceSettings: WorkspaceSettings;
  updateAppSettings(settings: AppSettings): void;
  updateWorkspaceSettings(settings: WorkspaceSettings): void;
}

export function AgentsSettingsPanel({
  appSettings,
  hasWorkspace,
  providerManagement,
  updateAppSettings,
  updateWorkspaceSettings,
  workspaceSettings,
}: AgentsSettingsPanelProps) {
  const changeCliPath = (agentCliKind: AgentCliKind, agentCliPath: string | null): void => {
    updateAppSettings({
      ...appSettings,
      agentCliPaths: { ...appSettings.agentCliPaths, [agentCliKind]: agentCliPath },
    });
  };

  const clearAgentModelFavorites = (): void => {
    const revision = nextAgentModelFavoritesRevision(appSettings.agentModelFavoritesRevision);
    if (revision === null) return;
    updateAppSettings({
      ...appSettings,
      agentModelFavoriteKeys: [],
      agentModelFavoritesRevision: revision,
    });
  };

  const changeProviderPreference = (
    provider: AgentCliKind,
    change: (preference: AgentProviderPreference) => AgentProviderPreference,
  ): void => {
    const preferences = appSettings.agentProviderPreferences ?? defaultAgentProviderPreferences();
    updateAppSettings({
      ...appSettings,
      agentProviderPreferences: {
        ...preferences,
        [provider]: change(preferences[provider]),
      },
    });
  };

  return (
    <AgentsSettingsSection
      appSettings={appSettings}
      hasWorkspace={hasWorkspace}
      onChangeAgentAppearanceVariant={(agentAppearanceVariant) =>
        updateAppSettings({ ...appSettings, agentAppearanceVariant })
      }
      onChangeAgentCliKind={(agentCliKind) => updateAppSettings({ ...appSettings, agentCliKind })}
      onChangeAgentCliPath={changeCliPath}
      onChangeAgentProviderCheckForUpdates={(provider, checkForUpdates) =>
        changeProviderPreference(provider, (preference) => ({
          ...preference,
          checkForUpdates,
          dismissedUpdateVersion: null,
        }))
      }
      onChangeAgentProviderEnabled={(provider, enabled) =>
        changeProviderPreference(provider, (preference) => ({ ...preference, enabled }))
      }
      onChangeAgentProviderHealthCheckInterval={(provider, healthCheckIntervalSeconds) =>
        changeProviderPreference(provider, (preference) => ({
          ...preference,
          healthCheckIntervalSeconds,
        }))
      }
      onChangeAgentIsolationPolicy={(agentIsolationPolicy) =>
        updateWorkspaceSettings({ ...workspaceSettings, agentIsolationPolicy })
      }
      onChangeMaxConcurrentAgentTasks={(maxConcurrentAgentTasks) =>
        updateAppSettings({ ...appSettings, maxConcurrentAgentTasks })
      }
      onClearAgentModelFavorites={clearAgentModelFavorites}
      providerManagement={providerManagement}
      workspaceSettings={workspaceSettings}
    />
  );
}
