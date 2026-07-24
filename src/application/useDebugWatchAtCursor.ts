import { useCallback, useRef } from "react";
import {
  debugWatchAtCursorCapturesEqual,
  isDebugWatchAtCursorDocumentPath,
  type DebugWatchAtCursorCapture,
  type DebugWatchAtCursorCaptureReader,
} from "../domain/debugWatchAtCursorCapture";
import { createDebugHoverExpressionIndex } from "../domain/debugHoverExpression";
import { workspaceRelativePath } from "../domain/pathDerivation";

export interface DebugWatchAtCursorCommands {
  canAddAtCursor(): boolean;
  addToWatchAtCursor(): boolean;
}

interface UseDebugWatchAtCursorOptions {
  readonly captureReader?: DebugWatchAtCursorCaptureReader | null;
  readonly watches: {
    add(expression: string): boolean;
    canAdd(expression: string): boolean;
  };
  isWorkspaceCurrent(workspaceRoot: string, workspaceOwnerKey: string): boolean;
  openDebugPanel(): void;
}

/** Command-boundary coordinator over an atomic editor capture and persistent Watches. */
export function useDebugWatchAtCursor(
  options: UseDebugWatchAtCursorOptions,
): DebugWatchAtCursorCommands {
  const currentRef = useRef(options);
  currentRef.current = options;

  const canAddAtCursor = useCallback((): boolean => {
    const current = currentRef.current;
    const expression = currentExpression(current);
    return expression !== null && current.watches.canAdd(expression);
  }, []);

  const addToWatchAtCursor = useCallback((): boolean => {
    const current = currentRef.current;
    const expression = currentExpression(current);
    if (expression === null || !current.watches.canAdd(expression)) return false;

    if (!current.watches.add(expression)) return false;
    current.openDebugPanel();
    return true;
  }, []);

  return { addToWatchAtCursor, canAddAtCursor };
}

function currentExpression(options: UseDebugWatchAtCursorOptions): string | null {
  const reader = options.captureReader;
  if (!reader) return null;
  const first = reader.readDebugWatchAtCursorCapture();
  if (!first || !validCapture(first, options.isWorkspaceCurrent)) return null;
  const index = createDebugHoverExpressionIndex(first.content);
  const expression =
    index?.at(first.position)?.expression ??
    (first.position.column > 1
      ? index?.at({ ...first.position, column: first.position.column - 1 })?.expression
      : null);
  if (!expression) return null;

  const second = reader.readDebugWatchAtCursorCapture();
  if (
    !second ||
    !debugWatchAtCursorCapturesEqual(first, second) ||
    !validCapture(second, options.isWorkspaceCurrent)
  ) {
    return null;
  }
  return expression;
}

function validCapture(
  capture: DebugWatchAtCursorCapture,
  isWorkspaceCurrent: UseDebugWatchAtCursorOptions["isWorkspaceCurrent"],
): boolean {
  return (
    capture.workspaceRoot.length > 0 &&
    capture.workspaceOwnerKey.length > 0 &&
    capture.modelIdentity.length > 0 &&
    capture.modelIdentity.length <= 1024 &&
    Number.isSafeInteger(capture.modelVersion) &&
    capture.modelVersion >= 1 &&
    workspaceRelativePath(capture.workspaceRoot, capture.documentPath) !== null &&
    isDebugWatchAtCursorDocumentPath(capture.documentPath) &&
    isWorkspaceCurrent(capture.workspaceRoot, capture.workspaceOwnerKey)
  );
}
