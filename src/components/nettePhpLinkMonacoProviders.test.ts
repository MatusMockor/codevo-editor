import { describe, expect, it, vi } from "vitest";
import {
  phpNettePresenterLinkCompletionSuggestions,
  provideNettePhpPresenterLinkDefinition,
  type NettePhpLinkMonacoProviderContext,
} from "./nettePhpLinkMonacoProviders";
import type { LatteCompletion } from "./templateLanguageMonacoProviders";

describe("nette PHP link Monaco providers", () => {
  it("delegates presenter-link definition with the current PHP source offset", async () => {
    const source = "<?php\n$this->link('Product:show');";
    const context = providerContext({
      provideNettePhpLinkDefinition: vi.fn(async () => true),
    });

    const handled = await provideNettePhpPresenterLinkDefinition(
      context,
      model(source),
      positionAt(source, source.indexOf("Product")),
    );

    expect(handled).toBe(true);
    expect(context.provideNettePhpLinkDefinition).toHaveBeenCalledWith(
      source,
      source.indexOf("Product"),
    );
  });

  it("maps presenter-link completions and preserves replace ranges", async () => {
    const source = "<?php\n$this->link('Pro');";
    const replaceStart = source.indexOf("Pro");
    const replaceEnd = replaceStart + "Pro".length;
    const context = providerContext({
      provideNettePhpLinkCompletions: vi.fn(async () => [
        {
          detail: "App\\Presentation\\ProductPresenter::renderShow",
          insertText: "Product:show",
          kind: "link" as const,
          label: "Product:show",
          replaceEnd,
          replaceStart,
        },
      ]),
    });

    const suggestions = await phpNettePresenterLinkCompletionSuggestions(
      monaco(),
      context,
      model(source),
      source,
      positionAt(source, replaceEnd),
      fallbackRange(),
      { rootPath: "/workspace", sessionId: 7 },
    );

    expect(context.provideNettePhpLinkCompletions).toHaveBeenCalledWith(
      source,
      replaceEnd,
    );
    expect(suggestions).toEqual([
      expect.objectContaining({
        detail: "App\\Presentation\\ProductPresenter::renderShow",
        insertText: "Product:show",
        kind: 10,
        label: "Product:show",
        range: expect.objectContaining({
          endColumn: 17,
          endLineNumber: 2,
          startColumn: 14,
          startLineNumber: 2,
        }),
        sortText: "0_0000",
      }),
    ]);
  });

  it("falls through without calling Nette completion outside presenter-link strings", async () => {
    const source = "<?php\n$label = 'Product:show';";
    const context = providerContext({
      provideNettePhpLinkCompletions: vi.fn(async () => []),
    });

    const suggestions = await phpNettePresenterLinkCompletionSuggestions(
      monaco(),
      context,
      model(source),
      source,
      positionAt(source, source.indexOf("Product")),
      fallbackRange(),
      { rootPath: "/workspace", sessionId: 7 },
    );

    expect(suggestions).toBeNull();
    expect(context.provideNettePhpLinkCompletions).not.toHaveBeenCalled();
  });

  it("drops stale async completions without reporting an error", async () => {
    const source = "<?php\n$this->link('Pro');";
    const completion = deferred<LatteCompletion[] | null>();
    let sessionId = 7;
    const context = providerContext({
      getRuntimeStatus: () =>
        ({
          capabilities: {},
          kind: "running",
          rootPath: "/workspace",
          sessionId,
        }) as ReturnType<NettePhpLinkMonacoProviderContext["getRuntimeStatus"]>,
      provideNettePhpLinkCompletions: vi.fn(async () => completion.promise),
    });

    const suggestionsPromise = phpNettePresenterLinkCompletionSuggestions(
      monaco(),
      context,
      model(source),
      source,
      positionAt(source, source.indexOf("Pro") + "Pro".length),
      fallbackRange(),
      { rootPath: "/workspace", sessionId: 7 },
    );
    sessionId = 8;
    completion.resolve([
      {
        insertText: "Product:show",
        kind: "link",
        label: "Product:show",
      },
    ]);

    await expect(suggestionsPromise).resolves.toEqual([]);
    expect(context.reportError).not.toHaveBeenCalled();
  });
});

function providerContext(
  overrides: Partial<NettePhpLinkMonacoProviderContext> = {},
): NettePhpLinkMonacoProviderContext {
  return {
    getActiveDocument: () => ({
        content: "",
        language: "php",
        name: "ProductPresenter.php",
        path: "/workspace/app/Presenters/ProductPresenter.php",
        savedContent: "",
      }),
    getRuntimeStatus: () =>
      ({
        capabilities: {},
        kind: "running",
        rootPath: "/workspace",
        sessionId: 7,
      }) as ReturnType<NettePhpLinkMonacoProviderContext["getRuntimeStatus"]>,
    getWorkspaceRoot: () => "/workspace",
    reportError: vi.fn(),
    ...overrides,
  };
}

function model(source: string) {
  return {
    getValue: () => source,
    uri: { fsPath: "/workspace/app/Presenters/ProductPresenter.php" },
  } as never;
}

function monaco() {
  return {
    languages: {
      CompletionItemKind: {
        File: 5,
        Field: 4,
        Function: 3,
        Keyword: 17,
        Method: 10,
        Module: 8,
        Variable: 6,
      },
    },
    Range: class Range {
      constructor(
        public startLineNumber: number,
        public startColumn: number,
        public endLineNumber: number,
        public endColumn: number,
      ) {}
    },
  } as never;
}

function fallbackRange() {
  return {
    endColumn: 1,
    endLineNumber: 1,
    startColumn: 1,
    startLineNumber: 1,
  };
}

function positionAt(source: string, offset: number) {
  const before = source.slice(0, offset);
  const lines = before.split("\n");

  return {
    column: lines[lines.length - 1].length + 1,
    lineNumber: lines.length,
  } as never;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });

  return { promise, resolve };
}
