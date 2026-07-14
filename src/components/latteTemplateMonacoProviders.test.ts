import { describe, expect, it, vi } from "vitest";
import type * as Monaco from "monaco-editor";
import { registerLatteTemplateMonacoProviders } from "./latteTemplateMonacoProviders";
import type {
  TemplateLanguageMonacoProviderContext,
  TemplateLanguageMonacoProviderHandlers,
  TemplateLanguageProviderRegistry,
} from "./templateLanguageMonacoTypes";

const LARGE_DOCUMENT_POLICY = { characterLimit: 16 * 1024, lineLimit: 500 };
const NORMAL_LATTE_SOURCE = "{include 'partials/card'}";
const LARGE_LATTE_SOURCE = "{include 'partials/card'}\n".repeat(501);

describe("registerLatteTemplateMonacoProviders", () => {
  it("provides Latte completions for a normal document", async () => {
    const registered = registerProviders();
    const provideCompletions = vi.fn(async () => [
      { insertText: "include", kind: "tag" as const, label: "include" },
    ]);
    const context = templateContext({ provideCompletions });
    registerLatteTemplateMonacoProviders(
      registered.monaco,
      context,
      { toCodeAction: vi.fn() } as TemplateLanguageMonacoProviderHandlers<
        TemplateLanguageMonacoProviderContext
      >,
    );

    const result = await registered.completionProvider?.provideCompletionItems(
      textModel(NORMAL_LATTE_SOURCE),
      latteCursorPosition(),
      {} as Monaco.languages.CompletionContext,
      {} as never,
    );

    expect(provideCompletions).toHaveBeenCalledWith(
      NORMAL_LATTE_SOURCE,
      latteCursorPosition(),
    );
    expect(result?.suggestions).toHaveLength(1);
  });

  it("skips Latte completions for a large document", async () => {
    const registered = registerProviders();
    const provideCompletions = vi.fn(async () => [
      { insertText: "include", kind: "tag" as const, label: "include" },
    ]);
    const context = templateContext({
      content: LARGE_LATTE_SOURCE,
      provideCompletions,
    });
    registerLatteTemplateMonacoProviders(
      registered.monaco,
      context,
      { toCodeAction: vi.fn() } as TemplateLanguageMonacoProviderHandlers<
        TemplateLanguageMonacoProviderContext
      >,
    );

    const result = await registered.completionProvider?.provideCompletionItems(
      textModel(LARGE_LATTE_SOURCE),
      latteCursorPosition(),
      {} as Monaco.languages.CompletionContext,
      {} as never,
    );

    expect(provideCompletions).not.toHaveBeenCalled();
    expect(result?.suggestions).toEqual([]);
  });

  it("provides the Latte definition lookup for a normal document", async () => {
    const registered = registerProviders();
    const provideDefinition = vi.fn(async () => true);
    const context = templateContext({ provideDefinition });
    registerLatteTemplateMonacoProviders(
      registered.monaco,
      context,
      { toCodeAction: vi.fn() } as TemplateLanguageMonacoProviderHandlers<
        TemplateLanguageMonacoProviderContext
      >,
    );

    await registered.definitionProvider?.provideDefinition(
      textModel(NORMAL_LATTE_SOURCE),
      latteCursorPosition(),
      {} as never,
    );

    expect(provideDefinition).toHaveBeenCalledWith(
      NORMAL_LATTE_SOURCE,
      0,
      expect.anything(),
    );
  });

  it("skips the Latte definition lookup for a large document", async () => {
    const registered = registerProviders();
    const provideDefinition = vi.fn(async () => true);
    const context = templateContext({
      content: LARGE_LATTE_SOURCE,
      provideDefinition,
    });
    registerLatteTemplateMonacoProviders(
      registered.monaco,
      context,
      { toCodeAction: vi.fn() } as TemplateLanguageMonacoProviderHandlers<
        TemplateLanguageMonacoProviderContext
      >,
    );

    const result = await registered.definitionProvider?.provideDefinition(
      textModel(LARGE_LATTE_SOURCE),
      latteCursorPosition(),
      {} as never,
    );

    expect(provideDefinition).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("maps Latte quick fixes through the shared code-action handler", async () => {
    const registered = registerProviders();
    const descriptor = {
      edits: [],
      isPreferred: true,
      kind: "quickfix",
      title: "Create Latte template partials/card",
    };
    const provideCodeActions = vi.fn(async () => [descriptor]);
    const context = templateContext({ provideCodeActions });
    const toCodeAction = vi.fn(() => ({ title: descriptor.title }));
    const disposable = registerLatteTemplateMonacoProviders(
      registered.monaco,
      context,
      { toCodeAction } as TemplateLanguageMonacoProviderHandlers<
        TemplateLanguageMonacoProviderContext
      >,
    );
    const model = textModel("{include 'partials/card'}");

    const result = await registered.codeActionProvider?.provideCodeActions(
      model,
      {
        endColumn: 18,
        endLineNumber: 1,
        startColumn: 12,
        startLineNumber: 1,
      } as Monaco.Range,
      { markers: [], trigger: "manual" } as unknown as Monaco.languages.CodeActionContext,
      {} as never,
    );

    expect(result?.actions).toEqual([{ title: descriptor.title }]);
    expect(provideCodeActions).toHaveBeenCalledWith("{include 'partials/card'}", {
      end: 17,
      start: 11,
    });
    expect(toCodeAction).toHaveBeenCalledWith(
      registered.monaco,
      context,
      model,
      descriptor,
    );

    disposable.dispose();
    expect(registered.disposed).toEqual(["definition", "completion", "actions"]);
  });

  it("maps Monaco markers into the Latte code-action diagnostic context", async () => {
    const registered = registerProviders();
    const provideCodeActions = vi.fn(async () => []);
    const context = templateContext({ provideCodeActions });
    const disposable = registerLatteTemplateMonacoProviders(
      registered.monaco,
      context,
      { toCodeAction: vi.fn() } as TemplateLanguageMonacoProviderHandlers<
        TemplateLanguageMonacoProviderContext
      >,
    );
    const markerData = {
      candidateMethodNames: ["renderDetail"],
      kind: "missing-presenter-method",
      presenterPath: "/ws/app/UI/Home/HomePresenter.php",
      target: "Home:detail",
    };
    const model = textModel("{link Home:detail}");

    await registered.codeActionProvider?.provideCodeActions(
      model,
      {
        endColumn: 18,
        endLineNumber: 1,
        startColumn: 7,
        startLineNumber: 1,
      } as Monaco.Range,
      {
        markers: [
          {
            code: "nette.missingPresenterMethod",
            data: markerData,
            endColumn: 18,
            endLineNumber: 1,
            message: "Missing presenter method.",
            severity: 4,
            source: "Nette",
            startColumn: 7,
            startLineNumber: 1,
          },
        ],
        trigger: "manual",
      } as unknown as Monaco.languages.CodeActionContext,
      {} as never,
    );

    expect(provideCodeActions).toHaveBeenCalledWith(
      "{link Home:detail}",
      { end: 17, start: 6 },
      {
        diagnostics: [
          {
            code: "nette.missingPresenterMethod",
            data: markerData,
            message: "Missing presenter method.",
            range: {
              endColumn: 18,
              endLineNumber: 1,
              startColumn: 7,
              startLineNumber: 1,
            },
            source: "Nette",
          },
        ],
      },
    );

    disposable.dispose();
  });
});

function registerProviders() {
  const disposed: string[] = [];
  let codeActionProvider:
    | Monaco.languages.CodeActionProvider
    | undefined;
  let completionProvider:
    | Monaco.languages.CompletionItemProvider
    | undefined;
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
      registerCodeActionProvider: vi.fn(
        (_language: string, provider: Monaco.languages.CodeActionProvider) => {
          codeActionProvider = provider;

          return { dispose: () => disposed.push("actions") };
        },
      ),
      registerCompletionItemProvider: vi.fn(
        (
          _language: string,
          provider: Monaco.languages.CompletionItemProvider,
        ) => {
          completionProvider = provider;

          return { dispose: () => disposed.push("completion") };
        },
      ),
      registerDefinitionProvider: vi.fn(
        (_language: string, provider: Monaco.languages.DefinitionProvider) => {
          definitionProvider = provider;

          return { dispose: () => disposed.push("definition") };
        },
      ),
    },
  } as unknown as typeof Monaco;

  return {
    disposed,
    get codeActionProvider() {
      return codeActionProvider;
    },
    get completionProvider() {
      return completionProvider;
    },
    get definitionProvider() {
      return definitionProvider;
    },
    monaco,
  };
}

function latteCursorPosition(): Monaco.Position {
  return { column: 1, lineNumber: 1 } as Monaco.Position;
}

function templateContext({
  content = NORMAL_LATTE_SOURCE,
  provideCodeActions = vi.fn(async () => []),
  provideCompletions = vi.fn(async () => []),
  provideDefinition = vi.fn(async () => false),
}: {
  content?: string;
  provideCodeActions?: TemplateLanguageMonacoProviderContext["getTemplateLanguageProviders"] extends () => infer Registry
    ? Registry extends { latte: { provideCodeActions: infer Provider } }
      ? Provider
      : never
    : never;
  provideCompletions?: TemplateLanguageProviderRegistry["latte"]["provideCompletions"];
  provideDefinition?: TemplateLanguageProviderRegistry["latte"]["provideDefinition"];
}): TemplateLanguageMonacoProviderContext {
  return {
    getActiveDocument: () => ({
      content,
      language: "latte",
      name: "default.latte",
      path: "/ws/app/UI/Home/default.latte",
      savedContent: content,
    }),
    getLargeSmartDocumentPolicy: () => LARGE_DOCUMENT_POLICY,
    getTemplateLanguageProviders: () => ({
      blade: {
        provideCodeActions: vi.fn(async () => []),
        provideCompletions: vi.fn(async () => []),
        provideDefinition: vi.fn(async () => false),
      },
      latte: {
        provideCodeActions,
        provideCompletions,
        provideDefinition,
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
    getValue: () => value,
    getWordUntilPosition: () => ({ endColumn: 1, startColumn: 1, word: "" }),
    uri: {
      fsPath: "/ws/app/UI/Home/default.latte",
      path: "/ws/app/UI/Home/default.latte",
      scheme: "file",
      toString: () => "file:///ws/app/UI/Home/default.latte",
    },
  } as unknown as Monaco.editor.ITextModel;
}
