import { describe, expect, it } from "vitest";
import { defaultWorkspaceSettings } from "../domain/settings";
import type { EditorDocument } from "../domain/workspace";
import {
  formattingOptionsForActiveJavaScriptTypeScriptDocument,
  javaScriptTypeScriptLanguageServerConfiguration,
  javaScriptTypeScriptLanguageServerOptions,
  javaScriptTypeScriptSettingsChangeKind,
} from "./javaScriptTypeScriptLanguageServerSettings";

describe("javaScriptTypeScriptSettingsChangeKind", () => {
  it("returns none for unrelated workspace settings changes", () => {
    const previous = defaultWorkspaceSettings();
    const next = {
      ...previous,
      phpBackend: "phpactor" as const,
    };

    expect(javaScriptTypeScriptSettingsChangeKind(previous, next)).toBe("none");
  });

  it("returns configuration for live JavaScript and TypeScript configuration changes", () => {
    const previous = defaultWorkspaceSettings();
    const next = {
      ...previous,
      javaScriptTypeScriptAutoImports: false,
      javaScriptTypeScriptReferencesCodeLensOnAllFunctions: true,
      javaScriptTypeScriptQuotePreference: "single" as const,
    };

    expect(javaScriptTypeScriptSettingsChangeKind(previous, next)).toBe(
      "configuration",
    );
  });

  it("returns restart for settings that require a new JavaScript and TypeScript runtime", () => {
    const previous = defaultWorkspaceSettings();
    const next = {
      ...previous,
      javaScriptTypeScriptAutomaticTypeAcquisition: true,
      javaScriptTypeScriptAutoImports: false,
    };

    expect(javaScriptTypeScriptSettingsChangeKind(previous, next)).toBe(
      "restart",
    );
  });
});

describe("javaScriptTypeScriptLanguageServerOptions", () => {
  it("omits default import preferences", () => {
    expect(
      javaScriptTypeScriptLanguageServerOptions(defaultWorkspaceSettings()),
    ).toEqual({
      autoImportsEnabled: true,
      automaticTypeAcquisitionEnabled: false,
      codeLensEnabled: false,
      completeFunctionCalls: false,
      inlayHintsEnabled: true,
      typeScriptVersionPreference: "bundled",
      validationEnabled: true,
    });
  });

  it("includes non-default import preferences", () => {
    const settings = {
      ...defaultWorkspaceSettings(),
      javaScriptTypeScriptImportModuleSpecifierEnding: "minimal" as const,
      javaScriptTypeScriptImportModuleSpecifierPreference: "relative" as const,
      javaScriptTypeScriptPreferTypeOnlyAutoImports: true,
      javaScriptTypeScriptQuotePreference: "single" as const,
      javaScriptTypeScriptVersion: "workspace" as const,
    };

    expect(javaScriptTypeScriptLanguageServerOptions(settings)).toEqual({
      autoImportsEnabled: true,
      automaticTypeAcquisitionEnabled: false,
      codeLensEnabled: false,
      completeFunctionCalls: false,
      importModuleSpecifierEnding: "minimal",
      importModuleSpecifierPreference: "relative",
      inlayHintsEnabled: true,
      preferTypeOnlyAutoImports: true,
      quotePreference: "single",
      typeScriptVersionPreference: "workspace",
      validationEnabled: true,
    });
  });
});

describe("javaScriptTypeScriptLanguageServerConfiguration", () => {
  it("uses active EditorConfig formatting options", () => {
    const configuration = javaScriptTypeScriptLanguageServerConfiguration(
      defaultWorkspaceSettings(),
      {
        indentSize: 4,
        indentStyle: "space",
      },
      null,
    );

    expect(configuration).toEqual(
      expect.objectContaining({
        formattingOptions: {
          insertSpaces: true,
          tabSize: 4,
        },
      }),
    );
  });

  it("falls back to active document indentation when EditorConfig is absent", () => {
    const document: EditorDocument = {
      content: ["export function run() {", "\treturn 1;", "}", ""].join("\n"),
      language: "typescript",
      name: "App.ts",
      path: "/workspace/src/App.ts",
      savedContent: "",
    };

    expect(
      formattingOptionsForActiveJavaScriptTypeScriptDocument(
        defaultWorkspaceSettings(),
        {},
        document,
      ),
    ).toEqual({
      insertSpaces: false,
      tabSize: 4,
    });
  });

  it("maps JavaScript and TypeScript settings into the configuration payload", () => {
    const configuration = javaScriptTypeScriptLanguageServerConfiguration(
      {
        ...defaultWorkspaceSettings(),
        javaScriptTypeScriptAutoImports: false,
        javaScriptTypeScriptCodeLens: true,
        javaScriptTypeScriptReferencesCodeLensOnAllFunctions: true,
        javaScriptTypeScriptCompleteFunctionCalls: true,
        javaScriptTypeScriptInlayHints: false,
        javaScriptTypeScriptQuotePreference: "single",
        javaScriptTypeScriptValidation: false,
      },
      {},
      null,
    );

    expect(configuration).toEqual(
      expect.objectContaining({
        preferences: expect.objectContaining({
          includePackageJsonAutoImports: "off",
          includeInlayParameterNameHints: "none",
          quotePreference: "single",
        }),
        referencesCodeLens: {
          enabled: true,
          showOnAllFunctions: true,
        },
        suggest: expect.objectContaining({
          autoImports: false,
          completeFunctionCalls: true,
        }),
        validate: {
          enable: false,
        },
      }),
    );
  });
});
