import type * as Monaco from "monaco-editor";
import {
  disposeAll,
  emptyDisposable,
  type Disposable,
  type MonacoApi,
} from "./providerRegistrationTypes";

export interface DocumentLanguageServerProviderDelegates {
  readonly getSemanticTokensLegend: () => Monaco.languages.SemanticTokensLegend;
  readonly onDidChangeCodeLens: NonNullable<Monaco.languages.CodeLensProvider["onDidChange"]>;
  readonly onDidChangeInlayHints: Monaco.IEvent<void>;
  readonly onDidChangeSemanticTokens: Monaco.IEvent<void>;
  readonly provideCodeLenses: Monaco.languages.CodeLensProvider["provideCodeLenses"];
  readonly provideDocumentFormattingEdits: Monaco.languages.DocumentFormattingEditProvider["provideDocumentFormattingEdits"];
  readonly provideDocumentLinks: Monaco.languages.LinkProvider["provideLinks"];
  readonly provideDocumentRangeFormattingEdits: Monaco.languages.DocumentRangeFormattingEditProvider["provideDocumentRangeFormattingEdits"];
  readonly provideDocumentRangeSemanticTokens: Monaco.languages.DocumentRangeSemanticTokensProvider["provideDocumentRangeSemanticTokens"];
  readonly provideDocumentSemanticTokens: Monaco.languages.DocumentSemanticTokensProvider["provideDocumentSemanticTokens"];
  readonly provideFoldingRanges: Monaco.languages.FoldingRangeProvider["provideFoldingRanges"];
  readonly provideInlayHints: Monaco.languages.InlayHintsProvider["provideInlayHints"];
  readonly provideLinkedEditingRanges: Monaco.languages.LinkedEditingRangeProvider["provideLinkedEditingRanges"];
  readonly provideOnTypeFormattingEdits: Monaco.languages.OnTypeFormattingEditProvider["provideOnTypeFormattingEdits"];
  readonly resolveCodeLens: NonNullable<Monaco.languages.CodeLensProvider["resolveCodeLens"]>;
  readonly resolveDocumentLink: NonNullable<Monaco.languages.LinkProvider["resolveLink"]>;
  readonly resolveInlayHint: NonNullable<Monaco.languages.InlayHintsProvider["resolveInlayHint"]>;
  readonly onTypeFormattingTriggerCharacters: readonly string[];
}

export function registerDocumentLanguageServerProviders(
  monaco: MonacoApi,
  delegates: DocumentLanguageServerProviderDelegates,
): Disposable {
  const registry = monaco.languages as Partial<typeof monaco.languages>;
  const documentLink = monaco.languages.registerLinkProvider
    ? monaco.languages.registerLinkProvider("php", {
        provideLinks: delegates.provideDocumentLinks,
        resolveLink: delegates.resolveDocumentLink,
      })
    : emptyDisposable();
  const codeLens = monaco.languages.registerCodeLensProvider
    ? monaco.languages.registerCodeLensProvider("php", {
        onDidChange: delegates.onDidChangeCodeLens,
        provideCodeLenses: delegates.provideCodeLenses,
        resolveCodeLens: delegates.resolveCodeLens,
      })
    : emptyDisposable();
  const inlayHints = monaco.languages.registerInlayHintsProvider
    ? monaco.languages.registerInlayHintsProvider("php", {
        onDidChangeInlayHints: delegates.onDidChangeInlayHints,
        provideInlayHints: delegates.provideInlayHints,
        resolveInlayHint: delegates.resolveInlayHint,
      })
    : emptyDisposable();
  const foldingRange = monaco.languages.registerFoldingRangeProvider
    ? monaco.languages.registerFoldingRangeProvider("php", {
        provideFoldingRanges: delegates.provideFoldingRanges,
      })
    : emptyDisposable();
  const documentFormatting = monaco.languages.registerDocumentFormattingEditProvider
    ? monaco.languages.registerDocumentFormattingEditProvider("php", {
        provideDocumentFormattingEdits: delegates.provideDocumentFormattingEdits,
      })
    : emptyDisposable();
  const rangeFormatting = monaco.languages.registerDocumentRangeFormattingEditProvider
    ? monaco.languages.registerDocumentRangeFormattingEditProvider("php", {
        provideDocumentRangeFormattingEdits: delegates.provideDocumentRangeFormattingEdits,
      })
    : emptyDisposable();
  const onTypeFormatting = monaco.languages.registerOnTypeFormattingEditProvider
    ? monaco.languages.registerOnTypeFormattingEditProvider("php", {
        autoFormatTriggerCharacters: [...delegates.onTypeFormattingTriggerCharacters],
        provideOnTypeFormattingEdits: delegates.provideOnTypeFormattingEdits,
      })
    : emptyDisposable();
  const linkedEditingRange = monaco.languages.registerLinkedEditingRangeProvider
    ? monaco.languages.registerLinkedEditingRangeProvider("php", {
        provideLinkedEditingRanges: delegates.provideLinkedEditingRanges,
      })
    : emptyDisposable();
  const semanticTokens = registry.registerDocumentSemanticTokensProvider
    ? registry.registerDocumentSemanticTokensProvider("php", {
        onDidChange: delegates.onDidChangeSemanticTokens,
        getLegend: delegates.getSemanticTokensLegend,
        provideDocumentSemanticTokens: delegates.provideDocumentSemanticTokens,
        releaseDocumentSemanticTokens: () => undefined,
      })
    : emptyDisposable();
  const rangeSemanticTokens = registry.registerDocumentRangeSemanticTokensProvider
    ? registry.registerDocumentRangeSemanticTokensProvider("php", {
        getLegend: delegates.getSemanticTokensLegend,
        provideDocumentRangeSemanticTokens: delegates.provideDocumentRangeSemanticTokens,
      })
    : emptyDisposable();

  return {
    dispose: () =>
      disposeAll([
        documentLink,
        codeLens,
        inlayHints,
        foldingRange,
        documentFormatting,
        rangeFormatting,
        onTypeFormatting,
        linkedEditingRange,
        semanticTokens,
        rangeSemanticTokens,
      ]),
  };
}
