import { COLOR_SCHEME_ATTRIBUTE, PALETTE_ATTRIBUTE } from "./domain/appearance";
import { resolveStartupAppearance, STARTUP_APP_SETTINGS_KEY } from "./domain/startupTheme";

export interface StartupThemeEnvironment {
  readonly prefersLight: () => boolean;
  readonly readSetting: (key: string) => string | null;
  readonly setDocumentAttribute: (name: string, value: string) => void;
}

export function applyStartupTheme(environment: StartupThemeEnvironment): void {
  const appearance = resolveStartupAppearance(
    readSettingSafely(environment),
    prefersLightSafely(environment),
  );
  environment.setDocumentAttribute(PALETTE_ATTRIBUTE, appearance.palette);
  environment.setDocumentAttribute(COLOR_SCHEME_ATTRIBUTE, appearance.colorScheme);
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
    setDocumentAttribute: (name, value) => document.documentElement.setAttribute(name, value),
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
