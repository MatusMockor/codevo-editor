import type {
  JavaScriptTypeScriptImportModuleSpecifierEnding,
  JavaScriptTypeScriptImportModuleSpecifierPreference,
  JavaScriptTypeScriptQuotePreference,
  JavaScriptTypeScriptServiceMode,
  JavaScriptTypeScriptVersionPreference,
  WorkspaceSettings,
} from "../../../domain/settings";
import { SettingsButton } from "../primitives/SettingsButton";
import { SettingsRow } from "../primitives/SettingsRow";
import { SettingsSectionHeading } from "../primitives/SettingsSectionHeading";
import { SettingsSelect } from "../primitives/SettingsSelect";
import { SettingsSwitch } from "../primitives/SettingsSwitch";
import type { SettingsPageProps } from "../settingsPageProps";
import type { SettingsRowId } from "../settingsRegistry";

type BooleanKey = {
  [Key in keyof WorkspaceSettings]: WorkspaceSettings[Key] extends boolean ? Key : never;
}[keyof WorkspaceSettings];

const SERVICE_OPTIONS = [
  { label: "Auto", value: "auto" },
  { label: "Off", value: "off" },
] as const;

const VERSION_OPTIONS = [
  { label: "Managed", value: "bundled" },
  { label: "Workspace", value: "workspace" },
] as const;

const SPECIFIER_OPTIONS = [
  { label: "Shortest", value: "shortest" },
  { label: "Relative", value: "relative" },
  { label: "Non-relative", value: "non-relative" },
  { label: "Project-relative", value: "project-relative" },
] as const;

const SPECIFIER_ENDING_OPTIONS = [
  { label: "Auto", value: "auto" },
  { label: "Minimal", value: "minimal" },
  { label: "Index", value: "index" },
  { label: "JS", value: "js" },
] as const;

const QUOTE_OPTIONS = [
  { label: "Auto", value: "auto" },
  { label: "Single", value: "single" },
  { label: "Double", value: "double" },
] as const;

const SWITCH_ROWS: ReadonlyArray<readonly [SettingsRowId, BooleanKey]> = [
  ["index.javaScriptTypeScriptValidation", "javaScriptTypeScriptValidation"],
  ["index.javaScriptTypeScriptAutoImports", "javaScriptTypeScriptAutoImports"],
];

const TRAILING_SWITCH_ROWS: ReadonlyArray<readonly [SettingsRowId, BooleanKey]> = [
  [
    "index.javaScriptTypeScriptPreferTypeOnlyAutoImports",
    "javaScriptTypeScriptPreferTypeOnlyAutoImports",
  ],
  [
    "index.javaScriptTypeScriptAutomaticTypeAcquisition",
    "javaScriptTypeScriptAutomaticTypeAcquisition",
  ],
  ["index.javaScriptTypeScriptInlayHints", "javaScriptTypeScriptInlayHints"],
  ["index.javaScriptTypeScriptCodeLens", "javaScriptTypeScriptCodeLens"],
  [
    "index.javaScriptTypeScriptReferencesCodeLensOnAllFunctions",
    "javaScriptTypeScriptReferencesCodeLensOnAllFunctions",
  ],
  ["index.javaScriptTypeScriptCompleteFunctionCalls", "javaScriptTypeScriptCompleteFunctionCalls"],
  ["index.javaScriptTypeScriptOrganizeImportsOnSave", "javaScriptTypeScriptOrganizeImportsOnSave"],
  ["index.javaScriptTypeScriptRemoveUnusedOnSave", "javaScriptTypeScriptRemoveUnusedOnSave"],
  [
    "index.javaScriptTypeScriptAddMissingImportsOnSave",
    "javaScriptTypeScriptAddMissingImportsOnSave",
  ],
  ["index.javaScriptTypeScriptFixAllOnSave", "javaScriptTypeScriptFixAllOnSave"],
];

export function JavaScriptTypeScriptRows({ actions, draft, env }: SettingsPageProps) {
  const settings = draft.workspaceSettings;
  const disabled = !env.hasWorkspace;
  const update = (patch: Partial<WorkspaceSettings>): void =>
    actions.updateWorkspaceSettings({ ...settings, ...patch });
  const toggle = (key: BooleanKey) => (checked: boolean) => {
    const next: WorkspaceSettings = { ...settings };
    next[key] = checked;
    actions.updateWorkspaceSettings(next);
  };

  return (
    <SettingsSectionHeading title="JavaScript & TypeScript">
      <SettingsRow rowId="index.javaScriptTypeScriptService">
        <SettingsSelect
          disabled={disabled}
          onChange={(value) => {
            if (!isServiceMode(value)) return;

            update({ javaScriptTypeScriptService: value });
          }}
          options={SERVICE_OPTIONS}
          value={settings.javaScriptTypeScriptService}
        />
      </SettingsRow>

      <SettingsRow rowId="index.javaScriptTypeScriptVersion">
        <SettingsSelect
          disabled={disabled}
          onChange={(value) => {
            if (!isVersionPreference(value)) return;

            update({ javaScriptTypeScriptVersion: value });
          }}
          options={VERSION_OPTIONS}
          value={settings.javaScriptTypeScriptVersion}
        />
      </SettingsRow>

      {SWITCH_ROWS.map(([rowId, key]) => (
        <SettingsRow key={rowId} rowId={rowId}>
          <SettingsSwitch checked={settings[key]} disabled={disabled} onChange={toggle(key)} />
        </SettingsRow>
      ))}

      <SettingsRow rowId="index.javaScriptTypeScriptImportModuleSpecifier">
        <SettingsSelect
          disabled={disabled}
          onChange={(value) => {
            if (!isSpecifierPreference(value)) return;

            update({ javaScriptTypeScriptImportModuleSpecifierPreference: value });
          }}
          options={SPECIFIER_OPTIONS}
          value={settings.javaScriptTypeScriptImportModuleSpecifierPreference}
        />
      </SettingsRow>

      <SettingsRow rowId="index.javaScriptTypeScriptImportModuleSpecifierEnding">
        <SettingsSelect
          disabled={disabled}
          onChange={(value) => {
            if (!isSpecifierEnding(value)) return;

            update({ javaScriptTypeScriptImportModuleSpecifierEnding: value });
          }}
          options={SPECIFIER_ENDING_OPTIONS}
          value={settings.javaScriptTypeScriptImportModuleSpecifierEnding}
        />
      </SettingsRow>

      <SettingsRow rowId="index.javaScriptTypeScriptQuotePreference">
        <SettingsSelect
          disabled={disabled}
          onChange={(value) => {
            if (!isQuotePreference(value)) return;

            update({ javaScriptTypeScriptQuotePreference: value });
          }}
          options={QUOTE_OPTIONS}
          value={settings.javaScriptTypeScriptQuotePreference}
        />
      </SettingsRow>

      {TRAILING_SWITCH_ROWS.map(([rowId, key]) => (
        <SettingsRow key={rowId} rowId={rowId}>
          <SettingsSwitch checked={settings[key]} disabled={disabled} onChange={toggle(key)} />
        </SettingsRow>
      ))}

      <SettingsRow rowId="index.javaScriptTypeScriptServiceActions">
        <SettingsButton
          disabled={disabled || settings.javaScriptTypeScriptService === "off"}
          label="Restart JavaScript/TypeScript service"
          onClick={() => void env.onRestartJavaScriptTypeScriptService()}
          size="compact"
          variant="outline"
        >
          Restart
        </SettingsButton>
        <SettingsButton
          disabled={disabled}
          label="Open JavaScript/TypeScript service log"
          onClick={() => void env.onOpenJavaScriptTypeScriptServiceLog()}
          size="compact"
          variant="ghost"
        >
          Open log
        </SettingsButton>
      </SettingsRow>
    </SettingsSectionHeading>
  );
}

function isServiceMode(value: string): value is JavaScriptTypeScriptServiceMode {
  return SERVICE_OPTIONS.some((option) => option.value === value);
}

function isVersionPreference(value: string): value is JavaScriptTypeScriptVersionPreference {
  return VERSION_OPTIONS.some((option) => option.value === value);
}

function isSpecifierPreference(
  value: string,
): value is JavaScriptTypeScriptImportModuleSpecifierPreference {
  return SPECIFIER_OPTIONS.some((option) => option.value === value);
}

function isSpecifierEnding(
  value: string,
): value is JavaScriptTypeScriptImportModuleSpecifierEnding {
  return SPECIFIER_ENDING_OPTIONS.some((option) => option.value === value);
}

function isQuotePreference(value: string): value is JavaScriptTypeScriptQuotePreference {
  return QUOTE_OPTIONS.some((option) => option.value === value);
}
