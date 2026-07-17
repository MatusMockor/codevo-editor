import { describe, expect, it } from "vitest";
import {
  BrowserSettingsGateway,
  type KeyValueStorage,
} from "./browserSettingsGateway";
import { defaultKeymapSettings } from "../domain/keymap";
import {
  LARGE_SMART_DOCUMENT_CHARACTER_LIMIT,
  LARGE_SMART_DOCUMENT_LINE_LIMIT,
} from "../domain/largeDocumentPolicy";
import { defaultWorkspaceSettings } from "../domain/settings";

describe("BrowserSettingsGateway", () => {
  it("isolates split sessions per project even when group IDs match", async () => {
    const gateway = new BrowserSettingsGateway(memoryStorage());
    const sessionFor = (path: string) => ({
      bottomPanelView: "problems" as const,
      editor: {
        activeGroupId: "main",
        groups: {
          main: { activePath: path, openPaths: [path], previewPath: null },
        },
        layout: { kind: "group" as const, groupId: "main" },
      },
      sidebarView: "files" as const,
      version: 1 as const,
    });

    await gateway.saveWorkspaceSettings("/project-a", {
      ...defaultWorkspaceSettings(),
      session: sessionFor("/project-a/A.ts"),
    });
    await gateway.saveWorkspaceSettings("/project-b", {
      ...defaultWorkspaceSettings(),
      session: sessionFor("/project-b/B.ts"),
    });

    await expect(gateway.loadWorkspaceSettings("/project-a"))
      .resolves.toMatchObject({ session: sessionFor("/project-a/A.ts") });
    await expect(gateway.loadWorkspaceSettings("/project-b"))
      .resolves.toMatchObject({ session: sessionFor("/project-b/B.ts") });
  });

  it("migrates and round trips a legacy flat session as version one", async () => {
    const storage = memoryStorage();
    const key = "editor.settings.workspace:%2Flegacy";
    storage.setItem(key, JSON.stringify({
      session: {
        activePath: "/legacy/Preview.ts",
        bottomPanelView: "history",
        openPaths: ["/legacy/A.ts", "/legacy/Preview.ts"],
        previewPath: "/legacy/Preview.ts",
        sidebarView: "git",
      },
    }));
    const gateway = new BrowserSettingsGateway(storage);
    const settings = await gateway.loadWorkspaceSettings("/legacy");

    expect(settings.session).toMatchObject({
      version: 1,
      editor: {
        groups: {
          "editor-main": {
            activePath: "/legacy/Preview.ts",
            openPaths: ["/legacy/A.ts"],
            previewPath: "/legacy/Preview.ts",
          },
        },
      },
    });

    await gateway.saveWorkspaceSettings("/legacy", settings);
    expect(JSON.parse(storage.getItem(key) ?? "{}").session).toEqual(
      settings.session,
    );
  });

  it("keeps raw trailing-slash keys backward compatible", async () => {
    const storage = memoryStorage();
    const gateway = new BrowserSettingsGateway(storage);
    const settings = {
      ...defaultWorkspaceSettings(),
      defaultTabSize: 2,
    };

    await gateway.saveWorkspaceSettings("/project/", settings);

    await expect(gateway.loadWorkspaceSettings("/project/")).resolves.toEqual(
      settings,
    );
    await expect(gateway.loadWorkspaceSettings("/project")).resolves.toEqual(
      defaultWorkspaceSettings(),
    );
  });

  it("migrates direct-path settings when an alias is selected", async () => {
    const storage = memoryStorage();
    const directKey = "editor.settings.workspace:%2Freal%2Fproject";
    const aliasKey = "editor.settings.workspace:%2Falias%2Fproject";
    const canonicalKey = "editor.settings.workspace:canonical:workspace-1";
    const legacyValue =
      '{"defaultTabSize":2,"futureSetting":{"enabled":true}}';
    storage.setItem(directKey, legacyValue);
    const gateway = new BrowserSettingsGateway(storage);

    const settings = await gateway.loadWorkspaceSettings({
      canonicalKey: "workspace-1",
      legacyRawKeys: ["/real/project", "/alias/project"],
    });

    expect(settings.defaultTabSize).toBe(2);
    expect(storage.getItem(canonicalKey)).toBe(legacyValue);
    expect(storage.getItem(directKey)).toBeNull();
    expect(storage.getItem(aliasKey)).toBeNull();
  });

  it("migrates alias settings when the direct path is selected", async () => {
    const storage = memoryStorage();
    const directKey = "editor.settings.workspace:%2Freal%2Fproject";
    const aliasKey = "editor.settings.workspace:%2Falias%2Fproject";
    const canonicalKey = "editor.settings.workspace:canonical:workspace-1";
    const legacyValue = '{"defaultTabSize":2,"unknown":true}';
    storage.setItem(aliasKey, legacyValue);
    const gateway = new BrowserSettingsGateway(storage);

    const settings = await gateway.loadWorkspaceSettings({
      canonicalKey: "workspace-1",
      legacyRawKeys: ["/real/project", "/alias/project"],
    });

    expect(settings.defaultTabSize).toBe(2);
    expect(storage.getItem(canonicalKey)).toBe(legacyValue);
    expect(storage.getItem(directKey)).toBeNull();
    expect(storage.getItem(aliasKey)).toBeNull();
  });

  it("persists identity-aware saves under the canonical key", async () => {
    const storage = memoryStorage();
    const legacyKey = "editor.settings.workspace:%2Falias%2Fproject";
    const canonicalKey =
      "editor.settings.workspace:canonical:workspace-1";
    storage.setItem(legacyKey, JSON.stringify({ defaultTabSize: 8 }));
    const gateway = new BrowserSettingsGateway(storage);
    const settings = {
      ...defaultWorkspaceSettings(),
      defaultTabSize: 2,
    };

    await gateway.saveWorkspaceSettings(
      {
        canonicalKey: "workspace-1",
        legacyRawKeys: ["/real/project", "/alias/project"],
      },
      settings,
    );

    expect(JSON.parse(storage.getItem(canonicalKey) ?? "{}")).toEqual(settings);
    expect(storage.getItem(legacyKey)).toBeNull();
  });

  it("keeps legacy keys untouched when canonical settings already exist", async () => {
    const storage = memoryStorage();
    const canonicalKey = "editor.settings.workspace:canonical:workspace-1";
    const directKey = "editor.settings.workspace:%2Freal%2Fproject";
    const aliasKey = "editor.settings.workspace:%2Falias%2Fproject";
    storage.setItem(canonicalKey, JSON.stringify({ defaultTabSize: 2 }));
    storage.setItem(directKey, JSON.stringify({ defaultTabSize: 8 }));
    storage.setItem(aliasKey, JSON.stringify({ defaultTabSize: 6 }));
    const gateway = new BrowserSettingsGateway(storage);

    const settings = await gateway.loadWorkspaceSettings({
      canonicalKey: "workspace-1",
      legacyRawKeys: ["/real/project", "/alias/project"],
    });

    expect(settings.defaultTabSize).toBe(2);
    expect(storage.getItem(directKey)).not.toBeNull();
    expect(storage.getItem(aliasKey)).not.toBeNull();
  });

  it("uses deterministic legacy precedence without deleting the collision loser", async () => {
    const storage = memoryStorage();
    const directKey = "editor.settings.workspace:%2Freal%2Fproject";
    const aliasKey = "editor.settings.workspace:%2Falias%2Fproject";
    storage.setItem(directKey, JSON.stringify({ defaultTabSize: 2 }));
    storage.setItem(aliasKey, JSON.stringify({ defaultTabSize: 8 }));
    const gateway = new BrowserSettingsGateway(storage);

    const settings = await gateway.loadWorkspaceSettings({
      canonicalKey: "workspace-1",
      legacyRawKeys: ["/real/project", "/alias/project"],
    });

    expect(settings.defaultTabSize).toBe(2);
    expect(storage.getItem(directKey)).toBeNull();
    expect(storage.getItem(aliasKey)).not.toBeNull();
  });

  it("leaves malformed legacy settings untouched and migrates the next valid key", async () => {
    const storage = memoryStorage();
    const directKey = "editor.settings.workspace:%2Freal%2Fproject";
    const aliasKey = "editor.settings.workspace:%2Falias%2Fproject";
    const malformedValue = '{"defaultTabSize":2';
    const aliasValue = JSON.stringify({ defaultTabSize: 8 });
    storage.setItem(directKey, malformedValue);
    storage.setItem(aliasKey, aliasValue);
    const gateway = new BrowserSettingsGateway(storage);

    const settings = await gateway.loadWorkspaceSettings({
      canonicalKey: "workspace-1",
      legacyRawKeys: ["/real/project", "/alias/project"],
    });

    expect(settings.defaultTabSize).toBe(8);
    expect(storage.getItem(directKey)).toBe(malformedValue);
    expect(storage.getItem(aliasKey)).toBeNull();
    expect(storage.getItem("editor.settings.workspace:canonical:workspace-1"))
      .toBe(aliasValue);
  });

  it("does not delete any legacy settings when the canonical migration write fails", async () => {
    const values = new Map<string, string>([
      [
        "editor.settings.workspace:%2Freal%2Fproject",
        JSON.stringify({ defaultTabSize: 2 }),
      ],
      [
        "editor.settings.workspace:%2Falias%2Fproject",
        JSON.stringify({ defaultTabSize: 8 }),
      ],
    ]);
    const storage: KeyValueStorage = {
      getItem: (key) => values.get(key) ?? null,
      removeItem: (key) => values.delete(key),
      setItem: () => {
        throw new Error("quota exceeded");
      },
    };
    const gateway = new BrowserSettingsGateway(storage);

    await expect(
      gateway.loadWorkspaceSettings({
        canonicalKey: "workspace-1",
        legacyRawKeys: ["/real/project", "/alias/project"],
      }),
    ).rejects.toThrow("quota exceeded");
    expect(storage.getItem("editor.settings.workspace:%2Freal%2Fproject"))
      .not.toBeNull();
    expect(storage.getItem("editor.settings.workspace:%2Falias%2Fproject"))
      .not.toBeNull();
  });

  it("does not delete any legacy settings when a canonical save fails", async () => {
    const directKey = "editor.settings.workspace:%2Freal%2Fproject";
    const aliasKey = "editor.settings.workspace:%2Falias%2Fproject";
    const values = new Map<string, string>([
      [directKey, JSON.stringify({ defaultTabSize: 2 })],
      [aliasKey, JSON.stringify({ defaultTabSize: 8 })],
    ]);
    const storage: KeyValueStorage = {
      getItem: (key) => values.get(key) ?? null,
      removeItem: (key) => values.delete(key),
      setItem: () => {
        throw new Error("quota exceeded");
      },
    };
    const gateway = new BrowserSettingsGateway(storage);

    await expect(
      gateway.saveWorkspaceSettings(
        {
          canonicalKey: "workspace-1",
          legacyRawKeys: ["/real/project", "/alias/project"],
        },
        defaultWorkspaceSettings(),
      ),
    ).rejects.toThrow("quota exceeded");
    expect(storage.getItem(directKey)).not.toBeNull();
    expect(storage.getItem(aliasKey)).not.toBeNull();
  });

  it("returns defaults when settings are missing", async () => {
    const gateway = new BrowserSettingsGateway(memoryStorage());

    await expect(gateway.loadAppSettings()).resolves.toEqual({
      editorFontFamily:
        "JetBrains Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
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
    await expect(gateway.loadWorkspaceSettings("/project")).resolves.toEqual({
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
  });

  it("persists app and workspace settings", async () => {
    const storage = memoryStorage();
    const gateway = new BrowserSettingsGateway(storage);

    await gateway.saveAppSettings({
      editorFontFamily: "Fira Code, monospace",
      editorFontLigatures: true,
      editorFontSize: 18,
      keymap: {
        ...defaultKeymapSettings(),
        "editor.save": "Cmd+Shift+S",
      },
      minimapEnabled: false,
      recentWorkspacePath: "/project",
      recentWorkspacePaths: ["/project"],
      runtimePolicy: "keepAlive",
      terminalShellIntegrationEnabled: true,
      theme: "ayuMirage",
      wordWrapEnabled: true,
      userSnippets: [
        {
          prefix: "myhelper",
          body: "helper($0);",
          description: "Call helper",
          languages: ["php"],
        },
      ],
      workspaceTabs: ["/project", "/another-project"],
    });
    await gateway.saveWorkspaceSettings("/project", {
      autoSave: true,
      autoSaveConfigured: true,
      defaultInsertSpaces: false,
      defaultTabSize: 8,
      extraIgnorePatterns: ["var/cache"],
      eslintAnalyseOnSave: true,
      eslintFixOnSave: true,
      eslintPath: "/tools/eslint",
      formatOnPaste: true,
      formatOnSave: true,
      gitCommitMessageHistory: ["feat: persisted history"],
      gitDirectoryMappings: ["", "workbench/lcsk/attendance"],
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
      javaScriptTypeScriptImportModuleSpecifierPreference: "non-relative",
      javaScriptTypeScriptInlayHints: false,
      javaScriptTypeScriptOrganizeImportsOnSave: true,
      javaScriptTypeScriptPreferTypeOnlyAutoImports: true,
      javaScriptTypeScriptQuotePreference: "double",
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
      phpInlayHints: true,
      phpstanAnalyseOnSave: true,
      phpstanPath: "/tools/phpstan",
      phpVersionOverride: "8.2",
      phpactorPath: "/tools/phpactor",
      prettierFormatOnSave: true,
      revealActiveFileInTree: false,
      session: {
        bottomPanelView: "index",
        editor: {
          activeGroupId: "main",
          groups: {
            main: {
              activePath: "/project/src/User.php",
              openPaths: ["/project/src/User.php", "/project/README.md"],
              previewPath: null,
            },
          },
          layout: { groupId: "main", kind: "group" },
        },
        sidebarView: "php",
        version: 1,
      },
      statusBar: {
        activePath: true,
        cursorPosition: true,
        dirtyCount: true,
        gitBranch: true,
        index: false,
        language: true,
        largeFileMode: true,
        languageServer: true,
        message: true,
        mode: true,
        workspaceInfo: false,
        workspaceTrust: true,
      },
    });

    await expect(gateway.loadAppSettings()).resolves.toEqual({
      editorFontFamily: "Fira Code, monospace",
      editorFontLigatures: true,
      editorFontSize: 18,
      keymap: {
        ...defaultKeymapSettings(),
        "editor.save": "Cmd+Shift+S",
      },
      minimapEnabled: false,
      recentWorkspacePath: "/project",
      recentWorkspacePaths: ["/project"],
      runtimePolicy: "keepAlive",
      terminalShellIntegrationEnabled: true,
      theme: "ayuMirage",
      wordWrapEnabled: true,
      userSnippets: [
        {
          prefix: "myhelper",
          body: "helper($0);",
          description: "Call helper",
          languages: ["php"],
        },
      ],
      workspaceTabs: ["/project", "/another-project"],
    });
    await expect(gateway.loadWorkspaceSettings("/project")).resolves.toEqual({
      autoSave: true,
      autoSaveConfigured: true,
      defaultInsertSpaces: false,
      defaultTabSize: 8,
      extraIgnorePatterns: ["var/cache"],
      eslintAnalyseOnSave: true,
      eslintFixOnSave: true,
      eslintPath: "/tools/eslint",
      formatOnPaste: true,
      formatOnSave: true,
      gitCommitMessageHistory: ["feat: persisted history"],
      gitDirectoryMappings: ["", "workbench/lcsk/attendance"],
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
      javaScriptTypeScriptImportModuleSpecifierPreference: "non-relative",
      javaScriptTypeScriptInlayHints: false,
      javaScriptTypeScriptOrganizeImportsOnSave: true,
      javaScriptTypeScriptPreferTypeOnlyAutoImports: true,
      javaScriptTypeScriptQuotePreference: "double",
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
      phpInlayHints: true,
      phpstanAnalyseOnSave: true,
      phpstanPath: "/tools/phpstan",
      phpVersionOverride: "8.2",
      phpactorPath: "/tools/phpactor",
      prettierFormatOnSave: true,
      revealActiveFileInTree: false,
      session: {
        bottomPanelView: "index",
        editor: {
          activeGroupId: "main",
          groups: {
            main: {
              activePath: "/project/src/User.php",
              openPaths: ["/project/src/User.php", "/project/README.md"],
              previewPath: null,
            },
          },
          layout: { groupId: "main", kind: "group" },
        },
        sidebarView: "php",
        version: 1,
      },
      statusBar: {
        activePath: true,
        cursorPosition: true,
        dirtyCount: true,
        gitBranch: true,
        index: false,
        language: true,
        largeFileMode: true,
        languageServer: true,
        message: true,
        mode: true,
        workspaceInfo: false,
        workspaceTrust: true,
      },
    });
  });

  it("falls back when persisted JSON is invalid", async () => {
    const storage = memoryStorage();
    storage.setItem("editor.settings.app", "{");
    storage.setItem("editor.settings.workspace:%2Fproject", "{");
    const gateway = new BrowserSettingsGateway(storage);

    await expect(gateway.loadAppSettings()).resolves.toEqual({
      editorFontFamily:
        "JetBrains Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
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
    await expect(gateway.loadWorkspaceSettings("/project")).resolves.toEqual({
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
  });
});

function memoryStorage(): KeyValueStorage {
  const values = new Map<string, string>();

  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}
