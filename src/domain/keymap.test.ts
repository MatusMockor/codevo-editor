import { afterEach, describe, expect, it } from "vitest";
import {
  __resetKeymapPlatformCacheForTests,
  collectBareKeyShortcutKeys,
  defaultKeymapSettings,
  defaultShortcutForCommand,
  detectKeymapPlatform,
  eventCanMatchKeymapShortcut,
  findKeymapConflicts,
  findKeymapSequenceConflicts,
  isKeymapCommandId,
  keymapCommandIdForShortcut,
  keymapCommandIdsForShortcut,
  keymapCommands,
  matchesShortcut,
  normalizeKeymapSettings,
  normalizeShortcutInput,
  parseShortcut,
  shortcutFromKeyboardEvent,
} from "./keymap";

const KEYMAP_COMMAND_IDS = [
  "app.quit",
  "workbench.closeActive",
  "workbench.zoomIn",
  "workbench.zoomOut",
  "workbench.zoomReset",
  "git.switchBranch",
  "git.newBranch",
  "git.commit",
  "file.quickOpen",
  "commands.show",
  "workbench.openSettings",
  "workbench.openAppearanceSettings",
  "workspace.nextTab",
  "workspace.previousTab",
  "panel.toggle",
  "terminal.show",
  "agent.newThread",
  "agent.newThreadIn",
  "agent.previousThread",
  "agent.nextThread",
  "agent.jumpToThread.1",
  "agent.jumpToThread.2",
  "agent.jumpToThread.3",
  "agent.jumpToThread.4",
  "agent.jumpToThread.5",
  "agent.jumpToThread.6",
  "agent.jumpToThread.7",
  "agent.jumpToThread.8",
  "agent.jumpToThread.9",
  "agent.searchThreads",
  "agent.findInThread",
  "agent.goToTurn",
  "agent.toggleRightPanel",
  "agent.toggleSidebar",
  "agent.openFilesSurface",
  "agent.openDiffSurface",
  "agent.openTerminalSurface",
  "agent.runPreferredScript",
  "agent.openCommitMenu",
  "agent.toggleDictation",
  "project.add",
  "palette.open",
  "palette.shortcuts",
  "panel.toggleMaximized",
];

const REMOVED_COMMAND_PREFIXES = [
  "editor.",
  "testing.",
  "typescript.",
  "javascript.",
  "php.",
  "pint.",
  "navigation.",
  "bookmark.",
];

const REMOVED_COMMAND_IDS = [
  "class.quickOpen",
  "artisan.make",
  "markdown.openPreview",
  "search.text",
  "panel.toggleTodo",
  "panel.showProblems",
  "npm.runSelectedScript",
  "workbench.searchEverywhere",
  "runtime.show",
  "file.new",
  "git.cherryPickCommit",
  "git.rewordCommit",
  "git.revertCommit",
  "git.stashChanges",
  "git.showStashes",
];

const LEGACY_EDITOR_KEYMAP = {
  "editor.save": "Cmd+S",
  "editor.closeTab": "Cmd+Shift+W",
  "editor.goToDefinition": "F12",
  "editor.fontZoomIn": "Cmd+=",
  "editor.foldAll": "Cmd+Shift+-",
  "editor.nextRecentlyUsedEditor": "Ctrl+Tab",
  "testing.runAtCursor": "Cmd+; C",
  "php.runTest": "Cmd+Shift+T",
  "bookmark.toggle": "F11",
  "navigation.back": "Cmd+[",
  "panel.showProblems": "Cmd+Shift+M",
  "agent.toggleRightPanel": "Cmd+Alt+Shift+R",
  "agent.findInThread": "Cmd+Shift+F",
  "palette.open": "Cmd+Alt+K",
  "git.commit": "Cmd+Alt+Enter",
  "git.cherryPickCommit": "Cmd+Alt+=",
  "git.rewordCommit": "Cmd+Alt+-",
  "git.stashChanges": "Cmd+Shift+S",
  "git.showStashes": "Cmd+Alt+S",
};

describe("keymap catalog", () => {
  it("lists exactly the app-level and agent commands", () => {
    expect(keymapCommands.map((command) => command.id)).toEqual(KEYMAP_COMMAND_IDS);
  });

  it("keeps every removed editor command out of the catalog and the defaults", () => {
    for (const platform of ["mac", "linux", "windows"] as const) {
      const ids = Object.keys(defaultKeymapSettings(platform));

      expect(ids).toEqual(KEYMAP_COMMAND_IDS);
      for (const prefix of REMOVED_COMMAND_PREFIXES) {
        expect(ids.filter((id) => id.startsWith(prefix))).toEqual([]);
      }
      for (const id of REMOVED_COMMAND_IDS) {
        expect(ids).not.toContain(id);
        expect(isKeymapCommandId(id)).toBe(false);
      }
    }
    expect(keymapCommands.map((command) => command.category)).not.toContain("Editor");
  });

  it("keeps focus scopes out of every remaining command", () => {
    expect(keymapCommands.every((command) => !("focus" in command))).toBe(true);
  });

  it("binds Close Active Panel to Cmd+W as an app-level workbench command", () => {
    expect(keymapCommands.find((command) => command.id === "workbench.closeActive")).toEqual({
      category: "Workbench",
      defaultShortcut: "Cmd+W",
      id: "workbench.closeActive",
      label: "Close Active Panel",
    });
    expect(defaultShortcutForCommand("workbench.closeActive", "mac")).toBe("Cmd+W");
    expect(defaultShortcutForCommand("workbench.closeActive", "linux")).toBe("Ctrl+W");
    for (const platform of ["mac", "linux", "windows"] as const) {
      const defaults = defaultKeymapSettings(platform);

      expect(findKeymapSequenceConflicts(defaults, "workbench.closeActive", platform)).toEqual([]);
    }
  });

  it("keeps every default shortcut unique and free of chord prefixes on every platform", () => {
    for (const platform of ["mac", "linux", "windows"] as const) {
      const defaults = defaultKeymapSettings(platform);
      const shortcuts = Object.values(defaults).filter(Boolean);

      expect(new Set(shortcuts).size).toBe(shortcuts.length);
      for (const id of KEYMAP_COMMAND_IDS) {
        if (!isKeymapCommandId(id)) throw new Error(id);
        expect(findKeymapSequenceConflicts(defaults, id, platform)).toEqual([]);
      }
    }
  });

  it("resolves shortcut conflicts in reverse dispatcher command order", () => {
    const keymap = {
      ...defaultKeymapSettings("mac"),
      "app.quit": "F12",
      "workbench.openSettings": "F12",
    };

    expect(keymapCommandIdsForShortcut(keymap, "F12", "mac")).toEqual([
      "workbench.openSettings",
      "app.quit",
    ]);
    expect(keymapCommandIdForShortcut(keymap, "F12", "mac")).toBe("workbench.openSettings");
    expect(keymapCommandIdsForShortcut(keymap, "", "mac")).toEqual([]);
  });

  it("binds the palette to Cmd+K and the cheatsheet to Cmd+/", () => {
    const defaults = defaultKeymapSettings("mac");

    expect(defaults["palette.open"]).toBe("Cmd+K");
    expect(defaults["palette.shortcuts"]).toBe("Cmd+/");
    expect(defaults["panel.toggleMaximized"]).toBe("");
    expect(defaults["agent.toggleSidebar"]).toBe("Cmd+B");
    expect(defaults["agent.searchThreads"]).toBe("Cmd+Shift+K");
  });

  it("narrows only catalog ids to keymap command ids", () => {
    expect([isKeymapCommandId("palette.open"), isKeymapCommandId("script.node.k")]).toEqual([
      true,
      false,
    ]);
  });

  it("uses Ctrl defaults on non-Mac platforms", () => {
    expect(defaultKeymapSettings("linux")).toMatchObject({
      "app.quit": "Ctrl+Q",
      "file.quickOpen": "Ctrl+P",
      "terminal.show": "Ctrl+`",
      "workbench.closeActive": "Ctrl+W",
      "workbench.zoomIn": "Ctrl+=",
      "workbench.zoomOut": "Ctrl+-",
      "workbench.zoomReset": "Ctrl+0",
    });
    expect(defaultShortcutForCommand("workbench.zoomIn", "windows")).toBe("Ctrl+=");
  });

  it("registers a Quit Application command bound to Cmd+Q", () => {
    const quit = keymapCommands.find((command) => command.id === "app.quit");

    expect(quit).toMatchObject({
      category: "Application",
      label: "Quit Application",
      defaultShortcut: "Cmd+Q",
    });
    expect(defaultShortcutForCommand("app.quit", "mac")).toBe("Cmd+Q");
    expect(defaultShortcutForCommand("app.quit", "linux")).toBe("Ctrl+Q");

    for (const platform of ["mac", "linux", "windows"] as const) {
      const keymap = defaultKeymapSettings(platform);

      expect(findKeymapConflicts(keymap, "app.quit", platform)).toEqual([]);
    }
  });

  it("registers Add Project as an unbound rebindable workbench command", () => {
    const entry = keymapCommands.find((command) => command.id === "project.add");

    expect(entry).toMatchObject({
      category: "Workbench",
      defaultShortcut: "",
      label: "Add Project…",
    });
    expect(defaultKeymapSettings("mac")).toHaveProperty("project.add", "");
  });

  it("registers the git branch commands without shortcut collisions", () => {
    const switchBranch = keymapCommands.find((command) => command.id === "git.switchBranch");
    const newBranch = keymapCommands.find((command) => command.id === "git.newBranch");

    expect(switchBranch).toMatchObject({
      category: "Git",
      label: "Git: Switch Branch",
      defaultShortcut: "Cmd+Shift+B",
    });
    expect(newBranch).toMatchObject({
      category: "Git",
      label: "Git: Open Branches",
      defaultShortcut: "Cmd+Alt+N",
    });

    // The branch shortcuts are distinct from one another and from every other
    // binding; assert every command id stays unique.
    const ids = keymapCommands.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);

    const defaults = defaultKeymapSettings("mac");
    expect(
      Object.entries(defaults).filter(([, shortcut]) => shortcut === defaults["git.switchBranch"]),
    ).toEqual([["git.switchBranch", "Cmd+Shift+B"]]);
    expect(
      Object.entries(defaults).filter(([, shortcut]) => shortcut === defaults["git.newBranch"]),
    ).toEqual([["git.newBranch", "Cmd+Alt+N"]]);
  });

  it("leaves Git: Open Commit unbound so Cmd+Enter stays with text fields", () => {
    const commit = keymapCommands.find((command) => command.id === "git.commit");

    expect(commit).toMatchObject({
      category: "Git",
      label: "Git: Open Commit",
      defaultShortcut: "",
    });
    for (const platform of ["mac", "linux", "windows"] as const) {
      expect(defaultShortcutForCommand("git.commit", platform)).toBe("");
      expect(Object.values(defaultKeymapSettings(platform))).not.toContain(
        platform === "mac" ? "Cmd+Enter" : "Ctrl+Enter",
      );
    }
  });

  it("registers the agent thread commands with their T3 parity defaults", () => {
    const expected = {
      "agent.newThread": "Cmd+Shift+N",
      "agent.previousThread": "Cmd+Shift+[",
      "agent.nextThread": "Cmd+Shift+]",
      "agent.jumpToThread.1": "Cmd+1",
      "agent.jumpToThread.5": "Cmd+5",
      "agent.jumpToThread.9": "Cmd+9",
      "agent.searchThreads": "Cmd+Shift+K",
      "agent.findInThread": "Cmd+F",
    } as const;

    expect(defaultKeymapSettings("mac")).toMatchObject(expected);
    expect(defaultKeymapSettings("linux")).toMatchObject({
      "agent.newThread": "Ctrl+Shift+N",
      "agent.searchThreads": "Ctrl+Shift+K",
      "agent.findInThread": "Ctrl+F",
    });

    for (const id of Object.keys(expected) as Array<keyof typeof expected>) {
      expect(keymapCommands.find((command) => command.id === id)).toMatchObject({
        category: "Agent",
        defaultShortcut: expected[id],
      });
    }

    const jumpIds = [
      "agent.jumpToThread.1",
      "agent.jumpToThread.2",
      "agent.jumpToThread.3",
      "agent.jumpToThread.4",
      "agent.jumpToThread.5",
      "agent.jumpToThread.6",
      "agent.jumpToThread.7",
      "agent.jumpToThread.8",
      "agent.jumpToThread.9",
    ] as const;

    jumpIds.forEach((id, index) => {
      expect(defaultShortcutForCommand(id, "mac")).toBe(`Cmd+${index + 1}`);
      expect(defaultShortcutForCommand(id, "windows")).toBe(`Ctrl+${index + 1}`);
    });
  });

  it("registers the agent workbench chrome commands without shortcut collisions", () => {
    const expected = {
      "agent.toggleRightPanel": { label: "Toggle Right Panel", mac: "Cmd+Alt+R" },
      "agent.openFilesSurface": { label: "Show Files Surface", mac: "Cmd+Alt+F" },
      "agent.openDiffSurface": { label: "Show Diff Surface", mac: "Cmd+Alt+D" },
      "agent.openTerminalSurface": { label: "Show Terminal Surface", mac: "Cmd+Alt+J" },
      "agent.runPreferredScript": { label: "Run Thread Script", mac: "" },
      "agent.openCommitMenu": { label: "Commit Thread Changes", mac: "" },
    } as const;

    for (const id of Object.keys(expected) as Array<keyof typeof expected>) {
      expect(keymapCommands.find((command) => command.id === id)).toMatchObject({
        category: "Agent",
        defaultShortcut: expected[id].mac,
        label: expected[id].label,
      });
    }

    for (const platform of ["mac", "linux", "windows"] as const) {
      const defaults = defaultKeymapSettings(platform);
      const primary = platform === "mac" ? "Cmd" : "Ctrl";

      expect(defaults["agent.toggleRightPanel"]).toBe(`${primary}+Alt+R`);
      expect(defaults["agent.openFilesSurface"]).toBe(`${primary}+Alt+F`);
      expect(defaults["agent.openDiffSurface"]).toBe(`${primary}+Alt+D`);
      expect(defaults["agent.openTerminalSurface"]).toBe(`${primary}+Alt+J`);
      expect(defaults["agent.runPreferredScript"]).toBe("");
      expect(defaults["agent.openCommitMenu"]).toBe("");

      expect(defaults["agent.openTerminalSurface"]).not.toBe(defaults["panel.toggle"]);
      expect(defaults["panel.toggle"]).toBe(`${primary}+J`);

      for (const id of Object.keys(expected) as Array<keyof typeof expected>) {
        const shortcut = defaults[id];
        if (!shortcut) continue;
        expect(keymapCommandIdsForShortcut(defaults, shortcut, platform)).toEqual([id]);
        expect(findKeymapSequenceConflicts(defaults, id, platform)).toEqual([]);
      }
    }
  });

  it("binds Toggle Dictation to the dictation chord without shortcut collisions", () => {
    expect(keymapCommands.find((command) => command.id === "agent.toggleDictation")).toMatchObject({
      category: "Agent",
      defaultShortcut: "Cmd+Alt+V",
      label: "Toggle Dictation",
    });
    expect(isKeymapCommandId("agent.toggleDictation")).toBe(true);

    for (const platform of ["mac", "linux", "windows"] as const) {
      const defaults = defaultKeymapSettings(platform);
      const primary = platform === "mac" ? "Cmd" : "Ctrl";
      const shortcut = defaults["agent.toggleDictation"];

      expect(shortcut).toBe(`${primary}+Alt+V`);
      expect(keymapCommandIdsForShortcut(defaults, shortcut, platform)).toEqual([
        "agent.toggleDictation",
      ]);
      expect(findKeymapConflicts(defaults, "agent.toggleDictation", platform)).toEqual([]);
      expect(findKeymapSequenceConflicts(defaults, "agent.toggleDictation", platform)).toEqual([]);
    }
  });

  it("registers workspace tab cycling with platform defaults and no conflicts", () => {
    expect(keymapCommands.find((command) => command.id === "workspace.nextTab")).toMatchObject({
      category: "Workspace",
      defaultShortcut: "Cmd+Alt+ArrowRight",
      label: "Next Workspace Tab",
    });
    expect(keymapCommands.find((command) => command.id === "workspace.previousTab")).toMatchObject({
      category: "Workspace",
      defaultShortcut: "Cmd+Alt+ArrowLeft",
      label: "Previous Workspace Tab",
    });

    for (const platform of ["mac", "linux", "windows"] as const) {
      const keymap = defaultKeymapSettings(platform);

      expect(findKeymapConflicts(keymap, "workspace.nextTab", platform)).toEqual([]);
      expect(findKeymapConflicts(keymap, "workspace.previousTab", platform)).toEqual([]);
    }

    expect(defaultShortcutForCommand("workspace.nextTab", "mac")).toBe("Cmd+Alt+ArrowRight");
    expect(defaultShortcutForCommand("workspace.previousTab", "mac")).toBe("Cmd+Alt+ArrowLeft");
    expect(defaultShortcutForCommand("workspace.nextTab", "linux")).toBe("Ctrl+Alt+ArrowRight");
    expect(defaultShortcutForCommand("workspace.previousTab", "windows")).toBe(
      "Ctrl+Alt+ArrowLeft",
    );
  });

  it("defaults the command palette to Cmd+Shift+P on mac and Ctrl+Shift+P elsewhere", () => {
    expect(defaultShortcutForCommand("commands.show", "mac")).toBe("Cmd+Shift+P");
    expect(defaultShortcutForCommand("commands.show", "linux")).toBe("Ctrl+Shift+P");
    expect(defaultShortcutForCommand("commands.show", "windows")).toBe("Ctrl+Shift+P");
    expect(defaultKeymapSettings("mac")["commands.show"]).toBe("Cmd+Shift+P");
  });

  it("matches the window zoom shortcuts against the platform primary modifier", () => {
    expect(matchesShortcut(keyEvent({ key: "=", metaKey: true }), "Cmd+=", "mac")).toBe(true);
    expect(matchesShortcut(keyEvent({ key: "-", metaKey: true }), "Cmd+-", "mac")).toBe(true);
    expect(matchesShortcut(keyEvent({ key: "0", metaKey: true }), "Cmd+0", "mac")).toBe(true);
    expect(matchesShortcut(keyEvent({ key: "=", ctrlKey: true }), "Cmd+=", "linux")).toBe(true);
    expect(matchesShortcut(keyEvent({ key: "0", metaKey: true }), "Cmd+0", "linux")).toBe(false);
  });

  it("matches a + key event against the = shortcut with the same modifiers", () => {
    const shifted = keyEvent({ key: "+", metaKey: true, shiftKey: true });
    const unshifted = keyEvent({ key: "+", metaKey: true });
    const linuxShifted = keyEvent({ ctrlKey: true, key: "+", shiftKey: true });

    expect(matchesShortcut(shifted, "Cmd+Shift+=", "mac")).toBe(true);
    expect(matchesShortcut(shifted, "Cmd+=", "mac")).toBe(false);
    expect(matchesShortcut(unshifted, "Cmd+=", "mac")).toBe(true);
    expect(matchesShortcut(unshifted, "Cmd+Shift+=", "mac")).toBe(false);
    expect(matchesShortcut(linuxShifted, "Cmd+Shift+=", "linux")).toBe(true);
    expect(matchesShortcut(linuxShifted, "Ctrl+Shift+=", "windows")).toBe(true);
    expect(matchesShortcut(linuxShifted, "Cmd+Shift+=", "mac")).toBe(false);
  });

  it("parses shortcuts and matches keyboard events exactly", () => {
    expect(parseShortcut("Cmd+Shift+F")).toEqual({
      alt: false,
      ctrl: false,
      key: "f",
      meta: true,
      shift: true,
    });
    expect(normalizeShortcutInput("option + return")).toBe("Alt+Enter");
    expect(matchesShortcut(keyEvent({ key: "[", metaKey: true }), "Cmd+[", "mac")).toBe(true);
    expect(
      matchesShortcut(keyEvent({ key: "f", metaKey: true, shiftKey: true }), "Cmd+Shift+F", "mac"),
    ).toBe(true);
    expect(matchesShortcut(keyEvent({ key: "f", metaKey: true }), "Cmd+Shift+F", "mac")).toBe(
      false,
    );
    expect(matchesShortcut(keyEvent({ key: "Enter", altKey: true }), "Alt+Enter")).toBe(true);
    expect(matchesShortcut(keyEvent({ key: "Enter", altKey: true }), "")).toBe(false);
  });

  it("matches Cmd shortcuts against the platform primary modifier", () => {
    expect(matchesShortcut(keyEvent({ key: "s", ctrlKey: true }), "Cmd+S", "linux")).toBe(true);
    expect(matchesShortcut(keyEvent({ key: "s", metaKey: true }), "Cmd+S", "linux")).toBe(false);
    expect(matchesShortcut(keyEvent({ key: "s", metaKey: true }), "Cmd+S", "mac")).toBe(true);
  });

  it("detects mac, windows, and linux platforms from navigator fields", () => {
    expect(
      detectKeymapPlatform({
        platform: "MacIntel",
        userAgent: "Mozilla/5.0",
      }),
    ).toBe("mac");
    expect(
      detectKeymapPlatform({
        platform: "Win32",
        userAgent: "Mozilla/5.0",
      }),
    ).toBe("windows");
    expect(
      detectKeymapPlatform({
        platform: "Linux x86_64",
        userAgent: "Mozilla/5.0",
      }),
    ).toBe("linux");
  });
});

describe("normalizeKeymapSettings", () => {
  it("normalizes a legacy keymap with editor overrides without error and keeps agent overrides", () => {
    for (const platform of ["mac", "linux", "windows"] as const) {
      const keymap = normalizeKeymapSettings(LEGACY_EDITOR_KEYMAP, platform);

      expect(Object.keys(keymap)).toEqual(KEYMAP_COMMAND_IDS);
      expect(keymap).toMatchObject({
        "agent.findInThread": "Cmd+Shift+F",
        "agent.toggleRightPanel": "Cmd+Alt+Shift+R",
        "git.commit": "Cmd+Alt+Enter",
        "palette.open": "Cmd+Alt+K",
        "workbench.closeActive": "Cmd+Shift+W",
      });
      expect(keymap["file.quickOpen"]).toBe(defaultShortcutForCommand("file.quickOpen", platform));
    }
  });

  it("carries a persisted editor.closeTab binding over to workbench.closeActive", () => {
    expect(normalizeKeymapSettings({ "editor.closeTab": "Cmd+W" }, "linux")).toMatchObject({
      "workbench.closeActive": "Ctrl+W",
    });
    expect(normalizeKeymapSettings({ "editor.closeTab": "" }, "mac")).toMatchObject({
      "workbench.closeActive": "",
    });
    expect(
      normalizeKeymapSettings(
        { "editor.closeTab": "Cmd+Shift+W", "workbench.closeActive": "Cmd+Alt+W" },
        "mac",
      )["workbench.closeActive"],
    ).toBe("Cmd+Alt+W");
    expect(normalizeKeymapSettings({ "editor.closeTab": 42 }, "mac")["workbench.closeActive"]).toBe(
      "Cmd+W",
    );
  });

  it("normalizes persisted keymaps and keeps unknown values out", () => {
    const keymap = normalizeKeymapSettings(
      {
        "app.quit": "command + q",
        "file.quickOpen": "",
        "workspace.nextTab": "cmd+alt+arrowright",
        unknown: "Cmd+X",
      },
      "mac",
    );

    expect(keymap).toMatchObject({
      "app.quit": "Cmd+Q",
      "file.quickOpen": "",
      "workspace.nextTab": "Cmd+Alt+ArrowRight",
    });
    expect(keymap).not.toHaveProperty("unknown");
  });

  it("migrates persisted Mac defaults to Ctrl on non-Mac platforms", () => {
    expect(
      normalizeKeymapSettings(
        {
          "app.quit": "Cmd+Q",
          "workbench.closeActive": "Cmd+W",
          "agent.toggleRightPanel": "Cmd+Alt+R",
          "terminal.show": "Ctrl+`",
        },
        "linux",
      ),
    ).toMatchObject({
      "app.quit": "Ctrl+Q",
      "workbench.closeActive": "Ctrl+W",
      "agent.toggleRightPanel": "Ctrl+Alt+R",
      "terminal.show": "Ctrl+`",
    });
    expect(normalizeKeymapSettings({ "app.quit": "Cmd+Shift+Q" }, "linux")["app.quit"]).toBe(
      "Cmd+Shift+Q",
    );
  });

  it("falls back to the defaults for a non-object value", () => {
    expect(normalizeKeymapSettings(null, "mac")).toEqual(defaultKeymapSettings("mac"));
    expect(normalizeKeymapSettings("Cmd+W", "linux")).toEqual(defaultKeymapSettings("linux"));
  });
});

describe("keymap shortcut matching", () => {
  describe("detectKeymapPlatform caching (keydown hot path)", () => {
    afterEach(() => {
      __resetKeymapPlatformCacheForTests();
    });

    it("reads the global navigator only once and reuses the cached platform", () => {
      __resetKeymapPlatformCacheForTests();
      let reads = 0;
      const navigatorLike = {
        get platform() {
          reads += 1;
          return "MacIntel";
        },
        userAgent: "Mozilla/5.0",
      };

      expect(detectKeymapPlatform(navigatorLike)).toBe("mac");
      expect(detectKeymapPlatform(navigatorLike)).toBe("mac");
      expect(detectKeymapPlatform(navigatorLike)).toBe("mac");
      expect(reads).toBe(1);
    });

    it("recomputes after the cache is reset (so tests can swap platforms)", () => {
      __resetKeymapPlatformCacheForTests();
      let reads = 0;
      const navigatorLike = {
        get platform() {
          reads += 1;
          return "MacIntel";
        },
        userAgent: "Mozilla/5.0",
      };

      detectKeymapPlatform(navigatorLike);
      __resetKeymapPlatformCacheForTests();
      detectKeymapPlatform(navigatorLike);

      expect(reads).toBe(2);
    });
  });

  describe("keydown hot-path early exit", () => {
    it("has no bare-key default bindings left", () => {
      expect(collectBareKeyShortcutKeys(defaultKeymapSettings("mac")).size).toBe(0);
    });

    it("collects a user-bound bare key", () => {
      const keys = collectBareKeyShortcutKeys({
        ...defaultKeymapSettings("mac"),
        "app.quit": "F8",
      });

      expect(keys.has("f8")).toBe(true);
      expect(keys.has("q")).toBe(false);
    });

    it("skips matching for held bare keys that no command binds", () => {
      const bareKeys = collectBareKeyShortcutKeys(defaultKeymapSettings("mac"));

      expect(eventCanMatchKeymapShortcut(keyEvent({ key: "ArrowUp" }), bareKeys)).toBe(false);
      expect(eventCanMatchKeymapShortcut(keyEvent({ key: "F8" }), bareKeys)).toBe(false);
      expect(eventCanMatchKeymapShortcut(keyEvent({ key: "a" }), bareKeys)).toBe(false);
    });

    it("always allows matching when any modifier is held", () => {
      const bareKeys = collectBareKeyShortcutKeys(defaultKeymapSettings("mac"));

      expect(eventCanMatchKeymapShortcut(keyEvent({ key: "w", metaKey: true }), bareKeys)).toBe(
        true,
      );
      expect(
        eventCanMatchKeymapShortcut(keyEvent({ key: "ArrowUp", altKey: true }), bareKeys),
      ).toBe(true);
      expect(
        eventCanMatchKeymapShortcut(keyEvent({ key: "Shift", shiftKey: true }), bareKeys),
      ).toBe(true);
    });

    it("lets a bare + key reach matching when its = equivalent is a bare-key command", () => {
      const bareKeys = collectBareKeyShortcutKeys({
        ...defaultKeymapSettings("mac"),
        "workbench.zoomIn": "=",
      });

      expect(eventCanMatchKeymapShortcut(keyEvent({ key: "+" }), bareKeys)).toBe(true);
      expect(eventCanMatchKeymapShortcut(keyEvent({ key: "=" }), bareKeys)).toBe(true);
    });
  });

  describe("findKeymapConflicts", () => {
    it("returns no conflicts when a shortcut is unique", () => {
      expect(findKeymapConflicts(defaultKeymapSettings("mac"), "app.quit")).toEqual([]);
    });

    it("reports the other command when two commands share a rebound shortcut", () => {
      const keymap = { ...defaultKeymapSettings("mac"), "app.quit": "Cmd+W" };

      expect(findKeymapConflicts(keymap, "app.quit", "mac")).toEqual([
        { id: "workbench.closeActive", label: "Close Active Panel" },
      ]);
      expect(findKeymapConflicts(keymap, "workbench.closeActive", "mac")).toEqual([
        { id: "app.quit", label: "Quit Application" },
      ]);
    });

    it("reports palette conflicts that used to be hidden by editor focus scopes", () => {
      const keymap = { ...defaultKeymapSettings("mac"), "agent.goToTurn": "Cmd+K" };

      expect(findKeymapConflicts(keymap, "palette.open", "mac")).toEqual([
        { id: "agent.goToTurn", label: "Go to Turn" },
      ]);
      expect(findKeymapSequenceConflicts(keymap, "palette.open", "mac")).toContainEqual({
        id: "agent.goToTurn",
        kind: "exact",
      });
    });

    it("never reports a conflict for an unbound (empty) shortcut", () => {
      const keymap = {
        ...defaultKeymapSettings("mac"),
        "agent.runPreferredScript": "",
        "agent.openCommitMenu": "",
      };

      expect(findKeymapConflicts(keymap, "agent.runPreferredScript")).toEqual([]);
    });

    it("reports every other command sharing the same shortcut, not just the first", () => {
      const keymap = {
        ...defaultKeymapSettings("mac"),
        "workbench.closeActive": "Cmd+Q",
        "terminal.show": "Cmd+Q",
      };

      const conflicts = findKeymapConflicts(keymap, "app.quit", "mac").map(
        (conflict) => conflict.id,
      );

      expect(conflicts).toEqual(expect.arrayContaining(["workbench.closeActive", "terminal.show"]));
      expect(conflicts).toHaveLength(2);
    });
  });

  describe("shortcutFromKeyboardEvent", () => {
    it("captures a modifier chord as a normalized shortcut string", () => {
      expect(shortcutFromKeyboardEvent(keyEvent({ key: "s", metaKey: true }))).toBe("Cmd+S");
    });

    it("orders multiple modifiers consistently (Cmd, Ctrl, Shift, Alt)", () => {
      expect(
        shortcutFromKeyboardEvent(
          keyEvent({ altKey: true, key: "s", metaKey: true, shiftKey: true }),
        ),
      ).toBe("Cmd+Shift+Alt+S");
    });

    it("captures a Shift-only chord", () => {
      expect(shortcutFromKeyboardEvent(keyEvent({ key: "F12", shiftKey: true }))).toBe("Shift+F12");
    });

    it("returns null while only a modifier key itself is held", () => {
      expect(shortcutFromKeyboardEvent(keyEvent({ key: "Meta", metaKey: true }))).toBeNull();
      expect(shortcutFromKeyboardEvent(keyEvent({ key: "Shift", shiftKey: true }))).toBeNull();
    });

    it("returns null for a bare key with no modifier held", () => {
      expect(shortcutFromKeyboardEvent(keyEvent({ key: "s" }))).toBeNull();
    });

    it("does not capture Shift+Tab so reverse focus navigation keeps working", () => {
      expect(shortcutFromKeyboardEvent(keyEvent({ key: "Tab", shiftKey: true }))).toBeNull();
    });

    it("does not capture Shift-typed printable characters (free typing)", () => {
      // On a standard layout "+", "A" and "!" are all produced with Shift held,
      // so capturing them would hijack normal text entry in the shortcut field.
      expect(shortcutFromKeyboardEvent(keyEvent({ key: "+", shiftKey: true }))).toBeNull();
      expect(shortcutFromKeyboardEvent(keyEvent({ key: "A", shiftKey: true }))).toBeNull();
      expect(shortcutFromKeyboardEvent(keyEvent({ key: "!", shiftKey: true }))).toBeNull();
    });

    it("captures a chord on the '+' delimiter key as its '=' equivalent", () => {
      // "+" cannot be represented in the "Cmd+Shift+X" string format (it IS the
      // delimiter), so it is captured as "=" with the event's real modifiers.
      expect(shortcutFromKeyboardEvent(keyEvent({ key: "+", metaKey: true, shiftKey: true }))).toBe(
        "Cmd+Shift+=",
      );
      expect(shortcutFromKeyboardEvent(keyEvent({ key: "+", metaKey: true }))).toBe("Cmd+=");
      expect(shortcutFromKeyboardEvent(keyEvent({ ctrlKey: true, key: "+", shiftKey: true }))).toBe(
        "Ctrl+Shift+=",
      );
      expect(shortcutFromKeyboardEvent(keyEvent({ key: "+" }))).toBeNull();
    });

    it("still captures strong-modifier chords with a printable key", () => {
      expect(shortcutFromKeyboardEvent(keyEvent({ altKey: true, key: "/" }))).toBe("Alt+/");
    });

    it.each([
      ["∂", "KeyD", "Cmd+Alt+D"],
      ["Dead", "KeyE", "Cmd+Alt+E"],
    ])("captures an Alt-modified %s key through its letter code", (key, code, shortcut) => {
      const event = keyEvent({ altKey: true, code, key, metaKey: true });

      expect(shortcutFromKeyboardEvent(event)).toBe(shortcut);
      expect(matchesShortcut(event, shortcut, "mac")).toBe(true);
    });

    it.each([
      ["≠", "Equal", "Cmd+Alt+="],
      ["–", "Minus", "Cmd+Alt+-"],
      ["÷", "Slash", "Cmd+Alt+/"],
      ["Dead", "Backquote", "Cmd+Alt+`"],
    ])("captures an Alt-modified %s key through its %s punctuation code", (key, code, shortcut) => {
      const event = keyEvent({ altKey: true, code, key, metaKey: true });

      expect(shortcutFromKeyboardEvent(event)).toBe(shortcut);
      expect(matchesShortcut(event, shortcut, "mac")).toBe(true);
    });

    it("captures the macOS Option-transformed = and - keys", () => {
      const equal = keyEvent({ altKey: true, code: "Equal", key: "≠", metaKey: true });
      const minus = keyEvent({ altKey: true, code: "Minus", key: "–", metaKey: true });

      expect(shortcutFromKeyboardEvent(equal)).toBe("Cmd+Alt+=");
      expect(shortcutFromKeyboardEvent(minus)).toBe("Cmd+Alt+-");
      expect(
        shortcutFromKeyboardEvent(
          keyEvent({ altKey: true, code: "Equal", key: "±", metaKey: true, shiftKey: true }),
        ),
      ).toBe("Cmd+Shift+Alt+=");
    });

    it("preserves AltGr text and captures a representable transformed delimiter", () => {
      const altGraphEvent = keyEvent({
        altKey: true,
        code: "KeyE",
        ctrlKey: true,
        getModifierState: (keyArg) => keyArg === "AltGraph",
        key: "€",
      });
      const delimiterEvent = keyEvent({
        altKey: true,
        code: "KeyD",
        key: "+",
        metaKey: true,
      });

      expect(shortcutFromKeyboardEvent(altGraphEvent)).toBe("Ctrl+Alt+€");
      expect(matchesShortcut(altGraphEvent, "Cmd+Alt+E", "windows")).toBe(false);
      expect(shortcutFromKeyboardEvent(delimiterEvent)).toBe("Cmd+Alt+D");
    });

    it("captures a macOS Control+Option transformed key", () => {
      const event = keyEvent({ altKey: true, code: "KeyD", ctrlKey: true, key: "∂" });

      expect(shortcutFromKeyboardEvent(event)).toBe("Ctrl+Alt+D");
      expect(matchesShortcut(event, "Ctrl+Alt+D", "mac")).toBe(true);
    });
  });
});

function keyEvent(
  overrides: Partial<
    Pick<
      KeyboardEvent,
      "altKey" | "code" | "ctrlKey" | "getModifierState" | "key" | "metaKey" | "shiftKey"
    >
  >,
): KeyboardEvent {
  return {
    altKey: false,
    code: "",
    ctrlKey: false,
    key: "",
    metaKey: false,
    shiftKey: false,
    ...overrides,
  } as KeyboardEvent;
}
