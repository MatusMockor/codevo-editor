import type { AgentCliVersionGateway } from "../domain/agentCliVersion";
import { nextAgentModelFavoritesRevision, type AgentCliKind } from "../domain/agentSettings";
import type { AppSettings, WorkspaceSettings } from "../domain/settings";
import { AgentsSettingsSection } from "./AgentsSettingsSection";

export interface AgentsSettingsPanelProps {
  readonly agentCliVersionGateway: AgentCliVersionGateway | null;
  readonly appSettings: AppSettings;
  readonly hasWorkspace: boolean;
  readonly workspaceSettings: WorkspaceSettings;
  updateAppSettings(settings: AppSettings): void;
  updateWorkspaceSettings(settings: WorkspaceSettings): void;
}

export function AgentsSettingsPanel({
  agentCliVersionGateway,
  appSettings,
  hasWorkspace,
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

  return (
    <AgentsSettingsSection
      agentCliVersionGateway={agentCliVersionGateway}
      appSettings={appSettings}
      hasWorkspace={hasWorkspace}
      onChangeAgentAppearanceVariant={(agentAppearanceVariant) =>
        updateAppSettings({ ...appSettings, agentAppearanceVariant })
      }
      onChangeAgentCliKind={(agentCliKind) => updateAppSettings({ ...appSettings, agentCliKind })}
      onChangeAgentCliPath={changeCliPath}
      onChangeAgentIsolationPolicy={(agentIsolationPolicy) =>
        updateWorkspaceSettings({ ...workspaceSettings, agentIsolationPolicy })
      }
      onChangeMaxConcurrentAgentTasks={(maxConcurrentAgentTasks) =>
        updateAppSettings({ ...appSettings, maxConcurrentAgentTasks })
      }
      onClearAgentModelFavorites={clearAgentModelFavorites}
      workspaceSettings={workspaceSettings}
    />
  );
}
