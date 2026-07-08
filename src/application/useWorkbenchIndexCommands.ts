import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { shouldIndexWorkspace } from "../domain/intelligence";
import {
  createIndexHealthLogEntry,
  prependIndexHealthLog,
  startIndexProgress,
  type IndexHealthLogEntry,
  type IndexProgressGateway,
  type IndexProgressState,
  type WorkspaceReindexMode,
} from "../domain/indexProgress";
import type { IntelligenceMode } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

export interface WorkbenchIndexActions {
  startIndexScan(): Promise<void>;
  startPhpReindex(): Promise<void>;
  startHardReindex(): Promise<void>;
}

export interface WorkbenchIndexCommandsOptions {
  activeIndexRootRef: MutableRefObject<string | null>;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  indexProgressGateway: IndexProgressGateway;
  intelligenceMode: IntelligenceMode;
  pendingIndexRootRef: MutableRefObject<string | null>;
  pendingIndexScanRef: MutableRefObject<boolean>;
  reportError(source: string, error: unknown): void;
  setIndexHealthLogs: Dispatch<SetStateAction<IndexHealthLogEntry[]>>;
  setIndexProgress: Dispatch<SetStateAction<IndexProgressState>>;
  setMessage: Dispatch<SetStateAction<string | null>>;
  workspaceRoot: string | null;
}

export function useWorkbenchIndexCommands({
  activeIndexRootRef,
  currentWorkspaceRootRef,
  indexProgressGateway,
  intelligenceMode,
  pendingIndexRootRef,
  pendingIndexScanRef,
  reportError,
  setIndexHealthLogs,
  setIndexProgress,
  setMessage,
  workspaceRoot,
}: WorkbenchIndexCommandsOptions): WorkbenchIndexActions {
  const startReindex = useCallback(async (
    mode: WorkspaceReindexMode,
    language?: string,
  ) => {
    if (!workspaceRoot) {
      return;
    }

    if (!shouldIndexWorkspace(intelligenceMode)) {
      setMessage("Enable Smart Index or IDE Mode to index this workspace.");
      return;
    }

    const requestedRoot = workspaceRoot;
    pendingIndexScanRef.current = true;
    pendingIndexRootRef.current = requestedRoot;

    try {
      const started = await indexProgressGateway.startReindex(
        requestedRoot,
        mode,
        language,
      );

      if (
        !pendingIndexScanRef.current ||
        !workspaceRootKeysEqual(pendingIndexRootRef.current, requestedRoot)
      ) {
        return;
      }

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        pendingIndexScanRef.current = false;
        pendingIndexRootRef.current = null;
        return;
      }

      if (!workspaceRootKeysEqual(started.rootPath, requestedRoot)) {
        pendingIndexScanRef.current = false;
        pendingIndexRootRef.current = null;
        return;
      }

      activeIndexRootRef.current = started.rootPath;
      setIndexProgress(startIndexProgress(started));
      const message = reindexStartMessage(mode);
      setIndexHealthLogs((current) =>
        prependIndexHealthLog(
          current,
          createIndexHealthLogEntry("info", requestedRoot, message),
        ),
      );
      setMessage(message);
    } catch (error) {
      if (!workspaceRootKeysEqual(pendingIndexRootRef.current, requestedRoot)) {
        return;
      }

      pendingIndexScanRef.current = false;
      pendingIndexRootRef.current = null;

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      reportError("Index", error);
    }
  }, [
    activeIndexRootRef,
    currentWorkspaceRootRef,
    indexProgressGateway,
    intelligenceMode,
    pendingIndexRootRef,
    pendingIndexScanRef,
    reportError,
    setIndexHealthLogs,
    setIndexProgress,
    setMessage,
    workspaceRoot,
  ]);

  const startIndexScan = useCallback(async () => {
    await startReindex("soft");
  }, [startReindex]);

  const startPhpReindex = useCallback(async () => {
    await startReindex("language", "php");
  }, [startReindex]);

  const startHardReindex = useCallback(async () => {
    await startReindex("hard");
  }, [startReindex]);

  return {
    startHardReindex,
    startIndexScan,
    startPhpReindex,
  };
}

export function reindexStartMessage(mode: WorkspaceReindexMode): string {
  if (mode === "hard") {
    return "Hard index rebuild started.";
  }

  if (mode === "language") {
    return "PHP symbol reindex started.";
  }

  return "Index scan started.";
}
