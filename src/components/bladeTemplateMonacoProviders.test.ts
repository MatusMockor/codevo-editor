import { describe, expect, it, vi } from "vitest";
import type * as Monaco from "monaco-editor";
import { registerBladeTemplateMonacoProviders } from "./bladeTemplateMonacoProviders";
import type {
  TemplateLanguageMonacoProviderContext,
  TemplateLanguageMonacoProviderHandlers,
  TemplateLanguageProviderRegistry,
} from "./templateLanguageMonacoTypes";

const LARGE_DOCUMENT_POLICY = { characterLimit: 16 * 1024, lineLimit: 500 };
const NORMAL_BLADE_SOURCE = "@include('partials.card')";
const LARGE_BLADE_SOURCE = "@include('partials.card')\n".repeat(501);

describe("registerBladeTemplateMonacoProviders", () => {
  it("provides Blade completions for a normal document", async () => {
    const registered = registerProviders();
    const provideCompletions = vi.fn(async () => [
      { insertText: "@include", kind: "directive" as const, label: "@include" },
    ]);
    const context = templateContext({
      provideCompletions,
      source: NORMAL_BLADE_SOURCE,
    });
    registerBladeTemplateMonacoProviders(registered.monaco, context, handlers());

    const result = await registered.completionProvider?.provideCompletionItems(
      textModel(NORMAL_BLADE_SOURCE),
      position(),
      {} as Monaco.languages.CompletionContext,
      {} as never,
    );

    expect(provideCompletions).toHaveBeenCalledWith(NORMAL_BLADE_SOURCE, position());
    expect(result?.suggestions).toHaveLength(1);
  });

  it("skips Blade completions for a large document", async () => {
    const registered = registerProviders();
    const provideCompletions = vi.fn(async () => [
      { insertText: "@include", kind: "directive" as const, label: "@include" },
    ]);
    const context = templateContext({
      provideCompletions,
      source: LARGE_BLADE_SOURCE,
    });
    registerBladeTemplateMonacoProviders(registered.monaco, context, handlers());

    const result = await registered.completionProvider?.provideCompletionItems(
      textModel(LARGE_BLADE_SOURCE),
      position(),
      {} as Monaco.languages.CompletionContext,
      {} as never,
    );

    expect(provideCompletions).not.toHaveBeenCalled();
    expect(result?.suggestions).toEqual([]);
  });

  it("provides the Blade definition lookup for a normal document", async () => {
    const registered = registerProviders();
    const provideDefinition = vi.fn(async () => true);
    const context = templateContext({
      provideDefinition,
      source: NORMAL_BLADE_SOURCE,
    });
    registerBladeTemplateMonacoProviders(registered.monaco, context, handlers());

    await registered.definitionProvider?.provideDefinition(
      textModel(NORMAL_BLADE_SOURCE),
      position(),
      {} as never,
    );

    expect(provideDefinition).toHaveBeenCalledWith(
      NORMAL_BLADE_SOURCE,
      0,
      expect.anything(),
    );
  });

  it("skips the Blade definition lookup for a large document", async () => {
    const registered = registerProviders();
    const provideDefinition = vi.fn(async () => true);
    const context = templateContext({
      provideDefinition,
      source: LARGE_BLADE_SOURCE,
    });
    registerBladeTemplateMonacoProviders(registered.monaco, context, handlers());

    const result = await registered.definitionProvider?.provideDefinition(
      textModel(LARGE_BLADE_SOURCE),
      position(),
      {} as never,
    );

    expect(provideDefinition).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});

function handlers(): TemplateLanguageMonacoProviderHandlers<
  TemplateLanguageMonacoProviderContext
> {
  return { toCodeAction: vi.fn() } as TemplateLanguageMonacoProviderHandlers<
    TemplateLanguageMonacoProviderContext
  >;
}

function position(): Monaco.Position {
  return { column: 1, lineNumber: 1 } as Monaco.Position;
}

function registerProviders() {
  let completionProvider: Monaco.languages.CompletionItemProvider | undefined;
  let definitionProvider: Monaco.languages.DefinitionProvider | undefined;
  const monaco = {
    languages: {
      CompletionItemKind: {
        Field: 1,
        File: 2,
        Function: 3,
        Keyword: 4,
        Method: 5,
        Module: 6,
        Variable: 7,
      },
      registerCodeActionProvider: vi.fn(() => ({ dispose: () => undefined })),
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
  provideCompletions?: TemplateLanguageProviderRegistry["blade"]["provideCompletions"];
  provideDefinition?: TemplateLanguageProviderRegistry["blade"]["provideDefinition"];
  source: string;
}): TemplateLanguageMonacoProviderContext {
  return {
    getActiveDocument: () => ({
      content: source,
      language: "blade",
      name: "card.blade.php",
      path: "/ws/resources/views/card.blade.php",
      savedContent: source,
    }),
    getLargeSmartDocumentPolicy: () => LARGE_DOCUMENT_POLICY,
    getTemplateLanguageProviders: () => ({
      blade: {
        provideCodeActions: vi.fn(async () => []),
        provideCompletions,
        provideDefinition,
      },
      latte: {
        provideCodeActions: vi.fn(async () => []),
        provideCompletions: vi.fn(async () => []),
        provideDefinition: vi.fn(async () => false),
      },
      neon: {
        provideCompletions: vi.fn(async () => []),
        provideDefinition: vi.fn(async () => false),
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
      fsPath: "/ws/resources/views/card.blade.php",
      path: "/ws/resources/views/card.blade.php",
      scheme: "file",
      toString: () => "file:///ws/resources/views/card.blade.php",
    },
  } as unknown as Monaco.editor.ITextModel;
}
