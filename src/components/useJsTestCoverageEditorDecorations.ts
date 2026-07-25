import { useEffect, useMemo, useRef } from "react";
import type * as Monaco from "monaco-editor";
import { selectActiveJsTestCoverageDecorations } from "../application/jsTestCoverageDecorationSelection";
import type { JsTestCoverageReport } from "../domain/jsTestCoverage";
import { isDirty, type EditorDocument } from "../domain/workspace";
import { modelMatchesWorkspacePath, modelPath } from "./phpMonacoDocumentContext";
import { toJsTestCoverageDecoration } from "./editorJsTestCoverageMonacoMappings";

interface JsTestCoverageEditorDecorationOptions {
  readonly activeDocument: EditorDocument | null;
  readonly editor: Monaco.editor.IStandaloneCodeEditor | null;
  readonly monaco: typeof Monaco | null;
  readonly report: JsTestCoverageReport | null;
  readonly rootPath: string | null;
  readonly workspaceId: string | null;
}

export function useJsTestCoverageEditorDecorations({
  activeDocument,
  editor,
  monaco,
  report,
  rootPath,
  workspaceId,
}: JsTestCoverageEditorDecorationOptions): void {
  const decorationIdsRef = useRef<string[]>([]);
  const activeFilePath = activeDocument?.path ?? null;
  const activeFileDirty = activeDocument ? isDirty(activeDocument) : false;
  const decorations = useMemo(
    () =>
      selectActiveJsTestCoverageDecorations({
        activeFileDirty,
        activeFilePath,
        rootPath,
        snapshot: report && rootPath && workspaceId ? { report, rootPath, workspaceId } : null,
        workspaceId,
      }),
    [activeFileDirty, activeFilePath, report, rootPath, workspaceId],
  );

  useEffect(() => {
    const path = activeFilePath;
    const model = editor?.getModel();
    if (!path || !editor || !monaco || !model || model.isDisposed?.()) return;
    const matches = rootPath
      ? modelMatchesWorkspacePath(model, rootPath, path)
      : modelPath(model) === path;
    if (!matches) return;
    const visibleDecorations =
      decorations.length === 0
        ? decorations
        : decorations.filter(
            ({ lineNumber }) => lineNumber >= 1 && lineNumber <= model.getLineCount(),
          );

    decorationIdsRef.current = editor.deltaDecorations(
      decorationIdsRef.current,
      visibleDecorations.map((decoration) => toJsTestCoverageDecoration(monaco, model, decoration)),
    );
    return () => {
      decorationIdsRef.current = editor.deltaDecorations(decorationIdsRef.current, []);
    };
  }, [activeFilePath, decorations, editor, monaco, rootPath]);
}
