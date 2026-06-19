import { describe, expect, it, vi } from "vitest";
import { configureTypescriptJavascriptDefaults } from "./typescriptJavascriptDefaults";

describe("configureTypescriptJavascriptDefaults", () => {
  it("enables eager model sync and diagnostics for TypeScript and JavaScript", () => {
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
      noSyntaxValidation: false,
    });
    expect(typescriptDefaults.setModeConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({
        completionItems: true,
        definitions: true,
        diagnostics: true,
        hovers: true,
        rename: true,
      }),
    );
    expect(javascriptDefaults.setCompilerOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        allowJs: true,
        checkJs: false,
      }),
    );
  });

  it("disables Monaco diagnostics when JavaScript and TypeScript validation is off", () => {
    const typescriptDefaults = languageDefaults();
    const javascriptDefaults = languageDefaults();
    const monaco = monacoWithDefaults(typescriptDefaults, javascriptDefaults);

    configureTypescriptJavascriptDefaults(monaco as never, {
      validationEnabled: false,
    });

    expect(typescriptDefaults.setDiagnosticsOptions).toHaveBeenCalledWith({
      noSemanticValidation: true,
      noSyntaxValidation: true,
    });
    expect(javascriptDefaults.setModeConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({
        completionItems: true,
        diagnostics: false,
        hovers: true,
      }),
    );
  });

  it("disables Monaco built-in JS/TS providers while the managed language server owns them", () => {
    const typescriptDefaults = languageDefaults();
    const javascriptDefaults = languageDefaults();
    const monaco = monacoWithDefaults(typescriptDefaults, javascriptDefaults);

    configureTypescriptJavascriptDefaults(monaco as never, {
      managedLanguageServerActive: true,
      validationEnabled: true,
    });

    expect(typescriptDefaults.setDiagnosticsOptions).toHaveBeenCalledWith({
      noSemanticValidation: true,
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
      onTypeFormattingEdits: false,
      references: false,
      rename: false,
      signatureHelp: false,
    });
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
