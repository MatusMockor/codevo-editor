import type { MutableRefObject } from "react";
import type * as Monaco from "monaco-editor";
import type {
  EditorSurfaceCommandId,
  EditorSurfaceCommandInvocationScope,
  EditorSurfaceCommandRunner,
} from "../../domain/editorSurfaceCommand";
import { editorSurfaceCommandInvocationScopesEqual } from "../../domain/editorSurfaceCommand";
import type { EditorChangeHunk } from "../../domain/editorChangeMarkers";
import {
  nextEditorSelectionExpansionRange,
  type EditorSelectionTextRange,
} from "../../domain/editorSelectionRanges";
import {
  advanceHippieSession,
  startHippieSession,
  type HippieSession,
} from "../../domain/hippieCompletion";
import { completePhpStatement } from "../../domain/phpCompleteStatement";
import { phpMoveStatement, type MoveStatementDirection } from "../../domain/phpMoveStatement";
import { surroundWithSnippet, type SurroundWithTemplateId } from "../../domain/surroundWith";
import { editorActionForSurfaceCommand } from "../editorSurfaceCommandAction";
import { jumpToChangeHunk } from "../editorChangeMonacoMappings";
import { leadingWhitespace } from "../editorSmartIndent";
import { modelPath } from "../phpMonacoDocumentContext";

export interface SurroundWithRequest {
  eol: string;
  indent: string;
  indentUnit: string;
  path: string;
  modelUri: string;
  selection: {
    endColumn: number;
    endLineNumber: number;
    startColumn: number;
    startLineNumber: number;
  };
  text: string;
}

export function surroundWithRequestFromEditor(
  monaco: typeof Monaco,
  editor: Monaco.editor.IStandaloneCodeEditor,
): SurroundWithRequest | null {
  const model = editor.getModel();
  const selection = editor.getSelection();

  if (!model || !selection) {
    return null;
  }

  const path = modelPath(model);

  if (!path) {
    return null;
  }

  const range = surroundWithTargetRange(monaco, model, selection);
  const firstLine = model.getLineContent(range.startLineNumber);
  const indent = leadingWhitespace(firstLine);
  const text = dedentSurroundWithText(model.getValueInRange(range), indent);

  return {
    eol: model.getEOL(),
    indent,
    indentUnit: indentUnitFromModel(model),
    modelUri: model.uri.toString(),
    path,
    selection: {
      endColumn: range.endColumn,
      endLineNumber: range.endLineNumber,
      startColumn: range.startColumn,
      startLineNumber: range.startLineNumber,
    },
    text,
  };
}

function dedentSurroundWithText(text: string, indent: string): string {
  if (indent.length === 0) {
    return text;
  }

  return text
    .split(/\r\n|\r|\n/)
    .map((line) => (line.startsWith(indent) ? line.slice(indent.length) : line))
    .join("\n");
}

function surroundWithTargetRange(
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel,
  selection: Monaco.Selection,
): Monaco.Range {
  const startLineNumber = Math.min(selection.startLineNumber, selection.endLineNumber);
  const endLineNumber = Math.max(selection.startLineNumber, selection.endLineNumber);
  return new monaco.Range(startLineNumber, 1, endLineNumber, model.getLineMaxColumn(endLineNumber));
}

function indentUnitFromModel(model: Monaco.editor.ITextModel): string {
  const options = model.getOptions();

  if (!options.insertSpaces) {
    return "\t";
  }

  const size = options.indentSize || options.tabSize || 4;
  return " ".repeat(size);
}

function precedingLinesSource(model: Monaco.editor.ITextModel, lineNumber: number): string {
  if (lineNumber <= 1) {
    return "";
  }

  const lines: string[] = [];
  for (let line = 1; line < lineNumber; line += 1) {
    lines.push(model.getLineContent(line));
  }
  return `${lines.join("\n")}\n`;
}

const HIPPIE_WORD_CHAR = /[A-Za-z0-9_$]/;

export function applyCyclicExpandWord(
  monaco: typeof Monaco,
  editor: Monaco.editor.IStandaloneCodeEditor,
  sessionRef: MutableRefObject<HippieSession | null>,
): void {
  const model = editor.getModel();
  const position = editor.getPosition();

  if (!model || !position) {
    sessionRef.current = null;
    return;
  }

  const documentText = model.getValue();
  const cursorOffset = model.getOffsetAt(position);
  const session = continueOrStartHippieSession(sessionRef.current, documentText, cursorOffset);

  if (!session) {
    sessionRef.current = null;
    return;
  }

  const replaceEndOffset = currentHippieEndOffset(sessionRef.current, session);
  const startPosition = model.getPositionAt(session.anchorOffset);
  const endPosition = model.getPositionAt(replaceEndOffset);

  editor.executeEdits("mockor.cyclicExpandWord", [
    {
      forceMoveMarkers: true,
      range: new monaco.Range(
        startPosition.lineNumber,
        startPosition.column,
        endPosition.lineNumber,
        endPosition.column,
      ),
      text: session.word,
    },
  ]);

  editor.setPosition(model.getPositionAt(session.anchorOffset + session.word.length));
  sessionRef.current = session;
}

function continueOrStartHippieSession(
  previous: HippieSession | null,
  documentText: string,
  cursorOffset: number,
): HippieSession | null {
  if (previous && isLiveHippieSession(previous, documentText, cursorOffset)) {
    return advanceHippieSession(previous);
  }

  return startHippieSession(
    documentText,
    hippiePrefixBefore(documentText, cursorOffset),
    cursorOffset,
  );
}

function isLiveHippieSession(
  session: HippieSession,
  documentText: string,
  cursorOffset: number,
): boolean {
  const expectedEnd = session.anchorOffset + session.word.length;
  return (
    cursorOffset === expectedEnd &&
    documentText.slice(session.anchorOffset, expectedEnd) === session.word
  );
}

function currentHippieEndOffset(previous: HippieSession | null, session: HippieSession): number {
  return previous && previous.anchorOffset === session.anchorOffset
    ? previous.anchorOffset + previous.word.length
    : session.anchorOffset + session.prefix.length;
}

function hippiePrefixBefore(documentText: string, cursorOffset: number): string {
  let start = cursorOffset;
  while (start > 0 && HIPPIE_WORD_CHAR.test(documentText[start - 1])) {
    start -= 1;
  }
  return documentText.slice(start, cursorOffset);
}

export function applyMoveStatement(
  monaco: typeof Monaco,
  editor: Monaco.editor.IStandaloneCodeEditor,
  direction: MoveStatementDirection,
): boolean {
  const model = editor.getModel();
  const position = editor.getPosition();

  if (!model || !position) {
    return false;
  }

  const edit = phpMoveStatement(model.getValue(), position.lineNumber, direction);
  if (!edit) {
    return false;
  }

  editor.executeEdits("mockor.moveStatement", [
    {
      forceMoveMarkers: true,
      range: new monaco.Range(
        edit.startLine,
        1,
        edit.endLine,
        model.getLineMaxColumn(edit.endLine),
      ),
      text: edit.newText,
    },
  ]);
  editor.setPosition({ column: position.column, lineNumber: clampLine(model, edit.caretLine) });
  editor.focus();
  return true;
}

function clampLine(model: Monaco.editor.ITextModel, lineNumber: number): number {
  return Math.min(Math.max(lineNumber, 1), model.getLineCount());
}

export function applyCompleteStatement(
  monaco: typeof Monaco,
  editor: Monaco.editor.IStandaloneCodeEditor,
): void {
  const model = editor.getModel();
  const position = editor.getPosition();

  if (!model || !position) {
    return;
  }

  const lineNumber = position.lineNumber;
  const completion = completePhpStatement(
    model.getLineContent(lineNumber),
    position.column,
    precedingLinesSource(model, lineNumber),
  );
  if (!completion) {
    return;
  }

  const lineRange = new monaco.Range(lineNumber, 1, lineNumber, model.getLineMaxColumn(lineNumber));
  if (completion.kind === "replaceLine") {
    editor.executeEdits("mockor.completeStatement", [
      { forceMoveMarkers: true, range: lineRange, text: completion.newText },
    ]);
    editor.setPosition({ column: completion.caretColumn, lineNumber });
    editor.focus();
    return;
  }

  insertStatementBlock(monaco, editor, model, completion, lineRange);
}

function insertStatementBlock(
  monaco: typeof Monaco,
  editor: Monaco.editor.IStandaloneCodeEditor,
  model: Monaco.editor.ITextModel,
  completion: { indent: string; keepHeader: string },
  lineRange: Monaco.Range,
): void {
  const eol = model.getEOL();
  const bodyIndent = completion.indent + indentUnitFromModel(model);
  const snippetController =
    editor.getContribution<SnippetInsertingContribution>("snippetController2");

  if (snippetController) {
    editor.setSelection(
      new monaco.Selection(
        lineRange.startLineNumber,
        lineRange.startColumn,
        lineRange.endLineNumber,
        lineRange.endColumn,
      ),
    );
    snippetController.insert(
      `${escapeStatementSnippet(completion.keepHeader)}${eol}${escapeStatementSnippet(bodyIndent)}$0${eol}${escapeStatementSnippet(completion.indent)}}`,
    );
    editor.focus();
    return;
  }

  editor.executeEdits("mockor.completeStatement", [
    {
      forceMoveMarkers: true,
      range: lineRange,
      text: `${completion.keepHeader}${eol}${bodyIndent}${eol}${completion.indent}}`,
    },
  ]);
  editor.setPosition({
    column: bodyIndent.length + 1,
    lineNumber: lineRange.startLineNumber + 1,
  });
  editor.focus();
}

function escapeStatementSnippet(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\$/g, "\\$").replace(/}/g, "\\}");
}

export function applySurroundWith(
  monaco: typeof Monaco,
  editor: Monaco.editor.IStandaloneCodeEditor,
  request: SurroundWithRequest,
  templateId: SurroundWithTemplateId,
): void {
  const model = editor.getModel();
  if (!model || model.uri.toString() !== request.modelUri || modelPath(model) !== request.path) {
    return;
  }

  const snippet = surroundWithSnippet({
    eol: request.eol,
    id: templateId,
    indent: request.indent,
    indentUnit: request.indentUnit,
    text: request.text,
  });

  editor.focus();
  editor.setSelection(
    new monaco.Selection(
      request.selection.startLineNumber,
      request.selection.startColumn,
      request.selection.endLineNumber,
      request.selection.endColumn,
    ),
  );

  const snippetController =
    editor.getContribution<SnippetInsertingContribution>("snippetController2");
  if (snippetController) {
    snippetController.insert(snippet);
    return;
  }

  editor.executeEdits("mockor.surroundWith", [
    {
      forceMoveMarkers: true,
      range: new monaco.Range(
        request.selection.startLineNumber,
        request.selection.startColumn,
        request.selection.endLineNumber,
        request.selection.endColumn,
      ),
      text: plainSnippetText(snippet),
    },
  ]);
}

function plainSnippetText(snippet: string): string {
  return snippet
    .replace(/(?<!\\)\$\{\d+:((?:\\.|[^}])*)\}/g, "$1")
    .replace(/(?<!\\)\$0/g, "")
    .replace(/\\([$}\\])/g, "$1");
}

interface SnippetInsertingContribution extends Monaco.editor.IEditorContribution {
  insert(template: string): void;
}

export function triggerEditorAction(
  editor: Monaco.editor.IStandaloneCodeEditor,
  actionId: string,
): void {
  if (editor.getModel()) {
    editor.trigger("keyboard", actionId, {});
  }
}

export function triggerEditorSurfaceCommand(
  editor: Monaco.editor.IStandaloneCodeEditor,
  commandId: EditorSurfaceCommandId,
): void {
  if (!editor.getModel() || (commandId === "editor.quickFix" && !editor.getPosition())) {
    return;
  }

  const actionId = editorActionForSurfaceCommand(commandId);
  if (actionId) {
    editor.trigger("keyboard", actionId, {});
  }
}

export function createEditorSurfaceCommandRunner({
  captureScope,
  changeHunksRef,
  editor,
  isImportActionEnabled,
  runImportAction,
}: {
  captureScope(): EditorSurfaceCommandInvocationScope | null;
  changeHunksRef: MutableRefObject<readonly EditorChangeHunk[]>;
  editor: Monaco.editor.IStandaloneCodeEditor;
  isImportActionEnabled(commandId: EditorSurfaceCommandId): boolean;
  runImportAction(commandId: EditorSurfaceCommandId): void;
}): EditorSurfaceCommandRunner {
  const runner: EditorSurfaceCommandRunner = (commandId, scope) => {
    if (scope && !runner.isScopeCurrent?.(scope)) {
      return;
    }
    if (!captureScope()) {
      return;
    }
    if (isEditorSurfaceImportCommand(commandId)) {
      if (isImportActionEnabled(commandId)) {
        editor.focus();
        runImportAction(commandId);
      }
      return;
    }

    editor.focus();
    if (commandId === "editor.nextChange" || commandId === "editor.previousChange") {
      jumpToChangeHunk(
        editor,
        changeHunksRef.current,
        commandId === "editor.nextChange" ? "next" : "previous",
      );
      return;
    }
    triggerEditorSurfaceCommand(editor, commandId);
  };

  runner.captureScope = captureScope;
  runner.isScopeCurrent = (scope) => {
    const currentScope = captureScope();
    return currentScope ? editorSurfaceCommandInvocationScopesEqual(scope, currentScope) : false;
  };
  runner.isEnabled = (commandId, scope) => {
    if ((scope && !runner.isScopeCurrent?.(scope)) || !captureScope()) {
      return false;
    }
    if (isEditorSurfaceImportCommand(commandId)) {
      return isImportActionEnabled(commandId);
    }
    if (commandId === "editor.nextChange" || commandId === "editor.previousChange") {
      return changeHunksRef.current.length > 0;
    }
    return true;
  };
  return runner;
}

function isEditorSurfaceImportCommand(commandId: EditorSurfaceCommandId): boolean {
  return (
    commandId === "editor.action.organizeImports" ||
    commandId === "typescript.sortImports" ||
    commandId === "javascript.sortImports" ||
    commandId === "typescript.removeUnusedImports" ||
    commandId === "javascript.removeUnusedImports"
  );
}

export function expandEditorSelection(
  monaco: typeof Monaco,
  editor: Monaco.editor.IStandaloneCodeEditor,
): boolean {
  const model = editor.getModel();
  const position = editor.getPosition();
  if (!model || !position) {
    return false;
  }

  const nextRange = nextEditorSelectionExpansionRange(
    model.getLineContent(position.lineNumber),
    position.column - 1,
    currentEditorTextRange(position, editor.getSelection()),
  );
  if (!nextRange) {
    return false;
  }

  editor.setSelection(
    new monaco.Range(
      position.lineNumber,
      nextRange.start + 1,
      position.lineNumber,
      nextRange.end + 1,
    ),
  );
  return true;
}

function currentEditorTextRange(
  position: Monaco.Position,
  selection: Monaco.Selection | null,
): EditorSelectionTextRange {
  if (!selection || selection.startLineNumber !== selection.endLineNumber) {
    const offset = Math.max(0, position.column - 1);
    return { end: offset, start: offset };
  }

  return {
    end: Math.max(selection.startColumn, selection.endColumn) - 1,
    start: Math.min(selection.startColumn, selection.endColumn) - 1,
  };
}
