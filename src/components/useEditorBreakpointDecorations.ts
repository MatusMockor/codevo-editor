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
    readonly authoritativeContent?: string;
    readonly relocateBreakpoint?: (
      candidate: DebugBreakpointRelocationCandidate,
    ) => Promise<boolean>;
    readonly workspaceOwnerKey?: string | null;
    readonly workspaceRoot?: string | null;
  } = {},
) {
  const ids = useRef<string[]>([]);
  const authoritativeContentRef = useRef(relocation.authoritativeContent);
  const pendingControlledReplacementRef = useRef<{
    readonly nextContent: string;
    readonly previousLength: number;
  } | null>(null);
  if (
    relocation.authoritativeContent !== undefined &&
    authoritativeContentRef.current !== relocation.authoritativeContent
  ) {
    pendingControlledReplacementRef.current = {
      nextContent: relocation.authoritativeContent,
      previousLength: authoritativeContentRef.current?.length ?? 0,
    };
    authoritativeContentRef.current = relocation.authoritativeContent;
  }
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
    const validBreakpoints = () => {
      const lineCount = modelIdentity.getLineCount();
      return candidates.filter(({ columnNumber, lineNumber }) => {
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
    };
    let current = true;
    let trackedBreakpoints: readonly Breakpoint[] = [];
    const trackedByBreakpointId = new Map<string, string | undefined>();
    const anchorDecorations = () => {
      trackedBreakpoints = validBreakpoints();
      ids.current = editor.deltaDecorations(
        ids.current,
        trackedBreakpoints.map((breakpoint) => toBreakpointDecoration(monaco, breakpoint)),
      );
      trackedByBreakpointId.clear();
      trackedBreakpoints.forEach((breakpoint, index) => {
        trackedByBreakpointId.set(breakpoint.id, ids.current[index]);
      });
    };
    anchorDecorations();
    const contentSubscription = editor.onDidChangeModelContent((event) => {
      const pendingControlledReplacement = pendingControlledReplacementRef.current;
      pendingControlledReplacementRef.current = null;
      const change = event.changes.length === 1 ? event.changes[0] : null;
      const isControlledFullReplacement =
        pendingControlledReplacement !== null &&
        change !== null &&
        change.range.startLineNumber === 1 &&
        change.range.startColumn === 1 &&
        change.rangeLength === pendingControlledReplacement.previousLength &&
        change.text === pendingControlledReplacement.nextContent;
      // Monaco emits a flush when the workbench replaces the complete model
      // after an external reload. The React wrapper can also express the same
      // controlled full-buffer sync as executeEdits(forceMoveMarkers: true).
      // Both can collapse tracked decorations to EOF; re-anchor from the
      // authoritative breakpoint snapshot instead of persisting that movement.
      if (event.isFlush || isControlledFullReplacement) {
        anchorDecorations();
        return;
      }
      const relocateBreakpoint = relocation.relocateBreakpoint;
      const workspaceOwnerKey = relocation.workspaceOwnerKey;
      const workspaceRoot = relocation.workspaceRoot;
      if (!relocateBreakpoint || !workspaceOwnerKey || !workspaceRoot) return;
      const modelVersion = modelIdentity.getVersionId();
      for (const breakpoint of trackedBreakpoints) {
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
