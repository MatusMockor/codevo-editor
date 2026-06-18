import { describe, expect, it, vi } from "vitest";
import { registerLanguageServerMonacoProviders } from "./languageServerMonacoProviders";
import type {
  LanguageServerCompletionList,
  LanguageServerFeaturesGateway,
  LanguageServerHover,
  LanguageServerLocation,
} from "../domain/languageServerFeatures";
import type {
  LanguageServerCapabilities,
  LanguageServerRuntimeStatus,
} from "../domain/languageServerRuntime";
import type { EditorDocument } from "../domain/workspace";

describe("registerLanguageServerMonacoProviders", () => {
  it("registers php hover, completion, signature and code action providers and disposes them", () => {
    const registered = createRegisteredProviders();
    const context = providerContext();
    const disposable = registerLanguageServerMonacoProviders(
      registered.monaco,
      context,
    );

    expect(registered.hoverLanguage).toBe("php");
    expect(registered.completionLanguage).toBe("php");
    expect(registered.signatureLanguage).toBe("php");
    expect(registered.codeActionLanguage).toBe("php");
    expect(registered.codeActionMetadata).toEqual({
      providedCodeActionKinds: ["quickfix"],
    });

    disposable.dispose();

    expect(registered.hoverDispose).toHaveBeenCalled();
    expect(registered.completionDispose).toHaveBeenCalled();
    expect(registered.signatureDispose).toHaveBeenCalled();
    expect(registered.codeActionDispose).toHaveBeenCalled();
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

  it("maps completion responses to Monaco suggestions", async () => {
    const registered = createRegisteredProviders();
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
      registered.completionProvider.provideCompletionItems(model(), position()),
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
        insertText: "forceDestroy($0)",
        label: {
          description: "method - Illuminate\\Database\\Eloquent\\Model",
          detail: "()",
          label: "forceDestroy",
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
          insertText: "get($0)",
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

  it("provides a quick fix for unexpected bare PHP identifiers", () => {
    const registered = createRegisteredProviders();
    const context = providerContext();
    registerLanguageServerMonacoProviders(registered.monaco, context);

    expect(
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
    ).toEqual({
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
  });

});

function createRegisteredProviders() {
  const codeActionDispose = vi.fn();
  const hoverDispose = vi.fn();
  const completionDispose = vi.fn();
  const signatureDispose = vi.fn();
  const registered: {
    codeActionDispose: ReturnType<typeof vi.fn>;
    codeActionLanguage: string | null;
    codeActionMetadata: any;
    codeActionProvider: any;
    completionDispose: ReturnType<typeof vi.fn>;
    completionLanguage: string | null;
    completionProvider: any;
    hoverDispose: ReturnType<typeof vi.fn>;
    hoverLanguage: string | null;
    hoverProvider: any;
    monaco: any;
    signatureDispose: ReturnType<typeof vi.fn>;
    signatureLanguage: string | null;
    signatureProvider: any;
  } = {
    codeActionDispose,
    codeActionLanguage: null,
    codeActionMetadata: null,
    codeActionProvider: null,
    completionDispose,
    completionLanguage: null,
    completionProvider: null,
    hoverDispose,
    hoverLanguage: null,
    hoverProvider: null,
    monaco: null,
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
    languages: {
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
      registerSignatureHelpProvider: vi.fn((language, provider) => {
        registered.signatureLanguage = language;
        registered.signatureProvider = provider;
        return { dispose: signatureDispose };
      }),
    },
  };

  return registered;
}

function providerContext(
  overrides: Partial<{
    activeDocument: EditorDocument | null;
    featuresGateway: LanguageServerFeaturesGateway;
    flushPendingDocumentChange(path: string): Promise<void>;
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
    getWorkspaceRoot: () => "/project",
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
    definition: LanguageServerLocation[];
    documentSymbols: Awaited<
      ReturnType<LanguageServerFeaturesGateway["documentSymbols"]>
    >;
    formatting: Awaited<ReturnType<LanguageServerFeaturesGateway["formatting"]>>;
    hover: LanguageServerHover | null;
    inlayHints: Awaited<ReturnType<LanguageServerFeaturesGateway["inlayHints"]>>;
    references: LanguageServerLocation[];
    rename: Awaited<ReturnType<LanguageServerFeaturesGateway["rename"]>>;
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
    completion: vi.fn(async () =>
      responses.completion ?? {
        isIncomplete: false,
        items: [],
      },
    ),
    definition: vi.fn(async () => responses.definition ?? []),
    documentHighlights: vi.fn(async () => []),
    documentLinks: vi.fn(async () => []),
    documentSymbols: vi.fn(async () => responses.documentSymbols ?? []),
    executeCommand: vi.fn(async () => null),
    foldingRanges: vi.fn(async () => []),
    formatting: vi.fn(async () => responses.formatting ?? []),
    hover: vi.fn(async () => responses.hover ?? null),
    implementation: vi.fn(async () => []),
    inlayHints: vi.fn(async () => responses.inlayHints ?? []),
    rangeFormatting: vi.fn(async () => []),
    references: vi.fn(async () => responses.references ?? []),
    rename: vi.fn(async () => responses.rename ?? null),
    selectionRanges: vi.fn(async () => []),
    signatureHelp: vi.fn(async () => responses.signatureHelp ?? null),
    workspaceSymbols: vi.fn(async () => responses.workspaceSymbols ?? []),
    resolveCompletionItem: vi.fn(async (_rootPath, item) => item),
    resolveCodeAction: vi.fn(async (_rootPath, action) => action),
    resolveDocumentLink: vi.fn(async (_rootPath, link) => link),
  };
}

function runningStatus(
  capabilities: Partial<LanguageServerCapabilities> = {},
): LanguageServerRuntimeStatus {
  return {
    capabilities: {
      codeAction: true,
      completion: true,
      definition: true,
      documentHighlight: true,
      documentLink: true,
      documentSymbol: true,
      foldingRange: true,
      formatting: true,
      hover: true,
      implementation: true,
      inlayHint: true,
      rangeFormatting: true,
      references: true,
      rename: true,
      selectionRange: true,
      signatureHelp: true,
      workspaceSymbol: true,
      ...capabilities,
    },
    kind: "running",
    sessionId: 1,
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

function model(
  overrides: Partial<{
    lineContent: string;
    path: string;
    word: { endColumn: number; startColumn: number };
  }> = {},
) {
  return {
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
