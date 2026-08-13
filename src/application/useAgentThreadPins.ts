import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { normalizedWorkspaceRootKey } from "../domain/workspaceRootKey";

const STORAGE_KEY_PREFIX = "mockor.agents.threadPins.";
const MAX_PINNED_TASK_IDS = 64;
const MAX_TASK_ID_LENGTH = 128;

export interface AgentThreadPinStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

export interface UseAgentThreadPinsResult {
  readonly pinnedTaskIds: readonly string[];
  toggle(taskId: string): boolean;
}

interface AgentThreadPinState {
  readonly pinnedTaskIds: readonly string[];
  readonly rootKey: string;
}

interface PersistedPinSnapshot {
  readonly rootKey: string;
  readonly serialized: string;
}

type PersistedPinSnapshotRef = { current: PersistedPinSnapshot | null };

export function useAgentThreadPins(
  workspaceRoot: string | null,
  pinnableTaskIds: readonly string[],
  storage?: AgentThreadPinStorage,
): UseAgentThreadPinsResult {
  const rootKey = normalizedWorkspaceRootKey(workspaceRoot);
  const pinnableTaskIdSet = useMemo(() => new Set(pinnableTaskIds), [pinnableTaskIds]);
  const storageRef = useRef(storage);
  storageRef.current = storage;
  const persistedRef = useRef<PersistedPinSnapshot | null>(null);
  const [state, setState] = useState<AgentThreadPinState>(() => ({
    pinnedTaskIds: retainPinnableTaskIds(loadPinnedTaskIds(storage, rootKey), pinnableTaskIdSet),
    rootKey,
  }));

  useLayoutEffect(() => {
    const current =
      state.rootKey === rootKey
        ? state.pinnedTaskIds
        : loadPinnedTaskIds(storageRef.current, rootKey);
    const pinnedTaskIds = retainPinnableTaskIds(current, pinnableTaskIdSet);
    persistPinnedTaskIds(storageRef.current, persistedRef, rootKey, pinnedTaskIds);
    if (state.rootKey === rootKey && taskIdListsEqual(state.pinnedTaskIds, pinnedTaskIds)) {
      return;
    }
    setState({ pinnedTaskIds, rootKey });
  }, [pinnableTaskIdSet, rootKey, state.pinnedTaskIds, state.rootKey]);

  const toggle = useCallback(
    (taskId: string) => {
      if (!isStorableTaskId(taskId) || !pinnableTaskIdSet.has(taskId)) {
        return false;
      }
      setState((current) => {
        const base =
          current.rootKey === rootKey
            ? current.pinnedTaskIds
            : loadPinnedTaskIds(storageRef.current, rootKey);
        const pinnedTaskIds = togglePinnedTaskId(
          retainPinnableTaskIds(base, pinnableTaskIdSet),
          taskId,
        );
        persistPinnedTaskIds(storageRef.current, persistedRef, rootKey, pinnedTaskIds);
        return { pinnedTaskIds, rootKey };
      });
      return true;
    },
    [pinnableTaskIdSet, rootKey],
  );

  if (state.rootKey !== rootKey) {
    return {
      pinnedTaskIds: retainPinnableTaskIds(
        loadPinnedTaskIds(storageRef.current, rootKey),
        pinnableTaskIdSet,
      ),
      toggle,
    };
  }

  return {
    pinnedTaskIds: retainPinnableTaskIds(state.pinnedTaskIds, pinnableTaskIdSet),
    toggle,
  };
}

export function agentThreadPinStorageKey(workspaceRoot: string): string {
  return `${STORAGE_KEY_PREFIX}${normalizedWorkspaceRootKey(workspaceRoot)}`;
}

function loadPinnedTaskIds(
  storage: AgentThreadPinStorage | undefined,
  rootKey: string,
): readonly string[] {
  if (!rootKey) {
    return [];
  }
  try {
    const raw = (storage ?? window.localStorage).getItem(agentThreadPinStorageKey(rootKey));
    if (raw === null) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const pinnedTaskIds: string[] = [];
    for (const value of parsed) {
      if (typeof value !== "string" || !isStorableTaskId(value)) {
        continue;
      }
      if (pinnedTaskIds.includes(value)) {
        continue;
      }
      pinnedTaskIds.push(value);
      if (pinnedTaskIds.length >= MAX_PINNED_TASK_IDS) {
        break;
      }
    }
    return pinnedTaskIds;
  } catch {
    return [];
  }
}

function persistPinnedTaskIds(
  storage: AgentThreadPinStorage | undefined,
  persistedRef: PersistedPinSnapshotRef,
  rootKey: string,
  pinnedTaskIds: readonly string[],
): void {
  if (!rootKey) {
    return;
  }
  const bounded = pinnedTaskIds.filter(isStorableTaskId).slice(0, MAX_PINNED_TASK_IDS);
  const serialized = JSON.stringify(bounded);
  const persisted = persistedRef.current;
  if (persisted !== null && persisted.rootKey === rootKey && persisted.serialized === serialized) {
    return;
  }
  persistedRef.current = { rootKey, serialized };
  try {
    const target = storage ?? window.localStorage;
    if (bounded.length === 0) {
      target.removeItem(agentThreadPinStorageKey(rootKey));
      return;
    }
    target.setItem(agentThreadPinStorageKey(rootKey), serialized);
  } catch {
    return;
  }
}

function togglePinnedTaskId(pinnedTaskIds: readonly string[], taskId: string): readonly string[] {
  if (pinnedTaskIds.includes(taskId)) {
    return pinnedTaskIds.filter((pinned) => pinned !== taskId);
  }
  return [taskId, ...pinnedTaskIds].slice(0, MAX_PINNED_TASK_IDS);
}

function retainPinnableTaskIds(
  pinnedTaskIds: readonly string[],
  pinnableTaskIds: ReadonlySet<string>,
): readonly string[] {
  if (pinnableTaskIds.size === 0) {
    return pinnedTaskIds;
  }
  const retained = pinnedTaskIds.filter((taskId) => pinnableTaskIds.has(taskId));
  if (retained.length === pinnedTaskIds.length) {
    return pinnedTaskIds;
  }
  return retained;
}

function taskIdListsEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((taskId, index) => taskId === right[index]);
}

function isStorableTaskId(taskId: string): boolean {
  return taskId.length > 0 && taskId.length <= MAX_TASK_ID_LENGTH;
}
