import { describe, expect, it } from "vitest";
import { BrowserSettingsGateway, type KeyValueStorage } from "./browserSettingsGateway";
import {
  defaultAgentNewThreadDefaults,
  type AgentNewThreadDefaults,
} from "../domain/agentNewThreadDefaults";
import {
  defaultKeymapSettings,
  detectKeymapPlatform,
  shortcutSequenceForPlatform,
} from "../domain/keymap";
import { KEYMAP_DEFAULTS_REVISION } from "../domain/keymapDefaultsMigration";
import {
  initialAgentWorkbenchLayout,
  serializeAgentWorkbenchLayout,
} from "../domain/agentWorkbenchLayout";
import { defaultAppSettings, defaultWorkspaceSettings } from "../domain/settings";
import { DEFAULT_APPEARANCE } from "../domain/appearance";

describe("BrowserSettingsGateway", () => {
  it("persists follow-up delivery preference and migrates missing or invalid values to queue", async () => {
    const storage = memoryStorage();
    const gateway = new BrowserSettingsGateway(storage);
    expect((await gateway.loadAppSettings()).agentFollowUpBehavior).toBe("queue");
    await gateway.saveAppSettings({ ...defaultAppSettings(), agentFollowUpBehavior: "steer" });
    expect(
      (await new BrowserSettingsGateway(storage).loadAppSettings()).agentFollowUpBehavior,
    ).toBe("steer");
    for (const value of [undefined, "invalid", null, 1, {}, []]) {
      storage.setItem("editor.settings.app", JSON.stringify({ agentFollowUpBehavior: value }));
      expect((await gateway.loadAppSettings()).agentFollowUpBehavior).toBe("queue");
    }
    await gateway.saveAppSettings({ ...defaultAppSettings(), agentFollowUpBehavior: "queue" });
    expect(
      (await new BrowserSettingsGateway(storage).loadAppSettings()).agentFollowUpBehavior,
    ).toBe("queue");
  });

  it("ignores an update channel persisted by an earlier build and never writes it back", async () => {
    const storage = memoryStorage();
    storage.setItem(
      "editor.settings.app",
      JSON.stringify({ appUpdateChannel: "stable", appUpdaterSkippedVersion: "0.2.0" }),
    );
    const gateway = new BrowserSettingsGateway(storage);

    const loaded = await gateway.loadAppSettings();

    expect(loaded).not.toHaveProperty("appUpdateChannel");
    expect(loaded.appUpdaterSkippedVersion).toBe("0.2.0");
    await gateway.saveAppSettings(loaded);
    expect(storage.getItem("editor.settings.app")).not.toContain("appUpdateChannel");
  });

  it("enables automatic CLI update checks for both providers on a fresh install", async () => {
    const gateway = new BrowserSettingsGateway(memoryStorage());

    await expect(gateway.loadAppSettings()).resolves.toMatchObject({
      agentProviderPreferences: {
        claudeCode: { checkForUpdates: true },
        codex: { checkForUpdates: true },
      },
    });
  });

  it("migrates old CLI update preferences for both providers and preserves them on reload", async () => {
    const storage = memoryStorage();
    const oldPreferences = {
      claudeCode: {
        enabled: true,
        checkForUpdates: false,
        healthCheckIntervalSeconds: 600,
        dismissedUpdateVersion: "2.1.245",
      },
      codex: {
        enabled: false,
        checkForUpdates: false,
        healthCheckIntervalSeconds: 0,
        dismissedUpdateVersion: "0.150.1",
      },
    };
    storage.setItem(
      "editor.settings.app",
      JSON.stringify({ ...defaultAppSettings(), agentProviderPreferences: oldPreferences }),
    );
    const gateway = new BrowserSettingsGateway(storage);
    const settings = await gateway.loadAppSettings();
    const expected = {
      claudeCode: { ...oldPreferences.claudeCode, checkForUpdates: true },
      codex: {
        ...oldPreferences.codex,
        checkForUpdates: true,
        codexTransport: "appServer",
        codexAppServerArgs: [],
      },
    };
    expect(settings.agentProviderPreferences).toEqual(expected);

    await gateway.saveAppSettings(settings);

    expect(JSON.parse(storage.getItem("editor.settings.app") ?? "{}")).toMatchObject({
      agentProviderPreferences: expected,
    });
    await expect(new BrowserSettingsGateway(storage).loadAppSettings()).resolves.toMatchObject({
      agentProviderPreferences: expected,
    });
  });

  it("round trips new thread defaults across save and reload", async () => {
    const storage = memoryStorage();
    const gateway = new BrowserSettingsGateway(storage);
    const agentNewThreadDefaults: AgentNewThreadDefaults = {
      source: "lastUsed",
      claudeCode: { model: "claude-opus-4-8", effort: "max" },
      codex: { model: "gpt-5.5", effort: "xhigh" },
    };
    expect((await gateway.loadAppSettings()).agentNewThreadDefaults).toEqual(
      defaultAgentNewThreadDefaults(),
    );

    await gateway.saveAppSettings({ ...defaultAppSettings(), agentNewThreadDefaults });

    expect(JSON.parse(storage.getItem("editor.settings.app") ?? "{}")).toMatchObject({
      agentNewThreadDefaults,
    });
    expect(
      (await new BrowserSettingsGateway(storage).loadAppSettings()).agentNewThreadDefaults,
    ).toEqual(agentNewThreadDefaults);
  });

  it("restores new thread defaults when a saved settings literal omits them", async () => {
    const storage = memoryStorage();
    const gateway = new BrowserSettingsGateway(storage);
    const { agentNewThreadDefaults: _omitted, ...legacySettings } = defaultAppSettings();

    await gateway.saveAppSettings(legacySettings);

    expect(storage.getItem("editor.settings.app")).not.toContain("agentNewThreadDefaults");
    expect((await gateway.loadAppSettings()).agentNewThreadDefaults).toEqual(
      defaultAgentNewThreadDefaults(),
    );
  });

  it("recovers only the stale part of persisted new thread defaults on reload", async () => {
    const storage = memoryStorage();
    storage.setItem(
      "editor.settings.app",
      JSON.stringify({
        agentNewThreadDefaults: {
          source: "lastUsed",
          claudeCode: { model: "opus", effort: "medium" },
          codex: { model: "GPT 5", effort: "high" },
        },
      }),
    );

    expect(
      (await new BrowserSettingsGateway(storage).loadAppSettings()).agentNewThreadDefaults,
    ).toEqual({
      source: "lastUsed",
      claudeCode: { model: "opus", effort: "medium" },
      codex: { model: "default", effort: "default" },
    });
  });

  it("round trips favorite models with their ordering revision across reload", async () => {
    const storage = memoryStorage();
    const gateway = new BrowserSettingsGateway(storage);
    const settings = {
      ...defaultAppSettings(),
      agentModelFavoriteKeys: ["claudeCode/opus", "codex/gpt-5.5"] as const,
      agentModelFavoritesRevision: 19,
    };

    await gateway.saveAppSettings(settings);

    await expect(gateway.loadAppSettings()).resolves.toMatchObject({
      agentModelFavoriteKeys: ["claudeCode/opus", "codex/gpt-5.5"],
      agentModelFavoritesRevision: 19,
    });
  });

  it("drops overrides of removed editor commands on load and never writes them back", async () => {
    const storage = memoryStorage();
    const gateway = new BrowserSettingsGateway(storage);
    const toggleSidebar = shortcutSequenceForPlatform("Cmd+Alt+B", detectKeymapPlatform());
    storage.setItem(
      "editor.settings.app",
      JSON.stringify({
        keymap: {
          ...defaultKeymapSettings(),
          "agent.toggleSidebar": toggleSidebar,
          "editor.foldAll": "Cmd+Shift+-",
          "editor.save": "Cmd+Alt+S",
          "editor.unfoldAll": "Cmd+Shift+=",
        },
        keymapDefaultsRevision: KEYMAP_DEFAULTS_REVISION,
      }),
    );

    const loaded = await gateway.loadAppSettings();

    expect(loaded.keymap).toEqual({
      ...defaultKeymapSettings(),
      "agent.toggleSidebar": toggleSidebar,
    });

    await gateway.saveAppSettings(loaded);
    const raw = storage.getItem("editor.settings.app") ?? "";

    expect(raw).not.toContain("editor.foldAll");
    expect(raw).not.toContain("editor.save");
    expect(raw).not.toContain("editor.unfoldAll");
    await expect(new BrowserSettingsGateway(storage).loadAppSettings()).resolves.toEqual(loaded);
  });

  it("recovers a corrupt favorite snapshot on reload", async () => {
    const storage = memoryStorage();
    const gateway = new BrowserSettingsGateway(storage);

    for (const snapshot of [
      {
        agentModelFavoriteKeys: ["claudeCode/unknown"],
        agentModelFavoritesRevision: Number.MAX_SAFE_INTEGER,
      },
      {
        agentModelFavoriteKeys: ["claudeCode/opus"],
        agentModelFavoritesRevision: "19",
      },
    ]) {
      storage.setItem("editor.settings.app", JSON.stringify(snapshot));
      await expect(gateway.loadAppSettings()).resolves.toMatchObject({
        agentModelFavoriteKeys: [],
        agentModelFavoritesRevision: 0,
      });
    }
  });

  it("isolates agent workbench sessions per project", async () => {
    const gateway = new BrowserSettingsGateway(memoryStorage());
    const sessionFor = (bottomPanel: boolean) => ({
      agentWorkbench: serializeAgentWorkbenchLayout(initialAgentWorkbenchLayout, bottomPanel),
      version: 1 as const,
    });

    await gateway.saveWorkspaceSettings("/project-a", {
      ...defaultWorkspaceSettings(),
      session: sessionFor(true),
    });
    await gateway.saveWorkspaceSettings("/project-b", {
      ...defaultWorkspaceSettings(),
      session: sessionFor(false),
    });

    await expect(gateway.loadWorkspaceSettings("/project-a")).resolves.toMatchObject({
      session: sessionFor(true),
    });
    await expect(gateway.loadWorkspaceSettings("/project-b")).resolves.toMatchObject({
      session: sessionFor(false),
    });
  });

  it("keeps agent state from a 0.2.0-beta.124 profile and drops every removed key on save", async () => {
    const storage = memoryStorage();
    const legacyWorkspaceKey = "editor.settings.workspace:%2Fprojects%2Fapi";
    const canonicalWorkspaceKey = "editor.settings.workspace:canonical:workspace-api";
    const identity = { canonicalKey: "workspace-api", legacyRawKeys: ["/projects/api"] };
    const toggleSidebar = shortcutSequenceForPlatform("Cmd+Alt+B", detectKeymapPlatform());
    const legacyApp = {
      agentCliKind: "codex",
      agentCliPaths: { claudeCode: "/usr/local/bin/claude", codex: "/usr/local/bin/codex" },
      agentFollowUpBehavior: "steer",
      agentThreadFontSize: 16,
      agentThreadNotifications: false,
      appUpdaterSkippedVersion: "0.2.0-beta.125",
      appearance: { palette: "ink-mint", colorScheme: "light", syntaxTheme: "ayuMirage" },
      editorFontFamily: "Fira Code",
      editorFontLigatures: true,
      editorFontSize: 13,
      keymap: {
        "agent.toggleSidebar": toggleSidebar,
        "editor.foldAll": "Cmd+K Cmd+0",
        "editor.save": "Cmd+Alt+S",
        "php.generateConstructor": "Cmd+Alt+G",
        "testing.runAtCursor": "Cmd+Alt+T",
      },
      keymapDefaultsRevision: KEYMAP_DEFAULTS_REVISION,
      maxConcurrentAgentTasks: 8,
      minimapEnabled: true,
      recentWorkspacePath: "/projects/api",
      recentWorkspacePaths: ["/projects/api", "/projects/web"],
      runtimePolicy: "singleActive",
      terminalShellIntegrationEnabled: true,
      userSnippets: [{ prefix: "dd", body: "dd($0);", description: "Dump", languages: ["php"] }],
      windowZoomLevel: 1,
      wordWrapEnabled: true,
      workspaceTabs: ["/projects/api", "/projects/web"],
    };
    const legacyAgentWorkbench = {
      layout: "agent",
      rightPanel: "open",
      openSurfaces: ["files", "terminal", "editor"],
      activeSurface: "terminal",
      rightPanelMaximized: false,
      rail: "expanded",
      bottomPanel: true,
      rightPanelWidth: 540,
      bottomPanelHeight: 280,
    };
    const legacyWorkspace = {
      agentIsolationPolicy: "worktree",
      autoSave: false,
      autoSaveConfigured: true,
      defaultInsertSpaces: false,
      defaultTabSize: 2,
      eslintAnalyseOnSave: true,
      eslintFixOnSave: true,
      eslintPath: "/tools/eslint",
      extraIgnorePatterns: ["var/cache"],
      formatOnPaste: true,
      formatOnSave: true,
      gitCommitMessageHistory: ["feat: keep history"],
      gitDirectoryMappings: ["", "packages/api"],
      gitDirectoryMappingsAuto: false,
      intelephensePath: "/tools/intelephense",
      intelligenceMode: "fullSmart",
      javaScriptTypeScriptAutoImports: false,
      javaScriptTypeScriptService: "off",
      javaScriptTypeScriptValidation: false,
      javaScriptTypeScriptVersion: "workspace",
      largeFileMode: { characterLimit: 512_000, lineLimit: 10_000 },
      optimizeImportsOnSave: true,
      phpBackend: "phpactor",
      phpInlayHints: false,
      phpVersionOverride: "8.3",
      phpactorPath: "/tools/phpactor",
      phpstanAnalyseOnSave: true,
      phpstanPath: "/tools/phpstan",
      prettierFormatOnSave: true,
      revealActiveFileInTree: false,
      session: {
        agentWorkbench: legacyAgentWorkbench,
        bottomPanelView: "problems",
        editor: {
          activeGroupId: "editor-main",
          groups: {
            "editor-main": {
              activePath: "/projects/api/src/app.ts",
              openPaths: ["/projects/api/src/app.ts"],
              previewPath: null,
            },
          },
          layout: { groupId: "editor-main", kind: "group" },
        },
        navigation: {
          backStack: [{ path: "/projects/api/src/app.ts", position: { column: 1, lineNumber: 2 } }],
          forwardStack: [],
          recentFiles: [{ name: "app.ts", path: "/projects/api/src/app.ts" }],
          recentLocations: [],
        },
        sidebarView: "php",
        version: 1,
        viewStates: {
          "editor-main": { "/projects/api/src/app.ts": { column: 1, line: 2, scrollTop: 0 } },
        },
      },
      statusBar: {
        agentAttention: false,
        cursorPosition: false,
        index: false,
        languageServer: false,
      },
    };
    storage.setItem("editor.settings.app", JSON.stringify(legacyApp));
    storage.setItem(legacyWorkspaceKey, JSON.stringify(legacyWorkspace));
    const gateway = new BrowserSettingsGateway(storage);

    const app = await gateway.loadAppSettings();
    const workspace = await gateway.loadWorkspaceSettings(identity);

    expect(app).toMatchObject({
      agentCliKind: "codex",
      agentCliPaths: { claudeCode: "/usr/local/bin/claude", codex: "/usr/local/bin/codex" },
      agentFollowUpBehavior: "steer",
      agentThreadFontSize: 16,
      agentThreadNotifications: false,
      appUpdaterSkippedVersion: "0.2.0-beta.125",
      appearance: { palette: "ink-mint", colorScheme: "light", syntaxTheme: "ayuMirage" },
      editorFontFamily: "Fira Code, monospace",
      editorFontLigatures: true,
      editorFontSize: 13,
      keymapDefaultsRevision: KEYMAP_DEFAULTS_REVISION,
      maxConcurrentAgentTasks: 64,
      recentWorkspacePath: "/projects/api",
      recentWorkspacePaths: ["/projects/api", "/projects/web"],
      runtimePolicy: "singleActive",
      terminalShellIntegrationEnabled: true,
      windowZoomLevel: 1,
      workspaceTabs: ["/projects/api", "/projects/web"],
    });
    expect(app.keymap).toEqual({
      ...defaultKeymapSettings(),
      "agent.toggleSidebar": toggleSidebar,
    });
    expect(workspace).toEqual({
      agentIsolationPolicy: "worktree",
      gitCommitMessageHistory: ["feat: keep history"],
      gitDirectoryMappings: ["", "packages/api"],
      gitDirectoryMappingsAuto: false,
      session: {
        agentWorkbench: {
          rightPanel: "open",
          openSurfaces: ["files", "terminal"],
          activeSurface: "terminal",
          rightPanelMaximized: false,
          rail: "expanded",
          railWidth: 256,
          rightPanelWidth: 540,
          bottomPanelHeight: 280,
          bottomPanel: true,
        },
        version: 1,
      },
      statusBar: { agentAttention: false },
    });

    await gateway.saveAppSettings(app);
    await gateway.saveWorkspaceSettings(identity, workspace);
    const savedApp = JSON.parse(storage.getItem("editor.settings.app") ?? "{}");
    const savedWorkspace = JSON.parse(storage.getItem(canonicalWorkspaceKey) ?? "{}");

    for (const removed of ["minimapEnabled", "wordWrapEnabled", "userSnippets"]) {
      expect(savedApp).not.toHaveProperty(removed);
    }
    expect(Object.keys(savedApp.keymap).filter((id) => !(id in defaultKeymapSettings()))).toEqual(
      [],
    );
    expect(Object.keys(savedWorkspace).sort()).toEqual([
      "agentIsolationPolicy",
      "gitCommitMessageHistory",
      "gitDirectoryMappings",
      "gitDirectoryMappingsAuto",
      "session",
      "statusBar",
    ]);
    expect(Object.keys(savedWorkspace.session).sort()).toEqual(["agentWorkbench", "version"]);
    expect(savedWorkspace.statusBar).toEqual({ agentAttention: false });
    expect(storage.getItem(legacyWorkspaceKey)).toBeNull();
    await expect(new BrowserSettingsGateway(storage).loadAppSettings()).resolves.toEqual(app);
    await expect(
      new BrowserSettingsGateway(storage).loadWorkspaceSettings(identity),
    ).resolves.toEqual(workspace);
  });

  it("keeps raw trailing-slash keys backward compatible", async () => {
    const storage = memoryStorage();
    const gateway = new BrowserSettingsGateway(storage);
    const settings = {
      ...defaultWorkspaceSettings(),
      gitCommitMessageHistory: ["m2"],
    };

    await gateway.saveWorkspaceSettings("/project/", settings);

    await expect(gateway.loadWorkspaceSettings("/project/")).resolves.toEqual(settings);
    await expect(gateway.loadWorkspaceSettings("/project")).resolves.toEqual(
      defaultWorkspaceSettings(),
    );
  });

  it("migrates direct-path settings when an alias is selected", async () => {
    const storage = memoryStorage();
    const directKey = "editor.settings.workspace:%2Freal%2Fproject";
    const aliasKey = "editor.settings.workspace:%2Falias%2Fproject";
    const canonicalKey = "editor.settings.workspace:canonical:workspace-1";
    const legacyValue = '{"gitCommitMessageHistory":["m2"],"futureSetting":{"enabled":true}}';
    storage.setItem(directKey, legacyValue);
    const gateway = new BrowserSettingsGateway(storage);

    const settings = await gateway.loadWorkspaceSettings({
      canonicalKey: "workspace-1",
      legacyRawKeys: ["/real/project", "/alias/project"],
    });

    expect(settings.gitCommitMessageHistory).toEqual(["m2"]);
    expect(storage.getItem(canonicalKey)).toBe(legacyValue);
    expect(storage.getItem(directKey)).toBeNull();
    expect(storage.getItem(aliasKey)).toBeNull();
  });

  it("migrates alias settings when the direct path is selected", async () => {
    const storage = memoryStorage();
    const directKey = "editor.settings.workspace:%2Freal%2Fproject";
    const aliasKey = "editor.settings.workspace:%2Falias%2Fproject";
    const canonicalKey = "editor.settings.workspace:canonical:workspace-1";
    const legacyValue = '{"gitCommitMessageHistory":["m2"],"unknown":true}';
    storage.setItem(aliasKey, legacyValue);
    const gateway = new BrowserSettingsGateway(storage);

    const settings = await gateway.loadWorkspaceSettings({
      canonicalKey: "workspace-1",
      legacyRawKeys: ["/real/project", "/alias/project"],
    });

    expect(settings.gitCommitMessageHistory).toEqual(["m2"]);
    expect(storage.getItem(canonicalKey)).toBe(legacyValue);
    expect(storage.getItem(directKey)).toBeNull();
    expect(storage.getItem(aliasKey)).toBeNull();
  });

  it("persists identity-aware saves under the canonical key", async () => {
    const storage = memoryStorage();
    const legacyKey = "editor.settings.workspace:%2Falias%2Fproject";
    const canonicalKey = "editor.settings.workspace:canonical:workspace-1";
    storage.setItem(legacyKey, JSON.stringify({ gitCommitMessageHistory: ["m8"] }));
    const gateway = new BrowserSettingsGateway(storage);
    const settings = {
      ...defaultWorkspaceSettings(),
      gitCommitMessageHistory: ["m2"],
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
    storage.setItem(canonicalKey, JSON.stringify({ gitCommitMessageHistory: ["m2"] }));
    storage.setItem(directKey, JSON.stringify({ gitCommitMessageHistory: ["m8"] }));
    storage.setItem(aliasKey, JSON.stringify({ gitCommitMessageHistory: ["m6"] }));
    const gateway = new BrowserSettingsGateway(storage);

    const settings = await gateway.loadWorkspaceSettings({
      canonicalKey: "workspace-1",
      legacyRawKeys: ["/real/project", "/alias/project"],
    });

    expect(settings.gitCommitMessageHistory).toEqual(["m2"]);
    expect(storage.getItem(directKey)).not.toBeNull();
    expect(storage.getItem(aliasKey)).not.toBeNull();
  });

  it("uses deterministic legacy precedence without deleting the collision loser", async () => {
    const storage = memoryStorage();
    const directKey = "editor.settings.workspace:%2Freal%2Fproject";
    const aliasKey = "editor.settings.workspace:%2Falias%2Fproject";
    storage.setItem(directKey, JSON.stringify({ gitCommitMessageHistory: ["m2"] }));
    storage.setItem(aliasKey, JSON.stringify({ gitCommitMessageHistory: ["m8"] }));
    const gateway = new BrowserSettingsGateway(storage);

    const settings = await gateway.loadWorkspaceSettings({
      canonicalKey: "workspace-1",
      legacyRawKeys: ["/real/project", "/alias/project"],
    });

    expect(settings.gitCommitMessageHistory).toEqual(["m2"]);
    expect(storage.getItem(directKey)).toBeNull();
    expect(storage.getItem(aliasKey)).not.toBeNull();
  });

  it("leaves malformed legacy settings untouched and migrates the next valid key", async () => {
    const storage = memoryStorage();
    const directKey = "editor.settings.workspace:%2Freal%2Fproject";
    const aliasKey = "editor.settings.workspace:%2Falias%2Fproject";
    const malformedValue = '{"gitCommitMessageHistory":["m2"]';
    const aliasValue = JSON.stringify({ gitCommitMessageHistory: ["m8"] });
    storage.setItem(directKey, malformedValue);
    storage.setItem(aliasKey, aliasValue);
    const gateway = new BrowserSettingsGateway(storage);

    const settings = await gateway.loadWorkspaceSettings({
      canonicalKey: "workspace-1",
      legacyRawKeys: ["/real/project", "/alias/project"],
    });

    expect(settings.gitCommitMessageHistory).toEqual(["m8"]);
    expect(storage.getItem(directKey)).toBe(malformedValue);
    expect(storage.getItem(aliasKey)).toBeNull();
    expect(storage.getItem("editor.settings.workspace:canonical:workspace-1")).toBe(aliasValue);
  });

  it("does not delete any legacy settings when the canonical migration write fails", async () => {
    const values = new Map<string, string>([
      [
        "editor.settings.workspace:%2Freal%2Fproject",
        JSON.stringify({ gitCommitMessageHistory: ["m2"] }),
      ],
      [
        "editor.settings.workspace:%2Falias%2Fproject",
        JSON.stringify({ gitCommitMessageHistory: ["m8"] }),
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
    expect(storage.getItem("editor.settings.workspace:%2Freal%2Fproject")).not.toBeNull();
    expect(storage.getItem("editor.settings.workspace:%2Falias%2Fproject")).not.toBeNull();
  });

  it("does not delete any legacy settings when a canonical save fails", async () => {
    const directKey = "editor.settings.workspace:%2Freal%2Fproject";
    const aliasKey = "editor.settings.workspace:%2Falias%2Fproject";
    const values = new Map<string, string>([
      [directKey, JSON.stringify({ gitCommitMessageHistory: ["m2"] })],
      [aliasKey, JSON.stringify({ gitCommitMessageHistory: ["m8"] })],
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

  it("reduces only the current transient session when quota is exhausted", async () => {
    const olderKey = "editor.settings.workspace:canonical:older";
    const currentKey = "editor.settings.workspace:canonical:current";
    const olderValue = JSON.stringify({
      ...defaultWorkspaceSettings(),
      gitCommitMessageHistory: ["m8"],
    });
    const values = new Map<string, string>([[olderKey, olderValue]]);
    const events: string[] = [];
    const storage: KeyValueStorage = {
      getItem: (key) => values.get(key) ?? null,
      removeItem: (key) => {
        events.push(`remove:${key}`);
        values.delete(key);
      },
      setItem: (key, value) => {
        const session = JSON.parse(value).session;
        events.push(session.agentWorkbench ? "write:session" : "write:default-session");
        if (session.agentWorkbench) {
          throw new DOMException("Quota exceeded", "QuotaExceededError");
        }
        values.set(key, value);
      },
    };
    const gateway = new BrowserSettingsGateway(storage);

    await expect(
      gateway.saveWorkspaceSettings(
        { canonicalKey: "current" },
        {
          ...defaultWorkspaceSettings(),
          session: {
            agentWorkbench: serializeAgentWorkbenchLayout(initialAgentWorkbenchLayout, true),
            version: 1,
          },
        },
      ),
    ).resolves.toBeUndefined();

    expect(values.get(olderKey)).toBe(olderValue);
    expect(values.has(currentKey)).toBe(true);
    expect(JSON.parse(values.get(currentKey) ?? "{}").session).toEqual(
      defaultWorkspaceSettings().session,
    );
    expect(events).toEqual(["write:session", "write:default-session"]);
  });

  it("preserves every workspace across A-B-A when all bounded current reductions exceed quota", async () => {
    const workspaceAKey = "editor.settings.workspace:canonical:workspace-a";
    const workspaceBKey = "editor.settings.workspace:canonical:workspace-b";
    const legacyKey = "editor.settings.workspace:%2Falias%2Fproject";
    const workspaceAValue = JSON.stringify({
      ...defaultWorkspaceSettings(),
      gitCommitMessageHistory: ["m2"],
    });
    const workspaceBValue = JSON.stringify({
      ...defaultWorkspaceSettings(),
      gitCommitMessageHistory: ["m6"],
    });
    const legacyValue = JSON.stringify({ gitCommitMessageHistory: ["m8"] });
    const values = new Map<string, string>([
      [workspaceAKey, workspaceAValue],
      [workspaceBKey, workspaceBValue],
      [legacyKey, legacyValue],
    ]);
    const removed: string[] = [];
    const storage: KeyValueStorage = {
      getItem: (key) => values.get(key) ?? null,
      removeItem: (key) => {
        removed.push(key);
        values.delete(key);
      },
      setItem: () => {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      },
    };
    const gateway = new BrowserSettingsGateway(storage);

    await expect(
      gateway.saveWorkspaceSettings(
        {
          canonicalKey: "workspace-b",
          legacyRawKeys: ["/alias/project"],
        },
        {
          ...defaultWorkspaceSettings(),
          gitCommitMessageHistory: ["m4"],
        },
      ),
    ).rejects.toMatchObject({ name: "QuotaExceededError" });

    expect(removed).toEqual([]);
    expect(values.get(workspaceAKey)).toBe(workspaceAValue);
    expect(values.get(workspaceBKey)).toBe(workspaceBValue);
    expect(values.get(legacyKey)).toBe(legacyValue);
    await expect(
      gateway.loadWorkspaceSettings({ canonicalKey: "workspace-a" }),
    ).resolves.toMatchObject({ gitCommitMessageHistory: ["m2"] });
    await expect(
      gateway.loadWorkspaceSettings({ canonicalKey: "workspace-b" }),
    ).resolves.toMatchObject({ gitCommitMessageHistory: ["m6"] });
    await expect(
      gateway.loadWorkspaceSettings({ canonicalKey: "workspace-a" }),
    ).resolves.toMatchObject({ gitCommitMessageHistory: ["m2"] });
  });

  it("returns defaults when settings are missing", async () => {
    const gateway = new BrowserSettingsGateway(memoryStorage());

    await expect(gateway.loadAppSettings()).resolves.toEqual({
      appUpdaterSkippedVersion: null,
      agentCliKind: "claudeCode",
      agentCliPaths: { claudeCode: null, codex: null },
      agentThreadFontSize: 15,
      agentFollowUpBehavior: "queue",
      agentThreadNotifications: true,
      agentModelFavoriteKeys: [],
      agentModelFavoritesRevision: 0,
      keymapDefaultsRevision: KEYMAP_DEFAULTS_REVISION,
      agentNewThreadDefaults: defaultAgentNewThreadDefaults(),
      agentProviderPreferences: defaultAppSettings().agentProviderPreferences,
      maxConcurrentAgentTasks: 64,
      editorFontFamily: "JetBrains Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      windowZoomLevel: 0,
      editorFontLigatures: false,
      editorFontSize: 14,
      keymap: defaultKeymapSettings(),
      recentWorkspacePath: null,
      recentWorkspacePaths: [],
      recentWorkspaceOpenedAt: {},
      lastCloneParentPath: null,
      runtimePolicy: "keepAlive",
      terminalShellIntegrationEnabled: false,
      appearance: DEFAULT_APPEARANCE,
      workspaceTabs: [],
    });
    await expect(gateway.loadWorkspaceSettings("/project")).resolves.toEqual({
      agentIsolationPolicy: "auto",
      gitCommitMessageHistory: [],
      gitDirectoryMappings: [],
      gitDirectoryMappingsAuto: true,
      session: { version: 1 },
      statusBar: { agentAttention: true },
    });
  });

  it("persists app and workspace settings", async () => {
    const storage = memoryStorage();
    const gateway = new BrowserSettingsGateway(storage);

    await gateway.saveAppSettings({
      appUpdaterSkippedVersion: null,
      agentCliPaths: { claudeCode: null, codex: null },
      agentThreadFontSize: 15,
      agentFollowUpBehavior: "queue",
      agentThreadNotifications: true,
      agentModelFavoriteKeys: [],
      agentModelFavoritesRevision: 0,
      keymapDefaultsRevision: KEYMAP_DEFAULTS_REVISION,
      agentNewThreadDefaults: defaultAgentNewThreadDefaults(),
      agentProviderPreferences: defaultAppSettings().agentProviderPreferences,
      agentCliKind: "claudeCode",
      maxConcurrentAgentTasks: 64,
      editorFontFamily: "Fira Code, monospace",
      windowZoomLevel: 0,
      editorFontLigatures: true,
      editorFontSize: 18,
      keymap: {
        ...defaultKeymapSettings(),
        "commands.show": "Cmd+Shift+S",
      },
      recentWorkspacePath: "/project",
      recentWorkspacePaths: ["/project"],
      runtimePolicy: "keepAlive",
      terminalShellIntegrationEnabled: true,
      appearance: { palette: "ink-mint", colorScheme: "light", syntaxTheme: "ayuMirage" },
      workspaceTabs: ["/project", "/another-project"],
    });
    const workspaceSettings = {
      agentIsolationPolicy: "in-place" as const,
      gitCommitMessageHistory: ["feat: persisted history"],
      gitDirectoryMappings: ["", "workbench/lcsk/attendance"],
      gitDirectoryMappingsAuto: false,
      session: {
        agentWorkbench: serializeAgentWorkbenchLayout(initialAgentWorkbenchLayout, true),
        version: 1 as const,
      },
      statusBar: { agentAttention: false },
    };
    await gateway.saveWorkspaceSettings("/project", workspaceSettings);

    await expect(gateway.loadAppSettings()).resolves.toEqual({
      appUpdaterSkippedVersion: null,
      agentCliKind: "claudeCode",
      agentCliPaths: { claudeCode: null, codex: null },
      agentThreadFontSize: 15,
      agentFollowUpBehavior: "queue",
      agentThreadNotifications: true,
      agentModelFavoriteKeys: [],
      agentModelFavoritesRevision: 0,
      keymapDefaultsRevision: KEYMAP_DEFAULTS_REVISION,
      agentNewThreadDefaults: defaultAgentNewThreadDefaults(),
      agentProviderPreferences: defaultAppSettings().agentProviderPreferences,
      maxConcurrentAgentTasks: 64,
      editorFontFamily: "Fira Code, monospace",
      windowZoomLevel: 0,
      editorFontLigatures: true,
      editorFontSize: 18,
      keymap: {
        ...defaultKeymapSettings(),
        "commands.show": "Cmd+Shift+S",
      },
      recentWorkspacePath: "/project",
      recentWorkspacePaths: ["/project"],
      recentWorkspaceOpenedAt: {},
      lastCloneParentPath: null,
      runtimePolicy: "keepAlive",
      terminalShellIntegrationEnabled: true,
      appearance: { palette: "ink-mint", colorScheme: "light", syntaxTheme: "ayuMirage" },
      workspaceTabs: ["/project", "/another-project"],
    });
    await expect(gateway.loadWorkspaceSettings("/project")).resolves.toEqual(workspaceSettings);
  });

  it("preserves hidden agent attention through saving and reloading a workspace", async () => {
    const storage = memoryStorage();
    const settings = defaultWorkspaceSettings();
    const identity = { canonicalKey: "/project" };

    await new BrowserSettingsGateway(storage).saveWorkspaceSettings(identity, {
      ...settings,
      statusBar: { ...settings.statusBar, agentAttention: false },
    });

    const reloaded = await new BrowserSettingsGateway(storage).loadWorkspaceSettings(identity);
    expect(reloaded.statusBar.agentAttention).toBe(false);
    expect(reloaded.statusBar).toEqual({ agentAttention: false });
  });

  it("reads the initial appearance synchronously with the same normaliser the loader uses", async () => {
    const storage = memoryStorage();
    const gateway = new BrowserSettingsGateway(storage);
    expect(gateway.readInitialAppearance()).toEqual(DEFAULT_APPEARANCE);

    storage.setItem("editor.settings.app", JSON.stringify({ theme: "oneLight" }));

    expect(gateway.readInitialAppearance()).toEqual((await gateway.loadAppSettings()).appearance);
    expect(gateway.readInitialAppearance()).toEqual({
      palette: "graphite-teal",
      colorScheme: "light",
      syntaxTheme: "oneLight",
    });
  });

  it("falls back to the default initial appearance when storage cannot be read", () => {
    const gateway = new BrowserSettingsGateway({
      ...memoryStorage(),
      getItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
    });

    expect(gateway.readInitialAppearance()).toEqual(DEFAULT_APPEARANCE);
  });

  it("falls back when persisted JSON is invalid", async () => {
    const storage = memoryStorage();
    storage.setItem("editor.settings.app", "{");
    storage.setItem("editor.settings.workspace:%2Fproject", "{");
    const gateway = new BrowserSettingsGateway(storage);

    await expect(gateway.loadAppSettings()).resolves.toEqual({
      appUpdaterSkippedVersion: null,
      agentCliKind: "claudeCode",
      agentCliPaths: { claudeCode: null, codex: null },
      agentThreadFontSize: 15,
      agentFollowUpBehavior: "queue",
      agentThreadNotifications: true,
      agentModelFavoriteKeys: [],
      agentModelFavoritesRevision: 0,
      keymapDefaultsRevision: KEYMAP_DEFAULTS_REVISION,
      agentNewThreadDefaults: defaultAgentNewThreadDefaults(),
      agentProviderPreferences: defaultAppSettings().agentProviderPreferences,
      maxConcurrentAgentTasks: 64,
      editorFontFamily: "JetBrains Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      windowZoomLevel: 0,
      editorFontLigatures: false,
      editorFontSize: 14,
      keymap: defaultKeymapSettings(),
      recentWorkspacePath: null,
      recentWorkspacePaths: [],
      recentWorkspaceOpenedAt: {},
      lastCloneParentPath: null,
      runtimePolicy: "keepAlive",
      terminalShellIntegrationEnabled: false,
      appearance: DEFAULT_APPEARANCE,
      workspaceTabs: [],
    });
    await expect(gateway.loadWorkspaceSettings("/project")).resolves.toEqual({
      agentIsolationPolicy: "auto",
      gitCommitMessageHistory: [],
      gitDirectoryMappings: [],
      gitDirectoryMappingsAuto: true,
      session: { version: 1 },
      statusBar: { agentAttention: true },
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
