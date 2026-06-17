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
  it("registers php hover, completion and signature providers and disposes them", () => {
    const registered = createRegisteredProviders();
    const context = providerContext();
    const disposable = registerLanguageServerMonacoProviders(
      registered.monaco,
      context,
    );

    expect(registered.hoverLanguage).toBe("php");
    expect(registered.completionLanguage).toBe("php");
    expect(registered.signatureLanguage).toBe("php");

    disposable.dispose();

    expect(registered.hoverDispose).toHaveBeenCalled();
    expect(registered.completionDispose).toHaveBeenCalled();
    expect(registered.signatureDispose).toHaveBeenCalled();
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
    expect(gateway.hover).toHaveBeenCalledWith({
      character: 4,
      line: 10,
      path: "/project/src/User.php",
    });
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
          kind: 1,
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
    expect(gateway.completion).toHaveBeenCalledWith({
      character: 4,
      line: 10,
      path: "/project/src/User.php",
    });
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
            "Symfony\\Component\\HttpFoundation\\Request(string $key, mixed $default = null): mixed",
          documentation:
            "Symfony\\Component\\HttpFoundation\\Request::get()\n\n- string $key\n- mixed $default = null",
          insertText: "get(${1:key})",
          insertTextRules: 4,
          kind: 2,
          label: "get",
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
});

function createRegisteredProviders() {
  const hoverDispose = vi.fn();
  const completionDispose = vi.fn();
  const signatureDispose = vi.fn();
  const registered: {
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
    languages: {
      CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
      CompletionItemKind: { Method: 2, Text: 1, Variable: 6 },
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
    providePhpMethodCompletions: overrides.providePhpMethodCompletions,
    providePhpMethodSignature: overrides.providePhpMethodSignature,
    reportError: vi.fn(),
  };
}

function featuresGateway(
  responses: Partial<{
    completion: LanguageServerCompletionList;
    definition: LanguageServerLocation[];
    hover: LanguageServerHover | null;
  }> = {},
): LanguageServerFeaturesGateway {
  return {
    completion: vi.fn(async () =>
      responses.completion ?? {
        isIncomplete: false,
        items: [],
      },
    ),
    definition: vi.fn(async () => responses.definition ?? []),
    hover: vi.fn(async () => responses.hover ?? null),
    implementation: vi.fn(async () => []),
  };
}

function runningStatus(
  capabilities: Partial<LanguageServerCapabilities> = {},
): LanguageServerRuntimeStatus {
  return {
    capabilities: {
      completion: true,
      definition: true,
      hover: true,
      implementation: true,
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
