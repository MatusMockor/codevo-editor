import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DebugEvent,
  DebugFunctionBreakpointInput,
  DebugGateway,
  FunctionBreakpoint,
} from "../domain/debug";
import {
  addFunctionBreakpoint,
  deserializeFunctionBreakpoints,
  MAX_FUNCTION_BREAKPOINTS,
  removeFunctionBreakpoint,
  serializeFunctionBreakpoints,
  setFunctionBreakpointEnabled,
} from "../domain/debugFunctionBreakpoints";
import { normalizedWorkspaceRootKey, workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import { MAX_PENDING_DEBUG_START_EVENTS } from "./debugStartDescriptor";

const STORAGE_KEY_PREFIX = "mockor.debug.functionBreakpoints.";
const MIGRATION_OWNER_KEY_PREFIX = "mockor.debug.functionBreakpointsMigrationOwner.";
const MAX_PERSISTED_FUNCTION_BREAKPOINT_CHARACTERS = 131_072;
const EMPTY_FUNCTION_BREAKPOINTS: readonly FunctionBreakpoint[] = Object.freeze([]);
const STARTUP_FUNCTION_BREAKPOINT_GENERATION = 1;

interface FunctionBreakpointStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

export interface ActiveFunctionBreakpointSession {
  readonly adapterKind: "node" | "php";
  readonly rootPath: string;
  readonly sessionId: number;
  readonly workspaceEpoch: number;
  readonly workspaceId: string | null;
}

interface UseDebugFunctionBreakpointManagementOptions {
  readonly canMutate?: () => boolean;
  readonly gateway: Pick<DebugGateway, "setFunctionBreakpoints">;
  readonly getActiveSession: () => ActiveFunctionBreakpointSession | null;
  readonly isSessionCurrent?: (session: ActiveFunctionBreakpointSession) => boolean;
  readonly isWorkspaceCurrent: (rootPath: string, workspaceId: string) => boolean;
  readonly isWorkspaceTrusted?: () => boolean;
  readonly rootPath: string | null;
  readonly storage?: FunctionBreakpointStorage;
  readonly subscribe?: DebugGateway["subscribe"];
  readonly workspaceEpoch: number;
  readonly workspaceId: string | null;
}

export interface DebugFunctionBreakpointManagement {
  readonly functionBreakpoints: readonly FunctionBreakpoint[];
  snapshotForStart(
    rootPath: string,
    workspaceId: string | null,
  ): readonly [breakpoints: readonly DebugFunctionBreakpointInput[], desiredRevision: number];
  add(functionName: string): Promise<boolean>;
  remove(id: string): Promise<boolean>;
  setEnabled(id: string, enabled: boolean): Promise<boolean>;
  synchronizeSession(
    rootPath: string,
    workspaceId: string | null,
    workspaceEpoch: number,
    sessionId: number,
    adapterKind: "node" | "php",
    startupDesiredRevision?: number,
    startupEvents?: readonly DebugEvent[],
    startedAtGenerationOne?: boolean,
  ): Promise<boolean>;
}

export function useDebugFunctionBreakpointManagement({
  canMutate = () => true,
  gateway,
  getActiveSession,
  isSessionCurrent,
  isWorkspaceCurrent,
  isWorkspaceTrusted = () => true,
  rootPath,
  storage,
  subscribe,
  workspaceEpoch,
  workspaceId,
}: UseDebugFunctionBreakpointManagementOptions): DebugFunctionBreakpointManagement {
  const [byRoot, setByRoot] = useState<Record<string, FunctionBreakpoint[]>>({});
  const byRootRef = useRef(byRoot);
  byRootRef.current = byRoot;
  const ownerRef = useRef({ rootPath, workspaceEpoch, workspaceId });
  ownerRef.current = { rootPath, workspaceEpoch, workspaceId };
  const mountedRef = useRef(true);
  const loadedRootsRef = useRef(new Set<string>());
  const nextIdRef = useRef(1);
  const storageRef = useRef(storage);
  storageRef.current = storage;
  const canMutateRef = useRef(canMutate);
  canMutateRef.current = canMutate;
  const synchronizationByRootRef = useRef(new Map<string, Promise<void>>());
  const verificationSessionByRootRef = useRef(
    new Map<
      string,
      {
        readonly sessionId: number;
        readonly workspaceEpoch: number;
        readonly workspaceId: string | null;
      }
    >(),
  );
  const lastEventSeqBySessionRef = useRef(new Map<string, number>());
  const desiredGenerationBySessionRef = useRef(new Map<string, number>());
  const startupReceiptAcceptedBySessionRef = useRef(new Map<string, boolean>());
  const nextDesiredGenerationRef = useRef(STARTUP_FUNCTION_BREAKPOINT_GENERATION);
  const desiredRevisionByRootRef = useRef(new Map<string, number>());

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!rootPath) return;
    const key = functionBreakpointOwnerKey(rootPath, workspaceId);
    if (loadedRootsRef.current.has(key)) return;
    loadedRootsRef.current.add(key);
    const persisted = load(storageRef.current, rootPath, workspaceId);
    if (persisted.length === 0) return;
    desiredRevisionByRootRef.current.set(key, 1);
    byRootRef.current = { ...byRootRef.current, [key]: persisted };
    setByRoot(byRootRef.current);
  }, [rootPath, workspaceId]);

  const ownerIsCurrent = useCallback(
    (
      requestedRoot: string,
      requestedWorkspaceId: string | null,
      requestedWorkspaceEpoch: number,
    ): boolean => {
      if (
        !mountedRef.current ||
        !workspaceRootKeysEqual(ownerRef.current.rootPath, requestedRoot) ||
        ownerRef.current.workspaceId !== requestedWorkspaceId ||
        ownerRef.current.workspaceEpoch !== requestedWorkspaceEpoch
      ) {
        return false;
      }
      if (!trusted(isWorkspaceTrusted)) return false;
      return (
        requestedWorkspaceId === null || isWorkspaceCurrent(requestedRoot, requestedWorkspaceId)
      );
    },
    [isWorkspaceCurrent, isWorkspaceTrusted],
  );

  const exactSessionIsCurrent = useCallback(
    (requested: ActiveFunctionBreakpointSession): boolean => {
      if (!ownerIsCurrent(requested.rootPath, requested.workspaceId, requested.workspaceEpoch)) {
        return false;
      }
      if (isSessionCurrent) return isSessionCurrent(requested);
      const current = getActiveSession();
      return (
        current !== null &&
        current.adapterKind === requested.adapterKind &&
        current.sessionId === requested.sessionId &&
        current.workspaceEpoch === requested.workspaceEpoch &&
        current.workspaceId === requested.workspaceId &&
        workspaceRootKeysEqual(current.rootPath, requested.rootPath)
      );
    },
    [getActiveSession, isSessionCurrent, ownerIsCurrent],
  );

  const applyVerification = useCallback(
    (
      requestedRoot: string,
      requestedWorkspaceId: string | null,
      requestedWorkspaceEpoch: number,
      verification: readonly { readonly id: string; readonly verified: boolean }[],
    ): boolean => {
      if (!ownerIsCurrent(requestedRoot, requestedWorkspaceId, requestedWorkspaceEpoch)) {
        return false;
      }
      const key = functionBreakpointOwnerKey(requestedRoot, requestedWorkspaceId);
      const current = byRootRef.current[key] ?? EMPTY_FUNCTION_BREAKPOINTS;
      const byId = new Map(verification.map((entry) => [entry.id, entry.verified]));
      const next = current.map((entry) =>
        byId.has(entry.id) ? { ...entry, verified: byId.get(entry.id) } : entry,
      );
      byRootRef.current = { ...byRootRef.current, [key]: next };
      setByRoot(byRootRef.current);
      return true;
    },
    [ownerIsCurrent],
  );

  useEffect(() => {
    if (!subscribe) return;
    return subscribe((event) => {
      if (typeof event?.payload?.kind !== "string") return;
      if (
        event.payload.kind !== "functionBreakpointsVerified" &&
        event.payload.kind !== "terminated"
      ) {
        return;
      }
      const rootKey = normalizedWorkspaceRootKey(event.rootPath);
      const verificationOwner = verificationSessionByRootRef.current.get(rootKey);
      if (!verificationOwner || verificationOwner.sessionId !== event.sessionId) return;
      const eventKey = `${rootKey}:${event.sessionId}:${verificationOwner.workspaceEpoch}`;
      if (event.payload.kind === "terminated") {
        if (
          !ownerIsCurrent(
            event.rootPath,
            verificationOwner.workspaceId,
            verificationOwner.workspaceEpoch,
          )
        ) {
          return;
        }
        const lastSeq = lastEventSeqBySessionRef.current.get(eventKey) ?? 0;
        if (event.seq <= lastSeq) return;
        verificationSessionByRootRef.current.delete(rootKey);
        lastEventSeqBySessionRef.current.delete(eventKey);
        desiredGenerationBySessionRef.current.delete(eventKey);
        startupReceiptAcceptedBySessionRef.current.delete(eventKey);
        applyVerification(
          event.rootPath,
          verificationOwner.workspaceId,
          verificationOwner.workspaceEpoch,
          (
            byRootRef.current[
              functionBreakpointOwnerKey(event.rootPath, verificationOwner.workspaceId)
            ] ?? EMPTY_FUNCTION_BREAKPOINTS
          ).map(({ id }) => ({
            id,
            verified: false,
          })),
        );
        return;
      }
      const current = getActiveSession();
      if (
        current === null ||
        current.adapterKind !== "node" ||
        current.sessionId !== event.sessionId ||
        current.workspaceEpoch !== verificationOwner.workspaceEpoch ||
        current.workspaceId !== verificationOwner.workspaceId ||
        !workspaceRootKeysEqual(current.rootPath, event.rootPath) ||
        !exactSessionIsCurrent(current)
      ) {
        return;
      }
      const lastSeq = lastEventSeqBySessionRef.current.get(eventKey) ?? 0;
      if (event.seq <= lastSeq) return;
      if (desiredGenerationBySessionRef.current.get(eventKey) !== event.payload.generation) return;
      if (
        event.payload.generation === STARTUP_FUNCTION_BREAKPOINT_GENERATION &&
        startupReceiptAcceptedBySessionRef.current.get(eventKey) === false
      ) {
        return;
      }
      lastEventSeqBySessionRef.current.set(eventKey, event.seq);
      verificationSessionByRootRef.current.set(rootKey, {
        sessionId: event.sessionId,
        workspaceEpoch: current.workspaceEpoch,
        workspaceId: current.workspaceId,
      });
      applyVerification(
        current.rootPath,
        current.workspaceId,
        current.workspaceEpoch,
        event.payload.breakpoints,
      );
    });
  }, [applyVerification, exactSessionIsCurrent, getActiveSession, ownerIsCurrent, subscribe]);

  const synchronize = useCallback(
    async (
      requested: ActiveFunctionBreakpointSession,
      list: readonly FunctionBreakpoint[],
    ): Promise<boolean> => {
      if (
        requested.adapterKind !== "node" ||
        !allowed(canMutateRef.current) ||
        !exactSessionIsCurrent(requested)
      ) {
        return false;
      }
      const replace = gateway.setFunctionBreakpoints;
      if (!replace) return false;
      const key = functionBreakpointOwnerKey(requested.rootPath, requested.workspaceId);
      const synchronizationKey = `${key}\0${requested.workspaceEpoch}`;
      const previous = synchronizationByRootRef.current.get(synchronizationKey);
      const send = async () => {
        if (!exactSessionIsCurrent(requested)) return false;
        verificationSessionByRootRef.current.set(normalizedWorkspaceRootKey(requested.rootPath), {
          sessionId: requested.sessionId,
          workspaceEpoch: requested.workspaceEpoch,
          workspaceId: requested.workspaceId,
        });
        const eventKey = `${normalizedWorkspaceRootKey(requested.rootPath)}:${requested.sessionId}:${requested.workspaceEpoch}`;
        const generation = nextDesiredGenerationRef.current;
        if (!Number.isSafeInteger(generation) || generation <= 0) return false;
        nextDesiredGenerationRef.current = generation + 1;
        desiredGenerationBySessionRef.current.set(eventKey, generation);
        startupReceiptAcceptedBySessionRef.current.delete(eventKey);
        const eventSeqAtStart = lastEventSeqBySessionRef.current.get(eventKey) ?? 0;
        applyVerification(
          requested.rootPath,
          requested.workspaceId,
          requested.workspaceEpoch,
          list.map(({ id }) => ({ id, verified: false })),
        );
        try {
          const verification = await replace({
            rootPath: requested.rootPath,
            sessionId: requested.sessionId,
            generation,
            breakpoints: list.map(({ enabled, functionName, id }) => ({
              enabled,
              functionName,
              id,
            })),
          });
          if (!exactSessionIsCurrent(requested)) return false;
          if (
            desiredGenerationBySessionRef.current.get(eventKey) !== generation ||
            (lastEventSeqBySessionRef.current.get(eventKey) ?? 0) > eventSeqAtStart
          ) {
            return true;
          }
          applyVerification(
            requested.rootPath,
            requested.workspaceId,
            requested.workspaceEpoch,
            verification,
          );
          return true;
        } catch {
          return false;
        }
      };
      const operation = previous ? previous.then(send) : send();
      const settled = operation.then(
        () => undefined,
        () => undefined,
      );
      synchronizationByRootRef.current.set(synchronizationKey, settled);
      try {
        return await operation;
      } finally {
        if (synchronizationByRootRef.current.get(synchronizationKey) === settled) {
          synchronizationByRootRef.current.delete(synchronizationKey);
        }
      }
    },
    [applyVerification, exactSessionIsCurrent, gateway],
  );

  const commit = useCallback(
    (
      requestedRoot: string,
      requestedWorkspaceId: string | null,
      list: FunctionBreakpoint[],
    ): boolean => {
      const key = functionBreakpointOwnerKey(requestedRoot, requestedWorkspaceId);
      const currentRevision = desiredRevisionByRootRef.current.get(key) ?? 0;
      const nextRevision = currentRevision + 1;
      if (!Number.isSafeInteger(nextRevision)) return false;
      desiredRevisionByRootRef.current.set(key, nextRevision);
      byRootRef.current = { ...byRootRef.current, [key]: list };
      setByRoot(byRootRef.current);
      save(storageRef.current, requestedRoot, requestedWorkspaceId, list);
      return true;
    },
    [],
  );

  const mutate = useCallback(
    async (
      operation: (list: readonly FunctionBreakpoint[]) => FunctionBreakpoint[],
    ): Promise<boolean> => {
      const requestedRoot = ownerRef.current.rootPath;
      const requestedWorkspaceId = ownerRef.current.workspaceId;
      const requestedWorkspaceEpoch = ownerRef.current.workspaceEpoch;
      if (
        !requestedRoot ||
        !allowed(canMutateRef.current) ||
        !ownerIsCurrent(requestedRoot, requestedWorkspaceId, requestedWorkspaceEpoch)
      ) {
        return false;
      }
      const key = functionBreakpointOwnerKey(requestedRoot, requestedWorkspaceId);
      const current = byRootRef.current[key] ?? EMPTY_FUNCTION_BREAKPOINTS;
      const next = operation(current);
      if (next === current) return false;
      if (!commit(requestedRoot, requestedWorkspaceId, next)) return false;
      const session = getActiveSession();
      if (
        session === null ||
        session.adapterKind !== "node" ||
        session.workspaceId !== requestedWorkspaceId ||
        !workspaceRootKeysEqual(session.rootPath, requestedRoot)
      ) {
        return ownerIsCurrent(requestedRoot, requestedWorkspaceId, requestedWorkspaceEpoch);
      }
      return synchronize(session, next);
    },
    [commit, getActiveSession, ownerIsCurrent, synchronize],
  );

  const add = useCallback(
    (functionName: string) =>
      mutate((list) =>
        addFunctionBreakpoint(list, functionName, () => createFunctionBreakpointId(nextIdRef)),
      ),
    [mutate],
  );
  const remove = useCallback(
    (id: string) => mutate((list) => removeFunctionBreakpoint(list, id)),
    [mutate],
  );
  const setEnabled = useCallback(
    (id: string, enabled: boolean) =>
      mutate((list) => setFunctionBreakpointEnabled(list, id, enabled)),
    [mutate],
  );
  const synchronizeSession = useCallback(
    (
      requestedRoot: string,
      requestedWorkspaceId: string | null,
      requestedWorkspaceEpoch: number,
      sessionId: number,
      adapterKind: "node" | "php",
      startupDesiredRevision?: number,
      startupEvents?: readonly DebugEvent[],
      startedAtGenerationOne = false,
    ) => {
      if (adapterKind === "php") return Promise.resolve(true);
      const requested = {
        adapterKind,
        rootPath: requestedRoot,
        sessionId,
        workspaceEpoch: requestedWorkspaceEpoch,
        workspaceId: requestedWorkspaceId,
      } as const;
      const ownerKey = functionBreakpointOwnerKey(requestedRoot, requestedWorkspaceId);
      const list = byRootRef.current[ownerKey] ?? EMPTY_FUNCTION_BREAKPOINTS;
      if (startedAtGenerationOne && adapterKind === "node") {
        nextDesiredGenerationRef.current = Math.max(
          nextDesiredGenerationRef.current,
          STARTUP_FUNCTION_BREAKPOINT_GENERATION + 1,
        );
      }
      if (
        startupDesiredRevision !== undefined &&
        (desiredRevisionByRootRef.current.get(ownerKey) ?? 0) === startupDesiredRevision &&
        adapterKind === "node" &&
        allowed(canMutateRef.current) &&
        exactSessionIsCurrent(requested)
      ) {
        const rootKey = normalizedWorkspaceRootKey(requestedRoot);
        const eventKey = `${rootKey}:${sessionId}:${requestedWorkspaceEpoch}`;
        verificationSessionByRootRef.current.set(rootKey, {
          sessionId,
          workspaceEpoch: requestedWorkspaceEpoch,
          workspaceId: requestedWorkspaceId,
        });
        desiredGenerationBySessionRef.current.set(eventKey, STARTUP_FUNCTION_BREAKPOINT_GENERATION);
        const receipt = replayStartupVerification(startupEvents, requestedRoot, sessionId, list);
        lastEventSeqBySessionRef.current.set(eventKey, receipt.lastSeq);
        startupReceiptAcceptedBySessionRef.current.set(eventKey, receipt.accepted);
        applyVerification(
          requestedRoot,
          requestedWorkspaceId,
          requestedWorkspaceEpoch,
          receipt.verification ?? list.map(({ id }) => ({ id, verified: false })),
        );
        return Promise.resolve(true);
      }
      return synchronize(requested, list);
    },
    [applyVerification, exactSessionIsCurrent, synchronize],
  );

  const activeKey = rootPath ? functionBreakpointOwnerKey(rootPath, workspaceId) : "";
  return {
    functionBreakpoints: byRoot[activeKey] ?? EMPTY_FUNCTION_BREAKPOINTS,
    snapshotForStart: (requestedRootPath, requestedWorkspaceId) => {
      const key = functionBreakpointOwnerKey(requestedRootPath, requestedWorkspaceId);
      return [
        (
          byRootRef.current[functionBreakpointOwnerKey(requestedRootPath, requestedWorkspaceId)] ??
          EMPTY_FUNCTION_BREAKPOINTS
        ).map(({ enabled, functionName, id }) => ({ enabled, functionName, id })),
        desiredRevisionByRootRef.current.get(key) ?? 0,
      ];
    },
    add,
    remove,
    setEnabled,
    synchronizeSession,
  };
}

function replayStartupVerification(
  events: readonly DebugEvent[] | undefined,
  rootPath: string,
  sessionId: number,
  desired: readonly FunctionBreakpoint[],
): {
  readonly accepted: boolean;
  readonly lastSeq: number;
  readonly verification: readonly { readonly id: string; readonly verified: boolean }[] | null;
} {
  if (!events || events.length > MAX_PENDING_DEBUG_START_EVENTS) {
    return { accepted: false, lastSeq: 0, verification: null };
  }
  const ordered = [...events].sort((left, right) => left.seq - right.seq);
  let lastSeq = 0;
  let verification: readonly { readonly id: string; readonly verified: boolean }[] | null = null;
  const desiredIds = new Set(desired.map(({ id }) => id));
  for (const event of ordered) {
    if (event.sessionId !== sessionId || !workspaceRootKeysEqual(event.rootPath, rootPath)) {
      continue;
    }
    if (!Number.isSafeInteger(event.seq) || event.seq <= lastSeq) {
      return { accepted: false, lastSeq, verification: null };
    }
    lastSeq = event.seq;
    if (
      event.payload.kind !== "functionBreakpointsVerified" ||
      event.payload.generation !== STARTUP_FUNCTION_BREAKPOINT_GENERATION
    ) {
      continue;
    }
    const entries = event.payload.breakpoints;
    if (verification === null) {
      if (
        entries.length !== desired.length ||
        entries.some(({ id }, index) => id !== desired[index]?.id)
      ) {
        return { accepted: false, lastSeq, verification: null };
      }
      verification = entries;
      continue;
    }
    const observed = new Set<string>();
    if (
      entries.some(({ id }) => {
        if (!desiredIds.has(id) || observed.has(id)) return true;
        observed.add(id);
        return false;
      })
    ) {
      return { accepted: false, lastSeq, verification: null };
    }
    const updates = new Map(entries.map(({ id, verified }) => [id, verified]));
    verification = verification.map((entry) =>
      updates.has(entry.id) ? { ...entry, verified: updates.get(entry.id) ?? false } : entry,
    );
  }
  return {
    accepted: verification !== null,
    lastSeq,
    verification,
  };
}

function storageKey(rootKey: string): string {
  return `${STORAGE_KEY_PREFIX}${rootKey}`;
}

function functionBreakpointOwnerKey(rootPath: string, workspaceId: string | null): string {
  return JSON.stringify([normalizedWorkspaceRootKey(rootPath), workspaceId]);
}

function load(
  storage: FunctionBreakpointStorage | undefined,
  rootPath: string,
  workspaceId: string | null,
): FunctionBreakpoint[] {
  try {
    const target = storage ?? window.localStorage;
    const ownerKey = functionBreakpointOwnerKey(rootPath, workspaceId);
    const scopedKey = storageKey(ownerKey);
    const scopedRaw = target.getItem(scopedKey);
    if (scopedRaw !== null) {
      const scoped = deserializePersistedFunctionBreakpoints(scopedRaw);
      if (workspaceId !== null) {
        if (scoped === null) {
          claimValidLegacyFunctionBreakpoints(target, rootPath, workspaceId);
        } else {
          retireLegacyFunctionBreakpoints(target, rootPath, workspaceId);
        }
      }
      return scoped ?? [];
    }
    if (workspaceId === null) return [];

    return loadClaimedLegacyFunctionBreakpoints(target, rootPath, workspaceId);
  } catch {
    return [];
  }
}

function loadClaimedLegacyFunctionBreakpoints(
  storage: FunctionBreakpointStorage,
  rootPath: string,
  workspaceId: string,
): FunctionBreakpoint[] {
  const rootKey = normalizedWorkspaceRootKey(rootPath);
  const legacyKey = storageKey(rootKey);
  const legacyRaw = storage.getItem(legacyKey);
  if (legacyRaw === null) return [];
  const legacy = deserializePersistedFunctionBreakpoints(legacyRaw);
  if (legacy === null) return [];

  const claimKey = `${MIGRATION_OWNER_KEY_PREFIX}${rootKey}`;
  const expectedClaim = claimLegacyFunctionBreakpoints(storage, claimKey, workspaceId);
  if (expectedClaim === null) return [];
  return storage.getItem(legacyKey) === legacyRaw ? legacy : [];
}

function claimValidLegacyFunctionBreakpoints(
  storage: FunctionBreakpointStorage,
  rootPath: string,
  workspaceId: string,
): void {
  try {
    const rootKey = normalizedWorkspaceRootKey(rootPath);
    const legacyRaw = storage.getItem(storageKey(rootKey));
    if (legacyRaw === null || deserializePersistedFunctionBreakpoints(legacyRaw) === null) {
      return;
    }
    claimLegacyFunctionBreakpoints(storage, `${MIGRATION_OWNER_KEY_PREFIX}${rootKey}`, workspaceId);
  } catch {
    return;
  }
}

function retireLegacyFunctionBreakpoints(
  storage: FunctionBreakpointStorage,
  rootPath: string,
  workspaceId: string | null,
): void {
  try {
    const rootKey = normalizedWorkspaceRootKey(rootPath);
    const legacyKey = storageKey(rootKey);
    if (storage.getItem(legacyKey) === null) return;
    const claimKey = `${MIGRATION_OWNER_KEY_PREFIX}${rootKey}`;
    const expectedClaim = claimLegacyFunctionBreakpoints(storage, claimKey, workspaceId);
    if (expectedClaim === null) return;
    tryRemoveStorageItem(storage, legacyKey);
    if (storage.getItem(legacyKey) === null && storage.getItem(claimKey) === expectedClaim) {
      tryRemoveStorageItem(storage, claimKey);
    }
  } catch {
    return;
  }
}

function claimLegacyFunctionBreakpoints(
  storage: FunctionBreakpointStorage,
  claimKey: string,
  workspaceId: string | null,
): string | null {
  const expectedClaim = JSON.stringify(workspaceId);
  const currentClaim = storage.getItem(claimKey);
  if (currentClaim !== null) return currentClaim === expectedClaim ? expectedClaim : null;
  storage.setItem(claimKey, expectedClaim);
  return storage.getItem(claimKey) === expectedClaim ? expectedClaim : null;
}

function tryRemoveStorageItem(storage: FunctionBreakpointStorage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    return;
  }
}

function deserializePersistedFunctionBreakpoints(raw: string): FunctionBreakpoint[] | null {
  if (raw.length > MAX_PERSISTED_FUNCTION_BREAKPOINT_CHARACTERS) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_FUNCTION_BREAKPOINTS) return null;
  const breakpoints = deserializeFunctionBreakpoints(raw);
  return breakpoints.length === parsed.length ? breakpoints : null;
}

function save(
  storage: FunctionBreakpointStorage | undefined,
  rootPath: string,
  workspaceId: string | null,
  breakpoints: readonly FunctionBreakpoint[],
): void {
  try {
    const target = storage ?? window.localStorage;
    const rootKey = functionBreakpointOwnerKey(rootPath, workspaceId);
    if (breakpoints.length === 0) {
      target.removeItem(storageKey(rootKey));
    } else {
      target.setItem(
        storageKey(rootKey),
        serializeFunctionBreakpoints(
          breakpoints.map(({ enabled, functionName, id }) => ({ enabled, functionName, id })),
        ),
      );
    }
    if (workspaceId !== null) retireLegacyFunctionBreakpoints(target, rootPath, workspaceId);
  } catch {
    return;
  }
}

function trusted(isWorkspaceTrusted: () => boolean): boolean {
  try {
    return isWorkspaceTrusted();
  } catch {
    return false;
  }
}

function allowed(canMutate: () => boolean): boolean {
  try {
    return canMutate();
  } catch {
    return false;
  }
}

function createFunctionBreakpointId(nextIdRef: { current: number }): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) return `fn-${randomId}`;
  return `fn-${Date.now()}-${nextIdRef.current++}`;
}
