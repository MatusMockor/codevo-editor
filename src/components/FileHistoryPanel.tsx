import { DiffEditor } from "@monaco-editor/react";
import { GitCommit, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type * as Monaco from "monaco-editor";
import {
  gitBlameRelativeDate,
  type GitFileDiff,
  type GitFileHistoryEntry,
} from "../domain/git";
import {
  defaultEditorFontFamily,
  defaultEditorFontLigatures,
  defaultEditorFontSize,
  monacoFontLigaturesForEditorSetting,
  type MonacoAppTheme,
} from "../domain/settings";
import {
  applyImmediateFallbackTheme,
  setupShikiTokenization,
} from "../infrastructure/shikiHighlighter";

interface FileHistoryPanelProps {
  commits: GitFileHistoryEntry[];
  commitsLoading: boolean;
  diff: GitFileDiff | null;
  diffLoading: boolean;
  editorFontFamily?: string;
  editorFontLigatures?: boolean;
  editorFontSize?: number;
  isOpen: boolean;
  monacoTheme: MonacoAppTheme;
  onClose(): void;
  onSelectCommit(sha: string): void;
  relativePath: string | null;
  selectedSha: string | null;
}

export function FileHistoryPanel({
  commits,
  commitsLoading,
  diff,
  diffLoading,
  editorFontFamily = defaultEditorFontFamily,
  editorFontLigatures = defaultEditorFontLigatures,
  editorFontSize = defaultEditorFontSize,
  isOpen,
  monacoTheme,
  onClose,
  onSelectCommit,
  relativePath,
  selectedSha,
}: FileHistoryPanelProps) {
  const containerRef = useRef<HTMLElement | null>(null);
  const activeRowRef = useRef<HTMLButtonElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!isOpen) {
      setActiveIndex(0);
      return;
    }

    containerRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    setActiveIndex((current) =>
      Math.min(current, Math.max(commits.length - 1, 0)),
    );
  }, [commits.length]);

  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!isOpen) {
    return null;
  }

  const activeCommit = commits[activeIndex];

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) =>
        Math.min(current + 1, Math.max(commits.length - 1, 0)),
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (event.key === "Enter" && activeCommit) {
      event.preventDefault();
      onSelectCommit(activeCommit.sha);
    }
  };

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-label="File History"
        aria-modal="true"
        className="file-history-panel"
        onKeyDown={handleKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
        ref={containerRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="file-history-header">
          <span>
            <strong>File History</strong>
            <small title={relativePath ?? undefined}>
              {relativePath ?? "No file selected"}
            </small>
          </span>
          <button onClick={onClose} title="Close file history" type="button">
            <X aria-hidden="true" size={14} />
          </button>
        </header>

        <div className="file-history-body">
          <div className="file-history-commits" role="listbox">
            {commitsLoading ? (
              <div className="file-history-empty">Loading history</div>
            ) : null}
            {!commitsLoading && commits.length === 0 ? (
              <div className="file-history-empty">No commits for this file</div>
            ) : null}
            {commits.map((commit, index) => (
              <button
                aria-selected={commit.sha === selectedSha}
                className={
                  index === activeIndex
                    ? "file-history-row active"
                    : "file-history-row"
                }
                key={commit.sha}
                onClick={() => {
                  setActiveIndex(index);
                  onSelectCommit(commit.sha);
                }}
                onMouseEnter={() => setActiveIndex(index)}
                ref={index === activeIndex ? activeRowRef : undefined}
                role="option"
                title={commit.subject}
                type="button"
              >
                <GitCommit aria-hidden="true" size={15} />
                <span>
                  <strong>{commit.subject || "(no subject)"}</strong>
                  <small>
                    {commit.sha} · {commit.author} ·{" "}
                    {gitBlameRelativeDate(commit.timestamp)}
                  </small>
                </span>
              </button>
            ))}
          </div>

          <div className="file-history-diff">
            <FileHistoryDiff
              diff={diff}
              editorFontFamily={editorFontFamily}
              editorFontLigatures={editorFontLigatures}
              editorFontSize={editorFontSize}
              isLoading={diffLoading}
              monacoTheme={monacoTheme}
              selectedSha={selectedSha}
            />
          </div>
        </div>
      </section>
    </div>
  );
}

interface FileHistoryDiffProps {
  diff: GitFileDiff | null;
  editorFontFamily: string;
  editorFontLigatures: boolean;
  editorFontSize: number;
  isLoading: boolean;
  monacoTheme: MonacoAppTheme;
  selectedSha: string | null;
}

function FileHistoryDiff({
  diff,
  editorFontFamily,
  editorFontLigatures,
  editorFontSize,
  isLoading,
  monacoTheme,
  selectedSha,
}: FileHistoryDiffProps) {
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

  if (isLoading) {
    return (
      <div className="file-history-diff-empty">
        <p>Loading diff</p>
      </div>
    );
  }

  if (!selectedSha) {
    return (
      <div className="file-history-diff-empty">
        <p>Select a commit to preview its changes.</p>
      </div>
    );
  }

  if (!diff) {
    return (
      <div className="file-history-diff-empty">
        <p>No changes to preview for this commit.</p>
      </div>
    );
  }

  return (
    <DiffEditor
      onMount={(editor) => setDiffEditor(editor)}
      beforeMount={(monaco) => {
        applyImmediateFallbackTheme(monaco, monacoTheme);
        setupShikiTokenization(monaco, monacoTheme).catch((error) => {
          console.error("Shiki tokenization setup failed", error);
        });
      }}
      height="100%"
      language={diff.language}
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
  );
}
