import { afterEach, describe, expect, it } from "vitest";
import {
  __resetKeymapPlatformCacheForTests,
  collectBareKeyShortcutKeys,
  defaultKeymapSettings,
  defaultShortcutForCommand,
  detectKeymapPlatform,
  eventCanMatchKeymapShortcut,
  findKeymapConflicts,
  keymapCommands,
  matchesShortcut,
  normalizeKeymapSettings,
  normalizeShortcutInput,
  parseShortcut,
  shortcutFromKeyboardEvent,
} from "./keymap";

describe("keymap", () => {
  it("creates defaults for editable shortcuts", () => {
    expect(defaultKeymapSettings("mac")).toMatchObject({
      "class.quickOpen": "Cmd+O",
      "editor.closeTab": "Cmd+W",
      "editor.fileStructure": "Cmd+R",
      "editor.extendSelection": "Alt+ArrowUp",
      "editor.moveStatementUp": "Cmd+Shift+ArrowUp",
      "editor.moveStatementDown": "Cmd+Shift+ArrowDown",
      "editor.moveLineUp": "Shift+Alt+ArrowUp",
      "editor.moveLineDown": "Shift+Alt+ArrowDown",
      "editor.duplicateLine": "Cmd+Shift+D",
      "editor.addSelectionToNextMatch": "Cmd+D",
      "editor.deleteLine": "Cmd+Shift+K",
      "editor.surroundWith": "Cmd+Alt+T",
      "editor.fontZoomIn": "Cmd+=",
      "editor.fontZoomOut": "Cmd+-",
      "editor.fontZoomReset": "Cmd+0",
      "editor.toggleFontLigatures": "",
      "editor.goToDeclaration": "",
      "editor.goToDefinition": "Cmd+B",
      "editor.goToSourceDefinition": "",
      "editor.goToSymbol": "Cmd+T",
      "editor.goToTypeDefinition": "",
      "editor.nextProblem": "F8",
      "editor.previousProblem": "Shift+F8",
      "editor.quickFix": "Alt+Enter",
      "file.quickOpen": "Cmd+P",
      "navigation.back": "Cmd+[",
      "navigation.forward": "Cmd+]",
      "workbench.openAppearanceSettings": "",
    });
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

  it("defaults Markdown preview to Cmd+Shift+V", () => {
    expect(defaultShortcutForCommand("markdown.openPreview", "mac")).toBe(
      "Cmd+Shift+V",
    );
    expect(defaultShortcutForCommand("markdown.openPreview", "linux")).toBe(
      "Ctrl+Shift+V",
    );
    expect(defaultKeymapSettings("mac")["markdown.openPreview"]).toBe(
      "Cmd+Shift+V",
    );
  });

  it("registers the git stash commands without shortcut collisions", () => {
    const stashChanges = keymapCommands.find(
      (command) => command.id === "git.stashChanges",
    );
    const showStashes = keymapCommands.find(
      (command) => command.id === "git.showStashes",
    );

    expect(stashChanges).toMatchObject({
      category: "Git",
      label: "Git: Stash Changes",
      defaultShortcut: "Cmd+Shift+S",
    });
    expect(showStashes).toMatchObject({
      category: "Git",
      label: "Git: Show Stashes",
      defaultShortcut: "Cmd+Alt+S",
    });

    // The stash shortcuts are distinct from one another and from every other
    // binding; assert no other command claims the same id or shortcut.
    const ids = keymapCommands.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);

    const defaults = defaultKeymapSettings("mac");
    expect(
      Object.entries(defaults).filter(
        ([, shortcut]) => shortcut === defaults["git.stashChanges"],
      ),
    ).toEqual([["git.stashChanges", "Cmd+Shift+S"]]);
    expect(
      Object.entries(defaults).filter(
        ([, shortcut]) => shortcut === defaults["git.showStashes"],
      ),
    ).toEqual([["git.showStashes", "Cmd+Alt+S"]]);
  });

  it("registers the git branch commands without shortcut collisions", () => {
    const switchBranch = keymapCommands.find(
      (command) => command.id === "git.switchBranch",
    );
    const newBranch = keymapCommands.find(
      (command) => command.id === "git.newBranch",
    );

    expect(switchBranch).toMatchObject({
      category: "Git",
      label: "Git: Switch Branch",
      defaultShortcut: "Cmd+Shift+B",
    });
    expect(newBranch).toMatchObject({
      category: "Git",
      label: "Git: New Branch",
      defaultShortcut: "Cmd+Alt+N",
    });

    // The branch shortcuts are distinct from one another and from every other
    // binding; assert every command id stays unique.
    const ids = keymapCommands.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);

    const defaults = defaultKeymapSettings("mac");
    expect(
      Object.entries(defaults).filter(
        ([, shortcut]) => shortcut === defaults["git.switchBranch"],
      ),
    ).toEqual([["git.switchBranch", "Cmd+Shift+B"]]);
    expect(
      Object.entries(defaults).filter(
        ([, shortcut]) => shortcut === defaults["git.newBranch"],
      ),
    ).toEqual([["git.newBranch", "Cmd+Alt+N"]]);
  });

  it("assigns discoverable default shortcuts to the git and history commands", () => {
    const defaults = defaultKeymapSettings("mac");

    expect(defaults["git.stashChanges"]).toBe("Cmd+Shift+S");
    expect(defaults["git.showStashes"]).toBe("Cmd+Alt+S");
    expect(defaults["git.switchBranch"]).toBe("Cmd+Shift+B");
    expect(defaults["git.newBranch"]).toBe("Cmd+Alt+N");
    expect(defaults["editor.toggleGitBlame"]).toBe("Cmd+Alt+G");
    expect(defaults["editor.showFileHistory"]).toBe("Cmd+Alt+H");
    expect(defaults["editor.showLocalHistory"]).toBe("Cmd+Shift+H");
  });

  it("maps the git and history shortcuts to the primary modifier on non-mac", () => {
    const defaults = defaultKeymapSettings("linux");

    expect(defaults["git.stashChanges"]).toBe("Ctrl+Shift+S");
    expect(defaults["git.showStashes"]).toBe("Ctrl+Alt+S");
    expect(defaults["git.switchBranch"]).toBe("Ctrl+Shift+B");
    expect(defaults["git.newBranch"]).toBe("Ctrl+Alt+N");
    expect(defaults["editor.toggleGitBlame"]).toBe("Ctrl+Alt+G");
    expect(defaults["editor.showFileHistory"]).toBe("Ctrl+Alt+H");
    expect(defaults["editor.showLocalHistory"]).toBe("Ctrl+Shift+H");
  });

  it("registers a Git: Commit command bound to Cmd+Enter", () => {
    const commit = keymapCommands.find((command) => command.id === "git.commit");

    expect(commit).toMatchObject({
      category: "Git",
      label: "Git: Commit",
      defaultShortcut: "Cmd+Enter",
    });
    expect(defaultShortcutForCommand("git.commit", "mac")).toBe("Cmd+Enter");
    expect(defaultShortcutForCommand("git.commit", "linux")).toBe("Ctrl+Enter");
  });

  it("registers next/previous change navigation commands", () => {
    const nextChange = keymapCommands.find(
      (command) => command.id === "editor.nextChange",
    );
    const previousChange = keymapCommands.find(
      (command) => command.id === "editor.previousChange",
    );

    expect(nextChange).toMatchObject({
      category: "Editor",
      label: "Go to Next Change",
      defaultShortcut: "Alt+F5",
    });
    expect(previousChange).toMatchObject({
      category: "Editor",
      label: "Go to Previous Change",
      defaultShortcut: "Shift+Alt+F5",
    });
  });

  it("keeps every default shortcut unique across the whole keymap (no collisions)", () => {
    for (const platform of ["mac", "linux", "windows"] as const) {
      const defaults = defaultKeymapSettings(platform);
      const bound = Object.entries(defaults).filter(([, shortcut]) => shortcut);
      const shortcuts = bound.map(([, shortcut]) => shortcut);

      expect(new Set(shortcuts).size).toBe(shortcuts.length);
    }
  });

  it("registers workspace tab cycling with platform defaults and no conflicts", () => {
    expect(
      keymapCommands.find((command) => command.id === "workspace.nextTab"),
    ).toMatchObject({
      category: "Workspace",
      defaultShortcut: "Cmd+Alt+ArrowRight",
      label: "Next Workspace Tab",
    });
    expect(
      keymapCommands.find((command) => command.id === "workspace.previousTab"),
    ).toMatchObject({
      category: "Workspace",
      defaultShortcut: "Cmd+Alt+ArrowLeft",
      label: "Previous Workspace Tab",
    });

    for (const platform of ["mac", "linux", "windows"] as const) {
      const keymap = defaultKeymapSettings(platform);

      expect(findKeymapConflicts(keymap, "workspace.nextTab", platform)).toEqual(
        [],
      );
      expect(
        findKeymapConflicts(keymap, "workspace.previousTab", platform),
      ).toEqual([]);
    }

    expect(defaultShortcutForCommand("workspace.nextTab", "mac")).toBe(
      "Cmd+Alt+ArrowRight",
    );
    expect(defaultShortcutForCommand("workspace.previousTab", "mac")).toBe(
      "Cmd+Alt+ArrowLeft",
    );
    expect(defaultShortcutForCommand("workspace.nextTab", "linux")).toBe(
      "Ctrl+Alt+ArrowRight",
    );
    expect(defaultShortcutForCommand("workspace.previousTab", "windows")).toBe(
      "Ctrl+Alt+ArrowLeft",
    );
  });

  it("defaults Go to Super Method to Cmd+U on mac and Ctrl+U elsewhere (PhpStorm parity)", () => {
    expect(defaultShortcutForCommand("editor.goToSuperMethod", "mac")).toBe(
      "Cmd+U",
    );
    expect(defaultShortcutForCommand("editor.goToSuperMethod", "linux")).toBe(
      "Ctrl+U",
    );
    expect(defaultKeymapSettings("mac")["editor.goToSuperMethod"]).toBe("Cmd+U");
  });

  it("registers Search Everywhere with a Cmd+Shift+A fallback shortcut", () => {
    expect(defaultShortcutForCommand("workbench.searchEverywhere", "mac")).toBe(
      "Cmd+Shift+A",
    );
    expect(
      defaultShortcutForCommand("workbench.searchEverywhere", "linux"),
    ).toBe("Ctrl+Shift+A");
    expect(defaultKeymapSettings("mac")["workbench.searchEverywhere"]).toBe(
      "Cmd+Shift+A",
    );
  });

  it("defaults the command palette to Cmd+Shift+P on mac and Ctrl+Shift+P elsewhere", () => {
    expect(defaultShortcutForCommand("commands.show", "mac")).toBe(
      "Cmd+Shift+P",
    );
    expect(defaultShortcutForCommand("commands.show", "linux")).toBe(
      "Ctrl+Shift+P",
    );
    expect(defaultShortcutForCommand("commands.show", "windows")).toBe(
      "Ctrl+Shift+P",
    );
    expect(defaultKeymapSettings("mac")["commands.show"]).toBe("Cmd+Shift+P");
  });

  it("defaults the recent files switcher to Cmd+E on mac and Ctrl+E elsewhere", () => {
    expect(defaultShortcutForCommand("editor.recentFiles", "mac")).toBe("Cmd+E");
    expect(defaultShortcutForCommand("editor.recentFiles", "linux")).toBe(
      "Ctrl+E",
    );
    expect(defaultKeymapSettings("mac")["editor.recentFiles"]).toBe("Cmd+E");
  });

  it("defaults the recent locations panel to Cmd+Shift+E on mac and Ctrl+Shift+E elsewhere", () => {
    expect(defaultShortcutForCommand("editor.recentLocations", "mac")).toBe(
      "Cmd+Shift+E",
    );
    expect(defaultShortcutForCommand("editor.recentLocations", "linux")).toBe(
      "Ctrl+Shift+E",
    );
    expect(defaultKeymapSettings("mac")["editor.recentLocations"]).toBe(
      "Cmd+Shift+E",
    );
  });

  it("does not collide the recent locations shortcut with any other command", () => {
    const defaults = defaultKeymapSettings("mac");
    const recentLocations = defaults["editor.recentLocations"];
    const owners = Object.entries(defaults).filter(
      ([, shortcut]) => shortcut === recentLocations,
    );

    expect(owners).toEqual([["editor.recentLocations", "Cmd+Shift+E"]]);
  });

  it("defaults the TODO panel toggle to the platform primary modifier", () => {
    expect(defaultShortcutForCommand("panel.toggleTodo", "mac")).toBe(
      "Cmd+Shift+T",
    );
    expect(defaultShortcutForCommand("panel.toggleTodo", "linux")).toBe(
      "Ctrl+Shift+T",
    );
    expect(defaultKeymapSettings("mac")["panel.toggleTodo"]).toBe(
      "Cmd+Shift+T",
    );
  });

  it("defaults go to line to Cmd+L on mac and Ctrl+L elsewhere", () => {
    expect(defaultShortcutForCommand("editor.gotoLine", "mac")).toBe("Cmd+L");
    expect(defaultShortcutForCommand("editor.gotoLine", "linux")).toBe("Ctrl+L");
    expect(defaultKeymapSettings("mac")["editor.gotoLine"]).toBe("Cmd+L");
  });

  it("leaves Go to Test unbound to avoid the Cmd+Shift+T TODO panel collision", () => {
    expect(defaultShortcutForCommand("php.goToTest", "mac")).toBe("");
    expect(defaultShortcutForCommand("php.goToTest", "linux")).toBe("");
    expect(defaultKeymapSettings("mac")["php.goToTest"]).toBe("");
  });

  it("leaves Reopen Closed Tab unbound for palette-only access", () => {
    expect(defaultShortcutForCommand("editor.reopenClosedTab", "mac")).toBe("");
    expect(defaultShortcutForCommand("editor.reopenClosedTab", "linux")).toBe("");
    expect(defaultKeymapSettings("mac")["editor.reopenClosedTab"]).toBe("");
  });

  it("leaves Run All Tests in File unbound by default (palette only)", () => {
    expect(defaultShortcutForCommand("php.runTestFile", "mac")).toBe("");
    expect(defaultShortcutForCommand("php.runTestFile", "linux")).toBe("");
    expect(defaultKeymapSettings("mac")["php.runTestFile"]).toBe("");
  });

  it("leaves Run Tests with Results Panel unbound by default", () => {
    expect(
      defaultShortcutForCommand("php.runTestsWithResultsPanel", "mac"),
    ).toBe("");
    expect(
      defaultShortcutForCommand("php.runTestsWithResultsPanel", "linux"),
    ).toBe("");
    expect(
      defaultKeymapSettings("mac")["php.runTestsWithResultsPanel"],
    ).toBe("");
  });

  it("defaults complete current statement to Cmd+Shift+Enter on mac and Ctrl+Shift+Enter elsewhere", () => {
    expect(defaultShortcutForCommand("editor.completeStatement", "mac")).toBe(
      "Cmd+Shift+Enter",
    );
    expect(defaultShortcutForCommand("editor.completeStatement", "linux")).toBe(
      "Ctrl+Shift+Enter",
    );
    expect(defaultKeymapSettings("mac")["editor.completeStatement"]).toBe(
      "Cmd+Shift+Enter",
    );
  });

  it("defaults cyclic expand word to Alt+/ on every platform (PhpStorm parity)", () => {
    expect(defaultShortcutForCommand("editor.cyclicExpandWord", "mac")).toBe(
      "Alt+/",
    );
    expect(defaultShortcutForCommand("editor.cyclicExpandWord", "linux")).toBe(
      "Alt+/",
    );
    expect(defaultShortcutForCommand("editor.cyclicExpandWord", "windows")).toBe(
      "Alt+/",
    );
    expect(defaultKeymapSettings("mac")["editor.cyclicExpandWord"]).toBe(
      "Alt+/",
    );
  });

  it("does not collide the cyclic expand word shortcut with any other command", () => {
    for (const platform of ["mac", "linux", "windows"] as const) {
      const defaults = defaultKeymapSettings(platform);
      const owners = Object.entries(defaults).filter(
        ([, shortcut]) => shortcut === "Alt+/",
      );

      expect(owners).toEqual([["editor.cyclicExpandWord", "Alt+/"]]);
    }
  });

  it("parses and matches the Alt+/ cyclic expand word shortcut", () => {
    expect(parseShortcut("Alt+/")).toEqual({
      alt: true,
      ctrl: false,
      key: "/",
      meta: false,
      shift: false,
    });
    expect(
      matchesShortcut(keyEvent({ key: "/", altKey: true }), "Alt+/"),
    ).toBe(true);
    expect(matchesShortcut(keyEvent({ key: "/" }), "Alt+/")).toBe(false);
  });

  it("defaults rename symbol to F2 on every platform (VS Code parity)", () => {
    expect(defaultShortcutForCommand("editor.rename", "mac")).toBe("F2");
    expect(defaultShortcutForCommand("editor.rename", "linux")).toBe("F2");
    expect(defaultShortcutForCommand("editor.rename", "windows")).toBe("F2");
    expect(defaultKeymapSettings("mac")["editor.rename"]).toBe("F2");
  });

  it("registers the rename symbol command in the Editor category", () => {
    const rename = keymapCommands.find(
      (command) => command.id === "editor.rename",
    );

    expect(rename).toMatchObject({
      category: "Editor",
      label: "Rename Symbol",
      defaultShortcut: "F2",
    });
  });

  it("does not collide the rename symbol shortcut with any other command", () => {
    for (const platform of ["mac", "linux", "windows"] as const) {
      const defaults = defaultKeymapSettings(platform);
      const owners = Object.entries(defaults).filter(
        ([, shortcut]) => shortcut === "F2",
      );

      expect(owners).toEqual([["editor.rename", "F2"]]);
    }
  });

  it("defaults fold all / unfold all to Cmd+Shift+- / Cmd+Shift+= on mac", () => {
    expect(defaultShortcutForCommand("editor.foldAll", "mac")).toBe(
      "Cmd+Shift+-",
    );
    expect(defaultShortcutForCommand("editor.foldAll", "linux")).toBe(
      "Ctrl+Shift+-",
    );
    expect(defaultShortcutForCommand("editor.unfoldAll", "mac")).toBe(
      "Cmd+Shift+=",
    );
    expect(defaultShortcutForCommand("editor.unfoldAll", "linux")).toBe(
      "Ctrl+Shift+=",
    );
    expect(defaultKeymapSettings("mac")["editor.foldAll"]).toBe("Cmd+Shift+-");
    expect(defaultKeymapSettings("mac")["editor.unfoldAll"]).toBe("Cmd+Shift+=");
  });

  it("registers the fold commands in the Editor category", () => {
    const foldAll = keymapCommands.find(
      (command) => command.id === "editor.foldAll",
    );
    const unfoldAll = keymapCommands.find(
      (command) => command.id === "editor.unfoldAll",
    );

    expect(foldAll).toMatchObject({
      category: "Editor",
      label: "Fold All",
      defaultShortcut: "Cmd+Shift+-",
    });
    expect(unfoldAll).toMatchObject({
      category: "Editor",
      label: "Unfold All",
      defaultShortcut: "Cmd+Shift+=",
    });
  });

  it("leaves fold/unfold recursively unbound by default (palette only)", () => {
    expect(defaultShortcutForCommand("editor.foldRecursively", "mac")).toBe("");
    expect(defaultShortcutForCommand("editor.unfoldRecursively", "mac")).toBe(
      "",
    );
    expect(defaultKeymapSettings("mac")["editor.foldRecursively"]).toBe("");
    expect(defaultKeymapSettings("mac")["editor.unfoldRecursively"]).toBe("");

    const foldRecursively = keymapCommands.find(
      (command) => command.id === "editor.foldRecursively",
    );
    const unfoldRecursively = keymapCommands.find(
      (command) => command.id === "editor.unfoldRecursively",
    );

    expect(foldRecursively).toMatchObject({
      category: "Editor",
      label: "Fold Recursively",
      defaultShortcut: "",
    });
    expect(unfoldRecursively).toMatchObject({
      category: "Editor",
      label: "Unfold Recursively",
      defaultShortcut: "",
    });
  });

  it("does not collide the fold all / unfold all shortcuts with font zoom", () => {
    for (const platform of ["mac", "linux", "windows"] as const) {
      const defaults = defaultKeymapSettings(platform);
      const foldAll = defaults["editor.foldAll"];
      const unfoldAll = defaults["editor.unfoldAll"];

      expect(
        Object.entries(defaults).filter(([, shortcut]) => shortcut === foldAll),
      ).toEqual([["editor.foldAll", foldAll]]);
      expect(
        Object.entries(defaults).filter(
          ([, shortcut]) => shortcut === unfoldAll,
        ),
      ).toEqual([["editor.unfoldAll", unfoldAll]]);
    }
  });

  it("matches the fold all / unfold all shortcuts distinctly from font zoom", () => {
    expect(
      matchesShortcut(
        keyEvent({ key: "-", metaKey: true, shiftKey: true }),
        "Cmd+Shift+-",
        "mac",
      ),
    ).toBe(true);
    // Font zoom out (Cmd+-) must NOT trigger fold all (Cmd+Shift+-).
    expect(
      matchesShortcut(keyEvent({ key: "-", metaKey: true }), "Cmd+Shift+-", "mac"),
    ).toBe(false);
    expect(
      matchesShortcut(
        keyEvent({ key: "=", metaKey: true, shiftKey: true }),
        "Cmd+Shift+=",
        "mac",
      ),
    ).toBe(true);
    expect(
      matchesShortcut(keyEvent({ key: "=", metaKey: true }), "Cmd+Shift+=", "mac"),
    ).toBe(false);
  });

  it("defaults toggle bookmark to F11 on every platform (PhpStorm parity)", () => {
    expect(defaultShortcutForCommand("bookmark.toggle", "mac")).toBe("F11");
    expect(defaultShortcutForCommand("bookmark.toggle", "linux")).toBe("F11");
    expect(defaultShortcutForCommand("bookmark.toggle", "windows")).toBe("F11");
    expect(defaultKeymapSettings("mac")["bookmark.toggle"]).toBe("F11");
  });

  it("defaults show bookmarks panel to Shift+F11 on every platform", () => {
    expect(defaultShortcutForCommand("bookmark.showPanel", "mac")).toBe(
      "Shift+F11",
    );
    expect(defaultShortcutForCommand("bookmark.showPanel", "linux")).toBe(
      "Shift+F11",
    );
    expect(defaultKeymapSettings("mac")["bookmark.showPanel"]).toBe("Shift+F11");
  });

  it("leaves bookmark navigation unbound by default (palette only)", () => {
    expect(defaultShortcutForCommand("bookmark.next", "mac")).toBe("");
    expect(defaultShortcutForCommand("bookmark.previous", "mac")).toBe("");
    expect(defaultKeymapSettings("mac")["bookmark.next"]).toBe("");
    expect(defaultKeymapSettings("mac")["bookmark.previous"]).toBe("");
  });

  it("never assigns the same default shortcut to two commands", () => {
    const defaults = defaultKeymapSettings("mac");
    const assigned = Object.values(defaults).filter(Boolean);

    expect(new Set(assigned).size).toBe(assigned.length);
  });

  it("defaults find all references to Shift+F12 on every platform", () => {
    expect(defaultShortcutForCommand("editor.findReferences", "mac")).toBe(
      "Shift+F12",
    );
    expect(defaultShortcutForCommand("editor.findReferences", "linux")).toBe(
      "Shift+F12",
    );
    expect(defaultShortcutForCommand("editor.findReferences", "windows")).toBe(
      "Shift+F12",
    );
    expect(defaultKeymapSettings("mac")["editor.findReferences"]).toBe(
      "Shift+F12",
    );
  });

  it("defaults quick definition to Cmd/Ctrl+Shift+I without colliding with redo", () => {
    expect(defaultShortcutForCommand("editor.quickDefinition", "mac")).toBe(
      "Cmd+Shift+I",
    );
    expect(defaultShortcutForCommand("editor.quickDefinition", "linux")).toBe(
      "Ctrl+Shift+I",
    );
    expect(defaultShortcutForCommand("editor.quickDefinition", "windows")).toBe(
      "Ctrl+Shift+I",
    );
    expect(defaultKeymapSettings("mac")["editor.quickDefinition"]).toBe(
      "Cmd+Shift+I",
    );
  });

  it("defaults the format document shortcut to Shift+Alt+F on every platform", () => {
    expect(defaultShortcutForCommand("editor.formatDocument", "mac")).toBe(
      "Shift+Alt+F",
    );
    expect(defaultShortcutForCommand("editor.formatDocument", "linux")).toBe(
      "Shift+Alt+F",
    );
    expect(defaultShortcutForCommand("editor.formatDocument", "windows")).toBe(
      "Shift+Alt+F",
    );
    expect(defaultKeymapSettings("mac")["editor.formatDocument"]).toBe(
      "Shift+Alt+F",
    );
  });

  it("defaults move statement to Cmd+Shift+Arrow and move line to Shift+Alt+Arrow", () => {
    expect(defaultShortcutForCommand("editor.moveStatementUp", "mac")).toBe(
      "Cmd+Shift+ArrowUp",
    );
    expect(defaultShortcutForCommand("editor.moveStatementUp", "linux")).toBe(
      "Ctrl+Shift+ArrowUp",
    );
    expect(defaultShortcutForCommand("editor.moveStatementDown", "mac")).toBe(
      "Cmd+Shift+ArrowDown",
    );
    expect(defaultShortcutForCommand("editor.moveLineUp", "mac")).toBe(
      "Shift+Alt+ArrowUp",
    );
    expect(defaultShortcutForCommand("editor.moveLineUp", "linux")).toBe(
      "Shift+Alt+ArrowUp",
    );
    expect(defaultShortcutForCommand("editor.moveLineDown", "mac")).toBe(
      "Shift+Alt+ArrowDown",
    );
  });

  it("defaults the editor ergonomics shortcuts to their PhpStorm/VS Code keys", () => {
    expect(defaultShortcutForCommand("editor.duplicateLine", "mac")).toBe(
      "Cmd+Shift+D",
    );
    expect(defaultShortcutForCommand("editor.duplicateLine", "linux")).toBe(
      "Ctrl+Shift+D",
    );
    expect(defaultShortcutForCommand("editor.addSelectionToNextMatch", "mac")).toBe(
      "Cmd+D",
    );
    expect(
      defaultShortcutForCommand("editor.addSelectionToNextMatch", "linux"),
    ).toBe("Ctrl+D");
    expect(defaultShortcutForCommand("editor.deleteLine", "mac")).toBe(
      "Cmd+Shift+K",
    );
    expect(defaultShortcutForCommand("editor.deleteLine", "linux")).toBe(
      "Ctrl+Shift+K",
    );
  });

  it("defaults the multi-cursor breadth shortcuts to their VS Code keys", () => {
    expect(defaultShortcutForCommand("editor.insertCursorAbove", "mac")).toBe(
      "Cmd+Alt+ArrowUp",
    );
    expect(defaultShortcutForCommand("editor.insertCursorAbove", "linux")).toBe(
      "Ctrl+Alt+ArrowUp",
    );
    expect(defaultShortcutForCommand("editor.insertCursorBelow", "mac")).toBe(
      "Cmd+Alt+ArrowDown",
    );
    expect(
      defaultShortcutForCommand("editor.insertCursorBelow", "windows"),
    ).toBe("Ctrl+Alt+ArrowDown");
    expect(
      defaultShortcutForCommand("editor.selectAllOccurrences", "mac"),
    ).toBe("Cmd+Shift+L");
    expect(
      defaultShortcutForCommand("editor.selectAllOccurrences", "linux"),
    ).toBe("Ctrl+Shift+L");
  });

  it("defaults shrink selection to Alt+ArrowDown to mirror expand", () => {
    expect(defaultShortcutForCommand("editor.extendSelection", "mac")).toBe(
      "Alt+ArrowUp",
    );
    expect(defaultShortcutForCommand("editor.shrinkSelection", "mac")).toBe(
      "Alt+ArrowDown",
    );
    expect(defaultShortcutForCommand("editor.shrinkSelection", "linux")).toBe(
      "Alt+ArrowDown",
    );
  });

  it("leaves toggle column selection unbound by default", () => {
    expect(
      defaultShortcutForCommand("editor.toggleColumnSelection", "mac"),
    ).toBe("");
    expect(
      defaultShortcutForCommand("editor.toggleColumnSelection", "linux"),
    ).toBe("");
  });

  it("defaults the line/case utility shortcuts to their PhpStorm/VS Code keys", () => {
    expect(defaultShortcutForCommand("editor.joinLines", "mac")).toBe(
      "Cmd+Shift+J",
    );
    expect(defaultShortcutForCommand("editor.joinLines", "linux")).toBe(
      "Ctrl+Shift+J",
    );
    expect(defaultShortcutForCommand("editor.toggleCase", "mac")).toBe(
      "Cmd+Shift+U",
    );
    expect(defaultShortcutForCommand("editor.toggleCase", "windows")).toBe(
      "Ctrl+Shift+U",
    );
    expect(defaultShortcutForCommand("editor.sortLinesAscending", "mac")).toBe(
      "",
    );
    expect(defaultShortcutForCommand("editor.sortLinesDescending", "mac")).toBe(
      "",
    );
    expect(defaultShortcutForCommand("editor.transformToLowercase", "mac")).toBe(
      "",
    );
  });

  it("assigns every default shortcut to at most one command per platform", () => {
    for (const platform of ["mac", "linux", "windows"] as const) {
      const defaults = defaultKeymapSettings(platform);
      const assigned = Object.values(defaults).filter(
        (shortcut) => shortcut.length > 0,
      );
      const unique = new Set(assigned);

      expect(unique.size).toBe(assigned.length);
    }
  });

  it("defaults format selection to Cmd+Alt+L mirroring PhpStorm reformat", () => {
    expect(defaultShortcutForCommand("editor.formatSelection", "mac")).toBe(
      "Cmd+Alt+L",
    );
    expect(defaultShortcutForCommand("editor.formatSelection", "linux")).toBe(
      "Ctrl+Alt+L",
    );
    expect(defaultShortcutForCommand("editor.formatSelection", "windows")).toBe(
      "Ctrl+Alt+L",
    );
  });

  it("matches the format document shortcut against Shift+Alt+F", () => {
    expect(
      matchesShortcut(
        keyEvent({ key: "f", altKey: true, shiftKey: true }),
        "Shift+Alt+F",
      ),
    ).toBe(true);
    expect(
      matchesShortcut(keyEvent({ key: "f", altKey: true }), "Shift+Alt+F"),
    ).toBe(false);
  });

  it("uses Ctrl defaults on non-Mac platforms", () => {
    expect(defaultShortcutForCommand("editor.save", "linux")).toBe("Ctrl+S");
    expect(defaultShortcutForCommand("editor.save", "windows")).toBe("Ctrl+S");
    expect(defaultShortcutForCommand("editor.save", "mac")).toBe("Cmd+S");
    expect(defaultShortcutForCommand("editor.fontZoomIn", "linux")).toBe(
      "Ctrl+=",
    );
    expect(defaultShortcutForCommand("editor.fontZoomOut", "linux")).toBe(
      "Ctrl+-",
    );
    expect(defaultShortcutForCommand("editor.fontZoomReset", "linux")).toBe(
      "Ctrl+0",
    );
    expect(defaultKeymapSettings("linux")).toMatchObject({
      "class.quickOpen": "Ctrl+O",
      "editor.closeTab": "Ctrl+W",
      "editor.fileStructure": "Ctrl+R",
      "editor.fontZoomIn": "Ctrl+=",
      "editor.fontZoomOut": "Ctrl+-",
      "editor.fontZoomReset": "Ctrl+0",
      "editor.goToDefinition": "Ctrl+B",
      "file.quickOpen": "Ctrl+P",
      "navigation.back": "Ctrl+[",
      "navigation.forward": "Ctrl+]",
    });
    expect(defaultKeymapSettings("linux")["terminal.show"]).toBe("Ctrl+`");
  });

  it("matches the font zoom shortcuts against the platform primary modifier", () => {
    expect(
      matchesShortcut(keyEvent({ key: "=", metaKey: true }), "Cmd+=", "mac"),
    ).toBe(true);
    expect(
      matchesShortcut(keyEvent({ key: "-", metaKey: true }), "Cmd+-", "mac"),
    ).toBe(true);
    expect(
      matchesShortcut(keyEvent({ key: "0", metaKey: true }), "Cmd+0", "mac"),
    ).toBe(true);
    expect(
      matchesShortcut(keyEvent({ key: "=", ctrlKey: true }), "Cmd+=", "linux"),
    ).toBe(true);
    expect(
      matchesShortcut(keyEvent({ key: "0", metaKey: true }), "Cmd+0", "linux"),
    ).toBe(false);
  });

  it("normalizes persisted keymaps and keeps unknown values out", () => {
    expect(
      normalizeKeymapSettings({
        "editor.save": "command + s",
        "file.quickOpen": "",
        "navigation.back": "cmd+[",
        unknown: "Cmd+X",
      }, "mac"),
    ).toMatchObject({
      "editor.save": "Cmd+S",
      "file.quickOpen": "",
      "navigation.back": "Cmd+[",
    });
  });

  it("migrates persisted Mac defaults to Ctrl on non-Mac platforms", () => {
    expect(
      normalizeKeymapSettings(
        {
          "editor.save": "Cmd+S",
          "editor.closeTab": "Cmd+W",
          "editor.goToImplementation": "Cmd+Alt+B",
          "editor.quickFix": "Alt+Enter",
          "terminal.show": "Ctrl+`",
        },
        "linux",
      ),
    ).toMatchObject({
      "editor.save": "Ctrl+S",
      "editor.closeTab": "Ctrl+W",
      "editor.goToImplementation": "Ctrl+Alt+B",
      "editor.quickFix": "Alt+Enter",
      "terminal.show": "Ctrl+`",
    });
    expect(
      normalizeKeymapSettings({ "editor.save": "Cmd+Shift+S" }, "linux")[
        "editor.save"
      ],
    ).toBe("Cmd+Shift+S");
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
    expect(
      matchesShortcut(keyEvent({ key: "[", metaKey: true }), "Cmd+[", "mac"),
    ).toBe(true);
    expect(
      matchesShortcut(
        keyEvent({ key: "f", metaKey: true, shiftKey: true }),
        "Cmd+Shift+F",
        "mac",
      ),
    ).toBe(true);
    expect(
      matchesShortcut(
        keyEvent({ key: "f", metaKey: true }),
        "Cmd+Shift+F",
        "mac",
      ),
    ).toBe(false);
    expect(matchesShortcut(keyEvent({ key: "Enter", altKey: true }), "Alt+Enter")).toBe(
      true,
    );
    expect(matchesShortcut(keyEvent({ key: "Enter", altKey: true }), "")).toBe(
      false,
    );
  });

  it("matches Cmd shortcuts against the platform primary modifier", () => {
    expect(
      matchesShortcut(keyEvent({ key: "s", ctrlKey: true }), "Cmd+S", "linux"),
    ).toBe(true);
    expect(
      matchesShortcut(keyEvent({ key: "s", metaKey: true }), "Cmd+S", "linux"),
    ).toBe(false);
    expect(
      matchesShortcut(keyEvent({ key: "s", metaKey: true }), "Cmd+S", "mac"),
    ).toBe(true);
  });

  it("matches the next and previous problem function keys", () => {
    expect(matchesShortcut(keyEvent({ key: "F8" }), "F8")).toBe(true);
    expect(
      matchesShortcut(keyEvent({ key: "F8", shiftKey: true }), "Shift+F8"),
    ).toBe(true);
    expect(matchesShortcut(keyEvent({ key: "F8", shiftKey: true }), "F8")).toBe(
      false,
    );
    expect(matchesShortcut(keyEvent({ key: "F8" }), "Shift+F8")).toBe(false);
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
    it("collects the bare-key (modifier-less) command keys from a keymap", () => {
      const keys = collectBareKeyShortcutKeys(defaultKeymapSettings("mac"));

      // F8 (Go to Next Problem) and F11 (Toggle Bookmark) are bare-key defaults.
      expect(keys.has("f8")).toBe(true);
      expect(keys.has("f11")).toBe(true);
      // Shift+F8 / Shift+F11 require Shift, so they are not bare-key keys.
      // Modifier shortcuts contribute nothing to the bare-key set.
      expect(keys.has("s")).toBe(false);
      expect(keys.has("arrowup")).toBe(false);
    });

    it("skips matching for held bare arrow keys (no modifier, not a bare-key command)", () => {
      const bareKeys = collectBareKeyShortcutKeys(defaultKeymapSettings("mac"));

      expect(
        eventCanMatchKeymapShortcut(keyEvent({ key: "ArrowUp" }), bareKeys),
      ).toBe(false);
      expect(
        eventCanMatchKeymapShortcut(keyEvent({ key: "ArrowDown" }), bareKeys),
      ).toBe(false);
      expect(eventCanMatchKeymapShortcut(keyEvent({ key: "a" }), bareKeys)).toBe(
        false,
      );
    });

    it("still matches bare-key commands like F8 and F11", () => {
      const bareKeys = collectBareKeyShortcutKeys(defaultKeymapSettings("mac"));

      expect(eventCanMatchKeymapShortcut(keyEvent({ key: "F8" }), bareKeys)).toBe(
        true,
      );
      expect(
        eventCanMatchKeymapShortcut(keyEvent({ key: "F11" }), bareKeys),
      ).toBe(true);
    });

    it("always allows matching when any non-shift modifier is held", () => {
      const bareKeys = collectBareKeyShortcutKeys(defaultKeymapSettings("mac"));

      expect(
        eventCanMatchKeymapShortcut(
          keyEvent({ key: "s", metaKey: true }),
          bareKeys,
        ),
      ).toBe(true);
      expect(
        eventCanMatchKeymapShortcut(
          keyEvent({ key: "ArrowUp", altKey: true }),
          bareKeys,
        ),
      ).toBe(true);
      expect(
        eventCanMatchKeymapShortcut(
          keyEvent({ key: "s", ctrlKey: true }),
          bareKeys,
        ),
      ).toBe(true);
    });

    it("does not early-exit a bare Shift tap (double-shift safety)", () => {
      const bareKeys = collectBareKeyShortcutKeys(defaultKeymapSettings("mac"));

      // Shift is treated as a modifier presence, so the loop is never skipped on
      // a Shift keydown. (The double-shift detector runs before this check, but
      // we keep the Shift path conservative regardless.)
      expect(
        eventCanMatchKeymapShortcut(
          keyEvent({ key: "Shift", shiftKey: true }),
          bareKeys,
        ),
      ).toBe(true);
    });
  });

  describe("findKeymapConflicts", () => {
    it("returns no conflicts when a shortcut is unique", () => {
      const keymap = defaultKeymapSettings("mac");

      expect(findKeymapConflicts(keymap, "editor.save")).toEqual([]);
    });

    it("reports the other command when two commands share a rebound shortcut", () => {
      const keymap = {
        ...defaultKeymapSettings("mac"),
        "editor.save": "Cmd+W",
      };

      expect(findKeymapConflicts(keymap, "editor.save")).toEqual([
        { id: "editor.closeTab", label: "Close Tab or Window" },
      ]);
      expect(findKeymapConflicts(keymap, "editor.closeTab")).toEqual([
        { id: "editor.save", label: "Save File" },
      ]);
    });

    it("never reports a conflict for an unbound (empty) shortcut", () => {
      const keymap = {
        ...defaultKeymapSettings("mac"),
        "php.goToTest": "",
        "php.runTest": "",
      };

      expect(findKeymapConflicts(keymap, "php.goToTest")).toEqual([]);
    });

    it("reports every other command sharing the same shortcut, not just the first", () => {
      const keymap = {
        ...defaultKeymapSettings("mac"),
        "editor.closeTab": "Cmd+S",
        "editor.goToDefinition": "Cmd+S",
      };

      const conflicts = findKeymapConflicts(keymap, "editor.save").map(
        (conflict) => conflict.id,
      );

      expect(conflicts).toEqual(
        expect.arrayContaining(["editor.closeTab", "editor.goToDefinition"]),
      );
      expect(conflicts).toHaveLength(2);
    });
  });

  describe("shortcutFromKeyboardEvent", () => {
    it("captures a modifier chord as a normalized shortcut string", () => {
      expect(
        shortcutFromKeyboardEvent(
          keyEvent({ key: "s", metaKey: true }),
        ),
      ).toBe("Cmd+S");
    });

    it("orders multiple modifiers consistently (Cmd, Ctrl, Shift, Alt)", () => {
      expect(
        shortcutFromKeyboardEvent(
          keyEvent({ altKey: true, key: "s", metaKey: true, shiftKey: true }),
        ),
      ).toBe("Cmd+Shift+Alt+S");
    });

    it("captures a Shift-only chord", () => {
      expect(
        shortcutFromKeyboardEvent(keyEvent({ key: "F12", shiftKey: true })),
      ).toBe("Shift+F12");
    });

    it("returns null while only a modifier key itself is held", () => {
      expect(
        shortcutFromKeyboardEvent(keyEvent({ key: "Meta", metaKey: true })),
      ).toBeNull();
      expect(
        shortcutFromKeyboardEvent(keyEvent({ key: "Shift", shiftKey: true })),
      ).toBeNull();
    });

    it("returns null for a bare key with no modifier held", () => {
      expect(shortcutFromKeyboardEvent(keyEvent({ key: "s" }))).toBeNull();
    });

    it("does not capture Shift+Tab so reverse focus navigation keeps working", () => {
      expect(
        shortcutFromKeyboardEvent(keyEvent({ key: "Tab", shiftKey: true })),
      ).toBeNull();
    });

    it("does not capture Shift-typed printable characters (free typing)", () => {
      // On a standard layout "+", "A" and "!" are all produced with Shift held,
      // so capturing them would hijack normal text entry in the shortcut field.
      expect(
        shortcutFromKeyboardEvent(keyEvent({ key: "+", shiftKey: true })),
      ).toBeNull();
      expect(
        shortcutFromKeyboardEvent(keyEvent({ key: "A", shiftKey: true })),
      ).toBeNull();
      expect(
        shortcutFromKeyboardEvent(keyEvent({ key: "!", shiftKey: true })),
      ).toBeNull();
    });

    it("returns null for a chord whose key is the '+' delimiter itself", () => {
      // "+" cannot be represented in the "Cmd+Shift+X" string format (it IS the
      // delimiter); capturing it would degenerate to a modifier-only string.
      expect(
        shortcutFromKeyboardEvent(
          keyEvent({ key: "+", metaKey: true, shiftKey: true }),
        ),
      ).toBeNull();
    });

    it("still captures strong-modifier chords with a printable key", () => {
      expect(
        shortcutFromKeyboardEvent(keyEvent({ altKey: true, key: "/" })),
      ).toBe("Alt+/");
    });
  });
});

function keyEvent(
  overrides: Partial<Pick<KeyboardEvent, "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey">>,
): KeyboardEvent {
  return {
    altKey: false,
    ctrlKey: false,
    key: "",
    metaKey: false,
    shiftKey: false,
    ...overrides,
  } as KeyboardEvent;
}
