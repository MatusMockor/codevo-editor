import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { ResolvedEditorConfig } from "../domain/editorConfig";
import { applyEditorConfigOnSave } from "../domain/editorConfig";
import type { FilePrefetchCache } from "../domain/filePrefetchCache";
import type { LocalHistoryGateway } from "../domain/localHistory";
import { isJavaScriptTypeScriptLanguageServerDocument } from "../domain/languageServerDocumentSync";
import type { WorkspaceSettings } from "../domain/settings";
import type { EditorDocument, WorkspaceFileGateway } from "../domain/workspace";
import {
  isDirty,
  readWorkspaceTextFileSnapshot,
  workspaceRelativePath,
} from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import {
  DocumentSaveCoordinator,
  type DocumentSaveLease,
  type RunWithDocumentSaveExclusion,
} from "./documentSaveCoordinator";

export interface DocumentSaveLifecycleDependencies {
  workspaceRoot: string | null;
  activeDocument: EditorDocument | null;
  workspaceSettings: WorkspaceSettings;

  currentWorkspaceRootRef: MutableRefObject<string | null>;
  workspaceRequestTokenRef: MutableRefObject<number>;
  activeDocumentRef: MutableRefObject<EditorDocument | null>;
  documentsRef: MutableRefObject<Record<string, EditorDocument>>;
  filePrefetchCacheRef: MutableRefObject<FilePrefetchCache>;

  setDocuments: Dispatch<SetStateAction<Record<string, EditorDocument>>>;
  setMessage: Dispatch<SetStateAction<string | null>>;

  localHistoryGateway: LocalHistoryGateway;
  workspaceFiles: WorkspaceFileGateway;

  formattedContentForSave: (
    document: EditorDocument,
    requestedRoot: string,
  ) => Promise<string>;
  optimizedImportsContentForSave: (
    document: EditorDocument,
    content: string,
  ) => string;
  organizedImportsContentForSave: (
    document: EditorDocument,
    content: string,
    requestedRoot: string,
  ) => Promise<string>;
  resolveEditorConfigForFile: (
    requestedRoot: string,
    filePath: string,
  ) => Promise<ResolvedEditorConfig>;

  syncSavedDocument: (
    document: EditorDocument,
    shouldEmit?: () => boolean,
  ) => Promise<void>;
  syncSavedJavaScriptTypeScriptDocument: (
    document: EditorDocument,
    shouldEmit?: () => boolean,
  ) => Promise<void>;

  reportErrorForActiveWorkspaceRoot: (
    rootPath: string | null | undefined,
    source: string,
    error: unknown,
  ) => void;
  hasExternalFileConflict?: (rootPath: string | null, path: string) => boolean;
  detectSaveConflict?: (
    rootPath: string,
    document: EditorDocument,
    disk: Awaited<ReturnType<typeof readWorkspaceTextFileSnapshot>> | null,
  ) => void;
  runEslintAnalysisOnSave: (rootPath: string) => void;
  runPhpstanAnalysisOnSave: (rootPath: string) => void;
}

export interface DocumentSaveLifecycle {
  captureLocalHistorySnapshot: (
    requestedRoot: string,
    absolutePath: string,
    content: string,
  ) => Promise<void>;
  saveActiveDocument: () => Promise<void>;
  runWithDocumentSaveExclusion: RunWithDocumentSaveExclusion;
  invalidateDocumentSave: (rootPath: string, path: string) => void;
}

interface DocumentSaveIdentity {
  path: string;
  requestedRoot: string;
  workspaceRequestToken: number;
}

export function useDocumentSaveLifecycle(
  dependencies: DocumentSaveLifecycleDependencies,
): DocumentSaveLifecycle {
  const {
    workspaceRoot,
    activeDocument,
    workspaceSettings,
    currentWorkspaceRootRef,
    workspaceRequestTokenRef,
    activeDocumentRef,
    documentsRef,
    filePrefetchCacheRef,
    setDocuments,
    setMessage,
    localHistoryGateway,
    workspaceFiles,
    formattedContentForSave,
    optimizedImportsContentForSave,
    organizedImportsContentForSave,
    resolveEditorConfigForFile,
    syncSavedDocument,
    syncSavedJavaScriptTypeScriptDocument,
    reportErrorForActiveWorkspaceRoot,
    hasExternalFileConflict = () => false,
    detectSaveConflict = () => {},
    runEslintAnalysisOnSave,
    runPhpstanAnalysisOnSave,
  } = dependencies;
  const documentSaveCoordinatorRef = useRef<DocumentSaveCoordinator | null>(
    null,
  );
  if (!documentSaveCoordinatorRef.current) {
    documentSaveCoordinatorRef.current = new DocumentSaveCoordinator();
  }
  const documentSaveCoordinator = documentSaveCoordinatorRef.current;
  const documentSaveCoordinatorEffectGenerationRef = useRef(0);
  const eslintAnalysisOnSaveTimerRef = useRef<number | null>(null);
  const phpstanAnalysisOnSaveTimerRef = useRef<number | null>(null);

  const clearAnalysisOnSaveTimers = useCallback(() => {
    if (eslintAnalysisOnSaveTimerRef.current !== null) {
      window.clearTimeout(eslintAnalysisOnSaveTimerRef.current);
      eslintAnalysisOnSaveTimerRef.current = null;
    }
    if (phpstanAnalysisOnSaveTimerRef.current !== null) {
      window.clearTimeout(phpstanAnalysisOnSaveTimerRef.current);
      phpstanAnalysisOnSaveTimerRef.current = null;
    }
  }, []);

  useEffect(
    () => clearAnalysisOnSaveTimers,
    [clearAnalysisOnSaveTimers, workspaceRoot],
  );

  useEffect(() => {
    const generation = ++documentSaveCoordinatorEffectGenerationRef.current;

    return () => {
      queueMicrotask(() => {
        if (documentSaveCoordinatorEffectGenerationRef.current !== generation) {
          return;
        }

        documentSaveCoordinator.dispose();
      });
    };
  }, [documentSaveCoordinator]);

  const scheduleAnalysisOnSave = useCallback(
    (document: EditorDocument, requestedRoot: string) => {
      if (
        workspaceSettings.eslintAnalyseOnSave &&
        isJavaScriptTypeScriptLanguageServerDocument(document)
      ) {
        if (eslintAnalysisOnSaveTimerRef.current !== null) {
          window.clearTimeout(eslintAnalysisOnSaveTimerRef.current);
        }
        eslintAnalysisOnSaveTimerRef.current = window.setTimeout(() => {
          eslintAnalysisOnSaveTimerRef.current = null;
          if (
            !workspaceRootKeysEqual(
              currentWorkspaceRootRef.current,
              requestedRoot,
            )
          ) {
            return;
          }
          runEslintAnalysisOnSave(requestedRoot);
        }, 500);
      }
      if (
        workspaceSettings.phpstanAnalyseOnSave &&
        document.language === "php"
      ) {
        if (phpstanAnalysisOnSaveTimerRef.current !== null) {
          window.clearTimeout(phpstanAnalysisOnSaveTimerRef.current);
        }
        phpstanAnalysisOnSaveTimerRef.current = window.setTimeout(() => {
          phpstanAnalysisOnSaveTimerRef.current = null;
          if (
            !workspaceRootKeysEqual(
              currentWorkspaceRootRef.current,
              requestedRoot,
            )
          ) {
            return;
          }
          runPhpstanAnalysisOnSave(requestedRoot);
        }, 500);
      }
    },
    [
      currentWorkspaceRootRef,
      runEslintAnalysisOnSave,
      runPhpstanAnalysisOnSave,
      workspaceSettings.eslintAnalyseOnSave,
      workspaceSettings.phpstanAnalyseOnSave,
    ],
  );

  // Records a Local History snapshot for a saved document, scoped to the
  // workspace root captured by the caller. Best-effort: a snapshot failure must
  // never surface as a save error, so it is swallowed (logged) rather than
  // thrown. The absolute path is converted to a workspace-relative path so the
  // snapshot lands in the requested workspace's bucket only.
  const captureLocalHistorySnapshot = useCallback(
    async (
      requestedRoot: string,
      absolutePath: string,
      content: string,
    ): Promise<void> => {
      const relativePath = workspaceRelativePath(requestedRoot, absolutePath);

      if (!relativePath) {
        return;
      }

      try {
        await localHistoryGateway.recordSnapshot(
          requestedRoot,
          relativePath,
          content,
        );
      } catch (error) {
        console.error("Local History snapshot failed", error);
      }
    },
    [localHistoryGateway],
  );

  const performDocumentSave = useCallback(
    async (identity: DocumentSaveIdentity, lease: DocumentSaveLease) => {
      const { path, requestedRoot, workspaceRequestToken } = identity;
      const currentDocumentForSave = (): EditorDocument | null => {
        if (
          !lease.isCurrent() ||
          workspaceRequestTokenRef.current !== workspaceRequestToken ||
          !workspaceRootKeysEqual(
            currentWorkspaceRootRef.current,
            requestedRoot,
          )
        ) {
          return null;
        }

        return documentsRef.current[path] ?? null;
      };

      try {
        let documentToFormat = currentDocumentForSave();
        if (!documentToFormat || documentToFormat.readOnly) {
          return;
        }
        if (hasExternalFileConflict(requestedRoot, path)) {
          setMessage("Resolve the external file conflict before saving.");
          return;
        }

        while (true) {
          const startingContent = documentToFormat.content;
          const formattedContent = await formattedContentForSave(
            documentToFormat,
            requestedRoot,
          );
          let liveDocument = currentDocumentForSave();
          if (!liveDocument) {
            return;
          }
          if (hasExternalFileConflict(requestedRoot, path)) {
            setMessage("Resolve the external file conflict before saving.");
            return;
          }
          if (liveDocument !== documentToFormat) {
            documentToFormat = liveDocument;
            continue;
          }

          // Optimize imports AFTER formatting on the captured document snapshot.
          // Any edit observed at an async boundary restarts the whole pipeline.
          const phpOptimizedContent = optimizedImportsContentForSave(
            documentToFormat,
            formattedContent,
          );

          // JavaScript/TypeScript organize-imports goes through the language server
          // (`source.organizeImports`). It is async, so it is given the upfront
          // requested root (which it uses for every LSP call and re-checks after its
          // await), and the workspace root is re-checked again here before writing.
          // It is a no-op for non-JS/TS documents.
          const contentToSave = await organizedImportsContentForSave(
            documentToFormat,
            phpOptimizedContent,
            requestedRoot,
          );
          liveDocument = currentDocumentForSave();
          if (!liveDocument) {
            return;
          }
          if (hasExternalFileConflict(requestedRoot, path)) {
            setMessage("Resolve the external file conflict before saving.");
            return;
          }
          if (liveDocument !== documentToFormat) {
            documentToFormat = liveDocument;
            continue;
          }

          // EditorConfig on-save transforms (trim trailing whitespace, insert final
          // newline, normalize EOL) run LAST so they compose over the formatted +
          // import-organized content, mirroring VS Code / PhpStorm. Resolved per the
          // saved document's own path through the per-workspace cascade. A no-op when
          // no `.editorconfig` enables any on-save behaviour.
          const editorConfigForSave = await resolveEditorConfigForFile(
            requestedRoot,
            documentToFormat.path,
          );
          liveDocument = currentDocumentForSave();
          if (!liveDocument) {
            return;
          }
          if (hasExternalFileConflict(requestedRoot, path)) {
            setMessage("Resolve the external file conflict before saving.");
            return;
          }
          if (liveDocument !== documentToFormat) {
            documentToFormat = liveDocument;
            continue;
          }

          const editorConfiguredContent = applyEditorConfigOnSave(
            contentToSave,
            editorConfigForSave,
          );

          const documentToSave: EditorDocument = {
            ...documentToFormat,
            content: editorConfiguredContent,
          };

          if (hasExternalFileConflict(requestedRoot, path)) {
            setMessage("Resolve the external file conflict before saving.");
            return;
          }

          const writeResult = documentToFormat.revision
            ? await workspaceFiles.writeTextFile(
                documentToSave.path,
                documentToSave.content,
                documentToFormat.revision,
              )
            : await workspaceFiles.writeTextFile(
                documentToSave.path,
                documentToSave.content,
              );
          if (writeResult?.status === "conflict") {
            let disk: Awaited<
              ReturnType<typeof readWorkspaceTextFileSnapshot>
            > | null = null;
            try {
              disk = await readWorkspaceTextFileSnapshot(
                workspaceFiles,
                documentToSave.path,
              );
            } catch {
              // The conflict remains guarded and can retry the authoritative read.
            }
            const conflictedDocument = currentDocumentForSave();
            if (conflictedDocument) {
              detectSaveConflict(requestedRoot, conflictedDocument, disk);
              setMessage(
                "The file changed on disk. Review the conflict before saving.",
              );
            }
            return;
          }
          if (writeResult?.status === "error") {
            throw new Error(writeResult.message);
          }
          if (writeResult?.status === "partial") {
            const partiallyWrittenDocument = currentDocumentForSave();
            if (partiallyWrittenDocument) {
              const recoveredDocument = {
                ...partiallyWrittenDocument,
                revision: writeResult.revision,
              };
              documentsRef.current = {
                ...documentsRef.current,
                [documentToSave.path]: recoveredDocument,
              };
              if (activeDocumentRef.current?.path === documentToSave.path) {
                activeDocumentRef.current = recoveredDocument;
              }
              setDocuments((current) => {
                const existing = current[documentToSave.path];
                if (!existing || !currentDocumentForSave()) {
                  return current;
                }
                return {
                  ...current,
                  [documentToSave.path]: {
                    ...existing,
                    revision: writeResult.revision,
                  },
                };
              });
            }
            throw new Error(
              `The file was saved, but durability could not be confirmed: ${writeResult.message}`,
            );
          }
          liveDocument = currentDocumentForSave();
          if (!liveDocument) {
            return;
          }
          if (hasExternalFileConflict(requestedRoot, path)) {
            return;
          }

          const acknowledgedDocument: EditorDocument = {
            ...liveDocument,
            content:
              liveDocument === documentToFormat &&
              liveDocument.content === startingContent
                ? documentToSave.content
                : liveDocument.content,
            savedContent: documentToSave.content,
            revision:
              writeResult?.status === "success"
                ? writeResult.revision
                : liveDocument.revision,
          };
          if (!currentDocumentForSave()) {
            return;
          }
          documentsRef.current = {
            ...documentsRef.current,
            [documentToSave.path]: acknowledgedDocument,
          };
          if (!currentDocumentForSave()) {
            return;
          }
          if (activeDocumentRef.current?.path === documentToSave.path) {
            activeDocumentRef.current = acknowledgedDocument;
          }

          if (!currentDocumentForSave()) {
            return;
          }
          setDocuments((current) => {
            if (!currentDocumentForSave()) {
              return current;
            }

            const existing = current[documentToSave.path];
            if (!existing) {
              return current;
            }

            return {
              ...current,
              [documentToSave.path]: {
                ...existing,
                content:
                  existing === documentToFormat &&
                  existing.content === startingContent
                    ? documentToSave.content
                    : existing.content,
                savedContent: documentToSave.content,
                revision:
                  writeResult?.status === "success"
                    ? writeResult.revision
                    : existing.revision,
              },
            };
          });

          if (!currentDocumentForSave()) {
            return;
          }
          filePrefetchCacheRef.current.invalidate(documentToSave.path);

          if (!currentDocumentForSave()) {
            return;
          }
          await captureLocalHistorySnapshot(
            requestedRoot,
            documentToSave.path,
            documentToSave.content,
          );

          const isWrittenDocumentCurrent = () =>
            currentDocumentForSave()?.content === documentToSave.content;
          if (!isWrittenDocumentCurrent()) {
            return;
          }
          await syncSavedDocument(documentToSave, isWrittenDocumentCurrent);

          if (!isWrittenDocumentCurrent()) {
            return;
          }
          await syncSavedJavaScriptTypeScriptDocument(
            documentToSave,
            isWrittenDocumentCurrent,
          );

          if (!isWrittenDocumentCurrent()) {
            return;
          }

          setMessage(`Saved ${documentToSave.name}`);
          scheduleAnalysisOnSave(documentToSave, requestedRoot);
          return;
        }
      } catch (error) {
        if (!currentDocumentForSave()) {
          return;
        }

        reportErrorForActiveWorkspaceRoot(requestedRoot, "Save File", error);
      }
    },
    [
      captureLocalHistorySnapshot,
      activeDocumentRef,
      detectSaveConflict,
      documentsRef,
      formattedContentForSave,
      optimizedImportsContentForSave,
      organizedImportsContentForSave,
      reportErrorForActiveWorkspaceRoot,
      resolveEditorConfigForFile,
      scheduleAnalysisOnSave,
      setDocuments,
      syncSavedDocument,
      syncSavedJavaScriptTypeScriptDocument,
      workspaceFiles,
      workspaceRequestTokenRef,
      hasExternalFileConflict,
      setMessage,
    ],
  );

  const saveActiveDocument = useCallback(async () => {
    const document = activeDocumentRef.current;
    if (!document || document.readOnly || !workspaceRoot) {
      return;
    }

    const identity: DocumentSaveIdentity = {
      path: document.path,
      requestedRoot: workspaceRoot,
      workspaceRequestToken: workspaceRequestTokenRef.current,
    };
    await documentSaveCoordinator.request(
      { rootPath: identity.requestedRoot, path: identity.path },
      (lease) => performDocumentSave(identity, lease),
    );
  }, [
    activeDocumentRef,
    documentSaveCoordinator,
    performDocumentSave,
    workspaceRoot,
    workspaceRequestTokenRef,
  ]);

  const runWithDocumentSaveExclusion =
    useCallback<RunWithDocumentSaveExclusion>(
      (scope, operation) =>
        documentSaveCoordinator.runWithExclusion(scope, operation),
      [documentSaveCoordinator],
    );

  const invalidateDocumentSave = useCallback(
    (rootPath: string, path: string): void => {
      documentSaveCoordinator.invalidate({ rootPath, path });
    },
    [documentSaveCoordinator],
  );

  useEffect(() => {
    if (!workspaceSettings.autoSave) {
      return;
    }

    if (
      !activeDocument ||
      activeDocument.readOnly ||
      !isDirty(activeDocument)
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      void saveActiveDocument();
    }, 900);

    return () => window.clearTimeout(timer);
  }, [activeDocument, saveActiveDocument, workspaceSettings.autoSave]);

  return {
    captureLocalHistorySnapshot,
    saveActiveDocument,
    runWithDocumentSaveExclusion,
    invalidateDocumentSave,
  };
}
