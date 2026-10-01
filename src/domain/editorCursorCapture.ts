export interface EditorCursorPosition {
  readonly column: number;
  readonly lineNumber: number;
}

export interface EditorCursorCapture {
  readonly content: string;
  readonly documentPath: string;
  readonly modelIdentity: string;
  readonly modelVersion: number;
  readonly position: EditorCursorPosition;
  readonly workspaceOwnerKey: string;
  readonly workspaceRoot: string;
}

export interface EditorCursorCaptureReader {
  readEditorCursorCapture(): EditorCursorCapture | null;
}

export function editorCursorCapturesEqual(
  left: EditorCursorCapture,
  right: EditorCursorCapture,
): boolean {
  return (
    left.content === right.content &&
    left.documentPath === right.documentPath &&
    left.modelIdentity === right.modelIdentity &&
    left.modelVersion === right.modelVersion &&
    left.position.lineNumber === right.position.lineNumber &&
    left.position.column === right.position.column &&
    left.workspaceOwnerKey === right.workspaceOwnerKey &&
    left.workspaceRoot === right.workspaceRoot
  );
}
