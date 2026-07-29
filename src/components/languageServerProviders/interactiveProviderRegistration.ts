import type * as Monaco from "monaco-editor";
import { disposeAll, type Disposable, type MonacoApi } from "./providerRegistrationTypes";

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
  const hover = monaco.languages.registerHoverProvider("php", {
    provideHover: delegates.provideHover,
  });
  const completion = monaco.languages.registerCompletionItemProvider("php", {
    triggerCharacters: ["$", ">", ":", "'", '"', "."],
    provideCompletionItems: delegates.provideCompletionItems,
  });
  const signature = monaco.languages.registerSignatureHelpProvider("php", {
    signatureHelpRetriggerCharacters: [","],
    signatureHelpTriggerCharacters: ["(", ","],
    provideSignatureHelp: delegates.provideSignatureHelp,
  });
  const codeActions = monaco.languages.registerCodeActionProvider(
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
  );
  const selectionRange = monaco.languages.registerSelectionRangeProvider("php", {
    provideSelectionRanges: delegates.provideSelectionRanges,
  });

  return {
    dispose: () => disposeAll([hover, completion, signature, codeActions, selectionRange]),
  };
}
