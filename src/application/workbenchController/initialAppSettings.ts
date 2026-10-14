import { defaultAppSettings, type AppSettings, type SettingsGateway } from "../../domain/settings";
import { DEFAULT_WINDOW_ZOOM_LEVEL, normalizeWindowZoomLevel } from "../../domain/windowZoom";

type InitialSettingsSource = Pick<
  SettingsGateway,
  "readInitialAppearance" | "readInitialWindowZoomLevel"
>;

export function initialAppSettings(settingsGateway: InitialSettingsSource): AppSettings {
  const defaults = defaultAppSettings();
  return {
    ...defaults,
    appearance: settingsGateway.readInitialAppearance?.() ?? defaults.appearance,
    windowZoomLevel: readInitialWindowZoomLevel(settingsGateway),
  };
}

export function initialAppSettingsFrom(settingsGateway: InitialSettingsSource): () => AppSettings {
  return () => initialAppSettings(settingsGateway);
}

function readInitialWindowZoomLevel(settingsGateway: InitialSettingsSource): number {
  try {
    return normalizeWindowZoomLevel(settingsGateway.readInitialWindowZoomLevel?.());
  } catch {
    return DEFAULT_WINDOW_ZOOM_LEVEL;
  }
}
