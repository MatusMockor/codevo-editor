import type {
  Dispatch,
  MutableRefObject,
  SetStateAction,
} from "react";
import type { LanguageServerDiagnostic } from "../domain/languageServerDiagnostics";
import type { EditorDocument } from "../domain/workspace";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import type { PhpFrameworkTargets } from "./usePhpFrameworkTargets";
import { usePhpFrameworkActiveDocumentDiagnostics } from "./usePhpFrameworkActiveDocumentDiagnostics";

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
  const { provideFrameworkDiagnosticsForActiveDocument } =
    usePhpFrameworkActiveDocumentDiagnostics({
      activeDocument,
      activeDocumentRef,
      collectViewTargets,
      currentWorkspaceRootRef,
      frameworkRuntime,
      setFrameworkDiagnosticsByPath: setLaravelDiagnosticsByPath,
      workspaceRoot,
    });

  return {
    provideLaravelDiagnosticsForActiveDocument:
      provideFrameworkDiagnosticsForActiveDocument,
  };
}
