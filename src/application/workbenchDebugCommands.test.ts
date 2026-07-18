import { describe, expect, it, vi } from "vitest";
import type { DebuggerSessionSnapshot } from "../domain/debugSessionState";
import { initialDebuggerSnapshot } from "../domain/debugSessionState";
import type { CommandContext } from "./commandRegistry";
import {
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

function commandsWith(
  overrides: Partial<Parameters<typeof workbenchDebugCommands>[0]> = {},
) {
  return workbenchDebugCommands({
    shortcut: () => "",
    hasJsWorkspace: true,
    hasPhpWorkspace: false,
    isActiveDocumentDebuggable: true,
    isWorkspaceTrusted: true,
    snapshot: initialDebuggerSnapshot(),
    openDebugPanel: vi.fn(),
    pauseDebug: vi.fn(),
    startOrContinueDebug: vi.fn(),
    startPhpListenDebug: vi.fn(),
    stepDebug: vi.fn(),
    stopDebug: vi.fn(),
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
  it("enables start for a trusted JS workspace with a debuggable document", () => {
    expect(command(commandsWith(), "debug.start").isEnabled(context)).toBe(true);
  });

  it("disables start in an untrusted workspace", () => {
    expect(
      command(
        commandsWith({ isWorkspaceTrusted: false }),
        "debug.start",
      ).isEnabled(context),
    ).toBe(false);
  });

  it("disables start without a debuggable active document", () => {
    expect(
      command(
        commandsWith({ isActiveDocumentDebuggable: false }),
        "debug.start",
      ).isEnabled(context),
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
    expect(
      command(commandsWith({ hasJsWorkspace: false }), "debug.start").isEnabled(
        context,
      ),
    ).toBe(false);
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
    expect(command(commandsWith(), "debug.listenPhp").isEnabled(context)).toBe(
      false,
    );
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

  it("disables start while the session is already running", () => {
    expect(
      command(
        commandsWith({ snapshot: runningSnapshot() }),
        "debug.start",
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

  it("enables toggle breakpoint only with an active document", () => {
    const commands = commandsWith();

    expect(command(commands, "debug.toggleBreakpoint").isEnabled(context)).toBe(
      true,
    );
    expect(
      command(commands, "debug.toggleBreakpoint").isEnabled({
        ...context,
        hasActiveDocument: false,
      }),
    ).toBe(false);
  });

  it("wires keymap shortcuts onto the shortcut-bearing commands", () => {
    const commands = workbenchDebugCommands({
      shortcut: (commandId) => `key:${commandId}`,
      hasJsWorkspace: true,
      hasPhpWorkspace: true,
      isActiveDocumentDebuggable: true,
      isWorkspaceTrusted: true,
      snapshot: initialDebuggerSnapshot(),
      openDebugPanel: vi.fn(),
      pauseDebug: vi.fn(),
      startOrContinueDebug: vi.fn(),
      startPhpListenDebug: vi.fn(),
      stepDebug: vi.fn(),
      stopDebug: vi.fn(),
      toggleBreakpointAtCursor: vi.fn(),
    });

    expect(command(commands, "debug.start").shortcut).toBe("key:debug.start");
    expect(command(commands, "debug.stop").shortcut).toBe("key:debug.stop");
    expect(command(commands, "debug.stepOver").shortcut).toBe(
      "key:debug.stepOver",
    );
    expect(command(commands, "debug.toggleBreakpoint").shortcut).toBe(
      "key:debug.toggleBreakpoint",
    );
    expect(command(commands, "debug.stepInto").shortcut).toBeUndefined();
    expect(command(commands, "debug.stepOut").shortcut).toBeUndefined();
    expect(command(commands, "debug.listenPhp").shortcut).toBeUndefined();
  });
});

describe("isDebuggableNodeScriptPath", () => {
  it("accepts plain JavaScript entrypoints and rejects everything else", () => {
    expect(isDebuggableNodeScriptPath("/workspace/index.js")).toBe(true);
    expect(isDebuggableNodeScriptPath("/workspace/tool.mjs")).toBe(true);
    expect(isDebuggableNodeScriptPath("/workspace/tool.cjs")).toBe(true);
    expect(isDebuggableNodeScriptPath("/workspace/app.ts")).toBe(false);
    expect(isDebuggableNodeScriptPath("/workspace/app.jsx")).toBe(false);
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
