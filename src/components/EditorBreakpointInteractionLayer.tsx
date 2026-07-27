import { useCallback, useEffect } from "react";
import type * as Monaco from "monaco-editor";
import type {
  Breakpoint,
  BreakpointCreationOwnership,
  BreakpointHitCondition,
} from "../domain/debug";
import type { DebugBreakpointRelocationCandidate } from "../application/debugSessionContracts";
import { isBreakpointPathSupported } from "../domain/debugBreakpointPolicy";
import { BreakpointEditorPopover } from "./BreakpointEditorPopover";
import { glyphMarginLaneFromMouseEvent } from "./editorChangeMonacoMappings";
import { useEditorBreakpointInteractions } from "./useEditorBreakpointInteractions";

export interface EditorBreakpointActions {
  removeBreakpoint(id: string): void | Promise<void>;
  relocateBreakpoint(candidate: DebugBreakpointRelocationCandidate): Promise<boolean>;
  setBreakpointCondition(id: string, condition: string | null): void | Promise<void>;
  setBreakpointHitCondition(
    id: string,
    hitCondition: BreakpointHitCondition | null,
  ): void | Promise<void>;
  setBreakpointLogMessage(id: string, logMessage: string | null): void | Promise<void>;
  toggleBreakpoint(
    filePath: string,
    lineNumber: number,
  ): void | BreakpointCreationOwnership | Promise<void | BreakpointCreationOwnership | null> | null;
}

interface Props {
  readonly actions?: Partial<EditorBreakpointActions>;
  readonly activeDocumentPath: string | undefined;
  readonly breakpoints: readonly Breakpoint[];
  readonly editor: Monaco.editor.IStandaloneCodeEditor | null;
  readonly modelIdentity: object | null;
  readonly monaco: typeof Monaco | null;
  readonly onMutationError?: (error: unknown) => void;
  readonly workspaceRoot: string | null;
}

export function EditorBreakpointInteractionLayer({
  actions,
  activeDocumentPath,
  breakpoints,
  editor,
  modelIdentity,
  monaco,
  onMutationError,
  workspaceRoot,
}: Props) {
  const restoreFocus = useCallback(() => editor?.focus(), [editor]);
  const interactions = useEditorBreakpointInteractions({
    activeDocumentPath,
    breakpoints,
    modelIdentity,
    onMutationError,
    onRemoveBreakpoint: actions?.removeBreakpoint,
    onSetBreakpointCondition: actions?.setBreakpointCondition,
    onSetBreakpointHitCondition: actions?.setBreakpointHitCondition,
    onSetBreakpointLogMessage: actions?.setBreakpointLogMessage,
    onToggleBreakpoint: actions?.toggleBreakpoint,
    hitConditionSupported: Boolean(
      workspaceRoot &&
      activeDocumentPath &&
      actions?.setBreakpointHitCondition &&
      isBreakpointPathSupported(workspaceRoot, "node", activeDocumentPath),
    ),
    logMessageSupported: Boolean(
      workspaceRoot &&
      activeDocumentPath &&
      actions?.setBreakpointLogMessage &&
      isBreakpointPathSupported(workspaceRoot, "node", activeDocumentPath),
    ),
    restoreFocus,
    workspaceRoot,
  });
  const open = interactions.open;

  useEffect(() => {
    if (!editor || !monaco || !activeDocumentPath) return;
    const disposable = editor.onMouseDown((event) => {
      if (!event.event.rightButton || !event.target.position) return;
      const type = event.target.type;
      const lineNumbers = type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS;
      const leftGlyph =
        type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN &&
        glyphMarginLaneFromMouseEvent(event) === monaco.editor.GlyphMarginLane.Left;
      const inlineBreakpoint =
        lineNumbers || leftGlyph
          ? undefined
          : breakpoints.find(
              (breakpoint) =>
                breakpoint.filePath === activeDocumentPath &&
                breakpoint.columnNumber !== undefined &&
                breakpoint.lineNumber === event.target.position?.lineNumber &&
                breakpoint.columnNumber === event.target.position.column,
            );
      if (!lineNumbers && !leftGlyph && !inlineBreakpoint) return;
      event.event.preventDefault();
      event.event.stopPropagation();
      open(
        activeDocumentPath,
        event.target.position.lineNumber,
        { x: event.event.posx, y: event.event.posy },
        lineNumbers || leftGlyph ? undefined : inlineBreakpoint?.columnNumber,
      );
    });
    return () => disposable.dispose();
  }, [activeDocumentPath, breakpoints, editor, monaco, open]);

  return interactions.popover ? (
    <BreakpointEditorPopover
      key={`${interactions.popover.operationToken}:${interactions.popover.kind}:${interactions.popover.editKind}`}
      onCancel={interactions.close}
      onEdit={interactions.edit}
      onRemove={interactions.remove}
      onRemoveLogpoint={interactions.removeLogpoint}
      onSave={interactions.save}
      request={interactions.popover}
    />
  ) : null;
}
