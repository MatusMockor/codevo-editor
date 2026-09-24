import { describe, expect, it } from "vitest";
import { COLOR_SCHEME_ATTRIBUTE, PALETTE_ATTRIBUTE } from "./domain/appearance";
import { STARTUP_APP_SETTINGS_KEY } from "./domain/startupTheme";
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
    setDocumentAttribute: (name, value) => {
      attributes[name] = value;
    },
    ...environment,
  });
  return { attributes, requestedKeys };
}

const DEFAULT_ATTRIBUTES = {
  [PALETTE_ATTRIBUTE]: "graphite-teal",
  [COLOR_SCHEME_ATTRIBUTE]: "dark",
};

describe("applyStartupTheme", () => {
  it("reads the same storage key the settings gateway persists", () => {
    expect(STARTUP_APP_SETTINGS_KEY).toBe(APP_SETTINGS_KEY);
    expect(apply({}).requestedKeys).toEqual([STARTUP_APP_SETTINGS_KEY]);
  });

  it("stamps the persisted palette and scheme on the document element", () => {
    const applied = apply({
      readSetting: () =>
        JSON.stringify({
          appearance: { palette: "ink-mint", colorScheme: "light", syntaxTheme: "matchPalette" },
        }),
    });

    expect(applied.attributes).toEqual({
      [PALETTE_ATTRIBUTE]: "ink-mint",
      [COLOR_SCHEME_ATTRIBUTE]: "light",
    });
  });

  it("resolves the system scheme through the reported colour scheme", () => {
    const raw = JSON.stringify({
      appearance: { palette: "slate-blue", colorScheme: "system", syntaxTheme: "matchPalette" },
    });

    expect(apply({ prefersLight: () => true, readSetting: () => raw }).attributes).toEqual({
      [PALETTE_ATTRIBUTE]: "slate-blue",
      [COLOR_SCHEME_ATTRIBUTE]: "light",
    });
    expect(apply({ prefersLight: () => false, readSetting: () => raw }).attributes).toEqual({
      [PALETTE_ATTRIBUTE]: "slate-blue",
      [COLOR_SCHEME_ATTRIBUTE]: "dark",
    });
  });

  it("falls closed to Graphite · Teal dark when storage throws", () => {
    const applied = apply({
      readSetting: () => {
        throw new Error("storage disabled");
      },
    });

    expect(applied.attributes).toEqual(DEFAULT_ATTRIBUTES);
  });

  it("follows the platform scheme for the system default when storage throws", () => {
    const applied = apply({
      prefersLight: () => true,
      readSetting: () => {
        throw new Error("storage disabled");
      },
    });

    expect(applied.attributes).toEqual({
      [PALETTE_ATTRIBUTE]: "graphite-teal",
      [COLOR_SCHEME_ATTRIBUTE]: "light",
    });
  });

  it("falls closed to dark when the colour-scheme query throws", () => {
    const applied = apply({
      prefersLight: () => {
        throw new Error("matchMedia unavailable");
      },
      readSetting: () => JSON.stringify({ theme: "system" }),
    });

    expect(applied.attributes).toEqual(DEFAULT_ATTRIBUTES);
  });

  it("falls closed when storage returns a non-string", () => {
    const applied = apply({ readSetting: () => ({}) as unknown as string });

    expect(applied.attributes).toEqual(DEFAULT_ATTRIBUTES);
  });
});

describe("applyStartupTheme result", () => {
  it("returns the resolved appearance it stamped on the document", () => {
    const stamped = new Map<string, string>();
    const appearance = applyStartupTheme({
      prefersLight: () => true,
      readSetting: () =>
        JSON.stringify({ appearance: { palette: "ink-mint", colorScheme: "system" } }),
      setDocumentAttribute: (name, value) => stamped.set(name, value),
    });

    expect(appearance).toEqual({ palette: "ink-mint", colorScheme: "light" });
    expect(stamped.get("data-cv-palette")).toBe("ink-mint");
    expect(stamped.get("data-cv-scheme")).toBe("light");
  });
});
