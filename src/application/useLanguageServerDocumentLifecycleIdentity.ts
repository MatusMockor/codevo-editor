import { useCallback, type MutableRefObject } from "react";
import { languageServerDocumentSyncKey } from "../domain/languageServerDocumentSync";

export function useLanguageServerDocumentLifecycleIdentity(
  lifecycleIdentitiesRef: MutableRefObject<Record<string, number>>,
  syncedPathsRef: MutableRefObject<Set<string>>,
) {
  return useCallback(
    (rootPath: string, path: string): number | null => {
      const syncKey = languageServerDocumentSyncKey(rootPath, path);
      return syncedPathsRef.current.has(syncKey)
        ? (lifecycleIdentitiesRef.current[syncKey] ?? null)
        : null;
    },
    [lifecycleIdentitiesRef, syncedPathsRef],
  );
}
