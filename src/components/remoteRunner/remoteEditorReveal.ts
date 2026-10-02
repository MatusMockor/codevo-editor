export interface RemoteEditorPosition {
  readonly lineNumber: number;
  readonly column: number;
}

export interface RemoteEditorRevealSurface {
  getModel(): {
    getLineCount(): number;
    getLineMaxColumn(lineNumber: number): number;
  } | null;
  setPosition(position: RemoteEditorPosition): void;
  revealPositionInCenter(position: RemoteEditorPosition): void;
}

export interface RemoteEditorRevealTarget {
  readonly line: number | null;
  readonly column: number | null;
}

export function revealRemoteEditorLocation(
  editor: RemoteEditorRevealSurface,
  target: RemoteEditorRevealTarget,
): RemoteEditorPosition | null {
  if (target.line === null) return null;
  const model = editor.getModel();
  if (model === null) return null;
  const lineNumber = Math.max(1, Math.min(target.line, model.getLineCount()));
  const column = Math.max(1, Math.min(target.column ?? 1, model.getLineMaxColumn(lineNumber)));
  const position = { lineNumber, column };
  editor.setPosition(position);
  editor.revealPositionInCenter(position);
  return position;
}
