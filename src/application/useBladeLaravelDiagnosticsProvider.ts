import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { LanguageServerDiagnostic } from "../domain/languageServerDiagnostics";
import {
  bladeLaravelReferenceDiagnostics,
} from "../domain/laravelDiagnostics";
import type { EditorDocument } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import type { PhpFrameworkTargets } from "./usePhpFrameworkTargets";

export interface BladeLaravelDiagnosticsProviderDependencies {
  activeDocument: EditorDocument | null;
  activeDocumentRef: MutableRefObject<EditorDocument | null>;
  collectViewTargets: PhpFrameworkTargets["collectViewTargets"];
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  frameworkRuntime: PhpFrameworkRuntimeContext;
  setLaravelDiagnosticsByPath: Dispatch<
    SetStateAction<Record<string, LanguageServerDiagnostic[]>>
  >;
  workspaceRoot: string | null;
}

export interface BladeLaravelDiagnosticsProvider {
  provideLaravelDiagnosticsForActiveDocument: () => Promise<void>;
}

export function useBladeLaravelDiagnosticsProvider({
  activeDocument,
  activeDocumentRef,
  collectViewTargets,
  currentWorkspaceRootRef,
  frameworkRuntime,
  setLaravelDiagnosticsByPath,
  workspaceRoot,
}: BladeLaravelDiagnosticsProviderDependencies): BladeLaravelDiagnosticsProvider {
  const laravelDiagnosticValidationGenerationRef = useRef(0);

  const provideLaravelDiagnosticsForActiveDocument = useCallback(async () => {
    const document = activeDocumentRef.current;
    const requestedRoot = workspaceRoot;
    const generation = laravelDiagnosticValidationGenerationRef.current + 1;
    laravelDiagnosticValidationGenerationRef.current = generation;
    const isRequestedStateActive = () =>
      laravelDiagnosticValidationGenerationRef.current === generation &&
      workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot) &&
      activeDocumentRef.current?.path === document?.path &&
      activeDocumentRef.current?.content === document?.content;

    if (
      !requestedRoot ||
      !document ||
      !frameworkRuntime.isLaravel ||
      document.language !== "blade"
    ) {
      if (document?.path) {
        setLaravelDiagnosticsByPath((current) => {
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

    const viewTargets = await collectViewTargets();

    if (!isRequestedStateActive()) {
      return;
    }

    const diagnostics = bladeLaravelReferenceDiagnostics(document.content, {
      viewNames: viewTargets.map((target) => target.name),
    });

    setLaravelDiagnosticsByPath((current) => {
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
    collectViewTargets,
    currentWorkspaceRootRef,
    frameworkRuntime,
    setLaravelDiagnosticsByPath,
    workspaceRoot,
  ]);

  useEffect(() => {
    void provideLaravelDiagnosticsForActiveDocument();
  }, [
    activeDocument?.content,
    activeDocument?.language,
    activeDocument?.path,
    provideLaravelDiagnosticsForActiveDocument,
  ]);

  return { provideLaravelDiagnosticsForActiveDocument };
}
