import { DiffEditor } from "@monaco-editor/react";
import { History, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type * as Monaco from "monaco-editor";
import {
  localHistoryAbsoluteTime,
  localHistoryRelativeTime,
  type LocalHistoryDiff,
  type LocalHistoryVersion,
} from "../domain/localHistory";
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

interface LocalHistoryPanelProps {
  diff: LocalHistoryDiff | null;
  diffLoading: boolean;
  editorFontFamily?: string;
  editorFontLigatures?: boolean;
  editorFontSize?: number;
  isOpen: boolean;
  monacoTheme: MonacoAppTheme;
  onClose(): void;
  onRevertVersion(versionId: string): void;
  onSelectVersion(versionId: string): void;
  relativePath: string | null;
  selectedVersionId: string | null;
  versions: LocalHistoryVersion[];
  versionsLoading: boolean;
}

export function LocalHistoryPanel({
  diff,
  diffLoading,
  editorFontFamily = defaultEditorFontFamily,
  editorFontLigatures = defaultEditorFontLigatures,
  editorFontSize = defaultEditorFontSize,
  isOpen,
  monacoTheme,
  onClose,
  onRevertVersion,
  onSelectVersion,
  relativePath,
  selectedVersionId,
  versions,
  versionsLoading,
}: LocalHistoryPanelProps) {
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
      Math.min(current, Math.max(versions.length - 1, 0)),
    );
  }, [versions.length]);

  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!isOpen) {
    return null;
  }

  const activeVersion = versions[activeIndex];

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) =>
        Math.min(current + 1, Math.max(versions.length - 1, 0)),
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (event.key === "Enter" && activeVersion) {
      event.preventDefault();
      onSelectVersion(activeVersion.id);
    }
  };

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-label="Local History"
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
            <strong>Local History</strong>
            <small title={relativePath ?? undefined}>
              {relativePath ?? "No file selected"}
            </small>
          </span>
          <button onClick={onClose} title="Close local history" type="button">
            <X aria-hidden="true" size={14} />
          </button>
        </header>

        <div className="file-history-body">
          <div className="file-history-commits" role="listbox">
            {versionsLoading ? (
              <div className="file-history-empty">Loading history</div>
            ) : null}
            {!versionsLoading && versions.length === 0 ? (
              <div className="file-history-empty">
                No local history for this file yet. Versions are captured on
                save.
              </div>
            ) : null}
            {versions.map((version, index) => (
              <button
                aria-selected={version.id === selectedVersionId}
                className={
                  index === activeIndex
                    ? "file-history-row active"
                    : "file-history-row"
                }
                key={version.id}
                onClick={() => {
                  setActiveIndex(index);
                  onSelectVersion(version.id);
                }}
                onMouseEnter={() => setActiveIndex(index)}
                ref={index === activeIndex ? activeRowRef : undefined}
                role="option"
                title={localHistoryAbsoluteTime(version.timestampMs)}
                type="button"
              >
                <History aria-hidden="true" size={15} />
                <span>
                  <strong>{localHistoryRelativeTime(version.timestampMs)}</strong>
                  <small>{localHistoryAbsoluteTime(version.timestampMs)}</small>
                </span>
              </button>
            ))}
          </div>

          <div className="file-history-diff">
            <LocalHistoryDiffView
              diff={diff}
              editorFontFamily={editorFontFamily}
              editorFontLigatures={editorFontLigatures}
              editorFontSize={editorFontSize}
              isLoading={diffLoading}
              monacoTheme={monacoTheme}
              onRevert={
                selectedVersionId
                  ? () => onRevertVersion(selectedVersionId)
                  : undefined
              }
              selectedVersionId={selectedVersionId}
            />
          </div>
        </div>
      </section>
    </div>
  );
}

interface LocalHistoryDiffViewProps {
  diff: LocalHistoryDiff | null;
  editorFontFamily: string;
  editorFontLigatures: boolean;
  editorFontSize: number;
  isLoading: boolean;
  monacoTheme: MonacoAppTheme;
  onRevert?: () => void;
  selectedVersionId: string | null;
}

function LocalHistoryDiffView({
  diff,
  editorFontFamily,
  editorFontLigatures,
  editorFontSize,
  isLoading,
  monacoTheme,
  onRevert,
  selectedVersionId,
}: LocalHistoryDiffViewProps) {
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

  if (!selectedVersionId) {
    return (
      <div className="file-history-diff-empty">
        <p>Select a version to compare it with the current file.</p>
      </div>
    );
  }

  if (!diff) {
    return (
      <div className="file-history-diff-empty">
        <p>No content to preview for this version.</p>
      </div>
    );
  }

  return (
    <>
      <div className="local-history-diff-toolbar">
        <span>Selected version (left) vs current file (right)</span>
        <button
          className="local-history-revert"
          onClick={onRevert}
          title="Revert the file to this version"
          type="button"
        >
          <RotateCcw aria-hidden="true" size={13} />
          Revert to this version
        </button>
      </div>
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
    </>
  );
}
