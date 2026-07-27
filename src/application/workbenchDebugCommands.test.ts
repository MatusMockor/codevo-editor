import { describe, expect, it, vi } from "vitest";
import type { DebuggerSessionSnapshot } from "../domain/debugSessionState";
import { initialDebuggerSnapshot } from "../domain/debugSessionState";
import type { CommandContext } from "./commandRegistry";
import {
  hasDebuggableNodeWorkspace,
  isDebuggableNodeScriptPath,
  isDebuggablePhpScriptPath,
  workbenchDebugCommands,
} from "./workbenchDebugCommands";

const context: CommandContext = {
  hasWorkspace: true,
  hasActiveDocument: true,
  activeDocumentDirty: false,
};

function stoppedSnapshot(): DebuggerSessionSnapshot {
  return {
    lastSeq: 2,
    state: {
      kind: "stopped",
      sessionId: 4,
      reason: "breakpoint",
      frames: [],
      topFrame: null,
    },
  };
}

function runningSnapshot(): DebuggerSessionSnapshot {
  return {
    lastSeq: 1,
    state: { kind: "running", sessionId: 4 },
  };
}

function commandsWith(overrides: Partial<Parameters<typeof workbenchDebugCommands>[0]> = {}) {
  return workbenchDebugCommands({
    attachNodeDebug: vi.fn(),
    configurationLauncher: {
      busy: false,
      pickerOpen: false,
      canOpenPicker: () => true,
      openPicker: vi.fn(),
    },
    configureNodeLaunchConfigurations: vi.fn(),
    canRestartDebug: false,
    canRunToCursor: false,
    canClearDebugConsole: false,
    breakpointBulkMutationPending: false,
    breakpointCounts: { disabled: 0, enabled: 0 },
    debugRestartPending: false,
    debugCompoundStartPending: false,
    debugAddToWatch: {
      canAddToWatch: vi.fn(() => false),
      addToWatch: vi.fn(() => false),
    },
    debugControlPending: false,
    debugStopPending: false,
    debugSessionAttached: false,
    debugStartPending: false,
    debugEvaluateInConsole: {
      canEvaluateInConsole: vi.fn(() => false),
      evaluateInConsole: vi.fn(() => false),
    },
    debugBreakpointNavigation: {
      canGoToNextBreakpoint: vi.fn(() => false),
      canGoToPreviousBreakpoint: vi.fn(() => false),
      goToNextBreakpoint: vi.fn(() => false),
      goToPreviousBreakpoint: vi.fn(() => false),
    },
    debugInlineBreakpoint: {
      addInlineBreakpoint: vi.fn(() => false),
      canAddInlineBreakpoint: vi.fn(() => false),
    },
    debugCopyValue: {
      canCopyEvaluatePath: vi.fn(() => false),
      canCopyValue: vi.fn(() => false),
      copyEvaluatePath: vi.fn(async () => false),
      copyValue: vi.fn(async () => false),
    },
    debugCopyStackTrace: {
      canCopyStackTrace: vi.fn(() => false),
      copyStackTrace: vi.fn(() => false),
    },
    debugCallStackNavigation: {
      canSelectCallStackFrame: vi.fn(() => false),
      selectCallStackTop: vi.fn(() => false),
      selectCallStackBottom: vi.fn(() => false),
      selectCallStackUp: vi.fn(() => false),
      selectCallStackDown: vi.fn(() => false),
    },
    debugRestartFrame: {
      canRestartFrame: vi.fn(() => false),
      restartFrame: vi.fn(() => false),
    },
    debugSetVariable: {
      canBeginEdit: vi.fn(() => false),
      beginEdit: vi.fn(() => false),
    },
    debugWatchAtCursor: {
      addToWatchAtCursor: vi.fn(() => false),
      canAddAtCursor: vi.fn(() => false),
    },
    shortcut: () => "",
    hasJsWorkspace: true,
    hasPhpWorkspace: false,
    isActiveDocumentDebuggable: true,
    isWorkspaceTrusted: true,
    snapshot: initialDebuggerSnapshot(),
    openDebugPanel: vi.fn(),
    clearDebugConsole: vi.fn(),
    focusDebugConsole: vi.fn(),
    disableAllBreakpoints: vi.fn(),
    enableAllBreakpoints: vi.fn(),
    pauseDebug: vi.fn(),
    restartDebug: vi.fn(),
    runToCursor: vi.fn(),
    removeAllBreakpoints: vi.fn(),
    startOrContinueDebug: vi.fn(),
    startPhpListenDebug: vi.fn(),
    stepDebug: vi.fn(),
    stopDebug: vi.fn(),
    disconnectDebug: vi.fn(),
    toggleBreakpointAtCursor: vi.fn(),
    ...overrides,
  });
}

function command(commands: ReturnType<typeof workbenchDebugCommands>, id: string) {
  const found = commands.find((entry) => entry.id === id);
  expect(found).toBeDefined();
  return found as NonNullable<typeof found>;
}

describe("workbenchDebugCommands", () => {
  it("recognizes a bare Node script inside an otherwise uninferred workspace", () => {
    expect(
      hasDebuggableNodeWorkspace({
        activeDocument: { path: "/workspace/launch.json" },
        detectedJavaScriptTypeScript: false,
        openedDocuments: [{ path: "/workspace/server.js" }],
        workspaceRoot: "/workspace",
      }),
    ).toBe(true);
    expect(
      hasDebuggableNodeWorkspace({
        activeDocument: { path: "/outside/server.js" },
        detectedJavaScriptTypeScript: false,
        workspaceRoot: "/workspace",
      }),
    ).toBe(false);
    expect(
      hasDebuggableNodeWorkspace({
        activeDocument: { path: "/workspace/readme.md" },
        detectedJavaScriptTypeScript: false,
        workspaceRoot: "/workspace",
      }),
    ).toBe(false);
    expect(
      hasDebuggableNodeWorkspace({
        activeDocument: { path: "/workspace/server.js" },
        detectedJavaScriptTypeScript: true,
        workspaceRoot: null,
      }),
    ).toBe(false);
  });

  it("routes Set Value only through the live focused writable-row capability", () => {
    let writableRowFocused = true;
    const debugSetVariable = {
      canBeginEdit: vi.fn(() => writableRowFocused),
      beginEdit: vi.fn(() => true),
    };
    const configured = command(commandsWith({ debugSetVariable }), "debug.setVariable");

    expect(configured).toMatchObject({
      category: "Debug",
      id: "debug.setVariable",
      title: "Set Value",
    });
    expect(configured.shortcut).toBe("");
    expect(configured.isEnabled(context)).toBe(true);
    void configured.run(context);
    expect(debugSetVariable.beginEdit).toHaveBeenCalledOnce();

    writableRowFocused = false;
    expect(configured.isEnabled(context)).toBe(false);
  });

  it("registers Restart Frame as an unbound callable context action outside Command Palette", () => {
    let restartable = true;
    const restartFrame = {
      canRestartFrame: vi.fn(() => restartable),
      restartFrame: vi.fn(() => true),
    };
    const configured = command(
      commandsWith({ debugRestartFrame: restartFrame }),
      "workbench.action.debug.restartFrame",
    );

    expect(configured).toMatchObject({
      category: "Debug",
      id: "workbench.action.debug.restartFrame",
      title: "Restart Frame",
      visibleInCommandPalette: false,
    });
    expect(configured.shortcut).toBeUndefined();
    expect(configured.isEnabled(context)).toBe(true);
    restartable = false;
    expect(configured.isEnabled(context)).toBe(false);
    void configured.run(context);
    expect(restartFrame.restartFrame).toHaveBeenCalledOnce();
  });

  it("exposes the official unbound Call Stack navigation commands through one live capability", () => {
    let selectable = true;
    const navigation = {
      canSelectCallStackFrame: vi.fn(() => selectable),
      selectCallStackTop: vi.fn(() => true),
      selectCallStackBottom: vi.fn(() => true),
      selectCallStackUp: vi.fn(() => true),
      selectCallStackDown: vi.fn(() => true),
    };
    const configured = commandsWith({
      debugCallStackNavigation: navigation,
      snapshot: stoppedSnapshot(),
    });
    const expected = [
      ["workbench.action.debug.callStackTop", "Debug: Navigate to Top of Call Stack"],
      ["workbench.action.debug.callStackBottom", "Debug: Navigate to Bottom of Call Stack"],
      ["workbench.action.debug.callStackUp", "Debug: Navigate Up Call Stack"],
      ["workbench.action.debug.callStackDown", "Debug: Navigate Down Call Stack"],
    ] as const;

    for (const [id, title] of expected) {
      const item = command(configured, id);
      expect(item).toMatchObject({ category: "Debug", id, title });
      expect(item.shortcut).toBeUndefined();
      expect(Object.keys(item).sort()).toEqual(["category", "id", "isEnabled", "run", "title"]);
      expect(item.isEnabled(context)).toBe(true);
    }
    expect(navigation.canSelectCallStackFrame).toHaveBeenCalledTimes(4);

    selectable = false;
    for (const [id] of expected) {
      expect(command(configured, id).isEnabled(context)).toBe(false);
    }

    for (const [id] of expected) {
      void command(configured, id).run(context);
    }
    expect(navigation.selectCallStackTop).toHaveBeenCalledOnce();
    expect(navigation.selectCallStackBottom).toHaveBeenCalledOnce();
    expect(navigation.selectCallStackUp).toHaveBeenCalledOnce();
    expect(navigation.selectCallStackDown).toHaveBeenCalledOnce();
  });

  it("keeps official Call Stack ids collision-free without replacing legacy debug commands", () => {
    const commands = commandsWith();
    const ids = commands.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      expect.arrayContaining([
        "workbench.action.debug.callStackTop",
        "workbench.action.debug.callStackBottom",
        "workbench.action.debug.callStackUp",
        "workbench.action.debug.callStackDown",
        "debug.copyStackTrace",
        "debug.continue",
        "debug.stepOver",
      ]),
    );
  });

  it("exposes the official unbound Copy Call Stack command through its live capability only", () => {
    let accepted = true;
    const canCopyStackTrace = vi.fn(() => accepted);
    const copyStackTrace = vi.fn(() => accepted);
    const copy = command(
      commandsWith({
        debugCopyStackTrace: { canCopyStackTrace, copyStackTrace },
        hasJsWorkspace: false,
        hasPhpWorkspace: true,
        isWorkspaceTrusted: false,
        snapshot: runningSnapshot(),
      }),
      "debug.copyStackTrace",
    );

    expect(copy).toMatchObject({
      category: "Debug",
      id: "debug.copyStackTrace",
      title: "Debug: Copy Call Stack",
    });
    expect(copy.shortcut).toBeUndefined();
    expect(Object.keys(copy).sort()).toEqual(["category", "id", "isEnabled", "run", "title"]);
    expect(copy.isEnabled(context)).toBe(true);
    expect(copy.isEnabled({ ...context, hasActiveDocument: false, hasWorkspace: false })).toBe(
      true,
    );
    expect(canCopyStackTrace).toHaveBeenCalledTimes(2);

    accepted = false;
    expect(copy.isEnabled(context)).toBe(false);
    accepted = true;
    void copy.run(context);
    expect(copyStackTrace).toHaveBeenCalledOnce();
  });

  it("exposes hidden official Copy Value through live focused-candidate capability only", async () => {
    let enabled = true;
    const canCopyValue = vi.fn(() => enabled);
    const copyValue = vi.fn(async () => true);
    const copy = command(
      commandsWith({
        debugCopyValue: {
          canCopyEvaluatePath: vi.fn(() => false),
          canCopyValue,
          copyEvaluatePath: vi.fn(async () => false),
          copyValue,
        },
      }),
      "workbench.debug.viewlet.action.copyValue",
    );

    expect(copy).toMatchObject({
      category: "Debug",
      id: "workbench.debug.viewlet.action.copyValue",
      title: "Copy Value",
      visibleInCommandPalette: false,
    });
    expect(copy.shortcut).toBeUndefined();
    expect(Object.keys(copy).sort()).toEqual([
      "category",
      "id",
      "isEnabled",
      "run",
      "title",
      "visibleInCommandPalette",
    ]);
    expect(copy.isEnabled(context)).toBe(true);
    expect(copy.isEnabled({ ...context, hasActiveDocument: false, hasWorkspace: false })).toBe(
      true,
    );
    enabled = false;
    expect(copy.isEnabled(context)).toBe(false);
    enabled = true;
    await copy.run(context);
    expect(copyValue).toHaveBeenCalledOnce();
  });

  it("exposes hidden official Copy as Expression through its live capability only", async () => {
    let enabled = true;
    const canCopyEvaluatePath = vi.fn(() => enabled);
    const copyEvaluatePath = vi.fn(async () => true);
    const copy = command(
      commandsWith({
        debugCopyValue: {
          canCopyEvaluatePath,
          canCopyValue: vi.fn(() => false),
          copyEvaluatePath,
          copyValue: vi.fn(async () => false),
        },
      }),
      "debug.copyEvaluatePath",
    );

    expect(copy).toMatchObject({
      category: "Debug",
      id: "debug.copyEvaluatePath",
      title: "Copy as Expression",
      visibleInCommandPalette: false,
    });
    expect(copy.shortcut).toBeUndefined();
    expect(Object.keys(copy).sort()).toEqual([
      "category",
      "id",
      "isEnabled",
      "run",
      "title",
      "visibleInCommandPalette",
    ]);
    expect(copy.isEnabled(context)).toBe(true);
    expect(copy.isEnabled({ ...context, hasActiveDocument: false, hasWorkspace: false })).toBe(
      true,
    );
    enabled = false;
    expect(copy.isEnabled(context)).toBe(false);
    enabled = true;
    await copy.run(context);
    expect(copyEvaluatePath).toHaveBeenCalledOnce();
  });

  it("exposes hidden official Add to Watch without a shortcut", () => {
    let enabled = true;
    const canAddToWatch = vi.fn(() => enabled);
    const addToWatch = vi.fn(() => true);
    const add = command(
      commandsWith({ debugAddToWatch: { canAddToWatch, addToWatch } }),
      "debug.addToWatchExpressions",
    );

    expect(add).toMatchObject({
      category: "Debug",
      id: "debug.addToWatchExpressions",
      title: "Add to Watch",
      visibleInCommandPalette: false,
    });
    expect(add.shortcut).toBeUndefined();
    expect(add.isEnabled(context)).toBe(true);
    enabled = false;
    expect(add.isEnabled(context)).toBe(false);
    enabled = true;
    add.run(context);
    expect(addToWatch).toHaveBeenCalledOnce();
  });

  it("exposes the official unbound breakpoint navigation pair through live capabilities only", () => {
    let canNext = true;
    let canPrevious = false;
    const navigation = {
      canGoToNextBreakpoint: vi.fn(() => canNext),
      canGoToPreviousBreakpoint: vi.fn(() => canPrevious),
      goToNextBreakpoint: vi.fn(() => true),
      goToPreviousBreakpoint: vi.fn(() => true),
    };
    const configured = commandsWith({
      debugBreakpointNavigation: navigation,
      isWorkspaceTrusted: false,
      snapshot: runningSnapshot(),
    });
    const next = command(configured, "editor.debug.action.goToNextBreakpoint");
    const previous = command(configured, "editor.debug.action.goToPreviousBreakpoint");

    expect(next).toMatchObject({
      category: "Debug",
      id: "editor.debug.action.goToNextBreakpoint",
      title: "Debug: Go to Next Breakpoint",
    });
    expect(previous).toMatchObject({
      category: "Debug",
      id: "editor.debug.action.goToPreviousBreakpoint",
      title: "Debug: Go to Previous Breakpoint",
    });
    expect(next.shortcut).toBeUndefined();
    expect(previous.shortcut).toBeUndefined();
    expect(Object.keys(next).sort()).toEqual(["category", "id", "isEnabled", "run", "title"]);
    expect(Object.keys(previous).sort()).toEqual(["category", "id", "isEnabled", "run", "title"]);

    // Navigation is editor/model-owned: it requires neither workspace trust nor
    // an active debug session, and the command layer re-reads each direction.
    expect(next.isEnabled(context)).toBe(true);
    expect(previous.isEnabled(context)).toBe(false);
    canNext = false;
    canPrevious = true;
    expect(next.isEnabled(context)).toBe(false);
    expect(previous.isEnabled(context)).toBe(true);

    expect(next.isEnabled({ ...context, hasWorkspace: false })).toBe(false);
    expect(previous.isEnabled({ ...context, hasWorkspace: false })).toBe(false);
    const nonJs = commandsWith({
      debugBreakpointNavigation: navigation,
      hasJsWorkspace: false,
    });
    expect(command(nonJs, "editor.debug.action.goToNextBreakpoint").isEnabled(context)).toBe(false);
    expect(command(nonJs, "editor.debug.action.goToPreviousBreakpoint").isEnabled(context)).toBe(
      false,
    );

    void next.run(context);
    void previous.run(context);
    expect(navigation.goToNextBreakpoint).toHaveBeenCalledOnce();
    expect(navigation.goToPreviousBreakpoint).toHaveBeenCalledOnce();
  });

  it("exposes the official Shift+F9 inline breakpoint command through its live capture", () => {
    let accepted = true;
    const inline = {
      addInlineBreakpoint: vi.fn(() => true),
      canAddInlineBreakpoint: vi.fn(() => accepted),
    };
    const configured = command(
      commandsWith({
        debugInlineBreakpoint: inline,
        shortcut: (id) =>
          id === "editor.debug.action.toggleInlineBreakpoint" ? "Shift+F9" : `key:${id}`,
      }),
      "editor.debug.action.toggleInlineBreakpoint",
    );

    expect(configured).toMatchObject({
      category: "Debug",
      id: "editor.debug.action.toggleInlineBreakpoint",
      shortcut: "Shift+F9",
      title: "Debug: Inline Breakpoint",
    });
    expect(configured.isEnabled(context)).toBe(true);
    accepted = false;
    expect(configured.isEnabled(context)).toBe(false);
    expect(configured.isEnabled({ ...context, hasWorkspace: false })).toBe(false);
    expect(
      command(
        commandsWith({ debugInlineBreakpoint: inline, hasJsWorkspace: false }),
        "editor.debug.action.toggleInlineBreakpoint",
      ).isEnabled(context),
    ).toBe(false);
    void configured.run(context);
    expect(inline.addInlineBreakpoint).toHaveBeenCalledOnce();
  });

  it("exposes Evaluate in Console without projecting an expression or shortcut", () => {
    let accepted = true;
    const canEvaluateInConsole = vi.fn(() => accepted);
    const evaluateInConsole = vi.fn(() => accepted);
    const evaluate = command(
      commandsWith({ debugEvaluateInConsole: { canEvaluateInConsole, evaluateInConsole } }),
      "debug.evaluateInConsole",
    );

    expect(evaluate).toMatchObject({
      category: "Debug",
      id: "debug.evaluateInConsole",
      title: "Debug: Evaluate in Console",
    });
    expect(evaluate.shortcut).toBeUndefined();
    expect(Object.keys(evaluate).sort()).toEqual(["category", "id", "isEnabled", "run", "title"]);
    expect(evaluate.isEnabled(context)).toBe(true);
    expect(canEvaluateInConsole).toHaveBeenCalledOnce();

    accepted = false;
    expect(evaluate.isEnabled(context)).toBe(false);
    expect(evaluate.isEnabled({ ...context, hasWorkspace: false })).toBe(false);
    expect(
      command(
        commandsWith({
          debugEvaluateInConsole: { canEvaluateInConsole, evaluateInConsole },
          hasJsWorkspace: false,
        }),
        "debug.evaluateInConsole",
      ).isEnabled(context),
    ).toBe(false);

    void evaluate.run(context);
    expect(evaluateInConsole).toHaveBeenCalledOnce();
  });

  it("exposes Add to Watch without a shortcut and revalidates its live capability", () => {
    let accepted = true;
    const addToWatchAtCursor = vi.fn(() => accepted);
    const canAddAtCursor = vi.fn(() => accepted);
    const add = command(
      commandsWith({ debugWatchAtCursor: { addToWatchAtCursor, canAddAtCursor } }),
      "debug.addToWatchAtCursor",
    );

    expect(add).toMatchObject({
      category: "Debug",
      id: "debug.addToWatchAtCursor",
      title: "Debug: Add to Watch",
    });
    expect(add.shortcut).toBeUndefined();
    expect(add.isEnabled(context)).toBe(true);
    expect(canAddAtCursor).toHaveBeenCalledOnce();
    expect(
      command(
        commandsWith({
          debugWatchAtCursor: { addToWatchAtCursor, canAddAtCursor },
          isWorkspaceTrusted: false,
          snapshot: runningSnapshot(),
        }),
        "debug.addToWatchAtCursor",
      ).isEnabled(context),
    ).toBe(true);

    accepted = false;
    expect(add.isEnabled(context)).toBe(false);
    expect(add.isEnabled({ ...context, hasWorkspace: false })).toBe(false);
    expect(
      command(
        commandsWith({
          debugWatchAtCursor: { addToWatchAtCursor, canAddAtCursor },
          hasJsWorkspace: false,
        }),
        "debug.addToWatchAtCursor",
      ).isEnabled(context),
    ).toBe(false);

    void add.run(context);
    expect(addToWatchAtCursor).toHaveBeenCalledOnce();
  });

  it("exposes unbound Node launch configuration editing for a current JS/TS workspace", () => {
    const configureNodeLaunchConfigurations = vi.fn();
    const configure = command(
      commandsWith({ configureNodeLaunchConfigurations }),
      "debug.configureNodeLaunchConfigurations",
    );

    expect(configure).toMatchObject({
      category: "Run",
      id: "debug.configureNodeLaunchConfigurations",
      title: "Run: Configure Node Launch Configurations",
    });
    expect(configure.shortcut).toBeUndefined();
    expect(
      configure.isEnabled({
        activeDocumentDirty: true,
        hasActiveDocument: false,
        hasWorkspace: true,
      }),
    ).toBe(true);
    expect(configure.isEnabled({ ...context, hasWorkspace: false })).toBe(false);
    expect(
      command(
        commandsWith({ configureNodeLaunchConfigurations, hasJsWorkspace: false }),
        "debug.configureNodeLaunchConfigurations",
      ).isEnabled(context),
    ).toBe(false);

    void configure.run(context);
    expect(configureNodeLaunchConfigurations).toHaveBeenCalledOnce();
  });

  it("focuses and clears the Debug Console through separate narrow capabilities", () => {
    const focusDebugConsole = vi.fn();
    const clearDebugConsole = vi.fn();
    const configured = commandsWith({
      canClearDebugConsole: true,
      clearDebugConsole,
      focusDebugConsole,
    });
    const focus = command(configured, "debug.focusConsole");
    const clear = command(configured, "debug.clearConsole");

    expect(focus.isEnabled(context)).toBe(true);
    expect(focus.isEnabled({ ...context, hasWorkspace: false })).toBe(false);
    expect(focus.shortcut).toBe("");
    focus.run(context);
    expect(focusDebugConsole).toHaveBeenCalledOnce();

    expect(clear.isEnabled(context)).toBe(true);
    expect(clear.isEnabled({ ...context, hasWorkspace: false })).toBe(false);
    clear.run(context);
    expect(clearDebugConsole).toHaveBeenCalledOnce();
    expect(
      command(commandsWith({ canClearDebugConsole: false }), "debug.clearConsole").isEnabled(
        context,
      ),
    ).toBe(false);
    expect(
      command(commandsWith({ isWorkspaceTrusted: false }), "debug.focusConsole").isEnabled(context),
    ).toBe(false);
    expect(
      command(
        commandsWith({ canClearDebugConsole: true, isWorkspaceTrusted: false }),
        "debug.clearConsole",
      ).isEnabled(context),
    ).toBe(false);
  });
  it("runs to cursor only through the exact clean stopped Node capability", () => {
    const runToCursor = vi.fn();
    const configured = commandsWith({
      canRunToCursor: true,
      runToCursor,
      snapshot: stoppedSnapshot(),
    });
    const run = command(configured, "debug.runToCursor");

    expect(run.shortcut).toBe("");
    expect(run.isEnabled(context)).toBe(true);
    void run.run(context);
    expect(runToCursor).toHaveBeenCalledOnce();
    expect(run.isEnabled({ ...context, activeDocumentDirty: true })).toBe(false);
    expect(
      command(
        commandsWith({ canRunToCursor: true, snapshot: runningSnapshot() }),
        "debug.runToCursor",
      ).isEnabled(context),
    ).toBe(false);

    for (const options of [
      { canRunToCursor: false },
      { debugControlPending: true },
      { debugRestartPending: true },
      { debugStopPending: true },
      { debugStartPending: true },
      { breakpointBulkMutationPending: true },
      { isWorkspaceTrusted: false },
    ]) {
      expect(
        command(
          commandsWith({ ...options, canRunToCursor: options.canRunToCursor ?? true }),
          "debug.runToCursor",
        ).isEnabled(context),
      ).toBe(false);
    }
  });

  it("enables start for a trusted JS workspace with a debuggable document", () => {
    expect(command(commandsWith(), "debug.start").isEnabled(context)).toBe(true);
  });

  it("disables start in an untrusted workspace", () => {
    expect(
      command(commandsWith({ isWorkspaceTrusted: false }), "debug.start").isEnabled(context),
    ).toBe(false);
  });

  it("keeps compound pending cancellation on Stop and disables another Start", () => {
    const configured = commandsWith({
      debugCompoundStartPending: true,
      debugStartPending: true,
    });

    expect(command(configured, "debug.start").isEnabled(context)).toBe(false);
    expect(command(configured, "debug.stop").isEnabled(context)).toBe(true);
  });

  it("disables start without a debuggable active document", () => {
    expect(
      command(commandsWith({ isActiveDocumentDebuggable: false }), "debug.start").isEnabled(
        context,
      ),
    ).toBe(false);
  });

  it("enables start for a trusted PHP workspace without JS", () => {
    expect(
      command(
        commandsWith({ hasJsWorkspace: false, hasPhpWorkspace: true }),
        "debug.start",
      ).isEnabled(context),
    ).toBe(true);
  });

  it("disables start without any debuggable workspace", () => {
    expect(command(commandsWith({ hasJsWorkspace: false }), "debug.start").isEnabled(context)).toBe(
      false,
    );
  });

  it("enables PHP listen for a trusted PHP workspace without a session", () => {
    const startPhpListenDebug = vi.fn();
    const commands = commandsWith({
      hasJsWorkspace: false,
      hasPhpWorkspace: true,
      startPhpListenDebug,
    });

    expect(command(commands, "debug.listenPhp").isEnabled(context)).toBe(true);
    void command(commands, "debug.listenPhp").run(context);
    expect(startPhpListenDebug).toHaveBeenCalled();
  });

  it("disables PHP listen without a PHP workspace", () => {
    expect(command(commandsWith(), "debug.listenPhp").isEnabled(context)).toBe(false);
  });

  it("disables PHP listen in an untrusted workspace", () => {
    expect(
      command(
        commandsWith({ hasPhpWorkspace: true, isWorkspaceTrusted: false }),
        "debug.listenPhp",
      ).isEnabled(context),
    ).toBe(false);
  });

  it("disables PHP listen while a session is active", () => {
    expect(
      command(
        commandsWith({ hasPhpWorkspace: true, snapshot: runningSnapshot() }),
        "debug.listenPhp",
      ).isEnabled(context),
    ).toBe(false);
    expect(
      command(
        commandsWith({ hasPhpWorkspace: true, snapshot: stoppedSnapshot() }),
        "debug.listenPhp",
      ).isEnabled(context),
    ).toBe(false);
  });

  it("keeps start enabled as continue while the session is stopped", () => {
    expect(
      command(
        commandsWith({
          isActiveDocumentDebuggable: false,
          snapshot: stoppedSnapshot(),
        }),
        "debug.start",
      ).isEnabled(context),
    ).toBe(true);
  });

  it("trust-gates start-as-continue and blocks it while stop is pending", () => {
    expect(
      command(
        commandsWith({ isWorkspaceTrusted: false, snapshot: stoppedSnapshot() }),
        "debug.start",
      ).isEnabled(context),
    ).toBe(false);
    expect(
      command(
        commandsWith({ debugStopPending: true, snapshot: stoppedSnapshot() }),
        "debug.start",
      ).isEnabled(context),
    ).toBe(false);
  });

  it("disables start while the session is already running", () => {
    expect(
      command(commandsWith({ snapshot: runningSnapshot() }), "debug.start").isEnabled(context),
    ).toBe(false);
  });

  it("opens the Node configuration picker from an idle trusted JS workspace", () => {
    const openPicker = vi.fn();
    const selectAndStart = command(
      commandsWith({
        configurationLauncher: {
          busy: false,
          pickerOpen: false,
          canOpenPicker: () => true,
          openPicker,
        },
      }),
      "debug.selectAndStartConfiguration",
    );

    expect(selectAndStart.title).toBe("Debug: Select and Start Configuration");
    expect(selectAndStart.category).toBe("Debug");
    expect(selectAndStart.shortcut).toBeUndefined();
    expect(selectAndStart.isEnabled(context)).toBe(true);

    void selectAndStart.run(context);

    expect(openPicker).toHaveBeenCalledOnce();
  });

  it.each<[string, Partial<Parameters<typeof workbenchDebugCommands>[0]>, CommandContext]>([
    ["without a workspace", {}, { ...context, hasWorkspace: false }],
    ["for a PHP-only workspace", { hasJsWorkspace: false, hasPhpWorkspace: true }, context],
    ["in an untrusted workspace", { isWorkspaceTrusted: false }, context],
    ["while debug start is pending", { debugStartPending: true }, context],
    ["while debug restart is pending", { debugRestartPending: true }, context],
    ["while debug stop is pending", { debugStopPending: true }, context],
    ["while a debugger is running", { snapshot: runningSnapshot() }, context],
    ["while a debugger is stopped", { snapshot: stoppedSnapshot() }, context],
  ])("disables configuration selection %s", (_label, options, commandContext) => {
    const configured = commandsWith(options);

    expect(command(configured, "debug.selectAndStartConfiguration").isEnabled(commandContext)).toBe(
      false,
    );
  });

  it("disables configuration selection while its launcher is unavailable, busy, or open", () => {
    for (const configurationLauncher of [
      { busy: false, pickerOpen: false, canOpenPicker: () => false, openPicker: vi.fn() },
      { busy: true, pickerOpen: false, canOpenPicker: () => true, openPicker: vi.fn() },
      { busy: false, pickerOpen: true, canOpenPicker: () => true, openPicker: vi.fn() },
    ]) {
      expect(
        command(
          commandsWith({ configurationLauncher }),
          "debug.selectAndStartConfiguration",
        ).isEnabled(context),
      ).toBe(false);
    }
  });

  it("restarts only with workspace, trust, exact capability, and no pending restart", () => {
    const restartDebug = vi.fn();
    const enabled = commandsWith({ canRestartDebug: true, restartDebug });
    const restart = command(enabled, "debug.restart");

    expect(restart.title).toBe("Debug: Restart");
    expect(restart.category).toBe("Debug");
    expect(restart.isEnabled(context)).toBe(true);
    void restart.run(context);
    expect(restartDebug).toHaveBeenCalledOnce();

    expect(restart.isEnabled({ ...context, hasWorkspace: false })).toBe(false);
    expect(
      command(
        commandsWith({ canRestartDebug: true, isWorkspaceTrusted: false }),
        "debug.restart",
      ).isEnabled(context),
    ).toBe(false);
    expect(command(commandsWith(), "debug.restart").isEnabled(context)).toBe(false);
    expect(
      command(
        commandsWith({ canRestartDebug: true, debugRestartPending: true }),
        "debug.restart",
      ).isEnabled(context),
    ).toBe(false);
    expect(
      command(
        commandsWith({ canRestartDebug: true, debugStopPending: true }),
        "debug.restart",
      ).isEnabled(context),
    ).toBe(false);
  });

  it("gates step commands on a stopped session and dispatches the step kind", () => {
    const stepDebug = vi.fn();
    const stopped = commandsWith({ snapshot: stoppedSnapshot(), stepDebug });
    const inactive = commandsWith();

    for (const [id, kind] of [
      ["debug.continue", "continue"],
      ["debug.stepOver", "stepOver"],
      ["debug.stepInto", "stepInto"],
      ["debug.stepOut", "stepOut"],
    ] as const) {
      expect(command(inactive, id).isEnabled(context)).toBe(false);
      expect(command(stopped, id).isEnabled(context)).toBe(true);
      void command(stopped, id).run(context);
      expect(stepDebug).toHaveBeenLastCalledWith(kind);
    }
  });

  it.each(["debug.continue", "debug.stepOver", "debug.stepInto", "debug.stepOut"] as const)(
    "gates %s on the exact trusted, stopped, mutation-free state",
    (id) => {
      expect(command(commandsWith({ snapshot: stoppedSnapshot() }), id).isEnabled(context)).toBe(
        true,
      );

      for (const overrides of [
        {},
        { snapshot: runningSnapshot() },
        { snapshot: stoppedSnapshot(), isWorkspaceTrusted: false },
        { snapshot: stoppedSnapshot(), debugStartPending: true },
        { snapshot: stoppedSnapshot(), debugRestartPending: true },
        { snapshot: stoppedSnapshot(), debugStopPending: true },
        { snapshot: stoppedSnapshot(), debugControlPending: true },
        { snapshot: stoppedSnapshot(), breakpointBulkMutationPending: true },
      ]) {
        expect(
          command(commandsWith(overrides), id).isEnabled(context),
          JSON.stringify(overrides),
        ).toBe(false);
      }
    },
  );

  it("enables pause only while running and stop for any active session", () => {
    const inactive = commandsWith();
    const running = commandsWith({ snapshot: runningSnapshot() });
    const stopped = commandsWith({ snapshot: stoppedSnapshot() });

    expect(command(inactive, "debug.pause").isEnabled(context)).toBe(false);
    expect(command(running, "debug.pause").isEnabled(context)).toBe(true);
    expect(command(stopped, "debug.pause").isEnabled(context)).toBe(false);

    expect(command(inactive, "debug.stop").isEnabled(context)).toBe(false);
    expect(command(running, "debug.stop").isEnabled(context)).toBe(true);
    expect(command(stopped, "debug.stop").isEnabled(context)).toBe(true);
  });

  it("switches Shift+F5 between launch Stop and exact attach Disconnect", () => {
    const stopDebug = vi.fn();
    const disconnectDebug = vi.fn();
    const launched = commandsWith({ snapshot: runningSnapshot(), stopDebug, disconnectDebug });
    const attached = commandsWith({
      debugSessionAttached: true,
      snapshot: runningSnapshot(),
      stopDebug,
      disconnectDebug,
    });

    expect(command(launched, "debug.stop").isEnabled(context)).toBe(true);
    expect(command(launched, "workbench.action.debug.disconnect").isEnabled(context)).toBe(false);
    expect(command(attached, "debug.stop").isEnabled(context)).toBe(false);
    const disconnect = command(attached, "workbench.action.debug.disconnect");
    expect(disconnect).toMatchObject({
      category: "Debug",
      title: "Debug: Disconnect",
    });
    expect(disconnect.isEnabled(context)).toBe(true);
    disconnect.run(context);
    expect(disconnectDebug).toHaveBeenCalledOnce();
    expect(stopDebug).not.toHaveBeenCalled();

    for (const overrides of [{ debugStopPending: true }, { debugRestartPending: true }]) {
      const pending = commandsWith({
        ...overrides,
        debugSessionAttached: true,
        snapshot: runningSnapshot(),
      });
      expect(command(pending, "workbench.action.debug.disconnect").isEnabled(context)).toBe(false);
    }
    expect(
      command(
        commandsWith({
          debugSessionAttached: true,
          isWorkspaceTrusted: false,
          snapshot: runningSnapshot(),
        }),
        "workbench.action.debug.disconnect",
      ).isEnabled(context),
    ).toBe(true);
  });

  it("locks session mutations while stop is pending and keeps stop trust-independent", () => {
    const pendingStopped = commandsWith({
      canRestartDebug: true,
      canRunToCursor: true,
      canClearDebugConsole: true,
      debugStopPending: true,
      snapshot: stoppedSnapshot(),
    });
    for (const id of [
      "debug.start",
      "debug.continue",
      "debug.stepOver",
      "debug.stepInto",
      "debug.stepOut",
      "debug.stop",
      "debug.restart",
    ]) {
      expect(command(pendingStopped, id).isEnabled(context), id).toBe(false);
    }
    expect(
      command(
        commandsWith({ debugStopPending: true, snapshot: runningSnapshot() }),
        "debug.pause",
      ).isEnabled(context),
    ).toBe(false);

    const untrustedStopped = commandsWith({
      canRestartDebug: true,
      isWorkspaceTrusted: false,
      snapshot: stoppedSnapshot(),
    });
    for (const id of [
      "debug.start",
      "debug.continue",
      "debug.stepOver",
      "debug.stepInto",
      "debug.stepOut",
      "debug.restart",
    ]) {
      expect(command(untrustedStopped, id).isEnabled(context), id).toBe(false);
    }
    expect(command(untrustedStopped, "debug.stop").isEnabled(context)).toBe(true);
    expect(
      command(
        commandsWith({ isWorkspaceTrusted: false, snapshot: runningSnapshot() }),
        "debug.pause",
      ).isEnabled(context),
    ).toBe(false);
  });

  it("locks every session mutation command while restart is pending", () => {
    const pendingStopped = commandsWith({
      canRestartDebug: true,
      debugRestartPending: true,
      snapshot: stoppedSnapshot(),
    });
    for (const id of [
      "debug.start",
      "debug.continue",
      "debug.stepOver",
      "debug.stepInto",
      "debug.stepOut",
      "debug.stop",
      "debug.restart",
    ]) {
      expect(command(pendingStopped, id).isEnabled(context), id).toBe(false);
    }

    const pendingRunning = commandsWith({
      debugRestartPending: true,
      snapshot: runningSnapshot(),
    });
    expect(command(pendingRunning, "debug.pause").isEnabled(context)).toBe(false);
    expect(command(pendingRunning, "debug.stop").isEnabled(context)).toBe(false);

    const pendingInactive = commandsWith({
      debugRestartPending: true,
      hasPhpWorkspace: true,
    });
    for (const id of ["debug.start", "debug.attachNode", "debug.listenPhp"]) {
      expect(command(pendingInactive, id).isEnabled(context), id).toBe(false);
    }
  });

  it("enables toggle breakpoint only with an active document", () => {
    const commands = commandsWith();

    expect(command(commands, "debug.toggleBreakpoint").isEnabled(context)).toBe(true);
    expect(
      command(commands, "debug.toggleBreakpoint").isEnabled({
        ...context,
        hasActiveDocument: false,
      }),
    ).toBe(false);
  });

  it("registers shortcut-free bulk breakpoint commands and dispatches their exact capability", () => {
    const enableAllBreakpoints = vi.fn();
    const disableAllBreakpoints = vi.fn();
    const removeAllBreakpoints = vi.fn();
    const commands = commandsWith({
      breakpointCounts: { disabled: 2, enabled: 3 },
      disableAllBreakpoints,
      enableAllBreakpoints,
      removeAllBreakpoints,
    });

    for (const [id, title, run] of [
      ["debug.enableAllBreakpoints", "Debug: Enable All Breakpoints", enableAllBreakpoints],
      ["debug.disableAllBreakpoints", "Debug: Disable All Breakpoints", disableAllBreakpoints],
      ["debug.removeAllBreakpoints", "Debug: Remove All Breakpoints", removeAllBreakpoints],
    ] as const) {
      const bulkCommand = command(commands, id);
      expect(bulkCommand.title).toBe(title);
      expect(bulkCommand.category).toBe("Debug");
      expect(bulkCommand.shortcut).toBeUndefined();
      expect(bulkCommand.isEnabled(context)).toBe(true);

      void bulkCommand.run(context);

      expect(run).toHaveBeenCalledOnce();
    }
  });

  it.each([
    ["debug.enableAllBreakpoints", { disabled: 1, enabled: 0 }],
    ["debug.disableAllBreakpoints", { disabled: 0, enabled: 1 }],
    ["debug.removeAllBreakpoints", { disabled: 1, enabled: 0 }],
    ["debug.removeAllBreakpoints", { disabled: 0, enabled: 1 }],
  ] as const)("workspace-gates %s and blocks it during a bulk mutation", (id, breakpointCounts) => {
    const enabled = commandsWith({ breakpointCounts });
    expect(command(enabled, id).isEnabled(context)).toBe(true);
    expect(command(enabled, id).isEnabled({ ...context, hasWorkspace: false })).toBe(false);
    expect(
      command(
        commandsWith({ breakpointBulkMutationPending: true, breakpointCounts }),
        id,
      ).isEnabled(context),
    ).toBe(false);
    expect(
      command(commandsWith({ breakpointCounts, debugControlPending: true }), id).isEnabled(context),
    ).toBe(false);
  });

  it("truthfully derives each bulk breakpoint command from enabled and disabled counts", () => {
    for (const [breakpointCounts, expected] of [
      [{ disabled: 0, enabled: 0 }, [false, false, false]],
      [{ disabled: 2, enabled: 0 }, [true, false, true]],
      [{ disabled: 0, enabled: 3 }, [false, true, true]],
      [{ disabled: 2, enabled: 3 }, [true, true, true]],
    ] as const) {
      const commands = commandsWith({ breakpointCounts });
      expect(
        [
          "debug.enableAllBreakpoints",
          "debug.disableAllBreakpoints",
          "debug.removeAllBreakpoints",
        ].map((id) => command(commands, id).isEnabled(context)),
      ).toEqual(expected);
    }
  });

  it("exposes the VS Code-compatible breakpoint activation command and delegates once", async () => {
    const toggleBreakpointsActivated = vi.fn();
    const activation = command(
      commandsWith({
        canToggleBreakpointsActivated: true,
        toggleBreakpointsActivated,
      }),
      "workbench.debug.viewlet.action.toggleBreakpointsActivatedAction",
    );

    expect(activation.title).toBe("Debug: Toggle Activate Breakpoints");
    expect(activation.isEnabled(context)).toBe(true);
    await activation.run(context);
    expect(toggleBreakpointsActivated).toHaveBeenCalledOnce();
    expect(
      command(
        commandsWith({ canToggleBreakpointsActivated: false }),
        "workbench.debug.viewlet.action.toggleBreakpointsActivatedAction",
      ).isEnabled(context),
    ).toBe(false);
  });

  it("wires keymap shortcuts onto the shortcut-bearing commands", () => {
    const commands = workbenchDebugCommands({
      attachNodeDebug: vi.fn(),
      configurationLauncher: {
        busy: false,
        pickerOpen: false,
        canOpenPicker: () => true,
        openPicker: vi.fn(),
      },
      configureNodeLaunchConfigurations: vi.fn(),
      canRestartDebug: true,
      canRunToCursor: true,
      canClearDebugConsole: true,
      breakpointBulkMutationPending: false,
      breakpointCounts: { disabled: 1, enabled: 1 },
      debugRestartPending: false,
      debugCompoundStartPending: false,
      debugControlPending: false,
      debugStopPending: false,
      debugSessionAttached: false,
      debugStartPending: false,
      debugEvaluateInConsole: {
        canEvaluateInConsole: vi.fn(() => false),
        evaluateInConsole: vi.fn(() => false),
      },
      debugBreakpointNavigation: {
        canGoToNextBreakpoint: vi.fn(() => false),
        canGoToPreviousBreakpoint: vi.fn(() => false),
        goToNextBreakpoint: vi.fn(() => false),
        goToPreviousBreakpoint: vi.fn(() => false),
      },
      debugInlineBreakpoint: {
        addInlineBreakpoint: vi.fn(() => false),
        canAddInlineBreakpoint: vi.fn(() => false),
      },
      debugCopyValue: {
        canCopyEvaluatePath: vi.fn(() => false),
        canCopyValue: vi.fn(() => false),
        copyEvaluatePath: vi.fn(async () => false),
        copyValue: vi.fn(async () => false),
      },
      debugCopyStackTrace: {
        canCopyStackTrace: vi.fn(() => false),
        copyStackTrace: vi.fn(() => false),
      },
      debugCallStackNavigation: {
        canSelectCallStackFrame: vi.fn(() => false),
        selectCallStackTop: vi.fn(() => false),
        selectCallStackBottom: vi.fn(() => false),
        selectCallStackUp: vi.fn(() => false),
        selectCallStackDown: vi.fn(() => false),
      },
      debugRestartFrame: {
        canRestartFrame: vi.fn(() => false),
        restartFrame: vi.fn(() => false),
      },
      debugSetVariable: {
        canBeginEdit: vi.fn(() => false),
        beginEdit: vi.fn(() => false),
      },
      debugWatchAtCursor: {
        addToWatchAtCursor: vi.fn(() => false),
        canAddAtCursor: vi.fn(() => false),
      },
      shortcut: (commandId) => `key:${commandId}`,
      hasJsWorkspace: true,
      hasPhpWorkspace: true,
      isActiveDocumentDebuggable: true,
      isWorkspaceTrusted: true,
      snapshot: initialDebuggerSnapshot(),
      openDebugPanel: vi.fn(),
      clearDebugConsole: vi.fn(),
      focusDebugConsole: vi.fn(),
      disableAllBreakpoints: vi.fn(),
      enableAllBreakpoints: vi.fn(),
      pauseDebug: vi.fn(),
      restartDebug: vi.fn(),
      runToCursor: vi.fn(),
      removeAllBreakpoints: vi.fn(),
      startOrContinueDebug: vi.fn(),
      startPhpListenDebug: vi.fn(),
      stepDebug: vi.fn(),
      stopDebug: vi.fn(),
      disconnectDebug: vi.fn(),
      toggleBreakpointAtCursor: vi.fn(),
    });

    expect(command(commands, "debug.start").shortcut).toBe("key:debug.start");
    expect(command(commands, "debug.restart").shortcut).toBe("key:debug.restart");
    expect(command(commands, "debug.runToCursor").shortcut).toBe("key:debug.runToCursor");
    expect(command(commands, "debug.stop").shortcut).toBe("key:debug.stop");
    expect(command(commands, "workbench.action.debug.disconnect").shortcut).toBe(
      "key:workbench.action.debug.disconnect",
    );
    expect(command(commands, "debug.stepOver").shortcut).toBe("key:debug.stepOver");
    expect(command(commands, "debug.toggleBreakpoint").shortcut).toBe("key:debug.toggleBreakpoint");
    expect(command(commands, "debug.stepInto").shortcut).toBe("key:debug.stepInto");
    expect(command(commands, "debug.stepOut").shortcut).toBe("key:debug.stepOut");
    expect(command(commands, "debug.focusConsole").shortcut).toBe("key:debug.focusConsole");
    expect(command(commands, "debug.setVariable").shortcut).toBe("key:debug.setVariable");
    expect(command(commands, "debug.clearConsole").shortcut).toBeUndefined();
    expect(command(commands, "debug.listenPhp").shortcut).toBeUndefined();
    expect(command(commands, "debug.selectAndStartConfiguration").shortcut).toBeUndefined();
    expect(command(commands, "debug.configureNodeLaunchConfigurations").shortcut).toBeUndefined();
    expect(command(commands, "debug.addToWatchAtCursor").shortcut).toBeUndefined();
    expect(command(commands, "debug.evaluateInConsole").shortcut).toBeUndefined();
    expect(command(commands, "workbench.debug.viewlet.action.copyValue").shortcut).toBeUndefined();
    expect(command(commands, "debug.copyEvaluatePath").shortcut).toBeUndefined();
  });

  it("gates Node attach on trust, JS capability, and inactive non-pending sessions", () => {
    const attachNodeDebug = vi.fn();
    const enabled = commandsWith({ attachNodeDebug });
    expect(command(enabled, "debug.attachNode").isEnabled(context)).toBe(true);
    void command(enabled, "debug.attachNode").run(context);
    expect(attachNodeDebug).toHaveBeenCalledOnce();
    for (const overrides of [
      { hasJsWorkspace: false },
      { isWorkspaceTrusted: false },
      { debugStartPending: true },
      { debugRestartPending: true },
      { debugStopPending: true },
      { snapshot: runningSnapshot() },
    ]) {
      expect(command(commandsWith(overrides), "debug.attachNode").isEnabled(context)).toBe(false);
    }
  });
});

describe("isDebuggableNodeScriptPath", () => {
  it("accepts plain JavaScript entrypoints and rejects everything else", () => {
    expect(isDebuggableNodeScriptPath("/workspace/index.js")).toBe(true);
    expect(isDebuggableNodeScriptPath("/workspace/tool.mjs")).toBe(true);
    expect(isDebuggableNodeScriptPath("/workspace/tool.cjs")).toBe(true);
    expect(isDebuggableNodeScriptPath("/workspace/app.ts")).toBe(true);
    expect(isDebuggableNodeScriptPath("/workspace/app.tsx")).toBe(true);
    expect(isDebuggableNodeScriptPath("/workspace/app.mts")).toBe(true);
    expect(isDebuggableNodeScriptPath("/workspace/app.cts")).toBe(true);
    expect(isDebuggableNodeScriptPath("/workspace/app.jsx")).toBe(false);
    expect(isDebuggableNodeScriptPath("/workspace/types.d.ts")).toBe(false);
    expect(isDebuggableNodeScriptPath("/workspace/readme.md")).toBe(false);
  });
});

describe("isDebuggablePhpScriptPath", () => {
  it("accepts PHP scripts and rejects everything else", () => {
    expect(isDebuggablePhpScriptPath("/workspace/public/index.php")).toBe(true);
    expect(isDebuggablePhpScriptPath("/workspace/artisan.php")).toBe(true);
    expect(isDebuggablePhpScriptPath("/workspace/view.phtml")).toBe(false);
    expect(isDebuggablePhpScriptPath("/workspace/index.js")).toBe(false);
    expect(isDebuggablePhpScriptPath("/workspace/php")).toBe(false);
  });
});
