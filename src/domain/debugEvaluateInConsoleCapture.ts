export interface DebugEditorSelectionRange {
  readonly endColumn: number;
  readonly endLineNumber: number;
  readonly startColumn: number;
  readonly startLineNumber: number;
}

/** Framework-neutral immutable active-editor snapshot for explicit REPL evaluation. */
export interface DebugEvaluateInConsoleCapture {
  readonly currentLineText: string;
  readonly documentPath: string;
  readonly focused: boolean;
  readonly modelIdentity: string;
  readonly modelVersion: number;
  readonly selection: DebugEditorSelectionRange;
  readonly selectionText: string;
  readonly workspaceOwnerKey: string;
  readonly workspaceRoot: string;
}

export interface DebugEvaluateInConsoleCaptureReader {
  readDebugEvaluateInConsoleCapture(): DebugEvaluateInConsoleCapture | null;
}

export function debugEvaluateInConsoleCapturesEqual(
  left: DebugEvaluateInConsoleCapture,
  right: DebugEvaluateInConsoleCapture,
): boolean {
  return (
    left.currentLineText === right.currentLineText &&
    left.documentPath === right.documentPath &&
    left.focused === right.focused &&
    left.modelIdentity === right.modelIdentity &&
    left.modelVersion === right.modelVersion &&
    left.selectionText === right.selectionText &&
    left.selection.startLineNumber === right.selection.startLineNumber &&
    left.selection.startColumn === right.selection.startColumn &&
    left.selection.endLineNumber === right.selection.endLineNumber &&
    left.selection.endColumn === right.selection.endColumn &&
    left.workspaceOwnerKey === right.workspaceOwnerKey &&
    left.workspaceRoot === right.workspaceRoot
  );
}
