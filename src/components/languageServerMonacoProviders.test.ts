import { describe, expect, it, vi } from "vitest";
import { registerLanguageServerMonacoProviders } from "./languageServerMonacoProviders";
import type {
  LanguageServerCompletionList,
  LanguageServerFeaturesGateway,
  LanguageServerHover,
  LanguageServerLocation,
  LanguageServerRange,
  LanguageServerWorkspaceEdit,
  LanguageServerWorkspaceEditEvent,
  LanguageServerWorkspaceEditGateway,
} from "../domain/languageServerFeatures";
import type {
  LanguageServerCapabilities,
  LanguageServerRuntimeStatus,
} from "../domain/languageServerRuntime";
import type { PhpMethodSignature } from "../domain/phpMethodCompletions";
import type { EditorDocument } from "../domain/workspace";

describe("registerLanguageServerMonacoProviders", () => {
  it("registers php hover, completion, signature, code action, selection range, rename, reference, definition, declaration, implementation and type definition providers and disposes them", () => {
    const registered = createRegisteredProviders();
    const context = providerContext();
    const disposable = registerLanguageServerMonacoProviders(
      registered.monaco,
      context,
    );

    expect(registered.hoverLanguage).toBe("php");
    expect(registered.completionLanguage).toBe("php");
    expect(registered.completionProvider.triggerCharacters).toEqual([
      "$",
      ">",
      ":",
      "'",
      "\"",
    ]);
    expect(registered.signatureLanguage).toBe("php");
    expect(registered.codeActionLanguage).toBe("php");
    expect(registered.selectionRangeLanguage).toBe("php");
    expect(registered.renameLanguage).toBe("php");
    expect(registered.referenceLanguage).toBe("php");
    expect(registered.definitionLanguage).toBe("php");
    expect(registered.declarationLanguage).toBe("php");
    expect(registered.implementationLanguage).toBe("php");
    expect(registered.typeDefinitionLanguage).toBe("php");
    expect(registered.codeActionMetadata).toEqual({
      providedCodeActionKinds: [
        "quickfix",
        "refactor",
        "source",
        "source.fixAll",
        "source.organizeImports",
      ],
    });

    disposable.dispose();

    expect(registered.commandDispose).toHaveBeenCalled();
    expect(registered.hoverDispose).toHaveBeenCalled();
    expect(registered.completionDispose).toHaveBeenCalled();
    expect(registered.signatureDispose).toHaveBeenCalled();
    expect(registered.codeActionDispose).toHaveBeenCalled();
    expect(registered.selectionRangeDispose).toHaveBeenCalled();
    expect(registered.renameDispose).toHaveBeenCalled();
    expect(registered.referenceDispose).toHaveBeenCalled();
    expect(registered.definitionDispose).toHaveBeenCalled();
    expect(registered.declarationDispose).toHaveBeenCalled();
    expect(registered.implementationDispose).toHaveBeenCalled();
    expect(registered.typeDefinitionDispose).toHaveBeenCalled();
  });

  it("does not request hover when the provider capability is disabled", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway();
    const context = providerContext({
      featuresGateway: gateway,
      runtimeStatus: runningStatus({ hover: false }),
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.hoverProvider.provideHover(model(), position()),
    ).resolves.toBeNull();
    expect(gateway.hover).not.toHaveBeenCalled();
  });

  it("does not request hover when the PHP runtime status belongs to another workspace root", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      hover: { contents: "**Other project**" },
    });
    const flushPendingDocumentChange = vi.fn(async () => undefined);
    const context = providerContext({
      activeDocument: {
        ...document(),
        path: "/workspace/src/User.php",
      },
      featuresGateway: gateway,
      flushPendingDocumentChange,
      getWorkspaceRoot: () => "/workspace",
      runtimeStatus: {
        ...runningStatus(),
        rootPath: "/other",
      },
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.hoverProvider.provideHover(
        model({ path: "/workspace/src/User.php" }),
        position(),
      ),
    ).resolves.toBeNull();
    expect(flushPendingDocumentChange).not.toHaveBeenCalled();
    expect(gateway.hover).not.toHaveBeenCalled();
  });

  it("does not request hover when the PHP runtime status has no explicit workspace root", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      hover: { contents: "**Rootless**" },
    });
    const flushPendingDocumentChange = vi.fn(async () => undefined);
    const context = providerContext({
      featuresGateway: gateway,
      flushPendingDocumentChange,
      runtimeStatus: rootlessRunningStatus(),
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.hoverProvider.provideHover(model(), position()),
    ).resolves.toBeNull();
    expect(flushPendingDocumentChange).not.toHaveBeenCalled();
    expect(gateway.hover).not.toHaveBeenCalled();
  });

  it("flushes pending changes and maps hover responses", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      hover: { contents: "**User**" },
    });
    const flushPendingDocumentChange = vi.fn(async () => undefined);
    const context = providerContext({
      featuresGateway: gateway,
      flushPendingDocumentChange,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.hoverProvider.provideHover(model(), position()),
    ).resolves.toEqual({
      contents: [{ value: "**User**" }],
    });
    expect(flushPendingDocumentChange).toHaveBeenCalledWith(
      "/project/src/User.php",
    );
    expect(gateway.hover).toHaveBeenCalledWith(
      "/project",
      {
        character: 4,
        line: 10,
        path: "/project/src/User.php",
      },
    );
  });

  it("drops in-flight PHP hover when no project tab is active", async () => {
    const registered = createRegisteredProviders();
    let activeRoot: string | null = "/project";
    const hover = createDeferred<LanguageServerHover | null>();
    const gateway = featuresGateway();
    vi.mocked(gateway.hover).mockImplementationOnce(async () => hover.promise);
    const context = providerContext({
      featuresGateway: gateway,
      getWorkspaceRoot: () => activeRoot,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const hoverPromise = registered.hoverProvider.provideHover(
      model(),
      position(),
    );

    await Promise.resolve();
    activeRoot = null;
    hover.resolve({ contents: "**Stale user**" });

    await expect(hoverPromise).resolves.toBeNull();
    expect(gateway.hover).toHaveBeenCalledWith(
      "/project",
      {
        character: 4,
        line: 10,
        path: "/project/src/User.php",
      },
    );
  });

  it("drops in-flight PHP hover after same-root session restart", async () => {
    const registered = createRegisteredProviders();
    let activeSessionId = 1;
    const hover = createDeferred<LanguageServerHover | null>();
    const gateway = featuresGateway();
    vi.mocked(gateway.hover).mockImplementationOnce(async () => hover.promise);
    const context = providerContext({
      featuresGateway: gateway,
      getRuntimeStatus: () => ({
        ...runningStatus(),
        sessionId: activeSessionId,
      }),
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const hoverPromise = registered.hoverProvider.provideHover(
      model(),
      position(),
    );

    await Promise.resolve();
    activeSessionId = 2;
    hover.resolve({ contents: "**Stale user**" });

    await expect(hoverPromise).resolves.toBeNull();
    expect(gateway.hover).toHaveBeenCalledWith(
      "/project",
      {
        character: 4,
        line: 10,
        path: "/project/src/User.php",
      },
    );
  });

  it("maps completion responses to Monaco suggestions", async () => {
    const registered = createRegisteredProviders();
    const source = phpCompletionFixtureSource();
    const gateway = featuresGateway({
      completion: {
        isIncomplete: false,
        items: [
          {
            detail: "class",
            documentation: "A user",
            insertText: "User",
            kind: 7,
            label: "User",
          },
        ],
      },
    });
    const context = providerContext({ featuresGateway: gateway });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.completionProvider.provideCompletionItems(
        model({ content: source }),
        position(),
      ),
    ).resolves.toEqual({
      suggestions: [
        {
          detail: "local variable",
          insertText: "$user",
          kind: 6,
          label: "$user",
          range: {
            endColumn: 5,
            endLineNumber: 11,
            startColumn: 1,
            startLineNumber: 11,
          },
          sortText: "0_0000",
        },
        {
          detail: "class",
          documentation: "A user",
          insertText: "User",
          kind: 7,
          label: "User",
          range: {
            endColumn: 5,
            endLineNumber: 11,
            startColumn: 1,
            startLineNumber: 11,
          },
          sortText: "1_0000",
        },
      ],
    });
    expect(gateway.completion).toHaveBeenCalledWith(
      "/project",
      {
        character: 4,
        line: 10,
        path: "/project/src/User.php",
      },
    );
  });

  it("drops in-flight PHP completions when no project tab is active", async () => {
    const registered = createRegisteredProviders();
    let activeRoot: string | null = "/project";
    const completion = createDeferred<LanguageServerCompletionList>();
    const gateway = featuresGateway();
    vi.mocked(gateway.completion).mockImplementationOnce(
      async () => completion.promise,
    );
    const context = providerContext({
      featuresGateway: gateway,
      getWorkspaceRoot: () => activeRoot,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const completionPromise =
      registered.completionProvider.provideCompletionItems(
        model({ content: phpCompletionFixtureSource() }),
        position(),
      );

    for (
      let tick = 0;
      tick < 5 && vi.mocked(gateway.completion).mock.calls.length === 0;
      tick += 1
    ) {
      await Promise.resolve();
    }
    expect(gateway.completion).toHaveBeenCalledTimes(1);

    activeRoot = null;
    completion.resolve({
      isIncomplete: false,
      items: [
        {
          detail: "class",
          documentation: "A stale user",
          insertText: "User",
          kind: 7,
          label: "User",
        },
      ],
    });

    await expect(completionPromise).resolves.toEqual({ suggestions: [] });
    expect(gateway.completion).toHaveBeenCalledWith(
      "/project",
      {
        character: 4,
        line: 10,
        path: "/project/src/User.php",
      },
    );
  });

  it("drops in-flight PHP completions after same-root session restart", async () => {
    const registered = createRegisteredProviders();
    let activeSessionId = 1;
    const completion = createDeferred<LanguageServerCompletionList>();
    const gateway = featuresGateway();
    vi.mocked(gateway.completion).mockImplementationOnce(
      async () => completion.promise,
    );
    const context = providerContext({
      featuresGateway: gateway,
      getRuntimeStatus: () => ({
        ...runningStatus(),
        sessionId: activeSessionId,
      }),
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const completionPromise =
      registered.completionProvider.provideCompletionItems(
        model({ content: phpCompletionFixtureSource() }),
        position(),
      );

    for (
      let tick = 0;
      tick < 5 && vi.mocked(gateway.completion).mock.calls.length === 0;
      tick += 1
    ) {
      await Promise.resolve();
    }
    expect(gateway.completion).toHaveBeenCalledTimes(1);

    activeSessionId = 2;
    completion.resolve({
      isIncomplete: false,
      items: [
        {
          detail: "class",
          documentation: "A stale user",
          insertText: "User",
          kind: 7,
          label: "User",
        },
      ],
    });

    await expect(completionPromise).resolves.toEqual({ suggestions: [] });
    expect(gateway.completion).toHaveBeenCalledWith(
      "/project",
      {
        character: 4,
        line: 10,
        path: "/project/src/User.php",
      },
    );
  });

  it("does not request completion when the PHP runtime status belongs to another workspace root", async () => {
    const registered = createRegisteredProviders();
    const source = phpCompletionFixtureSource();
    const gateway = featuresGateway({
      completion: {
        isIncomplete: false,
        items: [
          {
            detail: "class",
            documentation: "A user",
            insertText: "User",
            kind: 7,
            label: "User",
          },
        ],
      },
    });
    const flushPendingDocumentChange = vi.fn(async () => undefined);
    const context = providerContext({
      activeDocument: {
        ...document(),
        path: "/workspace/src/User.php",
      },
      featuresGateway: gateway,
      flushPendingDocumentChange,
      getWorkspaceRoot: () => "/workspace",
      runtimeStatus: {
        ...runningStatus(),
        rootPath: "/other",
      },
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.completionProvider.provideCompletionItems(
        model({ content: source, path: "/workspace/src/User.php" }),
        position(),
      ),
    ).resolves.toEqual({
      suggestions: [
        {
          detail: "local variable",
          insertText: "$user",
          kind: 6,
          label: "$user",
          range: {
            endColumn: 5,
            endLineNumber: 11,
            startColumn: 1,
            startLineNumber: 11,
          },
          sortText: "0_0000",
        },
      ],
    });
    expect(flushPendingDocumentChange).not.toHaveBeenCalled();
    expect(gateway.completion).not.toHaveBeenCalled();
  });

  it("does not request completion when the PHP runtime status has no explicit workspace root", async () => {
    const registered = createRegisteredProviders();
    const source = phpCompletionFixtureSource();
    const gateway = featuresGateway({
      completion: {
        isIncomplete: false,
        items: [
          {
            detail: "class",
            documentation: "A rootless user",
            insertText: "User",
            kind: 7,
            label: "User",
          },
        ],
      },
    });
    const flushPendingDocumentChange = vi.fn(async () => undefined);
    const context = providerContext({
      featuresGateway: gateway,
      flushPendingDocumentChange,
      runtimeStatus: rootlessRunningStatus(),
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.completionProvider.provideCompletionItems(
        model({ content: source }),
        position(),
      ),
    ).resolves.toEqual({
      suggestions: [
        {
          detail: "local variable",
          insertText: "$user",
          kind: 6,
          label: "$user",
          range: {
            endColumn: 5,
            endLineNumber: 11,
            startColumn: 1,
            startLineNumber: 11,
          },
          sortText: "0_0000",
        },
      ],
    });
    expect(flushPendingDocumentChange).not.toHaveBeenCalled();
    expect(gateway.completion).not.toHaveBeenCalled();
  });

  it("inserts parentheses and parameter cursor for LSP method completions with parameters", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      completion: {
        isIncomplete: false,
        items: [
          {
            detail:
              "Illuminate\\Database\\Eloquent\\Model::forceDestroy(array|int $ids): int",
            documentation: null,
            insertText: "forceDestroy",
            kind: 2,
            label: "forceDestroy",
          },
        ],
      },
    });
    const context = providerContext({
      activeDocument: {
        ...document(),
        content:
          "<?php\nfunction show(Comment $comment): void\n{\n    $comment->forceD\n}\n",
      },
      featuresGateway: gateway,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const result = await registered.completionProvider.provideCompletionItems(
      model({
        lineContent: "    $comment->forceD",
        word: {
          endColumn: 21,
          startColumn: 15,
        },
      }),
      {
        column: 21,
        lineNumber: 4,
      },
    );

    expect(result.suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: {
            id: "editor.action.triggerParameterHints",
            title: "Trigger parameter hints",
          },
          insertText: "forceDestroy($0)",
          insertTextRules: 4,
          kind: 2,
          label: "forceDestroy",
        }),
      ]),
    );
  });

  it("inserts Laravel route name completions as plain string suffixes", async () => {
    const registered = createRegisteredProviders();
    const providePhpMethodCompletions = vi.fn(async () => [
      {
        declaringClassName: "routes/web.php",
        insertText: "show",
        kind: "route" as const,
        name: "comments.show",
        parameters: "",
        returnType: null,
      },
    ]);
    const context = providerContext({
      activeDocument: {
        ...document(),
        content:
          "<?php\nfunction show(): string\n{\n    return route('comments.sh');\n}\n",
      },
      featuresGateway: featuresGateway({
        completion: {
          isIncomplete: false,
          items: [],
        },
      }),
      providePhpMethodCompletions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const result = await registered.completionProvider.provideCompletionItems(
      model({
        lineContent: "    return route('comments.sh');",
        word: {
          endColumn: 32,
          startColumn: 30,
        },
      }),
      {
        column: 32,
        lineNumber: 4,
      },
    );

    expect(result.suggestions).toEqual([
      expect.objectContaining({
        command: undefined,
        detail: "Laravel route - routes/web.php",
        documentation: "Laravel named route\n\ncomments.show",
        insertText: "show",
        insertTextRules: 4,
        kind: 12,
        label: {
          description: "route - routes/web.php",
          detail: "",
          label: "comments.show",
        },
      }),
    ]);
  });

  it("deduplicates typed PHP methods against LSP signature labels", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      completion: {
        isIncomplete: false,
        items: [
          {
            detail:
              "Illuminate\\Database\\Eloquent\\Model::forceDestroy(array|int $ids): int",
            documentation: null,
            insertText: "forceDestroy",
            kind: 2,
            label: "forceDestroy(...)",
          },
        ],
      },
    });
    const providePhpMethodCompletions = vi.fn(async () => [
      {
        declaringClassName: "Illuminate\\Database\\Eloquent\\Model",
        name: "forceDestroy",
        parameters: "array|int $ids",
        returnType: "int",
      },
    ]);
    const context = providerContext({
      activeDocument: {
        ...document(),
        content:
          "<?php\nfunction show(Comment $comment): void\n{\n    $comment->force\n}\n",
      },
      featuresGateway: gateway,
      providePhpMethodCompletions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const result = await registered.completionProvider.provideCompletionItems(
      model({
        lineContent: "    $comment->force",
        word: {
          endColumn: 21,
          startColumn: 15,
        },
      }),
      {
        column: 21,
        lineNumber: 4,
      },
    );

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]).toEqual(
      expect.objectContaining({
        detail:
          "Illuminate\\Database\\Eloquent\\Model::forceDestroy(array|int $ids): int",
        insertText: "forceDestroy(${1:ids})$0",
        label: {
          description: "method - Illuminate\\Database\\Eloquent\\Model",
          detail: "()",
          label: "forceDestroy",
        },
      }),
    );
  });

  it("deduplicates typed PHP methods against plain LSP method labels", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      completion: {
        isIncomplete: false,
        items: [
          {
            detail:
              "Illuminate\\Database\\Eloquent\\Model::forceDelete(): bool",
            documentation: null,
            insertText: "forceDelete",
            kind: 2,
            label: "forceDelete",
          },
        ],
      },
    });
    const providePhpMethodCompletions = vi.fn(async () => [
      {
        declaringClassName: "Illuminate\\Database\\Eloquent\\Model",
        name: "forceDelete",
        parameters: "",
        returnType: "bool",
      },
    ]);
    const context = providerContext({
      activeDocument: {
        ...document(),
        content:
          "<?php\nfunction show(Comment $comment): void\n{\n    $comment->force\n}\n",
      },
      featuresGateway: gateway,
      providePhpMethodCompletions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const result = await registered.completionProvider.provideCompletionItems(
      model({
        lineContent: "    $comment->force",
        word: {
          endColumn: 21,
          startColumn: 15,
        },
      }),
      {
        column: 21,
        lineNumber: 4,
      },
    );

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]).toEqual(
      expect.objectContaining({
        detail:
          "Illuminate\\Database\\Eloquent\\Model::forceDelete(): bool",
        insertText: "forceDelete()$0",
        label: {
          description: "method - Illuminate\\Database\\Eloquent\\Model",
          detail: "()",
          label: "forceDelete",
        },
      }),
    );
  });

  it("deduplicates typed PHP methods against text LSP signature labels", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      completion: {
        isIncomplete: false,
        items: [
          {
            detail:
              "Illuminate\\Database\\Eloquent\\Model::forceDelete(): bool",
            documentation: null,
            insertText: "forceDelete",
            kind: null,
            label: "forceDelete(...)",
          },
        ],
      },
    });
    const providePhpMethodCompletions = vi.fn(async () => [
      {
        declaringClassName: "Illuminate\\Database\\Eloquent\\Model",
        name: "forceDelete",
        parameters: "",
        returnType: "bool",
      },
    ]);
    const context = providerContext({
      activeDocument: {
        ...document(),
        content:
          "<?php\nfunction show(Comment $comment): void\n{\n    $comment->force\n}\n",
      },
      featuresGateway: gateway,
      providePhpMethodCompletions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const result = await registered.completionProvider.provideCompletionItems(
      model({
        lineContent: "    $comment->force",
        word: {
          endColumn: 21,
          startColumn: 15,
        },
      }),
      {
        column: 21,
        lineNumber: 4,
      },
    );

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]).toEqual(
      expect.objectContaining({
        insertText: "forceDelete()$0",
        kind: 2,
        label: {
          description: "method - Illuminate\\Database\\Eloquent\\Model",
          detail: "()",
          label: "forceDelete",
        },
      }),
    );
  });

  it("deduplicates typed PHP methods against text LSP detail signatures", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      completion: {
        isIncomplete: false,
        items: [
          {
            detail:
              "Illuminate\\Database\\Eloquent\\Model::forceDelete(): bool",
            documentation: null,
            insertText: "forceDelete",
            kind: null,
            label: "forceDelete",
          },
        ],
      },
    });
    const providePhpMethodCompletions = vi.fn(async () => [
      {
        declaringClassName: "Illuminate\\Database\\Eloquent\\Model",
        name: "forceDelete",
        parameters: "",
        returnType: "bool",
      },
    ]);
    const context = providerContext({
      activeDocument: {
        ...document(),
        content:
          "<?php\nfunction show(Comment $comment): void\n{\n    $comment->force\n}\n",
      },
      featuresGateway: gateway,
      providePhpMethodCompletions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const result = await registered.completionProvider.provideCompletionItems(
      model({
        lineContent: "    $comment->force",
        word: {
          endColumn: 21,
          startColumn: 15,
        },
      }),
      {
        column: 21,
        lineNumber: 4,
      },
    );

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]).toEqual(
      expect.objectContaining({
        insertText: "forceDelete()$0",
        kind: 2,
        label: {
          description: "method - Illuminate\\Database\\Eloquent\\Model",
          detail: "()",
          label: "forceDelete",
        },
      }),
    );
  });

  it("places the cursor after parentheses for LSP method completions without parameters", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      completion: {
        isIncomplete: false,
        items: [
          {
            detail: "App\\Models\\Comment::refresh(): App\\Models\\Comment",
            documentation: null,
            insertText: "refresh",
            kind: 2,
            label: "refresh",
          },
        ],
      },
    });
    const context = providerContext({
      activeDocument: {
        ...document(),
        content:
          "<?php\nfunction show(Comment $comment): void\n{\n    $comment->ref\n}\n",
      },
      featuresGateway: gateway,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const result = await registered.completionProvider.provideCompletionItems(
      model({
        lineContent: "    $comment->ref",
        word: {
          endColumn: 18,
          startColumn: 15,
        },
      }),
      {
        column: 18,
        lineNumber: 4,
      },
    );
    const suggestion = result.suggestions.find(
      (item: { label: string }) => item.label === "refresh",
    );

    expect(suggestion).toEqual(
      expect.objectContaining({
        insertText: "refresh()$0",
        insertTextRules: 4,
        kind: 2,
        label: "refresh",
      }),
    );
    expect(suggestion).not.toHaveProperty("command");
  });

  it("places the cursor after parentheses for text LSP method detail completions", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      completion: {
        isIncomplete: false,
        items: [
          {
            detail: "App\\Models\\Comment::refresh(): App\\Models\\Comment",
            documentation: null,
            insertText: "refresh",
            kind: null,
            label: "refresh",
          },
        ],
      },
    });
    const context = providerContext({
      activeDocument: {
        ...document(),
        content:
          "<?php\nfunction show(Comment $comment): void\n{\n    $comment->ref\n}\n",
      },
      featuresGateway: gateway,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const result = await registered.completionProvider.provideCompletionItems(
      model({
        lineContent: "    $comment->ref",
        word: {
          endColumn: 18,
          startColumn: 15,
        },
      }),
      {
        column: 18,
        lineNumber: 4,
      },
    );
    const suggestion = result.suggestions.find(
      (item: { label: string }) => item.label === "refresh",
    );

    expect(suggestion).toEqual(
      expect.objectContaining({
        insertText: "refresh()$0",
        insertTextRules: 4,
        kind: 1,
        label: "refresh",
      }),
    );
    expect(suggestion).not.toHaveProperty("command");
  });

  it("prioritizes typed PHP receiver method completions for member access", async () => {
    const registered = createRegisteredProviders();
    const providePhpMethodCompletions = vi.fn(async () => [
      {
        declaringClassName: "Symfony\\Component\\HttpFoundation\\Request",
        name: "get",
        parameters: "string $key, mixed $default = null",
        returnType: "mixed",
      },
    ]);
    const context = providerContext({
      activeDocument: {
        ...document(),
        content: "<?php\nfunction store(StoreCommentRequest $request): void\n{\n    $request->get\n}\n",
      },
      providePhpMethodCompletions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.completionProvider.provideCompletionItems(
        model({
          lineContent: "    $request->get",
          word: {
            endColumn: 18,
            startColumn: 15,
          },
        }),
        {
          column: 18,
          lineNumber: 4,
        },
      ),
    ).resolves.toEqual({
      suggestions: [
        {
          command: {
            id: "editor.action.triggerParameterHints",
            title: "Trigger parameter hints",
          },
          detail:
            "Symfony\\Component\\HttpFoundation\\Request::get(string $key, mixed $default = null): mixed",
          documentation:
            "Method\n\nSymfony\\Component\\HttpFoundation\\Request::get()\n\n- string $key\n- mixed $default = null",
          insertText: "get(${1:key})$0",
          insertTextRules: 4,
          kind: 2,
          label: {
            description:
              "method - Symfony\\Component\\HttpFoundation\\Request",
            detail: "()",
            label: "get",
          },
          range: {
            endColumn: 18,
            endLineNumber: 4,
            startColumn: 15,
            startLineNumber: 4,
          },
          sortText: "0_0000",
        },
      ],
    });
    expect(providePhpMethodCompletions).toHaveBeenCalled();
  });

  it("does not offer local variables as a fallback inside PHP member access", async () => {
    const registered = createRegisteredProviders();
    const providePhpMethodCompletions = vi.fn(async () => []);
    const context = providerContext({
      activeDocument: {
        ...document(),
        content:
          "<?php\nfunction show(Comment $comment, StoreCommentRequest $request): void\n{\n    $comment->\n}\n",
      },
      providePhpMethodCompletions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.completionProvider.provideCompletionItems(
        model({
          lineContent: "    $comment->",
          word: {
            endColumn: 15,
            startColumn: 15,
          },
        }),
        {
          column: 15,
          lineNumber: 4,
        },
      ),
    ).resolves.toEqual({
      suggestions: [],
    });
    expect(providePhpMethodCompletions).toHaveBeenCalled();
  });

  it("filters PHP LSP locals and keywords inside member access completions", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      completion: {
        isIncomplete: false,
        items: [
          {
            detail: "instance",
            documentation: null,
            insertText: "$this",
            kind: 6,
            label: "$this",
          },
          {
            detail: "StoreCommentRequest",
            documentation: null,
            insertText: "$request",
            kind: 6,
            label: "$request",
          },
          {
            detail: "Comment",
            documentation: null,
            insertText: "$comment",
            kind: 6,
            label: "$comment",
          },
          {
            detail: null,
            documentation: null,
            insertText: "function",
            kind: null,
            label: "function",
          },
          {
            detail: null,
            documentation: null,
            insertText: "const",
            kind: 21,
            label: "const",
          },
          {
            detail: "App\\Models\\Comment::refresh(): static",
            documentation: null,
            insertText: "refresh",
            kind: 2,
            label: "refresh",
          },
          {
            detail: "App\\Models\\Comment::restore(): bool",
            documentation: null,
            insertText: "restore",
            kind: null,
            label: "restore",
          },
        ],
      },
    });
    const providePhpMethodCompletions = vi.fn(async () => []);
    const context = providerContext({
      activeDocument: {
        ...document(),
        content:
          "<?php\nfunction show(Comment $comment, StoreCommentRequest $request): void\n{\n    $comment->\n}\n",
      },
      featuresGateway: gateway,
      providePhpMethodCompletions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const result = await registered.completionProvider.provideCompletionItems(
      model({
        lineContent: "    $comment->",
        word: {
          endColumn: 15,
          startColumn: 15,
        },
      }),
      {
        column: 15,
        lineNumber: 4,
      },
    );

    expect(completionLabels(result.suggestions)).toEqual(["refresh", "restore"]);
    expect(gateway.completion).toHaveBeenCalled();
  });

  it("filters PHP LSP locals and globals inside static access completions", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      completion: {
        isIncomplete: false,
        items: [
          {
            detail: "instance",
            documentation: null,
            insertText: "$this",
            kind: 6,
            label: "$this",
          },
          {
            detail: "App\\Models\\Comment",
            documentation: null,
            insertText: "Comment",
            kind: 7,
            label: "Comment",
          },
          {
            detail: null,
            documentation: null,
            insertText: "function",
            kind: null,
            label: "function",
          },
          {
            detail: "class constant",
            documentation: null,
            insertText: "STATUS_ACTIVE",
            kind: 21,
            label: "STATUS_ACTIVE",
          },
          {
            detail: "App\\Models\\Comment::query(): Illuminate\\Database\\Eloquent\\Builder",
            documentation: null,
            insertText: "query",
            kind: 2,
            label: "query",
          },
          {
            detail: "App\\Models\\Comment::whereNull(string $column): Illuminate\\Database\\Eloquent\\Builder",
            documentation: null,
            insertText: "whereNull",
            kind: 3,
            label: "whereNull",
          },
        ],
      },
    });
    const providePhpMethodCompletions = vi.fn(async () => []);
    const context = providerContext({
      activeDocument: {
        ...document(),
        content: "<?php\nComment::\n",
      },
      featuresGateway: gateway,
      providePhpMethodCompletions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const result = await registered.completionProvider.provideCompletionItems(
      model({
        lineContent: "Comment::",
        word: {
          endColumn: 10,
          startColumn: 10,
        },
      }),
      {
        column: 10,
        lineNumber: 2,
      },
    );

    expect(completionLabels(result.suggestions)).toEqual([
      "STATUS_ACTIVE",
      "query",
      "whereNull",
    ]);
  });

  it("uses the live Monaco model source for fresh PHP member access completions", async () => {
    const registered = createRegisteredProviders();
    const providePhpMethodCompletions = vi.fn(async () => [
      {
        declaringClassName: "App\\Models\\Comment",
        name: "forceDelete",
        parameters: "",
        returnType: "bool",
      },
    ]);
    const staleSource =
      "<?php\nfunction show(Comment $comment, StoreCommentRequest $request): void\n{\n    $comment\n}\n";
    const liveSource =
      "<?php\nfunction show(Comment $comment, StoreCommentRequest $request): void\n{\n    $comment->\n}\n";
    const context = providerContext({
      activeDocument: {
        ...document(),
        content: staleSource,
      },
      providePhpMethodCompletions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const result = await registered.completionProvider.provideCompletionItems(
      model({
        content: liveSource,
        lineContent: "    $comment->",
        word: {
          endColumn: 15,
          startColumn: 15,
        },
      }),
      {
        column: 15,
        lineNumber: 4,
      },
    );

    expect(result.suggestions).toEqual([
      expect.objectContaining({
        insertText: "forceDelete()$0",
        label: expect.objectContaining({ label: "forceDelete" }),
      }),
    ]);
    expect(providePhpMethodCompletions).toHaveBeenCalledWith(liveSource, {
      column: 15,
      lineNumber: 4,
    });
  });

  it("maps typed PHP receiver properties without method parentheses", async () => {
    const registered = createRegisteredProviders();
    const providePhpMethodCompletions = vi.fn(async () => [
      {
        declaringClassName: "App\\Models\\Comment",
        kind: "property" as const,
        name: "body",
        parameters: "",
        returnType: "string",
      },
    ]);
    const context = providerContext({
      activeDocument: {
        ...document(),
        content: "<?php\nfunction show(Comment $comment): void\n{\n    $comment->bo\n}\n",
      },
      providePhpMethodCompletions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.completionProvider.provideCompletionItems(
        model({
          lineContent: "    $comment->bo",
          word: {
            endColumn: 17,
            startColumn: 15,
          },
        }),
        {
          column: 17,
          lineNumber: 4,
        },
      ),
    ).resolves.toEqual({
      suggestions: [
        {
          command: undefined,
          detail: "App\\Models\\Comment::$body: string",
          documentation: "Property\n\nApp\\Models\\Comment::$body",
          insertText: "body",
          insertTextRules: 4,
          kind: 10,
          label: {
            description: "property - App\\Models\\Comment",
            detail: "",
            label: "body",
          },
          range: {
            endColumn: 17,
            endLineNumber: 4,
            startColumn: 15,
            startLineNumber: 4,
          },
          sortText: "0_0000",
        },
      ],
    });
  });

  it("maps Laravel relation completions as field-like property access", async () => {
    const registered = createRegisteredProviders();
    const providePhpMethodCompletions = vi.fn(async () => [
      {
        declaringClassName: "App\\Models\\Post",
        kind: "relation" as const,
        name: "comments",
        parameters: "",
        returnType: "Illuminate\\Database\\Eloquent\\Relations\\HasMany",
      },
    ]);
    const context = providerContext({
      activeDocument: {
        ...document(),
        content: "<?php\nfunction show(Post $post): void\n{\n    $post->com\n}\n",
      },
      providePhpMethodCompletions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.completionProvider.provideCompletionItems(
        model({
          lineContent: "    $post->com",
          word: {
            endColumn: 15,
            startColumn: 12,
          },
        }),
        {
          column: 15,
          lineNumber: 4,
        },
      ),
    ).resolves.toEqual({
      suggestions: [
        expect.objectContaining({
          command: undefined,
          detail:
            "App\\Models\\Post::comments relation: Illuminate\\Database\\Eloquent\\Relations\\HasMany",
          documentation: "Laravel relation\n\nApp\\Models\\Post::comments()",
          insertText: "comments",
          kind: 5,
          label: {
            description: "relation - App\\Models\\Post",
            detail: "",
            label: "comments",
          },
        }),
      ],
    });
  });

  it("keeps typed PHP methods and properties with the same display name distinct", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      completion: {
        isIncomplete: false,
        items: [
          {
            detail: "App\\Models\\Comment::status(): string",
            documentation: null,
            insertText: "status",
            kind: 2,
            label: "status",
          },
        ],
      },
    });
    const providePhpMethodCompletions = vi.fn(async () => [
      {
        declaringClassName: "App\\Models\\Comment",
        kind: "property" as const,
        name: "status",
        parameters: "",
        returnType: "string",
      },
      {
        declaringClassName: "App\\Models\\Comment",
        name: "status",
        parameters: "",
        returnType: "string",
      },
    ]);
    const context = providerContext({
      activeDocument: {
        ...document(),
        content: "<?php\nfunction show(Comment $comment): void\n{\n    $comment->sta\n}\n",
      },
      featuresGateway: gateway,
      providePhpMethodCompletions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const result = await registered.completionProvider.provideCompletionItems(
      model({
        lineContent: "    $comment->sta",
        word: {
          endColumn: 18,
          startColumn: 15,
        },
      }),
      {
        column: 18,
        lineNumber: 4,
      },
    );

    expect(result.suggestions).toHaveLength(2);
    expect(result.suggestions).toEqual([
      expect.objectContaining({
        insertText: "status",
        kind: 10,
        label: {
          description: "property - App\\Models\\Comment",
          detail: "",
          label: "status",
        },
      }),
      expect.objectContaining({
        insertText: "status()$0",
        kind: 2,
        label: {
          description: "method - App\\Models\\Comment",
          detail: "()",
          label: "status",
        },
      }),
    ]);
  });

  it("places the cursor after parentheses for typed PHP methods without parameters", async () => {
    const registered = createRegisteredProviders();
    const providePhpMethodCompletions = vi.fn(async () => [
      {
        declaringClassName: "App\\Models\\Comment",
        name: "refresh",
        parameters: "",
        returnType: "void",
      },
    ]);
    const context = providerContext({
      activeDocument: {
        ...document(),
        content: "<?php\nfunction show(Comment $comment): void\n{\n    $comment->ref\n}\n",
      },
      providePhpMethodCompletions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.completionProvider.provideCompletionItems(
        model({
          lineContent: "    $comment->ref",
          word: {
            endColumn: 18,
            startColumn: 15,
          },
        }),
        {
          column: 18,
          lineNumber: 4,
        },
      ),
    ).resolves.toEqual({
      suggestions: [
        expect.objectContaining({
          command: undefined,
          insertText: "refresh()$0",
          label: {
            description: "method - App\\Models\\Comment",
            detail: "()",
            label: "refresh",
          },
        }),
      ],
    });
  });

  it("maps typed PHP method signatures to Monaco parameter hints", async () => {
    const registered = createRegisteredProviders();
    const providePhpMethodSignature = vi.fn(async () => ({
      argumentIndex: 1,
      method: {
        declaringClassName: "Symfony\\Component\\HttpFoundation\\Request",
        name: "get",
        parameters: "string $key, mixed $default = null",
        returnType: "mixed",
      },
      parameters: [
        {
          defaultValue: null,
          name: "$key",
          optional: false,
          raw: "string $key",
          type: "string",
        },
        {
          defaultValue: "null",
          name: "$default",
          optional: true,
          raw: "mixed $default = null",
          type: "mixed",
        },
      ],
    }));
    const context = providerContext({
      activeDocument: {
        ...document(),
        content: "<?php\nfunction store(StoreCommentRequest $request): void\n{\n    $request->get($key,\n}\n",
      },
      providePhpMethodSignature,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.signatureProvider.provideSignatureHelp(
        model(),
        {
          column: 24,
          lineNumber: 4,
        },
      ),
    ).resolves.toEqual({
      dispose: expect.any(Function),
      value: {
        activeParameter: 1,
        activeSignature: 0,
        signatures: [
          {
            documentation: "Symfony\\Component\\HttpFoundation\\Request",
            label: "get(string $key, mixed $default = null): mixed",
            parameters: [
              { label: "string $key" },
              { label: "mixed $default = null" },
            ],
          },
        ],
      },
    });
    expect(providePhpMethodSignature).toHaveBeenCalled();
  });

  it("drops in-flight PHP signature help when no project tab is active", async () => {
    const registered = createRegisteredProviders();
    let activeRoot: string | null = "/project";
    const signature = createDeferred<PhpMethodSignature | null>();
    const providePhpMethodSignature = vi.fn(async () => signature.promise);
    const context = providerContext({
      activeDocument: {
        ...document(),
        content: "<?php\nfunction store(StoreCommentRequest $request): void\n{\n    $request->get($key,\n}\n",
      },
      getWorkspaceRoot: () => activeRoot,
      providePhpMethodSignature,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const signaturePromise = registered.signatureProvider.provideSignatureHelp(
      model(),
      {
        column: 24,
        lineNumber: 4,
      },
    );

    await Promise.resolve();
    activeRoot = null;
    signature.resolve({
      argumentIndex: 1,
      method: {
        declaringClassName: "Symfony\\Component\\HttpFoundation\\Request",
        name: "get",
        parameters: "string $key, mixed $default = null",
        returnType: "mixed",
      },
      parameters: [
        {
          defaultValue: null,
          name: "$key",
          optional: false,
          raw: "string $key",
          type: "string",
        },
        {
          defaultValue: "null",
          name: "$default",
          optional: true,
          raw: "mixed $default = null",
          type: "mixed",
        },
      ],
    });

    await expect(signaturePromise).resolves.toBeNull();
    expect(providePhpMethodSignature).toHaveBeenCalled();
  });

  it("drops in-flight PHP signature help after switching project tabs", async () => {
    const registered = createRegisteredProviders();
    let activeRoot = "/project";
    const signature = createDeferred<PhpMethodSignature | null>();
    const providePhpMethodSignature = vi.fn(async () => signature.promise);
    const context = providerContext({
      activeDocument: {
        ...document(),
        content: "<?php\nfunction store(StoreCommentRequest $request): void\n{\n    $request->get($key,\n}\n",
      },
      getWorkspaceRoot: () => activeRoot,
      providePhpMethodSignature,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const signaturePromise = registered.signatureProvider.provideSignatureHelp(
      model(),
      {
        column: 24,
        lineNumber: 4,
      },
    );

    await Promise.resolve();
    activeRoot = "/other";
    signature.resolve({
      argumentIndex: 1,
      method: {
        declaringClassName: "Symfony\\Component\\HttpFoundation\\Request",
        name: "get",
        parameters: "string $key, mixed $default = null",
        returnType: "mixed",
      },
      parameters: [
        {
          defaultValue: null,
          name: "$key",
          optional: false,
          raw: "string $key",
          type: "string",
        },
        {
          defaultValue: "null",
          name: "$default",
          optional: true,
          raw: "mixed $default = null",
          type: "mixed",
        },
      ],
    });

    await expect(signaturePromise).resolves.toBeNull();
    expect(providePhpMethodSignature).toHaveBeenCalled();
  });

  it("requests LSP code actions and maps edits, commands and diagnostics", async () => {
    const registered = createRegisteredProviders();
    const commandAction = {
      command: {
        arguments: ["unused"],
        command: "phpactor.fixAll",
        title: "Fix all",
      },
      data: { id: "fix-all" },
      edit: null,
      isPreferred: false,
      kind: "source.fixAll",
      title: "Fix all unused imports",
    };
    const gateway = featuresGateway({
      codeActions: [
        {
          command: null,
          data: null,
          edit: {
            changes: {
              ...workspaceEdit(
                "file:///project/src/User.php",
                "use App\\Models\\User;\n",
              ).changes,
              ...workspaceEdit(
                "file:///project-neighbor/src/User.php",
                "leak",
              ).changes,
            },
          },
          isPreferred: true,
          kind: "quickfix",
          title: "Import User",
        },
        commandAction,
      ],
    });
    const flushPendingDocumentChange = vi.fn(async () => undefined);
    const context = providerContext({
      featuresGateway: gateway,
      flushPendingDocumentChange,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const marker = {
      code: { target: "https://example.test/PHP041", value: "PHP041" },
      data: { symbol: "User" },
      endColumn: 9,
      endLineNumber: 3,
      message: "Undefined type User",
      severity: registered.monaco.MarkerSeverity.Error,
      source: "phpactor",
      startColumn: 5,
      startLineNumber: 3,
    };
    const actions = await registered.codeActionProvider.provideCodeActions(
      model(),
      new registered.monaco.Range(3, 5, 3, 9),
      {
        markers: [marker],
        only: "quickfix",
        trigger: registered.monaco.languages.CodeActionTriggerType.Invoke,
      },
    );

    expect(flushPendingDocumentChange).toHaveBeenCalledWith(
      "/project/src/User.php",
    );
    expect(gateway.codeActions).toHaveBeenCalledWith(
      "/project",
      "/project/src/User.php",
      range(2, 4, 2, 8),
      {
        diagnostics: [
          {
            code: "PHP041",
            data: { symbol: "User" },
            message: "Undefined type User",
            range: range(2, 4, 2, 8),
            severity: 1,
            source: "phpactor",
          },
        ],
        only: ["quickfix"],
        triggerKind: 1,
      },
    );
    expect(actions.actions).toEqual([
      expect.objectContaining({
        diagnostics: [marker],
        edit: {
          edits: [
            {
              resource: {
                fsPath: "/project/src/User.php",
                path: "/project/src/User.php",
              },
              textEdit: {
                range: expect.objectContaining({
                  endColumn: 1,
                  endLineNumber: 1,
                  startColumn: 1,
                  startLineNumber: 1,
                }),
                text: "use App\\Models\\User;\n",
              },
              versionId: 42,
            },
          ],
        },
        isPreferred: true,
        kind: "quickfix",
        title: "Import User",
      }),
      expect.objectContaining({
        command: {
          arguments: [
            {
              command: commandAction.command,
              rootPath: "/project",
              sessionId: 1,
            },
          ],
          id: "mockor.php.executeLanguageServerCommand",
          title: "Fix all",
        },
        diagnostics: [marker],
        isPreferred: false,
        kind: "source.fixAll",
        title: "Fix all unused imports",
      }),
    ]);
  });

  it("drops in-flight PHP LSP code actions when no project tab is active", async () => {
    const registered = createRegisteredProviders();
    let activeRoot: string | null = "/project";
    const codeActions =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["codeActions"]>>
      >();
    const gateway = featuresGateway();
    vi.mocked(gateway.codeActions).mockImplementationOnce(
      async () => codeActions.promise,
    );
    const context = providerContext({
      featuresGateway: gateway,
      getWorkspaceRoot: () => activeRoot,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const codeActionsPromise =
      registered.codeActionProvider.provideCodeActions(
        model(),
        new registered.monaco.Range(3, 5, 3, 9),
        {
          markers: [],
          only: "quickfix",
          trigger: registered.monaco.languages.CodeActionTriggerType.Invoke,
        },
      );

    await Promise.resolve();
    activeRoot = null;
    codeActions.resolve([
      {
        command: null,
        data: { id: "stale-import" },
        edit: null,
        isPreferred: true,
        kind: "quickfix",
        title: "Import User",
      },
    ]);

    await expect(codeActionsPromise).resolves.toEqual({
      actions: [],
      dispose: expect.any(Function),
    });
    expect(gateway.codeActions).toHaveBeenCalledWith(
      "/project",
      "/project/src/User.php",
      range(2, 4, 2, 8),
      {
        diagnostics: [],
        only: ["quickfix"],
        triggerKind: 1,
      },
    );
  });

  it("drops in-flight PHP LSP code actions after same-root session restart", async () => {
    const registered = createRegisteredProviders();
    let activeSessionId = 1;
    const codeActions =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["codeActions"]>>
      >();
    const gateway = featuresGateway();
    vi.mocked(gateway.codeActions).mockImplementationOnce(
      async () => codeActions.promise,
    );
    const context = providerContext({
      featuresGateway: gateway,
      getRuntimeStatus: () => ({
        ...runningStatus(),
        sessionId: activeSessionId,
      }),
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const codeActionsPromise =
      registered.codeActionProvider.provideCodeActions(
        model(),
        new registered.monaco.Range(3, 5, 3, 9),
        {
          markers: [],
          only: "quickfix",
          trigger: registered.monaco.languages.CodeActionTriggerType.Invoke,
        },
      );

    await Promise.resolve();
    activeSessionId = 2;
    codeActions.resolve([
      {
        command: null,
        data: { id: "stale-import" },
        edit: null,
        isPreferred: true,
        kind: "quickfix",
        title: "Import User",
      },
    ]);

    await expect(codeActionsPromise).resolves.toEqual({
      actions: [],
      dispose: expect.any(Function),
    });
    expect(gateway.codeActions).toHaveBeenCalledWith(
      "/project",
      "/project/src/User.php",
      range(2, 4, 2, 8),
      {
        diagnostics: [],
        only: ["quickfix"],
        triggerKind: 1,
      },
    );
  });

  it("does not request LSP code actions when the PHP runtime status belongs to another workspace root", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      codeActions: [
        {
          command: null,
          data: { id: "other-root" },
          edit: null,
          isPreferred: true,
          kind: "quickfix",
          title: "Import User",
        },
      ],
    });
    const flushPendingDocumentChange = vi.fn(async () => undefined);
    const context = providerContext({
      activeDocument: {
        ...document(),
        path: "/workspace/src/User.php",
      },
      featuresGateway: gateway,
      flushPendingDocumentChange,
      getWorkspaceRoot: () => "/workspace",
      runtimeStatus: {
        ...runningStatus(),
        rootPath: "/other",
      },
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.codeActionProvider.provideCodeActions(
        model({ path: "/workspace/src/User.php" }),
        new registered.monaco.Range(3, 5, 3, 9),
        {
          markers: [],
          only: "quickfix",
          trigger: registered.monaco.languages.CodeActionTriggerType.Invoke,
        },
      ),
    ).resolves.toEqual({
      actions: [],
      dispose: expect.any(Function),
    });
    expect(flushPendingDocumentChange).not.toHaveBeenCalled();
    expect(gateway.codeActions).not.toHaveBeenCalled();
  });

  it("does not request LSP code actions when the PHP runtime status has no explicit workspace root", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      codeActions: [
        {
          command: null,
          data: { id: "rootless" },
          edit: null,
          isPreferred: true,
          kind: "quickfix",
          title: "Import User",
        },
      ],
    });
    const flushPendingDocumentChange = vi.fn(async () => undefined);
    const context = providerContext({
      featuresGateway: gateway,
      flushPendingDocumentChange,
      runtimeStatus: rootlessRunningStatus(),
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.codeActionProvider.provideCodeActions(
        model(),
        new registered.monaco.Range(3, 5, 3, 9),
        {
          markers: [],
          only: "quickfix",
          trigger: registered.monaco.languages.CodeActionTriggerType.Invoke,
        },
      ),
    ).resolves.toEqual({
      actions: [],
      dispose: expect.any(Function),
    });
    expect(flushPendingDocumentChange).not.toHaveBeenCalled();
    expect(gateway.codeActions).not.toHaveBeenCalled();
  });

  it("requests LSP selection ranges and flattens parent ranges for Monaco", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      selectionRanges: [
        {
          parent: {
            parent: null,
            range: range(3, 2, 5, 3),
          },
          range: range(3, 8, 3, 20),
        },
        {
          parent: null,
          range: range(9, 4, 9, 12),
        },
      ],
    });
    const flushPendingDocumentChange = vi.fn(async () => undefined);
    const context = providerContext({
      featuresGateway: gateway,
      flushPendingDocumentChange,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const selectionRanges =
      await registered.selectionRangeProvider.provideSelectionRanges(model(), [
        { column: 12, lineNumber: 4 },
        { column: 7, lineNumber: 10 },
      ]);

    expect(flushPendingDocumentChange).toHaveBeenCalledWith(
      "/project/src/User.php",
    );
    expect(gateway.selectionRanges).toHaveBeenCalledWith(
      "/project",
      "/project/src/User.php",
      [
        { character: 11, line: 3 },
        { character: 6, line: 9 },
      ],
    );
    expect(selectionRanges).toEqual([
      [
        {
          range: expect.objectContaining({
            endColumn: 21,
            endLineNumber: 4,
            startColumn: 9,
            startLineNumber: 4,
          }),
        },
        {
          range: expect.objectContaining({
            endColumn: 4,
            endLineNumber: 6,
            startColumn: 3,
            startLineNumber: 4,
          }),
        },
      ],
      [
        {
          range: expect.objectContaining({
            endColumn: 13,
            endLineNumber: 10,
            startColumn: 5,
            startLineNumber: 10,
          }),
        },
      ],
    ]);
  });

  it("does not request selection ranges when the provider capability is disabled", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      selectionRanges: [
        {
          parent: null,
          range: range(3, 8, 3, 20),
        },
      ],
    });
    const flushPendingDocumentChange = vi.fn(async () => undefined);
    const context = providerContext({
      featuresGateway: gateway,
      flushPendingDocumentChange,
      runtimeStatus: runningStatus({ selectionRange: false }),
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.selectionRangeProvider.provideSelectionRanges(model(), [
        { column: 12, lineNumber: 4 },
      ]),
    ).resolves.toBeNull();
    expect(flushPendingDocumentChange).not.toHaveBeenCalled();
    expect(gateway.selectionRanges).not.toHaveBeenCalled();
  });

  it("does not request selection ranges when the PHP runtime status belongs to another workspace root", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      selectionRanges: [
        {
          parent: null,
          range: range(3, 8, 3, 20),
        },
      ],
    });
    const flushPendingDocumentChange = vi.fn(async () => undefined);
    const context = providerContext({
      activeDocument: {
        ...document(),
        path: "/workspace/src/User.php",
      },
      featuresGateway: gateway,
      flushPendingDocumentChange,
      getWorkspaceRoot: () => "/workspace",
      runtimeStatus: {
        ...runningStatus(),
        rootPath: "/other",
      },
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.selectionRangeProvider.provideSelectionRanges(
        model({ path: "/workspace/src/User.php" }),
        [{ column: 12, lineNumber: 4 }],
      ),
    ).resolves.toBeNull();
    expect(flushPendingDocumentChange).not.toHaveBeenCalled();
    expect(gateway.selectionRanges).not.toHaveBeenCalled();
  });

  it("does not request selection ranges when the PHP runtime status has no explicit workspace root", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      selectionRanges: [
        {
          parent: null,
          range: range(3, 8, 3, 20),
        },
      ],
    });
    const flushPendingDocumentChange = vi.fn(async () => undefined);
    const context = providerContext({
      featuresGateway: gateway,
      flushPendingDocumentChange,
      runtimeStatus: rootlessRunningStatus(),
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.selectionRangeProvider.provideSelectionRanges(model(), [
        { column: 12, lineNumber: 4 },
      ]),
    ).resolves.toBeNull();
    expect(flushPendingDocumentChange).not.toHaveBeenCalled();
    expect(gateway.selectionRanges).not.toHaveBeenCalled();
  });

  it("drops in-flight PHP selection ranges after switching project tabs", async () => {
    const registered = createRegisteredProviders();
    let activeRoot = "/project";
    const selectionRanges =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["selectionRanges"]>>
      >();
    const gateway = featuresGateway();
    vi.mocked(gateway.selectionRanges).mockImplementationOnce(
      async () => selectionRanges.promise,
    );
    const context = providerContext({
      featuresGateway: gateway,
      getWorkspaceRoot: () => activeRoot,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const selectionRangesPromise =
      registered.selectionRangeProvider.provideSelectionRanges(model(), [
        { column: 12, lineNumber: 4 },
      ]);

    await Promise.resolve();
    activeRoot = "/other";
    selectionRanges.resolve([
      {
        parent: null,
        range: range(3, 8, 3, 20),
      },
    ]);

    await expect(selectionRangesPromise).resolves.toBeNull();
    expect(gateway.selectionRanges).toHaveBeenCalledWith(
      "/project",
      "/project/src/User.php",
      [{ character: 11, line: 3 }],
    );
  });

  it("drops in-flight PHP selection ranges when no project tab is active", async () => {
    const registered = createRegisteredProviders();
    let activeRoot: string | null = "/project";
    const selectionRanges =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["selectionRanges"]>>
      >();
    const gateway = featuresGateway();
    vi.mocked(gateway.selectionRanges).mockImplementationOnce(
      async () => selectionRanges.promise,
    );
    const context = providerContext({
      featuresGateway: gateway,
      getWorkspaceRoot: () => activeRoot,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const selectionRangesPromise =
      registered.selectionRangeProvider.provideSelectionRanges(model(), [
        { column: 12, lineNumber: 4 },
      ]);

    await Promise.resolve();
    activeRoot = null;
    selectionRanges.resolve([
      {
        parent: null,
        range: range(3, 8, 3, 20),
      },
    ]);

    await expect(selectionRangesPromise).resolves.toBeNull();
    expect(gateway.selectionRanges).toHaveBeenCalledWith(
      "/project",
      "/project/src/User.php",
      [{ character: 11, line: 3 }],
    );
  });

  it("resolves LSP-backed code actions", async () => {
    const registered = createRegisteredProviders();
    const unresolvedAction = {
      command: null,
      data: { id: "add-import" },
      edit: null,
      isPreferred: true,
      kind: "quickfix",
      title: "Import User",
    };
    const resolvedAction = {
      ...unresolvedAction,
      edit: workspaceEdit(
        "file:///project/src/User.php",
        "use App\\Models\\User;\n",
      ),
    };
    const gateway = featuresGateway({
      codeActions: [unresolvedAction],
      resolvedCodeAction: resolvedAction,
    });
    const context = providerContext({ featuresGateway: gateway });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const actions = await registered.codeActionProvider.provideCodeActions(
      model(),
      new registered.monaco.Range(3, 5, 3, 9),
      {
        markers: [],
        only: "quickfix",
        trigger: registered.monaco.languages.CodeActionTriggerType.Invoke,
      },
    );
    const resolved = await registered.codeActionProvider.resolveCodeAction(
      actions.actions[0],
    );

    expect(gateway.resolveCodeAction).toHaveBeenCalledWith(
      "/project",
      unresolvedAction,
    );
    expect(resolved).toEqual(
      expect.objectContaining({
        edit: {
          edits: [
            {
              resource: {
                fsPath: "/project/src/User.php",
                path: "/project/src/User.php",
              },
              textEdit: {
                range: expect.objectContaining({
                  endColumn: 1,
                  endLineNumber: 1,
                  startColumn: 1,
                  startLineNumber: 1,
                }),
                text: "use App\\Models\\User;\n",
              },
              versionId: 42,
            },
          ],
        },
        kind: "quickfix",
        title: "Import User",
      }),
    );
  });

  it("drops in-flight PHP code-action resolves after same-root session restart", async () => {
    const registered = createRegisteredProviders();
    let activeSessionId = 1;
    const resolvedCodeAction =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["resolveCodeAction"]>>
      >();
    const gateway = featuresGateway();
    vi.mocked(gateway.resolveCodeAction).mockImplementationOnce(
      async () => resolvedCodeAction.promise,
    );
    const context = providerContext({
      featuresGateway: gateway,
      getRuntimeStatus: () => ({
        ...runningStatus(),
        sessionId: activeSessionId,
      }),
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);
    const backedAction = backedCodeAction();

    const resolvePromise =
      registered.codeActionProvider.resolveCodeAction(backedAction);

    await Promise.resolve();
    activeSessionId = 2;
    resolvedCodeAction.resolve({
      command: null,
      data: null,
      edit: workspaceEdit(
        "file:///project/src/User.php",
        "use App\\Models\\User;\n",
      ),
      isPreferred: true,
      kind: "quickfix",
      title: "Import User",
    });

    await expect(resolvePromise).resolves.toBe(backedAction);
    expect(gateway.resolveCodeAction).toHaveBeenCalledWith(
      "/project",
      backedAction.__languageServerAction,
    );
  });

  it("does not resolve or execute PHP code-action commands when the runtime status belongs to another workspace root", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      resolvedCodeAction: {
        command: null,
        data: null,
        edit: workspaceEdit(
          "file:///project/src/User.php",
          "use App\\Models\\User;\n",
        ),
        isPreferred: true,
        kind: "quickfix",
        title: "Import User",
      },
    });
    const context = providerContext({
      featuresGateway: gateway,
      runtimeStatus: {
        ...runningStatus(),
        rootPath: "/other",
      },
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const backedAction = backedCodeAction();

    await expect(
      registered.codeActionProvider.resolveCodeAction(backedAction),
    ).resolves.toBe(backedAction);
    if (!registered.commandRun) {
      throw new Error("PHP language server command was not registered");
    }
    await registered.commandRun(null, phpCommandPayload());

    expect(gateway.resolveCodeAction).not.toHaveBeenCalled();
    expect(gateway.executeCommand).not.toHaveBeenCalled();
  });

  it("does not resolve or execute PHP code-action commands when the runtime status has no explicit workspace root", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      resolvedCodeAction: {
        command: null,
        data: null,
        edit: workspaceEdit(
          "file:///project/src/User.php",
          "use App\\Models\\User;\n",
        ),
        isPreferred: true,
        kind: "quickfix",
        title: "Import User",
      },
    });
    const context = providerContext({
      featuresGateway: gateway,
      runtimeStatus: rootlessRunningStatus(),
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const backedAction = backedCodeAction();

    await expect(
      registered.codeActionProvider.resolveCodeAction(backedAction),
    ).resolves.toBe(backedAction);
    if (!registered.commandRun) {
      throw new Error("PHP language server command was not registered");
    }
    await registered.commandRun(null, phpCommandPayload());

    expect(gateway.resolveCodeAction).not.toHaveBeenCalled();
    expect(gateway.executeCommand).not.toHaveBeenCalled();
  });

  it("does not resolve or execute PHP code-action commands when no project tab is active", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      resolvedCodeAction: {
        command: null,
        data: null,
        edit: workspaceEdit(
          "file:///project/src/User.php",
          "use App\\Models\\User;\n",
        ),
        isPreferred: true,
        kind: "quickfix",
        title: "Import User",
      },
    });
    const context = providerContext({
      featuresGateway: gateway,
      getWorkspaceRoot: () => null,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const backedAction = backedCodeAction();

    await expect(
      registered.codeActionProvider.resolveCodeAction(backedAction),
    ).resolves.toBe(backedAction);
    if (!registered.commandRun) {
      throw new Error("PHP language server command was not registered");
    }
    await registered.commandRun(null, phpCommandPayload());

    expect(gateway.resolveCodeAction).not.toHaveBeenCalled();
    expect(gateway.executeCommand).not.toHaveBeenCalled();
  });

  it("provides a quick fix for unexpected bare PHP identifiers", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway();
    const context = providerContext({
      featuresGateway: gateway,
      runtimeStatus: runningStatus({ codeAction: false }),
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.codeActionProvider.provideCodeActions(
        model(),
        new registered.monaco.Range(4, 5, 4, 13),
        {
          markers: [
            {
              endColumn: 13,
              endLineNumber: 4,
              message: 'Unexpected bare PHP identifier "asdasdad".',
              severity: 8,
              source: "PHP Syntax",
              startColumn: 5,
              startLineNumber: 4,
            },
          ],
          trigger: 1,
        },
      ),
    ).resolves.toEqual({
      actions: [
        {
          diagnostics: [
            {
              endColumn: 13,
              endLineNumber: 4,
              message: 'Unexpected bare PHP identifier "asdasdad".',
              severity: 8,
              source: "PHP Syntax",
              startColumn: 5,
              startLineNumber: 4,
            },
          ],
          edit: {
            edits: [
              {
                resource: {
                  fsPath: "/project/src/User.php",
                  path: "/project/src/User.php",
                },
                textEdit: {
                  range: expect.objectContaining({
                    endColumn: 13,
                    endLineNumber: 4,
                    startColumn: 5,
                    startLineNumber: 4,
                  }),
                  text: "",
                },
                versionId: 42,
              },
            ],
          },
          isPreferred: true,
          kind: "quickfix",
          title: "Remove unexpected identifier",
        },
      ],
      dispose: expect.any(Function),
    });
    expect(gateway.codeActions).not.toHaveBeenCalled();
  });

  it("applies PHP workspace edit events for the active workspace and session", async () => {
    const registered = createRegisteredProviders();
    const openPath = "/project/src/User.php";
    const openUri = "file:///project/src/User.php";
    const closedUri = "file:///project/src/Helper.php";
    const outsideUri = "file:///other/src/Outside.php";
    const openModel = {
      ...model({ path: openPath }),
      pushEditOperations: vi.fn(),
    };
    const edit: LanguageServerWorkspaceEdit = {
      changes: {
        ...workspaceEdit(openUri, "Open").changes,
        ...workspaceEdit(closedUri, "Closed").changes,
        ...workspaceEdit(outsideUri, "Outside").changes,
      },
      documentVersions: {
        [openUri]: 42,
        [outsideUri]: 42,
      },
    };
    let publishWorkspaceEdit: (event: LanguageServerWorkspaceEditEvent) => void =
      () => undefined;
    const unsubscribe = vi.fn();
    const workspaceEditGateway: LanguageServerWorkspaceEditGateway = {
      subscribeWorkspaceEdits: vi.fn(async (listener) => {
        publishWorkspaceEdit = listener;
        return unsubscribe;
      }),
    };
    const applyWorkspaceEdit = vi.fn(async () => undefined);
    vi.mocked(registered.monaco.editor.getModels).mockReturnValue([openModel]);
    const disposable = registerLanguageServerMonacoProviders(
      registered.monaco,
      providerContext({ applyWorkspaceEdit, workspaceEditGateway }),
    );
    await Promise.resolve();

    publishWorkspaceEdit({
      edit,
      label: "Rename",
      rootPath: "/project/",
      sessionId: 1,
    });

    expect(openModel.pushEditOperations).toHaveBeenCalledWith(
      [],
      [
        {
          range: expect.objectContaining({
            endColumn: 1,
            endLineNumber: 1,
            startColumn: 1,
            startLineNumber: 1,
          }),
          text: "Open",
        },
      ],
      expect.any(Function),
    );
    expect(applyWorkspaceEdit).toHaveBeenCalledWith(
      {
        changes: {
          ...workspaceEdit(openUri, "Open").changes,
          ...workspaceEdit(closedUri, "Closed").changes,
        },
        documentVersions: {
          [openUri]: 42,
        },
      },
      {
        editedOpenPaths: [openPath],
        rootPath: "/project/",
      },
    );

    disposable.dispose();

    expect(unsubscribe).toHaveBeenCalled();
  });

  it("drops PHP workspace edit events for inactive roots and stale sessions", () => {
    const registered = createRegisteredProviders();
    let activeRoot: string | null = null;
    let activeSessionId = 1;
    let publishWorkspaceEdit: (event: LanguageServerWorkspaceEditEvent) => void =
      () => undefined;
    const workspaceEditGateway: LanguageServerWorkspaceEditGateway = {
      subscribeWorkspaceEdits: vi.fn(async (listener) => {
        publishWorkspaceEdit = listener;
        return () => undefined;
      }),
    };
    const applyWorkspaceEdit = vi.fn(async () => undefined);
    registerLanguageServerMonacoProviders(
      registered.monaco,
      providerContext({
        applyWorkspaceEdit,
        getRuntimeStatus: () => ({
          ...runningStatus(),
          sessionId: activeSessionId,
        }),
        getWorkspaceRoot: () => activeRoot,
        workspaceEditGateway,
      }),
    );

    publishWorkspaceEdit({
      edit: workspaceEdit("file:///project/src/User.php", "No root"),
      label: null,
      rootPath: "/project",
      sessionId: 1,
    });
    activeRoot = "/project";
    publishWorkspaceEdit({
      edit: workspaceEdit("file:///project/src/User.php", "Stale"),
      label: null,
      rootPath: "/project",
      sessionId: 2,
    });
    publishWorkspaceEdit({
      edit: workspaceEdit("file:///other/src/User.php", "Other"),
      label: null,
      rootPath: "/other",
      sessionId: 1,
    });
    activeSessionId = 2;
    publishWorkspaceEdit({
      edit: workspaceEdit("file:///project/src/User.php", "Current"),
      label: null,
      rootPath: "/project",
      sessionId: 2,
    });

    expect(applyWorkspaceEdit).toHaveBeenCalledTimes(1);
    expect(applyWorkspaceEdit).toHaveBeenCalledWith(
      workspaceEdit("file:///project/src/User.php", "Current"),
      {
        editedOpenPaths: [],
        rootPath: "/project",
      },
    );
  });

  it("routes PHP execute-command workspace edits through the workspace applier", async () => {
    const registered = createRegisteredProviders();
    const openPath = "/project/src/User.php";
    const openUri = "file:///project/src/User.php";
    const closedUri = "file:///project/src/Helper.php";
    const openModel = {
      ...model({ path: openPath }),
      pushEditOperations: vi.fn(),
    };
    const edit: LanguageServerWorkspaceEdit = {
      changes: {
        ...workspaceEdit(openUri, "Open command").changes,
        ...workspaceEdit(closedUri, "Closed command").changes,
      },
    };
    const gateway = featuresGateway();
    vi.mocked(gateway.executeCommand).mockResolvedValueOnce(edit);
    vi.mocked(registered.monaco.editor.getModels).mockReturnValue([openModel]);
    const applyWorkspaceEdit = vi.fn(async () => undefined);
    const context = providerContext({
      applyWorkspaceEdit,
      featuresGateway: gateway,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    if (!registered.commandRun) {
      throw new Error("PHP language server command was not registered");
    }
    await registered.commandRun(null, phpCommandPayload());

    expect(gateway.executeCommand).toHaveBeenCalledWith(
      "/project",
      phpCommandPayload().command,
    );
    expect(openModel.pushEditOperations).toHaveBeenCalledWith(
      [],
      [
        {
          range: expect.objectContaining({
            endColumn: 1,
            endLineNumber: 1,
            startColumn: 1,
            startLineNumber: 1,
          }),
          text: "Open command",
        },
      ],
      expect.any(Function),
    );
    expect(applyWorkspaceEdit).toHaveBeenCalledWith(edit, {
      editedOpenPaths: [openPath],
      rootPath: "/project",
    });
  });

  it("keeps PHP execute-command workspace edits open-model-only without an applier", async () => {
    const registered = createRegisteredProviders();
    const openModel = {
      ...model({ path: "/project/src/User.php" }),
      pushEditOperations: vi.fn(),
    };
    const gateway = featuresGateway();
    vi.mocked(gateway.executeCommand).mockResolvedValueOnce({
      changes: {
        ...workspaceEdit("file:///project/src/User.php", "Open fallback")
          .changes,
        ...workspaceEdit("file:///project/src/Helper.php", "Closed fallback")
          .changes,
      },
    });
    vi.mocked(registered.monaco.editor.getModels).mockReturnValue([openModel]);
    registerLanguageServerMonacoProviders(
      registered.monaco,
      providerContext({ featuresGateway: gateway }),
    );

    if (!registered.commandRun) {
      throw new Error("PHP language server command was not registered");
    }
    await registered.commandRun(null, phpCommandPayload());

    expect(openModel.pushEditOperations).toHaveBeenCalledTimes(1);
    expect(openModel.pushEditOperations).toHaveBeenCalledWith(
      [],
      [
        expect.objectContaining({
          text: "Open fallback",
        }),
      ],
      expect.any(Function),
    );
  });

  it("maps PHP prepare rename range and placeholder", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      prepareRename: {
        defaultBehavior: false,
        placeholder: "$account",
        range: range(10, 4, 10, 9),
      },
    });
    const context = providerContext({ featuresGateway: gateway });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.renameProvider.resolveRenameLocation(model(), position()),
    ).resolves.toEqual({
      range: expect.objectContaining({
        endColumn: 10,
        endLineNumber: 11,
        startColumn: 5,
        startLineNumber: 11,
      }),
      text: "$account",
    });
    expect(gateway.prepareRename).toHaveBeenCalledWith("/project", {
      character: 4,
      line: 10,
      path: "/project/src/User.php",
    });
  });

  it("uses PHP default rename location when the language server requests default behavior", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      prepareRename: {
        defaultBehavior: true,
        placeholder: null,
        range: null,
      },
    });
    const context = providerContext({ featuresGateway: gateway });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.renameProvider.resolveRenameLocation(
        model({
          word: {
            endColumn: 6,
            startColumn: 2,
            word: "user",
          },
        }),
        position(),
      ),
    ).resolves.toEqual({
      range: {
        endColumn: 6,
        endLineNumber: 11,
        startColumn: 2,
        startLineNumber: 11,
      },
      text: "user",
    });
  });

  it("maps PHP rename workspace edits for in-root files", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      rename: workspaceEdit("file:///project/src/User.php", "$account"),
    });
    const context = providerContext({ featuresGateway: gateway });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.renameProvider.provideRenameEdits(
        model(),
        position(),
        "$account",
      ),
    ).resolves.toEqual({
      edits: [
        {
          resource: {
            fsPath: "/project/src/User.php",
            path: "/project/src/User.php",
          },
          textEdit: {
            range: expect.objectContaining({
              endColumn: 1,
              endLineNumber: 1,
              startColumn: 1,
              startLineNumber: 1,
            }),
            text: "$account",
          },
          versionId: 42,
        },
      ],
    });
    expect(gateway.rename).toHaveBeenCalledWith(
      "/project",
      {
        character: 4,
        line: 10,
        path: "/project/src/User.php",
      },
      "$account",
    );
  });

  it("routes PHP rename workspace edits through the workspace applier", async () => {
    const registered = createRegisteredProviders();
    const openPath = "/project/src/User.php";
    const openUri = "file:///project/src/User.php";
    const closedUri = "file:///project/src/Helper.php";
    const outsideUri = "file:///other/src/Outside.php";
    const openModel = {
      ...model({ path: openPath }),
      pushEditOperations: vi.fn(),
    };
    const edit: LanguageServerWorkspaceEdit = {
      changes: {
        ...workspaceEdit(openUri, "$account").changes,
        ...workspaceEdit(closedUri, "$helper").changes,
        ...workspaceEdit(outsideUri, "$outside").changes,
      },
    };
    const gateway = featuresGateway({ rename: edit });
    const applyWorkspaceEdit = vi.fn(async () => undefined);
    vi.mocked(registered.monaco.editor.getModels).mockReturnValue([openModel]);
    registerLanguageServerMonacoProviders(
      registered.monaco,
      providerContext({
        applyWorkspaceEdit,
        featuresGateway: gateway,
      }),
    );

    await expect(
      registered.renameProvider.provideRenameEdits(
        model(),
        position(),
        "$account",
      ),
    ).resolves.toEqual({ edits: [] });
    expect(openModel.pushEditOperations).toHaveBeenCalledWith(
      [],
      [
        {
          range: expect.objectContaining({
            endColumn: 1,
            endLineNumber: 1,
            startColumn: 1,
            startLineNumber: 1,
          }),
          text: "$account",
        },
      ],
      expect.any(Function),
    );
    expect(applyWorkspaceEdit).toHaveBeenCalledWith(
      {
        changes: {
          ...workspaceEdit(openUri, "$account").changes,
          ...workspaceEdit(closedUri, "$helper").changes,
        },
      },
      {
        editedOpenPaths: [openPath],
        rootPath: "/project",
      },
    );
  });

  it("drops stale PHP prepare rename and suppresses stale errors after same-root session restart", async () => {
    const registered = createRegisteredProviders();
    let activeSessionId = 1;
    const prepareRename = createDeferred<
      Awaited<ReturnType<LanguageServerFeaturesGateway["prepareRename"]>>
    >();
    const gateway = featuresGateway();
    vi.mocked(gateway.prepareRename).mockImplementationOnce(
      async () => prepareRename.promise,
    );
    const reportError = vi.fn();
    const context = providerContext({
      featuresGateway: gateway,
      getRuntimeStatus: () => ({
        ...runningStatus(),
        sessionId: activeSessionId,
      }),
      reportError,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const renameLocationPromise = registered.renameProvider.resolveRenameLocation(
      model(),
      position(),
    );

    await Promise.resolve();
    activeSessionId = 2;
    prepareRename.reject(new Error("Cannot rename stale symbol."));

    await expect(renameLocationPromise).resolves.toBeNull();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("drops stale PHP rename edits and suppresses stale errors after same-root session restart", async () => {
    const registered = createRegisteredProviders();
    let activeSessionId = 1;
    const rename = createDeferred<
      Awaited<ReturnType<LanguageServerFeaturesGateway["rename"]>>
    >();
    const gateway = featuresGateway();
    vi.mocked(gateway.rename).mockImplementationOnce(async () => rename.promise);
    const reportError = vi.fn();
    const context = providerContext({
      featuresGateway: gateway,
      getRuntimeStatus: () => ({
        ...runningStatus(),
        sessionId: activeSessionId,
      }),
      reportError,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const renameEditsPromise = registered.renameProvider.provideRenameEdits(
      model(),
      position(),
      "$account",
    );

    await Promise.resolve();
    activeSessionId = 2;
    rename.reject(new Error("Cannot rename stale symbol."));

    await expect(renameEditsPromise).resolves.toBeNull();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("drops stale PHP rename after switching project tabs", async () => {
    const registered = createRegisteredProviders();
    let activeRoot: string | null = "/project";
    const rename = createDeferred<
      Awaited<ReturnType<LanguageServerFeaturesGateway["rename"]>>
    >();
    const gateway = featuresGateway();
    vi.mocked(gateway.rename).mockImplementationOnce(async () => rename.promise);
    const reportError = vi.fn();
    const context = providerContext({
      featuresGateway: gateway,
      getWorkspaceRoot: () => activeRoot,
      reportError,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const renameEditsPromise = registered.renameProvider.provideRenameEdits(
      model(),
      position(),
      "$account",
    );

    await Promise.resolve();
    activeRoot = "/other";
    rename.resolve(workspaceEdit("file:///project/src/User.php", "$account"));

    await expect(renameEditsPromise).resolves.toBeNull();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("does not return outside-root PHP rename edits", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      rename: {
        changes: {
          ...workspaceEdit("file:///project/src/User.php", "$account").changes,
          ...workspaceEdit("file:///other/src/Outside.php", "$outside").changes,
        },
      },
    });
    const context = providerContext({ featuresGateway: gateway });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.renameProvider.provideRenameEdits(
        model(),
        position(),
        "$account",
      ),
    ).resolves.toEqual({
      edits: [
        expect.objectContaining({
          resource: {
            fsPath: "/project/src/User.php",
            path: "/project/src/User.php",
          },
        }),
      ],
    });
  });

  it("maps in-root PHP declaration locations", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      declaration: [
        {
          range: range(2, 3, 2, 11),
          uri: "file:///project/src/Contracts/UserRepository.php",
        },
      ],
    });
    const flushPendingDocumentChange = vi.fn(async () => undefined);
    const context = providerContext({
      featuresGateway: gateway,
      flushPendingDocumentChange,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.declarationProvider.provideDeclaration(model(), position()),
    ).resolves.toEqual([
      {
        range: expect.objectContaining({
          endColumn: 12,
          endLineNumber: 3,
          startColumn: 4,
          startLineNumber: 3,
        }),
        uri: {
          fsPath: "/project/src/Contracts/UserRepository.php",
          path: "/project/src/Contracts/UserRepository.php",
        },
      },
    ]);
    expect(flushPendingDocumentChange).toHaveBeenCalledWith(
      "/project/src/User.php",
    );
    expect(gateway.declaration).toHaveBeenCalledWith("/project", {
      character: 4,
      line: 10,
      path: "/project/src/User.php",
    });
  });

  it("maps in-root PHP definition locations", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      definition: [
        {
          range: range(1, 6, 1, 10),
          uri: "file:///project/src/Models/User.php",
        },
      ],
    });
    const flushPendingDocumentChange = vi.fn(async () => undefined);
    const context = providerContext({
      featuresGateway: gateway,
      flushPendingDocumentChange,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.definitionProvider.provideDefinition(model(), position()),
    ).resolves.toEqual([
      {
        range: expect.objectContaining({
          endColumn: 11,
          endLineNumber: 2,
          startColumn: 7,
          startLineNumber: 2,
        }),
        uri: {
          fsPath: "/project/src/Models/User.php",
          path: "/project/src/Models/User.php",
        },
      },
    ]);
    expect(flushPendingDocumentChange).toHaveBeenCalledWith(
      "/project/src/User.php",
    );
    expect(gateway.definition).toHaveBeenCalledWith("/project", {
      character: 4,
      line: 10,
      path: "/project/src/User.php",
    });
  });

  it("maps in-root PHP implementation locations", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      implementation: [
        {
          range: range(8, 2, 8, 18),
          uri: "file:///project/src/Repositories/EloquentUserRepository.php",
        },
        {
          range: range(9, 0, 9, 7),
          uri: "file:///outside/src/UserRepository.php",
        },
      ],
    });
    const context = providerContext({ featuresGateway: gateway });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.implementationProvider.provideImplementation(model(), position()),
    ).resolves.toEqual([
      {
        range: expect.objectContaining({
          endColumn: 19,
          endLineNumber: 9,
          startColumn: 3,
          startLineNumber: 9,
        }),
        uri: {
          fsPath: "/project/src/Repositories/EloquentUserRepository.php",
          path: "/project/src/Repositories/EloquentUserRepository.php",
        },
      },
    ]);
    expect(gateway.implementation).toHaveBeenCalledWith("/project", {
      character: 4,
      line: 10,
      path: "/project/src/User.php",
    });
  });

  it("maps in-root PHP type definition locations", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      typeDefinition: [
        {
          range: range(4, 0, 4, 9),
          uri: "file:///project/src/Models/User.php",
        },
        {
          range: range(6, 0, 6, 7),
          uri: "file:///project-other/src/Models/User.php",
        },
      ],
    });
    const context = providerContext({ featuresGateway: gateway });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.typeDefinitionProvider.provideTypeDefinition(model(), position()),
    ).resolves.toEqual([
      {
        range: expect.objectContaining({
          endColumn: 10,
          endLineNumber: 5,
          startColumn: 1,
          startLineNumber: 5,
        }),
        uri: {
          fsPath: "/project/src/Models/User.php",
          path: "/project/src/Models/User.php",
        },
      },
    ]);
    expect(gateway.typeDefinition).toHaveBeenCalledWith("/project", {
      character: 4,
      line: 10,
      path: "/project/src/User.php",
    });
  });

  it("does not request PHP definition or implementation when capability is disabled", async () => {
    const definitionRegistered = createRegisteredProviders();
    const definitionGateway = featuresGateway({
      definition: [
        {
          range: range(1, 6, 1, 10),
          uri: "file:///project/src/Models/User.php",
        },
      ],
    });
    const definitionFlush = vi.fn(async () => undefined);
    registerLanguageServerMonacoProviders(
      definitionRegistered.monaco,
      providerContext({
        featuresGateway: definitionGateway,
        flushPendingDocumentChange: definitionFlush,
        runtimeStatus: runningStatus({ definition: false }),
      }),
    );

    await expect(
      definitionRegistered.definitionProvider.provideDefinition(
        model(),
        position(),
      ),
    ).resolves.toBeNull();
    expect(definitionFlush).not.toHaveBeenCalled();
    expect(definitionGateway.definition).not.toHaveBeenCalled();

    const implementationRegistered = createRegisteredProviders();
    const implementationGateway = featuresGateway({
      implementation: [
        {
          range: range(8, 2, 8, 18),
          uri: "file:///project/src/Repositories/EloquentUserRepository.php",
        },
      ],
    });
    const implementationFlush = vi.fn(async () => undefined);
    registerLanguageServerMonacoProviders(
      implementationRegistered.monaco,
      providerContext({
        featuresGateway: implementationGateway,
        flushPendingDocumentChange: implementationFlush,
        runtimeStatus: runningStatus({ implementation: false }),
      }),
    );

    await expect(
      implementationRegistered.implementationProvider.provideImplementation(
        model(),
        position(),
      ),
    ).resolves.toBeNull();
    expect(implementationFlush).not.toHaveBeenCalled();
    expect(implementationGateway.implementation).not.toHaveBeenCalled();
  });

  it("drops stale PHP definition and implementation results after async response", async () => {
    const definitionRegistered = createRegisteredProviders();
    let activeSessionId = 1;
    const definition = createDeferred<LanguageServerLocation[]>();
    const definitionGateway = featuresGateway();
    vi.mocked(definitionGateway.definition).mockImplementationOnce(
      async () => definition.promise,
    );
    const definitionContext = providerContext({
      featuresGateway: definitionGateway,
      getRuntimeStatus: () => ({
        ...runningStatus(),
        sessionId: activeSessionId,
      }),
    });
    registerLanguageServerMonacoProviders(
      definitionRegistered.monaco,
      definitionContext,
    );

    const definitionPromise =
      definitionRegistered.definitionProvider.provideDefinition(
        model(),
        position(),
      );

    await Promise.resolve();
    activeSessionId = 2;
    definition.resolve([
      {
        range: range(1, 6, 1, 10),
        uri: "file:///project/src/Models/User.php",
      },
    ]);

    await expect(definitionPromise).resolves.toBeNull();

    const implementationRegistered = createRegisteredProviders();
    let activeRoot: string | null = "/project";
    const implementation = createDeferred<LanguageServerLocation[]>();
    const implementationGateway = featuresGateway();
    vi.mocked(implementationGateway.implementation).mockImplementationOnce(
      async () => implementation.promise,
    );
    const implementationContext = providerContext({
      featuresGateway: implementationGateway,
      getWorkspaceRoot: () => activeRoot,
    });
    registerLanguageServerMonacoProviders(
      implementationRegistered.monaco,
      implementationContext,
    );

    const implementationPromise =
      implementationRegistered.implementationProvider.provideImplementation(
        model(),
        position(),
      );

    await Promise.resolve();
    activeRoot = "/other";
    implementation.resolve([
      {
        range: range(8, 2, 8, 18),
        uri: "file:///project/src/Repositories/EloquentUserRepository.php",
      },
    ]);

    await expect(implementationPromise).resolves.toBeNull();
  });

  it("does not request PHP declaration or type definition when capability is disabled", async () => {
    const declarationRegistered = createRegisteredProviders();
    const declarationGateway = featuresGateway({
      declaration: [
        {
          range: range(2, 3, 2, 11),
          uri: "file:///project/src/Contracts/UserRepository.php",
        },
      ],
    });
    const declarationFlush = vi.fn(async () => undefined);
    registerLanguageServerMonacoProviders(
      declarationRegistered.monaco,
      providerContext({
        featuresGateway: declarationGateway,
        flushPendingDocumentChange: declarationFlush,
        runtimeStatus: runningStatus({ declaration: false }),
      }),
    );

    await expect(
      declarationRegistered.declarationProvider.provideDeclaration(
        model(),
        position(),
      ),
    ).resolves.toBeNull();
    expect(declarationFlush).not.toHaveBeenCalled();
    expect(declarationGateway.declaration).not.toHaveBeenCalled();

    const typeDefinitionRegistered = createRegisteredProviders();
    const typeDefinitionGateway = featuresGateway({
      typeDefinition: [
        {
          range: range(4, 0, 4, 9),
          uri: "file:///project/src/Models/User.php",
        },
      ],
    });
    const typeDefinitionFlush = vi.fn(async () => undefined);
    registerLanguageServerMonacoProviders(
      typeDefinitionRegistered.monaco,
      providerContext({
        featuresGateway: typeDefinitionGateway,
        flushPendingDocumentChange: typeDefinitionFlush,
        runtimeStatus: runningStatus({ typeDefinition: false }),
      }),
    );

    await expect(
      typeDefinitionRegistered.typeDefinitionProvider.provideTypeDefinition(
        model(),
        position(),
      ),
    ).resolves.toBeNull();
    expect(typeDefinitionFlush).not.toHaveBeenCalled();
    expect(typeDefinitionGateway.typeDefinition).not.toHaveBeenCalled();
  });

  it("drops stale PHP declaration and type definition results after async response", async () => {
    const declarationRegistered = createRegisteredProviders();
    let activeSessionId = 1;
    const declaration = createDeferred<LanguageServerLocation[]>();
    const declarationGateway = featuresGateway();
    vi.mocked(declarationGateway.declaration).mockImplementationOnce(
      async () => declaration.promise,
    );
    const declarationContext = providerContext({
      featuresGateway: declarationGateway,
      getRuntimeStatus: () => ({
        ...runningStatus(),
        sessionId: activeSessionId,
      }),
    });
    registerLanguageServerMonacoProviders(
      declarationRegistered.monaco,
      declarationContext,
    );

    const declarationPromise =
      declarationRegistered.declarationProvider.provideDeclaration(
        model(),
        position(),
      );

    await Promise.resolve();
    activeSessionId = 2;
    declaration.resolve([
      {
        range: range(2, 3, 2, 11),
        uri: "file:///project/src/Contracts/UserRepository.php",
      },
    ]);

    await expect(declarationPromise).resolves.toBeNull();

    const typeDefinitionRegistered = createRegisteredProviders();
    let activeRoot: string | null = "/project";
    const typeDefinition = createDeferred<LanguageServerLocation[]>();
    const typeDefinitionGateway = featuresGateway();
    vi.mocked(typeDefinitionGateway.typeDefinition).mockImplementationOnce(
      async () => typeDefinition.promise,
    );
    const typeDefinitionContext = providerContext({
      featuresGateway: typeDefinitionGateway,
      getWorkspaceRoot: () => activeRoot,
    });
    registerLanguageServerMonacoProviders(
      typeDefinitionRegistered.monaco,
      typeDefinitionContext,
    );

    const typeDefinitionPromise =
      typeDefinitionRegistered.typeDefinitionProvider.provideTypeDefinition(
        model(),
        position(),
      );

    await Promise.resolve();
    activeRoot = "/other";
    typeDefinition.resolve([
      {
        range: range(4, 0, 4, 9),
        uri: "file:///project/src/Models/User.php",
      },
    ]);

    await expect(typeDefinitionPromise).resolves.toBeNull();
  });

  it("maps in-root PHP reference locations", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      references: [
        {
          range: range(3, 4, 3, 9),
          uri: "file:///project/src/User.php",
        },
        {
          range: range(7, 8, 7, 13),
          uri: "file:///project/src/Controller.php",
        },
      ],
    });
    const flushPendingDocumentChange = vi.fn(async () => undefined);
    const context = providerContext({
      featuresGateway: gateway,
      flushPendingDocumentChange,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.referenceProvider.provideReferences(model(), position()),
    ).resolves.toEqual([
      {
        range: expect.objectContaining({
          endColumn: 10,
          endLineNumber: 4,
          startColumn: 5,
          startLineNumber: 4,
        }),
        uri: {
          fsPath: "/project/src/User.php",
          path: "/project/src/User.php",
        },
      },
      {
        range: expect.objectContaining({
          endColumn: 14,
          endLineNumber: 8,
          startColumn: 9,
          startLineNumber: 8,
        }),
        uri: {
          fsPath: "/project/src/Controller.php",
          path: "/project/src/Controller.php",
        },
      },
    ]);
    expect(flushPendingDocumentChange).toHaveBeenCalledWith(
      "/project/src/User.php",
    );
    expect(gateway.references).toHaveBeenCalledWith("/project", {
      character: 4,
      line: 10,
      path: "/project/src/User.php",
    });
  });

  it("does not request references when capability is disabled or runtime root mismatches", async () => {
    const disabledRegistered = createRegisteredProviders();
    const disabledGateway = featuresGateway({
      references: [
        {
          range: range(3, 4, 3, 9),
          uri: "file:///project/src/User.php",
        },
      ],
    });
    const disabledFlush = vi.fn(async () => undefined);
    registerLanguageServerMonacoProviders(
      disabledRegistered.monaco,
      providerContext({
        featuresGateway: disabledGateway,
        flushPendingDocumentChange: disabledFlush,
        runtimeStatus: runningStatus({ references: false }),
      }),
    );

    await expect(
      disabledRegistered.referenceProvider.provideReferences(model(), position()),
    ).resolves.toBeNull();
    expect(disabledFlush).not.toHaveBeenCalled();
    expect(disabledGateway.references).not.toHaveBeenCalled();

    const mismatchedRegistered = createRegisteredProviders();
    const mismatchedGateway = featuresGateway({
      references: [
        {
          range: range(3, 4, 3, 9),
          uri: "file:///project/src/User.php",
        },
      ],
    });
    const mismatchedFlush = vi.fn(async () => undefined);
    registerLanguageServerMonacoProviders(
      mismatchedRegistered.monaco,
      providerContext({
        featuresGateway: mismatchedGateway,
        flushPendingDocumentChange: mismatchedFlush,
        getWorkspaceRoot: () => "/project",
        runtimeStatus: {
          ...runningStatus(),
          rootPath: "/other",
        },
      }),
    );

    await expect(
      mismatchedRegistered.referenceProvider.provideReferences(model(), position()),
    ).resolves.toBeNull();
    expect(mismatchedFlush).not.toHaveBeenCalled();
    expect(mismatchedGateway.references).not.toHaveBeenCalled();
  });

  it("drops stale PHP references and suppresses stale errors after same-root session restart", async () => {
    const registered = createRegisteredProviders();
    let activeSessionId = 1;
    const references = createDeferred<LanguageServerLocation[]>();
    const gateway = featuresGateway();
    vi.mocked(gateway.references).mockImplementationOnce(
      async () => references.promise,
    );
    const reportError = vi.fn();
    const context = providerContext({
      featuresGateway: gateway,
      getRuntimeStatus: () => ({
        ...runningStatus(),
        sessionId: activeSessionId,
      }),
      reportError,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const referencesPromise = registered.referenceProvider.provideReferences(
      model(),
      position(),
    );

    await Promise.resolve();
    activeSessionId = 2;
    references.reject(new Error("Cannot find stale references."));

    await expect(referencesPromise).resolves.toBeNull();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("drops stale PHP references after switching project tabs and suppresses stale errors", async () => {
    const registered = createRegisteredProviders();
    let activeRoot: string | null = "/project";
    const references = createDeferred<LanguageServerLocation[]>();
    const gateway = featuresGateway();
    vi.mocked(gateway.references).mockImplementationOnce(
      async () => references.promise,
    );
    const reportError = vi.fn();
    const context = providerContext({
      featuresGateway: gateway,
      getWorkspaceRoot: () => activeRoot,
      reportError,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const referencesPromise = registered.referenceProvider.provideReferences(
      model(),
      position(),
    );

    await Promise.resolve();
    activeRoot = "/other";
    references.reject(new Error("Cannot find stale references."));

    await expect(referencesPromise).resolves.toBeNull();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("filters outside-root PHP reference locations", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      references: [
        {
          range: range(3, 4, 3, 9),
          uri: "file:///project/src/User.php",
        },
        {
          range: range(4, 0, 4, 7),
          uri: "file:///project-other/src/User.php",
        },
        {
          range: range(5, 0, 5, 7),
          uri: "untitled:User.php",
        },
      ],
    });
    const context = providerContext({ featuresGateway: gateway });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.referenceProvider.provideReferences(model(), position()),
    ).resolves.toEqual([
      {
        range: expect.objectContaining({
          endColumn: 10,
          endLineNumber: 4,
          startColumn: 5,
          startLineNumber: 4,
        }),
        uri: {
          fsPath: "/project/src/User.php",
          path: "/project/src/User.php",
        },
      },
    ]);
  });

});

function createRegisteredProviders() {
  const codeActionDispose = vi.fn();
  const commandDispose = vi.fn();
  const declarationDispose = vi.fn();
  const definitionDispose = vi.fn();
  const hoverDispose = vi.fn();
  const implementationDispose = vi.fn();
  const referenceDispose = vi.fn();
  const completionDispose = vi.fn();
  const renameDispose = vi.fn();
  const selectionRangeDispose = vi.fn();
  const signatureDispose = vi.fn();
  const typeDefinitionDispose = vi.fn();
  const registered: {
    codeActionDispose: ReturnType<typeof vi.fn>;
    codeActionLanguage: string | null;
    codeActionMetadata: any;
    codeActionProvider: any;
    commandDispose: ReturnType<typeof vi.fn>;
    commandRun: ((accessor: unknown, payload?: unknown) => unknown) | null;
    completionDispose: ReturnType<typeof vi.fn>;
    completionLanguage: string | null;
    completionProvider: any;
    declarationDispose: ReturnType<typeof vi.fn>;
    declarationLanguage: string | null;
    declarationProvider: any;
    definitionDispose: ReturnType<typeof vi.fn>;
    definitionLanguage: string | null;
    definitionProvider: any;
    hoverDispose: ReturnType<typeof vi.fn>;
    hoverLanguage: string | null;
    hoverProvider: any;
    implementationDispose: ReturnType<typeof vi.fn>;
    implementationLanguage: string | null;
    implementationProvider: any;
    monaco: any;
    referenceDispose: ReturnType<typeof vi.fn>;
    referenceLanguage: string | null;
    referenceProvider: any;
    renameDispose: ReturnType<typeof vi.fn>;
    renameLanguage: string | null;
    renameProvider: any;
    selectionRangeDispose: ReturnType<typeof vi.fn>;
    selectionRangeLanguage: string | null;
    selectionRangeProvider: any;
    signatureDispose: ReturnType<typeof vi.fn>;
    signatureLanguage: string | null;
    signatureProvider: any;
    typeDefinitionDispose: ReturnType<typeof vi.fn>;
    typeDefinitionLanguage: string | null;
    typeDefinitionProvider: any;
  } = {
    codeActionDispose,
    codeActionLanguage: null,
    codeActionMetadata: null,
    codeActionProvider: null,
    commandDispose,
    commandRun: null,
    completionDispose,
    completionLanguage: null,
    completionProvider: null,
    declarationDispose,
    declarationLanguage: null,
    declarationProvider: null,
    definitionDispose,
    definitionLanguage: null,
    definitionProvider: null,
    hoverDispose,
    hoverLanguage: null,
    hoverProvider: null,
    implementationDispose,
    implementationLanguage: null,
    implementationProvider: null,
    monaco: null,
    referenceDispose,
    referenceLanguage: null,
    referenceProvider: null,
    renameDispose,
    renameLanguage: null,
    renameProvider: null,
    selectionRangeDispose,
    selectionRangeLanguage: null,
    selectionRangeProvider: null,
    signatureDispose,
    signatureLanguage: null,
    signatureProvider: null,
    typeDefinitionDispose,
    typeDefinitionLanguage: null,
    typeDefinitionProvider: null,
  };
  registered.monaco = {
    Range: class FakeRange {
      endColumn: number;
      endLineNumber: number;
      startColumn: number;
      startLineNumber: number;

      constructor(
        startLineNumber: number,
        startColumn: number,
        endLineNumber: number,
        endColumn: number,
      ) {
        this.startLineNumber = startLineNumber;
        this.startColumn = startColumn;
        this.endLineNumber = endLineNumber;
        this.endColumn = endColumn;
      }
    },
    editor: {
      addCommand: vi.fn((command) => {
        registered.commandRun = command.run;
        return { dispose: commandDispose };
      }),
      getModels: vi.fn(() => []),
    },
    languages: {
      CodeActionTriggerType: { Invoke: 1 },
      CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
      CompletionItemKind: {
        Class: 7,
        Constant: 21,
        Field: 5,
        Function: 3,
        Interface: 8,
        Method: 2,
        Property: 10,
        Text: 1,
        Value: 12,
        Variable: 6,
      },
      registerCodeActionProvider: vi.fn((language, provider, metadata) => {
        registered.codeActionLanguage = language;
        registered.codeActionProvider = provider;
        registered.codeActionMetadata = metadata;
        return { dispose: codeActionDispose };
      }),
      registerCompletionItemProvider: vi.fn((language, provider) => {
        registered.completionLanguage = language;
        registered.completionProvider = provider;
        return { dispose: completionDispose };
      }),
      registerDeclarationProvider: vi.fn((language, provider) => {
        registered.declarationLanguage = language;
        registered.declarationProvider = provider;
        return { dispose: declarationDispose };
      }),
      registerDefinitionProvider: vi.fn((language, provider) => {
        registered.definitionLanguage = language;
        registered.definitionProvider = provider;
        return { dispose: definitionDispose };
      }),
      registerHoverProvider: vi.fn((language, provider) => {
        registered.hoverLanguage = language;
        registered.hoverProvider = provider;
        return { dispose: hoverDispose };
      }),
      registerImplementationProvider: vi.fn((language, provider) => {
        registered.implementationLanguage = language;
        registered.implementationProvider = provider;
        return { dispose: implementationDispose };
      }),
      registerReferenceProvider: vi.fn((language, provider) => {
        registered.referenceLanguage = language;
        registered.referenceProvider = provider;
        return { dispose: referenceDispose };
      }),
      registerRenameProvider: vi.fn((language, provider) => {
        registered.renameLanguage = language;
        registered.renameProvider = provider;
        return { dispose: renameDispose };
      }),
      registerSelectionRangeProvider: vi.fn((language, provider) => {
        registered.selectionRangeLanguage = language;
        registered.selectionRangeProvider = provider;
        return { dispose: selectionRangeDispose };
      }),
      registerSignatureHelpProvider: vi.fn((language, provider) => {
        registered.signatureLanguage = language;
        registered.signatureProvider = provider;
        return { dispose: signatureDispose };
      }),
      registerTypeDefinitionProvider: vi.fn((language, provider) => {
        registered.typeDefinitionLanguage = language;
        registered.typeDefinitionProvider = provider;
        return { dispose: typeDefinitionDispose };
      }),
    },
    MarkerSeverity: {
      Error: 8,
      Hint: 1,
      Info: 2,
      Warning: 4,
    },
    Uri: {
      file: (path: string) => ({ fsPath: path, path }),
    },
  };

  return registered;
}

function completionLabels(
  suggestions: Array<{ label: string | { label: string } }>,
): string[] {
  return suggestions.map((suggestion) =>
    typeof suggestion.label === "string" ? suggestion.label : suggestion.label.label,
  );
}

function providerContext(
  overrides: Partial<{
    activeDocument: EditorDocument | null;
    applyWorkspaceEdit: NonNullable<
      Parameters<typeof registerLanguageServerMonacoProviders>[1]["applyWorkspaceEdit"]
    >;
    featuresGateway: LanguageServerFeaturesGateway;
    flushPendingDocumentChange(path: string): Promise<void>;
    getWorkspaceRoot(): string | null;
    getRuntimeStatus(): LanguageServerRuntimeStatus | null;
    providePhpMethodCompletions: NonNullable<
      Parameters<typeof registerLanguageServerMonacoProviders>[1]["providePhpMethodCompletions"]
    >;
    providePhpMethodSignature: NonNullable<
      Parameters<typeof registerLanguageServerMonacoProviders>[1]["providePhpMethodSignature"]
    >;
    reportError(error: unknown): void;
    runtimeStatus: LanguageServerRuntimeStatus | null;
    workspaceEditGateway: LanguageServerWorkspaceEditGateway;
  }> = {},
) {
  const activeDocument = overrides.activeDocument ?? document();
  const runtimeStatus = overrides.runtimeStatus ?? runningStatus();

  return {
    applyWorkspaceEdit: overrides.applyWorkspaceEdit,
    featuresGateway: overrides.featuresGateway ?? featuresGateway(),
    flushPendingDocumentChange:
      overrides.flushPendingDocumentChange ?? vi.fn(async () => undefined),
    getActiveDocument: () => activeDocument,
    getRuntimeStatus: overrides.getRuntimeStatus ?? (() => runtimeStatus),
    getWorkspaceRoot: overrides.getWorkspaceRoot ?? (() => "/project"),
    providePhpMethodCompletions: overrides.providePhpMethodCompletions,
    providePhpMethodSignature: overrides.providePhpMethodSignature,
    reportError: overrides.reportError ?? vi.fn(),
    workspaceEditGateway: overrides.workspaceEditGateway,
  };
}

function featuresGateway(
  responses: Partial<{
    codeActions: Awaited<
      ReturnType<LanguageServerFeaturesGateway["codeActions"]>
    >;
    completion: LanguageServerCompletionList;
    declaration: LanguageServerLocation[];
    definition: LanguageServerLocation[];
    documentSymbols: Awaited<
      ReturnType<LanguageServerFeaturesGateway["documentSymbols"]>
    >;
    formatting: Awaited<ReturnType<LanguageServerFeaturesGateway["formatting"]>>;
    hover: LanguageServerHover | null;
    implementation: LanguageServerLocation[];
    inlayHints: Awaited<ReturnType<LanguageServerFeaturesGateway["inlayHints"]>>;
    prepareRename: Awaited<
      ReturnType<LanguageServerFeaturesGateway["prepareRename"]>
    >;
    references: LanguageServerLocation[];
    resolvedCodeAction: Awaited<
      ReturnType<LanguageServerFeaturesGateway["resolveCodeAction"]>
    >;
    rename: Awaited<ReturnType<LanguageServerFeaturesGateway["rename"]>>;
    selectionRanges: Awaited<
      ReturnType<LanguageServerFeaturesGateway["selectionRanges"]>
    >;
    signatureHelp: Awaited<
      ReturnType<LanguageServerFeaturesGateway["signatureHelp"]>
    >;
    typeDefinition: LanguageServerLocation[];
    workspaceSymbols: Awaited<
      ReturnType<LanguageServerFeaturesGateway["workspaceSymbols"]>
    >;
  }> = {},
): LanguageServerFeaturesGateway {
  return {
    codeActions: vi.fn(async () => responses.codeActions ?? []),
    codeLenses: vi.fn(async () => []),
    completion: vi.fn(async () =>
      responses.completion ?? {
        isIncomplete: false,
        items: [],
      },
    ),
    declaration: vi.fn(async () => responses.declaration ?? []),
    definition: vi.fn(async () => responses.definition ?? []),
    didChangeConfiguration: vi.fn(async () => undefined),
    didChangeWatchedFiles: vi.fn(async () => undefined),
    didRenameFiles: vi.fn(async () => undefined),
    documentHighlights: vi.fn(async () => []),
    documentLinks: vi.fn(async () => []),
    documentSymbols: vi.fn(async () => responses.documentSymbols ?? []),
    executeCommand: vi.fn(async () => null),
    foldingRanges: vi.fn(async () => []),
    formatting: vi.fn(async () => responses.formatting ?? []),
    hover: vi.fn(async () => responses.hover ?? null),
    incomingCalls: vi.fn(async () => []),
    implementation: vi.fn(async () => responses.implementation ?? []),
    inlayHints: vi.fn(async () => responses.inlayHints ?? []),
    resolveInlayHint: vi.fn(async (_rootPath, hint) => hint),
    linkedEditingRanges: vi.fn(async () => null),
    onTypeFormatting: vi.fn(async () => []),
    outgoingCalls: vi.fn(async () => []),
    prepareCallHierarchy: vi.fn(async () => []),
    prepareRename: vi.fn(async () => responses.prepareRename ?? null),
    prepareTypeHierarchy: vi.fn(async () => []),
    rangeFormatting: vi.fn(async () => []),
    rangeSemanticTokens: vi.fn(async () => null),
    references: vi.fn(async () => responses.references ?? []),
    rename: vi.fn(async () => responses.rename ?? null),
    selectionRanges: vi.fn(async () => responses.selectionRanges ?? []),
    semanticTokens: vi.fn(async () => null),
    signatureHelp: vi.fn(async () => responses.signatureHelp ?? null),
    sourceDefinition: vi.fn(async () => []),
    typeDefinition: vi.fn(async () => responses.typeDefinition ?? []),
    typeHierarchySubtypes: vi.fn(async () => []),
    typeHierarchySupertypes: vi.fn(async () => []),
    willRenameFiles: vi.fn(async () => null),
    workspaceSymbols: vi.fn(async () => responses.workspaceSymbols ?? []),
    resolveCompletionItem: vi.fn(async (_rootPath, item) => item),
    resolveCodeAction: vi.fn(
      async (_rootPath, action) => responses.resolvedCodeAction ?? action,
    ),
    resolveCodeLens: vi.fn(async (_rootPath, lens) => lens),
    resolveDocumentLink: vi.fn(async (_rootPath, link) => link),
  };
}

function backedCodeAction() {
  return {
    __languageServerAction: {
      command: null,
      data: { id: "add-import" },
      edit: null,
      isPreferred: true,
      kind: "quickfix",
      title: "Import User",
    },
    __workspaceEditContext: {
      path: "/project/src/User.php",
      versionId: 42,
    },
    __languageServerSessionId: 1,
    __workspaceRoot: "/project",
    diagnostics: [],
    kind: "quickfix",
    title: "Import User",
  };
}

function phpCommandPayload(rootPath = "/project", sessionId = 1) {
  return {
    command: {
      arguments: [],
      command: "phpactor.fixAll",
      title: "Fix all",
    },
    rootPath,
    sessionId,
  };
}

function runningStatus(
  capabilities: Partial<LanguageServerCapabilities> = {},
): LanguageServerRuntimeStatus {
  return {
    capabilities: {
      callHierarchy: true,
      codeAction: true,
      codeLens: true,
      completion: true,
      declaration: true,
      definition: true,
      documentHighlight: true,
      documentLink: true,
      documentSymbol: true,
      didRenameFiles: true,
      foldingRange: true,
      formatting: true,
      hover: true,
      implementation: true,
      inlayHint: true,
      linkedEditingRange: true,
      onTypeFormatting: true,
      prepareRename: true,
      rangeFormatting: true,
      references: true,
      rename: true,
      selectionRange: true,
      semanticTokens: true,
      signatureHelp: true,
      sourceDefinition: true,
      typeDefinition: true,
      typeHierarchy: true,
      willRenameFiles: true,
      workspaceSymbol: true,
      ...capabilities,
    },
    kind: "running",
    rootPath: "/project",
    sessionId: 1,
  };
}

function rootlessRunningStatus(): LanguageServerRuntimeStatus {
  const { rootPath: _rootPath, ...status } = runningStatus();

  return status;
}

function createDeferred<T>(): {
  promise: Promise<T>;
  reject(reason?: unknown): void;
  resolve(value: T): void;
} {
  let rejectValue: ((reason?: unknown) => void) | null = null;
  let resolveValue: ((value: T) => void) | null = null;
  const promise = new Promise<T>((resolve, reject) => {
    rejectValue = reject;
    resolveValue = resolve;
  });

  return {
    promise,
    reject(reason?: unknown): void {
      rejectValue?.(reason);
    },
    resolve(value: T): void {
      resolveValue?.(value);
    },
  };
}

function document(): EditorDocument {
  return {
    content: "<?php\nfunction show() {\n    $user = null;\n    echo $user;\n}",
    language: "php",
    name: "User.php",
    path: "/project/src/User.php",
    savedContent: "<?php echo $user;",
  };
}

function phpCompletionFixtureSource(): string {
  return `<?php
function show() {
    $user = null;







    $use
}
`;
}

function model(
  overrides: Partial<{
    content: string;
    lineContent: string;
    path: string;
    word: { endColumn: number; startColumn: number; word?: string };
  }> = {},
) {
  return {
    getValue: vi.fn(() => {
      if (overrides.content !== undefined) {
        return overrides.content;
      }

      throw new Error("model source unavailable");
    }),
    getLineContent: vi.fn(() => overrides.lineContent ?? "$user"),
    getValueInRange: vi.fn(() => "$user"),
    getVersionId: vi.fn(() => 42),
    getWordAtPosition: vi.fn(() => ({
      endColumn: overrides.word?.endColumn ?? 5,
      startColumn: overrides.word?.startColumn ?? 2,
      word: overrides.word?.word ?? "$user",
    })),
    getWordUntilPosition: vi.fn(() => overrides.word ?? {
      endColumn: 5,
      startColumn: 2,
    }),
    uri: {
      fsPath: overrides.path ?? "/project/src/User.php",
      path: overrides.path ?? "/project/src/User.php",
    },
  };
}

function position() {
  return {
    column: 5,
    lineNumber: 11,
  };
}

function workspaceEdit(uri: string, newText: string) {
  return {
    changes: {
      [uri]: [
        {
          newText,
          range: range(0, 0, 0, 0),
        },
      ],
    },
  };
}

function range(
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number,
): LanguageServerRange {
  return {
    end: {
      character: endCharacter,
      line: endLine,
    },
    start: {
      character: startCharacter,
      line: startLine,
    },
  };
}
