import { useCallback, useRef } from "react";
import type { Breakpoint } from "../domain/debug";
import { isDebugBreakpointModel } from "../domain/debugBreakpointPolicy";
import {
  selectDebugBreakpointNavigationTarget,
  type DebugBreakpointNavigationDirection,
  type DebugBreakpointNavigationTarget,
} from "../domain/debugBreakpointNavigation";
import {
  debugBreakpointNavigationCapturesEqual,
  type DebugBreakpointNavigationCapture,
  type DebugBreakpointNavigationCaptureReader,
} from "../domain/debugBreakpointNavigationCapture";
import { workspaceRelativePath } from "../domain/pathDerivation";
import { isDebuggableNodeScriptPath } from "../domain/debugScriptPath";
import { createWorkspaceRootFromPath } from "../domain/workspacePath";

export interface DebugBreakpointNavigationCommands {
  canGoToNextBreakpoint(): boolean;
  canGoToPreviousBreakpoint(): boolean;
  goToNextBreakpoint(): boolean;
  goToPreviousBreakpoint(): boolean;
}

export interface UseDebugBreakpointNavigationOptions {
  readonly captureReader?: DebugBreakpointNavigationCaptureReader | null;
  getBreakpoints(): readonly Breakpoint[];
  isWorkspaceCurrent(workspaceRoot: string, workspaceOwnerKey: string): boolean;
  openDebugLocation(
    filePath: string,
    lineNumber: number,
    column?: number,
    shouldCommit?: () => boolean,
  ): Promise<boolean>;
}

/** Owner-safe frontend-only navigation over the private breakpoint model. */
export function useDebugBreakpointNavigation(
  options: UseDebugBreakpointNavigationOptions,
): DebugBreakpointNavigationCommands {
  const currentRef = useRef(options);
  currentRef.current = options;
  const pendingRef = useRef(false);

  const canNavigate = useCallback((direction: DebugBreakpointNavigationDirection): boolean => {
    return !pendingRef.current && currentInvocation(currentRef.current, direction) !== null;
  }, []);

  const navigate = useCallback((direction: DebugBreakpointNavigationDirection): boolean => {
    if (pendingRef.current) return false;
    const current = currentRef.current;
    const invocation = currentInvocation(current, direction);
    if (!invocation) return false;

    const shouldCommit = () => invocationIsCurrent(currentRef.current, invocation);
    if (!shouldCommit()) return false;
    pendingRef.current = true;
    let opened: Promise<boolean>;
    try {
      opened = current.openDebugLocation(
        invocation.target.filePath,
        invocation.target.lineNumber,
        invocation.target.columnNumber ?? 1,
        shouldCommit,
      );
    } catch {
      pendingRef.current = false;
      return false;
    }
    void Promise.resolve(opened).then(
      () => {
        pendingRef.current = false;
      },
      () => {
        pendingRef.current = false;
      },
    );
    return true;
  }, []);

  return {
    canGoToNextBreakpoint: () => canNavigate("next"),
    canGoToPreviousBreakpoint: () => canNavigate("previous"),
    goToNextBreakpoint: () => navigate("next"),
    goToPreviousBreakpoint: () => navigate("previous"),
  };
}

interface DebugBreakpointNavigationInvocation {
  readonly capture: DebugBreakpointNavigationCapture;
  readonly target: DebugBreakpointNavigationTarget;
}

function currentInvocation(
  options: UseDebugBreakpointNavigationOptions,
  direction: DebugBreakpointNavigationDirection,
): DebugBreakpointNavigationInvocation | null {
  try {
    return currentInvocationUnsafe(options, direction);
  } catch {
    return null;
  }
}

function currentInvocationUnsafe(
  options: UseDebugBreakpointNavigationOptions,
  direction: DebugBreakpointNavigationDirection,
): DebugBreakpointNavigationInvocation | null {
  const reader = options.captureReader;
  if (!reader) return null;
  const first = reader.readDebugBreakpointNavigationCapture();
  if (!first || !validCapture(first, options)) return null;
  const target = selectDebugBreakpointNavigationTarget(
    eligibleBreakpoints(options.getBreakpoints(), first.workspaceRoot),
    {
      columnNumber: first.columnNumber,
      documentPath: first.documentPath,
      lineNumber: first.lineNumber,
    },
    direction,
  );
  if (!target) return null;
  const second = reader.readDebugBreakpointNavigationCapture();
  if (
    !second ||
    !debugBreakpointNavigationCapturesEqual(first, second) ||
    !validCapture(second, options)
  ) {
    return null;
  }
  const invocation = { capture: first, target };
  return invocationIsCurrent(options, invocation) ? invocation : null;
}

function validCapture(
  capture: DebugBreakpointNavigationCapture,
  options: UseDebugBreakpointNavigationOptions,
): boolean {
  return (
    capture.focused &&
    capture.workspaceRoot.length > 0 &&
    capture.workspaceOwnerKey.length > 0 &&
    capture.modelIdentity.length > 0 &&
    capture.modelIdentity.length <= 1_024 &&
    Number.isSafeInteger(capture.modelVersion) &&
    capture.modelVersion >= 1 &&
    Number.isSafeInteger(capture.lineNumber) &&
    capture.lineNumber >= 1 &&
    Number.isSafeInteger(capture.columnNumber) &&
    capture.columnNumber >= 1 &&
    canonicalPath(capture.documentPath) &&
    isDebuggableNodeScriptPath(capture.documentPath) &&
    workspaceRelativePath(capture.workspaceRoot, capture.documentPath) !== null &&
    options.isWorkspaceCurrent(capture.workspaceRoot, capture.workspaceOwnerKey)
  );
}

function invocationIsCurrent(
  options: UseDebugBreakpointNavigationOptions,
  invocation: DebugBreakpointNavigationInvocation,
): boolean {
  try {
    return invocationIsCurrentUnsafe(options, invocation);
  } catch {
    return false;
  }
}

function invocationIsCurrentUnsafe(
  options: UseDebugBreakpointNavigationOptions,
  invocation: DebugBreakpointNavigationInvocation,
): boolean {
  return (
    options.isWorkspaceCurrent(
      invocation.capture.workspaceRoot,
      invocation.capture.workspaceOwnerKey,
    ) &&
    eligibleBreakpoints(options.getBreakpoints(), invocation.capture.workspaceRoot).some(
      (breakpoint) =>
        breakpoint.id === invocation.target.id &&
        breakpoint.filePath === invocation.target.filePath &&
        breakpoint.lineNumber === invocation.target.lineNumber &&
        breakpoint.columnNumber === invocation.target.columnNumber,
    )
  );
}

function canonicalPath(path: string): boolean {
  if (path.includes("\\")) return false;
  const parsed = createWorkspaceRootFromPath(path);
  return parsed.ok && parsed.value.nativePath === path;
}

function eligibleBreakpoints(
  breakpoints: readonly Breakpoint[],
  workspaceRoot: string,
): Breakpoint[] {
  return breakpoints.filter(
    (breakpoint) =>
      breakpoint.enabled &&
      isDebugBreakpointModel(breakpoint) &&
      canonicalPath(breakpoint.filePath) &&
      isDebuggableNodeScriptPath(breakpoint.filePath) &&
      workspaceRelativePath(workspaceRoot, breakpoint.filePath) !== null,
  );
}
