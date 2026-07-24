import { useCallback, type RefObject } from "react";

interface DebugDocumentRef {
  readonly path: string;
  readonly readOnly?: boolean;
}

interface EditorPositionRef {
  readonly lineNumber: number;
}

export function useDebugBreakpointAtCursor(
  activeDocumentRef: RefObject<DebugDocumentRef | null>,
  activeEditorPositionRef: RefObject<EditorPositionRef | null>,
  toggleBreakpoint: (filePath: string, lineNumber: number) => Promise<unknown>,
) {
  return useCallback(async () => {
    const document = activeDocumentRef.current;
    const lineNumber = activeEditorPositionRef.current?.lineNumber;
    if (!document || document.readOnly || !lineNumber) return;
    await toggleBreakpoint(document.path, lineNumber);
  }, [activeDocumentRef, activeEditorPositionRef, toggleBreakpoint]);
}
