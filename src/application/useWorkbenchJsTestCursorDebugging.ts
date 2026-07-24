import { useCallback, useRef } from "react";
import type { DebugWatchAtCursorCaptureReader } from "../domain/debugWatchAtCursorCapture";
import type { WorkspaceFileGateway } from "../domain/workspace";
import { useDebugWatchAtCursor } from "./useDebugWatchAtCursor";
import {
  useJsTestDebugAtCursor,
  type UseJsTestDebugAtCursorOptions,
} from "./useJsTestDebugAtCursor";
import {
  useJsTestRunSelectionCommands,
  type JsTestExplorerScopeRunnerPort,
} from "./useJsTestRunSelectionCommands";

interface UseWorkbenchJsTestCursorDebuggingOptions extends Omit<
  UseJsTestDebugAtCursorOptions,
  "activationEpoch" | "captureReader" | "readTextFileBounded"
> {
  readonly captureReader?: DebugWatchAtCursorCaptureReader | null;
  readonly ownerKey: string | null;
  readonly readTextFileBounded: WorkspaceFileGateway["readTextFileBounded"];
  readonly runner?: JsTestExplorerScopeRunnerPort;
  readonly watches: Parameters<typeof useDebugWatchAtCursor>[0]["watches"];
  readonly workspaceRoot: string | null;
}

const unavailableRunner: JsTestExplorerScopeRunnerPort = Object.freeze({
  canCancelTestRun: () => false,
  canRerunFailedTests: () => false,
  canRerunLastRun: () => false,
  canRunScope: () => false,
  cancelTestRun: async () => false,
  rerunFailedTests: async () => false,
  rerunLastRun: async () => false,
  runScope: async () => false,
});

/** Keeps cursor-debug activation and bounded reads outside the workbench shell. */
export function useWorkbenchJsTestCursorDebugging({
  captureReader,
  ownerKey,
  readTextFileBounded,
  runner = unavailableRunner,
  watches,
  workspaceRoot,
  ...debugOptions
}: UseWorkbenchJsTestCursorDebuggingOptions) {
  const activationReader = captureReader ?? null;
  const activationTrusted = safelyReadWorkspaceTrust(debugOptions.isWorkspaceTrusted);
  const activationRef = useRef({
    epoch: 0,
    ownerKey: null as string | null,
    captureReader: null as DebugWatchAtCursorCaptureReader | null,
    trusted: false,
    workspaceId: null as string | null,
    workspaceRoot: null as string | null,
  });
  if (
    activationRef.current.ownerKey !== ownerKey ||
    activationRef.current.captureReader !== activationReader ||
    activationRef.current.trusted !== activationTrusted ||
    activationRef.current.workspaceId !== debugOptions.workspaceId ||
    activationRef.current.workspaceRoot !== workspaceRoot
  ) {
    activationRef.current = {
      epoch: activationRef.current.epoch + 1,
      ownerKey,
      captureReader: activationReader,
      trusted: activationTrusted,
      workspaceId: debugOptions.workspaceId,
      workspaceRoot,
    };
  }
  const activationEpoch = useCallback(() => activationRef.current.epoch, []);
  const readBounded = useCallback(
    async (path: string, maxBytes: number) => {
      if (!readTextFileBounded) return { status: "missing" as const };
      try {
        return await readTextFileBounded(path, maxBytes);
      } catch {
        return { status: "missing" as const };
      }
    },
    [readTextFileBounded],
  );
  return {
    debugWatchAtCursor: useDebugWatchAtCursor({
      captureReader,
      isWorkspaceCurrent: debugOptions.isWorkspaceCurrent,
      openDebugPanel: debugOptions.openDebugPanel,
      watches,
    }),
    jsTestDebugAtCursor: useJsTestDebugAtCursor({
      ...debugOptions,
      activationEpoch,
      captureReader,
      readTextFileBounded: readBounded,
    }),
    jsTestRunSelection: useJsTestRunSelectionCommands({
      activationEpoch,
      activeDocument: debugOptions.activeDocument,
      captureReader,
      isWorkspaceCurrent: debugOptions.isWorkspaceCurrent,
      isWorkspaceTrusted: debugOptions.isWorkspaceTrusted,
      readTextFileBounded: readBounded,
      runner,
      workspaceId: debugOptions.workspaceId,
      workspaceOwnerKey: ownerKey,
      workspaceRoot,
    }),
  };
}

function safelyReadWorkspaceTrust(isWorkspaceTrusted: () => boolean): boolean {
  try {
    return isWorkspaceTrusted() === true;
  } catch {
    return false;
  }
}
