import type * as Monaco from "monaco-editor";
import {
  disposeAll,
  emptyDisposable,
  type Disposable,
  type MonacoApi,
  type MonacoWorkspaceSymbolRegistry,
} from "./providerRegistrationTypes";

export interface NavigationLanguageServerProviderDelegates {
  readonly provideDeclaration: Monaco.languages.DeclarationProvider["provideDeclaration"];
  readonly provideDefinition: Monaco.languages.DefinitionProvider["provideDefinition"];
  readonly provideDocumentHighlights: Monaco.languages.DocumentHighlightProvider["provideDocumentHighlights"];
  readonly provideDocumentSymbols: Monaco.languages.DocumentSymbolProvider["provideDocumentSymbols"];
  readonly provideImplementation: Monaco.languages.ImplementationProvider["provideImplementation"];
  readonly provideReferences: Monaco.languages.ReferenceProvider["provideReferences"];
  readonly provideRenameEdits: Monaco.languages.RenameProvider["provideRenameEdits"];
  readonly provideTypeDefinition: Monaco.languages.TypeDefinitionProvider["provideTypeDefinition"];
  readonly provideWorkspaceSymbols: (
    query: string,
  ) => Promise<import("./providerRegistrationTypes").MonacoWorkspaceSymbol[]>;
  readonly resolveRenameLocation: NonNullable<
    Monaco.languages.RenameProvider["resolveRenameLocation"]
  >;
}

export function registerNavigationLanguageServerProviders(
  monaco: MonacoApi,
  delegates: NavigationLanguageServerProviderDelegates,
): Disposable {
  const rename = monaco.languages.registerRenameProvider
    ? monaco.languages.registerRenameProvider("php", {
        provideRenameEdits: delegates.provideRenameEdits,
        resolveRenameLocation: delegates.resolveRenameLocation,
      })
    : emptyDisposable();
  const references = monaco.languages.registerReferenceProvider
    ? monaco.languages.registerReferenceProvider("php", {
        provideReferences: delegates.provideReferences,
      })
    : emptyDisposable();
  const definition = monaco.languages.registerDefinitionProvider
    ? monaco.languages.registerDefinitionProvider("php", {
        provideDefinition: delegates.provideDefinition,
      })
    : emptyDisposable();
  const declaration = monaco.languages.registerDeclarationProvider
    ? monaco.languages.registerDeclarationProvider("php", {
        provideDeclaration: delegates.provideDeclaration,
      })
    : emptyDisposable();
  const implementation = monaco.languages.registerImplementationProvider
    ? monaco.languages.registerImplementationProvider("php", {
        provideImplementation: delegates.provideImplementation,
      })
    : emptyDisposable();
  const typeDefinition = monaco.languages.registerTypeDefinitionProvider
    ? monaco.languages.registerTypeDefinitionProvider("php", {
        provideTypeDefinition: delegates.provideTypeDefinition,
      })
    : emptyDisposable();
  const documentHighlight = monaco.languages.registerDocumentHighlightProvider
    ? monaco.languages.registerDocumentHighlightProvider("php", {
        provideDocumentHighlights: delegates.provideDocumentHighlights,
      })
    : emptyDisposable();
  const documentSymbol = monaco.languages.registerDocumentSymbolProvider
    ? monaco.languages.registerDocumentSymbolProvider("php", {
        provideDocumentSymbols: delegates.provideDocumentSymbols,
      })
    : emptyDisposable();
  const workspaceSymbolRegistry = monaco.languages as MonacoWorkspaceSymbolRegistry;
  const workspaceSymbol = workspaceSymbolRegistry.registerWorkspaceSymbolProvider
    ? workspaceSymbolRegistry.registerWorkspaceSymbolProvider({
        provideWorkspaceSymbols: delegates.provideWorkspaceSymbols,
      })
    : emptyDisposable();

  return {
    dispose: () =>
      disposeAll([
        rename,
        references,
        definition,
        declaration,
        implementation,
        typeDefinition,
        documentHighlight,
        documentSymbol,
        workspaceSymbol,
      ]),
  };
}
