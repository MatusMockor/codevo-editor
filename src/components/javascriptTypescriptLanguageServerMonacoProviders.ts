import type * as Monaco from "monaco-editor";
import {
  canUseLanguageServerFeature,
  pathFromLanguageServerUri,
  toLanguageServerTextDocumentPosition,
  type LanguageServerCodeAction,
  type LanguageServerCodeActionCommand,
  type LanguageServerCodeLens,
  type LanguageServerDocumentLink,
  type LanguageServerFeature,
  type LanguageServerFoldingRange,
  type LanguageServerInlayHint,
  type LanguageServerLocation,
  type LanguageServerRefreshEvent,
  type LanguageServerRefreshGateway,
  type LanguageServerSignature,
  type LanguageServerSignatureHelp,
  type LanguageServerSignatureHelpContext,
  type LanguageServerSignatureParameter,
  type LanguageServerWorkspaceEdit,
  type LanguageServerWorkspaceFileOperation,
  type LanguageServerWorkspaceFileOperationOptions,
  type LanguageServerWorkspaceEditEvent,
  type LanguageServerWorkspaceEditGateway,
  type JavaScriptTypeScriptLanguageServerFeaturesGateway,
} from "../domain/languageServerFeatures";
import {
  codeActionFitsProjection,
  codeActionRequestContextFitsProjection,
  codeActionsFitProjection,
} from "../domain/codeActionProjection";
import { toJavaScriptTypeScriptCodeActionContext as toLanguageServerCodeActionContext } from "./javascriptTypescriptCodeActionContext";
import {
  languageServerCodeActionKindMatchesOnly,
  languageServerCodeActionsMatchingOnly,
} from "../domain/languageServerCodeActionKind";
import {
  emptyCodeActionList,
  emptyCodeLensList,
  emptyInlayHintList,
  emptyLinksList,
} from "./emptyMonacoLanguageProviderResults";
import {
  createDocumentHighlightRequestTracker,
  type DocumentHighlightRequestTracker,
} from "../domain/documentHighlightRequestTracker";
import { linkedEditingRangesFitProjection } from "../domain/linkedEditingRangesPolicy";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import type { LatencyOperationKind } from "../domain/latencyTracker";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import {
  WORKSPACE_SYMBOL_REQUEST_TIMEOUT_MS,
  workspaceSymbolQueryFitsProjection,
  workspaceSymbolsFitProjection,
} from "../domain/workspaceSymbolProjection";
import {
  modelMatchesWorkspacePath,
  modelPath,
  registerWorkspaceIdentityDescriptor,
  toWorkspaceMonacoUri,
  type WorkspaceIdentityDescriptor,
} from "./phpMonacoDocumentContext";
import type { UserSnippet } from "../domain/snippets";
import type { EditorDocument } from "../domain/workspace";
import type { LargeSmartDocumentPolicy } from "../domain/largeDocumentPolicy";
import {
  CODE_ACTION_REQUEST_TIMEOUT_MS,
  CODE_ACTION_RESOLVE_REQUEST_TIMEOUT_MS,
  LINKED_EDITING_RANGE_REQUEST_TIMEOUT_MS,
  toMonacoSemanticTokens,
} from "./languageServerRequestCancellation";
import { provideJavaScriptTypeScriptDocumentHighlights } from "./javascriptTypescriptProviders/documentHighlight";
import {
  provideJavaScriptTypeScriptDocumentFormattingEdits,
  toJavaScriptTypeScriptFormattingOptions as toLanguageServerFormattingOptions,
  type JavaScriptTypeScriptFormattingDependencies,
} from "./javascriptTypescriptProviders/formatting";
import {
  type JavaScriptTypeScriptNavigationFeature,
  type JavaScriptTypeScriptPreparedNavigationTarget,
} from "./javascriptTypescriptMonacoProviderRegistration";
import {
  toJavaScriptTypeScriptMonacoLocations as toMonacoLocations,
  toJavaScriptTypeScriptShowReferencesArguments as toShowReferencesArguments,
} from "./javascriptTypescriptMonacoNavigationLocations";
import {
  flattenJavaScriptTypeScriptSelectionRange as flattenSelectionRange,
  toJavaScriptTypeScriptMonacoLinkedEditingRanges as toMonacoLinkedEditingRanges,
} from "./javascriptTypescriptMonacoSelectionMappings";
import { mergeAliasedWorkspaceEditDocumentChanges } from "../domain/workspaceEditDocuments";
import type {
  WorkspaceEditApplicationContext,
  WorkspaceEditApplicationDecision,
} from "../application/workspaceEditApplication";
import {
  codeActionAuthorityMatches,
  createCodeActionAuthority,
  type CodeActionAuthority,
  type LanguageServerBackedCodeAction,
  type ProviderRegistrationAuthority,
} from "./javascriptTypescriptCodeActionAuthority";
import {
  applyJavaScriptTypeScriptWorkspaceEditWithOpenModels,
  type AppliedJavaScriptTypeScriptWorkspaceEditCommit,
} from "./javascriptTypescriptWorkspaceEditApplication";
import {
  attachStoredJavaScriptTypeScriptExecutablePayloadAuthority,
  canContinueStoredJavaScriptTypeScriptDocumentAuthority,
  isJavaScriptTypeScriptDocumentRequestAuthority,
  isJavaScriptTypeScriptDocumentRequestAuthorityActive,
  isJavaScriptTypeScriptProviderRequestAuthorityActive,
  isLargeJavaScriptTypeScriptProviderDocument,
  isStoredJavaScriptTypeScriptDocumentAuthorityActive,
  refreshStoredJavaScriptTypeScriptDocumentAuthority,
  type JavaScriptTypeScriptDocumentRequestAuthority,
  type JavaScriptTypeScriptProviderRequestAuthority,
  type StoredJavaScriptTypeScriptDocumentAuthority,
} from "./javascriptTypescriptProviderDocumentAuthority";
import {
  createJavaScriptTypeScriptMonacoEventEmitter,
  isJavaScriptTypeScriptMonacoLanguage,
  type JavaScriptTypeScriptMonacoEventEmitter,
} from "./javascriptTypescriptMonacoProviderRegistration";
import {
  javaScriptTypeScriptOnTypeFormattingTriggerCharacters,
  javaScriptTypeScriptSemanticTokensLegend,
} from "./javascriptTypescriptRuntimeCapabilityProjection";
import {
  consumeJavaScriptTypeScriptWorkspaceEditCommitReceipt,
  isJavaScriptTypeScriptWorkspaceEditCommitReceiptActive,
  type JavaScriptTypeScriptWorkspaceEditCommitReceipt,
} from "./javascriptTypescriptWorkspaceEditContinuation";
import {
  javaScriptTypeScriptFileOperationIsInWorkspaceRoot as isFileOperationInWorkspaceRoot,
  javaScriptTypeScriptPathIsInWorkspaceRoot as isPathInWorkspaceRoot,
  javaScriptTypeScriptWorkspaceEditForRoot as workspaceEditForRoot,
  javaScriptTypeScriptWorkspaceEditIsFullyInRoot as workspaceEditIsFullyInRoot,
  javaScriptTypeScriptWorkspaceEditVersionId as workspaceEditVersionId,
} from "./javascriptTypescriptWorkspaceEditScope";
import {
  provideJavaScriptTypeScriptCompletionItems,
  resolveJavaScriptTypeScriptCompletionItem,
  toMonacoLanguageServerCommand,
} from "./javascriptTypescriptProviders/completion";
import {
  toLanguageServerRange,
  toMonacoRange,
  toMonacoTextEdit,
} from "./javascriptTypescriptProviders/sharedMappings";
import { provideJavaScriptTypeScriptHover } from "./javascriptTypescriptProviders/hover";
import {
  javaScriptTypeScriptProviderRequestDidNotComplete as featureRequestDidNotComplete,
  runBoundedJavaScriptTypeScriptProviderRequest as runBoundedProviderRequest,
  type JavaScriptTypeScriptProviderRequestCancellationPort,
  type JavaScriptTypeScriptProviderRequestBoundary,
} from "./javascriptTypescriptProviders/requestBoundary";
import {
  provideJavaScriptTypeScriptDeclaration,
  provideJavaScriptTypeScriptDefinition,
  provideJavaScriptTypeScriptImplementation,
  provideJavaScriptTypeScriptReferences,
  provideJavaScriptTypeScriptTypeDefinition,
} from "./javascriptTypescriptProviders/navigation";
import {
  provideJavaScriptTypeScriptRenameEdits,
  resolveJavaScriptTypeScriptRenameLocation,
  type JavaScriptTypeScriptRenameDependencies,
} from "./javascriptTypescriptProviders/rename";
import {
  toMonacoDocumentSymbol,
  toMonacoWorkspaceSymbol,
  type JavaScriptTypeScriptMonacoWorkspaceSymbol,
} from "./javascriptTypescriptProviders/symbols";
import { toJavaScriptTypeScriptMonacoCodeAction } from "./javascriptTypescriptProviders/actions";
import { withJavaScriptTypeScriptAtomicWorkspaceEditAuthority } from "./javascriptTypescriptProviders/workspaceEditAtomicAuthority";
import {
  createJavaScriptTypeScriptExecuteCommandHandler,
  type JavaScriptTypeScriptExecuteCommandPayload,
} from "./javascriptTypescriptProviders/commandExecution";
import {
  activateJavaScriptTypeScriptProviderRegistration,
  deactivateJavaScriptTypeScriptProviderRegistration,
  disposeJavaScriptTypeScriptProviderDisposables,
  registerJavaScriptTypeScriptMonacoProvidersTransactionally,
  rollbackJavaScriptTypeScriptProviderRegistrationActivation,
} from "./javascriptTypescriptProviders/registrationLifecycle";

type MonacoApi = typeof Monaco;
type MonacoModel = Monaco.editor.ITextModel;
type MonacoPosition = Monaco.Position;
type Disposable = Monaco.IDisposable;
type MonacoEventEmitter<T> = JavaScriptTypeScriptMonacoEventEmitter<T>;
type WorkspaceEditContext = {
  path: string | null;
  versionId: number | undefined;
};
type StoredLanguageServerPayloadRequest = StoredJavaScriptTypeScriptDocumentAuthority & {
  __codeActionAuthority?: CodeActionAuthority;
  __languageServerSessionId?: number;
  __sourcePath?: string;
  __workspaceRoot?: string;
  path?: string;
  rootPath?: string;
  sessionId?: number;
};
type MonacoWorkspaceSymbol = JavaScriptTypeScriptMonacoWorkspaceSymbol;

export type JavaScriptTypeScriptWorkspaceEditApplicationContext = WorkspaceEditApplicationContext;

export type JavaScriptTypeScriptWorkspaceEditApplier = (
  edit: LanguageServerWorkspaceEdit,
  context: JavaScriptTypeScriptWorkspaceEditApplicationContext,
) => Promise<WorkspaceEditApplicationDecision | void> | WorkspaceEditApplicationDecision | void;

interface LanguageServerBackedCodeLens extends Monaco.languages.CodeLens {
  __languageServerCodeLens?: LanguageServerCodeLens;
  __languageServerSessionId?: number;
  __sourcePath?: string;
  __workspaceRoot?: string;
}

interface LanguageServerBackedLink extends Monaco.languages.ILink {
  __languageServerLink?: LanguageServerDocumentLink;
  __languageServerSessionId?: number;
  __sourcePath?: string;
  __workspaceRoot?: string;
}

interface LanguageServerBackedInlayHint extends Monaco.languages.InlayHint {
  __languageServerInlayHint?: LanguageServerInlayHint;
  __languageServerSessionId?: number;
  __sourcePath?: string;
  __workspaceRoot?: string;
}

type ExecuteCommandPayload = JavaScriptTypeScriptExecuteCommandPayload;

const EXECUTE_LANGUAGE_SERVER_COMMAND_ID =
  "mockor.javascriptTypeScript.executeLanguageServerCommand";
function attachStoredProviderPayloadAuthority<T extends object>(
  payload: T,
  authority:
    JavaScriptTypeScriptDocumentRequestAuthority | StoredJavaScriptTypeScriptDocumentAuthority,
): T {
  return attachStoredJavaScriptTypeScriptExecutablePayloadAuthority(
    payload,
    authority,
    EXECUTE_LANGUAGE_SERVER_COMMAND_ID,
  );
}

export interface JavaScriptTypeScriptLanguageServerProviderContext {
  applyWorkspaceEdit?: JavaScriptTypeScriptWorkspaceEditApplier;
  cancelRequest?: JavaScriptTypeScriptProviderRequestCancellationPort;
  completeFunctionCalls?: boolean;
  featuresGateway: JavaScriptTypeScriptLanguageServerFeaturesGateway;
  flushPendingDocumentChange(path: string): Promise<void>;
  getActiveJavaScriptTypeScriptOwnerEpoch(): number;
  getActiveJavaScriptTypeScriptOwnerIdentity(): object | null;
  getActiveDocument(): EditorDocument | null;
  getActiveModel?(): MonacoModel | null;
  getDocumentSyncVersion(rootPath: string, path: string): number | null;
  getLargeSmartDocumentPolicy(): LargeSmartDocumentPolicy;
  getProviderRegistrationLease?(): ProviderRegistrationAuthority;
  getRuntimeStatus(): LanguageServerRuntimeStatus | null;
  /**
   * Returns the GLOBAL (app-level) user-authored live templates merged with the
   * built-in JS/TS snippet registry at completion time. Omitted when the host
   * wires no user snippets; the provider then offers built-ins only.
   */
  getUserSnippets?(): readonly UserSnippet[];
  getWorkspaceRoot?(): string | null;
  getWorkspaceIdentityDescriptor?(): WorkspaceIdentityDescriptor | null;
  prepareNavigationModels?(
    locations: readonly LanguageServerLocation[],
    isCurrent: () => boolean,
    feature: JavaScriptTypeScriptNavigationFeature,
  ): Promise<readonly JavaScriptTypeScriptPreparedNavigationTarget[]>;
  recordLatency?(feature: LatencyOperationKind, durationMs: number, rootPath: string): void;
  refreshGateway?: LanguageServerRefreshGateway;
  reportError(error: unknown): void;
  workspaceEditGateway?: LanguageServerWorkspaceEditGateway;
}

const providerRequestBoundary: JavaScriptTypeScriptProviderRequestBoundary<JavaScriptTypeScriptLanguageServerProviderContext> =
  {
    attachStoredAuthority: attachStoredProviderPayloadAuthority,
    createFeatureRequest: featureRequestContext,
    flushActiveRequest: flushPendingDocumentChangeForActiveRoot,
    flushStoredPayload: flushPendingDocumentChangeForStoredPayload,
    isActiveRequest: (context, request) => isFeatureRequestActive(context, request),
    isStoredPayloadActive: (context, payload) => isStoredDocumentPayloadActive(context, payload),
    isStoredSessionActive: isStoredLanguageServerPayloadActive,
    reportActiveRequestError: reportErrorForActiveRequest,
    reportStoredPayloadError: reportErrorForStoredPayload,
  };

const renameDependencies: JavaScriptTypeScriptRenameDependencies<JavaScriptTypeScriptLanguageServerProviderContext> =
  {
    applyWorkspaceEdit: (monaco, context, edit, rootPath, isStillActive) =>
      applyWorkspaceEditWithOpenModels(monaco, context, edit, rootPath, isStillActive),
    editIsFullyInRoot: workspaceEditIsFullyInRoot,
    toWorkspaceEdit: (monaco, model, edit, rootPath) =>
      toMonacoWorkspaceEdit(monaco, workspaceEditContext(model), edit, rootPath),
  };

const formattingDependencies = (monaco: MonacoApi): JavaScriptTypeScriptFormattingDependencies => ({
  createRequest: (context, model) => documentRequestContext(context, model, "formatting"),
  flush: flushPendingDocumentChangeForActiveRoot,
  isActive: isFeatureRequestActive,
  reportError: reportErrorForActiveRequest,
  toFormattingOptions: toLanguageServerFormattingOptions,
  toMonacoTextEdit: (edit) => toMonacoTextEdit(monaco, edit),
});

export function registerJavaScriptTypeScriptLanguageServerMonacoProviders(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
): Disposable {
  const disposables: Disposable[] = [];
  const registrationAuthority: ProviderRegistrationAuthority = { active: true };
  let registrationDisposed = false;
  const previousRegistrationAuthority = activateJavaScriptTypeScriptProviderRegistration(
    monaco,
    registrationAuthority,
  );
  const registeredContext = new Proxy(context, {
    get(target, property, receiver) {
      if (property === "getProviderRegistrationLease") {
        return () => registrationAuthority;
      }
      if (property === "cancelRequest") {
        const identifiedRequests = target.featuresGateway.identifiedRequests;
        return (
          Reflect.get(target, property, receiver) ??
          (identifiedRequests
            ? (rootPath: string, sessionId: number, requestId: number) =>
                identifiedRequests.cancelRequest(rootPath, sessionId, requestId)
            : undefined)
        );
      }
      return Reflect.get(target, property, receiver);
    },
  });
  try {
    const identityDescriptor = context.getWorkspaceIdentityDescriptor?.();
    if (identityDescriptor) {
      disposables.push({
        dispose: registerWorkspaceIdentityDescriptor(
          identityDescriptor,
          context.getWorkspaceRoot?.() ?? identityDescriptor.canonicalRoot,
        ),
      });
    }
    const documentHighlightTracker =
      createDocumentHighlightRequestTracker<Monaco.languages.DocumentHighlight>();
    let workspaceSymbolRequestGeneration = 0;
    const codeLensRefreshEmitter = createJavaScriptTypeScriptMonacoEventEmitter<void>();
    const inlayHintRefreshEmitter = createJavaScriptTypeScriptMonacoEventEmitter<void>();
    const semanticTokensRefreshEmitter = createJavaScriptTypeScriptMonacoEventEmitter<void>();
    disposables.push({
      dispose: () => {
        codeLensRefreshEmitter.dispose();
        inlayHintRefreshEmitter.dispose();
        semanticTokensRefreshEmitter.dispose();
      },
    });
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
      disposables.push(refreshSubscriptionDisposable);
      context.refreshGateway
        .subscribeRefreshEvents((event) => {
          handleLanguageServerRefreshEvent(
            registeredContext,
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
        .catch((error) => {
          if (registrationAuthority.active) {
            context.reportError(error);
          }
        });
    }

    if (context.workspaceEditGateway) {
      disposables.push(workspaceEditSubscriptionDisposable);
      context.workspaceEditGateway
        .subscribeWorkspaceEdits((event) => {
          void applyWorkspaceEditEvent(monaco, registeredContext, event).catch((error) => {
            if (event.rootPath) {
              reportErrorForActiveWorkspaceEditEvent(registeredContext, event, error);
              return;
            }

            context.reportError(error);
          });
        })
        .then((unsubscribe) => {
          if (workspaceEditSubscriptionDisposed) {
            unsubscribe();
            return;
          }

          workspaceEditUnsubscribe = unsubscribe;
        })
        .catch((error) => {
          if (registrationAuthority.active) {
            context.reportError(error);
          }
        });
    }

    const executeCommand = createJavaScriptTypeScriptExecuteCommandHandler(registeredContext, {
      applyWorkspaceEdit: (edit, rootPath, isStillActive, onApplied) =>
        applyWorkspaceEditWithOpenModels(
          monaco,
          registeredContext,
          edit,
          rootPath,
          isStillActive,
          onApplied,
        ),
      consumeWorkspaceEditContinuation: (payload, rootPath, sessionId, authority, receipt) =>
        consumeExecutableWorkspaceEditContinuation(
          registeredContext,
          payload,
          rootPath,
          sessionId,
          authority,
          receipt,
        ),
      flushStoredPayload: (payload) =>
        flushPendingDocumentChangeForStoredPayload(registeredContext, payload),
      isCodeActionAuthorityActive: (authority, requireVersion) =>
        isCodeActionAuthorityActive(registeredContext, authority, requireVersion),
      isExecutableWorkspaceEditContinuationActive: (
        payload,
        rootPath,
        sessionId,
        authority,
        receipt,
      ) =>
        isExecutableWorkspaceEditContinuationActive(
          registeredContext,
          payload,
          rootPath,
          sessionId,
          authority,
          receipt,
        ),
      isPayloadActive: (payload, authority, requireVersion) =>
        isExecutableCommandPayloadActive(registeredContext, payload, authority, requireVersion),
      refreshPayloadAuthority: (payload, rootPath, sessionId) =>
        refreshExecutableCommandPayloadAuthority(registeredContext, payload, rootPath, sessionId),
      reportError: (payload, error) =>
        reportErrorForStoredPayload(registeredContext, payload, error),
    });
    const commandDisposable = monaco.editor.addCommand({
      id: EXECUTE_LANGUAGE_SERVER_COMMAND_ID,
      run: async (_accessor, payload: ExecuteCommandPayload | undefined) => executeCommand(payload),
    });
    disposables.push(commandDisposable);

    disposables.push(
      ...registerJavaScriptTypeScriptMonacoProvidersTransactionally(monaco, {
        codeAction: {
          provideCodeActions: (model, range, actionContext, token) =>
            provideCodeActions(
              monaco,
              registeredContext,
              registrationAuthority,
              model,
              range,
              actionContext,
              token,
            ),
          resolveCodeAction: (action, token) =>
            resolveCodeAction(monaco, registeredContext, action, token),
        },
        codeLens: {
          onDidChange:
            codeLensRefreshEmitter.event as unknown as Monaco.languages.CodeLensProvider["onDidChange"],
          provideCodeLenses: (model) => provideCodeLenses(monaco, registeredContext, model),
          resolveCodeLens: (_model, codeLens) =>
            resolveCodeLens(monaco, registeredContext, codeLens),
        },
        completion: {
          triggerCharacters: [".", "'", '"', "`", "/", "@", "<", "#"],
          provideCompletionItems: (model, position, completionContext, token) =>
            provideJavaScriptTypeScriptCompletionItems(
              monaco,
              registeredContext,
              providerRequestBoundary,
              model,
              position,
              completionContext,
              token,
            ),
          resolveCompletionItem: (item, token) =>
            resolveJavaScriptTypeScriptCompletionItem(
              monaco,
              registeredContext,
              providerRequestBoundary,
              item,
              token,
            ),
        },
        declaration: {
          provideDeclaration: (model, position, token) =>
            provideJavaScriptTypeScriptDeclaration(
              monaco,
              registeredContext,
              providerRequestBoundary,
              model,
              position,
              token,
            ),
        },
        definition: {
          provideDefinition: (model, position, token) =>
            provideJavaScriptTypeScriptDefinition(
              monaco,
              registeredContext,
              providerRequestBoundary,
              model,
              position,
              token,
            ),
        },
        documentFormatting: {
          provideDocumentFormattingEdits: (model, options, token) =>
            provideJavaScriptTypeScriptDocumentFormattingEdits(
              registeredContext,
              model,
              options,
              token,
              formattingDependencies(monaco),
            ),
        },
        documentHighlight: {
          provideDocumentHighlights: (model, position, token) =>
            provideDocumentHighlights(
              monaco,
              registeredContext,
              documentHighlightTracker,
              model,
              position,
              token,
            ),
        },
        documentRangeFormatting: {
          provideDocumentRangeFormattingEdits: (model, range, options) =>
            provideDocumentRangeFormattingEdits(monaco, registeredContext, model, range, options),
        },
        documentRangeSemanticTokens: {
          getLegend: () =>
            javaScriptTypeScriptSemanticTokensLegend(
              registeredContext.getRuntimeStatus(),
              registeredContext.getWorkspaceRoot?.() ?? null,
            ),
          provideDocumentRangeSemanticTokens: (model, range, token) =>
            provideDocumentRangeSemanticTokens(registeredContext, model, range, token),
        },
        documentSemanticTokens: {
          onDidChange: semanticTokensRefreshEmitter.event,
          getLegend: () =>
            javaScriptTypeScriptSemanticTokensLegend(
              registeredContext.getRuntimeStatus(),
              registeredContext.getWorkspaceRoot?.() ?? null,
            ),
          provideDocumentSemanticTokens: (model, _lastResultId, token) =>
            provideDocumentSemanticTokens(registeredContext, model, token),
          releaseDocumentSemanticTokens: () => undefined,
        },
        documentSymbol: {
          provideDocumentSymbols: (model) =>
            provideDocumentSymbols(monaco, registeredContext, model),
        },
        foldingRange: {
          provideFoldingRanges: (model) => provideFoldingRanges(monaco, registeredContext, model),
        },
        hover: {
          provideHover: (model, position, token) =>
            provideJavaScriptTypeScriptHover(
              registeredContext,
              providerRequestBoundary,
              model,
              position,
              token,
            ),
        },
        implementation: {
          provideImplementation: (model, position, token) =>
            provideJavaScriptTypeScriptImplementation(
              monaco,
              registeredContext,
              providerRequestBoundary,
              model,
              position,
              token,
            ),
        },
        inlayHints: {
          onDidChangeInlayHints: inlayHintRefreshEmitter.event,
          provideInlayHints: (model, range) =>
            provideInlayHints(monaco, registeredContext, model, range),
          resolveInlayHint: (hint) => resolveInlayHint(monaco, registeredContext, hint),
        },
        linkedEditingRange: {
          provideLinkedEditingRanges: (model, position, token) =>
            provideLinkedEditingRanges(monaco, registeredContext, model, position, token),
        },
        links: {
          provideLinks: (model) => provideDocumentLinks(monaco, registeredContext, model),
          resolveLink: (link) => resolveDocumentLink(monaco, registeredContext, link),
        },
        onTypeFormatting: {
          autoFormatTriggerCharacters: javaScriptTypeScriptOnTypeFormattingTriggerCharacters(
            registeredContext.getRuntimeStatus(),
            registeredContext.getWorkspaceRoot?.() ?? null,
          ),
          provideOnTypeFormattingEdits: (model, position, ch, options) =>
            provideOnTypeFormattingEdits(monaco, registeredContext, model, position, ch, options),
        },
        references: {
          provideReferences: (model, position, _referenceContext, token) =>
            provideJavaScriptTypeScriptReferences(
              monaco,
              registeredContext,
              providerRequestBoundary,
              model,
              position,
              token,
            ),
        },
        rename: {
          resolveRenameLocation: (model, position, token) =>
            resolveJavaScriptTypeScriptRenameLocation(
              monaco,
              registeredContext,
              providerRequestBoundary,
              model,
              position,
              token,
            ),
          provideRenameEdits: (model, position, newName, token) =>
            provideJavaScriptTypeScriptRenameEdits(
              monaco,
              registeredContext,
              providerRequestBoundary,
              renameDependencies,
              model,
              position,
              newName,
              token,
            ),
        },
        selectionRange: {
          provideSelectionRanges: (model, positions) =>
            provideSelectionRanges(monaco, registeredContext, model, positions),
        },
        signatureHelp: {
          signatureHelpRetriggerCharacters: [",", ")"],
          signatureHelpTriggerCharacters: ["(", ",", "<"],
          provideSignatureHelp: (model, position, token, signatureContext) =>
            provideSignatureHelp(
              monaco,
              registeredContext,
              model,
              position,
              token,
              signatureContext,
            ),
        },
        typeDefinition: {
          provideTypeDefinition: (model, position, token) =>
            provideJavaScriptTypeScriptTypeDefinition(
              monaco,
              registeredContext,
              providerRequestBoundary,
              model,
              position,
              token,
            ),
        },
        workspaceSymbols: {
          provideWorkspaceSymbols: (query, token) => {
            const generation = ++workspaceSymbolRequestGeneration;
            return provideWorkspaceSymbols(
              monaco,
              registeredContext,
              query,
              token,
              () => generation === workspaceSymbolRequestGeneration,
            );
          },
        },
      }),
    );

    return {
      dispose: () => {
        if (registrationDisposed) {
          return;
        }
        registrationDisposed = true;
        deactivateJavaScriptTypeScriptProviderRegistration(monaco, registrationAuthority);
        disposeJavaScriptTypeScriptProviderDisposables(disposables, context.reportError);
      },
    };
  } catch (error) {
    registrationDisposed = true;
    rollbackJavaScriptTypeScriptProviderRegistrationActivation(
      monaco,
      registrationAuthority,
      previousRegistrationAuthority,
    );
    disposeJavaScriptTypeScriptProviderDisposables(disposables, context.reportError);
    throw error;
  }
}

async function provideSignatureHelp(
  _monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
  token?: Monaco.CancellationToken,
  signatureContext?: Monaco.languages.SignatureHelpContext,
): Promise<Monaco.languages.SignatureHelpResult | null> {
  const request = featureRequestContext(context, model, position, "signatureHelp");

  if (!request) {
    return null;
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRoot(context, request))) {
      return null;
    }

    const languageServerSignatureContext = toLanguageServerSignatureHelpContext(signatureContext);
    const signatureHelp = await runBoundedProviderRequest(
      languageServerSignatureContext
        ? context.featuresGateway.signatureHelp(
            request.rootPath,
            request.position,
            languageServerSignatureContext,
            request.sessionId,
          )
        : context.featuresGateway.signatureHelp(
            request.rootPath,
            request.position,
            undefined,
            request.sessionId,
          ),
      request.sessionId,
      token,
      request.rootPath,
      undefined,
      context.cancelRequest,
    );

    if (featureRequestDidNotComplete(signatureHelp)) {
      return null;
    }

    if (token?.isCancellationRequested) {
      return null;
    }

    if (!isFeatureRequestActive(context, request)) {
      return null;
    }

    return signatureHelp ? toMonacoSignatureHelp(signatureHelp) : null;
  } catch (error) {
    if (token?.isCancellationRequested) {
      return null;
    }
    reportErrorForActiveRequest(context, request, error);
    return null;
  }
}

function toLanguageServerSignatureHelpContext(
  context: Monaco.languages.SignatureHelpContext | undefined,
): LanguageServerSignatureHelpContext | undefined {
  if (!context) {
    return undefined;
  }

  return {
    ...(context.activeSignatureHelp
      ? {
          activeSignatureHelp: toLanguageServerSignatureHelp(context.activeSignatureHelp),
        }
      : {}),
    isRetrigger: context.isRetrigger,
    ...(context.triggerCharacter ? { triggerCharacter: context.triggerCharacter } : {}),
    triggerKind: context.triggerKind as LanguageServerSignatureHelpContext["triggerKind"],
  };
}

function toLanguageServerSignatureHelp(
  signatureHelp: Monaco.languages.SignatureHelp,
): LanguageServerSignatureHelp {
  return {
    activeParameter: signatureHelp.activeParameter,
    activeSignature: signatureHelp.activeSignature,
    signatures: signatureHelp.signatures.map(toLanguageServerSignature),
  };
}

function toLanguageServerSignature(
  signature: Monaco.languages.SignatureInformation,
): LanguageServerSignature {
  return {
    documentation: markdownStringValue(signature.documentation),
    label: signature.label,
    parameters: signature.parameters.map((parameter) =>
      toLanguageServerSignatureParameter(signature.label, parameter),
    ),
  };
}

function toLanguageServerSignatureParameter(
  signatureLabel: string,
  parameter: Monaco.languages.ParameterInformation,
): LanguageServerSignatureParameter {
  return {
    documentation: markdownStringValue(parameter.documentation),
    label: signatureParameterLabel(signatureLabel, parameter.label),
  };
}

function signatureParameterLabel(signatureLabel: string, label: string | [number, number]): string {
  if (typeof label === "string") {
    return label;
  }

  const [start, end] = label;
  return signatureLabel.slice(start, end);
}

function markdownStringValue(value: Monaco.IMarkdownString | string | undefined): string | null {
  if (!value) {
    return null;
  }

  return typeof value === "string" ? value : value.value;
}

async function provideDocumentHighlights(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  tracker: DocumentHighlightRequestTracker<Monaco.languages.DocumentHighlight>,
  model: MonacoModel,
  position: MonacoPosition,
  token?: Monaco.CancellationToken,
): Promise<Monaco.languages.DocumentHighlight[] | null> {
  const request = featureRequestContext(context, model, position, "documentHighlight");

  if (!request) {
    return null;
  }
  return provideJavaScriptTypeScriptDocumentHighlights({
    cancelRequest: context.cancelRequest,
    featuresGateway: context.featuresGateway,
    flushPendingDocumentChange: () => flushPendingDocumentChangeForActiveRoot(context, request),
    isRequestActive: () => isFeatureRequestActive(context, request),
    model,
    monaco,
    position,
    reportError: (error) => reportErrorForActiveRequest(context, request, error),
    request,
    token,
    tracker,
  });
}

async function provideDocumentLinks(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  model: MonacoModel,
): Promise<Monaco.languages.ILinksList> {
  const request = documentRequestContext(context, model, "documentLink");

  if (!request) {
    return emptyLinksList();
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRoot(context, request))) {
      return emptyLinksList();
    }

    const links = await context.featuresGateway.documentLinks(request.rootPath, request.path);

    if (!isFeatureRequestActive(context, request)) {
      return emptyLinksList();
    }

    return {
      dispose: () => undefined,
      links: links.map((link) =>
        attachStoredProviderPayloadAuthority(
          toMonacoDocumentLink(monaco, request.rootPath, request.sessionId, request.path, link),
          request,
        ),
      ),
    };
  } catch (error) {
    reportErrorForActiveRequest(context, request, error);
    return emptyLinksList();
  }
}

async function provideDocumentSymbols(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  model: MonacoModel,
): Promise<Monaco.languages.DocumentSymbol[] | null> {
  const request = documentRequestContext(context, model, "documentSymbol");

  if (!request) {
    return null;
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRoot(context, request))) {
      return null;
    }

    const symbols = await context.featuresGateway.documentSymbols(request.rootPath, request.path);

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
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  query: string,
  token: Monaco.CancellationToken | undefined,
  isLatestQuery: () => boolean,
): Promise<MonacoWorkspaceSymbol[]> {
  const request = workspaceSymbolRequestContext(context);

  if (!request || !workspaceSymbolQueryFitsProjection(query)) {
    return [];
  }

  try {
    const symbols = await runBoundedProviderRequest(
      context.featuresGateway.workspaceSymbols(request.rootPath, query, request.sessionId),
      request.sessionId,
      token,
      request.rootPath,
      WORKSPACE_SYMBOL_REQUEST_TIMEOUT_MS,
      context.cancelRequest,
    );

    if (
      featureRequestDidNotComplete(symbols) ||
      token?.isCancellationRequested ||
      !isLatestQuery() ||
      !isFeatureRequestActive(context, request) ||
      !workspaceSymbolsFitProjection(symbols)
    ) {
      return [];
    }

    return symbols.flatMap((symbol) => toMonacoWorkspaceSymbol(monaco, symbol, request.rootPath));
  } catch (error) {
    reportErrorForActiveRequest(context, request, error);
    return [];
  }
}

async function resolveDocumentLink(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  link: Monaco.languages.ILink,
): Promise<Monaco.languages.ILink> {
  const backedLink = link as LanguageServerBackedLink;

  if (
    !backedLink.__languageServerLink ||
    !backedLink.__workspaceRoot ||
    backedLink.__languageServerSessionId == null ||
    !isStoredLanguageServerPayloadActive(
      context,
      backedLink.__workspaceRoot,
      backedLink.__languageServerSessionId,
    )
  ) {
    return link;
  }

  try {
    if (!(await flushPendingDocumentChangeForStoredPayload(context, backedLink))) {
      return link;
    }

    const resolved = await context.featuresGateway.resolveDocumentLink(
      backedLink.__workspaceRoot,
      backedLink.__languageServerLink,
    );

    if (!isStoredDocumentPayloadActive(context, backedLink)) {
      return link;
    }

    return attachStoredProviderPayloadAuthority(
      {
        ...link,
        ...toMonacoDocumentLink(
          monaco,
          backedLink.__workspaceRoot,
          backedLink.__languageServerSessionId,
          backedLink.__sourcePath,
          resolved,
        ),
      },
      backedLink,
    );
  } catch (error) {
    reportErrorForStoredPayload(context, backedLink, error);
    return link;
  }
}

async function provideFoldingRanges(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  model: MonacoModel,
): Promise<Monaco.languages.FoldingRange[] | null> {
  const request = documentRequestContext(context, model, "foldingRange");

  if (!request) {
    return null;
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRoot(context, request))) {
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

async function provideSelectionRanges(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  model: MonacoModel,
  positions: MonacoPosition[],
): Promise<Monaco.languages.SelectionRange[][] | null> {
  const request = documentRequestContext(context, model, "selectionRange");

  if (!request) {
    return null;
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRoot(context, request))) {
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
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  model: MonacoModel,
  token?: Monaco.CancellationToken,
): Promise<Monaco.languages.SemanticTokens | null> {
  const request = documentRequestContext(context, model, "semanticTokens");

  if (!request) {
    return null;
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRoot(context, request))) {
      return null;
    }

    const languageServerRequest = context.featuresGateway.semanticTokens(
      request.rootPath,
      request.path,
      request.sessionId,
    );
    if (languageServerRequest.sessionId !== request.sessionId) {
      return null;
    }
    const tokens = await runBoundedProviderRequest(
      languageServerRequest,
      request.sessionId,
      token,
      request.rootPath,
      undefined,
      context.cancelRequest,
    );
    if (featureRequestDidNotComplete(tokens)) {
      return null;
    }

    if (!isFeatureRequestActive(context, request)) {
      return null;
    }

    return toMonacoSemanticTokens(tokens);
  } catch (error) {
    if (token?.isCancellationRequested) {
      return null;
    }
    reportErrorForActiveRequest(context, request, error);
    return null;
  }
}

async function provideDocumentRangeSemanticTokens(
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  model: MonacoModel,
  range: Monaco.Range,
  token: Monaco.CancellationToken,
): Promise<Monaco.languages.SemanticTokens | null> {
  const request = documentRequestContext(context, model, "semanticTokens");

  if (!request) {
    return null;
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRoot(context, request))) {
      return null;
    }

    const languageServerRequest = context.featuresGateway.rangeSemanticTokens(
      request.rootPath,
      request.path,
      toLanguageServerRange(range),
      request.sessionId,
    );
    if (languageServerRequest.sessionId !== request.sessionId) {
      return null;
    }
    const tokens = await runBoundedProviderRequest(
      languageServerRequest,
      request.sessionId,
      token,
      request.rootPath,
      undefined,
      context.cancelRequest,
    );
    if (featureRequestDidNotComplete(tokens)) {
      return null;
    }

    if (!isFeatureRequestActive(context, request)) {
      return null;
    }

    return toMonacoSemanticTokens(tokens);
  } catch (error) {
    if (token.isCancellationRequested) {
      return null;
    }
    reportErrorForActiveRequest(context, request, error);
    return null;
  }
}

async function provideLinkedEditingRanges(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
  token?: Monaco.CancellationToken,
): Promise<Monaco.languages.LinkedEditingRanges | null> {
  const request = featureRequestContext(context, model, position, "linkedEditingRange");

  if (!request) {
    return null;
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRoot(context, request))) {
      return null;
    }

    const ranges = await runBoundedProviderRequest(
      context.featuresGateway.linkedEditingRanges(
        request.rootPath,
        request.position,
        request.sessionId,
      ),
      request.sessionId,
      token,
      request.rootPath,
      LINKED_EDITING_RANGE_REQUEST_TIMEOUT_MS,
      context.cancelRequest,
    );

    if (
      featureRequestDidNotComplete(ranges) ||
      !linkedEditingRangesFitProjection(ranges) ||
      token?.isCancellationRequested === true ||
      !isFeatureRequestActive(context, request)
    ) {
      return null;
    }

    return toMonacoLinkedEditingRanges(monaco, ranges);
  } catch (error) {
    reportErrorForActiveRequest(context, request, error);
    return null;
  }
}

async function provideCodeActions(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  registration: ProviderRegistrationAuthority,
  model: MonacoModel,
  range: Monaco.Range,
  actionContext: Monaco.languages.CodeActionContext,
  token?: Monaco.CancellationToken,
): Promise<Monaco.languages.CodeActionList> {
  const request = documentRequestContext(context, model, "codeAction");

  if (!request) {
    return emptyCodeActionList();
  }
  const authority = createCodeActionAuthority({
    model,
    path: request.path,
    registration,
    requestedOnly: actionContext.only,
    rootPath: request.rootPath,
    sessionId: request.sessionId,
    workspaceId: context.getWorkspaceIdentityDescriptor?.()?.workspaceId ?? null,
  });

  try {
    if (
      !(await flushPendingDocumentChangeForActiveRoot(context, request)) ||
      !isCodeActionAuthorityActive(context, authority)
    ) {
      return emptyCodeActionList();
    }

    const requestContext = toLanguageServerCodeActionContext(monaco, actionContext);
    if (!requestContext || !codeActionRequestContextFitsProjection(requestContext)) {
      return emptyCodeActionList();
    }
    const actions = await runBoundedProviderRequest(
      context.featuresGateway.codeActions(
        request.rootPath,
        request.path,
        toLanguageServerRange(range),
        requestContext,
        request.sessionId,
      ),
      request.sessionId,
      token,
      request.rootPath,
      CODE_ACTION_REQUEST_TIMEOUT_MS,
      context.cancelRequest,
    );

    if (
      featureRequestDidNotComplete(actions) ||
      !codeActionsFitProjection(actions) ||
      token?.isCancellationRequested === true ||
      !isFeatureRequestActive(context, request) ||
      !isCodeActionAuthorityActive(context, authority)
    ) {
      return emptyCodeActionList();
    }

    return {
      actions: languageServerCodeActionsMatchingOnly(actions, actionContext.only).flatMap(
        (action) =>
          toMonacoCodeAction(
            monaco,
            Boolean(context.applyWorkspaceEdit),
            authority,
            action,
            actionContext,
          ).map((mapped) => attachStoredProviderPayloadAuthority(mapped, request)),
      ),
      dispose: () => undefined,
    };
  } catch (error) {
    if (!token?.isCancellationRequested) {
      reportErrorForActiveRequest(context, request, error);
    }
    return emptyCodeActionList();
  }
}

async function resolveCodeAction(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  action: Monaco.languages.CodeAction,
  token?: Monaco.CancellationToken,
): Promise<Monaco.languages.CodeAction> {
  const backedAction = action as LanguageServerBackedCodeAction;
  const authority = backedAction.__codeActionAuthority;

  if (
    !authority ||
    !backedAction.__languageServerAction ||
    !codeActionFitsProjection(backedAction.__languageServerAction) ||
    !isCodeActionAuthorityActive(context, authority)
  ) {
    return action;
  }

  try {
    if (!(await flushPendingDocumentChangeForStoredPayload(context, backedAction))) {
      return action;
    }

    const resolved = await runBoundedProviderRequest(
      context.featuresGateway.resolveCodeAction(
        authority.rootPath,
        backedAction.__languageServerAction,
        authority.sessionId,
      ),
      authority.sessionId,
      token,
      authority.rootPath,
      CODE_ACTION_RESOLVE_REQUEST_TIMEOUT_MS,
      context.cancelRequest,
    );

    if (
      featureRequestDidNotComplete(resolved) ||
      !codeActionFitsProjection(resolved) ||
      token?.isCancellationRequested === true ||
      !isCodeActionAuthorityActive(context, authority) ||
      !isStoredDocumentPayloadActive(context, backedAction)
    ) {
      return action;
    }

    if (
      !languageServerCodeActionKindMatchesOnly(resolved.kind, authority.requestedOnly ?? undefined)
    ) {
      return action;
    }

    const [mapped] = toMonacoCodeAction(
      monaco,
      Boolean(context.applyWorkspaceEdit),
      authority,
      resolved,
      {
        markers: action.diagnostics ?? [],
        only: action.kind ?? undefined,
        trigger: monaco.languages.CodeActionTriggerType.Invoke,
      },
    );

    return mapped
      ? attachStoredProviderPayloadAuthority({ ...action, ...mapped }, backedAction)
      : action;
  } catch (error) {
    if (!token?.isCancellationRequested) {
      reportErrorForStoredPayload(context, backedAction, error);
    }
    return action;
  }
}

async function provideCodeLenses(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  model: MonacoModel,
): Promise<Monaco.languages.CodeLensList> {
  const request = documentRequestContext(context, model, "codeLens");

  if (!request) {
    return emptyCodeLensList();
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRoot(context, request))) {
      return emptyCodeLensList();
    }

    const lenses = await context.featuresGateway.codeLenses(request.rootPath, request.path);

    if (!isFeatureRequestActive(context, request)) {
      return emptyCodeLensList();
    }

    return {
      lenses: lenses.map((lens) =>
        attachStoredProviderPayloadAuthority(
          toMonacoCodeLens(monaco, request.rootPath, request.sessionId, request.path, lens),
          request,
        ),
      ),
      dispose: () => undefined,
    };
  } catch (error) {
    reportErrorForActiveRequest(context, request, error);
    return emptyCodeLensList();
  }
}

async function resolveCodeLens(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  codeLens: Monaco.languages.CodeLens,
): Promise<Monaco.languages.CodeLens> {
  const backedCodeLens = codeLens as LanguageServerBackedCodeLens;

  if (
    !backedCodeLens.__languageServerCodeLens ||
    !backedCodeLens.__workspaceRoot ||
    backedCodeLens.__languageServerSessionId == null ||
    !isStoredLanguageServerPayloadActive(
      context,
      backedCodeLens.__workspaceRoot,
      backedCodeLens.__languageServerSessionId,
    )
  ) {
    return codeLens;
  }

  try {
    if (!(await flushPendingDocumentChangeForStoredPayload(context, backedCodeLens))) {
      return codeLens;
    }

    const resolved = await context.featuresGateway.resolveCodeLens(
      backedCodeLens.__workspaceRoot,
      backedCodeLens.__languageServerCodeLens,
    );

    if (!isStoredDocumentPayloadActive(context, backedCodeLens)) {
      return codeLens;
    }

    return attachStoredProviderPayloadAuthority(
      {
        ...codeLens,
        ...toMonacoCodeLens(
          monaco,
          backedCodeLens.__workspaceRoot,
          backedCodeLens.__languageServerSessionId,
          backedCodeLens.__sourcePath,
          resolved,
        ),
      },
      backedCodeLens,
    );
  } catch (error) {
    reportErrorForStoredPayload(context, backedCodeLens, error);
    return codeLens;
  }
}

async function provideDocumentRangeFormattingEdits(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  model: MonacoModel,
  range: Monaco.Range,
  options: Monaco.languages.FormattingOptions,
): Promise<Monaco.languages.TextEdit[]> {
  const request = documentRequestContext(context, model, "rangeFormatting");

  if (!request) {
    return [];
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRoot(context, request))) {
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
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
  ch: string,
  options: Monaco.languages.FormattingOptions,
): Promise<Monaco.languages.TextEdit[]> {
  const request = documentRequestContext(context, model, "onTypeFormatting");

  if (!request) {
    return [];
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRoot(context, request))) {
      return [];
    }

    const edits = await context.featuresGateway.onTypeFormatting(
      request.rootPath,
      request.path,
      {
        character: Math.max(0, position.column - 1),
        line: Math.max(0, position.lineNumber - 1),
      },
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

async function provideInlayHints(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  model: MonacoModel,
  range: Monaco.Range,
): Promise<Monaco.languages.InlayHintList> {
  const request = documentRequestContext(context, model, "inlayHint");

  if (!request) {
    return emptyInlayHintList();
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRoot(context, request))) {
      return emptyInlayHintList();
    }

    const hints = await context.featuresGateway.inlayHints(
      request.rootPath,
      request.path,
      toLanguageServerRange(range),
    );

    if (!isFeatureRequestActive(context, request)) {
      return emptyInlayHintList();
    }

    return {
      hints: hints.map((hint) =>
        attachStoredProviderPayloadAuthority(
          toMonacoInlayHint(monaco, hint, request.rootPath, request.sessionId, request.path),
          request,
        ),
      ),
      dispose: () => undefined,
    };
  } catch (error) {
    reportErrorForActiveRequest(context, request, error);
    return emptyInlayHintList();
  }
}

async function resolveInlayHint(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  hint: Monaco.languages.InlayHint,
): Promise<Monaco.languages.InlayHint> {
  const backedHint = hint as LanguageServerBackedInlayHint;

  if (
    !backedHint.__languageServerInlayHint ||
    !backedHint.__workspaceRoot ||
    backedHint.__languageServerSessionId == null ||
    !isStoredLanguageServerPayloadActive(
      context,
      backedHint.__workspaceRoot,
      backedHint.__languageServerSessionId,
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
    if (!(await flushPendingDocumentChangeForStoredPayload(context, backedHint))) {
      return hint;
    }

    const resolvedHint = await context.featuresGateway.resolveInlayHint(
      backedHint.__workspaceRoot,
      backedHint.__languageServerInlayHint,
    );

    if (!isStoredDocumentPayloadActive(context, backedHint)) {
      return hint;
    }

    return attachStoredProviderPayloadAuthority(
      toMonacoInlayHint(
        monaco,
        resolvedHint,
        backedHint.__workspaceRoot,
        backedHint.__languageServerSessionId,
        backedHint.__sourcePath,
      ),
      backedHint,
    );
  } catch (error) {
    reportErrorForStoredPayload(context, backedHint, error);
    return hint;
  }
}

function featureRequestContext(
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
  feature:
    | "completion"
    | "declaration"
    | "definition"
    | "documentHighlight"
    | "hover"
    | "implementation"
    | "linkedEditingRange"
    | "prepareRename"
    | "references"
    | "rename"
    | "signatureHelp"
    | "typeDefinition",
) {
  const activeDocument = context.getActiveDocument();
  const ownerEpoch = context.getActiveJavaScriptTypeScriptOwnerEpoch();
  const registrationLease = context.getProviderRegistrationLease?.();
  const rootPath = context.getWorkspaceRoot?.() ?? null;

  if (
    !rootPath ||
    !activeDocument ||
    !Number.isSafeInteger(ownerEpoch) ||
    ownerEpoch < 0 ||
    registrationLease?.active !== true ||
    !isJavaScriptTypeScriptDocument(activeDocument) ||
    !modelMatchesWorkspacePath(model, rootPath, activeDocument.path)
  ) {
    return null;
  }

  if (
    isLargeJavaScriptTypeScriptProviderDocument(
      model,
      activeDocument,
      context.getLargeSmartDocumentPolicy(),
    )
  ) {
    return null;
  }

  if (!canUseRuntimeFeatureForRoot(context, rootPath, feature)) {
    return null;
  }
  const sessionId = runningRuntimeSessionIdForRoot(context, rootPath);

  if (sessionId == null) {
    return null;
  }

  return {
    model,
    modelVersion: model.getVersionId(),
    ownerEpoch,
    path: activeDocument.path,
    position: toLanguageServerTextDocumentPosition(activeDocument.path, {
      column: position.column,
      lineNumber: position.lineNumber,
    }),
    registrationLease,
    rootPath,
    sessionId,
  };
}

function documentRequestContext(
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  model: MonacoModel,
  feature:
    | "codeLens"
    | "codeAction"
    | "documentLink"
    | "documentSymbol"
    | "foldingRange"
    | "formatting"
    | "inlayHint"
    | "onTypeFormatting"
    | "rangeFormatting"
    | "selectionRange"
    | "semanticTokens",
) {
  const activeDocument = context.getActiveDocument();
  const ownerEpoch = context.getActiveJavaScriptTypeScriptOwnerEpoch();
  const registrationLease = context.getProviderRegistrationLease?.();
  const rootPath = context.getWorkspaceRoot?.() ?? null;

  if (
    !rootPath ||
    !activeDocument ||
    !Number.isSafeInteger(ownerEpoch) ||
    ownerEpoch < 0 ||
    registrationLease?.active !== true ||
    !isJavaScriptTypeScriptDocument(activeDocument) ||
    !modelMatchesWorkspacePath(model, rootPath, activeDocument.path)
  ) {
    return null;
  }

  if (
    isLargeJavaScriptTypeScriptProviderDocument(
      model,
      activeDocument,
      context.getLargeSmartDocumentPolicy(),
    )
  ) {
    return null;
  }

  if (!canUseRuntimeFeatureForRoot(context, rootPath, feature)) {
    return null;
  }
  const sessionId = runningRuntimeSessionIdForRoot(context, rootPath);

  if (sessionId == null) {
    return null;
  }

  return {
    model,
    modelVersion: model.getVersionId(),
    ownerEpoch,
    path: activeDocument.path,
    registrationLease,
    rootPath,
    sessionId,
  };
}

function workspaceSymbolRequestContext(context: JavaScriptTypeScriptLanguageServerProviderContext) {
  const ownerEpoch = context.getActiveJavaScriptTypeScriptOwnerEpoch();
  const registrationLease = context.getProviderRegistrationLease?.();
  const rootPath = context.getWorkspaceRoot?.() ?? null;

  if (
    !rootPath ||
    !Number.isSafeInteger(ownerEpoch) ||
    ownerEpoch < 0 ||
    registrationLease?.active !== true
  ) {
    return null;
  }

  if (!canUseRuntimeFeatureForRoot(context, rootPath, "workspaceSymbol")) {
    return null;
  }
  const sessionId = runningRuntimeSessionIdForRoot(context, rootPath);

  if (sessionId == null) {
    return null;
  }

  return { ownerEpoch, registrationLease, rootPath, sessionId };
}

async function flushPendingDocumentChangeForActiveRoot(
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  request: JavaScriptTypeScriptDocumentRequestAuthority,
): Promise<boolean> {
  await context.flushPendingDocumentChange(request.path);

  if (!isFeatureRequestActive(context, request, false)) {
    return false;
  }

  const syncVersion = context.getDocumentSyncVersion(request.rootPath, request.path);

  if (syncVersion === null) {
    return false;
  }

  request.syncVersion = syncVersion;
  return isFeatureRequestActive(context, request);
}

async function flushPendingDocumentChangeForStoredPayload(
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  payload: StoredLanguageServerPayloadRequest,
): Promise<boolean> {
  const authority = payload.__codeActionAuthority;
  const path = authority?.path ?? payload.path ?? payload.__sourcePath;
  const rootPath = authority?.rootPath ?? payload.rootPath ?? payload.__workspaceRoot;
  const sessionId = authority?.sessionId ?? payload.sessionId ?? payload.__languageServerSessionId;

  if (!path || !rootPath || sessionId == null) {
    return false;
  }

  if (!isStoredDocumentAuthorityActive(context, payload, path, rootPath, sessionId)) {
    return false;
  }

  await context.flushPendingDocumentChange(path);

  return (
    (authority
      ? isCodeActionAuthorityActive(context, authority)
      : isStoredLanguageServerPayloadActive(context, rootPath, sessionId)) &&
    isStoredDocumentAuthorityActive(context, payload, path, rootPath, sessionId)
  );
}

function isStoredDocumentAuthorityActive(
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  payload: StoredLanguageServerPayloadRequest,
  path: string,
  rootPath: string,
  sessionId: number,
): boolean {
  return isStoredJavaScriptTypeScriptDocumentAuthorityActive(context, payload, {
    path,
    rootAndSessionActive: isStoredLanguageServerPayloadActive(context, rootPath, sessionId),
    rootPath,
  });
}

function isStoredDocumentPayloadActive(
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  payload: StoredLanguageServerPayloadRequest,
): boolean {
  const authority = payload.__codeActionAuthority;
  const path = authority?.path ?? payload.path ?? payload.__sourcePath;
  const rootPath = authority?.rootPath ?? payload.rootPath ?? payload.__workspaceRoot;
  const sessionId = authority?.sessionId ?? payload.sessionId ?? payload.__languageServerSessionId;
  return Boolean(
    path &&
    rootPath &&
    sessionId != null &&
    isStoredDocumentAuthorityActive(context, payload, path, rootPath, sessionId),
  );
}

function isExecutableCommandPayloadActive(
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  payload: StoredLanguageServerPayloadRequest,
  codeActionAuthority: CodeActionAuthority | undefined,
  requireVersion = true,
): boolean {
  return (
    isStoredDocumentPayloadActive(context, payload) &&
    (!codeActionAuthority ||
      isCodeActionAuthorityActive(context, codeActionAuthority, requireVersion))
  );
}

function refreshExecutableCommandPayloadAuthority(
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  payload: StoredLanguageServerPayloadRequest,
  rootPath: string,
  sessionId: number,
): boolean {
  const path = payload.__codeActionAuthority?.path ?? payload.path ?? payload.__sourcePath;
  return Boolean(
    path &&
    refreshStoredJavaScriptTypeScriptDocumentAuthority(context, payload, {
      path,
      rootAndSessionActive: isStoredLanguageServerPayloadActive(context, rootPath, sessionId),
      rootPath,
    }),
  );
}

function isExecutableWorkspaceEditContinuationActive(
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  payload: StoredLanguageServerPayloadRequest,
  rootPath: string,
  sessionId: number,
  codeActionAuthority: CodeActionAuthority | undefined,
  receipt: JavaScriptTypeScriptWorkspaceEditCommitReceipt,
): boolean {
  return isJavaScriptTypeScriptWorkspaceEditCommitReceiptActive(
    receipt,
    context.getActiveJavaScriptTypeScriptOwnerEpoch(),
    context.getActiveJavaScriptTypeScriptOwnerIdentity(),
    () =>
      canContinueStoredJavaScriptTypeScriptDocumentAuthority(context, payload, {
        path: receipt.path,
        rootAndSessionActive: isStoredLanguageServerPayloadActive(context, rootPath, sessionId),
        rootPath,
      }) &&
      (!codeActionAuthority || isCodeActionAuthorityActive(context, codeActionAuthority, false)),
  );
}

function consumeExecutableWorkspaceEditContinuation(
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  payload: StoredLanguageServerPayloadRequest,
  rootPath: string,
  sessionId: number,
  codeActionAuthority: CodeActionAuthority | undefined,
  receipt: JavaScriptTypeScriptWorkspaceEditCommitReceipt,
): boolean {
  return consumeJavaScriptTypeScriptWorkspaceEditCommitReceipt(
    receipt,
    context.getActiveJavaScriptTypeScriptOwnerEpoch(),
    context.getActiveJavaScriptTypeScriptOwnerIdentity(),
    () =>
      canContinueStoredJavaScriptTypeScriptDocumentAuthority(context, payload, {
        path: receipt.path,
        rootAndSessionActive: isStoredLanguageServerPayloadActive(context, rootPath, sessionId),
        rootPath,
      }) &&
      (!codeActionAuthority || isCodeActionAuthorityActive(context, codeActionAuthority, false)),
  );
}

function isFeatureRequestActive(
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  request:
    | { rootPath: string; sessionId?: number }
    | (JavaScriptTypeScriptProviderRequestAuthority & {
        rootPath: string;
        sessionId?: number;
      })
    | JavaScriptTypeScriptDocumentRequestAuthority,
  requireSyncAuthority = true,
): boolean {
  const rootAndSessionActive =
    request.sessionId == null
      ? isStoredWorkspaceRootActive(context, request.rootPath)
      : isStoredLanguageServerPayloadActive(context, request.rootPath, request.sessionId);

  if (
    !rootAndSessionActive ||
    ("registrationLease" in request &&
      !isJavaScriptTypeScriptProviderRequestAuthorityActive(context, request))
  ) {
    return false;
  }

  if (!isJavaScriptTypeScriptDocumentRequestAuthority(request)) {
    return rootAndSessionActive;
  }

  return isJavaScriptTypeScriptDocumentRequestAuthorityActive(
    context,
    request,
    rootAndSessionActive,
    requireSyncAuthority,
  );
}

function canUseRuntimeFeatureForRoot(
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  rootPath: string,
  feature: LanguageServerFeature,
): boolean {
  const status = runningRuntimeStatusForRoot(context, rootPath);

  return Boolean(status && canUseLanguageServerFeature(status.capabilities, feature));
}

function runningRuntimeSessionIdForRoot(
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  rootPath: string,
): number | null {
  return runningRuntimeStatusForRoot(context, rootPath)?.sessionId ?? null;
}

function runningRuntimeStatusForRoot(
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  rootPath: string,
): Extract<LanguageServerRuntimeStatus, { kind: "running" }> | null {
  const status = context.getRuntimeStatus();

  if (
    status?.kind !== "running" ||
    !status.rootPath ||
    !workspaceRootKeysEqual(status.rootPath, rootPath)
  ) {
    return null;
  }

  return status;
}

function isStoredWorkspaceRootActive(
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  rootPath: string,
): boolean {
  const activeRootPath = context.getWorkspaceRoot?.() ?? null;

  return Boolean(activeRootPath && workspaceRootKeysEqual(activeRootPath, rootPath));
}

function isStoredLanguageServerPayloadActive(
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  rootPath: string,
  sessionId: number,
): boolean {
  if (!isStoredWorkspaceRootActive(context, rootPath)) {
    return false;
  }

  return runningRuntimeSessionIdForRoot(context, rootPath) === sessionId;
}

function isCodeActionAuthorityActive(
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  authority: CodeActionAuthority,
  requireVersion = true,
): boolean {
  const activeDocument = context.getActiveDocument();
  return codeActionAuthorityMatches(
    authority,
    {
      activeDocumentPath:
        activeDocument && isJavaScriptTypeScriptDocument(activeDocument)
          ? activeDocument.path
          : null,
      activeModel: context.getActiveModel?.(),
      modelMatchesPath: modelMatchesWorkspacePath(
        authority.model,
        authority.rootPath,
        authority.path,
      ),
      rootAndSessionActive: isStoredLanguageServerPayloadActive(
        context,
        authority.rootPath,
        authority.sessionId,
      ),
      workspaceId: context.getWorkspaceIdentityDescriptor?.()?.workspaceId ?? null,
    },
    requireVersion,
  );
}

function reportErrorForActiveRequest(
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  request: { rootPath: string; sessionId?: number },
  error: unknown,
): void {
  if (!isFeatureRequestActive(context, request)) {
    return;
  }

  context.reportError(error);
}

function reportErrorForStoredPayload(
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  payload: StoredLanguageServerPayloadRequest,
  error: unknown,
): void {
  const authority = payload.__codeActionAuthority;
  const rootPath = authority?.rootPath ?? payload.rootPath ?? payload.__workspaceRoot;
  const sessionId = authority?.sessionId ?? payload.sessionId ?? payload.__languageServerSessionId;

  if (
    !rootPath ||
    sessionId == null ||
    !isStoredDocumentPayloadActive(context, payload) ||
    (authority && !isCodeActionAuthorityActive(context, authority))
  ) {
    return;
  }

  context.reportError(error);
}

function reportErrorForActiveWorkspaceEditEvent(
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  event: LanguageServerWorkspaceEditEvent,
  error: unknown,
): void {
  if (!isWorkspaceEditEventActive(context, event)) {
    return;
  }

  context.reportError(error);
}

function toMonacoFoldingRange(
  monaco: MonacoApi,
  range: LanguageServerFoldingRange,
): Monaco.languages.FoldingRange {
  return {
    end: range.endLine + 1,
    kind: range.kind ? monaco.languages.FoldingRangeKind.fromValue(range.kind) : undefined,
    start: range.startLine + 1,
  };
}

function toMonacoDocumentLink(
  monaco: MonacoApi,
  rootPath: string,
  sessionId: number,
  sourcePath: string | undefined,
  link: LanguageServerDocumentLink,
): LanguageServerBackedLink {
  return {
    __languageServerLink: link,
    __languageServerSessionId: sessionId,
    __sourcePath: sourcePath,
    __workspaceRoot: rootPath,
    range: toMonacoRange(monaco, link.range),
    ...(link.target ? { url: link.target } : {}),
    ...(link.tooltip ? { tooltip: link.tooltip } : {}),
  };
}

function toMonacoCodeLens(
  monaco: MonacoApi,
  rootPath: string,
  sessionId: number,
  sourcePath: string | undefined,
  lens: LanguageServerCodeLens,
): LanguageServerBackedCodeLens {
  return {
    __languageServerCodeLens: lens,
    __languageServerSessionId: sessionId,
    __sourcePath: sourcePath,
    __workspaceRoot: rootPath,
    ...(lens.command
      ? {
          command: toMonacoCodeLensCommand(monaco, rootPath, sessionId, sourcePath, lens.command),
        }
      : {}),
    range: toMonacoRange(monaco, lens.range),
  };
}

function toMonacoCodeLensCommand(
  monaco: MonacoApi,
  rootPath: string,
  sessionId: number,
  sourcePath: string | undefined,
  command: LanguageServerCodeActionCommand,
): Monaco.languages.Command {
  if (command.command === "editor.action.showReferences") {
    return {
      arguments: toShowReferencesArguments(monaco, command.arguments ?? [], rootPath),
      id: command.command,
      title: command.title,
    };
  }

  return {
    arguments: [
      {
        command,
        ...(sourcePath ? { path: sourcePath } : {}),
        rootPath,
        sessionId,
      } satisfies ExecuteCommandPayload,
    ],
    id: EXECUTE_LANGUAGE_SERVER_COMMAND_ID,
    title: command.title || command.command,
  };
}

function toMonacoWorkspaceEdit(
  monaco: MonacoApi,
  context: WorkspaceEditContext,
  edit: LanguageServerWorkspaceEdit,
  rootPath: string,
): Monaco.languages.WorkspaceEdit {
  const canonicalEdit = mergeAliasedWorkspaceEditDocumentChanges(edit);
  const fileEdits = (canonicalEdit.fileOperations ?? []).flatMap((operation) =>
    toMonacoWorkspaceFileEdit(monaco, operation, rootPath),
  );
  const textEdits = Object.entries(canonicalEdit.changes).flatMap(([uri, edits]) => {
    const path = pathFromLanguageServerUri(uri);

    if (!path) {
      return [];
    }

    if (!isPathInWorkspaceRoot(rootPath, path)) {
      return [];
    }

    const resource = toWorkspaceMonacoUri(monaco, rootPath, path);

    if (!resource) {
      return [];
    }
    const editVersionId = workspaceEditVersionId(canonicalEdit, uri);
    const versionId =
      typeof editVersionId === "number"
        ? editVersionId
        : context.path === path
          ? context.versionId
          : undefined;

    return edits.map((textEdit) => ({
      resource,
      textEdit: toMonacoTextEdit(monaco, textEdit),
      versionId,
    }));
  });

  return {
    edits: [...fileEdits, ...textEdits],
  };
}

function toMonacoWorkspaceFileEdit(
  monaco: MonacoApi,
  operation: LanguageServerWorkspaceFileOperation,
  rootPath: string,
): Monaco.languages.IWorkspaceFileEdit[] {
  if (!isFileOperationInWorkspaceRoot(operation, rootPath)) {
    return [];
  }

  if (operation.kind === "create") {
    const path = pathFromLanguageServerUri(operation.uri);
    const options = toMonacoWorkspaceFileEditOptions(operation.options);
    const resource = path ? toWorkspaceMonacoUri(monaco, rootPath, path) : null;

    return resource
      ? [
          {
            newResource: resource,
            ...(options ? { options } : {}),
          },
        ]
      : [];
  }

  if (operation.kind === "rename") {
    const oldPath = pathFromLanguageServerUri(operation.oldUri);
    const newPath = pathFromLanguageServerUri(operation.newUri);
    const options = toMonacoWorkspaceFileEditOptions(operation.options);
    const oldResource = oldPath ? toWorkspaceMonacoUri(monaco, rootPath, oldPath) : null;
    const newResource = newPath ? toWorkspaceMonacoUri(monaco, rootPath, newPath) : null;

    return oldResource && newResource
      ? [
          {
            newResource,
            oldResource,
            ...(options ? { options } : {}),
          },
        ]
      : [];
  }

  const path = pathFromLanguageServerUri(operation.uri);
  const options = toMonacoWorkspaceFileEditOptions(operation.options);
  const resource = path ? toWorkspaceMonacoUri(monaco, rootPath, path) : null;

  return resource
    ? [
        {
          oldResource: resource,
          ...(options ? { options } : {}),
        },
      ]
    : [];
}

function toMonacoWorkspaceFileEditOptions(
  options: LanguageServerWorkspaceFileOperationOptions | null | undefined,
): Monaco.languages.WorkspaceFileEditOptions | undefined {
  if (!options) {
    return undefined;
  }

  const monacoOptions: Monaco.languages.WorkspaceFileEditOptions = {};

  if (typeof options.ignoreIfExists === "boolean") {
    monacoOptions.ignoreIfExists = options.ignoreIfExists;
  }

  if (typeof options.ignoreIfNotExists === "boolean") {
    monacoOptions.ignoreIfNotExists = options.ignoreIfNotExists;
  }

  if (typeof options.overwrite === "boolean") {
    monacoOptions.overwrite = options.overwrite;
  }

  if (typeof options.recursive === "boolean") {
    monacoOptions.recursive = options.recursive;
  }

  return Object.keys(monacoOptions).length > 0 ? monacoOptions : undefined;
}

function toMonacoCodeAction(
  monaco: MonacoApi,
  appliesEditThroughWorkspaceApplier: boolean,
  authority: CodeActionAuthority,
  action: LanguageServerCodeAction,
  context: Monaco.languages.CodeActionContext,
): Monaco.languages.CodeAction[] {
  return toJavaScriptTypeScriptMonacoCodeAction(
    monaco,
    EXECUTE_LANGUAGE_SERVER_COMMAND_ID,
    appliesEditThroughWorkspaceApplier,
    authority,
    action,
    context,
    toMonacoWorkspaceEdit,
  );
}

function toMonacoSignatureHelp(
  signatureHelp: LanguageServerSignatureHelp,
): Monaco.languages.SignatureHelpResult {
  return {
    dispose: () => undefined,
    value: {
      activeParameter: signatureHelp.activeParameter,
      activeSignature: signatureHelp.activeSignature,
      signatures: signatureHelp.signatures.map(toMonacoSignatureInformation),
    },
  };
}

function toMonacoSignatureInformation(
  signature: LanguageServerSignature,
): Monaco.languages.SignatureInformation {
  return {
    documentation: signature.documentation || undefined,
    label: signature.label,
    parameters: signature.parameters.map(toMonacoParameterInformation),
  };
}

function toMonacoParameterInformation(
  parameter: LanguageServerSignatureParameter,
): Monaco.languages.ParameterInformation {
  return {
    documentation: parameter.documentation || undefined,
    label: parameter.label,
  };
}

function toMonacoInlayHint(
  monaco: MonacoApi,
  hint: LanguageServerInlayHint,
  rootPath: string,
  sessionId: number,
  sourcePath?: string,
): Monaco.languages.InlayHint {
  const monacoHint: Monaco.languages.InlayHint = {
    kind: monacoInlayHintKindFromLspKind(monaco, hint.kind),
    label: toMonacoInlayHintLabel(monaco, hint.label, rootPath, sessionId, sourcePath),
    paddingLeft: hint.paddingLeft,
    paddingRight: hint.paddingRight,
    position: {
      column: hint.position.character + 1,
      lineNumber: hint.position.line + 1,
    },
    ...(hint.textEdits?.length
      ? {
          textEdits: hint.textEdits.map((edit) => toMonacoTextEdit(monaco, edit)),
        }
      : {}),
    tooltip: hint.tooltip || undefined,
  };

  Object.defineProperties(monacoHint, {
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
  label: LanguageServerInlayHint["label"],
  rootPath: string,
  sessionId: number,
  sourcePath?: string,
): Monaco.languages.InlayHint["label"] {
  if (typeof label === "string") {
    return label;
  }

  return label.map((part) => {
    const [location] = part.location ? toMonacoLocations(monaco, [part.location], rootPath) : [];

    return {
      label: part.label,
      ...(part.command
        ? {
            command: toMonacoLanguageServerCommand(rootPath, sessionId, sourcePath, part.command),
          }
        : {}),
      ...(location ? { location } : {}),
      ...(part.tooltip ? { tooltip: part.tooltip } : {}),
    };
  });
}

function monacoInlayHintKindFromLspKind(
  monaco: MonacoApi,
  kind: number | null,
): Monaco.languages.InlayHintKind {
  if (kind === 1) {
    return monaco.languages.InlayHintKind.Type;
  }

  if (kind === 2) {
    return monaco.languages.InlayHintKind.Parameter;
  }

  return monaco.languages.InlayHintKind.Type;
}

function workspaceEditContext(model: MonacoModel): WorkspaceEditContext {
  return {
    path: modelPath(model),
    versionId: typeof model.getVersionId === "function" ? model.getVersionId() : undefined,
  };
}

async function applyWorkspaceEditWithOpenModels(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  edit: LanguageServerWorkspaceEdit,
  rootPath: string,
  isStillActive: () => boolean = () => true,
  onApplied?: (commit: AppliedJavaScriptTypeScriptWorkspaceEditCommit) => void,
): Promise<boolean> {
  const scopedEdit = workspaceEditForRoot(edit, rootPath);
  const atomicWorkspaceEditApplier = withJavaScriptTypeScriptAtomicWorkspaceEditAuthority(
    context.applyWorkspaceEdit,
    isStillActive,
  );
  return applyJavaScriptTypeScriptWorkspaceEditWithOpenModels(
    monaco,
    scopedEdit,
    rootPath,
    atomicWorkspaceEditApplier,
    isStillActive,
    onApplied,
  );
}

async function applyWorkspaceEditEvent(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  event: LanguageServerWorkspaceEditEvent,
): Promise<void> {
  if (!isWorkspaceEditEventActive(context, event)) {
    return;
  }

  const stillActiveAfterFlush = await flushPendingDocumentChangesForWorkspaceEditEvent(
    monaco,
    context,
    event,
  );

  if (!stillActiveAfterFlush) {
    return;
  }

  await applyWorkspaceEditWithOpenModels(monaco, context, event.edit, event.rootPath, () =>
    isWorkspaceEditEventActive(context, event),
  );
}

async function flushPendingDocumentChangesForWorkspaceEditEvent(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  event: LanguageServerWorkspaceEditEvent,
): Promise<boolean> {
  const scopedEdit = workspaceEditForRoot(event.edit, event.rootPath);
  const editedOpenPaths = openModelPathsForWorkspaceEdit(monaco, scopedEdit, event.rootPath);

  await Promise.all(editedOpenPaths.map((path) => context.flushPendingDocumentChange(path)));

  return isWorkspaceEditEventActive(context, event);
}

function isWorkspaceEditEventActive(
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  event: LanguageServerWorkspaceEditEvent,
): boolean {
  if (context.getProviderRegistrationLease?.()?.active !== true) {
    return false;
  }
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

function handleLanguageServerRefreshEvent(
  context: JavaScriptTypeScriptLanguageServerProviderContext,
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
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  event: LanguageServerRefreshEvent,
): boolean {
  if (context.getProviderRegistrationLease?.()?.active !== true) {
    return false;
  }
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

function openModelPathsForWorkspaceEdit(
  monaco: MonacoApi,
  edit: LanguageServerWorkspaceEdit,
  rootPath: string,
): string[] {
  const editPaths = new Set(
    Object.keys(edit.changes).flatMap((uri) => {
      const path = pathFromLanguageServerUri(uri);

      return path ? [path] : [];
    }),
  );

  return monaco.editor.getModels().flatMap((model) => {
    const path = modelPath(model);

    return path && editPaths.has(path) && modelMatchesWorkspacePath(model, rootPath, path)
      ? [path]
      : [];
  });
}

function isJavaScriptTypeScriptDocument(document: EditorDocument): boolean {
  return isJavaScriptTypeScriptMonacoLanguage(document.language);
}
