import Editor from "@monaco-editor/react";
import type { OnMount } from "@monaco-editor/react";
import { useEffect, useRef, useState } from "react";
import type * as Monaco from "monaco-editor";
import type {
  EditorPosition,
  EditorRevealTarget,
  LanguageServerFeaturesGateway,
} from "../domain/languageServerFeatures";
import type { LanguageServerDiagnostic } from "../domain/languageServerDiagnostics";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import type {
  PhpSyntaxDiagnostic,
  PhpSyntaxDiagnosticsGateway,
} from "../domain/phpSyntaxDiagnostics";
import { suspiciousPhpBareIdentifierDiagnostics } from "../domain/phpSyntaxDiagnostics";
import type { EditorDocument } from "../domain/workspace";
import { registerLanguageServerMonacoProviders } from "./languageServerMonacoProviders";
import { getTabId, getTabPanelId } from "./tabIds";

interface EditorSurfaceProps {
  activeDocument: EditorDocument | null;
  editorRevealTarget: EditorRevealTarget | null;
  flushPendingLanguageServerDocument(path: string): Promise<void>;
  languageServerDiagnosticsByPath: Record<string, LanguageServerDiagnostic[]>;
  languageServerFeaturesGateway: LanguageServerFeaturesGateway;
  languageServerRuntimeStatus: LanguageServerRuntimeStatus | null;
  monacoTheme: "vs" | "vs-dark";
  onCloseActiveTab(): void;
  onCursorPositionChange(position: EditorPosition): void;
  onGoBack(): void;
  onGoForward(): void;
  onGoToDefinition(): void;
  onOpenClass(): void;
  onOpenFile(): void;
  onOpenFileStructure(): void;
  onChange(content: string): void;
  onLanguageServerError(error: unknown): void;
  onRevealTargetHandled(): void;
  phpSyntaxDiagnosticsGateway: PhpSyntaxDiagnosticsGateway;
}

export function EditorSurface({
  activeDocument,
  editorRevealTarget,
  flushPendingLanguageServerDocument,
  languageServerDiagnosticsByPath,
  languageServerFeaturesGateway,
  languageServerRuntimeStatus,
  monacoTheme,
  onCloseActiveTab,
  onCursorPositionChange,
  onGoBack,
  onGoForward,
  onGoToDefinition,
  onOpenClass,
  onOpenFile,
  onOpenFileStructure,
  onChange,
  onLanguageServerError,
  onRevealTargetHandled,
  phpSyntaxDiagnosticsGateway,
}: EditorSurfaceProps) {
  const [monacoApi, setMonacoApi] = useState<typeof Monaco | null>(null);
  const [editorApi, setEditorApi] =
    useState<Monaco.editor.IStandaloneCodeEditor | null>(null);
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
    setEditorApi(_editor);
    setMonacoApi(monaco);
  };

  useEffect(() => {
    if (!editorApi) {
      return;
    }

    const disposable = editorApi.onDidChangeCursorPosition((event) => {
      onCursorPositionChange(event.position);
    });
    const position = editorApi.getPosition();

    if (position) {
      onCursorPositionChange(position);
    }

    return () => disposable.dispose();
  }, [editorApi, onCursorPositionChange]);

  useEffect(() => {
    if (!editorApi || !monacoApi) {
      return;
    }

    const keyMod = monacoApi.KeyMod.CtrlCmd;
    const disposables = [
      editorApi.addAction({
        id: "mockor.goToDefinition",
        label: "Go to Definition",
        keybindings: [keyMod | monacoApi.KeyCode.KeyB],
        run: onGoToDefinition,
      }),
      editorApi.addAction({
        id: "mockor.openClass",
        label: "Open Class",
        keybindings: [keyMod | monacoApi.KeyCode.KeyO],
        run: onOpenClass,
      }),
      editorApi.addAction({
        id: "mockor.openFile",
        label: "Open File",
        keybindings: [keyMod | monacoApi.KeyCode.KeyP],
        run: onOpenFile,
      }),
      editorApi.addAction({
        id: "mockor.fileStructure",
        label: "File Structure",
        keybindings: [keyMod | monacoApi.KeyCode.KeyR],
        run: onOpenFileStructure,
      }),
      editorApi.addAction({
        id: "mockor.closeTab",
        label: "Close Tab",
        keybindings: [keyMod | monacoApi.KeyCode.KeyW],
        run: onCloseActiveTab,
      }),
      editorApi.addAction({
        id: "mockor.goBack",
        label: "Go Back",
        keybindings: [keyMod | monacoApi.KeyCode.BracketLeft],
        run: onGoBack,
      }),
      editorApi.addAction({
        id: "mockor.goForward",
        label: "Go Forward",
        keybindings: [keyMod | monacoApi.KeyCode.BracketRight],
        run: onGoForward,
      }),
    ];

    return () => {
      disposables.forEach((disposable) => disposable?.dispose());
    };
  }, [
    editorApi,
    monacoApi,
    onCloseActiveTab,
    onGoBack,
    onGoForward,
    onGoToDefinition,
    onOpenClass,
    onOpenFile,
    onOpenFileStructure,
  ]);

  useEffect(() => {
    if (!editorApi) {
      return;
    }

    const position = editorApi.getPosition();

    if (!position) {
      return;
    }

    onCursorPositionChange(position);
  }, [activeDocument, editorApi, onCursorPositionChange]);

  useEffect(() => {
    if (!editorApi) {
      return;
    }

    if (!activeDocument) {
      return;
    }

    if (!editorRevealTarget) {
      return;
    }

    if (editorRevealTarget.path !== activeDocument.path) {
      return;
    }

    editorApi.setPosition(editorRevealTarget.position);
    editorApi.revealPositionInCenter(editorRevealTarget.position);
    editorApi.focus();
    onRevealTargetHandled();
  }, [activeDocument, editorApi, editorRevealTarget, onRevealTargetHandled]);

  useEffect(() => {
    if (!monacoApi) {
      return;
    }

    monacoApi.editor.getModels().forEach((model) => {
      const path = modelPath(model);
      const diagnostics = path ? languageServerDiagnosticsByPath[path] ?? [] : [];
      monacoApi.editor.setModelMarkers(
        model,
        "php-language-server",
        diagnostics.map((diagnostic) =>
          toMonacoDiagnosticMarker(monacoApi, diagnostic),
        ),
      );
    });
  }, [activeDocument, languageServerDiagnosticsByPath, monacoApi]);

  useEffect(() => {
    if (!monacoApi) {
      return;
    }

    if (!activeDocument) {
      return;
    }

    const model = modelForPath(monacoApi, activeDocument.path);

    if (!model) {
      return;
    }

    if (activeDocument.language !== "php") {
      monacoApi.editor.setModelMarkers(model, "php-syntax", []);
      return;
    }

    let active = true;
    const timeout = window.setTimeout(() => {
      phpSyntaxDiagnosticsGateway
        .validate(activeDocument.content)
        .then((diagnostics) => {
          if (!active) {
            return;
          }

          const localDiagnostics = suspiciousPhpBareIdentifierDiagnostics(
            activeDocument.content,
          );
          monacoApi.editor.setModelMarkers(
            model,
            "php-syntax",
            [...diagnostics, ...localDiagnostics].map((diagnostic) =>
              toMonacoSyntaxDiagnosticMarker(monacoApi, diagnostic),
            ),
          );
        })
        .catch((error) => errorReporterRef.current(error));
    }, 160);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [
    activeDocument,
    monacoApi,
    phpSyntaxDiagnosticsGateway,
  ]);

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
        theme={monacoTheme}
        value={activeDocument.content}
      />
    </div>
  );
}

function toMonacoDiagnosticMarker(
  monaco: typeof Monaco,
  diagnostic: LanguageServerDiagnostic,
): Monaco.editor.IMarkerData {
  return {
    endColumn: diagnostic.character + 2,
    endLineNumber: diagnostic.line + 1,
    message: diagnostic.message,
    severity: diagnosticSeverity(monaco, diagnostic),
    source: diagnostic.source || "Language Server",
    startColumn: diagnostic.character + 1,
    startLineNumber: diagnostic.line + 1,
  };
}

function diagnosticSeverity(
  monaco: typeof Monaco,
  diagnostic: LanguageServerDiagnostic,
): Monaco.MarkerSeverity {
  if (diagnostic.severity === "error") {
    return monaco.MarkerSeverity.Error;
  }

  if (diagnostic.severity === "warning") {
    return monaco.MarkerSeverity.Warning;
  }

  if (diagnostic.severity === "hint") {
    return monaco.MarkerSeverity.Hint;
  }

  return monaco.MarkerSeverity.Info;
}

function toMonacoSyntaxDiagnosticMarker(
  monaco: typeof Monaco,
  diagnostic: PhpSyntaxDiagnostic,
): Monaco.editor.IMarkerData {
  return {
    endColumn: syntaxDiagnosticEndColumn(diagnostic),
    endLineNumber: diagnostic.endLine + 1,
    message: diagnostic.message,
    severity: monaco.MarkerSeverity.Error,
    source: "PHP Syntax",
    startColumn: diagnostic.character + 1,
    startLineNumber: diagnostic.line + 1,
  };
}

function syntaxDiagnosticEndColumn(diagnostic: PhpSyntaxDiagnostic): number {
  if (diagnostic.endLine === diagnostic.line) {
    return Math.max(diagnostic.endCharacter + 1, diagnostic.character + 2);
  }

  return diagnostic.endCharacter + 1;
}

function modelForPath(
  monaco: typeof Monaco,
  path: string,
): Monaco.editor.ITextModel | null {
  return monaco.editor
    .getModels()
    .find((model) => modelPath(model) === path) ?? null;
}

function modelPath(model: Monaco.editor.ITextModel): string | null {
  if (model.uri.fsPath) {
    return model.uri.fsPath;
  }

  if (model.uri.path) {
    return decodeURIComponent(model.uri.path);
  }

  return null;
}
