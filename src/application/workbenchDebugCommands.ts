import type { StepKind } from "../domain/debug";
import type { DebuggerSessionSnapshot } from "../domain/debugSessionState";
import type { KeymapCommandId } from "../domain/keymap";
import type { Command } from "./commandRegistry";

interface WorkbenchDebugCommandsOptions {
  shortcut(commandId: KeymapCommandId): string;
  hasJsWorkspace: boolean;
  hasPhpWorkspace: boolean;
  isActiveDocumentDebuggable: boolean;
  isWorkspaceTrusted: boolean;
  snapshot: DebuggerSessionSnapshot;
  openDebugPanel: Command["run"];
  pauseDebug: Command["run"];
  startOrContinueDebug: Command["run"];
  startPhpListenDebug: Command["run"];
  stepDebug(kind: StepKind): void | Promise<void>;
  stopDebug: Command["run"];
  toggleBreakpointAtCursor: Command["run"];
}

export function isDebuggableNodeScriptPath(path: string): boolean {
  return /\.(js|mjs|cjs)$/.test(path);
}

export function isDebuggablePhpScriptPath(path: string): boolean {
  return /\.php$/.test(path);
}

export function workbenchDebugCommands({
  shortcut,
  hasJsWorkspace,
  hasPhpWorkspace,
  isActiveDocumentDebuggable,
  isWorkspaceTrusted,
  snapshot,
  openDebugPanel,
  pauseDebug,
  startOrContinueDebug,
  startPhpListenDebug,
  stepDebug,
  stopDebug,
  toggleBreakpointAtCursor,
}: WorkbenchDebugCommandsOptions): Command[] {
  const sessionKind = snapshot.state.kind;
  const sessionActive =
    sessionKind === "starting" ||
    sessionKind === "running" ||
    sessionKind === "stopped";
  const sessionStopped = sessionKind === "stopped";
  const canStart =
    (hasJsWorkspace || hasPhpWorkspace) &&
    isWorkspaceTrusted &&
    isActiveDocumentDebuggable;

  return [
    {
      id: "debug.start",
      title: "Debug: Start or Continue",
      category: "Debug",
      shortcut: shortcut("debug.start"),
      isEnabled: (context) =>
        sessionStopped ||
        (context.hasWorkspace &&
          context.hasActiveDocument &&
          canStart &&
          !sessionActive),
      run: startOrContinueDebug,
    },
    {
      id: "debug.listenPhp",
      title: "Debug: Listen for PHP (Xdebug)",
      category: "Debug",
      isEnabled: () =>
        hasPhpWorkspace && isWorkspaceTrusted && !sessionActive,
      run: startPhpListenDebug,
    },
    {
      id: "debug.continue",
      title: "Debug: Continue",
      category: "Debug",
      isEnabled: () => sessionStopped,
      run: () => stepDebug("continue"),
    },
    {
      id: "debug.stepOver",
      title: "Debug: Step Over",
      category: "Debug",
      shortcut: shortcut("debug.stepOver"),
      isEnabled: () => sessionStopped,
      run: () => stepDebug("stepOver"),
    },
    {
      id: "debug.stepInto",
      title: "Debug: Step Into",
      category: "Debug",
      isEnabled: () => sessionStopped,
      run: () => stepDebug("stepInto"),
    },
    {
      id: "debug.stepOut",
      title: "Debug: Step Out",
      category: "Debug",
      isEnabled: () => sessionStopped,
      run: () => stepDebug("stepOut"),
    },
    {
      id: "debug.pause",
      title: "Debug: Pause",
      category: "Debug",
      isEnabled: () => sessionKind === "running",
      run: pauseDebug,
    },
    {
      id: "debug.stop",
      title: "Debug: Stop",
      category: "Debug",
      shortcut: shortcut("debug.stop"),
      isEnabled: () => sessionActive,
      run: stopDebug,
    },
    {
      id: "debug.toggleBreakpoint",
      title: "Debug: Toggle Breakpoint",
      category: "Debug",
      shortcut: shortcut("debug.toggleBreakpoint"),
      isEnabled: (context) => context.hasWorkspace && context.hasActiveDocument,
      run: toggleBreakpointAtCursor,
    },
    {
      id: "debug.openPanel",
      title: "Debug: Show Debug Panel",
      category: "Debug",
      isEnabled: (context) => context.hasWorkspace,
      run: openDebugPanel,
    },
  ];
}
