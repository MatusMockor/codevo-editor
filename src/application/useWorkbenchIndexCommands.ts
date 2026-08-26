import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { shouldIndexWorkspace } from "../domain/intelligence";
import {
  createIndexHealthLogEntry,
  prependIndexHealthLog,
  startIndexProgress,
  type IndexHealthLogEntry,
  type IndexProgressGateway,
  type IndexProgressState,
  type InitialMetadataScanStart,
  type WorkspaceReindexMode,
} from "../domain/indexProgress";
import type { IntelligenceMode } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

export interface WorkbenchIndexActions {
  startIndexScan(): Promise<void>;
  startPhpReindex(): Promise<void>;
  startHardReindex(): Promise<void>;
}

export interface WorkbenchIndexOperation {
  readonly admissionToken: number;
  readonly operationGeneration: number;
  readonly requestIsCurrent: () => boolean;
  readonly rootPath: string;
  readonly workspaceId: string;
}

export interface WorkbenchIndexCommandsOptions {
  activeIndexRootRef: MutableRefObject<string | null>;
  abandonIndexOperation(operation: WorkbenchIndexOperation): void;
  beginIndexOperation(rootPath: string): WorkbenchIndexOperation | null;
  indexProgressGateway: IndexProgressGateway;
  intelligenceMode: IntelligenceMode;
  indexOperationIsCurrent(operation: WorkbenchIndexOperation): boolean;
  reportError(source: string, error: unknown): void;
  setIndexHealthLogs: Dispatch<SetStateAction<IndexHealthLogEntry[]>>;
  setIndexProgress: Dispatch<SetStateAction<IndexProgressState>>;
  setMessage: Dispatch<SetStateAction<string | null>>;
  workspaceRoot: string | null;
}

export function useWorkbenchIndexCommands({
  activeIndexRootRef,
  abandonIndexOperation,
  beginIndexOperation,
  indexProgressGateway,
  intelligenceMode,
  indexOperationIsCurrent,
  reportError,
  setIndexHealthLogs,
  setIndexProgress,
  setMessage,
  workspaceRoot,
}: WorkbenchIndexCommandsOptions): WorkbenchIndexActions {
  const startReindex = useCallback(
    async (mode: WorkspaceReindexMode, language?: string) => {
      if (!workspaceRoot) {
        return;
      }

      if (!shouldIndexWorkspace(intelligenceMode)) {
        setMessage("Enable Smart Index or IDE Mode to index this workspace.");
        return;
      }

      const requestedRoot = workspaceRoot;
      const operation = beginIndexOperation(requestedRoot);
      if (!operation) return;

      try {
        const started = await indexProgressGateway.startReindex(
          {
            admissionToken: operation.admissionToken,
            operationGeneration: operation.operationGeneration,
            rootPath: requestedRoot,
            workspaceId: operation.workspaceId,
          },
          mode,
          language,
        );

        if (!indexOperationIsCurrent(operation)) {
          abandonIndexOperation(operation);
          return;
        }

        if (
          started.operationGeneration !== operation.operationGeneration ||
          !workspaceRootKeysEqual(started.rootPath, requestedRoot)
        ) {
          abandonIndexOperation(operation);
          return;
        }

        activeIndexRootRef.current = started.rootPath;
        setIndexProgress((current) => attachIndexStartReceipt(current, started));
        const message = reindexStartMessage(mode);
        setIndexHealthLogs((current) =>
          prependIndexHealthLog(current, createIndexHealthLogEntry("info", requestedRoot, message)),
        );
        setMessage(message);
      } catch (error) {
        if (!indexOperationIsCurrent(operation)) {
          abandonIndexOperation(operation);
          return;
        }
        abandonIndexOperation(operation);

        reportError("Index", error);
      }
    },
    [
      activeIndexRootRef,
      abandonIndexOperation,
      beginIndexOperation,
      indexOperationIsCurrent,
      indexProgressGateway,
      intelligenceMode,
      reportError,
      setIndexHealthLogs,
      setIndexProgress,
      setMessage,
      workspaceRoot,
    ],
  );

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

export function attachIndexStartReceipt(
  current: IndexProgressState,
  started: InitialMetadataScanStart,
): IndexProgressState {
  if (
    current.status === "scanning" &&
    current.operationGeneration === started.operationGeneration &&
    workspaceRootKeysEqual(current.rootPath, started.rootPath)
  ) {
    return { ...current, databasePath: started.databasePath };
  }
  return startIndexProgress(started);
}
