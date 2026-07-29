import { useCallback, type MutableRefObject } from "react";
import { languageServerPathFromDocumentSyncKey } from "../../domain/languageServerDocumentSync";
import {
  closeJavaScriptTypeScriptDocumentsForRoot,
  closePhpDocumentsForRoot,
} from "../documentSyncCloseLifecycle";
import type { DocumentSyncDependencies } from "../documentSyncContracts";

type RootCleanupDependencies = Pick<
  DocumentSyncDependencies,
  | "clearDocumentChangeTimer"
  | "clearJavaScriptTypeScriptDocumentChangeTimer"
  | "documentLifecycleIdentitiesRef"
  | "documentSyncGenerationRef"
  | "documentVersionsByUriRef"
  | "documentVersionsRef"
  | "enqueueDocumentSync"
  | "enqueueJavaScriptTypeScriptDocumentSync"
  | "isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot"
  | "isLanguageServerSessionCurrentForRoot"
  | "isRunningLanguageServerForWorkspace"
  | "isSessionPathInWorkspace"
  | "javaScriptTypeScriptDocumentChangeMailbox"
  | "javaScriptTypeScriptDocumentSyncGenerationRef"
  | "javaScriptTypeScriptDocumentVersionsByUriRef"
  | "javaScriptTypeScriptDocumentVersionsRef"
  | "javaScriptTypeScriptIncrementalSyncRef"
  | "javaScriptTypeScriptLanguageServerDocumentSyncGateway"
  | "javaScriptTypeScriptLanguageServerRuntimeStatusRef"
  | "javaScriptTypeScriptLanguageServerRuntimeStatusRootRef"
  | "javaScriptTypeScriptLastAppliedDiagnosticVersionByUriRef"
  | "javaScriptTypeScriptPendingDocumentChangesRef"
  | "javaScriptTypeScriptPendingDocumentOpenSyncAttemptsRef"
  | "javaScriptTypeScriptRuntimeStatusByRootRef"
  | "javaScriptTypeScriptSyncedDocumentContentRef"
  | "javaScriptTypeScriptSyncedDocumentPathsRef"
  | "languageServerDocumentSyncGateway"
  | "languageServerRuntimeStatusByRootRef"
  | "languageServerRuntimeStatusRef"
  | "languageServerRuntimeStatusRootRef"
  | "lastAppliedDiagnosticVersionByUriRef"
  | "pendingDocumentChangesRef"
  | "pendingDocumentLifecycleIdentitiesRef"
  | "pendingDocumentOpenSyncAttemptsRef"
  | "reportErrorForActiveWorkspaceRoot"
  | "reportLanguageServerErrorForActiveWorkspaceRoot"
  | "resetLanguageServerDocuments"
  | "syncedDocumentContentRef"
  | "syncedDocumentPathsRef"
> & {
  readonly javaScriptTypeScriptDocumentAuthorityVersionsRef: MutableRefObject<
    Record<string, number>
  >;
  readonly javaScriptTypeScriptDocumentLifecycleIdentitiesRef: MutableRefObject<
    Record<string, number>
  >;
};

export interface DocumentSyncRootCleanup {
  readonly closePhpDocumentsForRoot: (rootPath: string) => Promise<void>;
  readonly closeJavaScriptTypeScriptDocumentsForRoot: (rootPath: string) => Promise<void>;
}

/** Coordinates bounded, exact-root retirement for both language-server families. */
export function useDocumentSyncRootCleanup(
  dependencies: RootCleanupDependencies,
): DocumentSyncRootCleanup {
  const closePhpDocuments = useCallback(
    (rootPath: string) =>
      closePhpDocumentsForRoot({
        rootPath,
        syncGenerationRef: dependencies.documentSyncGenerationRef,
        state: {
          syncedPathsRef: dependencies.syncedDocumentPathsRef,
          syncedContentRef: dependencies.syncedDocumentContentRef,
          pendingChangesRef: dependencies.pendingDocumentChangesRef,
          pendingOpenAttemptsRef: dependencies.pendingDocumentOpenSyncAttemptsRef,
          lifecycleIdentitiesRef: dependencies.documentLifecycleIdentitiesRef,
          pendingLifecycleIdentitiesRef: dependencies.pendingDocumentLifecycleIdentitiesRef,
          versionState: {
            diagnosticVersionsByUriRef: dependencies.lastAppliedDiagnosticVersionByUriRef,
            documentVersionsByUriRef: dependencies.documentVersionsByUriRef,
            documentVersionsRef: dependencies.documentVersionsRef,
          },
        },
        runtimeAuthority: {
          statusRef: dependencies.languageServerRuntimeStatusRef,
          statusRootRef: dependencies.languageServerRuntimeStatusRootRef,
          statusByRootRef: dependencies.languageServerRuntimeStatusByRootRef,
          isRunningForWorkspace: dependencies.isRunningLanguageServerForWorkspace,
        },
        clearChangeTimer: dependencies.clearDocumentChangeTimer,
        enqueueSync: dependencies.enqueueDocumentSync,
        gateway: dependencies.languageServerDocumentSyncGateway,
        isSessionCurrent: dependencies.isLanguageServerSessionCurrentForRoot,
        reportError: dependencies.reportLanguageServerErrorForActiveWorkspaceRoot,
        resetDocuments: dependencies.resetLanguageServerDocuments,
      }),
    [
      dependencies.clearDocumentChangeTimer,
      dependencies.documentLifecycleIdentitiesRef,
      dependencies.documentSyncGenerationRef,
      dependencies.documentVersionsByUriRef,
      dependencies.documentVersionsRef,
      dependencies.enqueueDocumentSync,
      dependencies.isLanguageServerSessionCurrentForRoot,
      dependencies.isRunningLanguageServerForWorkspace,
      dependencies.languageServerDocumentSyncGateway,
      dependencies.languageServerRuntimeStatusByRootRef,
      dependencies.languageServerRuntimeStatusRef,
      dependencies.languageServerRuntimeStatusRootRef,
      dependencies.lastAppliedDiagnosticVersionByUriRef,
      dependencies.pendingDocumentChangesRef,
      dependencies.pendingDocumentLifecycleIdentitiesRef,
      dependencies.pendingDocumentOpenSyncAttemptsRef,
      dependencies.reportLanguageServerErrorForActiveWorkspaceRoot,
      dependencies.resetLanguageServerDocuments,
      dependencies.syncedDocumentContentRef,
      dependencies.syncedDocumentPathsRef,
    ],
  );

  const closeJavaScriptTypeScriptDocuments = useCallback(
    async (rootPath: string) => {
      const incrementalSync = dependencies.javaScriptTypeScriptIncrementalSyncRef?.current ?? null;
      if (incrementalSync) await incrementalSync.closeRoot(rootPath);

      for (const syncKey of dependencies.javaScriptTypeScriptSyncedDocumentPathsRef.current) {
        if (languageServerPathFromDocumentSyncKey(rootPath, syncKey) !== null) {
          dependencies.javaScriptTypeScriptDocumentChangeMailbox.drop(syncKey);
        }
      }

      return closeJavaScriptTypeScriptDocumentsForRoot({
        rootPath,
        syncGenerationRef: dependencies.javaScriptTypeScriptDocumentSyncGenerationRef,
        state: {
          syncedPathsRef: dependencies.javaScriptTypeScriptSyncedDocumentPathsRef,
          syncedContentRef: dependencies.javaScriptTypeScriptSyncedDocumentContentRef,
          pendingChangesRef: dependencies.javaScriptTypeScriptPendingDocumentChangesRef,
          pendingOpenAttemptsRef:
            dependencies.javaScriptTypeScriptPendingDocumentOpenSyncAttemptsRef,
          lifecycleIdentitiesRef: dependencies.javaScriptTypeScriptDocumentLifecycleIdentitiesRef,
          authorityVersionsRef: dependencies.javaScriptTypeScriptDocumentAuthorityVersionsRef,
          versionState: {
            diagnosticVersionsByUriRef:
              dependencies.javaScriptTypeScriptLastAppliedDiagnosticVersionByUriRef,
            documentVersionsByUriRef: dependencies.javaScriptTypeScriptDocumentVersionsByUriRef,
            documentVersionsRef: dependencies.javaScriptTypeScriptDocumentVersionsRef,
          },
        },
        runtimeAuthority: {
          statusRef: dependencies.javaScriptTypeScriptLanguageServerRuntimeStatusRef,
          statusRootRef: dependencies.javaScriptTypeScriptLanguageServerRuntimeStatusRootRef,
          statusByRootRef: dependencies.javaScriptTypeScriptRuntimeStatusByRootRef,
          isRunningForWorkspace: dependencies.isRunningLanguageServerForWorkspace,
        },
        isPathInWorkspace: dependencies.isSessionPathInWorkspace,
        clearChangeTimer: dependencies.clearJavaScriptTypeScriptDocumentChangeTimer,
        enqueueSync: dependencies.enqueueJavaScriptTypeScriptDocumentSync,
        gateway: dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway,
        isSessionCurrent: dependencies.isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot,
        reportError: (requestedRoot, error) =>
          dependencies.reportErrorForActiveWorkspaceRoot(
            requestedRoot,
            "JavaScript/TypeScript",
            error,
          ),
      });
    },
    [
      dependencies.clearJavaScriptTypeScriptDocumentChangeTimer,
      dependencies.enqueueJavaScriptTypeScriptDocumentSync,
      dependencies.isJavaScriptTypeScriptLanguageServerSessionCurrentForRoot,
      dependencies.isRunningLanguageServerForWorkspace,
      dependencies.isSessionPathInWorkspace,
      dependencies.javaScriptTypeScriptDocumentAuthorityVersionsRef,
      dependencies.javaScriptTypeScriptDocumentChangeMailbox,
      dependencies.javaScriptTypeScriptDocumentLifecycleIdentitiesRef,
      dependencies.javaScriptTypeScriptDocumentSyncGenerationRef,
      dependencies.javaScriptTypeScriptDocumentVersionsByUriRef,
      dependencies.javaScriptTypeScriptDocumentVersionsRef,
      dependencies.javaScriptTypeScriptIncrementalSyncRef,
      dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway,
      dependencies.javaScriptTypeScriptLanguageServerRuntimeStatusRef,
      dependencies.javaScriptTypeScriptLanguageServerRuntimeStatusRootRef,
      dependencies.javaScriptTypeScriptLastAppliedDiagnosticVersionByUriRef,
      dependencies.javaScriptTypeScriptPendingDocumentChangesRef,
      dependencies.javaScriptTypeScriptPendingDocumentOpenSyncAttemptsRef,
      dependencies.javaScriptTypeScriptRuntimeStatusByRootRef,
      dependencies.javaScriptTypeScriptSyncedDocumentContentRef,
      dependencies.javaScriptTypeScriptSyncedDocumentPathsRef,
      dependencies.reportErrorForActiveWorkspaceRoot,
    ],
  );

  return {
    closeJavaScriptTypeScriptDocumentsForRoot: closeJavaScriptTypeScriptDocuments,
    closePhpDocumentsForRoot: closePhpDocuments,
  };
}
