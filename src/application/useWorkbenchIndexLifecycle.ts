import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { shouldIndexWorkspace } from "../domain/intelligence";
import {
  applyIndexProgress,
  applyMetadataScanCompletion,
  beginIndexProgress,
  createIndexHealthCompletionLog,
  createIndexHealthLogEntry,
  indexProgressCompletionMessage,
  indexProgressNoticeSeverity,
  initialIndexProgress,
  prependIndexHealthLog,
  type IndexHealthLogEntry,
  type IndexProgressEvent,
  type IndexProgressGateway,
  type IndexProgressState,
  type MetadataScanCompletionEvent,
  type UnsubscribeFn as IndexProgressUnsubscribeFn,
} from "../domain/indexProgress";
import type { IntelligenceMode } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { WorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import {
  createWorkbenchNotice,
  replaceWorkbenchNoticeGroup,
  type WorkbenchNotice,
} from "./workbenchNotice";
import {
  attachIndexStartReceipt,
  useWorkbenchIndexCommands,
  type WorkbenchIndexActions,
  type WorkbenchIndexOperation,
} from "./useWorkbenchIndexCommands";

const MAX_INDEX_OPERATION_GENERATION = 4_294_967_295;
const workbenchIndexOperationGenerationIssuer = createIndexOperationGenerationIssuer();

export interface WorkbenchIndexLifecycleOptions {
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  indexProgressGateway: IndexProgressGateway;
  intelligenceMode: IntelligenceMode;
  intelligenceModeRef: MutableRefObject<IntelligenceMode>;
  reportError(source: string, error: unknown): void;
  resetIndexedWorkspaceViews(): void;
  resetPhpFrameworkCaches(): void;
  setMessage: Dispatch<SetStateAction<string | null>>;
  setNotices: Dispatch<SetStateAction<WorkbenchNotice[]>>;
  workspaceRoot: string | null;
  workspaceIdentityDescriptorRef: {
    readonly current: {
      readonly admissionToken?: number;
      readonly workspaceId: string;
    } | null;
  };
  workspaceRuntimeOwner: WorkspaceRuntimeOwner | null;
  workspaceRuntimeOwnerGeneration(ownerKey: string): number | null | undefined;
  workspaceRuntimeOwnerRef: { readonly current: WorkspaceRuntimeOwner | null };
}

export interface WorkbenchIndexLifecycle extends WorkbenchIndexActions {
  clearIndexWorkspaceState(): void;
  clearWorkspaceIndex(
    rootPath: string,
    message: string | undefined,
    requestIsCurrent: () => boolean,
  ): Promise<void>;
  indexHealthLogs: IndexHealthLogEntry[];
  indexProgress: IndexProgressState;
  restoreCachedIndexState(
    indexProgress: IndexProgressState,
    indexHealthLogs: IndexHealthLogEntry[],
  ): void;
  restoreIndexRoot(rootPath: string | null): void;
  startInitialIndexScan(rootPath: string, requestIsCurrent: () => boolean): Promise<void>;
}

export function useWorkbenchIndexLifecycle({
  currentWorkspaceRootRef,
  indexProgressGateway,
  intelligenceMode,
  intelligenceModeRef,
  reportError,
  resetIndexedWorkspaceViews,
  resetPhpFrameworkCaches,
  setMessage,
  setNotices,
  workspaceRoot,
  workspaceIdentityDescriptorRef,
  workspaceRuntimeOwner,
  workspaceRuntimeOwnerGeneration,
  workspaceRuntimeOwnerRef,
}: WorkbenchIndexLifecycleOptions): WorkbenchIndexLifecycle {
  const [indexProgress, setIndexProgress] = useState<IndexProgressState>(initialIndexProgress);
  const [indexHealthLogs, setIndexHealthLogs] = useState<IndexHealthLogEntry[]>([]);
  const activeIndexRootRef = useRef<string | null>(null);
  const pendingIndexRootRef = useRef<string | null>(null);
  const pendingIndexScanRef = useRef(false);
  const pendingIndexOperationRef = useRef<WorkbenchIndexOperation | null>(null);

  const captureIndexOperationAuthority = useCallback(
    (rootPath: string, requestedOwner: WorkspaceRuntimeOwner | null) => {
      if (!requestedOwner || !workspaceRootKeysEqual(requestedOwner.executionRoot, rootPath)) {
        return null;
      }
      const requestedGeneration = workspaceRuntimeOwnerGeneration(requestedOwner.ownerKey);
      if (requestedGeneration === null || requestedGeneration === undefined) return null;
      const workspaceIdentityDescriptor = workspaceIdentityDescriptorRef.current;
      const admissionToken = workspaceIdentityDescriptor?.admissionToken;
      if (
        !workspaceIdentityDescriptor ||
        workspaceIdentityDescriptor.workspaceId !== requestedOwner.ownerKey
      )
        return null;
      if (typeof admissionToken !== "number" || !Number.isSafeInteger(admissionToken)) return null;
      if (admissionToken <= 0) return null;
      return Object.freeze({
        admissionToken,
        requestIsCurrent: () =>
          workspaceRuntimeOwnerRef.current === requestedOwner &&
          workspaceRuntimeOwnerGeneration(requestedOwner.ownerKey) === requestedGeneration &&
          workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath),
        workspaceId: workspaceIdentityDescriptor.workspaceId,
      });
    },
    [
      currentWorkspaceRootRef,
      workspaceIdentityDescriptorRef,
      workspaceRuntimeOwnerGeneration,
      workspaceRuntimeOwnerRef,
    ],
  );

  const indexOperationIsCurrent = useCallback(
    (operation: WorkbenchIndexOperation) =>
      pendingIndexOperationRef.current === operation &&
      operation.requestIsCurrent() &&
      pendingIndexScanRef.current &&
      workspaceRootKeysEqual(pendingIndexRootRef.current, operation.rootPath),
    [],
  );

  const cancelIndexOperation = useCallback((operation: WorkbenchIndexOperation) => {
    if (pendingIndexOperationRef.current !== operation) return;
    pendingIndexOperationRef.current = null;
    pendingIndexScanRef.current = false;
    pendingIndexRootRef.current = null;
  }, []);

  const abandonIndexOperation = useCallback(
    (operation: WorkbenchIndexOperation) => {
      if (pendingIndexOperationRef.current !== operation) return;
      cancelIndexOperation(operation);
      activeIndexRootRef.current = null;
      setIndexProgress(initialIndexProgress());
    },
    [cancelIndexOperation],
  );

  const beginIndexOperation = useCallback(
    (rootPath: string, requestIsCurrent?: () => boolean): WorkbenchIndexOperation | null => {
      const ownerAuthority = captureIndexOperationAuthority(
        rootPath,
        workspaceRuntimeOwnerRef.current,
      );
      if (!ownerAuthority) return null;
      const remainsCurrent = () =>
        ownerAuthority.requestIsCurrent() && (!requestIsCurrent || requestIsCurrent());
      if (!remainsCurrent()) return null;
      const operationGeneration = workbenchIndexOperationGenerationIssuer.issue();
      if (operationGeneration === null) {
        reportError("Index", new Error("Index operation generation exhausted."));
        return null;
      }
      const operation = Object.freeze({
        admissionToken: ownerAuthority.admissionToken,
        operationGeneration,
        requestIsCurrent: remainsCurrent,
        rootPath,
        workspaceId: ownerAuthority.workspaceId,
      });
      pendingIndexOperationRef.current = operation;
      pendingIndexScanRef.current = true;
      pendingIndexRootRef.current = rootPath;
      setIndexProgress(beginIndexProgress(rootPath, operationGeneration));
      return operation;
    },
    [captureIndexOperationAuthority, reportError, workspaceRuntimeOwnerRef],
  );

  const handleMetadataScanCompletion = useCallback(
    (event: MetadataScanCompletionEvent) => {
      const operation = pendingIndexOperationRef.current;
      if (!operation || !indexOperationIsCurrent(operation)) return;
      if (operation.operationGeneration !== event.operationGeneration) return;
      if (!workspaceRootKeysEqual(operation.rootPath, event.rootPath)) return;

      if (!shouldIndexWorkspace(intelligenceModeRef.current)) {
        const clearRoot = event.rootPath;
        cancelIndexOperation(operation);
        activeIndexRootRef.current = null;
        indexProgressGateway
          .clearWorkspaceIndex({
            admissionToken: operation.admissionToken,
            rootPath: clearRoot,
            workspaceId: operation.workspaceId,
          })
          .catch((error) => {
            if (!operation.requestIsCurrent()) return;

            reportError("Index", error);
          });
        return;
      }

      const message = indexProgressCompletionMessage(event);
      const severity = indexProgressNoticeSeverity(event);
      const groupKey = indexProgressNoticeGroup(event.rootPath);

      cancelIndexOperation(operation);
      activeIndexRootRef.current = event.rootPath;
      resetPhpFrameworkCaches();
      setIndexProgress((current) => applyMetadataScanCompletion(current, event));
      setIndexHealthLogs((current) =>
        prependIndexHealthLog(current, createIndexHealthCompletionLog(event)),
      );
      setMessage(message);
      setNotices((current) =>
        replaceWorkbenchNoticeGroup(
          current,
          groupKey,
          severity ? [createWorkbenchNotice(severity, "Index", message, groupKey)] : [],
        ),
      );
    },
    [
      cancelIndexOperation,
      indexOperationIsCurrent,
      indexProgressGateway,
      intelligenceModeRef,
      reportError,
      resetPhpFrameworkCaches,
      setMessage,
      setNotices,
    ],
  );

  const handleIndexProgress = useCallback(
    (event: IndexProgressEvent) => {
      const operation = pendingIndexOperationRef.current;
      if (!operation || !indexOperationIsCurrent(operation)) return;
      if (operation.operationGeneration !== event.operationGeneration) return;
      if (!workspaceRootKeysEqual(operation.rootPath, event.rootPath)) return;

      setIndexProgress((current) => {
        if (current.operationGeneration !== event.operationGeneration) return current;
        if (!workspaceRootKeysEqual(current.rootPath, event.rootPath)) return current;

        return applyIndexProgress(current, event);
      });
    },
    [indexOperationIsCurrent],
  );

  const startInitialIndexScan = useCallback(
    async (rootPath: string, requestIsCurrent: () => boolean) => {
      if (!shouldIndexWorkspace(intelligenceModeRef.current)) return;
      const operation = beginIndexOperation(rootPath, requestIsCurrent);
      if (!operation) return;

      try {
        const started = await indexProgressGateway.startInitialMetadataScan({
          admissionToken: operation.admissionToken,
          operationGeneration: operation.operationGeneration,
          rootPath,
          workspaceId: operation.workspaceId,
        });
        if (!indexOperationIsCurrent(operation)) {
          abandonIndexOperation(operation);
          return;
        }

        if (
          started.operationGeneration !== operation.operationGeneration ||
          !workspaceRootKeysEqual(started.rootPath, rootPath)
        ) {
          abandonIndexOperation(operation);
          return;
        }

        activeIndexRootRef.current = started.rootPath;
        setIndexProgress((current) => attachIndexStartReceipt(current, started));
        setIndexHealthLogs((current) =>
          prependIndexHealthLog(
            current,
            createIndexHealthLogEntry("info", rootPath, "Indexing workspace."),
          ),
        );
        setMessage("Indexing workspace.");
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
      abandonIndexOperation,
      beginIndexOperation,
      indexOperationIsCurrent,
      indexProgressGateway,
      intelligenceModeRef,
      reportError,
      setMessage,
    ],
  );

  const clearIndexWorkspaceState = useCallback(() => {
    pendingIndexScanRef.current = false;
    pendingIndexRootRef.current = null;
    pendingIndexOperationRef.current = null;
    activeIndexRootRef.current = null;
    resetPhpFrameworkCaches();
    setIndexProgress(initialIndexProgress());
    setIndexHealthLogs([]);
    resetIndexedWorkspaceViews();
    setNotices((current) =>
      current.filter((notice) => !notice.groupKey?.startsWith("index-progress:")),
    );
  }, [resetIndexedWorkspaceViews, resetPhpFrameworkCaches, setNotices]);

  const clearWorkspaceIndex = useCallback(
    async (rootPath: string, message: string | undefined, requestIsCurrent: () => boolean) => {
      const ownerAuthority = captureIndexOperationAuthority(
        rootPath,
        workspaceRuntimeOwnerRef.current,
      );
      if (!ownerAuthority) return;
      const remainsCurrent = () => ownerAuthority.requestIsCurrent() && requestIsCurrent();
      if (!remainsCurrent()) return;
      clearIndexWorkspaceState();

      try {
        await indexProgressGateway.clearWorkspaceIndex({
          admissionToken: ownerAuthority.admissionToken,
          rootPath,
          workspaceId: ownerAuthority.workspaceId,
        });
        if (!remainsCurrent()) return;

        if (message) {
          setMessage(message);
        }
      } catch (error) {
        if (!remainsCurrent()) return;

        reportError("Index", error);
      }
    },
    [
      clearIndexWorkspaceState,
      captureIndexOperationAuthority,
      indexProgressGateway,
      reportError,
      setMessage,
      workspaceRuntimeOwnerRef,
    ],
  );

  const restoreCachedIndexState = useCallback(
    (restoredIndexProgress: IndexProgressState, restoredIndexHealthLogs: IndexHealthLogEntry[]) => {
      setIndexHealthLogs(restoredIndexHealthLogs);
      setIndexProgress(restoredIndexProgress);
    },
    [],
  );

  const restoreIndexRoot = useCallback((rootPath: string | null) => {
    activeIndexRootRef.current = rootPath;
    pendingIndexScanRef.current = false;
    pendingIndexOperationRef.current = null;
  }, []);

  const { startHardReindex, startIndexScan, startPhpReindex } = useWorkbenchIndexCommands({
    activeIndexRootRef,
    abandonIndexOperation,
    beginIndexOperation,
    indexProgressGateway,
    indexOperationIsCurrent,
    intelligenceMode,
    reportError,
    setIndexHealthLogs,
    setIndexProgress,
    setMessage,
    workspaceRoot,
  });

  useEffect(() => {
    let active = true;
    const subscriptionRoot = workspaceRoot;
    const subscriptionOwner = workspaceRuntimeOwner;
    const subscriptionGeneration = subscriptionOwner
      ? workspaceRuntimeOwnerGeneration(subscriptionOwner.ownerKey)
      : null;
    let unsubscribe: IndexProgressUnsubscribeFn | null = null;
    let unsubscribeProgress: IndexProgressUnsubscribeFn | null = null;

    const reportSubscriptionError = (error: unknown) => {
      if (
        !active ||
        !subscriptionRoot ||
        !subscriptionOwner ||
        subscriptionGeneration === null ||
        subscriptionGeneration === undefined ||
        workspaceRuntimeOwnerRef.current !== subscriptionOwner ||
        workspaceRuntimeOwnerGeneration(subscriptionOwner.ownerKey) !== subscriptionGeneration ||
        !workspaceRootKeysEqual(currentWorkspaceRootRef.current, subscriptionRoot)
      ) {
        return;
      }

      reportError("Index", error);
    };

    indexProgressGateway
      .subscribeMetadataScanCompletion((event) => {
        if (!active) {
          return;
        }

        handleMetadataScanCompletion(event);
      })
      .then((dispose) => {
        if (!active) {
          dispose();
          return;
        }

        unsubscribe = dispose;
      })
      .catch(reportSubscriptionError);

    indexProgressGateway
      .subscribeIndexProgress((event) => {
        if (!active) {
          return;
        }

        handleIndexProgress(event);
      })
      .then((dispose) => {
        if (!active) {
          dispose();
          return;
        }

        unsubscribeProgress = dispose;
      })
      .catch(reportSubscriptionError);

    return () => {
      active = false;
      unsubscribe?.();
      unsubscribeProgress?.();
    };
  }, [
    currentWorkspaceRootRef,
    handleIndexProgress,
    handleMetadataScanCompletion,
    indexProgressGateway,
    reportError,
    workspaceRoot,
    workspaceRuntimeOwner,
    workspaceRuntimeOwnerGeneration,
    workspaceRuntimeOwnerRef,
  ]);

  return {
    clearIndexWorkspaceState,
    clearWorkspaceIndex,
    indexHealthLogs,
    indexProgress,
    restoreCachedIndexState,
    restoreIndexRoot,
    startHardReindex,
    startIndexScan,
    startInitialIndexScan,
    startPhpReindex,
  };
}

function indexProgressNoticeGroup(rootPath: string): string {
  return `index-progress:${rootPath}`;
}

export interface IndexOperationGenerationIssuer {
  issue(): number | null;
}

export function createIndexOperationGenerationIssuer(initialGeneration = 0) {
  let currentGeneration = initialGeneration;
  return Object.freeze<IndexOperationGenerationIssuer>({
    issue() {
      if (
        !Number.isInteger(currentGeneration) ||
        currentGeneration < 0 ||
        currentGeneration >= MAX_INDEX_OPERATION_GENERATION
      ) {
        return null;
      }
      currentGeneration += 1;
      return currentGeneration;
    },
  });
}
