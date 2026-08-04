import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { LanguageServerDiagnostic } from "../domain/languageServerDiagnostics";
import type { LargeSmartDocumentMetrics } from "../domain/largeDocumentPolicy";
import type { PhpFrameworkProvider } from "../domain/phpFrameworkProviders";
import type { EditorDocument } from "../domain/workspace";
import { localPhpDiagnosticsFromSource } from "./diagnosticNotices";
import { phpFrameworkBindingEditorChangeRequiresInvalidation } from "./phpFrameworkBindingInvalidation";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";

type Documents = Record<string, EditorDocument>;

interface WorkbenchActiveDocumentEditingDependencies {
  readonly activeDocument: EditorDocument | null;
  readonly activeDocumentRef: MutableRefObject<EditorDocument | null>;
  readonly activePhpFrameworkProviders: readonly PhpFrameworkProvider[];
  readonly invalidatePhpFrameworkBindingCacheRef: MutableRefObject<() => void>;
  readonly isPhpFrameworkBindingDependencyPathRef: MutableRefObject<(path: string) => boolean>;
  readonly phpFrameworkRuntimeContext: Pick<PhpFrameworkRuntimeContext, "supports">;
  readonly pinDocument: (path: string) => void;
  readonly reportChangedDocuments: (paths: readonly string[]) => void;
  readonly resetPhpFrameworkMorphMapModelTypeCacheRef: MutableRefObject<() => void>;
  readonly setDocuments: Dispatch<SetStateAction<Documents>>;
  readonly updateDocumentContent: (
    path: string,
    content: string,
    metrics: LargeSmartDocumentMetrics,
  ) => boolean;
  readonly updateLocalPhpDiagnostics: (
    path: string,
    diagnostics: LanguageServerDiagnostic[],
  ) => void;
}

export function useWorkbenchActiveDocumentEditing({
  activeDocument,
  activeDocumentRef,
  activePhpFrameworkProviders,
  invalidatePhpFrameworkBindingCacheRef,
  isPhpFrameworkBindingDependencyPathRef,
  phpFrameworkRuntimeContext,
  pinDocument,
  reportChangedDocuments,
  resetPhpFrameworkMorphMapModelTypeCacheRef,
  setDocuments,
  updateDocumentContent,
  updateLocalPhpDiagnostics,
}: WorkbenchActiveDocumentEditingDependencies) {
  return useCallback(
    (content: string, sourcePath?: string, metrics?: LargeSmartDocumentMetrics) => {
      const requestedPath = sourcePath ?? activeDocument?.path;
      const currentActiveDocument = activeDocumentRef.current;
      if (
        !requestedPath ||
        !currentActiveDocument ||
        currentActiveDocument.path !== requestedPath ||
        currentActiveDocument.readOnly ||
        content === currentActiveDocument.content
      ) {
        return;
      }

      pinDocument(currentActiveDocument.path);
      if (currentActiveDocument.language === "php") {
        if (
          phpFrameworkRuntimeContext.supports("containerBindingsFromSource") &&
          phpFrameworkBindingEditorChangeRequiresInvalidation(
            currentActiveDocument.path,
            currentActiveDocument.content,
            content,
            activePhpFrameworkProviders,
            (path) => isPhpFrameworkBindingDependencyPathRef.current(path),
          )
        ) {
          invalidatePhpFrameworkBindingCacheRef.current();
        }
        resetPhpFrameworkMorphMapModelTypeCacheRef.current();
        updateLocalPhpDiagnostics(
          currentActiveDocument.path,
          localPhpDiagnosticsFromSource(content, []),
        );
      }

      if (metrics) {
        updateDocumentContent(currentActiveDocument.path, content, metrics);
      } else {
        setDocuments((current) => {
          const currentDocument = current[currentActiveDocument.path] ?? currentActiveDocument;
          return {
            ...current,
            [currentActiveDocument.path]: { ...currentDocument, content },
          };
        });
      }
      reportChangedDocuments([currentActiveDocument.path]);
    },
    [
      activeDocument,
      activeDocumentRef,
      activePhpFrameworkProviders,
      invalidatePhpFrameworkBindingCacheRef,
      isPhpFrameworkBindingDependencyPathRef,
      phpFrameworkRuntimeContext,
      pinDocument,
      reportChangedDocuments,
      resetPhpFrameworkMorphMapModelTypeCacheRef,
      setDocuments,
      updateLocalPhpDiagnostics,
      updateDocumentContent,
    ],
  );
}
