import { describe, expect, it } from "vitest";
import {
  appThemeOptions,
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
import { defaultKeymapSettings } from "./keymap";

describe("settings defaults", () => {
  it("creates app and workspace defaults", () => {
    expect(defaultAppSettings()).toEqual({
      keymap: defaultKeymapSettings(),
      recentWorkspacePath: null,
      runtimePolicy: "keepAlive",
      theme: "dark",
      workspaceTabs: [],
    });
    expect(defaultWorkspaceSettings()).toEqual({
      autoSave: true,
      autoSaveConfigured: true,
      extraIgnorePatterns: [],
      formatOnPaste: false,
      formatOnSave: false,
      intelligenceMode: "basic",
      intelephensePath: null,
      javaScriptTypeScriptAutoImports: true,
      javaScriptTypeScriptCodeLens: false,
      javaScriptTypeScriptInlayHints: true,
      javaScriptTypeScriptService: "auto",
      javaScriptTypeScriptValidation: true,
      javaScriptTypeScriptVersion: "bundled",
      phpBackend: "auto",
      phpVersionOverride: null,
      phpactorPath: null,
      revealActiveFileInTree: true,
      session: {
        activePath: null,
        bottomPanelView: "problems",
        openPaths: [],
        sidebarView: "files",
      },
      statusBar: {
        activePath: true,
        dirtyCount: true,
        index: true,
        language: true,
        languageServer: true,
        message: true,
        mode: true,
        workspaceInfo: true,
        workspaceTrust: true,
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
      keymap: defaultKeymapSettings(),
      recentWorkspacePath: "/project",
      runtimePolicy: "keepAlive",
      theme: "dark",
      workspaceTabs: ["/project"],
    });
    expect(
      normalizeAppSettings({
        keymap: { "editor.save": "Cmd+Shift+S" },
        recentWorkspacePath: null,
        runtimePolicy: "suspendOnBackground",
        theme: "light",
        workspaceTabs: ["/project-a", " /project-b ", "/project-a", 42],
      }),
    ).toEqual({
      keymap: {
        ...defaultKeymapSettings(),
        "editor.save": "Cmd+Shift+S",
      },
      recentWorkspacePath: null,
      runtimePolicy: "suspendOnBackground",
      theme: "light",
      workspaceTabs: ["/project-a", "/project-b"],
    });
    expect(
      normalizeAppSettings({
        recentWorkspacePath: null,
        theme: "ayuMirage",
      }),
    ).toEqual({
      keymap: defaultKeymapSettings(),
      recentWorkspacePath: null,
      runtimePolicy: "keepAlive",
      theme: "ayuMirage",
      workspaceTabs: [],
    });
  });

  it("deduplicates workspace tabs by normalized root key", () => {
    expect(
      normalizeAppSettings({
        recentWorkspacePath: "/project/api",
        workspaceTabs: ["/project/api/", "/project/web", "/project/api"],
      }),
    ).toEqual({
      keymap: defaultKeymapSettings(),
      recentWorkspacePath: "/project/api",
      runtimePolicy: "keepAlive",
      theme: "dark",
      workspaceTabs: ["/project/api/", "/project/web"],
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
        formatOnPaste: true,
        formatOnSave: true,
        intelligenceMode: "lightSmart",
        intelephensePath: "/tools/intelephense",
        javaScriptTypeScriptAutoImports: false,
        javaScriptTypeScriptCodeLens: true,
        javaScriptTypeScriptInlayHints: false,
        javaScriptTypeScriptService: "off",
        javaScriptTypeScriptValidation: false,
        javaScriptTypeScriptVersion: "workspace",
        phpBackend: "phpactor",
        phpVersionOverride: "8.3",
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
        statusBar: {
          activePath: true,
          dirtyCount: false,
          index: false,
          language: true,
          languageServer: true,
          message: true,
          mode: false,
          workspaceInfo: false,
          workspaceTrust: true,
        },
      }),
    ).toEqual({
      autoSave: true,
      autoSaveConfigured: true,
      extraIgnorePatterns: ["vendor/generated", "var/cache"],
      formatOnPaste: true,
      formatOnSave: true,
      intelligenceMode: "lightSmart",
      intelephensePath: "/tools/intelephense",
      javaScriptTypeScriptAutoImports: false,
      javaScriptTypeScriptCodeLens: true,
      javaScriptTypeScriptInlayHints: false,
      javaScriptTypeScriptService: "off",
      javaScriptTypeScriptValidation: false,
      javaScriptTypeScriptVersion: "workspace",
      phpBackend: "phpactor",
      phpVersionOverride: "8.3",
      phpactorPath: "/tools/phpactor",
      revealActiveFileInTree: false,
      session: {
        activePath: "/project/src/User.php",
        bottomPanelView: "index",
        openPaths: ["/project/src/User.php", "/project/README.md"],
        sidebarView: "git",
      },
      statusBar: {
        activePath: true,
        dirtyCount: false,
        index: false,
        language: true,
        languageServer: true,
        message: true,
        mode: false,
        workspaceInfo: false,
        workspaceTrust: true,
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

  it("defaults formatOnSave to false and ignores non-boolean values", () => {
    expect(normalizeWorkspaceSettings({}).formatOnSave).toBe(false);
    expect(
      normalizeWorkspaceSettings({ formatOnSave: "yes" }).formatOnSave,
    ).toBe(false);
    expect(
      normalizeWorkspaceSettings({ formatOnSave: true }).formatOnSave,
    ).toBe(true);
  });

  it("defaults formatOnPaste to false and ignores non-boolean values", () => {
    expect(normalizeWorkspaceSettings({}).formatOnPaste).toBe(false);
    expect(
      normalizeWorkspaceSettings({ formatOnPaste: "yes" }).formatOnPaste,
    ).toBe(false);
    expect(
      normalizeWorkspaceSettings({ formatOnPaste: true }).formatOnPaste,
    ).toBe(true);
  });

  it("falls back for invalid workspace settings", () => {
    expect(
      normalizeWorkspaceSettings({
        extraIgnorePatterns: ["var/cache", 4],
        intelligenceMode: "unknown",
        javaScriptTypeScriptService: "manual",
        javaScriptTypeScriptVersion: "manual",
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
    expect(monacoThemeForAppTheme("light")).toBe("calm-light");
    expect(monacoThemeForAppTheme("dark")).toBe("calm-dark");
    expect(monacoThemeForAppTheme("system")).toBe("calm-dark");
    expect(monacoThemeForAppTheme("system", true)).toBe("calm-light");
    expect(monacoThemeForAppTheme("ayuMirage")).toBe("ayu-mirage");
    expect(monacoThemeForAppTheme("materialDeepOcean")).toBe(
      "material-deep-ocean",
    );
    expect(monacoThemeForAppTheme("oneDarkPro")).toBe("one-dark-pro");
    expect(monacoThemeForAppTheme("dracula")).toBe("dracula");
    expect(monacoThemeForAppTheme("catppuccinMocha")).toBe("catppuccin-mocha");
    expect(monacoThemeForAppTheme("catppuccinLatte")).toBe("catppuccin-latte");
    expect(monacoThemeForAppTheme("oneLight")).toBe("one-light");
    expect(monacoThemeForAppTheme("darkPlus")).toBe("dark-plus");
  });
});

describe("appThemeOptions", () => {
  it("offers the VS Code Dark Plus theme", () => {
    const option = appThemeOptions.find((entry) => entry.id === "darkPlus");
    expect(option).toEqual({ id: "darkPlus", label: "Dark Plus (VS Code)" });
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
    expect(terminalThemeForAppTheme("darkPlus").background).toBe("#1e1e1e");
    expect(terminalThemeForAppTheme("darkPlus").foreground).toBe("#cccccc");
  });
});
