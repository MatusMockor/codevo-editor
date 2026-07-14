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
  createIndexHealthCompletionLog,
  createIndexHealthLogEntry,
  indexProgressCompletionMessage,
  indexProgressNoticeSeverity,
  initialIndexProgress,
  prependIndexHealthLog,
  startIndexProgress,
  type IndexHealthLogEntry,
  type IndexProgressEvent,
  type IndexProgressGateway,
  type IndexProgressState,
  type MetadataScanCompletionEvent,
  type UnsubscribeFn as IndexProgressUnsubscribeFn,
} from "../domain/indexProgress";
import type { IntelligenceMode } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import {
  createWorkbenchNotice,
  replaceWorkbenchNoticeGroup,
  type WorkbenchNotice,
} from "./workbenchNotice";
import {
  useWorkbenchIndexCommands,
  type WorkbenchIndexActions,
} from "./useWorkbenchIndexCommands";

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
}

export interface WorkbenchIndexLifecycle extends WorkbenchIndexActions {
  clearIndexWorkspaceState(): void;
  clearWorkspaceIndex(rootPath: string, message?: string): Promise<void>;
  indexHealthLogs: IndexHealthLogEntry[];
  indexProgress: IndexProgressState;
  restoreCachedIndexState(
    indexProgress: IndexProgressState,
    indexHealthLogs: IndexHealthLogEntry[],
  ): void;
  restoreIndexRoot(rootPath: string | null): void;
  startInitialIndexScan(rootPath: string): Promise<void>;
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
}: WorkbenchIndexLifecycleOptions): WorkbenchIndexLifecycle {
  const [indexProgress, setIndexProgress] = useState<IndexProgressState>(
    initialIndexProgress,
  );
  const [indexHealthLogs, setIndexHealthLogs] = useState<
    IndexHealthLogEntry[]
  >([]);
  const activeIndexRootRef = useRef<string | null>(null);
  const pendingIndexRootRef = useRef<string | null>(null);
  const pendingIndexScanRef = useRef(false);

  const handleMetadataScanCompletion = useCallback(
    (event: MetadataScanCompletionEvent) => {
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, event.rootPath)) {
        return;
      }

      if (!shouldIndexWorkspace(intelligenceModeRef.current)) {
        const clearRoot = event.rootPath;
        pendingIndexScanRef.current = false;
        pendingIndexRootRef.current = null;
        activeIndexRootRef.current = null;
        indexProgressGateway
          .clearWorkspaceIndex(clearRoot)
          .catch((error) => {
            if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, clearRoot)) {
              return;
            }

            reportError("Index", error);
          });
        return;
      }

      if (pendingIndexScanRef.current) {
        if (!workspaceRootKeysEqual(pendingIndexRootRef.current, event.rootPath)) {
          return;
        }
      } else {
        if (!workspaceRootKeysEqual(activeIndexRootRef.current, event.rootPath)) {
          return;
        }
      }

      const message = indexProgressCompletionMessage(event);
      const severity = indexProgressNoticeSeverity(event);
      const groupKey = indexProgressNoticeGroup(event.rootPath);

      pendingIndexScanRef.current = false;
      pendingIndexRootRef.current = null;
      activeIndexRootRef.current = event.rootPath;
      resetPhpFrameworkCaches();
      setIndexProgress((current) =>
        applyMetadataScanCompletion(current, event),
      );
      setIndexHealthLogs((current) =>
        prependIndexHealthLog(current, createIndexHealthCompletionLog(event)),
      );
      setMessage(message);
      setNotices((current) =>
        replaceWorkbenchNoticeGroup(
          current,
          groupKey,
          severity
            ? [createWorkbenchNotice(severity, "Index", message, groupKey)]
            : [],
        ),
      );
    },
    [
      currentWorkspaceRootRef,
      indexProgressGateway,
      intelligenceModeRef,
      reportError,
      resetPhpFrameworkCaches,
      setMessage,
      setNotices,
    ],
  );

  const handleIndexProgress = useCallback((event: IndexProgressEvent) => {
    // Per-workspace isolation: drop progress for any root that is not the active workspace and the
    // root the in-flight index was actually started for, so a stale background run can never paint
    // the newly-active workspace's status bar. Progress is purely advisory - completion/failure are
    // still owned by handleMetadataScanCompletion.
    if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, event.rootPath)) {
      return;
    }

    const indexRoot = pendingIndexScanRef.current
      ? pendingIndexRootRef.current
      : activeIndexRootRef.current;

    if (!workspaceRootKeysEqual(indexRoot, event.rootPath)) {
      return;
    }

    setIndexProgress((current) => {
      if (
        current.rootPath &&
        !workspaceRootKeysEqual(current.rootPath, event.rootPath)
      ) {
        return current;
      }

      return applyIndexProgress(current, event);
    });
  }, [currentWorkspaceRootRef]);

  const startInitialIndexScan = useCallback(
    async (rootPath: string) => {
      if (!shouldIndexWorkspace(intelligenceModeRef.current)) {
        return;
      }

      pendingIndexScanRef.current = true;
      pendingIndexRootRef.current = rootPath;

      try {
        const started = await indexProgressGateway.startInitialMetadataScan(
          rootPath,
        );

        if (
          !pendingIndexScanRef.current ||
          !workspaceRootKeysEqual(pendingIndexRootRef.current, rootPath)
        ) {
          return;
        }

        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
          pendingIndexScanRef.current = false;
          pendingIndexRootRef.current = null;
          return;
        }

        if (!workspaceRootKeysEqual(started.rootPath, rootPath)) {
          pendingIndexScanRef.current = false;
          pendingIndexRootRef.current = null;
          return;
        }

        activeIndexRootRef.current = started.rootPath;
        setIndexProgress(startIndexProgress(started));
        setIndexHealthLogs((current) =>
          prependIndexHealthLog(
            current,
            createIndexHealthLogEntry("info", rootPath, "Indexing workspace."),
          ),
        );
        setMessage("Indexing workspace.");
      } catch (error) {
        if (!workspaceRootKeysEqual(pendingIndexRootRef.current, rootPath)) {
          return;
        }

        pendingIndexScanRef.current = false;
        pendingIndexRootRef.current = null;

        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
          return;
        }

        reportError("Index", error);
      }
    },
    [
      currentWorkspaceRootRef,
      indexProgressGateway,
      intelligenceModeRef,
      reportError,
      setMessage,
    ],
  );

  const clearIndexWorkspaceState = useCallback(() => {
    pendingIndexScanRef.current = false;
    pendingIndexRootRef.current = null;
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
    async (rootPath: string, message?: string) => {
      clearIndexWorkspaceState();

      try {
        await indexProgressGateway.clearWorkspaceIndex(rootPath);
        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
          return;
        }

        if (message) {
          setMessage(message);
        }
      } catch (error) {
        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
          return;
        }

        reportError("Index", error);
      }
    },
    [
      clearIndexWorkspaceState,
      currentWorkspaceRootRef,
      indexProgressGateway,
      reportError,
      setMessage,
    ],
  );

  const restoreCachedIndexState = useCallback(
    (
      restoredIndexProgress: IndexProgressState,
      restoredIndexHealthLogs: IndexHealthLogEntry[],
    ) => {
      setIndexHealthLogs(restoredIndexHealthLogs);
      setIndexProgress(restoredIndexProgress);
    },
    [],
  );

  const restoreIndexRoot = useCallback((rootPath: string | null) => {
    activeIndexRootRef.current = rootPath;
    pendingIndexScanRef.current = false;
  }, []);

  const {
    startHardReindex,
    startIndexScan,
    startPhpReindex,
  } = useWorkbenchIndexCommands({
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
  });

  useEffect(() => {
    let active = true;
    const subscriptionRoot = workspaceRoot;
    let unsubscribe: IndexProgressUnsubscribeFn | null = null;
    let unsubscribeProgress: IndexProgressUnsubscribeFn | null = null;

    const reportSubscriptionError = (error: unknown) => {
      if (
        !active ||
        !subscriptionRoot ||
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
