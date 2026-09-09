import {
  resolveStartupTheme,
  STARTUP_APP_SETTINGS_KEY,
  STARTUP_THEME_ATTRIBUTE,
} from "./domain/startupTheme";

export interface StartupThemeEnvironment {
  readonly prefersLight: () => boolean;
  readonly readSetting: (key: string) => string | null;
  readonly setThemeAttribute: (name: string, value: string) => void;
}

export function applyStartupTheme(environment: StartupThemeEnvironment): void {
  const rawSettings = readSettingSafely(environment);
  const prefersLight = prefersLightSafely(environment);
  environment.setThemeAttribute(
    STARTUP_THEME_ATTRIBUTE,
    resolveStartupTheme(rawSettings, prefersLight),
  );
}

export function applyBrowserStartupTheme(): void {
  try {
    applyStartupTheme(browserStartupThemeEnvironment());
  } catch {
    return;
  }
}

export function browserStartupThemeEnvironment(): StartupThemeEnvironment {
  return {
    prefersLight: () => window.matchMedia("(prefers-color-scheme: light)").matches,
    readSetting: (key) => localStorage.getItem(key),
    setThemeAttribute: (name, value) => document.documentElement.setAttribute(name, value),
  };
}

function readSettingSafely(environment: StartupThemeEnvironment): string | null {
  try {
    const value = environment.readSetting(STARTUP_APP_SETTINGS_KEY);
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

function prefersLightSafely(environment: StartupThemeEnvironment): boolean {
  try {
    return environment.prefersLight() === true;
  } catch {
    return false;
  }
}
