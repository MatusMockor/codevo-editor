import type * as Monaco from "monaco-editor";
import {
  canUseLanguageServerFeature,
  pathFromLanguageServerUri,
  toLanguageServerTextDocumentPosition,
  type LanguageServerCodeAction,
  type LanguageServerCodeActionCommand,
  type LanguageServerCodeActionContext,
  type LanguageServerCodeLens,
  type LanguageServerCompletionContext,
  type LanguageServerCompletionItem,
  type LanguageServerCompletionTextEdit,
  type LanguageServerDocumentHighlight,
  type LanguageServerDocumentLink,
  type LanguageServerDocumentSymbol,
  type LanguageServerFeaturesGateway,
  type LanguageServerFeature,
  type LanguageServerFoldingRange,
  type LanguageServerFormattingOptions,
  type LanguageServerInlayHint,
  type LanguageServerLinkedEditingRanges,
  type LanguageServerLocation,
  type LanguageServerRange,
  type LanguageServerRefreshEvent,
  type LanguageServerRefreshGateway,
  type LanguageServerSelectionRange,
  type LanguageServerSemanticTokens,
  type LanguageServerSignature,
  type LanguageServerSignatureHelp,
  type LanguageServerSignatureHelpContext,
  type LanguageServerSignatureParameter,
  type LanguageServerTextEdit,
  type LanguageServerWorkspaceEdit,
  type LanguageServerWorkspaceFileOperation,
  type LanguageServerWorkspaceFileOperationOptions,
  type LanguageServerWorkspaceSymbol,
  type LanguageServerWorkspaceEditEvent,
  type LanguageServerWorkspaceEditGateway,
} from "../domain/languageServerFeatures";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { EditorDocument } from "../domain/workspace";

type MonacoApi = typeof Monaco;
type MonacoModel = Monaco.editor.ITextModel;
type MonacoPosition = Monaco.Position;
type Disposable = Monaco.IDisposable;
type MonacoEvent<T> = (
  listener: (event: T) => unknown,
  thisArgs?: unknown,
  disposables?: Disposable[],
) => Disposable;
type MonacoEventEmitter<T> = {
  dispose(): void;
  event: MonacoEvent<T>;
  fire(event: T): void;
};
type WorkspaceEditContext = {
  path: string;
  versionId: number | undefined;
};
type StoredLanguageServerPayloadRequest = {
  __languageServerSessionId?: number;
  __sourcePath?: string;
  __workspaceRoot?: string;
  path?: string;
  rootPath?: string;
  sessionId?: number;
};
type MonacoWorkspaceSymbol = {
  containerName?: string;
  kind: Monaco.languages.SymbolKind;
  location: Monaco.languages.Location;
  name: string;
};
type MonacoWorkspaceSymbolProvider = {
  provideWorkspaceSymbols(query: string): Promise<MonacoWorkspaceSymbol[]>;
};
type MonacoWorkspaceSymbolRegistry = {
  registerWorkspaceSymbolProvider?(
    provider: MonacoWorkspaceSymbolProvider,
  ): Disposable;
};

export interface JavaScriptTypeScriptWorkspaceEditApplicationContext {
  editedOpenPaths: string[];
  rootPath?: string;
}

export type JavaScriptTypeScriptWorkspaceEditApplier = (
  edit: LanguageServerWorkspaceEdit,
  context: JavaScriptTypeScriptWorkspaceEditApplicationContext,
) => Promise<void> | void;

interface LanguageServerBackedCodeAction extends Monaco.languages.CodeAction {
  __languageServerAction?: LanguageServerCodeAction;
  __languageServerSessionId?: number;
  __sourcePath?: string;
  __workspaceEditContext?: WorkspaceEditContext;
  __workspaceRoot?: string;
}

interface LanguageServerBackedCodeLens extends Monaco.languages.CodeLens {
  __languageServerCodeLens?: LanguageServerCodeLens;
  __languageServerSessionId?: number;
  __sourcePath?: string;
  __workspaceRoot?: string;
}

interface LanguageServerBackedCompletionItem
  extends Monaco.languages.CompletionItem {
  __completionRange?: Monaco.IRange | Monaco.languages.CompletionItemRanges;
  __languageServerItem?: LanguageServerCompletionItem;
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

interface ExecuteCommandPayload {
  command?: LanguageServerCodeActionCommand | null;
  edit?: LanguageServerWorkspaceEdit | null;
  path?: string;
  rootPath: string;
  sessionId: number;
}

const JAVASCRIPT_TYPESCRIPT_LANGUAGE_IDS = [
  "javascript",
  "typescript",
  "javascriptreact",
  "typescriptreact",
];
const JAVASCRIPT_TYPESCRIPT_LANGUAGE_ID_SET = new Set<string>(
  JAVASCRIPT_TYPESCRIPT_LANGUAGE_IDS,
);
const EXECUTE_LANGUAGE_SERVER_COMMAND_ID =
  "mockor.javascriptTypeScript.executeLanguageServerCommand";
const JAVASCRIPT_TYPESCRIPT_SEMANTIC_TOKENS_LEGEND = {
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

export interface JavaScriptTypeScriptLanguageServerProviderContext {
  applyWorkspaceEdit?: JavaScriptTypeScriptWorkspaceEditApplier;
  featuresGateway: LanguageServerFeaturesGateway;
  flushPendingDocumentChange(path: string): Promise<void>;
  getActiveDocument(): EditorDocument | null;
  getRuntimeStatus(): LanguageServerRuntimeStatus | null;
  getWorkspaceRoot?(): string | null;
  refreshGateway?: LanguageServerRefreshGateway;
  reportError(error: unknown): void;
  workspaceEditGateway?: LanguageServerWorkspaceEditGateway;
}

function createMonacoEventEmitter<T>(): MonacoEventEmitter<T> {
  const listeners = new Set<{
    listener: (event: T) => unknown;
    thisArgs?: unknown;
  }>();

  return {
    dispose: () => {
      listeners.clear();
    },
    event: (listener, thisArgs, disposables) => {
      const entry = { listener, thisArgs };
      listeners.add(entry);
      const disposable = {
        dispose: () => {
          listeners.delete(entry);
        },
      };

      disposables?.push(disposable);

      return disposable;
    },
    fire: (event) => {
      for (const entry of Array.from(listeners)) {
        entry.listener.call(entry.thisArgs, event);
      }
    },
  };
}

export function registerJavaScriptTypeScriptLanguageServerMonacoProviders(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
): Disposable {
  const languages = JAVASCRIPT_TYPESCRIPT_LANGUAGE_IDS;
  const registry = monaco.languages as Partial<typeof monaco.languages>;
  const disposables: Disposable[] = [];
  const codeLensRefreshEmitter = createMonacoEventEmitter<void>();
  const inlayHintRefreshEmitter = createMonacoEventEmitter<void>();
  const semanticTokensRefreshEmitter = createMonacoEventEmitter<void>();
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
    disposables.push(workspaceEditSubscriptionDisposable);
    context.workspaceEditGateway
      .subscribeWorkspaceEdits((event) => {
        void applyWorkspaceEditEvent(monaco, context, event).catch((error) => {
          if (event.rootPath) {
            reportErrorForActiveRoot(context, event.rootPath, error);
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
      .catch((error) => context.reportError(error));
  }

  const commandDisposable = monaco.editor.addCommand({
    id: EXECUTE_LANGUAGE_SERVER_COMMAND_ID,
    run: async (_accessor, payload: ExecuteCommandPayload | undefined) => {
      if (!payload) {
        return;
      }

      if (
        !isStoredLanguageServerPayloadActive(
          context,
          payload.rootPath,
          payload.sessionId,
        )
      ) {
        return;
      }

      try {
        if (
          !(await flushPendingDocumentChangeForStoredPayload(context, payload))
        ) {
          return;
        }

        if (payload.edit) {
          await applyWorkspaceEditAfterMonacoEdit(
            monaco,
            context,
            payload.edit,
            payload.rootPath,
          );
        }

        if (
          !isStoredLanguageServerPayloadActive(
            context,
            payload.rootPath,
            payload.sessionId,
          )
        ) {
          return;
        }

        if (!payload.command) {
          return;
        }

        const edit = await context.featuresGateway.executeCommand(
          payload.rootPath,
          payload.command,
        );

        if (
          !isStoredLanguageServerPayloadActive(
            context,
            payload.rootPath,
            payload.sessionId,
          )
        ) {
          return;
        }

        if (edit) {
          await applyWorkspaceEditWithOpenModels(
            monaco,
            context,
            edit,
            payload.rootPath,
          );
        }
      } catch (error) {
        reportErrorForActiveRoot(context, payload.rootPath, error);
      }
    },
  });
  disposables.push(commandDisposable);

  const workspaceSymbolRegistry = registry as MonacoWorkspaceSymbolRegistry;

  if (workspaceSymbolRegistry.registerWorkspaceSymbolProvider) {
    disposables.push(
      workspaceSymbolRegistry.registerWorkspaceSymbolProvider({
        provideWorkspaceSymbols: (query) =>
          provideWorkspaceSymbols(monaco, context, query),
      }),
    );
  }

  languages.forEach((language) => {
    if (registry.registerHoverProvider) {
      disposables.push(
        registry.registerHoverProvider(language, {
          provideHover: (model, position) =>
            provideHover(monaco, context, model, position),
        }),
      );
    }

    if (registry.registerCompletionItemProvider) {
      disposables.push(
        registry.registerCompletionItemProvider(language, {
          triggerCharacters: [".", "'", "\"", "`", "/", "@", "<", "#"],
          provideCompletionItems: (model, position, completionContext) =>
            provideCompletionItems(
              monaco,
              context,
              model,
              position,
              completionContext,
            ),
          resolveCompletionItem: (item) =>
            resolveCompletionItem(monaco, context, item),
        }),
      );
    }

    if (registry.registerSignatureHelpProvider) {
      disposables.push(
        registry.registerSignatureHelpProvider(language, {
          signatureHelpRetriggerCharacters: [",", ")"],
          signatureHelpTriggerCharacters: ["(", ",", "<"],
          provideSignatureHelp: (model, position, _token, signatureContext) =>
            provideSignatureHelp(
              monaco,
              context,
              model,
              position,
              signatureContext,
            ),
        }),
      );
    }

    if (registry.registerDefinitionProvider) {
      disposables.push(
        registry.registerDefinitionProvider(language, {
          provideDefinition: (model, position) =>
            provideDefinition(monaco, context, model, position),
        }),
      );
    }

    if (registry.registerDeclarationProvider) {
      disposables.push(
        registry.registerDeclarationProvider(language, {
          provideDeclaration: (model, position) =>
            provideDeclaration(monaco, context, model, position),
        }),
      );
    }

    if (registry.registerImplementationProvider) {
      disposables.push(
        registry.registerImplementationProvider(language, {
          provideImplementation: (model, position) =>
            provideImplementation(monaco, context, model, position),
        }),
      );
    }

    if (registry.registerTypeDefinitionProvider) {
      disposables.push(
        registry.registerTypeDefinitionProvider(language, {
          provideTypeDefinition: (model, position) =>
            provideTypeDefinition(monaco, context, model, position),
        }),
      );
    }

    if (registry.registerReferenceProvider) {
      disposables.push(
        registry.registerReferenceProvider(language, {
          provideReferences: (model, position) =>
            provideReferences(monaco, context, model, position),
        }),
      );
    }

    if (registry.registerRenameProvider) {
      disposables.push(
        registry.registerRenameProvider(language, {
          resolveRenameLocation: (model, position) =>
            resolveRenameLocation(monaco, context, model, position),
          provideRenameEdits: (model, position, newName) =>
            provideRenameEdits(monaco, context, model, position, newName),
        }),
      );
    }

    if (registry.registerCodeActionProvider) {
      disposables.push(
        registry.registerCodeActionProvider(
          language,
          {
            provideCodeActions: (model, range, actionContext) =>
              provideCodeActions(monaco, context, model, range, actionContext),
            resolveCodeAction: (action) =>
              resolveCodeAction(monaco, context, action),
          },
          {
            providedCodeActionKinds: [
              "quickfix",
              "refactor",
              "refactor.move",
              "source",
              "source.fixAll",
              "source.fixAll.ts",
              "source.addMissingImports.ts",
              "source.organizeImports",
              "source.organizeImports.ts",
              "source.removeUnused.ts",
              "source.removeUnusedImports.ts",
              "source.sortImports.ts",
            ],
          },
        ),
      );
    }

    if (registry.registerCodeLensProvider) {
      disposables.push(
        registry.registerCodeLensProvider(language, {
          onDidChange:
            codeLensRefreshEmitter.event as unknown as Monaco.languages.CodeLensProvider["onDidChange"],
          provideCodeLenses: (model) => provideCodeLenses(monaco, context, model),
          resolveCodeLens: (_model, codeLens) =>
            resolveCodeLens(monaco, context, codeLens),
        }),
      );
    }

    if (registry.registerDocumentFormattingEditProvider) {
      disposables.push(
        registry.registerDocumentFormattingEditProvider(language, {
          provideDocumentFormattingEdits: (model, options) =>
            provideDocumentFormattingEdits(monaco, context, model, options),
        }),
      );
    }

    if (registry.registerDocumentRangeFormattingEditProvider) {
      disposables.push(
        registry.registerDocumentRangeFormattingEditProvider(language, {
          provideDocumentRangeFormattingEdits: (model, range, options) =>
            provideDocumentRangeFormattingEdits(
              monaco,
              context,
              model,
              range,
              options,
            ),
        }),
      );
    }

    if (registry.registerOnTypeFormattingEditProvider) {
      disposables.push(
        registry.registerOnTypeFormattingEditProvider(language, {
          autoFormatTriggerCharacters: ["}", ";", "\n"],
          provideOnTypeFormattingEdits: (model, position, ch, options) =>
            provideOnTypeFormattingEdits(
              monaco,
              context,
              model,
              position,
              ch,
              options,
            ),
        }),
      );
    }

    if (registry.registerInlayHintsProvider) {
      disposables.push(
        registry.registerInlayHintsProvider(language, {
          onDidChangeInlayHints: inlayHintRefreshEmitter.event,
          provideInlayHints: (model, range) =>
            provideInlayHints(monaco, context, model, range),
          resolveInlayHint: (hint) => resolveInlayHint(monaco, context, hint),
        }),
      );
    }

    if (registry.registerDocumentHighlightProvider) {
      disposables.push(
        registry.registerDocumentHighlightProvider(language, {
          provideDocumentHighlights: (model, position) =>
            provideDocumentHighlights(monaco, context, model, position),
        }),
      );
    }

    if (registry.registerDocumentSymbolProvider) {
      disposables.push(
        registry.registerDocumentSymbolProvider(language, {
          provideDocumentSymbols: (model) =>
            provideDocumentSymbols(monaco, context, model),
        }),
      );
    }

    if (registry.registerLinkProvider) {
      disposables.push(
        registry.registerLinkProvider(language, {
          provideLinks: (model) => provideDocumentLinks(monaco, context, model),
          resolveLink: (link) => resolveDocumentLink(monaco, context, link),
        }),
      );
    }

    if (registry.registerFoldingRangeProvider) {
      disposables.push(
        registry.registerFoldingRangeProvider(language, {
          provideFoldingRanges: (model) =>
            provideFoldingRanges(monaco, context, model),
        }),
      );
    }

    if (registry.registerSelectionRangeProvider) {
      disposables.push(
        registry.registerSelectionRangeProvider(language, {
          provideSelectionRanges: (model, positions) =>
            provideSelectionRanges(monaco, context, model, positions),
        }),
      );
    }

    if (registry.registerLinkedEditingRangeProvider) {
      disposables.push(
        registry.registerLinkedEditingRangeProvider(language, {
          provideLinkedEditingRanges: (model, position) =>
            provideLinkedEditingRanges(monaco, context, model, position),
        }),
      );
    }

    if (registry.registerDocumentSemanticTokensProvider) {
      disposables.push(
        registry.registerDocumentSemanticTokensProvider(language, {
          onDidChange: semanticTokensRefreshEmitter.event,
          getLegend: () => semanticTokensLegendForActiveRuntime(context),
          provideDocumentSemanticTokens: (model) =>
            provideDocumentSemanticTokens(context, model),
          releaseDocumentSemanticTokens: () => undefined,
        }),
      );
    }

    if (registry.registerDocumentRangeSemanticTokensProvider) {
      disposables.push(
        registry.registerDocumentRangeSemanticTokensProvider(language, {
          getLegend: () => semanticTokensLegendForActiveRuntime(context),
          provideDocumentRangeSemanticTokens: (model, range) =>
            provideDocumentRangeSemanticTokens(context, model, range),
        }),
      );
    }
  });

  return {
    dispose: () => {
      disposables.forEach((disposable) => disposable.dispose());
    },
  };
}

async function provideHover(
  _monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Promise<Monaco.languages.Hover | null> {
  const request = featureRequestContext(context, model, position, "hover");

  if (!request) {
    return null;
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRoot(context, request))) {
      return null;
    }

    const hover = await context.featuresGateway.hover(
      request.rootPath,
      request.position,
    );

    if (!isFeatureRequestActive(context, request)) {
      return null;
    }

    return hover ? { contents: [{ value: hover.contents }] } : null;
  } catch (error) {
    reportErrorForActiveRoot(context, request.rootPath, error);
    return null;
  }
}

async function provideCompletionItems(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
  completionContext?: Monaco.languages.CompletionContext,
): Promise<Monaco.languages.CompletionList> {
  const request = featureRequestContext(context, model, position, "completion");

  if (!request) {
    return { suggestions: [] };
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRoot(context, request))) {
      return { suggestions: [] };
    }

    const languageServerContext =
      toLanguageServerCompletionContext(completionContext);
    const completion = languageServerContext
      ? await context.featuresGateway.completion(
          request.rootPath,
          request.position,
          languageServerContext,
        )
      : await context.featuresGateway.completion(
          request.rootPath,
          request.position,
        );

    if (!isFeatureRequestActive(context, request)) {
      return { suggestions: [] };
    }

    const word = model.getWordUntilPosition(position);
    const range = {
      endColumn: word.endColumn,
      endLineNumber: position.lineNumber,
      startColumn: word.startColumn,
      startLineNumber: position.lineNumber,
    };

    return {
      ...(completion.isIncomplete ? { incomplete: true } : {}),
      suggestions: completion.items.map((item, index) => {
        return toMonacoCompletionItem(
          monaco,
          item,
          request.rootPath,
          request.sessionId,
          request.path,
          range,
          `0_${String(index).padStart(4, "0")}`,
        );
      }),
    };
  } catch (error) {
    reportErrorForActiveRoot(context, request.rootPath, error);
    return { suggestions: [] };
  }
}

function toLanguageServerCompletionContext(
  context: Monaco.languages.CompletionContext | undefined,
): LanguageServerCompletionContext | undefined {
  if (!context) {
    return undefined;
  }

  return {
    triggerCharacter: context.triggerCharacter ?? null,
    triggerKind:
      context.triggerKind === 1 ? 2 : context.triggerKind === 2 ? 3 : 1,
  };
}

async function resolveCompletionItem(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  item: Monaco.languages.CompletionItem,
): Promise<Monaco.languages.CompletionItem> {
  const backedItem = item as LanguageServerBackedCompletionItem;

  if (
    !backedItem.__languageServerItem ||
    !backedItem.__workspaceRoot ||
    backedItem.__languageServerSessionId == null ||
    !isStoredLanguageServerPayloadActive(
      context,
      backedItem.__workspaceRoot,
      backedItem.__languageServerSessionId,
    )
  ) {
    return item;
  }

  try {
    if (
      !(await flushPendingDocumentChangeForStoredPayload(context, backedItem))
    ) {
      return item;
    }

    const resolved = await context.featuresGateway.resolveCompletionItem(
      backedItem.__workspaceRoot,
      backedItem.__languageServerItem,
    );

    if (
      !isStoredLanguageServerPayloadActive(
        context,
        backedItem.__workspaceRoot,
        backedItem.__languageServerSessionId,
      )
    ) {
      return item;
    }

    return {
      ...item,
      ...toMonacoCompletionItem(
        monaco,
        resolved,
        backedItem.__workspaceRoot,
        backedItem.__languageServerSessionId,
        backedItem.__sourcePath,
        backedItem.__completionRange ?? item.range,
        item.sortText,
      ),
    };
  } catch (error) {
    reportErrorForActiveRoot(context, backedItem.__workspaceRoot, error);
    return item;
  }
}

async function provideDefinition(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Promise<Monaco.languages.Definition | null> {
  const request = featureRequestContext(context, model, position, "definition");

  if (!request) {
    return null;
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRoot(context, request))) {
      return null;
    }

    const locations = await context.featuresGateway.definition(
      request.rootPath,
      request.position,
    );

    if (!isFeatureRequestActive(context, request)) {
      return null;
    }

    return toMonacoLocations(monaco, locations);
  } catch (error) {
    reportErrorForActiveRoot(context, request.rootPath, error);
    return null;
  }
}

async function provideDeclaration(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Promise<Monaco.languages.Definition | null> {
  const request = featureRequestContext(context, model, position, "declaration");

  if (!request) {
    return null;
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRoot(context, request))) {
      return null;
    }

    const locations = await context.featuresGateway.declaration(
      request.rootPath,
      request.position,
    );

    if (!isFeatureRequestActive(context, request)) {
      return null;
    }

    return toMonacoLocations(monaco, locations);
  } catch (error) {
    reportErrorForActiveRoot(context, request.rootPath, error);
    return null;
  }
}

async function provideImplementation(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Promise<Monaco.languages.Definition | null> {
  const request = featureRequestContext(
    context,
    model,
    position,
    "implementation",
  );

  if (!request) {
    return null;
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRoot(context, request))) {
      return null;
    }

    const locations = await context.featuresGateway.implementation(
      request.rootPath,
      request.position,
    );

    if (!isFeatureRequestActive(context, request)) {
      return null;
    }

    return toMonacoLocations(monaco, locations);
  } catch (error) {
    reportErrorForActiveRoot(context, request.rootPath, error);
    return null;
  }
}

async function provideTypeDefinition(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Promise<Monaco.languages.Definition | null> {
  const request = featureRequestContext(context, model, position, "typeDefinition");

  if (!request) {
    return null;
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRoot(context, request))) {
      return null;
    }

    const locations = await context.featuresGateway.typeDefinition(
      request.rootPath,
      request.position,
    );

    if (!isFeatureRequestActive(context, request)) {
      return null;
    }

    return toMonacoLocations(monaco, locations);
  } catch (error) {
    reportErrorForActiveRoot(context, request.rootPath, error);
    return null;
  }
}

async function provideSignatureHelp(
  _monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
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

    const languageServerSignatureContext =
      toLanguageServerSignatureHelpContext(signatureContext);
    const signatureHelp = languageServerSignatureContext
      ? await context.featuresGateway.signatureHelp(
          request.rootPath,
          request.position,
          languageServerSignatureContext,
        )
      : await context.featuresGateway.signatureHelp(
          request.rootPath,
          request.position,
        );

    if (!isFeatureRequestActive(context, request)) {
      return null;
    }

    return signatureHelp ? toMonacoSignatureHelp(signatureHelp) : null;
  } catch (error) {
    reportErrorForActiveRoot(context, request.rootPath, error);
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
          activeSignatureHelp: toLanguageServerSignatureHelp(
            context.activeSignatureHelp,
          ),
        }
      : {}),
    isRetrigger: context.isRetrigger,
    ...(context.triggerCharacter
      ? { triggerCharacter: context.triggerCharacter }
      : {}),
    triggerKind:
      context.triggerKind as LanguageServerSignatureHelpContext["triggerKind"],
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

function signatureParameterLabel(
  signatureLabel: string,
  label: string | [number, number],
): string {
  if (typeof label === "string") {
    return label;
  }

  const [start, end] = label;
  return signatureLabel.slice(start, end);
}

function markdownStringValue(
  value: Monaco.IMarkdownString | string | undefined,
): string | null {
  if (!value) {
    return null;
  }

  return typeof value === "string" ? value : value.value;
}

async function provideReferences(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Promise<Monaco.languages.Location[] | null> {
  const request = featureRequestContext(context, model, position, "references");

  if (!request) {
    return null;
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRoot(context, request))) {
      return null;
    }

    const locations = await context.featuresGateway.references(
      request.rootPath,
      request.position,
    );

    if (!isFeatureRequestActive(context, request)) {
      return null;
    }

    return toMonacoLocations(monaco, locations, request.rootPath);
  } catch (error) {
    reportErrorForActiveRoot(context, request.rootPath, error);
    return null;
  }
}

async function provideDocumentHighlights(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Promise<Monaco.languages.DocumentHighlight[] | null> {
  const request = featureRequestContext(
    context,
    model,
    position,
    "documentHighlight",
  );

  if (!request) {
    return null;
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRoot(context, request))) {
      return null;
    }

    const highlights = await context.featuresGateway.documentHighlights(
      request.rootPath,
      request.position,
    );

    if (!isFeatureRequestActive(context, request)) {
      return null;
    }

    return highlights.map((highlight) =>
      toMonacoDocumentHighlight(monaco, highlight),
    );
  } catch (error) {
    reportErrorForActiveRoot(context, request.rootPath, error);
    return null;
  }
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

    const links = await context.featuresGateway.documentLinks(
      request.rootPath,
      request.path,
    );

    if (!isFeatureRequestActive(context, request)) {
      return emptyLinksList();
    }

    return {
      dispose: () => undefined,
      links: links.map((link) =>
        toMonacoDocumentLink(
          monaco,
          request.rootPath,
          request.sessionId,
          request.path,
          link,
        ),
      ),
    };
  } catch (error) {
    reportErrorForActiveRoot(context, request.rootPath, error);
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

    const symbols = await context.featuresGateway.documentSymbols(
      request.rootPath,
      request.path,
    );

    if (!isFeatureRequestActive(context, request)) {
      return null;
    }

    return symbols.map((symbol) => toMonacoDocumentSymbol(monaco, symbol));
  } catch (error) {
    reportErrorForActiveRoot(context, request.rootPath, error);
    return null;
  }
}

async function provideWorkspaceSymbols(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  query: string,
): Promise<MonacoWorkspaceSymbol[]> {
  const request = workspaceSymbolRequestContext(context);

  if (!request) {
    return [];
  }

  try {
    const symbols = await context.featuresGateway.workspaceSymbols(
      request.rootPath,
      query,
    );

    if (!isFeatureRequestActive(context, request)) {
      return [];
    }

    return symbols.flatMap((symbol) =>
      toMonacoWorkspaceSymbol(monaco, symbol, request.rootPath),
    );
  } catch (error) {
    reportErrorForActiveRoot(context, request.rootPath, error);
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
    if (
      !(await flushPendingDocumentChangeForStoredPayload(context, backedLink))
    ) {
      return link;
    }

    const resolved = await context.featuresGateway.resolveDocumentLink(
      backedLink.__workspaceRoot,
      backedLink.__languageServerLink,
    );

    if (
      !isStoredLanguageServerPayloadActive(
        context,
        backedLink.__workspaceRoot,
        backedLink.__languageServerSessionId,
      )
    ) {
      return link;
    }

    return {
      ...link,
      ...toMonacoDocumentLink(
        monaco,
        backedLink.__workspaceRoot,
        backedLink.__languageServerSessionId,
        backedLink.__sourcePath,
        resolved,
      ),
    };
  } catch (error) {
    reportErrorForActiveRoot(context, backedLink.__workspaceRoot, error);
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

    const ranges = await context.featuresGateway.foldingRanges(
      request.rootPath,
      request.path,
    );

    if (!isFeatureRequestActive(context, request)) {
      return null;
    }

    return ranges.map((range) => toMonacoFoldingRange(monaco, range));
  } catch (error) {
    reportErrorForActiveRoot(context, request.rootPath, error);
    return null;
  }
}

async function provideRenameEdits(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
  newName: string,
): Promise<Monaco.languages.WorkspaceEdit | null> {
  const request = featureRequestContext(context, model, position, "rename");

  if (!request) {
    return null;
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRoot(context, request))) {
      return null;
    }

    const edit = await context.featuresGateway.rename(
      request.rootPath,
      request.position,
      newName,
    );

    if (!isFeatureRequestActive(context, request)) {
      return null;
    }

    return edit
      ? toMonacoWorkspaceEdit(
          monaco,
          workspaceEditContext(model),
          edit,
          request.rootPath,
        )
      : null;
  } catch (error) {
    reportErrorForActiveRoot(context, request.rootPath, error);
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

    return selectionRanges.map((selectionRange) =>
      flattenSelectionRange(monaco, selectionRange),
    );
  } catch (error) {
    reportErrorForActiveRoot(context, request.rootPath, error);
    return null;
  }
}

async function provideDocumentSemanticTokens(
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  model: MonacoModel,
): Promise<Monaco.languages.SemanticTokens | null> {
  const request = documentRequestContext(context, model, "semanticTokens");

  if (!request) {
    return null;
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRoot(context, request))) {
      return null;
    }

    const tokens = await context.featuresGateway.semanticTokens(
      request.rootPath,
      request.path,
    );

    if (!isFeatureRequestActive(context, request)) {
      return null;
    }

    return toMonacoSemanticTokens(tokens);
  } catch (error) {
    reportErrorForActiveRoot(context, request.rootPath, error);
    return null;
  }
}

async function provideDocumentRangeSemanticTokens(
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  model: MonacoModel,
  range: Monaco.Range,
): Promise<Monaco.languages.SemanticTokens | null> {
  const request = documentRequestContext(context, model, "semanticTokens");

  if (!request) {
    return null;
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRoot(context, request))) {
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
    reportErrorForActiveRoot(context, request.rootPath, error);
    return null;
  }
}

async function provideLinkedEditingRanges(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Promise<Monaco.languages.LinkedEditingRanges | null> {
  const request = featureRequestContext(
    context,
    model,
    position,
    "linkedEditingRange",
  );

  if (!request) {
    return null;
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRoot(context, request))) {
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
    reportErrorForActiveRoot(context, request.rootPath, error);
    return null;
  }
}

async function resolveRenameLocation(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Promise<(Monaco.languages.RenameLocation & Monaco.languages.Rejection) | null> {
  const request = featureRequestContext(context, model, position, "prepareRename");

  if (!request) {
    return null;
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRoot(context, request))) {
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
    if (!isFeatureRequestActive(context, request)) {
      return null;
    }

    return {
      rejectReason: errorMessage(error),
    } as Monaco.languages.RenameLocation & Monaco.languages.Rejection;
  }
}

async function provideCodeActions(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  model: MonacoModel,
  range: Monaco.Range,
  actionContext: Monaco.languages.CodeActionContext,
): Promise<Monaco.languages.CodeActionList> {
  const request = documentRequestContext(context, model, "codeAction");

  if (!request) {
    return emptyCodeActionList();
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRoot(context, request))) {
      return emptyCodeActionList();
    }

    const actions = await context.featuresGateway.codeActions(
      request.rootPath,
      request.path,
      toLanguageServerRange(range),
      toLanguageServerCodeActionContext(monaco, actionContext),
    );

    if (!isFeatureRequestActive(context, request)) {
      return emptyCodeActionList();
    }

    return {
      actions: actions.flatMap((action) =>
        toMonacoCodeAction(
          monaco,
          workspaceEditContext(model),
          request.rootPath,
          request.sessionId,
          request.path,
          action,
          actionContext,
        ),
      ),
      dispose: () => undefined,
    };
  } catch (error) {
    reportErrorForActiveRoot(context, request.rootPath, error);
    return emptyCodeActionList();
  }
}

async function resolveCodeAction(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  action: Monaco.languages.CodeAction,
): Promise<Monaco.languages.CodeAction> {
  const backedAction = action as LanguageServerBackedCodeAction;

  if (
    !backedAction.__languageServerAction ||
    !backedAction.__workspaceRoot ||
    backedAction.__languageServerSessionId == null ||
    !isStoredLanguageServerPayloadActive(
      context,
      backedAction.__workspaceRoot,
      backedAction.__languageServerSessionId,
    )
  ) {
    return action;
  }

  try {
    if (
      !(await flushPendingDocumentChangeForStoredPayload(context, backedAction))
    ) {
      return action;
    }

    const resolved = await context.featuresGateway.resolveCodeAction(
      backedAction.__workspaceRoot,
      backedAction.__languageServerAction,
    );

    if (
      !isStoredLanguageServerPayloadActive(
        context,
        backedAction.__workspaceRoot,
        backedAction.__languageServerSessionId,
      )
    ) {
      return action;
    }

    const [mapped] = toMonacoCodeAction(
      monaco,
      backedAction.__workspaceEditContext ?? {
        path: "",
        versionId: undefined,
      },
      backedAction.__workspaceRoot,
      backedAction.__languageServerSessionId,
      backedAction.__sourcePath,
      resolved,
      {
        markers: action.diagnostics ?? [],
        only: action.kind ?? undefined,
        trigger: monaco.languages.CodeActionTriggerType.Invoke,
      },
    );

    return mapped ? { ...action, ...mapped } : action;
  } catch (error) {
    reportErrorForActiveRoot(context, backedAction.__workspaceRoot, error);
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

    const lenses = await context.featuresGateway.codeLenses(
      request.rootPath,
      request.path,
    );

    if (!isFeatureRequestActive(context, request)) {
      return emptyCodeLensList();
    }

    return {
      lenses: lenses.map((lens) =>
        toMonacoCodeLens(
          monaco,
          request.rootPath,
          request.sessionId,
          request.path,
          lens,
        ),
      ),
      dispose: () => undefined,
    };
  } catch (error) {
    reportErrorForActiveRoot(context, request.rootPath, error);
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
    if (
      !(await flushPendingDocumentChangeForStoredPayload(context, backedCodeLens))
    ) {
      return codeLens;
    }

    const resolved = await context.featuresGateway.resolveCodeLens(
      backedCodeLens.__workspaceRoot,
      backedCodeLens.__languageServerCodeLens,
    );

    if (
      !isStoredLanguageServerPayloadActive(
        context,
        backedCodeLens.__workspaceRoot,
        backedCodeLens.__languageServerSessionId,
      )
    ) {
      return codeLens;
    }

    return {
      ...codeLens,
      ...toMonacoCodeLens(
        monaco,
        backedCodeLens.__workspaceRoot,
        backedCodeLens.__languageServerSessionId,
        backedCodeLens.__sourcePath,
        resolved,
      ),
    };
  } catch (error) {
    reportErrorForActiveRoot(context, backedCodeLens.__workspaceRoot, error);
    return codeLens;
  }
}

async function provideDocumentFormattingEdits(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  model: MonacoModel,
  options: Monaco.languages.FormattingOptions,
): Promise<Monaco.languages.TextEdit[]> {
  const request = documentRequestContext(context, model, "formatting");

  if (!request) {
    return [];
  }

  try {
    if (!(await flushPendingDocumentChangeForActiveRoot(context, request))) {
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
    reportErrorForActiveRoot(context, request.rootPath, error);
    return [];
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
    reportErrorForActiveRoot(context, request.rootPath, error);
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
    reportErrorForActiveRoot(context, request.rootPath, error);
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
        toMonacoInlayHint(
          monaco,
          hint,
          request.rootPath,
          request.sessionId,
          request.path,
        ),
      ),
      dispose: () => undefined,
    };
  } catch (error) {
    reportErrorForActiveRoot(context, request.rootPath, error);
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

  try {
    if (
      !(await flushPendingDocumentChangeForStoredPayload(context, backedHint))
    ) {
      return hint;
    }

    const resolvedHint = await context.featuresGateway.resolveInlayHint(
      backedHint.__workspaceRoot,
      backedHint.__languageServerInlayHint,
    );

    if (
      !isStoredLanguageServerPayloadActive(
        context,
        backedHint.__workspaceRoot,
        backedHint.__languageServerSessionId,
      )
    ) {
      return hint;
    }

    return toMonacoInlayHint(
      monaco,
      resolvedHint,
      backedHint.__workspaceRoot,
      backedHint.__languageServerSessionId,
      backedHint.__sourcePath,
    );
  } catch (error) {
    reportErrorForActiveRoot(context, backedHint.__workspaceRoot, error);
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
  const rootPath = context.getWorkspaceRoot?.() ?? null;

  if (
    !rootPath ||
    !activeDocument ||
    !isJavaScriptTypeScriptDocument(activeDocument) ||
    modelPath(model) !== activeDocument.path
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
    path: activeDocument.path,
    position: toLanguageServerTextDocumentPosition(activeDocument.path, {
      column: position.column,
      lineNumber: position.lineNumber,
    }),
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
  const rootPath = context.getWorkspaceRoot?.() ?? null;

  if (
    !rootPath ||
    !activeDocument ||
    !isJavaScriptTypeScriptDocument(activeDocument) ||
    modelPath(model) !== activeDocument.path
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
    path: activeDocument.path,
    rootPath,
    sessionId,
  };
}

function workspaceSymbolRequestContext(
  context: JavaScriptTypeScriptLanguageServerProviderContext,
) {
  const rootPath = context.getWorkspaceRoot?.() ?? null;

  if (!rootPath) {
    return null;
  }

  if (!canUseRuntimeFeatureForRoot(context, rootPath, "workspaceSymbol")) {
    return null;
  }
  const sessionId = runningRuntimeSessionIdForRoot(context, rootPath);

  if (sessionId == null) {
    return null;
  }

  return { rootPath, sessionId };
}

async function flushPendingDocumentChangeForActiveRoot(
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  request: { path: string; rootPath: string; sessionId?: number },
): Promise<boolean> {
  await context.flushPendingDocumentChange(request.path);

  return isFeatureRequestActive(context, request);
}

async function flushPendingDocumentChangeForStoredPayload(
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  payload: StoredLanguageServerPayloadRequest,
): Promise<boolean> {
  const path = payload.path ?? payload.__sourcePath;
  const rootPath = payload.rootPath ?? payload.__workspaceRoot;
  const sessionId = payload.sessionId ?? payload.__languageServerSessionId;

  if (!path || !rootPath || sessionId == null) {
    return false;
  }

  await context.flushPendingDocumentChange(path);

  return isStoredLanguageServerPayloadActive(context, rootPath, sessionId);
}

function isFeatureRequestActive(
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  request: { rootPath: string; sessionId?: number },
): boolean {
  return request.sessionId == null
    ? isStoredWorkspaceRootActive(context, request.rootPath)
    : isStoredLanguageServerPayloadActive(
        context,
        request.rootPath,
        request.sessionId,
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
    (status.rootPath && !workspaceRootKeysEqual(status.rootPath, rootPath))
  ) {
    return null;
  }

  return status;
}

function semanticTokensLegendForActiveRuntime(
  context: JavaScriptTypeScriptLanguageServerProviderContext,
): Monaco.languages.SemanticTokensLegend {
  const status = context.getRuntimeStatus();

  if (status?.kind !== "running") {
    return JAVASCRIPT_TYPESCRIPT_SEMANTIC_TOKENS_LEGEND;
  }

  const rootPath = context.getWorkspaceRoot?.() ?? null;

  if (
    status.rootPath &&
    (!rootPath || !workspaceRootKeysEqual(status.rootPath, rootPath))
  ) {
    return JAVASCRIPT_TYPESCRIPT_SEMANTIC_TOKENS_LEGEND;
  }

  if (!isUsableSemanticTokensLegend(status.capabilities.semanticTokensLegend)) {
    return JAVASCRIPT_TYPESCRIPT_SEMANTIC_TOKENS_LEGEND;
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

function reportErrorForActiveRoot(
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  rootPath: string,
  error: unknown,
): void {
  if (!isStoredWorkspaceRootActive(context, rootPath)) {
    return;
  }

  context.reportError(error);
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toMonacoFoldingRange(
  monaco: MonacoApi,
  range: LanguageServerFoldingRange,
): Monaco.languages.FoldingRange {
  return {
    end: range.endLine + 1,
    kind: range.kind
      ? monaco.languages.FoldingRangeKind.fromValue(range.kind)
      : undefined,
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

function toMonacoDocumentSymbol(
  monaco: MonacoApi,
  symbol: LanguageServerDocumentSymbol,
): Monaco.languages.DocumentSymbol {
  return {
    children: symbol.children.map((child) =>
      toMonacoDocumentSymbol(monaco, child),
    ),
    ...(symbol.containerName ? { containerName: symbol.containerName } : {}),
    detail: symbol.detail ?? "",
    kind: monacoSymbolKindFromLspKind(monaco, symbol.kind),
    name: symbol.name,
    range: toMonacoRange(monaco, symbol.range),
    selectionRange: toMonacoRange(monaco, symbol.selectionRange),
    tags: [],
  };
}

function toMonacoWorkspaceSymbol(
  monaco: MonacoApi,
  symbol: LanguageServerWorkspaceSymbol,
  rootPath: string,
): MonacoWorkspaceSymbol[] {
  if (!symbol.location) {
    return [];
  }

  const [location] = toMonacoLocations(monaco, [symbol.location], rootPath);

  if (!location) {
    return [];
  }

  return [
    {
      ...(symbol.containerName ? { containerName: symbol.containerName } : {}),
      kind: monacoSymbolKindFromLspKind(monaco, symbol.kind),
      location,
      name: symbol.name,
    },
  ];
}

function monacoSymbolKindFromLspKind(
  monaco: MonacoApi,
  kind: number,
): Monaco.languages.SymbolKind {
  switch (kind) {
    case 1:
      return monaco.languages.SymbolKind.File;
    case 2:
      return monaco.languages.SymbolKind.Module;
    case 3:
      return monaco.languages.SymbolKind.Namespace;
    case 4:
      return monaco.languages.SymbolKind.Package;
    case 5:
      return monaco.languages.SymbolKind.Class;
    case 6:
      return monaco.languages.SymbolKind.Method;
    case 7:
      return monaco.languages.SymbolKind.Property;
    case 8:
      return monaco.languages.SymbolKind.Field;
    case 9:
      return monaco.languages.SymbolKind.Constructor;
    case 10:
      return monaco.languages.SymbolKind.Enum;
    case 11:
      return monaco.languages.SymbolKind.Interface;
    case 12:
      return monaco.languages.SymbolKind.Function;
    case 13:
      return monaco.languages.SymbolKind.Variable;
    case 14:
      return monaco.languages.SymbolKind.Constant;
    case 15:
      return monaco.languages.SymbolKind.String;
    case 16:
      return monaco.languages.SymbolKind.Number;
    case 17:
      return monaco.languages.SymbolKind.Boolean;
    case 18:
      return monaco.languages.SymbolKind.Array;
    case 19:
      return monaco.languages.SymbolKind.Object;
    case 20:
      return monaco.languages.SymbolKind.Key;
    case 21:
      return monaco.languages.SymbolKind.Null;
    case 22:
      return monaco.languages.SymbolKind.EnumMember;
    case 23:
      return monaco.languages.SymbolKind.Struct;
    case 24:
      return monaco.languages.SymbolKind.Event;
    case 25:
      return monaco.languages.SymbolKind.Operator;
    case 26:
      return monaco.languages.SymbolKind.TypeParameter;
    default:
      return monaco.languages.SymbolKind.Variable;
  }
}

function toMonacoDocumentHighlight(
  monaco: MonacoApi,
  highlight: LanguageServerDocumentHighlight,
): Monaco.languages.DocumentHighlight {
  return {
    kind: toMonacoDocumentHighlightKind(monaco, highlight.kind),
    range: toMonacoRange(monaco, highlight.range),
  };
}

function toMonacoDocumentHighlightKind(
  monaco: MonacoApi,
  kind: number | null,
): Monaco.languages.DocumentHighlightKind {
  if (kind === 2) {
    return monaco.languages.DocumentHighlightKind.Read;
  }

  if (kind === 3) {
    return monaco.languages.DocumentHighlightKind.Write;
  }

  return monaco.languages.DocumentHighlightKind.Text;
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
          command: toMonacoCodeLensCommand(
            monaco,
            rootPath,
            sessionId,
            sourcePath,
            lens.command,
          ),
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
      arguments: toShowReferencesArguments(
        monaco,
        command.arguments ?? [],
        rootPath,
      ),
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

function toShowReferencesArguments(
  monaco: MonacoApi,
  args: unknown[],
  rootPath?: string,
): unknown[] {
  if (args.length < 3) {
    return args;
  }

  const [uri, position, locations, ...rest] = args;

  return [
    typeof uri === "string"
      ? languageServerUriToMonacoUri(monaco, uri)
      : uri,
    toMonacoPositionLike(position),
    Array.isArray(locations)
      ? toMonacoLocations(
          monaco,
          locations as LanguageServerLocation[],
          rootPath,
        )
      : locations,
    ...rest,
  ];
}

function languageServerUriToMonacoUri(monaco: MonacoApi, uri: string): unknown {
  const path = pathFromLanguageServerUri(uri);

  return path ? monaco.Uri.file(path) : uri;
}

function toMonacoPositionLike(position: unknown): unknown {
  if (
    position &&
    typeof position === "object" &&
    "line" in position &&
    "character" in position
  ) {
    const value = position as { character: unknown; line: unknown };

    if (
      typeof value.line === "number" &&
      typeof value.character === "number"
    ) {
      return {
        column: value.character + 1,
        lineNumber: value.line + 1,
      };
    }
  }

  return position;
}

function flattenSelectionRange(
  monaco: MonacoApi,
  selectionRange: LanguageServerSelectionRange,
): Monaco.languages.SelectionRange[] {
  const ranges: Monaco.languages.SelectionRange[] = [];
  let current: LanguageServerSelectionRange | null = selectionRange;

  while (current) {
    ranges.push({ range: toMonacoRange(monaco, current.range) });
    current = current.parent;
  }

  return ranges;
}

function toMonacoSemanticTokens(
  tokens: LanguageServerSemanticTokens | null,
): Monaco.languages.SemanticTokens | null {
  if (!tokens || tokens.data.length === 0) {
    return null;
  }

  return {
    data: Uint32Array.from(tokens.data),
    ...(tokens.resultId ? { resultId: tokens.resultId } : {}),
  };
}

function toMonacoLinkedEditingRanges(
  monaco: MonacoApi,
  ranges: LanguageServerLinkedEditingRanges | null,
): Monaco.languages.LinkedEditingRanges | null {
  if (!ranges || ranges.ranges.length === 0) {
    return null;
  }

  return {
    ranges: ranges.ranges.map((range) => toMonacoRange(monaco, range)),
    ...(ranges.wordPattern
      ? { wordPattern: safeRegExp(ranges.wordPattern) }
      : {}),
  };
}

function safeRegExp(pattern: string): RegExp | undefined {
  try {
    return new RegExp(pattern);
  } catch {
    return undefined;
  }
}

function toMonacoLocations(
  monaco: MonacoApi,
  locations: LanguageServerLocation[],
  rootPath?: string,
): Monaco.languages.Location[] {
  return locations.flatMap((location) => {
    const path = pathFromLanguageServerUri(location.uri);

    if (!path) {
      return [];
    }

    if (rootPath && !isPathInWorkspaceRoot(rootPath, path)) {
      return [];
    }

    return [
      {
        range: new monaco.Range(
          location.range.start.line + 1,
          location.range.start.character + 1,
          location.range.end.line + 1,
          location.range.end.character + 1,
        ),
        uri: monaco.Uri.file(path),
      },
    ];
  });
}

function toMonacoWorkspaceEdit(
  monaco: MonacoApi,
  context: WorkspaceEditContext,
  edit: LanguageServerWorkspaceEdit,
  rootPath?: string,
): Monaco.languages.WorkspaceEdit {
  const fileEdits = (edit.fileOperations ?? []).flatMap((operation) =>
    toMonacoWorkspaceFileEdit(monaco, operation, rootPath),
  );
  const textEdits = Object.entries(edit.changes).flatMap(([uri, edits]) => {
    const path = pathFromLanguageServerUri(uri);

    if (!path) {
      return [];
    }

    if (rootPath && !isPathInWorkspaceRoot(rootPath, path)) {
      return [];
    }

    const resource = monaco.Uri.file(path);
    const versionId = context.path === path ? context.versionId : undefined;

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
  rootPath?: string,
): Monaco.languages.IWorkspaceFileEdit[] {
  if (!isFileOperationInWorkspaceRoot(operation, rootPath)) {
    return [];
  }

  if (operation.kind === "create") {
    const path = pathFromLanguageServerUri(operation.uri);
    const options = toMonacoWorkspaceFileEditOptions(operation.options);

    return path
      ? [
          {
            newResource: monaco.Uri.file(path),
            ...(options ? { options } : {}),
          },
        ]
      : [];
  }

  if (operation.kind === "rename") {
    const oldPath = pathFromLanguageServerUri(operation.oldUri);
    const newPath = pathFromLanguageServerUri(operation.newUri);
    const options = toMonacoWorkspaceFileEditOptions(operation.options);

    return oldPath && newPath
      ? [
          {
            newResource: monaco.Uri.file(newPath),
            oldResource: monaco.Uri.file(oldPath),
            ...(options ? { options } : {}),
          },
        ]
      : [];
  }

  const path = pathFromLanguageServerUri(operation.uri);
  const options = toMonacoWorkspaceFileEditOptions(operation.options);

  return path
    ? [
        {
          oldResource: monaco.Uri.file(path),
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

function toMonacoTextEdit(
  monaco: MonacoApi,
  edit: LanguageServerTextEdit,
): Monaco.languages.TextEdit {
  return {
    range: toMonacoRange(monaco, edit.range),
    text: edit.newText,
  };
}

function toMonacoRange(
  monaco: MonacoApi,
  range: LanguageServerRange,
): Monaco.Range {
  return new monaco.Range(
    range.start.line + 1,
    range.start.character + 1,
    range.end.line + 1,
    range.end.character + 1,
  );
}

function toLanguageServerRange(range: Monaco.Range): LanguageServerRange {
  return {
    end: {
      character: Math.max(0, range.endColumn - 1),
      line: Math.max(0, range.endLineNumber - 1),
    },
    start: {
      character: Math.max(0, range.startColumn - 1),
      line: Math.max(0, range.startLineNumber - 1),
    },
  };
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

function lspDiagnosticSeverity(
  monaco: MonacoApi,
  severity: Monaco.MarkerSeverity,
): number | null {
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
  editContext: WorkspaceEditContext,
  rootPath: string,
  sessionId: number,
  sourcePath: string | undefined,
  action: LanguageServerCodeAction,
  context: Monaco.languages.CodeActionContext,
): Monaco.languages.CodeAction[] {
  if (!action.edit && !action.command && action.data == null && !action.disabled) {
    return [];
  }

  const codeAction: LanguageServerBackedCodeAction = {
    __languageServerAction: action,
    __languageServerSessionId: sessionId,
    __sourcePath: sourcePath,
    __workspaceEditContext: editContext,
    __workspaceRoot: rootPath,
    diagnostics: context.markers,
    ...(action.command || action.edit
      ? {
          command: {
            arguments: [
              {
                command: action.command,
                edit: action.edit,
                ...(sourcePath ? { path: sourcePath } : {}),
                rootPath,
                sessionId,
              } satisfies ExecuteCommandPayload,
            ],
            id: EXECUTE_LANGUAGE_SERVER_COMMAND_ID,
            title: action.command?.title || action.title,
          },
        }
      : {}),
    ...(action.edit
      ? {
          edit: toMonacoWorkspaceEdit(
            monaco,
            editContext,
            action.edit,
            rootPath,
          ),
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

function emptyCodeActionList(): Monaco.languages.CodeActionList {
  return {
    actions: [],
    dispose: () => undefined,
  };
}

function emptyCodeLensList(): Monaco.languages.CodeLensList {
  return {
    dispose: () => undefined,
    lenses: [],
  };
}

function emptyInlayHintList(): Monaco.languages.InlayHintList {
  return {
    hints: [],
    dispose: () => undefined,
  };
}

function emptyLinksList(): Monaco.languages.ILinksList {
  return {
    dispose: () => undefined,
    links: [],
  };
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
    label: toMonacoInlayHintLabel(
      monaco,
      hint.label,
      rootPath,
      sessionId,
      sourcePath,
    ),
    paddingLeft: hint.paddingLeft,
    paddingRight: hint.paddingRight,
    position: {
      column: hint.position.character + 1,
      lineNumber: hint.position.line + 1,
    },
    ...(hint.textEdits?.length
      ? {
          textEdits: hint.textEdits.map((edit) =>
            toMonacoTextEdit(monaco, edit),
          ),
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
    const [location] = part.location
      ? toMonacoLocations(monaco, [part.location])
      : [];

    return {
      label: part.label,
      ...(part.command
        ? {
            command: toMonacoLanguageServerCommand(
              rootPath,
              sessionId,
              sourcePath,
              part.command,
            ),
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

function toLanguageServerFormattingOptions(
  options: Monaco.languages.FormattingOptions,
): LanguageServerFormattingOptions {
  return {
    insertSpaces: options.insertSpaces,
    tabSize: options.tabSize,
  };
}

function workspaceEditContext(model: MonacoModel): WorkspaceEditContext {
  return {
    path: modelPath(model),
    versionId:
      typeof model.getVersionId === "function" ? model.getVersionId() : undefined,
  };
}

function applyWorkspaceEditToOpenModels(
  monaco: MonacoApi,
  edit: LanguageServerWorkspaceEdit,
): string[] {
  const editedOpenPaths: string[] = [];
  const modelsByPath = new Map(
    monaco.editor.getModels().map((model) => [modelPath(model), model]),
  );

  Object.entries(edit.changes).forEach(([uri, edits]) => {
    const path = pathFromLanguageServerUri(uri);
    const model = path ? modelsByPath.get(path) : null;

    if (!path || !model || edits.length === 0) {
      return;
    }

    model.pushEditOperations(
      [],
      edits.map((textEdit) => ({
        range: toMonacoRange(monaco, textEdit.range),
        text: textEdit.newText,
      })),
      () => null,
    );
    editedOpenPaths.push(path);
  });

  return editedOpenPaths;
}

async function applyWorkspaceEditWithOpenModels(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  edit: LanguageServerWorkspaceEdit,
  rootPath?: string,
): Promise<void> {
  const scopedEdit = workspaceEditForRoot(edit, rootPath);
  const editedOpenPaths = applyWorkspaceEditToOpenModels(monaco, scopedEdit);

  await context.applyWorkspaceEdit?.(scopedEdit, {
    editedOpenPaths,
    rootPath,
  });
}

async function applyWorkspaceEditAfterMonacoEdit(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  edit: LanguageServerWorkspaceEdit,
  rootPath?: string,
): Promise<void> {
  const scopedEdit = workspaceEditForRoot(edit, rootPath);

  await context.applyWorkspaceEdit?.(scopedEdit, {
    editedOpenPaths: openModelPathsForWorkspaceEdit(monaco, scopedEdit),
    rootPath,
  });
}

async function applyWorkspaceEditEvent(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  event: LanguageServerWorkspaceEditEvent,
): Promise<void> {
  if (!isWorkspaceEditEventActive(context, event)) {
    return;
  }

  await applyWorkspaceEditWithOpenModels(
    monaco,
    context,
    event.edit,
    event.rootPath ?? undefined,
  );
}

function isWorkspaceEditEventActive(
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  event: LanguageServerWorkspaceEditEvent,
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
    (!status.rootPath || workspaceRootKeysEqual(status.rootPath, workspaceRoot))
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
    (!status.rootPath || workspaceRootKeysEqual(status.rootPath, workspaceRoot))
  );
}

function openModelPathsForWorkspaceEdit(
  monaco: MonacoApi,
  edit: LanguageServerWorkspaceEdit,
): string[] {
  const editPaths = new Set(
    Object.keys(edit.changes).flatMap((uri) => {
      const path = pathFromLanguageServerUri(uri);

      return path ? [path] : [];
    }),
  );

  return monaco.editor
    .getModels()
    .flatMap((model) => {
      const path = modelPath(model);

      return path && editPaths.has(path) ? [path] : [];
    });
}

function workspaceEditForRoot(
  edit: LanguageServerWorkspaceEdit,
  rootPath?: string,
): LanguageServerWorkspaceEdit {
  if (!rootPath) {
    return edit;
  }

  const changes = Object.fromEntries(
    Object.entries(edit.changes).filter(([uri]) => {
      const path = pathFromLanguageServerUri(uri);

      return path ? isPathInWorkspaceRoot(rootPath, path) : false;
    }),
  );
  const fileOperations = (edit.fileOperations ?? []).filter((operation) =>
    isFileOperationInWorkspaceRoot(operation, rootPath),
  );

  return {
    ...(fileOperations.length > 0 ? { fileOperations } : {}),
    changes,
  };
}

function isFileOperationInWorkspaceRoot(
  operation: LanguageServerWorkspaceFileOperation,
  rootPath?: string,
): boolean {
  if (!rootPath) {
    return true;
  }

  return fileOperationUris(operation).every((uri) => {
    const path = pathFromLanguageServerUri(uri);

    return path ? isPathInWorkspaceRoot(rootPath, path) : false;
  });
}

function fileOperationUris(
  operation: LanguageServerWorkspaceFileOperation,
): string[] {
  if (operation.kind === "rename") {
    return [operation.oldUri, operation.newUri];
  }

  return [operation.uri];
}

function isPathInWorkspaceRoot(rootPath: string, path: string): boolean {
  const normalizedRootPath = normalizedWorkspacePath(rootPath);
  const normalizedPath = normalizedWorkspacePath(path);

  return (
    normalizedPath === normalizedRootPath ||
    normalizedPath.startsWith(`${normalizedRootPath}/`)
  );
}

function normalizedWorkspacePath(path: string): string {
  return path.trim().split("\\").join("/").replace(/\/+$/, "");
}

function toMonacoCompletionItem(
  monaco: MonacoApi,
  item: LanguageServerCompletionItem,
  rootPath: string,
  sessionId: number,
  sourcePath: string | undefined,
  fallbackRange: Monaco.IRange | Monaco.languages.CompletionItemRanges,
  fallbackSortText?: string,
): LanguageServerBackedCompletionItem {
  const kind = monacoCompletionKindFromLspKind(monaco, item.kind);
  const insert = completionInsert(monaco, item, kind);
  const additionalTextEdits =
    item.additionalTextEdits && item.additionalTextEdits.length > 0
      ? item.additionalTextEdits.map((edit) => toMonacoTextEdit(monaco, edit))
      : undefined;

  return {
    __completionRange: fallbackRange,
    __languageServerItem: item,
    __languageServerSessionId: sessionId,
    __sourcePath: sourcePath,
    __workspaceRoot: rootPath,
    ...(additionalTextEdits ? { additionalTextEdits } : {}),
    ...(item.commitCharacters && item.commitCharacters.length > 0
      ? { commitCharacters: item.commitCharacters }
      : {}),
    detail: item.detail || undefined,
    documentation: toMonacoCompletionDocumentation(item),
    filterText: item.filterText || undefined,
    insertText: insert.insertText,
    ...(item.command
      ? {
          command: toMonacoLanguageServerCommand(
            rootPath,
            sessionId,
            sourcePath,
            item.command,
          ),
        }
      : insert.command
        ? { command: insert.command }
        : {}),
    ...(insert.insertTextRules ? { insertTextRules: insert.insertTextRules } : {}),
    kind,
    label: completionLabel(item),
    ...(item.preselect ? { preselect: true } : {}),
    range: item.textEdit
      ? toMonacoCompletionRange(monaco, item.textEdit, fallbackRange)
      : fallbackRange,
    sortText: item.sortText ?? fallbackSortText,
    ...(isDeprecatedCompletionItem(item)
      ? { tags: [monaco.languages.CompletionItemTag.Deprecated] }
      : {}),
  };
}

function toMonacoLanguageServerCommand(
  rootPath: string,
  sessionId: number,
  sourcePath: string | undefined,
  command: LanguageServerCodeActionCommand,
): Monaco.languages.Command {
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

function isDeprecatedCompletionItem(item: LanguageServerCompletionItem): boolean {
  return Boolean(item.deprecated || item.tags?.includes(1));
}

function completionLabel(
  item: LanguageServerCompletionItem,
): string | Monaco.languages.CompletionItemLabel {
  if (!item.labelDetails) {
    return item.label;
  }

  return {
    ...(item.labelDetails.description
      ? { description: item.labelDetails.description }
      : {}),
    ...(item.labelDetails.detail ? { detail: item.labelDetails.detail } : {}),
    label: item.label,
  };
}

function toMonacoCompletionDocumentation(
  item: LanguageServerCompletionItem,
): string | Monaco.IMarkdownString | undefined {
  if (!item.documentation) {
    return undefined;
  }

  if (item.documentationKind === "markdown") {
    return { value: item.documentation };
  }

  return item.documentation;
}

function toMonacoCompletionRange(
  monaco: MonacoApi,
  edit: LanguageServerCompletionTextEdit,
  fallbackRange: Monaco.IRange | Monaco.languages.CompletionItemRanges,
): Monaco.IRange | Monaco.languages.CompletionItemRanges {
  if (edit.insert && edit.replace) {
    return {
      insert: toMonacoRange(monaco, edit.insert),
      replace: toMonacoRange(monaco, edit.replace),
    };
  }

  if (edit.range) {
    return toMonacoRange(monaco, edit.range);
  }

  return fallbackRange;
}

function completionInsert(
  monaco: MonacoApi,
  item: {
    detail: string | null;
    insertText: string | null;
    insertTextFormat?: number | null;
    insertTextMode?: number | null;
    kind: number | null;
    label: string;
    labelDetails?: {
      description?: string | null;
      detail?: string | null;
    } | null;
    textEdit?: LanguageServerCompletionTextEdit | null;
    textEditText?: string | null;
  },
  kind: Monaco.languages.CompletionItemKind,
): {
  command?: Monaco.languages.Command;
  insertText: string;
  insertTextRules?: Monaco.languages.CompletionItemInsertTextRule;
} {
  const insertText =
    item.textEdit?.newText || item.textEditText || item.insertText || item.label;
  const keepWhitespaceRule =
    item.insertTextMode === 1
      ? monaco.languages.CompletionItemInsertTextRule.KeepWhitespace
      : 0;

  if (item.insertTextFormat === 2 || /\$(?:\d+|\{)/.test(insertText)) {
    return {
      insertText,
      insertTextRules:
        monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet |
        keepWhitespaceRule,
    };
  }

  if (
    kind !== monaco.languages.CompletionItemKind.Method &&
    kind !== monaco.languages.CompletionItemKind.Function
  ) {
    return {
      insertText,
      ...(keepWhitespaceRule ? { insertTextRules: keepWhitespaceRule } : {}),
    };
  }

  const name = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(insertText.trim())?.[0];

  if (!name) {
    return {
      insertText,
      ...(keepWhitespaceRule ? { insertTextRules: keepWhitespaceRule } : {}),
    };
  }

  const hasKnownParameters = [item.detail, item.labelDetails?.detail].some((detail) =>
    hasCompletionParameters(detail || "", name),
  );

  return {
    command: hasKnownParameters
      ? {
          id: "editor.action.triggerParameterHints",
          title: "Trigger parameter hints",
        }
      : undefined,
    insertText: hasKnownParameters ? `${name}($0)` : `${name}()$0`,
    insertTextRules:
      monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet |
      keepWhitespaceRule,
  };
}

function hasCompletionParameters(detail: string, name: string): boolean {
  return hasNamedCompletionParameters(detail, name) || hasLabelDetailParameters(detail);
}

function hasNamedCompletionParameters(detail: string, name: string): boolean {
  const match = new RegExp(
    `${escapeRegExp(name)}\\s*(?:<[^()]*>\\s*)?\\(([^)]*)\\)`,
  ).exec(detail);

  return Boolean(match?.[1].trim());
}

function hasLabelDetailParameters(detail: string): boolean {
  const match = /^\s*(?:<[^()]*>\s*)?\(([^)]*)\)/.exec(detail);

  return Boolean(match?.[1].trim());
}

function monacoCompletionKindFromLspKind(
  monaco: MonacoApi,
  kind: number | null | undefined,
): Monaco.languages.CompletionItemKind {
  switch (kind) {
    case 2:
      return monaco.languages.CompletionItemKind.Method;
    case 3:
      return monaco.languages.CompletionItemKind.Function;
    case 5:
      return monaco.languages.CompletionItemKind.Field;
    case 6:
      return monaco.languages.CompletionItemKind.Variable;
    case 7:
      return monaco.languages.CompletionItemKind.Class;
    case 8:
      return monaco.languages.CompletionItemKind.Interface;
    case 9:
      return monaco.languages.CompletionItemKind.Module;
    case 10:
      return monaco.languages.CompletionItemKind.Property;
    case 12:
      return monaco.languages.CompletionItemKind.Value;
    case 13:
      return monaco.languages.CompletionItemKind.Enum;
    case 14:
      return monaco.languages.CompletionItemKind.Keyword;
    case 15:
      return monaco.languages.CompletionItemKind.Snippet;
    case 17:
      return monaco.languages.CompletionItemKind.File;
    case 20:
      return monaco.languages.CompletionItemKind.EnumMember;
    case 21:
      return monaco.languages.CompletionItemKind.Constant;
    default:
      return monaco.languages.CompletionItemKind.Text;
  }
}

function modelPath(model: MonacoModel): string {
  return model.uri.fsPath || model.uri.path;
}

function isJavaScriptTypeScriptDocument(document: EditorDocument): boolean {
  return JAVASCRIPT_TYPESCRIPT_LANGUAGE_ID_SET.has(document.language);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
