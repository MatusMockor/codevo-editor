import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type * as Monaco from "monaco-editor";
import type { CommandExecutionRunner } from "../../application/commandRegistry";
import { runRegisteredCommand } from "../../application/commandChain";
import type { EditorBreakpointGutterActions } from "../../application/useEditorBreakpointGutterMenu";
import type { EditorChangeHunk } from "../../domain/editorChangeMarkers";
import type { GitBlameLine } from "../../domain/git";
import type { EditorPosition } from "../../domain/languageServerFeatures";
import type { PhpTestGutterTarget } from "../../domain/phpTestGutterTargets";
import type { EditorDocument } from "../../domain/workspace";
import { gitBlameShaAtLine } from "../../domain/git";
import { findChangeHunkAtLine, glyphMarginLaneFromMouseEvent } from "../editorChangeMonacoMappings";
import { detectKeymapPlatform } from "../../domain/keymap";

export interface EditorChangePreviewState {
  anchorLineNumber: number;
  hunk: EditorChangeHunk;
}

interface EditorMouseInteractionsOptions {
  readonly activateEditorGroupFromInteraction: () => void;
  readonly activeDocumentRef: MutableRefObject<EditorDocument | null>;
  readonly changeHunksRef: MutableRefObject<readonly EditorChangeHunk[]>;
  readonly commandExecutionRunnerRef: MutableRefObject<CommandExecutionRunner | undefined>;
  readonly customDefinitionNavigationEnabled: boolean;
  readonly editor: Monaco.editor.IStandaloneCodeEditor | null;
  readonly goToDefinition: () => void;
  readonly editorActionCommandPortRef: MutableRefObject<{
    goToImplementationAt(position: EditorPosition): void;
  }>;
  readonly gitBlameLinesRef: MutableRefObject<GitBlameLine[]>;
  readonly implementationGutterTargetsRef: MutableRefObject<Map<number, EditorPosition>>;
  readonly monaco: typeof Monaco | null;
  readonly onRevealGitBlameCommit?: (path: string, sha: string) => void;
  readonly onRunTestAt?: (target: PhpTestGutterTarget) => void;
  readonly onToggleBookmarkAtLine?: (lineNumber: number) => void;
  readonly reportBreakpointMutationError: (error: unknown) => void;
  readonly setChangePreview: Dispatch<SetStateAction<EditorChangePreviewState | null>>;
  readonly testGutterTargetsRef: MutableRefObject<Map<number, PhpTestGutterTarget>>;
  readonly toggleBreakpointAction?: EditorBreakpointGutterActions["toggleBreakpoint"];
}

/**
 * Owns all pointer gestures registered on the Monaco editor. The handler reads
 * active-document data from refs so a registration cannot act on a stale tab.
 */
export function useEditorMouseInteractions({
  activateEditorGroupFromInteraction,
  activeDocumentRef,
  changeHunksRef,
  commandExecutionRunnerRef,
  customDefinitionNavigationEnabled,
  editor,
  goToDefinition,
  editorActionCommandPortRef,
  gitBlameLinesRef,
  implementationGutterTargetsRef,
  monaco,
  onRevealGitBlameCommit,
  onRunTestAt,
  onToggleBookmarkAtLine,
  reportBreakpointMutationError,
  setChangePreview,
  testGutterTargetsRef,
  toggleBreakpointAction,
}: EditorMouseInteractionsOptions): void {
  useEffect(() => {
    if (!editor || !monaco) {
      return;
    }

    const mouseDownPlatform = detectKeymapPlatform();

    const disposable = editor.onMouseDown((event) => {
      activateEditorGroupFromInteraction();
      const targetType = event.target.type;

      if (
        targetType === monaco.editor.MouseTargetType.CONTENT_TEXT &&
        event.event.leftButton === true &&
        event.target.element?.closest(".git-blame-annotation")
      ) {
        const lineNumber = event.target.position?.lineNumber;
        const sha = lineNumber ? gitBlameShaAtLine(gitBlameLinesRef.current, lineNumber) : null;
        const path = activeDocumentRef.current?.path;

        if (!sha || !path) {
          return;
        }

        event.event.preventDefault();
        event.event.stopPropagation();

        if (onRevealGitBlameCommit) {
          onRevealGitBlameCommit(path, sha);
          return;
        }

        window.dispatchEvent(
          new CustomEvent("mockor-reveal-git-blame-commit", {
            detail: { path, sha },
          }),
        );
        return;
      }

      const isContentText = targetType === monaco.editor.MouseTargetType.CONTENT_TEXT;
      const isLeftClick = event.event.leftButton === true;
      const isMiddleClick = event.event.middleButton === true;
      const definitionModifierPressed =
        mouseDownPlatform === "mac"
          ? event.event.metaKey === true && event.event.ctrlKey !== true
          : event.event.ctrlKey === true;
      const shouldNavigateToDefinition =
        (isLeftClick && definitionModifierPressed) || isMiddleClick;
      const contentPosition = event.target.position;

      if (isContentText && shouldNavigateToDefinition && contentPosition) {
        if (!customDefinitionNavigationEnabled && !isMiddleClick) {
          return;
        }

        event.event.preventDefault();
        event.event.stopPropagation();
        editor.setPosition(contentPosition);
        if (customDefinitionNavigationEnabled) {
          runRegisteredCommand(commandExecutionRunnerRef, "editor.goToDefinition", goToDefinition);
        } else {
          editor.trigger("mouse", "editor.action.revealDefinition", {});
        }
        return;
      }

      if (targetType === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS) {
        const lineNumber = event.target.position?.lineNumber;
        const path = activeDocumentRef.current?.path;
        const isPlainLeftClick =
          event.event.leftButton === true &&
          event.event.ctrlKey !== true &&
          event.event.metaKey !== true &&
          event.event.shiftKey !== true &&
          event.event.altKey !== true;
        if (!toggleBreakpointAction || !isPlainLeftClick || !lineNumber || !path) {
          return;
        }

        try {
          void Promise.resolve(toggleBreakpointAction(path, lineNumber)).catch(
            reportBreakpointMutationError,
          );
        } catch (error) {
          reportBreakpointMutationError(error);
        }
        return;
      }

      if (event.event.rightButton) {
        return;
      }

      const isGlyphMargin = targetType === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN;
      const isLineDecorations =
        targetType === monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS;

      if (!isGlyphMargin && !isLineDecorations) {
        return;
      }

      const lineNumber = event.target.position?.lineNumber;

      if (!lineNumber) {
        return;
      }

      if (isLineDecorations) {
        if (!onToggleBookmarkAtLine) {
          return;
        }

        event.event.preventDefault();
        event.event.stopPropagation();
        onToggleBookmarkAtLine(lineNumber);
        return;
      }

      const lane = glyphMarginLaneFromMouseEvent(event);
      const changeHunk = findChangeHunkAtLine(changeHunksRef.current, lineNumber);
      const testTarget = testGutterTargetsRef.current.get(lineNumber);

      if (testTarget && onRunTestAt && lane === monaco.editor.GlyphMarginLane.Right) {
        event.event.preventDefault();
        event.event.stopPropagation();
        onRunTestAt(testTarget);
        return;
      }

      const target = implementationGutterTargetsRef.current.get(lineNumber);

      if (target && lane !== monaco.editor.GlyphMarginLane.Left) {
        event.event.preventDefault();
        event.event.stopPropagation();
        editor.setPosition(target);
        runRegisteredCommand(commandExecutionRunnerRef, "editor.goToImplementation", () =>
          editorActionCommandPortRef.current.goToImplementationAt(target),
        );
        return;
      }

      if (changeHunk) {
        event.event.preventDefault();
        event.event.stopPropagation();
        setChangePreview({
          anchorLineNumber: lineNumber,
          hunk: changeHunk,
        });
      }
    });

    return () => disposable.dispose();
  }, [
    activateEditorGroupFromInteraction,
    activeDocumentRef,
    changeHunksRef,
    commandExecutionRunnerRef,
    customDefinitionNavigationEnabled,
    editor,
    gitBlameLinesRef,
    goToDefinition,
    editorActionCommandPortRef,
    implementationGutterTargetsRef,
    monaco,
    onRevealGitBlameCommit,
    onRunTestAt,
    onToggleBookmarkAtLine,
    reportBreakpointMutationError,
    setChangePreview,
    testGutterTargetsRef,
    toggleBreakpointAction,
  ]);
}
