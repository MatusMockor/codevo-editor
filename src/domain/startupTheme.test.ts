import { describe, expect, it } from "vitest";
import { appThemeOptions } from "./settings";
import {
  FALLBACK_STARTUP_THEME,
  MAX_STARTUP_SETTINGS_LENGTH,
  readPersistedStartupTheme,
  resolveStartupTheme,
  STARTUP_THEME_IDS,
} from "./startupTheme";

function persisted(theme: unknown): string {
  return JSON.stringify({ editorFontSize: 13, theme });
}

describe("startup theme ids", () => {
  it("stays in step with the persisted app theme union", () => {
    expect([...STARTUP_THEME_IDS].sort()).toEqual(
      appThemeOptions.map((option) => option.id).sort(),
    );
  });

  it("falls closed to the persisted default theme", () => {
    expect(FALLBACK_STARTUP_THEME).toBe("dark");
  });
});

describe("resolveStartupTheme", () => {
  it("keeps every known concrete theme", () => {
    for (const id of STARTUP_THEME_IDS) {
      if (id === "system") continue;
      expect(resolveStartupTheme(persisted(id), false), id).toBe(id);
      expect(resolveStartupTheme(persisted(id), true), id).toBe(id);
    }
  });

  it("resolves system against the reported colour scheme", () => {
    expect(resolveStartupTheme(persisted("system"), true)).toBe("light");
    expect(resolveStartupTheme(persisted("system"), false)).toBe("dark");
  });

  it("falls closed to dark when nothing is persisted", () => {
    expect(resolveStartupTheme(null, false)).toBe("dark");
    expect(resolveStartupTheme(null, true)).toBe("dark");
  });

  it("falls closed to dark on malformed json", () => {
    expect(resolveStartupTheme("{", true)).toBe("dark");
    expect(resolveStartupTheme("", true)).toBe("dark");
    expect(resolveStartupTheme("null", true)).toBe("dark");
    expect(resolveStartupTheme('"dark"', true)).toBe("dark");
    expect(resolveStartupTheme('["light"]', true)).toBe("dark");
  });

  it("falls closed to dark on an unknown or absent theme", () => {
    expect(resolveStartupTheme(persisted("solarized"), true)).toBe("dark");
    expect(resolveStartupTheme(persisted(7), true)).toBe("dark");
    expect(resolveStartupTheme(persisted(null), true)).toBe("dark");
    expect(resolveStartupTheme("{}", true)).toBe("dark");
    expect(resolveStartupTheme('{"theme":{"id":"light"}}', true)).toBe("dark");
  });

  it("never resolves to a value the startup stylesheet cannot tone", () => {
    const cases = [null, "{", "{}", persisted("light"), persisted("system"), persisted("nope")];
    for (const raw of cases) {
      const resolved = resolveStartupTheme(raw, true);
      expect(STARTUP_THEME_IDS).toContain(resolved);
      expect(resolved).not.toBe("system");
    }
  });

  it("rejects an oversized payload before parsing it", () => {
    const oversized = `${" ".repeat(MAX_STARTUP_SETTINGS_LENGTH)}${persisted("light")}`;
    expect(oversized.length).toBeGreaterThan(MAX_STARTUP_SETTINGS_LENGTH);
    expect(resolveStartupTheme(oversized, false)).toBe("dark");
    expect(readPersistedStartupTheme(oversized)).toBeNull();
  });
});
