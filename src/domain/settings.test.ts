import { describe, expect, it } from "vitest";
import {
  appThemeOptions,
  defaultAppSettings,
  defaultEditorFontSize,
  defaultWorkspaceSessionState,
  defaultWorkspaceSettings,
  maxEditorFontSize,
  minEditorFontSize,
  monacoThemeForAppTheme,
  monacoFontLigaturesForEditorSetting,
  normalizeAppSettings,
  normalizeEditorFontSize,
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
      editorFontFamily:
        "JetBrains Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      editorFontLigatures: false,
      editorFontSize: 14,
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
      formatOnPaste: true,
      formatOnSave: true,
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
      editorFontFamily:
        "JetBrains Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      editorFontLigatures: false,
      editorFontSize: 14,
      keymap: defaultKeymapSettings(),
      recentWorkspacePath: "/project",
      runtimePolicy: "keepAlive",
      theme: "dark",
      workspaceTabs: ["/project"],
    });
    expect(
      normalizeAppSettings({
        editorFontFamily: "Fira Code",
        editorFontLigatures: true,
        editorFontSize: 18,
        keymap: { "editor.save": "Cmd+Shift+S" },
        recentWorkspacePath: null,
        runtimePolicy: "suspendOnBackground",
        theme: "light",
        workspaceTabs: ["/project-a", " /project-b ", "/project-a", 42],
      }),
    ).toEqual({
      editorFontFamily: "Fira Code",
      editorFontLigatures: true,
      editorFontSize: 18,
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
      editorFontFamily:
        "JetBrains Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      editorFontLigatures: false,
      editorFontSize: 14,
      keymap: defaultKeymapSettings(),
      recentWorkspacePath: null,
      runtimePolicy: "keepAlive",
      theme: "ayuMirage",
      workspaceTabs: [],
    });
  });

  it("clamps and falls back persisted editor font size", () => {
    expect(normalizeAppSettings({ editorFontSize: 100 }).editorFontSize).toBe(
      maxEditorFontSize,
    );
    expect(normalizeAppSettings({ editorFontSize: 2 }).editorFontSize).toBe(
      minEditorFontSize,
    );
    expect(normalizeAppSettings({ editorFontSize: 16.7 }).editorFontSize).toBe(
      16,
    );
    expect(
      normalizeAppSettings({ editorFontSize: "20" }).editorFontSize,
    ).toBe(defaultEditorFontSize);
    expect(
      normalizeAppSettings({ editorFontSize: Number.NaN }).editorFontSize,
    ).toBe(defaultEditorFontSize);
  });

  it("falls back persisted editor font family and ligatures when invalid", () => {
    expect(
      normalizeAppSettings({
        editorFontFamily: "  ",
        editorFontLigatures: "true",
      }),
    ).toEqual({
      editorFontFamily:
        "JetBrains Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      editorFontLigatures: false,
      editorFontSize: 14,
      keymap: defaultKeymapSettings(),
      recentWorkspacePath: null,
      runtimePolicy: "keepAlive",
      theme: "dark",
      workspaceTabs: [],
    });
    expect(
      normalizeAppSettings({
        editorFontFamily: 42,
        editorFontLigatures: true,
      }).editorFontFamily,
    ).toBe(
      "JetBrains Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    );
  });

  it("normalizes editor font family case for known aliases", () => {
    expect(
      normalizeAppSettings({ editorFontFamily: "fira code" }).editorFontFamily,
    ).toBe("Fira Code");
  });

  it("deduplicates workspace tabs by normalized root key", () => {
    expect(
      normalizeAppSettings({
        recentWorkspacePath: "/project/api",
        workspaceTabs: ["/project/api/", "/project/web", "/project/api"],
      }),
    ).toEqual({
      editorFontFamily:
        "JetBrains Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      editorFontLigatures: false,
      editorFontSize: 14,
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

describe("monacoFontLigaturesForEditorSetting", () => {
  it("maps the boolean app setting to explicit Monaco font feature settings", () => {
    expect(monacoFontLigaturesForEditorSetting(true)).toBe(
      '"liga" on, "calt" on',
    );
    expect(monacoFontLigaturesForEditorSetting(false)).toBe(
      '"liga" off, "calt" off',
    );
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

  it("defaults formatOnSave to true and respects explicit boolean values", () => {
    expect(normalizeWorkspaceSettings({}).formatOnSave).toBe(true);
    expect(
      normalizeWorkspaceSettings({ formatOnSave: "yes" }).formatOnSave,
    ).toBe(true);
    expect(
      normalizeWorkspaceSettings({ formatOnSave: false }).formatOnSave,
    ).toBe(false);
    expect(
      normalizeWorkspaceSettings({ formatOnSave: true }).formatOnSave,
    ).toBe(true);
  });

  it("defaults formatOnPaste to true and respects explicit boolean values", () => {
    expect(normalizeWorkspaceSettings({}).formatOnPaste).toBe(true);
    expect(
      normalizeWorkspaceSettings({ formatOnPaste: "yes" }).formatOnPaste,
    ).toBe(true);
    expect(
      normalizeWorkspaceSettings({ formatOnPaste: false }).formatOnPaste,
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

describe("normalizeEditorFontSize", () => {
  it("clamps to the supported font size range and rounds to whole pixels", () => {
    expect(defaultEditorFontSize).toBe(14);
    expect(minEditorFontSize).toBe(8);
    expect(maxEditorFontSize).toBe(40);
    expect(normalizeEditorFontSize(14)).toBe(14);
    expect(normalizeEditorFontSize(7)).toBe(minEditorFontSize);
    expect(normalizeEditorFontSize(999)).toBe(maxEditorFontSize);
    expect(normalizeEditorFontSize(15.9)).toBe(15);
  });

  it("falls back to the default for invalid values", () => {
    expect(normalizeEditorFontSize("16")).toBe(defaultEditorFontSize);
    expect(normalizeEditorFontSize(undefined)).toBe(defaultEditorFontSize);
    expect(normalizeEditorFontSize(null)).toBe(defaultEditorFontSize);
    expect(normalizeEditorFontSize(Number.NaN)).toBe(defaultEditorFontSize);
    expect(normalizeEditorFontSize(Number.POSITIVE_INFINITY)).toBe(
      defaultEditorFontSize,
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

  it("offers the Ayu Mirage theme", () => {
    const option = appThemeOptions.find((entry) => entry.id === "ayuMirage");
    expect(option).toEqual({ id: "ayuMirage", label: "Ayu Mirage" });
  });

  it("maps Ayu Mirage to the bundled official Shiki theme", () => {
    expect(monacoThemeForAppTheme("ayuMirage")).toBe("ayu-mirage");
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
