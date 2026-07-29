import type * as Monaco from "monaco-editor";
import type { EditorDocument } from "../domain/workspace";
import {
  pathFromLanguageServerUri,
  toLanguageServerTextDocumentPosition,
  type LanguageServerCodeAction,
  type LanguageServerCodeActionCommand,
  type LanguageServerCodeActionContext,
  type LanguageServerCompletionList,
  type LanguageServerCodeLens,
  type LanguageServerFeaturesGateway,
  type LanguageServerInlayHint,
  type LanguageServerLocation,
  type LanguageServerRefreshEvent,
  type LanguageServerRefreshGateway,
  type LanguageServerSignature,
  type LanguageServerSignatureHelp,
  type LanguageServerSignatureHelpContext,
  type LanguageServerTextDocumentPosition,
  type LanguageServerWorkspaceEdit,
  type LanguageServerWorkspaceEditGateway,
} from "../domain/languageServerFeatures";
import {
  createDocumentHighlightRequestTracker,
  type DocumentHighlightRequestTracker,
} from "../domain/documentHighlightRequestTracker";
import type { PhpParameterNameInlayHint } from "../domain/phpInlayHints";
import type { LargeSmartDocumentPolicy } from "../domain/largeDocumentPolicy";
import {
  phpPostfixCompletionContextAt,
  phpPostfixCompletionItems,
} from "../domain/phpPostfixCompletions";
import {
  normalizeUserSnippets,
  snippetCompletionSuggestions,
  type UserSnippet,
} from "../domain/snippets";
import {
  orderPhpMemberCompletionsByCategory,
  phpMemberAccessCompletionContextAt,
  phpStaticAccessCompletionContextAt,
  type PhpMethodCompletion,
  type PhpMethodSignature,
} from "../domain/phpMethodCompletions";
import { phpVariableCompletionsAt } from "../domain/phpScopeCompletions";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type {
  PhpCodeActionDescriptor,
  PhpCodeActionNewFile,
  PhpCodeActionRange,
  PhpCodeActionTextEdit,
  PhpCodeActionWorkspaceEditApplier,
} from "../application/phpCodeActionTypes";
import type {
  WorkspaceEditApplicationContext,
  WorkspaceEditApplicationDecision,
} from "../application/workspaceEditApplication";
import {
  registerTemplateLanguageMonacoProviders,
  type TemplateLanguageMonacoProviderContext,
} from "./templateLanguageMonacoProviders";
import {
  phpFrameworkCompletionSuggestions,
  providePhpFrameworkDefinitionBeforeLsp,
  phpFrameworkStringCompletionOwnsContext,
  type PhpFrameworkMonacoProviderContext,
} from "./phpFrameworkMonacoProviders";
import {
  activePhpDocumentContext,
  isPhpDocumentContextActive,
  modelPath,
  modelSource,
  offsetAtMonacoPosition,
  registerWorkspaceIdentityDescriptor,
  toWorkspaceMonacoUri,
  type WorkspaceIdentityDescriptor,
} from "./phpMonacoDocumentContext";
import {
  flattenSelectionRange,
  toLanguageServerFormattingOptions,
  toLanguageServerRange,
  toMonacoDocumentHighlight,
  toMonacoDocumentSymbol,
  toMonacoFoldingRange,
  toMonacoLinkedEditingRanges,
  toMonacoRange,
  toMonacoSemanticTokens,
  toMonacoTextEdit,
} from "./languageServerMonacoMappings";
import { registerDocumentLanguageServerProviders } from "./languageServerProviders/documentProviderRegistration";
import { registerInteractiveLanguageServerProviders } from "./languageServerProviders/interactiveProviderRegistration";
import { registerNavigationLanguageServerProviders } from "./languageServerProviders/navigationProviderRegistration";
import {
  FEATURE_REQUEST_TIMED_OUT,
  HOVER_FEATURE_REQUEST_TIMEOUT_MS,
  featureDocumentRequestContext,
  featureRequestContext,
  flushPendingDocumentChangeForActiveRequest,
  isDocumentLifecyclePayloadActive,
  isExecuteCommandPayloadActive,
  isFeatureRequestActive,
  isPathInWorkspaceRoot,
  isLargePhpDocumentContext,
  raceInteractiveFeatureRequest,
  reportErrorForActiveRequest,
  reportErrorForActiveWorkspaceEditEvent,
  runningRuntimeStatusForRoot,
  shouldSkipLargePhpSmartProviders,
  workspaceSymbolRequestContext,
  type LanguageServerMonacoDocumentRequestLease,
} from "./languageServerProviders/providerRequestLifecycle";
import {
  toMonacoDocumentLink,
  toMonacoLocation,
  toMonacoWorkspaceEdit,
  toMonacoWorkspaceSymbol,
  workspaceEditContext,
  type LanguageServerBackedLink,
  type WorkspaceEditContext,
} from "./languageServerProviders/providerProjections";
import {
  createMonacoEventEmitter,
  type MonacoEventEmitter,
} from "./languageServerProviders/providerRegistrationTypes";
import {
  applyWorkspaceEditEvent,
  applyWorkspaceEditWithOpenModels,
  createOpenModelWorkspaceEditApplier,
} from "./languageServerProviders/workspaceEditApplication";
import {
  phpMethodCompletionKind,
  phpMethodDetail,
  phpMethodDocumentation,
  phpMethodCompletionLabel,
  phpMethodSignatureLabel,
  phpMethodCompletionShouldTriggerParameterHints,
  phpMethodInsertText,
  phpMethodInsertTextRules,
  phpParameterLabel,
  lspCompletionInsert,
  completionItemValuesLookLikeSignature,
  phpCallableCompletionName,
  completionRange,
  dedupeCompletionItems,
  monacoCompletionKindFromLspKind,
} from "./languageServerProviders/phpCompletionProjection";

export type {
  BladeCompletion,
  BladeCompletionKind,
  LatteCompletion,
  LatteCompletionKind,
  NeonCompletion,
  NeonCompletionKind,
} from "./templateLanguageMonacoProviders";
export type {
  PhpCodeActionDescriptor,
  PhpCodeActionNewFile,
  PhpCodeActionRange,
} from "../application/phpCodeActionTypes";

type MonacoApi = typeof Monaco;
type MonacoModel = Monaco.editor.ITextModel;
type MonacoPosition = Monaco.Position;
type Disposable = Monaco.IDisposable;
type MonacoWorkspaceSymbol =
  import("./languageServerProviders/providerRegistrationTypes").MonacoWorkspaceSymbol;
export type { LanguageServerMonacoDocumentRequestLease } from "./languageServerProviders/providerRequestLifecycle";
export type PhpWorkspaceEditApplicationContext = WorkspaceEditApplicationContext;

export type PhpWorkspaceEditApplier = (
  edit: LanguageServerWorkspaceEdit,
  context: PhpWorkspaceEditApplicationContext,
) => Promise<WorkspaceEditApplicationDecision | void> | WorkspaceEditApplicationDecision | void;

interface LanguageServerBackedCodeAction extends Monaco.languages.CodeAction {
  __documentLifecycleIdentity?: number;
  __languageServerAction?: LanguageServerCodeAction;
  __languageServerSessionId?: number;
  __sourcePath?: string;
  __workspaceEditContext?: WorkspaceEditContext;
  __workspaceRoot?: string;
}

interface LanguageServerBackedCodeLens extends Monaco.languages.CodeLens {
  __documentLifecycleIdentity?: number;
  __languageServerLens?: LanguageServerCodeLens;
  __languageServerSessionId?: number;
  __sourcePath?: string;
  __workspaceRoot?: string;
}

interface LanguageServerBackedInlayHint extends Monaco.languages.InlayHint {
  __documentLifecycleIdentity?: number;
  __languageServerInlayHint?: LanguageServerInlayHint;
  __languageServerSessionId?: number;
  __sourcePath?: string;
  __workspaceRoot?: string;
}

interface ExecuteCommandPayload {
  command: LanguageServerCodeActionCommand;
  lifecycleIdentity?: number;
  path?: string;
  rootPath: string;
  sessionId: number;
}

interface ResolveAndApplyCodeActionPayload {
  action: LanguageServerCodeAction;
  editContext: WorkspaceEditContext;
  lifecycleIdentity?: number;
  path?: string;
  rootPath: string;
  sessionId: number;
}

interface ApplyPhpCodeActionNewFilePayload {
  edits: PhpCodeActionTextEdit[];
  newFile: PhpCodeActionNewFile;
  sourcePath: string | null;
  sourceModelUri: string;
  versionId: number | undefined;
}

interface ApplyPhpCodeActionWorkspaceEditPayload {
  edit: LanguageServerWorkspaceEdit;
  rootPath: string;
}

type OpenPhpChangeSignaturePayload = NonNullable<PhpCodeActionDescriptor["interaction"]>;

const EXECUTE_PHP_LANGUAGE_SERVER_COMMAND_ID = "mockor.php.executeLanguageServerCommand";
const RESOLVE_AND_APPLY_PHP_CODE_ACTION_ID = "mockor.php.resolveAndApplyCodeAction";
/**
 * Monaco command fired by a synthesized PHP code action that creates a new file
 * (currently "Extract interface"). The command persists the new interface file
 * first and then applies the paired in-document edit, so a failed file creation
 * cannot leave a partial `implements` clause behind.
 */
const APPLY_PHP_CODE_ACTION_NEW_FILE_COMMAND_ID = "mockor.php.applyCodeActionNewFile";
const APPLY_PHP_CODE_ACTION_WORKSPACE_EDIT_COMMAND_ID = "mockor.php.applyCodeActionWorkspaceEdit";
const OPEN_PHP_CHANGE_SIGNATURE_COMMAND_ID = "codevo.php.openChangeSignature";
/**
 * Upper bound (ms) for an interactive hover / navigation request before the
 * provider gives up and resolves to "no result". A cold phpactor (mid-index or
 * just-warmed) can take seconds to answer; without a bound the Monaco hover
 * widget would show its "Loading…" placeholder indefinitely. A warm phpactor
 * answers in well under this budget, so the timeout only trips on genuinely
 * stuck cold requests and never cancels a legitimate (slower-but-valid) result.
 */
/**
 * Shorter upper bound (ms) for a hover request. Hover is passive information,
 * so the worse outcome is leaving the Monaco "Loading…" placeholder on screen
 * for the full {@link INTERACTIVE_FEATURE_REQUEST_TIMEOUT_MS} budget when a cold
 * phpactor is slow. A warm phpactor answers a symbol hover in well under this
 * budget, so the only behavioural change is that a stuck cold hover tears down
 * its "Loading…" widget in ~700ms (PhpStorm-like) instead of 2.5s. Actionable
 * navigation/references/completion requests keep the longer budget.
 */
const PHP_SIGNATURE_MERGE_WINDOW_MS = 20;
const PHP_SIGNATURE_MERGE_WINDOW_EXPIRED = Symbol("phpSignatureMergeWindowExpired");
const PHP_SEMANTIC_TOKENS_LEGEND = {
  tokenModifiers: [
    "declaration",
    "definition",
    "readonly",
    "static",
    "deprecated",
    "abstract",
    "async",
    "modification",
    "documentation",
    "defaultLibrary",
  ],
  tokenTypes: [
    "namespace",
    "type",
    "class",
    "enum",
    "interface",
    "struct",
    "typeParameter",
    "parameter",
    "variable",
    "property",
    "enumMember",
    "event",
    "function",
    "method",
    "macro",
    "keyword",
    "modifier",
    "comment",
    "string",
    "number",
    "regexp",
    "operator",
  ],
} satisfies Monaco.languages.SemanticTokensLegend;

export interface LanguageServerMonacoProviderContext
  extends TemplateLanguageMonacoProviderContext, PhpFrameworkMonacoProviderContext {
  getDocumentForModel?(model: MonacoModel): EditorDocument | null;
  getWorkspaceIdentityDescriptor?(): WorkspaceIdentityDescriptor | null;
  /**
   * Persists a PHP code action's new file (e.g. "Extract interface" writes a
   * sibling `<Class>Interface.php`) to DISK and opens it in a tab. When wired,
   * the code-action mapper routes the new file through this controller callback
   * (a monaco command) instead of monaco's in-memory file-create bulk edit, so
   * the interface is a real `.php` file that survives reopening the workspace.
   * The controller owns the gateway write, the file-tree refresh, the tab open
   * AND the per-project isolation (requested-root capture + re-check after each
   * await). RESOLVES `true` only when the file was freshly written; the command
   * applies the paired in-document edit (e.g. the `implements` clause) ONLY then,
   * so a pre-existing target or a failed write never leaves a partial class edit.
   * Omitted callers fall back to the legacy in-memory monaco file-create edit.
   */
  applyPhpCodeActionNewFile?(newFile: PhpCodeActionNewFile): Promise<boolean>;
  applyWorkspaceEdit?: PhpWorkspaceEditApplier;
  openPhpChangeSignature?(
    request: OpenPhpChangeSignaturePayload,
    applyWorkspaceEdit: PhpCodeActionWorkspaceEditApplier,
  ): void;
  clearLanguageServerDiagnosticsForPath?(path: string): void;
  coordinatePhpDocumentSymbols?(
    request: {
      content: string;
      lifecycleIdentity: number;
      path: string;
      rootPath: string;
      runtimeIdentity: object;
      sessionId: number;
    },
    load: () => ReturnType<LanguageServerFeaturesGateway["documentSymbols"]>,
  ): ReturnType<LanguageServerFeaturesGateway["documentSymbols"]>;
  featuresGateway: LanguageServerFeaturesGateway;
  flushPendingDocumentChange(path: string): Promise<void>;
  requestDocumentLease?(
    rootPath: string,
    path: string,
  ): Promise<LanguageServerMonacoDocumentRequestLease | null>;
  isDocumentLeaseCurrent?(lease: LanguageServerMonacoDocumentRequestLease): boolean;
  getDocumentLifecycleIdentity?(rootPath: string, path: string): number | null;
  /**
   * Reports whether `path` has already been opened on the language server (its
   * `didOpen` was sent) for `rootPath`. Used to gate the `documentSymbol`
   * request so an outline / breadcrumb fetch never races ahead of the document
   * sync and triggers an `UnknownDocument` error. When omitted the provider
   * does not gate (the controller's `flushPendingDocumentChange` still opens the
   * document on demand for interactive requests).
   */
  isDocumentSynced?(rootPath: string, path: string): boolean;
  /**
   * Reports whether PHP inlay hints (both the managed phpactor hints and the
   * TS-domain parameter-name fallback) are enabled for the active workspace.
   * When omitted the provider treats PHP inlay hints as enabled so callers that
   * do not wire the toggle keep the prior behaviour.
   */
  isPhpInlayHintsEnabled?(): boolean;
  getLargeSmartDocumentPolicy?(): LargeSmartDocumentPolicy;
  limitNavigationResultsToOpenModels?: boolean;
  providePhpCodeActions?(
    source: string,
    range: PhpCodeActionRange,
  ): Promise<PhpCodeActionDescriptor[]>;
  providePhpMethodCompletions?(
    source: string,
    position: MonacoPosition,
  ): Promise<PhpMethodCompletion[]>;
  providePhpMethodSignature?(
    source: string,
    position: MonacoPosition,
  ): Promise<PhpMethodSignature | null>;
  /**
   * Resolves PHP parameter-name inlay hints for the call expressions whose
   * opening parenthesis sits inside `range` (a 0-based inclusive line span). The
   * controller reuses the signature-resolution flow to map parameter names onto
   * positional arguments and enforces per-project isolation (requested-root
   * capture + re-check after each await), dropping stale results on a tab
   * switch. Returns one hint per argument that should display its parameter
   * name, with 0-based `line`/`character` positions.
   */
  providePhpParameterInlayHints?(
    source: string,
    range: { endLine: number; startLine: number },
  ): Promise<PhpParameterNameInlayHint[]>;
  /**
   * Records the wall-clock latency (in milliseconds) of a PHP language-server
   * completion round-trip so it can surface in the runtime latency panel. The
   * provider calls this once per completion request it actually issues to the
   * gateway. Omitted when the host wires no latency instrumentation; the
   * provider then skips the timestamp delta entirely (no hot-path cost).
   */
  recordCompletionLatency?(durationMs: number, rootPath?: string): void;
  refreshGateway?: LanguageServerRefreshGateway;
  workspaceEditGateway?: LanguageServerWorkspaceEditGateway;
}

export function registerLanguageServerMonacoProviders(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
): Disposable {
  const identityDescriptor = context.getWorkspaceIdentityDescriptor?.();
  const unregisterWorkspaceIdentity = identityDescriptor
    ? registerWorkspaceIdentityDescriptor(
        identityDescriptor,
        context.getWorkspaceRoot?.() ?? identityDescriptor.canonicalRoot,
      )
    : () => undefined;
  const documentHighlightTracker =
    createDocumentHighlightRequestTracker<Monaco.languages.DocumentHighlight>();
  const codeLensRefreshEmitter = createMonacoEventEmitter<void>();
  const inlayHintRefreshEmitter = createMonacoEventEmitter<void>();
  const semanticTokensRefreshEmitter = createMonacoEventEmitter<void>();
  let refreshUnsubscribe: (() => void) | null = null;
  let refreshSubscriptionDisposed = false;
  const refreshSubscriptionDisposable = {
    dispose: () => {
      refreshSubscriptionDisposed = true;
      refreshUnsubscribe?.();
      refreshUnsubscribe = null;
    },
  };
  let workspaceEditUnsubscribe: (() => void) | null = null;
  let workspaceEditSubscriptionDisposed = false;
  const workspaceEditSubscriptionDisposable = {
    dispose: () => {
      workspaceEditSubscriptionDisposed = true;
      workspaceEditUnsubscribe?.();
      workspaceEditUnsubscribe = null;
    },
  };

  if (context.refreshGateway) {
    context.refreshGateway
      .subscribeRefreshEvents((event) => {
        handleLanguageServerRefreshEvent(
          context,
          event,
          codeLensRefreshEmitter,
          inlayHintRefreshEmitter,
          semanticTokensRefreshEmitter,
        );
      })
      .then((unsubscribe) => {
        if (refreshSubscriptionDisposed) {
          unsubscribe();
          return;
        }

        refreshUnsubscribe = unsubscribe;
      })
      .catch((error) => context.reportError(error));
  }

  if (context.workspaceEditGateway) {
    context.workspaceEditGateway
      .subscribeWorkspaceEdits((event) => {
        void applyWorkspaceEditEvent(monaco, context, event).catch((error) => {
          reportErrorForActiveWorkspaceEditEvent(context, event, error);
        });
      })
      .then((unsubscribe) => {
        if (workspaceEditSubscriptionDisposed) {
          unsubscribe();
          return;
        }

        workspaceEditUnsubscribe = unsubscribe;
      })
      .catch((error) => context.reportError(error));
  }

  const command = monaco.editor.addCommand({
    id: EXECUTE_PHP_LANGUAGE_SERVER_COMMAND_ID,
    run: async (_accessor, payload: ExecuteCommandPayload | undefined) => {
      if (!payload) {
        return;
      }

      if (payload.sessionId == null || !isExecuteCommandPayloadActive(context, payload)) {
        return;
      }

      try {
        if (payload.path) {
          await context.flushPendingDocumentChange(payload.path);

          if (!isExecuteCommandPayloadActive(context, payload)) {
            return;
          }
        }

        const edit = await context.featuresGateway.executeCommand(
          payload.rootPath,
          payload.command,
        );

        if (!isExecuteCommandPayloadActive(context, payload)) {
          return;
        }

        if (edit) {
          await applyWorkspaceEditWithOpenModels(monaco, context, edit, payload.rootPath);
        }
      } catch (error) {
        if (isExecuteCommandPayloadActive(context, payload)) {
          context.reportError(error);
        }
      }
    },
  });
  const resolveAndApplyCodeActionCommand = monaco.editor.addCommand({
    id: RESOLVE_AND_APPLY_PHP_CODE_ACTION_ID,
    run: async (_accessor, payload: ResolveAndApplyCodeActionPayload | undefined) => {
      if (
        !payload ||
        payload.sessionId == null ||
        !isDocumentLifecyclePayloadActive(
          context,
          payload.rootPath,
          payload.sessionId,
          payload.path,
          payload.lifecycleIdentity,
        )
      ) {
        return;
      }

      try {
        if (payload.editContext.path) {
          await context.flushPendingDocumentChange(payload.editContext.path);

          if (
            !isDocumentLifecyclePayloadActive(
              context,
              payload.rootPath,
              payload.sessionId,
              payload.path,
              payload.lifecycleIdentity,
            )
          ) {
            return;
          }
        }

        const resolved = isLanguageServerActionAlreadyResolved(payload.action)
          ? payload.action
          : await context.featuresGateway.resolveCodeAction(payload.rootPath, payload.action);

        if (
          !isDocumentLifecyclePayloadActive(
            context,
            payload.rootPath,
            payload.sessionId,
            payload.path,
            payload.lifecycleIdentity,
          )
        ) {
          return;
        }

        if (resolved.edit) {
          await applyWorkspaceEditWithOpenModels(monaco, context, resolved.edit, payload.rootPath);
        }

        if (resolved.command) {
          const edit = await context.featuresGateway.executeCommand(
            payload.rootPath,
            resolved.command,
          );

          if (
            edit &&
            isDocumentLifecyclePayloadActive(
              context,
              payload.rootPath,
              payload.sessionId,
              payload.path,
              payload.lifecycleIdentity,
            )
          ) {
            await applyWorkspaceEditWithOpenModels(monaco, context, edit, payload.rootPath);
          }
        }
      } catch (error) {
        if (
          !isUnsupportedCodeActionResolveError(error) &&
          isDocumentLifecyclePayloadActive(
            context,
            payload.rootPath,
            payload.sessionId,
            payload.path,
            payload.lifecycleIdentity,
          )
        ) {
          context.reportError(error);
        }
      }
    },
  });
  const applyNewFileCommand = monaco.editor.addCommand({
    id: APPLY_PHP_CODE_ACTION_NEW_FILE_COMMAND_ID,
    run: async (_accessor, payload: ApplyPhpCodeActionNewFilePayload | undefined) => {
      if (!payload?.newFile || !context.applyPhpCodeActionNewFile) {
        return;
      }

      try {
        if (payload.sourcePath) {
          await context.flushPendingDocumentChange(payload.sourcePath);
        }

        // The controller callback owns the gateway disk write, the file-tree
        // refresh, the tab open AND the per-project isolation (requested-root
        // capture + re-check after each await), so a tab switch mid-write drops
        // the stale result. It resolves `true` ONLY when the interface file was
        // freshly written; we apply the paired in-document edits only then, so a
        // pre-existing target or a failed creation cannot leave a partial class
        // edit behind.
        const interfaceFileWritten = await context.applyPhpCodeActionNewFile(payload.newFile);

        if (interfaceFileWritten) {
          if (payload.sourcePath) {
            context.clearLanguageServerDiagnosticsForPath?.(payload.sourcePath);
          }

          applyPhpCodeActionDocumentEdits(monaco, payload);
        }
      } catch (error) {
        context.reportError(error);
      }
    },
  });
  const applyCodeActionWorkspaceEditCommand = monaco.editor.addCommand({
    id: APPLY_PHP_CODE_ACTION_WORKSPACE_EDIT_COMMAND_ID,
    run: async (_accessor, payload: ApplyPhpCodeActionWorkspaceEditPayload | undefined) => {
      if (!payload?.edit || !payload.rootPath) {
        return;
      }

      try {
        await applyWorkspaceEditWithOpenModels(monaco, context, payload.edit, payload.rootPath);
      } catch (error) {
        context.reportError(error);
      }
    },
  });
  const openPhpChangeSignatureCommand = monaco.editor.addCommand({
    id: OPEN_PHP_CHANGE_SIGNATURE_COMMAND_ID,
    run: (_accessor, payload: OpenPhpChangeSignaturePayload | undefined) => {
      if (!payload || payload.kind !== "change-signature") return;
      if (!workspaceRootKeysEqual(context.getWorkspaceRoot?.() ?? null, payload.rootPath)) return;
      context.openPhpChangeSignature?.(
        payload,
        createOpenModelWorkspaceEditApplier(monaco, context),
      );
    },
  });
  const interactiveProviders = registerInteractiveLanguageServerProviders(monaco, {
    provideCodeActions: (model, range, actionContext) =>
      provideCodeActions(monaco, context, model, range, actionContext),
    provideCompletionItems: (model, position, completionContext, token) =>
      provideCompletionItems(monaco, context, model, position, completionContext, token),
    provideHover: (model, position, token) => provideHover(monaco, context, model, position, token),
    provideSelectionRanges: (model, positions) =>
      provideSelectionRanges(monaco, context, model, positions),
    provideSignatureHelp: (model, position, token, signatureContext) =>
      provideSignatureHelp(monaco, context, model, position, token, signatureContext),
    resolveCodeAction: (action) => resolveCodeAction(monaco, context, action),
  });
  const navigationProviders = registerNavigationLanguageServerProviders(monaco, {
    provideDeclaration: (model, position, token) =>
      provideDeclaration(monaco, context, model, position, token),
    provideDefinition: (model, position, token) =>
      provideDefinition(monaco, context, model, position, token),
    provideDocumentHighlights: (model, position, token) =>
      provideDocumentHighlights(monaco, context, documentHighlightTracker, model, position, token),
    provideDocumentSymbols: (model) => provideDocumentSymbols(monaco, context, model),
    provideImplementation: (model, position, token) =>
      provideImplementation(monaco, context, model, position, token),
    provideReferences: (model, position, _referenceContext, token) =>
      provideReferences(monaco, context, model, position, token),
    provideRenameEdits: (model, position, newName) =>
      provideRenameEdits(monaco, context, model, position, newName),
    provideTypeDefinition: (model, position, token) =>
      provideTypeDefinition(monaco, context, model, position, token),
    provideWorkspaceSymbols: (query) => provideWorkspaceSymbols(monaco, context, query),
    resolveRenameLocation: (model, position) => prepareRename(monaco, context, model, position),
  });
  const documentProviders = registerDocumentLanguageServerProviders(monaco, {
    getSemanticTokensLegend: () => semanticTokensLegendForActiveRuntime(context),
    onDidChangeCodeLens: codeLensRefreshEmitter.event as unknown as NonNullable<
      Monaco.languages.CodeLensProvider["onDidChange"]
    >,
    onDidChangeInlayHints: inlayHintRefreshEmitter.event,
    onDidChangeSemanticTokens: semanticTokensRefreshEmitter.event,
    onTypeFormattingTriggerCharacters: onTypeFormattingTriggerCharacters(context),
    provideCodeLenses: (model) => provideCodeLenses(monaco, context, model),
    provideDocumentFormattingEdits: (model, options) =>
      provideDocumentFormattingEdits(monaco, context, model, options),
    provideDocumentLinks: (model) => provideDocumentLinks(monaco, context, model),
    provideDocumentRangeFormattingEdits: (model, range, options) =>
      provideDocumentRangeFormattingEdits(monaco, context, model, range, options),
    provideDocumentRangeSemanticTokens: (model, range) =>
      provideDocumentRangeSemanticTokens(context, model, range),
    provideDocumentSemanticTokens: (model) => provideDocumentSemanticTokens(context, model),
    provideFoldingRanges: (model) => provideFoldingRanges(monaco, context, model),
    provideInlayHints: (model, range) => provideInlayHints(monaco, context, model, range),
    provideLinkedEditingRanges: (model, position) =>
      provideLinkedEditingRanges(monaco, context, model, position),
    provideOnTypeFormattingEdits: (model, position, ch, options) =>
      provideOnTypeFormattingEdits(monaco, context, model, position, ch, options),
    resolveCodeLens: (model, lens) => resolveCodeLens(monaco, context, model, lens),
    resolveDocumentLink: (link) => resolveDocumentLink(monaco, context, link),
    resolveInlayHint: (hint) => resolveInlayHint(monaco, context, hint),
  });
  const templateLanguageProviders = registerTemplateLanguageMonacoProviders(monaco, context, {
    toCodeAction: toPhpCodeAction,
  });

  return {
    dispose: () => {
      refreshSubscriptionDisposable.dispose();
      workspaceEditSubscriptionDisposable.dispose();
      codeLensRefreshEmitter.dispose();
      inlayHintRefreshEmitter.dispose();
      semanticTokensRefreshEmitter.dispose();
      command.dispose();
      resolveAndApplyCodeActionCommand.dispose();
      applyNewFileCommand.dispose();
      applyCodeActionWorkspaceEditCommand.dispose();
      openPhpChangeSignatureCommand.dispose();
      interactiveProviders.dispose();
      navigationProviders.dispose();
      documentProviders.dispose();
      templateLanguageProviders.dispose();
      unregisterWorkspaceIdentity();
    },
  };
}

async function prepareRename(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Promise<(Monaco.languages.RenameLocation & Monaco.languages.Rejection) | null> {
  const request = featureRequestContext(context, model, position, "prepareRename");

  if (!request) {
    return null;
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRequest(context, request))) {
      return null;
    }

    const prepareRename = await context.featuresGateway.prepareRename(
      request.rootPath,
      request.position,
    );

    if (!isFeatureRequestActive(context, request)) {
      return null;
    }

    if (!prepareRename?.range || prepareRename.defaultBehavior) {
      return defaultRenameLocation(model, position);
    }

    const range = toMonacoRange(monaco, prepareRename.range);

    return {
      range,
      text: prepareRename.placeholder ?? model.getValueInRange(range),
    };
  } catch (error) {
    reportErrorForActiveRequest(context, request, error);
    return null;
  }
}

async function provideRenameEdits(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
  newName: string,
): Promise<Monaco.languages.WorkspaceEdit | null> {
  const request = featureRequestContext(context, model, position, "rename");

  if (!request) {
    return null;
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRequest(context, request))) {
      return null;
    }

    const edit = await context.featuresGateway.rename(request.rootPath, request.position, newName);

    if (!isFeatureRequestActive(context, request)) {
      return null;
    }

    if (!edit) {
      return null;
    }

    if (context.applyWorkspaceEdit) {
      await applyWorkspaceEditWithOpenModels(monaco, context, edit, request.rootPath);

      if (!isFeatureRequestActive(context, request)) {
        return null;
      }

      return { edits: [] };
    }

    return toMonacoWorkspaceEdit(monaco, workspaceEditContext(model), edit, request.rootPath);
  } catch (error) {
    reportErrorForActiveRequest(context, request, error);
    return null;
  }
}

async function provideReferences(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
  token?: Monaco.CancellationToken,
): Promise<Monaco.languages.Location[] | null> {
  return provideNavigationLocations(
    monaco,
    context,
    model,
    position,
    "references",
    (rootPath, requestPosition) => context.featuresGateway.references(rootPath, requestPosition),
    token,
  );
}

async function provideDeclaration(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
  token?: Monaco.CancellationToken,
): Promise<Monaco.languages.Location[] | null> {
  return provideNavigationLocations(
    monaco,
    context,
    model,
    position,
    "declaration",
    (rootPath, requestPosition) => context.featuresGateway.declaration(rootPath, requestPosition),
    token,
  );
}

async function provideDefinition(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
  token?: Monaco.CancellationToken,
): Promise<Monaco.languages.Location[] | null> {
  if (shouldSkipLargePhpSmartProviders(context, model)) {
    return null;
  }

  if (await providePhpFrameworkDefinitionBeforeLsp(context, model, position)) {
    return null;
  }

  return provideNavigationLocations(
    monaco,
    context,
    model,
    position,
    "definition",
    (rootPath, requestPosition) => context.featuresGateway.definition(rootPath, requestPosition),
    token,
  );
}

async function provideImplementation(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
  token?: Monaco.CancellationToken,
): Promise<Monaco.languages.Location[] | null> {
  return provideNavigationLocations(
    monaco,
    context,
    model,
    position,
    "implementation",
    (rootPath, requestPosition) =>
      context.featuresGateway.implementation(rootPath, requestPosition),
    token,
  );
}

async function provideTypeDefinition(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
  token?: Monaco.CancellationToken,
): Promise<Monaco.languages.Location[] | null> {
  return provideNavigationLocations(
    monaco,
    context,
    model,
    position,
    "typeDefinition",
    (rootPath, requestPosition) =>
      context.featuresGateway.typeDefinition(rootPath, requestPosition),
    token,
  );
}

async function provideDocumentHighlights(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  tracker: DocumentHighlightRequestTracker<Monaco.languages.DocumentHighlight>,
  model: MonacoModel,
  position: MonacoPosition,
  token: Monaco.CancellationToken,
): Promise<Monaco.languages.DocumentHighlight[] | null> {
  const request = featureRequestContext(context, model, position, "documentHighlight");

  if (!request) {
    return null;
  }

  const word = model.getWordAtPosition(position)?.word ?? null;
  const version = model.getVersionId();

  if (word !== null) {
    const cached = tracker.cached(request.path, word, version);

    if (cached) {
      return cached;
    }
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRequest(context, request))) {
      return null;
    }

    const highlights = await context.featuresGateway.documentHighlights(
      request.rootPath,
      request.position,
    );

    if (token.isCancellationRequested) {
      return null;
    }

    if (!isFeatureRequestActive(context, request)) {
      return null;
    }

    const mapped = highlights.map((highlight) => toMonacoDocumentHighlight(monaco, highlight));

    if (word !== null) {
      tracker.remember(request.path, word, version, mapped);
    }

    return mapped;
  } catch (error) {
    reportErrorForActiveRequest(context, request, error);
    return null;
  }
}

async function provideFoldingRanges(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
): Promise<Monaco.languages.FoldingRange[] | null> {
  const request = featureDocumentRequestContext(context, model, "foldingRange");

  if (!request) {
    return null;
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRequest(context, request))) {
      return null;
    }

    const ranges = await context.featuresGateway.foldingRanges(request.rootPath, request.path);

    if (!isFeatureRequestActive(context, request)) {
      return null;
    }

    return ranges.map((range) => toMonacoFoldingRange(monaco, range));
  } catch (error) {
    reportErrorForActiveRequest(context, request, error);
    return null;
  }
}

async function provideDocumentFormattingEdits(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  options: Monaco.languages.FormattingOptions,
): Promise<Monaco.languages.TextEdit[]> {
  const request = featureDocumentRequestContext(context, model, "formatting");

  if (!request) {
    return [];
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRequest(context, request))) {
      return [];
    }

    const edits = await context.featuresGateway.formatting(
      request.rootPath,
      request.path,
      toLanguageServerFormattingOptions(options),
    );

    if (!isFeatureRequestActive(context, request)) {
      return [];
    }

    return edits.map((edit) => toMonacoTextEdit(monaco, edit));
  } catch (error) {
    reportErrorForActiveRequest(context, request, error);
    return [];
  }
}

async function provideDocumentRangeFormattingEdits(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  range: Monaco.Range,
  options: Monaco.languages.FormattingOptions,
): Promise<Monaco.languages.TextEdit[]> {
  const request = featureDocumentRequestContext(context, model, "rangeFormatting");

  if (!request) {
    return [];
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRequest(context, request))) {
      return [];
    }

    const edits = await context.featuresGateway.rangeFormatting(
      request.rootPath,
      request.path,
      toLanguageServerRange(range),
      toLanguageServerFormattingOptions(options),
    );

    if (!isFeatureRequestActive(context, request)) {
      return [];
    }

    return edits.map((edit) => toMonacoTextEdit(monaco, edit));
  } catch (error) {
    reportErrorForActiveRequest(context, request, error);
    return [];
  }
}

async function provideOnTypeFormattingEdits(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
  ch: string,
  options: Monaco.languages.FormattingOptions,
): Promise<Monaco.languages.TextEdit[]> {
  const request = featureDocumentRequestContext(context, model, "onTypeFormatting");

  if (!request) {
    return [];
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRequest(context, request))) {
      return [];
    }

    const edits = await context.featuresGateway.onTypeFormatting(
      request.rootPath,
      request.path,
      toLanguageServerTextDocumentPosition(request.path, position),
      ch,
      toLanguageServerFormattingOptions(options),
    );

    if (!isFeatureRequestActive(context, request)) {
      return [];
    }

    return edits.map((edit) => toMonacoTextEdit(monaco, edit));
  } catch (error) {
    reportErrorForActiveRequest(context, request, error);
    return [];
  }
}

async function provideDocumentSymbols(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
): Promise<Monaco.languages.DocumentSymbol[] | null> {
  const request = featureDocumentRequestContext(context, model, "documentSymbol");

  if (!request) {
    return null;
  }

  // BUG 2: skip the request until the document has been opened on the server.
  // An outline / breadcrumb DocumentSymbol fetch can otherwise fire before the
  // document's `didOpen` is sent, which phpactor answers with UnknownDocument.
  if (
    !context.requestDocumentLease &&
    context.isDocumentSynced &&
    !context.isDocumentSynced(request.rootPath, request.path)
  ) {
    return null;
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRequest(context, request))) {
      return null;
    }

    const load = () => context.featuresGateway.documentSymbols(request.rootPath, request.path);
    const symbols = await (request.lifecycleIdentity == null
      ? load()
      : (context.coordinatePhpDocumentSymbols?.(
          {
            ...request,
            content: model.getValue(),
            lifecycleIdentity: request.lifecycleIdentity,
            runtimeIdentity: context.featuresGateway,
          },
          load,
        ) ?? load()));

    if (!isFeatureRequestActive(context, request)) {
      return null;
    }

    return symbols.map((symbol) => toMonacoDocumentSymbol(monaco, symbol));
  } catch (error) {
    reportErrorForActiveRequest(context, request, error);
    return null;
  }
}

async function provideWorkspaceSymbols(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  query: string,
): Promise<MonacoWorkspaceSymbol[]> {
  const request = workspaceSymbolRequestContext(context);

  if (!request) {
    return [];
  }

  try {
    const symbols = await context.featuresGateway.workspaceSymbols(request.rootPath, query);

    if (!isFeatureRequestActive(context, request)) {
      return [];
    }

    return symbols.flatMap((symbol) => toMonacoWorkspaceSymbol(monaco, request.rootPath, symbol));
  } catch (error) {
    reportErrorForActiveRequest(context, request, error);
    return [];
  }
}

async function provideLinkedEditingRanges(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Promise<Monaco.languages.LinkedEditingRanges | null> {
  const request = featureRequestContext(context, model, position, "linkedEditingRange");

  if (!request) {
    return null;
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRequest(context, request))) {
      return null;
    }

    const ranges = await context.featuresGateway.linkedEditingRanges(
      request.rootPath,
      request.position,
    );

    if (!isFeatureRequestActive(context, request)) {
      return null;
    }

    return toMonacoLinkedEditingRanges(monaco, ranges);
  } catch (error) {
    reportErrorForActiveRequest(context, request, error);
    return null;
  }
}

async function provideDocumentLinks(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
): Promise<Monaco.languages.ILinksList> {
  const request = featureDocumentRequestContext(context, model, "documentLink");

  if (!request) {
    return documentLinkList();
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRequest(context, request))) {
      return documentLinkList();
    }

    const links = await context.featuresGateway.documentLinks(request.rootPath, request.path);

    if (!isFeatureRequestActive(context, request)) {
      return documentLinkList();
    }

    return documentLinkList(
      links.map((link) =>
        toMonacoDocumentLink(
          monaco,
          request.rootPath,
          request.path,
          request.sessionId,
          request.lifecycleIdentity,
          link,
        ),
      ),
    );
  } catch (error) {
    reportErrorForActiveRequest(context, request, error);
    return documentLinkList();
  }
}

async function resolveDocumentLink(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  link: Monaco.languages.ILink,
): Promise<Monaco.languages.ILink> {
  const backedLink = link as LanguageServerBackedLink;

  if (
    !backedLink.__languageServerLink ||
    !backedLink.__sourcePath ||
    !backedLink.__workspaceRoot ||
    backedLink.__languageServerSessionId == null ||
    !isDocumentLifecyclePayloadActive(
      context,
      backedLink.__workspaceRoot,
      backedLink.__languageServerSessionId,
      backedLink.__sourcePath,
      backedLink.__documentLifecycleIdentity,
    )
  ) {
    return link;
  }

  try {
    await context.flushPendingDocumentChange(backedLink.__sourcePath);

    if (
      !isDocumentLifecyclePayloadActive(
        context,
        backedLink.__workspaceRoot,
        backedLink.__languageServerSessionId,
        backedLink.__sourcePath,
        backedLink.__documentLifecycleIdentity,
      )
    ) {
      return link;
    }

    const resolved = await context.featuresGateway.resolveDocumentLink(
      backedLink.__workspaceRoot,
      backedLink.__languageServerLink,
    );

    if (
      !isDocumentLifecyclePayloadActive(
        context,
        backedLink.__workspaceRoot,
        backedLink.__languageServerSessionId,
        backedLink.__sourcePath,
        backedLink.__documentLifecycleIdentity,
      )
    ) {
      return link;
    }

    return {
      ...link,
      ...toMonacoDocumentLink(
        monaco,
        backedLink.__workspaceRoot,
        backedLink.__sourcePath,
        backedLink.__languageServerSessionId,
        backedLink.__documentLifecycleIdentity,
        resolved,
      ),
    };
  } catch (error) {
    if (
      isDocumentLifecyclePayloadActive(
        context,
        backedLink.__workspaceRoot,
        backedLink.__languageServerSessionId,
        backedLink.__sourcePath,
        backedLink.__documentLifecycleIdentity,
      )
    ) {
      context.reportError(error);
    }

    return link;
  }
}

async function provideCodeLenses(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
): Promise<Monaco.languages.CodeLensList> {
  const request = featureDocumentRequestContext(context, model, "codeLens");

  if (!request) {
    return codeLensList();
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRequest(context, request))) {
      return codeLensList();
    }

    const lenses = await context.featuresGateway.codeLenses(request.rootPath, request.path);

    if (!isFeatureRequestActive(context, request)) {
      return codeLensList();
    }

    return codeLensList(
      lenses.map((lens) =>
        toMonacoCodeLens(
          monaco,
          request.rootPath,
          request.path,
          request.sessionId,
          request.lifecycleIdentity,
          lens,
        ),
      ),
    );
  } catch (error) {
    reportErrorForActiveRequest(context, request, error);
    return codeLensList();
  }
}

async function resolveCodeLens(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  _model: MonacoModel,
  lens: Monaco.languages.CodeLens,
): Promise<Monaco.languages.CodeLens> {
  const backedLens = lens as LanguageServerBackedCodeLens;

  if (
    !backedLens.__languageServerLens ||
    !backedLens.__sourcePath ||
    !backedLens.__workspaceRoot ||
    backedLens.__languageServerSessionId == null ||
    !isDocumentLifecyclePayloadActive(
      context,
      backedLens.__workspaceRoot,
      backedLens.__languageServerSessionId,
      backedLens.__sourcePath,
      backedLens.__documentLifecycleIdentity,
    )
  ) {
    return lens;
  }

  try {
    await context.flushPendingDocumentChange(backedLens.__sourcePath);

    if (
      !isDocumentLifecyclePayloadActive(
        context,
        backedLens.__workspaceRoot,
        backedLens.__languageServerSessionId,
        backedLens.__sourcePath,
        backedLens.__documentLifecycleIdentity,
      )
    ) {
      return lens;
    }

    const resolved = await context.featuresGateway.resolveCodeLens(
      backedLens.__workspaceRoot,
      backedLens.__languageServerLens,
    );

    if (
      !isDocumentLifecyclePayloadActive(
        context,
        backedLens.__workspaceRoot,
        backedLens.__languageServerSessionId,
        backedLens.__sourcePath,
        backedLens.__documentLifecycleIdentity,
      )
    ) {
      return lens;
    }

    return {
      ...lens,
      ...toMonacoCodeLens(
        monaco,
        backedLens.__workspaceRoot,
        backedLens.__sourcePath,
        backedLens.__languageServerSessionId,
        backedLens.__documentLifecycleIdentity,
        resolved,
      ),
    };
  } catch (error) {
    if (
      isDocumentLifecyclePayloadActive(
        context,
        backedLens.__workspaceRoot,
        backedLens.__languageServerSessionId,
        backedLens.__sourcePath,
        backedLens.__documentLifecycleIdentity,
      )
    ) {
      context.reportError(error);
    }

    return lens;
  }
}

async function provideInlayHints(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  range: Monaco.Range,
): Promise<Monaco.languages.InlayHintList> {
  // The PHP inlay-hints toggle gates both the managed phpactor hints and the
  // TS-domain parameter-name fallback. An unwired toggle defaults to enabled so
  // existing callers keep producing phpactor hints.
  if (context.isPhpInlayHintsEnabled && !context.isPhpInlayHintsEnabled()) {
    return inlayHintList();
  }

  const request = featureDocumentRequestContext(context, model, "inlayHint");

  if (!request) {
    return inlayHintList();
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRequest(context, request))) {
      return inlayHintList();
    }

    const hints = await context.featuresGateway.inlayHints(
      request.rootPath,
      request.path,
      toLanguageServerRange(range),
    );

    if (!isFeatureRequestActive(context, request)) {
      return inlayHintList();
    }

    const monacoHints = hints.map((hint) =>
      toMonacoInlayHint(
        monaco,
        request.rootPath,
        request.path,
        request.sessionId,
        request.lifecycleIdentity,
        hint,
      ),
    );
    const parameterHints = await providePhpParameterNameInlayHints(context, request, model, range);

    return inlayHintList(mergePhpInlayHints(parameterHints, monacoHints));
  } catch (error) {
    reportErrorForActiveRequest(context, request, error);
    return inlayHintList();
  }
}

/**
 * Resolves the TS-domain parameter-name fallback hints for the viewport `range`
 * and converts them into Monaco parameter inlay hints. phpactor parameter hints
 * are unreliable, so this fallback (built on the signature-resolution flow)
 * supplies `name:` hints in front of positional arguments. Re-checks the active
 * request after the resolve await before returning (per-project isolation), and
 * never throws: a failed fallback leaves the phpactor hints untouched.
 */
async function providePhpParameterNameInlayHints(
  context: LanguageServerMonacoProviderContext,
  request: { path: string; rootPath: string; sessionId: number },
  model: MonacoModel,
  range: Monaco.Range,
): Promise<LanguageServerBackedInlayHint[]> {
  if (!context.providePhpParameterInlayHints) {
    return [];
  }

  const documentContext = activePhpDocumentContext(context, model);

  if (!documentContext) {
    return [];
  }

  if (isLargePhpDocumentContext(context, documentContext)) {
    return [];
  }

  try {
    const hints = await context.providePhpParameterInlayHints(
      modelSource(model, documentContext.activeDocument.content),
      {
        endLine: Math.max(0, range.endLineNumber - 1),
        startLine: Math.max(0, range.startLineNumber - 1),
      },
    );

    if (!isFeatureRequestActive(context, request)) {
      return [];
    }

    return hints.map((hint) => toMonacoParameterNameInlayHint(hint));
  } catch (error) {
    reportErrorForActiveRequest(context, request, error);
    return [];
  }
}

/**
 * Converts a domain parameter-name hint (0-based line/character) into a Monaco
 * `Parameter` inlay hint rendered as `name:` immediately before the argument.
 */
function toMonacoParameterNameInlayHint(
  hint: PhpParameterNameInlayHint,
): LanguageServerBackedInlayHint {
  return {
    label: `${hint.name}:`,
    paddingLeft: false,
    paddingRight: true,
    position: {
      column: hint.character + 1,
      lineNumber: hint.line + 1,
    },
    kind: 2 as Monaco.languages.InlayHintKind,
  };
}

/**
 * Merges TS-fallback parameter hints with phpactor hints, dropping a fallback
 * hint when phpactor already emitted a parameter hint at the same position so a
 * call never shows the parameter name twice. phpactor hints win on overlap.
 */
function mergePhpInlayHints(
  parameterHints: LanguageServerBackedInlayHint[],
  phpactorHints: LanguageServerBackedInlayHint[],
): LanguageServerBackedInlayHint[] {
  const occupied = new Set(
    phpactorHints.map((hint) => `${hint.position.lineNumber}:${hint.position.column}`),
  );
  const fallback = parameterHints.filter(
    (hint) => !occupied.has(`${hint.position.lineNumber}:${hint.position.column}`),
  );

  return [...phpactorHints, ...fallback];
}

async function resolveInlayHint(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  hint: Monaco.languages.InlayHint,
): Promise<Monaco.languages.InlayHint> {
  const backedHint = hint as LanguageServerBackedInlayHint;

  if (
    !backedHint.__languageServerInlayHint ||
    !backedHint.__sourcePath ||
    !backedHint.__workspaceRoot ||
    backedHint.__languageServerSessionId == null ||
    !isDocumentLifecyclePayloadActive(
      context,
      backedHint.__workspaceRoot,
      backedHint.__languageServerSessionId,
      backedHint.__sourcePath,
      backedHint.__documentLifecycleIdentity,
    )
  ) {
    return hint;
  }

  const runtimeStatus = runningRuntimeStatusForRoot(context, backedHint.__workspaceRoot);
  if (
    runtimeStatus?.sessionId !== backedHint.__languageServerSessionId ||
    runtimeStatus.capabilities.inlayHintResolve !== true
  ) {
    return hint;
  }

  try {
    await context.flushPendingDocumentChange(backedHint.__sourcePath);

    if (
      !isDocumentLifecyclePayloadActive(
        context,
        backedHint.__workspaceRoot,
        backedHint.__languageServerSessionId,
        backedHint.__sourcePath,
        backedHint.__documentLifecycleIdentity,
      )
    ) {
      return hint;
    }

    const resolved = await context.featuresGateway.resolveInlayHint(
      backedHint.__workspaceRoot,
      backedHint.__languageServerInlayHint,
    );

    if (
      !isDocumentLifecyclePayloadActive(
        context,
        backedHint.__workspaceRoot,
        backedHint.__languageServerSessionId,
        backedHint.__sourcePath,
        backedHint.__documentLifecycleIdentity,
      )
    ) {
      return hint;
    }

    return toMonacoInlayHint(
      monaco,
      backedHint.__workspaceRoot,
      backedHint.__sourcePath,
      backedHint.__languageServerSessionId,
      backedHint.__documentLifecycleIdentity,
      resolved,
    );
  } catch (error) {
    if (
      isDocumentLifecyclePayloadActive(
        context,
        backedHint.__workspaceRoot,
        backedHint.__languageServerSessionId,
        backedHint.__sourcePath,
        backedHint.__documentLifecycleIdentity,
      )
    ) {
      context.reportError(error);
    }

    return hint;
  }
}

async function provideNavigationLocations(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
  feature: "declaration" | "definition" | "implementation" | "references" | "typeDefinition",
  requestLocations: (
    rootPath: string,
    position: LanguageServerTextDocumentPosition,
  ) => Promise<LanguageServerLocation[]>,
  token?: Monaco.CancellationToken,
): Promise<Monaco.languages.Location[] | null> {
  const request = featureRequestContext(context, model, position, feature);

  if (!request) {
    return null;
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRequest(context, request))) {
      return null;
    }

    const locations = await raceInteractiveFeatureRequest(
      requestLocations(request.rootPath, request.position),
    );

    if (locations === FEATURE_REQUEST_TIMED_OUT) {
      return null;
    }

    if (token?.isCancellationRequested) {
      return null;
    }

    if (!isFeatureRequestActive(context, request)) {
      return null;
    }

    return locations.flatMap((location) =>
      toMonacoLocation(
        monaco,
        request.rootPath,
        location,
        context.limitNavigationResultsToOpenModels === true,
      ),
    );
  } catch (error) {
    reportErrorForActiveRequest(context, request, error);
    return null;
  }
}

function defaultRenameLocation(
  model: MonacoModel,
  position: MonacoPosition,
): (Monaco.languages.RenameLocation & Monaco.languages.Rejection) | null {
  const word = model.getWordAtPosition(position);

  if (!word) {
    return {
      rejectReason: "Cannot rename this symbol.",
    } as Monaco.languages.RenameLocation & Monaco.languages.Rejection;
  }

  return {
    range: {
      endColumn: word.endColumn,
      endLineNumber: position.lineNumber,
      startColumn: word.startColumn,
      startLineNumber: position.lineNumber,
    },
    text: word.word,
  };
}

async function provideCodeActions(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  range: Monaco.Range,
  actionContext: Monaco.languages.CodeActionContext,
): Promise<Monaco.languages.CodeActionList> {
  const localActions = provideLocalCodeActions(monaco, model, range, actionContext);
  const request = featureDocumentRequestContext(context, model, "codeAction");
  const phpDocumentContext = activePhpDocumentContext(context, model);
  const phpActions = context.providePhpCodeActions
    ? await providePhpSourceCodeActions(
        monaco,
        context,
        model,
        range,
        actionContext,
        phpDocumentContext,
      )
    : [];
  // PHP actions resolve from a different workspace-aware flow than the LSP
  // request; re-validate their document context at EVERY return so a workspace
  // switch during any later await drops them (per-project isolation).
  const activePhpActions = () =>
    phpDocumentContext && isPhpDocumentContextActive(context, phpDocumentContext) ? phpActions : [];

  if (!request) {
    return codeActionList([...activePhpActions(), ...localActions]);
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRequest(context, request))) {
      return codeActionList([...activePhpActions(), ...localActions]);
    }

    const actions = await context.featuresGateway.codeActions(
      request.rootPath,
      request.path,
      toLanguageServerRange(range),
      toLanguageServerCodeActionContext(monaco, actionContext),
    );

    if (!isFeatureRequestActive(context, request)) {
      return codeActionList([...activePhpActions(), ...localActions]);
    }

    return codeActionList(
      orderCodeActions({
        languageServerActions: actions.flatMap((action) =>
          toMonacoCodeAction(
            monaco,
            Boolean(context.applyWorkspaceEdit),
            workspaceEditContext(model),
            request.rootPath,
            request.sessionId,
            request.path,
            request.lifecycleIdentity,
            action,
            actionContext,
          ),
        ),
        localActions,
        phpActions: activePhpActions(),
      }),
    );
  } catch (error) {
    reportErrorForActiveRequest(context, request, error);

    return codeActionList([...activePhpActions(), ...localActions]);
  }
}

async function providePhpSourceCodeActions(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  range: Monaco.Range,
  actionContext: Monaco.languages.CodeActionContext,
  documentContext: ReturnType<typeof activePhpDocumentContext>,
): Promise<Monaco.languages.CodeAction[]> {
  if (!context.providePhpCodeActions) {
    return [];
  }

  if (!phpSourceCodeActionKindRequested(actionContext.only)) {
    return [];
  }

  if (!documentContext) {
    return [];
  }

  if (isLargePhpDocumentContext(context, documentContext)) {
    return [];
  }

  const source = modelSource(model, documentContext.activeDocument.content);
  const offsetRange = phpCodeActionOffsetRange(source, range);

  try {
    const descriptors = await context.providePhpCodeActions(source, offsetRange);

    if (!isPhpDocumentContextActive(context, documentContext)) {
      return [];
    }

    return descriptors.flatMap((descriptor) =>
      canApplyPhpWorkspaceEditDescriptor(context, descriptor)
        ? [toPhpCodeAction(monaco, context, model, descriptor)]
        : [],
    );
  } catch (error) {
    if (isPhpDocumentContextActive(context, documentContext)) {
      context.reportError(error);
    }

    return [];
  }
}

/**
 * The synthesized PHP code actions span three kind families: contextual
 * quickfixes ("Create method/property from usage", "Import class", "Remove
 * unused ...") on the lightbulb, refactors ("Extract ...", "Add type hint",
 * "Generate constructor/accessors", "Implement/Override methods"), and the
 * "Optimize imports" organize-imports source action. Honour Monaco's `only`
 * filter: an unfiltered request qualifies, and a request narrowed to a family we
 * actually emit - `quickfix`, `refactor`, or the `source.organizeImports`
 * group - is served. Any other narrow `source.*` scope (e.g. `source.fixAll`)
 * has no matching action, so it is left to the language server. This keeps us
 * from ever surfacing an off-context action.
 */
function phpSourceCodeActionKindRequested(only: string | undefined): boolean {
  if (!only) {
    return true;
  }

  return (
    only.startsWith("quickfix") ||
    only.startsWith("refactor") ||
    phpOrganizeImportsKindRequested(only)
  );
}

/**
 * True when the `only` scope targets the organize-imports family that our
 * "Optimize imports" action belongs to: the bare `source` group, or
 * `source.organizeImports` (and its sub-scopes). A more specific sibling scope
 * like `source.fixAll` returns false so we do not run for an action we never
 * emit.
 */
function phpOrganizeImportsKindRequested(only: string): boolean {
  return (
    only === "source" ||
    only === "source.organizeImports" ||
    only.startsWith("source.organizeImports.")
  );
}

/**
 * Converts the Monaco selection range Monaco hands the code-action provider into
 * the 0-based character offset span the controller's position-aware actions
 * consume. An empty selection collapses to `start === end` (the bare cursor).
 */
function phpCodeActionOffsetRange(source: string, range: Monaco.Range): PhpCodeActionRange {
  const start = offsetAtMonacoPosition(source, {
    column: range.startColumn,
    lineNumber: range.startLineNumber,
  } as MonacoPosition);
  const end = offsetAtMonacoPosition(source, {
    column: range.endColumn,
    lineNumber: range.endLineNumber,
  } as MonacoPosition);

  return start <= end ? { end, start } : { end: start, start: end };
}

function canApplyPhpWorkspaceEditDescriptor(
  context: LanguageServerMonacoProviderContext,
  descriptor: PhpCodeActionDescriptor,
): boolean {
  if (!descriptor.workspaceEdit) {
    return true;
  }

  return Boolean(
    context.applyWorkspaceEdit &&
    (descriptor.workspaceRoot ?? context.getWorkspaceRoot?.() ?? null),
  );
}

function toPhpCodeAction(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  descriptor: PhpCodeActionDescriptor,
): Monaco.languages.CodeAction {
  if (descriptor.interaction?.kind === "change-signature") {
    return {
      command: {
        arguments: [descriptor.interaction],
        id: OPEN_PHP_CHANGE_SIGNATURE_COMMAND_ID,
        title: descriptor.title,
      },
      edit: { edits: [] },
      isPreferred: descriptor.isPreferred,
      kind: descriptor.kind ?? "refactor.rewrite",
      title: descriptor.title,
    };
  }
  if (descriptor.workspaceEdit && context.applyWorkspaceEdit) {
    const rootPath = descriptor.workspaceRoot ?? context.getWorkspaceRoot?.() ?? null;

    if (rootPath) {
      return {
        command: applyPhpCodeActionWorkspaceEditCommand(descriptor.workspaceEdit, rootPath),
        edit: { edits: [] },
        isPreferred: descriptor.isPreferred,
        kind: descriptor.kind ?? "quickfix",
        title: descriptor.title,
      };
    }
  }

  const versionId = model.getVersionId();
  const documentEdits: Array<
    Monaco.languages.IWorkspaceTextEdit | Monaco.languages.IWorkspaceFileEdit
  > = descriptor.edits.flatMap((edit) =>
    phpCodeActionDocumentEdit(monaco, context, model, edit, versionId),
  );

  // When the host wires the disk-persisting callback, a new-file action (e.g.
  // "Extract interface") keeps its document edits out of the eager Monaco bulk
  // edit. The command writes the file first, then applies those edits, making
  // the interface real on disk while failing closed if creation is blocked.
  // Hosts that omit the callback fall back to the legacy in-memory file-create
  // bulk edit.
  if (descriptor.newFile && context.applyPhpCodeActionNewFile) {
    return {
      command: applyPhpCodeActionNewFileCommand(descriptor.newFile, descriptor.edits, model),
      edit: { edits: [] },
      isPreferred: descriptor.isPreferred,
      kind: descriptor.kind ?? "quickfix",
      title: descriptor.title,
    };
  }

  return {
    edit: {
      edits: [
        ...newFileEdits(monaco, context.getWorkspaceRoot?.() ?? null, descriptor.newFile),
        ...documentEdits,
      ],
    },
    isPreferred: descriptor.isPreferred,
    kind: descriptor.kind ?? "quickfix",
    title: descriptor.title,
  };
}

function phpCodeActionDocumentEdit(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  edit: PhpCodeActionTextEdit,
  modelVersionId: number,
): Array<Monaco.languages.IWorkspaceTextEdit> {
  const resource = phpCodeActionEditResource(monaco, context, model, edit);

  if (!resource) {
    return [];
  }

  return [
    {
      resource,
      textEdit: {
        range: new monaco.Range(
          edit.range.startLineNumber,
          edit.range.startColumn,
          edit.range.endLineNumber,
          edit.range.endColumn,
        ),
        text: edit.text,
      },
      versionId: phpCodeActionEditTargetsModel(edit, model) ? modelVersionId : undefined,
    },
  ];
}

function phpCodeActionEditResource(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  edit: PhpCodeActionTextEdit,
): Monaco.Uri | null {
  if (!edit.path) {
    return model.uri;
  }

  const rootPath = context.getWorkspaceRoot?.() ?? null;

  if (!rootPath) {
    return null;
  }

  return toWorkspaceMonacoUri(monaco, rootPath, edit.path);
}

/**
 * Builds the monaco command that persists a PHP code action's new file to disk.
 * The action itself has no eager document edits; this command writes the sibling
 * file and then applies the captured edits to the original model.
 */
function applyPhpCodeActionNewFileCommand(
  newFile: PhpCodeActionNewFile,
  edits: PhpCodeActionTextEdit[],
  model: MonacoModel,
): Monaco.languages.Command {
  return {
    arguments: [
      {
        edits: edits.filter((edit) => !edit.path),
        newFile,
        sourcePath: modelPath(model),
        sourceModelUri: model.uri.toString(),
        versionId: typeof model.getVersionId === "function" ? model.getVersionId() : undefined,
      } satisfies ApplyPhpCodeActionNewFilePayload,
    ],
    id: APPLY_PHP_CODE_ACTION_NEW_FILE_COMMAND_ID,
    title: "Create file",
  };
}

function applyPhpCodeActionWorkspaceEditCommand(
  edit: LanguageServerWorkspaceEdit,
  rootPath: string,
): Monaco.languages.Command {
  return {
    arguments: [{ edit, rootPath } satisfies ApplyPhpCodeActionWorkspaceEditPayload],
    id: APPLY_PHP_CODE_ACTION_WORKSPACE_EDIT_COMMAND_ID,
    title: "Apply workspace edit",
  };
}

function phpCodeActionEditTargetsModel(edit: PhpCodeActionTextEdit, model: MonacoModel): boolean {
  if (!edit.path) {
    return true;
  }

  return modelPath(model) === edit.path;
}

function applyPhpCodeActionDocumentEdits(
  monaco: MonacoApi,
  payload: ApplyPhpCodeActionNewFilePayload,
): void {
  const model = monaco.editor
    .getModels()
    .find((candidate) => candidate.uri.toString() === payload.sourceModelUri);

  if (!model || payload.edits.length === 0) {
    return;
  }

  if (
    payload.versionId !== undefined &&
    typeof model.getVersionId === "function" &&
    model.getVersionId() !== payload.versionId
  ) {
    return;
  }

  model.pushEditOperations(
    [],
    payload.edits.map((edit) => ({
      range: new monaco.Range(
        edit.range.startLineNumber,
        edit.range.startColumn,
        edit.range.endLineNumber,
        edit.range.endColumn,
      ),
      text: edit.text,
    })),
    () => null,
  );
}

/**
 * Maps a code action's optional new-file payload to a monaco file-create
 * resource edit followed by a content insertion into the new model. The create
 * edit uses `ignoreIfExists` so re-applying (or an already-present sibling)
 * never clobbers an existing file; the content is inserted at the start of the
 * (empty) new model. Returns an empty list when the action creates no file.
 */
function newFileEdits(
  monaco: MonacoApi,
  rootPath: string | null,
  newFile: PhpCodeActionNewFile | undefined,
): Array<Monaco.languages.IWorkspaceTextEdit | Monaco.languages.IWorkspaceFileEdit> {
  if (!newFile || !rootPath) {
    return [];
  }

  const resource = toWorkspaceMonacoUri(monaco, rootPath, newFile.path);

  if (!resource) {
    return [];
  }

  return [
    {
      newResource: resource,
      options: { ignoreIfExists: true },
    },
    {
      resource,
      textEdit: {
        range: new monaco.Range(1, 1, 1, 1),
        text: newFile.content,
      },
      versionId: undefined,
    },
  ];
}

async function resolveCodeAction(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  action: Monaco.languages.CodeAction,
): Promise<Monaco.languages.CodeAction> {
  const backedAction = action as LanguageServerBackedCodeAction;

  if (
    !backedAction.__languageServerAction ||
    !backedAction.__workspaceRoot ||
    backedAction.__languageServerSessionId == null ||
    !isDocumentLifecyclePayloadActive(
      context,
      backedAction.__workspaceRoot,
      backedAction.__languageServerSessionId,
      backedAction.__sourcePath,
      backedAction.__documentLifecycleIdentity,
    )
  ) {
    return action;
  }

  if (isLanguageServerActionAlreadyResolved(backedAction.__languageServerAction)) {
    return action;
  }

  try {
    const resolved = await context.featuresGateway.resolveCodeAction(
      backedAction.__workspaceRoot,
      backedAction.__languageServerAction,
    );

    if (
      !isDocumentLifecyclePayloadActive(
        context,
        backedAction.__workspaceRoot,
        backedAction.__languageServerSessionId,
        backedAction.__sourcePath,
        backedAction.__documentLifecycleIdentity,
      )
    ) {
      return action;
    }

    const [mapped] = toMonacoCodeAction(
      monaco,
      Boolean(context.applyWorkspaceEdit),
      backedAction.__workspaceEditContext ?? {
        path: null,
        versionId: undefined,
      },
      backedAction.__workspaceRoot,
      backedAction.__languageServerSessionId,
      backedAction.__sourcePath,
      backedAction.__documentLifecycleIdentity,
      resolved,
      {
        markers: action.diagnostics ?? [],
        only: action.kind ?? undefined,
        trigger: monaco.languages.CodeActionTriggerType.Invoke,
      },
    );

    return mapped ? { ...action, ...mapped } : action;
  } catch (error) {
    if (isUnsupportedCodeActionResolveError(error)) {
      return action;
    }

    if (
      isDocumentLifecyclePayloadActive(
        context,
        backedAction.__workspaceRoot,
        backedAction.__languageServerSessionId,
        backedAction.__sourcePath,
        backedAction.__documentLifecycleIdentity,
      )
    ) {
      context.reportError(error);
    }

    return action;
  }
}

/**
 * A lazy LSP code action can be applied directly once it already carries an
 * inline `edit` or a `command`; only `data`-only actions still need a
 * `codeAction/resolve` round-trip. Our own PHP actions (Implement / Override
 * methods, getters, constructor) always ship an inline `edit`, so this guard
 * keeps them working without an extra resolve request — and avoids asking a
 * server that does not support `codeAction/resolve` to fill in what is already
 * present.
 */
function isLanguageServerActionAlreadyResolved(action: LanguageServerCodeAction): boolean {
  return Boolean(action.edit) || Boolean(action.command);
}

/**
 * Some servers (e.g. phpactor) advertise `codeActionProvider` but ship lazy
 * actions without a `codeAction/resolve` handler. Resolving such an edit-less
 * action surfaces a JSON-RPC "Handler codeAction/resolve not found" error. The
 * Rust side already skips the resolve request when the server does not advertise
 * `resolveProvider`; this guard is the matching client-side defence so the user
 * never sees a confusing "Handler not found" notice when an edit-less action
 * simply cannot be resolved.
 */
function isUnsupportedCodeActionResolveError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";

  return /codeAction\/resolve.*not found|not found.*codeAction\/resolve/i.test(message);
}

function provideLocalCodeActions(
  monaco: MonacoApi,
  model: MonacoModel,
  range: Monaco.Range,
  context: Monaco.languages.CodeActionContext,
): Monaco.languages.CodeAction[] {
  if (context.only && !context.only.startsWith("quickfix")) {
    return [];
  }

  return context.markers
    .filter(isUnexpectedBareIdentifierMarker)
    .filter((marker) => markerTouchesRange(marker, range))
    .map((marker) => ({
      diagnostics: [marker],
      edit: {
        edits: [
          {
            resource: model.uri,
            textEdit: {
              range: new monaco.Range(
                marker.startLineNumber,
                marker.startColumn,
                marker.endLineNumber,
                marker.endColumn,
              ),
              text: "",
            },
            versionId: model.getVersionId(),
          },
        ],
      },
      isPreferred: true,
      kind: "quickfix",
      title: "Remove unexpected identifier",
    }));
}

function codeActionList(actions: Monaco.languages.CodeAction[]): Monaco.languages.CodeActionList {
  return {
    actions,
    dispose: () => undefined,
  };
}

function orderCodeActions({
  languageServerActions,
  localActions,
  phpActions,
}: {
  languageServerActions: Monaco.languages.CodeAction[];
  localActions: Monaco.languages.CodeAction[];
  phpActions: Monaco.languages.CodeAction[];
}): Monaco.languages.CodeAction[] {
  const safeCreateTypeNames = new Set(
    phpActions.flatMap((action) => {
      const name = phpCreateTypeActionName(action.title);
      return name ? [name] : [];
    }),
  );
  const safeCreateMemberKeys = new Set(
    phpActions.flatMap((action) => {
      const key = phpCreateMemberActionKey(action.title);
      return key ? [key] : [];
    }),
  );
  const seenLanguageServerActions = new Set<string>();
  const filteredLanguageServerActions = languageServerActions.filter((action) => {
    const phpactorCreateTypeName = phpactorCreateTypeVariantName(action);
    if (phpactorCreateTypeName && safeCreateTypeNames.has(phpactorCreateTypeName)) {
      return false;
    }

    const phpactorCreateMemberKey = phpactorCreateMemberVariantKey(action);
    if (phpactorCreateMemberKey && safeCreateMemberKeys.has(phpactorCreateMemberKey)) {
      return false;
    }

    const key = codeActionDedupeKey(action);

    if (seenLanguageServerActions.has(key)) {
      return false;
    }

    seenLanguageServerActions.add(key);
    return true;
  });

  return [...phpActions, ...filteredLanguageServerActions, ...localActions];
}

function phpCreateTypeActionName(title: string): string | null {
  const match = /^Create (?:class|interface|trait|enum) ([A-Za-z_\\][A-Za-z0-9_\\]*)$/.exec(title);

  return match ? phpTypeShortName(match[1] ?? "") : null;
}

function phpactorCreateTypeVariantName(action: Monaco.languages.CodeAction): string | null {
  const backedAction = action as LanguageServerBackedCodeAction;

  if (!backedAction.__languageServerAction) {
    return null;
  }

  return phpactorCreateFileActionName(action.title) ?? phpCreateTypeActionName(action.title);
}

function phpCreateMemberActionKey(title: string): string | null {
  const match = /^Create (method|property|constant) '([^']+)'(?: in '[^']+')?$/i.exec(title);

  if (!match?.[1] || !match[2]) {
    return null;
  }

  return phpCreateMemberKey(match[1], match[2]);
}

function phpactorCreateMemberVariantKey(action: Monaco.languages.CodeAction): string | null {
  const backedAction = action as LanguageServerBackedCodeAction;

  if (!backedAction.__languageServerAction) {
    return null;
  }

  return phpactorCreateMemberActionKey(action.title);
}

function phpactorCreateMemberActionKey(title: string): string | null {
  const match = /^Create (method|property|constant)\b\s*(?:"([^"]+)"|'([^']+)'|(.+))$/i.exec(
    title.trim(),
  );

  if (!match?.[1]) {
    return null;
  }

  const memberName = match[2] ?? match[3] ?? match[4];

  return memberName ? phpCreateMemberKey(match[1], memberName) : null;
}

function phpCreateMemberKey(kind: string, name: string): string {
  return `${kind.toLowerCase()}:${phpMemberShortName(name)}`;
}

function phpMemberShortName(name: string): string {
  const normalized = name
    .replace(/^['"]|['"]$/g, "")
    .replace(/^\$+/, "")
    .trim();
  const classMember = /::\s*([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(normalized);
  if (classMember?.[1]) {
    return classMember[1].replace(/^\$+/, "");
  }

  const namespaceParts = normalized.split("\\").filter(Boolean);

  return (namespaceParts[namespaceParts.length - 1] ?? normalized).replace(/^\$+/, "");
}

function phpactorCreateFileActionName(title: string): string | null {
  const quoted = /^Create (?:default|class|interface|trait|enum) file for "([^"]+)"$/i.exec(title);

  if (quoted) {
    return phpTypeShortName(quoted[1] ?? "");
  }

  const bare = /^Create (?:default|class|interface|trait|enum) file\b\s*(?:for\s+)?(.+)$/i.exec(
    title,
  );

  if (!bare) {
    return null;
  }

  return phpTypeShortName((bare[1] ?? "").replace(/\.php$/i, "").trim());
}

function phpTypeShortName(name: string): string {
  const normalized = name.replace(/^\\+/, "").trim();
  const segments = normalized.split("\\").filter(Boolean);

  return segments.length > 0 ? (segments[segments.length - 1] ?? normalized) : normalized;
}

function codeActionDedupeKey(action: Monaco.languages.CodeAction): string {
  return [action.kind ?? "", action.title].join("\0");
}

function documentLinkList(links: Monaco.languages.ILink[] = []): Monaco.languages.ILinksList {
  return {
    dispose: () => undefined,
    links,
  };
}

function codeLensList(lenses: Monaco.languages.CodeLens[] = []): Monaco.languages.CodeLensList {
  return {
    dispose: () => undefined,
    lenses,
  };
}

function inlayHintList(hints: Monaco.languages.InlayHint[] = []): Monaco.languages.InlayHintList {
  return {
    dispose: () => undefined,
    hints,
  };
}

function isUnexpectedBareIdentifierMarker(marker: Monaco.editor.IMarkerData): boolean {
  return (
    marker.source === "PHP Syntax" &&
    /^Unexpected bare PHP identifier "[^"]+"\.$/.test(marker.message)
  );
}

function markerTouchesRange(marker: Monaco.editor.IMarkerData, range: Monaco.Range): boolean {
  if (marker.endLineNumber < range.startLineNumber) {
    return false;
  }

  if (marker.startLineNumber > range.endLineNumber) {
    return false;
  }

  if (marker.startLineNumber === range.endLineNumber && marker.startColumn > range.endColumn) {
    return false;
  }

  if (marker.endLineNumber === range.startLineNumber && marker.endColumn < range.startColumn) {
    return false;
  }

  return true;
}

function toLanguageServerCodeActionContext(
  monaco: MonacoApi,
  context: Monaco.languages.CodeActionContext,
): LanguageServerCodeActionContext {
  return {
    diagnostics: context.markers.map((marker) => ({
      code: markerCode(marker),
      data: markerData(marker),
      message: marker.message,
      range: {
        end: {
          character: Math.max(0, marker.endColumn - 1),
          line: Math.max(0, marker.endLineNumber - 1),
        },
        start: {
          character: Math.max(0, marker.startColumn - 1),
          line: Math.max(0, marker.startLineNumber - 1),
        },
      },
      severity: lspDiagnosticSeverity(monaco, marker.severity),
      source: marker.source ?? null,
    })),
    only: context.only ? [context.only] : null,
    triggerKind: codeActionTriggerKind(monaco, context.trigger),
  };
}

function onTypeFormattingTriggerCharacters(context: LanguageServerMonacoProviderContext): string[] {
  const status = context.getRuntimeStatus();
  const rootPath = context.getWorkspaceRoot?.() ?? null;
  const triggers =
    status?.kind === "running" &&
    status.rootPath &&
    rootPath &&
    workspaceRootKeysEqual(status.rootPath, rootPath) &&
    isStringArray(status.capabilities.onTypeFormattingTriggerCharacters)
      ? status.capabilities.onTypeFormattingTriggerCharacters
      : null;

  return triggers && triggers.length > 0 ? triggers : [];
}

function semanticTokensLegendForActiveRuntime(
  context: LanguageServerMonacoProviderContext,
): Monaco.languages.SemanticTokensLegend {
  const status = context.getRuntimeStatus();
  const rootPath = context.getWorkspaceRoot?.() ?? null;

  if (
    status?.kind !== "running" ||
    !status.rootPath ||
    !rootPath ||
    !workspaceRootKeysEqual(status.rootPath, rootPath)
  ) {
    return PHP_SEMANTIC_TOKENS_LEGEND;
  }

  if (!isUsableSemanticTokensLegend(status.capabilities.semanticTokensLegend)) {
    return PHP_SEMANTIC_TOKENS_LEGEND;
  }

  return status.capabilities.semanticTokensLegend;
}

function isUsableSemanticTokensLegend(
  legend: unknown,
): legend is Monaco.languages.SemanticTokensLegend {
  if (!legend || typeof legend !== "object") {
    return false;
  }

  const candidate = legend as Partial<Monaco.languages.SemanticTokensLegend>;

  return (
    isStringArray(candidate.tokenTypes) &&
    candidate.tokenTypes.length > 0 &&
    isStringArray(candidate.tokenModifiers)
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function markerCode(marker: Monaco.editor.IMarkerData): string | number | null {
  if (!marker.code) {
    return null;
  }

  if (typeof marker.code === "string" || typeof marker.code === "number") {
    return marker.code;
  }

  return marker.code.value;
}

function markerData(marker: Monaco.editor.IMarkerData): unknown | null {
  return (marker as Monaco.editor.IMarkerData & { data?: unknown }).data ?? null;
}

function codeActionTriggerKind(
  monaco: MonacoApi,
  trigger: Monaco.languages.CodeActionTriggerType | undefined,
): number | null {
  if (trigger === monaco.languages.CodeActionTriggerType.Invoke) {
    return 1;
  }

  if (trigger === 2) {
    return 2;
  }

  return null;
}

function lspDiagnosticSeverity(monaco: MonacoApi, severity: Monaco.MarkerSeverity): number | null {
  if (severity === monaco.MarkerSeverity.Error) {
    return 1;
  }

  if (severity === monaco.MarkerSeverity.Warning) {
    return 2;
  }

  if (severity === monaco.MarkerSeverity.Info) {
    return 3;
  }

  if (severity === monaco.MarkerSeverity.Hint) {
    return 4;
  }

  return null;
}

function toMonacoCodeAction(
  monaco: MonacoApi,
  appliesEditThroughWorkspaceApplier: boolean,
  editContext: WorkspaceEditContext,
  rootPath: string,
  sessionId: number,
  sourcePath: string | undefined,
  lifecycleIdentity: number | null | undefined,
  action: LanguageServerCodeAction,
  context: Monaco.languages.CodeActionContext,
): Monaco.languages.CodeAction[] {
  if (!action.edit && !action.command && action.data == null && !action.disabled) {
    return [];
  }

  const codeAction: LanguageServerBackedCodeAction = {
    ...(lifecycleIdentity == null ? {} : { __documentLifecycleIdentity: lifecycleIdentity }),
    __languageServerAction: action,
    __languageServerSessionId: sessionId,
    ...(sourcePath ? { __sourcePath: sourcePath } : {}),
    __workspaceEditContext: editContext,
    __workspaceRoot: rootPath,
    diagnostics: context.markers,
    ...(appliesEditThroughWorkspaceApplier && action.edit && !action.disabled
      ? {
          command: {
            arguments: [
              {
                action,
                editContext,
                ...(lifecycleIdentity == null ? {} : { lifecycleIdentity }),
                ...(sourcePath ? { path: sourcePath } : {}),
                rootPath,
                sessionId,
              } satisfies ResolveAndApplyCodeActionPayload,
            ],
            id: RESOLVE_AND_APPLY_PHP_CODE_ACTION_ID,
            title: action.title,
          },
        }
      : action.command
        ? {
            command: toMonacoLanguageServerCommand(
              rootPath,
              sessionId,
              action.command,
              action.title,
              sourcePath,
              lifecycleIdentity,
            ),
          }
        : !action.edit && action.data != null && !action.disabled
          ? {
              command: {
                arguments: [
                  {
                    action,
                    editContext,
                    ...(lifecycleIdentity == null ? {} : { lifecycleIdentity }),
                    ...(sourcePath ? { path: sourcePath } : {}),
                    rootPath,
                    sessionId,
                  } satisfies ResolveAndApplyCodeActionPayload,
                ],
                id: RESOLVE_AND_APPLY_PHP_CODE_ACTION_ID,
                title: action.title,
              },
            }
          : {}),
    ...(action.edit && !appliesEditThroughWorkspaceApplier
      ? {
          edit: toMonacoWorkspaceEdit(monaco, editContext, action.edit, rootPath),
        }
      : {}),
    ...(action.disabled
      ? {
          disabled: action.disabled.reason,
        }
      : {}),
    isPreferred: action.isPreferred,
    kind: action.kind ?? "quickfix",
    title: action.title,
  };

  return [codeAction];
}

function toMonacoLanguageServerCommand(
  rootPath: string,
  sessionId: number,
  command: LanguageServerCodeActionCommand,
  fallbackTitle: string,
  path?: string,
  lifecycleIdentity?: number | null,
): Monaco.languages.Command {
  return {
    arguments: [
      {
        command,
        ...(lifecycleIdentity == null ? {} : { lifecycleIdentity }),
        ...(path ? { path } : {}),
        rootPath,
        sessionId,
      } satisfies ExecuteCommandPayload,
    ],
    id: EXECUTE_PHP_LANGUAGE_SERVER_COMMAND_ID,
    title: command.title || fallbackTitle,
  };
}

function toMonacoCodeLens(
  monaco: MonacoApi,
  rootPath: string,
  sourcePath: string,
  sessionId: number,
  lifecycleIdentity: number | null | undefined,
  lens: LanguageServerCodeLens,
): LanguageServerBackedCodeLens {
  return {
    ...(lifecycleIdentity == null ? {} : { __documentLifecycleIdentity: lifecycleIdentity }),
    __languageServerLens: lens,
    __languageServerSessionId: sessionId,
    __sourcePath: sourcePath,
    __workspaceRoot: rootPath,
    ...(lens.command
      ? {
          command: toMonacoCodeLensCommand(
            monaco,
            rootPath,
            sessionId,
            sourcePath,
            lifecycleIdentity,
            lens.command,
          ),
        }
      : {}),
    range: toMonacoRange(monaco, lens.range),
  };
}

function toMonacoInlayHint(
  monaco: MonacoApi,
  rootPath: string,
  sourcePath: string,
  sessionId: number,
  lifecycleIdentity: number | null | undefined,
  hint: LanguageServerInlayHint,
): LanguageServerBackedInlayHint {
  const kind = monacoInlayHintKindFromLspKind(monaco, hint.kind);
  const monacoHint: LanguageServerBackedInlayHint = {
    label: toMonacoInlayHintLabel(
      monaco,
      rootPath,
      sourcePath,
      sessionId,
      lifecycleIdentity,
      hint.label,
    ),
    paddingLeft: hint.paddingLeft,
    paddingRight: hint.paddingRight,
    position: {
      column: hint.position.character + 1,
      lineNumber: hint.position.line + 1,
    },
    ...(kind != null ? { kind } : {}),
    ...(hint.textEdits?.length
      ? {
          textEdits: hint.textEdits.map((edit) => toMonacoTextEdit(monaco, edit)),
        }
      : {}),
    tooltip: hint.tooltip ?? undefined,
  };

  Object.defineProperties(monacoHint, {
    ...(lifecycleIdentity == null
      ? {}
      : {
          __documentLifecycleIdentity: {
            value: lifecycleIdentity,
          },
        }),
    __languageServerInlayHint: {
      value: hint,
    },
    __languageServerSessionId: {
      value: sessionId,
    },
    __sourcePath: {
      value: sourcePath,
    },
    __workspaceRoot: {
      value: rootPath,
    },
  });

  return monacoHint;
}

function toMonacoInlayHintLabel(
  monaco: MonacoApi,
  rootPath: string,
  sourcePath: string,
  sessionId: number,
  lifecycleIdentity: number | null | undefined,
  label: LanguageServerInlayHint["label"],
): Monaco.languages.InlayHint["label"] {
  if (typeof label === "string") {
    return label;
  }

  return label.map((part) => {
    const [location] = part.location ? toMonacoLocation(monaco, rootPath, part.location) : [];

    return {
      ...(part.command
        ? {
            command: toMonacoLanguageServerCommand(
              rootPath,
              sessionId,
              part.command,
              part.command.title,
              sourcePath,
              lifecycleIdentity,
            ),
          }
        : {}),
      label: part.label,
      ...(location ? { location } : {}),
      ...(part.tooltip ? { tooltip: part.tooltip } : {}),
    };
  });
}

function monacoInlayHintKindFromLspKind(
  monaco: MonacoApi,
  kind: number | null,
): Monaco.languages.InlayHintKind | undefined {
  if (kind === 1) {
    return monaco.languages.InlayHintKind.Type;
  }

  if (kind === 2) {
    return monaco.languages.InlayHintKind.Parameter;
  }

  return undefined;
}

function toMonacoCodeLensCommand(
  monaco: MonacoApi,
  rootPath: string,
  sessionId: number,
  sourcePath: string,
  lifecycleIdentity: number | null | undefined,
  command: LanguageServerCodeActionCommand,
): Monaco.languages.Command | undefined {
  if (command.command === "editor.action.showReferences") {
    return toMonacoShowReferencesCommand(monaco, rootPath, command);
  }

  return toMonacoLanguageServerCommand(
    rootPath,
    sessionId,
    command,
    command.title,
    sourcePath,
    lifecycleIdentity,
  );
}

function toMonacoShowReferencesCommand(
  monaco: MonacoApi,
  rootPath: string,
  command: LanguageServerCodeActionCommand,
): Monaco.languages.Command | undefined {
  const [uri, position, locations] = command.arguments ?? [];
  const sourceUri = toMonacoFileUri(monaco, rootPath, uri);
  const monacoPosition = toMonacoCommandPosition(position);

  if (!sourceUri || !monacoPosition || !Array.isArray(locations)) {
    return undefined;
  }

  return {
    arguments: [
      sourceUri,
      monacoPosition,
      locations.flatMap((location) =>
        toMonacoLocation(monaco, rootPath, location as LanguageServerLocation),
      ),
    ],
    id: "editor.action.showReferences",
    title: command.title,
  };
}

function toMonacoFileUri(
  monaco: MonacoApi,
  rootPath: string,
  value: unknown,
): ReturnType<MonacoApi["Uri"]["file"]> | null {
  if (typeof value !== "string") {
    return null;
  }

  const path = pathFromLanguageServerUri(value);

  if (!path || !isPathInWorkspaceRoot(rootPath, path)) {
    return null;
  }

  return toWorkspaceMonacoUri(monaco, rootPath, path);
}

function toMonacoCommandPosition(value: unknown): Monaco.IPosition | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const line = (value as { line?: unknown }).line;
  const character = (value as { character?: unknown }).character;

  if (typeof line !== "number" || typeof character !== "number") {
    return null;
  }

  return {
    column: Math.max(1, character + 1),
    lineNumber: Math.max(1, line + 1),
  };
}

async function provideHover(
  _monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
  token?: Monaco.CancellationToken,
): Promise<Monaco.languages.Hover | null> {
  const request = featureRequestContext(context, model, position, "hover");

  if (!request) {
    return null;
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRequest(context, request))) {
      return null;
    }

    const hover = await raceInteractiveFeatureRequest(
      context.featuresGateway.hover(request.rootPath, request.position),
      HOVER_FEATURE_REQUEST_TIMEOUT_MS,
    );

    if (hover === FEATURE_REQUEST_TIMED_OUT) {
      return null;
    }

    if (token?.isCancellationRequested) {
      return null;
    }

    if (!isFeatureRequestActive(context, request)) {
      return null;
    }

    if (!hover) {
      return null;
    }

    return {
      contents: [{ value: hover.contents }],
    };
  } catch (error) {
    reportErrorForActiveRequest(context, request, error);
    return null;
  }
}

async function provideCompletionItems(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
  _completionContext?: Monaco.languages.CompletionContext,
  token?: Monaco.CancellationToken,
): Promise<Monaco.languages.CompletionList> {
  const documentContext = activePhpDocumentContext(context, model);

  if (!documentContext) {
    return { suggestions: [] };
  }

  if (isLargePhpDocumentContext(context, documentContext)) {
    return { suggestions: [] };
  }

  const word = model.getWordUntilPosition(position);
  const range = completionRange(model, position, word);
  const source = modelSource(model, documentContext.activeDocument.content);
  const postfixSuggestions = phpPostfixCompletionSuggestions(monaco, model, source, position);

  if (postfixSuggestions) {
    return { suggestions: postfixSuggestions };
  }

  const frameworkSuggestions = await phpFrameworkCompletionSuggestions(
    monaco,
    context,
    model,
    source,
    position,
    range,
    documentContext,
  );

  if (frameworkSuggestions) {
    return { suggestions: frameworkSuggestions };
  }

  const memberAccessCompletionContext = phpMemberAccessCompletionContextAt(source, position);
  const staticAccessCompletionContext = phpStaticAccessCompletionContextAt(source, position);
  const isMemberOrStaticAccessCompletion = Boolean(
    memberAccessCompletionContext || staticAccessCompletionContext,
  );
  const isFrameworkStringCompletion = phpFrameworkStringCompletionOwnsContext(
    context,
    source,
    position,
  );
  const isScopedCompletion = Boolean(
    isMemberOrStaticAccessCompletion || isFrameworkStringCompletion,
  );

  // Kick off the language-server completion before awaiting the (potentially
  // framework-backed) method collectors so the two run concurrently instead of
  // adding their latencies serially on every keystroke. Laravel/framework
  // string contexts are the exception: phpactor has no useful semantic signal
  // inside `route('...')`, `config('...')`, `DB::connection('...')`, etc., and
  // its generic string completions can drown out or duplicate our framework
  // targets. In that context the local framework collector is authoritative.
  const lspCompletion = isFrameworkStringCompletion
    ? null
    : requestPhpLanguageServerCompletion(context, model, position);
  const methodSuggestions = await phpMethodSuggestions(
    monaco,
    context,
    model,
    source,
    position,
    range,
    documentContext,
  );

  if (!isPhpDocumentContextActive(context, documentContext)) {
    void lspCompletion?.catch(() => undefined);
    return { suggestions: [] };
  }

  const variableSuggestions: Monaco.languages.CompletionItem[] =
    methodSuggestions.length > 0 || isScopedCompletion
      ? []
      : phpVariableCompletionsAt(source, position).map((item, index) => ({
          detail: item.detail,
          insertText: item.name,
          kind: monaco.languages.CompletionItemKind.Variable,
          label: item.name,
          range,
          sortText: `0_${String(index).padStart(4, "0")}`,
        }));
  // Built-in live-template snippets (nclass/dd/route/…) only make sense as
  // free-standing statements typed from an abbreviation, never after `->`/`::`,
  // inside a Laravel scoped string, or while framework-backed method/Laravel
  // completions are driving the list. They are suppressed in those contexts just
  // like local variables.
  const snippetSuggestions =
    methodSuggestions.length > 0 || isScopedCompletion
      ? []
      : phpSnippetSuggestions(
          monaco,
          context,
          documentContext.activeDocument.language,
          word,
          range,
        );
  const localSuggestions = [...methodSuggestions, ...variableSuggestions];
  const suggestions = [...localSuggestions, ...snippetSuggestions];

  if (isFrameworkStringCompletion) {
    return { suggestions };
  }

  if (!lspCompletion) {
    return { suggestions };
  }

  const resolution = await lspCompletion;

  // The locally-computed method/postfix/variable/snippet suggestions are
  // returned as a graceful fallback when the language server is missing,
  // mid-index or slow, so completion is never empty while phpactor warms up.
  if (resolution.kind === "noRequest") {
    return { suggestions };
  }

  if (resolution.kind === "timedOut") {
    return { suggestions };
  }

  if (token?.isCancellationRequested) {
    return { suggestions: [] };
  }

  if (resolution.kind === "inactive") {
    return { suggestions: [] };
  }

  if (resolution.kind === "error") {
    if (isFeatureRequestActive(context, resolution)) {
      context.reportError(resolution.error);
    }
    return { suggestions };
  }

  const completion = resolution.completion;
  const lspSuggestions = completion.items.flatMap((item, index) => {
    const kind = monacoCompletionKindFromLspKind(monaco, item.kind);

    if (
      isMemberOrStaticAccessCompletion &&
      !phpLspCompletionAllowedInMemberContext(
        monaco,
        item,
        kind,
        Boolean(staticAccessCompletionContext),
      )
    ) {
      return [];
    }

    if (
      !phpLspCompletionVisibleForReceiver(
        item,
        memberAccessCompletionContext?.receiverExpression ?? null,
        staticAccessCompletionContext?.className ?? null,
      )
    ) {
      return [];
    }

    const insert = lspCompletionInsert(monaco, item, kind);
    const additionalTextEdits =
      item.additionalTextEdits && item.additionalTextEdits.length > 0
        ? item.additionalTextEdits.map((edit) => toMonacoTextEdit(monaco, edit))
        : undefined;

    return [
      {
        ...(additionalTextEdits ? { additionalTextEdits } : {}),
        ...(item.commitCharacters && item.commitCharacters.length > 0
          ? { commitCharacters: item.commitCharacters }
          : {}),
        detail: item.detail || undefined,
        documentation: phpLspCompletionDocumentation(item),
        filterText: item.filterText || undefined,
        insertText: insert.insertText,
        ...(item.command
          ? {
              command: toMonacoLanguageServerCommand(
                resolution.rootPath,
                resolution.sessionId,
                item.command,
                item.label,
                resolution.sourcePath,
                resolution.lifecycleIdentity,
              ),
            }
          : insert.command
            ? { command: insert.command }
            : {}),
        ...(insert.insertTextRules ? { insertTextRules: insert.insertTextRules } : {}),
        kind,
        label: phpLspCompletionLabel(item),
        ...(item.preselect ? { preselect: true } : {}),
        range,
        sortText: item.sortText ? `1_${item.sortText}` : `1_${String(index).padStart(4, "0")}`,
        ...(phpLspCompletionIsDeprecated(item)
          ? { tags: [monaco.languages.CompletionItemTag.Deprecated] }
          : {}),
      },
    ];
  });

  // Ordering for dedupe: locally-computed method/variable suggestions first,
  // then language-server items, then snippets last. On a dedupe-key collision
  // the LSP item wins over a like-named snippet (relevant for callable-shaped
  // snippets such as `dd`). Monaco still orders the visible list by `sortText`,
  // which keeps snippets (`2_`) below LSP (`1_`).
  return {
    ...(completion.isIncomplete ? { incomplete: true } : {}),
    suggestions: dedupeCompletionItems(monaco, [
      ...localSuggestions,
      ...lspSuggestions,
      ...snippetSuggestions,
    ]),
  };
}

function phpLspCompletionVisibleForReceiver(
  item: LanguageServerCompletionList["items"][number],
  memberReceiver: string | null,
  staticReceiver: string | null,
): boolean {
  const visibility = /^\s*(private|protected|public)\b/i
    .exec(item.detail ?? "")?.[1]
    ?.toLowerCase();

  if (!visibility || visibility === "public") {
    return true;
  }

  if (memberReceiver?.trim() === "$this") {
    return true;
  }

  const normalizedStaticReceiver = staticReceiver?.trim().toLowerCase();

  return (
    normalizedStaticReceiver === "self" ||
    normalizedStaticReceiver === "static" ||
    normalizedStaticReceiver === "parent"
  );
}

function phpLspCompletionLabel(
  item: LanguageServerCompletionList["items"][number],
): Monaco.languages.CompletionItemLabel | string {
  const detail = item.labelDetails?.detail || undefined;
  const description = item.labelDetails?.description || undefined;

  if (!detail && !description) {
    return item.label;
  }

  return {
    ...(description ? { description } : {}),
    ...(detail ? { detail } : {}),
    label: item.label,
  };
}

function phpLspCompletionDocumentation(
  item: LanguageServerCompletionList["items"][number],
): Monaco.IMarkdownString | string | undefined {
  if (!item.documentation) {
    return undefined;
  }

  return item.documentationKind === "markdown" ? { value: item.documentation } : item.documentation;
}

function phpLspCompletionIsDeprecated(
  item: LanguageServerCompletionList["items"][number],
): boolean {
  return item.deprecated === true || item.tags?.includes(1) === true;
}

type PhpLanguageServerCompletionResolution =
  | { kind: "noRequest" }
  | { kind: "timedOut" }
  | { kind: "inactive" }
  | {
      kind: "error";
      error: unknown;
      lifecycleIdentity: number | null;
      path: string;
      rootPath: string;
      sessionId: number;
    }
  | {
      kind: "completion";
      completion: LanguageServerCompletionList;
      lifecycleIdentity: number | null;
      rootPath: string;
      sessionId: number;
      sourcePath: string;
    };

/**
 * Runs the PHP language-server completion request behind the shared interactive
 * timeout and the per-workspace root/session guard, mirroring the hardening
 * already applied to hover/navigation. Returning a discriminated result lets the
 * caller decide between a graceful local fallback (timeout/no-request/error) and
 * dropping a stale response (inactive root/session).
 */
async function requestPhpLanguageServerCompletion(
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Promise<PhpLanguageServerCompletionResolution> {
  const request = featureRequestContext(context, model, position, "completion");

  if (!request) {
    return { kind: "noRequest" };
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRequest(context, request))) {
      return { kind: "inactive" };
    }

    const recordCompletionLatency = context.recordCompletionLatency;
    const completionStart = recordCompletionLatency ? performance.now() : 0;
    const completion = await raceInteractiveFeatureRequest(
      context.featuresGateway.completion(request.rootPath, request.position),
    );

    if (completion === FEATURE_REQUEST_TIMED_OUT) {
      return { kind: "timedOut" };
    }

    // Record only genuine round-trips: the timeout sentinel resolves at the
    // fixed interactive-request deadline (not the real gateway latency) and
    // would otherwise skew the completion median/p95. When no host wired the
    // callback, the `performance.now()` read above was skipped entirely (zero
    // hot-path cost).
    if (recordCompletionLatency) {
      recordCompletionLatency(performance.now() - completionStart, request.rootPath);
    }

    if (!isFeatureRequestActive(context, request)) {
      return { kind: "inactive" };
    }

    return {
      kind: "completion",
      completion,
      lifecycleIdentity: request.lifecycleIdentity,
      rootPath: request.rootPath,
      sessionId: request.sessionId,
      sourcePath: request.path,
    };
  } catch (error) {
    if (isFeatureRequestActive(context, request)) {
      return {
        kind: "error",
        error,
        lifecycleIdentity: request.lifecycleIdentity,
        path: request.path,
        rootPath: request.rootPath,
        sessionId: request.sessionId,
      };
    }

    return { kind: "inactive" };
  }
}

function phpPostfixCompletionSuggestions(
  monaco: MonacoApi,
  model: MonacoModel,
  source: string,
  position: MonacoPosition,
): Monaco.languages.CompletionItem[] | null {
  const postfixContext = phpPostfixCompletionContextAt(source, position);

  if (!postfixContext) {
    return null;
  }

  const start = model.getPositionAt(postfixContext.replaceRange.start);
  const range = {
    endColumn: position.column,
    endLineNumber: position.lineNumber,
    startColumn: start.column,
    startLineNumber: start.lineNumber,
  };

  return phpPostfixCompletionItems(postfixContext.receiverExpression, postfixContext.keyword).map(
    (item, index) => ({
      detail: item.detail,
      insertText: item.insertText,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      kind: monaco.languages.CompletionItemKind.Snippet,
      label: item.label,
      range,
      sortText: `0_${String(index).padStart(4, "0")}`,
    }),
  );
}

/**
 * Builds language-scoped live-template snippet completion items for the typed
 * `word`. The snippet registry is a GLOBAL built-in (no workspace state), so it
 * carries no per-project isolation risk; the surrounding completion flow keeps
 * its root/session/token guards. Bodies are emitted with `InsertAsSnippet` so
 * Monaco expands the `$1`/`${1:default}`/`$0` tab-stops natively, and sort with
 * the `2_` bucket so they appear after language-server suggestions.
 */
function phpSnippetSuggestions(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  language: string,
  word: { word?: string },
  range: ReturnType<typeof completionRange>,
): Monaco.languages.CompletionItem[] {
  const typed = typeof word.word === "string" ? word.word : "";

  return snippetCompletionSuggestions(
    monaco,
    language,
    typed,
    range,
    contextUserSnippets(context),
  ) as Monaco.languages.CompletionItem[];
}

/**
 * Reads the GLOBAL user snippets from the provider context, tolerating a host
 * that wires no `getUserSnippets` callback (returns an empty list so only the
 * built-in registry is offered). The list is normalized here so a half-edited
 * or malformed in-session snippet (empty body, untrimmed prefix, no language)
 * never reaches completion, matching the persisted/reload path.
 */
function contextUserSnippets(context: LanguageServerMonacoProviderContext): readonly UserSnippet[] {
  return normalizeUserSnippets(context.getUserSnippets?.() ?? []);
}

async function phpMethodSuggestions(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  source: string,
  position: MonacoPosition,
  range: ReturnType<typeof completionRange>,
  request: { rootPath: string; sessionId: number | null },
): Promise<Monaco.languages.CompletionItem[]> {
  if (!context.providePhpMethodCompletions) {
    return [];
  }

  try {
    const methods = await context.providePhpMethodCompletions(source, position);

    if (!isPhpDocumentContextActive(context, request)) {
      return [];
    }

    // Group the list PhpStorm-like (properties, relations, methods, magic
    // scopes) before assigning the `sortText` index so Monaco renders the
    // categories together. The sort is stable, so each collector's intended
    // ordering within a category is untouched.
    return orderPhpMemberCompletionsByCategory(methods).map((item, index) => ({
      command: phpMethodCompletionShouldTriggerParameterHints(item)
        ? {
            id: "editor.action.triggerParameterHints",
            title: "Trigger parameter hints",
          }
        : undefined,
      detail: phpMethodDetail(item),
      documentation: phpMethodDocumentation(item),
      insertText: phpMethodInsertText(item),
      insertTextRules: phpMethodInsertTextRules(monaco, item),
      kind: phpMethodCompletionKind(monaco, item),
      label: phpMethodCompletionLabel(item),
      range: phpMethodCompletionRange(monaco, model, item, range),
      sortText: `0_${String(index).padStart(4, "0")}`,
    }));
  } catch (error) {
    if (isPhpDocumentContextActive(context, request)) {
      context.reportError(error);
    }
    return [];
  }
}

function phpMethodCompletionRange(
  monaco: MonacoApi,
  model: MonacoModel,
  item: PhpMethodCompletion,
  fallbackRange: ReturnType<typeof completionRange>,
): ReturnType<typeof completionRange> | Monaco.Range {
  if (item.replaceStart == null || item.replaceEnd == null) {
    return fallbackRange;
  }

  const start = model.getPositionAt(item.replaceStart);
  const end = model.getPositionAt(item.replaceEnd);

  return new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column);
}

const invalidPhpMemberCompletionNames = new Set([
  "class",
  "const",
  "function",
  "interface",
  "namespace",
  "private",
  "protected",
  "public",
  "return",
  "static",
  "trait",
  "use",
]);

function phpLspCompletionAllowedInMemberContext(
  monaco: MonacoApi,
  item: {
    detail: string | null;
    documentation: string | null;
    insertText: string | null;
    label: string;
  },
  kind: Monaco.languages.CompletionItemKind,
  allowConstants: boolean,
): boolean {
  const labelName = phpCallableCompletionName(item.label);

  if (labelName && invalidPhpMemberCompletionNames.has(labelName.toLowerCase())) {
    return false;
  }

  if (
    kind === monaco.languages.CompletionItemKind.Method ||
    kind === monaco.languages.CompletionItemKind.Property ||
    kind === monaco.languages.CompletionItemKind.Field
  ) {
    return true;
  }

  if (kind === monaco.languages.CompletionItemKind.Constant) {
    return allowConstants;
  }

  if (
    kind !== monaco.languages.CompletionItemKind.Function &&
    kind !== monaco.languages.CompletionItemKind.Text
  ) {
    return false;
  }

  if (!labelName) {
    return false;
  }

  return completionItemValuesLookLikeSignature(item, item.insertText, labelName);
}

async function provideSignatureHelp(
  _monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
  token?: Monaco.CancellationToken,
  signatureContext?: Monaco.languages.SignatureHelpContext,
): Promise<Monaco.languages.SignatureHelpResult | null> {
  const documentContext = activePhpDocumentContext(context, model);

  if (!documentContext) {
    return null;
  }

  if (isLargePhpDocumentContext(context, documentContext)) {
    return null;
  }

  const lspSignaturePromise = requestPhpLanguageServerSignatureHelp(
    context,
    model,
    position,
    signatureContext,
  );
  const localSignature = await requestLocalPhpSignatureHelp(
    context,
    model,
    position,
    documentContext,
  );

  if (localSignature) {
    const lspResolution = await resolvePhpSignatureWithinMergeWindow(lspSignaturePromise);

    if (token?.isCancellationRequested) {
      return null;
    }

    if (!isPhpDocumentContextActive(context, documentContext)) {
      return null;
    }

    if (lspResolution === PHP_SIGNATURE_MERGE_WINDOW_EXPIRED) {
      return toMonacoPhpSignatureHelp(localSignature);
    }

    return phpSignatureHelpFromResolution(context, lspResolution, localSignature);
  }

  const lspResolution = await lspSignaturePromise;

  if (token?.isCancellationRequested) {
    return null;
  }

  if (!isPhpDocumentContextActive(context, documentContext)) {
    return null;
  }

  return phpSignatureHelpFromResolution(context, lspResolution, null);
}

async function resolvePhpSignatureWithinMergeWindow(
  lspSignaturePromise: Promise<PhpLanguageServerSignatureResolution>,
): Promise<PhpLanguageServerSignatureResolution | typeof PHP_SIGNATURE_MERGE_WINDOW_EXPIRED> {
  return Promise.race([
    lspSignaturePromise,
    new Promise<typeof PHP_SIGNATURE_MERGE_WINDOW_EXPIRED>((resolve) => {
      setTimeout(() => resolve(PHP_SIGNATURE_MERGE_WINDOW_EXPIRED), PHP_SIGNATURE_MERGE_WINDOW_MS);
    }),
  ]);
}

function phpSignatureHelpFromResolution(
  context: LanguageServerMonacoProviderContext,
  resolution: PhpLanguageServerSignatureResolution,
  localSignature: LanguageServerSignatureHelp | null,
): Monaco.languages.SignatureHelpResult | null {
  if (resolution.kind === "inactive") {
    return null;
  }

  if (resolution.kind === "error") {
    context.reportError(resolution.error);
  }

  const lspSignature = resolution.kind === "signature" ? resolution.signatureHelp : null;
  const merged = mergePhpSignatureHelp(lspSignature, localSignature);

  return merged ? toMonacoPhpSignatureHelp(merged) : null;
}

async function requestLocalPhpSignatureHelp(
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
  documentContext: {
    activeDocument: EditorDocument;
    rootPath: string;
    sessionId: number | null;
  },
): Promise<LanguageServerSignatureHelp | null> {
  if (!context.providePhpMethodSignature) {
    return null;
  }

  try {
    const signature = await context.providePhpMethodSignature(
      modelSource(model, documentContext.activeDocument.content),
      position,
    );

    if (!isPhpDocumentContextActive(context, documentContext) || !signature) {
      return null;
    }

    return {
      activeParameter: Math.min(
        signature.argumentIndex,
        Math.max(0, signature.parameters.length - 1),
      ),
      activeSignature: 0,
      signatures: [
        {
          documentation: signature.method.declaringClassName,
          label: phpMethodSignatureLabel(signature.method),
          parameters: signature.parameters.map((parameter) => ({
            documentation: null,
            label: phpParameterLabel(parameter),
          })),
        },
      ],
    };
  } catch (error) {
    if (isPhpDocumentContextActive(context, documentContext)) {
      context.reportError(error);
    }

    return null;
  }
}

type PhpLanguageServerSignatureResolution =
  | { kind: "noRequest" }
  | { kind: "timedOut" }
  | { kind: "inactive" }
  | { kind: "error"; error: unknown }
  | { kind: "signature"; signatureHelp: LanguageServerSignatureHelp | null };

async function requestPhpLanguageServerSignatureHelp(
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
  signatureContext?: Monaco.languages.SignatureHelpContext,
): Promise<PhpLanguageServerSignatureResolution> {
  const request = featureRequestContext(context, model, position, "signatureHelp");

  if (!request) {
    return { kind: "noRequest" };
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRequest(context, request))) {
      return { kind: "inactive" };
    }

    const lspContext = toPhpLanguageServerSignatureHelpContext(signatureContext);
    const signatureHelp = await raceInteractiveFeatureRequest(
      lspContext
        ? context.featuresGateway.signatureHelp(request.rootPath, request.position, lspContext)
        : context.featuresGateway.signatureHelp(request.rootPath, request.position),
    );

    if (signatureHelp === FEATURE_REQUEST_TIMED_OUT) {
      return { kind: "timedOut" };
    }

    if (!isFeatureRequestActive(context, request)) {
      return { kind: "inactive" };
    }

    return { kind: "signature", signatureHelp };
  } catch (error) {
    return isFeatureRequestActive(context, request)
      ? { kind: "error", error }
      : { kind: "inactive" };
  }
}

function toPhpLanguageServerSignatureHelpContext(
  context: Monaco.languages.SignatureHelpContext | undefined,
): LanguageServerSignatureHelpContext | undefined {
  if (!context) {
    return undefined;
  }

  return {
    ...(context.activeSignatureHelp
      ? {
          activeSignatureHelp: {
            activeParameter: context.activeSignatureHelp.activeParameter,
            activeSignature: context.activeSignatureHelp.activeSignature,
            signatures: context.activeSignatureHelp.signatures.map(toPhpLanguageServerSignature),
          },
        }
      : {}),
    isRetrigger: context.isRetrigger,
    ...(context.triggerCharacter ? { triggerCharacter: context.triggerCharacter } : {}),
    triggerKind: context.triggerKind as LanguageServerSignatureHelpContext["triggerKind"],
  };
}

function toPhpLanguageServerSignature(
  signature: Monaco.languages.SignatureInformation,
): LanguageServerSignature {
  return {
    documentation: monacoDocumentationText(signature.documentation),
    label: signature.label,
    parameters: signature.parameters.map((parameter) => ({
      documentation: monacoDocumentationText(parameter.documentation),
      label: monacoSignatureParameterLabel(signature.label, parameter.label),
    })),
  };
}

function monacoDocumentationText(
  documentation: string | Monaco.IMarkdownString | undefined,
): string | null {
  return typeof documentation === "string" ? documentation : (documentation?.value ?? null);
}

function monacoSignatureParameterLabel(
  signatureLabel: string,
  label: string | [number, number],
): string {
  return typeof label === "string" ? label : signatureLabel.slice(label[0], label[1]);
}

function mergePhpSignatureHelp(
  lsp: LanguageServerSignatureHelp | null,
  local: LanguageServerSignatureHelp | null,
): LanguageServerSignatureHelp | null {
  if (!lsp) {
    return local;
  }

  if (!local) {
    return lsp;
  }

  const signatures = [...lsp.signatures];
  const labels = new Set(signatures.map((signature) => signature.label));

  for (const signature of local.signatures) {
    if (labels.has(signature.label)) {
      continue;
    }

    labels.add(signature.label);
    signatures.push(signature);
  }

  return {
    activeParameter: lsp.activeParameter,
    activeSignature: Math.min(lsp.activeSignature, Math.max(0, signatures.length - 1)),
    signatures,
  };
}

function toMonacoPhpSignatureHelp(
  signatureHelp: LanguageServerSignatureHelp,
): Monaco.languages.SignatureHelpResult {
  return {
    dispose: () => undefined,
    value: {
      activeParameter: signatureHelp.activeParameter,
      activeSignature: signatureHelp.activeSignature,
      signatures: signatureHelp.signatures.map((signature) => ({
        documentation: signature.documentation || undefined,
        label: signature.label,
        parameters: signature.parameters.map((parameter) => ({
          documentation: parameter.documentation || undefined,
          label: parameter.label,
        })),
      })),
    },
  };
}

async function provideSelectionRanges(
  monaco: MonacoApi,
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  positions: MonacoPosition[],
): Promise<Monaco.languages.SelectionRange[][] | null> {
  const request = featureDocumentRequestContext(context, model, "selectionRange");

  if (!request) {
    return null;
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRequest(context, request))) {
      return null;
    }

    const selectionRanges = await context.featuresGateway.selectionRanges(
      request.rootPath,
      request.path,
      positions.map((position) => ({
        character: Math.max(0, position.column - 1),
        line: Math.max(0, position.lineNumber - 1),
      })),
    );

    if (!isFeatureRequestActive(context, request)) {
      return null;
    }

    return selectionRanges.map((selectionRange) => flattenSelectionRange(monaco, selectionRange));
  } catch (error) {
    reportErrorForActiveRequest(context, request, error);
    return null;
  }
}

async function provideDocumentSemanticTokens(
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
): Promise<Monaco.languages.SemanticTokens | null> {
  const request = featureDocumentRequestContext(context, model, "semanticTokens");

  if (!request) {
    return null;
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRequest(context, request))) {
      return null;
    }

    const tokens = await context.featuresGateway.semanticTokens(request.rootPath, request.path);

    if (!isFeatureRequestActive(context, request)) {
      return null;
    }

    return toMonacoSemanticTokens(tokens);
  } catch (error) {
    reportErrorForActiveRequest(context, request, error);
    return null;
  }
}

async function provideDocumentRangeSemanticTokens(
  context: LanguageServerMonacoProviderContext,
  model: MonacoModel,
  range: Monaco.Range,
): Promise<Monaco.languages.SemanticTokens | null> {
  const request = featureDocumentRequestContext(context, model, "semanticTokens");

  if (!request) {
    return null;
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRequest(context, request))) {
      return null;
    }

    const tokens = await context.featuresGateway.rangeSemanticTokens(
      request.rootPath,
      request.path,
      toLanguageServerRange(range),
    );

    if (!isFeatureRequestActive(context, request)) {
      return null;
    }

    return toMonacoSemanticTokens(tokens);
  } catch (error) {
    reportErrorForActiveRequest(context, request, error);
    return null;
  }
}

function handleLanguageServerRefreshEvent(
  context: LanguageServerMonacoProviderContext,
  event: LanguageServerRefreshEvent,
  codeLensRefreshEmitter: MonacoEventEmitter<void>,
  inlayHintRefreshEmitter: MonacoEventEmitter<void>,
  semanticTokensRefreshEmitter: MonacoEventEmitter<void>,
): void {
  if (!isRefreshEventActive(context, event)) {
    return;
  }

  if (event.feature === "codeLens") {
    codeLensRefreshEmitter.fire(undefined);
    return;
  }

  if (event.feature === "inlayHint") {
    inlayHintRefreshEmitter.fire(undefined);
    return;
  }

  if (event.feature === "semanticTokens") {
    semanticTokensRefreshEmitter.fire(undefined);
  }
}

function isRefreshEventActive(
  context: LanguageServerMonacoProviderContext,
  event: LanguageServerRefreshEvent,
): boolean {
  const workspaceRoot = context.getWorkspaceRoot?.() ?? null;

  if (!workspaceRoot) {
    return false;
  }

  if (!event.rootPath || !workspaceRootKeysEqual(event.rootPath, workspaceRoot)) {
    return false;
  }

  const status = context.getRuntimeStatus();

  return (
    status?.kind === "running" &&
    status.sessionId === event.sessionId &&
    Boolean(status.rootPath) &&
    workspaceRootKeysEqual(status.rootPath, workspaceRoot)
  );
}
