import type { PhpBackendPreference, WorkspaceSettings } from "../../../domain/settings";
import type { ToolLocation, WorkspaceDescriptor } from "../../../domain/workspace";
import { nullableInputValue } from "../../settingsDialogValues";
import { SettingsRow } from "../primitives/SettingsRow";
import { SettingsSectionHeading } from "../primitives/SettingsSectionHeading";
import { SettingsSelect } from "../primitives/SettingsSelect";
import { SettingsSwitch } from "../primitives/SettingsSwitch";
import { SettingsTextField } from "../primitives/SettingsTextField";
import type { SettingsPageProps } from "../settingsPageProps";

type ToolPathKey = "phpactorPath" | "intelephensePath" | "phpstanPath";

const PHP_BACKEND_OPTIONS = [
  { label: "Auto", value: "auto" },
  { label: "Managed PHP engine", value: "phpactor" },
  { label: "Intelephense", value: "intelephense" },
] as const;

const TOOL_PATH_ROWS: ReadonlyArray<{
  readonly key: ToolPathKey;
  readonly rowId: "php.phpactorPath" | "php.intelephensePath" | "php.phpstanPath";
}> = [
  { key: "phpactorPath", rowId: "php.phpactorPath" },
  { key: "intelephensePath", rowId: "php.intelephensePath" },
  { key: "phpstanPath", rowId: "php.phpstanPath" },
];

export function PhpSettingsPage({ actions, draft, env }: SettingsPageProps) {
  const settings = draft.workspaceSettings;
  const disabled = !env.hasWorkspace;
  const detectedPhpVersion = detectedComposerPhpVersion(env.workspaceDescriptor);
  const effectivePhpVersion = settings.phpVersionOverride || detectedPhpVersion || "Auto";
  const update = (patch: Partial<WorkspaceSettings>): void =>
    actions.updateWorkspaceSettings({ ...settings, ...patch });
  const updateToolPath = (key: ToolPathKey, value: string): void => {
    const next: WorkspaceSettings = { ...settings };
    next[key] = nullableInputValue(value);
    actions.updateWorkspaceSettings(next);
  };
  const placeholders: Readonly<Record<ToolPathKey, string>> = {
    phpactorPath: detectedToolPath(env.phpTools?.phpactor),
    intelephensePath: detectedToolPath(env.phpTools?.intelephense),
    phpstanPath: "vendor/bin/phpstan / Auto",
  };

  return (
    <>
      <SettingsSectionHeading title="PHP">
        <SettingsRow rowId="php.backend">
          <SettingsSelect
            disabled={disabled}
            onChange={(value) => {
              if (!isPhpBackendPreference(value)) return;

              update({ phpBackend: value });
            }}
            options={PHP_BACKEND_OPTIONS}
            value={settings.phpBackend}
            width="md"
          />
        </SettingsRow>

        <SettingsRow rowId="php.versionOverride">
          <SettingsTextField
            disabled={disabled}
            mono
            onChange={(value) => update({ phpVersionOverride: nullableInputValue(value) })}
            placeholder={detectedPhpVersion ?? "Composer / Auto"}
            value={settings.phpVersionOverride ?? ""}
          />
        </SettingsRow>
      </SettingsSectionHeading>

      <SettingsSectionHeading title="Tool paths">
        {TOOL_PATH_ROWS.map(({ key, rowId }) => (
          <SettingsRow key={rowId} rowId={rowId}>
            <SettingsTextField
              disabled={disabled}
              mono
              onChange={(value) => updateToolPath(key, value)}
              placeholder={placeholders[key]}
              value={settings[key] ?? ""}
            />
          </SettingsRow>
        ))}
      </SettingsSectionHeading>

      <SettingsSectionHeading title="Analysis">
        <SettingsRow rowId="php.phpstanAnalyseOnSave">
          <SettingsSwitch
            checked={settings.phpstanAnalyseOnSave}
            disabled={disabled}
            onChange={(phpstanAnalyseOnSave) => update({ phpstanAnalyseOnSave })}
          />
        </SettingsRow>

        <SettingsRow rowId="php.inlayHints">
          <SettingsSwitch
            checked={settings.phpInlayHints}
            disabled={disabled}
            onChange={(phpInlayHints) => update({ phpInlayHints })}
          />
        </SettingsRow>
      </SettingsSectionHeading>

      <SettingsSectionHeading title="Detected">
        <SettingsRow rowId="php.composerPhpVersion">
          <code className="settings-readout">{detectedPhpVersion ?? "Not declared"}</code>
        </SettingsRow>
        <SettingsRow rowId="php.effectivePhpLevel">
          <code className="settings-readout">{effectivePhpVersion}</code>
        </SettingsRow>
        <SettingsRow rowId="php.detectedPhpEngine">
          <code className="settings-readout">{detectedToolPath(env.phpTools?.phpactor)}</code>
        </SettingsRow>
        <SettingsRow rowId="php.detectedIntelephense">
          <code className="settings-readout">{detectedToolPath(env.phpTools?.intelephense)}</code>
        </SettingsRow>
      </SettingsSectionHeading>
    </>
  );
}

function detectedComposerPhpVersion(descriptor: WorkspaceDescriptor | null): string | null {
  const php = descriptor?.php;

  if (!php) return null;

  return php.phpPlatformVersion || php.phpVersionConstraint || null;
}

function detectedToolPath(tool: ToolLocation | null | undefined): string {
  if (!tool) return "Not detected";

  return tool.path;
}

function isPhpBackendPreference(value: string): value is PhpBackendPreference {
  return PHP_BACKEND_OPTIONS.some((option) => option.value === value);
}
