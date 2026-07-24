import { useCallback, useEffect, useRef, useState } from "react";
import type { DebugGateway, FunctionBreakpoint } from "../domain/debug";
import {
  addFunctionBreakpoint,
  deserializeFunctionBreakpoints,
  removeFunctionBreakpoint,
  serializeFunctionBreakpoints,
  setFunctionBreakpointEnabled,
} from "../domain/debugFunctionBreakpoints";
import { normalizedWorkspaceRootKey, workspaceRootKeysEqual } from "../domain/workspaceRootKey";

const STORAGE_KEY_PREFIX = "mockor.debug.functionBreakpoints.";
const EMPTY_FUNCTION_BREAKPOINTS: readonly FunctionBreakpoint[] = Object.freeze([]);

interface FunctionBreakpointStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

interface ActiveFunctionBreakpointSession {
  readonly adapterKind: "node" | "php";
  readonly rootPath: string;
  readonly sessionId: number;
  readonly workspaceId: string | null;
}

interface UseDebugFunctionBreakpointManagementOptions {
  readonly gateway: Pick<DebugGateway, "setFunctionBreakpoints">;
  readonly getActiveSession: () => ActiveFunctionBreakpointSession | null;
  readonly isWorkspaceCurrent: (rootPath: string, workspaceId: string) => boolean;
  readonly isWorkspaceTrusted?: () => boolean;
  readonly rootPath: string | null;
  readonly storage?: FunctionBreakpointStorage;
  readonly workspaceId: string | null;
}

export interface DebugFunctionBreakpointManagement {
  readonly functionBreakpoints: readonly FunctionBreakpoint[];
  add(functionName: string): Promise<boolean>;
  remove(id: string): Promise<boolean>;
  setEnabled(id: string, enabled: boolean): Promise<boolean>;
  synchronizeSession(
    rootPath: string,
    workspaceId: string | null,
    sessionId: number,
    adapterKind: "node" | "php",
  ): Promise<boolean>;
}

export function useDebugFunctionBreakpointManagement({
  gateway,
  getActiveSession,
  isWorkspaceCurrent,
  isWorkspaceTrusted = () => true,
  rootPath,
  storage,
  workspaceId,
}: UseDebugFunctionBreakpointManagementOptions): DebugFunctionBreakpointManagement {
  const [byRoot, setByRoot] = useState<Record<string, FunctionBreakpoint[]>>({});
  const byRootRef = useRef(byRoot);
  byRootRef.current = byRoot;
  const ownerRef = useRef({ rootPath, workspaceId });
  ownerRef.current = { rootPath, workspaceId };
  const mountedRef = useRef(true);
  const loadedRootsRef = useRef(new Set<string>());
  const nextIdRef = useRef(1);
  const storageRef = useRef(storage);
  storageRef.current = storage;
  const synchronizationByRootRef = useRef(new Map<string, Promise<void>>());

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  useEffect(() => {
    if (!rootPath) return;
    const key = normalizedWorkspaceRootKey(rootPath);
    if (loadedRootsRef.current.has(key)) return;
    loadedRootsRef.current.add(key);
    const persisted = load(storageRef.current, key);
    if (persisted.length === 0) return;
    byRootRef.current = { ...byRootRef.current, [key]: persisted };
    setByRoot(byRootRef.current);
  }, [rootPath]);

  const ownerIsCurrent = useCallback(
    (requestedRoot: string, requestedWorkspaceId: string | null): boolean => {
      if (
        !mountedRef.current ||
        !workspaceRootKeysEqual(ownerRef.current.rootPath, requestedRoot) ||
        ownerRef.current.workspaceId !== requestedWorkspaceId
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
      if (!ownerIsCurrent(requested.rootPath, requested.workspaceId)) return false;
      const current = getActiveSession();
      return (
        current !== null &&
        current.adapterKind === requested.adapterKind &&
        current.sessionId === requested.sessionId &&
        current.workspaceId === requested.workspaceId &&
        workspaceRootKeysEqual(current.rootPath, requested.rootPath)
      );
    },
    [getActiveSession, ownerIsCurrent],
  );

  const synchronize = useCallback(
    async (
      requested: ActiveFunctionBreakpointSession,
      list: readonly FunctionBreakpoint[],
    ): Promise<boolean> => {
      if (requested.adapterKind !== "node" || !exactSessionIsCurrent(requested)) return false;
      const replace = gateway.setFunctionBreakpoints;
      if (!replace) return false;
      const key = normalizedWorkspaceRootKey(requested.rootPath);
      const previous = synchronizationByRootRef.current.get(key);
      const send = async () => {
        if (!exactSessionIsCurrent(requested)) return false;
        try {
          await replace({
            rootPath: requested.rootPath,
            sessionId: requested.sessionId,
            breakpoints: list,
          });
          return exactSessionIsCurrent(requested);
        } catch {
          return false;
        }
      };
      const operation = previous ? previous.then(send) : send();
      const settled = operation.then(
        () => undefined,
        () => undefined,
      );
      synchronizationByRootRef.current.set(key, settled);
      try {
        return await operation;
      } finally {
        if (synchronizationByRootRef.current.get(key) === settled) {
          synchronizationByRootRef.current.delete(key);
        }
      }
    },
    [exactSessionIsCurrent, gateway],
  );

  const commit = useCallback((requestedRoot: string, list: FunctionBreakpoint[]) => {
    const key = normalizedWorkspaceRootKey(requestedRoot);
    byRootRef.current = { ...byRootRef.current, [key]: list };
    setByRoot(byRootRef.current);
    save(storageRef.current, key, list);
  }, []);

  const mutate = useCallback(
    async (
      operation: (list: readonly FunctionBreakpoint[]) => FunctionBreakpoint[],
    ): Promise<boolean> => {
      const requestedRoot = ownerRef.current.rootPath;
      const requestedWorkspaceId = ownerRef.current.workspaceId;
      if (!requestedRoot || !ownerIsCurrent(requestedRoot, requestedWorkspaceId)) return false;
      const key = normalizedWorkspaceRootKey(requestedRoot);
      const current = byRootRef.current[key] ?? EMPTY_FUNCTION_BREAKPOINTS;
      const next = operation(current);
      if (next === current) return false;
      commit(requestedRoot, next);
      const session = getActiveSession();
      if (
        session === null ||
        session.adapterKind !== "node" ||
        session.workspaceId !== requestedWorkspaceId ||
        !workspaceRootKeysEqual(session.rootPath, requestedRoot)
      ) {
        return ownerIsCurrent(requestedRoot, requestedWorkspaceId);
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
      sessionId: number,
      adapterKind: "node" | "php",
    ) =>
      synchronize(
        {
          adapterKind,
          rootPath: requestedRoot,
          sessionId,
          workspaceId: requestedWorkspaceId,
        },
        byRootRef.current[normalizedWorkspaceRootKey(requestedRoot)] ?? EMPTY_FUNCTION_BREAKPOINTS,
      ),
    [synchronize],
  );

  const activeKey = rootPath ? normalizedWorkspaceRootKey(rootPath) : "";
  return {
    functionBreakpoints: byRoot[activeKey] ?? EMPTY_FUNCTION_BREAKPOINTS,
    add,
    remove,
    setEnabled,
    synchronizeSession,
  };
}

function storageKey(rootKey: string): string {
  return `${STORAGE_KEY_PREFIX}${rootKey}`;
}

function load(
  storage: FunctionBreakpointStorage | undefined,
  rootKey: string,
): FunctionBreakpoint[] {
  try {
    const raw = (storage ?? window.localStorage).getItem(storageKey(rootKey));
    return raw === null ? [] : deserializeFunctionBreakpoints(raw);
  } catch {
    return [];
  }
}

function save(
  storage: FunctionBreakpointStorage | undefined,
  rootKey: string,
  breakpoints: readonly FunctionBreakpoint[],
): void {
  try {
    const target = storage ?? window.localStorage;
    if (breakpoints.length === 0) {
      target.removeItem(storageKey(rootKey));
      return;
    }
    target.setItem(storageKey(rootKey), serializeFunctionBreakpoints(breakpoints));
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

function createFunctionBreakpointId(nextIdRef: { current: number }): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) return `fn-${randomId}`;
  return `fn-${Date.now()}-${nextIdRef.current++}`;
}
