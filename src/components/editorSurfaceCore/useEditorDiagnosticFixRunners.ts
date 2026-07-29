import { useEffect } from "react";
import type * as Monaco from "monaco-editor";
import { applicableEslintFixes, type EslintFix } from "../../domain/eslintDiagnostics";
import type {
  EditorSurfaceBufferFixRunner,
  EditorSurfacePhpstanIgnoreRunner,
} from "../../application/useWorkbenchCodeQualityDiagnostics";
import type { EditorSurfaceEslintDisableRunner } from "../../application/workbenchEslintDisableCommand";
import { modelMatchesProject } from "../editorSurfaceModelIdentity";

interface EditorDiagnosticFixRunnerOptions {
  readonly activeDocumentPath: string | null | undefined;
  readonly editor: Monaco.editor.IStandaloneCodeEditor | null;
  readonly monaco: typeof Monaco | null;
  readonly onEditorSurfaceBufferFixRunnerChange?: (
    runner: EditorSurfaceBufferFixRunner | null,
  ) => void;
  readonly onEditorSurfaceEslintDisableRunnerChange?: (
    runner: EditorSurfaceEslintDisableRunner | null,
  ) => void;
  readonly onEditorSurfacePhpstanIgnoreRunnerChange?: (
    runner: EditorSurfacePhpstanIgnoreRunner | null,
  ) => void;
  readonly workspaceRoot: string | null;
}

/**
 * Publishes buffer-local diagnostic fixes. Every runner validates the captured
 * document path and expected buffer before it mutates Monaco.
 */
export function useEditorDiagnosticFixRunners({
  activeDocumentPath,
  editor,
  monaco,
  onEditorSurfaceBufferFixRunnerChange,
  onEditorSurfaceEslintDisableRunnerChange,
  onEditorSurfacePhpstanIgnoreRunnerChange,
  workspaceRoot,
}: EditorDiagnosticFixRunnerOptions): void {
  useEffect(() => {
    if (!onEditorSurfaceBufferFixRunnerChange) {
      return;
    }

    if (!editor || !monaco || !activeDocumentPath) {
      onEditorSurfaceBufferFixRunnerChange(null);
      return;
    }

    const targetPath = activeDocumentPath;
    const runner: EditorSurfaceBufferFixRunner = (expectedContent, fixes) => {
      const model = editor.getModel();

      if (!model || !modelMatchesProject(model, workspaceRoot, targetPath)) {
        return null;
      }

      if (model.getValue() !== expectedContent) {
        return null;
      }

      const applicable = applicableEslintFixes(expectedContent, fixes);

      if (applicable.length === 0) {
        return 0;
      }

      const edits = applicable.map((fix: EslintFix) => {
        const start = model.getPositionAt(fix.range[0]);
        const end = model.getPositionAt(fix.range[1]);

        return {
          forceMoveMarkers: true,
          range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
          text: fix.text,
        };
      });

      if (!editor.executeEdits("eslint.fixAllInActiveFile", edits)) {
        return null;
      }

      return applicable.length;
    };

    onEditorSurfaceBufferFixRunnerChange(runner);

    return () => {
      onEditorSurfaceBufferFixRunnerChange(null);
    };
  }, [activeDocumentPath, editor, monaco, onEditorSurfaceBufferFixRunnerChange, workspaceRoot]);

  useEffect(() => {
    if (!onEditorSurfaceEslintDisableRunnerChange) {
      return;
    }

    if (!editor || !monaco || !activeDocumentPath) {
      onEditorSurfaceEslintDisableRunnerChange(null);
      return;
    }

    const targetPath = activeDocumentPath;
    const runner: EditorSurfaceEslintDisableRunner = (expectedContent, lineNumber, identifiers) => {
      const model = editor.getModel();

      if (!model || !modelMatchesProject(model, workspaceRoot, targetPath)) {
        return null;
      }

      if (model.getValue() !== expectedContent) {
        return null;
      }

      if (identifiers.length === 0 || lineNumber < 1 || lineNumber > model.getLineCount()) {
        return 0;
      }

      const indentation = /^\s*/.exec(model.getLineContent(lineNumber))?.[0] ?? "";
      const edit = {
        forceMoveMarkers: true,
        range: new monaco.Range(lineNumber, 1, lineNumber, 1),
        text: `${indentation}// eslint-disable-next-line ${identifiers.join(", ")}\n`,
      };

      if (!editor.executeEdits("eslint.disableRuleAtCursor", [edit])) {
        return null;
      }

      return identifiers.length;
    };

    onEditorSurfaceEslintDisableRunnerChange(runner);

    return () => {
      onEditorSurfaceEslintDisableRunnerChange(null);
    };
  }, [activeDocumentPath, editor, monaco, onEditorSurfaceEslintDisableRunnerChange, workspaceRoot]);

  useEffect(() => {
    if (!onEditorSurfacePhpstanIgnoreRunnerChange) {
      return;
    }

    if (!editor || !monaco || !activeDocumentPath) {
      onEditorSurfacePhpstanIgnoreRunnerChange(null);
      return;
    }

    const targetPath = activeDocumentPath;
    const runner: EditorSurfacePhpstanIgnoreRunner = (expectedContent, lineNumber, identifiers) => {
      const model = editor.getModel();

      if (!model || !modelMatchesProject(model, workspaceRoot, targetPath)) {
        return null;
      }

      if (model.getValue() !== expectedContent) {
        return null;
      }

      if (identifiers.length === 0 || lineNumber < 1 || lineNumber > model.getLineCount()) {
        return 0;
      }

      const indentation = /^\s*/.exec(model.getLineContent(lineNumber))?.[0] ?? "";
      const edit = {
        forceMoveMarkers: true,
        range: new monaco.Range(lineNumber, 1, lineNumber, 1),
        text: `${indentation}// @phpstan-ignore ${identifiers.join(", ")}\n`,
      };

      if (!editor.executeEdits("phpstan.ignoreIssueAtCursor", [edit])) {
        return null;
      }

      return identifiers.length;
    };

    onEditorSurfacePhpstanIgnoreRunnerChange(runner);

    return () => {
      onEditorSurfacePhpstanIgnoreRunnerChange(null);
    };
  }, [activeDocumentPath, editor, monaco, onEditorSurfacePhpstanIgnoreRunnerChange, workspaceRoot]);
}
