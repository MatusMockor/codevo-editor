import type * as Monaco from "monaco-editor";
import {
  canUseLanguageServerFeature,
  pathFromLanguageServerUri,
  toLanguageServerTextDocumentPosition,
  type LanguageServerCodeAction,
  type LanguageServerCodeActionCommand,
  type LanguageServerCodeActionContext,
  type LanguageServerCodeLens,
  type LanguageServerCompletionItem,
  type LanguageServerCompletionTextEdit,
  type LanguageServerDocumentHighlight,
  type LanguageServerDocumentLink,
  type LanguageServerFeaturesGateway,
  type LanguageServerFoldingRange,
  type LanguageServerFormattingOptions,
  type LanguageServerInlayHint,
  type LanguageServerLinkedEditingRanges,
  type LanguageServerLocation,
  type LanguageServerRange,
  type LanguageServerSelectionRange,
  type LanguageServerSemanticTokens,
  type LanguageServerSignature,
  type LanguageServerSignatureHelp,
  type LanguageServerSignatureParameter,
  type LanguageServerTextEdit,
  type LanguageServerWorkspaceEdit,
  type LanguageServerWorkspaceEditEvent,
  type LanguageServerWorkspaceEditGateway,
} from "../domain/languageServerFeatures";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import type { EditorDocument } from "../domain/workspace";

type MonacoApi = typeof Monaco;
type MonacoModel = Monaco.editor.ITextModel;
type MonacoPosition = Monaco.Position;
type Disposable = Monaco.IDisposable;
type WorkspaceEditContext = {
  path: string;
  versionId: number | undefined;
};

interface LanguageServerBackedCodeAction extends Monaco.languages.CodeAction {
  __languageServerAction?: LanguageServerCodeAction;
  __workspaceEditContext?: WorkspaceEditContext;
  __workspaceRoot?: string;
}

interface LanguageServerBackedCodeLens extends Monaco.languages.CodeLens {
  __languageServerCodeLens?: LanguageServerCodeLens;
  __workspaceRoot?: string;
}

interface LanguageServerBackedCompletionItem
  extends Monaco.languages.CompletionItem {
  __completionRange?: Monaco.IRange | Monaco.languages.CompletionItemRanges;
  __languageServerItem?: LanguageServerCompletionItem;
  __workspaceRoot?: string;
}

interface LanguageServerBackedLink extends Monaco.languages.ILink {
  __languageServerLink?: LanguageServerDocumentLink;
  __workspaceRoot?: string;
}

interface ExecuteCommandPayload {
  command: LanguageServerCodeActionCommand;
  rootPath: string;
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
  featuresGateway: LanguageServerFeaturesGateway;
  flushPendingDocumentChange(path: string): Promise<void>;
  getActiveDocument(): EditorDocument | null;
  getRuntimeStatus(): LanguageServerRuntimeStatus | null;
  getWorkspaceRoot?(): string | null;
  reportError(error: unknown): void;
  workspaceEditGateway?: LanguageServerWorkspaceEditGateway;
}

export function registerJavaScriptTypeScriptLanguageServerMonacoProviders(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
): Disposable {
  const languages = JAVASCRIPT_TYPESCRIPT_LANGUAGE_IDS;
  const registry = monaco.languages as Partial<typeof monaco.languages>;
  const disposables: Disposable[] = [];
  let workspaceEditUnsubscribe: (() => void) | null = null;
  let workspaceEditSubscriptionDisposed = false;
  const workspaceEditSubscriptionDisposable = {
    dispose: () => {
      workspaceEditSubscriptionDisposed = true;
      workspaceEditUnsubscribe?.();
      workspaceEditUnsubscribe = null;
    },
  };

  if (context.workspaceEditGateway) {
    disposables.push(workspaceEditSubscriptionDisposable);
    context.workspaceEditGateway
      .subscribeWorkspaceEdits((event) => {
        applyWorkspaceEditEvent(monaco, context, event);
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

      try {
        const edit = await context.featuresGateway.executeCommand(
          payload.rootPath,
          payload.command,
        );

        if (edit) {
          applyWorkspaceEditToOpenModels(monaco, edit);
        }
      } catch (error) {
        context.reportError(error);
      }
    },
  });
  disposables.push(commandDisposable);

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
          triggerCharacters: [".", "'", "\"", "/", "@", "<", "#"],
          provideCompletionItems: (model, position) =>
            provideCompletionItems(monaco, context, model, position),
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
          provideSignatureHelp: (model, position) =>
            provideSignatureHelp(monaco, context, model, position),
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
              "source",
              "source.fixAll",
              "source.organizeImports",
            ],
          },
        ),
      );
    }

    if (registry.registerCodeLensProvider) {
      disposables.push(
        registry.registerCodeLensProvider(language, {
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

    if (registry.registerInlayHintsProvider) {
      disposables.push(
        registry.registerInlayHintsProvider(language, {
          provideInlayHints: (model, range) =>
            provideInlayHints(monaco, context, model, range),
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
          getLegend: () => JAVASCRIPT_TYPESCRIPT_SEMANTIC_TOKENS_LEGEND,
          provideDocumentSemanticTokens: (model) =>
            provideDocumentSemanticTokens(context, model),
          releaseDocumentSemanticTokens: () => undefined,
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
    await context.flushPendingDocumentChange(request.path);
    const hover = await context.featuresGateway.hover(
      request.rootPath,
      request.position,
    );

    return hover ? { contents: [{ value: hover.contents }] } : null;
  } catch (error) {
    context.reportError(error);
    return null;
  }
}

async function provideCompletionItems(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Promise<Monaco.languages.CompletionList> {
  const request = featureRequestContext(context, model, position, "completion");

  if (!request) {
    return { suggestions: [] };
  }

  try {
    await context.flushPendingDocumentChange(request.path);
    const completion = await context.featuresGateway.completion(
      request.rootPath,
      request.position,
    );
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
          range,
          `0_${String(index).padStart(4, "0")}`,
        );
      }),
    };
  } catch (error) {
    context.reportError(error);
    return { suggestions: [] };
  }
}

async function resolveCompletionItem(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  item: Monaco.languages.CompletionItem,
): Promise<Monaco.languages.CompletionItem> {
  const backedItem = item as LanguageServerBackedCompletionItem;

  if (!backedItem.__languageServerItem || !backedItem.__workspaceRoot) {
    return item;
  }

  try {
    const resolved = await context.featuresGateway.resolveCompletionItem(
      backedItem.__workspaceRoot,
      backedItem.__languageServerItem,
    );

    return {
      ...item,
      ...toMonacoCompletionItem(
        monaco,
        resolved,
        backedItem.__workspaceRoot,
        backedItem.__completionRange ?? item.range,
        item.sortText,
      ),
    };
  } catch (error) {
    context.reportError(error);
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
    await context.flushPendingDocumentChange(request.path);
    const locations = await context.featuresGateway.definition(
      request.rootPath,
      request.position,
    );

    return toMonacoLocations(monaco, locations);
  } catch (error) {
    context.reportError(error);
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
    await context.flushPendingDocumentChange(request.path);
    const locations = await context.featuresGateway.implementation(
      request.rootPath,
      request.position,
    );

    return toMonacoLocations(monaco, locations);
  } catch (error) {
    context.reportError(error);
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
    await context.flushPendingDocumentChange(request.path);
    const locations = await context.featuresGateway.typeDefinition(
      request.rootPath,
      request.position,
    );

    return toMonacoLocations(monaco, locations);
  } catch (error) {
    context.reportError(error);
    return null;
  }
}

async function provideSignatureHelp(
  _monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Promise<Monaco.languages.SignatureHelpResult | null> {
  const request = featureRequestContext(context, model, position, "signatureHelp");

  if (!request) {
    return null;
  }

  try {
    await context.flushPendingDocumentChange(request.path);
    const signatureHelp = await context.featuresGateway.signatureHelp(
      request.rootPath,
      request.position,
    );

    return signatureHelp ? toMonacoSignatureHelp(signatureHelp) : null;
  } catch (error) {
    context.reportError(error);
    return null;
  }
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
    await context.flushPendingDocumentChange(request.path);
    const locations = await context.featuresGateway.references(
      request.rootPath,
      request.position,
    );

    return toMonacoLocations(monaco, locations);
  } catch (error) {
    context.reportError(error);
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
    await context.flushPendingDocumentChange(request.path);
    const highlights = await context.featuresGateway.documentHighlights(
      request.rootPath,
      request.position,
    );

    return highlights.map((highlight) =>
      toMonacoDocumentHighlight(monaco, highlight),
    );
  } catch (error) {
    context.reportError(error);
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
    await context.flushPendingDocumentChange(request.path);
    const links = await context.featuresGateway.documentLinks(
      request.rootPath,
      request.path,
    );

    return {
      dispose: () => undefined,
      links: links.map((link) =>
        toMonacoDocumentLink(monaco, request.rootPath, link),
      ),
    };
  } catch (error) {
    context.reportError(error);
    return emptyLinksList();
  }
}

async function resolveDocumentLink(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  link: Monaco.languages.ILink,
): Promise<Monaco.languages.ILink> {
  const backedLink = link as LanguageServerBackedLink;

  if (!backedLink.__languageServerLink || !backedLink.__workspaceRoot) {
    return link;
  }

  try {
    const resolved = await context.featuresGateway.resolveDocumentLink(
      backedLink.__workspaceRoot,
      backedLink.__languageServerLink,
    );

    return {
      ...link,
      ...toMonacoDocumentLink(monaco, backedLink.__workspaceRoot, resolved),
    };
  } catch (error) {
    context.reportError(error);
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
    await context.flushPendingDocumentChange(request.path);
    const ranges = await context.featuresGateway.foldingRanges(
      request.rootPath,
      request.path,
    );

    return ranges.map((range) => toMonacoFoldingRange(monaco, range));
  } catch (error) {
    context.reportError(error);
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
    await context.flushPendingDocumentChange(request.path);
    const edit = await context.featuresGateway.rename(
      request.rootPath,
      request.position,
      newName,
    );

    return edit
      ? toMonacoWorkspaceEdit(monaco, workspaceEditContext(model), edit)
      : null;
  } catch (error) {
    context.reportError(error);
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
    await context.flushPendingDocumentChange(request.path);
    const selectionRanges = await context.featuresGateway.selectionRanges(
      request.rootPath,
      request.path,
      positions.map((position) => ({
        character: Math.max(0, position.column - 1),
        line: Math.max(0, position.lineNumber - 1),
      })),
    );

    return selectionRanges.map((selectionRange) =>
      flattenSelectionRange(monaco, selectionRange),
    );
  } catch (error) {
    context.reportError(error);
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
    await context.flushPendingDocumentChange(request.path);
    return toMonacoSemanticTokens(
      await context.featuresGateway.semanticTokens(request.rootPath, request.path),
    );
  } catch (error) {
    context.reportError(error);
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
    await context.flushPendingDocumentChange(request.path);
    return toMonacoLinkedEditingRanges(
      monaco,
      await context.featuresGateway.linkedEditingRanges(
        request.rootPath,
        request.position,
      ),
    );
  } catch (error) {
    context.reportError(error);
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
    await context.flushPendingDocumentChange(request.path);
    const prepareRename = await context.featuresGateway.prepareRename(
      request.rootPath,
      request.position,
    );

    if (!prepareRename?.range || prepareRename.defaultBehavior) {
      return defaultRenameLocation(model, position);
    }

    const range = toMonacoRange(monaco, prepareRename.range);

    return {
      range,
      text: prepareRename.placeholder ?? model.getValueInRange(range),
    };
  } catch (error) {
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
    await context.flushPendingDocumentChange(request.path);
    const actions = await context.featuresGateway.codeActions(
      request.rootPath,
      request.path,
      toLanguageServerRange(range),
      toLanguageServerCodeActionContext(monaco, actionContext),
    );

    return {
      actions: actions.flatMap((action) =>
        toMonacoCodeAction(
          monaco,
          workspaceEditContext(model),
          request.rootPath,
          action,
          actionContext,
        ),
      ),
      dispose: () => undefined,
    };
  } catch (error) {
    context.reportError(error);
    return emptyCodeActionList();
  }
}

async function resolveCodeAction(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  action: Monaco.languages.CodeAction,
): Promise<Monaco.languages.CodeAction> {
  const backedAction = action as LanguageServerBackedCodeAction;

  if (!backedAction.__languageServerAction || !backedAction.__workspaceRoot) {
    return action;
  }

  try {
    const resolved = await context.featuresGateway.resolveCodeAction(
      backedAction.__workspaceRoot,
      backedAction.__languageServerAction,
    );
    const [mapped] = toMonacoCodeAction(
      monaco,
      backedAction.__workspaceEditContext ?? {
        path: "",
        versionId: undefined,
      },
      backedAction.__workspaceRoot,
      resolved,
      {
        markers: action.diagnostics ?? [],
        only: action.kind ?? undefined,
        trigger: monaco.languages.CodeActionTriggerType.Invoke,
      },
    );

    return mapped ? { ...action, ...mapped } : action;
  } catch (error) {
    context.reportError(error);
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
    await context.flushPendingDocumentChange(request.path);
    const lenses = await context.featuresGateway.codeLenses(
      request.rootPath,
      request.path,
    );

    return {
      lenses: lenses.map((lens) =>
        toMonacoCodeLens(monaco, request.rootPath, lens),
      ),
      dispose: () => undefined,
    };
  } catch (error) {
    context.reportError(error);
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
    !backedCodeLens.__workspaceRoot
  ) {
    return codeLens;
  }

  try {
    const resolved = await context.featuresGateway.resolveCodeLens(
      backedCodeLens.__workspaceRoot,
      backedCodeLens.__languageServerCodeLens,
    );

    return {
      ...codeLens,
      ...toMonacoCodeLens(monaco, backedCodeLens.__workspaceRoot, resolved),
    };
  } catch (error) {
    context.reportError(error);
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
    await context.flushPendingDocumentChange(request.path);
    const edits = await context.featuresGateway.formatting(
      request.rootPath,
      request.path,
      toLanguageServerFormattingOptions(options),
    );

    return edits.map((edit) => toMonacoTextEdit(monaco, edit));
  } catch (error) {
    context.reportError(error);
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
    await context.flushPendingDocumentChange(request.path);
    const edits = await context.featuresGateway.rangeFormatting(
      request.rootPath,
      request.path,
      toLanguageServerRange(range),
      toLanguageServerFormattingOptions(options),
    );

    return edits.map((edit) => toMonacoTextEdit(monaco, edit));
  } catch (error) {
    context.reportError(error);
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
    await context.flushPendingDocumentChange(request.path);
    const hints = await context.featuresGateway.inlayHints(
      request.rootPath,
      request.path,
      toLanguageServerRange(range),
    );

    return {
      hints: hints.map((hint) => toMonacoInlayHint(monaco, hint)),
      dispose: () => undefined,
    };
  } catch (error) {
    context.reportError(error);
    return emptyInlayHintList();
  }
}

function featureRequestContext(
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
  feature:
    | "completion"
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
  const status = context.getRuntimeStatus();

  if (
    status?.kind !== "running" ||
    !canUseLanguageServerFeature(status.capabilities, feature)
  ) {
    return null;
  }

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

  return {
    path: activeDocument.path,
    position: toLanguageServerTextDocumentPosition(activeDocument.path, {
      column: position.column,
      lineNumber: position.lineNumber,
    }),
    rootPath,
  };
}

function documentRequestContext(
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  model: MonacoModel,
  feature:
    | "codeLens"
    | "codeAction"
    | "documentLink"
    | "foldingRange"
    | "formatting"
    | "inlayHint"
    | "rangeFormatting"
    | "selectionRange"
    | "semanticTokens",
) {
  const status = context.getRuntimeStatus();

  if (
    status?.kind !== "running" ||
    !canUseLanguageServerFeature(status.capabilities, feature)
  ) {
    return null;
  }

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

  return {
    path: activeDocument.path,
    rootPath,
  };
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
  link: LanguageServerDocumentLink,
): LanguageServerBackedLink {
  return {
    __languageServerLink: link,
    __workspaceRoot: rootPath,
    range: toMonacoRange(monaco, link.range),
    ...(link.target ? { url: link.target } : {}),
    ...(link.tooltip ? { tooltip: link.tooltip } : {}),
  };
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
  lens: LanguageServerCodeLens,
): LanguageServerBackedCodeLens {
  return {
    __languageServerCodeLens: lens,
    __workspaceRoot: rootPath,
    ...(lens.command
      ? { command: toMonacoCodeLensCommand(monaco, rootPath, lens.command) }
      : {}),
    range: toMonacoRange(monaco, lens.range),
  };
}

function toMonacoCodeLensCommand(
  monaco: MonacoApi,
  rootPath: string,
  command: LanguageServerCodeActionCommand,
): Monaco.languages.Command {
  if (command.command === "editor.action.showReferences") {
    return {
      arguments: toShowReferencesArguments(monaco, command.arguments ?? []),
      id: command.command,
      title: command.title,
    };
  }

  return {
    arguments: [
      {
        command,
        rootPath,
      } satisfies ExecuteCommandPayload,
    ],
    id: EXECUTE_LANGUAGE_SERVER_COMMAND_ID,
    title: command.title || command.command,
  };
}

function toShowReferencesArguments(
  monaco: MonacoApi,
  args: unknown[],
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
      ? toMonacoLocations(monaco, locations as LanguageServerLocation[])
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
): Monaco.languages.Location[] {
  return locations.flatMap((location) => {
    const path = pathFromLanguageServerUri(location.uri);

    if (!path) {
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
): Monaco.languages.WorkspaceEdit {
  return {
    edits: Object.entries(edit.changes).flatMap(([uri, edits]) => {
      const path = pathFromLanguageServerUri(uri);

      if (!path) {
        return [];
      }

      const resource = monaco.Uri.file(path);
      const versionId = context.path === path ? context.versionId : undefined;

      return edits.map((textEdit) => ({
        resource,
        textEdit: toMonacoTextEdit(monaco, textEdit),
        versionId,
      }));
    }),
  };
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
  action: LanguageServerCodeAction,
  context: Monaco.languages.CodeActionContext,
): Monaco.languages.CodeAction[] {
  if (!action.edit && !action.command && action.data == null) {
    return [];
  }

  const codeAction: LanguageServerBackedCodeAction = {
    __languageServerAction: action,
    __workspaceEditContext: editContext,
    __workspaceRoot: rootPath,
    diagnostics: context.markers,
    ...(action.command
      ? {
          command: {
            arguments: [
              {
                command: action.command,
                rootPath,
              } satisfies ExecuteCommandPayload,
            ],
            id: EXECUTE_LANGUAGE_SERVER_COMMAND_ID,
            title: action.command.title || action.title,
          },
        }
      : {}),
    ...(action.edit
      ? { edit: toMonacoWorkspaceEdit(monaco, editContext, action.edit) }
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
): Monaco.languages.InlayHint {
  return {
    kind: monacoInlayHintKindFromLspKind(monaco, hint.kind),
    label: hint.label,
    paddingLeft: hint.paddingLeft,
    paddingRight: hint.paddingRight,
    position: {
      column: hint.position.character + 1,
      lineNumber: hint.position.line + 1,
    },
    tooltip: hint.tooltip || undefined,
  };
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
): void {
  const modelsByPath = new Map(
    monaco.editor.getModels().map((model) => [modelPath(model), model]),
  );

  Object.entries(edit.changes).forEach(([uri, edits]) => {
    const path = pathFromLanguageServerUri(uri);
    const model = path ? modelsByPath.get(path) : null;

    if (!model) {
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
  });
}

function applyWorkspaceEditEvent(
  monaco: MonacoApi,
  context: JavaScriptTypeScriptLanguageServerProviderContext,
  event: LanguageServerWorkspaceEditEvent,
): void {
  const workspaceRoot = context.getWorkspaceRoot?.() ?? null;

  if (event.rootPath && workspaceRoot && event.rootPath !== workspaceRoot) {
    return;
  }

  applyWorkspaceEditToOpenModels(monaco, event.edit);
}

function toMonacoCompletionItem(
  monaco: MonacoApi,
  item: LanguageServerCompletionItem,
  rootPath: string,
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
    __workspaceRoot: rootPath,
    ...(additionalTextEdits ? { additionalTextEdits } : {}),
    ...(item.commitCharacters && item.commitCharacters.length > 0
      ? { commitCharacters: item.commitCharacters }
      : {}),
    detail: item.detail || undefined,
    documentation: item.documentation || undefined,
    filterText: item.filterText || undefined,
    insertText: insert.insertText,
    ...(insert.command ? { command: insert.command } : {}),
    ...(insert.insertTextRules ? { insertTextRules: insert.insertTextRules } : {}),
    kind,
    label: completionLabel(item),
    ...(item.preselect ? { preselect: true } : {}),
    range: item.textEdit
      ? toMonacoCompletionRange(monaco, item.textEdit, fallbackRange)
      : fallbackRange,
    sortText: item.sortText ?? fallbackSortText,
  };
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
    kind: number | null;
    label: string;
    textEdit?: LanguageServerCompletionTextEdit | null;
  },
  kind: Monaco.languages.CompletionItemKind,
): {
  command?: Monaco.languages.Command;
  insertText: string;
  insertTextRules?: Monaco.languages.CompletionItemInsertTextRule;
} {
  const insertText = item.textEdit?.newText || item.insertText || item.label;

  if (item.insertTextFormat === 2 || /\$(?:\d+|\{)/.test(insertText)) {
    return {
      insertText,
      insertTextRules:
        monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    };
  }

  if (
    kind !== monaco.languages.CompletionItemKind.Method &&
    kind !== monaco.languages.CompletionItemKind.Function
  ) {
    return { insertText };
  }

  const name = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(insertText.trim())?.[0];

  if (!name) {
    return { insertText };
  }

  const hasKnownParameters = hasParameters(item.detail || "", name);

  return {
    command: hasKnownParameters
      ? {
          id: "editor.action.triggerParameterHints",
          title: "Trigger parameter hints",
        }
      : undefined,
    insertText: hasKnownParameters ? `${name}($0)` : `${name}()$0`,
    insertTextRules:
      monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  };
}

function hasParameters(detail: string, name: string): boolean {
  const match = new RegExp(`${escapeRegExp(name)}\\s*\\(([^)]*)\\)`).exec(
    detail,
  );

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
