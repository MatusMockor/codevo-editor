import {
  MAX_AGENT_THREAD_FONT_SIZE,
  MIN_AGENT_THREAD_FONT_SIZE,
  normalizeAgentThreadFontSize,
} from "../../../domain/agentSettings";
import { SYNTAX_THEME_IDS, SYNTAX_THEME_LABELS, isSyntaxThemeId } from "../../../domain/appearance";
import {
  maxEditorFontSize,
  minEditorFontSize,
  normalizeEditorFontFamily,
  normalizeEditorFontSize,
} from "../../../domain/settings";
import { Stepper } from "../../../ui/foundation/Stepper";
import { SettingsButton } from "../primitives/SettingsButton";
import { SettingsRow } from "../primitives/SettingsRow";
import { SettingsSectionHeading } from "../primitives/SettingsSectionHeading";
import { SettingsSelect } from "../primitives/SettingsSelect";
import { SettingsSwitch } from "../primitives/SettingsSwitch";
import type { SettingsPageProps } from "../settingsPageProps";
import { useMonospaceFontFamilies } from "./useMonospaceFontFamilies";

const SYNTAX_THEME_OPTIONS = SYNTAX_THEME_IDS.map((value) => ({
  value,
  label: SYNTAX_THEME_LABELS[value],
}));

export function GeneralTextEditorRows({ actions, draft, env }: SettingsPageProps) {
  const appSettings = draft.appSettings;
  const fonts = useMonospaceFontFamilies(env.systemFontGateway, appSettings.editorFontFamily);

  return (
    <SettingsSectionHeading title="Text & editor">
      <SettingsRow rowId="appearance.agentThreadFontSize">
        <Stepper
          label="Thread text size"
          max={MAX_AGENT_THREAD_FONT_SIZE}
          min={MIN_AGENT_THREAD_FONT_SIZE}
          onChange={(value) =>
            actions.updateAppSettings({
              ...appSettings,
              agentThreadFontSize: normalizeAgentThreadFontSize(value),
            })
          }
          unit="px"
          value={appSettings.agentThreadFontSize}
        />
      </SettingsRow>

      <SettingsRow rowId="appearance.editorFontFamily">
        <div className="settings-fontfamily">
          <SettingsSelect
            onChange={(editorFontFamily) =>
              actions.updateAppSettings({
                ...appSettings,
                editorFontFamily: normalizeEditorFontFamily(editorFontFamily),
              })
            }
            options={fonts.options.map((family) => ({ value: family, label: family }))}
            value={appSettings.editorFontFamily}
            width="md"
          />
          <SettingsButton onClick={fonts.refresh} variant="outline">
            Refresh list
          </SettingsButton>
        </div>
      </SettingsRow>

      <SettingsRow rowId="appearance.editorFontSize">
        <Stepper
          label="Editor font size"
          max={maxEditorFontSize}
          min={minEditorFontSize}
          onChange={(value) =>
            actions.updateAppSettings({
              ...appSettings,
              editorFontSize: normalizeEditorFontSize(value),
            })
          }
          unit="px"
          value={appSettings.editorFontSize}
        />
      </SettingsRow>

      <SettingsRow rowId="appearance.syntaxTheme">
        <SettingsSelect
          onChange={(value) => {
            if (!isSyntaxThemeId(value)) return;

            actions.updateAppSettings({
              ...appSettings,
              appearance: { ...appSettings.appearance, syntaxTheme: value },
            });
          }}
          options={SYNTAX_THEME_OPTIONS}
          value={appSettings.appearance.syntaxTheme}
          width="md"
        />
      </SettingsRow>

      <SettingsRow rowId="appearance.editorFontLigatures">
        <SettingsSwitch
          checked={appSettings.editorFontLigatures}
          onChange={(editorFontLigatures) =>
            actions.updateAppSettings({ ...appSettings, editorFontLigatures })
          }
        />
      </SettingsRow>

      <SettingsRow rowId="appearance.minimap">
        <SettingsSwitch
          checked={appSettings.minimapEnabled === true}
          onChange={(minimapEnabled) =>
            actions.updateAppSettings({ ...appSettings, minimapEnabled })
          }
        />
      </SettingsRow>

      <SettingsRow rowId="appearance.wordWrap">
        <SettingsSwitch
          checked={appSettings.wordWrapEnabled === true}
          onChange={(wordWrapEnabled) =>
            actions.updateAppSettings({ ...appSettings, wordWrapEnabled })
          }
        />
      </SettingsRow>
    </SettingsSectionHeading>
  );
}
