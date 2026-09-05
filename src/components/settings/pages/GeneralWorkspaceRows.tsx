import type { BackgroundRuntimePolicy } from "../../../domain/settings";
import type { IntelligenceMode } from "../../../domain/workspace";
import { SettingsRow } from "../primitives/SettingsRow";
import { SettingsSectionHeading } from "../primitives/SettingsSectionHeading";
import { SettingsSegmented } from "../primitives/SettingsSegmented";
import { SettingsSelect } from "../primitives/SettingsSelect";
import { SettingsSwitch } from "../primitives/SettingsSwitch";
import { SettingsTextField } from "../primitives/SettingsTextField";
import type { SettingsPageProps } from "../settingsPageProps";

const INTELLIGENCE_MODE_OPTIONS = [
  { value: "basic", label: "Editor Mode" },
  { value: "lightSmart", label: "Smart Index" },
  { value: "fullSmart", label: "IDE Mode" },
] as const;

const RUNTIME_POLICY_OPTIONS = [
  { value: "keepAlive", label: "Keep project engines alive" },
  { value: "suspendOnBackground", label: "Suspend background projects" },
  { value: "singleActive", label: "Only active project runs IDE" },
] as const;

export function GeneralWorkspaceRows({ actions, draft, env }: SettingsPageProps) {
  const workspaceSettings = draft.workspaceSettings;
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

      <SettingsRow rowId="general.intelligenceMode">
        <SettingsSegmented
          disabled={disabled}
          onChange={(value) => {
            if (!isIntelligenceMode(value)) return;

            actions.updateWorkspaceSettings({ ...workspaceSettings, intelligenceMode: value });
          }}
          options={INTELLIGENCE_MODE_OPTIONS}
          value={workspaceSettings.intelligenceMode}
        />
      </SettingsRow>

      <SettingsRow rowId="general.trustedWorkspace">
        <SettingsSwitch
          checked={draft.trusted}
          disabled={disabled}
          onChange={actions.updateTrusted}
        />
      </SettingsRow>

      <SettingsRow rowId="general.revealActiveFileInTree">
        <SettingsSwitch
          checked={workspaceSettings.revealActiveFileInTree}
          disabled={disabled}
          onChange={(revealActiveFileInTree) =>
            actions.updateWorkspaceSettings({ ...workspaceSettings, revealActiveFileInTree })
          }
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

function isIntelligenceMode(value: string): value is IntelligenceMode {
  return INTELLIGENCE_MODE_OPTIONS.some((option) => option.value === value);
}

function isBackgroundRuntimePolicy(value: string): value is BackgroundRuntimePolicy {
  return RUNTIME_POLICY_OPTIONS.some((option) => option.value === value);
}
