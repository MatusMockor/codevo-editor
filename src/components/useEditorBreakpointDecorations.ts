import { useEffect, useRef } from "react";
import type * as Monaco from "monaco-editor";
import type { DebugBreakpointRelocationCandidate } from "../application/debugSessionContracts";
import type { Breakpoint } from "../domain/debug";
import { toBreakpointDecoration } from "./editorChangeMonacoMappings";

export function useEditorBreakpointDecorations(
  editor: Monaco.editor.IStandaloneCodeEditor | null,
  monaco: typeof Monaco | null,
  activeDocumentPath: string | undefined,
  modelIdentity: Monaco.editor.ITextModel | null,
  breakpoints: readonly Breakpoint[],
  relocation: {
    readonly relocateBreakpoint?: (
      candidate: DebugBreakpointRelocationCandidate,
    ) => Promise<boolean>;
    readonly workspaceOwnerKey?: string | null;
    readonly workspaceRoot?: string | null;
  } = {},
) {
  const ids = useRef<string[]>([]);
  useEffect(() => {
    if (
      !editor ||
      !monaco ||
      !activeDocumentPath ||
      !modelIdentity ||
      editor.getModel() !== modelIdentity
    )
      return;
    const candidates = breakpoints.filter(({ filePath }) => filePath === activeDocumentPath);
    if (candidates.length === 0) {
      ids.current = editor.deltaDecorations(ids.current, []);
      return;
    }
    const lineCount = modelIdentity.getLineCount();
    const decoratedBreakpoints = candidates.filter(({ columnNumber, lineNumber }) => {
      if (!Number.isInteger(lineNumber) || lineNumber < 1 || lineNumber > lineCount) {
        return false;
      }
      return (
        columnNumber === undefined ||
        (Number.isInteger(columnNumber) &&
          columnNumber >= 1 &&
          columnNumber <= modelIdentity.getLineMaxColumn(lineNumber))
      );
    });
    ids.current = editor.deltaDecorations(
      ids.current,
      decoratedBreakpoints.map((breakpoint) => toBreakpointDecoration(monaco, breakpoint)),
    );
    let current = true;
    const trackedByBreakpointId = new Map(
      decoratedBreakpoints.map((breakpoint, index) => [breakpoint.id, ids.current[index]] as const),
    );
    const contentSubscription = editor.onDidChangeModelContent(() => {
      const relocateBreakpoint = relocation.relocateBreakpoint;
      const workspaceOwnerKey = relocation.workspaceOwnerKey;
      const workspaceRoot = relocation.workspaceRoot;
      if (!relocateBreakpoint || !workspaceOwnerKey || !workspaceRoot) return;
      const modelVersion = modelIdentity.getVersionId();
      for (const breakpoint of decoratedBreakpoints) {
        const decorationId = trackedByBreakpointId.get(breakpoint.id);
        const range = decorationId ? modelIdentity.getDecorationRange(decorationId) : null;
        if (!decorationId || !range) continue;
        const lineNumber = range.startLineNumber;
        const columnNumber = breakpoint.columnNumber === undefined ? undefined : range.startColumn;
        if (lineNumber === breakpoint.lineNumber && columnNumber === breakpoint.columnNumber) {
          continue;
        }
        const candidate: DebugBreakpointRelocationCandidate = {
          breakpointId: breakpoint.id,
          ...(columnNumber === undefined ? {} : { columnNumber }),
          filePath: breakpoint.filePath,
          lineNumber,
          workspaceOwnerKey,
          workspaceRoot,
          isCurrent: () => {
            if (
              !current ||
              editor.getModel() !== modelIdentity ||
              modelIdentity.getVersionId() !== modelVersion ||
              trackedByBreakpointId.get(breakpoint.id) !== decorationId
            ) {
              return false;
            }
            const liveRange = modelIdentity.getDecorationRange(decorationId);
            return (
              liveRange?.startLineNumber === lineNumber &&
              (breakpoint.columnNumber === undefined || liveRange.startColumn === columnNumber)
            );
          },
        };
        void relocateBreakpoint(candidate).catch(() => undefined);
      }
    });
    return () => {
      current = false;
      contentSubscription.dispose();
      ids.current = editor.deltaDecorations(ids.current, []);
    };
  }, [
    activeDocumentPath,
    breakpoints,
    editor,
    modelIdentity,
    monaco,
    relocation.relocateBreakpoint,
    relocation.workspaceOwnerKey,
    relocation.workspaceRoot,
  ]);
}
