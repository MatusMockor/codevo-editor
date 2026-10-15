import type { BackgroundRuntimePolicy } from "../../../domain/settings";
import { SettingsRow } from "../primitives/SettingsRow";
import { SettingsSectionHeading } from "../primitives/SettingsSectionHeading";
import { SettingsSelect } from "../primitives/SettingsSelect";
import { SettingsSwitch } from "../primitives/SettingsSwitch";
import { SettingsTextField } from "../primitives/SettingsTextField";
import type { SettingsPageProps } from "../settingsPageProps";

const RUNTIME_POLICY_OPTIONS = [
  { value: "keepAlive", label: "Keep background projects running" },
  { value: "suspendOnBackground", label: "Suspend background projects" },
  { value: "singleActive", label: "Run only the active project" },
] as const;

export function GeneralWorkspaceRows({ actions, draft, env }: SettingsPageProps) {
  const disabled = !env.hasWorkspace;

  return (
    <SettingsSectionHeading title="Workspace">
      <SettingsRow rowId="general.workspaceRoot">
        <SettingsTextField
          mono
          readOnly
          value={env.workspaceRoot ?? "No workspace open"}
          width="full"
        />
      </SettingsRow>

      <SettingsRow rowId="general.trustedWorkspace">
        <SettingsSwitch
          checked={draft.trusted}
          disabled={disabled}
          onChange={actions.updateTrusted}
        />
      </SettingsRow>

      <SettingsRow rowId="general.backgroundRuntimePolicy">
        <SettingsSelect
          onChange={(value) => {
            if (!isBackgroundRuntimePolicy(value)) return;

            actions.updateAppSettings({ ...draft.appSettings, runtimePolicy: value });
          }}
          options={RUNTIME_POLICY_OPTIONS}
          value={draft.appSettings.runtimePolicy}
          width="md"
        />
      </SettingsRow>

      <SettingsRow rowId="general.terminalShellIntegration">
        <SettingsSwitch
          checked={draft.appSettings.terminalShellIntegrationEnabled}
          onChange={(terminalShellIntegrationEnabled) =>
            actions.updateAppSettings({ ...draft.appSettings, terminalShellIntegrationEnabled })
          }
        />
      </SettingsRow>
    </SettingsSectionHeading>
  );
}

function isBackgroundRuntimePolicy(value: string): value is BackgroundRuntimePolicy {
  return RUNTIME_POLICY_OPTIONS.some((option) => option.value === value);
}
