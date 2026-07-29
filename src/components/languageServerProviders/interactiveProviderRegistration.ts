import type * as Monaco from "monaco-editor";
import {
  registerTransactionally,
  type Disposable,
  type MonacoApi,
} from "./providerRegistrationTypes";

export interface InteractiveLanguageServerProviderDelegates {
  readonly provideCodeActions: Monaco.languages.CodeActionProvider["provideCodeActions"];
  readonly provideCompletionItems: Monaco.languages.CompletionItemProvider["provideCompletionItems"];
  readonly provideHover: Monaco.languages.HoverProvider["provideHover"];
  readonly provideSelectionRanges: Monaco.languages.SelectionRangeProvider["provideSelectionRanges"];
  readonly provideSignatureHelp: Monaco.languages.SignatureHelpProvider["provideSignatureHelp"];
  readonly resolveCodeAction: NonNullable<Monaco.languages.CodeActionProvider["resolveCodeAction"]>;
}

export function registerInteractiveLanguageServerProviders(
  monaco: MonacoApi,
  delegates: InteractiveLanguageServerProviderDelegates,
): Disposable {
  return registerTransactionally((track) => {
    track(
      monaco.languages.registerHoverProvider("php", {
        provideHover: delegates.provideHover,
      }),
    );
    track(
      monaco.languages.registerCompletionItemProvider("php", {
        triggerCharacters: ["$", ">", ":", "'", '"', "."],
        provideCompletionItems: delegates.provideCompletionItems,
      }),
    );
    track(
      monaco.languages.registerSignatureHelpProvider("php", {
        signatureHelpRetriggerCharacters: [","],
        signatureHelpTriggerCharacters: ["(", ","],
        provideSignatureHelp: delegates.provideSignatureHelp,
      }),
    );
    track(
      monaco.languages.registerCodeActionProvider(
        "php",
        {
          provideCodeActions: delegates.provideCodeActions,
          resolveCodeAction: delegates.resolveCodeAction,
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
    track(
      monaco.languages.registerSelectionRangeProvider("php", {
        provideSelectionRanges: delegates.provideSelectionRanges,
      }),
    );
  });
}
