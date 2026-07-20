import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { LanguageServerDiagnostic } from "../domain/languageServerDiagnostics";
import type { EditorDocument } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { PhpFrameworkActiveDocumentDiagnosticsContributionCatalog } from "./phpFrameworkActiveDocumentDiagnosticsContributionCatalog";
import { activePhpFrameworkDocumentDiagnosticsProvider } from "./phpFrameworkActiveDocumentDiagnosticsRegistry";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";

export interface PhpFrameworkActiveDocumentDiagnosticsHookDependencies {
  activeDocument: EditorDocument | null;
  activeDocumentRef: MutableRefObject<EditorDocument | null>;
  contributions: PhpFrameworkActiveDocumentDiagnosticsContributionCatalog;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  frameworkRuntime: PhpFrameworkRuntimeContext;
  setFrameworkDiagnosticsByPath: Dispatch<
    SetStateAction<Record<string, LanguageServerDiagnostic[]>>
  >;
  workspaceRoot: string | null;
}

export interface PhpFrameworkActiveDocumentDiagnosticsHook {
  provideFrameworkDiagnosticsForActiveDocument: () => Promise<void>;
}

export function usePhpFrameworkActiveDocumentDiagnostics({
  activeDocument,
  activeDocumentRef,
  contributions,
  currentWorkspaceRootRef,
  frameworkRuntime,
  setFrameworkDiagnosticsByPath,
  workspaceRoot,
}: PhpFrameworkActiveDocumentDiagnosticsHookDependencies): PhpFrameworkActiveDocumentDiagnosticsHook {
  const diagnosticValidationGenerationRef = useRef(0);

  const provideFrameworkDiagnosticsForActiveDocument = useCallback(async () => {
    const document = activeDocumentRef.current;
    const requestedRoot = workspaceRoot;
    const generation = diagnosticValidationGenerationRef.current + 1;
    diagnosticValidationGenerationRef.current = generation;
    const isRequestedStateActive = () =>
      diagnosticValidationGenerationRef.current === generation &&
      workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot) &&
      activeDocumentRef.current?.path === document?.path &&
      activeDocumentRef.current?.content === document?.content;

    const provider =
      requestedRoot && document
        ? activePhpFrameworkDocumentDiagnosticsProvider({
            contributions,
            document,
            frameworkRuntime,
            workspaceRoot: requestedRoot,
          })
        : null;

    if (!provider || !document) {
      if (document?.path) {
        setFrameworkDiagnosticsByPath((current) => {
          if (!(document.path in current)) {
            return current;
          }

          const next = { ...current };
          delete next[document.path];
          return next;
        });
      }

      return;
    }

    const diagnostics = await provider.provideDiagnostics();

    if (!isRequestedStateActive()) {
      return;
    }

    setFrameworkDiagnosticsByPath((current) => {
      if (diagnostics.length === 0) {
        if (!(document.path in current)) {
          return current;
        }

        const next = { ...current };
        delete next[document.path];
        return next;
      }

      return {
        ...current,
        [document.path]: diagnostics,
      };
    });
  }, [
    activeDocumentRef,
    contributions,
    currentWorkspaceRootRef,
    frameworkRuntime,
    setFrameworkDiagnosticsByPath,
    workspaceRoot,
  ]);

  useEffect(() => {
    void provideFrameworkDiagnosticsForActiveDocument();
  }, [
    activeDocument?.content,
    activeDocument?.language,
    activeDocument?.path,
    provideFrameworkDiagnosticsForActiveDocument,
  ]);

  return { provideFrameworkDiagnosticsForActiveDocument };
}
