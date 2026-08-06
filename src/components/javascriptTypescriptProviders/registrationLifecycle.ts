import type * as Monaco from "monaco-editor";
import {
  defaultLargeSmartDocumentPolicy,
  largeSmartDocumentStatusFromMetrics,
} from "../../domain/largeDocumentPolicy";
import type { JavaScriptTypeScriptMonacoProviderBindings } from "../javascriptTypescriptMonacoProviderRegistration";
import type { ProviderRegistrationAuthority } from "../javascriptTypescriptCodeActionAuthority";
import { registerPerfMeasuredProviders } from "../perfScenarioBridge";

type Disposable = Monaco.IDisposable;
type ProviderRegistry = Partial<typeof Monaco.languages>;

const LANGUAGE_IDS = [
  "javascript",
  "typescript",
  "javascriptreact",
  "typescriptreact",
  "vue",
] as const;

const CODE_ACTION_KINDS = [
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

const activeRegistrationByMonaco = new WeakMap<object, ProviderRegistrationAuthority>();

export function activateJavaScriptTypeScriptProviderRegistration(
  monaco: object,
  authority: ProviderRegistrationAuthority,
): ProviderRegistrationAuthority | undefined {
  const previous = activeRegistrationByMonaco.get(monaco);
  if (previous && previous !== authority) {
    previous.active = false;
  }
  activeRegistrationByMonaco.set(monaco, authority);
  return previous;
}

export function deactivateJavaScriptTypeScriptProviderRegistration(
  monaco: object,
  authority: ProviderRegistrationAuthority,
): void {
  authority.active = false;
  if (activeRegistrationByMonaco.get(monaco) === authority) {
    activeRegistrationByMonaco.delete(monaco);
  }
}

export function rollbackJavaScriptTypeScriptProviderRegistrationActivation(
  monaco: object,
  authority: ProviderRegistrationAuthority,
  previous: ProviderRegistrationAuthority | undefined,
): void {
  authority.active = false;
  if (activeRegistrationByMonaco.get(monaco) !== authority) {
    return;
  }
  if (previous) {
    previous.active = true;
    activeRegistrationByMonaco.set(monaco, previous);
    return;
  }
  activeRegistrationByMonaco.delete(monaco);
}

type WorkspaceSymbolRegistry = {
  registerWorkspaceSymbolProvider?(
    provider: JavaScriptTypeScriptMonacoProviderBindings["workspaceSymbols"],
  ): Disposable;
};

class JavaScriptTypeScriptProviderRegistrationRollbackError extends Error {
  readonly errors: readonly unknown[];

  constructor(errors: readonly unknown[]) {
    super("JS/TS provider registration failed during rollback");
    this.name = "JavaScriptTypeScriptProviderRegistrationRollbackError";
    this.errors = errors;
  }
}

export function disposeJavaScriptTypeScriptProviderDisposables(
  disposables: readonly Disposable[],
  reportError?: (error: unknown) => void,
): readonly unknown[] {
  const errors: unknown[] = [];
  for (let index = disposables.length - 1; index >= 0; index -= 1) {
    try {
      disposables[index]?.dispose();
    } catch (error) {
      errors.push(error);
      try {
        reportError?.(error);
      } catch {
        // Cleanup remains best-effort even if the host error reporter is unavailable.
      }
    }
  }
  return errors;
}

export function registerJavaScriptTypeScriptMonacoProvidersTransactionally(
  monaco: typeof Monaco,
  providers: JavaScriptTypeScriptMonacoProviderBindings,
): readonly Disposable[] {
  const registry: ProviderRegistry = monaco.languages;
  const acquired: Disposable[] = [];

  try {
    const workspaceRegistry = registry as WorkspaceSymbolRegistry;
    if (workspaceRegistry.registerWorkspaceSymbolProvider) {
      acquired.push(workspaceRegistry.registerWorkspaceSymbolProvider(providers.workspaceSymbols));
    }

    for (const language of LANGUAGE_IDS) {
      registerLanguageProviders(registry, acquired, language, providers);
    }

    const unregisterMeasuredProviders = registerPerfMeasuredProviders({
      completion: providers.completion,
      definition: providers.definition,
      references: providers.references,
      rename: providers.rename,
    });

    if (unregisterMeasuredProviders) {
      acquired.push({ dispose: unregisterMeasuredProviders });
    }

    return acquired;
  } catch (error) {
    const rollbackErrors = disposeJavaScriptTypeScriptProviderDisposables(acquired);
    if (rollbackErrors.length > 0) {
      throw new JavaScriptTypeScriptProviderRegistrationRollbackError([error, ...rollbackErrors]);
    }
    throw error;
  }
}

function registerLanguageProviders(
  registry: ProviderRegistry,
  acquired: Disposable[],
  language: string,
  providers: JavaScriptTypeScriptMonacoProviderBindings,
): void {
  register(registry.registerHoverProvider, registry, acquired, language, providers.hover);
  register(
    registry.registerCompletionItemProvider,
    registry,
    acquired,
    language,
    providers.completion,
  );
  register(
    registry.registerSignatureHelpProvider,
    registry,
    acquired,
    language,
    providers.signatureHelp,
  );
  register(registry.registerDefinitionProvider, registry, acquired, language, providers.definition);
  register(
    registry.registerDeclarationProvider,
    registry,
    acquired,
    language,
    providers.declaration,
  );
  register(
    registry.registerImplementationProvider,
    registry,
    acquired,
    language,
    providers.implementation,
  );
  register(
    registry.registerTypeDefinitionProvider,
    registry,
    acquired,
    language,
    providers.typeDefinition,
  );
  register(registry.registerReferenceProvider, registry, acquired, language, providers.references);
  register(registry.registerRenameProvider, registry, acquired, language, providers.rename);

  if (registry.registerCodeActionProvider) {
    acquired.push(
      registry.registerCodeActionProvider(language, providers.codeAction, {
        providedCodeActionKinds: [...CODE_ACTION_KINDS],
      }),
    );
  }

  register(registry.registerCodeLensProvider, registry, acquired, language, providers.codeLens);
  register(
    registry.registerDocumentFormattingEditProvider,
    registry,
    acquired,
    language,
    providers.documentFormatting,
  );
  register(
    registry.registerDocumentRangeFormattingEditProvider,
    registry,
    acquired,
    language,
    providers.documentRangeFormatting,
  );
  register(
    registry.registerOnTypeFormattingEditProvider,
    registry,
    acquired,
    language,
    providers.onTypeFormatting,
  );
  register(registry.registerInlayHintsProvider, registry, acquired, language, providers.inlayHints);
  register(
    registry.registerDocumentHighlightProvider,
    registry,
    acquired,
    language,
    providers.documentHighlight,
  );
  register(
    registry.registerDocumentSymbolProvider,
    registry,
    acquired,
    language,
    policyGatedJavaScriptTypeScriptDocumentSymbolProvider(providers.documentSymbol),
  );
  register(registry.registerLinkProvider, registry, acquired, language, providers.links);
  register(
    registry.registerFoldingRangeProvider,
    registry,
    acquired,
    language,
    providers.foldingRange,
  );
  register(
    registry.registerSelectionRangeProvider,
    registry,
    acquired,
    language,
    providers.selectionRange,
  );
  register(
    registry.registerLinkedEditingRangeProvider,
    registry,
    acquired,
    language,
    providers.linkedEditingRange,
  );
  register(
    registry.registerDocumentSemanticTokensProvider,
    registry,
    acquired,
    language,
    providers.documentSemanticTokens,
  );
  register(
    registry.registerDocumentRangeSemanticTokensProvider,
    registry,
    acquired,
    language,
    providers.documentRangeSemanticTokens,
  );
}

export function policyGatedJavaScriptTypeScriptDocumentSymbolProvider(
  provider: Monaco.languages.DocumentSymbolProvider,
): Monaco.languages.DocumentSymbolProvider {
  return {
    ...provider,
    provideDocumentSymbols: (model, token) => {
      if (!largeSmartDocumentModelEligible(model)) {
        return null;
      }

      return provider.provideDocumentSymbols(model, token);
    },
  };
}

function largeSmartDocumentModelEligible(model: Monaco.editor.ITextModel): boolean {
  const status = largeSmartDocumentStatusFromMetrics(
    { lineCount: model.getLineCount(), utf16Length: model.getValueLength() },
    defaultLargeSmartDocumentPolicy,
  );

  return status.kind === "eligible";
}

function register<Provider>(
  registration: ((languageSelector: string, provider: Provider) => Disposable) | undefined,
  receiver: ProviderRegistry,
  acquired: Disposable[],
  language: string,
  provider: Provider,
): void {
  if (registration) {
    acquired.push(registration.call(receiver, language, provider));
  }
}
