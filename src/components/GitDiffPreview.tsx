import { DiffEditor } from "@monaco-editor/react";
import { ChevronDown, ChevronUp, Minus, Plus, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type * as Monaco from "monaco-editor";
import {
  defaultEditorFontFamily,
  defaultEditorFontLigatures,
  defaultEditorFontSize,
  monacoFontLigaturesForEditorSetting,
  type MonacoAppTheme,
} from "../domain/settings";
import type { GitChangedFile, GitDiffHunk, GitFileDiff } from "../domain/git";
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
  /** True while a stage/unstage operation is running; disables hunk actions. */
  gitOperationLoading?: boolean;
  onClose(): void;
  onRevertFile?(change: GitChangedFile): void;
  /** Loads the file's hunks (staged or worktree) for per-hunk staging. */
  loadFileHunks?(relativePath: string, staged: boolean): Promise<GitDiffHunk[]>;
  onStageHunk?(relativePath: string, hunkIndex: number): void;
  onUnstageHunk?(relativePath: string, hunkIndex: number): void;
}

export function GitDiffPreview({
  diff,
  isLoading,
  monacoTheme,
  editorFontFamily = defaultEditorFontFamily,
  editorFontLigatures = defaultEditorFontLigatures,
  editorFontSize = defaultEditorFontSize,
  gitOperationLoading = false,
  onClose,
  onRevertFile,
  loadFileHunks,
  onStageHunk,
  onUnstageHunk,
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

  const [hunks, setHunks] = useState<GitDiffHunk[]>([]);
  const changeRelativePath = diff?.change.relativePath ?? null;
  const changeIsStaged = diff?.change.isStaged ?? false;
  const changeStatus = diff?.change.status ?? null;
  // Per-hunk staging only applies to tracked text changes. Untracked files have
  // no `git diff` hunks (they would need intent-to-add first) and conflicts are
  // resolved through the editor, not hunk staging.
  const supportsHunkStaging =
    Boolean(loadFileHunks) &&
    changeStatus !== null &&
    changeStatus !== "untracked" &&
    changeStatus !== "conflicted";
  // `modifiedContent`/`originalContent` change after each stage/unstage, so
  // including them re-loads the hunks to reflect the new index state.
  const diffOriginalContent = diff?.originalContent ?? "";
  const diffModifiedContent = diff?.modifiedContent ?? "";

  useEffect(() => {
    if (!loadFileHunks || !changeRelativePath || !supportsHunkStaging) {
      setHunks([]);
      return;
    }

    let cancelled = false;
    const relativePath = changeRelativePath;
    const staged = changeIsStaged;

    void loadFileHunks(relativePath, staged).then((loaded) => {
      // Guard against an out-of-order resolve after the selected change moved
      // on (per-tab isolation; the latest selection wins).
      if (
        cancelled ||
        relativePath !== changeRelativePath ||
        staged !== changeIsStaged
      ) {
        return;
      }

      setHunks(loaded);
    });

    return () => {
      cancelled = true;
    };
  }, [
    changeIsStaged,
    changeRelativePath,
    diffModifiedContent,
    diffOriginalContent,
    loadFileHunks,
    supportsHunkStaging,
  ]);

  const onToggleHunk = useCallback(
    (hunkIndex: number) => {
      if (!changeRelativePath || gitOperationLoading) {
        return;
      }

      if (changeIsStaged) {
        onUnstageHunk?.(changeRelativePath, hunkIndex);
        return;
      }

      onStageHunk?.(changeRelativePath, hunkIndex);
    },
    [
      changeIsStaged,
      changeRelativePath,
      gitOperationLoading,
      onStageHunk,
      onUnstageHunk,
    ],
  );

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
      {supportsHunkStaging && hunks.length > 0 ? (
        <GitDiffHunkList
          disabled={gitOperationLoading}
          hunks={hunks}
          staged={changeIsStaged}
          onToggleHunk={onToggleHunk}
        />
      ) : null}
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

interface GitDiffHunkListProps {
  disabled: boolean;
  hunks: GitDiffHunk[];
  staged: boolean;
  onToggleHunk(hunkIndex: number): void;
}

// PhpStorm-style per-hunk staging. A checkbox per hunk stages (or, when viewing
// the staged side, unstages) exactly that hunk; the surrounding diff editor
// re-renders against the new index state after the operation resolves.
function GitDiffHunkList({
  disabled,
  hunks,
  staged,
  onToggleHunk,
}: GitDiffHunkListProps) {
  const actionVerb = staged ? "Unstage" : "Stage";

  return (
    <ul className="git-diff-hunks" aria-label="File hunks">
      {hunks.map((hunk) => {
        const summary = hunkSummary(hunk);

        return (
          <li className="git-diff-hunk" key={hunk.index}>
            <label className="git-diff-hunk-toggle">
              <input
                aria-label={`${actionVerb} hunk ${hunk.index + 1}`}
                checked={staged}
                disabled={disabled}
                onChange={() => onToggleHunk(hunk.index)}
                type="checkbox"
              />
              <span aria-hidden="true" className="git-diff-hunk-icon">
                {staged ? <Minus size={12} /> : <Plus size={12} />}
              </span>
            </label>
            <code className="git-diff-hunk-header">{hunk.header}</code>
            <span className="git-diff-hunk-summary">
              {summary.added > 0 ? (
                <span className="git-diff-hunk-added">+{summary.added}</span>
              ) : null}
              {summary.removed > 0 ? (
                <span className="git-diff-hunk-removed">-{summary.removed}</span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function hunkSummary(hunk: GitDiffHunk): { added: number; removed: number } {
  let added = 0;
  let removed = 0;

  for (const line of hunk.lines) {
    if (line.startsWith("+")) {
      added += 1;
      continue;
    }

    if (line.startsWith("-")) {
      removed += 1;
    }
  }

  return { added, removed };
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
