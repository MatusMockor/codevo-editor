import type { StatusBarItemVisibility } from "../../../domain/settings";
import { SettingsChipGroup } from "../primitives/SettingsChipGroup";
import { SettingsRow } from "../primitives/SettingsRow";
import { SettingsSectionHeading } from "../primitives/SettingsSectionHeading";
import type { SettingsPageProps } from "../settingsPageProps";

const STATUS_BAR_CHIPS: ReadonlyArray<{
  readonly value: keyof StatusBarItemVisibility;
  readonly label: string;
}> = [
  { value: "activePath", label: "File path" },
  { value: "workspaceInfo", label: "Project info" },
  { value: "index", label: "Index" },
  { value: "languageServer", label: "IDE engine" },
  { value: "largeFileMode", label: "Large file mode" },
  { value: "workspaceTrust", label: "Trust" },
  { value: "mode", label: "Mode" },
  { value: "language", label: "Language" },
  { value: "cursorPosition", label: "Cursor position" },
  { value: "gitBranch", label: "Git branch" },
  { value: "dirtyCount", label: "Unsaved files" },
  { value: "message", label: "Messages" },
];

export function GeneralStatusBarRows({ actions, draft, env }: SettingsPageProps) {
  const workspaceSettings = draft.workspaceSettings;
  const selected = STATUS_BAR_CHIPS.filter((chip) => workspaceSettings.statusBar[chip.value]).map(
    (chip) => chip.value,
  );

  return (
    <SettingsSectionHeading title="Status bar">
      <SettingsRow layout="stacked" rowId="general.statusBar">
        <SettingsChipGroup
          chips={STATUS_BAR_CHIPS}
          disabled={!env.hasWorkspace}
          onToggle={(value, visible) => {
            if (!isStatusBarItemKey(value)) return;

            actions.updateWorkspaceSettings({
              ...workspaceSettings,
              statusBar: { ...workspaceSettings.statusBar, [value]: visible },
            });
          }}
          selected={selected}
        />
      </SettingsRow>
    </SettingsSectionHeading>
  );
}

function isStatusBarItemKey(value: string): value is keyof StatusBarItemVisibility {
  return STATUS_BAR_CHIPS.some((chip) => chip.value === value);
}
