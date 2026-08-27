import { describe, expect, it } from "vitest";
import {
  appThemeOptions,
  defaultAppSettings,
  defaultEditorFontSize,
  defaultWorkspaceSessionState,
  defaultWorkspaceSettings,
  MAX_RECENT_WORKSPACE_PATHS,
  maxEditorFontSize,
  minEditorFontSize,
  monacoThemeForAppTheme,
  monacoFontLigaturesForEditorSetting,
  normalizeAppSettings,
  normalizeEditorFontSize,
  normalizeRecentWorkspacePaths,
  normalizeWorkspaceSession,
  normalizeWorkspaceSettings,
  pushRecentWorkspacePath,
  resolveAppTheme,
  settingsIgnorePatternsFromText,
  settingsIgnorePatternsText,
  terminalThemeForAppTheme,
  WORKSPACE_SESSION_VERSION,
} from "./settings";
import { initialAgentWorkbenchLayout, serializeAgentWorkbenchLayout } from "./agentWorkbenchLayout";
import { defaultAgentProviderPreferences } from "./agentProviderSettings";
import { defaultKeymapSettings } from "./keymap";
import {
  LARGE_SMART_DOCUMENT_CHARACTER_LIMIT,
  LARGE_SMART_DOCUMENT_LINE_LIMIT,
  MIN_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT,
  MIN_LARGE_SMART_DOCUMENT_LINE_LIMIT,
  normalizeLargeSmartDocumentPolicy,
} from "./largeDocumentPolicy";

describe("settings defaults", () => {
  it("creates app and workspace defaults", () => {
    expect(defaultAppSettings()).toEqual({
      agentCliKind: "claudeCode",
      agentCliPaths: { claudeCode: null, codex: null },
      agentAppearanceVariant: "current",
      agentModelFavoriteKeys: [],
      agentModelFavoritesRevision: 0,
      agentProviderPreferences: defaultAgentProviderPreferences(),
      maxConcurrentAgentTasks: 4,
      editorFontFamily: "JetBrains Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      editorFontLigatures: false,
      editorFontSize: 14,
      minimapEnabled: false,
      keymap: defaultKeymapSettings(),
      recentWorkspacePath: null,
      recentWorkspacePaths: [],
      runtimePolicy: "keepAlive",
      terminalShellIntegrationEnabled: false,
      theme: "dark",
      wordWrapEnabled: false,
      userSnippets: [],
      workspaceTabs: [],
    });
    expect(defaultWorkspaceSettings()).toEqual({
      agentIsolationPolicy: "auto",
      autoSave: true,
      autoSaveConfigured: true,
      defaultInsertSpaces: true,
      defaultTabSize: 4,
      extraIgnorePatterns: [],
      eslintAnalyseOnSave: false,
      eslintFixOnSave: false,
      eslintPath: null,
      formatOnPaste: false,
      formatOnSave: false,
      gitCommitMessageHistory: [],
      gitDirectoryMappings: [],
      gitDirectoryMappingsAuto: true,
      intelligenceMode: "basic",
      intelephensePath: null,
      javaScriptTypeScriptAddMissingImportsOnSave: false,
      javaScriptTypeScriptAutoImports: true,
      javaScriptTypeScriptAutomaticTypeAcquisition: false,
      javaScriptTypeScriptCodeLens: false,
      javaScriptTypeScriptReferencesCodeLensOnAllFunctions: false,
      javaScriptTypeScriptCompleteFunctionCalls: false,
      javaScriptTypeScriptFixAllOnSave: false,
      javaScriptTypeScriptImportModuleSpecifierEnding: "auto",
      javaScriptTypeScriptImportModuleSpecifierPreference: "shortest",
      javaScriptTypeScriptInlayHints: true,
      javaScriptTypeScriptOrganizeImportsOnSave: false,
      javaScriptTypeScriptPreferTypeOnlyAutoImports: false,
      javaScriptTypeScriptQuotePreference: "auto",
      javaScriptTypeScriptRemoveUnusedOnSave: false,
      javaScriptTypeScriptService: "auto",
      javaScriptTypeScriptValidation: true,
      javaScriptTypeScriptVersion: "bundled",
      largeFileMode: {
        characterLimit: LARGE_SMART_DOCUMENT_CHARACTER_LIMIT,
        lineLimit: LARGE_SMART_DOCUMENT_LINE_LIMIT,
      },
      optimizeImportsOnSave: false,
      phpBackend: "auto",
      phpInlayHints: true,
      phpstanAnalyseOnSave: false,
      phpstanPath: null,
      phpVersionOverride: null,
      phpactorPath: null,
      prettierFormatOnSave: false,
      revealActiveFileInTree: true,
      session: {
        bottomPanelView: "problems",
        editor: {
          activeGroupId: "editor-main",
          groups: {
            "editor-main": { activePath: null, openPaths: [], previewPath: null },
          },
          layout: { groupId: "editor-main", kind: "group" },
        },
        sidebarView: "files",
        version: 1,
      },
      statusBar: {
        activePath: true,
        cursorPosition: true,
        dirtyCount: true,
        gitBranch: true,
        index: true,
        language: true,
        largeFileMode: true,
        languageServer: true,
        message: true,
        mode: true,
        workspaceInfo: true,
        workspaceTrust: true,
      },
    });
    expect(defaultWorkspaceSessionState()).toEqual({
      bottomPanelView: "problems",
      editor: {
        activeGroupId: "editor-main",
        groups: {
          "editor-main": { activePath: null, openPaths: [], previewPath: null },
        },
        layout: { groupId: "editor-main", kind: "group" },
      },
      sidebarView: "files",
      version: 1,
    });
  });
});

describe("normalizeAppSettings", () => {
  it("persists only normalized provider preferences", () => {
    expect(
      normalizeAppSettings({
        agentProviderPreferences: {
          claudeCode: {
            enabled: false,
            healthCheckIntervalSeconds: 0,
            checkForUpdates: true,
            dismissedUpdateVersion: "2.1.245",
          },
          codex: {
            enabled: true,
            healthCheckIntervalSeconds: 86_400,
            checkForUpdates: false,
            dismissedUpdateVersion: null,
          },
        },
      }).agentProviderPreferences,
    ).toEqual({
      claudeCode: {
        enabled: false,
        healthCheckIntervalSeconds: 0,
        checkForUpdates: true,
        dismissedUpdateVersion: "2.1.245",
      },
      codex: {
        enabled: true,
        healthCheckIntervalSeconds: 86_400,
        checkForUpdates: false,
        dismissedUpdateVersion: null,
      },
    });
  });

  it("drops runtime provider state and fails secret-bearing preferences closed", () => {
    const normalized = normalizeAppSettings({
      agentProviderPreferences: {
        claudeCode: {
          enabled: true,
          healthCheckIntervalSeconds: 300,
          checkForUpdates: false,
          dismissedUpdateVersion: null,
          auth: { kind: "signedIn", token: "secret" },
        },
        codex: {
          enabled: true,
          healthCheckIntervalSeconds: 300,
          checkForUpdates: false,
          dismissedUpdateVersion: null,
        },
      },
      agentProviderHealth: { token: "secret" },
    });
    expect(normalized.agentProviderPreferences).toEqual(defaultAgentProviderPreferences());
    expect(Object.prototype.hasOwnProperty.call(normalized, "agentProviderHealth")).toBe(false);
  });

  it("migrates a legacy CLI path without retaining a second runtime authority", () => {
    expect(
      normalizeAppSettings({ agentCliKind: "codex", agentCliPath: "/usr/local/bin/codex" }),
    ).toMatchObject({
      agentCliKind: "codex",
      agentCliPaths: { claudeCode: null, codex: "/usr/local/bin/codex" },
    });
    expect(
      Object.prototype.hasOwnProperty.call(
        normalizeAppSettings({ agentCliKind: "codex", agentCliPath: "/usr/local/bin/codex" }),
        "agentCliPath",
      ),
    ).toBe(false);
  });

  it("keeps both configured paths across provider switches and fails malformed records closed", () => {
    const paths = { claudeCode: "/usr/local/bin/claude", codex: "/usr/local/bin/codex" };
    expect(
      normalizeAppSettings({ agentCliKind: "claudeCode", agentCliPaths: paths }),
    ).toMatchObject({
      agentCliKind: "claudeCode",
      agentCliPaths: paths,
    });
    expect(normalizeAppSettings({ agentCliKind: "codex", agentCliPaths: paths })).toMatchObject({
      agentCliKind: "codex",
      agentCliPaths: paths,
    });
    expect(
      normalizeAppSettings({
        agentCliPaths: { claudeCode: "/usr/local/bin/claude", codex: "bin/codex" },
      }).agentCliPaths,
    ).toEqual({ claudeCode: null, codex: null });
  });

  it("round-trips a valid favorite revision and fails malformed revisions closed", () => {
    expect(
      normalizeAppSettings({
        agentModelFavoriteKeys: ["claudeCode/opus"],
        agentModelFavoritesRevision: 12,
      }).agentModelFavoritesRevision,
    ).toBe(12);
    for (const malformed of [-1, 1.5, "12", Number.POSITIVE_INFINITY, null]) {
      expect(
        normalizeAppSettings({
          agentModelFavoriteKeys: ["claudeCode/opus"],
          agentModelFavoritesRevision: malformed,
        }),
      ).toMatchObject({ agentModelFavoriteKeys: [], agentModelFavoritesRevision: 0 });
    }
  });
  it("round-trips a persisted word wrap setting", () => {
    expect(normalizeAppSettings({ wordWrapEnabled: true }).wordWrapEnabled).toBe(true);
    expect(normalizeAppSettings({ wordWrapEnabled: false }).wordWrapEnabled).toBe(false);
  });

  it("defaults a legacy app setting without word wrap state to false", () => {
    expect(normalizeAppSettings({}).wordWrapEnabled).toBe(false);
  });

  it("round-trips a persisted minimap setting", () => {
    expect(normalizeAppSettings({ minimapEnabled: true }).minimapEnabled).toBe(true);
    expect(normalizeAppSettings({ minimapEnabled: false }).minimapEnabled).toBe(false);
  });

  it("defaults a legacy app setting without minimap state to false", () => {
    expect(normalizeAppSettings({}).minimapEnabled).toBe(false);
  });

  it("accepts valid persisted app settings", () => {
    expect(normalizeAppSettings({ recentWorkspacePath: "/project" })).toEqual({
      agentCliKind: "claudeCode",
      agentCliPaths: { claudeCode: null, codex: null },
      agentAppearanceVariant: "current",
      agentModelFavoriteKeys: [],
      agentModelFavoritesRevision: 0,
      agentProviderPreferences: defaultAgentProviderPreferences(),
      maxConcurrentAgentTasks: 4,
      editorFontFamily: "JetBrains Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      editorFontLigatures: false,
      editorFontSize: 14,
      keymap: defaultKeymapSettings(),
      minimapEnabled: false,
      recentWorkspacePath: "/project",
      recentWorkspacePaths: ["/project"],
      runtimePolicy: "keepAlive",
      terminalShellIntegrationEnabled: false,
      theme: "dark",
      wordWrapEnabled: false,
      userSnippets: [],
      workspaceTabs: ["/project"],
    });
    expect(
      normalizeAppSettings({
        editorFontFamily: "Fira Code",
        editorFontLigatures: true,
        editorFontSize: 18,
        keymap: { "editor.save": "Cmd+Shift+S" },
        minimapEnabled: true,
        recentWorkspacePath: null,
        runtimePolicy: "suspendOnBackground",
        theme: "light",
        wordWrapEnabled: true,
        workspaceTabs: ["/project-a", " /project-b ", "/project-a", 42],
      }),
    ).toEqual({
      agentCliKind: "claudeCode",
      agentCliPaths: { claudeCode: null, codex: null },
      agentAppearanceVariant: "current",
      agentModelFavoriteKeys: [],
      agentModelFavoritesRevision: 0,
      agentProviderPreferences: defaultAgentProviderPreferences(),
      maxConcurrentAgentTasks: 4,
      editorFontFamily: "Fira Code, monospace",
      editorFontLigatures: true,
      editorFontSize: 18,
      keymap: {
        ...defaultKeymapSettings(),
        "editor.save": "Cmd+Shift+S",
      },
      minimapEnabled: true,
      recentWorkspacePath: null,
      recentWorkspacePaths: [],
      runtimePolicy: "suspendOnBackground",
      terminalShellIntegrationEnabled: false,
      theme: "light",
      wordWrapEnabled: true,
      userSnippets: [],
      workspaceTabs: ["/project-a", "/project-b"],
    });
    expect(
      normalizeAppSettings({
        recentWorkspacePath: null,
        theme: "ayuMirage",
      }),
    ).toEqual({
      agentCliKind: "claudeCode",
      agentCliPaths: { claudeCode: null, codex: null },
      agentAppearanceVariant: "current",
      agentModelFavoriteKeys: [],
      agentModelFavoritesRevision: 0,
      agentProviderPreferences: defaultAgentProviderPreferences(),
      maxConcurrentAgentTasks: 4,
      editorFontFamily: "JetBrains Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      editorFontLigatures: false,
      editorFontSize: 14,
      keymap: defaultKeymapSettings(),
      minimapEnabled: false,
      recentWorkspacePath: null,
      recentWorkspacePaths: [],
      runtimePolicy: "keepAlive",
      terminalShellIntegrationEnabled: false,
      theme: "ayuMirage",
      wordWrapEnabled: false,
      userSnippets: [],
      workspaceTabs: [],
    });
  });

  it("clamps and falls back persisted editor font size", () => {
    expect(normalizeAppSettings({ editorFontSize: 100 }).editorFontSize).toBe(maxEditorFontSize);
    expect(normalizeAppSettings({ editorFontSize: 2 }).editorFontSize).toBe(minEditorFontSize);
    expect(normalizeAppSettings({ editorFontSize: 16.7 }).editorFontSize).toBe(16);
    expect(normalizeAppSettings({ editorFontSize: "20" }).editorFontSize).toBe(
      defaultEditorFontSize,
    );
    expect(normalizeAppSettings({ editorFontSize: Number.NaN }).editorFontSize).toBe(
      defaultEditorFontSize,
    );
  });

  it("falls back persisted editor font family and ligatures when invalid", () => {
    expect(
      normalizeAppSettings({
        editorFontFamily: "  ",
        editorFontLigatures: "true",
      }),
    ).toEqual({
      agentCliKind: "claudeCode",
      agentCliPaths: { claudeCode: null, codex: null },
      agentAppearanceVariant: "current",
      agentModelFavoriteKeys: [],
      agentModelFavoritesRevision: 0,
      agentProviderPreferences: defaultAgentProviderPreferences(),
      maxConcurrentAgentTasks: 4,
      editorFontFamily: "JetBrains Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      editorFontLigatures: false,
      editorFontSize: 14,
      keymap: defaultKeymapSettings(),
      minimapEnabled: false,
      recentWorkspacePath: null,
      recentWorkspacePaths: [],
      runtimePolicy: "keepAlive",
      terminalShellIntegrationEnabled: false,
      theme: "dark",
      wordWrapEnabled: false,
      userSnippets: [],
      workspaceTabs: [],
    });
    expect(
      normalizeAppSettings({
        editorFontFamily: 42,
        editorFontLigatures: true,
      }).editorFontFamily,
    ).toBe("JetBrains Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace");
  });

  it("normalizes editor font family case for known aliases", () => {
    expect(normalizeAppSettings({ editorFontFamily: "fira code" }).editorFontFamily).toBe(
      "Fira Code, monospace",
    );
  });

  it("adds a monospace fallback for a single editor font family", () => {
    expect(normalizeAppSettings({ editorFontFamily: "Iosevka" }).editorFontFamily).toBe(
      "Iosevka, monospace",
    );
    expect(normalizeAppSettings({ editorFontFamily: "monospace" }).editorFontFamily).toBe(
      "monospace",
    );
    expect(
      normalizeAppSettings({
        editorFontFamily: "Iosevka, Fira Code",
      }).editorFontFamily,
    ).toBe("Iosevka, Fira Code");
  });

  it("deduplicates workspace tabs by normalized root key", () => {
    expect(
      normalizeAppSettings({
        recentWorkspacePath: "/project/api",
        workspaceTabs: ["/project/api/", "/project/web", "/project/api"],
      }),
    ).toEqual({
      agentCliKind: "claudeCode",
      agentCliPaths: { claudeCode: null, codex: null },
      agentAppearanceVariant: "current",
      agentModelFavoriteKeys: [],
      agentModelFavoritesRevision: 0,
      agentProviderPreferences: defaultAgentProviderPreferences(),
      maxConcurrentAgentTasks: 4,
      editorFontFamily: "JetBrains Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      editorFontLigatures: false,
      editorFontSize: 14,
      keymap: defaultKeymapSettings(),
      minimapEnabled: false,
      recentWorkspacePath: "/project/api",
      recentWorkspacePaths: ["/project/api"],
      runtimePolicy: "keepAlive",
      terminalShellIntegrationEnabled: false,
      theme: "dark",
      wordWrapEnabled: false,
      userSnippets: [],
      workspaceTabs: ["/project/api/", "/project/web"],
    });
  });

  it("seeds recent workspace paths from the legacy single path", () => {
    expect(
      normalizeAppSettings({ recentWorkspacePath: "/legacy/project" }).recentWorkspacePaths,
    ).toEqual(["/legacy/project"]);
  });

  it("defensively normalizes malformed recent workspace paths", () => {
    expect(
      normalizeRecentWorkspacePaths([
        " /one ",
        42,
        "",
        "/two/",
        "/two",
        ...Array.from({ length: 12 }, (_, index) => `/extra-${index}`),
      ]),
    ).toEqual(["/one", "/two/", ...Array.from({ length: 12 }, (_, index) => `/extra-${index}`)]);
    expect(normalizeRecentWorkspacePaths(null)).toEqual([]);
  });

  it("pushes recent workspaces in MRU order", () => {
    const full = Array.from({ length: 10 }, (_, index) => `/project-${index}`);

    expect(pushRecentWorkspacePath(full, "/project-4/")).toEqual([
      "/project-4/",
      "/project-0",
      "/project-1",
      "/project-2",
      "/project-3",
      "/project-5",
      "/project-6",
      "/project-7",
      "/project-8",
      "/project-9",
    ]);
    expect(pushRecentWorkspacePath(full, "   ")).toEqual(full);
  });

  it("falls back for invalid app settings", () => {
    expect(normalizeAppSettings({ recentWorkspacePath: 1 })).toEqual(defaultAppSettings());
    expect(normalizeAppSettings(null)).toEqual(defaultAppSettings());
  });

  it("persists and normalizes user snippets", () => {
    const normalized = normalizeAppSettings({
      userSnippets: [
        {
          prefix: "  myhelper ",
          body: "helper($0);",
          description: " Call helper ",
          languages: ["php", "php", "blade"],
        },
        { prefix: "", body: "x", description: "", languages: ["php"] },
      ],
    });

    expect(normalized.userSnippets).toEqual([
      {
        prefix: "myhelper",
        body: "helper($0);",
        description: "Call helper",
        languages: ["php", "blade"],
      },
    ]);
  });

  it("defaults user snippets to an empty array when absent or invalid", () => {
    expect(normalizeAppSettings({}).userSnippets).toEqual([]);
    expect(normalizeAppSettings({ userSnippets: "nope" }).userSnippets).toEqual([]);
  });
});

describe("monacoFontLigaturesForEditorSetting", () => {
  it("maps the boolean app setting to explicit Monaco font feature settings", () => {
    expect(monacoFontLigaturesForEditorSetting(true)).toBe('"liga" on, "calt" on');
    expect(monacoFontLigaturesForEditorSetting(false)).toBe('"liga" off, "calt" off');
  });
});

describe("normalizeWorkspaceSettings", () => {
  it("accepts valid persisted workspace settings", () => {
    expect(
      normalizeWorkspaceSettings({
        autoSave: true,
        autoSaveConfigured: true,
        defaultInsertSpaces: false,
        defaultTabSize: 6,
        extraIgnorePatterns: ["vendor/generated", " var/cache ", "var/cache"],
        eslintAnalyseOnSave: true,
        eslintFixOnSave: true,
        eslintPath: " /tools/eslint ",
        formatOnPaste: true,
        formatOnSave: true,
        gitDirectoryMappings: [
          "workbench/lcsk/x",
          "",
          "workbench\\lcsk\\x",
          "workbench/lcsk/attendance",
          "../escape",
        ],
        gitDirectoryMappingsAuto: false,
        intelligenceMode: "lightSmart",
        intelephensePath: "/tools/intelephense",
        javaScriptTypeScriptAddMissingImportsOnSave: true,
        javaScriptTypeScriptAutoImports: false,
        javaScriptTypeScriptAutomaticTypeAcquisition: true,
        javaScriptTypeScriptCodeLens: true,
        javaScriptTypeScriptReferencesCodeLensOnAllFunctions: true,
        javaScriptTypeScriptCompleteFunctionCalls: true,
        javaScriptTypeScriptFixAllOnSave: true,
        javaScriptTypeScriptImportModuleSpecifierEnding: "minimal",
        javaScriptTypeScriptImportModuleSpecifierPreference: "project-relative",
        javaScriptTypeScriptInlayHints: false,
        javaScriptTypeScriptOrganizeImportsOnSave: true,
        javaScriptTypeScriptPreferTypeOnlyAutoImports: true,
        javaScriptTypeScriptQuotePreference: "single",
        javaScriptTypeScriptRemoveUnusedOnSave: true,
        javaScriptTypeScriptService: "off",
        javaScriptTypeScriptValidation: false,
        javaScriptTypeScriptVersion: "workspace",
        largeFileMode: {
          characterLimit: 512_000,
          lineLimit: 10_000,
        },
        optimizeImportsOnSave: true,
        phpBackend: "phpactor",
        phpInlayHints: false,
        phpstanAnalyseOnSave: true,
        phpstanPath: " /tools/phpstan ",
        phpVersionOverride: "8.3",
        phpactorPath: " /tools/phpactor ",
        prettierFormatOnSave: true,
        revealActiveFileInTree: false,
        session: {
          activePath: "/project/src/User.php",
          bottomPanelView: "history",
          openPaths: ["/project/src/User.php", "/project/src/User.php", " /project/README.md "],
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
      agentIsolationPolicy: "auto",
      autoSave: true,
      autoSaveConfigured: true,
      defaultInsertSpaces: false,
      defaultTabSize: 6,
      extraIgnorePatterns: ["vendor/generated", "var/cache"],
      eslintAnalyseOnSave: true,
      eslintFixOnSave: true,
      eslintPath: "/tools/eslint",
      formatOnPaste: true,
      formatOnSave: true,
      gitCommitMessageHistory: [],
      gitDirectoryMappings: ["", "workbench/lcsk/attendance", "workbench/lcsk/x"],
      gitDirectoryMappingsAuto: false,
      intelligenceMode: "lightSmart",
      intelephensePath: "/tools/intelephense",
      javaScriptTypeScriptAddMissingImportsOnSave: true,
      javaScriptTypeScriptAutoImports: false,
      javaScriptTypeScriptAutomaticTypeAcquisition: true,
      javaScriptTypeScriptCodeLens: true,
      javaScriptTypeScriptReferencesCodeLensOnAllFunctions: true,
      javaScriptTypeScriptCompleteFunctionCalls: true,
      javaScriptTypeScriptFixAllOnSave: true,
      javaScriptTypeScriptImportModuleSpecifierEnding: "minimal",
      javaScriptTypeScriptImportModuleSpecifierPreference: "project-relative",
      javaScriptTypeScriptInlayHints: false,
      javaScriptTypeScriptOrganizeImportsOnSave: true,
      javaScriptTypeScriptPreferTypeOnlyAutoImports: true,
      javaScriptTypeScriptQuotePreference: "single",
      javaScriptTypeScriptRemoveUnusedOnSave: true,
      javaScriptTypeScriptService: "off",
      javaScriptTypeScriptValidation: false,
      javaScriptTypeScriptVersion: "workspace",
      largeFileMode: {
        characterLimit: 512_000,
        lineLimit: 10_000,
      },
      optimizeImportsOnSave: true,
      phpBackend: "phpactor",
      phpInlayHints: false,
      phpstanAnalyseOnSave: true,
      phpstanPath: "/tools/phpstan",
      phpVersionOverride: "8.3",
      phpactorPath: "/tools/phpactor",
      prettierFormatOnSave: true,
      revealActiveFileInTree: false,
      session: {
        bottomPanelView: "history",
        editor: {
          activeGroupId: "editor-main",
          groups: {
            "editor-main": {
              activePath: "/project/src/User.php",
              openPaths: ["/project/src/User.php", "/project/README.md"],
              previewPath: null,
            },
          },
          layout: { groupId: "editor-main", kind: "group" },
        },
        sidebarView: "git",
        version: 1,
      },
      statusBar: {
        activePath: true,
        cursorPosition: true,
        dirtyCount: false,
        gitBranch: true,
        index: false,
        language: true,
        largeFileMode: true,
        languageServer: true,
        message: true,
        mode: false,
        workspaceInfo: false,
        workspaceTrust: true,
      },
    });
  });

  it("keeps old workspace settings compatible", () => {
    expect(normalizeWorkspaceSettings({ intelligenceMode: "lightSmart" })).toEqual({
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

  it("defaults git directory mappings to empty with auto-detect enabled", () => {
    expect(normalizeWorkspaceSettings({}).gitDirectoryMappings).toEqual([]);
    expect(normalizeWorkspaceSettings({}).gitDirectoryMappingsAuto).toBe(true);
  });

  it("keeps settings without git fields backward compatible", () => {
    const legacy = normalizeWorkspaceSettings({
      intelligenceMode: "basic",
      phpBackend: "phpactor",
    });

    expect(legacy.gitDirectoryMappings).toEqual([]);
    expect(legacy.gitDirectoryMappingsAuto).toBe(true);
  });

  it("normalizes, dedupes and rejects unsafe git directory mappings", () => {
    expect(
      normalizeWorkspaceSettings({
        gitDirectoryMappings: [
          "workbench/lcsk/x",
          "",
          "workbench\\lcsk\\x",
          "./workbench/lcsk/attendance/",
          "/abs/repo",
          "../escape",
        ],
        gitDirectoryMappingsAuto: false,
      }).gitDirectoryMappings,
    ).toEqual(["", "workbench/lcsk/attendance", "workbench/lcsk/x"]);
    expect(
      normalizeWorkspaceSettings({ gitDirectoryMappingsAuto: false }).gitDirectoryMappingsAuto,
    ).toBe(false);
    expect(
      normalizeWorkspaceSettings({ gitDirectoryMappings: "nope" }).gitDirectoryMappings,
    ).toEqual([]);
  });

  it("defaults formatOnSave to false and respects explicit boolean values", () => {
    expect(normalizeWorkspaceSettings({}).formatOnSave).toBe(false);
    expect(normalizeWorkspaceSettings({ formatOnSave: "yes" }).formatOnSave).toBe(false);
    expect(normalizeWorkspaceSettings({ formatOnSave: false }).formatOnSave).toBe(false);
    expect(normalizeWorkspaceSettings({ formatOnSave: true }).formatOnSave).toBe(true);
  });

  it("defaults analyse-on-save settings to false and respects explicit boolean values", () => {
    expect(normalizeWorkspaceSettings({}).eslintAnalyseOnSave).toBe(false);
    expect(normalizeWorkspaceSettings({}).phpstanAnalyseOnSave).toBe(false);
    expect(normalizeWorkspaceSettings({ eslintAnalyseOnSave: "yes" }).eslintAnalyseOnSave).toBe(
      false,
    );
    expect(normalizeWorkspaceSettings({ phpstanAnalyseOnSave: "yes" }).phpstanAnalyseOnSave).toBe(
      false,
    );
    expect(normalizeWorkspaceSettings({ eslintAnalyseOnSave: true }).eslintAnalyseOnSave).toBe(
      true,
    );
    expect(normalizeWorkspaceSettings({ phpstanAnalyseOnSave: true }).phpstanAnalyseOnSave).toBe(
      true,
    );
  });

  it("defaults eslintFixOnSave to false and respects explicit boolean values", () => {
    expect(normalizeWorkspaceSettings({}).eslintFixOnSave).toBe(false);
    expect(normalizeWorkspaceSettings({ eslintFixOnSave: "yes" }).eslintFixOnSave).toBe(false);
    expect(normalizeWorkspaceSettings({ eslintFixOnSave: false }).eslintFixOnSave).toBe(false);
    expect(normalizeWorkspaceSettings({ eslintFixOnSave: true }).eslintFixOnSave).toBe(true);
  });

  it("defaults prettierFormatOnSave to false and respects explicit boolean values", () => {
    expect(normalizeWorkspaceSettings({}).prettierFormatOnSave).toBe(false);
    expect(normalizeWorkspaceSettings({ prettierFormatOnSave: "yes" }).prettierFormatOnSave).toBe(
      false,
    );
    expect(normalizeWorkspaceSettings({ prettierFormatOnSave: false }).prettierFormatOnSave).toBe(
      false,
    );
    expect(normalizeWorkspaceSettings({ prettierFormatOnSave: true }).prettierFormatOnSave).toBe(
      true,
    );
  });

  it("defaults optimizeImportsOnSave to false and respects explicit boolean values", () => {
    expect(normalizeWorkspaceSettings({}).optimizeImportsOnSave).toBe(false);
    expect(normalizeWorkspaceSettings({ optimizeImportsOnSave: "yes" }).optimizeImportsOnSave).toBe(
      false,
    );
    expect(normalizeWorkspaceSettings({ optimizeImportsOnSave: true }).optimizeImportsOnSave).toBe(
      true,
    );
    expect(normalizeWorkspaceSettings({ optimizeImportsOnSave: false }).optimizeImportsOnSave).toBe(
      false,
    );
  });

  it("defaults JS/TS on-save source actions to false and respects explicit boolean values", () => {
    expect(normalizeWorkspaceSettings({}).javaScriptTypeScriptOrganizeImportsOnSave).toBe(false);
    expect(normalizeWorkspaceSettings({}).javaScriptTypeScriptRemoveUnusedOnSave).toBe(false);
    expect(normalizeWorkspaceSettings({}).javaScriptTypeScriptAddMissingImportsOnSave).toBe(false);
    expect(normalizeWorkspaceSettings({}).javaScriptTypeScriptFixAllOnSave).toBe(false);
    expect(
      normalizeWorkspaceSettings({
        javaScriptTypeScriptAddMissingImportsOnSave: "yes",
        javaScriptTypeScriptFixAllOnSave: "yes",
        javaScriptTypeScriptOrganizeImportsOnSave: "yes",
        javaScriptTypeScriptRemoveUnusedOnSave: "yes",
      }).javaScriptTypeScriptOrganizeImportsOnSave,
    ).toBe(false);
    expect(
      normalizeWorkspaceSettings({
        javaScriptTypeScriptAddMissingImportsOnSave: "yes",
        javaScriptTypeScriptFixAllOnSave: "yes",
      }).javaScriptTypeScriptAddMissingImportsOnSave,
    ).toBe(false);
    expect(
      normalizeWorkspaceSettings({
        javaScriptTypeScriptAddMissingImportsOnSave: "yes",
        javaScriptTypeScriptFixAllOnSave: "yes",
      }).javaScriptTypeScriptFixAllOnSave,
    ).toBe(false);
    expect(
      normalizeWorkspaceSettings({
        javaScriptTypeScriptAddMissingImportsOnSave: true,
        javaScriptTypeScriptFixAllOnSave: true,
        javaScriptTypeScriptOrganizeImportsOnSave: true,
        javaScriptTypeScriptRemoveUnusedOnSave: true,
      }),
    ).toEqual({
      ...defaultWorkspaceSettings(),
      javaScriptTypeScriptAddMissingImportsOnSave: true,
      javaScriptTypeScriptFixAllOnSave: true,
      javaScriptTypeScriptOrganizeImportsOnSave: true,
      javaScriptTypeScriptRemoveUnusedOnSave: true,
    });
  });

  it("normalizes JS/TS import preferences", () => {
    expect(normalizeWorkspaceSettings({}).javaScriptTypeScriptImportModuleSpecifierEnding).toBe(
      "auto",
    );
    expect(normalizeWorkspaceSettings({}).javaScriptTypeScriptImportModuleSpecifierPreference).toBe(
      "shortest",
    );
    expect(normalizeWorkspaceSettings({}).javaScriptTypeScriptQuotePreference).toBe("auto");
    expect(normalizeWorkspaceSettings({}).javaScriptTypeScriptPreferTypeOnlyAutoImports).toBe(
      false,
    );
    expect(
      normalizeWorkspaceSettings({
        javaScriptTypeScriptImportModuleSpecifierEnding: "minimal",
        javaScriptTypeScriptImportModuleSpecifierPreference: "relative",
        javaScriptTypeScriptPreferTypeOnlyAutoImports: true,
        javaScriptTypeScriptQuotePreference: "double",
      }),
    ).toEqual({
      ...defaultWorkspaceSettings(),
      javaScriptTypeScriptImportModuleSpecifierEnding: "minimal",
      javaScriptTypeScriptImportModuleSpecifierPreference: "relative",
      javaScriptTypeScriptPreferTypeOnlyAutoImports: true,
      javaScriptTypeScriptQuotePreference: "double",
    });
    expect(
      normalizeWorkspaceSettings({
        javaScriptTypeScriptImportModuleSpecifierEnding: "explicit",
        javaScriptTypeScriptImportModuleSpecifierPreference: "absolute",
        javaScriptTypeScriptPreferTypeOnlyAutoImports: "yes",
        javaScriptTypeScriptQuotePreference: "backtick",
      }),
    ).toEqual(defaultWorkspaceSettings());
  });

  it("defaults JS/TS automatic type acquisition to false and respects explicit booleans", () => {
    expect(normalizeWorkspaceSettings({}).javaScriptTypeScriptAutomaticTypeAcquisition).toBe(false);
    expect(
      normalizeWorkspaceSettings({
        javaScriptTypeScriptAutomaticTypeAcquisition: "yes",
      }).javaScriptTypeScriptAutomaticTypeAcquisition,
    ).toBe(false);
    expect(
      normalizeWorkspaceSettings({
        javaScriptTypeScriptAutomaticTypeAcquisition: true,
      }).javaScriptTypeScriptAutomaticTypeAcquisition,
    ).toBe(true);
  });

  it("defaults phpInlayHints to true and respects explicit boolean values", () => {
    expect(normalizeWorkspaceSettings({}).phpInlayHints).toBe(true);
    expect(normalizeWorkspaceSettings({ phpInlayHints: "yes" }).phpInlayHints).toBe(true);
    expect(normalizeWorkspaceSettings({ phpInlayHints: false }).phpInlayHints).toBe(false);
    expect(normalizeWorkspaceSettings({ phpInlayHints: true }).phpInlayHints).toBe(true);
  });

  it("defaults formatOnPaste to false and respects explicit boolean values", () => {
    expect(normalizeWorkspaceSettings({}).formatOnPaste).toBe(false);
    expect(normalizeWorkspaceSettings({ formatOnPaste: "yes" }).formatOnPaste).toBe(false);
    expect(normalizeWorkspaceSettings({ formatOnPaste: false }).formatOnPaste).toBe(false);
    expect(normalizeWorkspaceSettings({ formatOnPaste: true }).formatOnPaste).toBe(true);
  });

  it("falls back for invalid workspace settings", () => {
    expect(
      normalizeWorkspaceSettings({
        extraIgnorePatterns: ["var/cache", 4],
        eslintPath: 10,
        defaultInsertSpaces: "yes",
        defaultTabSize: 0,
        intelligenceMode: "unknown",
        javaScriptTypeScriptService: "manual",
        javaScriptTypeScriptVersion: "manual",
        phpBackend: "unknown",
        phpactorPath: 10,
        phpstanPath: 10,
      }),
    ).toEqual({
      ...defaultWorkspaceSettings(),
      defaultTabSize: 1,
      extraIgnorePatterns: ["var/cache"],
    });
    expect(normalizeWorkspaceSettings(null)).toEqual(defaultWorkspaceSettings());
  });
});

describe("normalizeLargeSmartDocumentPolicy", () => {
  it("accepts positive numeric thresholds", () => {
    expect(
      normalizeLargeSmartDocumentPolicy({
        characterLimit: 512_000.9,
        lineLimit: 10_000.4,
      }),
    ).toEqual({
      characterLimit: 512_000,
      lineLimit: 10_000,
    });
  });

  it("clamps small numeric thresholds and falls back for non-numeric thresholds", () => {
    expect(
      normalizeLargeSmartDocumentPolicy({
        characterLimit: 0,
        lineLimit: "lots",
      }),
    ).toEqual({
      characterLimit: MIN_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT,
      lineLimit: LARGE_SMART_DOCUMENT_LINE_LIMIT,
    });
    expect(normalizeLargeSmartDocumentPolicy({ lineLimit: 1 })).toEqual({
      characterLimit: LARGE_SMART_DOCUMENT_CHARACTER_LIMIT,
      lineLimit: MIN_LARGE_SMART_DOCUMENT_LINE_LIMIT,
    });
  });
});

describe("normalizeWorkspaceSession", () => {
  it("restores bounded recent files, locations, and navigation stacks", () => {
    const normalized = normalizeWorkspaceSession({
      ...defaultWorkspaceSessionState(),
      navigation: {
        backStack: [
          {
            path: "/project/a.ts",
            position: { column: 2, lineNumber: 3 },
          },
        ],
        forwardStack: [
          {
            path: "/project/b.ts",
            position: { column: 4, lineNumber: 5 },
          },
        ],
        recentFiles: [{ name: "a.ts", path: "/project/a.ts" }],
        recentLocations: [
          {
            column: 2,
            line: 3,
            name: "a.ts",
            path: "/project/a.ts",
            relativePath: "a.ts",
            snippet: "const a = 1;",
          },
        ],
      },
    });

    expect(normalized.navigation).toEqual({
      backStack: [
        {
          path: "/project/a.ts",
          position: { column: 2, lineNumber: 3 },
        },
      ],
      forwardStack: [
        {
          path: "/project/b.ts",
          position: { column: 4, lineNumber: 5 },
        },
      ],
      recentFiles: [{ name: "a.ts", path: "/project/a.ts" }],
      recentLocations: [
        {
          column: 2,
          line: 3,
          name: "a.ts",
          path: "/project/a.ts",
          relativePath: "a.ts",
          snippet: "const a = 1;",
        },
      ],
    });
  });

  it("drops malformed elements without discarding valid entries or sibling lists", () => {
    const normalized = normalizeWorkspaceSession({
      ...defaultWorkspaceSessionState(),
      navigation: {
        additiveField: true,
        backStack: [
          { path: "src/valid.ts", position: { column: 1, lineNumber: 2 } },
          { path: 42, position: { column: 1, lineNumber: 2 } },
        ],
        forwardStack: [{ path: "src/forward.ts", position: { column: 2, lineNumber: 3 } }],
        recentFiles: [
          { name: "valid.ts", path: "src/valid.ts" },
          { name: "bad.ts", path: 42 },
          { extra: true, name: "extra.ts", path: "src/extra.ts" },
        ],
        recentLocations: [
          {
            column: 1,
            line: 2,
            name: "valid.ts",
            path: "src/valid.ts",
            relativePath: "src/valid.ts",
            snippet: "valid",
          },
          {
            column: Number.NaN,
            line: 2,
            name: "bad.ts",
            path: "src/bad.ts",
            relativePath: "src/bad.ts",
            snippet: "bad",
          },
        ],
      },
    });

    expect(normalized.navigation).toEqual({
      backStack: [{ path: "src/valid.ts", position: { column: 1, lineNumber: 2 } }],
      forwardStack: [{ path: "src/forward.ts", position: { column: 2, lineNumber: 3 } }],
      recentFiles: [{ name: "valid.ts", path: "src/valid.ts" }],
      recentLocations: [
        {
          column: 1,
          line: 2,
          name: "valid.ts",
          path: "src/valid.ts",
          relativePath: "src/valid.ts",
          snippet: "valid",
        },
      ],
    });
  });

  it("caps each list after filtering instead of rejecting oversized arrays", () => {
    const normalized = normalizeWorkspaceSession({
      ...defaultWorkspaceSessionState(),
      navigation: {
        backStack: Array.from({ length: 125 }, (_, index) => ({
          path: `src/back-${index}.ts`,
          position: { column: 1, lineNumber: index + 1 },
        })),
        forwardStack: [],
        recentFiles: Array.from({ length: 75 }, (_, index) => ({
          name: `file-${index}.ts`,
          path: `src/file-${index}.ts`,
        })),
        recentLocations: [],
      },
    });

    expect(normalized.navigation?.backStack).toHaveLength(100);
    expect(normalized.navigation?.recentFiles).toHaveLength(50);
  });

  it("preserves bounded siblings when one list is not an array", () => {
    const normalized = normalizeWorkspaceSession({
      ...defaultWorkspaceSessionState(),
      navigation: {
        backStack: [],
        forwardStack: [],
        recentFiles: {},
        recentLocations: [
          {
            column: 1,
            line: 1,
            name: "a.ts",
            path: "a.ts",
            relativePath: "a.ts",
            snippet: "a",
          },
        ],
      },
    });

    expect(normalized.navigation?.recentFiles).toEqual([]);
    expect(normalized.navigation?.recentLocations).toHaveLength(1);
  });

  it("rejects a navigation record with a polluted prototype", () => {
    const navigation = Object.create({ polluted: true }) as Record<string, unknown>;
    navigation.backStack = [];
    navigation.forwardStack = [];
    navigation.recentFiles = [];
    navigation.recentLocations = [];

    expect(
      normalizeWorkspaceSession({
        ...defaultWorkspaceSessionState(),
        navigation,
      }).navigation,
    ).toBeUndefined();
  });

  it("truncates an oversized snippet without discarding its location", () => {
    const normalized = normalizeWorkspaceSession({
      ...defaultWorkspaceSessionState(),
      navigation: {
        backStack: [],
        forwardStack: [],
        recentFiles: [],
        recentLocations: [
          {
            column: 1,
            line: 1,
            name: "a.ts",
            path: "/project/a.ts",
            relativePath: "a.ts",
            snippet: "x".repeat(200_000),
          },
        ],
      },
    });

    expect(normalized.navigation?.recentLocations).toHaveLength(1);
    expect(
      new TextEncoder().encode(normalized.navigation?.recentLocations[0]?.snippet).byteLength,
    ).toBeLessThanOrEqual(256);
  });

  it("restores the Scripts sidebar view", () => {
    expect(
      normalizeWorkspaceSession({
        ...defaultWorkspaceSessionState(),
        sidebarView: "scripts",
      }).sidebarView,
    ).toBe("scripts");
  });

  it("falls back to the Files sidebar view for a legacy persisted agents view", () => {
    expect(
      normalizeWorkspaceSession({
        ...defaultWorkspaceSessionState(),
        sidebarView: "agents",
      }).sidebarView,
    ).toBe("files");
  });

  it("migrates legacy flat fields into the primary group and unpins preview", () => {
    const normalized = normalizeWorkspaceSession({
      activePath: "/project/Preview.php",
      bottomPanelView: "history",
      openPaths: ["/project/A.php", "/project/Preview.php"],
      previewPath: "/project/Preview.php",
      sidebarView: "git",
      viewStates: {
        "/project/Preview.php": { column: 9, foldedLines: [3, 2, 2], line: 14 },
      },
    });

    expect(normalized).toMatchObject({
      bottomPanelView: "history",
      editor: {
        activeGroupId: "editor-main",
        groups: {
          "editor-main": {
            activePath: "/project/Preview.php",
            openPaths: ["/project/A.php"],
            previewPath: "/project/Preview.php",
          },
        },
        layout: { groupId: "editor-main", kind: "group" },
      },
      sidebarView: "git",
      version: 1,
      viewStates: {
        "editor-main": {
          "/project/Preview.php": { column: 9, foldedLines: [2, 3], line: 14 },
        },
      },
    });
  });

  it("keeps independent same-file view states in split groups", () => {
    const normalized = normalizeWorkspaceSession(splitSessionFixture());
    expect(normalized.viewStates).toEqual({
      left: { "/project/A.php": { column: 2, line: 3 } },
      right: { "/project/A.php": { column: 8, line: 9 } },
    });
  });

  it("repairs corrupt layouts through editor group normalization", () => {
    const normalized = normalizeWorkspaceSession({
      ...splitSessionFixture(),
      editor: {
        activeGroupId: "missing",
        groups: {
          valid: { activePath: "/project/A.php", openPaths: ["/project/A.php"], previewPath: null },
          "": { activePath: null, openPaths: [], previewPath: null },
        },
        layout: { kind: "group", groupId: "missing" },
      },
    });
    expect(normalized.editor).toMatchObject({
      activeGroupId: "valid",
      layout: { groupId: "valid", kind: "group" },
    });
  });

  it("returns the safe default for unsupported explicit versions", () => {
    expect(normalizeWorkspaceSession({ version: 2, sidebarView: "git" })).toEqual(
      defaultWorkspaceSessionState(),
    );
  });

  it("omits the agent workbench layout when it is absent", () => {
    const normalized = normalizeWorkspaceSession(defaultWorkspaceSessionState());

    expect(normalized.version).toBe(WORKSPACE_SESSION_VERSION);
    expect("agentWorkbench" in normalized).toBe(false);
  });

  it("restores a valid agent workbench layout without a version bump", () => {
    const normalized = normalizeWorkspaceSession({
      ...defaultWorkspaceSessionState(),
      agentWorkbench: {
        layout: "agent",
        rightSurface: "diff",
        bottomPanel: true,
        rightPanelWidth: 640,
        bottomPanelHeight: 320,
      },
    });

    expect(normalized.version).toBe(WORKSPACE_SESSION_VERSION);
    expect(normalized.agentWorkbench).toEqual({
      layout: "agent",
      rightPanel: "open",
      openSurfaces: ["diff"],
      activeSurface: "diff",
      rightPanelMaximized: false,
      rail: "expanded",
      rightPanelWidth: 640,
      bottomPanelHeight: 320,
      bottomPanel: true,
    });
  });

  it("preserves the persisted bottom panel flag through normalization", () => {
    const normalized = normalizeWorkspaceSession({
      ...defaultWorkspaceSessionState(),
      agentWorkbench: serializeAgentWorkbenchLayout(initialAgentWorkbenchLayout, true),
    });

    expect(normalized.agentWorkbench).toEqual(
      serializeAgentWorkbenchLayout(initialAgentWorkbenchLayout, true),
    );
    expect(normalized.agentWorkbench?.bottomPanel).toBe(true);
  });

  it("normalizes a missing or invalid bottom panel flag to false", () => {
    for (const bottomPanel of [undefined, false, "yes", 1, null]) {
      const normalized = normalizeWorkspaceSession({
        ...defaultWorkspaceSessionState(),
        agentWorkbench: {
          ...serializeAgentWorkbenchLayout(initialAgentWorkbenchLayout, true),
          bottomPanel,
        },
      });

      expect(normalized.agentWorkbench?.bottomPanel).toBe(false);
    }
  });

  it("restores the tabbed agent workbench layout", () => {
    const normalized = normalizeWorkspaceSession({
      ...defaultWorkspaceSessionState(),
      agentWorkbench: {
        layout: "agent",
        rightPanel: "open",
        openSurfaces: ["files", "terminal", "bogus", "files"],
        activeSurface: "terminal",
        rightPanelMaximized: true,
        rail: "expanded",
        bottomPanel: false,
        rightPanelWidth: 540,
        bottomPanelHeight: 280,
      },
    });

    expect(normalized.agentWorkbench).toEqual({
      layout: "agent",
      rightPanel: "open",
      openSurfaces: ["files", "terminal"],
      activeSurface: "terminal",
      rightPanelMaximized: true,
      rail: "expanded",
      rightPanelWidth: 540,
      bottomPanelHeight: 280,
      bottomPanel: false,
    });
  });

  it("drops a non-record agent workbench layout", () => {
    [null, "agent", 7, [], true].forEach((agentWorkbench) => {
      const normalized = normalizeWorkspaceSession({
        ...defaultWorkspaceSessionState(),
        agentWorkbench,
      });

      expect("agentWorkbench" in normalized).toBe(false);
    });
  });

  it("fails closed to the layout defaults for invalid agent workbench values", () => {
    const normalized = normalizeWorkspaceSession({
      ...defaultWorkspaceSessionState(),
      agentWorkbench: {
        layout: "browser",
        rightSurface: "preview",
        openSurfaces: "files",
        activeSurface: "files",
        rightPanelMaximized: "yes",
        bottomPanel: "yes",
        rightPanelWidth: "wide",
        bottomPanelHeight: "tall",
      },
    });

    expect(normalized.agentWorkbench).toEqual(
      serializeAgentWorkbenchLayout(initialAgentWorkbenchLayout, false),
    );
  });

  it("round-trips a closed agent panel that still remembers its tabs", () => {
    const normalized = normalizeWorkspaceSession({
      ...defaultWorkspaceSessionState(),
      agentWorkbench: {
        layout: "agent",
        rightPanel: "closed",
        openSurfaces: ["files", "terminal"],
        activeSurface: "terminal",
        rightPanelMaximized: true,
        rail: "expanded",
        bottomPanel: false,
        rightPanelWidth: 640,
        bottomPanelHeight: 300,
      },
    });

    expect(normalized.agentWorkbench).toEqual({
      layout: "agent",
      rightPanel: "closed",
      openSurfaces: ["files", "terminal"],
      activeSurface: "terminal",
      rightPanelMaximized: false,
      rail: "expanded",
      rightPanelWidth: 640,
      bottomPanelHeight: 300,
      bottomPanel: false,
    });
  });

  it("drops the legacy remembered surface field", () => {
    const normalized = normalizeWorkspaceSession({
      ...defaultWorkspaceSessionState(),
      agentWorkbench: {
        layout: "agent",
        rightSurface: null,
        lastSurface: "terminal",
        bottomPanel: false,
        rightPanelWidth: 540,
        bottomPanelHeight: 280,
      },
    });

    expect(normalized.agentWorkbench).toBeDefined();
    expect("lastSurface" in (normalized.agentWorkbench ?? {})).toBe(false);
  });
});

describe("recent workspace paths", () => {
  it("keeps the newest configured number of recent workspaces", () => {
    const paths = Array.from(
      { length: MAX_RECENT_WORKSPACE_PATHS + 5 },
      (_, index) => `/workspace-${index}`,
    );

    expect(normalizeRecentWorkspacePaths(paths)).toEqual(
      paths.slice(0, MAX_RECENT_WORKSPACE_PATHS),
    );
    expect(pushRecentWorkspacePath(paths, "/new-workspace")).toHaveLength(
      MAX_RECENT_WORKSPACE_PATHS,
    );
  });
});

function splitSessionFixture() {
  return {
    version: 1,
    bottomPanelView: "problems",
    editor: {
      activeGroupId: "right",
      groups: {
        left: { activePath: "/project/A.php", openPaths: ["/project/A.php"], previewPath: null },
        right: { activePath: "/project/A.php", openPaths: ["/project/A.php"], previewPath: null },
      },
      layout: {
        kind: "split",
        orientation: "horizontal",
        sizes: [0.4, 0.6],
        children: [
          { kind: "group", groupId: "left" },
          { kind: "group", groupId: "right" },
        ],
      },
    },
    sidebarView: "files",
    viewStates: {
      left: { "/project/A.php": { column: 2, line: 3 } },
      right: { "/project/A.php": { column: 8, line: 9 } },
    },
  };
}

describe("workspace commit message history", () => {
  it("defaults legacy workspace settings to empty history", () => {
    expect(normalizeWorkspaceSettings({}).gitCommitMessageHistory).toEqual([]);
  });

  it("defensively normalizes persisted history", () => {
    expect(
      normalizeWorkspaceSettings({
        gitCommitMessageHistory: [" first ", null, "", "first", "second"],
      }).gitCommitMessageHistory,
    ).toEqual(["first", "second"]);
    expect(
      normalizeWorkspaceSettings({ gitCommitMessageHistory: "broken" }).gitCommitMessageHistory,
    ).toEqual([]);
  });
});

describe("settings ignore pattern text", () => {
  it("round trips trimmed unique patterns", () => {
    const patterns = settingsIgnorePatternsFromText("vendor/generated\n\n var/cache \nvar/cache");

    expect(patterns).toEqual(["vendor/generated", "var/cache"]);
    expect(settingsIgnorePatternsText(patterns)).toBe("vendor/generated\nvar/cache");
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
    expect(normalizeEditorFontSize(Number.POSITIVE_INFINITY)).toBe(defaultEditorFontSize);
  });
});

describe("monacoThemeForAppTheme", () => {
  it("maps light theme to Monaco light and keeps dark themes dark", () => {
    expect(monacoThemeForAppTheme("light")).toBe("calm-light");
    expect(monacoThemeForAppTheme("dark")).toBe("calm-dark");
    expect(monacoThemeForAppTheme("system")).toBe("calm-dark");
    expect(monacoThemeForAppTheme("system", true)).toBe("calm-light");
    expect(monacoThemeForAppTheme("ayuMirage")).toBe("ayu-mirage");
    expect(monacoThemeForAppTheme("materialDeepOcean")).toBe("material-deep-ocean");
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
    expect(terminalThemeForAppTheme("materialDeepOcean").background).toBe("#0f111a");
    expect(terminalThemeForAppTheme("system", true).foreground).toBe("#263240");
    expect(terminalThemeForAppTheme("system", false).foreground).toBe("#d8dee9");
    expect(terminalThemeForAppTheme("darkPlus").background).toBe("#1e1e1e");
    expect(terminalThemeForAppTheme("darkPlus").foreground).toBe("#cccccc");
  });
});
