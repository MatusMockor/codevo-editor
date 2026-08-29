import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  appThemeOptions,
  maxEditorFontSize,
  minEditorFontSize,
  type AppSettings,
  type AppTheme,
} from "../domain/settings";
import type { SystemFontGateway } from "../domain/systemFonts";
import { uniqueSortedStrings } from "./settingsDialogValues";

export interface AppearanceSettingsProps {
  appSettings: AppSettings;
  systemFontGateway: SystemFontGateway;
  onChangeEditorFontFamily(value: string): void;
  onChangeEditorFontLigatures(enabled: boolean): void;
  onChangeEditorFontSize(value: number): void;
  onChangeMinimapEnabled(enabled: boolean): void;
  onChangeTheme(theme: AppTheme): void;
  onChangeWordWrapEnabled(enabled: boolean): void;
}

export function AppearanceSettings({
  appSettings,
  systemFontGateway,
  onChangeEditorFontFamily,
  onChangeEditorFontLigatures,
  onChangeEditorFontSize,
  onChangeMinimapEnabled,
  onChangeTheme,
  onChangeWordWrapEnabled,
}: AppearanceSettingsProps) {
  const [fontFamilyOptions, setFontFamilyOptions] = useState<string[]>([]);
  const fontFamilyLoadRequestRef = useRef(0);
  const visibleFontFamilyOptions = useMemo(
    () => uniqueSortedStrings([...fontFamilyOptions, appSettings.editorFontFamily]),
    [appSettings.editorFontFamily, fontFamilyOptions],
  );

  const loadInstalledFonts = useCallback(async () => {
    const requestId = fontFamilyLoadRequestRef.current + 1;
    fontFamilyLoadRequestRef.current = requestId;
    try {
      const localFamilies = await systemFontGateway.listMonospaceFontFamilies();
      if (fontFamilyLoadRequestRef.current !== requestId) return;
      setFontFamilyOptions(uniqueSortedStrings(localFamilies));
    } catch {
      if (fontFamilyLoadRequestRef.current !== requestId) return;
      setFontFamilyOptions([]);
    }
  }, [systemFontGateway]);

  useEffect(() => {
    void loadInstalledFonts();
  }, [loadInstalledFonts]);

  return (
    <div className="settings-group">
      <label className="settings-field">
        <span>Theme</span>
        <select
          onChange={(event) => onChangeTheme(event.currentTarget.value as AppTheme)}
          value={appSettings.theme}
        >
          {appThemeOptions.map((theme) => (
            <option key={theme.id} value={theme.id}>
              {theme.label}
            </option>
          ))}
        </select>
      </label>
      <label className="settings-field">
        <span>Font family</span>
        <select
          onChange={(event) => onChangeEditorFontFamily(event.currentTarget.value)}
          value={appSettings.editorFontFamily}
        >
          {visibleFontFamilyOptions.map((fontFamily) => (
            <option key={fontFamily} value={fontFamily}>
              {fontFamily}
            </option>
          ))}
        </select>
      </label>
      <div className="settings-actions">
        <button onClick={() => void loadInstalledFonts()} type="button">
          Refresh fonts
        </button>
      </div>
      <label className="settings-field">
        <span>Font size</span>
        <input
          max={maxEditorFontSize}
          min={minEditorFontSize}
          onChange={(event) => onChangeEditorFontSize(event.currentTarget.valueAsNumber)}
          type="number"
          value={appSettings.editorFontSize}
        />
      </label>
      <label className="settings-toggle">
        <input
          checked={appSettings.editorFontLigatures}
          onChange={(event) => onChangeEditorFontLigatures(event.currentTarget.checked)}
          type="checkbox"
        />
        <span>Font ligatures</span>
      </label>
      <label className="settings-toggle">
        <input
          checked={appSettings.minimapEnabled === true}
          onChange={(event) => onChangeMinimapEnabled(event.currentTarget.checked)}
          type="checkbox"
        />
        <span>Minimap</span>
      </label>
      <label className="settings-toggle">
        <input
          checked={appSettings.wordWrapEnabled === true}
          onChange={(event) => onChangeWordWrapEnabled(event.currentTarget.checked)}
          type="checkbox"
        />
        <span>Word wrap</span>
      </label>
    </div>
  );
}
