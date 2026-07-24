import { useEffect, useRef } from "react";
import type * as Monaco from "monaco-editor";
import type { DebugInlineValueContext } from "../application/debugInlineValueContext";
import { selectDebugInlineValues } from "../domain/debugInlineValues";
import { isDirty, type EditorDocument } from "../domain/workspace";
import { normalizedWorkspaceRootKey } from "../domain/workspaceRootKey";
import {
  debugInlineSourceAdmissionCoordinator,
  type DebugInlineSourceAdmissionCoordinator,
} from "./debugInlineSourceAdmissionCoordinator";

const supportedLanguages = new Set([
  "javascript",
  "javascriptreact",
  "typescript",
  "typescriptreact",
]);

interface DebugInlineDecorationSelection {
  readonly activeDocument: EditorDocument | null;
  readonly context: DebugInlineValueContext | null;
  readonly model: Monaco.editor.ITextModel | null;
  readonly monaco: typeof Monaco | null;
  readonly workspaceRoot: string | null;
}

export function createDebugInlineValueDecorations({
  activeDocument,
  context,
  model,
  monaco,
  workspaceRoot,
}: DebugInlineDecorationSelection): Monaco.editor.IModelDeltaDecoration[] {
  if (
    !activeDocument ||
    !context ||
    !model ||
    !monaco ||
    !workspaceRoot ||
    !supportedLanguages.has(activeDocument.language) ||
    isDirty(activeDocument) ||
    activeDocument.path !== context.filePath ||
    normalizedWorkspaceRootKey(workspaceRoot) !== context.owner.rootKey ||
    model.getValue() !== activeDocument.content ||
    context.lineNumber > model.getLineCount()
  ) {
    return [];
  }
  return selectDebugInlineValues({
    lineNumber: context.lineNumber,
    owner: context.owner,
    scopes: context.scopes,
    source: activeDocument.content,
    variablePages: context.variablePages,
  }).map(({ content, range }) => ({
    options: {
      after: { content, inlineClassName: "debug-inline-value" },
      stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
    },
    range: new monaco.Range(
      range.startLineNumber,
      range.startColumn,
      range.endLineNumber,
      range.endColumn,
    ),
  }));
}

export function useDebugInlineValueDecorations({
  activeDocument,
  context,
  coordinator = debugInlineSourceAdmissionCoordinator,
  editor,
  model,
  monaco,
  workspaceRoot,
}: DebugInlineDecorationSelection & {
  readonly coordinator?: DebugInlineSourceAdmissionCoordinator;
  readonly editor: Monaco.editor.IStandaloneCodeEditor | null;
}): void {
  const decorationIds = useRef<string[]>([]);
  useEffect(() => {
    if (context) coordinator.beginOwner(context.owner);
    if (!editor) return;
    const clear = () => {
      if (decorationIds.current.length === 0) return;
      decorationIds.current = editor.deltaDecorations(decorationIds.current, []);
    };
    if (!model || editor.getModel() !== model) {
      clear();
      return;
    }
    const targetsStoppedSource = Boolean(
      activeDocument &&
      context &&
      workspaceRoot &&
      activeDocument.path === context.filePath &&
      normalizedWorkspaceRootKey(workspaceRoot) === context.owner.rootKey,
    );
    if (!targetsStoppedSource || !activeDocument || !context) {
      clear();
      return;
    }
    if (
      !coordinator.admit({
        dirty: isDirty(activeDocument),
        model,
        modelSource: model.getValue(),
        owner: context.owner,
        path: context.filePath,
        source: activeDocument.content,
      })
    ) {
      clear();
      return;
    }
    const decorations = createDebugInlineValueDecorations({
      activeDocument,
      context,
      model,
      monaco,
      workspaceRoot,
    });
    if (decorationIds.current.length === 0 && decorations.length === 0) return;
    decorationIds.current = editor.deltaDecorations(decorationIds.current, decorations);
    return clear;
  }, [activeDocument, context, coordinator, editor, model, monaco, workspaceRoot]);
}
