import Editor from "@monaco-editor/react";
import type { OnMount } from "@monaco-editor/react";
import { RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type * as Monaco from "monaco-editor";
import type {
  EditorChangeHunk,
  EditorChangeKind,
} from "../domain/editorChangeMarkers";
import type {
  EditorPosition,
  EditorRevealTarget,
  LanguageServerFeaturesGateway,
} from "../domain/languageServerFeatures";
import {
  parseShortcut,
  shortcutForCommand,
  type KeymapCommandId,
  type KeymapSettings,
} from "../domain/keymap";
import type { LanguageServerDiagnostic } from "../domain/languageServerDiagnostics";
import { phpImplementationGutterTargets } from "../domain/phpImplementationGutterTargets";
import { filterPhpLanguageServerDiagnostics } from "../domain/phpLanguageServerDiagnosticFilters";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import type {
  PhpSyntaxDiagnostic,
  PhpSyntaxDiagnosticsGateway,
} from "../domain/phpSyntaxDiagnostics";
import { suspiciousPhpBareIdentifierDiagnostics } from "../domain/phpSyntaxDiagnostics";
import type {
  PhpMethodCompletion,
  PhpMethodSignature,
} from "../domain/phpMethodCompletions";
import type { EditorDocument } from "../domain/workspace";
import type { MonacoAppTheme } from "../domain/settings";
import { registerJavaScriptTypeScriptLanguageServerMonacoProviders } from "./javascriptTypescriptLanguageServerMonacoProviders";
import { registerLanguageServerMonacoProviders } from "./languageServerMonacoProviders";
import { registerMonacoAppThemes } from "./monacoThemes";
import { getTabId, getTabPanelId } from "./tabIds";
import { configureTypescriptJavascriptDefaults } from "./typescriptJavascriptDefaults";

interface ChangePreviewState {
  anchorLineNumber: number;
  hunk: EditorChangeHunk;
}

interface EditorSurfaceProps {
  activeDocument: EditorDocument | null;
  changeHunks: EditorChangeHunk[];
  editorRevealTarget: EditorRevealTarget | null;
  flushPendingJavaScriptTypeScriptLanguageServerDocument?(
    path: string,
  ): Promise<void>;
  flushPendingLanguageServerDocument(path: string): Promise<void>;
  javaScriptTypeScriptLanguageServerFeaturesGateway?: LanguageServerFeaturesGateway;
  javaScriptTypeScriptLanguageServerRuntimeStatus?: LanguageServerRuntimeStatus | null;
  languageServerDiagnosticsByPath: Record<string, LanguageServerDiagnostic[]>;
  languageServerFeaturesGateway: LanguageServerFeaturesGateway;
  languageServerRuntimeStatus: LanguageServerRuntimeStatus | null;
  keymap: KeymapSettings;
  monacoTheme: MonacoAppTheme;
  workspaceRoot?: string | null;
  onCloseActiveTab(): void;
  onCursorPositionChange(position: EditorPosition): void;
  onGoBack(): void;
  onGoForward(): void;
  onGoToDefinition(): void;
  onGoToImplementationAt(position: EditorPosition): void;
  onEditorFocused(): void;
  onOpenClass(): void;
  onOpenFile(): void;
  onOpenFileStructure(): void;
  onChange(content: string): void;
  onLanguageServerError(error: unknown): void;
  onRevealTargetHandled(): void;
  onRevertChangeHunk(hunk: EditorChangeHunk): void;
  phpSyntaxDiagnosticsGateway: PhpSyntaxDiagnosticsGateway;
  providePhpMethodCompletions(
    source: string,
    position: EditorPosition,
  ): Promise<PhpMethodCompletion[]>;
  providePhpMethodSignature(
    source: string,
    position: EditorPosition,
  ): Promise<PhpMethodSignature | null>;
}

export function EditorSurface({
  activeDocument,
  changeHunks,
  editorRevealTarget,
  flushPendingJavaScriptTypeScriptLanguageServerDocument = async () => undefined,
  flushPendingLanguageServerDocument,
  languageServerDiagnosticsByPath,
  languageServerFeaturesGateway,
  languageServerRuntimeStatus,
  javaScriptTypeScriptLanguageServerFeaturesGateway = languageServerFeaturesGateway,
  javaScriptTypeScriptLanguageServerRuntimeStatus = null,
  keymap,
  monacoTheme,
  workspaceRoot = null,
  onCloseActiveTab,
  onCursorPositionChange,
  onGoBack,
  onGoForward,
  onGoToDefinition,
  onGoToImplementationAt,
  onEditorFocused,
  onOpenClass,
  onOpenFile,
  onOpenFileStructure,
  onChange,
  onLanguageServerError,
  onRevealTargetHandled,
  onRevertChangeHunk,
  phpSyntaxDiagnosticsGateway,
  providePhpMethodCompletions,
  providePhpMethodSignature,
}: EditorSurfaceProps) {
  const [monacoApi, setMonacoApi] = useState<typeof Monaco | null>(null);
  const [editorApi, setEditorApi] =
    useState<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const activeDocumentRef = useRef(activeDocument);
  const runtimeStatusRef = useRef(languageServerRuntimeStatus);
  const javaScriptTypeScriptRuntimeStatusRef = useRef(
    javaScriptTypeScriptLanguageServerRuntimeStatus,
  );
  const flushPendingRef = useRef(flushPendingLanguageServerDocument);
  const flushPendingJavaScriptTypeScriptRef = useRef(
    flushPendingJavaScriptTypeScriptLanguageServerDocument,
  );
  const errorReporterRef = useRef(onLanguageServerError);
  const changeDecorationIdsRef = useRef<string[]>([]);
  const changeHunksRef = useRef(changeHunks);
  const implementationGutterDecorationIdsRef = useRef<string[]>([]);
  const implementationGutterTargetsRef = useRef(new Map<number, EditorPosition>());
  const diagnosticOverviewDecorationIdsRef = useRef<string[]>([]);
  const phpMethodCompletionsRef = useRef(providePhpMethodCompletions);
  const phpMethodSignatureRef = useRef(providePhpMethodSignature);
  const [syntaxDiagnosticsByPath, setSyntaxDiagnosticsByPath] = useState<
    Record<string, PhpSyntaxDiagnostic[]>
  >({});
  const [changePreview, setChangePreview] = useState<ChangePreviewState | null>(
    null,
  );

  useEffect(() => {
    activeDocumentRef.current = activeDocument;
  }, [activeDocument]);

  useEffect(() => {
    changeHunksRef.current = changeHunks;
    setChangePreview((current) => {
      if (!current) {
        return null;
      }

      const hunk = changeHunks.find(
        (candidate) => candidate.id === current.hunk.id,
      );

      return hunk
        ? {
            anchorLineNumber: clampNumber(
              current.anchorLineNumber,
              hunk.startLineNumber,
              hunk.endLineNumber,
            ),
            hunk,
          }
        : null;
    });
  }, [changeHunks]);

  useEffect(() => {
    runtimeStatusRef.current = languageServerRuntimeStatus;
  }, [languageServerRuntimeStatus]);

  useEffect(() => {
    javaScriptTypeScriptRuntimeStatusRef.current =
      javaScriptTypeScriptLanguageServerRuntimeStatus;
  }, [javaScriptTypeScriptLanguageServerRuntimeStatus]);

  useEffect(() => {
    flushPendingRef.current = flushPendingLanguageServerDocument;
  }, [flushPendingLanguageServerDocument]);

  useEffect(() => {
    flushPendingJavaScriptTypeScriptRef.current =
      flushPendingJavaScriptTypeScriptLanguageServerDocument;
  }, [flushPendingJavaScriptTypeScriptLanguageServerDocument]);

  useEffect(() => {
    errorReporterRef.current = onLanguageServerError;
  }, [onLanguageServerError]);

  useEffect(() => {
    phpMethodCompletionsRef.current = providePhpMethodCompletions;
  }, [providePhpMethodCompletions]);

  useEffect(() => {
    phpMethodSignatureRef.current = providePhpMethodSignature;
  }, [providePhpMethodSignature]);

  useEffect(() => {
    if (!monacoApi) {
      return;
    }

    const disposable = registerLanguageServerMonacoProviders(monacoApi, {
      featuresGateway: languageServerFeaturesGateway,
      flushPendingDocumentChange: (path) => flushPendingRef.current(path),
      getActiveDocument: () => activeDocumentRef.current,
      getRuntimeStatus: () => runtimeStatusRef.current,
      getWorkspaceRoot: () => workspaceRoot,
      providePhpMethodCompletions: (source, position) =>
        phpMethodCompletionsRef.current(source, position),
      providePhpMethodSignature: (source, position) =>
        phpMethodSignatureRef.current(source, position),
      reportError: (error) => errorReporterRef.current(error),
    });

    return () => disposable.dispose();
  }, [languageServerFeaturesGateway, monacoApi, workspaceRoot]);

  useEffect(() => {
    if (!monacoApi) {
      return;
    }

    const disposable = registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monacoApi,
      {
        featuresGateway: javaScriptTypeScriptLanguageServerFeaturesGateway,
        flushPendingDocumentChange: (path) =>
          flushPendingJavaScriptTypeScriptRef.current(path),
        getActiveDocument: () => activeDocumentRef.current,
        getRuntimeStatus: () => javaScriptTypeScriptRuntimeStatusRef.current,
        getWorkspaceRoot: () => workspaceRoot,
        reportError: (error) => errorReporterRef.current(error),
      },
    );

    return () => disposable.dispose();
  }, [javaScriptTypeScriptLanguageServerFeaturesGateway, monacoApi, workspaceRoot]);

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

    const keybinding = (commandId: KeymapCommandId) =>
      monacoKeybindingsForShortcut(
        monacoApi,
        shortcutForCommand(keymap, commandId),
      );
    const disposables = [
      editorApi.addAction({
        id: "mockor.goToDefinition",
        label: "Go to Definition",
        keybindings: keybinding("editor.goToDefinition"),
        run: () => {
          if (isTypescriptJavascriptDocument(activeDocumentRef.current)) {
            editorApi.trigger("keyboard", "editor.action.revealDefinition", {});
            return;
          }

          onGoToDefinition();
        },
      }),
      editorApi.addAction({
        id: "mockor.goToImplementation",
        label: "Go to Implementation",
        keybindings: keybinding("editor.goToImplementation"),
        run: () => {
          if (isTypescriptJavascriptDocument(activeDocumentRef.current)) {
            editorApi.trigger("keyboard", "editor.action.goToImplementation", {});
            return;
          }

          const position = editorApi.getPosition();

          if (!position) {
            return;
          }

          onGoToImplementationAt(position);
        },
      }),
      editorApi.addAction({
        id: "mockor.openClass",
        label: "Open Class",
        keybindings: keybinding("class.quickOpen"),
        run: onOpenClass,
      }),
      editorApi.addAction({
        id: "mockor.openFile",
        label: "Open File",
        keybindings: keybinding("file.quickOpen"),
        run: onOpenFile,
      }),
      editorApi.addAction({
        id: "mockor.fileStructure",
        label: "File Structure",
        keybindings: keybinding("editor.fileStructure"),
        run: onOpenFileStructure,
      }),
      editorApi.addAction({
        id: "mockor.quickFix",
        label: "Show Context Actions",
        keybindings: keybinding("editor.quickFix"),
        run: () => {
          const model = editorApi.getModel();
          const position = editorApi.getPosition();

          if (!model || !position) {
            return;
          }

          const markers = monacoApi.editor.getModelMarkers({
            resource: model.uri,
          });

          if (!markers.some((marker) => isFixableQuickFixMarkerAt(marker, position))) {
            return;
          }

          editorApi.trigger("keyboard", "editor.action.quickFix", {});
        },
      }),
      editorApi.addAction({
        id: "mockor.extendSelection",
        label: "Extend Selection",
        keybindings: keybinding("editor.extendSelection"),
        run: () => {
          if (expandEditorSelection(monacoApi, editorApi)) {
            return;
          }

          editorApi.trigger("keyboard", "editor.action.smartSelect.expand", {});
        },
      }),
      editorApi.addAction({
        id: "mockor.closeTab",
        label: "Close Tab",
        keybindings: keybinding("editor.closeTab"),
        run: onCloseActiveTab,
      }),
      editorApi.addAction({
        id: "mockor.goBack",
        label: "Go Back",
        keybindings: keybinding("navigation.back"),
        run: onGoBack,
      }),
      editorApi.addAction({
        id: "mockor.goForward",
        label: "Go Forward",
        keybindings: keybinding("navigation.forward"),
        run: onGoForward,
      }),
    ];

    return () => {
      disposables.forEach((disposable) => disposable?.dispose());
    };
  }, [
    editorApi,
    keymap,
    monacoApi,
    onCloseActiveTab,
    onGoBack,
    onGoForward,
    onGoToDefinition,
    onGoToImplementationAt,
    onOpenClass,
    onOpenFile,
    onOpenFileStructure,
  ]);

  useEffect(() => {
    if (!editorApi || !monacoApi) {
      return;
    }

    const disposable = editorApi.onMouseDown((event) => {
      if (
        event.target.type !== monacoApi.editor.MouseTargetType.GUTTER_GLYPH_MARGIN
      ) {
        return;
      }

      const lineNumber = event.target.position?.lineNumber;

      if (!lineNumber) {
        return;
      }

      const lane = glyphMarginLaneFromMouseEvent(event);
      const changeHunk = findChangeHunkAtLine(
        changeHunksRef.current,
        lineNumber,
      );
      const target = implementationGutterTargetsRef.current.get(lineNumber);

      if (target && lane !== monacoApi.editor.GlyphMarginLane.Left) {
        event.event.preventDefault();
        event.event.stopPropagation();
        onGoToImplementationAt(target);
        return;
      }

      if (changeHunk) {
        event.event.preventDefault();
        event.event.stopPropagation();
        setChangePreview({
          anchorLineNumber: lineNumber,
          hunk: changeHunk,
        });
      }
    });

    return () => disposable.dispose();
  }, [editorApi, monacoApi, onGoToImplementationAt]);

  useEffect(() => {
    if (!activeDocument || !editorApi || !monacoApi) {
      return;
    }

    const model = editorApi.getModel();

    if (!model || modelPath(model) !== activeDocument.path) {
      return;
    }

    changeDecorationIdsRef.current = editorApi.deltaDecorations(
      changeDecorationIdsRef.current,
      changeHunks.map((hunk) => toEditorChangeDecoration(monacoApi, hunk)),
    );

    return () => {
      changeDecorationIdsRef.current = editorApi.deltaDecorations(
        changeDecorationIdsRef.current,
        [],
      );
    };
  }, [activeDocument, changeHunks, editorApi, monacoApi]);

  useEffect(() => {
    if (!changePreview) {
      return;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      setChangePreview(null);
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [changePreview]);

  useEffect(() => {
    if (!activeDocument || !editorApi || !monacoApi) {
      return;
    }

    const model = editorApi.getModel();

    if (!model || modelPath(model) !== activeDocument.path) {
      return;
    }

    if (activeDocument.language !== "php") {
      implementationGutterTargetsRef.current = new Map();
      implementationGutterDecorationIdsRef.current = editorApi.deltaDecorations(
        implementationGutterDecorationIdsRef.current,
        [],
      );
      return;
    }

    const targets = phpImplementationGutterTargets(activeDocument.content);
    implementationGutterTargetsRef.current = new Map(
      targets.map((target) => [target.position.lineNumber, target.position]),
    );
    implementationGutterDecorationIdsRef.current = editorApi.deltaDecorations(
      implementationGutterDecorationIdsRef.current,
      targets.map((target) => ({
        options: {
          glyphMargin: {
            position: monacoApi.editor.GlyphMarginLane.Center,
          },
          glyphMarginClassName: "implementation-gutter-glyph",
          glyphMarginHoverMessage: {
            value: "Go to implementation",
          },
          isWholeLine: false,
          stickiness:
            monacoApi.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          zIndex: 20,
        },
        range: new monacoApi.Range(
          target.position.lineNumber,
          1,
          target.position.lineNumber,
          1,
        ),
      })),
    );

    return () => {
      implementationGutterTargetsRef.current = new Map();
      implementationGutterDecorationIdsRef.current = editorApi.deltaDecorations(
        implementationGutterDecorationIdsRef.current,
        [],
      );
    };
  }, [activeDocument, editorApi, monacoApi]);

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
      const filteredDiagnostics =
        path &&
        activeDocument?.path === path &&
        activeDocument.language === "php"
          ? filterPhpLanguageServerDiagnostics(
              activeDocument.content,
              diagnostics,
              { path },
            )
          : diagnostics;
      monacoApi.editor.setModelMarkers(
        model,
        "php-language-server",
        filteredDiagnostics.map((diagnostic) =>
          toMonacoDiagnosticMarker(monacoApi, diagnostic),
        ),
      );
    });
  }, [activeDocument, languageServerDiagnosticsByPath, monacoApi]);

  useEffect(() => {
    if (!activeDocument || !editorApi || !monacoApi) {
      return;
    }

    const model = editorApi.getModel();

    if (!model || modelPath(model) !== activeDocument.path) {
      return;
    }

    const languageServerDiagnostics =
      activeDocument.language === "php"
        ? filterPhpLanguageServerDiagnostics(
            activeDocument.content,
            languageServerDiagnosticsByPath[activeDocument.path] ?? [],
            { path: activeDocument.path },
          )
        : languageServerDiagnosticsByPath[activeDocument.path] ?? [];
    const syntaxDiagnostics =
      activeDocument.language === "php"
        ? syntaxDiagnosticsByPath[activeDocument.path] ?? []
        : [];
    diagnosticOverviewDecorationIdsRef.current = editorApi.deltaDecorations(
      diagnosticOverviewDecorationIdsRef.current,
      [
        ...languageServerDiagnostics.map((diagnostic) =>
          toDiagnosticOverviewDecoration(monacoApi, diagnostic),
        ),
        ...syntaxDiagnostics.map((diagnostic) =>
          toSyntaxOverviewDecoration(monacoApi, diagnostic),
        ),
      ],
    );

    return () => {
      diagnosticOverviewDecorationIdsRef.current = editorApi.deltaDecorations(
        diagnosticOverviewDecorationIdsRef.current,
        [],
      );
    };
  }, [
    activeDocument,
    editorApi,
    languageServerDiagnosticsByPath,
    monacoApi,
    syntaxDiagnosticsByPath,
  ]);

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
      setSyntaxDiagnosticsByPath((current) => {
        if (!current[activeDocument.path]) {
          return current;
        }

        const next = { ...current };
        delete next[activeDocument.path];
        return next;
      });
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
          const allDiagnostics = [...diagnostics, ...localDiagnostics];
          setSyntaxDiagnosticsByPath((current) => ({
            ...current,
            [activeDocument.path]: allDiagnostics,
          }));
          monacoApi.editor.setModelMarkers(
            model,
            "php-syntax",
            allDiagnostics.map((diagnostic) =>
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

  const changePreviewStyle =
    changePreview && editorApi
      ? editorChangePopoverStyle(
          editorApi,
          changePreview.hunk,
          changePreview.anchorLineNumber,
        )
      : undefined;

  return (
    <div
      aria-labelledby={getTabId(activeDocument.path)}
      className="editor-panel"
      id={getTabPanelId(activeDocument.path)}
      onFocusCapture={onEditorFocused}
      onMouseDown={onEditorFocused}
      role="tabpanel"
    >
      <Editor
        beforeMount={beforeMonacoMount}
        height="100%"
        language={activeDocument.language}
        onChange={(value) => onChange(value || "")}
        onMount={handleMount}
        options={{
          automaticLayout: true,
          fontFamily:
            "JetBrains Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: 13,
          glyphMargin: true,
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
      {changePreview ? (
        <div
          aria-label="Local change preview"
          className={`editor-change-popover editor-change-popover-${changePreview.hunk.kind}`}
          role="dialog"
          style={changePreviewStyle}
        >
          <div className="editor-change-popover-header">
            <span
              className={`editor-change-popover-kind ${changePreview.hunk.kind}`}
            >
              {editorChangeKindLabel(changePreview.hunk.kind)}
            </span>
            <button
              aria-label="Close local change preview"
              className="editor-change-popover-icon-button"
              onClick={() => setChangePreview(null)}
              type="button"
            >
              <X aria-hidden="true" size={14} />
            </button>
          </div>
          <div className="editor-change-popover-section-label">
            Previous content
          </div>
          <pre className="editor-change-popover-code">
            {changePreviewText(changePreview.hunk)}
          </pre>
          <div className="editor-change-popover-actions">
            <button
              className="editor-change-popover-action"
              onClick={() => {
                onRevertChangeHunk(changePreview.hunk);
                setChangePreview(null);
              }}
              type="button"
            >
              <RotateCcw aria-hidden="true" size={13} />
              Revert change
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface EditorTextRange {
  end: number;
  start: number;
}

function expandEditorSelection(
  monaco: typeof Monaco,
  editor: Monaco.editor.IStandaloneCodeEditor,
): boolean {
  const model = editor.getModel();
  const position = editor.getPosition();

  if (!model || !position) {
    return false;
  }

  const line = model.getLineContent(position.lineNumber);
  const selection = editor.getSelection();
  const currentRange = currentEditorTextRange(position, selection);
  const candidates = selectionExpansionRanges(line, position.column - 1);
  const nextRange = candidates.find(
    (candidate) =>
      containsEditorTextRange(candidate, currentRange) &&
      editorTextRangeLength(candidate) > editorTextRangeLength(currentRange),
  );

  if (!nextRange) {
    return false;
  }

  editor.setSelection(
    new monaco.Range(
      position.lineNumber,
      nextRange.start + 1,
      position.lineNumber,
      nextRange.end + 1,
    ),
  );
  return true;
}

function currentEditorTextRange(
  position: Monaco.Position,
  selection: Monaco.Selection | null,
): EditorTextRange {
  if (!selection || selection.startLineNumber !== selection.endLineNumber) {
    const offset = Math.max(0, position.column - 1);
    return { end: offset, start: offset };
  }

  return {
    end: Math.max(selection.startColumn, selection.endColumn) - 1,
    start: Math.min(selection.startColumn, selection.endColumn) - 1,
  };
}

function selectionExpansionRanges(line: string, offset: number): EditorTextRange[] {
  const identifier = identifierRangeAtOffset(line, offset);

  if (!identifier) {
    return [];
  }

  const callOrIdentifier = callRangeFromIdentifier(line, identifier) ?? identifier;
  const expression = expressionRangeAround(line, callOrIdentifier);
  const statement = statementRangeAround(line, expression);

  return uniqueEditorTextRanges([identifier, expression, statement])
    .filter((range) => range.end > range.start)
    .sort((left, right) => editorTextRangeLength(left) - editorTextRangeLength(right));
}

function identifierRangeAtOffset(
  line: string,
  offset: number,
): EditorTextRange | null {
  if (!line) {
    return null;
  }

  let index = Math.max(0, Math.min(offset, line.length - 1));

  if (!isIdentifierCharacter(line[index]) && index > 0 && isIdentifierCharacter(line[index - 1])) {
    index -= 1;
  }

  if (!isIdentifierCharacter(line[index])) {
    return null;
  }

  let start = index;
  let end = index + 1;

  while (start > 0 && isIdentifierCharacter(line[start - 1])) {
    start -= 1;
  }

  while (end < line.length && isIdentifierCharacter(line[end])) {
    end += 1;
  }

  if (start > 0 && line[start - 1] === "$") {
    start -= 1;
  }

  return { end, start };
}

function callRangeFromIdentifier(
  line: string,
  identifier: EditorTextRange,
): EditorTextRange | null {
  const openParen = skipWhitespaceRight(line, identifier.end);

  if (line[openParen] !== "(") {
    return null;
  }

  const closeParen = findMatchingForward(line, openParen, "(", ")");

  if (closeParen === null) {
    return null;
  }

  return { end: closeParen + 1, start: identifier.start };
}

function expressionRangeAround(
  line: string,
  range: EditorTextRange,
): EditorTextRange {
  let expression = { ...range };

  while (true) {
    const operator = memberOperatorBefore(line, expression.start);

    if (!operator) {
      break;
    }

    const operand = operandRangeBefore(line, operator.start);

    if (!operand) {
      break;
    }

    expression = { end: expression.end, start: operand.start };
  }

  while (true) {
    const operator = memberOperatorAfter(line, expression.end);

    if (!operator) {
      break;
    }

    const operand = operandRangeAfter(line, operator.end);

    if (!operand) {
      break;
    }

    expression = { end: operand.end, start: expression.start };
  }

  return expression;
}

function statementRangeAround(
  line: string,
  range: EditorTextRange,
): EditorTextRange {
  const statementStart = skipWhitespaceRight(
    line,
    Math.max(
      line.lastIndexOf(";", range.start - 1),
      line.lastIndexOf("{", range.start - 1),
      line.lastIndexOf("}", range.start - 1),
    ) + 1,
  );
  const semicolon = line.indexOf(";", range.end);
  const statementEnd = semicolon === -1 ? range.end : semicolon + 1;

  return statementEnd > statementStart
    ? { end: statementEnd, start: statementStart }
    : range;
}

function memberOperatorBefore(
  line: string,
  start: number,
): EditorTextRange | null {
  const index = skipWhitespaceLeft(line, start);
  const candidates: Array<[string, number]> = [
    ["?->", 3],
    ["->", 2],
    ["::", 2],
    ["?.", 2],
    [".", 1],
  ];

  for (const [operator, length] of candidates) {
    if (line.slice(index - length, index) === operator) {
      return { end: index, start: index - length };
    }
  }

  return null;
}

function memberOperatorAfter(line: string, end: number): EditorTextRange | null {
  const index = skipWhitespaceRight(line, end);
  const candidates = ["?->", "->", "::", "?.", "."];
  const operator = candidates.find((candidate) =>
    line.startsWith(candidate, index),
  );

  return operator ? { end: index + operator.length, start: index } : null;
}

function operandRangeBefore(line: string, end: number): EditorTextRange | null {
  const operandEnd = skipWhitespaceLeft(line, end);

  if (operandEnd <= 0) {
    return null;
  }

  const lastCharacter = line[operandEnd - 1];

  if (lastCharacter === ")" || lastCharacter === "]") {
    const openIndex = findMatchingBackward(
      line,
      operandEnd - 1,
      lastCharacter === ")" ? "(" : "[",
      lastCharacter,
    );

    if (openIndex === null) {
      return null;
    }

    const callee = identifierRangeEndingAt(line, openIndex);
    const start = callee?.start ?? openIndex;
    return expressionRangeAround(line, { end: operandEnd, start });
  }

  return identifierRangeEndingAt(line, operandEnd);
}

function operandRangeAfter(line: string, start: number): EditorTextRange | null {
  const operandStart = skipWhitespaceRight(line, start);
  const identifier = identifierRangeStartingAt(line, operandStart);

  if (!identifier) {
    return null;
  }

  return callRangeFromIdentifier(line, identifier) ?? identifier;
}

function identifierRangeEndingAt(
  line: string,
  end: number,
): EditorTextRange | null {
  let cursor = end;

  while (cursor > 0 && isIdentifierCharacter(line[cursor - 1])) {
    cursor -= 1;
  }

  if (cursor === end) {
    return null;
  }

  if (cursor > 0 && line[cursor - 1] === "$") {
    cursor -= 1;
  }

  return { end, start: cursor };
}

function identifierRangeStartingAt(
  line: string,
  start: number,
): EditorTextRange | null {
  let cursor = start;

  if (line[cursor] === "$") {
    cursor += 1;
  }

  if (!isIdentifierCharacter(line[cursor])) {
    return null;
  }

  while (cursor < line.length && isIdentifierCharacter(line[cursor])) {
    cursor += 1;
  }

  return { end: cursor, start };
}

function findMatchingForward(
  line: string,
  openIndex: number,
  openCharacter: string,
  closeCharacter: string,
): number | null {
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;

  for (let index = openIndex; index < line.length; index += 1) {
    const character = line[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }

    if (character === openCharacter) {
      depth += 1;
    } else if (character === closeCharacter) {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  return null;
}

function findMatchingBackward(
  line: string,
  closeIndex: number,
  openCharacter: string,
  closeCharacter: string,
): number | null {
  let depth = 0;

  for (let index = closeIndex; index >= 0; index -= 1) {
    const character = line[index];

    if (character === closeCharacter) {
      depth += 1;
    } else if (character === openCharacter) {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  return null;
}

function skipWhitespaceLeft(line: string, index: number): number {
  let cursor = Math.max(0, Math.min(index, line.length));

  while (cursor > 0 && /\s/.test(line[cursor - 1])) {
    cursor -= 1;
  }

  return cursor;
}

function skipWhitespaceRight(line: string, index: number): number {
  let cursor = Math.max(0, Math.min(index, line.length));

  while (cursor < line.length && /\s/.test(line[cursor])) {
    cursor += 1;
  }

  return cursor;
}

function containsEditorTextRange(
  range: EditorTextRange,
  current: EditorTextRange,
): boolean {
  return range.start <= current.start && range.end >= current.end;
}

function editorTextRangeLength(range: EditorTextRange): number {
  return range.end - range.start;
}

function uniqueEditorTextRanges(ranges: EditorTextRange[]): EditorTextRange[] {
  const seen = new Set<string>();
  const unique: EditorTextRange[] = [];

  for (const range of ranges) {
    const key = `${range.start}:${range.end}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(range);
  }

  return unique;
}

function isIdentifierCharacter(character: string | undefined): boolean {
  return Boolean(character && /[A-Za-z0-9_$]/.test(character));
}

function beforeMonacoMount(monaco: typeof Monaco): void {
  registerMonacoAppThemes(monaco);
  configureTypescriptJavascriptDefaults(monaco);
}

function isTypescriptJavascriptDocument(
  document: EditorDocument | null,
): boolean {
  return (
    document?.language === "typescript" ||
    document?.language === "javascript"
  );
}

function editorChangePopoverStyle(
  editor: Monaco.editor.IStandaloneCodeEditor,
  hunk: EditorChangeHunk,
  anchorLineNumber: number,
): CSSProperties {
  const layout = editor.getLayoutInfo();
  const clampedAnchorLine = clampNumber(
    anchorLineNumber,
    hunk.startLineNumber,
    hunk.endLineNumber,
  );
  const lineTop =
    editor.getTopForLineNumber(clampedAnchorLine) - editor.getScrollTop();
  const nextLineTop =
    editor.getTopForLineNumber(clampedAnchorLine + 1) - editor.getScrollTop();
  const lineHeight = Math.max(20, nextLineTop - lineTop);
  const estimatedHeight = 170;
  const minimumEdgeGap = 12;
  const left = Math.max(
    54,
    Math.min(layout.contentLeft + 12, layout.width - 320),
  );
  const belowTop = lineTop + lineHeight + 6;
  const aboveTop = lineTop - estimatedHeight - 6;
  const maxTop = Math.max(
    minimumEdgeGap,
    layout.height - estimatedHeight - minimumEdgeGap,
  );
  const preferredTop =
    belowTop <= maxTop ? belowTop : Math.max(minimumEdgeGap, aboveTop);
  const top = clampNumber(preferredTop, minimumEdgeGap, maxTop);

  return {
    left: `${Math.round(left)}px`,
    maxHeight: `min(360px, calc(100% - ${Math.round(top + minimumEdgeGap)}px))`,
    top: `${Math.round(top)}px`,
    width: `min(620px, calc(100% - ${Math.round(left + minimumEdgeGap)}px))`,
  };
}

function clampNumber(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function toEditorChangeDecoration(
  monaco: typeof Monaco,
  hunk: EditorChangeHunk,
): Monaco.editor.IModelDeltaDecoration {
  return {
    options: {
      glyphMargin: {
        position: monaco.editor.GlyphMarginLane.Left,
      },
      glyphMarginClassName: `editor-change-glyph editor-change-glyph-${hunk.kind}`,
      glyphMarginHoverMessage: {
        value: `${editorChangeKindLabel(hunk.kind)}. Click to preview or revert.`,
      },
      isWholeLine: true,
      linesDecorationsClassName: `editor-change-line editor-change-line-${hunk.kind}`,
      overviewRuler: {
        color: editorChangeColor(hunk.kind),
        position: monaco.editor.OverviewRulerLane.Left,
      },
      stickiness:
        monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      zIndex: 15,
    },
    range: new monaco.Range(
      hunk.startLineNumber,
      1,
      hunk.endLineNumber,
      1,
    ),
  };
}

function findChangeHunkAtLine(
  hunks: EditorChangeHunk[],
  lineNumber: number,
): EditorChangeHunk | null {
  return (
    hunks.find(
      (hunk) =>
        lineNumber >= hunk.startLineNumber &&
        lineNumber <= hunk.endLineNumber,
    ) ?? null
  );
}

function glyphMarginLaneFromMouseEvent(
  event: Monaco.editor.IEditorMouseEvent,
): Monaco.editor.GlyphMarginLane | null {
  const target = event.target as {
    detail?: { glyphMarginLane?: Monaco.editor.GlyphMarginLane };
  };

  return target.detail?.glyphMarginLane ?? null;
}

function editorChangeKindLabel(kind: EditorChangeKind): string {
  if (kind === "added") {
    return "Added lines";
  }

  if (kind === "deleted") {
    return "Deleted lines";
  }

  return "Modified lines";
}

function editorChangeColor(kind: EditorChangeKind): string {
  if (kind === "added") {
    return "#7ddc9f";
  }

  if (kind === "deleted") {
    return "#ef7373";
  }

  return "#e7c66c";
}

function changePreviewText(hunk: EditorChangeHunk): string {
  if (!hunk.originalLines.length) {
    return "No previous lines.";
  }

  return hunk.originalLines.join("\n");
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

function toDiagnosticOverviewDecoration(
  monaco: typeof Monaco,
  diagnostic: LanguageServerDiagnostic,
): Monaco.editor.IModelDeltaDecoration {
  return {
    options: {
      hoverMessage: {
        value: diagnosticHoverText(
          diagnostic.source || "Language Server",
          diagnostic.message,
        ),
      },
      overviewRuler: {
        color: diagnosticOverviewColor(diagnostic.severity),
        position: monaco.editor.OverviewRulerLane.Right,
      },
      stickiness:
        monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
    },
    range: new monaco.Range(
      diagnostic.line + 1,
      diagnostic.character + 1,
      diagnostic.line + 1,
      diagnostic.character + 2,
    ),
  };
}

function toSyntaxOverviewDecoration(
  monaco: typeof Monaco,
  diagnostic: PhpSyntaxDiagnostic,
): Monaco.editor.IModelDeltaDecoration {
  return {
    options: {
      hoverMessage: {
        value: diagnosticHoverText("PHP Syntax", diagnostic.message),
      },
      overviewRuler: {
        color: "#d98b8b",
        position: monaco.editor.OverviewRulerLane.Right,
      },
      stickiness:
        monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
    },
    range: new monaco.Range(
      diagnostic.line + 1,
      diagnostic.character + 1,
      diagnostic.endLine + 1,
      syntaxDiagnosticEndColumn(diagnostic),
    ),
  };
}

function diagnosticHoverText(source: string, message: string): string {
  return `**${escapeMarkdown(source)}**: ${escapeMarkdown(message)}`;
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+\-.!|]/g, "\\$&");
}

function diagnosticOverviewColor(
  severity: LanguageServerDiagnostic["severity"],
): string {
  if (severity === "warning") {
    return "#d8b878";
  }

  if (severity === "hint" || severity === "information") {
    return "#8fbcae";
  }

  return "#d98b8b";
}

function isFixableQuickFixMarkerAt(
  marker: Monaco.editor.IMarkerData,
  position: EditorPosition,
): boolean {
  if (
    marker.source !== "PHP Syntax" ||
    !/^Unexpected bare PHP identifier "[^"]+"\.$/.test(marker.message)
  ) {
    return false;
  }

  return (
    position.lineNumber >= marker.startLineNumber &&
    position.lineNumber <= marker.endLineNumber
  );
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

function monacoKeybindingsForShortcut(
  monaco: typeof Monaco,
  shortcut: string,
): number[] {
  const parsed = parseShortcut(shortcut);

  if (!parsed) {
    return [];
  }

  const keyCode = monacoKeyCode(monaco, parsed.key);

  if (!keyCode) {
    return [];
  }

  let keybinding = keyCode;

  if (parsed.meta) {
    keybinding |= monaco.KeyMod.CtrlCmd;
  }

  if (parsed.ctrl) {
    keybinding |= monaco.KeyMod.WinCtrl ?? monaco.KeyMod.CtrlCmd;
  }

  if (parsed.alt) {
    keybinding |= monaco.KeyMod.Alt;
  }

  if (parsed.shift) {
    keybinding |= monaco.KeyMod.Shift;
  }

  return [keybinding];
}

function monacoKeyCode(monaco: typeof Monaco, key: string): number | null {
  if (/^[a-z]$/.test(key)) {
    return monaco.KeyCode[`Key${key.toUpperCase()}` as keyof typeof monaco.KeyCode] ?? null;
  }

  const specialKeyCodes: Record<string, keyof typeof monaco.KeyCode> = {
    ",": "Comma",
    "`": "Backquote",
    "[": "BracketLeft",
    "]": "BracketRight",
    arrowdown: "DownArrow",
    arrowleft: "LeftArrow",
    arrowright: "RightArrow",
    arrowup: "UpArrow",
    enter: "Enter",
    escape: "Escape",
  };
  const keyCodeName = specialKeyCodes[key];

  return keyCodeName ? monaco.KeyCode[keyCodeName] ?? null : null;
}
