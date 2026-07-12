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
  normalizeRecentWorkspacePaths,
  normalizeWorkspaceSession,
  normalizeWorkspaceSettings,
  pushRecentWorkspacePath,
  resolveAppTheme,
  settingsIgnorePatternsFromText,
  settingsIgnorePatternsText,
  terminalThemeForAppTheme,
} from "./settings";
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
      editorFontFamily:
        "JetBrains Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      editorFontLigatures: false,
      editorFontSize: 14,
      minimapEnabled: false,
      keymap: defaultKeymapSettings(),
      recentWorkspacePath: null,
      recentWorkspacePaths: [],
      runtimePolicy: "keepAlive",
      theme: "dark",
      userSnippets: [],
      workspaceTabs: [],
    });
    expect(defaultWorkspaceSettings()).toEqual({
      autoSave: true,
      autoSaveConfigured: true,
      defaultInsertSpaces: true,
      defaultTabSize: 4,
      extraIgnorePatterns: [],
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
      phpstanPath: null,
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
      activePath: null,
      bottomPanelView: "problems",
      openPaths: [],
      sidebarView: "files",
    });
  });
});

describe("normalizeAppSettings", () => {
  it("round-trips a persisted minimap setting", () => {
    expect(normalizeAppSettings({ minimapEnabled: true }).minimapEnabled).toBe(
      true,
    );
    expect(normalizeAppSettings({ minimapEnabled: false }).minimapEnabled).toBe(
      false,
    );
  });

  it("defaults a legacy app setting without minimap state to false", () => {
    expect(normalizeAppSettings({}).minimapEnabled).toBe(false);
  });

  it("accepts valid persisted app settings", () => {
    expect(normalizeAppSettings({ recentWorkspacePath: "/project" })).toEqual({
      editorFontFamily:
        "JetBrains Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      editorFontLigatures: false,
      editorFontSize: 14,
      keymap: defaultKeymapSettings(),
      minimapEnabled: false,
      recentWorkspacePath: "/project",
      recentWorkspacePaths: ["/project"],
      runtimePolicy: "keepAlive",
      theme: "dark",
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
        workspaceTabs: ["/project-a", " /project-b ", "/project-a", 42],
      }),
    ).toEqual({
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
      theme: "light",
      userSnippets: [],
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
      minimapEnabled: false,
      recentWorkspacePath: null,
      recentWorkspacePaths: [],
      runtimePolicy: "keepAlive",
      theme: "ayuMirage",
      userSnippets: [],
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
      minimapEnabled: false,
      recentWorkspacePath: null,
      recentWorkspacePaths: [],
      runtimePolicy: "keepAlive",
      theme: "dark",
      userSnippets: [],
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
    ).toBe("Fira Code, monospace");
  });

  it("adds a monospace fallback for a single editor font family", () => {
    expect(
      normalizeAppSettings({ editorFontFamily: "Iosevka" }).editorFontFamily,
    ).toBe("Iosevka, monospace");
    expect(
      normalizeAppSettings({ editorFontFamily: "monospace" }).editorFontFamily,
    ).toBe("monospace");
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
      editorFontFamily:
        "JetBrains Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      editorFontLigatures: false,
      editorFontSize: 14,
      keymap: defaultKeymapSettings(),
      minimapEnabled: false,
      recentWorkspacePath: "/project/api",
      recentWorkspacePaths: ["/project/api"],
      runtimePolicy: "keepAlive",
      theme: "dark",
      userSnippets: [],
      workspaceTabs: ["/project/api/", "/project/web"],
    });
  });

  it("seeds recent workspace paths from the legacy single path", () => {
    expect(
      normalizeAppSettings({ recentWorkspacePath: "/legacy/project" })
        .recentWorkspacePaths,
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
    ).toEqual([
      "/one",
      "/two/",
      "/extra-0",
      "/extra-1",
      "/extra-2",
      "/extra-3",
      "/extra-4",
      "/extra-5",
      "/extra-6",
      "/extra-7",
    ]);
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
    expect(normalizeAppSettings({ recentWorkspacePath: 1 })).toEqual(
      defaultAppSettings(),
    );
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
    expect(normalizeAppSettings({ userSnippets: "nope" }).userSnippets).toEqual(
      [],
    );
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
        defaultInsertSpaces: false,
        defaultTabSize: 6,
        extraIgnorePatterns: ["vendor/generated", " var/cache ", "var/cache"],
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
        phpstanPath: " /tools/phpstan ",
        phpVersionOverride: "8.3",
        phpactorPath: " /tools/phpactor ",
        revealActiveFileInTree: false,
        session: {
          activePath: "/project/src/User.php",
          bottomPanelView: "history",
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
      defaultInsertSpaces: false,
      defaultTabSize: 6,
      extraIgnorePatterns: ["vendor/generated", "var/cache"],
      formatOnPaste: true,
      formatOnSave: true,
      gitCommitMessageHistory: [],
      gitDirectoryMappings: [
        "",
        "workbench/lcsk/attendance",
        "workbench/lcsk/x",
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
      phpstanPath: "/tools/phpstan",
      phpVersionOverride: "8.3",
      phpactorPath: "/tools/phpactor",
      revealActiveFileInTree: false,
      session: {
        activePath: "/project/src/User.php",
        bottomPanelView: "history",
        openPaths: ["/project/src/User.php", "/project/README.md"],
        sidebarView: "git",
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
      normalizeWorkspaceSettings({ gitDirectoryMappingsAuto: false })
        .gitDirectoryMappingsAuto,
    ).toBe(false);
    expect(
      normalizeWorkspaceSettings({ gitDirectoryMappings: "nope" })
        .gitDirectoryMappings,
    ).toEqual([]);
  });

  it("defaults formatOnSave to false and respects explicit boolean values", () => {
    expect(normalizeWorkspaceSettings({}).formatOnSave).toBe(false);
    expect(
      normalizeWorkspaceSettings({ formatOnSave: "yes" }).formatOnSave,
    ).toBe(false);
    expect(
      normalizeWorkspaceSettings({ formatOnSave: false }).formatOnSave,
    ).toBe(false);
    expect(
      normalizeWorkspaceSettings({ formatOnSave: true }).formatOnSave,
    ).toBe(true);
  });

  it("defaults optimizeImportsOnSave to false and respects explicit boolean values", () => {
    expect(normalizeWorkspaceSettings({}).optimizeImportsOnSave).toBe(false);
    expect(
      normalizeWorkspaceSettings({ optimizeImportsOnSave: "yes" })
        .optimizeImportsOnSave,
    ).toBe(false);
    expect(
      normalizeWorkspaceSettings({ optimizeImportsOnSave: true })
        .optimizeImportsOnSave,
    ).toBe(true);
    expect(
      normalizeWorkspaceSettings({ optimizeImportsOnSave: false })
        .optimizeImportsOnSave,
    ).toBe(false);
  });

  it("defaults JS/TS on-save source actions to false and respects explicit boolean values", () => {
    expect(
      normalizeWorkspaceSettings({}).javaScriptTypeScriptOrganizeImportsOnSave,
    ).toBe(false);
    expect(
      normalizeWorkspaceSettings({}).javaScriptTypeScriptRemoveUnusedOnSave,
    ).toBe(false);
    expect(
      normalizeWorkspaceSettings({})
        .javaScriptTypeScriptAddMissingImportsOnSave,
    ).toBe(false);
    expect(normalizeWorkspaceSettings({}).javaScriptTypeScriptFixAllOnSave).toBe(
      false,
    );
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
    expect(
      normalizeWorkspaceSettings({})
        .javaScriptTypeScriptImportModuleSpecifierEnding,
    ).toBe("auto");
    expect(
      normalizeWorkspaceSettings({})
        .javaScriptTypeScriptImportModuleSpecifierPreference,
    ).toBe("shortest");
    expect(normalizeWorkspaceSettings({}).javaScriptTypeScriptQuotePreference).toBe(
      "auto",
    );
    expect(
      normalizeWorkspaceSettings({}).javaScriptTypeScriptPreferTypeOnlyAutoImports,
    ).toBe(false);
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
    expect(
      normalizeWorkspaceSettings({})
        .javaScriptTypeScriptAutomaticTypeAcquisition,
    ).toBe(false);
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
    expect(
      normalizeWorkspaceSettings({ phpInlayHints: "yes" }).phpInlayHints,
    ).toBe(true);
    expect(
      normalizeWorkspaceSettings({ phpInlayHints: false }).phpInlayHints,
    ).toBe(false);
    expect(
      normalizeWorkspaceSettings({ phpInlayHints: true }).phpInlayHints,
    ).toBe(true);
  });

  it("defaults formatOnPaste to false and respects explicit boolean values", () => {
    expect(normalizeWorkspaceSettings({}).formatOnPaste).toBe(false);
    expect(
      normalizeWorkspaceSettings({ formatOnPaste: "yes" }).formatOnPaste,
    ).toBe(false);
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
  it("round trips preview and stable editor view positions", () => {
    expect(
      normalizeWorkspaceSession({
        activePath: "/project/src/User.php",
        bottomPanelView: "problems",
        openPaths: ["/project/src/User.php"],
        previewPath: "/project/src/User.php",
        sidebarView: "files",
        viewStates: {
          "/project/src/User.php": {
            column: 9,
            foldedLines: [3, 12],
            line: 14,
            scrollTop: 320.5,
          },
        },
      }),
    ).toEqual({
      activePath: "/project/src/User.php",
      bottomPanelView: "problems",
      openPaths: ["/project/src/User.php"],
      previewPath: "/project/src/User.php",
      sidebarView: "files",
      viewStates: {
        "/project/src/User.php": {
          column: 9,
          foldedLines: [3, 12],
          line: 14,
          scrollTop: 320.5,
        },
      },
    });
  });

  it("safely drops malformed optional session fidelity fields", () => {
    expect(
      normalizeWorkspaceSession({
        activePath: "/project/User.php",
        bottomPanelView: "problems",
        openPaths: ["/project/User.php"],
        previewPath: "/project/Missing.php",
        sidebarView: "files",
        viewStates: {
          "/project/BadLine.php": { column: 2, line: 0 },
          "/project/BadColumn.php": { column: "2", line: 3 },
          "/project/BadScroll.php": { column: 2, line: 3, scrollTop: -1 },
          "/project/User.php": {
            column: 2,
            foldedLines: [1, 0, -1, 2.5, "3", 4, null],
            line: 3,
          },
        },
      }),
    ).toEqual({
      activePath: "/project/User.php",
      bottomPanelView: "problems",
      openPaths: ["/project/User.php"],
      sidebarView: "files",
      viewStates: {
        "/project/User.php": { column: 2, foldedLines: [1, 4], line: 3 },
      },
    });

    expect(
      normalizeWorkspaceSession({
        activePath: "/project/User.php",
        bottomPanelView: "problems",
        openPaths: ["/project/User.php"],
        sidebarView: "files",
        viewStates: {
          "/project/User.php": {
            column: 2,
            foldedLines: { line: 3 },
            line: 3,
          },
        },
      }).viewStates,
    ).toEqual({
      "/project/User.php": { column: 2, line: 3 },
    });

    expect(
      normalizeWorkspaceSession({
        activePath: null,
        bottomPanelView: "problems",
        openPaths: [],
        sidebarView: "files",
      }),
    ).toEqual(defaultWorkspaceSessionState());
  });

  it("caps persisted folded lines", () => {
    const foldedLines = Array.from({ length: 600 }, (_, index) => index + 1);

    expect(
      normalizeWorkspaceSession({
        activePath: "/project/User.php",
        bottomPanelView: "problems",
        openPaths: ["/project/User.php"],
        sidebarView: "files",
        viewStates: {
          "/project/User.php": { column: 2, foldedLines, line: 3 },
        },
      }).viewStates?.["/project/User.php"]?.foldedLines,
    ).toEqual(foldedLines.slice(0, 500));
  });

  it("sorts and deduplicates persisted folded lines", () => {
    expect(
      normalizeWorkspaceSession({
        activePath: "/project/User.php",
        bottomPanelView: "problems",
        openPaths: ["/project/User.php"],
        sidebarView: "files",
        viewStates: {
          "/project/User.php": {
            column: 2,
            foldedLines: [3, 2, 2],
            line: 3,
          },
        },
      }).viewStates?.["/project/User.php"]?.foldedLines,
    ).toEqual([2, 3]);
  });

  it("accepts history as a valid stored bottom panel view", () => {
    expect(
      normalizeWorkspaceSession({
        activePath: "/project/src/User.php",
        bottomPanelView: "history",
        openPaths: ["/project/src/User.php"],
        sidebarView: "files",
      }),
    ).toEqual({
      activePath: "/project/src/User.php",
      bottomPanelView: "history",
      openPaths: ["/project/src/User.php"],
      sidebarView: "files",
    });
  });

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
      normalizeWorkspaceSettings({ gitCommitMessageHistory: "broken" })
        .gitCommitMessageHistory,
    ).toEqual([]);
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
