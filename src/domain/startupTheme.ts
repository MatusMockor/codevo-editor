import {
  DEFAULT_APPEARANCE,
  normalizeAppearance,
  resolveColorScheme,
  type AppearanceSettings,
  type PaletteId,
  type ResolvedColorScheme,
} from "./appearance";

export const STARTUP_APP_SETTINGS_KEY = "editor.settings.app";
export const MAX_STARTUP_SETTINGS_LENGTH = 512 * 1024;

function parseStartupSettings(rawSettings: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(rawSettings);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }

    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export interface DocumentAppearance {
  readonly palette: PaletteId;
  readonly colorScheme: ResolvedColorScheme;
}

export function persistedAppearanceIsReadable(rawSettings: string): boolean {
  return rawSettings.length <= MAX_STARTUP_SETTINGS_LENGTH;
}

export function readPersistedAppearance(rawSettings: string | null): AppearanceSettings {
  if (rawSettings === null) return DEFAULT_APPEARANCE;
  if (!persistedAppearanceIsReadable(rawSettings)) return DEFAULT_APPEARANCE;
  const parsed = parseStartupSettings(rawSettings);
  if (parsed === null) return DEFAULT_APPEARANCE;
  return normalizeAppearance(parsed.appearance, parsed.theme);
}

export function resolveStartupAppearance(
  rawSettings: string | null,
  prefersLight: boolean,
): DocumentAppearance {
  const appearance = readPersistedAppearance(rawSettings);
  return {
    palette: appearance.palette,
    colorScheme: resolveColorScheme(appearance.colorScheme, prefersLight),
  };
}
