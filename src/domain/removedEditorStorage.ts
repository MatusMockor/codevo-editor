export const REMOVED_EDITOR_STORAGE_KEYS: readonly string[] = [
  "codevo.qaBridge",
  "codevo.perfBridge",
];

export type RemovedEditorStoragePort = Pick<Storage, "getItem" | "removeItem">;

export function purgeRemovedEditorStorage(
  storage: RemovedEditorStoragePort | null | undefined,
): number {
  if (!storage) return 0;
  let removed = 0;
  for (const key of REMOVED_EDITOR_STORAGE_KEYS) {
    if (!hasItem(storage, key)) continue;
    try {
      storage.removeItem(key);
      removed += 1;
    } catch {
      continue;
    }
  }
  return removed;
}

function hasItem(storage: RemovedEditorStoragePort, key: string): boolean {
  try {
    return storage.getItem(key) !== null;
  } catch {
    return false;
  }
}
