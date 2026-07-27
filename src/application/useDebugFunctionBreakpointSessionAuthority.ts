import { useCallback, type MutableRefObject } from "react";
import { debuggerSessionId } from "../domain/debug";
import type { DebuggerSessionSnapshot } from "../domain/debugSessionState";
import { normalizedWorkspaceRootKey, workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import { projectActiveFunctionBreakpointSession } from "./debugSessionOwnerProjection";
import { inactiveSnapshot } from "./debugSessionDefaults";
import type { ActiveFunctionBreakpointSession } from "./useDebugFunctionBreakpointManagement";
import type { DebugSessionOwner } from "./useDebugSessionEnd";

interface Options {
  readonly adapterKindForSession: (
    rootPath: string,
    sessionId: number,
  ) => "node" | "php" | null | undefined;
  readonly currentRootRef: MutableRefObject<string | null>;
  readonly pendingAdapterByRootRef: MutableRefObject<Record<string, "node" | "php">>;
  readonly sessionOwnersRef: MutableRefObject<Map<string, DebugSessionOwner>>;
  readonly snapshotsRef: MutableRefObject<Record<string, DebuggerSessionSnapshot>>;
  readonly workspaceOwnerEpochRef: MutableRefObject<{ readonly epoch: number }>;
}

export function useDebugFunctionBreakpointSessionAuthority(options: Options) {
  const project = useCallback(
    (rootPath: string, sessionId: number, workspaceEpoch: number) => {
      const rootKey = normalizedWorkspaceRootKey(rootPath);
      const adapterKind =
        options.adapterKindForSession(rootPath, sessionId) ??
        options.pendingAdapterByRootRef.current[rootKey];
      return projectActiveFunctionBreakpointSession(
        rootPath,
        sessionId,
        adapterKind,
        options.sessionOwnersRef.current.get(rootKey),
        workspaceEpoch,
      );
    },
    [options],
  );
  const getActiveSession = useCallback(() => {
    const rootPath = options.currentRootRef.current;
    if (!rootPath) return null;
    const snapshot =
      options.snapshotsRef.current[normalizedWorkspaceRootKey(rootPath)] ?? inactiveSnapshot;
    if (snapshot.state.kind === "inactive" || snapshot.state.kind === "terminated") return null;
    const sessionId = debuggerSessionId(snapshot.state);
    if (sessionId === null) return null;
    return project(rootPath, sessionId, options.workspaceOwnerEpochRef.current.epoch);
  }, [options, project]);
  const isSessionCurrent = useCallback(
    (requested: ActiveFunctionBreakpointSession) => {
      if (!workspaceRootKeysEqual(options.currentRootRef.current, requested.rootPath)) return false;
      const rootKey = normalizedWorkspaceRootKey(requested.rootPath);
      const snapshot = options.snapshotsRef.current[rootKey] ?? inactiveSnapshot;
      if (
        snapshot.state.kind === "inactive" ||
        snapshot.state.kind === "terminated" ||
        debuggerSessionId(snapshot.state) !== requested.sessionId
      ) {
        return false;
      }
      const current = project(requested.rootPath, requested.sessionId, requested.workspaceEpoch);
      return (
        current?.adapterKind === requested.adapterKind &&
        current.workspaceId === requested.workspaceId
      );
    },
    [options, project],
  );
  return { getActiveSession, isSessionCurrent };
}
