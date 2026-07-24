import type { DebugHoverPosition } from "./debugHoverExpression";

/** Framework-neutral immutable editor snapshot used by Add to Watch at Cursor. */
export interface DebugWatchAtCursorCapture {
  readonly content: string;
  readonly documentPath: string;
  readonly modelIdentity: string;
  readonly modelVersion: number;
  readonly position: DebugHoverPosition;
  readonly workspaceOwnerKey: string;
  readonly workspaceRoot: string;
}

/** Synchronous reader implemented by the active editor surface. */
export interface DebugWatchAtCursorCaptureReader {
  readDebugWatchAtCursorCapture(): DebugWatchAtCursorCapture | null;
}

export function isDebugWatchAtCursorDocumentPath(path: string): boolean {
  return /\.(?:[cm]?[jt]s|[jt]sx)$/iu.test(path);
}

export function debugWatchAtCursorCapturesEqual(
  left: DebugWatchAtCursorCapture,
  right: DebugWatchAtCursorCapture,
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
