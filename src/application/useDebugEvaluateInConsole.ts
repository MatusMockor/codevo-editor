import { useCallback, useRef } from "react";
import {
  debugEvaluateInConsoleCapturesEqual,
  type DebugEvaluateInConsoleCapture,
  type DebugEvaluateInConsoleCaptureReader,
} from "../domain/debugEvaluateInConsoleCapture";
import { validateDebugExpression } from "../domain/debugEvaluationPolicy";
import { workspaceRelativePath } from "../domain/pathDerivation";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { ActiveDebugAdapterKind } from "./debugSessionContracts";

export interface DebugEvaluateInConsoleContext {
  readonly adapterKind: ActiveDebugAdapterKind;
  readonly frameId: number | null;
  readonly pauseGeneration: number | null;
  readonly rootPath: string | null;
  readonly sessionId: number | null;
  readonly stateKind: "inactive" | "starting" | "running" | "stopped" | "terminated";
}

export interface DebugEvaluateInConsoleCommands {
  canEvaluateInConsole(): boolean;
  evaluateInConsole(): boolean;
}

export interface UseDebugEvaluateInConsoleOptions {
  readonly captureReader?: DebugEvaluateInConsoleCaptureReader | null;
  getDebugContext(): DebugEvaluateInConsoleContext;
  isWorkspaceCurrent(workspaceRoot: string, workspaceOwnerKey: string): boolean;
  isWorkspaceTrusted(): boolean;
  focusConsole(): void;
  submit(expression: string): Promise<void>;
}

/** Exact-owner coordinator for the explicit side-effect-capable REPL command. */
export function useDebugEvaluateInConsole(
  options: UseDebugEvaluateInConsoleOptions,
): DebugEvaluateInConsoleCommands {
  const currentRef = useRef(options);
  currentRef.current = options;
  const pendingRef = useRef(false);

  const canEvaluateInConsole = useCallback(
    (): boolean => !pendingRef.current && currentInvocation(currentRef.current) !== null,
    [],
  );

  const evaluateInConsole = useCallback((): boolean => {
    if (pendingRef.current) return false;
    const current = currentRef.current;
    const invocation = currentInvocation(current);
    if (!invocation) return false;

    pendingRef.current = true;
    let submitted: Promise<void>;
    try {
      submitted = current.submit(invocation.expression);
    } catch {
      pendingRef.current = false;
      return false;
    }
    try {
      current.focusConsole();
    } catch {
      // Submission was already accepted. Keep it single-flighted and do not
      // invite a retry that could repeat a side effect just because panel focus failed.
    }
    void Promise.resolve(submitted).then(
      () => {
        pendingRef.current = false;
      },
      () => {
        pendingRef.current = false;
      },
    );
    return true;
  }, []);

  return { canEvaluateInConsole, evaluateInConsole };
}

interface DebugEvaluateInvocation {
  readonly expression: string;
}

function currentInvocation(
  options: UseDebugEvaluateInConsoleOptions,
): DebugEvaluateInvocation | null {
  try {
    return currentInvocationUnsafe(options);
  } catch {
    return null;
  }
}

function currentInvocationUnsafe(
  options: UseDebugEvaluateInConsoleOptions,
): DebugEvaluateInvocation | null {
  const reader = options.captureReader;
  if (!reader || !trusted(options)) return null;
  const firstContext = options.getDebugContext();
  const first = reader.readDebugEvaluateInConsoleCapture();
  if (!first || !validOwner(first, firstContext, options)) return null;
  const expression = expressionFromCapture(first);
  if (!expression) return null;

  const second = reader.readDebugEvaluateInConsoleCapture();
  const secondContext = options.getDebugContext();
  if (
    !second ||
    !debugEvaluateInConsoleCapturesEqual(first, second) ||
    !contextsEqual(firstContext, secondContext) ||
    !trusted(options) ||
    !validOwner(second, secondContext, options)
  ) {
    return null;
  }
  return { expression };
}

function expressionFromCapture(capture: DebugEvaluateInConsoleCapture): string | null {
  const candidate = selectionIsEmpty(capture.selection)
    ? capture.currentLineText.trim()
    : capture.selectionText.trim();
  const validation = validateDebugExpression(candidate);
  return validation.ok ? validation.expression : null;
}

function validOwner(
  capture: DebugEvaluateInConsoleCapture,
  context: DebugEvaluateInConsoleContext,
  options: UseDebugEvaluateInConsoleOptions,
): boolean {
  return (
    capture.focused &&
    validCaptureMetadata(capture) &&
    isJavaScriptTypeScriptSourcePath(capture.documentPath) &&
    workspaceRelativePath(capture.workspaceRoot, capture.documentPath) !== null &&
    options.isWorkspaceCurrent(capture.workspaceRoot, capture.workspaceOwnerKey) &&
    context.adapterKind === "node" &&
    context.stateKind === "stopped" &&
    context.rootPath !== null &&
    workspaceRootKeysEqual(context.rootPath, capture.workspaceRoot) &&
    context.sessionId !== null &&
    context.pauseGeneration !== null &&
    context.frameId !== null
  );
}

function validCaptureMetadata(capture: DebugEvaluateInConsoleCapture): boolean {
  const range = capture.selection;
  return (
    capture.modelIdentity.length > 0 &&
    capture.modelIdentity.length <= 1024 &&
    Number.isSafeInteger(capture.modelVersion) &&
    capture.modelVersion >= 1 &&
    [range.startLineNumber, range.startColumn, range.endLineNumber, range.endColumn].every(
      (value) => Number.isSafeInteger(value) && value >= 1,
    ) &&
    (range.startLineNumber < range.endLineNumber ||
      (range.startLineNumber === range.endLineNumber && range.startColumn <= range.endColumn)) &&
    selectionIsEmpty(range) === (capture.selectionText.length === 0)
  );
}

function selectionIsEmpty(range: DebugEvaluateInConsoleCapture["selection"]): boolean {
  return (
    range.startLineNumber === range.endLineNumber && range.startColumn === range.endColumn
  );
}

function contextsEqual(
  left: DebugEvaluateInConsoleContext,
  right: DebugEvaluateInConsoleContext,
): boolean {
  return (
    left.adapterKind === right.adapterKind &&
    left.frameId === right.frameId &&
    left.pauseGeneration === right.pauseGeneration &&
    left.rootPath === right.rootPath &&
    left.sessionId === right.sessionId &&
    left.stateKind === right.stateKind
  );
}

function trusted(options: UseDebugEvaluateInConsoleOptions): boolean {
  try {
    return options.isWorkspaceTrusted() === true;
  } catch {
    return false;
  }
}

function isJavaScriptTypeScriptSourcePath(path: string): boolean {
  return /\.(?:[cm]?[jt]s|[jt]sx)$/iu.test(path);
}
