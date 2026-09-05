import {
  maxWorkspaceTabSize,
  minWorkspaceTabSize,
  normalizeWorkspaceTabSize,
} from "../../../domain/settings";
import { SettingsNumberField } from "../primitives/SettingsNumberField";
import { SettingsRow } from "../primitives/SettingsRow";
import { SettingsSectionHeading } from "../primitives/SettingsSectionHeading";
import { SettingsSwitch } from "../primitives/SettingsSwitch";
import type { SettingsPageProps } from "../settingsPageProps";

export function GeneralEditingRows({ actions, draft, env }: SettingsPageProps) {
  const workspaceSettings = draft.workspaceSettings;
  const disabled = !env.hasWorkspace;

  return (
    <SettingsSectionHeading title="Editing">
      <SettingsRow rowId="general.autoSave">
        <SettingsSwitch
          checked={workspaceSettings.autoSave}
          disabled={disabled}
          onChange={(autoSave) =>
            actions.updateWorkspaceSettings({
              ...workspaceSettings,
              autoSave,
              autoSaveConfigured: true,
            })
          }
        />
      </SettingsRow>

      <SettingsRow rowId="general.formatOnSave">
        <SettingsSwitch
          checked={workspaceSettings.formatOnSave}
          disabled={disabled}
          onChange={(formatOnSave) =>
            actions.updateWorkspaceSettings({ ...workspaceSettings, formatOnSave })
          }
        />
      </SettingsRow>

      <SettingsRow rowId="general.formatOnPaste">
        <SettingsSwitch
          checked={workspaceSettings.formatOnPaste}
          disabled={disabled}
          onChange={(formatOnPaste) =>
            actions.updateWorkspaceSettings({ ...workspaceSettings, formatOnPaste })
          }
        />
      </SettingsRow>

      <SettingsRow rowId="general.optimizeImportsOnSave">
        <SettingsSwitch
          checked={workspaceSettings.optimizeImportsOnSave}
          disabled={disabled}
          onChange={(optimizeImportsOnSave) =>
            actions.updateWorkspaceSettings({ ...workspaceSettings, optimizeImportsOnSave })
          }
        />
      </SettingsRow>

      <SettingsRow rowId="general.defaultTabSize">
        <SettingsNumberField
          disabled={disabled}
          max={maxWorkspaceTabSize}
          min={minWorkspaceTabSize}
          onChange={(value) =>
            actions.updateWorkspaceSettings({
              ...workspaceSettings,
              defaultTabSize: normalizeWorkspaceTabSize(value),
            })
          }
          unit="spaces"
          value={workspaceSettings.defaultTabSize}
        />
      </SettingsRow>

      <SettingsRow rowId="general.defaultInsertSpaces">
        <SettingsSwitch
          checked={workspaceSettings.defaultInsertSpaces}
          disabled={disabled}
          onChange={(defaultInsertSpaces) =>
            actions.updateWorkspaceSettings({ ...workspaceSettings, defaultInsertSpaces })
          }
        />
      </SettingsRow>
    </SettingsSectionHeading>
  );
}
