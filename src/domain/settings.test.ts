import { describe, expect, it } from "vitest";
import {
  defaultAppSettings,
  defaultWorkspaceSessionState,
  defaultWorkspaceSettings,
  monacoThemeForAppTheme,
  normalizeAppSettings,
  normalizeWorkspaceSession,
  normalizeWorkspaceSettings,
  resolveAppTheme,
  settingsIgnorePatternsFromText,
  settingsIgnorePatternsText,
  terminalThemeForAppTheme,
} from "./settings";

describe("settings defaults", () => {
  it("creates app and workspace defaults", () => {
    expect(defaultAppSettings()).toEqual({
      recentWorkspacePath: null,
      theme: "dark",
    });
    expect(defaultWorkspaceSettings()).toEqual({
      autoSave: true,
      autoSaveConfigured: true,
      extraIgnorePatterns: [],
      intelligenceMode: "basic",
      intelephensePath: null,
      phpBackend: "auto",
      phpactorPath: null,
      revealActiveFileInTree: true,
      session: {
        activePath: null,
        bottomPanelView: "problems",
        openPaths: [],
        sidebarView: "files",
      },
    });
    expect(defaultWorkspaceSessionState()).toEqual({
      activePath: null,
      bottomPanelView: "problems",
      openPaths: [],
      sidebarView: "files",
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
    expect(
      normalizeAppSettings({
        recentWorkspacePath: null,
        theme: "ayuMirage",
      }),
    ).toEqual({
      recentWorkspacePath: null,
      theme: "ayuMirage",
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
        autoSave: true,
        autoSaveConfigured: true,
        extraIgnorePatterns: ["vendor/generated", " var/cache ", "var/cache"],
        intelligenceMode: "lightSmart",
        intelephensePath: "/tools/intelephense",
        phpBackend: "phpactor",
        phpactorPath: " /tools/phpactor ",
        revealActiveFileInTree: false,
        session: {
          activePath: "/project/src/User.php",
          bottomPanelView: "index",
          openPaths: [
            "/project/src/User.php",
            "/project/src/User.php",
            " /project/README.md ",
          ],
          sidebarView: "git",
        },
      }),
    ).toEqual({
      autoSave: true,
      autoSaveConfigured: true,
      extraIgnorePatterns: ["vendor/generated", "var/cache"],
      intelligenceMode: "lightSmart",
      intelephensePath: "/tools/intelephense",
      phpBackend: "phpactor",
      phpactorPath: "/tools/phpactor",
      revealActiveFileInTree: false,
      session: {
        activePath: "/project/src/User.php",
        bottomPanelView: "index",
        openPaths: ["/project/src/User.php", "/project/README.md"],
        sidebarView: "git",
      },
    });
  });

  it("keeps old workspace settings compatible", () => {
    expect(
      normalizeWorkspaceSettings({ intelligenceMode: "lightSmart" }),
    ).toEqual({
      ...defaultWorkspaceSettings(),
      intelligenceMode: "lightSmart",
    });
    expect(
      normalizeWorkspaceSettings({
        autoSave: false,
        intelligenceMode: "basic",
      }).autoSave,
    ).toBe(true);
    expect(
      normalizeWorkspaceSettings({
        autoSave: false,
        autoSaveConfigured: true,
        intelligenceMode: "basic",
      }).autoSave,
    ).toBe(false);
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

describe("normalizeWorkspaceSession", () => {
  it("falls back for invalid layout values and inactive paths", () => {
    expect(
      normalizeWorkspaceSession({
        activePath: "/project/missing.php",
        bottomPanelView: "unknown",
        openPaths: ["/project/User.php", 12],
        sidebarView: "unknown",
      }),
    ).toEqual({
      activePath: null,
      bottomPanelView: "problems",
      openPaths: ["/project/User.php"],
      sidebarView: "files",
    });
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
    expect(monacoThemeForAppTheme("ayuMirage")).toBe("mockor-ayu-mirage");
    expect(monacoThemeForAppTheme("materialDeepOcean")).toBe(
      "mockor-material-deep-ocean",
    );
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

describe("terminalThemeForAppTheme", () => {
  it("maps app themes to terminal palettes", () => {
    expect(terminalThemeForAppTheme("dark").background).toBe("#111418");
    expect(terminalThemeForAppTheme("light").background).toBe("#f4f6f8");
    expect(terminalThemeForAppTheme("ayuMirage").background).toBe("#1f2430");
    expect(terminalThemeForAppTheme("materialDeepOcean").background).toBe(
      "#0f111a",
    );
    expect(terminalThemeForAppTheme("system", true).foreground).toBe("#263240");
    expect(terminalThemeForAppTheme("system", false).foreground).toBe("#d8dee9");
  });
});
