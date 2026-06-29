import { describe, expect, it, vi } from "vitest";
import { configureTypescriptJavascriptDefaults } from "./typescriptJavascriptDefaults";

describe("Monaco JavaScript and TypeScript built-ins", () => {
  it("configures compiler options, eager sync, and diagnostics for TypeScript and JavaScript", () => {
    const typescriptDefaults = languageDefaults();
    const javascriptDefaults = languageDefaults();
    const monaco = {
      languages: {
        typescript: {
          javascriptDefaults,
          typescriptDefaults,
          JsxEmit: { ReactJSX: 4 },
          ModuleKind: { ESNext: 99 },
          ModuleResolutionKind: { NodeJs: 2 },
          ScriptTarget: { ESNext: 99 },
        },
      },
    };

    configureTypescriptJavascriptDefaults(monaco as never);

    expect(typescriptDefaults.setEagerModelSync).toHaveBeenCalledWith(true);
    expect(javascriptDefaults.setEagerModelSync).toHaveBeenCalledWith(true);
    expect(typescriptDefaults.setDiagnosticsOptions).toHaveBeenCalledWith({
      noSemanticValidation: false,
      noSuggestionDiagnostics: false,
      noSyntaxValidation: false,
    });
    expect(javascriptDefaults.setDiagnosticsOptions).toHaveBeenCalledWith({
      noSemanticValidation: false,
      noSuggestionDiagnostics: false,
      noSyntaxValidation: false,
    });
    expect(typescriptDefaults.setModeConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({
        completionItems: true,
        definitions: true,
        diagnostics: true,
        hovers: true,
        onTypeFormattingEdits: true,
        rename: true,
      }),
    );
    expect(typescriptDefaults.setCompilerOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        allowNonTsExtensions: true,
        allowSyntheticDefaultImports: true,
        resolveJsonModule: true,
      }),
    );
    expect(javascriptDefaults.setCompilerOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        allowJs: true,
        allowNonTsExtensions: true,
        allowSyntheticDefaultImports: true,
        checkJs: false,
        resolveJsonModule: true,
      }),
    );
  });

  it("keeps Monaco built-in JS/TS diagnostics disabled during fallback when validation is off", () => {
    const typescriptDefaults = languageDefaults();
    const javascriptDefaults = languageDefaults();
    const monaco = monacoWithDefaults(typescriptDefaults, javascriptDefaults);

    configureTypescriptJavascriptDefaults(monaco as never, {
      validationEnabled: false,
    });

    expect(typescriptDefaults.setDiagnosticsOptions).toHaveBeenCalledWith({
      noSemanticValidation: true,
      noSuggestionDiagnostics: true,
      noSyntaxValidation: true,
    });
    expect(javascriptDefaults.setModeConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({
        completionItems: true,
        diagnostics: false,
        hovers: true,
        onTypeFormattingEdits: true,
      }),
    );
  });

  it("enables Monaco built-in JS/TS providers and diagnostics when the managed runtime is unavailable", () => {
    const typescriptDefaults = languageDefaults();
    const javascriptDefaults = languageDefaults();
    const monaco = monacoWithDefaults(typescriptDefaults, javascriptDefaults);

    configureTypescriptJavascriptDefaults(monaco as never, {
      managedLanguageServerActive: false,
      validationEnabled: true,
    });

    expect(typescriptDefaults.setDiagnosticsOptions).toHaveBeenCalledWith({
      noSemanticValidation: false,
      noSuggestionDiagnostics: false,
      noSyntaxValidation: false,
    });
    expect(javascriptDefaults.setDiagnosticsOptions).toHaveBeenCalledWith({
      noSemanticValidation: false,
      noSuggestionDiagnostics: false,
      noSyntaxValidation: false,
    });
    expect(typescriptDefaults.setModeConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({
        completionItems: true,
        diagnostics: true,
        hovers: true,
        onTypeFormattingEdits: true,
      }),
    );
    expect(javascriptDefaults.setModeConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({
        completionItems: true,
        diagnostics: true,
        hovers: true,
        onTypeFormattingEdits: true,
      }),
    );
  });

  it("keeps on-type formatting but disables Monaco semantic JS/TS providers and diagnostics while the matching-root managed runtime owns them", () => {
    const typescriptDefaults = languageDefaults();
    const javascriptDefaults = languageDefaults();
    const monaco = monacoWithDefaults(typescriptDefaults, javascriptDefaults);

    configureTypescriptJavascriptDefaults(monaco as never, {
      managedLanguageServerActive: true,
      validationEnabled: true,
    });

    expect(typescriptDefaults.setDiagnosticsOptions).toHaveBeenCalledWith({
      noSemanticValidation: true,
      noSuggestionDiagnostics: true,
      noSyntaxValidation: true,
    });
    expect(typescriptDefaults.setModeConfiguration).toHaveBeenCalledWith({
      codeActions: false,
      completionItems: false,
      definitions: false,
      diagnostics: false,
      documentHighlights: false,
      documentRangeFormattingEdits: false,
      documentSymbols: false,
      hovers: false,
      inlayHints: false,
      onTypeFormattingEdits: true,
      references: false,
      rename: false,
      signatureHelp: false,
    });
  });

  it("enables Monaco built-in JS/TS providers and diagnostics for a stale-root managed runtime", () => {
    const typescriptDefaults = languageDefaults();
    const javascriptDefaults = languageDefaults();
    const monaco = monacoWithDefaults(typescriptDefaults, javascriptDefaults);

    configureTypescriptJavascriptDefaults(monaco as never, {
      managedLanguageServerActive: false,
      validationEnabled: true,
    });

    expect(typescriptDefaults.setDiagnosticsOptions).toHaveBeenCalledWith({
      noSemanticValidation: false,
      noSuggestionDiagnostics: false,
      noSyntaxValidation: false,
    });
    expect(typescriptDefaults.setModeConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({
        completionItems: true,
        diagnostics: true,
        hovers: true,
      }),
    );
  });
});

function monacoWithDefaults(
  typescriptDefaults: ReturnType<typeof languageDefaults>,
  javascriptDefaults: ReturnType<typeof languageDefaults>,
) {
  return {
    languages: {
      typescript: {
        javascriptDefaults,
        typescriptDefaults,
        JsxEmit: { ReactJSX: 4 },
        ModuleKind: { ESNext: 99 },
        ModuleResolutionKind: { NodeJs: 2 },
        ScriptTarget: { ESNext: 99 },
      },
    },
  };
}

function languageDefaults() {
  return {
    setCompilerOptions: vi.fn(),
    setDiagnosticsOptions: vi.fn(),
    setEagerModelSync: vi.fn(),
    setModeConfiguration: vi.fn(),
  };
}
