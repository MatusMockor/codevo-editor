import { describe, expect, it, vi } from "vitest";
import type * as Monaco from "monaco-editor";
import {
  isJavaScriptTypeScriptMonacoLanguage,
  registerJavaScriptTypeScriptMonacoProviderBindings,
  type JavaScriptTypeScriptMonacoProviderBindings,
} from "./javascriptTypescriptMonacoProviderRegistration";

const languageRegistrationNames = [
  "registerHoverProvider",
  "registerCompletionItemProvider",
  "registerSignatureHelpProvider",
  "registerDefinitionProvider",
  "registerDeclarationProvider",
  "registerImplementationProvider",
  "registerTypeDefinitionProvider",
  "registerReferenceProvider",
  "registerRenameProvider",
  "registerCodeActionProvider",
  "registerCodeLensProvider",
  "registerDocumentFormattingEditProvider",
  "registerDocumentRangeFormattingEditProvider",
  "registerOnTypeFormattingEditProvider",
  "registerInlayHintsProvider",
  "registerDocumentHighlightProvider",
  "registerDocumentSymbolProvider",
  "registerLinkProvider",
  "registerFoldingRangeProvider",
  "registerSelectionRangeProvider",
  "registerLinkedEditingRangeProvider",
  "registerDocumentSemanticTokensProvider",
  "registerDocumentRangeSemanticTokensProvider",
] as const;

const providerKeyByRegistration = {
  registerCodeActionProvider: "codeAction",
  registerCodeLensProvider: "codeLens",
  registerCompletionItemProvider: "completion",
  registerDeclarationProvider: "declaration",
  registerDefinitionProvider: "definition",
  registerDocumentFormattingEditProvider: "documentFormatting",
  registerDocumentHighlightProvider: "documentHighlight",
  registerDocumentRangeFormattingEditProvider: "documentRangeFormatting",
  registerDocumentRangeSemanticTokensProvider: "documentRangeSemanticTokens",
  registerDocumentSemanticTokensProvider: "documentSemanticTokens",
  registerDocumentSymbolProvider: "documentSymbol",
  registerFoldingRangeProvider: "foldingRange",
  registerHoverProvider: "hover",
  registerImplementationProvider: "implementation",
  registerInlayHintsProvider: "inlayHints",
  registerLinkedEditingRangeProvider: "linkedEditingRange",
  registerLinkProvider: "links",
  registerOnTypeFormattingEditProvider: "onTypeFormatting",
  registerReferenceProvider: "references",
  registerRenameProvider: "rename",
  registerSelectionRangeProvider: "selectionRange",
  registerSignatureHelpProvider: "signatureHelp",
  registerTypeDefinitionProvider: "typeDefinition",
} as const satisfies Record<
  (typeof languageRegistrationNames)[number],
  keyof JavaScriptTypeScriptMonacoProviderBindings
>;

function providerBindings(): JavaScriptTypeScriptMonacoProviderBindings {
  return {
    codeAction: {},
    codeLens: {},
    completion: {},
    declaration: {},
    definition: {},
    documentFormatting: {},
    documentHighlight: {},
    documentRangeFormatting: {},
    documentRangeSemanticTokens: {},
    documentSemanticTokens: {},
    documentSymbol: {},
    foldingRange: {},
    hover: {},
    implementation: {},
    inlayHints: {},
    linkedEditingRange: {},
    links: {},
    onTypeFormatting: {},
    references: {},
    rename: {},
    selectionRange: {},
    signatureHelp: {},
    typeDefinition: {},
    workspaceSymbols: {
      provideWorkspaceSymbols: vi.fn(async () => []),
    },
  } as unknown as JavaScriptTypeScriptMonacoProviderBindings;
}

describe("JavaScript/TypeScript Monaco provider registration", () => {
  it("registers every binding for every supported language with disposable ownership", () => {
    const dispose = vi.fn();
    const receivers: unknown[] = [];
    const languages = Object.fromEntries(
      languageRegistrationNames.map((name) => [
        name,
        vi.fn(function (this: unknown, _language: string, _provider: unknown, _metadata?: unknown) {
          receivers.push(this);
          return { dispose };
        }),
      ]),
    );
    const registerWorkspaceSymbolProvider = vi.fn(() => ({ dispose }));
    const monaco = {
      languages: {
        ...languages,
        registerWorkspaceSymbolProvider,
      },
    } as unknown as typeof Monaco;
    const providers = providerBindings();

    const disposables = registerJavaScriptTypeScriptMonacoProviderBindings(monaco, providers);

    expect(registerWorkspaceSymbolProvider).toHaveBeenCalledWith(providers.workspaceSymbols);
    expect(disposables).toHaveLength(1 + languageRegistrationNames.length * 5);
    for (const name of languageRegistrationNames) {
      expect(languages[name]).toHaveBeenCalledTimes(5);
      expect(languages[name].mock.calls.map(([language]) => language)).toEqual([
        "javascript",
        "typescript",
        "javascriptreact",
        "typescriptreact",
        "vue",
      ]);
      expect(
        languages[name].mock.calls.every(
          ([, provider]) => provider === providers[providerKeyByRegistration[name]],
        ),
      ).toBe(true);
    }
    expect(receivers.every((receiver) => receiver === monaco.languages)).toBe(true);
    expect(languages.registerCodeActionProvider).toHaveBeenCalledWith(
      "javascript",
      providers.codeAction,
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
    );
    disposables.forEach((disposable) => disposable.dispose());
    expect(dispose).toHaveBeenCalledTimes(disposables.length);
  });

  it("skips unavailable optional Monaco registries without fabricating disposables", () => {
    const monaco = { languages: {} } as unknown as typeof Monaco;

    expect(registerJavaScriptTypeScriptMonacoProviderBindings(monaco, providerBindings())).toEqual(
      [],
    );
  });

  it("recognizes only the exact JS/TS provider language set", () => {
    expect(
      ["javascript", "typescript", "javascriptreact", "typescriptreact", "vue"].every(
        isJavaScriptTypeScriptMonacoLanguage,
      ),
    ).toBe(true);
    expect(isJavaScriptTypeScriptMonacoLanguage("php")).toBe(false);
    expect(isJavaScriptTypeScriptMonacoLanguage("JavaScript")).toBe(false);
  });
});
