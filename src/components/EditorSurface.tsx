import Editor from "@monaco-editor/react";
import type { EditorDocument } from "../domain/workspace";
import { getTabId, getTabPanelId } from "./tabIds";

interface EditorSurfaceProps {
  activeDocument: EditorDocument | null;
  onChange(content: string): void;
}

export function EditorSurface({ activeDocument, onChange }: EditorSurfaceProps) {
  if (!activeDocument) {
    return (
      <div className="empty-editor">
        <p>Open a file to start editing.</p>
      </div>
    );
  }

  return (
    <div
      aria-labelledby={getTabId(activeDocument.path)}
      className="editor-panel"
      id={getTabPanelId(activeDocument.path)}
      role="tabpanel"
    >
    <Editor
      height="100%"
      language={activeDocument.language}
      onChange={(value) => onChange(value || "")}
      options={{
        automaticLayout: true,
        fontFamily:
          "JetBrains Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 13,
        lineHeight: 20,
        minimap: { enabled: false },
        padding: { top: 14, bottom: 14 },
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        tabSize: 2,
      }}
      path={activeDocument.path}
      theme="vs-dark"
      value={activeDocument.content}
    />
    </div>
  );
}
