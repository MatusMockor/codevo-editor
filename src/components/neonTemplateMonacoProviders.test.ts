import { describe, expect, it, vi } from "vitest";
import type * as Monaco from "monaco-editor";
import { registerNeonTemplateMonacoProviders } from "./neonTemplateMonacoProviders";
import type {
  TemplateLanguageMonacoProviderContext,
  TemplateLanguageProviderRegistry,
} from "./templateLanguageMonacoTypes";

const LARGE_DOCUMENT_POLICY = { characterLimit: 16 * 1024, lineLimit: 500 };
const NORMAL_NEON_SOURCE = "services:\n  - App\\Model\\UserFacade";
const LARGE_NEON_SOURCE = "services:\n".repeat(501);

describe("registerNeonTemplateMonacoProviders", () => {
  it("provides NEON completions for a normal document", async () => {
    const registered = registerProviders();
    const provideCompletions = vi.fn(async () => [
      { insertText: "services", kind: "service" as const, label: "services" },
    ]);
    const context = templateContext({
      provideCompletions,
      source: NORMAL_NEON_SOURCE,
    });
    registerNeonTemplateMonacoProviders(registered.monaco, context);

    const result = await registered.completionProvider?.provideCompletionItems(
      textModel(NORMAL_NEON_SOURCE),
      position(),
      {} as Monaco.languages.CompletionContext,
      {} as never,
    );

    expect(provideCompletions).toHaveBeenCalledWith(
      NORMAL_NEON_SOURCE,
      position(),
    );
    expect(result?.suggestions).toHaveLength(1);
  });

  it("skips NEON completions for a large document", async () => {
    const registered = registerProviders();
    const provideCompletions = vi.fn(async () => [
      { insertText: "services", kind: "service" as const, label: "services" },
    ]);
    const context = templateContext({
      provideCompletions,
      source: LARGE_NEON_SOURCE,
    });
    registerNeonTemplateMonacoProviders(registered.monaco, context);

    const result = await registered.completionProvider?.provideCompletionItems(
      textModel(LARGE_NEON_SOURCE),
      position(),
      {} as Monaco.languages.CompletionContext,
      {} as never,
    );

    expect(provideCompletions).not.toHaveBeenCalled();
    expect(result?.suggestions).toEqual([]);
  });

  it("runs the NEON definition lookup for a normal document", async () => {
    const registered = registerProviders();
    const provideDefinition = vi.fn(async () => false);
    const context = templateContext({
      provideDefinition,
      source: NORMAL_NEON_SOURCE,
    });
    registerNeonTemplateMonacoProviders(registered.monaco, context);

    await registered.definitionProvider?.provideDefinition(
      textModel(NORMAL_NEON_SOURCE),
      position(),
      {} as never,
    );

    expect(provideDefinition).toHaveBeenCalledWith(
      NORMAL_NEON_SOURCE,
      0,
      expect.anything(),
    );
  });

  it("skips the NEON definition lookup for a large document", async () => {
    const registered = registerProviders();
    const provideDefinition = vi.fn(async () => false);
    const context = templateContext({
      provideDefinition,
      source: LARGE_NEON_SOURCE,
    });
    registerNeonTemplateMonacoProviders(registered.monaco, context);

    const result = await registered.definitionProvider?.provideDefinition(
      textModel(LARGE_NEON_SOURCE),
      position(),
      {} as never,
    );

    expect(provideDefinition).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});

function position(): Monaco.Position {
  return { column: 1, lineNumber: 1 } as Monaco.Position;
}

function registerProviders() {
  let completionProvider: Monaco.languages.CompletionItemProvider | undefined;
  let definitionProvider: Monaco.languages.DefinitionProvider | undefined;
  const monaco = {
    languages: {
      CompletionItemKind: {
        Class: 1,
        Field: 2,
        Keyword: 3,
        Module: 4,
        Property: 5,
        Value: 6,
        Variable: 7,
      },
      registerCompletionItemProvider: vi.fn(
        (
          _language: string,
          provider: Monaco.languages.CompletionItemProvider,
        ) => {
          completionProvider = provider;

          return { dispose: () => undefined };
        },
      ),
      registerDefinitionProvider: vi.fn(
        (_language: string, provider: Monaco.languages.DefinitionProvider) => {
          definitionProvider = provider;

          return { dispose: () => undefined };
        },
      ),
    },
  } as unknown as typeof Monaco;

  return {
    get completionProvider() {
      return completionProvider;
    },
    get definitionProvider() {
      return definitionProvider;
    },
    monaco,
  };
}

function templateContext({
  provideCompletions = vi.fn(async () => []),
  provideDefinition = vi.fn(async () => false),
  source,
}: {
  provideCompletions?: TemplateLanguageProviderRegistry["neon"]["provideCompletions"];
  provideDefinition?: TemplateLanguageProviderRegistry["neon"]["provideDefinition"];
  source: string;
}): TemplateLanguageMonacoProviderContext {
  return {
    getActiveDocument: () => ({
      content: source,
      language: "neon",
      name: "services.neon",
      path: "/ws/config/services.neon",
      savedContent: source,
    }),
    getLargeSmartDocumentPolicy: () => LARGE_DOCUMENT_POLICY,
    getTemplateLanguageProviders: () => ({
      blade: {
        provideCodeActions: vi.fn(async () => []),
        provideCompletions: vi.fn(async () => []),
        provideDefinition: vi.fn(async () => false),
      },
      latte: {
        provideCodeActions: vi.fn(async () => []),
        provideCompletions: vi.fn(async () => []),
        provideDefinition: vi.fn(async () => false),
      },
      neon: {
        provideCompletions,
        provideDefinition,
      },
    }),
    getWorkspaceRoot: () => "/ws",
    reportError: vi.fn(),
  };
}

function textModel(value: string): Monaco.editor.ITextModel {
  return {
    getLineContent: () => "",
    getValue: () => value,
    getWordUntilPosition: () => ({ endColumn: 1, startColumn: 1, word: "" }),
    uri: {
      fsPath: "/ws/config/services.neon",
      path: "/ws/config/services.neon",
      scheme: "file",
      toString: () => "file:///ws/config/services.neon",
    },
  } as unknown as Monaco.editor.ITextModel;
}
