import type * as Monaco from "monaco-editor";
import type { LanguageServerDiagnostic } from "../domain/languageServerDiagnostics";
import {
  modelMatchesWorkspacePath,
  modelPath,
} from "./phpMonacoDocumentContext";

export const EDITOR_PLACEHOLDER_MODEL_PATH = "inmemory://workbench/empty";

export interface EditorRuntimeModelRetention {
  activePath: string | null;
  retainPaths: readonly string[];
}

function modelMatchesProject(
  model: Monaco.editor.ITextModel,
  workspaceRoot: string | null,
  path: string,
): boolean {
  return workspaceRoot
    ? modelMatchesWorkspacePath(model, workspaceRoot, path)
    : modelPath(model) === path;
}

export function reconcileEditorRuntimeMarkers(
  monacoApi: typeof Monaco,
  workspaceRoot: string | null,
  diagnosticsByPath: Readonly<Record<string, readonly LanguageServerDiagnostic[]>>,
  previousDiagnosticsByPath: Readonly<
    Record<string, readonly LanguageServerDiagnostic[]>
  >,
  markedModels: WeakSet<Monaco.editor.ITextModel>,
  toMarker: (
    diagnostic: LanguageServerDiagnostic,
  ) => Monaco.editor.IMarkerData,
): void {
  monacoApi.editor.getModels().forEach((model) => {
    const path = modelPath(model);

    if (!path || !modelMatchesProject(model, workspaceRoot, path)) {
      return;
    }

    const diagnostics = diagnosticsByPath[path] ?? [];
    const isNewModel = !markedModels.has(model);
    const diagnosticsChanged =
      previousDiagnosticsByPath[path] !== diagnosticsByPath[path];

    if (!isNewModel && !diagnosticsChanged) {
      return;
    }

    monacoApi.editor.setModelMarkers(
      model,
      "php-language-server",
      diagnostics.map(toMarker),
    );
    markedModels.add(model);
  });
}

export function disposeUnretainedEditorRuntimeModels(
  monacoApi: typeof Monaco,
  workspaceRoot: string | null,
  memberships: readonly EditorRuntimeModelRetention[],
  disposedModels: WeakSet<Monaco.editor.ITextModel> = new WeakSet(),
): void {
  const retainPaths = new Set<string>([EDITOR_PLACEHOLDER_MODEL_PATH]);

  memberships.forEach((membership) => {
    membership.retainPaths.forEach((path) => retainPaths.add(path));
    if (membership.activePath) {
      retainPaths.add(membership.activePath);
    }
  });

  monacoApi.editor.getModels().forEach((model) => {
    const path = modelPath(model);

    if (
      !path ||
      !modelMatchesProject(model, workspaceRoot, path) ||
      retainPaths.has(path) ||
      disposedModels.has(model)
    ) {
      return;
    }

    disposedModels.add(model);
    model.dispose();
  });
}
