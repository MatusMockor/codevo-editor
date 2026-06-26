import { DiffEditor } from "@monaco-editor/react";
import { ChevronDown, ChevronUp, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type * as Monaco from "monaco-editor";
import {
  defaultEditorFontFamily,
  defaultEditorFontLigatures,
  defaultEditorFontSize,
  monacoFontLigaturesForEditorSetting,
  type MonacoAppTheme,
} from "../domain/settings";
import type { GitChangedFile, GitFileDiff } from "../domain/git";
import {
  applyImmediateFallbackTheme,
  setupShikiTokenization,
} from "../infrastructure/shikiHighlighter";

interface GitDiffPreviewProps {
  diff: GitFileDiff | null;
  isLoading: boolean;
  monacoTheme: MonacoAppTheme;
  editorFontFamily?: string;
  editorFontLigatures?: boolean;
  editorFontSize?: number;
  onClose(): void;
  onRevertFile?(change: GitChangedFile): void;
}

export function GitDiffPreview({
  diff,
  isLoading,
  monacoTheme,
  editorFontFamily = defaultEditorFontFamily,
  editorFontLigatures = defaultEditorFontLigatures,
  editorFontSize = defaultEditorFontSize,
  onClose,
  onRevertFile,
}: GitDiffPreviewProps) {
  const [diffEditor, setDiffEditor] = useState<
    Monaco.editor.IStandaloneDiffEditor | null
  >(null);
  const monacoFontLigatures =
    monacoFontLigaturesForEditorSetting(editorFontLigatures);

  useEffect(() => {
    if (!diffEditor) {
      return;
    }

    diffEditor.updateOptions({
      fontFamily: editorFontFamily,
      fontLigatures: monacoFontLigatures,
      fontSize: editorFontSize,
    });
  }, [diffEditor, editorFontFamily, monacoFontLigatures, editorFontSize]);

  const goToChange = useCallback(
    (target: DiffNavigationTarget) => {
      if (!diffEditor) {
        return;
      }

      if (typeof diffEditor.goToDiff === "function") {
        diffEditor.goToDiff(target);
        return;
      }

      navigateLineChanges(diffEditor, target);
    },
    [diffEditor],
  );

  const onNextChange = useCallback(() => goToChange("next"), [goToChange]);
  const onPreviousChange = useCallback(
    () => goToChange("previous"),
    [goToChange],
  );

  const onRevert = useCallback(() => {
    if (!diff || !onRevertFile) {
      return;
    }

    onRevertFile(diff.change);
  }, [diff, onRevertFile]);

  if (isLoading) {
    return (
      <div className="empty-editor">
        <p>Loading diff</p>
      </div>
    );
  }

  if (!diff) {
    return (
      <div className="empty-editor">
        <p>Select a changed file to preview diff.</p>
      </div>
    );
  }

  return (
    <section className="git-diff-preview" aria-label="Git diff">
      <header className="git-diff-header">
        <div>
          <strong>{diff.change.relativePath}</strong>
          <span>{diff.change.status}</span>
        </div>
        <div className="git-diff-toolbar" aria-label="Diff actions">
          <button
            disabled={!diffEditor}
            onClick={onPreviousChange}
            title="Previous change"
            type="button"
          >
            <ChevronUp aria-hidden="true" size={14} />
          </button>
          <button
            disabled={!diffEditor}
            onClick={onNextChange}
            title="Next change"
            type="button"
          >
            <ChevronDown aria-hidden="true" size={14} />
          </button>
          {onRevertFile ? (
            <button onClick={onRevert} title="Revert file" type="button">
              <RotateCcw aria-hidden="true" size={14} />
            </button>
          ) : null}
          <button onClick={onClose} title="Close diff" type="button">
            <X aria-hidden="true" size={14} />
          </button>
        </div>
      </header>
      <div className="editor-panel">
        <DiffEditor
          onMount={(editor) => setDiffEditor(editor)}
          beforeMount={(monaco) => {
            // Apply a matching built-in dark/light theme synchronously so the
            // diff editor paints the correct background on its first frame.
            // Without this, Monaco renders the default white `vs` theme until
            // the async Shiki setup below resolves and calls `setTheme`,
            // producing a white flash when switching to/from the git diff view.
            applyImmediateFallbackTheme(monaco, monacoTheme);
            setupShikiTokenization(monaco, monacoTheme).catch((error) => {
              console.error("Shiki tokenization setup failed", error);
            });
          }}
          height="100%"
          language={diff.language}
          loading={<GitDiffLoadingPlaceholder />}
          modified={diff.modifiedContent}
          original={diff.originalContent}
          options={{
            automaticLayout: true,
            fontFamily: editorFontFamily,
            fontLigatures: monacoFontLigatures,
            fontSize: editorFontSize,
            lineHeight: 20,
            minimap: { enabled: false },
            originalEditable: false,
            readOnly: true,
            renderSideBySide: true,
            scrollBeyondLastLine: false,
          }}
          theme={monacoTheme}
        />
      </div>
    </section>
  );
}

// Rendered via the Monaco `loading` prop. Monaco's default loading element is a
// white "Loading…" box; this matches the dark editor surface background so the
// diff editor never flashes white while the Monaco chunk loads.
function GitDiffLoadingPlaceholder() {
  return <div className="editor-loading-placeholder" aria-hidden="true" />;
}

type DiffNavigationTarget = "next" | "previous";

// Fallback used when the Monaco diff editor build does not expose `goToDiff`.
// Computes the diff regions via `getLineChanges`, then moves the modified
// editor's caret to the change before/after the current caret line and reveals
// it centered. Keeps navigation local to this diff editor instance.
function navigateLineChanges(
  diffEditor: Monaco.editor.IStandaloneDiffEditor,
  target: DiffNavigationTarget,
): void {
  const lineChanges = diffEditor.getLineChanges?.();

  if (!lineChanges || lineChanges.length === 0) {
    return;
  }

  const modifiedEditor = diffEditor.getModifiedEditor?.();

  if (!modifiedEditor) {
    return;
  }

  const changeLines = lineChanges.map((change) =>
    Math.max(
      1,
      change.modifiedStartLineNumber ?? change.modifiedEndLineNumber,
    ),
  );
  const currentLine = modifiedEditor.getPosition()?.lineNumber ?? 1;
  const targetLine = nextChangeLine(changeLines, currentLine, target);

  if (targetLine === null) {
    return;
  }

  modifiedEditor.setPosition({ column: 1, lineNumber: targetLine });
  modifiedEditor.revealLineInCenter(targetLine);
  modifiedEditor.focus();
}

function nextChangeLine(
  changeLines: number[],
  currentLine: number,
  target: DiffNavigationTarget,
): number | null {
  if (target === "next") {
    const forward = changeLines.find((line) => line > currentLine);
    return forward ?? changeLines[0] ?? null;
  }

  const backward = [...changeLines]
    .reverse()
    .find((line) => line < currentLine);
  return backward ?? changeLines[changeLines.length - 1] ?? null;
}
