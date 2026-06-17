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
import { registerLanguageServerMonacoProviders } from "./languageServerMonacoProviders";
import { registerMonacoAppThemes } from "./monacoThemes";
import { getTabId, getTabPanelId } from "./tabIds";

interface ChangePreviewState {
  anchorLineNumber: number;
  hunk: EditorChangeHunk;
}

interface EditorSurfaceProps {
  activeDocument: EditorDocument | null;
  changeHunks: EditorChangeHunk[];
  editorRevealTarget: EditorRevealTarget | null;
  flushPendingLanguageServerDocument(path: string): Promise<void>;
  languageServerDiagnosticsByPath: Record<string, LanguageServerDiagnostic[]>;
  languageServerFeaturesGateway: LanguageServerFeaturesGateway;
  languageServerRuntimeStatus: LanguageServerRuntimeStatus | null;
  keymap: KeymapSettings;
  monacoTheme: MonacoAppTheme;
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
  flushPendingLanguageServerDocument,
  languageServerDiagnosticsByPath,
  languageServerFeaturesGateway,
  languageServerRuntimeStatus,
  keymap,
  monacoTheme,
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
  const flushPendingRef = useRef(flushPendingLanguageServerDocument);
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
    flushPendingRef.current = flushPendingLanguageServerDocument;
  }, [flushPendingLanguageServerDocument]);

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
      providePhpMethodCompletions: (source, position) =>
        phpMethodCompletionsRef.current(source, position),
      providePhpMethodSignature: (source, position) =>
        phpMethodSignatureRef.current(source, position),
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
        run: onGoToDefinition,
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
        beforeMount={registerMonacoAppThemes}
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
          className="editor-change-popover"
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
