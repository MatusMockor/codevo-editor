import { describe, expect, it } from "vitest";
import {
  defaultAppSettings,
  defaultWorkspaceSettings,
  monacoThemeForAppTheme,
  normalizeAppSettings,
  normalizeWorkspaceSettings,
  resolveAppTheme,
  settingsIgnorePatternsFromText,
  settingsIgnorePatternsText,
} from "./settings";

describe("settings defaults", () => {
  it("creates app and workspace defaults", () => {
    expect(defaultAppSettings()).toEqual({
      recentWorkspacePath: null,
      theme: "dark",
    });
    expect(defaultWorkspaceSettings()).toEqual({
      extraIgnorePatterns: [],
      intelligenceMode: "basic",
      intelephensePath: null,
      phpBackend: "auto",
      phpactorPath: null,
    });
  });
});

describe("normalizeAppSettings", () => {
  it("accepts valid persisted app settings", () => {
    expect(normalizeAppSettings({ recentWorkspacePath: "/project" })).toEqual({
      recentWorkspacePath: "/project",
      theme: "dark",
    });
    expect(
      normalizeAppSettings({ recentWorkspacePath: null, theme: "light" }),
    ).toEqual({
      recentWorkspacePath: null,
      theme: "light",
    });
  });

  it("falls back for invalid app settings", () => {
    expect(normalizeAppSettings({ recentWorkspacePath: 1 })).toEqual(
      defaultAppSettings(),
    );
    expect(normalizeAppSettings(null)).toEqual(defaultAppSettings());
  });
});

describe("normalizeWorkspaceSettings", () => {
  it("accepts valid persisted workspace settings", () => {
    expect(
      normalizeWorkspaceSettings({
        extraIgnorePatterns: ["vendor/generated", " var/cache ", "var/cache"],
        intelligenceMode: "lightSmart",
        intelephensePath: "/tools/intelephense",
        phpBackend: "phpactor",
        phpactorPath: " /tools/phpactor ",
      }),
    ).toEqual({
      extraIgnorePatterns: ["vendor/generated", "var/cache"],
      intelligenceMode: "lightSmart",
      intelephensePath: "/tools/intelephense",
      phpBackend: "phpactor",
      phpactorPath: "/tools/phpactor",
    });
  });

  it("keeps old workspace settings compatible", () => {
    expect(
      normalizeWorkspaceSettings({ intelligenceMode: "lightSmart" }),
    ).toEqual({
      ...defaultWorkspaceSettings(),
      intelligenceMode: "lightSmart",
    });
  });

  it("falls back for invalid workspace settings", () => {
    expect(
      normalizeWorkspaceSettings({
        extraIgnorePatterns: ["var/cache", 4],
        intelligenceMode: "unknown",
        phpBackend: "unknown",
        phpactorPath: 10,
      }),
    ).toEqual({
      ...defaultWorkspaceSettings(),
      extraIgnorePatterns: ["var/cache"],
    });
    expect(normalizeWorkspaceSettings(null)).toEqual(defaultWorkspaceSettings());
  });
});

describe("settings ignore pattern text", () => {
  it("round trips trimmed unique patterns", () => {
    const patterns = settingsIgnorePatternsFromText(
      "vendor/generated\n\n var/cache \nvar/cache",
    );

    expect(patterns).toEqual(["vendor/generated", "var/cache"]);
    expect(settingsIgnorePatternsText(patterns)).toBe(
      "vendor/generated\nvar/cache",
    );
  });
});

describe("monacoThemeForAppTheme", () => {
  it("maps light theme to Monaco light and keeps dark themes dark", () => {
    expect(monacoThemeForAppTheme("light")).toBe("vs");
    expect(monacoThemeForAppTheme("dark")).toBe("vs-dark");
    expect(monacoThemeForAppTheme("system")).toBe("vs-dark");
    expect(monacoThemeForAppTheme("system", true)).toBe("vs");
  });
});

describe("resolveAppTheme", () => {
  it("resolves system from the current platform preference", () => {
    expect(resolveAppTheme("light", false)).toBe("light");
    expect(resolveAppTheme("dark", true)).toBe("dark");
    expect(resolveAppTheme("system", true)).toBe("light");
    expect(resolveAppTheme("system", false)).toBe("dark");
  });
});
