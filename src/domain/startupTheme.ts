export const STARTUP_APP_SETTINGS_KEY = "editor.settings.app";
export const STARTUP_THEME_ATTRIBUTE = "data-startup-theme";
export const MAX_STARTUP_SETTINGS_LENGTH = 512 * 1024;

const startupThemeIds = [
  "dark",
  "light",
  "system",
  "ayuMirage",
  "materialDeepOcean",
  "oneDarkPro",
  "dracula",
  "catppuccinMocha",
  "catppuccinLatte",
  "oneLight",
  "darkPlus",
] as const;

export type StartupThemeId = (typeof startupThemeIds)[number];
export type StartupSurfaceTheme = Exclude<StartupThemeId, "system">;

export const STARTUP_THEME_IDS: readonly StartupThemeId[] = startupThemeIds;
export const FALLBACK_STARTUP_THEME: StartupSurfaceTheme = "dark";

export function resolveStartupTheme(
  rawSettings: string | null,
  prefersLight: boolean,
): StartupSurfaceTheme {
  return startupThemeFor(readPersistedStartupTheme(rawSettings), prefersLight);
}

export function startupThemeFor(
  theme: StartupThemeId | null,
  prefersLight: boolean,
): StartupSurfaceTheme {
  if (theme === null) {
    return FALLBACK_STARTUP_THEME;
  }

  if (theme !== "system") {
    return theme;
  }

  if (prefersLight) {
    return "light";
  }

  return FALLBACK_STARTUP_THEME;
}

export function readPersistedStartupTheme(rawSettings: string | null): StartupThemeId | null {
  if (rawSettings === null) {
    return null;
  }

  if (rawSettings.length > MAX_STARTUP_SETTINGS_LENGTH) {
    return null;
  }

  const parsed = parseStartupSettings(rawSettings);
  if (parsed === null) {
    return null;
  }

  const theme = parsed.theme;
  if (!isStartupThemeId(theme)) {
    return null;
  }

  return theme;
}

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

function isStartupThemeId(value: unknown): value is StartupThemeId {
  return startupThemeIds.some((id) => id === value);
}
