export const MAX_DEBUG_INLINE_BREAKPOINT_FOCUS_EPOCH = 4_294_967_295;

export interface DebugInlineBreakpointCapture {
  readonly columnNumber: number;
  readonly documentPath: string;
  readonly focusEpoch: number;
  readonly focused: boolean;
  readonly lineNumber: number;
  readonly modelIdentity: string;
  readonly modelVersion: number;
  readonly workspaceOwnerKey: string;
  readonly workspaceRoot: string;
  readonly writable: boolean;
}

export interface DebugInlineBreakpointCaptureReader {
  readDebugInlineBreakpointCapture(): DebugInlineBreakpointCapture | null;
}

export function debugInlineBreakpointCapturesEqual(
  left: DebugInlineBreakpointCapture,
  right: DebugInlineBreakpointCapture,
): boolean {
  return (
    left.columnNumber === right.columnNumber &&
    left.documentPath === right.documentPath &&
    left.focusEpoch === right.focusEpoch &&
    left.focused === right.focused &&
    left.lineNumber === right.lineNumber &&
    left.modelIdentity === right.modelIdentity &&
    left.modelVersion === right.modelVersion &&
    left.workspaceOwnerKey === right.workspaceOwnerKey &&
    left.workspaceRoot === right.workspaceRoot &&
    left.writable === right.writable
  );
}
