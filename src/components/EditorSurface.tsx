import type { OnMount } from "@monaco-editor/react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useId,
} from "react";
import type * as Monaco from "monaco-editor";
import type { EditorChangeHunk } from "../domain/editorChangeMarkers";
import type { CommandContext, CommandExecutionRunner } from "../application/commandRegistry";
import { useNpmRunSelectedScriptMonacoAction } from "./npmRunSelectedScriptMonacoAction";
import type { NavigationRequest } from "../application/navigationRequest";
import type { PhpCodeActionWorkspaceEditApplier } from "../application/phpCodeActionTypes";
import type { EditorMenuCommandRunner } from "../domain/editorMenuCommand";
import type {
  EditorSurfaceCommandInvocationScope,
  EditorSurfaceCommandRunner,
} from "../domain/editorSurfaceCommand";
import { useEditorSurfaceImportActions } from "./useEditorSurfaceImportActions";
import {
  type IncompleteWorkspaceIdentityDescriptor,
  modelForPath,
  modelMatchesProject,
  resolveCompleteWorkspaceIdentityDescriptor,
} from "./editorSurfaceModelIdentity";
import { currentEditorModelForPath } from "./editorSurfaceLiveModelContentAuthority";
import { createWorkspaceEditorSessionOwnerKey } from "../domain/editorSessionOwnerKey";
import type { EditorCursorStorePort } from "../application/editorCursorStore";
import type { DebugWatchAtCursorCaptureReader } from "../domain/debugWatchAtCursorCapture";
import type { DebugBreakpointNavigationCaptureReader } from "../domain/debugBreakpointNavigationCapture";
import type { DebugInlineBreakpointCaptureReader } from "../domain/debugInlineBreakpointCapture";
import type { DebugEvaluateInConsoleCaptureReader } from "../domain/debugEvaluateInConsoleCapture";
import type {
  EditorSurfaceBufferFixRunner,
  EditorSurfacePhpstanIgnoreRunner,
} from "../application/useWorkbenchCodeQualityDiagnostics";
import type { EditorSurfaceEslintDisableRunner } from "../application/workbenchEslintDisableCommand";
import type { DebugInlineValueContext } from "../application/debugInlineValueContext";
import type { DebugBreakpointManagement } from "../application/useDebugBreakpointManagement";
import type { JsTestExplorerCurrentFileIdentity } from "../domain/jsTestExplorerFilter";
import type { JsTestProblemsSnapshot } from "../domain/jsTestProblems";
import type {
  EditorPosition,
  EditorRevealTarget,
  JavaScriptTypeScriptLanguageServerFeaturesGateway,
  LanguageServerFeaturesGateway,
  LanguageServerRefreshGateway,
  LanguageServerWorkspaceEdit,
  LanguageServerWorkspaceEditGateway,
} from "../domain/languageServerFeatures";
import { BackgroundTokenizer, idleCallbackScheduler } from "../domain/backgroundTokenizer";
import {
  defaultShortcutForCommand,
  detectKeymapPlatform,
  keymapCommandIdsForShortcut,
  shortcutForCommand,
  type KeymapCommandId,
  type KeymapSettings,
} from "../domain/keymap";
import { monacoKeybindingsForShortcut } from "./monacoKeybindings";
import { requestRegisteredCommand, runRegisteredCommand } from "../application/commandChain";
import type { LanguageServerDocumentSymbol } from "../domain/languageServerFeatures";
import {
  defaultLargeSmartDocumentPolicy,
  type LargeSmartDocumentMetrics,
  type LargeSmartDocumentPolicy,
} from "../domain/largeDocumentPolicy";
import { useEditorCursorPublication } from "./useEditorCursorPublication";
import type { HippieSession } from "../domain/hippieCompletion";
import type { Breakpoint } from "../domain/debug";
import type { LanguageServerDiagnostic } from "../domain/languageServerDiagnostics";
import type { GitBlameLine } from "../domain/git";
import type { PhpTestGutterTarget } from "../domain/phpTestGutterTargets";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import type { LatencyOperationKind } from "../domain/latencyTracker";
import type {
  PhpSyntaxDiagnostic,
  PhpSyntaxDiagnosticsGateway,
} from "../domain/phpSyntaxDiagnostics";
import {
  structuralPhpSyntaxDiagnostics,
  suspiciousPhpBareIdentifierDiagnostics,
} from "../domain/phpSyntaxDiagnostics";
import type { PhpInspectionDiagnostic } from "../domain/phpInspections";
import { phpInspectionDiagnostics } from "../domain/phpInspections";
import { useDebouncedPhpEditTick } from "./useDebouncedPhpEditTick";
import type { PhpMethodCompletion, PhpMethodSignature } from "../domain/phpMethodCompletions";
import type { PhpParameterNameInlayHint } from "../domain/phpInlayHints";
import {
  phpMemberAccessCompletionContextAt,
  phpStaticAccessCompletionContextAt,
} from "../domain/phpMethodCompletions";
import { isDirty, type EditorDocument } from "../domain/workspace";
import type { ResolvedEditorConfig } from "../domain/editorConfig";
import type { UserSnippet } from "../domain/snippets";
import {
  defaultEditorFontFamily,
  defaultEditorFontLigatures,
  defaultEditorFontSize,
  monacoFontLigaturesForEditorSetting,
  type MonacoAppTheme,
  type WorkspaceSessionViewState,
} from "../domain/settings";
import { type JavaScriptTypeScriptWorkspaceEditApplicationContext } from "./javascriptTypescriptLanguageServerMonacoProviders";
import { useJavaScriptTypeScriptTransientNavigationModels } from "./javascriptTypescriptMonacoProviderRegistration";
import {
  type LanguageServerMonacoDocumentRequestLease,
  type PhpCodeActionDescriptor,
  type PhpCodeActionNewFile,
  type PhpCodeActionRange,
  type PhpWorkspaceEditApplicationContext,
} from "./languageServerMonacoProviders";
import type { WorkspaceEditApplicationDecision } from "../application/workspaceEditApplication";
import { registerConflictMarkerCodeActions } from "../application/conflictMarkerCodeActions";
import { useConflictMarkerEditorDecorations } from "./useConflictMarkerEditorDecorations";
import type { EditorSurfaceLanguageProviderRegistrationRefs } from "./useEditorSurfaceLanguageProviderRegistration";
import { EditorRuntimeHost, type EditorRuntimeSurfaceRegistration } from "./EditorRuntimeHost";
import { useEditorRuntimeContext } from "./editorRuntimeContext";
import {
  toBoundedDiagnosticOverviewDecorations,
  toMonacoDiagnosticMarker,
} from "./editorDiagnosticMonacoMappings";
import {
  applyLocalPhpValidationSnapshot,
  localPhpDiagnosticsFromVisibleMarkers,
} from "./editorLocalPhpValidation";

import { clampNumber } from "./editorChangeMonacoMappings";
import type { EditorSurfaceCoverageProps } from "./useEditorSurfaceCoverageDecorations";
import { useEditorBreakpointDecorations } from "./useEditorBreakpointDecorations";
import { useEditorRuntimeDecorations } from "./useEditorRuntimeDecorations";
import { isLargeSmartModel } from "./editorSurfaceModelGuards";
import type { EditorRuntimeMembershipInput } from "./editorRuntimeMembership";
import {
  useEditorSurfaceFrameworkProviderRefs,
  type EditorSurfaceFrameworkIntelligenceProviders,
} from "./useEditorSurfaceFrameworkProviderRefs";
import {
  type EditorQaDefinitionRequest,
  type EditorQaOpenWorkspaceFileRequest,
  editorQaBridgeEnabled,
  installEditorQaBridge,
} from "./editorQaBridge";
import { loadJsonSchemaForDocument } from "../infrastructure/jsonSchemaLoader";
import {
  modelMatchesWorkspacePath,
  type WorkspaceIdentityDescriptor,
} from "./phpMonacoDocumentContext";
import {
  applyCompleteStatement,
  applyCyclicExpandWord,
  applyMoveStatement,
  expandEditorSelection,
  surroundWithRequestFromEditor,
  triggerEditorAction,
  triggerEditorSurfaceCommand,
  type SurroundWithRequest,
} from "./editorSurfaceCore/editorCommands";
import {
  EMPTY_BOOKMARK_LINES,
  EMPTY_BREADCRUMB_SYMBOLS,
  EMPTY_BREAKPOINTS,
  EMPTY_PATHS,
  EMPTY_USER_SNIPPETS,
  noopLocalPhpDiagnosticsChange,
} from "./editorSurfaceCore/presentation";
import { useSynchronizedRef } from "./editorSurfaceCore/useSynchronizedRef";
import { useEditorPresentationBindings } from "./editorSurfaceCore/useEditorPresentationBindings";
import { useBackgroundTokenizationLifecycle } from "./editorSurfaceCore/useBackgroundTokenizationLifecycle";
import { useEditorModelViewStateLifecycle } from "./editorSurfaceCore/useEditorModelViewStateLifecycle";
import { useEditorSurfaceCommandPublications } from "./editorSurfaceCore/useEditorSurfaceCommandPublications";
import { useEditorDebugCaptureReaders } from "./editorSurfaceCore/useEditorDebugCaptureReaders";
import { useEditorDiagnosticFixRunners } from "./editorSurfaceCore/useEditorDiagnosticFixRunners";
import { useEditorSourceControlDecorations } from "./editorSurfaceCore/useEditorSourceControlDecorations";
import { useEditorGutterDecorations } from "./editorSurfaceCore/useEditorGutterDecorations";
import { useEditorNavigationLifecycle } from "./editorSurfaceCore/useEditorNavigationLifecycle";
import { useEditorBreadcrumbLifecycle } from "./editorSurfaceCore/useEditorBreadcrumbLifecycle";
import { useEditorInputLifecycle } from "./editorSurfaceCore/useEditorInputLifecycle";
import { useEditorActiveModelLifecycle } from "./editorSurfaceCore/useEditorActiveModelLifecycle";
import { useEditorModelCachePruning } from "./editorSurfaceCore/useEditorModelCachePruning";
import {
  configuredF12NeedsNativeDefinition,
  useEditorDefinitionNavigation,
} from "./editorSurfaceCore/useEditorDefinitionNavigation";
import {
  type EditorChangePreviewState,
  useEditorMouseInteractions,
} from "./editorSurfaceCore/useEditorMouseInteractions";
import { useLargeSmartDocumentMetricsLifecycle } from "./editorSurfaceCore/useLargeSmartDocumentMetricsLifecycle";
import { useEditorSurfacePresentation } from "./editorSurfaceCore/useEditorSurfacePresentation";
import {
  useChangePreviewEscapeLifecycle,
  useEditorChangeDecorations,
} from "./editorSurfaceCore/useEditorChangePresentationLifecycle";

export interface EditorSurfaceProps extends EditorSurfaceCoverageProps {
  activeDocument: EditorDocument | null;
  activeDocumentContentReady?: boolean;
  /**
   * Resolved `.editorconfig` settings for the active document. Empty `{}` (the
   * default) means no `.editorconfig` matched, so the editor keeps its own
   * defaults. When indent / EOL are set they override the editor defaults for
   * the active model only.
   */
  editorConfig?: ResolvedEditorConfig;
  editorFontFamily?: string;
  editorFontLigatures?: boolean;
  editorFontSize?: number;
  embeddedInGroupPanel?: boolean;
  minimapEnabled?: boolean;
  wordWrapEnabled?: boolean;
  isOpeningFile?: boolean;
  applyJavaScriptTypeScriptLanguageServerWorkspaceEdit?(
    edit: LanguageServerWorkspaceEdit,
    context: JavaScriptTypeScriptWorkspaceEditApplicationContext,
  ): Promise<WorkspaceEditApplicationDecision>;
  applyPhpCodeActionNewFile?(newFile: PhpCodeActionNewFile): Promise<boolean>;
  applyPhpLanguageServerWorkspaceEdit?(
    edit: LanguageServerWorkspaceEdit,
    context: PhpWorkspaceEditApplicationContext,
  ): Promise<WorkspaceEditApplicationDecision>;
  clearLanguageServerDiagnosticsForPath?(path: string): void;
  bookmarkedLineNumbers?: readonly number[];
  breakpoints?: readonly Breakpoint[];
  breakpointActions?: Partial<DebugBreakpointManagement>;
  onBreakpointMutationError?: (error: unknown) => void;
  changeHunks: readonly EditorChangeHunk[];
  debugStoppedLocation?: { filePath: string; lineNumber: number } | null;
  debugInlineValueContext?: DebugInlineValueContext | null;
  editorRevealTarget: EditorRevealTarget | null;
  flushPendingJavaScriptTypeScriptLanguageServerDocument?(path: string): Promise<void>;
  flushPendingLanguageServerDocument(path: string): Promise<void>;
  getLanguageServerDocumentLifecycleIdentity?(rootPath: string, path: string): number | null;
  getJavaScriptTypeScriptDocumentSyncVersion?(rootPath: string, path: string): number | null;
  requestLanguageServerDocumentLease?(
    rootPath: string,
    path: string,
  ): Promise<LanguageServerMonacoDocumentRequestLease | null>;
  isLanguageServerDocumentRequestLeaseCurrent?(
    lease: LanguageServerMonacoDocumentRequestLease,
  ): boolean;
  formatOnPaste?: boolean;
  gitBlameEnabled?: boolean;
  isLanguageServerDocumentSynced?(path: string): boolean;
  javaScriptTypeScriptLanguageServerFeaturesGateway?: JavaScriptTypeScriptLanguageServerFeaturesGateway;
  javaScriptTypeScriptLanguageServerRefreshGateway?: LanguageServerRefreshGateway;
  javaScriptTypeScriptLanguageServerRuntimeStatus?: LanguageServerRuntimeStatus | null;
  javaScriptTypeScriptLanguageServerWorkspaceEditGateway?: LanguageServerWorkspaceEditGateway;
  javaScriptTypeScriptCompleteFunctionCalls?: boolean;
  javaScriptTypeScriptValidationEnabled?: boolean;
  jsTestProblemCurrentFileIdentity?: JsTestExplorerCurrentFileIdentity | null;
  jsTestProblemSnapshot?: JsTestProblemsSnapshot | null;
  languageServerDiagnosticsByPath: Record<string, LanguageServerDiagnostic[]>;
  languageServerFeaturesGateway: LanguageServerFeaturesGateway;
  languageServerRefreshGateway?: LanguageServerRefreshGateway;
  languageServerRuntimeStatus: LanguageServerRuntimeStatus | null;
  largeSmartDocumentPolicy?: LargeSmartDocumentPolicy;
  keymap: KeymapSettings;
  monacoTheme: MonacoAppTheme;
  runCommand?: CommandExecutionRunner;
  navigationHistoryPaths?: readonly string[];
  openDocumentPaths?: readonly string[];
  runtimeMembership?: EditorRuntimeMembershipInput;
  restoredViewStates?: Record<string, WorkspaceSessionViewState>;
  restoredViewStateRevision?: number;
  cursorStore?: EditorCursorStorePort | null;
  cursorTrackingActive?: boolean;
  transientWidgetDismissKey?: string;
  phpInlayHintsEnabled?: boolean;
  phpIdeReadinessVersion?: number;
  phpLanguageServerWorkspaceEditGateway?: LanguageServerWorkspaceEditGateway;
  userSnippets?: readonly UserSnippet[];
  workspaceRoot?: string | null;
  workspaceTrusted?: boolean;
  workspaceIdentityDescriptor?:
    WorkspaceIdentityDescriptor | IncompleteWorkspaceIdentityDescriptor | null;
  onCloseActiveTab(): void;
  onCursorPositionChange(position: EditorPosition): void;
  onEditorViewStateChange?(path: string, viewState: WorkspaceSessionViewState): void;
  onEditorMenuCommandRunnerChange?(runner: EditorMenuCommandRunner | null): void;
  onEditorSurfaceCommandRunnerChange?(runner: EditorSurfaceCommandRunner | null): void;
  onDebugWatchAtCursorCaptureReaderChange?(reader: DebugWatchAtCursorCaptureReader | null): void;
  onDebugEvaluateInConsoleCaptureReaderChange?(
    reader: DebugEvaluateInConsoleCaptureReader | null,
  ): void;
  onDebugBreakpointNavigationCaptureReaderChange?(
    reader: DebugBreakpointNavigationCaptureReader | null,
  ): void;
  onDebugInlineBreakpointCaptureReaderChange?(
    reader: DebugInlineBreakpointCaptureReader | null,
  ): void;
  onEditorSurfaceBufferFixRunnerChange?(runner: EditorSurfaceBufferFixRunner | null): void;
  onEditorSurfaceEslintDisableRunnerChange?(runner: EditorSurfaceEslintDisableRunner | null): void;
  onEditorSurfacePhpstanIgnoreRunnerChange?(runner: EditorSurfacePhpstanIgnoreRunner | null): void;
  onGoBack(): void;
  onGoForward(): void;
  onGoToDefinition(): void;
  onGoToImplementationAt(position: EditorPosition): void;
  onGoToSuperMethod(): void;
  onCloseFloatingSurface?(): boolean;
  onRunTestAt?(target: PhpTestGutterTarget): void;
  onToggleBookmarkAtLine?(lineNumber: number): void;
  onToggleBreakpoint?(filePath: string, lineNumber: number): void | Promise<void>;
  onToggleGitBlame?(): void;
  onRevealGitBlameCommit?(path: string, sha: string): void;
  provideGitBlame?(path: string): Promise<GitBlameLine[]>;
  /**
   * Reads a file's text from disk by absolute path. Used to load a local JSON
   * Schema referenced by an open JSON document's `$schema` so Monaco validates
   * it inline. Defaults to a no-op so callers that do not need JSON schema
   * loading (e.g. tests) can omit it; without it JSON simply goes unvalidated.
   */
  readWorkspaceFile?(path: string): Promise<string>;
  isActiveDocumentPhpTest?: boolean;
  isActiveDocumentJsTest?: boolean;
  onEditorFocused(): void;
  onOpenClass(): void;
  onOpenFile(): void;
  onOpenWorkspaceFile?(path: string, request: EditorQaOpenWorkspaceFileRequest): Promise<boolean>;
  onOpenWorkspaceRoot?(path: string): Promise<boolean>;
  onOpenFileStructure(): void;
  onChange(content: string, path?: string, metrics?: LargeSmartDocumentMetrics): boolean | void;
  onLanguageServerError(error: unknown): void;
  onOpenPhpChangeSignature?(
    request: NonNullable<PhpCodeActionDescriptor["interaction"]>,
    applyWorkspaceEdit: PhpCodeActionWorkspaceEditApplier,
  ): void;
  /**
   * Records the latency (ms) of a PHP language-server completion round-trip for
   * the runtime latency panel. Optional: when omitted the completion provider
   * skips the timestamp delta entirely (no hot-path cost).
   */
  onRecordCompletionLatency?(
    durationMs: number,
    rootPath?: string,
    feature?: LatencyOperationKind,
  ): void;
  onLocalPhpDiagnosticsChange?(path: string, diagnostics: LanguageServerDiagnostic[]): void;
  onRevealTargetHandled(target: EditorRevealTarget): void;
  onRevertChangeHunk(hunk: EditorChangeHunk): void;
  phpSyntaxDiagnosticsGateway: PhpSyntaxDiagnosticsGateway;
  frameworkIntelligenceProviders?: EditorSurfaceFrameworkIntelligenceProviders;
  providePhpCodeActions?(
    source: string,
    range: PhpCodeActionRange,
  ): Promise<PhpCodeActionDescriptor[]>;
  providePhpFrameworkDefinition?(
    source: string,
    offset: number,
    request?: NavigationRequest,
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

interface EditorActionCommandPort {
  closeActiveTab(): void;
  goBack(): void;
  goForward(): void;
  goToDefinition(): void;
  goToImplementationAt(position: EditorPosition): void;
  goToSuperMethod(): void;
  openClass(): void;
  openFile(): void;
  openFileStructure(): void;
  toggleGitBlame?(): void;
}

type GuardedQaDefinitionProvider = (
  source: string,
  offset: number,
  request: EditorQaDefinitionRequest,
) => Promise<boolean>;

function provideGuardedQaDefinition(
  provider: (source: string, offset: number) => Promise<boolean>,
  source: string,
  offset: number,
  request: EditorQaDefinitionRequest,
): Promise<boolean> {
  if (!request.canNavigate()) {
    return Promise.resolve(false);
  }

  return (provider as GuardedQaDefinitionProvider)(source, offset, request);
}

function EditorSurfaceComponent({
  activeDocument,
  activeDocumentContentReady = true,
  editorConfig,
  editorFontFamily = defaultEditorFontFamily,
  editorFontLigatures = defaultEditorFontLigatures,
  editorFontSize = defaultEditorFontSize,
  embeddedInGroupPanel = false,
  minimapEnabled = false,
  wordWrapEnabled = false,
  isOpeningFile = false,
  applyJavaScriptTypeScriptLanguageServerWorkspaceEdit = async () => ({
    kind: "accepted",
  }),
  applyPhpCodeActionNewFile = async () => false,
  applyPhpLanguageServerWorkspaceEdit = async () => ({ kind: "accepted" }),
  clearLanguageServerDiagnosticsForPath = () => undefined,
  bookmarkedLineNumbers = EMPTY_BOOKMARK_LINES,
  breakpoints = EMPTY_BREAKPOINTS,
  breakpointActions,
  onBreakpointMutationError,
  changeHunks,
  debugStoppedLocation = null,
  debugInlineValueContext = null,
  editorRevealTarget,
  flushPendingJavaScriptTypeScriptLanguageServerDocument = async () => undefined,
  flushPendingLanguageServerDocument,
  getLanguageServerDocumentLifecycleIdentity,
  getJavaScriptTypeScriptDocumentSyncVersion = () => null,
  requestLanguageServerDocumentLease,
  isLanguageServerDocumentRequestLeaseCurrent,
  formatOnPaste = false,
  gitBlameEnabled = false,
  isActiveDocumentPhpTest = false,
  isActiveDocumentJsTest = false,
  isLanguageServerDocumentSynced,
  languageServerDiagnosticsByPath,
  languageServerFeaturesGateway,
  languageServerRefreshGateway,
  languageServerRuntimeStatus,
  largeSmartDocumentPolicy = defaultLargeSmartDocumentPolicy,
  javaScriptTypeScriptLanguageServerFeaturesGateway = languageServerFeaturesGateway as unknown as JavaScriptTypeScriptLanguageServerFeaturesGateway,
  javaScriptTypeScriptLanguageServerRefreshGateway,
  javaScriptTypeScriptLanguageServerRuntimeStatus = null,
  javaScriptTypeScriptLanguageServerWorkspaceEditGateway,
  javaScriptTypeScriptCompleteFunctionCalls = false,
  javaScriptTypeScriptValidationEnabled = true,
  jsTestCoverageReport = null,
  jsTestProblemCurrentFileIdentity = null,
  jsTestProblemSnapshot = null,
  phpCoverageActiveOwner,
  phpCoveragePublication,
  keymap,
  monacoTheme,
  runCommand,
  navigationHistoryPaths = EMPTY_PATHS,
  openDocumentPaths = EMPTY_PATHS,
  runtimeMembership,
  restoredViewStates = {},
  restoredViewStateRevision = 0,
  cursorStore,
  cursorTrackingActive = true,
  transientWidgetDismissKey,
  phpInlayHintsEnabled = true,
  phpIdeReadinessVersion = 0,
  phpLanguageServerWorkspaceEditGateway,
  userSnippets = EMPTY_USER_SNIPPETS,
  workspaceRoot = null,
  workspaceTrusted = false,
  workspaceIdentityDescriptor = null,
  onCloseActiveTab,
  onCursorPositionChange,
  onEditorViewStateChange,
  onEditorMenuCommandRunnerChange,
  onEditorSurfaceCommandRunnerChange,
  onDebugWatchAtCursorCaptureReaderChange,
  onDebugEvaluateInConsoleCaptureReaderChange,
  onDebugBreakpointNavigationCaptureReaderChange,
  onDebugInlineBreakpointCaptureReaderChange,
  onEditorSurfaceBufferFixRunnerChange,
  onEditorSurfaceEslintDisableRunnerChange,
  onEditorSurfacePhpstanIgnoreRunnerChange,
  onGoBack,
  onGoForward,
  onGoToDefinition,
  onGoToImplementationAt,
  onGoToSuperMethod,
  onCloseFloatingSurface,
  onRunTestAt,
  onToggleBookmarkAtLine,
  onToggleBreakpoint,
  onToggleGitBlame,
  onRevealGitBlameCommit,
  provideGitBlame,
  readWorkspaceFile,
  onEditorFocused,
  onOpenClass,
  onOpenFile,
  onOpenWorkspaceFile,
  onOpenWorkspaceRoot,
  onOpenFileStructure,
  onChange,
  onLanguageServerError,
  onOpenPhpChangeSignature = () => undefined,
  onRecordCompletionLatency,
  onLocalPhpDiagnosticsChange = noopLocalPhpDiagnosticsChange,
  onRevealTargetHandled,
  onRevertChangeHunk,
  phpSyntaxDiagnosticsGateway,
  frameworkIntelligenceProviders,
  providePhpCodeActions = async () => [],
  providePhpFrameworkDefinition,
  providePhpMethodCompletions,
  providePhpMethodSignature,
  providePhpParameterInlayHints = async () => [],
}: EditorSurfaceProps) {
  const runtime = useEditorRuntimeContext();
  const generatedSurfaceId = useId();
  const groupId = runtimeMembership?.groupId ?? generatedSurfaceId;
  const activeDocumentPath = activeDocument?.path;
  const activeDocumentLanguage = activeDocument?.language;
  const activeDocumentContent = activeDocument?.content;
  const editorConfigEndOfLine = editorConfig?.endOfLine;
  const editorConfigIndentSize = editorConfig?.indentSize;
  const editorConfigIndentStyle = editorConfig?.indentStyle;
  const editorConfigTabWidth = editorConfig?.tabWidth;
  const editorViewStateCaptureEnabled = Boolean(onEditorViewStateChange);
  const {
    templateLanguageProvidersRef,
    phpPresenterLinkCompletionsRef,
    phpPresenterLinkCompletionContextRef,
    phpPresenterLinkDefinitionRef,
    phpFrameworkDefinitionRef,
    phpFrameworkStringCompletionContextRef,
  } = useEditorSurfaceFrameworkProviderRefs({
    frameworkIntelligenceProviders,
    providePhpFrameworkDefinition,
  });
  const [monacoApi, setMonacoApi] = useState<typeof Monaco | null>(null);
  const [editorApi, setEditorApi] = useState<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const editorSessionOwnerKey = useMemo(
    () =>
      workspaceRoot
        ? createWorkspaceEditorSessionOwnerKey(workspaceRoot, workspaceIdentityDescriptor)
        : null,
    [workspaceIdentityDescriptor, workspaceRoot],
  );
  const currentBreakpointModel = currentEditorModelForPath(
    editorApi,
    workspaceRoot,
    activeDocumentPath,
  );
  const toggleBreakpointAction = breakpointActions?.toggleBreakpoint ?? onToggleBreakpoint;
  const reportBreakpointMutationError = useCallback(
    (error: unknown) => {
      try {
        onBreakpointMutationError?.(error);
      } catch {
        // Error reporting must not create another unhandled rejection.
      }
    },
    [onBreakpointMutationError],
  );
  useEditorBreakpointDecorations(
    editorApi,
    monacoApi,
    activeDocumentPath,
    currentBreakpointModel,
    breakpoints,
    {
      authoritativeContent: activeDocumentContent,
      relocateBreakpoint: breakpointActions?.relocateBreakpoint,
      workspaceOwnerKey: workspaceIdentityDescriptor?.workspaceId,
      workspaceRoot,
    },
  );
  useEditorRuntimeDecorations({
    activeDocument,
    currentFileIdentity: jsTestProblemCurrentFileIdentity,
    currentModel: currentBreakpointModel,
    debugInlineValueContext,
    debugStoppedLocation,
    editor: editorApi,
    jsTestCoverageReport,
    monaco: monacoApi,
    phpCoverageActiveOwner,
    phpCoveragePublication,
    problemSnapshot: jsTestProblemSnapshot,
    rootPath: workspaceRoot,
    workspaceId: workspaceIdentityDescriptor?.workspaceId ?? null,
  });
  const surfaceIdentityRef = useRef({});
  const activeDocumentRef = useRef(activeDocument);
  const workspaceRootRef = useRef(workspaceRoot);
  activeDocumentRef.current = activeDocument;
  workspaceRootRef.current = workspaceRoot;
  const completeWorkspaceIdentityDescriptor = resolveCompleteWorkspaceIdentityDescriptor(
    workspaceIdentityDescriptor,
  );
  const prepareJavaScriptTypeScriptNavigationModels =
    useJavaScriptTypeScriptTransientNavigationModels({
      descriptor: completeWorkspaceIdentityDescriptor,
      editor: editorApi,
      monaco: monacoApi,
      openDefinition: onGoToDefinition,
      policy: largeSmartDocumentPolicy,
      workspaceRoot,
    });
  const captureEditorSurfaceScope = useCallback((): EditorSurfaceCommandInvocationScope | null => {
    const document = activeDocumentRef.current;
    const model = editorApi?.getModel();
    if (
      !document ||
      !model ||
      !modelMatchesProject(model, workspaceRootRef.current, document.path)
    ) {
      return null;
    }
    return {
      documentPath: document.path,
      modelIdentity: model,
      ownerKey: editorSessionOwnerKey,
      surfaceIdentity: surfaceIdentityRef.current,
    };
  }, [editorApi, editorSessionOwnerKey]);
  const monacoFontLigatures = monacoFontLigaturesForEditorSetting(editorFontLigatures);
  const commandExecutionRunnerRef = useRef<CommandExecutionRunner | undefined>(undefined);
  const onEditorFocusedRef = useRef(onEditorFocused);
  const onCursorPositionChangeRef = useRef(onCursorPositionChange);
  const onEditorViewStateChangeRef = useRef(onEditorViewStateChange);
  const editorActionCommandPortRef = useRef<EditorActionCommandPort>({
    closeActiveTab: onCloseActiveTab,
    goBack: onGoBack,
    goForward: onGoForward,
    goToDefinition: onGoToDefinition,
    goToImplementationAt: onGoToImplementationAt,
    goToSuperMethod: onGoToSuperMethod,
    openClass: onOpenClass,
    openFile: onOpenFile,
    openFileStructure: onOpenFileStructure,
    toggleGitBlame: onToggleGitBlame,
  });
  const editorInteractionActivationPendingRef = useRef(false);
  onEditorFocusedRef.current = onEditorFocused;
  onCursorPositionChangeRef.current = onCursorPositionChange;
  onEditorViewStateChangeRef.current = onEditorViewStateChange;
  const surfaceCommandContext: CommandContext = {
    hasWorkspace: !!workspaceRoot,
    hasActiveDocument: !!activeDocument,
    activeDocumentDirty: Boolean(
      activeDocument && !activeDocument.readOnly && isDirty(activeDocument),
    ),
    editorSurfaceScope: captureEditorSurfaceScope() ?? undefined,
  };
  const npmRunSelectedScriptKeybindings = useMemo(() => {
    if (!monacoApi) return [];
    const platform = detectKeymapPlatform();
    return monacoKeybindingsForShortcut(
      monacoApi,
      shortcutForCommand(keymap, "npm.runSelectedScript", platform),
      platform,
    );
  }, [keymap, monacoApi]);
  commandExecutionRunnerRef.current = runCommand
    ? (commandId) => runCommand(commandId, surfaceCommandContext)
    : undefined;
  useNpmRunSelectedScriptMonacoAction({
    activeDocumentPath,
    activeDocumentRef,
    commandContext: surfaceCommandContext,
    editor: editorApi,
    keybindings: npmRunSelectedScriptKeybindings,
    modelMatchesDocument: modelMatchesProject,
    runCommand,
    workspaceRootRef,
  });
  useLayoutEffect(() => {
    editorActionCommandPortRef.current = {
      closeActiveTab: onCloseActiveTab,
      goBack: onGoBack,
      goForward: onGoForward,
      goToDefinition: onGoToDefinition,
      goToImplementationAt: onGoToImplementationAt,
      goToSuperMethod: onGoToSuperMethod,
      openClass: onOpenClass,
      openFile: onOpenFile,
      openFileStructure: onOpenFileStructure,
      toggleGitBlame: onToggleGitBlame,
    };
  }, [
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
  ]);
  const resolveDocumentForModelRef = useRef(
    (_model: Monaco.editor.ITextModel): EditorDocument | null => null,
  );
  const previousActiveDocumentPathRef = useRef<string | null>(activeDocument?.path ?? null);
  const previousTransientWidgetDismissKeyRef = useRef(transientWidgetDismissKey);
  // Warms TextMate tokens for the active model on idle, off the synchronous
  // reveal/jump path, so a far Cmd+B / click / scroll after open reads cached
  // tokens instead of forcing a main-thread tokenization burst (cold-start lag).
  // One instance per surface; `start()` cancels the previous model's pending
  // warming, so only the active model is ever warmed (per-tab isolation).
  const backgroundTokenizerRef = useRef<BackgroundTokenizer | null>(null);
  if (!backgroundTokenizerRef.current) {
    backgroundTokenizerRef.current = new BackgroundTokenizer(idleCallbackScheduler());
  }
  const runtimeStatusRef = useRef(languageServerRuntimeStatus);
  const largeSmartDocumentPolicyRef = useRef(largeSmartDocumentPolicy);
  const javaScriptTypeScriptRuntimeStatusRef = useRef(
    javaScriptTypeScriptLanguageServerRuntimeStatus,
  );
  const {
    customNavigationEnabled: customDefinitionNavigationEnabled,
    managedDocumentActive: managedJavaScriptTypeScriptDocumentActive,
    managedRuntimeActive: managedJavaScriptTypeScriptRuntimeActive,
  } = useEditorDefinitionNavigation({
    activeDocument,
    editor: editorApi,
    runtimeStatus: javaScriptTypeScriptLanguageServerRuntimeStatus,
    workspaceRoot,
  });
  const flushPendingRef = useRef(flushPendingLanguageServerDocument);
  const getLanguageServerDocumentLifecycleIdentityRef = useRef(
    getLanguageServerDocumentLifecycleIdentity,
  );
  const getJavaScriptTypeScriptDocumentSyncVersionRef = useRef(
    getJavaScriptTypeScriptDocumentSyncVersion,
  );
  const requestLanguageServerDocumentLeaseRef = useRef(requestLanguageServerDocumentLease);
  const isLanguageServerDocumentRequestLeaseCurrentRef = useRef(
    isLanguageServerDocumentRequestLeaseCurrent,
  );
  const flushPendingJavaScriptTypeScriptRef = useRef(
    flushPendingJavaScriptTypeScriptLanguageServerDocument,
  );
  const applyJavaScriptTypeScriptWorkspaceEditRef = useRef(
    applyJavaScriptTypeScriptLanguageServerWorkspaceEdit,
  );
  const applyPhpWorkspaceEditRef = useRef(applyPhpLanguageServerWorkspaceEdit);
  const errorReporterRef = useRef(onLanguageServerError);
  const recordCompletionLatencyRef = useRef(onRecordCompletionLatency);
  // Holds the latest parent onChange so the Editor can receive a single stable
  // handler (see handleEditorChange) without the closure ever going stale.
  const onChangeRef = useRef(onChange);
  const onLocalPhpDiagnosticsChangeRef = useRef(onLocalPhpDiagnosticsChange);
  onLocalPhpDiagnosticsChangeRef.current = onLocalPhpDiagnosticsChange;
  const openWorkspaceFileRef = useRef(onOpenWorkspaceFile);
  const openWorkspaceRootRef = useRef(onOpenWorkspaceRoot);
  const isLanguageServerDocumentSyncedRef = useRef(isLanguageServerDocumentSynced);
  const changeDecorationIdsRef = useRef<string[]>([]);
  // Tracks whether persistent column-selection mode is on so the toggle action
  // flips it. Per-editor state (one EditorSurface instance per tab), so it never
  // leaks between open project tabs.
  const columnSelectionEnabledRef = useRef(false);
  const {
    invalidateAuthority: invalidateEditorSurfaceImportActionAuthority,
    isEnabled: isEditorSurfaceImportActionEnabled,
    run: runEditorSurfaceImportAction,
  } = useEditorSurfaceImportActions({
    activeDocumentRef,
    captureScope: captureEditorSurfaceScope,
    editor: editorApi,
    featureGateway: javaScriptTypeScriptLanguageServerFeaturesGateway,
    flushPendingDocumentRef: flushPendingJavaScriptTypeScriptRef,
    getDocumentSyncVersionRef: getJavaScriptTypeScriptDocumentSyncVersionRef,
    largeSmartDocumentPolicyRef,
    modelMatchesDocument: modelMatchesProject,
    reportErrorRef: errorReporterRef,
    runtimeStatus: javaScriptTypeScriptLanguageServerRuntimeStatus,
    runtimeStatusRef: javaScriptTypeScriptRuntimeStatusRef,
    workspaceOwnerKey: editorSessionOwnerKey,
    workspacePathPolicy: completeWorkspaceIdentityDescriptor?.policy,
    workspaceRoot,
    workspaceRootRef,
    workspaceTrusted,
  });
  // Active cyclic-expand-word (hippie) session. Per-editor state (one
  // EditorSurface per tab) so completion candidates never leak between project
  // tabs. Reset whenever the caret/buffer no longer matches the last expansion.
  const hippieSessionRef = useRef<HippieSession | null>(null);
  const changeHunksRef = useRef(changeHunks);
  const implementationGutterDecorationIdsRef = useRef<string[]>([]);
  // The path whose glyphs currently occupy implementationGutterDecorationIdsRef.
  // The gutter recompute is debounced, so on a file switch we must clear the
  // previous file's glyphs synchronously (a switch is a path change) rather than
  // waiting for the debounced recompute, which would otherwise leave stale glyphs
  // or duplicate them when revisiting a file. null means no glyphs are applied.
  const implementationGutterDecoratedPathRef = useRef<string | null>(null);
  const implementationGutterTargetsRef = useRef(new Map<number, EditorPosition>());
  const testGutterDecorationIdsRef = useRef<string[]>([]);
  // The path whose glyphs currently occupy testGutterDecorationIdsRef (see the
  // implementation-gutter counterpart for why the debounced recompute needs a
  // synchronous path-switch clear).
  const testGutterDecoratedPathRef = useRef<string | null>(null);
  // Maps a line number to the parsed test target on that line so a Right-lane
  // gutter click can dispatch the exact test to run. Reset whenever the active
  // document changes so a stale tab's targets can never run.
  const testGutterTargetsRef = useRef(new Map<number, PhpTestGutterTarget>());
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
  const gitBlameLinesRef = useRef<GitBlameLine[]>([]);
  // The path whose annotations currently occupy gitBlameDecorationIdsRef. null
  // means none are applied. Used to drop the previous file's annotations on a
  // switch (per-tab isolation) and to ignore a stale async blame result whose
  // requested path no longer matches the active document.
  const gitBlameDecoratedPathRef = useRef<string | null>(null);
  const provideGitBlameRef = useRef(provideGitBlame);
  const diagnosticOverviewDecorationIdsRef = useRef<string[]>([]);
  const languageServerDiagnosticsByPathRef = useRef(languageServerDiagnosticsByPath);
  // Tracks the active document's path + total diagnostic count from the previous
  // diagnostics-decoration run, so a stale content hover can be dismissed when
  // that count drops (markers removed/cleared) for the same document.
  const previousActiveDiagnosticCountRef = useRef<{
    count: number;
    path: string;
  } | null>(null);
  const phpCodeActionsRef = useRef(providePhpCodeActions);
  const openPhpChangeSignatureRef = useRef(onOpenPhpChangeSignature);
  const applyPhpCodeActionNewFileRef = useRef(applyPhpCodeActionNewFile);
  const clearLanguageServerDiagnosticsForPathRef = useRef(clearLanguageServerDiagnosticsForPath);
  const pendingLocalPhpValidationRef = useRef<{
    key: string;
    model: Monaco.editor.ITextModel;
  } | null>(null);
  const phpMethodCompletionsRef = useRef(providePhpMethodCompletions);
  const phpMethodSignatureRef = useRef(providePhpMethodSignature);
  const phpParameterInlayHintsRef = useRef(providePhpParameterInlayHints);
  const phpInlayHintsEnabledRef = useRef(phpInlayHintsEnabled);
  const userSnippetsRef = useRef<readonly UserSnippet[]>(userSnippets);
  const [syntaxDiagnosticsByPath, setSyntaxDiagnosticsByPath] = useState<
    Record<string, PhpSyntaxDiagnostic[]>
  >({});
  const [phpInspectionDiagnosticCountsByPath, setPhpInspectionDiagnosticCountsByPath] = useState<
    Record<string, number>
  >({});
  const [changePreview, setChangePreview] = useState<EditorChangePreviewState | null>(null);
  const [cursorPosition, setCursorPosition] = useState<EditorPosition | null>(null);
  const [breadcrumbSymbolsByPath, setBreadcrumbSymbolsByPath] = useState<
    Record<string, LanguageServerDocumentSymbol[]>
  >({});
  // Holds the captured selection context while the Surround With quick-pick is
  // open. It is scoped to this editor surface and cleared as soon as a template
  // is chosen or the picker is dismissed, so nothing leaks across tabs.
  const [surroundWithRequest, setSurroundWithRequest] = useState<SurroundWithRequest | null>(null);
  const { activeDocumentIsLargeSmart, activeDocumentLargeSmartMode, onModelContentChange } =
    useLargeSmartDocumentMetricsLifecycle({
      document: activeDocument,
      onChangeRef,
      policy: largeSmartDocumentPolicy,
      workspaceRoot,
    });

  // A document switch must never apply a wrap meant for the previous file, so
  // any pending Surround With request is dropped when the active document
  // changes. The cyclic-expand-word (hippie) session is dropped for the same
  // reason: its anchor offset and candidate list belong to the previous file.
  useEffect(() => {
    setSurroundWithRequest(null);
    hippieSessionRef.current = null;
  }, [activeDocumentPath]);

  useEffect(() => {
    changeHunksRef.current = changeHunks;
    setChangePreview((current) => {
      if (!current) return null;

      const hunk = changeHunks.find((candidate) => candidate.id === current.hunk.id);

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

  useSynchronizedRef(runtimeStatusRef, languageServerRuntimeStatus);
  useSynchronizedRef(largeSmartDocumentPolicyRef, largeSmartDocumentPolicy);
  useSynchronizedRef(
    javaScriptTypeScriptRuntimeStatusRef,
    javaScriptTypeScriptLanguageServerRuntimeStatus,
  );

  // Registers the local JSON Schema declared by the active document's `$schema`
  // (e.g. `.phpactor.json`) with Monaco so it validates inline. Without this,
  // Monaco's JSON worker tries to fetch the schema, finds no request service,
  // and reports a 768 "No schema request service available" error on the
  // `$schema` line. The schema content is read off-disk via the Tauri gateway.
  //
  // Per-workspace isolation: the requested document path is captured up front;
  // the loader re-checks `isStale()` after the async schema read and drops the
  // result when the active document has since changed. Switching project tabs
  // also switches the active document, so this single check covers a mid-read
  // tab switch - one project's schema can never be registered while the user is
  // already looking at another.
  useEffect(() => {
    if (!monacoApi || !activeDocument || activeDocument.language !== "json" || !readWorkspaceFile) {
      return;
    }

    const requestedPath = activeDocument.path;
    const readTextFile = readWorkspaceFile;
    const document = {
      path: activeDocument.path,
      content: activeDocument.content,
      language: activeDocument.language,
    };

    void loadJsonSchemaForDocument(monacoApi, document, {
      readTextFile,
      isStale: () => activeDocumentRef.current?.path !== requestedPath,
    }).catch(() => {
      // Loading a JSON schema is best-effort: a failure must never break JSON
      // editing or surface an overlay. The loader already swallows expected
      // failures; this guard covers anything unexpected.
    });
  }, [activeDocument, monacoApi, readWorkspaceFile]);

  useSynchronizedRef(flushPendingRef, flushPendingLanguageServerDocument);
  useSynchronizedRef(
    getLanguageServerDocumentLifecycleIdentityRef,
    getLanguageServerDocumentLifecycleIdentity,
  );
  useSynchronizedRef(
    getJavaScriptTypeScriptDocumentSyncVersionRef,
    getJavaScriptTypeScriptDocumentSyncVersion,
  );
  useSynchronizedRef(requestLanguageServerDocumentLeaseRef, requestLanguageServerDocumentLease);
  useSynchronizedRef(
    isLanguageServerDocumentRequestLeaseCurrentRef,
    isLanguageServerDocumentRequestLeaseCurrent,
  );
  useSynchronizedRef(
    flushPendingJavaScriptTypeScriptRef,
    flushPendingJavaScriptTypeScriptLanguageServerDocument,
  );
  useSynchronizedRef(
    applyJavaScriptTypeScriptWorkspaceEditRef,
    applyJavaScriptTypeScriptLanguageServerWorkspaceEdit,
  );
  useSynchronizedRef(applyPhpWorkspaceEditRef, applyPhpLanguageServerWorkspaceEdit);
  useSynchronizedRef(errorReporterRef, onLanguageServerError);
  useSynchronizedRef(recordCompletionLatencyRef, onRecordCompletionLatency);
  useSynchronizedRef(onChangeRef, onChange);
  useSynchronizedRef(openWorkspaceFileRef, onOpenWorkspaceFile);
  useSynchronizedRef(openWorkspaceRootRef, onOpenWorkspaceRoot);
  useSynchronizedRef(isLanguageServerDocumentSyncedRef, isLanguageServerDocumentSynced);
  useSynchronizedRef(languageServerDiagnosticsByPathRef, languageServerDiagnosticsByPath);
  useSynchronizedRef(phpCodeActionsRef, providePhpCodeActions);
  useSynchronizedRef(openPhpChangeSignatureRef, onOpenPhpChangeSignature);
  useSynchronizedRef(applyPhpCodeActionNewFileRef, applyPhpCodeActionNewFile);
  useSynchronizedRef(
    clearLanguageServerDiagnosticsForPathRef,
    clearLanguageServerDiagnosticsForPath,
  );

  useEffect(() => {
    pendingLocalPhpValidationRef.current = null;
  }, [activeDocument?.path]);

  useSynchronizedRef(phpMethodCompletionsRef, providePhpMethodCompletions);
  useSynchronizedRef(phpMethodSignatureRef, providePhpMethodSignature);
  useSynchronizedRef(phpParameterInlayHintsRef, providePhpParameterInlayHints);
  useSynchronizedRef(phpInlayHintsEnabledRef, phpInlayHintsEnabled);
  useSynchronizedRef(userSnippetsRef, userSnippets);
  useSynchronizedRef(provideGitBlameRef, provideGitBlame);

  useEffect(() => {
    if (!activeDocumentPath || activeDocumentLanguage !== "php") {
      return;
    }

    if (!editorApi || phpIdeReadinessVersion <= 0) {
      return;
    }

    const model = editorApi.getModel();
    const position = editorApi.getPosition();

    if (!model || !position || !modelMatchesProject(model, workspaceRoot, activeDocumentPath)) {
      return;
    }

    const source = model.getValue();
    const isPhpCompletionContext = Boolean(
      phpMemberAccessCompletionContextAt(source, position) ||
      phpStaticAccessCompletionContextAt(source, position) ||
      phpFrameworkStringCompletionContextRef.current(source, position),
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
    activeDocumentPath,
    activeDocumentLanguage,
    editorApi,
    phpFrameworkStringCompletionContextRef,
    phpIdeReadinessVersion,
    providePhpMethodCompletions,
    workspaceRoot,
  ]);

  useEditorSurfaceCommandPublications({
    activeDocumentPath,
    captureEditorSurfaceScope,
    changeHunksRef,
    editor: editorApi,
    invalidateImportActionAuthority: invalidateEditorSurfaceImportActionAuthority,
    isImportActionEnabled: isEditorSurfaceImportActionEnabled,
    onEditorMenuCommandRunnerChange,
    onEditorSurfaceCommandRunnerChange,
    runImportAction: runEditorSurfaceImportAction,
    workspaceRoot,
  });

  useEditorDebugCaptureReaders({
    activeDocumentPath,
    activeDocumentRef,
    editor: editorApi,
    editorSessionOwnerKey,
    onDebugBreakpointNavigationCaptureReaderChange,
    onDebugEvaluateInConsoleCaptureReaderChange,
    onDebugInlineBreakpointCaptureReaderChange,
    onDebugWatchAtCursorCaptureReaderChange,
    workspaceRoot,
    workspaceRootRef,
  });

  useEditorDiagnosticFixRunners({
    activeDocumentPath,
    editor: editorApi,
    monaco: monacoApi,
    onEditorSurfaceBufferFixRunnerChange,
    onEditorSurfaceEslintDisableRunnerChange,
    onEditorSurfacePhpstanIgnoreRunnerChange,
    workspaceRoot,
  });

  const recoverVisibleLocalPhpDiagnostics = useCallback(
    (uris: readonly Monaco.Uri[] = []) => {
      if (!activeDocumentPath || activeDocumentLanguage !== "php" || !monacoApi) {
        return;
      }

      const model = monacoApi.editor
        .getModels()
        .find((candidate) => modelMatchesProject(candidate, workspaceRoot, activeDocumentPath));
      if (!model) {
        return;
      }

      if (uris.length > 0 && !uris.some((uri) => model.uri.toString() === uri.toString())) {
        return;
      }

      const diagnostics = localPhpDiagnosticsFromVisibleMarkers(monacoApi, model);

      // Recovery bridge only: parser-driven validation owns clears. This keeps
      // a visible local PHP marker from being absent in Problems/status during
      // startup/open races without letting a transient empty marker set wipe the
      // workbench diagnostics store.
      if (diagnostics.length === 0) {
        return;
      }

      onLocalPhpDiagnosticsChange(activeDocumentPath, diagnostics);
    },
    [
      activeDocumentLanguage,
      activeDocumentPath,
      monacoApi,
      onLocalPhpDiagnosticsChange,
      workspaceRoot,
    ],
  );

  const runtimeProviderRefs: EditorSurfaceLanguageProviderRegistrationRefs = {
    activeDocumentRef,
    resolveDocumentForModelRef,
    applyPhpCodeActionNewFileRef,
    applyPhpWorkspaceEditRef,
    clearLanguageServerDiagnosticsForPathRef,
    errorReporterRef,
    flushPendingRef,
    getLanguageServerDocumentLifecycleIdentityRef,
    ...(requestLanguageServerDocumentLease ? { requestLanguageServerDocumentLeaseRef } : {}),
    ...(isLanguageServerDocumentRequestLeaseCurrent
      ? { isLanguageServerDocumentRequestLeaseCurrentRef }
      : {}),
    isLanguageServerDocumentSyncedRef,
    largeSmartDocumentPolicyRef,
    phpCodeActionsRef,
    openPhpChangeSignatureRef,
    phpFrameworkDefinitionRef,
    phpFrameworkStringCompletionContextRef,
    phpInlayHintsEnabledRef,
    phpMethodCompletionsRef,
    phpMethodSignatureRef,
    phpParameterInlayHintsRef,
    phpPresenterLinkCompletionsRef,
    phpPresenterLinkCompletionContextRef,
    phpPresenterLinkDefinitionRef,
    recordCompletionLatencyRef,
    runtimeStatusRef,
    templateLanguageProvidersRef,
    userSnippetsRef,
  };
  const toRuntimeDiagnosticMarker = useCallback(
    (diagnostic: LanguageServerDiagnostic) => toMonacoDiagnosticMarker(monacoApi!, diagnostic),
    [monacoApi],
  );
  const runtimeRegistration: EditorRuntimeSurfaceRegistration = {
    activePath: activeDocument?.path ?? null,
    diagnosticsByPath: languageServerDiagnosticsByPath,
    editor: editorApi,
    groupId,
    monacoApi,
    onMarkerUrisChanged: recoverVisibleLocalPhpDiagnostics,
    onModelContentChange,
    providerDependencies: {
      coordinatePhpDocumentSymbols: runtime?.coordinatePhpDocumentSymbols,
      featuresGateway: languageServerFeaturesGateway,
      monacoApi,
      refreshGateway: languageServerRefreshGateway,
      workspaceEditGateway: phpLanguageServerWorkspaceEditGateway,
      workspaceIdentityDescriptor: completeWorkspaceIdentityDescriptor,
      workspaceRoot,
      workspaceTrusted,
    },
    routing: {
      activeDocumentRef,
      javaScriptTypeScriptProviderContext: {
        applyWorkspaceEdit: (edit, editContext) =>
          applyJavaScriptTypeScriptWorkspaceEditRef.current(edit, editContext),
        cancelRequest:
          javaScriptTypeScriptLanguageServerFeaturesGateway.identifiedRequests?.cancelRequest,
        completeFunctionCalls: javaScriptTypeScriptCompleteFunctionCalls,
        featuresGateway: javaScriptTypeScriptLanguageServerFeaturesGateway,
        flushPendingDocumentChange: (path) => flushPendingJavaScriptTypeScriptRef.current(path),
        getActiveDocument: () => activeDocumentRef.current,
        getActiveModel: () => editorApi?.getModel() ?? null,
        getDocumentSyncVersion: (rootPath, path) =>
          getJavaScriptTypeScriptDocumentSyncVersionRef.current(rootPath, path),
        getActiveJavaScriptTypeScriptOwnerEpoch: () =>
          runtime?.getActiveJavaScriptTypeScriptOwnerEpoch() ?? 0,
        getActiveJavaScriptTypeScriptOwnerIdentity: () =>
          runtime?.getActiveJavaScriptTypeScriptOwnerIdentity() ?? null,
        getLargeSmartDocumentPolicy: () => largeSmartDocumentPolicyRef.current,
        getRuntimeStatus: () => javaScriptTypeScriptRuntimeStatusRef.current,
        getUserSnippets: () => userSnippetsRef.current,
        getWorkspaceIdentityDescriptor: () => completeWorkspaceIdentityDescriptor,
        getWorkspaceRoot: () => workspaceRoot,
        prepareNavigationModels: prepareJavaScriptTypeScriptNavigationModels,
        recordLatency: (feature, durationMs, rootPath) =>
          recordCompletionLatencyRef.current?.(durationMs, rootPath, feature),
        refreshGateway: javaScriptTypeScriptLanguageServerRefreshGateway,
        reportError: (error) => errorReporterRef.current(error),
        workspaceEditGateway: javaScriptTypeScriptLanguageServerWorkspaceEditGateway,
      },
      providerRefs: runtimeProviderRefs,
      resolveDocumentForModel: (model) => {
        const resolved = runtimeMembership?.resolveDocumentForModel?.(model);
        if (resolved) {
          return resolved;
        }

        const document = activeDocumentRef.current;
        if (
          !document ||
          !workspaceRoot ||
          !modelMatchesWorkspacePath(model, workspaceRoot, document.path)
        ) {
          return null;
        }

        return document;
      },
    },
    retainPaths: [
      ...openDocumentPaths,
      ...navigationHistoryPaths,
      ...(runtimeMembership?.retainPaths ?? []),
    ],
    toMarker: toRuntimeDiagnosticMarker,
    typescriptJavascriptDefaults: {
      managedLanguageServerActive: managedJavaScriptTypeScriptRuntimeActive,
      validationEnabled: javaScriptTypeScriptValidationEnabled,
    },
    workspaceIdentityDescriptor: completeWorkspaceIdentityDescriptor,
    workspaceRoot,
  };
  resolveDocumentForModelRef.current = runtimeRegistration.routing.resolveDocumentForModel;
  const runtimeRegistrationRef = useRef(runtimeRegistration);
  runtimeRegistrationRef.current = runtimeRegistration;

  useEffect(() => {
    if (!runtime) {
      return;
    }

    return runtime.registerSurface(generatedSurfaceId, runtimeRegistrationRef.current);
  }, [generatedSurfaceId, runtime]);

  useEffect(() => {
    runtime?.updateSurface(generatedSurfaceId, runtimeRegistrationRef.current);
  }, [
    activeDocument,
    activeDocument?.path,
    editorApi,
    generatedSurfaceId,
    groupId,
    javaScriptTypeScriptCompleteFunctionCalls,
    javaScriptTypeScriptLanguageServerFeaturesGateway,
    javaScriptTypeScriptLanguageServerRefreshGateway,
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerWorkspaceEditGateway,
    javaScriptTypeScriptValidationEnabled,
    languageServerDiagnosticsByPath,
    languageServerFeaturesGateway,
    languageServerRefreshGateway,
    monacoApi,
    navigationHistoryPaths,
    openDocumentPaths,
    phpLanguageServerWorkspaceEditGateway,
    runtime,
    runtimeMembership?.resolveDocumentForModel,
    runtimeMembership?.retainPaths,
    completeWorkspaceIdentityDescriptor,
    workspaceTrusted,
    workspaceRoot,
  ]);

  useEffect(() => {
    if (!editorApi || !editorQaBridgeEnabled()) {
      return;
    }

    return installEditorQaBridge({
      diagnosticsByPath: () => languageServerDiagnosticsByPathRef.current,
      editor: () => editorApi,
      getActiveDocument: () => activeDocumentRef.current,
      getWorkspaceRoot: () => workspaceRootRef.current,
      openWorkspaceFile: (path, request) =>
        openWorkspaceFileRef.current?.(path, request) ?? Promise.resolve(false),
      openWorkspaceRoot: (path) => openWorkspaceRootRef.current?.(path) ?? Promise.resolve(false),
      provideBladeDefinition: (source, offset, request) =>
        provideGuardedQaDefinition(
          templateLanguageProvidersRef.current.blade.provideDefinition,
          source,
          offset,
          request,
        ),
      provideBladeCompletions: (source, position) =>
        templateLanguageProvidersRef.current.blade.provideCompletions(source, position),
      provideLatteDefinition: (source, offset, request) =>
        provideGuardedQaDefinition(
          templateLanguageProvidersRef.current.latte.provideDefinition,
          source,
          offset,
          request,
        ),
      provideLatteCompletions: (source, position) =>
        templateLanguageProvidersRef.current.latte.provideCompletions(source, position),
      provideNeonDefinition: (source, offset, request) =>
        provideGuardedQaDefinition(
          templateLanguageProvidersRef.current.neon.provideDefinition,
          source,
          offset,
          request,
        ),
      provideNeonCompletions: (source, position) =>
        templateLanguageProvidersRef.current.neon.provideCompletions(source, position),
      providePhpFrameworkDefinition: (source, offset, request) =>
        provideGuardedQaDefinition(phpFrameworkDefinitionRef.current, source, offset, request),
      providePhpMethodCompletions: (source, position) =>
        phpMethodCompletionsRef.current(source, position),
      providePhpPresenterLinkDefinition: (source, offset, request) =>
        provideGuardedQaDefinition(phpPresenterLinkDefinitionRef.current, source, offset, request),
    });
  }, [
    editorApi,
    phpFrameworkDefinitionRef,
    phpPresenterLinkDefinitionRef,
    templateLanguageProvidersRef,
  ]);

  const handleMount: OnMount = useCallback((_editor, monaco) => {
    setEditorApi(_editor);
    setMonacoApi(monaco);
  }, []);

  const activateEditorGroupFromInteraction = useCallback(() => {
    runtime?.focusGroup(groupId);
    if (editorInteractionActivationPendingRef.current) {
      return;
    }

    editorInteractionActivationPendingRef.current = true;
    onEditorFocusedRef.current();
    queueMicrotask(() => {
      editorInteractionActivationPendingRef.current = false;
    });
  }, [groupId, runtime]);

  useEditorPresentationBindings({
    activeDocumentPath,
    activateFromInteraction: activateEditorGroupFromInteraction,
    editor: editorApi,
    editorConfigEndOfLine,
    editorConfigIndentSize,
    editorConfigIndentStyle,
    editorConfigTabWidth,
    fontFamily: editorFontFamily,
    fontLigatures: monacoFontLigatures,
    fontSize: editorFontSize,
    minimapEnabled,
    monaco: monacoApi,
    wordWrapEnabled,
    workspaceRoot,
  });

  useEditorCursorPublication({
    activeDocumentPath: activeDocumentPath ?? null,
    cursorStore,
    editorApi,
    groupId: runtimeMembership?.groupId ?? null,
    onPositionRef: onCursorPositionChangeRef,
    ownerKey: editorSessionOwnerKey,
    setLegacyPosition: setCursorPosition,
    trackingActive: cursorTrackingActive,
  });

  useBackgroundTokenizationLifecycle({
    activeDocumentIsLargeSmart,
    activeDocumentPath,
    editor: editorApi,
    tokenizerRef: backgroundTokenizerRef,
    workspaceRoot,
  });

  useEditorBreadcrumbLifecycle({
    activeDocument,
    activeDocumentIsLargeSmart,
    activeDocumentRef,
    errorReporterRef,
    flushPendingLanguageServerDocument,
    isLanguageServerDocumentRequestLeaseCurrentRef,
    isLanguageServerDocumentSyncedRef,
    javaScriptTypeScriptFeaturesGateway: javaScriptTypeScriptLanguageServerFeaturesGateway,
    languageServerFeaturesGateway,
    requestLanguageServerDocumentLeaseRef,
    runtime,
    runtimeStatusRef,
    setBreadcrumbSymbolsByPath,
    workspaceRoot,
  });

  useEditorInputLifecycle({
    activeDocumentLanguage,
    activeDocumentPath,
    editor: editorApi,
    monaco: monacoApi,
    workspaceRoot,
  });

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
      ).filter((binding) => binding !== monacoApi.KeyCode.F12);
    const configuredF12CommandIds = keymapCommandIdsForShortcut(keymap, "F12", keymapPlatform);
    const definitionUsesDefaultShortcut =
      shortcutForCommand(keymap, "editor.goToDefinition", keymapPlatform) ===
      defaultShortcutForCommand("editor.goToDefinition", keymapPlatform);
    const disposables = [
      editorApi.addAction({
        id: "mockor.dispatchF12",
        label: "Dispatch F12",
        keybindings: [monacoApi.KeyCode.F12],
        run: () => {
          if (configuredF12CommandIds.length > 0) {
            if (
              configuredF12NeedsNativeDefinition({
                commandIds: configuredF12CommandIds,
                customNavigationEnabled: customDefinitionNavigationEnabled,
                runCommand: commandExecutionRunnerRef.current,
              })
            ) {
              triggerEditorAction(editorApi, "editor.action.revealDefinition");
            }
            return;
          }

          if (definitionUsesDefaultShortcut) {
            if (customDefinitionNavigationEnabled) {
              runRegisteredCommand(commandExecutionRunnerRef, "editor.goToDefinition", () =>
                editorActionCommandPortRef.current.goToDefinition(),
              );
            } else {
              triggerEditorAction(editorApi, "editor.action.revealDefinition");
            }
          }
        },
      }),
      editorApi.addAction({
        id: "mockor.goToDefinition",
        label: "Go to Definition",
        keybindings: keybinding("editor.goToDefinition"),
        run: () => {
          if (!customDefinitionNavigationEnabled) {
            triggerEditorAction(editorApi, "editor.action.revealDefinition");
            return;
          }

          runRegisteredCommand(commandExecutionRunnerRef, "editor.goToDefinition", () =>
            editorActionCommandPortRef.current.goToDefinition(),
          );
        },
      }),
      editorApi.addAction({
        id: "mockor.quickDefinition",
        label: "Quick Definition",
        keybindings: keybinding("editor.quickDefinition"),
        run: () => requestRegisteredCommand(commandExecutionRunnerRef, "editor.quickDefinition"),
      }),
      editorApi.addAction({
        id: "mockor.goToSourceDefinition",
        label: "Go to Source Definition",
        keybindings: keybinding("editor.goToSourceDefinition"),
        run: () =>
          runRegisteredCommand(
            commandExecutionRunnerRef,
            "editor.goToSourceDefinition",
            () => undefined,
          ),
      }),
      editorApi.addAction({
        id: "mockor.goToDeclaration",
        label: "Go to Declaration",
        keybindings: keybinding("editor.goToDeclaration"),
        run: () =>
          runRegisteredCommand(commandExecutionRunnerRef, "editor.goToDeclaration", () =>
            triggerEditorAction(editorApi, "editor.action.revealDeclaration"),
          ),
      }),
      editorApi.addAction({
        id: "mockor.goToTypeDefinition",
        label: "Go to Type Definition",
        keybindings: keybinding("editor.goToTypeDefinition"),
        run: () =>
          runRegisteredCommand(commandExecutionRunnerRef, "editor.goToTypeDefinition", () =>
            triggerEditorAction(editorApi, "editor.action.goToTypeDefinition"),
          ),
      }),
      editorApi.addAction({
        id: "mockor.goToImplementation",
        label: "Go to Implementation",
        keybindings: keybinding("editor.goToImplementation"),
        run: () => {
          runRegisteredCommand(commandExecutionRunnerRef, "editor.goToImplementation", () => {
            const position = editorApi.getPosition();

            if (!position) {
              return;
            }

            editorActionCommandPortRef.current.goToImplementationAt(position);
          });
        },
      }),
      editorApi.addAction({
        id: "mockor.goToSuperMethod",
        label: "Go to Super Method",
        keybindings: keybinding("editor.goToSuperMethod"),
        run: () =>
          runRegisteredCommand(commandExecutionRunnerRef, "editor.goToSuperMethod", () =>
            editorActionCommandPortRef.current.goToSuperMethod(),
          ),
      }),
      editorApi.addAction({
        id: "mockor.findReferences",
        label: "Find All References",
        keybindingContext: "!referenceSearchVisible && !inReferenceSearchEditor",
        keybindings: keybinding("editor.findReferences"),
        run: () => {
          if (managedJavaScriptTypeScriptDocumentActive) {
            requestRegisteredCommand(commandExecutionRunnerRef, "editor.findReferences");
            return;
          }

          runRegisteredCommand(commandExecutionRunnerRef, "editor.findReferences", () =>
            triggerEditorAction(editorApi, "editor.action.goToReferences"),
          );
        },
      }),
      editorApi.addAction({
        id: "mockor.findFileReferences",
        label: "Find File References",
        keybindings: keybinding("editor.findFileReferences"),
        run: () =>
          runRegisteredCommand(commandExecutionRunnerRef, "editor.findFileReferences", () =>
            triggerEditorAction(editorApi, "editor.action.peekImplementation"),
          ),
      }),
      editorApi.addAction({
        id: "mockor.openClass",
        label: "Open Class",
        keybindings: keybinding("class.quickOpen"),
        run: () =>
          runRegisteredCommand(commandExecutionRunnerRef, "class.quickOpen", () =>
            editorActionCommandPortRef.current.openClass(),
          ),
      }),
      editorApi.addAction({
        id: "mockor.openFile",
        label: "Open File",
        keybindings: keybinding("file.quickOpen"),
        run: () =>
          runRegisteredCommand(commandExecutionRunnerRef, "file.quickOpen", () =>
            editorActionCommandPortRef.current.openFile(),
          ),
      }),
      editorApi.addAction({
        id: "mockor.fileStructure",
        label: "File Structure",
        keybindings: keybinding("editor.fileStructure"),
        run: () =>
          runRegisteredCommand(commandExecutionRunnerRef, "editor.fileStructure", () =>
            editorActionCommandPortRef.current.openFileStructure(),
          ),
      }),
      editorApi.addAction({
        id: "mockor.gotoLine",
        label: "Go to Line/Column",
        keybindings: keybinding("editor.gotoLine"),
        run: () =>
          runRegisteredCommand(commandExecutionRunnerRef, "editor.gotoLine", () =>
            triggerEditorSurfaceCommand(editorApi, "editor.gotoLine"),
          ),
      }),
      editorApi.addAction({
        id: "mockor.rename",
        label: "Rename Symbol",
        keybindings: keybinding("editor.rename"),
        run: () =>
          runRegisteredCommand(commandExecutionRunnerRef, "editor.rename", () =>
            triggerEditorSurfaceCommand(editorApi, "editor.rename"),
          ),
      }),
      editorApi.addAction({
        id: "mockor.toggleGitBlame",
        label: "Annotate with Git Blame",
        keybindings: keybinding("editor.toggleGitBlame"),
        run: () =>
          runRegisteredCommand(commandExecutionRunnerRef, "editor.toggleGitBlame", () =>
            editorActionCommandPortRef.current.toggleGitBlame?.(),
          ),
      }),
      editorApi.addAction({
        id: "mockor.formatDocument",
        label: "Format Document",
        keybindings: keybinding("editor.formatDocument"),
        run: () =>
          runRegisteredCommand(commandExecutionRunnerRef, "editor.formatDocument", () =>
            triggerEditorSurfaceCommand(editorApi, "editor.formatDocument"),
          ),
      }),
      editorApi.addAction({
        id: "mockor.formatSelection",
        label: "Format Selection",
        keybindings: keybinding("editor.formatSelection"),
        run: () =>
          runRegisteredCommand(commandExecutionRunnerRef, "editor.formatSelection", () =>
            triggerEditorSurfaceCommand(editorApi, "editor.formatSelection"),
          ),
      }),
      editorApi.addAction({
        id: "mockor.quickFix",
        label: "Show Context Actions",
        keybindings: [
          ...keybinding("editor.quickFix"),
          monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.Period,
        ],
        run: () =>
          runRegisteredCommand(commandExecutionRunnerRef, "editor.quickFix", () =>
            triggerEditorSurfaceCommand(editorApi, "editor.quickFix"),
          ),
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
        run: () => triggerEditorAction(editorApi, "editor.action.smartSelect.shrink"),
      }),
      editorApi.addAction({
        id: "mockor.insertCursorAbove",
        label: "Add Caret Above",
        keybindings: keybinding("editor.insertCursorAbove"),
        run: () => triggerEditorAction(editorApi, "editor.action.insertCursorAbove"),
      }),
      editorApi.addAction({
        id: "mockor.insertCursorBelow",
        label: "Add Caret Below",
        keybindings: keybinding("editor.insertCursorBelow"),
        run: () => triggerEditorAction(editorApi, "editor.action.insertCursorBelow"),
      }),
      editorApi.addAction({
        id: "mockor.selectAllOccurrences",
        label: "Select All Occurrences",
        keybindings: keybinding("editor.selectAllOccurrences"),
        run: () => triggerEditorAction(editorApi, "editor.action.selectHighlights"),
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
        run: () => triggerEditorAction(editorApi, "editor.action.moveLinesUpAction"),
      }),
      editorApi.addAction({
        id: "mockor.moveLineDown",
        label: "Move Line Down",
        keybindings: keybinding("editor.moveLineDown"),
        run: () => triggerEditorAction(editorApi, "editor.action.moveLinesDownAction"),
      }),
      editorApi.addAction({
        id: "mockor.duplicateLine",
        label: "Duplicate Line or Selection",
        keybindings: keybinding("editor.duplicateLine"),
        run: () => triggerEditorAction(editorApi, "editor.action.copyLinesDownAction"),
      }),
      editorApi.addAction({
        id: "mockor.addSelectionToNextMatch",
        label: "Add Selection to Next Match",
        keybindings: keybinding("editor.addSelectionToNextMatch"),
        run: () => triggerEditorAction(editorApi, "editor.action.addSelectionToNextFindMatch"),
      }),
      editorApi.addAction({
        id: "mockor.deleteLine",
        label: "Delete Line",
        keybindings: keybinding("editor.deleteLine"),
        run: () => triggerEditorAction(editorApi, "editor.action.deleteLines"),
      }),
      editorApi.addAction({
        id: "mockor.joinLines",
        label: "Join Lines",
        keybindings: keybinding("editor.joinLines"),
        run: () => triggerEditorAction(editorApi, "editor.action.joinLines"),
      }),
      editorApi.addAction({
        id: "mockor.foldAll",
        label: "Fold All",
        keybindings: keybinding("editor.foldAll"),
        run: () => triggerEditorAction(editorApi, "editor.foldAll"),
      }),
      editorApi.addAction({
        id: "mockor.unfoldAll",
        label: "Unfold All",
        keybindings: keybinding("editor.unfoldAll"),
        run: () => triggerEditorAction(editorApi, "editor.unfoldAll"),
      }),
      editorApi.addAction({
        id: "mockor.foldRecursively",
        label: "Fold Recursively",
        keybindings: keybinding("editor.foldRecursively"),
        run: () => triggerEditorAction(editorApi, "editor.foldRecursively"),
      }),
      editorApi.addAction({
        id: "mockor.unfoldRecursively",
        label: "Unfold Recursively",
        keybindings: keybinding("editor.unfoldRecursively"),
        run: () => triggerEditorAction(editorApi, "editor.unfoldRecursively"),
      }),
      editorApi.addAction({
        id: "mockor.sortLinesAscending",
        label: "Sort Lines Ascending",
        keybindings: keybinding("editor.sortLinesAscending"),
        run: () => triggerEditorAction(editorApi, "editor.action.sortLinesAscending"),
      }),
      editorApi.addAction({
        id: "mockor.sortLinesDescending",
        label: "Sort Lines Descending",
        keybindings: keybinding("editor.sortLinesDescending"),
        run: () => triggerEditorAction(editorApi, "editor.action.sortLinesDescending"),
      }),
      editorApi.addAction({
        id: "mockor.toggleCase",
        label: "Toggle Case",
        keybindings: keybinding("editor.toggleCase"),
        run: () => triggerEditorAction(editorApi, "editor.action.transformToUppercase"),
      }),
      editorApi.addAction({
        id: "mockor.transformToLowercase",
        label: "Transform to Lowercase",
        keybindings: keybinding("editor.transformToLowercase"),
        run: () => triggerEditorAction(editorApi, "editor.action.transformToLowercase"),
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
        id: "mockor.cyclicExpandWord",
        label: "Cyclic Expand Word",
        keybindings: keybinding("editor.cyclicExpandWord"),
        run: () => {
          applyCyclicExpandWord(monacoApi, editorApi, hippieSessionRef);
        },
      }),
      editorApi.addAction({
        id: "mockor.closeTab",
        label: "Close Tab",
        keybindings: keybinding("editor.closeTab"),
        run: () =>
          runRegisteredCommand(commandExecutionRunnerRef, "editor.closeTab", () =>
            editorActionCommandPortRef.current.closeActiveTab(),
          ),
      }),
      editorApi.addAction({
        id: "mockor.goBack",
        label: "Go Back",
        keybindings: keybinding("navigation.back"),
        run: () =>
          runRegisteredCommand(commandExecutionRunnerRef, "navigation.back", () =>
            editorActionCommandPortRef.current.goBack(),
          ),
      }),
      editorApi.addAction({
        id: "mockor.goForward",
        label: "Go Forward",
        keybindings: keybinding("navigation.forward"),
        run: () =>
          runRegisteredCommand(commandExecutionRunnerRef, "navigation.forward", () =>
            editorActionCommandPortRef.current.goForward(),
          ),
      }),
      editorApi.addAction({
        id: "mockor.nextChange",
        label: "Go to Next Change",
        keybindings: keybinding("editor.nextChange"),
        run: () => requestRegisteredCommand(commandExecutionRunnerRef, "editor.nextChange"),
      }),
      editorApi.addAction({
        id: "mockor.previousChange",
        label: "Go to Previous Change",
        keybindings: keybinding("editor.previousChange"),
        run: () => requestRegisteredCommand(commandExecutionRunnerRef, "editor.previousChange"),
      }),
    ];

    return () => {
      disposables.forEach((disposable) => disposable?.dispose());
    };
  }, [
    customDefinitionNavigationEnabled,
    editorApi,
    keymap,
    managedJavaScriptTypeScriptDocumentActive,
    monacoApi,
  ]);

  useEffect(() => {
    if (!editorApi || !monacoApi) {
      return;
    }

    const disposables = registerConflictMarkerCodeActions(monacoApi, editorApi, {
      shouldInspectModel: (model) => !isLargeSmartModel(model, largeSmartDocumentPolicyRef.current),
    });

    return () => {
      disposables.forEach((disposable) => disposable.dispose());
    };
  }, [editorApi, monacoApi]);

  useConflictMarkerEditorDecorations({
    activeDocumentPath,
    activeDocumentRef,
    editor: editorApi,
    largeDocumentPolicyRef: largeSmartDocumentPolicyRef,
    ownerKey: editorSessionOwnerKey,
    surfaceId: generatedSurfaceId,
    workspaceIdentity: completeWorkspaceIdentityDescriptor,
    workspaceRoot,
    workspaceRootRef,
  });

  useEffect(() => {
    if (!editorApi || !monacoApi || !onCloseFloatingSurface) {
      return;
    }

    const disposable = editorApi.onKeyDown((event) => {
      if (event.keyCode !== monacoApi.KeyCode.Escape && event.browserEvent.key !== "Escape") {
        return;
      }

      if (!onCloseFloatingSurface()) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.browserEvent.preventDefault();
      event.browserEvent.stopPropagation();
    });

    return () => disposable.dispose();
  }, [editorApi, monacoApi, onCloseFloatingSurface]);

  useEditorMouseInteractions({
    activateEditorGroupFromInteraction,
    activeDocumentRef,
    changeHunksRef,
    commandExecutionRunnerRef,
    customDefinitionNavigationEnabled,
    editor: editorApi,
    editorActionCommandPortRef,
    gitBlameLinesRef,
    goToDefinition: onGoToDefinition,
    implementationGutterTargetsRef,
    monaco: monacoApi,
    onRevealGitBlameCommit,
    onRunTestAt,
    onToggleBookmarkAtLine,
    reportBreakpointMutationError,
    setChangePreview,
    testGutterTargetsRef,
    toggleBreakpointAction,
  });

  useEditorChangeDecorations({
    activeDocumentPath,
    changeDecorationIdsRef,
    changeHunks,
    editor: editorApi,
    monaco: monacoApi,
    workspaceRoot,
  });

  useEditorSourceControlDecorations({
    activeDocumentPath,
    activeDocumentRef,
    bookmarkedLineNumbers,
    bookmarkDecorationIdsRef,
    editor: editorApi,
    gitBlameDecoratedPathRef,
    gitBlameDecorationIdsRef,
    gitBlameEnabled,
    gitBlameLinesRef,
    monaco: monacoApi,
    provideGitBlameRef,
    workspaceRoot,
  });

  useChangePreviewEscapeLifecycle(changePreview, setChangePreview);

  // ONE debounced snapshot of the active PHP file's content, shared by the
  // implementation gutter, the test gutter and the syntax diagnostics. Each of
  // those used to arm its own independent 160ms `setTimeout` on every keystroke,
  // so a single edit fired three timers that each re-snapshotted the same
  // content and scheduled a redundant full-file parse on the main thread. Now a
  // single timer per edit publishes one snapshot and all three consumers react
  // to it. Gated to PHP documents (the union of the three consumers); the test
  // gutter applies its own narrower `isActiveDocumentPhpTest` gate downstream.
  const phpEditTick = useDebouncedPhpEditTick(
    activeDocument && activeDocument.language === "php" && !activeDocumentIsLargeSmart
      ? activeDocument.path
      : null,
    activeDocument && activeDocument.language === "php" && !activeDocumentIsLargeSmart
      ? activeDocument.content
      : null,
  );
  const jsTestEditTick = useDebouncedPhpEditTick(
    activeDocument && isActiveDocumentJsTest && !activeDocumentIsLargeSmart
      ? activeDocument.path
      : null,
    activeDocument && isActiveDocumentJsTest && !activeDocumentIsLargeSmart
      ? activeDocument.content
      : null,
  );
  const testEditTick = isActiveDocumentJsTest ? jsTestEditTick : phpEditTick;
  const applyLocalPhpDiagnostics = useCallback(
    async (
      path: string,
      content: string,
      model: Monaco.editor.ITextModel,
      isActive: () => boolean = () => true,
    ): Promise<boolean> => {
      if (!monacoApi || !runtime) {
        return false;
      }

      const version = typeof model.getVersionId === "function" ? model.getVersionId() : 0;
      const validationKey = `${path}\0${model.uri.toString()}\0${version}\0${content}`;

      if (
        pendingLocalPhpValidationRef.current?.key === validationKey &&
        pendingLocalPhpValidationRef.current.model === model
      ) {
        return false;
      }

      const pendingValidation = { key: validationKey, model };
      pendingLocalPhpValidationRef.current = pendingValidation;

      try {
        const coordinated = runtime.coordinateLocalPhpValidation<
          PhpSyntaxDiagnostic,
          PhpInspectionDiagnostic
        >(
          {
            consumerId: generatedSurfaceId,
            content,
            documentPath: path,
            modelUri: model.uri.toString(),
            version,
            workspaceRoot: workspaceRoot ?? "",
          },
          () => {
            const structuralDiagnostics = structuralPhpSyntaxDiagnostics(content);
            const suspiciousDiagnostics = suspiciousPhpBareIdentifierDiagnostics(content);
            const immediateSyntaxDiagnostics = [...structuralDiagnostics, ...suspiciousDiagnostics];
            const immediateInspectionDiagnostics = phpInspectionDiagnostics(content);

            return {
              immediate: {
                inspectionDiagnostics: immediateInspectionDiagnostics,
                syntaxDiagnostics: immediateSyntaxDiagnostics,
              },
              result: phpSyntaxDiagnosticsGateway.validate(content).then((diagnostics) => ({
                inspectionDiagnostics: immediateInspectionDiagnostics,
                syntaxDiagnostics: [
                  ...diagnostics,
                  ...(diagnostics.length === 0 ? structuralDiagnostics : []),
                  ...suspiciousDiagnostics,
                ],
              })),
            };
          },
        );

        if (isActive()) {
          applyLocalPhpValidationSnapshot(
            coordinated.immediate,
            monacoApi,
            path,
            (markers) =>
              runtime.writeLocalPhpMarkers(generatedSurfaceId, monacoApi, model, markers),
            onLocalPhpDiagnosticsChange,
            setSyntaxDiagnosticsByPath,
            setPhpInspectionDiagnosticCountsByPath,
          );
        }

        const result = await coordinated.result;

        if (!result || !isActive()) {
          return false;
        }

        applyLocalPhpValidationSnapshot(
          result,
          monacoApi,
          path,
          (markers) => runtime.writeLocalPhpMarkers(generatedSurfaceId, monacoApi, model, markers),
          onLocalPhpDiagnosticsChange,
          setSyntaxDiagnosticsByPath,
          setPhpInspectionDiagnosticCountsByPath,
        );

        return true;
      } catch (error) {
        errorReporterRef.current(error);
        return false;
      } finally {
        if (pendingLocalPhpValidationRef.current === pendingValidation) {
          pendingLocalPhpValidationRef.current = null;
        }
      }
    },
    [
      monacoApi,
      onLocalPhpDiagnosticsChange,
      phpSyntaxDiagnosticsGateway,
      runtime,
      generatedSurfaceId,
      workspaceRoot,
    ],
  );

  useEditorGutterDecorations({
    activeDocumentLanguage,
    activeDocumentPath,
    editor: editorApi,
    implementationDecoratedPathRef: implementationGutterDecoratedPathRef,
    implementationDecorationIdsRef: implementationGutterDecorationIdsRef,
    implementationTargetsRef: implementationGutterTargetsRef,
    isActiveDocumentJsTest,
    isActiveDocumentPhpTest,
    monaco: monacoApi,
    phpEditTick,
    testDecoratedPathRef: testGutterDecoratedPathRef,
    testDecorationIdsRef: testGutterDecorationIdsRef,
    testEditTick,
    testTargetsRef: testGutterTargetsRef,
    workspaceRoot,
  });

  useEditorNavigationLifecycle({
    activeDocument,
    activeDocumentContentReady,
    editor: editorApi,
    editorRevealTarget,
    groupId,
    isOpeningFile,
    onRevealTargetHandled,
    previousActiveDocumentPathRef,
    previousTransientWidgetDismissKeyRef,
    runtime,
    transientWidgetDismissKey,
    workspaceRoot,
  });

  useEditorActiveModelLifecycle({
    activeDocumentContent,
    activeDocumentContentReady,
    activeDocumentPath,
    activeDocumentRef,
    backgroundTokenizerRef,
    editor: editorApi,
    editorConfig,
    generatedSurfaceId,
    groupId,
    isOpeningFile,
    largeSmartDocumentPolicyRef,
    monaco: monacoApi,
    runtime,
    runtimeRegistrationRef,
    workspaceRoot,
    workspaceRootRef,
  });

  useEditorModelViewStateLifecycle({
    activeDocumentPath,
    captureEnabled: editorViewStateCaptureEnabled,
    editor: editorApi,
    onViewStateChangeRef: onEditorViewStateChangeRef,
    restoredViewStateRevision,
    restoredViewStates,
    workspaceRoot,
  });

  useEffect(() => {
    if (
      !activeDocumentPath ||
      activeDocumentLanguage !== "php" ||
      activeDocumentIsLargeSmart ||
      !editorApi
    ) {
      return;
    }

    let active = true;
    let validatedModel: Monaco.editor.ITextModel | null = null;
    const validateActiveModel = () => {
      const model = editorApi.getModel();

      if (!model || !modelMatchesProject(model, workspaceRoot, activeDocumentPath)) {
        return;
      }

      if (validatedModel === model) {
        return;
      }

      const isCurrentModel = () =>
        active &&
        editorApi.getModel() === model &&
        modelMatchesProject(model, workspaceRoot, activeDocumentPath);

      void applyLocalPhpDiagnostics(
        activeDocumentPath,
        model.getValue(),
        model,
        isCurrentModel,
      ).then((wasApplied) => {
        if (wasApplied && isCurrentModel()) {
          validatedModel = model;
        }
      });
    };

    validateActiveModel();

    const modelChangeDisposable = editorApi.onDidChangeModel(() => {
      validateActiveModel();
    });
    const retryTimers = [80, 240].map((delay) => window.setTimeout(validateActiveModel, delay));

    return () => {
      active = false;
      modelChangeDisposable.dispose();
      retryTimers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [
    activeDocumentLanguage,
    activeDocumentPath,
    activeDocumentIsLargeSmart,
    applyLocalPhpDiagnostics,
    editorApi,
    workspaceRoot,
  ]);

  useEffect(() => {
    if (!activeDocumentPath || activeDocumentLanguage !== "php") {
      return;
    }

    recoverVisibleLocalPhpDiagnostics();
    const retryTimers = [80, 240, 600].map((delay) =>
      window.setTimeout(recoverVisibleLocalPhpDiagnostics, delay),
    );

    return () => {
      retryTimers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [activeDocumentLanguage, activeDocumentPath, recoverVisibleLocalPhpDiagnostics]);

  useEditorModelCachePruning({
    activeDocumentPath: activeDocumentPath ?? null,
    breadcrumbSymbolsByPath,
    monaco: monacoApi,
    onLocalPhpDiagnosticsChange,
    phpInspectionDiagnosticCountsByPath,
    setBreadcrumbSymbolsByPath,
    setPhpInspectionDiagnosticCountsByPath,
    setSyntaxDiagnosticsByPath,
    syntaxDiagnosticsByPath,
    workspaceAuthority: workspaceIdentityDescriptor,
    workspaceRoot,
  });

  useEffect(() => {
    if (activeDocument?.language === "php") {
      return;
    }

    if (activeDocument?.path) {
      onLocalPhpDiagnosticsChange(activeDocument.path, []);
    }
  }, [activeDocument?.language, activeDocument?.path, onLocalPhpDiagnosticsChange]);

  useEffect(() => {
    if (!activeDocumentPath || !activeDocumentLanguage || !editorApi || !monacoApi) {
      return;
    }

    const model = editorApi.getModel();

    if (!model || !modelMatchesProject(model, workspaceRoot, activeDocumentPath)) {
      return;
    }

    const languageServerDiagnostics = languageServerDiagnosticsByPath[activeDocumentPath] ?? [];
    const syntaxDiagnostics =
      activeDocumentLanguage === "php" ? (syntaxDiagnosticsByPath[activeDocumentPath] ?? []) : [];
    const phpInspectionDiagnosticCount =
      activeDocumentLanguage === "php"
        ? (phpInspectionDiagnosticCountsByPath[activeDocumentPath] ?? 0)
        : 0;

    // Monaco's content hover widget is mouse-driven and is NOT dismissed when its
    // markers are removed, so a hover left open over a diagnostic (error/warning
    // message) stays pinned showing now-invalid text after the file is fixed or
    // re-validated and the diagnostic disappears. When the active document's total
    // diagnostic count drops for the *same* path, dismiss the open hover so it can
    // never linger as stale info; the next mouse hover re-opens it with fresh
    // content. Comparison is keyed on path (not a switch to another file) and on a
    // real count *decrease* (not a no-op keystroke), so the hover is never hidden
    // gratuitously. Isolation: only the model that belongs to the active document
    // is touched (the path match above), so a stale tab can never dismiss the
    // active editor's hover.
    const activeDiagnosticCount =
      languageServerDiagnostics.length + syntaxDiagnostics.length + phpInspectionDiagnosticCount;
    const previousActiveDiagnostics = previousActiveDiagnosticCountRef.current;
    const diagnosticsClearedForActivePath =
      previousActiveDiagnostics !== null &&
      previousActiveDiagnostics.path === activeDocumentPath &&
      activeDiagnosticCount < previousActiveDiagnostics.count;

    if (diagnosticsClearedForActivePath) {
      editorApi.trigger("diagnostics", "editor.action.hideHover", {});
    }

    previousActiveDiagnosticCountRef.current = {
      count: activeDiagnosticCount,
      path: activeDocumentPath,
    };

    diagnosticOverviewDecorationIdsRef.current = editorApi.deltaDecorations(
      diagnosticOverviewDecorationIdsRef.current,
      toBoundedDiagnosticOverviewDecorations(
        monacoApi,
        languageServerDiagnostics,
        syntaxDiagnostics,
      ),
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
    activeDocumentPath,
    activeDocumentLanguage,
    editorApi,
    languageServerDiagnosticsByPath,
    monacoApi,
    phpInspectionDiagnosticCountsByPath,
    syntaxDiagnosticsByPath,
    workspaceRoot,
  ]);

  // Synchronously clears the PHP syntax markers + cached diagnostics when the
  // active document is not (or stops being) PHP, or when it is too large for
  // live smart features. The debounced re-validation for normal PHP documents
  // is driven by the shared `phpEditTick` below.
  useEffect(() => {
    if (!monacoApi) {
      return;
    }

    if (!activeDocumentPath) {
      return;
    }

    if (activeDocumentLanguage === "php" && !activeDocumentIsLargeSmart) {
      return;
    }

    const model = modelForPath(monacoApi, workspaceRoot, activeDocumentPath);

    if (!model) {
      return;
    }

    runtime?.writeLocalPhpMarkers(generatedSurfaceId, monacoApi, model, []);
    onLocalPhpDiagnosticsChangeRef.current(activeDocumentPath, []);
    setSyntaxDiagnosticsByPath((current) => {
      if (!current[activeDocumentPath]) {
        return current;
      }

      const next = { ...current };
      delete next[activeDocumentPath];
      return next;
    });
    setPhpInspectionDiagnosticCountsByPath((current) => {
      if (current[activeDocumentPath] === undefined) {
        return current;
      }

      const next = { ...current };
      delete next[activeDocumentPath];
      return next;
    });
  }, [
    activeDocumentLanguage,
    activeDocumentPath,
    activeDocumentIsLargeSmart,
    monacoApi,
    generatedSurfaceId,
    runtime,
    workspaceRoot,
  ]);

  // The debounced PHP syntax validation, driven by the shared `phpEditTick` (one
  // 160ms timer per edit for all PHP gutter/diagnostics consumers). The `active`
  // flag drops a resolved validation whose tick has since changed or unmounted,
  // and the model is re-resolved from the tick's path so a stale tab's snapshot
  // can never mark the active model.
  useEffect(() => {
    if (!monacoApi || !phpEditTick) {
      return;
    }

    let active = true;
    const model = modelForPath(monacoApi, workspaceRoot, phpEditTick.path);
    if (!model || !editorApi) {
      return;
    }

    const isCurrentModel = () =>
      active &&
      editorApi.getModel() === model &&
      modelMatchesProject(model, workspaceRoot, phpEditTick.path);

    applyLocalPhpDiagnostics(phpEditTick.path, phpEditTick.content, model, isCurrentModel);

    return () => {
      active = false;
    };
  }, [applyLocalPhpDiagnostics, editorApi, monacoApi, phpEditTick, workspaceRoot]);

  const breadcrumbSymbols = activeDocumentPath
    ? (breadcrumbSymbolsByPath[activeDocumentPath] ?? EMPTY_BREADCRUMB_SYMBOLS)
    : EMPTY_BREADCRUMB_SYMBOLS;
  const cursorLineNumber = cursorPosition?.lineNumber;
  const cursorColumn = cursorPosition?.column;
  return useEditorSurfacePresentation({
    activateEditorGroupFromInteraction,
    activeDocument,
    activeDocumentContentReady,
    activeDocumentIsLargeSmart,
    activeDocumentLargeSmartMode,
    beforeMountTheme: monacoTheme,
    breakpointActions,
    breakpoints,
    breadcrumbSymbols,
    changeHunksRef,
    changePreview,
    cursorColumn,
    cursorLineNumber,
    cursorStore,
    cursorTrackingActive,
    editor: editorApi,
    editorFontFamily,
    editorFontSize,
    editorSessionOwnerKey,
    embeddedInGroupPanel,
    formatOnPaste,
    groupId,
    handleMount,
    isOpeningFile,
    minimapEnabled,
    modelIdentity: currentBreakpointModel,
    monaco: monacoApi,
    monacoFontLigatures,
    onMutationError: reportBreakpointMutationError,
    onRevertChangeHunk,
    runtime,
    runtimeMembershipGroupId: runtimeMembership?.groupId,
    setChangePreview,
    setSurroundWithRequest,
    surroundWithRequest,
    toggleBreakpointFallback: onToggleBreakpoint,
    wordWrapEnabled,
    workspaceRoot,
  });
}

// IDE events (index progress, runtime status, …) re-render App without touching
// the editor's props. memo lets the surface skip those renders, re-rendering
// only when one of its props actually changes (active document, diagnostics, …).
const MemoizedEditorSurfaceComponent = memo(EditorSurfaceComponent);

export const EditorSurface = memo(function EditorSurface(props: EditorSurfaceProps) {
  const runtime = useEditorRuntimeContext();

  if (runtime) {
    return <MemoizedEditorSurfaceComponent {...props} />;
  }

  return (
    <EditorRuntimeHost>
      <MemoizedEditorSurfaceComponent {...props} />
    </EditorRuntimeHost>
  );
});
