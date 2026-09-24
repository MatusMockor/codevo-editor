import { describe, expect, it } from "vitest";
import { DEFAULT_APPEARANCE } from "./appearance";
import {
  MAX_STARTUP_SETTINGS_LENGTH,
  readPersistedAppearance,
  resolveStartupAppearance,
} from "./startupTheme";

describe("resolveStartupAppearance", () => {
  function raw(value: unknown): string {
    return JSON.stringify({ editorFontSize: 13, ...(value as object) });
  }

  it("stamps the persisted palette and resolves the chrome scheme", () => {
    const settings = raw({
      appearance: { palette: "zinc-orange", colorScheme: "system", syntaxTheme: "dracula" },
    });

    expect(resolveStartupAppearance(settings, true)).toEqual({
      palette: "zinc-orange",
      colorScheme: "light",
    });
    expect(resolveStartupAppearance(settings, false)).toEqual({
      palette: "zinc-orange",
      colorScheme: "dark",
    });
  });

  it("migrates a legacy light theme before the app has saved an appearance", () => {
    expect(resolveStartupAppearance(raw({ theme: "catppuccinLatte" }), false)).toEqual({
      palette: "graphite-teal",
      colorScheme: "light",
    });
  });

  it("falls closed to the default appearance for missing, oversized and malformed settings", () => {
    expect(readPersistedAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(readPersistedAppearance("{")).toEqual(DEFAULT_APPEARANCE);
    expect(readPersistedAppearance("[]")).toEqual(DEFAULT_APPEARANCE);
    expect(readPersistedAppearance(`"${"x".repeat(MAX_STARTUP_SETTINGS_LENGTH)}"`)).toEqual(
      DEFAULT_APPEARANCE,
    );
    expect(resolveStartupAppearance(null, true)).toEqual({
      palette: "graphite-teal",
      colorScheme: "light",
    });
    expect(resolveStartupAppearance(null, false)).toEqual({
      palette: "graphite-teal",
      colorScheme: "dark",
    });
  });
});
