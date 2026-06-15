import Editor from "@monaco-editor/react";
import type { OnMount } from "@monaco-editor/react";
import { useEffect, useRef, useState } from "react";
import type * as Monaco from "monaco-editor";
import type { LanguageServerFeaturesGateway } from "../domain/languageServerFeatures";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import type { EditorDocument } from "../domain/workspace";
import { registerLanguageServerMonacoProviders } from "./languageServerMonacoProviders";
import { getTabId, getTabPanelId } from "./tabIds";

interface EditorSurfaceProps {
  activeDocument: EditorDocument | null;
  flushPendingLanguageServerDocument(path: string): Promise<void>;
  languageServerFeaturesGateway: LanguageServerFeaturesGateway;
  languageServerRuntimeStatus: LanguageServerRuntimeStatus | null;
  onChange(content: string): void;
  onLanguageServerError(error: unknown): void;
}

export function EditorSurface({
  activeDocument,
  flushPendingLanguageServerDocument,
  languageServerFeaturesGateway,
  languageServerRuntimeStatus,
  onChange,
  onLanguageServerError,
}: EditorSurfaceProps) {
  const [monacoApi, setMonacoApi] = useState<typeof Monaco | null>(null);
  const activeDocumentRef = useRef(activeDocument);
  const runtimeStatusRef = useRef(languageServerRuntimeStatus);
  const flushPendingRef = useRef(flushPendingLanguageServerDocument);
  const errorReporterRef = useRef(onLanguageServerError);

  useEffect(() => {
    activeDocumentRef.current = activeDocument;
  }, [activeDocument]);

  useEffect(() => {
    runtimeStatusRef.current = languageServerRuntimeStatus;
  }, [languageServerRuntimeStatus]);

  useEffect(() => {
    flushPendingRef.current = flushPendingLanguageServerDocument;
  }, [flushPendingLanguageServerDocument]);

  useEffect(() => {
    errorReporterRef.current = onLanguageServerError;
  }, [onLanguageServerError]);

  useEffect(() => {
    if (!monacoApi) {
      return;
    }

    const disposable = registerLanguageServerMonacoProviders(monacoApi, {
      featuresGateway: languageServerFeaturesGateway,
      flushPendingDocumentChange: (path) => flushPendingRef.current(path),
      getActiveDocument: () => activeDocumentRef.current,
      getRuntimeStatus: () => runtimeStatusRef.current,
      reportError: (error) => errorReporterRef.current(error),
    });

    return () => disposable.dispose();
  }, [languageServerFeaturesGateway, monacoApi]);

  const handleMount: OnMount = (_editor, monaco) => {
    setMonacoApi(monaco);
  };

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
        onMount={handleMount}
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
