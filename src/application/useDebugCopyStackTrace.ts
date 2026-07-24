import { useRef } from "react";
import type { StackFrame } from "../domain/debug";
import { formatDebugStackTrace } from "../domain/debugStackTrace";
import type { TextClipboardGateway } from "../domain/textClipboard";

export interface DebugCopyStackTraceContext {
  readonly frames: readonly StackFrame[];
  readonly pauseGeneration: number;
  readonly rootKey: string;
  readonly sessionId: number;
  readonly workspaceOwnerKey: string;
}

export interface DebugCopyStackTraceCommands {
  canCopyStackTrace(): boolean;
  copyStackTrace(): boolean;
}

interface UseDebugCopyStackTraceOptions {
  readonly clipboard: TextClipboardGateway | null | undefined;
  getContext(): DebugCopyStackTraceContext | null;
}

export function useDebugCopyStackTrace(
  options: UseDebugCopyStackTraceOptions,
): DebugCopyStackTraceCommands {
  const optionsRef = useRef(options);
  const pendingRef = useRef(false);
  optionsRef.current = options;

  const canCopyStackTrace = (): boolean => {
    if (pendingRef.current || !clipboardAvailable(optionsRef.current.clipboard)) return false;
    return capture(optionsRef.current.getContext) !== null;
  };

  const copyStackTrace = (): boolean => {
    const current = optionsRef.current;
    if (pendingRef.current || !clipboardAvailable(current.clipboard)) return false;
    const first = capture(current.getContext);
    const second = capture(current.getContext);
    if (!first || !second || !contextsEqual(first.context, second.context)) return false;

    pendingRef.current = true;
    let write: Promise<void>;
    try {
      write = current.clipboard.writeText(first.text);
    } catch {
      pendingRef.current = false;
      return false;
    }
    void Promise.resolve(write)
      .catch(() => undefined)
      .finally(() => {
        pendingRef.current = false;
      });
    return true;
  };

  return { canCopyStackTrace, copyStackTrace };
}

function clipboardAvailable(
  clipboard: TextClipboardGateway | null | undefined,
): clipboard is TextClipboardGateway {
  if (!clipboard) return false;
  try {
    return clipboard.canWriteText();
  } catch {
    return false;
  }
}

function capture(getContext: () => DebugCopyStackTraceContext | null): {
  context: DebugCopyStackTraceContext;
  text: string;
} | null {
  try {
    const value = getContext();
    if (
      !value ||
      !isPositiveInteger(value.sessionId) ||
      !isPositiveInteger(value.pauseGeneration) ||
      !isCleanRootKey(value.rootKey) ||
      !isCleanRootKey(value.workspaceOwnerKey) ||
      !Array.isArray(value.frames)
    ) {
      return null;
    }
    const frames = value.frames.map((frame) => ({ ...frame }));
    const text = formatDebugStackTrace(frames);
    return text === null ? null : { context: { ...value, frames }, text };
  } catch {
    return null;
  }
}

function contextsEqual(
  left: DebugCopyStackTraceContext,
  right: DebugCopyStackTraceContext,
): boolean {
  return (
    left.rootKey === right.rootKey &&
    left.sessionId === right.sessionId &&
    left.pauseGeneration === right.pauseGeneration &&
    left.workspaceOwnerKey === right.workspaceOwnerKey &&
    left.frames.length === right.frames.length &&
    left.frames.every((frame, index) => {
      const other = right.frames[index];
      return (
        other !== undefined &&
        frame.frameId === other.frameId &&
        frame.name === other.name &&
        frame.filePath === other.filePath &&
        frame.lineNumber === other.lineNumber &&
        frame.column === other.column
      );
    })
  );
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isCleanRootKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 4_096 &&
    !/[\0\r\n]/u.test(value)
  );
}
