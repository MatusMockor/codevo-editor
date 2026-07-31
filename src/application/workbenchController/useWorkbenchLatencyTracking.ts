import { useCallback, type MutableRefObject } from "react";
import {
  createLatencyTracker,
  type LatencyOperationKind,
  type LatencySnapshotEntry,
  type LatencyTracker,
} from "../../domain/latencyTracker";
import { normalizedWorkspaceRootKey } from "../../domain/workspaceRootKey";

interface UseWorkbenchLatencyTrackingOptions {
  readonly currentWorkspaceRootRef: MutableRefObject<string | null>;
  readonly latencyTrackersByRootRef: MutableRefObject<Record<string, LatencyTracker>>;
}

export function useWorkbenchLatencyTrackerForRoot({
  latencyTrackersByRootRef,
}: UseWorkbenchLatencyTrackingOptions) {
  return useCallback(
    (rootPath: string) => {
      const rootKey = normalizedWorkspaceRootKey(rootPath);
      let tracker = latencyTrackersByRootRef.current[rootKey];

      if (!tracker) {
        tracker = createLatencyTracker();
        latencyTrackersByRootRef.current[rootKey] = tracker;
      }

      return tracker;
    },
    [latencyTrackersByRootRef],
  );
}

export function useWorkbenchLatencyReporting({
  currentWorkspaceRootRef,
  latencyTrackersByRootRef,
  latencyTrackerForRoot,
}: UseWorkbenchLatencyTrackingOptions & {
  readonly latencyTrackerForRoot: (rootPath: string) => LatencyTracker;
}) {
  const clearLatencyMetrics = useCallback(() => {
    const requestedRoot = currentWorkspaceRootRef.current;

    if (!requestedRoot) {
      return;
    }

    const rootKey = normalizedWorkspaceRootKey(requestedRoot);
    latencyTrackersByRootRef.current[rootKey]?.clear();
  }, [currentWorkspaceRootRef, latencyTrackersByRootRef]);

  const forgetLatencyTrackerForRoot = useCallback(
    (rootPath: string | null | undefined) => {
      const rootKey = normalizedWorkspaceRootKey(rootPath);

      if (rootKey) {
        delete latencyTrackersByRootRef.current[rootKey];
      }
    },
    [latencyTrackersByRootRef],
  );

  const recordCompletionLatency = useCallback(
    (durationMs: number, rootPath?: string, feature: LatencyOperationKind = "completion") => {
      const requestedRoot = rootPath ?? currentWorkspaceRootRef.current;

      if (!requestedRoot) {
        return;
      }

      latencyTrackerForRoot(requestedRoot).record(feature, durationMs);
    },
    [currentWorkspaceRootRef, latencyTrackerForRoot],
  );

  const getLatencySnapshot = useCallback((): LatencySnapshotEntry[] => {
    const requestedRoot = currentWorkspaceRootRef.current;

    if (!requestedRoot) {
      return [];
    }

    const rootKey = normalizedWorkspaceRootKey(requestedRoot);
    return latencyTrackersByRootRef.current[rootKey]?.snapshot() ?? [];
  }, [currentWorkspaceRootRef, latencyTrackersByRootRef]);

  return {
    clearLatencyMetrics,
    forgetLatencyTrackerForRoot,
    getLatencySnapshot,
    recordCompletionLatency,
  };
}
