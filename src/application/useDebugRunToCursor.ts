import { useCallback, useRef, type RefObject } from "react";
import type { EditorDocument } from "../domain/workspace";
import { workspaceRelativePath } from "../domain/workspace";
import { isBreakpointPathSupported } from "../domain/debugBreakpointPolicy";
import type { DebugRunToLocationCandidate } from "./debugSessionContracts";

const RUN_TO_CURSOR_WARNING = "Debug: unable to run to cursor.";
const MAX_POSITION = 4_294_967_295;

interface EditorPosition {
  readonly lineNumber: number;
  readonly column: number;
}

interface UseDebugRunToCursorOptions {
  activeDocumentRef: RefObject<EditorDocument | null>;
  activeEditorPositionRef: RefObject<EditorPosition | null>;
  canRunToLocation(): boolean;
  currentWorkspaceRootRef: RefObject<string | null>;
  isWorkspaceTrusted(): boolean;
  reportWarning(message: string): void;
  runToLocation(candidate: DebugRunToLocationCandidate): Promise<boolean>;
  workspaceId: string | null;
}

interface RunToCursorCapture {
  readonly columnNumber: number;
  readonly content: string;
  readonly document: EditorDocument;
  readonly filePath: string;
  readonly lineNumber: number;
  readonly revision: EditorDocument["revision"];
  readonly rootPath: string;
  readonly savedContent: string;
  readonly workspaceId: string | null;
}

export function useDebugRunToCursor({
  activeDocumentRef,
  activeEditorPositionRef,
  canRunToLocation,
  currentWorkspaceRootRef,
  isWorkspaceTrusted,
  reportWarning,
  runToLocation,
  workspaceId,
}: UseDebugRunToCursorOptions) {
  const currentRef = useRef({ isWorkspaceTrusted, workspaceId });
  currentRef.current = { isWorkspaceTrusted, workspaceId };

  const capture = useCallback(
    (): RunToCursorCapture | null =>
      captureRunToCursor(
        currentWorkspaceRootRef.current,
        currentRef.current.workspaceId,
        activeDocumentRef.current,
        activeEditorPositionRef.current,
        currentRef.current.isWorkspaceTrusted,
        canRunToLocation,
      ),
    [activeDocumentRef, activeEditorPositionRef, canRunToLocation, currentWorkspaceRootRef],
  );

  const runToCursor = useCallback(async () => {
    const requested = capture();
    if (!requested) return;
    const isCurrent = () =>
      isRunToCursorCaptureCurrent(
        requested,
        currentWorkspaceRootRef.current,
        currentRef.current.workspaceId,
        activeDocumentRef.current,
        activeEditorPositionRef.current,
        currentRef.current.isWorkspaceTrusted,
      );
    if (!isCurrent()) return;
    try {
      await runToLocation({
        filePath: requested.filePath,
        lineNumber: requested.lineNumber,
        columnNumber: requested.columnNumber,
        isCurrent,
      });
    } catch {
      reportWarning(RUN_TO_CURSOR_WARNING);
    }
  }, [
    activeDocumentRef,
    activeEditorPositionRef,
    capture,
    currentWorkspaceRootRef,
    reportWarning,
    runToLocation,
  ]);

  return { canRunToCursor: capture() !== null, runToCursor };
}

export function captureRunToCursor(
  rootPath: string | null,
  workspaceId: string | null,
  document: EditorDocument | null,
  position: EditorPosition | null,
  isWorkspaceTrusted: () => boolean,
  canRunToLocation: () => boolean,
): RunToCursorCapture | null {
  if (
    !rootPath ||
    !workspaceId ||
    !safely(isWorkspaceTrusted) ||
    !safely(canRunToLocation) ||
    !document ||
    document.readOnly === true ||
    document.content !== document.savedContent ||
    /\.d\.(?:ts|mts|cts)$/.test(document.path) ||
    !isBreakpointPathSupported(rootPath, "node", document.path) ||
    workspaceRelativePath(rootPath, document.path) === null ||
    !validPosition(position)
  ) {
    return null;
  }
  return {
    columnNumber: position.column,
    content: document.content,
    document,
    filePath: document.path,
    lineNumber: position.lineNumber,
    revision: document.revision,
    rootPath,
    savedContent: document.savedContent,
    workspaceId,
  };
}

function isRunToCursorCaptureCurrent(
  captured: RunToCursorCapture,
  rootPath: string | null,
  workspaceId: string | null,
  document: EditorDocument | null,
  position: EditorPosition | null,
  isWorkspaceTrusted: () => boolean,
): boolean {
  return (
    safely(isWorkspaceTrusted) &&
    rootPath === captured.rootPath &&
    workspaceId === captured.workspaceId &&
    document === captured.document &&
    document.path === captured.filePath &&
    document.content === captured.content &&
    document.savedContent === captured.savedContent &&
    document.revision === captured.revision &&
    document.readOnly !== true &&
    position?.lineNumber === captured.lineNumber &&
    position.column === captured.columnNumber
  );
}

function validPosition(position: EditorPosition | null): position is EditorPosition {
  return Boolean(
    position &&
    Number.isSafeInteger(position.lineNumber) &&
    position.lineNumber >= 1 &&
    position.lineNumber <= MAX_POSITION &&
    Number.isSafeInteger(position.column) &&
    position.column >= 1 &&
    position.column <= MAX_POSITION,
  );
}

function safely(check: () => boolean): boolean {
  try {
    return check() === true;
  } catch {
    return false;
  }
}
