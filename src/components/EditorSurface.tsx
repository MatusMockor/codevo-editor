import Editor from "@monaco-editor/react";
import type { OnMount } from "@monaco-editor/react";
import { RotateCcw, X } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type * as Monaco from "monaco-editor";
import type {
  EditorChangeHunk,
  EditorChangeKind,
} from "../domain/editorChangeMarkers";
import {
  nextEditorSelectionExpansionRange,
  type EditorSelectionTextRange,
} from "../domain/editorSelectionRanges";
import type {
  EditorMenuCommand,
  EditorMenuCommandRunner,
} from "../domain/editorMenuCommand";
import type {
  EditorPosition,
  EditorRevealTarget,
  LanguageServerFeaturesGateway,
  LanguageServerRefreshGateway,
  LanguageServerWorkspaceEdit,
  LanguageServerWorkspaceEditGateway,
} from "../domain/languageServerFeatures";
import {
  breadcrumbPathFromCursorAndSymbols,
} from "../domain/breadcrumbs";
import {
  BackgroundTokenizer,
  idleCallbackScheduler,
  type BackgroundTokenizableModel,
} from "../domain/backgroundTokenizer";
import {
  detectKeymapPlatform,
  parseShortcut,
  shortcutForCommand,
  type KeymapCommandId,
  type KeymapPlatform,
  type KeymapSettings,
} from "../domain/keymap";
import type { LanguageServerDocumentSymbol } from "../domain/languageServerFeatures";
import {
  isJavaScriptTypeScriptLanguageServerDocument,
  isLanguageServerDocument,
} from "../domain/languageServerDocumentSync";
import { Breadcrumbs } from "./Breadcrumbs";
import { SurroundWithPicker } from "./SurroundWithPicker";
import {
  surroundWithSnippet,
  type SurroundWithTemplateId,
} from "../domain/surroundWith";
import { completePhpStatement } from "../domain/phpCompleteStatement";
import {
  phpMoveStatement,
  type MoveStatementDirection,
} from "../domain/phpMoveStatement";
import type { LanguageServerDiagnostic } from "../domain/languageServerDiagnostics";
import { gitBlameAnnotation, type GitBlameLine } from "../domain/git";
import { PhpImplementationGutterTargetsCache } from "../domain/phpImplementationGutterTargetsCache";
import { PhpTestGutterTargetsCache } from "../domain/phpTestGutterTargetsCache";
import type { PhpTestGutterTarget } from "../domain/phpTestGutterTargets";
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
import type { PhpParameterNameInlayHint } from "../domain/phpInlayHints";
import {
  phpMemberAccessCompletionContextAt,
  phpStaticAccessCompletionContextAt,
} from "../domain/phpMethodCompletions";
import { phpLaravelScopedStringCompletionContextAt } from "../domain/phpLaravelScopedCompletions";
import type { EditorDocument } from "../domain/workspace";
import {
  defaultEditorFontFamily,
  defaultEditorFontLigatures,
  defaultEditorFontSize,
  monacoFontLigaturesForEditorSetting,
  type MonacoAppTheme,
} from "../domain/settings";
import {
  registerJavaScriptTypeScriptLanguageServerMonacoProviders,
  type JavaScriptTypeScriptWorkspaceEditApplicationContext,
} from "./javascriptTypescriptLanguageServerMonacoProviders";
import {
  registerLanguageServerMonacoProviders,
  type BladeCompletion,
  type PhpCodeActionDescriptor,
  type PhpCodeActionRange,
  type PhpWorkspaceEditApplicationContext,
} from "./languageServerMonacoProviders";
import {
  applyImmediateFallbackTheme,
  configureShikiLanguageFeatures,
  setupShikiTokenization,
} from "../infrastructure/shikiHighlighter";
import { setupEmmet } from "../infrastructure/emmetSetup";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import { getTabId, getTabPanelId } from "./tabIds";
import { configureTypescriptJavascriptDefaults } from "./typescriptJavascriptDefaults";

interface ChangePreviewState {
  anchorLineNumber: number;
  hunk: EditorChangeHunk;
}

interface EditorSurfaceProps {
  activeDocument: EditorDocument | null;
  editorFontFamily?: string;
  editorFontLigatures?: boolean;
  editorFontSize?: number;
  isOpeningFile?: boolean;
  applyJavaScriptTypeScriptLanguageServerWorkspaceEdit?(
    edit: LanguageServerWorkspaceEdit,
    context: JavaScriptTypeScriptWorkspaceEditApplicationContext,
  ): Promise<void>;
  applyPhpLanguageServerWorkspaceEdit?(
    edit: LanguageServerWorkspaceEdit,
    context: PhpWorkspaceEditApplicationContext,
  ): Promise<void>;
  bookmarkedLineNumbers?: readonly number[];
  changeHunks: EditorChangeHunk[];
  editorRevealTarget: EditorRevealTarget | null;
  flushPendingJavaScriptTypeScriptLanguageServerDocument?(
    path: string,
  ): Promise<void>;
  flushPendingLanguageServerDocument(path: string): Promise<void>;
  formatOnPaste?: boolean;
  gitBlameEnabled?: boolean;
  isLanguageServerDocumentSynced?(path: string): boolean;
  javaScriptTypeScriptLanguageServerFeaturesGateway?: LanguageServerFeaturesGateway;
  javaScriptTypeScriptLanguageServerRefreshGateway?: LanguageServerRefreshGateway;
  javaScriptTypeScriptLanguageServerRuntimeStatus?: LanguageServerRuntimeStatus | null;
  javaScriptTypeScriptLanguageServerWorkspaceEditGateway?: LanguageServerWorkspaceEditGateway;
  javaScriptTypeScriptValidationEnabled?: boolean;
  languageServerDiagnosticsByPath: Record<string, LanguageServerDiagnostic[]>;
  languageServerFeaturesGateway: LanguageServerFeaturesGateway;
  languageServerRefreshGateway?: LanguageServerRefreshGateway;
  languageServerRuntimeStatus: LanguageServerRuntimeStatus | null;
  keymap: KeymapSettings;
  monacoTheme: MonacoAppTheme;
  navigationHistoryPaths?: readonly string[];
  openDocumentPaths?: readonly string[];
  phpInlayHintsEnabled?: boolean;
  phpIdeReadinessVersion?: number;
  phpLanguageServerWorkspaceEditGateway?: LanguageServerWorkspaceEditGateway;
  workspaceRoot?: string | null;
  onCloseActiveTab(): void;
  onCursorPositionChange(position: EditorPosition): void;
  onEditorMenuCommandRunnerChange?(runner: EditorMenuCommandRunner | null): void;
  onGoBack(): void;
  onGoForward(): void;
  onGoToDefinition(): void;
  onGoToImplementationAt(position: EditorPosition): void;
  onGoToSuperMethod(): void;
  onRunTestAt?(target: PhpTestGutterTarget): void;
  onToggleBookmarkAtLine?(lineNumber: number): void;
  onToggleGitBlame?(): void;
  provideGitBlame?(path: string): Promise<GitBlameLine[]>;
  isActiveDocumentPhpTest?: boolean;
  onEditorFocused(): void;
  onOpenClass(): void;
  onOpenFile(): void;
  onOpenFileStructure(): void;
  onChange(content: string): void;
  onLanguageServerError(error: unknown): void;
  onRevealTargetHandled(): void;
  onRevertChangeHunk(hunk: EditorChangeHunk): void;
  phpSyntaxDiagnosticsGateway: PhpSyntaxDiagnosticsGateway;
  providePhpCodeActions?(
    source: string,
    range: PhpCodeActionRange,
  ): Promise<PhpCodeActionDescriptor[]>;
  provideBladeCompletions?(
    source: string,
    position: EditorPosition,
  ): Promise<BladeCompletion[]>;
  provideBladeDefinition?(
    source: string,
    offset: number,
  ): Promise<boolean>;
  providePhpLaravelDefinition?(
    source: string,
    offset: number,
  ): Promise<boolean>;
  providePhpMethodCompletions(
    source: string,
    position: EditorPosition,
  ): Promise<PhpMethodCompletion[]>;
  providePhpMethodSignature(
    source: string,
    position: EditorPosition,
  ): Promise<PhpMethodSignature | null>;
  providePhpParameterInlayHints?(
    source: string,
    range: { endLine: number; startLine: number },
  ): Promise<PhpParameterNameInlayHint[]>;
}

function EditorSurfaceComponent({
  activeDocument,
  editorFontFamily = defaultEditorFontFamily,
  editorFontLigatures = defaultEditorFontLigatures,
  editorFontSize = defaultEditorFontSize,
  isOpeningFile = false,
  applyJavaScriptTypeScriptLanguageServerWorkspaceEdit = async () => undefined,
  applyPhpLanguageServerWorkspaceEdit = async () => undefined,
  bookmarkedLineNumbers = EMPTY_BOOKMARK_LINES,
  changeHunks,
  editorRevealTarget,
  flushPendingJavaScriptTypeScriptLanguageServerDocument = async () => undefined,
  flushPendingLanguageServerDocument,
  formatOnPaste = false,
  gitBlameEnabled = false,
  isActiveDocumentPhpTest = false,
  isLanguageServerDocumentSynced,
  languageServerDiagnosticsByPath,
  languageServerFeaturesGateway,
  languageServerRefreshGateway,
  languageServerRuntimeStatus,
  javaScriptTypeScriptLanguageServerFeaturesGateway = languageServerFeaturesGateway,
  javaScriptTypeScriptLanguageServerRefreshGateway,
  javaScriptTypeScriptLanguageServerRuntimeStatus = null,
  javaScriptTypeScriptLanguageServerWorkspaceEditGateway,
  javaScriptTypeScriptValidationEnabled = true,
  keymap,
  monacoTheme,
  navigationHistoryPaths = EMPTY_PATHS,
  openDocumentPaths = EMPTY_PATHS,
  phpInlayHintsEnabled = true,
  phpIdeReadinessVersion = 0,
  phpLanguageServerWorkspaceEditGateway,
  workspaceRoot = null,
  onCloseActiveTab,
  onCursorPositionChange,
  onEditorMenuCommandRunnerChange,
  onGoBack,
  onGoForward,
  onGoToDefinition,
  onGoToImplementationAt,
  onGoToSuperMethod,
  onRunTestAt,
  onToggleBookmarkAtLine,
  onToggleGitBlame,
  provideGitBlame,
  onEditorFocused,
  onOpenClass,
  onOpenFile,
  onOpenFileStructure,
  onChange,
  onLanguageServerError,
  onRevealTargetHandled,
  onRevertChangeHunk,
  phpSyntaxDiagnosticsGateway,
  provideBladeCompletions = async () => [],
  provideBladeDefinition = async () => false,
  providePhpCodeActions = async () => [],
  providePhpLaravelDefinition = async () => false,
  providePhpMethodCompletions,
  providePhpMethodSignature,
  providePhpParameterInlayHints = async () => [],
}: EditorSurfaceProps) {
  const [monacoApi, setMonacoApi] = useState<typeof Monaco | null>(null);
  const [editorApi, setEditorApi] =
    useState<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoFontLigatures =
    monacoFontLigaturesForEditorSetting(editorFontLigatures);
  const activeDocumentRef = useRef(activeDocument);
  // Warms TextMate tokens for the active model on idle, off the synchronous
  // reveal/jump path, so a far Cmd+B / click / scroll after open reads cached
  // tokens instead of forcing a main-thread tokenization burst (cold-start lag).
  // One instance per surface; `start()` cancels the previous model's pending
  // warming, so only the active model is ever warmed (per-tab isolation).
  const backgroundTokenizerRef = useRef<BackgroundTokenizer | null>(null);
  if (!backgroundTokenizerRef.current) {
    backgroundTokenizerRef.current = new BackgroundTokenizer(
      idleCallbackScheduler(),
    );
  }
  const runtimeStatusRef = useRef(languageServerRuntimeStatus);
  const javaScriptTypeScriptRuntimeStatusRef = useRef(
    javaScriptTypeScriptLanguageServerRuntimeStatus,
  );
  const flushPendingRef = useRef(flushPendingLanguageServerDocument);
  const flushPendingJavaScriptTypeScriptRef = useRef(
    flushPendingJavaScriptTypeScriptLanguageServerDocument,
  );
  const applyJavaScriptTypeScriptWorkspaceEditRef = useRef(
    applyJavaScriptTypeScriptLanguageServerWorkspaceEdit,
  );
  const applyPhpWorkspaceEditRef = useRef(applyPhpLanguageServerWorkspaceEdit);
  const errorReporterRef = useRef(onLanguageServerError);
  // Holds the latest parent onChange so the Editor can receive a single stable
  // handler (see handleEditorChange) without the closure ever going stale.
  const onChangeRef = useRef(onChange);
  const isLanguageServerDocumentSyncedRef = useRef(
    isLanguageServerDocumentSynced,
  );
  const changeDecorationIdsRef = useRef<string[]>([]);
  // Tracks whether persistent column-selection mode is on so the toggle action
  // flips it. Per-editor state (one EditorSurface instance per tab), so it never
  // leaks between open project tabs.
  const columnSelectionEnabledRef = useRef(false);
  const changeHunksRef = useRef(changeHunks);
  const implementationGutterDecorationIdsRef = useRef<string[]>([]);
  // The path whose glyphs currently occupy implementationGutterDecorationIdsRef.
  // The gutter recompute is debounced, so on a file switch we must clear the
  // previous file's glyphs synchronously (a switch is a path change) rather than
  // waiting for the debounced recompute, which would otherwise leave stale glyphs
  // or duplicate them when revisiting a file. null means no glyphs are applied.
  const implementationGutterDecoratedPathRef = useRef<string | null>(null);
  const implementationGutterTargetsRef = useRef(new Map<number, EditorPosition>());
  // Caches gutter targets so navigating back to an unchanged PHP file reuses
  // the previous parse instead of re-scanning the whole file on the navigation
  // commit. A content change re-parses and refreshes glyphs. Cross-tab safety
  // does not rely on per-tab instances (this surface is reused across tabs): it
  // is keyed by absolute document path, which is globally unique per workspace
  // root, plus full content, so a hit can never serve another file's targets.
  const implementationGutterTargetsCacheRef = useRef(
    new PhpImplementationGutterTargetsCache(),
  );
  const testGutterDecorationIdsRef = useRef<string[]>([]);
  // The path whose glyphs currently occupy testGutterDecorationIdsRef (see the
  // implementation-gutter counterpart for why the debounced recompute needs a
  // synchronous path-switch clear).
  const testGutterDecoratedPathRef = useRef<string | null>(null);
  // Maps a line number to the parsed test target on that line so a Right-lane
  // gutter click can dispatch the exact test to run. Reset whenever the active
  // document changes so a stale tab's targets can never run.
  const testGutterTargetsRef = useRef(new Map<number, PhpTestGutterTarget>());
  // Caches test gutter targets per absolute document path (globally unique per
  // workspace root) plus full content. Mirrors the implementation gutter cache,
  // so revisiting an unchanged test file reuses the previous parse and a hit can
  // never serve another file's targets across open project tabs.
  const testGutterTargetsCacheRef = useRef(new PhpTestGutterTargetsCache());
  // Bookmark gutter markers. Rendered in the lines-decorations margin (an
  // independent lane from the three glyph-margin lanes: Left=git, Center=impl,
  // Right=test-run) so they never collide with those glyphs or their click
  // handlers, and work on every language (not just PHP).
  const bookmarkDecorationIdsRef = useRef<string[]>([]);
  // Git blame annotations. Rendered as inline `before` injected text at the start
  // of each line (the content area), so they occupy NONE of the four gutter lanes
  // (glyph margin Left=git, Center=impl, Right=test-run; lines-decorations=
  // bookmark) - no collision with those glyphs or their click handlers. PhpStorm
  // shows author+date in a column beside the line numbers; Monaco has no native
  // line-annotation column, so inline injected text is the closest non-colliding
  // equivalent and matches how GitLens annotates in VS Code.
  const gitBlameDecorationIdsRef = useRef<string[]>([]);
  // The path whose annotations currently occupy gitBlameDecorationIdsRef. null
  // means none are applied. Used to drop the previous file's annotations on a
  // switch (per-tab isolation) and to ignore a stale async blame result whose
  // requested path no longer matches the active document.
  const gitBlameDecoratedPathRef = useRef<string | null>(null);
  const provideGitBlameRef = useRef(provideGitBlame);
  const diagnosticOverviewDecorationIdsRef = useRef<string[]>([]);
  // Tracks the diagnostics map seen on the previous run and the set of model
  // objects already given language-server markers, so the marker effect can
  // re-apply markers only for paths whose diagnostics actually changed (or for
  // new/reopened model objects) instead of every open model. A WeakSet keys on
  // the model object: a model disposed on close and recreated on reopen is a new
  // object, so it is correctly re-marked even when its diagnostics are unchanged.
  const previousLanguageServerDiagnosticsByPathRef = useRef<
    Record<string, LanguageServerDiagnostic[]>
  >({});
  const markedLanguageServerModelsRef = useRef<
    WeakSet<Monaco.editor.ITextModel>
  >(new WeakSet());
  const phpCodeActionsRef = useRef(providePhpCodeActions);
  const bladeCompletionsRef = useRef(provideBladeCompletions);
  const bladeDefinitionRef = useRef(provideBladeDefinition);
  const phpLaravelDefinitionRef = useRef(providePhpLaravelDefinition);
  const phpMethodCompletionsRef = useRef(providePhpMethodCompletions);
  const phpMethodSignatureRef = useRef(providePhpMethodSignature);
  const phpParameterInlayHintsRef = useRef(providePhpParameterInlayHints);
  const phpInlayHintsEnabledRef = useRef(phpInlayHintsEnabled);
  const [syntaxDiagnosticsByPath, setSyntaxDiagnosticsByPath] = useState<
    Record<string, PhpSyntaxDiagnostic[]>
  >({});
  const [changePreview, setChangePreview] = useState<ChangePreviewState | null>(
    null,
  );
  const [cursorPosition, setCursorPosition] = useState<EditorPosition | null>(
    null,
  );
  const [breadcrumbSymbolsByPath, setBreadcrumbSymbolsByPath] = useState<
    Record<string, LanguageServerDocumentSymbol[]>
  >({});
  // Holds the captured selection context while the Surround With quick-pick is
  // open. It is scoped to this editor surface and cleared as soon as a template
  // is chosen or the picker is dismissed, so nothing leaks across tabs.
  const [surroundWithRequest, setSurroundWithRequest] =
    useState<SurroundWithRequest | null>(null);

  useEffect(() => {
    activeDocumentRef.current = activeDocument;
  }, [activeDocument]);

  // A document switch must never apply a wrap meant for the previous file, so
  // any pending Surround With request is dropped when the active document
  // changes.
  useEffect(() => {
    setSurroundWithRequest(null);
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
    if (!monacoApi) {
      return;
    }

    configureTypescriptJavascriptDefaults(monacoApi, {
      managedLanguageServerActive:
        isJavaScriptTypeScriptRuntimeActiveForWorkspace(
          javaScriptTypeScriptLanguageServerRuntimeStatus,
          workspaceRoot,
        ),
      validationEnabled: javaScriptTypeScriptValidationEnabled,
    });
  }, [
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptValidationEnabled,
    monacoApi,
    workspaceRoot,
  ]);

  useEffect(() => {
    flushPendingRef.current = flushPendingLanguageServerDocument;
  }, [flushPendingLanguageServerDocument]);

  useEffect(() => {
    flushPendingJavaScriptTypeScriptRef.current =
      flushPendingJavaScriptTypeScriptLanguageServerDocument;
  }, [flushPendingJavaScriptTypeScriptLanguageServerDocument]);

  useEffect(() => {
    applyJavaScriptTypeScriptWorkspaceEditRef.current =
      applyJavaScriptTypeScriptLanguageServerWorkspaceEdit;
  }, [applyJavaScriptTypeScriptLanguageServerWorkspaceEdit]);

  useEffect(() => {
    applyPhpWorkspaceEditRef.current = applyPhpLanguageServerWorkspaceEdit;
  }, [applyPhpLanguageServerWorkspaceEdit]);

  useEffect(() => {
    errorReporterRef.current = onLanguageServerError;
  }, [onLanguageServerError]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    isLanguageServerDocumentSyncedRef.current = isLanguageServerDocumentSynced;
  }, [isLanguageServerDocumentSynced]);

  useEffect(() => {
    phpCodeActionsRef.current = providePhpCodeActions;
  }, [providePhpCodeActions]);

  useEffect(() => {
    bladeCompletionsRef.current = provideBladeCompletions;
  }, [provideBladeCompletions]);

  useEffect(() => {
    bladeDefinitionRef.current = provideBladeDefinition;
  }, [provideBladeDefinition]);

  useEffect(() => {
    phpLaravelDefinitionRef.current = providePhpLaravelDefinition;
  }, [providePhpLaravelDefinition]);

  useEffect(() => {
    phpMethodCompletionsRef.current = providePhpMethodCompletions;
  }, [providePhpMethodCompletions]);

  useEffect(() => {
    phpMethodSignatureRef.current = providePhpMethodSignature;
  }, [providePhpMethodSignature]);

  useEffect(() => {
    phpParameterInlayHintsRef.current = providePhpParameterInlayHints;
  }, [providePhpParameterInlayHints]);

  useEffect(() => {
    phpInlayHintsEnabledRef.current = phpInlayHintsEnabled;
  }, [phpInlayHintsEnabled]);

  useEffect(() => {
    provideGitBlameRef.current = provideGitBlame;
  }, [provideGitBlame]);

  useEffect(() => {
    if (!activeDocument || activeDocument.language !== "php") {
      return;
    }

    if (!editorApi || phpIdeReadinessVersion <= 0) {
      return;
    }

    const model = editorApi.getModel();
    const position = editorApi.getPosition();

    if (!model || !position || modelPath(model) !== activeDocument.path) {
      return;
    }

    const source = model.getValue();
    const isPhpCompletionContext = Boolean(
      phpMemberAccessCompletionContextAt(source, position) ||
        phpStaticAccessCompletionContextAt(source, position) ||
        phpLaravelScopedStringCompletionContextAt(source, position),
    );

    if (!isPhpCompletionContext) {
      return;
    }

    editorApi.trigger("mockor.phpIdeReadiness", "editor.action.triggerSuggest", {});
    // Re-key on the active document's *path* + *language* (stable strings), not
    // its object identity. `activeDocument` is replaced with a fresh
    // `{ ...doc, content }` on every keystroke; depending on the whole object
    // re-ran this effect per character typed, each time copying the model value
    // (O(file)) and scanning up to three completion contexts (O(file) each), and
    // could even reopen the suggest widget mid-typing. The intent is to reopen
    // suggestions on a readiness *bump* or a file switch - both still covered by
    // `phpIdeReadinessVersion`, the path/language keys, and the provider becoming
    // ready - never per keystroke.
  }, [
    activeDocument?.path,
    activeDocument?.language,
    editorApi,
    phpIdeReadinessVersion,
    providePhpMethodCompletions,
  ]);

  useEffect(() => {
    if (!onEditorMenuCommandRunnerChange) {
      return;
    }

    if (!editorApi || !activeDocument) {
      onEditorMenuCommandRunnerChange(null);
      return;
    }

    const targetPath = activeDocument.path;
    const runner: EditorMenuCommandRunner = (command) => {
      const model = editorApi.getModel();

      if (!model || modelPath(model) !== targetPath) {
        return;
      }

      editorApi.focus();
      editorApi.trigger(
        "mockor.windowChrome",
        editorActionForMenuCommand(command),
        null,
      );
    };

    onEditorMenuCommandRunnerChange(runner);

    return () => {
      onEditorMenuCommandRunnerChange(null);
    };
  }, [activeDocument?.path, editorApi, onEditorMenuCommandRunnerChange]);

  useEffect(() => {
    if (!monacoApi) {
      return;
    }

    const disposable = registerLanguageServerMonacoProviders(monacoApi, {
      applyWorkspaceEdit: (edit, editContext) =>
        applyPhpWorkspaceEditRef.current(edit, editContext),
      featuresGateway: languageServerFeaturesGateway,
      flushPendingDocumentChange: (path) => flushPendingRef.current(path),
      getActiveDocument: () => activeDocumentRef.current,
      getRuntimeStatus: () => runtimeStatusRef.current,
      getWorkspaceRoot: () => workspaceRoot,
      isDocumentSynced: (rootPath, path) =>
        workspaceRootKeysEqual(rootPath, workspaceRoot) &&
        Boolean(isLanguageServerDocumentSyncedRef.current?.(path)),
      isPhpInlayHintsEnabled: () => phpInlayHintsEnabledRef.current,
      limitNavigationResultsToOpenModels: true,
      provideBladeCompletions: (source, position) =>
        bladeCompletionsRef.current(source, position),
      provideBladeDefinition: (source, offset) =>
        bladeDefinitionRef.current(source, offset),
      providePhpCodeActions: (source, range) =>
        phpCodeActionsRef.current(source, range),
      providePhpLaravelDefinition: (source, offset) =>
        phpLaravelDefinitionRef.current(source, offset),
      providePhpMethodCompletions: (source, position) =>
        phpMethodCompletionsRef.current(source, position),
      providePhpMethodSignature: (source, position) =>
        phpMethodSignatureRef.current(source, position),
      providePhpParameterInlayHints: (source, range) =>
        phpParameterInlayHintsRef.current(source, range),
      refreshGateway: languageServerRefreshGateway,
      reportError: (error) => errorReporterRef.current(error),
      workspaceEditGateway: phpLanguageServerWorkspaceEditGateway,
    });

    return () => disposable.dispose();
  }, [
    languageServerFeaturesGateway,
    languageServerRefreshGateway,
    monacoApi,
    phpLanguageServerWorkspaceEditGateway,
    workspaceRoot,
  ]);

  useEffect(() => {
    if (!monacoApi) {
      return;
    }

    const disposable = registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monacoApi,
      {
        applyWorkspaceEdit: (edit, editContext) =>
          applyJavaScriptTypeScriptWorkspaceEditRef.current(edit, editContext),
        featuresGateway: javaScriptTypeScriptLanguageServerFeaturesGateway,
        flushPendingDocumentChange: (path) =>
          flushPendingJavaScriptTypeScriptRef.current(path),
        getActiveDocument: () => activeDocumentRef.current,
        getRuntimeStatus: () => javaScriptTypeScriptRuntimeStatusRef.current,
        getWorkspaceRoot: () => workspaceRoot,
        limitNavigationResultsToOpenModels: true,
        refreshGateway: javaScriptTypeScriptLanguageServerRefreshGateway,
        reportError: (error) => errorReporterRef.current(error),
        workspaceEditGateway:
          javaScriptTypeScriptLanguageServerWorkspaceEditGateway,
      },
    );

    return () => disposable.dispose();
  }, [
    javaScriptTypeScriptLanguageServerFeaturesGateway,
    javaScriptTypeScriptLanguageServerRefreshGateway,
    javaScriptTypeScriptLanguageServerWorkspaceEditGateway,
    monacoApi,
    workspaceRoot,
  ]);

  const handleMount: OnMount = useCallback((_editor, monaco) => {
    setEditorApi(_editor);
    setMonacoApi(monaco);
  }, []);

  useEffect(() => {
    if (!editorApi) {
      return;
    }

    editorApi.updateOptions({
      fontFamily: editorFontFamily,
      fontLigatures: monacoFontLigatures,
      fontSize: editorFontSize,
    });
  }, [editorApi, editorFontFamily, monacoFontLigatures, editorFontSize]);

  useEffect(() => {
    if (!editorApi) {
      return;
    }

    const disposable = editorApi.onDidChangeCursorPosition((event) => {
      onCursorPositionChange(event.position);
      setCursorPosition((previous) =>
        nextCursorPosition(previous, event.position),
      );
    });
    const position = editorApi.getPosition();

    if (position) {
      onCursorPositionChange(position);
      setCursorPosition((previous) => nextCursorPosition(previous, position));
    }

    return () => disposable.dispose();
  }, [editorApi, onCursorPositionChange]);

  // Eagerly warm the active model's TextMate tokens on idle after open/switch.
  // @monaco-editor/react swaps the model when `path` changes, so this re-runs on
  // every document switch: it adopts the new active model and (inside `start`)
  // cancels any pending warming for the previous one, so a stale tab's model can
  // never keep tokenizing. The cleanup stops warming on unmount/switch, and the
  // tokenizer re-checks `model.isDisposed()` before each idle slice.
  useEffect(() => {
    const tokenizer = backgroundTokenizerRef.current;

    if (!editorApi || !activeDocument || !tokenizer) {
      return;
    }

    const requestedPath = activeDocument.path;
    const model = editorApi.getModel();

    // Only warm the model that actually backs the requested document. During a
    // switch the editor can still hold the previous model for a frame; warming
    // it would tokenize the wrong file, so we wait for the next effect run.
    if (!model || modelPath(model) !== requestedPath) {
      return;
    }

    tokenizer.start(model as unknown as BackgroundTokenizableModel);

    return () => tokenizer.stop();
  }, [activeDocument, editorApi]);

  // Permanent teardown so a disposed surface leaves no pending idle slice.
  useEffect(() => {
    const tokenizer = backgroundTokenizerRef.current;
    return () => tokenizer?.dispose();
  }, []);

  useEffect(() => {
    if (!activeDocument || !workspaceRoot) {
      return;
    }

    const breadcrumbGateway = breadcrumbFeaturesGateway(activeDocument, {
      javaScriptTypeScript: javaScriptTypeScriptLanguageServerFeaturesGateway,
      php: languageServerFeaturesGateway,
    });

    if (!breadcrumbGateway) {
      return;
    }

    const requestedRoot = workspaceRoot;
    const requestedPath = activeDocument.path;
    // The synced gate only applies to PHP documents: phpactor answers a
    // DocumentSymbol request that races ahead of the document's `didOpen` with
    // UnknownDocument, and `isLanguageServerDocumentSynced` tracks exactly the
    // PHP synced set. JS/TS breadcrumbs keep their prior on-demand behaviour.
    const requiresSync = isLanguageServerDocument(activeDocument);
    let active = true;
    let timeout: number | null = null;

    const fetchBreadcrumbSymbols = () => {
      breadcrumbGateway
        .documentSymbols(requestedRoot, requestedPath)
        .then((symbols) => {
          if (!active) {
            return;
          }

          setBreadcrumbSymbolsByPath((current) => ({
            ...current,
            [requestedPath]: symbols,
          }));
        })
        .catch((error) => errorReporterRef.current(error));
    };

    const loadBreadcrumbSymbols = () => {
      if (!active) {
        return;
      }

      // Skip until the document's `didOpen` has been sent; otherwise the
      // outline / breadcrumb fetch races ahead of the document sync and
      // phpactor answers with UnknownDocument. Re-arm so the breadcrumbs are
      // populated as soon as the document is synced (the sync state lives in a
      // ref, so polling is the re-trigger that survives the await-less sync).
      if (
        requiresSync &&
        !isLanguageServerDocumentSyncedRef.current?.(requestedPath)
      ) {
        timeout = window.setTimeout(loadBreadcrumbSymbols, 160);
        return;
      }

      fetchBreadcrumbSymbols();
    };

    timeout = window.setTimeout(loadBreadcrumbSymbols, 160);

    return () => {
      active = false;

      if (timeout !== null) {
        window.clearTimeout(timeout);
      }
    };
    // `isLanguageServerDocumentSynced` is read through a ref inside the poll, so
    // it is intentionally omitted here: the re-arming timeout re-reads the fresh
    // synced state each tick (the re-trigger) without restarting the effect.
  }, [
    activeDocument,
    javaScriptTypeScriptLanguageServerFeaturesGateway,
    languageServerFeaturesGateway,
    workspaceRoot,
  ]);

  useEffect(() => {
    if (!activeDocument || !editorApi || !monacoApi) {
      return;
    }

    if (!isSmartBlankLineIndentDocument(activeDocument)) {
      return;
    }

    const disposable = editorApi.onDidChangeModelContent((event) => {
      const insertedNewLine = event.changes.some((change) =>
        change.text.includes("\n"),
      );
      const insertedBlankLineWhitespace = event.changes.some((change) =>
        /^[\t ]+$/.test(change.text),
      );

      if (!insertedNewLine && !insertedBlankLineWhitespace) {
        return;
      }

      const model = editorApi.getModel();
      const position = editorApi.getPosition();

      if (!model || !position || modelPath(model) !== activeDocument.path) {
        return;
      }

      const targetLineNumber = insertedNewLine
        ? smartBlankLineIndentTargetLineNumber(
            event.changes,
            position.lineNumber,
          )
        : position.lineNumber;
      const indent = smartBlankLineIndent(model, targetLineNumber);

      if (indent === null) {
        return;
      }

      const line = model.getLineContent(targetLineNumber);
      const currentIndent = leadingWhitespace(line);

      if (currentIndent === indent) {
        return;
      }

      if (!insertedNewLine && currentIndent.length >= indent.length) {
        return;
      }

      editorApi.executeEdits("mockor.smartBlankLineIndent", [
        {
          forceMoveMarkers: true,
          range: new monacoApi.Range(
            targetLineNumber,
            1,
            targetLineNumber,
            currentIndent.length + 1,
          ),
          text: indent,
        },
      ]);
      editorApi.setPosition({
        column: indent.length + 1,
        lineNumber: targetLineNumber,
      });
    });

    return () => disposable.dispose();
  }, [activeDocument, editorApi, monacoApi]);

  useEffect(() => {
    if (!editorApi || !monacoApi) {
      return;
    }

    const keymapPlatform = detectKeymapPlatform();
    const keybinding = (commandId: KeymapCommandId) =>
      monacoKeybindingsForShortcut(
        monacoApi,
        shortcutForCommand(keymap, commandId, keymapPlatform),
        keymapPlatform,
      );
    const disposables = [
      editorApi.addAction({
        id: "mockor.goToDefinition",
        label: "Go to Definition",
        keybindings: keybinding("editor.goToDefinition"),
        run: () => {
          onGoToDefinition();
        },
      }),
      editorApi.addAction({
        id: "mockor.quickDefinition",
        label: "Quick Definition",
        keybindings: keybinding("editor.quickDefinition"),
        run: () =>
          triggerEditorAction(editorApi, "editor.action.peekDefinition"),
      }),
      editorApi.addAction({
        id: "mockor.goToImplementation",
        label: "Go to Implementation",
        keybindings: keybinding("editor.goToImplementation"),
        run: () => {
          const position = editorApi.getPosition();

          if (!position) {
            return;
          }

          onGoToImplementationAt(position);
        },
      }),
      editorApi.addAction({
        id: "mockor.goToSuperMethod",
        label: "Go to Super Method",
        keybindings: keybinding("editor.goToSuperMethod"),
        run: () => {
          onGoToSuperMethod();
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
        id: "mockor.toggleGitBlame",
        label: "Annotate with Git Blame",
        keybindings: keybinding("editor.toggleGitBlame"),
        run: () => {
          onToggleGitBlame?.();
        },
      }),
      editorApi.addAction({
        id: "mockor.formatDocument",
        label: "Format Document",
        keybindings: keybinding("editor.formatDocument"),
        run: () => {
          const model = editorApi.getModel();

          if (!model) {
            return;
          }

          editorApi.trigger("keyboard", "editor.action.formatDocument", {});
        },
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

          if (isTypescriptJavascriptDocument(activeDocumentRef.current)) {
            editorApi.trigger("keyboard", "editor.action.quickFix", {});
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
        id: "mockor.shrinkSelection",
        label: "Shrink Selection",
        keybindings: keybinding("editor.shrinkSelection"),
        run: () =>
          triggerEditorAction(editorApi, "editor.action.smartSelect.shrink"),
      }),
      editorApi.addAction({
        id: "mockor.insertCursorAbove",
        label: "Add Caret Above",
        keybindings: keybinding("editor.insertCursorAbove"),
        run: () =>
          triggerEditorAction(editorApi, "editor.action.insertCursorAbove"),
      }),
      editorApi.addAction({
        id: "mockor.insertCursorBelow",
        label: "Add Caret Below",
        keybindings: keybinding("editor.insertCursorBelow"),
        run: () =>
          triggerEditorAction(editorApi, "editor.action.insertCursorBelow"),
      }),
      editorApi.addAction({
        id: "mockor.selectAllOccurrences",
        label: "Select All Occurrences",
        keybindings: keybinding("editor.selectAllOccurrences"),
        run: () =>
          triggerEditorAction(editorApi, "editor.action.selectHighlights"),
      }),
      editorApi.addAction({
        id: "mockor.toggleColumnSelection",
        label: "Toggle Column Selection Mode",
        keybindings: keybinding("editor.toggleColumnSelection"),
        run: () => {
          if (!editorApi.getModel()) {
            return;
          }

          columnSelectionEnabledRef.current = !columnSelectionEnabledRef.current;
          editorApi.updateOptions({
            columnSelection: columnSelectionEnabledRef.current,
          });
        },
      }),
      editorApi.addAction({
        id: "mockor.moveStatementUp",
        label: "Move Statement Up",
        keybindings: keybinding("editor.moveStatementUp"),
        run: () => {
          if (
            activeDocumentRef.current?.language === "php" &&
            applyMoveStatement(monacoApi, editorApi, "up")
          ) {
            return;
          }

          triggerEditorAction(editorApi, "editor.action.moveLinesUpAction");
        },
      }),
      editorApi.addAction({
        id: "mockor.moveStatementDown",
        label: "Move Statement Down",
        keybindings: keybinding("editor.moveStatementDown"),
        run: () => {
          if (
            activeDocumentRef.current?.language === "php" &&
            applyMoveStatement(monacoApi, editorApi, "down")
          ) {
            return;
          }

          triggerEditorAction(editorApi, "editor.action.moveLinesDownAction");
        },
      }),
      editorApi.addAction({
        id: "mockor.moveLineUp",
        label: "Move Line Up",
        keybindings: keybinding("editor.moveLineUp"),
        run: () =>
          triggerEditorAction(editorApi, "editor.action.moveLinesUpAction"),
      }),
      editorApi.addAction({
        id: "mockor.moveLineDown",
        label: "Move Line Down",
        keybindings: keybinding("editor.moveLineDown"),
        run: () =>
          triggerEditorAction(editorApi, "editor.action.moveLinesDownAction"),
      }),
      editorApi.addAction({
        id: "mockor.duplicateLine",
        label: "Duplicate Line or Selection",
        keybindings: keybinding("editor.duplicateLine"),
        run: () =>
          triggerEditorAction(editorApi, "editor.action.copyLinesDownAction"),
      }),
      editorApi.addAction({
        id: "mockor.addSelectionToNextMatch",
        label: "Add Selection to Next Match",
        keybindings: keybinding("editor.addSelectionToNextMatch"),
        run: () =>
          triggerEditorAction(
            editorApi,
            "editor.action.addSelectionToNextFindMatch",
          ),
      }),
      editorApi.addAction({
        id: "mockor.deleteLine",
        label: "Delete Line",
        keybindings: keybinding("editor.deleteLine"),
        run: () =>
          triggerEditorAction(editorApi, "editor.action.deleteLines"),
      }),
      editorApi.addAction({
        id: "mockor.surroundWith",
        label: "Surround With",
        keybindings: keybinding("editor.surroundWith"),
        run: () => {
          const request = surroundWithRequestFromEditor(monacoApi, editorApi);

          if (!request) {
            return;
          }

          setSurroundWithRequest(request);
        },
      }),
      editorApi.addAction({
        id: "mockor.completeStatement",
        label: "Complete Current Statement",
        keybindings: keybinding("editor.completeStatement"),
        run: () => {
          if (activeDocumentRef.current?.language !== "php") {
            return;
          }

          applyCompleteStatement(monacoApi, editorApi);
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
    onGoToSuperMethod,
    onOpenClass,
    onOpenFile,
    onOpenFileStructure,
    onToggleGitBlame,
    setSurroundWithRequest,
  ]);

  useEffect(() => {
    if (!editorApi || !monacoApi) {
      return;
    }

    const disposable = editorApi.onMouseDown((event) => {
      const targetType = event.target.type;
      const isGlyphMargin =
        targetType === monacoApi.editor.MouseTargetType.GUTTER_GLYPH_MARGIN;
      const isLineDecorations =
        targetType === monacoApi.editor.MouseTargetType.GUTTER_LINE_DECORATIONS;

      if (!isGlyphMargin && !isLineDecorations) {
        return;
      }

      const lineNumber = event.target.position?.lineNumber;

      if (!lineNumber) {
        return;
      }

      // A click in the lines-decorations margin toggles a bookmark on that line.
      // This margin is independent of the three glyph-margin lanes, so it never
      // contends with the git/impl/test glyph clicks above.
      if (isLineDecorations) {
        if (!onToggleBookmarkAtLine) {
          return;
        }

        event.event.preventDefault();
        event.event.stopPropagation();
        onToggleBookmarkAtLine(lineNumber);
        return;
      }

      const lane = glyphMarginLaneFromMouseEvent(event);
      const changeHunk = findChangeHunkAtLine(
        changeHunksRef.current,
        lineNumber,
      );
      const testTarget = testGutterTargetsRef.current.get(lineNumber);

      if (
        testTarget &&
        onRunTestAt &&
        lane === monacoApi.editor.GlyphMarginLane.Right
      ) {
        event.event.preventDefault();
        event.event.stopPropagation();
        onRunTestAt(testTarget);
        return;
      }

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
  }, [
    editorApi,
    monacoApi,
    onGoToImplementationAt,
    onRunTestAt,
    onToggleBookmarkAtLine,
  ]);

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
    // Depend on the active document path (not its full identity) so typing does
    // not re-run this effect every keystroke. The body reads only the path (for
    // the per-tab stale guard) plus changeHunks, so the path covers file
    // switches and changeHunks covers actual hunk changes. Mirrors the
    // bookmark / diagnostic-overview / gutter path-gated effects.
  }, [activeDocument?.path, changeHunks, editorApi, monacoApi]);

  // Renders a bookmark marker in the lines-decorations margin plus an overview
  // ruler tick for each bookmarked line of the active document. The stale-guard
  // (model path must equal the active document path) keeps the per-tab isolation
  // invariant intact: a switch repaints from the new tab's bookmarked lines and
  // the previous tab's markers are dropped via deltaDecorations.
  useEffect(() => {
    if (!activeDocument || !editorApi || !monacoApi) {
      return;
    }

    const model = editorApi.getModel();

    if (!model || modelPath(model) !== activeDocument.path) {
      return;
    }

    bookmarkDecorationIdsRef.current = editorApi.deltaDecorations(
      bookmarkDecorationIdsRef.current,
      bookmarkedLineNumbers.map((lineNumber) =>
        toBookmarkDecoration(monacoApi, lineNumber),
      ),
    );

    return () => {
      bookmarkDecorationIdsRef.current = editorApi.deltaDecorations(
        bookmarkDecorationIdsRef.current,
        [],
      );
    };
    // Depend on the active document path (not its full identity) so typing does
    // not re-run this effect every keystroke. The body reads only the path (for
    // the per-tab stale guard) plus bookmarkedLineNumbers, so the path covers
    // file switches and bookmarkedLineNumbers covers bookmark toggles.
  }, [activeDocument?.path, bookmarkedLineNumbers, editorApi, monacoApi]);

  // Git blame annotations (PhpStorm "Annotate with Git Blame"). When enabled for
  // the active document, fetch per-line blame off the parent gateway and render
  // an inline author + relative-date annotation at the start of each line. The
  // request captures the requested path up front and re-checks the active /
  // model path AFTER the await before mutating decorations, so a tab switch in
  // flight drops the stale result (per-tab + per-document isolation). Disabling
  // (or switching away) clears the annotations synchronously.
  useEffect(() => {
    if (!activeDocument || !editorApi || !monacoApi) {
      return;
    }

    const model = editorApi.getModel();

    if (!model || modelPath(model) !== activeDocument.path) {
      return;
    }

    const clearAnnotations = () => {
      gitBlameDecorationIdsRef.current = editorApi.deltaDecorations(
        gitBlameDecorationIdsRef.current,
        [],
      );
      gitBlameDecoratedPathRef.current = null;
    };

    const provider = provideGitBlameRef.current;

    if (!gitBlameEnabled || !provider) {
      clearAnnotations();
      return;
    }

    // Capture the requested path BEFORE the await so a switch can be detected.
    const requestedPath = activeDocument.path;
    let cancelled = false;

    void provider(requestedPath)
      .then((blameLines) => {
        // Re-check AFTER the await: drop stale results from a switched-away tab,
        // an effect cleanup (cancelled), a disposed model, or a document whose
        // path no longer matches the request.
        if (cancelled || model.isDisposed?.()) {
          return;
        }

        const currentModel = editorApi.getModel();

        if (
          !currentModel ||
          modelPath(currentModel) !== requestedPath ||
          activeDocumentRef.current?.path !== requestedPath
        ) {
          return;
        }

        const now = Date.now();
        gitBlameDecorationIdsRef.current = editorApi.deltaDecorations(
          gitBlameDecorationIdsRef.current,
          blameLines.map((line) =>
            toGitBlameDecoration(monacoApi, line, now),
          ),
        );
        gitBlameDecoratedPathRef.current = requestedPath;
      })
      .catch(() => {
        // Blame is best-effort decoration; a gateway failure leaves the editor
        // untouched rather than surfacing an error.
      });

    return () => {
      cancelled = true;
      clearAnnotations();
    };
    // Keyed on the active path + the enabled flag (not the document identity), so
    // typing does not refetch blame every keystroke; a file switch or a toggle
    // re-runs it. Blame is anchored to committed lines and need not track live
    // edits between toggles.
  }, [activeDocument?.path, editorApi, gitBlameEnabled, monacoApi]);

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

    // Synchronously drop the previous file's glyphs on a path switch (or when the
    // document is no longer PHP) so a switch never leaves stale glyphs while the
    // debounced recompute is pending. A same-path keystroke does not clear, so
    // the existing glyphs stay put (and track edits via stickiness) until the
    // debounce flushes - no flicker.
    const decoratedPath = implementationGutterDecoratedPathRef.current;
    const isPathSwitch =
      decoratedPath !== null && decoratedPath !== activeDocument.path;

    if (activeDocument.language !== "php" || isPathSwitch) {
      implementationGutterTargetsRef.current = new Map();
      implementationGutterDecorationIdsRef.current = editorApi.deltaDecorations(
        implementationGutterDecorationIdsRef.current,
        [],
      );
      implementationGutterDecoratedPathRef.current = null;
    }

    if (activeDocument.language !== "php") {
      return;
    }

    // Debounce the full-file parse + decoration replace. `activeDocument` gets a
    // fresh `{ ...doc, content }` on every keystroke, which re-ran this effect
    // (cache miss on changed content -> full re-parse + deltaDecorations) per
    // character typed. The glyphs do not need to track typing in real time -
    // their stickiness keeps existing glyphs anchored to the right lines while
    // typing, and the recompute catches up ~160ms after the user pauses. This
    // mirrors the syntax-diagnostics debounce. The cleanup only clears the
    // pending timer so rapid keystrokes coalesce into a single parse without
    // clearing the glyphs in between (no flicker).
    const targetDocumentPath = activeDocument.path;
    const targetDocumentContent = activeDocument.content;
    const timeout = window.setTimeout(() => {
      const liveModel = editorApi.getModel();

      if (!liveModel || modelPath(liveModel) !== targetDocumentPath) {
        return;
      }

      const targets = implementationGutterTargetsCacheRef.current.resolve(
        targetDocumentPath,
        targetDocumentContent,
      );
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
              monacoApi.editor.TrackedRangeStickiness
                .NeverGrowsWhenTypingAtEdges,
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
      implementationGutterDecoratedPathRef.current = targetDocumentPath;
    }, 160);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [activeDocument, editorApi, monacoApi]);

  // Renders the green "run test" play glyph on the Right glyph-margin lane for
  // each parsed test target in the active PHP test file. Gated to PHP test
  // documents (via the controller-supplied boolean) so the glyph never appears
  // on production code or non-PHP files. The stale-guard (model path must equal
  // the active document path) plus the absolute-path-keyed cache keep the
  // per-tab isolation invariant intact.
  useEffect(() => {
    if (!activeDocument || !editorApi || !monacoApi) {
      return;
    }

    const model = editorApi.getModel();

    if (!model || modelPath(model) !== activeDocument.path) {
      return;
    }

    // Synchronously drop the previous file's glyphs on a path switch (or when the
    // document stops being a PHP test) so a switch never leaves stale glyphs while
    // the debounced recompute is pending. Mirrors the implementation-gutter
    // effect; see its comment for the no-flicker rationale.
    const decoratedPath = testGutterDecoratedPathRef.current;
    const isPathSwitch =
      decoratedPath !== null && decoratedPath !== activeDocument.path;
    const isApplicable =
      activeDocument.language === "php" && isActiveDocumentPhpTest;

    if (!isApplicable || isPathSwitch) {
      testGutterTargetsRef.current = new Map();
      testGutterDecorationIdsRef.current = editorApi.deltaDecorations(
        testGutterDecorationIdsRef.current,
        [],
      );
      testGutterDecoratedPathRef.current = null;
    }

    if (!isApplicable) {
      return;
    }

    const targetDocumentPath = activeDocument.path;
    const targetDocumentContent = activeDocument.content;
    const timeout = window.setTimeout(() => {
      const liveModel = editorApi.getModel();

      if (!liveModel || modelPath(liveModel) !== targetDocumentPath) {
        return;
      }

      const targets = testGutterTargetsCacheRef.current.resolve(
        targetDocumentPath,
        targetDocumentContent,
      );
      testGutterTargetsRef.current = new Map(
        targets.map((target) => [target.position.lineNumber, target]),
      );
      testGutterDecorationIdsRef.current = editorApi.deltaDecorations(
        testGutterDecorationIdsRef.current,
        targets.map((target) => ({
          options: {
            glyphMargin: {
              position: monacoApi.editor.GlyphMarginLane.Right,
            },
            glyphMarginClassName: "test-run-gutter-glyph",
            glyphMarginHoverMessage: {
              value: target.label,
            },
            isWholeLine: false,
            stickiness:
              monacoApi.editor.TrackedRangeStickiness
                .NeverGrowsWhenTypingAtEdges,
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
      testGutterDecoratedPathRef.current = targetDocumentPath;
    }, 160);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [activeDocument, editorApi, isActiveDocumentPhpTest, monacoApi]);

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

    // The diagnostics map gets a fresh identity on every language-server event,
    // but typically only one path's diagnostics actually change. Re-applying
    // markers to every open model on each event is wasteful (large projects can
    // have many models open). Re-apply markers only for models we have not marked
    // yet (a freshly opened model, or one disposed-and-recreated for the same
    // path on reopen, is a new object the WeakSet has not seen) or whose
    // diagnostics array identity changed since the previous run. The result is
    // identical to a full re-apply, with far less per-event work.
    const previousDiagnosticsByPath =
      previousLanguageServerDiagnosticsByPathRef.current;
    const markedModels = markedLanguageServerModelsRef.current;

    monacoApi.editor.getModels().forEach((model) => {
      const path = modelPath(model);

      if (!path) {
        return;
      }

      const diagnostics = languageServerDiagnosticsByPath[path] ?? [];
      const isNewModel = !markedModels.has(model);
      const diagnosticsChanged =
        previousDiagnosticsByPath[path] !== languageServerDiagnosticsByPath[path];

      if (!isNewModel && !diagnosticsChanged) {
        return;
      }

      monacoApi.editor.setModelMarkers(
        model,
        "php-language-server",
        diagnostics.map((diagnostic) =>
          toMonacoDiagnosticMarker(monacoApi, diagnostic),
        ),
      );
      markedModels.add(model);
    });

    previousLanguageServerDiagnosticsByPathRef.current =
      languageServerDiagnosticsByPath;
    // Re-key on the active document's *path* (a stable string), not its object
    // identity. `activeDocument` is replaced with a fresh `{ ...doc, content }`
    // on every keystroke, which would otherwise re-run for every open model on
    // each character typed even though diagnostics are unchanged. The path still
    // changes when a new file is opened/activated, so a freshly opened model
    // that already has diagnostics still gets its markers (handled by the
    // newly-seen-path branch above); real diagnostic changes are covered by the
    // `languageServerDiagnosticsByPath` dependency and the per-path diff.
  }, [activeDocument?.path, languageServerDiagnosticsByPath, monacoApi]);

  useEffect(() => {
    if (!monacoApi) {
      return;
    }

    // EditorSurface lives for the whole app session, so the per-path caches grow
    // without bound as distinct files are visited. Prune entries whose model is
    // no longer open (the live Monaco model set is the source of truth for "open
    // documents") to stop the slow leak. Keyed on the active path so it re-runs
    // when files are opened, closed, or switched. Conservative by construction:
    // entries for still-open paths are never dropped.
    const openPaths = new Set(
      monacoApi.editor
        .getModels()
        .map((model) => modelPath(model))
        .filter((path): path is string => path !== null),
    );

    setSyntaxDiagnosticsByPath((current) =>
      pruneClosedPaths(current, openPaths),
    );
    setBreadcrumbSymbolsByPath((current) =>
      pruneClosedPaths(current, openPaths),
    );
  }, [activeDocument?.path, monacoApi]);

  useEffect(() => {
    if (!monacoApi) {
      return;
    }

    // @monaco-editor/react gets-or-creates one model per visited path and never
    // disposes it on a path switch, so every file ever opened keeps its text
    // buffer + tokenization + undo stack alive for the whole app session
    // (a slow per-file memory leak) and bloats the diagnostics marker loop,
    // which iterates every model on each diagnostics event. Dispose the model of
    // a document that is no longer open so closing a file actually frees it.
    //
    // The "keep alive" set is the live open document paths for the active
    // workspace plus the active document's path as defence-in-depth: the active
    // model is never disposed out from under the editor, and a document still
    // open in another tab/split keeps its path in openDocumentPaths so its model
    // survives. The placeholder model (shown when no document is open) is kept
    // because Monaco is currently displaying it.
    //
    // Navigation history paths (back + forward stacks) are also kept alive:
    // go-to-definition turns the source file into a clean-preview replacement,
    // so its path leaves openDocumentPaths even though Back/Forward still
    // navigates to it. Without this, the source model would be disposed and Back
    // would force a synchronous dispose+recreate+re-tokenization (lag). Keeping
    // the history models alive makes Back/Forward a cheap model-swap.
    //
    // Workspace isolation falls out for free: openDocumentPaths and
    // navigationHistoryPaths are reset/restored per workspace tab, and paths are
    // workspace-scoped, so only the closing document's (or closing workspace's)
    // models are disposed. A file that is neither open nor in navigation history
    // is still disposed, preserving the leak fix.
    const keepAlivePaths = new Set([
      ...openDocumentPaths,
      ...navigationHistoryPaths,
      PLACEHOLDER_PATH,
    ]);

    if (activeDocument) {
      keepAlivePaths.add(activeDocument.path);
    }

    monacoApi.editor.getModels().forEach((model) => {
      const path = modelPath(model);

      if (!path || keepAlivePaths.has(path)) {
        return;
      }

      model.dispose();
    });
  }, [activeDocument, monacoApi, navigationHistoryPaths, openDocumentPaths]);

  useEffect(() => {
    if (!activeDocument || !editorApi || !monacoApi) {
      return;
    }

    const model = editorApi.getModel();

    if (!model || modelPath(model) !== activeDocument.path) {
      return;
    }

    const languageServerDiagnostics =
      languageServerDiagnosticsByPath[activeDocument.path] ?? [];
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
    // Re-key on the active document's *path* + *language* (stable strings), not
    // its object identity. `activeDocument` gets a fresh `{ ...doc, content }`
    // on every keystroke, which re-mapped every diagnostic and re-ran
    // deltaDecorations per character typed even though the diagnostics were
    // unchanged. The decorations are derived purely from the diagnostics maps
    // keyed by path, so real changes are covered by the diagnostics deps and a
    // file switch is covered by the path/language keys.
  }, [
    activeDocument?.path,
    activeDocument?.language,
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

  const breadcrumbSymbols = activeDocument
    ? breadcrumbSymbolsByPath[activeDocument.path] ?? EMPTY_BREADCRUMB_SYMBOLS
    : EMPTY_BREADCRUMB_SYMBOLS;
  // Recomputed only when the cursor actually moves (line OR column) or the
  // symbols change, so a re-render that leaves all three stable hands the same
  // path array to the memo'd Breadcrumbs and skips its render. Keyed on the raw
  // line/column rather than the cursorPosition object so the gate above does not
  // need to share identity for the memo to hold.
  const breadcrumbPath = useMemo(
    () =>
      activeDocument && cursorPosition
        ? breadcrumbPathFromCursorAndSymbols(cursorPosition, breadcrumbSymbols)
        : EMPTY_BREADCRUMB_PATH,
    [
      activeDocument,
      breadcrumbSymbols,
      cursorPosition?.lineNumber,
      cursorPosition?.column,
    ],
  );

  const navigateToBreadcrumbSymbol = useCallback(
    (symbol: LanguageServerDocumentSymbol) => {
      if (!editorApi) {
        return;
      }

      const position: EditorPosition = {
        lineNumber: symbol.selectionRange.start.line + 1,
        column: symbol.selectionRange.start.character + 1,
      };

      editorApi.setPosition(position);
      editorApi.revealPositionInCenter(position);
      editorApi.focus();
    },
    [editorApi],
  );

  const changePreviewStyle =
    activeDocument && changePreview && editorApi
      ? editorChangePopoverStyle(
          editorApi,
          changePreview.hunk,
          changePreview.anchorLineNumber,
        )
      : undefined;

  // The Monaco editor stays mounted at all times so switching files only swaps
  // the model (path/value) instead of unmounting/remounting Monaco — which would
  // re-run its initialization and flash a blank surface (VS Code never does
  // this). When no document is open we feed Monaco a stable placeholder model
  // and cover it with an overlay, instead of replacing the editor with a plain
  // div.
  const isReadOnly = activeDocument?.readOnly === true;

  // Stable handler identity for the wrapped @monaco-editor/react Editor. It reads
  // the latest parent onChange through a ref so the Editor never receives a fresh
  // reference (which would dispose/recreate its model-content listener on every
  // re-render) while still routing to the current handler (no stale closure).
  const handleEditorChange = useCallback((value: string | undefined) => {
    onChangeRef.current(value || "");
  }, []);

  // beforeMount only depends on the theme, so a cursor move keeps the same
  // reference and never re-runs Monaco's first-frame theme/feature setup.
  const handleBeforeMount = useCallback(
    (monaco: typeof Monaco) => beforeMonacoMount(monaco, monacoTheme),
    [monacoTheme],
  );

  // The Editor options object is rebuilt ONLY when a value Monaco actually reads
  // changes (read-only/format-on-paste flags and the three font settings). Every
  // other option is a static literal. Holding the identity stable across cursor
  // moves keeps @monaco-editor/react's memo intact, so it stops calling
  // editor.updateOptions (deep clone + ~170 comparisons) on each cursor event,
  // while a genuine settings/font change still recomputes and is applied.
  const editorOptions = useMemo<Monaco.editor.IStandaloneEditorConstructionOptions>(
    () => ({
      autoIndent: "full",
      automaticLayout: true,
      bracketPairColorization: { enabled: true },
      detectIndentation: true,
      domReadOnly: isReadOnly,
      formatOnPaste,
      fontFamily: editorFontFamily,
      fontLigatures: monacoFontLigatures,
      fontSize: editorFontSize,
      glyphMargin: true,
      insertSpaces: true,
      // Skip memory- and CPU-intensive features (including per-line
      // tokenization) on extreme lines. Monaco's default, kept explicit so the
      // scroll-performance guards live together.
      largeFileOptimizations: true,
      lineHeight: 20,
      // Lines longer than this are not tokenized. Monaco tokenizes the visible
      // viewport synchronously while scrolling, so a viewport full of very long
      // lines blows the frame budget and makes fast scrolling lag. Mirrors the
      // Shiki `tokenizeMaxLineLength` cap so both tokenization paths agree.
      maxTokenizationLineLength: 2000,
      minimap: { enabled: false },
      // Cmd/Ctrl is the multi-cursor modifier (VS Code parity), which frees Alt
      // so Alt+drag does box/column selection. Add a cursor with Cmd/Ctrl+Click
      // and toggle persistent column-selection mode with the
      // `editor.toggleColumnSelection` action below.
      multiCursorModifier: "ctrlCmd",
      padding: { top: 14, bottom: 14 },
      parameterHints: { enabled: true, cycle: true },
      quickSuggestions: { other: true, comments: false, strings: true },
      quickSuggestionsDelay: 10,
      readOnly: isReadOnly,
      scrollBeyondLastLine: false,
      "semanticHighlighting.enabled": true,
      // Smooth scrolling animates every fling into many onDidScrollChange
      // events, each driving a synchronous viewport tokenization pass. Disabling
      // it keeps fast scrolling of large files responsive (trade-off: the scroll
      // animation is gone, but the lag is too).
      smoothScrolling: false,
      stickyScroll: { enabled: true },
      // Stop rendering a line after this many characters. Monaco's default, kept
      // explicit alongside the other large-file scroll guards.
      stopRenderingLineAfter: 10000,
      suggestOnTriggerCharacters: true,
      tabSize: 2,
    }),
    [
      editorFontFamily,
      editorFontSize,
      formatOnPaste,
      isReadOnly,
      monacoFontLigatures,
    ],
  );

  const overlay = activeDocument ? null : isOpeningFile ? (
    <div className="editor-empty-overlay" data-testid="editor-opening">
      <p>Opening file…</p>
    </div>
  ) : (
    <div className="editor-empty-overlay" data-testid="editor-empty">
      <p>Open a file to start editing.</p>
    </div>
  );

  return (
    <div
      aria-labelledby={activeDocument ? getTabId(activeDocument.path) : undefined}
      className="editor-panel"
      id={activeDocument ? getTabPanelId(activeDocument.path) : undefined}
      onFocusCapture={onEditorFocused}
      onMouseDown={onEditorFocused}
      role="tabpanel"
    >
      {activeDocument ? (
        <Breadcrumbs
          fileName={activeDocument.name}
          onNavigate={navigateToBreadcrumbSymbol}
          path={breadcrumbPath}
        />
      ) : null}
      <Editor
        beforeMount={handleBeforeMount}
        height="100%"
        language={activeDocument ? activeDocument.language : PLACEHOLDER_LANGUAGE}
        loading={EDITOR_LOADING_PLACEHOLDER}
        onChange={handleEditorChange}
        onMount={handleMount}
        options={editorOptions}
        path={activeDocument ? activeDocument.path : PLACEHOLDER_PATH}
        theme={monacoTheme}
        value={activeDocument ? activeDocument.content : ""}
      />
      {overlay}
      {activeDocument && changePreview ? (
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
      <SurroundWithPicker
        isOpen={surroundWithRequest !== null}
        onClose={() => {
          setSurroundWithRequest(null);
          editorApi?.focus();
        }}
        onSelect={(templateId) => {
          if (surroundWithRequest && editorApi && monacoApi) {
            applySurroundWith(
              monacoApi,
              editorApi,
              surroundWithRequest,
              templateId,
            );
          }

          setSurroundWithRequest(null);
        }}
      />
    </div>
  );
}

// IDE events (index progress, runtime status, …) re-render App without touching
// the editor's props. memo lets the surface skip those renders, re-rendering
// only when one of its props actually changes (active document, diagnostics, …).
export const EditorSurface = memo(EditorSurfaceComponent);

function editorActionForMenuCommand(command: EditorMenuCommand): string {
  switch (command) {
    case "copy":
      return "editor.action.clipboardCopyAction";
    case "cut":
      return "editor.action.clipboardCutAction";
    case "paste":
      return "editor.action.clipboardPasteAction";
    case "redo":
      return "redo";
    case "selectAll":
      return "editor.action.selectAll";
    case "undo":
      return "undo";
  }
}

// The selection context captured when the Surround With quick-pick opens. It is
// snapshotted up front so the wrap is always applied to the exact range the
// developer triggered the command on, even if focus moves to the picker.
interface SurroundWithRequest {
  eol: string;
  indent: string;
  indentUnit: string;
  // Absolute path of the document the request was captured on. The apply path
  // re-checks it against the live model so a wrap can never land on another tab.
  path: string;
  selection: {
    endColumn: number;
    endLineNumber: number;
    startColumn: number;
    startLineNumber: number;
  };
  text: string;
}

// Snapshots the active selection (or the current line when the selection is
// empty) along with the document's indentation settings, so the chosen template
// can be applied later from the picker without re-reading editor state.
function surroundWithRequestFromEditor(
  monaco: typeof Monaco,
  editor: Monaco.editor.IStandaloneCodeEditor,
): SurroundWithRequest | null {
  const model = editor.getModel();
  const selection = editor.getSelection();

  if (!model || !selection) {
    return null;
  }

  const path = modelPath(model);

  if (!path) {
    return null;
  }

  const range = surroundWithTargetRange(monaco, model, selection);
  const firstLine = model.getLineContent(range.startLineNumber);
  const indent = leadingWhitespace(firstLine);
  const text = dedentSurroundWithText(model.getValueInRange(range), indent);

  return {
    eol: model.getEOL(),
    indent,
    indentUnit: indentUnitFromModel(model),
    path,
    selection: {
      endColumn: range.endColumn,
      endLineNumber: range.endLineNumber,
      startColumn: range.startColumn,
      startLineNumber: range.startLineNumber,
    },
    text,
  };
}

// Removes the wrapper's base indentation from every captured line so the helper
// re-indents the body relative to the new block. The relative indentation
// between body lines is preserved because only the shared leading prefix is
// stripped.
function dedentSurroundWithText(text: string, indent: string): string {
  if (indent.length === 0) {
    return text;
  }

  return text
    .split(/\r\n|\r|\n/)
    .map((line) => (line.startsWith(indent) ? line.slice(indent.length) : line))
    .join("\n");
}

// Expands an empty selection to cover the whole current line so the developer
// can surround a line without first selecting it (PhpStorm behaviour). A real
// selection is normalised to a full-line range at both ends so the replacement
// snippet's own indentation is authoritative.
function surroundWithTargetRange(
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel,
  selection: Monaco.Selection,
): Monaco.Range {
  const startLineNumber = Math.min(
    selection.startLineNumber,
    selection.endLineNumber,
  );
  const endLineNumber = Math.max(
    selection.startLineNumber,
    selection.endLineNumber,
  );

  return new monaco.Range(
    startLineNumber,
    1,
    endLineNumber,
    model.getLineMaxColumn(endLineNumber),
  );
}

function indentUnitFromModel(model: Monaco.editor.ITextModel): string {
  const options = model.getOptions();

  if (!options.insertSpaces) {
    return "\t";
  }

  const size = options.indentSize || options.tabSize || 4;
  return " ".repeat(size);
}

// Joins every line above the caret line into a single source string. The
// completion analyser uses it to detect when the caret is nested inside a
// multiline construct (an array, call or block opened earlier) so it can stay a
// no-op instead of corrupting the enclosing statement.
function precedingLinesSource(
  model: Monaco.editor.ITextModel,
  lineNumber: number,
): string {
  if (lineNumber <= 1) {
    return "";
  }

  const lines: string[] = [];

  for (let line = 1; line < lineNumber; line += 1) {
    lines.push(model.getLineContent(line));
  }

  return `${lines.join("\n")}\n`;
}

// Moves the whole statement (or brace block) under the caret up or down past its
// adjacent statement (PhpStorm Cmd+Shift+Up / Down). The pure analyser computes a
// balanced line range swap; when it declines (ambiguous, file edge, multi-line
// fragment) this returns false so the caller falls back to Monaco's Move Line.
// Returns true only when an edit was applied to the live model.
function applyMoveStatement(
  monaco: typeof Monaco,
  editor: Monaco.editor.IStandaloneCodeEditor,
  direction: MoveStatementDirection,
): boolean {
  const model = editor.getModel();
  const position = editor.getPosition();

  if (!model || !position) {
    return false;
  }

  const edit = phpMoveStatement(
    model.getValue(),
    position.lineNumber,
    direction,
  );

  if (!edit) {
    return false;
  }

  const range = new monaco.Range(
    edit.startLine,
    1,
    edit.endLine,
    model.getLineMaxColumn(edit.endLine),
  );

  editor.executeEdits("mockor.moveStatement", [
    {
      forceMoveMarkers: true,
      range,
      text: edit.newText,
    },
  ]);
  editor.setPosition({
    column: position.column,
    lineNumber: clampLine(model, edit.caretLine),
  });
  editor.focus();

  return true;
}

function clampLine(
  model: Monaco.editor.ITextModel,
  lineNumber: number,
): number {
  if (lineNumber < 1) {
    return 1;
  }

  const lineCount = model.getLineCount();

  return lineNumber > lineCount ? lineCount : lineNumber;
}

// Completes the statement on the caret's line (PhpStorm Cmd+Shift+Enter): the
// pure analyser decides the smallest safe edit, then it is applied to the live
// model. A `replaceLine` result rewrites the line and parks the caret at the
// reported column; an `insertBlock` result opens a brace block whose body holds
// the caret (via the snippet controller's `$0` tab-stop where available).
function applyCompleteStatement(
  monaco: typeof Monaco,
  editor: Monaco.editor.IStandaloneCodeEditor,
): void {
  const model = editor.getModel();
  const position = editor.getPosition();

  if (!model || !position) {
    return;
  }

  const lineNumber = position.lineNumber;
  const lineText = model.getLineContent(lineNumber);
  const precedingSource = precedingLinesSource(model, lineNumber);
  const completion = completePhpStatement(
    lineText,
    position.column,
    precedingSource,
  );

  if (!completion) {
    return;
  }

  const lineRange = new monaco.Range(
    lineNumber,
    1,
    lineNumber,
    model.getLineMaxColumn(lineNumber),
  );

  if (completion.kind === "replaceLine") {
    editor.executeEdits("mockor.completeStatement", [
      {
        forceMoveMarkers: true,
        range: lineRange,
        text: completion.newText,
      },
    ]);
    editor.setPosition({ column: completion.caretColumn, lineNumber });
    editor.focus();
    return;
  }

  insertStatementBlock(monaco, editor, model, completion, lineRange);
}

// Replaces the control header line with `<header> {`, a blank indented body
// line, and a closing brace, leaving the caret inside the body. The snippet
// controller is preferred so the body tab-stop is real; the fallback computes
// the caret position itself so the command still works without the controller.
function insertStatementBlock(
  monaco: typeof Monaco,
  editor: Monaco.editor.IStandaloneCodeEditor,
  model: Monaco.editor.ITextModel,
  completion: { indent: string; keepHeader: string },
  lineRange: Monaco.Range,
): void {
  const eol = model.getEOL();
  const unit = indentUnitFromModel(model);
  const bodyIndent = completion.indent + unit;
  const snippetController = editor.getContribution<SnippetInsertingContribution>(
    "snippetController2",
  );

  if (snippetController) {
    editor.setSelection(
      new monaco.Selection(
        lineRange.startLineNumber,
        lineRange.startColumn,
        lineRange.endLineNumber,
        lineRange.endColumn,
      ),
    );
    snippetController.insert(
      `${escapeStatementSnippet(completion.keepHeader)}${eol}${escapeStatementSnippet(bodyIndent)}$0${eol}${escapeStatementSnippet(completion.indent)}}`,
    );
    editor.focus();
    return;
  }

  const text = `${completion.keepHeader}${eol}${bodyIndent}${eol}${completion.indent}}`;

  editor.executeEdits("mockor.completeStatement", [
    {
      forceMoveMarkers: true,
      range: lineRange,
      text,
    },
  ]);
  editor.setPosition({
    column: bodyIndent.length + 1,
    lineNumber: lineRange.startLineNumber + 1,
  });
  editor.focus();
}

// Escapes the snippet meta-characters so literal header / indentation text is
// reproduced verbatim around the body's `$0` tab-stop.
function escapeStatementSnippet(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\$/g, "\\$").replace(/}/g, "\\}");
}

// Replaces the captured range with the wrapped block, inserting it through the
// snippet controller so the placeholders become tab-stops the developer can tab
// through (condition / loop variables first, then the body / catch clause).
function applySurroundWith(
  monaco: typeof Monaco,
  editor: Monaco.editor.IStandaloneCodeEditor,
  request: SurroundWithRequest,
  templateId: SurroundWithTemplateId,
): void {
  const model = editor.getModel();

  // The picker may outlive a tab switch; never apply a wrap captured on one
  // document to a different one that is now active in this reused surface.
  if (!model || modelPath(model) !== request.path) {
    return;
  }

  const snippet = surroundWithSnippet({
    eol: request.eol,
    id: templateId,
    indent: request.indent,
    indentUnit: request.indentUnit,
    text: request.text,
  });

  editor.focus();
  editor.setSelection(
    new monaco.Selection(
      request.selection.startLineNumber,
      request.selection.startColumn,
      request.selection.endLineNumber,
      request.selection.endColumn,
    ),
  );

  const snippetController = editor.getContribution<SnippetInsertingContribution>(
    "snippetController2",
  );

  if (snippetController) {
    snippetController.insert(snippet);
    return;
  }

  editor.executeEdits("mockor.surroundWith", [
    {
      forceMoveMarkers: true,
      range: new monaco.Range(
        request.selection.startLineNumber,
        request.selection.startColumn,
        request.selection.endLineNumber,
        request.selection.endColumn,
      ),
      text: plainSnippetText(snippet),
    },
  ]);
}

// Renders a Monaco snippet as the literal text it represents, for the rare
// fallback path where the snippet controller is unavailable. Placeholders
// (`${1:default}`) collapse to their default text, the final caret stop (`$0`)
// is dropped, and the snippet escaping applied in `surroundWithSnippet`
// (`\` -> `\\`, `$` -> `\$`, `}` -> `\}`) is reversed so the body text is
// inserted verbatim instead of carrying stray backslashes (e.g. `\$total`).
//
// The placeholder / caret strips only match structural markers that are NOT
// preceded by a backslash. Body characters are always escaped by
// `surroundWithSnippet`, so a literal `$0` or `${1:...}` inside the selected
// text appears as `\$0` / `\${1:...}` and is left untouched by the strips, then
// un-escaped back to its literal form by the final pass.
function plainSnippetText(snippet: string): string {
  return snippet
    .replace(/(?<!\\)\$\{\d+:((?:\\.|[^}])*)\}/g, "$1")
    .replace(/(?<!\\)\$0/g, "")
    .replace(/\\([$}\\])/g, "$1");
}

interface SnippetInsertingContribution extends Monaco.editor.IEditorContribution {
  insert(template: string): void;
}

// Runs a built-in Monaco editor action by id, so an ergonomics command (move /
// duplicate / delete line, multi-cursor) registered through the keymap drives
// the exact same Monaco behaviour as its native keybinding. Guarded on a live
// model so the action is a no-op when the surface shows the placeholder.
function triggerEditorAction(
  editor: Monaco.editor.IStandaloneCodeEditor,
  actionId: string,
): void {
  if (!editor.getModel()) {
    return;
  }

  editor.trigger("keyboard", actionId, {});
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
  const nextRange = nextEditorSelectionExpansionRange(
    line,
    position.column - 1,
    currentRange,
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
): EditorSelectionTextRange {
  if (!selection || selection.startLineNumber !== selection.endLineNumber) {
    const offset = Math.max(0, position.column - 1);
    return { end: offset, start: offset };
  }

  return {
    end: Math.max(selection.startColumn, selection.endColumn) - 1,
    start: Math.min(selection.startColumn, selection.endColumn) - 1,
  };
}

// Shared stable empty path list for the optional path-set props. A fresh `[]`
// default would change identity on every render, re-running the model-dispose
// effect (which depends on these arrays) on internal re-renders and risking a
// double-dispose. The single frozen identity keeps the effect quiet until the
// caller actually changes the path set.
const EMPTY_PATHS: readonly string[] = Object.freeze([]);
const EMPTY_BOOKMARK_LINES: readonly number[] = Object.freeze([]);
// Stable empty identities so an absent breadcrumb symbol set / path does not
// produce a fresh array each render and break the breadcrumb path memo.
const EMPTY_BREADCRUMB_SYMBOLS: LanguageServerDocumentSymbol[] = [];
const EMPTY_BREADCRUMB_PATH: LanguageServerDocumentSymbol[] = [];

// Stable placeholder model identity used while no document is open, so Monaco
// keeps a single mounted instance instead of remounting when the first file
// opens.
const PLACEHOLDER_PATH = "inmemory://workbench/empty";
const PLACEHOLDER_LANGUAGE = "plaintext";

// Rendered via the Monaco `loading` prop. Monaco's default loading element is a
// white "Loading…" box; this matches the editor surface background so the very
// first Monaco chunk load does not flash white.
function EditorLoadingPlaceholder() {
  return <div className="editor-loading-placeholder" aria-hidden="true" />;
}

// A single stable element identity for Monaco's `loading` prop. Recreating it on
// every render would feed @monaco-editor/react a fresh reference and break its
// memo, defeating the cursor-move stabilisation below.
const EDITOR_LOADING_PLACEHOLDER = <EditorLoadingPlaceholder />;

// Returns the previous cursor position unchanged when the incoming position is
// identical, so a duplicate Monaco cursor event (e.g. clicking the current spot)
// preserves referential identity and skips a re-render. A real move on either
// line or column produces a fresh object so breadcrumbs (keyed on line+column)
// stay correct.
function nextCursorPosition(
  previous: EditorPosition | null,
  next: EditorPosition,
): EditorPosition {
  if (
    previous &&
    previous.lineNumber === next.lineNumber &&
    previous.column === next.column
  ) {
    return previous;
  }

  return { column: next.column, lineNumber: next.lineNumber };
}

function beforeMonacoMount(monaco: typeof Monaco, theme: MonacoAppTheme): void {
  // Apply a matching built-in dark/light theme synchronously so Monaco paints
  // the correct background on its first frame. Without this, Monaco renders the
  // default white `vs` theme until the async Shiki setup below resolves and
  // calls `setTheme`, producing a white flash on dark themes.
  applyImmediateFallbackTheme(monaco, theme);
  configureTypescriptJavascriptDefaults(monaco);
  configureShikiLanguageFeatures(monaco);
  setupEmmet(monaco);
  setupShikiTokenization(monaco, theme).catch((error) => {
    console.error("Shiki tokenization setup failed", error);
  });
}

function isJavaScriptTypeScriptRuntimeActiveForWorkspace(
  status: LanguageServerRuntimeStatus | null,
  workspaceRoot: string | null,
): boolean {
  return (
    status?.kind === "running" &&
    Boolean(workspaceRoot) &&
    Boolean(status.rootPath) &&
    workspaceRootKeysEqual(status.rootPath, workspaceRoot)
  );
}

function isTypescriptJavascriptDocument(
  document: EditorDocument | null,
): boolean {
  return (
    document?.language === "typescript" ||
    document?.language === "javascript"
  );
}

function isSmartBlankLineIndentDocument(document: EditorDocument): boolean {
  return (
    document.language === "php" ||
    document.language === "blade" ||
    document.language === "javascript" ||
    document.language === "typescript"
  );
}

function smartBlankLineIndent(
  model: Monaco.editor.ITextModel,
  lineNumber: number,
): string | null {
  const line = model.getLineContent(lineNumber);

  if (line.trim().length > 0) {
    return null;
  }

  const previousLine = lineNumber > 1 ? model.getLineContent(lineNumber - 1) : "";
  const previousLineIndent = leadingWhitespace(previousLine);

  if (
    previousLine.length > 0 &&
    previousLine.trim().length === 0 &&
    previousLineIndent.length > 0
  ) {
    return previousLineIndent;
  }

  const previous = nearestNonEmptyLine(model, lineNumber, -1);

  if (!previous) {
    return null;
  }

  const previousIndent = leadingWhitespace(previous.content);

  if (opensIndentedBlock(previous.content)) {
    return previousIndent + indentationUnitNear(model, lineNumber, previousIndent);
  }

  return previousIndent;
}

function smartBlankLineIndentTargetLineNumber(
  changes: readonly SmartIndentContentChange[],
  fallbackLineNumber: number,
): number {
  const newLineChange = changes.find((change) => change.text.includes("\n"));

  if (!newLineChange?.range) {
    return fallbackLineNumber;
  }

  return (
    newLineChange.range.startLineNumber + countOccurrences(newLineChange.text, "\n")
  );
}

interface SmartIndentContentChange {
  range?: {
    startLineNumber: number;
  };
  text: string;
}

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

function nearestNonEmptyLine(
  model: Monaco.editor.ITextModel,
  lineNumber: number,
  direction: -1 | 1,
): { content: string; lineNumber: number } | null {
  const lineCount = model.getLineCount();

  for (
    let candidate = lineNumber + direction;
    candidate >= 1 && candidate <= lineCount;
    candidate += direction
  ) {
    const content = model.getLineContent(candidate);

    if (content.trim().length > 0) {
      return {
        content,
        lineNumber: candidate,
      };
    }
  }

  return null;
}

function indentationUnitNear(
  model: Monaco.editor.ITextModel,
  lineNumber: number,
  baseIndent: string,
): string {
  const next = nearestNonEmptyLine(model, lineNumber, 1);

  if (next) {
    const nextIndent = leadingWhitespace(next.content);

    if (nextIndent.startsWith(baseIndent) && nextIndent.length > baseIndent.length) {
      return nextIndent.slice(baseIndent.length);
    }
  }

  const lineCount = model.getLineCount();

  for (let candidate = 1; candidate < lineCount; candidate += 1) {
    const currentIndent = leadingWhitespace(model.getLineContent(candidate));
    const nextIndent = leadingWhitespace(model.getLineContent(candidate + 1));

    if (nextIndent.startsWith(currentIndent) && nextIndent.length > currentIndent.length) {
      return nextIndent.slice(currentIndent.length);
    }
  }

  return "  ";
}

function leadingWhitespace(value: string): string {
  return /^\s*/.exec(value)?.[0] ?? "";
}

function opensIndentedBlock(value: string): boolean {
  const trimmed = value.trimEnd();

  return /(?:\{|\[|\(|=>)\s*(?:\/\/.*)?$/.test(trimmed);
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

function toBookmarkDecoration(
  monaco: typeof Monaco,
  lineNumber: number,
): Monaco.editor.IModelDeltaDecoration {
  return {
    options: {
      isWholeLine: true,
      linesDecorationsClassName: "bookmark-gutter-glyph",
      overviewRuler: {
        color: "#f0a73a",
        position: monaco.editor.OverviewRulerLane.Right,
      },
      stickiness:
        monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      zIndex: 10,
    },
    range: new monaco.Range(lineNumber, 1, lineNumber, 1),
  };
}

function toGitBlameDecoration(
  monaco: typeof Monaco,
  line: GitBlameLine,
  now: number,
): Monaco.editor.IModelDeltaDecoration {
  const annotation = gitBlameAnnotation(line, now);

  return {
    options: {
      before: {
        content: annotation,
        // A non-breaking space pads the annotation from the code without
        // injecting selectable spaces into the document text.
        inlineClassName: "git-blame-annotation",
      },
      // Full commit detail on hover (short SHA + author + relative date), the
      // PhpStorm annotation tooltip equivalent.
      hoverMessage: {
        value: `\`${line.sha}\` ${annotation}`,
      },
      stickiness:
        monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
    },
    range: new monaco.Range(line.lineNumber, 1, line.lineNumber, 1),
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
  const range = diagnosticRange(diagnostic);

  const marker: Monaco.editor.IMarkerData & { data?: unknown } = {
    code: diagnosticCode(monaco, diagnostic),
    endColumn: range.endCharacter + 1,
    endLineNumber: range.endLine + 1,
    message: diagnostic.message,
    severity: diagnosticSeverity(monaco, diagnostic),
    source: diagnostic.source || "Language Server",
    startColumn: range.character + 1,
    startLineNumber: range.line + 1,
    tags: diagnosticTags(monaco, diagnostic.tags ?? []),
    relatedInformation: diagnosticRelatedInformation(monaco, diagnostic),
  };

  if ("data" in diagnostic) {
    marker.data = diagnostic.data;
  }

  return marker;
}

function diagnosticCode(
  monaco: typeof Monaco,
  diagnostic: LanguageServerDiagnostic,
): Monaco.editor.IMarkerData["code"] {
  if (diagnostic.code === null || typeof diagnostic.code === "undefined") {
    return undefined;
  }

  const value = String(diagnostic.code);

  if (!diagnostic.codeDescriptionHref) {
    return value;
  }

  return {
    target: monaco.Uri.parse(diagnostic.codeDescriptionHref),
    value,
  };
}

function toDiagnosticOverviewDecoration(
  monaco: typeof Monaco,
  diagnostic: LanguageServerDiagnostic,
): Monaco.editor.IModelDeltaDecoration {
  const range = diagnosticRange(diagnostic);

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
      range.line + 1,
      range.character + 1,
      range.endLine + 1,
      range.endCharacter + 1,
    ),
  };
}

function diagnosticRange(diagnostic: LanguageServerDiagnostic): {
  character: number;
  endCharacter: number;
  endLine: number;
  line: number;
} {
  return {
    character: diagnostic.character,
    endCharacter: diagnostic.endCharacter ?? diagnostic.character + 1,
    endLine: diagnostic.endLine ?? diagnostic.line,
    line: diagnostic.line,
  };
}

function diagnosticRelatedInformation(
  monaco: typeof Monaco,
  diagnostic: LanguageServerDiagnostic,
): Monaco.editor.IMarkerData["relatedInformation"] {
  return diagnostic.relatedInformation?.map((info) => {
    const range = diagnosticRange({
      character: info.character,
      endCharacter: info.endCharacter,
      endLine: info.endLine,
      line: info.line,
      message: info.message,
      severity: diagnostic.severity,
      source: diagnostic.source,
    });

    return {
      message: info.message,
      resource: monaco.Uri.parse(info.uri),
      startColumn: range.character + 1,
      startLineNumber: range.line + 1,
      endColumn: range.endCharacter + 1,
      endLineNumber: range.endLine + 1,
    };
  });
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

function diagnosticTags(
  monaco: typeof Monaco,
  tags: number[],
): Monaco.MarkerTag[] | undefined {
  const markerTags = tags.flatMap((tag) => {
    if (tag === 1) {
      return [monaco.MarkerTag.Unnecessary];
    }

    if (tag === 2) {
      return [monaco.MarkerTag.Deprecated];
    }

    return [];
  });

  return markerTags.length > 0 ? markerTags : undefined;
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

function pruneClosedPaths<Value>(
  cache: Record<string, Value>,
  openPaths: Set<string>,
): Record<string, Value> {
  const stalePaths = Object.keys(cache).filter((path) => !openPaths.has(path));

  if (stalePaths.length === 0) {
    return cache;
  }

  const next = { ...cache };
  stalePaths.forEach((path) => delete next[path]);
  return next;
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

function breadcrumbFeaturesGateway(
  document: EditorDocument,
  gateways: {
    javaScriptTypeScript: LanguageServerFeaturesGateway;
    php: LanguageServerFeaturesGateway;
  },
): LanguageServerFeaturesGateway | null {
  if (isJavaScriptTypeScriptLanguageServerDocument(document)) {
    return gateways.javaScriptTypeScript;
  }

  if (isLanguageServerDocument(document)) {
    return gateways.php;
  }

  return null;
}

function monacoKeybindingsForShortcut(
  monaco: typeof Monaco,
  shortcut: string,
  platform: KeymapPlatform,
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
  const primaryModifier =
    platform === "mac" ? parsed.meta : parsed.meta || parsed.ctrl;
  const controlModifier = platform === "mac" ? parsed.ctrl : false;

  if (primaryModifier) {
    keybinding |= monaco.KeyMod.CtrlCmd;
  }

  if (controlModifier) {
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
