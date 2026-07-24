import { useEffect, useMemo, useReducer, useRef } from "react";
import type * as Monaco from "monaco-editor";
import { selectJsTestProblemDecorations } from "../application/jsTestProblemDecorationSelection";
import type { JsTestExplorerCurrentFileIdentity } from "../domain/jsTestExplorerFilter";
import type { JsTestProblemEntry, JsTestProblemsSnapshot } from "../domain/jsTestProblems";
import { isDirty, type EditorDocument } from "../domain/workspace";
import { modelMatchesWorkspacePath } from "./phpMonacoDocumentContext";
import { toJsTestProblemMonacoDecoration } from "./editorJsTestProblemMonacoMappings";

export interface JsTestProblemEditorDecorationOptions {
  readonly activeDocument: EditorDocument | null;
  readonly currentFileIdentity: JsTestExplorerCurrentFileIdentity | null;
  readonly editor: Monaco.editor.IStandaloneCodeEditor | null;
  readonly model: Monaco.editor.ITextModel | null;
  readonly monaco: typeof Monaco | null;
  readonly rootPath: string | null;
  readonly snapshot: JsTestProblemsSnapshot | null;
}

/**
 * Presentation-only owner for JavaScript test failure decorations in one mounted editor.
 * Canonical owner/path selection stays in the application selector.
 */
export function useJsTestProblemEditorDecorations({
  activeDocument,
  currentFileIdentity,
  editor,
  model,
  monaco,
  rootPath,
  snapshot,
}: JsTestProblemEditorDecorationOptions): void {
  const decorationIdsRef = useRef<string[]>([]);
  const [, invalidateModel] = useReducer((revision: number) => revision + 1, 0);
  const selectedLines = useMemo(
    () =>
      safeSelectDecorations({
        activeDocument,
        currentFileIdentity,
        snapshot,
      }),
    [activeDocument, currentFileIdentity, snapshot],
  );

  useEffect(() => {
    if (!editor || typeof editor.onDidChangeModel !== "function") return;
    const subscription = safeSubscription(() =>
      editor.onDidChangeModel(() => {
        clearDecorations(editor, decorationIdsRef);
        invalidateModel();
      }),
    );
    return () => subscription?.dispose?.();
  }, [editor]);

  useEffect(() => {
    const clear = (): void => {
      if (editor) clearDecorations(editor, decorationIdsRef);
    };
    if (!editor || selectedLines.length === 0) {
      clear();
      return;
    }
    if (
      !activeDocument ||
      !model ||
      !monaco ||
      !rootPath ||
      safeEditorModel(editor) !== model ||
      safeModelIsDisposed(model) ||
      isDirty(activeDocument) ||
      !safeModelMatchesDocument(model, rootPath, activeDocument.path) ||
      safeModelValue(model) !== activeDocument.content ||
      !validSelectedLines(selectedLines, safeModelLineCount(model))
    ) {
      clear();
      return;
    }

    const decorations = safeMonacoDecorations(monaco, model, selectedLines);
    if (!decorations) {
      clear();
      return;
    }
    try {
      decorationIdsRef.current = editor.deltaDecorations(decorationIdsRef.current, decorations);
    } catch {
      decorationIdsRef.current = [];
      return;
    }
    const contentSubscription =
      typeof editor.onDidChangeModelContent === "function"
        ? safeSubscription(() => editor.onDidChangeModelContent(clear))
        : null;
    const disposeSubscription =
      typeof model.onWillDispose === "function"
        ? safeSubscription(() => model.onWillDispose(clear))
        : null;

    return () => {
      contentSubscription?.dispose?.();
      disposeSubscription?.dispose?.();
      clear();
    };
  }, [activeDocument, editor, model, monaco, rootPath, selectedLines]);
}

function safeSubscription(subscribe: () => Monaco.IDisposable): Monaco.IDisposable | null {
  try {
    return subscribe();
  } catch {
    return null;
  }
}

function safeEditorModel(
  editor: Monaco.editor.IStandaloneCodeEditor,
): Monaco.editor.ITextModel | null {
  try {
    return typeof editor.getModel === "function" ? editor.getModel() : null;
  } catch {
    return null;
  }
}

function clearDecorations(
  editor: Monaco.editor.IStandaloneCodeEditor,
  decorationIdsRef: { current: string[] },
): void {
  if (decorationIdsRef.current.length === 0 || typeof editor.deltaDecorations !== "function")
    return;
  try {
    decorationIdsRef.current = editor.deltaDecorations(decorationIdsRef.current, []);
  } catch {
    decorationIdsRef.current = [];
  }
}

function safeModelIsDisposed(model: Monaco.editor.ITextModel): boolean {
  try {
    return typeof model.isDisposed === "function" ? model.isDisposed() : false;
  } catch {
    return true;
  }
}

function safeModelValue(model: Monaco.editor.ITextModel): string | null {
  try {
    return typeof model.getValue === "function" ? model.getValue() : null;
  } catch {
    return null;
  }
}

function safeModelLineCount(model: Monaco.editor.ITextModel): number {
  try {
    return typeof model.getLineCount === "function" ? model.getLineCount() : -1;
  } catch {
    return -1;
  }
}

function safeMonacoDecorations(
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel,
  lines: ReturnType<typeof selectJsTestProblemDecorations>,
): Monaco.editor.IModelDeltaDecoration[] | null {
  try {
    if (typeof model.getLineLength !== "function") return null;
    return lines.map((line) => toJsTestProblemMonacoDecoration(monaco, model, line));
  } catch {
    return null;
  }
}

function safeSelectDecorations(
  input: Parameters<typeof selectJsTestProblemDecorations>[0],
): ReturnType<typeof selectJsTestProblemDecorations> {
  try {
    return selectJsTestProblemDecorations(input);
  } catch {
    return Object.freeze([]);
  }
}

function safeModelMatchesDocument(
  model: Monaco.editor.ITextModel,
  rootPath: string,
  documentPath: string,
): boolean {
  try {
    return modelMatchesWorkspacePath(model, rootPath, documentPath);
  } catch {
    return false;
  }
}

function validSelectedLines(
  lines: ReturnType<typeof selectJsTestProblemDecorations>,
  lineCount: number,
): boolean {
  if (!Array.isArray(lines) || !Number.isSafeInteger(lineCount) || lineCount < 0) return false;
  const seen = new Set<number>();
  for (const line of lines) {
    if (
      !line ||
      !Number.isSafeInteger(line.lineNumber) ||
      line.lineNumber <= 0 ||
      line.lineNumber > lineCount ||
      !Array.isArray(line.entries) ||
      line.entries.length === 0 ||
      seen.has(line.lineNumber) ||
      line.entries.some((entry: JsTestProblemEntry) => entry.lineNumber !== line.lineNumber)
    ) {
      return false;
    }
    seen.add(line.lineNumber);
  }
  return true;
}
