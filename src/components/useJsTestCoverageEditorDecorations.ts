import { useEffect, useMemo, useRef } from "react";
import type * as Monaco from "monaco-editor";
import { selectActiveJsTestCoverageFile } from "../application/jsTestCoverageDecorationSelection";
import type { JsTestCoverageReport } from "../domain/jsTestCoverage";
import { createJsTestCoverageReportIndex } from "../domain/jsTestCoverageDecorations";
import { isDirty, type EditorDocument } from "../domain/workspace";
import { modelMatchesWorkspacePath, modelPath } from "./phpMonacoDocumentContext";
import { toJsTestCoverageDecoration } from "./editorJsTestCoverageMonacoMappings";
import { selectVisibleJsTestCoverageDecorations } from "./jsTestCoverageDecorationWindow";

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
  const decorationOwnerRef = useRef<{
    readonly ids: readonly string[];
    readonly model: Monaco.editor.ITextModel;
  } | null>(null);
  const activeFilePath = activeDocument?.path ?? null;
  const activeFileDirty = activeDocument ? isDirty(activeDocument) : false;
  const reportIndex = useMemo(
    () => (report ? createJsTestCoverageReportIndex(report) : null),
    [report],
  );
  const coverageFile = useMemo(
    () =>
      selectActiveJsTestCoverageFile({
        activeFileDirty,
        activeFilePath,
        rootPath,
        snapshot:
          report && reportIndex && rootPath && workspaceId
            ? { index: reportIndex, report, rootPath, workspaceId }
            : null,
        workspaceId,
      }),
    [activeFileDirty, activeFilePath, report, reportIndex, rootPath, workspaceId],
  );

  useEffect(() => {
    const path = activeFilePath;
    if (!path || !coverageFile || !editor || !monaco) return;
    let animationFrame: number | null = null;
    const clearDecorationOwner = (): void => {
      const owner = decorationOwnerRef.current;
      decorationOwnerRef.current = null;
      if (
        !owner ||
        owner.model.isDisposed?.() ||
        typeof owner.model.deltaDecorations !== "function"
      ) {
        return;
      }
      owner.model.deltaDecorations([...owner.ids], []);
    };
    const refresh = (): void => {
      const model = editor.getModel();
      if (!model || model.isDisposed?.()) return;
      if (decorationOwnerRef.current?.model !== model) clearDecorationOwner();
      if (typeof model.deltaDecorations !== "function") return;
      const matches = rootPath
        ? modelMatchesWorkspacePath(model, rootPath, path)
        : modelPath(model) === path;
      if (!matches) return;
      const visibleRanges =
        typeof editor.getVisibleRanges === "function" ? editor.getVisibleRanges() : [];
      const visibleDecorations = selectVisibleJsTestCoverageDecorations(
        coverageFile.lines,
        visibleRanges,
        model.getLineCount(),
      );
      const ids = model.deltaDecorations(
        decorationOwnerRef.current?.model === model ? [...decorationOwnerRef.current.ids] : [],
        visibleDecorations.map((decoration) =>
          toJsTestCoverageDecoration(monaco, model, decoration),
        ),
      );
      decorationOwnerRef.current = { ids, model };
    };
    const scheduleRefresh = (): void => {
      if (animationFrame !== null) return;
      animationFrame = requestAnimationFrame(() => {
        animationFrame = null;
        refresh();
      });
    };
    refresh();
    const disposables = [
      editor.onDidScrollChange?.(scheduleRefresh),
      editor.onDidLayoutChange?.(scheduleRefresh),
      editor.onDidChangeModel?.(scheduleRefresh),
    ];
    return () => {
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      for (const disposable of disposables) disposable?.dispose();
      clearDecorationOwner();
    };
  }, [activeFilePath, coverageFile, editor, monaco, rootPath]);
}
