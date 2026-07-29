import { useEffect } from "react";
import type { MutableRefObject } from "react";
import type * as Monaco from "monaco-editor";
import type { EditorPosition } from "../../domain/languageServerFeatures";
import type { PhpTestGutterTarget } from "../../domain/phpTestGutterTargets";
import { jsGutterTargetsCoordinator } from "../../domain/jsGutterTargetsCoordinator";
import { phpGutterTargetsCoordinator } from "../../domain/phpGutterTargetsCoordinator";
import type { PhpEditTick } from "../useDebouncedPhpEditTick";
import { modelMatchesProject } from "../editorSurfaceModelIdentity";

interface EditorGutterDecorationOptions {
  readonly activeDocumentLanguage: string | null | undefined;
  readonly activeDocumentPath: string | null | undefined;
  readonly editor: Monaco.editor.IStandaloneCodeEditor | null;
  readonly implementationDecoratedPathRef: MutableRefObject<string | null>;
  readonly implementationDecorationIdsRef: MutableRefObject<string[]>;
  readonly implementationTargetsRef: MutableRefObject<Map<number, EditorPosition>>;
  readonly isActiveDocumentJsTest: boolean;
  readonly isActiveDocumentPhpTest: boolean;
  readonly monaco: typeof Monaco | null;
  readonly phpEditTick: PhpEditTick | null;
  readonly testDecoratedPathRef: MutableRefObject<string | null>;
  readonly testDecorationIdsRef: MutableRefObject<string[]>;
  readonly testEditTick: PhpEditTick | null;
  readonly testTargetsRef: MutableRefObject<Map<number, PhpTestGutterTarget>>;
  readonly workspaceRoot: string | null;
}

/**
 * Owns the implementation and test gutter decoration lifecycle. Path switches
 * clear synchronously; debounced snapshots repaint only the matching live model.
 */
export function useEditorGutterDecorations({
  activeDocumentLanguage,
  activeDocumentPath,
  editor,
  implementationDecoratedPathRef,
  implementationDecorationIdsRef,
  implementationTargetsRef,
  isActiveDocumentJsTest,
  isActiveDocumentPhpTest,
  monaco,
  phpEditTick,
  testDecoratedPathRef,
  testDecorationIdsRef,
  testEditTick,
  testTargetsRef,
  workspaceRoot,
}: EditorGutterDecorationOptions): void {
  useEffect(() => {
    if (!activeDocumentPath || !activeDocumentLanguage || !editor || !monaco) {
      return;
    }

    const model = editor.getModel();

    if (!model || !modelMatchesProject(model, workspaceRoot, activeDocumentPath)) {
      return;
    }

    const decoratedPath = implementationDecoratedPathRef.current;
    const isPathSwitch = decoratedPath !== null && decoratedPath !== activeDocumentPath;

    if (activeDocumentLanguage !== "php" || isPathSwitch) {
      implementationTargetsRef.current = new Map();
      implementationDecorationIdsRef.current = editor.deltaDecorations(
        implementationDecorationIdsRef.current,
        [],
      );
      implementationDecoratedPathRef.current = null;
    }
  }, [
    activeDocumentLanguage,
    activeDocumentPath,
    editor,
    implementationDecoratedPathRef,
    implementationDecorationIdsRef,
    implementationTargetsRef,
    monaco,
    workspaceRoot,
  ]);

  useEffect(() => {
    if (!phpEditTick || !editor || !monaco) {
      return;
    }

    const liveModel = editor.getModel();

    if (!liveModel || !modelMatchesProject(liveModel, workspaceRoot, phpEditTick.path)) {
      return;
    }

    const targets = phpGutterTargetsCoordinator.resolveImplementation(
      workspaceRoot,
      phpEditTick.path,
      phpEditTick.content,
    );
    implementationTargetsRef.current = new Map(
      targets.map((target) => [target.position.lineNumber, target.position]),
    );
    implementationDecorationIdsRef.current = editor.deltaDecorations(
      implementationDecorationIdsRef.current,
      targets.map((target) => ({
        options: {
          glyphMargin: {
            position: monaco.editor.GlyphMarginLane.Center,
          },
          glyphMarginClassName: "implementation-gutter-glyph",
          glyphMarginHoverMessage: {
            value: "Go to implementation",
          },
          isWholeLine: false,
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          zIndex: 20,
        },
        range: new monaco.Range(target.position.lineNumber, 1, target.position.lineNumber, 1),
      })),
    );
    implementationDecoratedPathRef.current = phpEditTick.path;
  }, [
    editor,
    implementationDecoratedPathRef,
    implementationDecorationIdsRef,
    implementationTargetsRef,
    monaco,
    phpEditTick,
    workspaceRoot,
  ]);

  useEffect(() => {
    if (!activeDocumentPath || !activeDocumentLanguage || !editor || !monaco) {
      return;
    }

    const model = editor.getModel();

    if (!model || !modelMatchesProject(model, workspaceRoot, activeDocumentPath)) {
      return;
    }

    const decoratedPath = testDecoratedPathRef.current;
    const isPathSwitch = decoratedPath !== null && decoratedPath !== activeDocumentPath;
    const isApplicable =
      (activeDocumentLanguage === "php" && isActiveDocumentPhpTest) || isActiveDocumentJsTest;

    if (!isApplicable || isPathSwitch) {
      testTargetsRef.current = new Map();
      testDecorationIdsRef.current = editor.deltaDecorations(testDecorationIdsRef.current, []);
      testDecoratedPathRef.current = null;
    }
  }, [
    activeDocumentLanguage,
    activeDocumentPath,
    editor,
    isActiveDocumentJsTest,
    isActiveDocumentPhpTest,
    monaco,
    testDecoratedPathRef,
    testDecorationIdsRef,
    testTargetsRef,
    workspaceRoot,
  ]);

  useEffect(() => {
    if (
      !testEditTick ||
      !editor ||
      !monaco ||
      (!isActiveDocumentPhpTest && !isActiveDocumentJsTest)
    ) {
      return;
    }

    const liveModel = editor.getModel();

    if (!liveModel || !modelMatchesProject(liveModel, workspaceRoot, testEditTick.path)) {
      return;
    }

    const targets = isActiveDocumentJsTest
      ? jsGutterTargetsCoordinator.resolveTest(
          workspaceRoot,
          testEditTick.path,
          testEditTick.content,
        )
      : phpGutterTargetsCoordinator.resolveTest(
          workspaceRoot,
          testEditTick.path,
          testEditTick.content,
        );
    testTargetsRef.current = new Map(targets.map((target) => [target.position.lineNumber, target]));
    testDecorationIdsRef.current = editor.deltaDecorations(
      testDecorationIdsRef.current,
      targets.map((target) => ({
        options: {
          glyphMargin: {
            position: monaco.editor.GlyphMarginLane.Right,
          },
          glyphMarginClassName: "test-run-gutter-glyph",
          glyphMarginHoverMessage: {
            value: target.label,
          },
          isWholeLine: false,
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          zIndex: 20,
        },
        range: new monaco.Range(target.position.lineNumber, 1, target.position.lineNumber, 1),
      })),
    );
    testDecoratedPathRef.current = testEditTick.path;
  }, [
    editor,
    isActiveDocumentJsTest,
    isActiveDocumentPhpTest,
    monaco,
    testDecoratedPathRef,
    testDecorationIdsRef,
    testEditTick,
    testTargetsRef,
    workspaceRoot,
  ]);
}
