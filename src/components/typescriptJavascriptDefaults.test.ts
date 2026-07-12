import { describe, expect, it, vi } from "vitest";
import {
  configureTypescriptJavascriptDefaults,
  configureTypescriptJavascriptDefaultsOnce,
} from "./typescriptJavascriptDefaults";

describe("Monaco JavaScript and TypeScript built-ins", () => {
  it("coalesces repeated effective configuration for one Monaco runtime", () => {
    const typescriptDefaults = languageDefaults();
    const javascriptDefaults = languageDefaults();
    const monaco = monacoWithDefaults(typescriptDefaults, javascriptDefaults);

    expect(configureTypescriptJavascriptDefaultsOnce(monaco as never)).toBe(true);
    expect(configureTypescriptJavascriptDefaultsOnce(monaco as never)).toBe(false);
    expect(typescriptDefaults.setCompilerOptions).toHaveBeenCalledTimes(1);
    expect(javascriptDefaults.setCompilerOptions).toHaveBeenCalledTimes(1);

    expect(
      configureTypescriptJavascriptDefaultsOnce(monaco as never, {
        managedLanguageServerActive: true,
      }),
    ).toBe(true);
    expect(typescriptDefaults.setCompilerOptions).toHaveBeenCalledTimes(2);
    expect(javascriptDefaults.setCompilerOptions).toHaveBeenCalledTimes(2);
  });

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

  it("prefers Bundler module resolution and modern inferred project options when available", () => {
    const typescriptDefaults = languageDefaults();
    const javascriptDefaults = languageDefaults();
    const monaco = monacoWithDefaults(typescriptDefaults, javascriptDefaults, {
      Bundler: 100,
      NodeNext: 99,
      NodeJs: 2,
    });

    configureTypescriptJavascriptDefaults(monaco as never);

    expect(typescriptDefaults.setCompilerOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        allowImportingTsExtensions: true,
        moduleResolution: 100,
        resolvePackageJsonExports: true,
        resolvePackageJsonImports: true,
      }),
    );
  });

  it("falls back to NodeNext module resolution and modern inferred project options when Bundler is unavailable", () => {
    const typescriptDefaults = languageDefaults();
    const javascriptDefaults = languageDefaults();
    const monaco = monacoWithDefaults(typescriptDefaults, javascriptDefaults, {
      NodeNext: 99,
      NodeJs: 2,
    });

    configureTypescriptJavascriptDefaults(monaco as never);

    expect(typescriptDefaults.setCompilerOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        allowImportingTsExtensions: true,
        moduleResolution: 99,
        resolvePackageJsonExports: true,
        resolvePackageJsonImports: true,
      }),
    );
  });

  it("keeps NodeJs module resolution without modern inferred project options for compatibility", () => {
    const typescriptDefaults = languageDefaults();
    const javascriptDefaults = languageDefaults();
    const monaco = monacoWithDefaults(typescriptDefaults, javascriptDefaults, {
      NodeJs: 2,
    });

    configureTypescriptJavascriptDefaults(monaco as never);

    expect(typescriptDefaults.setCompilerOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        moduleResolution: 2,
      }),
    );
    expect(typescriptDefaults.setCompilerOptions).toHaveBeenCalledWith(
      expect.not.objectContaining({
        allowImportingTsExtensions: true,
        resolvePackageJsonExports: true,
        resolvePackageJsonImports: true,
      }),
    );
  });

  it("applies modern module resolution options to both TypeScript and JavaScript defaults", () => {
    const typescriptDefaults = languageDefaults();
    const javascriptDefaults = languageDefaults();
    const monaco = monacoWithDefaults(typescriptDefaults, javascriptDefaults, {
      Bundler: 100,
      NodeJs: 2,
    });

    configureTypescriptJavascriptDefaults(monaco as never);

    expect(typescriptDefaults.setCompilerOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        allowImportingTsExtensions: true,
        moduleResolution: 100,
        resolvePackageJsonExports: true,
        resolvePackageJsonImports: true,
      }),
    );
    expect(javascriptDefaults.setCompilerOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        allowImportingTsExtensions: true,
        allowJs: true,
        checkJs: false,
        moduleResolution: 100,
        resolvePackageJsonExports: true,
        resolvePackageJsonImports: true,
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
  moduleResolutionKind: {
    Bundler?: number;
    NodeNext?: number;
    NodeJs: number;
  } = { NodeJs: 2 },
) {
  return {
    languages: {
      typescript: {
        javascriptDefaults,
        typescriptDefaults,
        JsxEmit: { ReactJSX: 4 },
        ModuleKind: { ESNext: 99 },
        ModuleResolutionKind: moduleResolutionKind,
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
