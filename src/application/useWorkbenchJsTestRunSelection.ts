import { useCallback, useRef } from "react";
import type { EditorCursorCaptureReader } from "../domain/editorCursorCapture";
import type { EditorDocument, WorkspaceFileGateway } from "../domain/workspace";
import {
  useJsTestRunSelectionCommands,
  type JsTestExplorerScopeRunnerPort,
} from "./useJsTestRunSelectionCommands";

interface UseWorkbenchJsTestRunSelectionOptions {
  readonly activeDocument: () => EditorDocument | null;
  readonly captureReader?: EditorCursorCaptureReader | null;
  readonly isWorkspaceCurrent: (workspaceRoot: string, workspaceOwnerKey: string) => boolean;
  readonly isWorkspaceTrusted: () => boolean;
  readonly ownerKey: string | null;
  readonly readTextFileBounded: WorkspaceFileGateway["readTextFileBounded"];
  readonly runner?: JsTestExplorerScopeRunnerPort;
  readonly workspaceId: string | null;
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

export function useWorkbenchJsTestRunSelection({
  activeDocument,
  captureReader,
  isWorkspaceCurrent,
  isWorkspaceTrusted,
  ownerKey,
  readTextFileBounded,
  runner = unavailableRunner,
  workspaceId,
  workspaceRoot,
}: UseWorkbenchJsTestRunSelectionOptions) {
  const activationReader = captureReader ?? null;
  const activationTrusted = safelyReadWorkspaceTrust(isWorkspaceTrusted);
  const activationRef = useRef({
    epoch: 0,
    ownerKey: null as string | null,
    captureReader: null as EditorCursorCaptureReader | null,
    trusted: false,
    workspaceId: null as string | null,
    workspaceRoot: null as string | null,
  });
  if (
    activationRef.current.ownerKey !== ownerKey ||
    activationRef.current.captureReader !== activationReader ||
    activationRef.current.trusted !== activationTrusted ||
    activationRef.current.workspaceId !== workspaceId ||
    activationRef.current.workspaceRoot !== workspaceRoot
  ) {
    activationRef.current = {
      epoch: activationRef.current.epoch + 1,
      ownerKey,
      captureReader: activationReader,
      trusted: activationTrusted,
      workspaceId,
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
  return useJsTestRunSelectionCommands({
    activationEpoch,
    activeDocument,
    captureReader,
    isWorkspaceCurrent,
    isWorkspaceTrusted,
    readTextFileBounded: readBounded,
    runner,
    workspaceId,
    workspaceOwnerKey: ownerKey,
    workspaceRoot,
  });
}

function safelyReadWorkspaceTrust(isWorkspaceTrusted: () => boolean): boolean {
  try {
    return isWorkspaceTrusted() === true;
  } catch {
    return false;
  }
}
