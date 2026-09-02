import { nextAgentModelFavoritesRevision, type AgentCliKind } from "../domain/agentSettings";
import {
  defaultAgentProviderPreferences,
  type AgentProviderPreference,
} from "../domain/agentProviderSettings";
import type { AgentProviderManagementSurface } from "../application/useAgentProviderManagement";
import type { AgentProviderSignInSurface } from "../application/useAgentProviderSignIn";
import type { AppSettings, WorkspaceSettings } from "../domain/settings";
import { AgentsSettingsSection } from "./AgentsSettingsSection";

function otherProvider(provider: AgentCliKind): AgentCliKind {
  switch (provider) {
    case "claudeCode":
      return "codex";
    case "codex":
      return "claudeCode";
    default:
      return provider satisfies never;
  }
}

function providerIsConfigured(
  provider: AgentCliKind,
  management: AgentProviderManagementSurface,
): boolean {
  const disposition = management.admissionAuthority(provider).disposition;
  switch (disposition.kind) {
    case "ready":
      return true;
    case "updating":
    case "disabled":
    case "policyUnavailable":
      return false;
    default:
      return disposition satisfies never;
  }
}

export interface AgentsSettingsPanelProps {
  readonly providerManagement: AgentProviderManagementSurface;
  readonly providerSignIn?: AgentProviderSignInSurface;
  readonly appSettings: AppSettings;
  readonly hasWorkspace: boolean;
  readonly workspaceSettings: WorkspaceSettings;
  updateAppSettings(settings: AppSettings): void;
  updateWorkspaceSettings(settings: WorkspaceSettings): void;
  onCopyInstallCommand?(command: string): void;
}

export function AgentsSettingsPanel({
  appSettings,
  hasWorkspace,
  providerManagement,
  providerSignIn,
  onCopyInstallCommand,
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

  const changeProviderEnabled = (provider: AgentCliKind, enabled: boolean): void => {
    const preferences = appSettings.agentProviderPreferences ?? defaultAgentProviderPreferences();
    const nextPreferences = {
      ...preferences,
      [provider]: { ...preferences[provider], enabled },
    };
    if (enabled || appSettings.agentCliKind !== provider) {
      updateAppSettings({ ...appSettings, agentProviderPreferences: nextPreferences });
      return;
    }
    const fallback = otherProvider(provider);
    if (!nextPreferences[fallback].enabled || !providerIsConfigured(fallback, providerManagement)) {
      updateAppSettings({ ...appSettings, agentProviderPreferences: nextPreferences });
      return;
    }
    updateAppSettings({
      ...appSettings,
      agentCliKind: fallback,
      agentProviderPreferences: nextPreferences,
    });
  };

  return (
    <div className="settings-surface settings-surface--agents">
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
        onChangeAgentProviderEnabled={changeProviderEnabled}
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
        onCopyInstallCommand={onCopyInstallCommand}
        onClearAgentModelFavorites={clearAgentModelFavorites}
        providerManagement={providerManagement}
        providerSignIn={providerSignIn}
        workspaceSettings={workspaceSettings}
      />
    </div>
  );
}
