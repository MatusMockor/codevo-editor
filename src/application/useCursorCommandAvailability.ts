import { useCallback, useRef } from "react";
import { supportsEslintLineComment } from "../domain/eslintDiagnostics";
import type { EditorDocument } from "../domain/workspace";
import type { EditorCursorPositionRef } from "./editorCursorBindings";
import { EditorCursorStore, type EditorCursorStorePort } from "./editorCursorStore";

interface CursorLineDiagnostic {
  readonly line: number;
}

export function useResolvedEditorCursorStore(
  provided: EditorCursorStorePort | undefined,
): EditorCursorStorePort {
  const fallbackRef = useRef<EditorCursorStorePort | null>(null);
  if (!fallbackRef.current) fallbackRef.current = new EditorCursorStore();
  return provided ?? fallbackRef.current;
}

export function useCursorCommandAvailability(options: {
  readonly activeDocument: EditorDocument | null;
  readonly eslintDiagnostics: readonly CursorLineDiagnostic[];
  readonly phpstanDiagnostics: readonly CursorLineDiagnostic[];
  readonly positionRef: EditorCursorPositionRef;
}) {
  const { activeDocument, eslintDiagnostics, phpstanDiagnostics, positionRef } = options;
  const hasEslintDiagnosticAtCursor = useCallback(
    () =>
      Boolean(
        activeDocument &&
        supportsEslintLineComment(activeDocument.language) &&
        eslintDiagnostics.some((diagnostic) => diagnostic.line === positionRef.current?.lineNumber),
      ),
    [activeDocument, eslintDiagnostics, positionRef],
  );
  const hasPhpstanDiagnosticAtCursor = useCallback(
    () =>
      phpstanDiagnostics.some((diagnostic) => diagnostic.line === positionRef.current?.lineNumber),
    [phpstanDiagnostics, positionRef],
  );
  return { hasEslintDiagnosticAtCursor, hasPhpstanDiagnosticAtCursor };
}
