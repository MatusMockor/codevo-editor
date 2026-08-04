import { useCallback, type MutableRefObject } from "react";
import { languageServerDocumentSyncKey } from "../domain/languageServerDocumentSync";
import type { EditorDocument } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { JavaScriptTypeScriptIncrementalSyncDocumentLifecyclePort } from "./javaScriptTypeScriptIncrementalSyncProduction";
import { isJavaScriptTypeScriptDocumentSyncBlockedBySize } from "./javaScriptTypeScriptDocumentSyncAdmission";

interface JavaScriptTypeScriptDocumentSyncVersionOptions {
  readonly activeDocumentRef: MutableRefObject<EditorDocument | null>;
  readonly authorityVersionsRef: MutableRefObject<Record<string, number>>;
  readonly currentWorkspaceRootRef: MutableRefObject<string | null>;
  readonly documentsRef: MutableRefObject<Record<string, EditorDocument>>;
  readonly lifecycleIdentitiesRef: MutableRefObject<Record<string, number>>;
  readonly incrementalSyncRef?: MutableRefObject<JavaScriptTypeScriptIncrementalSyncDocumentLifecyclePort | null>;
  readonly pendingChangesRef: MutableRefObject<Record<string, unknown>>;
  readonly pendingOpenAttemptsRef: MutableRefObject<Record<string, number>>;
  readonly syncedContentRef: MutableRefObject<Record<string, string>>;
  readonly syncedPathsRef: MutableRefObject<Set<string>>;
}

export function useJavaScriptTypeScriptDocumentSyncVersion({
  activeDocumentRef,
  authorityVersionsRef,
  currentWorkspaceRootRef,
  documentsRef,
  lifecycleIdentitiesRef,
  incrementalSyncRef,
  pendingChangesRef,
  pendingOpenAttemptsRef,
  syncedContentRef,
  syncedPathsRef,
}: JavaScriptTypeScriptDocumentSyncVersionOptions): (
  rootPath: string,
  path: string,
) => number | null {
  return useCallback(
    (rootPath: string, path: string): number | null => {
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
        return null;
      }

      const syncKey = languageServerDocumentSyncKey(rootPath, path);
      const document =
        activeDocumentRef.current?.path === path
          ? activeDocumentRef.current
          : documentsRef.current[path];
      if (!document) return null;
      const incrementalSync = incrementalSyncRef?.current ?? null;
      const incrementalVersion = incrementalSync?.currentDocumentSyncVersion(path) ?? null;
      if (incrementalVersion !== null) return incrementalVersion;
      if (
        incrementalSync &&
        (incrementalSync.currentDocumentSemanticMode(path) !== null ||
          incrementalSync.ownsLifecycle(path))
      ) {
        return null;
      }
      if (
        isJavaScriptTypeScriptDocumentSyncBlockedBySize(document) ||
        !syncedPathsRef.current.has(syncKey) ||
        pendingChangesRef.current[syncKey] !== undefined ||
        pendingOpenAttemptsRef.current[syncKey] !== undefined ||
        lifecycleIdentitiesRef.current[syncKey] === undefined ||
        syncedContentRef.current[syncKey] !== document.content
      ) {
        return null;
      }

      return authorityVersionsRef.current[syncKey] ?? null;
    },
    [
      activeDocumentRef,
      authorityVersionsRef,
      currentWorkspaceRootRef,
      documentsRef,
      lifecycleIdentitiesRef,
      incrementalSyncRef,
      pendingChangesRef,
      pendingOpenAttemptsRef,
      syncedContentRef,
      syncedPathsRef,
    ],
  );
}
