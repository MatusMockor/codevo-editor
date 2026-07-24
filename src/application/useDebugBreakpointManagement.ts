import {
  useCallback,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type {
  Breakpoint,
  BreakpointCreationOwnership,
  BreakpointHitCondition,
  DebugGateway,
} from "../domain/debug";
import {
  applyVerification,
  clearBreakpoints,
  removeBreakpoint as removeBreakpointFromList,
  setAllBreakpointsEnabled,
  setBreakpointCondition as setBreakpointConditionInList,
  setBreakpointEnabled as setBreakpointEnabledInList,
  setBreakpointHitCondition as setBreakpointHitConditionInList,
  setBreakpointLogMessage as setBreakpointLogMessageInList,
  toggleBreakpoint as toggleBreakpointInList,
} from "../domain/debugBreakpoints";
import {
  breakpointsForDebugSession,
  isBreakpointPathSupported,
  sanitizeDebugBreakpoints,
} from "../domain/debugBreakpointPolicy";
import { normalizedWorkspaceRootKey, workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import { createDebugBreakpointSynchronization } from "./debugBreakpointSynchronization";
import { useDebugInlineBreakpointMutations } from "./useDebugInlineBreakpointMutations";
import type {
  DebugBreakpointRelocationCandidate,
  DebugInlineBreakpointCandidate,
} from "./debugSessionContracts";

const MAX_CONCURRENT_BREAKPOINT_BULK_SYNCS = 4;
const BREAKPOINT_BULK_SYNC_ERROR = "Unable to synchronize all breakpoints.";
const COMPOUND_POLICY_SYNC_ERROR = "Unable to synchronize the active debug compound.";

interface PendingRegistry {
  has(key: string): boolean;
}

interface UseDebugBreakpointManagementOptions {
  readonly activeControlSessionId: () => number | null;
  readonly activeSessionId: () => number | null;
  readonly adapterKindForSession: (rootPath: string, sessionId: number) => "node" | "php" | null;
  readonly breakpointsByRootRef: MutableRefObject<Record<string, Breakpoint[]>>;
  commitBreakpoints(key: string, list: Breakpoint[]): void;
  readonly createBreakpointId: () => string;
  readonly currentRootRef: MutableRefObject<string | null>;
  readonly currentWorkspaceIdRef: MutableRefObject<string | null>;
  readonly exactLiveCompoundSessionIds: (
    rootPath: string,
    selectedSessionId: number,
  ) => readonly number[] | null;
  readonly failClosedCompoundPolicy: (rootPath: string, selectedSessionId: number) => Promise<void>;
  readonly gateway: DebugGateway;
  readonly isExactWorkspaceOwnerCurrent: (rootPath: string, workspaceId: string | null) => boolean;
  readonly isWorkspaceTrusted: () => boolean;
  readonly mountedRef: MutableRefObject<boolean>;
  readonly pendingActiveStopsRef: MutableRefObject<PendingRegistry>;
  readonly pendingBreakpointBulkMutationsRef: MutableRefObject<Map<string, Promise<void>>>;
  readonly pendingControlsRef: MutableRefObject<PendingRegistry>;
  readonly pendingRestartsRef: MutableRefObject<PendingRegistry>;
  readonly pendingStartKeysRef: MutableRefObject<PendingRegistry>;
  readonly setBreakpointBulkPendingByRoot: Dispatch<SetStateAction<Record<string, boolean>>>;
}

export interface DebugBreakpointManagement {
  addInlineBreakpoint(
    candidate: DebugInlineBreakpointCandidate,
  ): Promise<BreakpointCreationOwnership | null>;
  disableAllBreakpoints(): Promise<void>;
  enableAllBreakpoints(): Promise<void>;
  relocateBreakpoint(candidate: DebugBreakpointRelocationCandidate): Promise<boolean>;
  removeAllBreakpoints(): Promise<void>;
  removeBreakpoint(id: string): Promise<void>;
  restoreBreakpoints(list: Breakpoint[]): Promise<void>;
  setBreakpointCondition(id: string, condition: string | null): Promise<void>;
  setBreakpointEnabled(id: string, enabled: boolean): Promise<void>;
  setBreakpointHitCondition(id: string, hitCondition: BreakpointHitCondition | null): Promise<void>;
  setBreakpointLogMessage(id: string, logMessage: string | null): Promise<void>;
  toggleBreakpoint(
    filePath: string,
    lineNumber: number,
  ): Promise<BreakpointCreationOwnership | null>;
}

/** Owns breakpoint storage mutations and exact single/compound adapter synchronization. */
export function useDebugBreakpointManagement({
  activeControlSessionId,
  activeSessionId,
  adapterKindForSession,
  breakpointsByRootRef,
  commitBreakpoints,
  createBreakpointId,
  currentRootRef,
  currentWorkspaceIdRef,
  exactLiveCompoundSessionIds,
  failClosedCompoundPolicy,
  gateway,
  isExactWorkspaceOwnerCurrent,
  isWorkspaceTrusted,
  mountedRef,
  pendingActiveStopsRef,
  pendingBreakpointBulkMutationsRef,
  pendingControlsRef,
  pendingRestartsRef,
  pendingStartKeysRef,
  setBreakpointBulkPendingByRoot,
}: UseDebugBreakpointManagementOptions): DebugBreakpointManagement {
  const breakpointSynchronizationRef = useRef(createDebugBreakpointSynchronization());
  const breakpointCreationOwnersRef = useRef(new Map<string, object>());
  const breakpointRelocationOwnersRef = useRef(new Map<string, object>());

  const isExactBreakpointSessionCurrent = useCallback(
    (
      rootPath: string,
      requestedWorkspaceId: string | null,
      sessionId: number,
      adapterKind: "node" | "php",
    ): boolean =>
      mountedRef.current &&
      isExactWorkspaceOwnerCurrent(rootPath, requestedWorkspaceId) &&
      trustedWorkspace(isWorkspaceTrusted) &&
      activeControlSessionId() === sessionId &&
      adapterKindForSession(rootPath, sessionId) === adapterKind,
    [
      activeControlSessionId,
      adapterKindForSession,
      isExactWorkspaceOwnerCurrent,
      isWorkspaceTrusted,
      mountedRef,
    ],
  );

  const setBreakpointsForExactOwner = useCallback(
    async (
      rootPath: string,
      selectedSessionId: number,
      filePath: string,
      breakpoints: readonly Breakpoint[],
    ): Promise<Breakpoint[]> => {
      const compoundSessionIds = exactLiveCompoundSessionIds(rootPath, selectedSessionId);
      if (compoundSessionIds === null) {
        return gateway.setBreakpoints(rootPath, selectedSessionId, filePath, breakpoints);
      }
      if (compoundSessionIds.length === 0) throw new Error(COMPOUND_POLICY_SYNC_ERROR);
      try {
        const results = await Promise.all(
          compoundSessionIds.map((sessionId) =>
            gateway.setBreakpoints(rootPath, sessionId, filePath, breakpoints),
          ),
        );
        const selectedIndex = compoundSessionIds.indexOf(selectedSessionId);
        if (selectedIndex < 0) throw new Error(COMPOUND_POLICY_SYNC_ERROR);
        return results[selectedIndex] ?? [];
      } catch {
        await failClosedCompoundPolicy(rootPath, selectedSessionId);
        throw new Error(COMPOUND_POLICY_SYNC_ERROR);
      }
    },
    [exactLiveCompoundSessionIds, failClosedCompoundPolicy, gateway],
  );

  const syncBreakpointsForFile = useCallback(
    async (rootPath: string, key: string, filePath: string, list: readonly Breakpoint[]) => {
      const requestedWorkspaceId = currentWorkspaceIdRef.current;
      const sessionId = activeControlSessionId();
      if (sessionId === null) return;
      const adapterKind = adapterKindForSession(rootPath, sessionId);
      if (!adapterKind || !isBreakpointPathSupported(rootPath, adapterKind, filePath)) return;
      if (!isExactBreakpointSessionCurrent(rootPath, requestedWorkspaceId, sessionId, adapterKind))
        return;
      const token = breakpointSynchronizationRef.current.begin(key, sessionId, filePath);
      const eligible = breakpointsForDebugSession(rootPath, adapterKind, list).filter(
        (breakpoint) => breakpoint.filePath === filePath,
      );
      let verified: Breakpoint[];
      try {
        verified = await setBreakpointsForExactOwner(rootPath, sessionId, filePath, eligible);
      } catch (error) {
        if (!breakpointSynchronizationRef.current.isLatest(token)) return;
        if (
          !isExactBreakpointSessionCurrent(rootPath, requestedWorkspaceId, sessionId, adapterKind)
        )
          return;
        throw error;
      }
      if (!breakpointSynchronizationRef.current.isLatest(token)) return;
      if (!isExactBreakpointSessionCurrent(rootPath, requestedWorkspaceId, sessionId, adapterKind))
        return;
      commitBreakpoints(
        key,
        applyVerification(breakpointsByRootRef.current[key] ?? [], filePath, verified),
      );
    },
    [
      activeControlSessionId,
      adapterKindForSession,
      breakpointsByRootRef,
      commitBreakpoints,
      currentWorkspaceIdRef,
      isExactBreakpointSessionCurrent,
      setBreakpointsForExactOwner,
    ],
  );

  const mutateBreakpoints = useCallback(
    async (
      filePathOf: (list: readonly Breakpoint[]) => string | null,
      mutate: (list: readonly Breakpoint[]) => Breakpoint[],
    ) => {
      const root = currentRootRef.current;
      if (!root) return;
      const key = normalizedWorkspaceRootKey(root);
      const current = breakpointsByRootRef.current[key] ?? [];
      const filePath = filePathOf(current);
      if (filePath === null) return;
      const next = mutate(current);
      commitBreakpoints(key, next);
      await syncBreakpointsForFile(root, key, filePath, next);
    },
    [breakpointsByRootRef, commitBreakpoints, currentRootRef, syncBreakpointsForFile],
  );

  const toggleBreakpoint = useCallback(
    async (filePath: string, lineNumber: number): Promise<BreakpointCreationOwnership | null> => {
      const root = currentRootRef.current;
      if (!root) return null;
      const key = normalizedWorkspaceRootKey(root);
      const current = breakpointsByRootRef.current[key] ?? [];
      const existing = current.find(
        (entry) =>
          entry.filePath === filePath &&
          entry.lineNumber === lineNumber &&
          entry.columnNumber === undefined,
      );
      if (existing) {
        breakpointCreationOwnersRef.current.delete(`${key}\0${existing.id}`);
        const next = removeBreakpointFromList(current, existing.id);
        commitBreakpoints(key, next);
        await syncBreakpointsForFile(root, key, filePath, next);
        return null;
      }
      let createdId: string | null = null;
      const next = toggleBreakpointInList(current, filePath, lineNumber, () => {
        let id = createBreakpointId();
        while (current.some((entry) => entry.id === id)) id = createBreakpointId();
        createdId = id;
        return id;
      });
      if (createdId === null || next === current || next.length === current.length) return null;
      const ownedId = createdId as string;
      const ownerToken = {};
      const ownerKey = `${key}\0${ownedId}`;
      breakpointCreationOwnersRef.current.set(ownerKey, ownerToken);
      commitBreakpoints(key, next);
      const rollback = async () => {
        if (breakpointCreationOwnersRef.current.get(ownerKey) !== ownerToken) return;
        breakpointCreationOwnersRef.current.delete(ownerKey);
        const owned = breakpointsByRootRef.current[key] ?? [];
        if (!owned.some((entry) => entry.id === ownedId)) return;
        const rolledBack = removeBreakpointFromList(owned, ownedId);
        commitBreakpoints(key, rolledBack);
        if (workspaceRootKeysEqual(root, currentRootRef.current)) {
          await syncBreakpointsForFile(root, key, filePath, rolledBack);
        }
      };
      try {
        await syncBreakpointsForFile(root, key, filePath, next);
      } catch (error) {
        await rollback();
        throw error;
      }
      return {
        breakpointId: ownedId,
        filePath,
        lineNumber,
        isCurrent: () =>
          breakpointCreationOwnersRef.current.get(ownerKey) === ownerToken &&
          (breakpointsByRootRef.current[key] ?? []).some((entry) => entry.id === ownedId),
        rollback,
      };
    },
    [
      breakpointsByRootRef,
      commitBreakpoints,
      createBreakpointId,
      currentRootRef,
      syncBreakpointsForFile,
    ],
  );

  const { addInlineBreakpoint, relocateBreakpoint } = useDebugInlineBreakpointMutations({
    breakpointCreationOwnersRef,
    breakpointRelocationOwnersRef,
    breakpointsByRootRef,
    commitBreakpoints,
    createBreakpointId,
    currentRootRef,
    currentWorkspaceIdRef,
    syncBreakpointsForFile,
  });

  const restoreBreakpoints = useCallback(
    async (list: Breakpoint[]) => {
      const root = currentRootRef.current;
      if (!root) return;
      const key = normalizedWorkspaceRootKey(root);
      for (const ownerKey of breakpointCreationOwnersRef.current.keys()) {
        if (ownerKey.startsWith(`${key}\0`)) breakpointCreationOwnersRef.current.delete(ownerKey);
      }
      const sanitized = sanitizeDebugBreakpoints(list);
      commitBreakpoints(key, sanitized);
      if (activeSessionId() === null) return;
      for (const filePath of new Set(sanitized.map((entry) => entry.filePath))) {
        await syncBreakpointsForFile(root, key, filePath, sanitized);
      }
    },
    [activeSessionId, commitBreakpoints, currentRootRef, syncBreakpointsForFile],
  );

  const filePathOfBreakpoint = useCallback(
    (id: string) => (list: readonly Breakpoint[]) =>
      list.find((entry) => entry.id === id)?.filePath ?? null,
    [],
  );
  const setBreakpointEnabled = useCallback(
    (id: string, enabled: boolean) =>
      mutateBreakpoints(filePathOfBreakpoint(id), (list) =>
        setBreakpointEnabledInList(list, id, enabled),
      ),
    [filePathOfBreakpoint, mutateBreakpoints],
  );
  const setBreakpointCondition = useCallback(
    (id: string, condition: string | null) =>
      mutateBreakpoints(filePathOfBreakpoint(id), (list) =>
        setBreakpointConditionInList(list, id, condition),
      ),
    [filePathOfBreakpoint, mutateBreakpoints],
  );
  const setBreakpointHitCondition = useCallback(
    (id: string, hitCondition: BreakpointHitCondition | null) =>
      mutateBreakpoints(filePathOfBreakpoint(id), (list) =>
        setBreakpointHitConditionInList(list, id, hitCondition),
      ),
    [filePathOfBreakpoint, mutateBreakpoints],
  );
  const setBreakpointLogMessage = useCallback(
    (id: string, logMessage: string | null) =>
      mutateBreakpoints(filePathOfBreakpoint(id), (list) =>
        setBreakpointLogMessageInList(list, id, logMessage),
      ),
    [filePathOfBreakpoint, mutateBreakpoints],
  );
  const removeBreakpoint = useCallback(
    (id: string) => {
      const root = currentRootRef.current;
      if (root)
        breakpointCreationOwnersRef.current.delete(`${normalizedWorkspaceRootKey(root)}\0${id}`);
      return mutateBreakpoints(filePathOfBreakpoint(id), (list) =>
        removeBreakpointFromList(list, id),
      );
    },
    [currentRootRef, filePathOfBreakpoint, mutateBreakpoints],
  );

  const mutateAllBreakpoints = useCallback(
    async (mutate: (list: readonly Breakpoint[]) => Breakpoint[], clearCreationOwners: boolean) => {
      const root = currentRootRef.current;
      if (!root) return;
      const key = normalizedWorkspaceRootKey(root);
      const pending = pendingBreakpointBulkMutationsRef.current.get(key);
      if (pending) return pending;
      if (
        pendingControlsRef.current.has(key) ||
        pendingStartKeysRef.current.has(key) ||
        pendingRestartsRef.current.has(key) ||
        pendingActiveStopsRef.current.has(key)
      )
        return;
      const current = breakpointsByRootRef.current[key] ?? [];
      const next = mutate(current);
      if (next === current) return;
      const requestedWorkspaceId = currentWorkspaceIdRef.current;
      const sessionId = activeControlSessionId();
      const adapterKind = sessionId === null ? null : adapterKindForSession(root, sessionId);
      const affectedFilePaths = [
        ...new Set([...current, ...next].map((breakpoint) => breakpoint.filePath)),
      ].filter(
        (filePath) =>
          adapterKind !== null && isBreakpointPathSupported(root, adapterKind, filePath),
      );
      commitBreakpoints(key, next);
      if (clearCreationOwners) {
        for (const ownerKey of breakpointCreationOwnersRef.current.keys()) {
          if (ownerKey.startsWith(`${key}\0`)) breakpointCreationOwnersRef.current.delete(ownerKey);
        }
      }
      if (sessionId === null || adapterKind === null || affectedFilePaths.length === 0) return;
      const requests = affectedFilePaths.map((filePath) => ({
        eligible: breakpointsForDebugSession(root, adapterKind, next).filter(
          (breakpoint) => breakpoint.filePath === filePath,
        ),
        filePath,
        token: breakpointSynchronizationRef.current.begin(key, sessionId, filePath),
      }));
      const operation = (async () => {
        let nextRequest = 0;
        let failed = false;
        const operationStillCurrent = () =>
          isExactBreakpointSessionCurrent(root, requestedWorkspaceId, sessionId, adapterKind);
        const worker = async () => {
          while (nextRequest < requests.length) {
            const request = requests[nextRequest];
            nextRequest += 1;
            if (!operationStillCurrent()) return;
            if (!breakpointSynchronizationRef.current.isLatest(request.token)) continue;
            try {
              const verified = await setBreakpointsForExactOwner(
                root,
                sessionId,
                request.filePath,
                request.eligible,
              );
              if (!operationStillCurrent()) return;
              if (!breakpointSynchronizationRef.current.isLatest(request.token)) continue;
              commitBreakpoints(
                key,
                applyVerification(
                  breakpointsByRootRef.current[key] ?? [],
                  request.filePath,
                  verified,
                ),
              );
            } catch {
              if (!operationStillCurrent()) return;
              if (!breakpointSynchronizationRef.current.isLatest(request.token)) continue;
              failed = true;
            }
          }
        };
        await Promise.all(
          Array.from(
            { length: Math.min(MAX_CONCURRENT_BREAKPOINT_BULK_SYNCS, requests.length) },
            () => worker(),
          ),
        );
        if (failed) throw new Error(BREAKPOINT_BULK_SYNC_ERROR);
      })();
      pendingBreakpointBulkMutationsRef.current.set(key, operation);
      setBreakpointBulkPendingByRoot((state) => ({ ...state, [key]: true }));
      try {
        await operation;
      } finally {
        if (pendingBreakpointBulkMutationsRef.current.get(key) === operation) {
          pendingBreakpointBulkMutationsRef.current.delete(key);
          if (mountedRef.current) {
            setBreakpointBulkPendingByRoot((state) => ({ ...state, [key]: false }));
          }
        }
      }
    },
    [
      activeControlSessionId,
      adapterKindForSession,
      breakpointsByRootRef,
      commitBreakpoints,
      currentRootRef,
      currentWorkspaceIdRef,
      isExactBreakpointSessionCurrent,
      mountedRef,
      pendingActiveStopsRef,
      pendingBreakpointBulkMutationsRef,
      pendingControlsRef,
      pendingRestartsRef,
      pendingStartKeysRef,
      setBreakpointBulkPendingByRoot,
      setBreakpointsForExactOwner,
    ],
  );

  const enableAllBreakpoints = useCallback(
    () => mutateAllBreakpoints((list) => setAllBreakpointsEnabled(list, true), false),
    [mutateAllBreakpoints],
  );
  const disableAllBreakpoints = useCallback(
    () => mutateAllBreakpoints((list) => setAllBreakpointsEnabled(list, false), false),
    [mutateAllBreakpoints],
  );
  const removeAllBreakpoints = useCallback(
    () => mutateAllBreakpoints(clearBreakpoints, true),
    [mutateAllBreakpoints],
  );

  return {
    addInlineBreakpoint,
    disableAllBreakpoints,
    enableAllBreakpoints,
    relocateBreakpoint,
    removeAllBreakpoints,
    removeBreakpoint,
    restoreBreakpoints,
    setBreakpointCondition,
    setBreakpointEnabled,
    setBreakpointHitCondition,
    setBreakpointLogMessage,
    toggleBreakpoint,
  };
}

function trustedWorkspace(check: () => boolean): boolean {
  try {
    return check();
  } catch {
    return false;
  }
}
