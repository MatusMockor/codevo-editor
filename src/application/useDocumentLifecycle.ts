import type { EditorDocument } from "../domain/workspace";
import type {
  DocumentCloseLifecycle,
  DocumentCloseLifecycleDependencies,
} from "./useDocumentCloseLifecycle";
import { useDocumentCloseLifecycle } from "./useDocumentCloseLifecycle";
import type {
  DocumentSaveLifecycle,
  DocumentSaveLifecycleDependencies,
} from "./useDocumentSaveLifecycle";
import { useDocumentSaveLifecycle } from "./useDocumentSaveLifecycle";

export type { DocumentCloseOptions } from "./useDocumentCloseLifecycle";

/**
 * Compatibility boundary for the workbench shell. Save and close lifecycle
 * collaborators stay independently testable while existing callers can keep
 * passing the complete editor-session state during the controller split.
 */
export type DocumentLifecycleDependencies = DocumentSaveLifecycleDependencies &
  Omit<DocumentCloseLifecycleDependencies, "invalidateDocumentSave"> & {
    documents: Record<string, EditorDocument>;
    openPaths: string[];
    previewPath: string | null;
  };

export interface DocumentLifecycle
  extends
    Omit<DocumentSaveLifecycle, "invalidateDocumentSave">,
    DocumentCloseLifecycle {}

/**
 * Thin composition facade retained while the workbench controller migrates to
 * the focused save and close lifecycle ports.
 */
export function useDocumentLifecycle(
  dependencies: DocumentLifecycleDependencies,
): DocumentLifecycle {
  const saveLifecycle = useDocumentSaveLifecycle(dependencies);
  const closeLifecycle = useDocumentCloseLifecycle({
    ...dependencies,
    invalidateDocumentSave: saveLifecycle.invalidateDocumentSave,
  });

  return {
    captureLocalHistorySnapshot: saveLifecycle.captureLocalHistorySnapshot,
    saveActiveDocument: saveLifecycle.saveActiveDocument,
    runWithDocumentSaveExclusion: saveLifecycle.runWithDocumentSaveExclusion,
    ...closeLifecycle,
  };
}
