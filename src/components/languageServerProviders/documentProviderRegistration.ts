import type * as Monaco from "monaco-editor";
import {
  emptyDisposable,
  registerTransactionally,
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
  return registerTransactionally((track) => {
    track(
      monaco.languages.registerLinkProvider
        ? monaco.languages.registerLinkProvider("php", {
            provideLinks: delegates.provideDocumentLinks,
            resolveLink: delegates.resolveDocumentLink,
          })
        : emptyDisposable(),
    );
    track(
      monaco.languages.registerCodeLensProvider
        ? monaco.languages.registerCodeLensProvider("php", {
            onDidChange: delegates.onDidChangeCodeLens,
            provideCodeLenses: delegates.provideCodeLenses,
            resolveCodeLens: delegates.resolveCodeLens,
          })
        : emptyDisposable(),
    );
    track(
      monaco.languages.registerInlayHintsProvider
        ? monaco.languages.registerInlayHintsProvider("php", {
            onDidChangeInlayHints: delegates.onDidChangeInlayHints,
            provideInlayHints: delegates.provideInlayHints,
            resolveInlayHint: delegates.resolveInlayHint,
          })
        : emptyDisposable(),
    );
    track(
      monaco.languages.registerFoldingRangeProvider
        ? monaco.languages.registerFoldingRangeProvider("php", {
            provideFoldingRanges: delegates.provideFoldingRanges,
          })
        : emptyDisposable(),
    );
    track(
      monaco.languages.registerDocumentFormattingEditProvider
        ? monaco.languages.registerDocumentFormattingEditProvider("php", {
            provideDocumentFormattingEdits: delegates.provideDocumentFormattingEdits,
          })
        : emptyDisposable(),
    );
    track(
      monaco.languages.registerDocumentRangeFormattingEditProvider
        ? monaco.languages.registerDocumentRangeFormattingEditProvider("php", {
            provideDocumentRangeFormattingEdits: delegates.provideDocumentRangeFormattingEdits,
          })
        : emptyDisposable(),
    );
    track(
      monaco.languages.registerOnTypeFormattingEditProvider
        ? monaco.languages.registerOnTypeFormattingEditProvider("php", {
            autoFormatTriggerCharacters: [...delegates.onTypeFormattingTriggerCharacters],
            provideOnTypeFormattingEdits: delegates.provideOnTypeFormattingEdits,
          })
        : emptyDisposable(),
    );
    track(
      monaco.languages.registerLinkedEditingRangeProvider
        ? monaco.languages.registerLinkedEditingRangeProvider("php", {
            provideLinkedEditingRanges: delegates.provideLinkedEditingRanges,
          })
        : emptyDisposable(),
    );
    track(
      registry.registerDocumentSemanticTokensProvider
        ? registry.registerDocumentSemanticTokensProvider("php", {
            onDidChange: delegates.onDidChangeSemanticTokens,
            getLegend: delegates.getSemanticTokensLegend,
            provideDocumentSemanticTokens: delegates.provideDocumentSemanticTokens,
            releaseDocumentSemanticTokens: () => undefined,
          })
        : emptyDisposable(),
    );
    track(
      registry.registerDocumentRangeSemanticTokensProvider
        ? registry.registerDocumentRangeSemanticTokensProvider("php", {
            getLegend: delegates.getSemanticTokensLegend,
            provideDocumentRangeSemanticTokens: delegates.provideDocumentRangeSemanticTokens,
          })
        : emptyDisposable(),
    );
  });
}
