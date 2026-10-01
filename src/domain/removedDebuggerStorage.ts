export const REMOVED_DEBUGGER_STORAGE_PREFIX = "mockor.debug.";
export const MAX_REMOVED_DEBUGGER_STORAGE_SCAN = 10_000;

export type RemovedDebuggerStoragePort = Pick<Storage, "key" | "length" | "removeItem">;

export function purgeRemovedDebuggerStorage(
  storage: RemovedDebuggerStoragePort | null | undefined,
): number {
  if (!storage) return 0;
  const keys = removedDebuggerKeys(storage);
  let removed = 0;
  for (const key of keys) {
    try {
      storage.removeItem(key);
      removed += 1;
    } catch {
      continue;
    }
  }
  return removed;
}

function removedDebuggerKeys(storage: RemovedDebuggerStoragePort): readonly string[] {
  const length = safeLength(storage);
  const keys: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const key = safeKey(storage, index);
    if (key?.startsWith(REMOVED_DEBUGGER_STORAGE_PREFIX)) keys.push(key);
  }
  return keys;
}

function safeLength(storage: RemovedDebuggerStoragePort): number {
  try {
    const length = storage.length;
    if (!Number.isSafeInteger(length) || length < 0) return 0;
    return Math.min(length, MAX_REMOVED_DEBUGGER_STORAGE_SCAN);
  } catch {
    return 0;
  }
}

function safeKey(storage: RemovedDebuggerStoragePort, index: number): string | null {
  try {
    return storage.key(index);
  } catch {
    return null;
  }
}
