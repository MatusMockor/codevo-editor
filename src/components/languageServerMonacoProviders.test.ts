import { describe, expect, it, vi } from "vitest";
import { registerLanguageServerMonacoProviders } from "./languageServerMonacoProviders";
import type {
  LanguageServerCompletionList,
  LanguageServerFeaturesGateway,
  LanguageServerHover,
  LanguageServerLocation,
  LanguageServerRange,
} from "../domain/languageServerFeatures";
import type {
  LanguageServerCapabilities,
  LanguageServerRuntimeStatus,
} from "../domain/languageServerRuntime";
import type { EditorDocument } from "../domain/workspace";

describe("registerLanguageServerMonacoProviders", () => {
  it("registers php hover, completion, signature, code action and selection range providers and disposes them", () => {
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

});

function createRegisteredProviders() {
  const codeActionDispose = vi.fn();
  const commandDispose = vi.fn();
  const hoverDispose = vi.fn();
  const completionDispose = vi.fn();
  const selectionRangeDispose = vi.fn();
  const signatureDispose = vi.fn();
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
    hoverDispose: ReturnType<typeof vi.fn>;
    hoverLanguage: string | null;
    hoverProvider: any;
    monaco: any;
    selectionRangeDispose: ReturnType<typeof vi.fn>;
    selectionRangeLanguage: string | null;
    selectionRangeProvider: any;
    signatureDispose: ReturnType<typeof vi.fn>;
    signatureLanguage: string | null;
    signatureProvider: any;
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
    hoverDispose,
    hoverLanguage: null,
    hoverProvider: null,
    monaco: null,
    selectionRangeDispose,
    selectionRangeLanguage: null,
    selectionRangeProvider: null,
    signatureDispose,
    signatureLanguage: null,
    signatureProvider: null,
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
      registerHoverProvider: vi.fn((language, provider) => {
        registered.hoverLanguage = language;
        registered.hoverProvider = provider;
        return { dispose: hoverDispose };
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
    featuresGateway: LanguageServerFeaturesGateway;
    flushPendingDocumentChange(path: string): Promise<void>;
    getWorkspaceRoot(): string | null;
    providePhpMethodCompletions: NonNullable<
      Parameters<typeof registerLanguageServerMonacoProviders>[1]["providePhpMethodCompletions"]
    >;
    providePhpMethodSignature: NonNullable<
      Parameters<typeof registerLanguageServerMonacoProviders>[1]["providePhpMethodSignature"]
    >;
    runtimeStatus: LanguageServerRuntimeStatus | null;
  }> = {},
) {
  const activeDocument = overrides.activeDocument ?? document();
  const runtimeStatus = overrides.runtimeStatus ?? runningStatus();

  return {
    featuresGateway: overrides.featuresGateway ?? featuresGateway(),
    flushPendingDocumentChange:
      overrides.flushPendingDocumentChange ?? vi.fn(async () => undefined),
    getActiveDocument: () => activeDocument,
    getRuntimeStatus: () => runtimeStatus,
    getWorkspaceRoot: overrides.getWorkspaceRoot ?? (() => "/project"),
    providePhpMethodCompletions: overrides.providePhpMethodCompletions,
    providePhpMethodSignature: overrides.providePhpMethodSignature,
    reportError: vi.fn(),
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
    inlayHints: Awaited<ReturnType<LanguageServerFeaturesGateway["inlayHints"]>>;
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
    implementation: vi.fn(async () => []),
    inlayHints: vi.fn(async () => responses.inlayHints ?? []),
    resolveInlayHint: vi.fn(async (_rootPath, hint) => hint),
    linkedEditingRanges: vi.fn(async () => null),
    onTypeFormatting: vi.fn(async () => []),
    outgoingCalls: vi.fn(async () => []),
    prepareCallHierarchy: vi.fn(async () => []),
    prepareRename: vi.fn(async () => null),
    prepareTypeHierarchy: vi.fn(async () => []),
    rangeFormatting: vi.fn(async () => []),
    rangeSemanticTokens: vi.fn(async () => null),
    references: vi.fn(async () => responses.references ?? []),
    rename: vi.fn(async () => responses.rename ?? null),
    selectionRanges: vi.fn(async () => responses.selectionRanges ?? []),
    semanticTokens: vi.fn(async () => null),
    signatureHelp: vi.fn(async () => responses.signatureHelp ?? null),
    sourceDefinition: vi.fn(async () => []),
    typeDefinition: vi.fn(async () => []),
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
    __workspaceRoot: "/project",
    diagnostics: [],
    kind: "quickfix",
    title: "Import User",
  };
}

function phpCommandPayload(rootPath = "/project") {
  return {
    command: {
      arguments: [],
      command: "phpactor.fixAll",
      title: "Fix all",
    },
    rootPath,
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
    word: { endColumn: number; startColumn: number };
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
    getVersionId: vi.fn(() => 42),
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
