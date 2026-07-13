import { describe, expect, it, vi } from "vitest";
import {
  phpFrameworkCompletionSuggestions,
  phpFrameworkStringCompletionOwnsContext,
  providePhpFrameworkDefinitionBeforeLsp,
  type PhpFrameworkMonacoProviderContext,
} from "./phpFrameworkMonacoProviders";

describe("php framework Monaco providers", () => {
  it("lets presenter links handle definitions before generic framework strings", async () => {
    const source = "<?php\n$this->link('Product:show');";
    const context = providerContext({
      providePhpPresenterLinkDefinition: vi.fn(async () => true),
      providePhpFrameworkDefinition: vi.fn(async () => true),
    });

    await expect(
      providePhpFrameworkDefinitionBeforeLsp(
        context,
        model(source),
        positionAt(source, source.indexOf("Product")),
      ),
    ).resolves.toBe(true);
    expect(context.providePhpPresenterLinkDefinition).toHaveBeenCalledWith(
      source,
      source.indexOf("Product"),
      expect.objectContaining({ canNavigate: expect.any(Function) }),
    );
    expect(context.providePhpFrameworkDefinition).not.toHaveBeenCalled();
  });

  it("falls through to framework string literal definitions after presenter links miss", async () => {
    const source = "<?php\n$value = config('app.name');";
    const offset = source.indexOf("app.name");
    const context = providerContext({
      providePhpPresenterLinkDefinition: vi.fn(async () => false),
      providePhpFrameworkDefinition: vi.fn(async () => true),
    });

    await expect(
      providePhpFrameworkDefinitionBeforeLsp(
        context,
        model(source),
        positionAt(source, offset),
      ),
    ).resolves.toBe(true);
    expect(context.providePhpFrameworkDefinition).toHaveBeenCalledWith(
      source,
      offset,
      expect.objectContaining({ canNavigate: expect.any(Function) }),
    );
  });

  it("keeps framework string completion ownership behind the framework callback", () => {
    const source = "<?php\nroute('invoices.";
    const position = positionAt(source, source.length);
    const context = providerContext({
      isPhpFrameworkStringCompletionContext: vi.fn(() => true),
    });

    expect(
      phpFrameworkStringCompletionOwnsContext(context, source, position),
    ).toBe(true);
    expect(context.isPhpFrameworkStringCompletionContext).toHaveBeenCalledWith(
      source,
      position,
    );
  });

  it("keeps presenter-link completion ownership behind the framework callback", async () => {
    const source = "<?php\n$label = 'Product:show';";
    const offset = source.indexOf("Product");
    const context = providerContext({
      isPhpPresenterLinkCompletionContext: vi.fn(() => false),
      providePhpPresenterLinkCompletions: vi.fn(async () => []),
    });

    await expect(
      phpFrameworkCompletionSuggestions(
        monaco(),
        context,
        model(source),
        source,
        positionAt(source, offset),
        fallbackRange(),
        { rootPath: "/workspace", sessionId: 7 },
      ),
    ).resolves.toBeNull();
    expect(context.isPhpPresenterLinkCompletionContext).toHaveBeenCalledWith(
      source,
      offset,
    );
    expect(context.providePhpPresenterLinkCompletions).not.toHaveBeenCalled();
  });
});

function providerContext(
  overrides: Partial<PhpFrameworkMonacoProviderContext> = {},
): PhpFrameworkMonacoProviderContext {
  return {
    getActiveDocument: () => ({
      content: "",
      language: "php",
      name: "ProductPresenter.php",
      path: "/workspace/app/Presenters/ProductPresenter.php",
      savedContent: "",
    }),
    getRuntimeStatus: () => ({
      capabilities: {},
      kind: "running",
      rootPath: "/workspace",
      sessionId: 7,
    }) as ReturnType<PhpFrameworkMonacoProviderContext["getRuntimeStatus"]>,
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

function positionAt(source: string, offset: number) {
  const before = source.slice(0, offset);
  const lines = before.split("\n");

  return {
    column: lines[lines.length - 1].length + 1,
    lineNumber: lines.length,
  } as never;
}

function monaco() {
  return {
    languages: {
      CompletionItemKind: {},
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
