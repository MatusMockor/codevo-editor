import { ChevronDown, ChevronUp, Minus, Plus, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import {
  defaultEditorFontFamily,
  defaultEditorFontLigatures,
  defaultEditorFontSize,
  type MonacoAppTheme,
} from "../domain/settings";
import type { GitChangedFile, GitDiffHunk, GitFileDiff } from "../domain/git";

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
  monacoTheme: _monacoTheme,
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
  const [hunks, setHunks] = useState<GitDiffHunk[]>([]);
  const [activeChangeIndex, setActiveChangeIndex] = useState(0);
  const changeRowRefs = useRef<Array<HTMLTableRowElement | null>>([]);
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
  const diffRows = useMemo(
    () => buildPlainDiffRows(diffOriginalContent, diffModifiedContent),
    [diffOriginalContent, diffModifiedContent],
  );
  const changeRowCount = diffRows.reduce(
    (count, row) => count + (isChangedPlainDiffRow(row) ? 1 : 0),
    0,
  );

  useEffect(() => {
    setActiveChangeIndex(0);
    changeRowRefs.current = [];
  }, [
    changeRelativePath,
    changeIsStaged,
    diffOriginalContent,
    diffModifiedContent,
  ]);

  useEffect(() => {
    if (!loadFileHunks || !changeRelativePath || !supportsHunkStaging) {
      setHunks([]);
      return;
    }

    let cancelled = false;
    const relativePath = changeRelativePath;
    const staged = changeIsStaged;

    const applyLoadedHunks = (loaded: GitDiffHunk[]) => {
      // Guard against an out-of-order resolve after the selected change moved
      // on (per-tab isolation; the latest selection wins).
      if (
        cancelled ||
        relativePath !== changeRelativePath ||
        staged !== changeIsStaged
      ) {
        return;
      }

      // Per-hunk staging is a non-essential overlay on top of the diff. A
      // malformed/undefined payload from the hunk command must never break the
      // diff render, so only keep hunks that are safe to render and address
      // back to the hunk-staging command.
      setHunks(normalizeGitDiffHunks(loaded));
    };

    // The hunk load is best-effort. If the underlying command rejects (missing,
    // failing, or unavailable), swallow it and keep the hunk list empty so the
    // diff preview still renders instead of crashing the whole view to a blank
    // screen (there is no error boundary around this tree).
    void Promise.resolve()
      .then(() => loadFileHunks(relativePath, staged))
      .then(applyLoadedHunks)
      .catch((error) => {
        console.error("Loading git file hunks failed", error);

        if (cancelled) {
          return;
        }

        setHunks([]);
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
      if (changeRowCount === 0) {
        return;
      }

      const nextIndex =
        target === "next"
          ? (activeChangeIndex + 1) % changeRowCount
          : (activeChangeIndex - 1 + changeRowCount) % changeRowCount;
      setActiveChangeIndex(nextIndex);

      changeRowRefs.current[nextIndex]?.scrollIntoView({
        block: "center",
        inline: "nearest",
      });
    },
    [activeChangeIndex, changeRowCount],
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
            disabled={changeRowCount === 0}
            onClick={onPreviousChange}
            title="Previous change"
            type="button"
          >
            <ChevronUp aria-hidden="true" size={14} />
          </button>
          <button
            disabled={changeRowCount === 0}
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
      {supportsHunkStaging && Array.isArray(hunks) && hunks.length > 0 ? (
        <GitDiffHunkList
          disabled={gitOperationLoading}
          hunks={hunks}
          staged={changeIsStaged}
          onToggleHunk={onToggleHunk}
        />
      ) : null}
      <PlainGitDiff
        activeChangeIndex={activeChangeIndex}
        changeRowRefs={changeRowRefs}
        fontFamily={editorFontFamily}
        fontLigatures={editorFontLigatures}
        fontSize={editorFontSize}
        rows={diffRows}
      />
    </section>
  );
}

interface GitDiffHunkListProps {
  disabled: boolean;
  hunks: GitDiffHunk[];
  staged: boolean;
  onToggleHunk(hunkIndex: number): void;
}

// PhpStorm-style per-hunk staging. A checkbox per hunk stages (or, when viewing
// the staged side, unstages) exactly that hunk; the surrounding diff preview
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

interface PlainGitDiffProps {
  activeChangeIndex: number;
  changeRowRefs: MutableRefObject<Array<HTMLTableRowElement | null>>;
  fontFamily: string;
  fontLigatures: boolean;
  fontSize: number;
  rows: PlainDiffRow[];
}

function PlainGitDiff({
  activeChangeIndex,
  changeRowRefs,
  fontFamily,
  fontLigatures,
  fontSize,
  rows,
}: PlainGitDiffProps) {
  let changeIndex = -1;

  return (
    <div
      className="git-plain-diff"
      data-testid="plain-git-diff"
      style={{
        fontFamily,
        fontSize,
        fontVariantLigatures: fontLigatures ? "normal" : "none",
      }}
    >
      {rows.length === 0 ? (
        <div className="git-plain-diff-empty">No differences.</div>
      ) : (
        <table>
          <tbody>
            {rows.map((row, index) => {
              if (row.kind === "header") {
                return (
                  <tr className="git-plain-diff-row header" key={index}>
                    <td className="git-plain-diff-line" />
                    <td className="git-plain-diff-line" />
                    <td className="git-plain-diff-code" colSpan={2}>
                      {row.text}
                    </td>
                  </tr>
                );
              }

              const changed = isChangedPlainDiffRow(row);
              if (changed) {
                changeIndex += 1;
              }

              return (
                <tr
                  className={`git-plain-diff-row ${row.kind}${
                    changed && changeIndex === activeChangeIndex ? " active" : ""
                  }`}
                  key={index}
                  ref={
                    changed
                      ? (element) => {
                          changeRowRefs.current[changeIndex] = element;
                        }
                      : undefined
                  }
                >
                  <td className="git-plain-diff-line">
                    {row.originalLineNumber ?? ""}
                  </td>
                  <td className="git-plain-diff-line">
                    {row.modifiedLineNumber ?? ""}
                  </td>
                  <td className="git-plain-diff-marker">{row.marker}</td>
                  <td className="git-plain-diff-code">
                    {row.text.length > 0 ? row.text : " "}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function hunkSummary(hunk: GitDiffHunk): { added: number; removed: number } {
  let added = 0;
  let removed = 0;

  const lines = Array.isArray(hunk.lines) ? hunk.lines : [];

  for (const line of lines) {
    if (typeof line !== "string") {
      continue;
    }

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

function normalizeGitDiffHunks(loaded: unknown): GitDiffHunk[] {
  if (!Array.isArray(loaded)) {
    return [];
  }

  const hunks: GitDiffHunk[] = [];

  for (const hunk of loaded) {
    if (!isRenderableGitDiffHunk(hunk)) {
      continue;
    }

    hunks.push({
      header: hunk.header,
      index: hunk.index,
      isStaged: hunk.isStaged,
      lines: hunk.lines.filter(
        (line): line is string => typeof line === "string",
      ),
    });
  }

  return hunks;
}

function isRenderableGitDiffHunk(hunk: unknown): hunk is GitDiffHunk {
  if (!hunk || typeof hunk !== "object") {
    return false;
  }

  const candidate = hunk as Partial<GitDiffHunk>;
  const index = candidate.index;

  return (
    typeof candidate.header === "string" &&
    typeof index === "number" &&
    Number.isInteger(index) &&
    index >= 0 &&
    Array.isArray(candidate.lines) &&
    typeof candidate.isStaged === "boolean"
  );
}

type DiffNavigationTarget = "next" | "previous";

type PlainDiffRow =
  | { kind: "header"; text: string }
  | {
      kind: "context" | "added" | "removed";
      marker: " " | "+" | "-";
      modifiedLineNumber: number | null;
      originalLineNumber: number | null;
      text: string;
    };

function isChangedPlainDiffRow(row: PlainDiffRow): boolean {
  return row.kind === "added" || row.kind === "removed";
}

function buildPlainDiffRows(
  originalContent: string,
  modifiedContent: string,
): PlainDiffRow[] {
  const originalLines = splitDiffLines(originalContent ?? "");
  const modifiedLines = splitDiffLines(modifiedContent ?? "");

  if (linesEqual(originalLines, modifiedLines)) {
    return [];
  }

  let prefixLength = 0;
  while (
    prefixLength < originalLines.length &&
    prefixLength < modifiedLines.length &&
    originalLines[prefixLength] === modifiedLines[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < originalLines.length - prefixLength &&
    suffixLength < modifiedLines.length - prefixLength &&
    originalLines[originalLines.length - 1 - suffixLength] ===
      modifiedLines[modifiedLines.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  const context = 3;
  const originalChangeEnd = originalLines.length - suffixLength;
  const modifiedChangeEnd = modifiedLines.length - suffixLength;
  const originalHunkStart = Math.max(0, prefixLength - context);
  const modifiedHunkStart = Math.max(0, prefixLength - context);
  const originalHunkEnd = Math.min(
    originalLines.length,
    originalChangeEnd + context,
  );
  const modifiedHunkEnd = Math.min(
    modifiedLines.length,
    modifiedChangeEnd + context,
  );
  const rows: PlainDiffRow[] = [
    {
      kind: "header",
      text: `@@ -${formatRange(
        originalHunkStart + 1,
        originalHunkEnd - originalHunkStart,
      )} +${formatRange(
        modifiedHunkStart + 1,
        modifiedHunkEnd - modifiedHunkStart,
      )} @@`,
    },
  ];

  for (let index = originalHunkStart; index < prefixLength; index += 1) {
    rows.push({
      kind: "context",
      marker: " ",
      modifiedLineNumber: index + 1,
      originalLineNumber: index + 1,
      text: originalLines[index] ?? "",
    });
  }

  for (let index = prefixLength; index < originalChangeEnd; index += 1) {
    rows.push({
      kind: "removed",
      marker: "-",
      modifiedLineNumber: null,
      originalLineNumber: index + 1,
      text: originalLines[index] ?? "",
    });
  }

  for (let index = prefixLength; index < modifiedChangeEnd; index += 1) {
    rows.push({
      kind: "added",
      marker: "+",
      modifiedLineNumber: index + 1,
      originalLineNumber: null,
      text: modifiedLines[index] ?? "",
    });
  }

  for (let index = originalChangeEnd; index < originalHunkEnd; index += 1) {
    const modifiedLineNumber =
      modifiedChangeEnd + (index - originalChangeEnd) + 1;
    rows.push({
      kind: "context",
      marker: " ",
      modifiedLineNumber,
      originalLineNumber: index + 1,
      text: originalLines[index] ?? "",
    });
  }

  return rows;
}

function splitDiffLines(content: string): string[] {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (normalized.length === 0) {
    return [];
  }

  const lines = normalized.split("\n");

  if (lines.length > 1 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines;
}

function linesEqual(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((line, index) => line === right[index])
  );
}

function formatRange(startLine: number, lineCount: number): string {
  if (lineCount <= 1) {
    return String(startLine);
  }

  return `${startLine},${lineCount}`;
}
