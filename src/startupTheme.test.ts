import { describe, expect, it } from "vitest";
import { STARTUP_APP_SETTINGS_KEY, STARTUP_THEME_ATTRIBUTE } from "./domain/startupTheme";
import { APP_SETTINGS_KEY } from "./infrastructure/browserSettingsGateway";
import { applyStartupTheme, type StartupThemeEnvironment } from "./startupTheme";

interface Applied {
  readonly attributes: Record<string, string>;
  readonly requestedKeys: readonly string[];
}

function apply(environment: Partial<StartupThemeEnvironment>): Applied {
  const attributes: Record<string, string> = {};
  const requestedKeys: string[] = [];
  applyStartupTheme({
    prefersLight: () => false,
    readSetting: (key) => {
      requestedKeys.push(key);
      return null;
    },
    setThemeAttribute: (name, value) => {
      attributes[name] = value;
    },
    ...environment,
  });
  return { attributes, requestedKeys };
}

describe("applyStartupTheme", () => {
  it("reads the same storage key the settings gateway persists", () => {
    expect(STARTUP_APP_SETTINGS_KEY).toBe(APP_SETTINGS_KEY);
    expect(apply({}).requestedKeys).toEqual([STARTUP_APP_SETTINGS_KEY]);
  });

  it("stamps the persisted theme on the document element", () => {
    const applied = apply({ readSetting: () => JSON.stringify({ theme: "dracula" }) });

    expect(applied.attributes[STARTUP_THEME_ATTRIBUTE]).toBe("dracula");
  });

  it("resolves the system theme through the reported colour scheme", () => {
    const raw = JSON.stringify({ theme: "system" });

    expect(apply({ prefersLight: () => true, readSetting: () => raw }).attributes).toEqual({
      [STARTUP_THEME_ATTRIBUTE]: "light",
    });
    expect(apply({ prefersLight: () => false, readSetting: () => raw }).attributes).toEqual({
      [STARTUP_THEME_ATTRIBUTE]: "dark",
    });
  });

  it("falls closed to dark when storage throws", () => {
    const applied = apply({
      readSetting: () => {
        throw new Error("storage disabled");
      },
    });

    expect(applied.attributes[STARTUP_THEME_ATTRIBUTE]).toBe("dark");
  });

  it("falls closed to dark when the colour-scheme query throws", () => {
    const applied = apply({
      prefersLight: () => {
        throw new Error("matchMedia unavailable");
      },
      readSetting: () => JSON.stringify({ theme: "system" }),
    });

    expect(applied.attributes[STARTUP_THEME_ATTRIBUTE]).toBe("dark");
  });

  it("falls closed to dark when storage returns a non-string", () => {
    const applied = apply({ readSetting: () => ({}) as unknown as string });

    expect(applied.attributes[STARTUP_THEME_ATTRIBUTE]).toBe("dark");
  });
});
