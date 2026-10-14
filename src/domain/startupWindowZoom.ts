import { persistedAppearanceIsReadable } from "./startupTheme";
import { DEFAULT_WINDOW_ZOOM_LEVEL, normalizeWindowZoomLevel } from "./windowZoom";

export function readPersistedWindowZoomLevel(rawSettings: string | null): number {
  if (rawSettings === null || !persistedAppearanceIsReadable(rawSettings)) {
    return DEFAULT_WINDOW_ZOOM_LEVEL;
  }

  try {
    const parsed: unknown = JSON.parse(rawSettings);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return DEFAULT_WINDOW_ZOOM_LEVEL;
    }
    return normalizeWindowZoomLevel((parsed as Record<string, unknown>).windowZoomLevel);
  } catch {
    return DEFAULT_WINDOW_ZOOM_LEVEL;
  }
}
