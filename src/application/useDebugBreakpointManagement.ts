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
import { normalizedWorkspaceRootKey } from "../domain/workspaceRootKey";
import {
  DebugBreakpointMutationQueue,
  debugBreakpointMutationQueueKey,
  type DebugBreakpointMutationOwner,
} from "./debugBreakpointMutationQueue";
import { createDebugBreakpointSynchronization } from "./debugBreakpointSynchronization";
import { useDebugInlineBreakpointMutations } from "./useDebugInlineBreakpointMutations";
import type {
  DebugBreakpointRelocationCandidate,
  DebugInlineBreakpointCandidate,
} from "./debugSessionContracts";

const MAX_CONCURRENT_BREAKPOINT_BULK_SYNCS = 4;
const BREAKPOINT_BULK_SYNC_ERROR = "Unable to synchronize all breakpoints.";
const BREAKPOINT_MUTATION_STALE_ERROR =
  "Breakpoint update was cancelled because the debug session changed.";
const BREAKPOINT_MUTATION_SYNC_ERROR = "Unable to synchronize the breakpoint.";
const COMPOUND_POLICY_SYNC_ERROR = "Unable to synchronize the active debug compound.";

interface PendingRegistry {
  has(key: string): boolean;
}

interface WorkspaceOwnerEpoch {
  readonly epoch: number;
}

interface UseDebugBreakpointManagementOptions {
  readonly activeControlSessionId: () => number | null;
  readonly activeSessionId: () => number | null;
  readonly adapterKindForSession: (rootPath: string, sessionId: number) => "node" | "php" | null;
  readonly breakpointsByRootRef: MutableRefObject<Record<string, Breakpoint[]>>;
  commitBreakpoints(key: string, list: Breakpoint[]): void;
  readonly createBreakpointId: () => string;
  readonly currentRootRef: MutableRefObject<string | null>;
  readonly currentWorkspaceEpochRef: MutableRefObject<WorkspaceOwnerEpoch>;
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
  currentWorkspaceEpochRef,
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
  const breakpointMutationQueueRef = useRef(new DebugBreakpointMutationQueue());
  const breakpointMutationGenerationsRef = useRef(new Map<string, number>());
  const breakpointMutationOwnersRef = useRef(new Map<string, object>());
  const breakpointCreationOwnersRef = useRef(new Map<string, object>());
  const breakpointRelocationOwnersRef = useRef(new Map<string, object>());

  const isExactBreakpointSessionCurrent = useCallback(
    (
      rootPath: string,
      requestedWorkspaceId: string | null,
      requestedWorkspaceEpoch: number,
      sessionId: number,
      adapterKind: "node" | "php",
    ): boolean =>
      mountedRef.current &&
      currentWorkspaceEpochRef.current.epoch === requestedWorkspaceEpoch &&
      isExactWorkspaceOwnerCurrent(rootPath, requestedWorkspaceId) &&
      trustedWorkspace(isWorkspaceTrusted) &&
      activeControlSessionId() === sessionId &&
      adapterKindForSession(rootPath, sessionId) === adapterKind,
    [
      activeControlSessionId,
      adapterKindForSession,
      currentWorkspaceEpochRef,
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
    async (
      rootPath: string,
      key: string,
      filePath: string,
      list: readonly Breakpoint[],
      expectedOwner?: DebugBreakpointMutationOwner,
    ) => {
      const requestedWorkspaceId = expectedOwner?.workspaceId ?? currentWorkspaceIdRef.current;
      const requestedWorkspaceEpoch =
        expectedOwner?.workspaceEpoch ?? currentWorkspaceEpochRef.current.epoch;
      const sessionId = expectedOwner ? expectedOwner.sessionId : activeControlSessionId();
      if (sessionId === null) return;
      const adapterKind = expectedOwner
        ? expectedOwner.adapterKind
        : adapterKindForSession(rootPath, sessionId);
      if (!adapterKind || !isBreakpointPathSupported(rootPath, adapterKind, filePath)) return;
      if (
        !isExactBreakpointSessionCurrent(
          rootPath,
          requestedWorkspaceId,
          requestedWorkspaceEpoch,
          sessionId,
          adapterKind,
        )
      ) {
        if (expectedOwner) throw new Error(BREAKPOINT_MUTATION_STALE_ERROR);
        return;
      }
      const token = breakpointSynchronizationRef.current.begin(key, sessionId, filePath);
      const eligible = breakpointsForDebugSession(rootPath, adapterKind, list).filter(
        (breakpoint) => breakpoint.filePath === filePath,
      );
      let verified: Breakpoint[];
      try {
        verified = await setBreakpointsForExactOwner(rootPath, sessionId, filePath, eligible);
      } catch (error) {
        if (!breakpointSynchronizationRef.current.isLatest(token)) {
          if (expectedOwner) throw new Error(BREAKPOINT_MUTATION_STALE_ERROR);
          return;
        }
        if (
          !isExactBreakpointSessionCurrent(
            rootPath,
            requestedWorkspaceId,
            requestedWorkspaceEpoch,
            sessionId,
            adapterKind,
          )
        ) {
          if (expectedOwner) throw new Error(BREAKPOINT_MUTATION_STALE_ERROR);
          return;
        }
        if (expectedOwner) throw new Error(BREAKPOINT_MUTATION_SYNC_ERROR);
        throw error;
      }
      if (!breakpointSynchronizationRef.current.isLatest(token)) {
        if (expectedOwner) throw new Error(BREAKPOINT_MUTATION_STALE_ERROR);
        return;
      }
      if (
        !isExactBreakpointSessionCurrent(
          rootPath,
          requestedWorkspaceId,
          requestedWorkspaceEpoch,
          sessionId,
          adapterKind,
        )
      ) {
        if (expectedOwner) throw new Error(BREAKPOINT_MUTATION_STALE_ERROR);
        return;
      }
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
      currentWorkspaceEpochRef,
      currentWorkspaceIdRef,
      isExactBreakpointSessionCurrent,
      setBreakpointsForExactOwner,
    ],
  );

  const captureBreakpointMutation = useCallback(
    (filePath: string): DebugBreakpointMutationOwner | null => {
      const rootPath = currentRootRef.current;
      if (!rootPath) return null;
      const key = normalizedWorkspaceRootKey(rootPath);
      const workspaceId = currentWorkspaceIdRef.current;
      const workspaceEpoch = currentWorkspaceEpochRef.current.epoch;
      const candidateSessionId = activeSessionId();
      const candidateAdapterKind =
        candidateSessionId === null ? null : adapterKindForSession(rootPath, candidateSessionId);
      const runtimeOwner =
        candidateSessionId !== null &&
        candidateAdapterKind !== null &&
        isBreakpointPathSupported(rootPath, candidateAdapterKind, filePath)
          ? { adapterKind: candidateAdapterKind, sessionId: candidateSessionId }
          : { adapterKind: null, sessionId: null };
      return {
        ...runtimeOwner,
        filePath,
        key,
        mutationGeneration: breakpointMutationGenerationsRef.current.get(key) ?? 0,
        observedSessionId: candidateSessionId,
        rootPath,
        workspaceEpoch,
        workspaceId,
      };
    },
    [
      activeSessionId,
      adapterKindForSession,
      currentRootRef,
      currentWorkspaceEpochRef,
      currentWorkspaceIdRef,
    ],
  );

  const mutationCaptureIsCurrent = useCallback(
    (capture: DebugBreakpointMutationOwner): boolean => {
      if (
        !mountedRef.current ||
        currentWorkspaceEpochRef.current.epoch !== capture.workspaceEpoch ||
        (breakpointMutationGenerationsRef.current.get(capture.key) ?? 0) !==
          capture.mutationGeneration ||
        !isExactWorkspaceOwnerCurrent(capture.rootPath, capture.workspaceId) ||
        activeSessionId() !== capture.observedSessionId ||
        pendingStartKeysRef.current.has(capture.key) ||
        pendingRestartsRef.current.has(capture.key) ||
        pendingActiveStopsRef.current.has(capture.key)
      ) {
        return false;
      }
      if (capture.sessionId === null || capture.adapterKind === null) return true;
      return isExactBreakpointSessionCurrent(
        capture.rootPath,
        capture.workspaceId,
        capture.workspaceEpoch,
        capture.sessionId,
        capture.adapterKind,
      );
    },
    [
      activeSessionId,
      currentWorkspaceEpochRef,
      isExactBreakpointSessionCurrent,
      isExactWorkspaceOwnerCurrent,
      mountedRef,
      pendingActiveStopsRef,
      pendingRestartsRef,
      pendingStartKeysRef,
    ],
  );

  const runQueuedBreakpointMutation = useCallback(
    <T>(capture: DebugBreakpointMutationOwner, operation: () => Promise<T>): Promise<T> =>
      breakpointMutationQueueRef.current.run(
        debugBreakpointMutationQueueKey(
          capture.key,
          capture.workspaceId,
          capture.workspaceEpoch,
          capture.filePath,
        ),
        async () => {
          if (!mutationCaptureIsCurrent(capture)) {
            throw new Error(BREAKPOINT_MUTATION_STALE_ERROR);
          }
          return operation();
        },
      ),
    [mutationCaptureIsCurrent],
  );

  const applyBreakpointMutation = useCallback(
    async (
      capture: DebugBreakpointMutationOwner,
      id: string,
      mutate: (list: readonly Breakpoint[]) => Breakpoint[],
    ) => {
      if (!mutationCaptureIsCurrent(capture)) {
        throw new Error(BREAKPOINT_MUTATION_STALE_ERROR);
      }
      const current = breakpointsByRootRef.current[capture.key] ?? [];
      const originalIndex = current.findIndex((entry) => entry.id === id);
      const original = originalIndex < 0 ? null : current[originalIndex];
      const next = mutate(current);
      if (next === current) return;
      const ownerKey = `${capture.key}\0${id}`;
      const ownerToken = {};
      breakpointMutationOwnersRef.current.set(ownerKey, ownerToken);
      commitBreakpoints(capture.key, next);
      try {
        await syncBreakpointsForFile(
          capture.rootPath,
          capture.key,
          capture.filePath,
          next,
          capture,
        );
        if (breakpointMutationOwnersRef.current.get(ownerKey) === ownerToken) {
          breakpointMutationOwnersRef.current.delete(ownerKey);
        }
      } catch (error) {
        if (breakpointMutationOwnersRef.current.get(ownerKey) === ownerToken) {
          breakpointMutationOwnersRef.current.delete(ownerKey);
          const owned = breakpointsByRootRef.current[capture.key] ?? [];
          const existingIndex = owned.findIndex((entry) => entry.id === id);
          let rolledBack: Breakpoint[];
          if (original === null) {
            rolledBack =
              existingIndex < 0 ? owned : owned.filter((_entry, index) => index !== existingIndex);
          } else if (existingIndex < 0) {
            const insertionIndex = Math.min(originalIndex, owned.length);
            rolledBack = [
              ...owned.slice(0, insertionIndex),
              original,
              ...owned.slice(insertionIndex),
            ];
          } else {
            rolledBack = owned.map((entry, index) => (index === existingIndex ? original : entry));
          }
          commitBreakpoints(capture.key, rolledBack);
        }
        throw error;
      }
    },
    [breakpointsByRootRef, commitBreakpoints, mutationCaptureIsCurrent, syncBreakpointsForFile],
  );

  const mutateBreakpoints = useCallback(
    async (id: string, mutate: (list: readonly Breakpoint[]) => Breakpoint[]) => {
      const root = currentRootRef.current;
      if (!root) return;
      const key = normalizedWorkspaceRootKey(root);
      const filePath = (breakpointsByRootRef.current[key] ?? []).find(
        (entry) => entry.id === id,
      )?.filePath;
      if (!filePath) return;
      const capture = captureBreakpointMutation(filePath);
      if (!capture) return;
      await runQueuedBreakpointMutation(capture, () =>
        applyBreakpointMutation(capture, id, mutate),
      );
    },
    [
      applyBreakpointMutation,
      breakpointsByRootRef,
      captureBreakpointMutation,
      currentRootRef,
      runQueuedBreakpointMutation,
    ],
  );

  const toggleBreakpoint = useCallback(
    async (filePath: string, lineNumber: number): Promise<BreakpointCreationOwnership | null> => {
      const capture = captureBreakpointMutation(filePath);
      if (!capture) return null;
      return runQueuedBreakpointMutation(capture, async () => {
        const current = breakpointsByRootRef.current[capture.key] ?? [];
        const existing = current.find(
          (entry) =>
            entry.filePath === filePath &&
            entry.lineNumber === lineNumber &&
            entry.columnNumber === undefined,
        );
        if (existing) {
          await applyBreakpointMutation(capture, existing.id, (list) =>
            removeBreakpointFromList(list, existing.id),
          );
          breakpointCreationOwnersRef.current.delete(`${capture.key}\0${existing.id}`);
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
        const ownerKey = `${capture.key}\0${ownedId}`;
        breakpointCreationOwnersRef.current.set(ownerKey, ownerToken);
        try {
          await applyBreakpointMutation(capture, ownedId, () => next);
        } catch (error) {
          if (breakpointCreationOwnersRef.current.get(ownerKey) === ownerToken) {
            breakpointCreationOwnersRef.current.delete(ownerKey);
          }
          throw error;
        }
        const rollback = async () => {
          if (breakpointCreationOwnersRef.current.get(ownerKey) !== ownerToken) return;
          const rollbackCapture = captureBreakpointMutation(filePath);
          if (!rollbackCapture) return;
          await runQueuedBreakpointMutation(rollbackCapture, async () => {
            if (breakpointCreationOwnersRef.current.get(ownerKey) !== ownerToken) return;
            await applyBreakpointMutation(rollbackCapture, ownedId, (list) =>
              removeBreakpointFromList(list, ownedId),
            );
            breakpointCreationOwnersRef.current.delete(ownerKey);
          });
        };
        return {
          breakpointId: ownedId,
          filePath,
          lineNumber,
          isCurrent: () =>
            breakpointCreationOwnersRef.current.get(ownerKey) === ownerToken &&
            (breakpointsByRootRef.current[capture.key] ?? []).some((entry) => entry.id === ownedId),
          rollback,
        };
      });
    },
    [
      applyBreakpointMutation,
      breakpointsByRootRef,
      captureBreakpointMutation,
      createBreakpointId,
      runQueuedBreakpointMutation,
    ],
  );

  const inlineBreakpointMutations = useDebugInlineBreakpointMutations({
    breakpointCreationOwnersRef,
    breakpointRelocationOwnersRef,
    breakpointsByRootRef,
    commitBreakpoints,
    createBreakpointId,
    currentRootRef,
    currentWorkspaceIdRef,
    syncBreakpointsForFile,
  });
  const addInlineBreakpoint = useCallback(
    async (
      candidate: DebugInlineBreakpointCandidate,
    ): Promise<BreakpointCreationOwnership | null> => {
      const capture = captureBreakpointMutation(candidate.filePath);
      if (!capture) return null;
      return runQueuedBreakpointMutation(capture, async () => {
        try {
          const ownership = await inlineBreakpointMutations.addInlineBreakpoint(candidate, capture);
          if (!ownership) return null;
          if (!mutationCaptureIsCurrent(capture) || !safeCaptureIsCurrent(candidate.isCurrent)) {
            await ownership.rollback();
            throw new Error(BREAKPOINT_MUTATION_STALE_ERROR);
          }
          return {
            ...ownership,
            rollback: async () => {
              if (!safeCaptureIsCurrent(ownership.isCurrent)) return;
              const rollbackCapture = captureBreakpointMutation(candidate.filePath);
              if (!rollbackCapture) return;
              await runQueuedBreakpointMutation(rollbackCapture, async () => {
                if (!safeCaptureIsCurrent(ownership.isCurrent)) return;
                await applyBreakpointMutation(rollbackCapture, ownership.breakpointId, (list) =>
                  removeBreakpointFromList(list, ownership.breakpointId),
                );
                await ownership.rollback();
              });
            },
          };
        } catch (error) {
          if (
            error instanceof Error &&
            (error.message === BREAKPOINT_MUTATION_STALE_ERROR ||
              error.message === BREAKPOINT_MUTATION_SYNC_ERROR)
          ) {
            throw error;
          }
          throw new Error(BREAKPOINT_MUTATION_SYNC_ERROR);
        }
      });
    },
    [
      captureBreakpointMutation,
      inlineBreakpointMutations,
      mutationCaptureIsCurrent,
      applyBreakpointMutation,
      runQueuedBreakpointMutation,
    ],
  );
  const relocateBreakpoint = useCallback(
    async (candidate: DebugBreakpointRelocationCandidate): Promise<boolean> => {
      const capture = captureBreakpointMutation(candidate.filePath);
      if (!capture) return false;
      return runQueuedBreakpointMutation(capture, async () => {
        try {
          const relocated = await inlineBreakpointMutations.relocateBreakpoint(candidate, capture);
          if (!relocated) return false;
          if (!mutationCaptureIsCurrent(capture) || !safeCaptureIsCurrent(candidate.isCurrent)) {
            throw new Error(BREAKPOINT_MUTATION_STALE_ERROR);
          }
          return true;
        } catch (error) {
          if (
            error instanceof Error &&
            (error.message === BREAKPOINT_MUTATION_STALE_ERROR ||
              error.message === BREAKPOINT_MUTATION_SYNC_ERROR)
          ) {
            throw error;
          }
          throw new Error(BREAKPOINT_MUTATION_SYNC_ERROR);
        }
      });
    },
    [
      captureBreakpointMutation,
      inlineBreakpointMutations,
      mutationCaptureIsCurrent,
      runQueuedBreakpointMutation,
    ],
  );

  const restoreBreakpoints = useCallback(
    async (list: Breakpoint[]) => {
      const root = currentRootRef.current;
      if (!root) return;
      const key = normalizedWorkspaceRootKey(root);
      breakpointMutationGenerationsRef.current.set(
        key,
        (breakpointMutationGenerationsRef.current.get(key) ?? 0) + 1,
      );
      for (const ownerKey of breakpointCreationOwnersRef.current.keys()) {
        if (ownerKey.startsWith(`${key}\0`)) breakpointCreationOwnersRef.current.delete(ownerKey);
      }
      for (const ownerKey of breakpointMutationOwnersRef.current.keys()) {
        if (ownerKey.startsWith(`${key}\0`)) breakpointMutationOwnersRef.current.delete(ownerKey);
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

  const setBreakpointEnabled = useCallback(
    (id: string, enabled: boolean) =>
      mutateBreakpoints(id, (list) => setBreakpointEnabledInList(list, id, enabled)),
    [mutateBreakpoints],
  );
  const setBreakpointCondition = useCallback(
    (id: string, condition: string | null) =>
      mutateBreakpoints(id, (list) => setBreakpointConditionInList(list, id, condition)),
    [mutateBreakpoints],
  );
  const setBreakpointHitCondition = useCallback(
    (id: string, hitCondition: BreakpointHitCondition | null) =>
      mutateBreakpoints(id, (list) => setBreakpointHitConditionInList(list, id, hitCondition)),
    [mutateBreakpoints],
  );
  const setBreakpointLogMessage = useCallback(
    (id: string, logMessage: string | null) =>
      mutateBreakpoints(id, (list) => setBreakpointLogMessageInList(list, id, logMessage)),
    [mutateBreakpoints],
  );
  const removeBreakpoint = useCallback(
    async (id: string) => {
      const root = currentRootRef.current;
      if (!root) return;
      const ownerKey = `${normalizedWorkspaceRootKey(root)}\0${id}`;
      await mutateBreakpoints(id, (list) => removeBreakpointFromList(list, id));
      breakpointCreationOwnersRef.current.delete(ownerKey);
    },
    [currentRootRef, mutateBreakpoints],
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
      const requestedWorkspaceEpoch = currentWorkspaceEpochRef.current.epoch;
      const sessionId = activeControlSessionId();
      const adapterKind = sessionId === null ? null : adapterKindForSession(root, sessionId);
      const affectedFilePaths = [
        ...new Set([...current, ...next].map((breakpoint) => breakpoint.filePath)),
      ].filter(
        (filePath) =>
          adapterKind !== null && isBreakpointPathSupported(root, adapterKind, filePath),
      );
      breakpointMutationGenerationsRef.current.set(
        key,
        (breakpointMutationGenerationsRef.current.get(key) ?? 0) + 1,
      );
      for (const ownerKey of breakpointMutationOwnersRef.current.keys()) {
        if (ownerKey.startsWith(`${key}\0`)) breakpointMutationOwnersRef.current.delete(ownerKey);
      }
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
          isExactBreakpointSessionCurrent(
            root,
            requestedWorkspaceId,
            requestedWorkspaceEpoch,
            sessionId,
            adapterKind,
          );
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
      currentWorkspaceEpochRef,
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

function safeCaptureIsCurrent(check: () => boolean): boolean {
  try {
    return check();
  } catch {
    return false;
  }
}
