import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AGENT_APPEARANCE_VARIANTS,
  MAX_AGENT_THREAD_FONT_SIZE,
  MIN_AGENT_THREAD_FONT_SIZE,
  normalizeAgentThreadFontSize,
  type AgentAppearanceVariant,
} from "../../../domain/agentSettings";
import {
  appThemeOptions,
  maxEditorFontSize,
  minEditorFontSize,
  normalizeEditorFontFamily,
  normalizeEditorFontSize,
  type AppTheme,
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
import type { SettingsPageProps } from "../settingsPageProps";
import { ThemeSwatches } from "./ThemeSwatches";

const AGENT_APPEARANCE_LABELS: Readonly<Record<AgentAppearanceVariant, string>> = {
  current: "Current",
  graphite: "Graphite",
  paper: "Paper",
  studio: "Studio",
};

const AGENT_APPEARANCE_OPTIONS = AGENT_APPEARANCE_VARIANTS.map((variant) => ({
  value: variant,
  label: AGENT_APPEARANCE_LABELS[variant],
}));

const THEME_OPTIONS = appThemeOptions.map((theme) => ({ value: theme.id, label: theme.label }));

export function AppearanceSettingsPage({ actions, draft, env }: SettingsPageProps) {
  const appSettings = draft.appSettings;
  const fonts = useMonospaceFontFamilies(env.systemFontGateway, appSettings.editorFontFamily);
  const changeTheme = (theme: AppTheme): void =>
    actions.updateAppSettings({ ...appSettings, theme });

  return (
    <>
      <SettingsSectionHeading title="Appearance">
        <SettingsRow layout="stacked" rowId="appearance.theme">
          <div className="settings-theme">
            <SettingsSelect
              onChange={(value) => {
                if (!isAppTheme(value)) return;

                changeTheme(value);
              }}
              options={THEME_OPTIONS}
              value={appSettings.theme}
              width="md"
            />
            <ThemeSwatches onChange={changeTheme} value={appSettings.theme} />
          </div>
        </SettingsRow>

        <SettingsRow rowId="appearance.agentAppearance">
          <SettingsSegmented
            onChange={(value) => {
              if (!isAgentAppearanceVariant(value)) return;

              actions.updateAppSettings({ ...appSettings, agentAppearanceVariant: value });
            }}
            options={AGENT_APPEARANCE_OPTIONS}
            value={appSettings.agentAppearanceVariant}
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

function isAppTheme(value: string): value is AppTheme {
  return appThemeOptions.some((theme) => theme.id === value);
}

function isAgentAppearanceVariant(value: string): value is AgentAppearanceVariant {
  return AGENT_APPEARANCE_VARIANTS.some((variant) => variant === value);
}
