import { useEffect, useRef } from "react";
import type * as Monaco from "monaco-editor";
import type { DebugInlineValueContext } from "../application/debugInlineValueContext";
import {
  MAX_DEBUG_INLINE_SOURCE_BYTES,
  MAX_DEBUG_INLINE_SOURCE_LINES,
  selectDebugInlineValues,
} from "../domain/debugInlineValues";
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

interface DebugInlineModelSnapshot {
  readonly source: string;
  readonly version: number;
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
    normalizedWorkspaceRootKey(workspaceRoot) !== context.owner.rootKey
  ) {
    return [];
  }
  const snapshot = captureDebugInlineModelSnapshot(model);
  return createDebugInlineValueDecorationsFromSnapshot(
    { activeDocument, context, model, monaco, workspaceRoot },
    snapshot,
  );
}

function createDebugInlineValueDecorationsFromSnapshot(
  {
    activeDocument,
    context,
    monaco,
  }: DebugInlineDecorationSelection & {
    readonly activeDocument: EditorDocument;
    readonly context: DebugInlineValueContext;
    readonly model: Monaco.editor.ITextModel;
    readonly monaco: typeof Monaco;
    readonly workspaceRoot: string;
  },
  snapshot: DebugInlineModelSnapshot | null,
): Monaco.editor.IModelDeltaDecoration[] {
  if (!snapshot || snapshot.source !== activeDocument.content) return [];
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

function captureDebugInlineModelSnapshot(
  model: Monaco.editor.ITextModel,
): DebugInlineModelSnapshot | null {
  try {
    const version = model.getVersionId();
    const valueLength = model.getValueLength();
    const lineCount = model.getLineCount();
    if (
      !Number.isSafeInteger(version) ||
      !Number.isSafeInteger(valueLength) ||
      valueLength < 0 ||
      valueLength > MAX_DEBUG_INLINE_SOURCE_BYTES ||
      !Number.isSafeInteger(lineCount) ||
      lineCount <= 0 ||
      lineCount > MAX_DEBUG_INLINE_SOURCE_LINES
    ) {
      return null;
    }
    const source = model.getValue();
    if (
      model.getVersionId() !== version ||
      model.getValueLength() !== valueLength ||
      model.getLineCount() !== lineCount ||
      source.length !== valueLength
    ) {
      return null;
    }
    return { source, version };
  } catch {
    return null;
  }
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
    if (!model || !monaco || editor.getModel() !== model) {
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
    if (!targetsStoppedSource || !activeDocument || !context || !workspaceRoot) {
      clear();
      return;
    }
    const snapshot = captureDebugInlineModelSnapshot(model);
    if (
      !snapshot ||
      !coordinator.admit({
        dirty: isDirty(activeDocument),
        model,
        modelSource: snapshot.source,
        owner: context.owner,
        path: context.filePath,
        source: activeDocument.content,
      })
    ) {
      clear();
      return;
    }
    const decorations = createDebugInlineValueDecorationsFromSnapshot(
      {
        activeDocument,
        context,
        model,
        monaco,
        workspaceRoot,
      },
      snapshot,
    );
    if (decorationIds.current.length === 0 && decorations.length === 0) return;
    decorationIds.current = editor.deltaDecorations(decorationIds.current, decorations);
    return clear;
  }, [activeDocument, context, coordinator, editor, model, monaco, workspaceRoot]);
}
