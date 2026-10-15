import { describe, expect, it } from "vitest";
import {
  defaultAppSettings,
  defaultEditorFontSize,
  defaultWorkspaceSessionState,
  defaultWorkspaceSettings,
  MAX_RECENT_WORKSPACE_PATHS,
  maxEditorFontSize,
  minEditorFontSize,
  normalizeAppSettings,
  normalizeEditorFontSize,
  normalizeRecentWorkspacePaths,
  normalizeStatusBarItemVisibility,
  normalizeWorkspaceSession,
  normalizeWorkspaceSettings,
  isSettingsSection,
  parseSettingsSection,
  pushRecentWorkspacePath,
  WORKSPACE_SESSION_VERSION,
} from "./settings";
import { DEFAULT_APPEARANCE } from "./appearance";
import { initialAgentWorkbenchLayout, serializeAgentWorkbenchLayout } from "./agentWorkbenchLayout";
import {
  DEFAULT_AGENT_THREAD_FONT_SIZE,
  MAX_AGENT_THREAD_FONT_SIZE,
  MIN_AGENT_THREAD_FONT_SIZE,
} from "./agentSettings";
import { defaultAgentNewThreadDefaults } from "./agentNewThreadDefaults";
import { defaultAgentProviderPreferences } from "./agentProviderSettings";
import { defaultKeymapSettings } from "./keymap";
import { KEYMAP_DEFAULTS_REVISION } from "./keymapDefaultsMigration";

describe("settings defaults", () => {
  it("creates app and workspace defaults", () => {
    expect(defaultAppSettings()).toEqual({
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
      agentProviderPreferences: defaultAgentProviderPreferences(),
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
    expect(defaultWorkspaceSettings()).toEqual({
      agentIsolationPolicy: "auto",
      gitCommitMessageHistory: [],
      gitDirectoryMappings: [],
      gitDirectoryMappingsAuto: true,
      session: { version: 1 },
      statusBar: { agentAttention: true },
    });
    expect(defaultWorkspaceSessionState()).toEqual({ version: 1 });
  });

  it("normalizes the exact skipped application update version", () => {
    expect(
      normalizeAppSettings({ appUpdaterSkippedVersion: " 0.2.0 " }).appUpdaterSkippedVersion,
    ).toBe("0.2.0");
    expect(
      normalizeAppSettings({ appUpdaterSkippedVersion: "x".repeat(65) }).appUpdaterSkippedVersion,
    ).toBeNull();
  });

  it("ignores an update channel persisted by an earlier build", () => {
    const normalized = normalizeAppSettings({
      appUpdateChannel: "stable",
      appUpdaterSkippedVersion: "0.2.0",
    });

    expect(normalized).not.toHaveProperty("appUpdateChannel");
    expect(defaultAppSettings()).not.toHaveProperty("appUpdateChannel");
    expect(normalized.appUpdaterSkippedVersion).toBe("0.2.0");
  });
});

describe("normalizeAppSettings", () => {
  it("keeps thread notifications on unless they were explicitly turned off", () => {
    expect(normalizeAppSettings({}).agentThreadNotifications).toBe(true);
    expect(normalizeAppSettings({ agentThreadNotifications: false }).agentThreadNotifications).toBe(
      false,
    );
    expect(normalizeAppSettings({ agentThreadNotifications: "no" }).agentThreadNotifications).toBe(
      true,
    );
  });

  it("defaults new thread launches to the built-in model and effort per provider", () => {
    const expected = {
      source: "defaults",
      claudeCode: { model: "default", effort: "high" },
      codex: { model: "default", effort: "default" },
    };

    expect(defaultAppSettings().agentNewThreadDefaults).toEqual(expected);
    expect(normalizeAppSettings({}).agentNewThreadDefaults).toEqual(expected);
    expect(normalizeAppSettings(null).agentNewThreadDefaults).toEqual(expected);
  });

  it("round-trips persisted new thread defaults through serialization", () => {
    const agentNewThreadDefaults = {
      source: "lastUsed",
      claudeCode: { model: "claude-opus-4-8", effort: "xhigh" },
      codex: { model: "gpt-5.5", effort: "medium" },
    };
    const normalized = normalizeAppSettings({ agentNewThreadDefaults });

    expect(normalized.agentNewThreadDefaults).toEqual(agentNewThreadDefaults);
    expect(normalized.agentNewThreadDefaults).not.toBe(agentNewThreadDefaults);
    expect(
      normalizeAppSettings(JSON.parse(JSON.stringify(normalized))).agentNewThreadDefaults,
    ).toEqual(agentNewThreadDefaults);
  });

  it("fails malformed new thread defaults closed without touching other settings", () => {
    const normalized = normalizeAppSettings({
      agentFollowUpBehavior: "steer",
      agentNewThreadDefaults: {
        source: "lastUsed",
        claudeCode: { model: "claude-opus-4-8", effort: "xhigh" },
        codex: { model: "gpt-5.5", effort: "medium" },
        cursor: { model: "default", effort: "default" },
      },
    });

    expect(normalized.agentNewThreadDefaults).toEqual(defaultAgentNewThreadDefaults());
    expect(normalized.agentFollowUpBehavior).toBe("steer");
    for (const malformed of [null, "lastUsed", 1, [], { source: "lastUsed" }]) {
      expect(
        normalizeAppSettings({ agentNewThreadDefaults: malformed }).agentNewThreadDefaults,
      ).toEqual(defaultAgentNewThreadDefaults());
    }
  });

  it("keeps the valid provider default when the other provider default is stale", () => {
    expect(
      normalizeAppSettings({
        agentNewThreadDefaults: {
          source: "lastUsed",
          claudeCode: { model: "opus", effort: "medium" },
          codex: { model: "GPT 5", effort: "high" },
        },
      }).agentNewThreadDefaults,
    ).toEqual({
      source: "lastUsed",
      claudeCode: { model: "opus", effort: "medium" },
      codex: { model: "default", effort: "default" },
    });
  });

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
        codexTransport: "appServer",
        codexAppServerArgs: [],
        enabled: true,
        healthCheckIntervalSeconds: 86_400,
        checkForUpdates: true,
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
  it("migrates the legacy four-task limit to shared parallel thread capacity", () => {
    expect(normalizeAppSettings({ maxConcurrentAgentTasks: 4 }).maxConcurrentAgentTasks).toBe(64);
  });

  it("accepts valid persisted app settings", () => {
    expect(normalizeAppSettings({ recentWorkspacePath: "/project" })).toEqual({
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
      agentProviderPreferences: defaultAgentProviderPreferences(),
      maxConcurrentAgentTasks: 64,
      editorFontFamily: "JetBrains Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      windowZoomLevel: 0,
      editorFontLigatures: false,
      editorFontSize: 14,
      keymap: defaultKeymapSettings(),
      recentWorkspacePath: "/project",
      recentWorkspacePaths: ["/project"],
      recentWorkspaceOpenedAt: {},
      lastCloneParentPath: null,
      runtimePolicy: "keepAlive",
      terminalShellIntegrationEnabled: false,
      appearance: DEFAULT_APPEARANCE,
      workspaceTabs: ["/project"],
    });
    expect(
      normalizeAppSettings({
        editorFontFamily: "Fira Code",
        windowZoomLevel: 0,
        editorFontLigatures: true,
        editorFontSize: 18,
        keymap: { "commands.show": "Cmd+Shift+S" },
        recentWorkspacePath: null,
        runtimePolicy: "suspendOnBackground",
        theme: "light",
        workspaceTabs: ["/project-a", " /project-b ", "/project-a", 42],
      }),
    ).toEqual({
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
      agentProviderPreferences: defaultAgentProviderPreferences(),
      maxConcurrentAgentTasks: 64,
      editorFontFamily: "Fira Code, monospace",
      windowZoomLevel: 0,
      editorFontLigatures: true,
      editorFontSize: 18,
      keymap: {
        ...defaultKeymapSettings(),
        "commands.show": "Cmd+Shift+S",
      },
      recentWorkspacePath: null,
      recentWorkspacePaths: [],
      recentWorkspaceOpenedAt: {},
      lastCloneParentPath: null,
      runtimePolicy: "suspendOnBackground",
      terminalShellIntegrationEnabled: false,
      appearance: { palette: "graphite-teal", colorScheme: "light", syntaxTheme: "matchPalette" },
      workspaceTabs: ["/project-a", "/project-b"],
    });
    expect(
      normalizeAppSettings({
        recentWorkspacePath: null,
        theme: "ayuMirage",
      }),
    ).toEqual({
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
      agentProviderPreferences: defaultAgentProviderPreferences(),
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
      appearance: { palette: "graphite-teal", colorScheme: "dark", syntaxTheme: "ayuMirage" },
      workspaceTabs: [],
    });
  });

  it("normalizes a persisted appearance and drops the retired fields", () => {
    const settings = normalizeAppSettings({
      agentAppearanceVariant: "paper",
      appearance: { palette: "black-violet", colorScheme: "system", syntaxTheme: "oneLight" },
      theme: "dracula",
    });

    expect(settings.appearance).toEqual({
      palette: "black-violet",
      colorScheme: "system",
      syntaxTheme: "oneLight",
    });
    expect(settings).not.toHaveProperty("agentAppearanceVariant");
    expect(settings).not.toHaveProperty("theme");
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

  it("clamps and falls back the persisted agent thread font size", () => {
    expect(normalizeAppSettings({ agentThreadFontSize: 18 }).agentThreadFontSize).toBe(18);
    expect(normalizeAppSettings({ agentThreadFontSize: 100 }).agentThreadFontSize).toBe(
      MAX_AGENT_THREAD_FONT_SIZE,
    );
    expect(normalizeAppSettings({ agentThreadFontSize: 2 }).agentThreadFontSize).toBe(
      MIN_AGENT_THREAD_FONT_SIZE,
    );
    expect(normalizeAppSettings({ agentThreadFontSize: 16.7 }).agentThreadFontSize).toBe(16);
    expect(normalizeAppSettings({ agentThreadFontSize: "18" }).agentThreadFontSize).toBe(
      DEFAULT_AGENT_THREAD_FONT_SIZE,
    );
    expect(normalizeAppSettings({ agentThreadFontSize: Number.NaN }).agentThreadFontSize).toBe(
      DEFAULT_AGENT_THREAD_FONT_SIZE,
    );
    expect(normalizeAppSettings({}).agentThreadFontSize).toBe(DEFAULT_AGENT_THREAD_FONT_SIZE);
  });

  it("falls back persisted editor font family and ligatures when invalid", () => {
    expect(
      normalizeAppSettings({
        editorFontFamily: "  ",
        windowZoomLevel: 0,
        editorFontLigatures: "true",
      }),
    ).toEqual({
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
      agentProviderPreferences: defaultAgentProviderPreferences(),
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
    expect(
      normalizeAppSettings({
        editorFontFamily: 42,
        windowZoomLevel: 0,
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
      agentProviderPreferences: defaultAgentProviderPreferences(),
      maxConcurrentAgentTasks: 64,
      editorFontFamily: "JetBrains Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      windowZoomLevel: 0,
      editorFontLigatures: false,
      editorFontSize: 14,
      keymap: defaultKeymapSettings(),
      recentWorkspacePath: "/project/api",
      recentWorkspacePaths: ["/project/api"],
      recentWorkspaceOpenedAt: {},
      lastCloneParentPath: null,
      runtimePolicy: "keepAlive",
      terminalShellIntegrationEnabled: false,
      appearance: DEFAULT_APPEARANCE,
      workspaceTabs: ["/project/api/", "/project/web"],
    });
  });

  it("seeds recent workspace paths from the legacy single path", () => {
    expect(
      normalizeAppSettings({ recentWorkspacePath: "/legacy/project" }).recentWorkspacePaths,
    ).toEqual(["/legacy/project"]);
  });

  it("normalizes the last clone parent and recent workspace opened-at records", () => {
    const normalized = normalizeAppSettings({
      lastCloneParentPath: "/Users/dev/src/",
      recentWorkspaceOpenedAt: { "/project": 42, relative: 7, "/negative": -1 },
    });
    expect(normalized.lastCloneParentPath).toBe("/Users/dev/src");
    expect(normalized.recentWorkspaceOpenedAt).toEqual({ "/project": 42 });
    const repaired = normalizeAppSettings({
      lastCloneParentPath: "relative",
      recentWorkspaceOpenedAt: "x",
    });
    expect(repaired.lastCloneParentPath).toBeNull();
    expect(repaired.recentWorkspaceOpenedAt).toEqual({});
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
});

describe("keymap defaults revision", () => {
  const persistedWithRemovedCommands = {
    editorFontSize: 16,
    keymap: {
      ...defaultKeymapSettings(),
      "editor.foldAll": "Cmd+Shift+-",
      "editor.unfoldAll": "Cmd+Shift+=",
    },
  };

  function reloaded(settings: unknown): ReturnType<typeof normalizeAppSettings> {
    return normalizeAppSettings(JSON.parse(JSON.stringify(settings)));
  }

  it("stamps fresh and unreadable settings with the current revision", () => {
    expect(defaultAppSettings().keymapDefaultsRevision).toBe(KEYMAP_DEFAULTS_REVISION);
    expect(normalizeAppSettings(null).keymapDefaultsRevision).toBe(KEYMAP_DEFAULTS_REVISION);
    expect(normalizeAppSettings({}).keymapDefaultsRevision).toBe(KEYMAP_DEFAULTS_REVISION);
  });

  it("drops overrides of removed editor commands while settling the revision", () => {
    const migrated = normalizeAppSettings(persistedWithRemovedCommands);

    expect(migrated.keymap).toEqual(defaultKeymapSettings());
    expect(migrated.keymapDefaultsRevision).toBe(KEYMAP_DEFAULTS_REVISION);
    expect(migrated.editorFontSize).toBe(16);
    expect(reloaded(migrated)).toEqual(migrated);
  });

  it.each(["1", -1, 1.5, null, {}])(
    "treats the malformed persisted revision %j as never migrated",
    (keymapDefaultsRevision) => {
      const migrated = normalizeAppSettings({
        ...persistedWithRemovedCommands,
        keymapDefaultsRevision,
      });

      expect(migrated.keymap).toEqual(defaultKeymapSettings());
      expect(migrated.keymapDefaultsRevision).toBe(KEYMAP_DEFAULTS_REVISION);
    },
  );
});

describe("normalizeWorkspaceSettings", () => {
  it("accepts valid persisted workspace settings", () => {
    expect(
      normalizeWorkspaceSettings({
        agentIsolationPolicy: "worktree",
        gitCommitMessageHistory: [" first ", "second"],
        gitDirectoryMappings: [
          "workbench/lcsk/x",
          "",
          "workbench\\lcsk\\x",
          "workbench/lcsk/attendance",
          "../escape",
        ],
        gitDirectoryMappingsAuto: false,
        statusBar: { agentAttention: false },
      }),
    ).toEqual({
      agentIsolationPolicy: "worktree",
      gitCommitMessageHistory: ["first", "second"],
      gitDirectoryMappings: ["", "workbench/lcsk/attendance", "workbench/lcsk/x"],
      gitDirectoryMappingsAuto: false,
      session: { version: 1 },
      statusBar: { agentAttention: false },
    });
  });

  it("drops the retired editor header readouts when reading old settings", () => {
    expect(
      normalizeStatusBarItemVisibility({
        activePath: false,
        gitBranch: false,
        cursorPosition: false,
        message: true,
        index: false,
      }),
    ).toEqual({ agentAttention: true });
  });

  it.each([undefined, null, "false", 0, {}, []])(
    "defaults missing or invalid agent attention visibility to visible: %j",
    (agentAttention) => {
      expect(
        normalizeWorkspaceSettings({ statusBar: { agentAttention } }).statusBar.agentAttention,
      ).toBe(true);
    },
  );

  it.each([true, false])("preserves agent attention visibility: %s", (agentAttention) => {
    expect(
      normalizeWorkspaceSettings({ statusBar: { agentAttention } }).statusBar.agentAttention,
    ).toBe(agentAttention);
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

  it("falls back for invalid workspace settings", () => {
    expect(
      normalizeWorkspaceSettings({
        agentIsolationPolicy: "sometimes",
        gitCommitMessageHistory: "broken",
        gitDirectoryMappings: 7,
        gitDirectoryMappingsAuto: "yes",
        statusBar: [],
      }),
    ).toEqual(defaultWorkspaceSettings());
    expect(normalizeWorkspaceSettings(null)).toEqual(defaultWorkspaceSettings());
  });
});

describe("normalizeWorkspaceSession", () => {
  it("keeps the agent workbench and drops the retired editor session fields", () => {
    const agentWorkbench = serializeAgentWorkbenchLayout(initialAgentWorkbenchLayout, true);
    const normalized = normalizeWorkspaceSession({
      agentWorkbench,
      bottomPanelView: "problems",
      editor: {
        activeGroupId: "editor-main",
        groups: { "editor-main": { activePath: "/p/A.ts", openPaths: ["/p/A.ts"] } },
        layout: { groupId: "editor-main", kind: "group" },
      },
      navigation: { backStack: [], forwardStack: [], recentFiles: [], recentLocations: [] },
      sidebarView: "git",
      version: WORKSPACE_SESSION_VERSION,
      viewStates: { "editor-main": { "/p/A.ts": { column: 1, line: 2 } } },
    });

    expect(normalized).toEqual({ agentWorkbench, version: WORKSPACE_SESSION_VERSION });
  });

  it("keeps the agent workbench of a legacy unversioned session", () => {
    const agentWorkbench = serializeAgentWorkbenchLayout(initialAgentWorkbenchLayout, false);

    expect(
      normalizeWorkspaceSession({ agentWorkbench, openPaths: ["/p/A.ts"], activePath: "/p/A.ts" }),
    ).toEqual({ agentWorkbench, version: WORKSPACE_SESSION_VERSION });
  });

  it("keeps the session version at 1", () => {
    expect(WORKSPACE_SESSION_VERSION).toBe(1);
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
      rightPanel: "open",
      openSurfaces: ["diff"],
      activeSurface: "diff",
      rightPanelMaximized: false,
      rail: "expanded",
      railWidth: 256,
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
      rightPanel: "open",
      openSurfaces: ["files", "terminal"],
      activeSurface: "terminal",
      rightPanelMaximized: true,
      rail: "expanded",
      railWidth: 256,
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
      rightPanel: "closed",
      openSurfaces: ["files", "terminal"],
      activeSurface: "terminal",
      rightPanelMaximized: false,
      rail: "expanded",
      railWidth: 256,
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

describe("parseSettingsSection", () => {
  it.each([
    "general",
    "keymap",
    "git",
    "appearance",
    "agents",
    "environments",
    "mcp",
    "usage",
    "archive",
  ])("accepts the kept section %s", (section) => {
    expect(isSettingsSection(section)).toBe(true);
    expect(parseSettingsSection(section)).toBe(section);
  });

  it.each(["php", "snippets", "index", "", "General", null, undefined, 3, {}])(
    "falls back to general for the unknown section %j",
    (section) => {
      expect(isSettingsSection(section)).toBe(false);
      expect(parseSettingsSection(section)).toBe("general");
    },
  );
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
