import { SettingsRow } from "../primitives/SettingsRow";
import { SettingsSectionHeading } from "../primitives/SettingsSectionHeading";
import { SettingsSwitch } from "../primitives/SettingsSwitch";
import type { SettingsPageProps } from "../settingsPageProps";

export function GeneralStatusBarRows({ actions, draft, env }: SettingsPageProps) {
  const workspaceSettings = draft.workspaceSettings;

  return (
    <SettingsSectionHeading title="Sidebar">
      <SettingsRow rowId="general.threadAttention">
        <SettingsSwitch
          checked={workspaceSettings.statusBar.agentAttention}
          disabled={!env.hasWorkspace}
          onChange={(agentAttention) =>
            actions.updateWorkspaceSettings({
              ...workspaceSettings,
              statusBar: { ...workspaceSettings.statusBar, agentAttention },
            })
          }
        />
      </SettingsRow>
    </SettingsSectionHeading>
  );
}
