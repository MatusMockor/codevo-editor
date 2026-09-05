import {
  MAX_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT,
  MAX_LARGE_SMART_DOCUMENT_LINE_LIMIT,
  MIN_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT,
  MIN_LARGE_SMART_DOCUMENT_LINE_LIMIT,
} from "../../../domain/largeDocumentPolicy";
import { settingsIgnorePatternsFromText, type WorkspaceSettings } from "../../../domain/settings";
import { nullableInputValue } from "../../settingsDialogValues";
import { SettingsButton } from "../primitives/SettingsButton";
import { SettingsNumberField } from "../primitives/SettingsNumberField";
import { SettingsRow } from "../primitives/SettingsRow";
import { SettingsSectionHeading } from "../primitives/SettingsSectionHeading";
import { SettingsSwitch } from "../primitives/SettingsSwitch";
import { SettingsTextArea } from "../primitives/SettingsTextArea";
import { SettingsTextField } from "../primitives/SettingsTextField";
import type { SettingsPageProps } from "../settingsPageProps";
import { GitDirectoryMappingsRows } from "./GitDirectoryMappingsRows";
import { JavaScriptTypeScriptRows } from "./JavaScriptTypeScriptRows";

const BUILT_IN_IGNORES = ".git, node_modules, vendor, target, dist, build";

export function IndexLanguagesSettingsPage(props: SettingsPageProps) {
  const { actions, draft, env } = props;
  const settings = draft.workspaceSettings;
  const disabled = !env.hasWorkspace;
  const update = (patch: Partial<WorkspaceSettings>): void =>
    actions.updateWorkspaceSettings({ ...settings, ...patch });

  return (
    <>
      <SettingsSectionHeading title="Index & languages">
        <SettingsRow rowId="index.largeFileCharacterLimit">
          <SettingsNumberField
            disabled={disabled}
            max={MAX_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT}
            min={MIN_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT}
            onChange={(characterLimit) =>
              update({ largeFileMode: { ...settings.largeFileMode, characterLimit } })
            }
            step={1024}
            unit="chars"
            value={settings.largeFileMode.characterLimit}
          />
        </SettingsRow>

        <SettingsRow rowId="index.largeFileLineLimit">
          <SettingsNumberField
            disabled={disabled}
            max={MAX_LARGE_SMART_DOCUMENT_LINE_LIMIT}
            min={MIN_LARGE_SMART_DOCUMENT_LINE_LIMIT}
            onChange={(lineLimit) =>
              update({ largeFileMode: { ...settings.largeFileMode, lineLimit } })
            }
            step={100}
            unit="lines"
            value={settings.largeFileMode.lineLimit}
          />
        </SettingsRow>

        <SettingsRow layout="stacked" rowId="index.extraIgnorePatterns">
          <SettingsTextArea
            disabled={disabled}
            onChange={(value) => {
              actions.updateIgnorePatternsText(value);
              update({ extraIgnorePatterns: settingsIgnorePatternsFromText(value) });
            }}
            placeholder="build/**"
            rows={8}
            value={draft.ignorePatternsText}
          />
        </SettingsRow>

        <SettingsRow rowId="index.builtInIgnores">
          <code className="settings-readout">{BUILT_IN_IGNORES}</code>
        </SettingsRow>
      </SettingsSectionHeading>

      <JavaScriptTypeScriptRows {...props} />

      <SettingsSectionHeading title="Node, ESLint and Prettier">
        <SettingsRow rowId="index.nodeLaunchConfigurations">
          <SettingsButton
            disabled={disabled}
            label="Edit Node launch configurations"
            onClick={env.onOpenNodeLaunchConfigurations}
            size="compact"
            variant="outline"
          >
            Edit
          </SettingsButton>
        </SettingsRow>

        <SettingsRow rowId="index.eslintPath">
          <SettingsTextField
            disabled={disabled}
            mono
            onChange={(value) => update({ eslintPath: nullableInputValue(value) })}
            placeholder="node_modules/.bin/eslint / Auto"
            value={settings.eslintPath ?? ""}
          />
        </SettingsRow>

        <SettingsRow rowId="index.eslintAnalyseOnSave">
          <SettingsSwitch
            checked={settings.eslintAnalyseOnSave}
            disabled={disabled}
            onChange={(eslintAnalyseOnSave) => update({ eslintAnalyseOnSave })}
          />
        </SettingsRow>

        <SettingsRow rowId="index.eslintFixOnSave">
          <SettingsSwitch
            checked={settings.eslintFixOnSave}
            disabled={disabled}
            onChange={(eslintFixOnSave) => update({ eslintFixOnSave })}
          />
        </SettingsRow>

        <SettingsRow rowId="index.prettierFormatOnSave">
          <SettingsSwitch
            checked={settings.prettierFormatOnSave}
            disabled={disabled}
            onChange={(prettierFormatOnSave) => update({ prettierFormatOnSave })}
          />
        </SettingsRow>
      </SettingsSectionHeading>

      <GitDirectoryMappingsRows {...props} />
    </>
  );
}
