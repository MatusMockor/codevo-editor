import { DiffEditor } from "@monaco-editor/react";
import type { MonacoAppTheme } from "../domain/settings";
import type { GitFileDiff } from "../domain/git";
import { registerMonacoAppThemes } from "./monacoThemes";

interface GitDiffPreviewProps {
  diff: GitFileDiff | null;
  isLoading: boolean;
  monacoTheme: MonacoAppTheme;
}

export function GitDiffPreview({
  diff,
  isLoading,
  monacoTheme,
}: GitDiffPreviewProps) {
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
        <strong>{diff.change.relativePath}</strong>
        <span>{diff.change.status}</span>
      </header>
      <div className="editor-panel">
        <DiffEditor
          beforeMount={registerMonacoAppThemes}
          height="100%"
          language={diff.language}
          modified={diff.modifiedContent}
          original={diff.originalContent}
          options={{
            automaticLayout: true,
            fontFamily:
              "JetBrains Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            fontSize: 13,
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
