import { useCallback, useRef } from "react";
import type { Breakpoint, BreakpointCreationOwnership } from "../domain/debug";
import {
  debugInlineBreakpointCapturesEqual,
  MAX_DEBUG_INLINE_BREAKPOINT_FOCUS_EPOCH,
  type DebugInlineBreakpointCapture,
  type DebugInlineBreakpointCaptureReader,
} from "../domain/debugInlineBreakpointCapture";
import { isDebuggableNodeScriptPath } from "../domain/debugScriptPath";
import { workspaceRelativePath } from "../domain/pathDerivation";
import type { DebugInlineBreakpointCandidate } from "./debugSessionContracts";
export type { DebugInlineBreakpointCandidate } from "./debugSessionContracts";

export interface DebugInlineBreakpointCommands {
  addInlineBreakpoint(): boolean;
  canAddInlineBreakpoint(): boolean;
}

interface UseDebugInlineBreakpointOptions {
  readonly captureReader?: DebugInlineBreakpointCaptureReader | null;
  addBreakpoint(
    candidate: DebugInlineBreakpointCandidate,
  ): Promise<BreakpointCreationOwnership | null>;
  getBreakpoints(): readonly Breakpoint[];
  isWorkspaceCurrent(workspaceRoot: string, workspaceOwnerKey: string): boolean;
}

export function useDebugInlineBreakpoint(
  options: UseDebugInlineBreakpointOptions,
): DebugInlineBreakpointCommands {
  const optionsRef = useRef(options);
  const pendingRef = useRef(false);
  optionsRef.current = options;

  const canAddInlineBreakpoint = useCallback(
    () => !pendingRef.current && currentInvocation(optionsRef.current) !== null,
    [],
  );

  const addInlineBreakpoint = useCallback((): boolean => {
    if (pendingRef.current) return false;
    const invocation = currentInvocation(optionsRef.current);
    if (!invocation) return false;
    const isCurrent = () => invocationIsCurrent(optionsRef.current, invocation);
    if (!isCurrent()) return false;

    pendingRef.current = true;
    let created: Promise<BreakpointCreationOwnership | null>;
    try {
      created = optionsRef.current.addBreakpoint({
        ...(invocation.columnNumber === undefined ? {} : { columnNumber: invocation.columnNumber }),
        filePath: invocation.capture.documentPath,
        isCurrent,
        lineNumber: invocation.capture.lineNumber,
        workspaceOwnerKey: invocation.capture.workspaceOwnerKey,
        workspaceRoot: invocation.capture.workspaceRoot,
      });
    } catch {
      pendingRef.current = false;
      return false;
    }

    void Promise.resolve(created)
      .then(async (ownership) => {
        if (ownership && !isCurrent()) await ownership.rollback();
      })
      .catch(() => undefined)
      .finally(() => {
        pendingRef.current = false;
      });
    return true;
  }, []);

  return { addInlineBreakpoint, canAddInlineBreakpoint };
}

interface DebugInlineBreakpointInvocation {
  readonly capture: DebugInlineBreakpointCapture;
  readonly columnNumber?: number;
}

function currentInvocation(
  options: UseDebugInlineBreakpointOptions,
): DebugInlineBreakpointInvocation | null {
  try {
    const first = options.captureReader?.readDebugInlineBreakpointCapture() ?? null;
    const second = options.captureReader?.readDebugInlineBreakpointCapture() ?? null;
    if (!first || !second || !debugInlineBreakpointCapturesEqual(first, second)) return null;
    if (!captureIsEligible(options, first)) return null;
    const columnNumber = first.columnNumber <= 1 ? undefined : first.columnNumber;
    if (
      options
        .getBreakpoints()
        .some(
          (breakpoint) =>
            breakpoint.filePath === first.documentPath &&
            breakpoint.lineNumber === first.lineNumber &&
            breakpoint.columnNumber === columnNumber,
        )
    ) {
      return null;
    }
    return { capture: first, ...(columnNumber === undefined ? {} : { columnNumber }) };
  } catch {
    return null;
  }
}

function captureIsEligible(
  options: UseDebugInlineBreakpointOptions,
  capture: DebugInlineBreakpointCapture,
): boolean {
  return (
    capture.focused &&
    Number.isSafeInteger(capture.focusEpoch) &&
    capture.focusEpoch >= 1 &&
    capture.focusEpoch <= MAX_DEBUG_INLINE_BREAKPOINT_FOCUS_EPOCH &&
    capture.writable &&
    Number.isSafeInteger(capture.lineNumber) &&
    capture.lineNumber >= 1 &&
    Number.isSafeInteger(capture.columnNumber) &&
    capture.columnNumber >= 1 &&
    Number.isSafeInteger(capture.modelVersion) &&
    capture.modelVersion >= 1 &&
    capture.modelIdentity.length > 0 &&
    capture.modelIdentity.length <= 1_024 &&
    isDebuggableNodeScriptPath(capture.documentPath) &&
    workspaceRelativePath(capture.workspaceRoot, capture.documentPath) !== null &&
    options.isWorkspaceCurrent(capture.workspaceRoot, capture.workspaceOwnerKey)
  );
}

function invocationIsCurrent(
  options: UseDebugInlineBreakpointOptions,
  invocation: DebugInlineBreakpointInvocation,
): boolean {
  try {
    const current = options.captureReader?.readDebugInlineBreakpointCapture() ?? null;
    return (
      current !== null &&
      debugInlineBreakpointCapturesEqual(invocation.capture, current) &&
      captureIsEligible(options, current) &&
      !options
        .getBreakpoints()
        .some(
          (breakpoint) =>
            breakpoint.filePath === current.documentPath &&
            breakpoint.lineNumber === current.lineNumber &&
            breakpoint.columnNumber === invocation.columnNumber,
        )
    );
  } catch {
    return false;
  }
}
