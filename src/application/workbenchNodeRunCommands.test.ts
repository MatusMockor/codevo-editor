import { describe, expect, it, vi } from "vitest";
import type { NodeRunWithoutDebuggingState } from "./useNodeRunWithoutDebugging";
import {
  canRunNodeWithoutDebugging,
  canStopNodeRunWithoutDebugging,
  workbenchNodeRunCommands,
} from "./workbenchNodeRunCommands";

describe("workbenchNodeRunCommands", () => {
  it("exposes the VS Code-like command and delegates through the capability", () => {
    const run = vi.fn();
    const [command] = workbenchNodeRunCommands({
      canRun: true,
      canStop: false,
      configurationLauncher: launcher(),
      pending: false,
      run,
      shortcut: () => "Ctrl+F5",
      stop: vi.fn(),
    });

    expect(command).toMatchObject({
      category: "Run",
      id: "debug.runWithoutDebugging",
      shortcut: "Ctrl+F5",
      title: "Run: Start Without Debugging",
    });
    expect(command?.isEnabled(context())).toBe(true);
    command?.run();
    expect(run).toHaveBeenCalledOnce();
  });

  it.each([
    { canRun: false, pending: false, context: context(), reason: "capability" },
    { canRun: true, pending: true, context: context(), reason: "pending lifecycle" },
    {
      canRun: true,
      pending: false,
      context: context({ activeDocumentDirty: true }),
      reason: "dirty document",
    },
    {
      canRun: true,
      pending: false,
      context: context({ hasActiveDocument: false }),
      reason: "missing document",
    },
    {
      canRun: true,
      pending: false,
      context: context({ hasWorkspace: false }),
      reason: "missing workspace",
    },
  ])("disables execution for $reason", ({ canRun, pending, context: commandContext }) => {
    const [command] = workbenchNodeRunCommands({
      canRun,
      canStop: false,
      configurationLauncher: launcher(),
      pending,
      run: vi.fn(),
      shortcut: () => "Ctrl+F5",
      stop: vi.fn(),
    });

    expect(command?.isEnabled(commandContext)).toBe(false);
  });

  it("exposes an unbound stop command for the current workspace", () => {
    const stop = vi.fn();
    const command = stopCommand({ canStop: true, stop });

    expect(command).toMatchObject({
      category: "Run",
      id: "debug.stopWithoutDebugging",
      title: "Run: Stop Without Debugging",
    });
    expect(command).not.toHaveProperty("shortcut");
    expect(command?.isEnabled(context({ hasActiveDocument: false }))).toBe(true);
    command?.run();
    expect(stop).toHaveBeenCalledOnce();
  });

  it("disables stop outside the current workspace and without a stoppable owner", () => {
    expect(stopCommand({ canStop: true }).isEnabled(context({ hasWorkspace: false }))).toBe(false);
    expect(stopCommand({ canStop: false }).isEnabled(context())).toBe(false);
  });

  it("opens the named Run configuration picker without requiring an active document", () => {
    const openPicker = vi.fn();
    const command = selectAndStartCommand({ configurationLauncher: launcher({ openPicker }) });

    expect(command).toMatchObject({
      category: "Run",
      id: "debug.selectAndStartWithoutDebugging",
      title: "Run: Select and Start Without Debugging",
    });
    expect(command).not.toHaveProperty("shortcut");
    expect(
      command.isEnabled(context({ activeDocumentDirty: true, hasActiveDocument: false })),
    ).toBe(true);
    command.run();
    expect(openPicker).toHaveBeenCalledOnce();
  });

  it.each([
    { label: "outside the current workspace", context: context({ hasWorkspace: false }) },
    { label: "while Node run is pending", pending: true },
    { label: "while a Node run can stop", canStop: true },
    { label: "while its launcher is busy", launcher: { busy: true } },
    { label: "while its picker is already open", launcher: { pickerOpen: true } },
    {
      label: "when its owner-safe launcher is unavailable",
      launcher: { canOpenPicker: () => false },
    },
  ])(
    "disables named Run selection $label",
    ({ canStop, context: value, launcher: valueLauncher, pending }) => {
      const command = selectAndStartCommand({
        canStop,
        configurationLauncher: launcher(valueLauncher),
        pending,
      });
      expect(command.isEnabled(value ?? context())).toBe(false);
    },
  );
});

describe("canStopNodeRunWithoutDebugging", () => {
  it.each(["resolving", "waiting-for-terminal", "starting", "running"] as const)(
    "allows stopping the owner-bound %s lifecycle",
    (kind) => expect(canStopNodeRunWithoutDebugging(nodeRunState(kind))).toBe(true),
  );

  it("enables only retryable stopping after an exact-owner stop failure", () => {
    expect(canStopNodeRunWithoutDebugging(nodeRunState("stopping", false))).toBe(false);
    expect(canStopNodeRunWithoutDebugging(nodeRunState("stopping", true))).toBe(true);
  });

  it.each(["idle", "exited", "failed"] as const)("rejects unavailable stop in %s", (kind) =>
    expect(canStopNodeRunWithoutDebugging(nodeRunState(kind))).toBe(false),
  );
});

describe("canRunNodeWithoutDebugging", () => {
  it.each(["starting", "running", "stopped"] as const)(
    "rejects the active debug state %s",
    (debugSessionKind) => {
      expect(canRunNodeWithoutDebugging(availability({ debugSessionKind }))).toBe(false);
    },
  );

  it.each([
    { debugStartPending: true },
    { debugControlPending: true },
    { debugRestartPending: true },
    { debugStopPending: true },
    { hasJavaScriptTypeScriptWorkspace: false },
    { hasRunnableCleanActiveDocument: false },
    { workspaceTrusted: false },
  ])("rejects an unavailable owner gate %#", (override) => {
    expect(canRunNodeWithoutDebugging(availability(override))).toBe(false);
  });

  it.each(["inactive", "terminated"] as const)(
    "accepts a trusted clean runnable target in debug state %s",
    (debugSessionKind) => {
      expect(canRunNodeWithoutDebugging(availability({ debugSessionKind }))).toBe(true);
    },
  );
});

function context(overrides: Partial<ReturnType<typeof baseContext>> = {}) {
  return { ...baseContext(), ...overrides };
}

function baseContext() {
  return {
    activeDocumentDirty: false,
    hasActiveDocument: true,
    hasWorkspace: true,
  };
}

function availability(
  overrides: Partial<Parameters<typeof canRunNodeWithoutDebugging>[0]> = {},
): Parameters<typeof canRunNodeWithoutDebugging>[0] {
  return {
    debugControlPending: false,
    debugRestartPending: false,
    debugSessionKind: "inactive",
    debugStartPending: false,
    debugStopPending: false,
    hasJavaScriptTypeScriptWorkspace: true,
    hasRunnableCleanActiveDocument: true,
    workspaceTrusted: true,
    ...overrides,
  };
}

function stopCommand({ canStop, stop = vi.fn() }: { canStop: boolean; stop?: () => void }) {
  const commands = workbenchNodeRunCommands({
    canRun: false,
    canStop,
    configurationLauncher: launcher(),
    pending: true,
    run: vi.fn(),
    shortcut: () => "Ctrl+F5",
    stop,
  });
  const command = commands.find(({ id }) => id === "debug.stopWithoutDebugging");
  if (!command) throw new Error("Missing Run: Stop Without Debugging command.");
  return command;
}

function selectAndStartCommand({
  canStop = false,
  configurationLauncher = launcher(),
  pending = false,
}: {
  canStop?: boolean;
  configurationLauncher?: ReturnType<typeof launcher>;
  pending?: boolean;
} = {}) {
  const command = workbenchNodeRunCommands({
    canRun: false,
    canStop,
    configurationLauncher,
    pending,
    run: vi.fn(),
    shortcut: () => "Ctrl+F5",
    stop: vi.fn(),
  }).find(({ id }) => id === "debug.selectAndStartWithoutDebugging");
  if (!command) throw new Error("Missing Run: Select and Start Without Debugging command.");
  return command;
}

function launcher(
  overrides: Partial<{
    busy: boolean;
    pickerOpen: boolean;
    canOpenPicker(): boolean;
    openPicker(): void;
  }> = {},
) {
  return {
    busy: false,
    pickerOpen: false,
    canOpenPicker: () => true,
    openPicker: vi.fn(),
    ...overrides,
  };
}

function nodeRunState(
  kind: NodeRunWithoutDebuggingState["kind"],
  retryable = false,
): NodeRunWithoutDebuggingState {
  const target = { kind: "node-script" as const, scriptPath: "/workspace/index.ts" };
  switch (kind) {
    case "idle":
    case "resolving":
      return { kind };
    case "waiting-for-terminal":
      return { kind, target };
    case "starting":
    case "running":
      return {
        kind,
        runId: "run-1",
        target,
        terminalSessionId: 7,
        workspaceId: "workspace-1",
      };
    case "stopping":
      return {
        kind,
        retryable,
        runId: "run-1",
        target,
        terminalSessionId: 7,
        workspaceId: "workspace-1",
      };
    case "exited":
      return { kind, exitCode: 0 };
    case "failed":
      return { kind, message: "failed" };
  }
}
