import type * as Monaco from "monaco-editor";

type Disposable = Monaco.IDisposable;
type MonacoEvent<T> = (
  listener: (event: T) => unknown,
  thisArgs?: unknown,
  disposables?: Disposable[],
) => Disposable;

export interface JavaScriptTypeScriptMonacoEventEmitter<T> {
  dispose(): void;
  event: MonacoEvent<T>;
  fire(event: T): void;
}

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
  registerWorkspaceSymbolProvider?(provider: MonacoWorkspaceSymbolProvider): Disposable;
};

export interface JavaScriptTypeScriptMonacoProviderBindings {
  readonly codeAction: Monaco.languages.CodeActionProvider;
  readonly codeLens: Monaco.languages.CodeLensProvider;
  readonly completion: Monaco.languages.CompletionItemProvider;
  readonly declaration: Monaco.languages.DeclarationProvider;
  readonly definition: Monaco.languages.DefinitionProvider;
  readonly documentFormatting: Monaco.languages.DocumentFormattingEditProvider;
  readonly documentHighlight: Monaco.languages.DocumentHighlightProvider;
  readonly documentRangeFormatting: Monaco.languages.DocumentRangeFormattingEditProvider;
  readonly documentRangeSemanticTokens: Monaco.languages.DocumentRangeSemanticTokensProvider;
  readonly documentSemanticTokens: Monaco.languages.DocumentSemanticTokensProvider;
  readonly documentSymbol: Monaco.languages.DocumentSymbolProvider;
  readonly foldingRange: Monaco.languages.FoldingRangeProvider;
  readonly hover: Monaco.languages.HoverProvider;
  readonly implementation: Monaco.languages.ImplementationProvider;
  readonly inlayHints: Monaco.languages.InlayHintsProvider;
  readonly linkedEditingRange: Monaco.languages.LinkedEditingRangeProvider;
  readonly links: Monaco.languages.LinkProvider;
  readonly onTypeFormatting: Monaco.languages.OnTypeFormattingEditProvider;
  readonly references: Monaco.languages.ReferenceProvider;
  readonly rename: Monaco.languages.RenameProvider;
  readonly selectionRange: Monaco.languages.SelectionRangeProvider;
  readonly signatureHelp: Monaco.languages.SignatureHelpProvider;
  readonly typeDefinition: Monaco.languages.TypeDefinitionProvider;
  readonly workspaceSymbols: MonacoWorkspaceSymbolProvider;
}

const JAVASCRIPT_TYPESCRIPT_LANGUAGE_IDS = [
  "javascript",
  "typescript",
  "javascriptreact",
  "typescriptreact",
  // Vue single-file components use the same tsserver. Without the optional
  // Vue plugin the server returns no result, so registration remains safe.
  "vue",
] as const;

const JAVASCRIPT_TYPESCRIPT_LANGUAGE_ID_SET = new Set<string>(JAVASCRIPT_TYPESCRIPT_LANGUAGE_IDS);

const JAVASCRIPT_TYPESCRIPT_CODE_ACTION_KINDS = [
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
] as const;

export function isJavaScriptTypeScriptMonacoLanguage(language: string): boolean {
  return JAVASCRIPT_TYPESCRIPT_LANGUAGE_ID_SET.has(language);
}

export function createJavaScriptTypeScriptMonacoEventEmitter<
  T,
>(): JavaScriptTypeScriptMonacoEventEmitter<T> {
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

export function registerJavaScriptTypeScriptMonacoProviderBindings(
  monaco: typeof Monaco,
  providers: JavaScriptTypeScriptMonacoProviderBindings,
): readonly Disposable[] {
  const registry = monaco.languages as Partial<typeof monaco.languages>;
  const disposables: Disposable[] = [];
  const workspaceSymbolRegistry = registry as MonacoWorkspaceSymbolRegistry;

  if (workspaceSymbolRegistry.registerWorkspaceSymbolProvider) {
    disposables.push(
      workspaceSymbolRegistry.registerWorkspaceSymbolProvider(providers.workspaceSymbols),
    );
  }

  for (const language of JAVASCRIPT_TYPESCRIPT_LANGUAGE_IDS) {
    registerLanguageProviders(registry, disposables, language, providers);
  }

  return disposables;
}

function registerLanguageProviders(
  registry: Partial<typeof Monaco.languages>,
  disposables: Disposable[],
  language: string,
  providers: JavaScriptTypeScriptMonacoProviderBindings,
): void {
  registerProvider(
    registry.registerHoverProvider?.bind(registry),
    disposables,
    language,
    providers.hover,
  );
  registerProvider(
    registry.registerCompletionItemProvider?.bind(registry),
    disposables,
    language,
    providers.completion,
  );
  registerProvider(
    registry.registerSignatureHelpProvider?.bind(registry),
    disposables,
    language,
    providers.signatureHelp,
  );
  registerProvider(
    registry.registerDefinitionProvider?.bind(registry),
    disposables,
    language,
    providers.definition,
  );
  registerProvider(
    registry.registerDeclarationProvider?.bind(registry),
    disposables,
    language,
    providers.declaration,
  );
  registerProvider(
    registry.registerImplementationProvider?.bind(registry),
    disposables,
    language,
    providers.implementation,
  );
  registerProvider(
    registry.registerTypeDefinitionProvider?.bind(registry),
    disposables,
    language,
    providers.typeDefinition,
  );
  registerProvider(
    registry.registerReferenceProvider?.bind(registry),
    disposables,
    language,
    providers.references,
  );
  registerProvider(
    registry.registerRenameProvider?.bind(registry),
    disposables,
    language,
    providers.rename,
  );

  if (registry.registerCodeActionProvider) {
    disposables.push(
      registry.registerCodeActionProvider(language, providers.codeAction, {
        providedCodeActionKinds: [...JAVASCRIPT_TYPESCRIPT_CODE_ACTION_KINDS],
      }),
    );
  }

  registerProvider(
    registry.registerCodeLensProvider?.bind(registry),
    disposables,
    language,
    providers.codeLens,
  );
  registerProvider(
    registry.registerDocumentFormattingEditProvider?.bind(registry),
    disposables,
    language,
    providers.documentFormatting,
  );
  registerProvider(
    registry.registerDocumentRangeFormattingEditProvider?.bind(registry),
    disposables,
    language,
    providers.documentRangeFormatting,
  );
  registerProvider(
    registry.registerOnTypeFormattingEditProvider?.bind(registry),
    disposables,
    language,
    providers.onTypeFormatting,
  );
  registerProvider(
    registry.registerInlayHintsProvider?.bind(registry),
    disposables,
    language,
    providers.inlayHints,
  );
  registerProvider(
    registry.registerDocumentHighlightProvider?.bind(registry),
    disposables,
    language,
    providers.documentHighlight,
  );
  registerProvider(
    registry.registerDocumentSymbolProvider?.bind(registry),
    disposables,
    language,
    providers.documentSymbol,
  );
  registerProvider(
    registry.registerLinkProvider?.bind(registry),
    disposables,
    language,
    providers.links,
  );
  registerProvider(
    registry.registerFoldingRangeProvider?.bind(registry),
    disposables,
    language,
    providers.foldingRange,
  );
  registerProvider(
    registry.registerSelectionRangeProvider?.bind(registry),
    disposables,
    language,
    providers.selectionRange,
  );
  registerProvider(
    registry.registerLinkedEditingRangeProvider?.bind(registry),
    disposables,
    language,
    providers.linkedEditingRange,
  );
  registerProvider(
    registry.registerDocumentSemanticTokensProvider?.bind(registry),
    disposables,
    language,
    providers.documentSemanticTokens,
  );
  registerProvider(
    registry.registerDocumentRangeSemanticTokensProvider?.bind(registry),
    disposables,
    language,
    providers.documentRangeSemanticTokens,
  );
}

function registerProvider<T>(
  register: ((languageSelector: string, provider: T) => Disposable) | undefined,
  disposables: Disposable[],
  language: string,
  provider: T,
): void {
  if (register) {
    disposables.push(register(language, provider));
  }
}
