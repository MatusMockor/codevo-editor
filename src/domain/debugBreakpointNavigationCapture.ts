export interface DebugBreakpointNavigationCapture {
  readonly columnNumber: number;
  readonly documentPath: string;
  readonly focused: boolean;
  readonly lineNumber: number;
  readonly modelIdentity: string;
  readonly modelVersion: number;
  readonly workspaceOwnerKey: string;
  readonly workspaceRoot: string;
}

export interface DebugBreakpointNavigationCaptureReader {
  readDebugBreakpointNavigationCapture(): DebugBreakpointNavigationCapture | null;
}

export function debugBreakpointNavigationCapturesEqual(
  left: DebugBreakpointNavigationCapture,
  right: DebugBreakpointNavigationCapture,
): boolean {
  return (
    left.documentPath === right.documentPath &&
    left.columnNumber === right.columnNumber &&
    left.focused === right.focused &&
    left.lineNumber === right.lineNumber &&
    left.modelIdentity === right.modelIdentity &&
    left.modelVersion === right.modelVersion &&
    left.workspaceOwnerKey === right.workspaceOwnerKey &&
    left.workspaceRoot === right.workspaceRoot
  );
}
