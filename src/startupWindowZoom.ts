import { STARTUP_APP_SETTINGS_KEY } from "./domain/startupTheme";
import { readPersistedWindowZoomLevel } from "./domain/startupWindowZoom";
import { DEFAULT_WINDOW_ZOOM_LEVEL } from "./domain/windowZoom";

export function readBrowserStartupWindowZoomLevel(): number {
  try {
    return readPersistedWindowZoomLevel(window.localStorage.getItem(STARTUP_APP_SETTINGS_KEY));
  } catch {
    return DEFAULT_WINDOW_ZOOM_LEVEL;
  }
}
