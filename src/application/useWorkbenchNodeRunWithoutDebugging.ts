import { useMemo } from "react";
import type { DebuggerSessionSnapshot } from "../domain/debugSessionState";
import type { NodeRunTaskGateway } from "../domain/nodeRunTask";
import type { EditorDocument, WorkspaceFileGateway } from "../domain/workspace";
import { useNodeRunWithoutDebugging } from "./useNodeRunWithoutDebugging";
import { useNodeRunConfigurationLauncher } from "./useNodeRunConfigurationLauncher";
import type { NodeLaunchPickerCoordinator } from "./useNodeLaunchConfigurationPicker";
import { isDebuggableNodeScriptPath } from "./workbenchDebugCommands";
import {
  canRunNodeWithoutDebugging,
  canStopNodeRunWithoutDebugging,
  debugRuntimeAllowsNodeRun,
} from "./workbenchNodeRunCommands";

interface UseWorkbenchNodeRunWithoutDebuggingOptions {
  readonly activeDocument: EditorDocument | null;
  readonly configurationPickerCoordinator: NodeLaunchPickerCoordinator;
  readonly configurationVersion: number;
  readonly debugSession: {
    readonly debugControlPending: boolean;
    readonly debugRestartPending: boolean;
    readonly debugStartPending: boolean;
    readonly debugStopPending: boolean;
    readonly snapshot: DebuggerSessionSnapshot;
  };
  readonly gateway: NodeRunTaskGateway;
  readonly hasJavaScriptTypeScriptWorkspace: boolean;
  readonly isActiveDocumentJsTest: boolean;
  readonly isWorkspaceCurrent: (rootPath: string, workspaceId: string) => boolean;
  readonly isWorkspaceTrusted: () => boolean;
  readonly readFileIfExists: (path: string) => Promise<string | null>;
  readonly requestTerminalSession: (consumer: (sessionId: number | null) => void) => void;
  readonly workspaceFiles: Pick<
    WorkspaceFileGateway,
    "readDirectory" | "readTextFile" | "readTextFileBounded"
  >;
  readonly workspaceId: string | null;
  readonly workspaceRoot: string | null;
  readonly workspaceTrusted: boolean;
  reportError(error: unknown): void;
  reportWarning(message: string): void;
}

export function useWorkbenchNodeRunWithoutDebugging(
  options: UseWorkbenchNodeRunWithoutDebuggingOptions,
) {
  const { activeDocument, debugSession, hasJavaScriptTypeScriptWorkspace, workspaceTrusted } =
    options;
  const debugRuntimeAvailable = debugRuntimeAllowsNodeRun({
    debugControlPending: debugSession.debugControlPending,
    debugRestartPending: debugSession.debugRestartPending,
    debugSessionKind: debugSession.snapshot.state.kind,
    debugStartPending: debugSession.debugStartPending,
    debugStopPending: debugSession.debugStopPending,
  });
  const run = useNodeRunWithoutDebugging({
    ...options,
    debugRuntimeAvailable,
    isDebugRuntimeAvailable: () => debugRuntimeAvailable,
  });
  const canStop = canStopNodeRunWithoutDebugging(run.state);
  const configurationBlocked =
    !workspaceTrusted ||
    !hasJavaScriptTypeScriptWorkspace ||
    !debugRuntimeAvailable ||
    run.pending ||
    canStop;
  const workspaceReads = useMemo(
    () => ({
      readDirectory: options.workspaceFiles.readDirectory,
      readFile: options.workspaceFiles.readTextFile,
      ...(options.workspaceFiles.readTextFileBounded
        ? { readFileBounded: options.workspaceFiles.readTextFileBounded }
        : {}),
    }),
    [
      options.workspaceFiles.readDirectory,
      options.workspaceFiles.readTextFile,
      options.workspaceFiles.readTextFileBounded,
    ],
  );
  const runConfigurationLauncher = useNodeRunConfigurationLauncher({
    blocked: configurationBlocked,
    configurationVersion: options.configurationVersion,
    coordinator: options.configurationPickerCoordinator,
    isBlocked: () => configurationBlocked,
    isWorkspaceCurrent: options.isWorkspaceCurrent,
    isWorkspaceTrusted: options.isWorkspaceTrusted,
    revealPicker: revealRunConfigurationPicker,
    rootPath: options.workspaceRoot,
    startTarget: run.startTarget,
    workspaceId: options.workspaceId,
    workspaceReads,
    workspaceTrusted,
  });
  const configurationLauncher = useMemo(
    () => ({
      ...runConfigurationLauncher,
      state: runConfigurationLauncher.state.kind,
    }),
    [runConfigurationLauncher],
  );

  return useMemo(
    () => ({
      ...run,
      canStop,
      configurationLauncher,
      canRun: canRunNodeWithoutDebugging({
        debugControlPending: debugSession.debugControlPending,
        debugRestartPending: debugSession.debugRestartPending,
        debugSessionKind: debugSession.snapshot.state.kind,
        debugStartPending: debugSession.debugStartPending,
        debugStopPending: debugSession.debugStopPending,
        hasJavaScriptTypeScriptWorkspace,
        hasRunnableCleanActiveDocument:
          activeDocument !== null &&
          activeDocument.content === activeDocument.savedContent &&
          isDebuggableNodeScriptPath(activeDocument.path),
        workspaceTrusted,
      }),
    }),
    [
      activeDocument,
      canStop,
      configurationLauncher,
      debugSession,
      hasJavaScriptTypeScriptWorkspace,
      run,
      workspaceTrusted,
    ],
  );
}

function revealRunConfigurationPicker(): void {
  // The picker is hosted at App overlay level and becomes visible from its own state.
}
