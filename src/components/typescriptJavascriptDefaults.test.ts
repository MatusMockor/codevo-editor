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
    expect(javascriptDefaults.setCompilerOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        allowJs: true,
        checkJs: false,
      }),
    );
  });
});

function languageDefaults() {
  return {
    setCompilerOptions: vi.fn(),
    setDiagnosticsOptions: vi.fn(),
    setEagerModelSync: vi.fn(),
  };
}
