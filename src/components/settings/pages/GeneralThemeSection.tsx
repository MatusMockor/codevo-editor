import { usePrefersLightTheme } from "../../../application/usePrefersLightTheme";
import {
  COLOR_SCHEME_LABELS,
  COLOR_SCHEME_PREFERENCES,
  resolveColorScheme,
  type AppearanceSettings,
} from "../../../domain/appearance";
import { SegmentedControl } from "../../../ui/foundation/SegmentedControl";
import { SettingsSectionHeading } from "../primitives/SettingsSectionHeading";
import type { SettingsPageProps } from "../settingsPageProps";
import { useSettingsRowTarget } from "../settingsTargetContext";
import { AppearancePaletteSwatches } from "./AppearancePaletteSwatches";

const MODE_OPTIONS = COLOR_SCHEME_PREFERENCES.map((value) => ({
  value,
  label: COLOR_SCHEME_LABELS[value],
}));

export function GeneralThemeSection({ actions, draft }: SettingsPageProps) {
  const appSettings = draft.appSettings;
  const prefersLight = usePrefersLightTheme();
  const scheme = resolveColorScheme(appSettings.appearance.colorScheme, prefersLight);
  const modeRef = useSettingsRowTarget("appearance.colorScheme");
  const paletteRef = useSettingsRowTarget("appearance.palette");
  const update = (patch: Partial<AppearanceSettings>): void =>
    actions.updateAppSettings({
      ...appSettings,
      appearance: { ...appSettings.appearance, ...patch },
    });

  return (
    <SettingsSectionHeading
      actions={
        <div
          className="settings-theme__mode"
          data-settings-row="appearance.colorScheme"
          ref={modeRef}
          tabIndex={-1}
        >
          <SegmentedControl
            label="Appearance mode"
            onChange={(colorScheme) => update({ colorScheme })}
            options={MODE_OPTIONS}
            value={appSettings.appearance.colorScheme}
          />
        </div>
      }
      bare
      title="Theme"
    >
      <div
        className="settings-theme__palettes"
        data-settings-row="appearance.palette"
        ref={paletteRef}
        tabIndex={-1}
      >
        <AppearancePaletteSwatches
          onChange={(palette) => update({ palette })}
          scheme={scheme}
          value={appSettings.appearance.palette}
        />
      </div>
    </SettingsSectionHeading>
  );
}
