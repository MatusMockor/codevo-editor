import { DiffEditor } from "@monaco-editor/react";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import type * as Monaco from "monaco-editor";
import {
  defaultEditorFontFamily,
  defaultEditorFontLigatures,
  defaultEditorFontSize,
  monacoFontLigaturesForEditorSetting,
  type MonacoAppTheme,
} from "../domain/settings";
import type { GitFileDiff } from "../domain/git";
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
}

export function GitDiffPreview({
  diff,
  isLoading,
  monacoTheme,
  editorFontFamily = defaultEditorFontFamily,
  editorFontLigatures = defaultEditorFontLigatures,
  editorFontSize = defaultEditorFontSize,
  onClose,
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
        <button onClick={onClose} title="Close diff" type="button">
          <X aria-hidden="true" size={14} />
        </button>
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
