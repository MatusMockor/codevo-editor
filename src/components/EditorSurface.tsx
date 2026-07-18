import Editor from "@monaco-editor/react";
import type { OnMount } from "@monaco-editor/react";
import { ChevronDown, ChevronUp, RotateCcw, X } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useId,
  type CSSProperties,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type * as Monaco from "monaco-editor";
import type {
  EditorChangeHunk,
  EditorChangeKind,
} from "../domain/editorChangeMarkers";
import type {
  CommandContext,
  CommandExecutionRunner,
} from "../application/commandRegistry";
import type { NavigationRequest } from "../application/navigationRequest";
import type { PhpCodeActionWorkspaceEditApplier } from "../application/phpCodeActionTypes";
import {
  nextEditorSelectionExpansionRange,
  type EditorSelectionTextRange,
} from "../domain/editorSelectionRanges";
import type {
  EditorMenuCommand,
  EditorMenuCommandRunner,
} from "../domain/editorMenuCommand";
import type {
  EditorSurfaceCommandId,
  EditorSurfaceCommandInvocationScope,
  EditorSurfaceCommandRunner,
} from "../domain/editorSurfaceCommand";
import { editorSurfaceCommandInvocationScopesEqual } from "../domain/editorSurfaceCommand";
import { createWorkspaceEditorSessionOwnerKey } from "../domain/editorSessionOwnerKey";
import {
  applicableEslintFixes,
  type EslintFix,
} from "../domain/eslintDiagnostics";
import type {
  EditorSurfaceBufferFixRunner,
  EditorSurfacePhpstanIgnoreRunner,
} from "../application/useWorkbenchCodeQualityDiagnostics";
import type { EditorSurfaceEslintDisableRunner } from "../application/workbenchEslintDisableCommand";
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
  defaultShortcutForCommand,
  detectKeymapPlatform,
  keymapCommandIdForShortcut,
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
import {
  defaultLargeSmartDocumentPolicy,
  isLargeSmartDocument,
  normalizeLargeSmartDocumentPolicy,
  type LargeSmartDocumentPolicy,
} from "../domain/largeDocumentPolicy";
import { Breadcrumbs } from "./Breadcrumbs";
import { SurroundWithPicker } from "./SurroundWithPicker";
import {
  surroundWithSnippet,
  type SurroundWithTemplateId,
} from "../domain/surroundWith";
import { completePhpStatement } from "../domain/phpCompleteStatement";
import {
  advanceHippieSession,
  startHippieSession,
  type HippieSession,
} from "../domain/hippieCompletion";
import {
  phpMoveStatement,
  type MoveStatementDirection,
} from "../domain/phpMoveStatement";
import type { Breakpoint } from "../domain/debug";
import type { LanguageServerDiagnostic } from "../domain/languageServerDiagnostics";
import {
  gitBlameAnnotation,
  isUncommittedBlameLine,
  type GitBlameLine,
} from "../domain/git";
import { jsGutterTargetsCoordinator } from "../domain/jsGutterTargetsCoordinator";
import { phpGutterTargetsCoordinator } from "../domain/phpGutterTargetsCoordinator";
import type { PhpTestGutterTarget } from "../domain/phpTestGutterTargets";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
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
import type {
  PhpMethodCompletion,
  PhpMethodSignature,
} from "../domain/phpMethodCompletions";
import type { PhpParameterNameInlayHint } from "../domain/phpInlayHints";
import {
  phpMemberAccessCompletionContextAt,
  phpStaticAccessCompletionContextAt,
} from "../domain/phpMethodCompletions";
import { isDirty, type EditorDocument } from "../domain/workspace";
import {
  editorConfigEol,
  editorConfigFormattingOptions,
  type ResolvedEditorConfig,
} from "../domain/editorConfig";
import type { UserSnippet } from "../domain/snippets";
import {
  defaultEditorFontFamily,
  defaultEditorFontLigatures,
  defaultEditorFontSize,
  monacoFontLigaturesForEditorSetting,
  type MonacoAppTheme,
  type WorkspaceSessionViewState,
} from "../domain/settings";
import {
  type JavaScriptTypeScriptWorkspaceEditApplicationContext,
} from "./javascriptTypescriptLanguageServerMonacoProviders";
import {
  type LanguageServerMonacoDocumentRequestLease,
  type PhpCodeActionDescriptor,
  type PhpCodeActionNewFile,
  type PhpCodeActionRange,
  type PhpWorkspaceEditApplicationContext,
} from "./languageServerMonacoProviders";
import type { WorkspaceEditApplicationDecision } from "../application/workspaceEditApplication";
import {
  conflictMarkerDecorations,
  registerConflictMarkerCodeActions,
} from "../application/conflictMarkerCodeActions";
import type { EditorSurfaceLanguageProviderRegistrationRefs } from "./useEditorSurfaceLanguageProviderRegistration";
import {
  EditorRuntimeHost,
  useEditorRuntimeContext,
  type EditorRuntimeSurfaceRegistration,
  type LocalPhpValidationSnapshot,
} from "./EditorRuntimeHost";
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
import {
  applyImmediateFallbackTheme,
  configureShikiLanguageFeatures,
  setupShikiTokenization,
} from "../infrastructure/shikiHighlighter";
import { setupEmmet } from "../infrastructure/emmetSetup";
import { loadJsonSchemaForDocument } from "../infrastructure/jsonSchemaLoader";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import { getTabId, getTabPanelId } from "./tabIds";
import {
  modelMatchesWorkspacePath,
  modelPath,
  type WorkspaceIdentityDescriptor,
  workspaceModelUri,
} from "./phpMonacoDocumentContext";

interface ChangePreviewState {
  anchorLineNumber: number;
  hunk: EditorChangeHunk;
}

function shouldTriggerLatteMemberSuggest(
  language: EditorDocument["language"],
  model: Monaco.editor.ITextModel,
  position: EditorPosition,
  changes: readonly { text: string }[],
): boolean {
  if (language !== "latte") {
    return false;
  }

  if (!changes.some((change) => /[\w>-]/.test(change.text))) {
    return false;
  }

  const linePrefix = model
    .getLineContent(position.lineNumber)
    .slice(0, Math.max(0, position.column - 1));
  const lastOpenBrace = linePrefix.lastIndexOf("{");
  const lastCloseBrace = linePrefix.lastIndexOf("}");

  if (lastOpenBrace <= lastCloseBrace) {
    return false;
  }

  return /\$[A-Za-z_]\w*(?:\[[^\]]+\]|\->[A-Za-z_]\w*)*->\w*$/.test(
    linePrefix.slice(lastOpenBrace + 1),
  );
}

type IncompleteWorkspaceIdentityDescriptor =
  | { canonicalRoot?: string; workspaceId?: undefined }
  | { canonicalRoot?: undefined; workspaceId?: string };

export interface EditorSurfaceProps {
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
  changeHunks: EditorChangeHunk[];
  debugStoppedLocation?: { filePath: string; lineNumber: number } | null;
  editorRevealTarget: EditorRevealTarget | null;
  flushPendingJavaScriptTypeScriptLanguageServerDocument?(
    path: string,
  ): Promise<void>;
  flushPendingLanguageServerDocument(path: string): Promise<void>;
  getLanguageServerDocumentLifecycleIdentity?(
    rootPath: string,
    path: string,
  ): number | null;
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
  javaScriptTypeScriptLanguageServerFeaturesGateway?: LanguageServerFeaturesGateway;
  javaScriptTypeScriptLanguageServerRefreshGateway?: LanguageServerRefreshGateway;
  javaScriptTypeScriptLanguageServerRuntimeStatus?: LanguageServerRuntimeStatus | null;
  javaScriptTypeScriptLanguageServerWorkspaceEditGateway?: LanguageServerWorkspaceEditGateway;
  javaScriptTypeScriptCompleteFunctionCalls?: boolean;
  javaScriptTypeScriptValidationEnabled?: boolean;
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
  transientWidgetDismissKey?: string;
  phpInlayHintsEnabled?: boolean;
  phpIdeReadinessVersion?: number;
  phpLanguageServerWorkspaceEditGateway?: LanguageServerWorkspaceEditGateway;
  userSnippets?: readonly UserSnippet[];
  workspaceRoot?: string | null;
  workspaceIdentityDescriptor?:
    | WorkspaceIdentityDescriptor
    | IncompleteWorkspaceIdentityDescriptor
    | null;
  onCloseActiveTab(): void;
  onCursorPositionChange(position: EditorPosition): void;
  onEditorViewStateChange?(
    path: string,
    viewState: WorkspaceSessionViewState,
  ): void;
  onEditorMenuCommandRunnerChange?(runner: EditorMenuCommandRunner | null): void;
  onEditorSurfaceCommandRunnerChange?(
    runner: EditorSurfaceCommandRunner | null,
  ): void;
  onEditorSurfaceBufferFixRunnerChange?(
    runner: EditorSurfaceBufferFixRunner | null,
  ): void;
  onEditorSurfaceEslintDisableRunnerChange?(
    runner: EditorSurfaceEslintDisableRunner | null,
  ): void;
  onEditorSurfacePhpstanIgnoreRunnerChange?(
    runner: EditorSurfacePhpstanIgnoreRunner | null,
  ): void;
  onGoBack(): void;
  onGoForward(): void;
  onGoToDefinition(): void;
  onGoToImplementationAt(position: EditorPosition): void;
  onGoToSuperMethod(): void;
  onCloseFloatingSurface?(): boolean;
  onRunTestAt?(target: PhpTestGutterTarget): void;
  onToggleBookmarkAtLine?(lineNumber: number): void;
  onToggleBreakpoint?(filePath: string, lineNumber: number): void;
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
  onOpenWorkspaceFile?(
    path: string,
    request: EditorQaOpenWorkspaceFileRequest,
  ): Promise<boolean>;
  onOpenWorkspaceRoot?(path: string): Promise<boolean>;
  onOpenFileStructure(): void;
  onChange(content: string): void;
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
  onRecordCompletionLatency?(durationMs: number, rootPath?: string): void;
  onLocalPhpDiagnosticsChange?(
    path: string,
    diagnostics: LanguageServerDiagnostic[],
  ): void;
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

interface FoldingRegionViewState {
  isCollapsed: boolean;
  regionIndex: number;
  startLineNumber: number;
}

interface FoldingModelViewState {
  onDidChange(listener: () => void): Monaco.IDisposable;
  regions: {
    getStartLineNumber(index: number): number;
    isCollapsed(index: number): boolean;
    length: number;
    toRegion(index: number): FoldingRegionViewState;
  };
  toggleCollapseState(regions: FoldingRegionViewState[]): void;
}

interface FoldingControllerViewState {
  getFoldingModel(): Promise<FoldingModelViewState | null> | null;
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
  changeHunks,
  debugStoppedLocation = null,
  editorRevealTarget,
  flushPendingJavaScriptTypeScriptLanguageServerDocument = async () => undefined,
  flushPendingLanguageServerDocument,
  getLanguageServerDocumentLifecycleIdentity,
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
  javaScriptTypeScriptLanguageServerFeaturesGateway = languageServerFeaturesGateway,
  javaScriptTypeScriptLanguageServerRefreshGateway,
  javaScriptTypeScriptLanguageServerRuntimeStatus = null,
  javaScriptTypeScriptLanguageServerWorkspaceEditGateway,
  javaScriptTypeScriptCompleteFunctionCalls = false,
  javaScriptTypeScriptValidationEnabled = true,
  keymap,
  monacoTheme,
  runCommand,
  navigationHistoryPaths = EMPTY_PATHS,
  openDocumentPaths = EMPTY_PATHS,
  runtimeMembership,
  restoredViewStates = {},
  restoredViewStateRevision = 0,
  transientWidgetDismissKey,
  phpInlayHintsEnabled = true,
  phpIdeReadinessVersion = 0,
  phpLanguageServerWorkspaceEditGateway,
  userSnippets = EMPTY_USER_SNIPPETS,
  workspaceRoot = null,
  workspaceIdentityDescriptor = null,
  onCloseActiveTab,
  onCursorPositionChange,
  onEditorViewStateChange,
  onEditorMenuCommandRunnerChange,
  onEditorSurfaceCommandRunnerChange,
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
  const [editorApi, setEditorApi] =
    useState<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const surfaceIdentityRef = useRef<object>({});
  const activeDocumentRef = useRef(activeDocument);
  const workspaceRootRef = useRef(workspaceRoot);
  activeDocumentRef.current = activeDocument;
  workspaceRootRef.current = workspaceRoot;
  const completeWorkspaceIdentityDescriptor =
    resolveCompleteWorkspaceIdentityDescriptor(workspaceIdentityDescriptor);
  const editorSessionOwnerKey = useMemo(() => {
    if (!workspaceRoot) {
      return null;
    }

    return createWorkspaceEditorSessionOwnerKey(
      workspaceRoot,
      workspaceIdentityDescriptor,
    );
  }, [workspaceIdentityDescriptor, workspaceRoot]);
  const captureEditorSurfaceScope = useCallback(
    (): EditorSurfaceCommandInvocationScope | null => {
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
  const monacoFontLigatures =
    monacoFontLigaturesForEditorSetting(editorFontLigatures);
  const commandExecutionRunnerRef = useRef<CommandExecutionRunner | undefined>(
    undefined,
  );
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
    hasWorkspace: Boolean(workspaceRoot),
    hasActiveDocument: Boolean(activeDocument),
    activeDocumentDirty: Boolean(
      activeDocument && !activeDocument.readOnly && isDirty(activeDocument),
    ),
    editorSurfaceScope: captureEditorSurfaceScope() ?? undefined,
  };
  commandExecutionRunnerRef.current = runCommand
    ? (commandId) => runCommand(commandId, surfaceCommandContext)
    : undefined;
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
  const previousActiveDocumentPathRef = useRef<string | null>(
    activeDocument?.path ?? null,
  );
  const previousTransientWidgetDismissKeyRef = useRef(transientWidgetDismissKey);
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
  const largeSmartDocumentPolicyRef = useRef(largeSmartDocumentPolicy);
  const javaScriptTypeScriptRuntimeStatusRef = useRef(
    javaScriptTypeScriptLanguageServerRuntimeStatus,
  );
  const flushPendingRef = useRef(flushPendingLanguageServerDocument);
  const getLanguageServerDocumentLifecycleIdentityRef = useRef(
    getLanguageServerDocumentLifecycleIdentity,
  );
  const requestLanguageServerDocumentLeaseRef = useRef(
    requestLanguageServerDocumentLease,
  );
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
  const openWorkspaceFileRef = useRef(onOpenWorkspaceFile);
  const openWorkspaceRootRef = useRef(onOpenWorkspaceRoot);
  const isLanguageServerDocumentSyncedRef = useRef(
    isLanguageServerDocumentSynced,
  );
  const changeDecorationIdsRef = useRef<string[]>([]);
  const conflictMarkerDecorationIdsRef = useRef<string[]>([]);
  // Tracks whether persistent column-selection mode is on so the toggle action
  // flips it. Per-editor state (one EditorSurface instance per tab), so it never
  // leaks between open project tabs.
  const columnSelectionEnabledRef = useRef(false);
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
  const breakpointDecorationIdsRef = useRef<string[]>([]);
  const debugStoppedDecorationIdsRef = useRef<string[]>([]);
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
  const languageServerDiagnosticsByPathRef = useRef(
    languageServerDiagnosticsByPath,
  );
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
  const clearLanguageServerDiagnosticsForPathRef = useRef(
    clearLanguageServerDiagnosticsForPath,
  );
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
  const [
    phpInspectionDiagnosticCountsByPath,
    setPhpInspectionDiagnosticCountsByPath,
  ] = useState<Record<string, number>>({});
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
  const activeDocumentIsLargeSmart = useMemo(
    () =>
      activeDocument
        ? isLargeSmartDocument(activeDocument, largeSmartDocumentPolicy)
        : false,
    [
      activeDocument?.content,
      largeSmartDocumentPolicy.characterLimit,
      largeSmartDocumentPolicy.lineLimit,
    ],
  );

  // A document switch must never apply a wrap meant for the previous file, so
  // any pending Surround With request is dropped when the active document
  // changes. The cyclic-expand-word (hippie) session is dropped for the same
  // reason: its anchor offset and candidate list belong to the previous file.
  useEffect(() => {
    setSurroundWithRequest(null);
    hippieSessionRef.current = null;
  }, [activeDocument?.path]);

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
    largeSmartDocumentPolicyRef.current = largeSmartDocumentPolicy;
  }, [largeSmartDocumentPolicy]);

  useEffect(() => {
    javaScriptTypeScriptRuntimeStatusRef.current =
      javaScriptTypeScriptLanguageServerRuntimeStatus;
  }, [javaScriptTypeScriptLanguageServerRuntimeStatus]);

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
    if (
      !monacoApi ||
      !activeDocument ||
      activeDocument.language !== "json" ||
      !readWorkspaceFile
    ) {
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

  useEffect(() => {
    flushPendingRef.current = flushPendingLanguageServerDocument;
  }, [flushPendingLanguageServerDocument]);
  useEffect(() => {
    getLanguageServerDocumentLifecycleIdentityRef.current =
      getLanguageServerDocumentLifecycleIdentity;
  }, [getLanguageServerDocumentLifecycleIdentity]);
  useEffect(() => {
    requestLanguageServerDocumentLeaseRef.current =
      requestLanguageServerDocumentLease;
  }, [requestLanguageServerDocumentLease]);
  useEffect(() => {
    isLanguageServerDocumentRequestLeaseCurrentRef.current =
      isLanguageServerDocumentRequestLeaseCurrent;
  }, [isLanguageServerDocumentRequestLeaseCurrent]);

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
    recordCompletionLatencyRef.current = onRecordCompletionLatency;
  }, [onRecordCompletionLatency]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    openWorkspaceFileRef.current = onOpenWorkspaceFile;
  }, [onOpenWorkspaceFile]);

  useEffect(() => {
    openWorkspaceRootRef.current = onOpenWorkspaceRoot;
  }, [onOpenWorkspaceRoot]);

  useEffect(() => {
    isLanguageServerDocumentSyncedRef.current = isLanguageServerDocumentSynced;
  }, [isLanguageServerDocumentSynced]);

  useEffect(() => {
    languageServerDiagnosticsByPathRef.current = languageServerDiagnosticsByPath;
  }, [languageServerDiagnosticsByPath]);

  useEffect(() => {
    phpCodeActionsRef.current = providePhpCodeActions;
  }, [providePhpCodeActions]);

  useEffect(() => {
    openPhpChangeSignatureRef.current = onOpenPhpChangeSignature;
  }, [onOpenPhpChangeSignature]);

  useEffect(() => {
    applyPhpCodeActionNewFileRef.current = applyPhpCodeActionNewFile;
  }, [applyPhpCodeActionNewFile]);

  useEffect(() => {
    clearLanguageServerDiagnosticsForPathRef.current =
      clearLanguageServerDiagnosticsForPath;
  }, [clearLanguageServerDiagnosticsForPath]);

  useEffect(() => {
    pendingLocalPhpValidationRef.current = null;
  }, [activeDocument?.path]);

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
    userSnippetsRef.current = userSnippets;
  }, [userSnippets]);

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

    if (!model || !position || !modelMatchesProject(model, workspaceRoot, activeDocument.path)) {
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
    activeDocument?.path,
    activeDocument?.language,
    editorApi,
    phpIdeReadinessVersion,
    providePhpMethodCompletions,
    workspaceRoot,
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

      if (!model || !modelMatchesProject(model, workspaceRoot, targetPath)) {
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
  }, [activeDocument?.path, editorApi, onEditorMenuCommandRunnerChange, workspaceRoot]);

  useEffect(() => {
    if (!onEditorSurfaceCommandRunnerChange) {
      return;
    }

    if (!editorApi || !activeDocument) {
      onEditorSurfaceCommandRunnerChange(null);
      return;
    }

    const publishRunner = () => {
      onEditorSurfaceCommandRunnerChange(
        createEditorSurfaceCommandRunner({
          captureScope: captureEditorSurfaceScope,
          changeHunksRef,
          editor: editorApi,
        }),
      );
    };

    publishRunner();
    const modelChangeDisposable = editorApi.onDidChangeModel(publishRunner);

    return () => {
      modelChangeDisposable.dispose();
      onEditorSurfaceCommandRunnerChange(null);
    };
  }, [
    activeDocument?.path,
    captureEditorSurfaceScope,
    editorApi,
    onEditorSurfaceCommandRunnerChange,
  ]);

  useEffect(() => {
    if (!onEditorSurfaceBufferFixRunnerChange) {
      return;
    }

    if (!editorApi || !monacoApi || !activeDocument) {
      onEditorSurfaceBufferFixRunnerChange(null);
      return;
    }

    const targetPath = activeDocument.path;
    const runner: EditorSurfaceBufferFixRunner = (expectedContent, fixes) => {
      const model = editorApi.getModel();

      if (!model || !modelMatchesProject(model, workspaceRoot, targetPath)) {
        return null;
      }

      if (model.getValue() !== expectedContent) {
        return null;
      }

      const applicable = applicableEslintFixes(expectedContent, fixes);

      if (applicable.length === 0) {
        return 0;
      }

      const edits = applicable.map((fix: EslintFix) => {
        const start = model.getPositionAt(fix.range[0]);
        const end = model.getPositionAt(fix.range[1]);

        return {
          forceMoveMarkers: true,
          range: new monacoApi.Range(
            start.lineNumber,
            start.column,
            end.lineNumber,
            end.column,
          ),
          text: fix.text,
        };
      });

      if (!editorApi.executeEdits("eslint.fixAllInActiveFile", edits)) {
        return null;
      }

      return applicable.length;
    };

    onEditorSurfaceBufferFixRunnerChange(runner);

    return () => {
      onEditorSurfaceBufferFixRunnerChange(null);
    };
  }, [
    activeDocument?.path,
    editorApi,
    monacoApi,
    onEditorSurfaceBufferFixRunnerChange,
    workspaceRoot,
  ]);

  useEffect(() => {
    if (!onEditorSurfaceEslintDisableRunnerChange) {
      return;
    }

    if (!editorApi || !monacoApi || !activeDocument) {
      onEditorSurfaceEslintDisableRunnerChange(null);
      return;
    }

    const targetPath = activeDocument.path;
    const runner: EditorSurfaceEslintDisableRunner = (
      expectedContent,
      lineNumber,
      identifiers,
    ) => {
      const model = editorApi.getModel();

      if (!model || !modelMatchesProject(model, workspaceRoot, targetPath)) {
        return null;
      }

      if (model.getValue() !== expectedContent) {
        return null;
      }

      if (
        identifiers.length === 0 ||
        lineNumber < 1 ||
        lineNumber > model.getLineCount()
      ) {
        return 0;
      }

      const indentation =
        /^\s*/.exec(model.getLineContent(lineNumber))?.[0] ?? "";
      const edit = {
        forceMoveMarkers: true,
        range: new monacoApi.Range(lineNumber, 1, lineNumber, 1),
        text: `${indentation}// eslint-disable-next-line ${identifiers.join(", ")}\n`,
      };

      if (!editorApi.executeEdits("eslint.disableRuleAtCursor", [edit])) {
        return null;
      }

      return identifiers.length;
    };

    onEditorSurfaceEslintDisableRunnerChange(runner);

    return () => {
      onEditorSurfaceEslintDisableRunnerChange(null);
    };
  }, [
    activeDocument?.path,
    editorApi,
    monacoApi,
    onEditorSurfaceEslintDisableRunnerChange,
    workspaceRoot,
  ]);

  useEffect(() => {
    if (!onEditorSurfacePhpstanIgnoreRunnerChange) {
      return;
    }

    if (!editorApi || !monacoApi || !activeDocument) {
      onEditorSurfacePhpstanIgnoreRunnerChange(null);
      return;
    }

    const targetPath = activeDocument.path;
    const runner: EditorSurfacePhpstanIgnoreRunner = (
      expectedContent,
      lineNumber,
      identifiers,
    ) => {
      const model = editorApi.getModel();

      if (!model || !modelMatchesProject(model, workspaceRoot, targetPath)) {
        return null;
      }

      if (model.getValue() !== expectedContent) {
        return null;
      }

      if (
        identifiers.length === 0 ||
        lineNumber < 1 ||
        lineNumber > model.getLineCount()
      ) {
        return 0;
      }

      const indentation =
        /^\s*/.exec(model.getLineContent(lineNumber))?.[0] ?? "";
      const edit = {
        forceMoveMarkers: true,
        range: new monacoApi.Range(lineNumber, 1, lineNumber, 1),
        text: `${indentation}// @phpstan-ignore ${identifiers.join(", ")}\n`,
      };

      if (!editorApi.executeEdits("phpstan.ignoreIssueAtCursor", [edit])) {
        return null;
      }

      return identifiers.length;
    };

    onEditorSurfacePhpstanIgnoreRunnerChange(runner);

    return () => {
      onEditorSurfacePhpstanIgnoreRunnerChange(null);
    };
  }, [
    activeDocument?.path,
    editorApi,
    monacoApi,
    onEditorSurfacePhpstanIgnoreRunnerChange,
    workspaceRoot,
  ]);

  const recoverVisibleLocalPhpDiagnostics = useCallback(
    (uris: readonly Monaco.Uri[] = []) => {
      if (
        !activeDocument ||
        activeDocument.language !== "php" ||
        !monacoApi
      ) {
        return;
      }

      const model = monacoApi.editor
        .getModels()
        .find((candidate) =>
          modelMatchesProject(candidate, workspaceRoot, activeDocument.path),
        );
      if (!model) {
        return;
      }

      if (
        uris.length > 0 &&
        !uris.some((uri) => model.uri.toString() === uri.toString())
      ) {
        return;
      }

      const diagnostics = localPhpDiagnosticsFromVisibleMarkers(
        monacoApi,
        model,
      );

      // Recovery bridge only: parser-driven validation owns clears. This keeps
      // a visible local PHP marker from being absent in Problems/status during
      // startup/open races without letting a transient empty marker set wipe the
      // workbench diagnostics store.
      if (diagnostics.length === 0) {
        return;
      }

      onLocalPhpDiagnosticsChange(activeDocument.path, diagnostics);
    },
    [
      activeDocument?.language,
      activeDocument?.path,
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
    ...(requestLanguageServerDocumentLease
      ? { requestLanguageServerDocumentLeaseRef }
      : {}),
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
  const runtimeRegistration: EditorRuntimeSurfaceRegistration = {
    activePath: activeDocument?.path ?? null,
    diagnosticsByPath: languageServerDiagnosticsByPath,
    editor: editorApi,
    groupId,
    monacoApi,
    onMarkerUrisChanged: recoverVisibleLocalPhpDiagnostics,
    onModelContentChange: (content) => onChangeRef.current(content),
    providerDependencies: {
      coordinatePhpDocumentSymbols: runtime?.coordinatePhpDocumentSymbols,
      featuresGateway: languageServerFeaturesGateway,
      monacoApi,
      refreshGateway: languageServerRefreshGateway,
      workspaceEditGateway: phpLanguageServerWorkspaceEditGateway,
      workspaceIdentityDescriptor: completeWorkspaceIdentityDescriptor,
      workspaceRoot,
    },
    routing: {
      activeDocumentRef,
      javaScriptTypeScriptProviderContext: {
        applyWorkspaceEdit: (edit, editContext) =>
          applyJavaScriptTypeScriptWorkspaceEditRef.current(edit, editContext),
        completeFunctionCalls: javaScriptTypeScriptCompleteFunctionCalls,
        featuresGateway: javaScriptTypeScriptLanguageServerFeaturesGateway,
        flushPendingDocumentChange: (path) =>
          flushPendingJavaScriptTypeScriptRef.current(path),
        getActiveDocument: () => activeDocumentRef.current,
        getRuntimeStatus: () => javaScriptTypeScriptRuntimeStatusRef.current,
        getUserSnippets: () => userSnippetsRef.current,
        getWorkspaceIdentityDescriptor: () =>
          completeWorkspaceIdentityDescriptor,
        getWorkspaceRoot: () => workspaceRoot,
        limitNavigationResultsToOpenModels: true,
        refreshGateway: javaScriptTypeScriptLanguageServerRefreshGateway,
        reportError: (error) => errorReporterRef.current(error),
        workspaceEditGateway:
          javaScriptTypeScriptLanguageServerWorkspaceEditGateway,
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
    toMarker: (diagnostic) => toMonacoDiagnosticMarker(monacoApi!, diagnostic),
    typescriptJavascriptDefaults: {
      managedLanguageServerActive:
        isJavaScriptTypeScriptRuntimeActiveForWorkspace(
          javaScriptTypeScriptLanguageServerRuntimeStatus,
          workspaceRoot,
        ),
      validationEnabled: javaScriptTypeScriptValidationEnabled,
    },
    workspaceIdentityDescriptor: completeWorkspaceIdentityDescriptor,
    workspaceRoot,
  };
  resolveDocumentForModelRef.current =
    runtimeRegistration.routing.resolveDocumentForModel;
  const runtimeRegistrationRef = useRef(runtimeRegistration);
  runtimeRegistrationRef.current = runtimeRegistration;

  useEffect(() => {
    if (!runtime) {
      return;
    }

    return runtime.registerSurface(
      generatedSurfaceId,
      runtimeRegistrationRef.current,
    );
  }, [generatedSurfaceId, runtime]);

  useEffect(() => {
    runtime?.updateSurface(generatedSurfaceId, runtimeRegistrationRef.current);
  }, [
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
        openWorkspaceFileRef.current?.(path, request) ??
        Promise.resolve(false),
      openWorkspaceRoot: (path) =>
        openWorkspaceRootRef.current?.(path) ?? Promise.resolve(false),
      provideBladeDefinition: (source, offset, request) =>
        provideGuardedQaDefinition(
          templateLanguageProvidersRef.current.blade.provideDefinition,
          source,
          offset,
          request,
        ),
      provideBladeCompletions: (source, position) =>
        templateLanguageProvidersRef.current.blade.provideCompletions(
          source,
          position,
        ),
      provideLatteDefinition: (source, offset, request) =>
        provideGuardedQaDefinition(
          templateLanguageProvidersRef.current.latte.provideDefinition,
          source,
          offset,
          request,
        ),
      provideLatteCompletions: (source, position) =>
        templateLanguageProvidersRef.current.latte.provideCompletions(
          source,
          position,
        ),
      provideNeonDefinition: (source, offset, request) =>
        provideGuardedQaDefinition(
          templateLanguageProvidersRef.current.neon.provideDefinition,
          source,
          offset,
          request,
        ),
      provideNeonCompletions: (source, position) =>
        templateLanguageProvidersRef.current.neon.provideCompletions(
          source,
          position,
        ),
      providePhpFrameworkDefinition: (source, offset, request) =>
        provideGuardedQaDefinition(
          phpFrameworkDefinitionRef.current,
          source,
          offset,
          request,
        ),
      providePhpMethodCompletions: (source, position) =>
        phpMethodCompletionsRef.current(source, position),
      providePhpPresenterLinkDefinition: (source, offset, request) =>
        provideGuardedQaDefinition(
          phpPresenterLinkDefinitionRef.current,
          source,
          offset,
          request,
        ),
    });
  }, [editorApi, workspaceRoot]);

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

  useEffect(() => {
    if (!editorApi) {
      return;
    }

    const disposable = editorApi.onDidFocusEditorWidget(
      activateEditorGroupFromInteraction,
    );
    return () => disposable.dispose();
  }, [activateEditorGroupFromInteraction, editorApi]);

  useEffect(() => {
    if (!editorApi) {
      return;
    }

    editorApi.updateOptions({
      fontFamily: editorFontFamily,
      fontLigatures: monacoFontLigatures,
      fontSize: editorFontSize,
      minimap: { enabled: minimapEnabled },
      wordWrap: wordWrapEnabled ? "on" : "off",
    });
  }, [
    editorApi,
    editorFontFamily,
    monacoFontLigatures,
    editorFontSize,
    minimapEnabled,
    wordWrapEnabled,
  ]);

  // Apply resolved `.editorconfig` indent + EOL to the ACTIVE model only, so a
  // file with a matching `.editorconfig` mirrors VS Code / PhpStorm. Guarded by
  // `modelPath === activeDocument.path` (per-tab isolation): during a switch the
  // editor may still hold the previous model for a frame, and applying then
  // would mutate the wrong file. When EditorConfig sets no indent / EOL we leave
  // Monaco's own detection (`detectIndentation`) and the file's existing EOL
  // untouched, preserving the no-`.editorconfig` default behaviour.
  useEffect(() => {
    if (!editorApi || !monacoApi || !activeDocument) {
      return;
    }

    const model = editorApi.getModel();

    if (!model || !modelMatchesProject(model, workspaceRoot, activeDocument.path)) {
      return;
    }

    const resolved: ResolvedEditorConfig = editorConfig ?? {};
    const formattingOptions = editorConfigFormattingOptions(resolved);

    if (formattingOptions) {
      model.updateOptions({
        insertSpaces: formattingOptions.insertSpaces,
        tabSize: formattingOptions.tabSize,
      });
    }

    const eol = editorConfigEol(resolved);

    if (eol) {
      model.setEOL(
        eol === "\r\n"
          ? monacoApi.editor.EndOfLineSequence.CRLF
          : monacoApi.editor.EndOfLineSequence.LF,
      );
    }
  }, [
    activeDocument?.path,
    editorApi,
    editorConfig?.endOfLine,
    editorConfig?.indentSize,
    editorConfig?.indentStyle,
    editorConfig?.tabWidth,
    monacoApi,
    workspaceRoot,
  ]);

  useEffect(() => {
    if (!editorApi) {
      return;
    }

    const disposable = editorApi.onDidChangeCursorPosition((event) => {
      onCursorPositionChangeRef.current(event.position);
      setCursorPosition((previous) =>
        nextCursorPosition(previous, event.position),
      );
    });
    const position = editorApi.getPosition();

    if (position) {
      onCursorPositionChangeRef.current(position);
      setCursorPosition((previous) => nextCursorPosition(previous, position));
    }

    return () => disposable.dispose();
  }, [editorApi]);

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

    if (activeDocumentIsLargeSmart) {
      tokenizer.stop();
      return;
    }

    const requestedPath = activeDocument.path;
    const model = editorApi.getModel();

    // Only warm the model that actually backs the requested document. During a
    // switch the editor can still hold the previous model for a frame; warming
    // it would tokenize the wrong file, so we wait for the next effect run.
    if (!model || !modelMatchesProject(model, workspaceRoot, requestedPath)) {
      return;
    }

    tokenizer.start(model as unknown as BackgroundTokenizableModel);

    return () => tokenizer.stop();
  }, [
    activeDocument?.path,
    activeDocumentIsLargeSmart,
    editorApi,
    workspaceRoot,
  ]);

  // Permanent teardown so a disposed surface leaves no pending idle slice.
  useEffect(() => {
    const tokenizer = backgroundTokenizerRef.current;
    return () => tokenizer?.dispose();
  }, []);

  useEffect(() => {
    if (!activeDocument || !workspaceRoot) {
      return;
    }

    if (activeDocumentIsLargeSmart) {
      setBreadcrumbSymbolsByPath((current) => {
        if (!current[activeDocument.path]) {
          return current;
        }

        const next = { ...current };
        delete next[activeDocument.path];
        return next;
      });
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
    const requestDocumentLease =
      requestLanguageServerDocumentLeaseRef.current;
    const isDocumentLeaseCurrent =
      isLanguageServerDocumentRequestLeaseCurrentRef.current;
    const canUseDocumentLease = Boolean(
      requiresSync && requestDocumentLease && isDocumentLeaseCurrent,
    );
    let active = true;
    let timeout: number | null = null;

    const fetchBreadcrumbSymbols = async () => {
      let documentLease: LanguageServerMonacoDocumentRequestLease | null = null;

      try {
        documentLease = canUseDocumentLease
          ? (await requestDocumentLease?.(requestedRoot, requestedPath)) ?? null
          : null;

        if (!active) {
          return;
        }

        if (
          canUseDocumentLease &&
          (!documentLease || !isDocumentLeaseCurrent?.(documentLease))
        ) {
          return;
        }

        let load = () =>
          breadcrumbGateway.documentSymbols(requestedRoot, requestedPath);
        if (requiresSync) {
          if (!canUseDocumentLease) {
            await flushPendingLanguageServerDocument(requestedPath);
            if (!active) {
              return;
            }
          }

          const document = activeDocumentRef.current;
          const status = runtimeStatusRef.current;
          if (!document || document.path !== requestedPath) {
            return;
          }

          if (
            documentLease &&
            (status?.kind !== "running" ||
              status.sessionId !== documentLease.sessionId)
          ) {
            return;
          }

          if (
            documentLease &&
            status?.kind === "running" &&
            status.rootPath &&
            workspaceRootKeysEqual(status.rootPath, requestedRoot)
          ) {
            const directLoad = load;
            const coordinatedLease = documentLease;
            load = () =>
              runtime?.coordinatePhpDocumentSymbols(
                {
                  content: document.content,
                  lifecycleIdentity: coordinatedLease.lifecycleIdentity,
                  path: requestedPath,
                  rootPath: requestedRoot,
                  runtimeIdentity: languageServerFeaturesGateway,
                  sessionId: coordinatedLease.sessionId,
                },
                directLoad,
              ) ?? directLoad();
          }
        }

        const symbols = await load();
        if (!active) {
          return;
        }

        if (documentLease && !isDocumentLeaseCurrent?.(documentLease)) {
          return;
        }

        setBreadcrumbSymbolsByPath((current) => ({
          ...current,
          [requestedPath]: symbols,
        }));
      } catch (error) {
        if (!active) {
          return;
        }

        if (documentLease && !isDocumentLeaseCurrent?.(documentLease)) {
          return;
        }

        errorReporterRef.current(error);
      }
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
        !canUseDocumentLease &&
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
    activeDocumentIsLargeSmart,
    javaScriptTypeScriptLanguageServerFeaturesGateway,
    languageServerFeaturesGateway,
    flushPendingLanguageServerDocument,
    runtime,
    workspaceRoot,
  ]);

  useEffect(() => {
    if (!activeDocument || !editorApi) {
      return;
    }

    if (activeDocument.language !== "latte") {
      return;
    }

    const activeDocumentLanguage = activeDocument.language;
    const activeDocumentPath = activeDocument.path;
    const disposable = editorApi.onDidChangeModelContent((event) => {
      const model = editorApi.getModel();
      const position = editorApi.getPosition();

      if (!model || !position || !modelMatchesProject(model, workspaceRoot, activeDocumentPath)) {
        return;
      }

      if (
        !shouldTriggerLatteMemberSuggest(
          activeDocumentLanguage,
          model,
          position,
          event.changes,
        )
      ) {
        return;
      }

      editorApi.trigger(
        "mockor.latteMemberCompletion",
        "editor.action.triggerSuggest",
        {},
      );
    });

    return () => disposable.dispose();
  }, [activeDocument?.language, activeDocument?.path, editorApi, workspaceRoot]);

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

      if (!model || !position || !modelMatchesProject(model, workspaceRoot, activeDocument.path)) {
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
  }, [
    activeDocument?.language,
    activeDocument?.path,
    editorApi,
    monacoApi,
    workspaceRoot,
  ]);

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
    const configuredF12CommandId = keymapCommandIdForShortcut(
      keymap,
      "F12",
      keymapPlatform,
    );
    const definitionUsesDefaultShortcut =
      shortcutForCommand(
        keymap,
        "editor.goToDefinition",
        keymapPlatform,
      ) ===
      defaultShortcutForCommand("editor.goToDefinition", keymapPlatform);
    const f12CommandId =
      configuredF12CommandId ??
      (definitionUsesDefaultShortcut ? "editor.goToDefinition" : null);
    const disposables = [
      editorApi.addAction({
        id: "mockor.dispatchF12",
        label: "Dispatch F12",
        keybindings: [monacoApi.KeyCode.F12],
        run: () => {
          if (!f12CommandId) {
            return;
          }

          requestRegisteredCommand(commandExecutionRunnerRef, f12CommandId);
        },
      }),
      editorApi.addAction({
        id: "mockor.goToDefinition",
        label: "Go to Definition",
        keybindings: keybinding("editor.goToDefinition"),
        run: () =>
          runRegisteredCommand(
            commandExecutionRunnerRef,
            "editor.goToDefinition",
            () => editorActionCommandPortRef.current.goToDefinition(),
          ),
      }),
      editorApi.addAction({
        id: "mockor.quickDefinition",
        label: "Quick Definition",
        keybindings: keybinding("editor.quickDefinition"),
        run: () =>
          requestRegisteredCommand(
            commandExecutionRunnerRef,
            "editor.quickDefinition",
          ),
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
          runRegisteredCommand(
            commandExecutionRunnerRef,
            "editor.goToDeclaration",
            () =>
              triggerEditorAction(editorApi, "editor.action.revealDeclaration"),
          ),
      }),
      editorApi.addAction({
        id: "mockor.goToTypeDefinition",
        label: "Go to Type Definition",
        keybindings: keybinding("editor.goToTypeDefinition"),
        run: () =>
          runRegisteredCommand(
            commandExecutionRunnerRef,
            "editor.goToTypeDefinition",
            () =>
              triggerEditorAction(editorApi, "editor.action.goToTypeDefinition"),
          ),
      }),
      editorApi.addAction({
        id: "mockor.goToImplementation",
        label: "Go to Implementation",
        keybindings: keybinding("editor.goToImplementation"),
        run: () => {
          runRegisteredCommand(
            commandExecutionRunnerRef,
            "editor.goToImplementation",
            () => {
              const position = editorApi.getPosition();

              if (!position) {
                return;
              }

              editorActionCommandPortRef.current.goToImplementationAt(position);
            },
          );
        },
      }),
      editorApi.addAction({
        id: "mockor.goToSuperMethod",
        label: "Go to Super Method",
        keybindings: keybinding("editor.goToSuperMethod"),
        run: () =>
          runRegisteredCommand(
            commandExecutionRunnerRef,
            "editor.goToSuperMethod",
            () => editorActionCommandPortRef.current.goToSuperMethod(),
          ),
      }),
      editorApi.addAction({
        id: "mockor.findReferences",
        label: "Find All References",
        keybindingContext: "!referenceSearchVisible && !inReferenceSearchEditor",
        keybindings: keybinding("editor.findReferences"),
        run: () =>
          runRegisteredCommand(
            commandExecutionRunnerRef,
            "editor.findReferences",
            () => triggerEditorAction(editorApi, "editor.action.goToReferences"),
          ),
      }),
      editorApi.addAction({
        id: "mockor.findFileReferences",
        label: "Find File References",
        keybindings: keybinding("editor.findFileReferences"),
        run: () =>
          runRegisteredCommand(
            commandExecutionRunnerRef,
            "editor.findFileReferences",
            () =>
              triggerEditorAction(editorApi, "editor.action.peekImplementation"),
          ),
      }),
      editorApi.addAction({
        id: "mockor.openClass",
        label: "Open Class",
        keybindings: keybinding("class.quickOpen"),
        run: () =>
          runRegisteredCommand(
            commandExecutionRunnerRef,
            "class.quickOpen",
            () => editorActionCommandPortRef.current.openClass(),
          ),
      }),
      editorApi.addAction({
        id: "mockor.openFile",
        label: "Open File",
        keybindings: keybinding("file.quickOpen"),
        run: () =>
          runRegisteredCommand(
            commandExecutionRunnerRef,
            "file.quickOpen",
            () => editorActionCommandPortRef.current.openFile(),
          ),
      }),
      editorApi.addAction({
        id: "mockor.fileStructure",
        label: "File Structure",
        keybindings: keybinding("editor.fileStructure"),
        run: () =>
          runRegisteredCommand(
            commandExecutionRunnerRef,
            "editor.fileStructure",
            () => editorActionCommandPortRef.current.openFileStructure(),
          ),
      }),
      editorApi.addAction({
        id: "mockor.gotoLine",
        label: "Go to Line/Column",
        keybindings: keybinding("editor.gotoLine"),
        run: () =>
          runRegisteredCommand(
            commandExecutionRunnerRef,
            "editor.gotoLine",
            () => triggerEditorSurfaceCommand(editorApi, "editor.gotoLine"),
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
          runRegisteredCommand(
            commandExecutionRunnerRef,
            "editor.toggleGitBlame",
            () => editorActionCommandPortRef.current.toggleGitBlame?.(),
          ),
      }),
      editorApi.addAction({
        id: "mockor.formatDocument",
        label: "Format Document",
        keybindings: keybinding("editor.formatDocument"),
        run: () =>
          runRegisteredCommand(
            commandExecutionRunnerRef,
            "editor.formatDocument",
            () =>
              triggerEditorSurfaceCommand(editorApi, "editor.formatDocument"),
          ),
      }),
      editorApi.addAction({
        id: "mockor.formatSelection",
        label: "Format Selection",
        keybindings: keybinding("editor.formatSelection"),
        run: () =>
          runRegisteredCommand(
            commandExecutionRunnerRef,
            "editor.formatSelection",
            () =>
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
          runRegisteredCommand(
            commandExecutionRunnerRef,
            "editor.quickFix",
            () => triggerEditorSurfaceCommand(editorApi, "editor.quickFix"),
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
        run: () =>
          triggerEditorAction(editorApi, "editor.action.sortLinesAscending"),
      }),
      editorApi.addAction({
        id: "mockor.sortLinesDescending",
        label: "Sort Lines Descending",
        keybindings: keybinding("editor.sortLinesDescending"),
        run: () =>
          triggerEditorAction(editorApi, "editor.action.sortLinesDescending"),
      }),
      editorApi.addAction({
        id: "mockor.toggleCase",
        label: "Toggle Case",
        keybindings: keybinding("editor.toggleCase"),
        run: () =>
          triggerEditorAction(editorApi, "editor.action.transformToUppercase"),
      }),
      editorApi.addAction({
        id: "mockor.transformToLowercase",
        label: "Transform to Lowercase",
        keybindings: keybinding("editor.transformToLowercase"),
        run: () =>
          triggerEditorAction(editorApi, "editor.action.transformToLowercase"),
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
          runRegisteredCommand(
            commandExecutionRunnerRef,
            "editor.closeTab",
            () => editorActionCommandPortRef.current.closeActiveTab(),
          ),
      }),
      editorApi.addAction({
        id: "mockor.goBack",
        label: "Go Back",
        keybindings: keybinding("navigation.back"),
        run: () =>
          runRegisteredCommand(
            commandExecutionRunnerRef,
            "navigation.back",
            () => editorActionCommandPortRef.current.goBack(),
          ),
      }),
      editorApi.addAction({
        id: "mockor.goForward",
        label: "Go Forward",
        keybindings: keybinding("navigation.forward"),
        run: () =>
          runRegisteredCommand(
            commandExecutionRunnerRef,
            "navigation.forward",
            () => editorActionCommandPortRef.current.goForward(),
          ),
      }),
      editorApi.addAction({
        id: "mockor.nextChange",
        label: "Go to Next Change",
        keybindings: keybinding("editor.nextChange"),
        run: () =>
          requestRegisteredCommand(commandExecutionRunnerRef, "editor.nextChange"),
      }),
      editorApi.addAction({
        id: "mockor.previousChange",
        label: "Go to Previous Change",
        keybindings: keybinding("editor.previousChange"),
        run: () =>
          requestRegisteredCommand(
            commandExecutionRunnerRef,
            "editor.previousChange",
          ),
      }),
    ];

    return () => {
      disposables.forEach((disposable) => disposable?.dispose());
    };
  }, [editorApi, keymap, monacoApi]);

  useEffect(() => {
    if (!editorApi || !monacoApi) {
      return;
    }

    const disposables = registerConflictMarkerCodeActions(monacoApi, editorApi, {
      shouldInspectModel: (model) =>
        !isLargeSmartModel(model, largeSmartDocumentPolicyRef.current),
    });

    return () => {
      disposables.forEach((disposable) => disposable.dispose());
    };
  }, [editorApi, monacoApi]);

  useEffect(() => {
    if (!editorApi) {
      return;
    }

    const refreshDecorations = () => {
      const model = editorApi.getModel();
      const document = activeDocumentRef.current;
      const matchesActiveDocument =
        model &&
        document &&
        modelMatchesProject(model, workspaceRootRef.current, document.path);
      const decorations =
        matchesActiveDocument &&
        !isLargeSmartModel(model, largeSmartDocumentPolicyRef.current)
          ? conflictMarkerDecorations(model)
          : [];

      conflictMarkerDecorationIdsRef.current = editorApi.deltaDecorations(
        conflictMarkerDecorationIdsRef.current,
        decorations,
      );
    };

    refreshDecorations();
    const contentChangeDisposable =
      editorApi.onDidChangeModelContent(refreshDecorations);
    const modelChangeDisposable =
      editorApi.onDidChangeModel(refreshDecorations);

    return () => {
      contentChangeDisposable.dispose();
      modelChangeDisposable.dispose();
      conflictMarkerDecorationIdsRef.current = editorApi.deltaDecorations(
        conflictMarkerDecorationIdsRef.current,
        [],
      );
    };
  }, [activeDocument?.path, editorApi]);

  useEffect(() => {
    if (!editorApi || !monacoApi || !onCloseFloatingSurface) {
      return;
    }

    const disposable = editorApi.onKeyDown((event) => {
      if (
        event.keyCode !== monacoApi.KeyCode.Escape &&
        event.browserEvent.key !== "Escape"
      ) {
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

  useEffect(() => {
    if (!editorApi || !monacoApi) {
      return;
    }

    const mouseDownPlatform = detectKeymapPlatform();

    const disposable = editorApi.onMouseDown((event) => {
      activateEditorGroupFromInteraction();
      const targetType = event.target.type;

      if (
        targetType === monacoApi.editor.MouseTargetType.CONTENT_TEXT &&
        event.event.leftButton === true &&
        event.target.element?.closest(".git-blame-annotation")
      ) {
        const lineNumber = event.target.position?.lineNumber;
        const sha = lineNumber
          ? gitBlameShaAtLine(gitBlameLinesRef.current, lineNumber)
          : null;
        const path = activeDocumentRef.current?.path;

        if (!sha || !path) {
          return;
        }

        event.event.preventDefault();
        event.event.stopPropagation();

        if (onRevealGitBlameCommit) {
          onRevealGitBlameCommit(path, sha);
          return;
        }

        window.dispatchEvent(
          new CustomEvent("mockor-reveal-git-blame-commit", {
            detail: { path, sha },
          }),
        );
        return;
      }

      // Cmd+click (macOS) / Ctrl+click (Windows/Linux) and middle-click on code
      // text mirror the Cmd+B go-to-definition command instead of Monaco's
      // built-in gesture, which has no cross-file opener wired and skips the
      // Laravel/PHP contextual definition cascade. We set the caret first
      // (onMouseDown fires before the selection settles, and the controller
      // reads the active editor position), then run the same callback as the
      // keyboard shortcut and suppress the native gesture so navigation does not
      // fire twice.
      //
      // The modifier gesture must be a primary (left) click only. On macOS
      // Ctrl+click is the OS secondary/context click, so we navigate solely on
      // Cmd (metaKey) and explicitly bail when Ctrl is held - otherwise a Mac
      // user opening the context menu would be yanked to the definition instead.
      const isContentText =
        targetType === monacoApi.editor.MouseTargetType.CONTENT_TEXT;
      const isLeftClick = event.event.leftButton === true;
      const isMiddleClick = event.event.middleButton === true;
      const definitionModifierPressed =
        mouseDownPlatform === "mac"
          ? event.event.metaKey === true && event.event.ctrlKey !== true
          : event.event.ctrlKey === true;
      const shouldNavigateToDefinition =
        (isLeftClick && definitionModifierPressed) || isMiddleClick;
      const contentPosition = event.target.position;

      if (
        isContentText &&
        shouldNavigateToDefinition &&
        contentPosition
      ) {
        event.event.preventDefault();
        event.event.stopPropagation();
        editorApi.setPosition(contentPosition);
        runRegisteredCommand(
          commandExecutionRunnerRef,
          "editor.goToDefinition",
          onGoToDefinition,
        );
        return;
      }

      if (targetType === monacoApi.editor.MouseTargetType.GUTTER_LINE_NUMBERS) {
        const lineNumber = event.target.position?.lineNumber;
        const path = activeDocumentRef.current?.path;
        const isPlainLeftClick =
          event.event.leftButton === true &&
          event.event.ctrlKey !== true &&
          event.event.metaKey !== true &&
          event.event.shiftKey !== true &&
          event.event.altKey !== true;

        if (!onToggleBreakpoint || !isPlainLeftClick || !lineNumber || !path) {
          return;
        }

        onToggleBreakpoint(path, lineNumber);
        return;
      }

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
        editorApi.setPosition(target);
        runRegisteredCommand(
          commandExecutionRunnerRef,
          "editor.goToImplementation",
          () => editorActionCommandPortRef.current.goToImplementationAt(target),
        );
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
    activateEditorGroupFromInteraction,
    editorApi,
    monacoApi,
    onGoToDefinition,
    onRevealGitBlameCommit,
    onRunTestAt,
    onToggleBookmarkAtLine,
    onToggleBreakpoint,
  ]);

  // Monaco ships a built-in "go to definition on Cmd/Ctrl" gesture
  // (`editor.contrib.gotodefinitionatposition`). With `multiCursorModifier: "alt"`
  // Cmd/Ctrl is the trigger modifier for that contribution, so it navigates on
  // ITS OWN terms: it fires on mouse-UP whenever Cmd was held at mouse-down on
  // the same line (a Cmd-hover that registers the faintest tap), it ignores the
  // primary-button / CONTENT_TEXT guards the onMouseDown handler above enforces,
  // and it reveals the definition through Monaco's own opener - bypassing the
  // Laravel/PHP contextual cascade entirely. The net effect a user feels is
  // being yanked to the definition merely by hovering a symbol with Cmd held.
  //
  // Do NOT dispose the contribution. Disposing it tears down the editor mouse /
  // key listeners it registered while the contribution object stays in Monaco's
  // contribution map (it is registered `BeforeFirstInteraction`, so reading it
  // here force-instantiates it); the editor later re-enters and double-disposes
  // it, leaving Monaco's event delivery in an inconsistent state that surfaces as
  // a runtime crash ("undefined is not an object") on the next interaction.
  //
  // Instead neutralize ONLY the navigation: replace the contribution's
  // `gotoDefinition` method (the one its onExecute path calls to reveal the
  // target) with a no-op. Every listener stays wired, the link-hover underline
  // decorations still render, and Monaco's event system is left fully intact.
  // Go-to-definition then fires ONLY through the two explicit, guarded paths: the
  // Cmd+left-click handler above and the Cmd+B keybinding (both run the
  // controller's onGoToDefinition cascade).
  //
  // Per-tab isolation: @monaco-editor/react reuses one editor instance across
  // document switches, so patching once at mount covers every tab; the effect
  // re-runs if the editor instance itself changes.
  useEffect(() => {
    if (!editorApi) {
      return;
    }

    const gotoDefinitionGesture = editorApi.getContribution(
      "editor.contrib.gotodefinitionatposition",
    ) as { gotoDefinition?: (...args: unknown[]) => unknown } | null;

    if (
      !gotoDefinitionGesture ||
      typeof gotoDefinitionGesture.gotoDefinition !== "function"
    ) {
      return;
    }

    gotoDefinitionGesture.gotoDefinition = () => Promise.resolve();
  }, [editorApi]);

  useEffect(() => {
    if (!activeDocument || !editorApi || !monacoApi) {
      return;
    }

    const model = editorApi.getModel();

    if (!model || !modelMatchesProject(model, workspaceRoot, activeDocument.path)) {
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
  }, [activeDocument?.path, changeHunks, editorApi, monacoApi, workspaceRoot]);

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

    if (!model || !modelMatchesProject(model, workspaceRoot, activeDocument.path)) {
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
  }, [
    activeDocument?.path,
    bookmarkedLineNumbers,
    editorApi,
    monacoApi,
    workspaceRoot,
  ]);

  useEffect(() => {
    if (!activeDocument || !editorApi || !monacoApi) {
      return;
    }

    const model = editorApi.getModel();

    if (!model || !modelMatchesProject(model, workspaceRoot, activeDocument.path)) {
      return;
    }

    breakpointDecorationIdsRef.current = editorApi.deltaDecorations(
      breakpointDecorationIdsRef.current,
      breakpoints
        .filter((breakpoint) => breakpoint.filePath === activeDocument.path)
        .map((breakpoint) => toBreakpointDecoration(monacoApi, breakpoint)),
    );

    return () => {
      breakpointDecorationIdsRef.current = editorApi.deltaDecorations(
        breakpointDecorationIdsRef.current,
        [],
      );
    };
  }, [activeDocument?.path, breakpoints, editorApi, monacoApi, workspaceRoot]);

  useEffect(() => {
    if (!editorApi || !monacoApi) {
      return;
    }

    const clearStoppedLineDecoration = () => {
      debugStoppedDecorationIdsRef.current = editorApi.deltaDecorations(
        debugStoppedDecorationIdsRef.current,
        [],
      );
    };

    if (
      !activeDocument ||
      !debugStoppedLocation ||
      debugStoppedLocation.filePath !== activeDocument.path
    ) {
      clearStoppedLineDecoration();
      return;
    }

    const model = editorApi.getModel();

    if (!model || !modelMatchesProject(model, workspaceRoot, activeDocument.path)) {
      return;
    }

    debugStoppedDecorationIdsRef.current = editorApi.deltaDecorations(
      debugStoppedDecorationIdsRef.current,
      [
        {
          options: {
            className: "debug-stopped-line",
            isWholeLine: true,
            overviewRuler: {
              color: "#e7c66c",
              position: monacoApi.editor.OverviewRulerLane.Left,
            },
            stickiness:
              monacoApi.editor.TrackedRangeStickiness
                .NeverGrowsWhenTypingAtEdges,
          },
          range: new monacoApi.Range(
            debugStoppedLocation.lineNumber,
            1,
            debugStoppedLocation.lineNumber,
            1,
          ),
        },
      ],
    );
    editorApi.revealLineInCenter(debugStoppedLocation.lineNumber);

    return clearStoppedLineDecoration;
  }, [
    activeDocument?.path,
    debugStoppedLocation?.filePath,
    debugStoppedLocation?.lineNumber,
    editorApi,
    monacoApi,
    workspaceRoot,
  ]);

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

    if (!model || !modelMatchesProject(model, workspaceRoot, activeDocument.path)) {
      return;
    }

    const clearAnnotations = () => {
      gitBlameLinesRef.current = [];
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
          !modelMatchesProject(currentModel, workspaceRoot, requestedPath) ||
          activeDocumentRef.current?.path !== requestedPath
        ) {
          return;
        }

        const now = Date.now();
        gitBlameLinesRef.current = blameLines;
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
  }, [
    activeDocument?.path,
    editorApi,
    gitBlameEnabled,
    monacoApi,
    workspaceRoot,
  ]);

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

  // ONE debounced snapshot of the active PHP file's content, shared by the
  // implementation gutter, the test gutter and the syntax diagnostics. Each of
  // those used to arm its own independent 160ms `setTimeout` on every keystroke,
  // so a single edit fired three timers that each re-snapshotted the same
  // content and scheduled a redundant full-file parse on the main thread. Now a
  // single timer per edit publishes one snapshot and all three consumers react
  // to it. Gated to PHP documents (the union of the three consumers); the test
  // gutter applies its own narrower `isActiveDocumentPhpTest` gate downstream.
  const phpEditTick = useDebouncedPhpEditTick(
    activeDocument &&
      activeDocument.language === "php" &&
      !activeDocumentIsLargeSmart
      ? activeDocument.path
      : null,
    activeDocument &&
      activeDocument.language === "php" &&
      !activeDocumentIsLargeSmart
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

      const version =
        typeof model.getVersionId === "function" ? model.getVersionId() : 0;
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
            const structuralDiagnostics =
              structuralPhpSyntaxDiagnostics(content);
            const suspiciousDiagnostics =
              suspiciousPhpBareIdentifierDiagnostics(content);
            const immediateSyntaxDiagnostics = [
              ...structuralDiagnostics,
              ...suspiciousDiagnostics,
            ];
            const immediateInspectionDiagnostics =
              phpInspectionDiagnostics(content);

            return {
              immediate: {
                inspectionDiagnostics: immediateInspectionDiagnostics,
                syntaxDiagnostics: immediateSyntaxDiagnostics,
              },
              result: phpSyntaxDiagnosticsGateway.validate(content).then(
                (diagnostics) => ({
                  inspectionDiagnostics: immediateInspectionDiagnostics,
                  syntaxDiagnostics: [
                    ...diagnostics,
                    ...(diagnostics.length === 0
                      ? structuralDiagnostics
                      : []),
                    ...suspiciousDiagnostics,
                  ],
                }),
              ),
            };
          },
        );

        if (isActive()) {
          applyLocalPhpValidationSnapshot(
            coordinated.immediate,
            monacoApi,
            path,
            (markers) =>
              runtime.writeLocalPhpMarkers(
                generatedSurfaceId,
                monacoApi,
                model,
                markers,
              ),
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
          (markers) =>
            runtime.writeLocalPhpMarkers(
              generatedSurfaceId,
              monacoApi,
              model,
              markers,
            ),
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

  useEffect(() => {
    if (!activeDocument || !editorApi || !monacoApi) {
      return;
    }

    const model = editorApi.getModel();

    if (!model || !modelMatchesProject(model, workspaceRoot, activeDocument.path)) {
      return;
    }

    // Synchronously drop the previous file's glyphs on a path switch (or when the
    // document is no longer PHP) so a switch never leaves stale glyphs while the
    // debounced recompute is pending. A same-path keystroke does not clear, so
    // the existing glyphs stay put (and track edits via stickiness) until the
    // shared debounce tick flushes - no flicker.
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
  }, [
    activeDocument?.language,
    activeDocument?.path,
    editorApi,
    monacoApi,
    workspaceRoot,
  ]);

  // The debounced full-file parse + decoration replace. Driven by the shared
  // `phpEditTick` (one 160ms timer per edit for all PHP gutter/diagnostics
  // consumers) instead of arming its own timer per keystroke. The glyphs do not
  // need to track typing in real time - their stickiness keeps existing glyphs
  // anchored to the right lines while typing, and the recompute catches up once
  // the user pauses. The live-model path guard re-checks isolation AFTER the
  // debounce so a stale tab's snapshot can never decorate the active model.
  useEffect(() => {
    if (!phpEditTick || !editorApi || !monacoApi) {
      return;
    }

    const liveModel = editorApi.getModel();

    if (!liveModel || !modelMatchesProject(liveModel, workspaceRoot, phpEditTick.path)) {
      return;
    }

    const targets = phpGutterTargetsCoordinator.resolveImplementation(
      workspaceRoot,
      phpEditTick.path,
      phpEditTick.content,
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
    implementationGutterDecoratedPathRef.current = phpEditTick.path;
  }, [editorApi, monacoApi, phpEditTick, workspaceRoot]);

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

    if (!model || !modelMatchesProject(model, workspaceRoot, activeDocument.path)) {
      return;
    }

    // Synchronously drop the previous file's glyphs on a path switch (or when the
    // document stops being a PHP test) so a switch never leaves stale glyphs while
    // the shared debounce tick is pending. Mirrors the implementation-gutter
    // effect; see its comment for the no-flicker rationale.
    const decoratedPath = testGutterDecoratedPathRef.current;
    const isPathSwitch =
      decoratedPath !== null && decoratedPath !== activeDocument.path;
    const isApplicable =
      (activeDocument.language === "php" && isActiveDocumentPhpTest) ||
      isActiveDocumentJsTest;

    if (!isApplicable || isPathSwitch) {
      testGutterTargetsRef.current = new Map();
      testGutterDecorationIdsRef.current = editorApi.deltaDecorations(
        testGutterDecorationIdsRef.current,
        [],
      );
      testGutterDecoratedPathRef.current = null;
    }
  }, [
    activeDocument?.language,
    activeDocument?.path,
    editorApi,
    isActiveDocumentJsTest,
    isActiveDocumentPhpTest,
    monacoApi,
    workspaceRoot,
  ]);

  // The debounced test-gutter parse + decoration replace, driven by the shared
  // `phpEditTick`. Re-applies the `isActiveDocumentPhpTest` gate (the tick only
  // knows the document is PHP) and re-checks the live model path AFTER the
  // debounce so a stale tab's snapshot can never decorate the active model.
  useEffect(() => {
    if (
      !testEditTick ||
      !editorApi ||
      !monacoApi ||
      (!isActiveDocumentPhpTest && !isActiveDocumentJsTest)
    ) {
      return;
    }

    const liveModel = editorApi.getModel();

    if (!liveModel || !modelMatchesProject(liveModel, workspaceRoot, testEditTick.path)) {
      return;
    }

    const targets = isActiveDocumentJsTest
      ? jsGutterTargetsCoordinator.resolveTest(
          workspaceRoot,
          testEditTick.path,
          testEditTick.content,
        )
      : phpGutterTargetsCoordinator.resolveTest(
          workspaceRoot,
          testEditTick.path,
          testEditTick.content,
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
    testGutterDecoratedPathRef.current = testEditTick.path;
  }, [
    editorApi,
    isActiveDocumentJsTest,
    isActiveDocumentPhpTest,
    monacoApi,
    testEditTick,
    workspaceRoot,
  ]);

  useEffect(() => {
    if (!editorApi) {
      return;
    }

    const currentPath = activeDocument?.path ?? null;
    const previousPath = previousActiveDocumentPathRef.current;
    previousActiveDocumentPathRef.current = currentPath;

    if (previousPath === currentPath) {
      return;
    }

    dismissTransientEditorWidgets(editorApi, "document-switch");
  }, [activeDocument?.path, editorApi]);

  useEffect(() => {
    if (!editorApi || transientWidgetDismissKey === undefined) {
      return;
    }

    if (
      previousTransientWidgetDismissKeyRef.current ===
      transientWidgetDismissKey
    ) {
      return;
    }

    previousTransientWidgetDismissKeyRef.current = transientWidgetDismissKey;
    dismissTransientEditorWidgets(editorApi, "floating-surface");
  }, [editorApi, transientWidgetDismissKey]);

  useEffect(() => {
    if (!editorApi) {
      return;
    }

    const position = editorApi.getPosition();

    if (!position) {
      return;
    }

    onCursorPositionChangeRef.current(position);
  }, [activeDocument?.path, editorApi]);

  useEffect(() => {
    if (!editorRevealTarget) {
      return;
    }

    if (!activeDocument) {
      onRevealTargetHandled(editorRevealTarget);
      return;
    }

    if (editorRevealTarget.path !== activeDocument.path) {
      onRevealTargetHandled(editorRevealTarget);
      return;
    }

    if (!editorApi) {
      return;
    }

    if (!activeDocumentContentReady || isOpeningFile) {
      return;
    }

    const reveal = (): boolean => {
      const model = synchronizeActiveDocumentModel(
        editorApi,
        workspaceRoot,
        activeDocument,
      );

      if (!model) {
        return false;
      }

      // A reveal is a programmatic jump (Back/Forward, go-to-definition,
      // breadcrumb, etc). Clear transient widgets before moving the caret so
      // an in-flight hover cannot remain pinned to the previous location.
      dismissTransientEditorWidgets(editorApi, "navigation");
      editorApi.setPosition(editorRevealTarget.position);
      editorApi.revealPositionInCenter(editorRevealTarget.position);
      editorApi.focus();
      onRevealTargetHandled(editorRevealTarget);
      return true;
    };

    if (reveal()) {
      return;
    }

    // @monaco-editor/react swaps models in its own post-render lifecycle. Back
    // can therefore publish a reveal while the editor still exposes the model
    // being replaced. Keep the target pending and retry only when Monaco reports
    // the replacement instead of asking a stale/disposed model to validate the
    // position.
    const disposable = editorApi.onDidChangeModel(() => {
      if (!reveal()) {
        return;
      }

      disposable.dispose();
    });

    return () => disposable.dispose();
  }, [
    activeDocument,
    activeDocumentContentReady,
    editorApi,
    editorRevealTarget,
    isOpeningFile,
    onRevealTargetHandled,
    workspaceRoot,
  ]);

  const reconcileActiveModelContentRef = useRef(() => undefined);
  const applyActiveModelConfigRef = useRef(() => undefined);
  const startActiveModelTokenizerRef = useRef(() => undefined);

  reconcileActiveModelContentRef.current = () => {
    const document = activeDocumentRef.current;

    if (!editorApi || !document || !activeDocumentContentReady || isOpeningFile) {
      return;
    }

    synchronizeActiveDocumentModel(editorApi, workspaceRootRef.current, document);
  };
  applyActiveModelConfigRef.current = () => {
    const document = activeDocumentRef.current;

    if (!editorApi || !monacoApi || !document) {
      return;
    }

    const model = editorApi.getModel();

    if (!model || !modelMatchesProject(model, workspaceRootRef.current, document.path)) {
      return;
    }

    const resolved: ResolvedEditorConfig = editorConfig ?? {};
    const formattingOptions = editorConfigFormattingOptions(resolved);

    if (formattingOptions) {
      model.updateOptions({
        insertSpaces: formattingOptions.insertSpaces,
        tabSize: formattingOptions.tabSize,
      });
    }

    const eol = editorConfigEol(resolved);

    if (!eol) {
      return;
    }

    model.setEOL(
      eol === "\r\n"
        ? monacoApi.editor.EndOfLineSequence.CRLF
        : monacoApi.editor.EndOfLineSequence.LF,
    );
  };
  startActiveModelTokenizerRef.current = () => {
    const document = activeDocumentRef.current;
    const tokenizer = backgroundTokenizerRef.current;

    if (!editorApi || !document || !tokenizer) {
      return;
    }

    if (isLargeSmartDocument(document, largeSmartDocumentPolicyRef.current)) {
      tokenizer.stop();
      return;
    }

    const model = editorApi.getModel();

    if (!model || !modelMatchesProject(model, workspaceRootRef.current, document.path)) {
      return;
    }

    tokenizer.start(model as unknown as BackgroundTokenizableModel);
  };

  // Deterministic content sync: guarantee the live model buffer matches the
  // active document's content after every open / content change.
  //
  // @monaco-editor/react applies the `value` prop in an effect keyed on the
  // value identity, and swaps the model in a separate effect keyed on the `path`
  // identity. When a file's model already exists (we keep models alive for
  // Back/Forward navigation) and the path swaps to it without the value effect
  // re-running for this commit, Monaco shows that model's stale/empty buffer and
  // the freshly read content is never applied - the editor renders blank until an
  // unrelated edit nudges the value effect (the Quick Open "empty tab" race the
  // user hit). Reconcile here so content is shown the moment a file opens, with
  // no dependency on @monaco-editor/react's effect ordering.
  //
  // Isolation: only the model that currently belongs to the active document is
  // touched (path match), so a stale async commit can never write one file's
  // content into another's buffer. Idempotent: typing keeps content equal to the
  // model value, so this never re-applies during editing or fights live input.
  useEffect(() => {
    if (
      !editorApi ||
      !activeDocument ||
      !activeDocumentContentReady ||
      isOpeningFile
    ) {
      return;
    }

    reconcileActiveModelContentRef.current();
  }, [
    activeDocument?.content,
    activeDocument?.path,
    activeDocumentContentReady,
    editorApi,
    isOpeningFile,
    workspaceRoot,
  ]);

  // Model replacement is independent from document content updates. Keep one
  // listener for the editor instance and route it through latest-value refs so
  // same-path typing never replaces the subscription. A replacement model still
  // receives the current buffer, EditorConfig settings and token warming.
  useEffect(() => {
    if (!editorApi) {
      return;
    }

    const disposable = editorApi.onDidChangeModel(() => {
      reconcileActiveModelContentRef.current();
      applyActiveModelConfigRef.current();
      startActiveModelTokenizerRef.current();
    });

    return () => disposable.dispose();
  }, [editorApi]);

  const appliedRestoredViewStateKeysRef = useRef(new Set<string>());

  useEffect(() => {
    if (!editorApi || !activeDocument || !workspaceRoot) {
      return;
    }

    const viewState = restoredViewStates[activeDocument.path];

    if (!viewState) {
      return;
    }

    const applicationKey = `${workspaceRoot}\0${activeDocument.path}\0${restoredViewStateRevision}`;

    if (appliedRestoredViewStateKeysRef.current.has(applicationKey)) {
      return;
    }

    let active = true;
    let positionApplied = false;
    let restorationModel: Monaco.editor.ITextModel | null = null;
    let retryDisposable: Monaco.IDisposable | null = null;

    const activeModel = () => {
      const model = editorApi.getModel();

      if (!model || !modelMatchesProject(model, workspaceRoot, activeDocument.path)) {
        return null;
      }

      return model;
    };

    const applyPosition = (model: Monaco.editor.ITextModel) => {
      if (positionApplied) {
        return false;
      }

      const lineNumber = Math.min(
        Math.max(viewState.line, 1),
        Math.max(model.getLineCount(), 1),
      );
      const column = Math.min(
        Math.max(viewState.column, 1),
        model.getLineMaxColumn(lineNumber),
      );
      const position = { column, lineNumber };

      editorApi.setPosition(position);
      editorApi.revealPositionInCenter(position);

      if (viewState.scrollTop !== undefined) {
        editorApi.setScrollTop(viewState.scrollTop);
      }

      positionApplied = true;
      return true;
    };

    const finish = () => {
      if (!active) {
        return;
      }

      appliedRestoredViewStateKeysRef.current.add(applicationKey);
    };

    const finishFoldingRestore = (model: Monaco.editor.ITextModel) => {
      if (!active || activeModel() !== model) {
        return;
      }

      if (viewState.scrollTop !== undefined) {
        editorApi.setScrollTop(viewState.scrollTop);
      }

      finish();
    };

    const collapsePersistedLines = (
      model: Monaco.editor.ITextModel,
      foldingModel: FoldingModelViewState,
    ) => {
      if (activeModel() !== model) {
        return false;
      }

      const validFoldedLines = (viewState.foldedLines ?? []).filter(
        (line) => line >= 1 && line <= model.getLineCount(),
      );
      const foldedLines = new Set(validFoldedLines);
      const regions: FoldingRegionViewState[] = [];
      let matched = validFoldedLines.length === 0;

      for (let index = 0; index < foldingModel.regions.length; index += 1) {
        const startLineNumber = foldingModel.regions.getStartLineNumber(index);

        if (!foldedLines.has(startLineNumber)) {
          continue;
        }

        matched = true;

        if (foldingModel.regions.isCollapsed(index)) {
          continue;
        }

        regions.push(foldingModel.regions.toRegion(index));
      }

      if (regions.length > 0) {
        foldingModel.toggleCollapseState(regions);
      }

      return matched;
    };

    const applyFolding = async (model: Monaco.editor.ITextModel) => {
      const foldingModel = await foldingModelForEditor(editorApi);

      if (!active || activeModel() !== model) {
        return;
      }

      if ((viewState.foldedLines?.length ?? 0) === 0) {
        finish();
        return;
      }

      if (!foldingModel) {
        finishFoldingRestore(model);
        return;
      }

      if (collapsePersistedLines(model, foldingModel)) {
        finishFoldingRestore(model);
        return;
      }

      retryDisposable = foldingModel.onDidChange(() => {
        retryDisposable?.dispose();
        retryDisposable = null;
        collapsePersistedLines(model, foldingModel);
        finishFoldingRestore(model);
      });
    };

    const applyViewState = () => {
      const model = activeModel();

      if (!model) {
        return;
      }

      if (restorationModel !== model) {
        restorationModel = model;
        positionApplied = false;
        retryDisposable?.dispose();
        retryDisposable = null;
      }

      if (!applyPosition(model)) {
        return;
      }

      void applyFolding(model);
    };

    applyViewState();

    if (appliedRestoredViewStateKeysRef.current.has(applicationKey)) {
      return;
    }

    const disposable = editorApi.onDidChangeModel(applyViewState);

    return () => {
      active = false;
      disposable.dispose();
      retryDisposable?.dispose();
    };
  }, [
    activeDocument?.path,
    editorApi,
    restoredViewStateRevision,
    restoredViewStates,
    workspaceRoot,
  ]);

  useEffect(() => {
    if (!editorApi || !activeDocument || !onEditorViewStateChange) {
      return;
    }

    let active = true;
    let foldingBindingRevision = 0;
    let foldingModel: FoldingModelViewState | null = null;
    let foldingDisposable: Monaco.IDisposable | null = null;

    const resetFoldingBinding = () => {
      foldingBindingRevision += 1;
      foldingDisposable?.dispose();
      foldingDisposable = null;
      foldingModel = null;
    };

    const captureViewState = async () => {
      const model = editorApi.getModel();

      if (!model || !modelMatchesProject(model, workspaceRoot, activeDocument.path)) {
        return;
      }

      const position = editorApi.getPosition();

      if (!position) {
        return;
      }

      if (!foldingModel) {
        const bindingRevision = foldingBindingRevision;
        const resolvedFoldingModel = await foldingModelForEditor(editorApi);

        if (
          !active ||
          bindingRevision !== foldingBindingRevision ||
          editorApi.getModel() !== model
        ) {
          return;
        }

        foldingModel = resolvedFoldingModel;

        if (foldingModel && !foldingDisposable) {
          foldingDisposable = foldingModel.onDidChange(() => {
            void captureViewState();
          });
        }
      }

      const currentModel = editorApi.getModel();

      if (
        !currentModel ||
        !modelMatchesProject(currentModel, workspaceRoot, activeDocument.path)
      ) {
        return;
      }

      const foldedLines: number[] = [];

      if (foldingModel) {
        for (
          let index = 0;
          index < foldingModel.regions.length && foldedLines.length < 500;
          index += 1
        ) {
          if (!foldingModel.regions.isCollapsed(index)) {
            continue;
          }

          foldedLines.push(foldingModel.regions.getStartLineNumber(index));
        }
      }

      onEditorViewStateChangeRef.current?.(activeDocument.path, {
        column: position.column,
        ...(foldedLines.length === 0 ? {} : { foldedLines }),
        line: position.lineNumber,
        scrollTop: editorApi.getScrollTop(),
      });
    };

    void captureViewState();
    const cursorDisposable = editorApi.onDidChangeCursorPosition(() => {
      void captureViewState();
    });
    const scrollDisposable = editorApi.onDidScrollChange(() => {
      void captureViewState();
    });
    const modelDisposable = editorApi.onDidChangeModel(() => {
      resetFoldingBinding();
      void captureViewState();
    });

    return () => {
      active = false;
      cursorDisposable.dispose();
      modelDisposable.dispose();
      resetFoldingBinding();
      scrollDisposable.dispose();
    };
  }, [
    activeDocument?.path,
    Boolean(onEditorViewStateChange),
    editorApi,
    workspaceRoot,
  ]);

  useEffect(() => {
    if (
      !activeDocument ||
      activeDocument.language !== "php" ||
      activeDocumentIsLargeSmart ||
      !editorApi
    ) {
      return;
    }

    let active = true;
    let validatedModel: Monaco.editor.ITextModel | null = null;
    const validateActiveModel = () => {
      const model = editorApi.getModel();

      if (!model || !modelMatchesProject(model, workspaceRoot, activeDocument.path)) {
        return;
      }

      if (validatedModel === model) {
        return;
      }

      const isCurrentModel = () =>
        active &&
        editorApi.getModel() === model &&
        modelMatchesProject(model, workspaceRoot, activeDocument.path);

      void applyLocalPhpDiagnostics(
        activeDocument.path,
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
    const retryTimers = [80, 240].map((delay) =>
      window.setTimeout(validateActiveModel, delay),
    );

    return () => {
      active = false;
      modelChangeDisposable.dispose();
      retryTimers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [
    activeDocument?.language,
    activeDocument?.path,
    activeDocumentIsLargeSmart,
    applyLocalPhpDiagnostics,
    editorApi,
    workspaceRoot,
  ]);

  useEffect(() => {
    if (!activeDocument || activeDocument.language !== "php") {
      return;
    }

    recoverVisibleLocalPhpDiagnostics();
    const retryTimers = [80, 240, 600].map((delay) =>
      window.setTimeout(recoverVisibleLocalPhpDiagnostics, delay),
    );

    return () => {
      retryTimers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [
    activeDocument?.language,
    activeDocument?.path,
    recoverVisibleLocalPhpDiagnostics,
  ]);

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
        .filter((model) => {
          const path = modelPath(model);
          return Boolean(path && modelMatchesProject(model, workspaceRoot, path));
        })
        .map((model) => modelPath(model))
        .filter((path): path is string => path !== null),
    );
    const localDiagnosticPaths = new Set([
      ...Object.keys(syntaxDiagnosticsByPath),
      ...Object.keys(phpInspectionDiagnosticCountsByPath),
    ]);
    localDiagnosticPaths.forEach((path) => {
      if (!openPaths.has(path)) {
        onLocalPhpDiagnosticsChange(path, []);
      }
    });

    setSyntaxDiagnosticsByPath((current) =>
      pruneClosedPaths(current, openPaths),
    );
    setPhpInspectionDiagnosticCountsByPath((current) =>
      pruneClosedPaths(current, openPaths),
    );
    setBreadcrumbSymbolsByPath((current) =>
      pruneClosedPaths(current, openPaths),
    );
  }, [
    activeDocument?.path,
    monacoApi,
    onLocalPhpDiagnosticsChange,
    phpInspectionDiagnosticCountsByPath,
    syntaxDiagnosticsByPath,
    workspaceRoot,
  ]);

  useEffect(() => {
    if (activeDocument?.language === "php") {
      return;
    }

    if (activeDocument?.path) {
      onLocalPhpDiagnosticsChange(activeDocument.path, []);
    }
  }, [
    activeDocument?.language,
    activeDocument?.path,
    onLocalPhpDiagnosticsChange,
  ]);

  useEffect(() => {
    if (!activeDocument || !editorApi || !monacoApi) {
      return;
    }

    const model = editorApi.getModel();

    if (!model || !modelMatchesProject(model, workspaceRoot, activeDocument.path)) {
      return;
    }

    const languageServerDiagnostics =
      languageServerDiagnosticsByPath[activeDocument.path] ?? [];
    const syntaxDiagnostics =
      activeDocument.language === "php"
        ? syntaxDiagnosticsByPath[activeDocument.path] ?? []
        : [];
    const phpInspectionDiagnosticCount =
      activeDocument.language === "php"
        ? phpInspectionDiagnosticCountsByPath[activeDocument.path] ?? 0
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
      languageServerDiagnostics.length +
      syntaxDiagnostics.length +
      phpInspectionDiagnosticCount;
    const previousActiveDiagnostics = previousActiveDiagnosticCountRef.current;
    const diagnosticsClearedForActivePath =
      previousActiveDiagnostics !== null &&
      previousActiveDiagnostics.path === activeDocument.path &&
      activeDiagnosticCount < previousActiveDiagnostics.count;

    if (diagnosticsClearedForActivePath) {
      editorApi.trigger("diagnostics", "editor.action.hideHover", {});
    }

    previousActiveDiagnosticCountRef.current = {
      count: activeDiagnosticCount,
      path: activeDocument.path,
    };

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
    phpInspectionDiagnosticCountsByPath,
    syntaxDiagnosticsByPath,
  ]);

  // Synchronously clears the PHP syntax markers + cached diagnostics when the
  // active document is not (or stops being) PHP, or when it is too large for
  // live smart features. The debounced re-validation for normal PHP documents
  // is driven by the shared `phpEditTick` below.
  useEffect(() => {
    if (!monacoApi) {
      return;
    }

    if (!activeDocument) {
      return;
    }

    if (
      activeDocument.language === "php" &&
      !activeDocumentIsLargeSmart
    ) {
      return;
    }

    const model = modelForPath(monacoApi, workspaceRoot, activeDocument.path);

    if (!model) {
      return;
    }

    runtime?.writeLocalPhpMarkers(generatedSurfaceId, monacoApi, model, []);
    onLocalPhpDiagnosticsChange(activeDocument.path, []);
    setSyntaxDiagnosticsByPath((current) => {
      if (!current[activeDocument.path]) {
        return current;
      }

      const next = { ...current };
      delete next[activeDocument.path];
      return next;
    });
    setPhpInspectionDiagnosticCountsByPath((current) => {
      if (current[activeDocument.path] === undefined) {
        return current;
      }

      const next = { ...current };
      delete next[activeDocument.path];
      return next;
    });
  }, [
    activeDocument?.language,
    activeDocument?.path,
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

    applyLocalPhpDiagnostics(
      phpEditTick.path,
      phpEditTick.content,
      model,
      isCurrentModel,
    );

    return () => {
      active = false;
    };
  }, [applyLocalPhpDiagnostics, editorApi, monacoApi, phpEditTick, workspaceRoot]);

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

  // The gutter rollback popover mirrors JetBrains' change marker menu: Revert,
  // Show diff (the inline previous/current content already shown), and
  // Next/Previous change. Navigation is anchored on the hunk the popover is
  // currently showing (not the caret), then BOTH the editor caret and the
  // popover move to the target hunk so the popover follows the change instead of
  // being left stale on the originally-clicked hunk. The popover stays open so
  // repeated presses walk every change.
  const onPopoverGoToChange = useCallback(
    (direction: "next" | "previous") => {
      if (!editorApi) {
        return;
      }

      // Anchor on the hunk the popover is showing (read via the functional
      // updater so there is no stale-closure dependency on changePreview), find
      // the target, then move BOTH the editor and the popover onto it.
      setChangePreview((current) => {
        if (!current) {
          return current;
        }

        const target = navigateChangeHunkFromPopover(
          editorApi,
          changeHunksRef.current,
          current.hunk.startLineNumber,
          direction,
        );

        if (!target) {
          return current;
        }

        return {
          anchorLineNumber: target.startLineNumber,
          hunk: target,
        };
      });
    },
    [editorApi],
  );

  // The Monaco editor stays mounted at all times so switching files only swaps
  // the model (path/value) instead of unmounting/remounting Monaco — which would
  // re-run its initialization and flash a blank surface (VS Code never does
  // this). When no document is open we feed Monaco a stable placeholder model
  // and cover it with an overlay, instead of replacing the editor with a plain
  // div.
  const isReadOnly = activeDocument?.readOnly === true;

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
      minimap: { enabled: minimapEnabled },
      wordWrap: wordWrapEnabled ? "on" : "off",
      // Alt is the multi-cursor modifier (VS Code/PhpStorm default) so Cmd/Ctrl+Click
      // stays bound to go-to-definition (same as Cmd+B). Add a cursor with Alt+Click;
      // toggle persistent column/box selection with the `editor.toggleColumnSelection`
      // action below.
      multiCursorModifier: "alt",
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
      minimapEnabled,
      monacoFontLigatures,
      wordWrapEnabled,
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
      aria-labelledby={!embeddedInGroupPanel && activeDocument
        ? getTabId(activeDocument.path, groupId)
        : undefined}
      className="editor-panel"
      id={!embeddedInGroupPanel && activeDocument
        ? getTabPanelId(activeDocument.path, groupId)
        : undefined}
      onFocusCapture={() => {
        activateEditorGroupFromInteraction();
      }}
      onMouseDown={() => {
        activateEditorGroupFromInteraction();
      }}
      role={embeddedInGroupPanel ? undefined : "tabpanel"}
    >
      {activeDocument ? (
        <Breadcrumbs
          fileName={activeDocument.name}
          onNavigate={navigateToBreadcrumbSymbol}
          path={breadcrumbPath}
          symbols={breadcrumbSymbols}
        />
      ) : null}
      <Editor
        beforeMount={handleBeforeMount}
        height="100%"
        keepCurrentModel
        language={activeDocument ? activeDocument.language : PLACEHOLDER_LANGUAGE}
        loading={EDITOR_LOADING_PLACEHOLDER}
        onMount={handleMount}
        options={editorOptions}
        path={
          activeDocument && workspaceRoot
            ? workspaceModelUri(workspaceRoot, activeDocument.path) ??
              activeDocument.path
            : PLACEHOLDER_PATH
        }
        theme={monacoTheme}
        value={
          activeDocument && activeDocumentContentReady && !isOpeningFile
            ? activeDocument.content
            : undefined
        }
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
            <div
              aria-label="Change navigation"
              className="editor-change-popover-nav"
            >
              <button
                aria-label="Go to previous change"
                className="editor-change-popover-icon-button editor-change-popover-action-previous"
                onClick={() => onPopoverGoToChange("previous")}
                title="Previous change"
                type="button"
              >
                <ChevronUp aria-hidden="true" size={14} />
              </button>
              <button
                aria-label="Go to next change"
                className="editor-change-popover-icon-button editor-change-popover-action-next"
                onClick={() => onPopoverGoToChange("next")}
                title="Next change"
                type="button"
              >
                <ChevronDown aria-hidden="true" size={14} />
              </button>
              <button
                aria-label="Close local change preview"
                className="editor-change-popover-icon-button"
                onClick={() => setChangePreview(null)}
                title="Close"
                type="button"
              >
                <X aria-hidden="true" size={14} />
              </button>
            </div>
          </div>
          {changePreview.hunk.originalLines.length > 0 ? (
            <>
              <div className="editor-change-popover-section-label">
                Previous content
              </div>
              <pre className="editor-change-popover-code editor-change-popover-code-removed">
                {changePreviewText(changePreview.hunk)}
              </pre>
            </>
          ) : null}
          {changePreview.hunk.currentLines.length > 0 ? (
            <>
              <div className="editor-change-popover-section-label">
                Current content
              </div>
              <pre className="editor-change-popover-code editor-change-popover-code-added">
                {changePreview.hunk.currentLines.join("\n")}
              </pre>
            </>
          ) : null}
          <div className="editor-change-popover-actions">
            <button
              className="editor-change-popover-action editor-change-popover-action-revert"
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
const MemoizedEditorSurfaceComponent = memo(EditorSurfaceComponent);

export const EditorSurface = memo(function EditorSurface(
  props: EditorSurfaceProps,
) {
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

function editorActionForMenuCommand(command: EditorMenuCommand): string {
  switch (command) {
    case "copy":
      return "editor.action.clipboardCopyAction";
    case "cut":
      return "editor.action.clipboardCutAction";
    case "gotoLine":
      return "editor.action.gotoLine";
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

function editorActionForSurfaceCommand(
  commandId: EditorSurfaceCommandId,
): string | null {
  switch (commandId) {
    case "editor.formatDocument":
      return "editor.action.formatDocument";
    case "editor.formatSelection":
      return "editor.action.formatSelection";
    case "editor.gotoLine":
      return "editor.action.gotoLine";
    case "editor.nextChange":
    case "editor.previousChange":
      return null;
    case "editor.quickDefinition":
      return "editor.action.peekDefinition";
    case "editor.quickFix":
      return "editor.action.quickFix";
    case "editor.rename":
      return "editor.action.rename";
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
  modelUri: string;
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
    modelUri: model.uri.toString(),
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

// Word characters for the hippie prefix under the caret. Mirrors the domain
// module's WORD_CHAR set (PHP `$user`, JS `foo_bar2`) so the prefix we slice and
// the candidates we match agree.
const HIPPIE_WORD_CHAR = /[A-Za-z0-9_$]/;

// Cyclic Expand Word (PhpStorm "Cyclic Expand Word" / Emacs hippie, Alt+/).
// Expands the word prefix before the caret to the nearest matching buffer word;
// pressing again immediately cycles through the remaining candidates and wraps
// back to the typed prefix. Pure text from the live buffer only - no LSP/disk.
function applyCyclicExpandWord(
  monaco: typeof Monaco,
  editor: Monaco.editor.IStandaloneCodeEditor,
  sessionRef: MutableRefObject<HippieSession | null>,
): void {
  const model = editor.getModel();
  const position = editor.getPosition();

  if (!model || !position) {
    sessionRef.current = null;
    return;
  }

  const documentText = model.getValue();
  const cursorOffset = model.getOffsetAt(position);
  const session = continueOrStartHippieSession(
    sessionRef.current,
    documentText,
    cursorOffset,
  );

  if (!session) {
    sessionRef.current = null;
    return;
  }

  const replaceEndOffset = currentHippieEndOffset(sessionRef.current, session);
  const startPosition = model.getPositionAt(session.anchorOffset);
  const endPosition = model.getPositionAt(replaceEndOffset);

  editor.executeEdits("mockor.cyclicExpandWord", [
    {
      forceMoveMarkers: true,
      range: new monaco.Range(
        startPosition.lineNumber,
        startPosition.column,
        endPosition.lineNumber,
        endPosition.column,
      ),
      text: session.word,
    },
  ]);

  const caretPosition = model.getPositionAt(
    session.anchorOffset + session.word.length,
  );
  editor.setPosition(caretPosition);
  sessionRef.current = session;
}

// Decides whether the previous expansion is still live (same anchor, and the
// buffer at the anchor still holds exactly the last inserted word ending at the
// caret). If so we cycle to the next candidate; otherwise we start a fresh
// expansion from the prefix currently under the caret.
function continueOrStartHippieSession(
  previous: HippieSession | null,
  documentText: string,
  cursorOffset: number,
): HippieSession | null {
  if (previous && isLiveHippieSession(previous, documentText, cursorOffset)) {
    return advanceHippieSession(previous);
  }

  const prefix = hippiePrefixBefore(documentText, cursorOffset);
  return startHippieSession(documentText, prefix, cursorOffset);
}

function isLiveHippieSession(
  session: HippieSession,
  documentText: string,
  cursorOffset: number,
): boolean {
  const expectedEnd = session.anchorOffset + session.word.length;

  if (cursorOffset !== expectedEnd) {
    return false;
  }

  return (
    documentText.slice(session.anchorOffset, expectedEnd) === session.word
  );
}

// The offset where the text being replaced ends. On a fresh expansion the caret
// sits at the end of the typed prefix (anchor + prefix length); when cycling we
// replace the previously inserted word (anchor + previous word length).
function currentHippieEndOffset(
  previous: HippieSession | null,
  session: HippieSession,
): number {
  if (previous && previous.anchorOffset === session.anchorOffset) {
    return previous.anchorOffset + previous.word.length;
  }

  return session.anchorOffset + session.prefix.length;
}

function hippiePrefixBefore(documentText: string, cursorOffset: number): string {
  let start = cursorOffset;

  while (start > 0 && HIPPIE_WORD_CHAR.test(documentText[start - 1])) {
    start -= 1;
  }

  return documentText.slice(start, cursorOffset);
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
  if (
    !model ||
    model.uri.toString() !== request.modelUri ||
    modelPath(model) !== request.path
  ) {
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

function triggerEditorSurfaceCommand(
  editor: Monaco.editor.IStandaloneCodeEditor,
  commandId: EditorSurfaceCommandId,
): void {
  if (!editor.getModel()) {
    return;
  }

  if (commandId === "editor.quickFix" && !editor.getPosition()) {
    return;
  }

  const actionId = editorActionForSurfaceCommand(commandId);

  if (!actionId) {
    return;
  }

  editor.trigger("keyboard", actionId, {});
}

function createEditorSurfaceCommandRunner({
  captureScope,
  changeHunksRef,
  editor,
}: {
  captureScope(): EditorSurfaceCommandInvocationScope | null;
  changeHunksRef: MutableRefObject<EditorChangeHunk[]>;
  editor: Monaco.editor.IStandaloneCodeEditor;
}): EditorSurfaceCommandRunner {
  const runner: EditorSurfaceCommandRunner = (commandId, scope) => {
    if (scope && !runner.isScopeCurrent?.(scope)) {
      return;
    }

    if (!captureScope()) {
      return;
    }

    editor.focus();

    if (commandId === "editor.nextChange") {
      jumpToChangeHunk(editor, changeHunksRef.current, "next");
      return;
    }

    if (commandId === "editor.previousChange") {
      jumpToChangeHunk(editor, changeHunksRef.current, "previous");
      return;
    }

    triggerEditorSurfaceCommand(editor, commandId);
  };
  runner.captureScope = captureScope;
  runner.isScopeCurrent = (scope) => {
    const currentScope = captureScope();

    if (!currentScope) {
      return false;
    }

    return editorSurfaceCommandInvocationScopesEqual(scope, currentScope);
  };
  runner.isEnabled = (commandId, scope) => {
    if (scope && !runner.isScopeCurrent?.(scope)) {
      return false;
    }

    if (!captureScope()) {
      return false;
    }

    if (
      commandId === "editor.nextChange" ||
      commandId === "editor.previousChange"
    ) {
      return changeHunksRef.current.length > 0;
    }

    return true;
  };

  return runner;
}

function runRegisteredCommand(
  runnerRef: MutableRefObject<CommandExecutionRunner | undefined>,
  commandId: string,
  fallback: () => void,
): void {
  const runner = runnerRef.current;

  if (!runner) {
    fallback();
    return;
  }

  if (runner(commandId) !== "missing") {
    return;
  }

  fallback();
}

function resolveCompleteWorkspaceIdentityDescriptor(
  descriptor:
    | WorkspaceIdentityDescriptor
    | IncompleteWorkspaceIdentityDescriptor
    | null,
): WorkspaceIdentityDescriptor | null {
  if (typeof descriptor?.workspaceId !== "string") {
    return null;
  }

  if (typeof descriptor.canonicalRoot !== "string") {
    return null;
  }

  return descriptor;
}

function requestRegisteredCommand(
  runnerRef: MutableRefObject<CommandExecutionRunner | undefined>,
  commandId: string,
): void {
  const runner = runnerRef.current;

  if (!runner) {
    return;
  }

  runner(commandId);
}

function dismissTransientEditorWidgets(
  editor: Monaco.editor.IStandaloneCodeEditor,
  source: string,
): void {
  dismissTransientEditorWidgetsNow(editor, source);

  window.setTimeout(() => {
    dismissTransientEditorWidgetsNow(editor, source);
  }, 0);
}

function dismissTransientEditorWidgetsNow(
  editor: Monaco.editor.IStandaloneCodeEditor,
  source: string,
): void {
  if (!editor.getModel()) {
    return;
  }

  editor.trigger(source, "editor.action.hideHover", {});
  editor.trigger(source, "closeFindWidget", {});
  editor.trigger(source, "hideSuggestWidget", {});
  clearMonacoTransientAccessibilityStatus(editor);
}

function clearMonacoTransientAccessibilityStatus(
  editor: Monaco.editor.IStandaloneCodeEditor,
): void {
  const domNode = editor.getDomNode();

  if (!domNode) {
    return;
  }

  const root = domNode.ownerDocument ?? document;

  root
    .querySelectorAll<HTMLElement>(".monaco-aria-container, .monaco-status")
    .forEach((element) => {
      element.textContent = "";
    });
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
const EMPTY_BREAKPOINTS: readonly Breakpoint[] = Object.freeze([]);
const EMPTY_USER_SNIPPETS: readonly UserSnippet[] = Object.freeze([]);
const noopLocalPhpDiagnosticsChange = () => undefined;
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
  configureShikiLanguageFeatures(monaco);
  setupEmmet(monaco);
  setupShikiTokenization(monaco, theme).catch((error) => {
    console.error("Shiki tokenization setup failed", error);
  });
}

function isLargeSmartModel(
  model: Monaco.editor.ITextModel,
  policy: LargeSmartDocumentPolicy,
): boolean {
  if (
    typeof model.getValueLength !== "function" ||
    typeof model.getLineCount !== "function"
  ) {
    return false;
  }

  const normalizedPolicy = normalizeLargeSmartDocumentPolicy(policy);
  if (model.getValueLength() > normalizedPolicy.characterLimit) {
    return true;
  }

  return model.getLineCount() > normalizedPolicy.lineLimit;
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

function isSmartBlankLineIndentDocument(document: EditorDocument): boolean {
  return (
    document.language === "php" ||
    document.language === "blade" ||
    document.language === "latte" ||
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

function breakpointGlyphStateClassName(breakpoint: Breakpoint): string {
  if (!breakpoint.enabled) {
    return "breakpoint-glyph-disabled";
  }

  if (breakpoint.verified === false) {
    return "breakpoint-glyph-unverified";
  }

  return "breakpoint-glyph-verified";
}

function toBreakpointDecoration(
  monaco: typeof Monaco,
  breakpoint: Breakpoint,
): Monaco.editor.IModelDeltaDecoration {
  return {
    options: {
      glyphMargin: {
        position: monaco.editor.GlyphMarginLane.Left,
      },
      glyphMarginClassName: `breakpoint-glyph ${breakpointGlyphStateClassName(breakpoint)}`,
      isWholeLine: false,
      stickiness:
        monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      zIndex: 30,
    },
    range: new monaco.Range(
      breakpoint.lineNumber,
      1,
      breakpoint.lineNumber,
      1,
    ),
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

export function gitBlameShaAtLine(
  lines: readonly GitBlameLine[],
  lineNumber: number,
): string | null {
  const line = lines.find((candidate) => candidate.lineNumber === lineNumber);

  if (!line || !line.sha || isUncommittedBlameLine(line)) {
    return null;
  }

  return line.sha;
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

// Moves the caret to the next/previous gutter change hunk in the active editor,
// mirroring VS Code's "Go to Next/Previous Change". The hunks come from the live
// editorChangeMarkers (the same ranges that render the gutter glyphs), so the
// jump always lands on a real change. The list wraps around (last -> first and
// first -> last) so repeated presses cycle every change without dead-ending.
function jumpToChangeHunk(
  editor: Monaco.editor.IStandaloneCodeEditor,
  hunks: EditorChangeHunk[],
  direction: "next" | "previous",
): void {
  if (!hunks.length || !editor.getModel()) {
    return;
  }

  const ordered = [...hunks].sort(
    (left, right) => left.startLineNumber - right.startLineNumber,
  );
  const currentLine = editor.getPosition()?.lineNumber ?? 1;
  const target = nextChangeHunk(ordered, currentLine, direction);

  if (!target) {
    return;
  }

  const position = { column: 1, lineNumber: target.startLineNumber };
  editor.setPosition(position);
  editor.revealPositionInCenter(position);
  editor.focus();
}

// Popover-driven navigation. Like jumpToChangeHunk it moves the caret to the
// next/previous hunk, but it is anchored on the hunk the popover is currently
// showing (`fromLine`, not the caret) and it RETURNS the landed hunk so the
// caller can move the gutter rollback popover onto it too - keeping the popover
// and the editor in sync, the JetBrains behavior. The list wraps around so
// repeated presses cycle every change without dead-ending.
function navigateChangeHunkFromPopover(
  editor: Monaco.editor.IStandaloneCodeEditor,
  hunks: EditorChangeHunk[],
  fromLine: number,
  direction: "next" | "previous",
): EditorChangeHunk | null {
  if (!hunks.length || !editor.getModel()) {
    return null;
  }

  const ordered = [...hunks].sort(
    (left, right) => left.startLineNumber - right.startLineNumber,
  );
  const target = nextChangeHunk(ordered, fromLine, direction);

  if (!target) {
    return null;
  }

  const position = { column: 1, lineNumber: target.startLineNumber };
  editor.setPosition(position);
  editor.revealPositionInCenter(position);
  editor.focus();
  return target;
}

function nextChangeHunk(
  ordered: EditorChangeHunk[],
  currentLine: number,
  direction: "next" | "previous",
): EditorChangeHunk | null {
  if (direction === "next") {
    return (
      ordered.find((hunk) => hunk.startLineNumber > currentLine) ??
      ordered[0] ??
      null
    );
  }

  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    if (ordered[index].startLineNumber < currentLine) {
      return ordered[index];
    }
  }

  return ordered[ordered.length - 1] ?? null;
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

/**
 * Marker for a lightweight PHP inspection (unused import / unused private
 * method). Rendered as a Warning with Monaco's `Unnecessary` tag so the editor
 * fades the span (PhpStorm's greyed-out "never used" look). Tagged with the
 * `PHP Inspection` source so quick-fix discovery and code-action matching can
 * recognise it.
 */
function toMonacoInspectionMarker(
  monaco: typeof Monaco,
  diagnostic: PhpInspectionDiagnostic,
): Monaco.editor.IMarkerData {
  const endColumn =
    diagnostic.endLine === diagnostic.line
      ? Math.max(diagnostic.endCharacter + 1, diagnostic.character + 2)
      : diagnostic.endCharacter + 1;

  return {
    endColumn,
    endLineNumber: diagnostic.endLine + 1,
    message: diagnostic.message,
    severity: monaco.MarkerSeverity.Warning,
    source: "PHP Inspection",
    startColumn: diagnostic.character + 1,
    startLineNumber: diagnostic.line + 1,
    tags: [monaco.MarkerTag.Unnecessary],
  };
}

function toLocalPhpDiagnostic(
  diagnostic: PhpSyntaxDiagnostic | PhpInspectionDiagnostic,
  source: string,
  severity: LanguageServerDiagnostic["severity"],
): LanguageServerDiagnostic {
  return {
    character: diagnostic.character,
    endCharacter: diagnostic.endCharacter,
    endLine: diagnostic.endLine,
    line: diagnostic.line,
    message: diagnostic.message,
    severity,
    source,
    tags:
      "unnecessary" in diagnostic && diagnostic.unnecessary ? [1] : undefined,
  };
}

function applyLocalPhpValidationSnapshot(
  snapshot: LocalPhpValidationSnapshot<
    PhpSyntaxDiagnostic,
    PhpInspectionDiagnostic
  >,
  monaco: typeof Monaco,
  path: string,
  writeMarkers: (markers: readonly Monaco.editor.IMarkerData[]) => void,
  onDiagnosticsChange: (
    path: string,
    diagnostics: LanguageServerDiagnostic[],
  ) => void,
  setSyntaxDiagnostics: Dispatch<
    SetStateAction<Record<string, PhpSyntaxDiagnostic[]>>
  >,
  setInspectionDiagnosticCounts: Dispatch<
    SetStateAction<Record<string, number>>
  >,
): void {
  const { inspectionDiagnostics, syntaxDiagnostics } = snapshot;

  onDiagnosticsChange(path, [
    ...syntaxDiagnostics.map((diagnostic) =>
      toLocalPhpDiagnostic(diagnostic, "PHP Syntax", "error"),
    ),
    ...inspectionDiagnostics.map((diagnostic) =>
      toLocalPhpDiagnostic(diagnostic, "PHP Inspection", "warning"),
    ),
  ]);
  setSyntaxDiagnostics((current) => ({
    ...current,
    [path]: syntaxDiagnostics,
  }));
  setInspectionDiagnosticCounts((current) => {
    if (inspectionDiagnostics.length > 0) {
      return {
        ...current,
        [path]: inspectionDiagnostics.length,
      };
    }
    if (current[path] === undefined) {
      return current;
    }

    const next = { ...current };
    delete next[path];
    return next;
  });
  writeMarkers([
    ...syntaxDiagnostics.map((diagnostic) =>
      toMonacoSyntaxDiagnosticMarker(monaco, diagnostic),
    ),
    ...inspectionDiagnostics.map((diagnostic) =>
      toMonacoInspectionMarker(monaco, diagnostic),
    ),
  ]);
}

function localPhpDiagnosticsFromVisibleMarkers(
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel,
): LanguageServerDiagnostic[] {
  return monaco.editor
    .getModelMarkers({ resource: model.uri })
    .filter((marker) => isVisiblePhpProblemMarker(monaco, marker))
    .map((marker) => ({
      character: marker.startColumn - 1,
      endCharacter: marker.endColumn - 1,
      endLine: marker.endLineNumber - 1,
      line: marker.startLineNumber - 1,
      message: marker.message,
      severity: localPhpDiagnosticSeverityFromMarker(monaco, marker.severity),
      source: marker.source ?? "PHP",
      tags: marker.tags?.map((tag) => Number(tag)),
    }));
}

function isVisiblePhpProblemMarker(
  monaco: typeof Monaco,
  marker: Monaco.editor.IMarker,
): boolean {
  return (
    marker.severity === monaco.MarkerSeverity.Error ||
    marker.severity === monaco.MarkerSeverity.Warning
  );
}

function localPhpDiagnosticSeverityFromMarker(
  monaco: typeof Monaco,
  severity: Monaco.MarkerSeverity,
): LanguageServerDiagnostic["severity"] {
  if (severity === monaco.MarkerSeverity.Error) {
    return "error";
  }

  if (severity === monaco.MarkerSeverity.Warning) {
    return "warning";
  }

  if (severity === monaco.MarkerSeverity.Hint) {
    return "hint";
  }

  return "information";
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
  workspaceRoot: string | null,
  path: string,
): Monaco.editor.ITextModel | null {
  return monaco.editor
    .getModels()
    .find((model) => modelMatchesProject(model, workspaceRoot, path)) ?? null;
}

function modelMatchesProject(
  model: Monaco.editor.ITextModel,
  workspaceRoot: string | null,
  path: string,
): boolean {
  return workspaceRoot
    ? modelMatchesWorkspacePath(model, workspaceRoot, path)
    : modelPath(model) === path;
}

function synchronizeActiveDocumentModel(
  editor: Monaco.editor.IStandaloneCodeEditor,
  workspaceRoot: string | null,
  document: EditorDocument,
): Monaco.editor.ITextModel | null {
  const model = editor.getModel();

  if (!model || model.isDisposed?.()) {
    return null;
  }

  if (!modelMatchesProject(model, workspaceRoot, document.path)) {
    return null;
  }

  if (model.getValue() !== document.content) {
    model.setValue(document.content);
  }

  if (model.isDisposed?.() || editor.getModel() !== model) {
    return null;
  }

  return model;
}

async function foldingModelForEditor(
  editor: Monaco.editor.IStandaloneCodeEditor,
): Promise<FoldingModelViewState | null> {
  const contribution = editor.getContribution(
    "editor.contrib.folding",
  ) as unknown as FoldingControllerViewState | null;

  if (typeof contribution?.getFoldingModel !== "function") {
    return null;
  }

  try {
    return await contribution.getFoldingModel();
  } catch {
    return null;
  }
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
    ".": "Period",
    "-": "Minus",
    "/": "Slash",
    "=": "Equal",
    "`": "Backquote",
    "[": "BracketLeft",
    "]": "BracketRight",
    arrowdown: "DownArrow",
    arrowleft: "LeftArrow",
    arrowright: "RightArrow",
    arrowup: "UpArrow",
    enter: "Enter",
    escape: "Escape",
    f12: "F12",
    f2: "F2",
    f5: "F5",
  };
  const keyCodeName = specialKeyCodes[key];

  return keyCodeName ? monaco.KeyCode[keyCodeName] ?? null : null;
}
