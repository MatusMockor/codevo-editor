import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  COLOR_SCHEME_LABELS,
  COLOR_SCHEME_PREFERENCES,
  SYNTAX_THEME_IDS,
  SYNTAX_THEME_LABELS,
  isColorSchemePreference,
  isSyntaxThemeId,
  resolveColorScheme,
  type AppearanceSettings,
} from "../../../domain/appearance";
import {
  MAX_AGENT_THREAD_FONT_SIZE,
  MIN_AGENT_THREAD_FONT_SIZE,
  normalizeAgentThreadFontSize,
} from "../../../domain/agentSettings";
import {
  maxEditorFontSize,
  minEditorFontSize,
  normalizeEditorFontFamily,
  normalizeEditorFontSize,
} from "../../../domain/settings";
import type { SystemFontGateway } from "../../../domain/systemFonts";
import { SettingsButton } from "../primitives/SettingsButton";
import { SettingsNumberField } from "../primitives/SettingsNumberField";
import { SettingsRow } from "../primitives/SettingsRow";
import { SettingsSectionHeading } from "../primitives/SettingsSectionHeading";
import { SettingsSegmented } from "../primitives/SettingsSegmented";
import { SettingsSelect } from "../primitives/SettingsSelect";
import { SettingsSwitch } from "../primitives/SettingsSwitch";
import { uniqueSortedStrings } from "../../settingsDialogValues";
import { usePrefersLightTheme } from "../../../application/usePrefersLightTheme";
import type { SettingsPageProps } from "../settingsPageProps";
import { AppearancePaletteSwatches } from "./AppearancePaletteSwatches";

const COLOR_SCHEME_OPTIONS = COLOR_SCHEME_PREFERENCES.map((value) => ({
  value,
  label: COLOR_SCHEME_LABELS[value],
}));

const SYNTAX_THEME_OPTIONS = SYNTAX_THEME_IDS.map((value) => ({
  value,
  label: SYNTAX_THEME_LABELS[value],
}));

export function AppearanceSettingsPage({ actions, draft, env }: SettingsPageProps) {
  const appSettings = draft.appSettings;
  const fonts = useMonospaceFontFamilies(env.systemFontGateway, appSettings.editorFontFamily);
  const prefersLight = usePrefersLightTheme();
  const previewScheme = resolveColorScheme(appSettings.appearance.colorScheme, prefersLight);
  const updateAppearance = (patch: Partial<AppearanceSettings>): void =>
    actions.updateAppSettings({
      ...appSettings,
      appearance: { ...appSettings.appearance, ...patch },
    });

  return (
    <>
      <SettingsSectionHeading title="Appearance">
        <SettingsRow layout="stacked" rowId="appearance.palette">
          <AppearancePaletteSwatches
            onChange={(palette) => updateAppearance({ palette })}
            scheme={previewScheme}
            value={appSettings.appearance.palette}
          />
        </SettingsRow>

        <SettingsRow rowId="appearance.colorScheme">
          <SettingsSegmented
            onChange={(value) => {
              if (!isColorSchemePreference(value)) return;

              updateAppearance({ colorScheme: value });
            }}
            options={COLOR_SCHEME_OPTIONS}
            value={appSettings.appearance.colorScheme}
          />
        </SettingsRow>

        <SettingsRow rowId="appearance.syntaxTheme">
          <SettingsSelect
            onChange={(value) => {
              if (!isSyntaxThemeId(value)) return;

              updateAppearance({ syntaxTheme: value });
            }}
            options={SYNTAX_THEME_OPTIONS}
            value={appSettings.appearance.syntaxTheme}
            width="md"
          />
        </SettingsRow>

        <SettingsRow rowId="appearance.agentThreadFontSize">
          <SettingsNumberField
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
      </SettingsSectionHeading>

      <SettingsSectionHeading title="Editor font">
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
          <SettingsNumberField
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
    </>
  );
}

interface MonospaceFontFamilies {
  readonly options: ReadonlyArray<string>;
  refresh(): void;
}

function useMonospaceFontFamilies(
  gateway: SystemFontGateway,
  currentFamily: string,
): MonospaceFontFamilies {
  const [loaded, setLoaded] = useState<ReadonlyArray<string>>([]);
  const requestRef = useRef(0);
  const options = useMemo(
    () => uniqueSortedStrings([...loaded, currentFamily]),
    [currentFamily, loaded],
  );

  const load = useCallback(async () => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;

    try {
      const families = await gateway.listMonospaceFontFamilies();

      if (requestRef.current !== requestId) return;

      setLoaded(uniqueSortedStrings(families));
    } catch {
      if (requestRef.current !== requestId) return;

      setLoaded([]);
    }
  }, [gateway]);

  useEffect(() => {
    void load();
  }, [load]);

  return { options, refresh: () => void load() };
}
