import { describe, expect, it, vi } from "vitest";
import { URI } from "monaco-editor/esm/vs/base/common/uri.js";
import type {
  LanguageServerFeaturesGateway,
  LanguageServerRange,
  LanguageServerRefreshEvent,
  LanguageServerRefreshGateway,
  LanguageServerWorkspaceEditEvent,
  LanguageServerWorkspaceEditGateway,
} from "../domain/languageServerFeatures";
import type {
  LanguageServerRuntimeCapabilities,
  LanguageServerRuntimeStatus,
} from "../domain/languageServerRuntime";
import type { EditorDocument } from "../domain/workspace";
import {
  registerJavaScriptTypeScriptLanguageServerMonacoProviders,
  type JavaScriptTypeScriptWorkspaceEditApplicationContext,
  type JavaScriptTypeScriptLanguageServerProviderContext,
} from "./javascriptTypescriptLanguageServerMonacoProviders";
import { workspaceModelUri } from "./phpMonacoDocumentContext";

const JAVASCRIPT_TYPESCRIPT_PROVIDER_LANGUAGES = [
  "javascript",
  "typescript",
  "javascriptreact",
  "typescriptreact",
  "vue",
];

describe("registerJavaScriptTypeScriptLanguageServerMonacoProviders", () => {
  it("registers VS Code-like navigation, actions, rename and formatting providers", () => {
    const monaco = createMonaco();
    const disposable = registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext(),
    );

    expect(monaco.languages.registerHoverProvider).toHaveBeenCalledTimes(5);
    expect(monaco.languages.registerCompletionItemProvider).toHaveBeenCalledTimes(5);
    expect(monaco.languages.registerDeclarationProvider).toHaveBeenCalledTimes(5);
    expect(monaco.languages.registerDefinitionProvider).toHaveBeenCalledTimes(5);
    expect(monaco.languages.registerImplementationProvider).toHaveBeenCalledTimes(5);
    expect(monaco.languages.registerTypeDefinitionProvider).toHaveBeenCalledTimes(5);
    expect(monaco.languages.registerSignatureHelpProvider).toHaveBeenCalledTimes(5);
    expect(monaco.languages.registerReferenceProvider).toHaveBeenCalledTimes(5);
    expect(monaco.languages.registerRenameProvider).toHaveBeenCalledTimes(5);
    expect(monaco.languages.registerCodeActionProvider).toHaveBeenCalledTimes(5);
    expect(
      monaco.languages.registerDocumentFormattingEditProvider,
    ).toHaveBeenCalledTimes(5);
    expect(
      monaco.languages.registerDocumentRangeFormattingEditProvider,
    ).toHaveBeenCalledTimes(5);
    expect(
      monaco.languages.registerOnTypeFormattingEditProvider,
    ).toHaveBeenCalledTimes(5);
    expect(monaco.languages.registerInlayHintsProvider).toHaveBeenCalledTimes(5);
    expect(monaco.languages.registerDocumentHighlightProvider).toHaveBeenCalledTimes(5);
    expect(monaco.languages.registerDocumentSymbolProvider).toHaveBeenCalledTimes(5);
    expect(monaco.languages.registerWorkspaceSymbolProvider).toHaveBeenCalledTimes(1);
    expect(monaco.languages.registerLinkProvider).toHaveBeenCalledTimes(5);
    expect(monaco.languages.registerFoldingRangeProvider).toHaveBeenCalledTimes(5);
    expect(monaco.languages.registerSelectionRangeProvider).toHaveBeenCalledTimes(5);
    expect(monaco.languages.registerLinkedEditingRangeProvider).toHaveBeenCalledTimes(5);
    expect(monaco.languages.registerCodeLensProvider).toHaveBeenCalledTimes(5);
    expect(
      monaco.languages.registerDocumentSemanticTokensProvider,
    ).toHaveBeenCalledTimes(5);
    expect(
      monaco.languages.registerDocumentRangeSemanticTokensProvider,
    ).toHaveBeenCalledTimes(5);
    expect(
      (monaco.languages.registerCompletionItemProvider as any).mock.calls.map(
        ([language]: [string]) => language,
      ),
    ).toEqual(JAVASCRIPT_TYPESCRIPT_PROVIDER_LANGUAGES);
    for (const registerProvider of [
      monaco.languages.registerHoverProvider,
      monaco.languages.registerCompletionItemProvider,
      monaco.languages.registerDeclarationProvider,
      monaco.languages.registerDefinitionProvider,
      monaco.languages.registerImplementationProvider,
      monaco.languages.registerTypeDefinitionProvider,
      monaco.languages.registerSignatureHelpProvider,
      monaco.languages.registerReferenceProvider,
      monaco.languages.registerRenameProvider,
      monaco.languages.registerCodeActionProvider,
      monaco.languages.registerDocumentFormattingEditProvider,
      monaco.languages.registerDocumentRangeFormattingEditProvider,
      monaco.languages.registerOnTypeFormattingEditProvider,
      monaco.languages.registerInlayHintsProvider,
      monaco.languages.registerDocumentHighlightProvider,
      monaco.languages.registerDocumentSymbolProvider,
      monaco.languages.registerLinkProvider,
      monaco.languages.registerFoldingRangeProvider,
      monaco.languages.registerSelectionRangeProvider,
      monaco.languages.registerLinkedEditingRangeProvider,
      monaco.languages.registerCodeLensProvider,
      monaco.languages.registerDocumentSemanticTokensProvider,
      monaco.languages.registerDocumentRangeSemanticTokensProvider,
    ]) {
      expect(providerLanguages(registerProvider)).toEqual(
        JAVASCRIPT_TYPESCRIPT_PROVIDER_LANGUAGES,
      );
    }
    expect(
      (monaco.languages.registerCompletionItemProvider as any).mock.calls[0][1]
        .triggerCharacters,
    ).toEqual([".", "'", "\"", "`", "/", "@", "<", "#"]);
    expect(
      (monaco.languages.registerCodeActionProvider as any).mock.calls[0][2]
        .providedCodeActionKinds,
    ).toEqual(
      expect.arrayContaining([
        "refactor.move",
        "source.addMissingImports.ts",
        "source.fixAll.ts",
        "source.organizeImports.ts",
        "source.removeUnused.ts",
        "source.removeUnusedImports.ts",
        "source.sortImports.ts",
      ]),
    );

    disposable.dispose();

    expect(monaco.dispose).toHaveBeenCalledTimes(117);
  });

  it("registers advertised on-type formatting trigger characters", () => {
    const monaco = createMonaco();

    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        getRuntimeStatus: () =>
          runningStatus({
            onTypeFormattingTriggerCharacters: ["}", ";", "\n", ","],
          }),
      }),
    );

    const onTypeFormattingProvider = (
      monaco.languages.registerOnTypeFormattingEditProvider as any
    ).mock.calls[0][1];

    expect(onTypeFormattingProvider.autoFormatTriggerCharacters).toEqual([
      "}",
      ";",
      "\n",
      ",",
    ]);
  });

  it("requests TypeScript language-server completions for TSX documents", async () => {
    const monaco = createMonaco();
    const gateway = featuresGateway({
      completion: {
        isIncomplete: false,
        items: [
          {
            detail: "function useUser(): User",
            documentation: "Loads the current user.",
            insertText: "useUser",
            kind: 3,
            label: "useUser",
          },
        ],
      },
    });
    const context = providerContext({
      featuresGateway: gateway,
      getActiveDocument: () => ({
        ...document(),
        language: "typescriptreact",
        name: "App.tsx",
        path: "/project/src/App.tsx",
      }),
    });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(monaco as any, context);
    const model = {
      ...textModel(),
      uri: {
        fsPath: "/project/src/App.tsx",
        path: "/project/src/App.tsx",
      },
    };
    const position = { column: 4, lineNumber: 2 };
    const completionProvider = (
      monaco.languages.registerCompletionItemProvider as any
    ).mock.calls[3][1];

    const result = await completionProvider.provideCompletionItems(
      model,
      position,
      {
        triggerCharacter: ".",
        triggerKind: 1,
      },
    );

    expect(gateway.completion).toHaveBeenCalledWith(
      "/project",
      {
        character: 3,
        line: 1,
        path: "/project/src/App.tsx",
      },
      {
        triggerCharacter: ".",
        triggerKind: 2,
      },
    );
    expect(result.suggestions[0]).toEqual(
      expect.objectContaining({
        insertText: "useUser",
        kind: 3,
        label: "useUser",
      }),
    );
    expect(result.suggestions[0]).not.toHaveProperty("insertTextRules");
  });

  it("routes Vue completion, hover, definition and code action requests through the JS/TS gateway using the Vue document path", async () => {
    const monaco = createMonaco();
    const gateway = featuresGateway({
      codeActions: [
        {
          command: null,
          data: null,
          edit: null,
          isPreferred: true,
          kind: "quickfix",
          title: "Add missing import",
        },
      ],
      completion: {
        isIncomplete: false,
        items: [
          {
            detail: "const message: string",
            documentation: null,
            insertText: "message",
            kind: 6,
            label: "message",
          },
        ],
      },
      definition: [
        {
          range: range(1, 6, 1, 13),
          uri: "file:///project/src/App.vue",
        },
      ],
    });
    vi.mocked(gateway.hover).mockResolvedValueOnce({
      contents: "const message: string",
    });
    const vueDocument = {
      ...document(),
      content:
        '<script setup lang="ts">\nconst message = "hello";\nmessage\n</script>\n',
      language: "vue",
      name: "App.vue",
      path: "/project/src/App.vue",
      savedContent:
        '<script setup lang="ts">\nconst message = "hello";\nmessage\n</script>\n',
    };
    const context = providerContext({
      featuresGateway: gateway,
      getActiveDocument: () => vueDocument,
    });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(monaco as any, context);
    const model = {
      ...textModel(),
      getValue: vi.fn(() => vueDocument.content),
      uri: {
        fsPath: "/project/src/App.vue",
        path: "/project/src/App.vue",
      },
    };
    const position = { column: 8, lineNumber: 3 };
    const completionProvider = (
      monaco.languages.registerCompletionItemProvider as any
    ).mock.calls[4][1];
    const hoverProvider = (monaco.languages.registerHoverProvider as any).mock
      .calls[4][1];
    const definitionProvider = (
      monaco.languages.registerDefinitionProvider as any
    ).mock.calls[4][1];
    const codeActionProvider = (
      monaco.languages.registerCodeActionProvider as any
    ).mock.calls[4][1];

    await completionProvider.provideCompletionItems(model, position, {
      triggerCharacter: ".",
      triggerKind: 1,
    });
    await hoverProvider.provideHover(model, position, {
      isCancellationRequested: false,
    });
    await definitionProvider.provideDefinition(model, position, {
      isCancellationRequested: false,
    });
    await codeActionProvider.provideCodeActions(
      model,
      new monaco.Range(2, 1, 2, 8),
      {
        markers: [],
        only: "quickfix",
      },
    );

    const expectedDocument = {
      character: 7,
      line: 2,
      path: "/project/src/App.vue",
    };
    expect(gateway.completion).toHaveBeenCalledWith(
      "/project",
      expectedDocument,
      {
        triggerCharacter: ".",
        triggerKind: 2,
      },
    );
    expect(gateway.hover).toHaveBeenCalledWith("/project", expectedDocument);
    expect(gateway.definition).toHaveBeenCalledWith("/project", expectedDocument);
    expect(gateway.codeActions).toHaveBeenCalledWith(
      "/project",
      "/project/src/App.vue",
      range(1, 0, 1, 7),
      {
        diagnostics: [],
        only: ["quickfix"],
        triggerKind: null,
      },
    );
  });

  it("does not request TypeScript completions from a rootless runtime status", async () => {
    const monaco = createMonaco();
    const gateway = featuresGateway({
      completion: {
        isIncomplete: false,
        items: [
          {
            detail: null,
            documentation: null,
            insertText: "useUser",
            kind: 3,
            label: "useUser",
          },
        ],
      },
    });
    const context = providerContext({
      featuresGateway: gateway,
      getRuntimeStatus: () => ({
        ...runningStatus(),
        rootPath: undefined,
      }),
    });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(monaco as any, context);
    const completionProvider = (
      monaco.languages.registerCompletionItemProvider as any
    ).mock.calls[3][1];

    const result = await completionProvider.provideCompletionItems(
      textModel(),
      { column: 4, lineNumber: 1 },
      {
        triggerCharacter: ".",
        triggerKind: 1,
      },
    );

    expect(result.suggestions).toEqual([]);
    expect(gateway.completion).not.toHaveBeenCalled();
  });

  it("drops in-flight TypeScript completions after switching project tabs", async () => {
    const monaco = createMonaco();
    let activeRoot = "/project";
    const completion =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["completion"]>>
      >();
    const gateway = featuresGateway();
    vi.mocked(gateway.completion).mockImplementationOnce(
      async () => completion.promise,
    );
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        applyWorkspaceEdit: vi.fn(async () => undefined),
        featuresGateway: gateway,
        getWorkspaceRoot: () => activeRoot,
      }),
    );
    const completionProvider = (
      monaco.languages.registerCompletionItemProvider as any
    ).mock.calls[0][1];
    const completionPromise = completionProvider.provideCompletionItems(
      textModel(),
      { column: 4, lineNumber: 2 },
    );

    await Promise.resolve();
    activeRoot = "/other";
    completion.resolve({
      isIncomplete: false,
      items: [
        {
          detail: "function",
          documentation: null,
          insertText: "loadUser",
          kind: 3,
          label: "loadUser",
        },
      ],
    });

    await expect(completionPromise).resolves.toEqual({ suggestions: [] });
    expect(gateway.completion).toHaveBeenCalledWith("/project", {
      character: 3,
      line: 1,
      path: "/project/src/user.ts",
    });
  });

  it("drops in-flight TypeScript completions when no project tab is active", async () => {
    const monaco = createMonaco();
    let activeRoot: string | null = "/project";
    const completion =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["completion"]>>
      >();
    const gateway = featuresGateway();
    vi.mocked(gateway.completion).mockImplementationOnce(
      async () => completion.promise,
    );
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: gateway,
        getWorkspaceRoot: () => activeRoot,
      }),
    );
    const completionProvider = (
      monaco.languages.registerCompletionItemProvider as any
    ).mock.calls[0][1];
    const completionPromise = completionProvider.provideCompletionItems(
      textModel(),
      { column: 4, lineNumber: 2 },
    );

    await Promise.resolve();
    activeRoot = null;
    completion.resolve({
      isIncomplete: false,
      items: [
        {
          detail: "function",
          documentation: null,
          insertText: "loadUser",
          kind: 3,
          label: "loadUser",
        },
      ],
    });

    await expect(completionPromise).resolves.toEqual({ suggestions: [] });
    expect(gateway.completion).toHaveBeenCalledWith("/project", {
      character: 3,
      line: 1,
      path: "/project/src/user.ts",
    });
  });

  it("drops stale TypeScript provider errors after switching project tabs", async () => {
    const monaco = createMonaco();
    let activeRoot = "/project";
    const completion =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["completion"]>>
      >();
    const reportError = vi.fn();
    const gateway = featuresGateway();
    vi.mocked(gateway.completion).mockImplementationOnce(
      async () => completion.promise,
    );
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: gateway,
        getWorkspaceRoot: () => activeRoot,
        reportError,
      }),
    );
    const completionProvider = (
      monaco.languages.registerCompletionItemProvider as any
    ).mock.calls[0][1];
    const completionPromise = completionProvider.provideCompletionItems(
      textModel(),
      { column: 4, lineNumber: 2 },
    );

    await Promise.resolve();
    activeRoot = "/other";
    completion.reject(new Error("stale completion"));

    await expect(completionPromise).resolves.toEqual({ suggestions: [] });
    expect(reportError).not.toHaveBeenCalled();
  });

  it("drops stale TypeScript provider errors after same-root session restart", async () => {
    const monaco = createMonaco();
    let activeSessionId = 1;
    const completion =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["completion"]>>
      >();
    const reportError = vi.fn();
    const gateway = featuresGateway();
    vi.mocked(gateway.completion).mockImplementationOnce(
      async () => completion.promise,
    );
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: gateway,
        getRuntimeStatus: () => ({
          ...runningStatus(),
          sessionId: activeSessionId,
        }),
        reportError,
      }),
    );
    const completionProvider = (
      monaco.languages.registerCompletionItemProvider as any
    ).mock.calls[0][1];
    const completionPromise = completionProvider.provideCompletionItems(
      textModel(),
      { column: 4, lineNumber: 2 },
    );

    await Promise.resolve();
    activeSessionId = 2;
    completion.reject(new Error("stale completion"));

    await expect(completionPromise).resolves.toEqual({ suggestions: [] });
    expect(reportError).not.toHaveBeenCalled();
  });

  it("drops successful TypeScript provider responses after same-root session restart", async () => {
    const position = { column: 4, lineNumber: 2 };

    {
      const monaco = createMonaco();
      let activeSessionId = 1;
      const hover =
        createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["hover"]>>>();
      const gateway = featuresGateway();
      vi.mocked(gateway.hover).mockImplementationOnce(async () => hover.promise);
      registerJavaScriptTypeScriptLanguageServerMonacoProviders(
        monaco as any,
        providerContext({
          featuresGateway: gateway,
          getRuntimeStatus: () => ({
            ...runningStatus(),
            sessionId: activeSessionId,
          }),
        }),
      );
      const hoverProvider = (monaco.languages.registerHoverProvider as any).mock
        .calls[0][1];
      const hoverPromise = hoverProvider.provideHover(textModel(), position);

      await Promise.resolve();
      activeSessionId = 2;
      hover.resolve({
        contents: "type User = { id: string }",
      });

      await expect(hoverPromise).resolves.toBeNull();
      expect(gateway.hover).toHaveBeenCalledWith("/project", {
        character: 3,
        line: 1,
        path: "/project/src/user.ts",
      });
    }

    {
      const monaco = createMonaco();
      let activeSessionId = 1;
      const references =
        createDeferred<
          Awaited<ReturnType<LanguageServerFeaturesGateway["references"]>>
        >();
      const gateway = featuresGateway();
      vi.mocked(gateway.references).mockImplementationOnce(
        async () => references.promise,
      );
      registerJavaScriptTypeScriptLanguageServerMonacoProviders(
        monaco as any,
        providerContext({
          featuresGateway: gateway,
          getRuntimeStatus: () => ({
            ...runningStatus(),
            sessionId: activeSessionId,
          }),
        }),
      );
      const referenceProvider = (
        monaco.languages.registerReferenceProvider as any
      ).mock.calls[0][1];
      const referencesPromise = referenceProvider.provideReferences(
        textModel(),
        position,
      );

      await Promise.resolve();
      activeSessionId = 2;
      references.resolve([
        {
          range: range(0, 6, 0, 20),
          uri: "file:///project/src/stale.ts",
        },
      ]);

      await expect(referencesPromise).resolves.toBeNull();
      expect(gateway.references).toHaveBeenCalledWith("/project", {
        character: 3,
        line: 1,
        path: "/project/src/user.ts",
      });
    }

    {
      const monaco = createMonaco();
      let activeSessionId = 1;
      const rename =
        createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["rename"]>>>();
      const gateway = featuresGateway();
      vi.mocked(gateway.rename).mockImplementationOnce(async () => rename.promise);
      registerJavaScriptTypeScriptLanguageServerMonacoProviders(
        monaco as any,
        providerContext({
          featuresGateway: gateway,
          getRuntimeStatus: () => ({
            ...runningStatus(),
            sessionId: activeSessionId,
          }),
        }),
      );
      const renameProvider = (monaco.languages.registerRenameProvider as any).mock
        .calls[0][1];
      const renamePromise = renameProvider.provideRenameEdits(
        textModel(),
        position,
        "account",
      );

      await Promise.resolve();
      activeSessionId = 2;
      rename.resolve(workspaceEdit("file:///project/src/stale.ts", "account"));

      await expect(renamePromise).resolves.toBeNull();
      expect(gateway.rename).toHaveBeenCalledWith(
        "/project",
        {
          character: 3,
          line: 1,
          path: "/project/src/user.ts",
        },
        "account",
      );
    }
  });

  it("does not request TypeScript completions after switching project tabs during document sync", async () => {
    const monaco = createMonaco();
    let activeRoot = "/project";
    const documentFlush = createDeferred<void>();
    const gateway = featuresGateway();
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: gateway,
        flushPendingDocumentChange: vi.fn(async () => documentFlush.promise),
        getWorkspaceRoot: () => activeRoot,
      }),
    );
    const completionProvider = (
      monaco.languages.registerCompletionItemProvider as any
    ).mock.calls[0][1];
    const completionPromise = completionProvider.provideCompletionItems(
      textModel(),
      { column: 4, lineNumber: 2 },
    );

    await Promise.resolve();
    activeRoot = "/other";
    documentFlush.resolve(undefined);

    await expect(completionPromise).resolves.toEqual({ suggestions: [] });
    expect(gateway.completion).not.toHaveBeenCalled();
  });

  it("drops TypeScript completion when the Monaco cancellation token is cancelled after the response", async () => {
    const monaco = createMonaco();
    const completion =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["completion"]>>
      >();
    const gateway = featuresGateway();
    vi.mocked(gateway.completion).mockImplementationOnce(
      async () => completion.promise,
    );
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ featuresGateway: gateway }),
    );
    const completionProvider = (
      monaco.languages.registerCompletionItemProvider as any
    ).mock.calls[0][1];
    const token = { isCancellationRequested: false };
    const completionPromise = completionProvider.provideCompletionItems(
      textModel(),
      { column: 4, lineNumber: 2 },
      undefined,
      token,
    );

    await Promise.resolve();
    token.isCancellationRequested = true;
    completion.resolve({
      isIncomplete: false,
      items: [
        {
          detail: "function",
          documentation: null,
          insertText: "loadUser",
          kind: 3,
          label: "loadUser",
        },
      ],
    });

    await expect(completionPromise).resolves.toEqual({ suggestions: [] });
  });

  it("resolves TypeScript completion to empty when the server does not respond before the timeout", async () => {
    vi.useFakeTimers();

    try {
      const monaco = createMonaco();
      const completion =
        createDeferred<
          Awaited<ReturnType<LanguageServerFeaturesGateway["completion"]>>
        >();
      const gateway = featuresGateway();
      vi.mocked(gateway.completion).mockImplementationOnce(
        async () => completion.promise,
      );
      registerJavaScriptTypeScriptLanguageServerMonacoProviders(
        monaco as any,
        providerContext({ featuresGateway: gateway }),
      );
      const completionProvider = (
        monaco.languages.registerCompletionItemProvider as any
      ).mock.calls[0][1];
      const completionPromise = completionProvider.provideCompletionItems(
        textModel(),
        { column: 4, lineNumber: 2 },
      );

      await vi.advanceTimersByTimeAsync(5000);

      await expect(completionPromise).resolves.toEqual({ suggestions: [] });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not use a TypeScript runtime status from another project tab", async () => {
    const monaco = createMonaco();
    const gateway = featuresGateway();
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: gateway,
        getRuntimeStatus: () => ({
          ...runningStatus(),
          rootPath: "/other",
        }),
      }),
    );
    const completionProvider = (
      monaco.languages.registerCompletionItemProvider as any
    ).mock.calls[0][1];

    await expect(
      completionProvider.provideCompletionItems(textModel(), {
        column: 4,
        lineNumber: 2,
      }),
    ).resolves.toEqual({ suggestions: [] });
    expect(gateway.completion).not.toHaveBeenCalled();
  });

  it("drops in-flight TypeScript hovers after switching project tabs", async () => {
    const monaco = createMonaco();
    let activeRoot = "/project";
    const hover =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["hover"]>>>();
    const gateway = featuresGateway();
    vi.mocked(gateway.hover).mockImplementationOnce(async () => hover.promise);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: gateway,
        getWorkspaceRoot: () => activeRoot,
      }),
    );
    const hoverProvider = (monaco.languages.registerHoverProvider as any).mock
      .calls[0][1];
    const hoverPromise = hoverProvider.provideHover(textModel(), {
      column: 4,
      lineNumber: 2,
    });

    await Promise.resolve();
    activeRoot = "/other";
    hover.resolve({
      contents: "type User = { id: string }",
    });

    await expect(hoverPromise).resolves.toBeNull();
    expect(gateway.hover).toHaveBeenCalledWith("/project", {
      character: 3,
      line: 1,
      path: "/project/src/user.ts",
    });
  });

  it("drops in-flight TypeScript definitions after switching project tabs", async () => {
    const monaco = createMonaco();
    let activeRoot = "/project";
    const definition =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["definition"]>>
      >();
    const gateway = featuresGateway();
    vi.mocked(gateway.definition).mockImplementationOnce(
      async () => definition.promise,
    );
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: gateway,
        getWorkspaceRoot: () => activeRoot,
      }),
    );
    const definitionProvider = (
      monaco.languages.registerDefinitionProvider as any
    ).mock.calls[0][1];
    const definitionPromise = definitionProvider.provideDefinition(
      textModel(),
      {
        column: 4,
        lineNumber: 2,
      },
    );

    await Promise.resolve();
    activeRoot = "/other";
    definition.resolve([
      {
        range: range(0, 6, 0, 20),
        uri: "file:///project/src/stale.ts",
      },
    ]);

    await expect(definitionPromise).resolves.toBeNull();
    expect(gateway.definition).toHaveBeenCalledWith("/project", {
      character: 3,
      line: 1,
      path: "/project/src/user.ts",
    });
  });

  it("drops TypeScript hover when the Monaco cancellation token is cancelled after the response", async () => {
    const monaco = createMonaco();
    const hover =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["hover"]>>>();
    const gateway = featuresGateway();
    vi.mocked(gateway.hover).mockImplementationOnce(async () => hover.promise);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ featuresGateway: gateway }),
    );
    const hoverProvider = (monaco.languages.registerHoverProvider as any).mock
      .calls[0][1];
    const token = { isCancellationRequested: false };
    const hoverPromise = hoverProvider.provideHover(
      textModel(),
      { column: 4, lineNumber: 2 },
      token,
    );

    await Promise.resolve();
    token.isCancellationRequested = true;
    hover.resolve({ contents: "type User = { id: string }" });

    await expect(hoverPromise).resolves.toBeNull();
  });

  it("resolves TypeScript hover to null when the server does not respond before the timeout", async () => {
    vi.useFakeTimers();

    try {
      const monaco = createMonaco();
      const hover =
        createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["hover"]>>>();
      const gateway = featuresGateway();
      vi.mocked(gateway.hover).mockImplementationOnce(async () => hover.promise);
      registerJavaScriptTypeScriptLanguageServerMonacoProviders(
        monaco as any,
        providerContext({ featuresGateway: gateway }),
      );
      const hoverProvider = (monaco.languages.registerHoverProvider as any).mock
        .calls[0][1];
      const token = { isCancellationRequested: false };
      const hoverPromise = hoverProvider.provideHover(
        textModel(),
        { column: 4, lineNumber: 2 },
        token,
      );

      await vi.advanceTimersByTimeAsync(5000);

      await expect(hoverPromise).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("resolves TypeScript hover to null within the shorter hover timeout budget", async () => {
    vi.useFakeTimers();

    try {
      const monaco = createMonaco();
      const hover =
        createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["hover"]>>>();
      const gateway = featuresGateway();
      vi.mocked(gateway.hover).mockImplementationOnce(async () => hover.promise);
      registerJavaScriptTypeScriptLanguageServerMonacoProviders(
        monaco as any,
        providerContext({ featuresGateway: gateway }),
      );
      const hoverProvider = (monaco.languages.registerHoverProvider as any).mock
        .calls[0][1];
      const token = { isCancellationRequested: false };
      const hoverPromise = hoverProvider.provideHover(
        textModel(),
        { column: 4, lineNumber: 2 },
        token,
      );

      await vi.advanceTimersByTimeAsync(700);

      await expect(hoverPromise).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the full navigation timeout budget for TypeScript definition (still pending at the hover timeout)", async () => {
    vi.useFakeTimers();

    try {
      const monaco = createMonaco();
      const definition =
        createDeferred<
          Awaited<ReturnType<LanguageServerFeaturesGateway["definition"]>>
        >();
      const gateway = featuresGateway();
      vi.mocked(gateway.definition).mockImplementationOnce(
        async () => definition.promise,
      );
      registerJavaScriptTypeScriptLanguageServerMonacoProviders(
        monaco as any,
        providerContext({ featuresGateway: gateway }),
      );
      const definitionProvider = (
        monaco.languages.registerDefinitionProvider as any
      ).mock.calls[0][1];
      const token = { isCancellationRequested: false };
      const definitionPromise = definitionProvider.provideDefinition(
        textModel(),
        { column: 4, lineNumber: 2 },
        token,
      );

      let settled = false;
      void definitionPromise.then(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(700);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(2500);
      await expect(definitionPromise).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns TypeScript hover when the server responds before the timeout and the token stays active", async () => {
    const monaco = createMonaco();
    const gateway = featuresGateway();
    vi.mocked(gateway.hover).mockResolvedValueOnce({
      contents: "type User = { id: string }",
    });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ featuresGateway: gateway }),
    );
    const hoverProvider = (monaco.languages.registerHoverProvider as any).mock
      .calls[0][1];
    const token = { isCancellationRequested: false };

    await expect(
      hoverProvider.provideHover(textModel(), { column: 4, lineNumber: 2 }, token),
    ).resolves.toEqual({
      contents: [{ value: "type User = { id: string }" }],
    });
  });

  it("resolves TypeScript definition to null when the server does not respond before the timeout", async () => {
    vi.useFakeTimers();

    try {
      const monaco = createMonaco();
      const definition =
        createDeferred<
          Awaited<ReturnType<LanguageServerFeaturesGateway["definition"]>>
        >();
      const gateway = featuresGateway();
      vi.mocked(gateway.definition).mockImplementationOnce(
        async () => definition.promise,
      );
      registerJavaScriptTypeScriptLanguageServerMonacoProviders(
        monaco as any,
        providerContext({ featuresGateway: gateway }),
      );
      const definitionProvider = (
        monaco.languages.registerDefinitionProvider as any
      ).mock.calls[0][1];
      const token = { isCancellationRequested: false };
      const definitionPromise = definitionProvider.provideDefinition(
        textModel(),
        { column: 4, lineNumber: 2 },
        token,
      );

      await vi.advanceTimersByTimeAsync(5000);

      await expect(definitionPromise).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops in-flight TypeScript code actions after switching project tabs", async () => {
    const monaco = createMonaco();
    let activeRoot = "/project";
    const codeActions =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["codeActions"]>>
      >();
    const gateway = featuresGateway();
    vi.mocked(gateway.codeActions).mockImplementationOnce(
      async () => codeActions.promise,
    );
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: gateway,
        getWorkspaceRoot: () => activeRoot,
      }),
    );
    const codeActionProvider = (
      monaco.languages.registerCodeActionProvider as any
    ).mock.calls[0][1];
    const actionsPromise = codeActionProvider.provideCodeActions(
      textModel(),
      new monaco.Range(1, 1, 1, 5),
      {
        markers: [],
        only: "quickfix",
      },
    );

    await Promise.resolve();
    activeRoot = "/other";
    codeActions.resolve([
      {
        command: null,
        data: null,
        edit: workspaceEdit("file:///project/src/user.ts", "Stale"),
        isPreferred: true,
        kind: "quickfix",
        title: "Update imports",
      },
    ]);

    await expect(actionsPromise).resolves.toEqual({
      actions: [],
      dispose: expect.any(Function),
    });
    expect(gateway.codeActions).toHaveBeenCalledWith(
      "/project",
      "/project/src/user.ts",
      range(0, 0, 0, 4),
      {
        diagnostics: [],
        only: ["quickfix"],
        triggerKind: null,
      },
    );
  });

  it("drops in-flight TypeScript code actions when no project tab is active", async () => {
    const monaco = createMonaco();
    let activeRoot: string | null = "/project";
    const codeActions =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["codeActions"]>>
      >();
    const gateway = featuresGateway();
    vi.mocked(gateway.codeActions).mockImplementationOnce(
      async () => codeActions.promise,
    );
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: gateway,
        getWorkspaceRoot: () => activeRoot,
      }),
    );
    const codeActionProvider = (
      monaco.languages.registerCodeActionProvider as any
    ).mock.calls[0][1];
    const actionsPromise = codeActionProvider.provideCodeActions(
      textModel(),
      new monaco.Range(1, 1, 1, 5),
      {
        markers: [],
        only: "quickfix",
      },
    );

    await Promise.resolve();
    activeRoot = null;
    codeActions.resolve([
      {
        command: null,
        data: null,
        edit: workspaceEdit("file:///project/src/user.ts", "Stale"),
        isPreferred: true,
        kind: "quickfix",
        title: "Update imports",
      },
    ]);

    await expect(actionsPromise).resolves.toEqual({
      actions: [],
      dispose: expect.any(Function),
    });
    expect(gateway.codeActions).toHaveBeenCalledWith(
      "/project",
      "/project/src/user.ts",
      range(0, 0, 0, 4),
      {
        diagnostics: [],
        only: ["quickfix"],
        triggerKind: null,
      },
    );
  });

  it("maps TypeScript document links and lazy resolution", async () => {
    const monaco = createMonaco();
    const gateway = featuresGateway({
      documentLinks: [
        {
          data: { file: "/project/src/user.ts" },
          range: range(0, 15, 0, 23),
          target: null,
          tooltip: "Open user module",
        },
      ],
      resolvedDocumentLink: {
        data: { file: "/project/src/user.ts" },
        range: range(0, 15, 0, 23),
        target: "file:///project/src/user.ts",
        tooltip: "Open user module",
      },
    });
    const context = providerContext({ featuresGateway: gateway });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(monaco as any, context);
    const model = textModel();

    const linkProvider = (monaco.languages.registerLinkProvider as any).mock
      .calls[0][1];
    const links = await linkProvider.provideLinks(model);

    expect(gateway.documentLinks).toHaveBeenCalledWith(
      "/project",
      "/project/src/user.ts",
    );
    expect(links.links[0]).toEqual(
      expect.objectContaining({
        range: expect.objectContaining({
          endColumn: 24,
          endLineNumber: 1,
          startColumn: 16,
          startLineNumber: 1,
        }),
        tooltip: "Open user module",
      }),
    );
    expect(links.links[0].url).toBeUndefined();

    const resolved = await linkProvider.resolveLink(links.links[0]);

    expect(gateway.resolveDocumentLink).toHaveBeenCalledWith(
      "/project",
      expect.objectContaining({
        data: { file: "/project/src/user.ts" },
        target: null,
      }),
    );
    expect(resolved).toEqual(
      expect.objectContaining({
        tooltip: "Open user module",
        url: "file:///project/src/user.ts",
      }),
    );
  });

  it("drops in-flight TypeScript document links after switching project tabs", async () => {
    const monaco = createMonaco();
    let activeRoot = "/project";
    const documentLinks =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["documentLinks"]>>
      >();
    const gateway = featuresGateway();
    vi.mocked(gateway.documentLinks).mockImplementationOnce(
      async () => documentLinks.promise,
    );
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: gateway,
        getWorkspaceRoot: () => activeRoot,
      }),
    );
    const linkProvider = (monaco.languages.registerLinkProvider as any).mock
      .calls[0][1];
    const linksPromise = linkProvider.provideLinks(textModel());

    await Promise.resolve();
    activeRoot = "/other";
    documentLinks.resolve([
      {
        data: { file: "/project/src/user.ts" },
        range: range(0, 15, 0, 23),
        target: "file:///project/src/user.ts",
        tooltip: "Open user module",
      },
    ]);

    await expect(linksPromise).resolves.toEqual({
      dispose: expect.any(Function),
      links: [],
    });
    expect(gateway.documentLinks).toHaveBeenCalledWith(
      "/project",
      "/project/src/user.ts",
    );
  });

  it("drops in-flight TypeScript document links when no project tab is active", async () => {
    const monaco = createMonaco();
    let activeRoot: string | null = "/project";
    const documentLinks =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["documentLinks"]>>
      >();
    const gateway = featuresGateway();
    vi.mocked(gateway.documentLinks).mockImplementationOnce(
      async () => documentLinks.promise,
    );
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: gateway,
        getWorkspaceRoot: () => activeRoot,
      }),
    );
    const linkProvider = (monaco.languages.registerLinkProvider as any).mock
      .calls[0][1];
    const linksPromise = linkProvider.provideLinks(textModel());

    await Promise.resolve();
    activeRoot = null;
    documentLinks.resolve([
      {
        data: { file: "/project/src/user.ts" },
        range: range(0, 15, 0, 23),
        target: "file:///project/src/user.ts",
        tooltip: "Open user module",
      },
    ]);

    await expect(linksPromise).resolves.toEqual({
      dispose: expect.any(Function),
      links: [],
    });
    expect(gateway.documentLinks).toHaveBeenCalledWith(
      "/project",
      "/project/src/user.ts",
    );
  });

  it("maps nested TypeScript document symbols through the language server", async () => {
    const monaco = createMonaco();
    const gateway = featuresGateway({
      documentSymbols: [
        {
          children: [
            {
              children: [],
              containerName: "UserController",
              detail: "reset(): void",
              kind: 6,
              name: "reset",
              range: range(5, 2, 7, 3),
              selectionRange: range(5, 8, 5, 13),
            },
            {
              children: [],
              containerName: "UserController",
              detail: "loadUser(): User",
              kind: 6,
              name: "loadUser",
              range: range(2, 2, 4, 3),
              selectionRange: range(2, 8, 2, 16),
              tags: [1],
            },
          ],
          containerName: null,
          detail: "class UserController",
          kind: 5,
          name: "UserController",
          range: range(0, 0, 8, 1),
          selectionRange: range(0, 6, 0, 20),
          tags: [1, 99],
        },
      ],
    });
    const context = providerContext({ featuresGateway: gateway });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(monaco as any, context);

    const symbolProvider = (
      monaco.languages.registerDocumentSymbolProvider as any
    ).mock.calls[0][1];
    const symbols = await symbolProvider.provideDocumentSymbols(textModel());

    expect(gateway.documentSymbols).toHaveBeenCalledWith(
      "/project",
      "/project/src/user.ts",
    );
    expect(symbols).toEqual([
      expect.objectContaining({
        children: [
          expect.objectContaining({
            children: [],
            containerName: "UserController",
            detail: "reset(): void",
            kind: monaco.languages.SymbolKind.Method,
            name: "reset",
            range: expect.objectContaining({
              endColumn: 4,
              endLineNumber: 8,
              startColumn: 3,
              startLineNumber: 6,
            }),
            selectionRange: expect.objectContaining({
              endColumn: 14,
              endLineNumber: 6,
              startColumn: 9,
              startLineNumber: 6,
            }),
            tags: [],
          }),
          expect.objectContaining({
            children: [],
            containerName: "UserController",
            detail: "loadUser(): User",
            kind: monaco.languages.SymbolKind.Method,
            name: "loadUser",
            range: expect.objectContaining({
              endColumn: 4,
              endLineNumber: 5,
              startColumn: 3,
              startLineNumber: 3,
            }),
            selectionRange: expect.objectContaining({
              endColumn: 17,
              endLineNumber: 3,
              startColumn: 9,
              startLineNumber: 3,
            }),
            tags: [monaco.languages.SymbolTag.Deprecated],
          }),
        ],
        detail: "class UserController",
        kind: monaco.languages.SymbolKind.Class,
        name: "UserController",
        range: expect.objectContaining({
          endColumn: 2,
          endLineNumber: 9,
          startColumn: 1,
          startLineNumber: 1,
        }),
        selectionRange: expect.objectContaining({
          endColumn: 21,
          endLineNumber: 1,
          startColumn: 7,
          startLineNumber: 1,
        }),
        tags: [monaco.languages.SymbolTag.Deprecated],
      }),
    ]);
    expect(context.flushPendingDocumentChange).toHaveBeenCalledWith(
      "/project/src/user.ts",
    );
  });

  it("maps TypeScript workspace symbols through the active project root", async () => {
    const monaco = createMonaco();
    const gateway = featuresGateway({
      workspaceSymbols: [
        {
          containerName: "src/user.ts",
          kind: 5,
          location: {
            range: range(0, 6, 0, 20),
            uri: "file:///project/src/user.ts",
          },
          name: "UserController",
        },
        {
          containerName: "src/other.ts",
          kind: 12,
          location: {
            range: range(2, 0, 2, 8),
            uri: "file:///other/src/other.ts",
          },
          name: "loadOther",
        },
        {
          containerName: "src/neighbor.ts",
          kind: 12,
          location: {
            range: range(4, 0, 4, 12),
            uri: "file:///project-neighbor/src/neighbor.ts",
          },
          name: "loadNeighbor",
        },
        {
          containerName: null,
          kind: 13,
          location: null,
          name: "unresolved",
        },
      ],
    });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ featuresGateway: gateway }),
    );

    const symbolProvider = (
      monaco.languages.registerWorkspaceSymbolProvider as any
    ).mock.calls[0][0];
    const symbols = await symbolProvider.provideWorkspaceSymbols("User");

    expect(gateway.workspaceSymbols).toHaveBeenCalledWith("/project", "User");
    expect(symbols).toEqual([
      {
        containerName: "src/user.ts",
        kind: monaco.languages.SymbolKind.Class,
        location: {
          range: expect.objectContaining({
            endColumn: 21,
            endLineNumber: 1,
            startColumn: 7,
            startLineNumber: 1,
          }),
          uri: { fsPath: "/project/src/user.ts", path: "/project/src/user.ts" },
        },
        name: "UserController",
      },
    ]);
  });

  it("drops in-flight TypeScript workspace symbols after switching project tabs", async () => {
    const monaco = createMonaco();
    let activeRoot = "/project";
    const workspaceSymbols =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["workspaceSymbols"]>>
      >();
    const gateway = featuresGateway();
    vi.mocked(gateway.workspaceSymbols).mockImplementationOnce(
      async () => workspaceSymbols.promise,
    );
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: gateway,
        getWorkspaceRoot: () => activeRoot,
      }),
    );
    const symbolProvider = (
      monaco.languages.registerWorkspaceSymbolProvider as any
    ).mock.calls[0][0];
    const symbolsPromise = symbolProvider.provideWorkspaceSymbols("User");

    await Promise.resolve();
    activeRoot = "/other";
    workspaceSymbols.resolve([
      {
        containerName: "src/user.ts",
        kind: 5,
        location: {
          range: range(0, 6, 0, 20),
          uri: "file:///project/src/user.ts",
        },
        name: "UserController",
      },
    ]);

    await expect(symbolsPromise).resolves.toEqual([]);
    expect(gateway.workspaceSymbols).toHaveBeenCalledWith("/project", "User");
  });

  it("drops in-flight TypeScript workspace symbols when no project tab is active", async () => {
    const monaco = createMonaco();
    let activeRoot: string | null = "/project";
    const workspaceSymbols =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["workspaceSymbols"]>>
      >();
    const gateway = featuresGateway();
    vi.mocked(gateway.workspaceSymbols).mockImplementationOnce(
      async () => workspaceSymbols.promise,
    );
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: gateway,
        getWorkspaceRoot: () => activeRoot,
      }),
    );
    const symbolProvider = (
      monaco.languages.registerWorkspaceSymbolProvider as any
    ).mock.calls[0][0];
    const symbolsPromise = symbolProvider.provideWorkspaceSymbols("User");

    await Promise.resolve();
    activeRoot = null;
    workspaceSymbols.resolve([
      {
        containerName: "src/user.ts",
        kind: 5,
        location: {
          range: range(0, 6, 0, 20),
          uri: "file:///project/src/user.ts",
        },
        name: "UserController",
      },
    ]);

    await expect(symbolsPromise).resolves.toEqual([]);
    expect(gateway.workspaceSymbols).toHaveBeenCalledWith("/project", "User");
  });

  it("maps TypeScript type definitions through the language server including external targets", async () => {
    const monaco = createMonaco();
    const gateway = featuresGateway({
      typeDefinition: [
        {
          range: range(4, 2, 4, 10),
          uri: "file:///project/src/types.ts",
        },
        {
          range: range(1, 0, 1, 5),
          uri: "file:///other/src/types.ts",
        },
      ],
    });
    const context = providerContext({ featuresGateway: gateway });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(monaco as any, context);
    const model = textModel();
    const position = { column: 4, lineNumber: 2 };

    const provider = (monaco.languages.registerTypeDefinitionProvider as any).mock
      .calls[0][1];
    const locations = await provider.provideTypeDefinition(model, position);

    expect(gateway.typeDefinition).toHaveBeenCalledWith("/project", {
      character: 3,
      line: 1,
      path: "/project/src/user.ts",
    });
    expect(locations).toEqual([
      {
        range: expect.objectContaining({
          endColumn: 11,
          endLineNumber: 5,
          startColumn: 3,
          startLineNumber: 5,
        }),
        uri: { fsPath: "/project/src/types.ts", path: "/project/src/types.ts" },
      },
      {
        range: expect.objectContaining({
          endColumn: 6,
          endLineNumber: 2,
          startColumn: 1,
          startLineNumber: 2,
        }),
        uri: { fsPath: "/other/src/types.ts", path: "/other/src/types.ts" },
      },
    ]);
  });

  it("maps TypeScript definitions, declarations and implementations to external read-only targets", async () => {
    const monaco = createMonaco();
    const gateway = featuresGateway({
      declaration: [
        {
          range: range(6, 4, 6, 13),
          uri: "file:///project/node_modules/pkg/types.d.ts",
        },
        {
          range: range(20, 0, 20, 6),
          uri: "file:///Library/Developer/TypeScript/lib/lib.es2022.d.ts",
        },
      ],
      definition: [
        {
          range: range(12, 8, 12, 15),
          uri: "file:///project/node_modules/@types/react/index.d.ts",
        },
        {
          range: range(40, 1, 40, 7),
          uri: "file:///Applications/Codevo Editor.app/Contents/Resources/typescript/lib/lib.dom.d.ts",
        },
      ],
      implementation: [
        {
          range: range(2, 0, 8, 1),
          uri: "file:///project/node_modules/pkg/dist/component.d.ts",
        },
        {
          range: range(4, 2, 9, 3),
          uri: "file:///tmp/js-ts-cache/pkg/component.ts",
        },
      ],
    });
    const context = providerContext({ featuresGateway: gateway });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(monaco as any, context);
    const model = textModel();
    const position = { column: 4, lineNumber: 2 };

    const definitionProvider = (
      monaco.languages.registerDefinitionProvider as any
    ).mock.calls[0][1];
    const definitions = await definitionProvider.provideDefinition(model, position);

    expect(gateway.definition).toHaveBeenCalledWith("/project", {
      character: 3,
      line: 1,
      path: "/project/src/user.ts",
    });
    expect(definitions).toEqual([
      {
        range: expect.objectContaining({
          endColumn: 16,
          endLineNumber: 13,
          startColumn: 9,
          startLineNumber: 13,
        }),
        uri: {
          fsPath: "/project/node_modules/@types/react/index.d.ts",
          path: "/project/node_modules/@types/react/index.d.ts",
        },
      },
      {
        range: expect.objectContaining({
          endColumn: 8,
          endLineNumber: 41,
          startColumn: 2,
          startLineNumber: 41,
        }),
        uri: {
          fsPath:
            "/Applications/Codevo Editor.app/Contents/Resources/typescript/lib/lib.dom.d.ts",
          path: "/Applications/Codevo Editor.app/Contents/Resources/typescript/lib/lib.dom.d.ts",
        },
      },
    ]);

    const declarationProvider = (
      monaco.languages.registerDeclarationProvider as any
    ).mock.calls[0][1];
    const declarations = await declarationProvider.provideDeclaration(
      model,
      position,
    );

    expect(gateway.declaration).toHaveBeenCalledWith("/project", {
      character: 3,
      line: 1,
      path: "/project/src/user.ts",
    });
    expect(declarations).toEqual([
      {
        range: expect.objectContaining({
          endColumn: 14,
          endLineNumber: 7,
          startColumn: 5,
          startLineNumber: 7,
        }),
        uri: {
          fsPath: "/project/node_modules/pkg/types.d.ts",
          path: "/project/node_modules/pkg/types.d.ts",
        },
      },
      {
        range: expect.objectContaining({
          endColumn: 7,
          endLineNumber: 21,
          startColumn: 1,
          startLineNumber: 21,
        }),
        uri: {
          fsPath: "/Library/Developer/TypeScript/lib/lib.es2022.d.ts",
          path: "/Library/Developer/TypeScript/lib/lib.es2022.d.ts",
        },
      },
    ]);

    const implementationProvider = (
      monaco.languages.registerImplementationProvider as any
    ).mock.calls[0][1];
    const implementations = await implementationProvider.provideImplementation(
      model,
      position,
    );

    expect(gateway.implementation).toHaveBeenCalledWith("/project", {
      character: 3,
      line: 1,
      path: "/project/src/user.ts",
    });
    expect(implementations).toEqual([
      {
        range: expect.objectContaining({
          endColumn: 2,
          endLineNumber: 9,
          startColumn: 1,
          startLineNumber: 3,
        }),
        uri: {
          fsPath: "/project/node_modules/pkg/dist/component.d.ts",
          path: "/project/node_modules/pkg/dist/component.d.ts",
        },
      },
      {
        range: expect.objectContaining({
          endColumn: 4,
          endLineNumber: 10,
          startColumn: 3,
          startLineNumber: 5,
        }),
        uri: {
          fsPath: "/tmp/js-ts-cache/pkg/component.ts",
          path: "/tmp/js-ts-cache/pkg/component.ts",
        },
      },
    ]);
  });

  it("limits JavaScript and TypeScript navigation locations to open Monaco models when requested", async () => {
    const monaco = createMonaco();
    const gateway = featuresGateway({
      implementation: [
        {
          range: range(2, 0, 8, 1),
          uri: "file:///project/src/serviceImplementation.ts",
        },
      ],
    });
    const context = providerContext({
      featuresGateway: gateway,
      limitNavigationResultsToOpenModels: true,
    });
    monaco.editor.getModel.mockReturnValue(null);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(monaco as any, context);

    const implementationProvider = (
      monaco.languages.registerImplementationProvider as any
    ).mock.calls[0][1];

    await expect(
      implementationProvider.provideImplementation(textModel(), {
        column: 4,
        lineNumber: 2,
      }),
    ).resolves.toEqual([]);
    expect(monaco.editor.getModel).toHaveBeenCalledWith({
      fsPath: "/project/src/serviceImplementation.ts",
      path: "/project/src/serviceImplementation.ts",
    });
  });

  it("maps TypeScript linked editing ranges for paired JSX tags", async () => {
    const monaco = createMonaco();
    const gateway = featuresGateway({
      linkedEditingRanges: {
        ranges: [range(1, 1, 1, 4), range(1, 8, 1, 11)],
        wordPattern: "[A-Za-z][A-Za-z0-9]*",
      },
    });
    const context = providerContext({ featuresGateway: gateway });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(monaco as any, context);
    const model = textModel();
    const position = { column: 3, lineNumber: 2 };

    const provider = (
      monaco.languages.registerLinkedEditingRangeProvider as any
    ).mock.calls[0][1];
    const linkedRanges = await provider.provideLinkedEditingRanges(model, position);

    expect(gateway.linkedEditingRanges).toHaveBeenCalledWith("/project", {
      character: 2,
      line: 1,
      path: "/project/src/user.ts",
    });
    expect(linkedRanges).toEqual({
      ranges: [
        expect.objectContaining({
          endColumn: 5,
          endLineNumber: 2,
          startColumn: 2,
          startLineNumber: 2,
        }),
        expect.objectContaining({
          endColumn: 12,
          endLineNumber: 2,
          startColumn: 9,
          startLineNumber: 2,
        }),
      ],
      wordPattern: /[A-Za-z][A-Za-z0-9]*/,
    });
  });

  it("maps TypeScript CodeLens references through Monaco commands", async () => {
    const monaco = createMonaco();
    const lens = {
      command: null,
      data: { kind: "references" },
      range: range(2, 1, 2, 12),
    };
    const gateway = featuresGateway({
      codeLenses: [lens],
      resolvedCodeLens: {
        ...lens,
        command: {
          arguments: [
            "file:///project/src/user.ts",
            { character: 2, line: 2 },
            [
              {
                range: range(4, 3, 4, 8),
                uri: "file:///project/src/user.ts",
              },
              {
                range: range(9, 1, 9, 4),
                uri: "file:///other/src/user.ts",
              },
            ],
          ],
          command: "editor.action.showReferences",
          title: "1 reference",
        },
      },
    });
    const context = providerContext({ featuresGateway: gateway });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(monaco as any, context);
    const model = textModel();

    const provider = (monaco.languages.registerCodeLensProvider as any).mock
      .calls[0][1];
    const provided = await provider.provideCodeLenses(model);

    expect(gateway.codeLenses).toHaveBeenCalledWith(
      "/project",
      "/project/src/user.ts",
    );
    expect(provided.lenses).toHaveLength(1);
    expect(provided.lenses[0]).toEqual(
      expect.objectContaining({
        range: expect.objectContaining({
          endColumn: 13,
          endLineNumber: 3,
          startColumn: 2,
          startLineNumber: 3,
        }),
      }),
    );

    const resolved = await provider.resolveCodeLens(model, provided.lenses[0]);

    expect(gateway.resolveCodeLens).toHaveBeenCalledWith(
      "/project",
      expect.objectContaining({
        data: { kind: "references" },
      }),
    );
    expect(resolved.command).toEqual({
      arguments: [
        { fsPath: "/project/src/user.ts", path: "/project/src/user.ts" },
        { column: 3, lineNumber: 3 },
        [
          {
            range: expect.objectContaining({
              endColumn: 9,
              endLineNumber: 5,
              startColumn: 4,
              startLineNumber: 5,
            }),
            uri: { fsPath: "/project/src/user.ts", path: "/project/src/user.ts" },
          },
        ],
      ],
      id: "editor.action.showReferences",
      title: "1 reference",
    });
  });

  it("maps TypeScript folding ranges through the language server", async () => {
    const monaco = createMonaco();
    const gateway = featuresGateway({
      foldingRanges: [
        {
          endCharacter: null,
          endLine: 8,
          kind: "region",
          startCharacter: null,
          startLine: 2,
        },
      ],
    });
    const context = providerContext({ featuresGateway: gateway });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(monaco as any, context);
    const model = textModel();

    const foldingProvider = (
      monaco.languages.registerFoldingRangeProvider as any
    ).mock.calls[0][1];
    const ranges = await foldingProvider.provideFoldingRanges(model);

    expect(gateway.foldingRanges).toHaveBeenCalledWith(
      "/project",
      "/project/src/user.ts",
    );
    expect(monaco.languages.FoldingRangeKind.fromValue).toHaveBeenCalledWith(
      "region",
    );
    expect(ranges).toEqual([
      {
        end: 9,
        kind: { value: "region" },
        start: 3,
      },
    ]);
  });

  it("maps TypeScript document highlights and smart selection ranges", async () => {
    const monaco = createMonaco();
    const gateway = featuresGateway({
      documentHighlights: [
        {
          kind: 2,
          range: range(0, 6, 0, 10),
        },
        {
          kind: 3,
          range: range(2, 2, 2, 6),
        },
      ],
      selectionRanges: [
        {
          parent: {
            parent: null,
            range: range(3, 2, 5, 3),
          },
          range: range(3, 8, 3, 20),
        },
      ],
    });
    const context = providerContext({ featuresGateway: gateway });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(monaco as any, context);
    const model = textModel();

    const highlightProvider = (
      monaco.languages.registerDocumentHighlightProvider as any
    ).mock.calls[0][1];
    const highlights = await highlightProvider.provideDocumentHighlights(
      model,
      {
        column: 9,
        lineNumber: 4,
      },
      { isCancellationRequested: false },
    );

    expect(gateway.documentHighlights).toHaveBeenCalledWith("/project", {
      character: 8,
      line: 3,
      path: "/project/src/user.ts",
    });
    expect(highlights).toEqual([
      {
        kind: monaco.languages.DocumentHighlightKind.Read,
        range: expect.objectContaining({
          endColumn: 11,
          endLineNumber: 1,
          startColumn: 7,
          startLineNumber: 1,
        }),
      },
      {
        kind: monaco.languages.DocumentHighlightKind.Write,
        range: expect.objectContaining({
          endColumn: 7,
          endLineNumber: 3,
          startColumn: 3,
          startLineNumber: 3,
        }),
      },
    ]);

    const selectionRangeProvider = (
      monaco.languages.registerSelectionRangeProvider as any
    ).mock.calls[0][1];
    const selectionRanges = await selectionRangeProvider.provideSelectionRanges(
      model,
      [{ column: 12, lineNumber: 4 }],
    );

    expect(gateway.selectionRanges).toHaveBeenCalledWith(
      "/project",
      "/project/src/user.ts",
      [{ character: 11, line: 3 }],
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
    ]);
  });

  it("drops superseded TypeScript document highlights when the Monaco cancellation token is cancelled", async () => {
    const monaco = createMonaco();
    const highlights =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["documentHighlights"]>>
      >();
    const gateway = featuresGateway();
    vi.mocked(gateway.documentHighlights).mockImplementationOnce(
      async () => highlights.promise,
    );
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ featuresGateway: gateway }),
    );
    const highlightProvider = (
      monaco.languages.registerDocumentHighlightProvider as any
    ).mock.calls[0][1];

    const token = { isCancellationRequested: false };
    const promise = highlightProvider.provideDocumentHighlights(
      textModel(),
      { column: 9, lineNumber: 4 },
      token,
    );

    await Promise.resolve();
    token.isCancellationRequested = true;
    highlights.resolve([
      {
        kind: 2,
        range: range(0, 6, 0, 10),
      },
    ]);

    await expect(promise).resolves.toBeNull();
  });

  it("applies TypeScript document highlights when the Monaco cancellation token stays active", async () => {
    const monaco = createMonaco();
    const gateway = featuresGateway({
      documentHighlights: [
        {
          kind: 2,
          range: range(0, 6, 0, 10),
        },
      ],
    });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ featuresGateway: gateway }),
    );
    const highlightProvider = (
      monaco.languages.registerDocumentHighlightProvider as any
    ).mock.calls[0][1];

    const token = { isCancellationRequested: false };
    const highlights = await highlightProvider.provideDocumentHighlights(
      textModel(),
      { column: 9, lineNumber: 4 },
      token,
    );

    expect(highlights).toEqual([
      {
        kind: monaco.languages.DocumentHighlightKind.Read,
        range: expect.objectContaining({
          endColumn: 11,
          endLineNumber: 1,
          startColumn: 7,
          startLineNumber: 1,
        }),
      },
    ]);
    expect(gateway.documentHighlights).toHaveBeenCalledTimes(1);
  });

  it("skips repeated TypeScript document highlight requests for the same word under the cursor", async () => {
    const monaco = createMonaco();
    const gateway = featuresGateway({
      documentHighlights: [
        {
          kind: 2,
          range: range(0, 6, 0, 10),
        },
      ],
    });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ featuresGateway: gateway }),
    );
    const highlightProvider = (
      monaco.languages.registerDocumentHighlightProvider as any
    ).mock.calls[0][1];

    const wordModel = (word: string) => ({
      ...textModel(),
      getWordAtPosition: vi.fn(() => ({
        endColumn: 5,
        startColumn: 1,
        word,
      })),
    });
    const token = { isCancellationRequested: false };
    const userModel = wordModel("user");

    const first = await highlightProvider.provideDocumentHighlights(
      userModel,
      { column: 3, lineNumber: 1 },
      token,
    );
    const second = await highlightProvider.provideDocumentHighlights(
      userModel,
      { column: 3, lineNumber: 1 },
      token,
    );

    expect(gateway.documentHighlights).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);

    await highlightProvider.provideDocumentHighlights(
      wordModel("account"),
      { column: 3, lineNumber: 1 },
      token,
    );

    expect(gateway.documentHighlights).toHaveBeenCalledTimes(2);
  });

  it("drops in-flight TypeScript selection ranges after switching project tabs", async () => {
    const monaco = createMonaco();
    let activeRoot = "/project";
    const selectionRanges =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["selectionRanges"]>>
      >();
    const gateway = featuresGateway();
    vi.mocked(gateway.selectionRanges).mockImplementationOnce(
      async () => selectionRanges.promise,
    );
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: gateway,
        getWorkspaceRoot: () => activeRoot,
      }),
    );
    const selectionRangeProvider = (
      monaco.languages.registerSelectionRangeProvider as any
    ).mock.calls[0][1];
    const selectionRangesPromise = selectionRangeProvider.provideSelectionRanges(
      textModel(),
      [{ column: 12, lineNumber: 4 }],
    );

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
      "/project/src/user.ts",
      [{ character: 11, line: 3 }],
    );
  });

  it("drops in-flight TypeScript selection ranges when no project tab is active", async () => {
    const monaco = createMonaco();
    let activeRoot: string | null = "/project";
    const selectionRanges =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["selectionRanges"]>>
      >();
    const gateway = featuresGateway();
    vi.mocked(gateway.selectionRanges).mockImplementationOnce(
      async () => selectionRanges.promise,
    );
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: gateway,
        getWorkspaceRoot: () => activeRoot,
      }),
    );
    const selectionRangeProvider = (
      monaco.languages.registerSelectionRangeProvider as any
    ).mock.calls[0][1];
    const selectionRangesPromise = selectionRangeProvider.provideSelectionRanges(
      textModel(),
      [{ column: 12, lineNumber: 4 }],
    );

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
      "/project/src/user.ts",
      [{ character: 11, line: 3 }],
    );
  });

  it("uses the runtime semantic token legend and maps tokens through the language server", async () => {
    const monaco = createMonaco();
    const customLegend = {
      tokenModifiers: ["static", "async"],
      tokenTypes: ["decorator", "enumMember"],
    };
    const gateway = featuresGateway({
      semanticTokens: {
        data: [0, 6, 4, 8, 0, 1, 2, 3, 9, 1],
        resultId: "semantic-1",
      },
    });
    const context = providerContext({
      featuresGateway: gateway,
      getRuntimeStatus: () =>
        runningStatus({ semanticTokensLegend: customLegend }),
    });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(monaco as any, context);
    const model = textModel();

    const semanticTokensProvider = (
      monaco.languages.registerDocumentSemanticTokensProvider as any
    ).mock.calls[0][1];
    const tokens = await semanticTokensProvider.provideDocumentSemanticTokens(
      model,
      null,
    );

    expect(semanticTokensProvider.getLegend()).toEqual(customLegend);
    expect(gateway.semanticTokens).toHaveBeenCalledWith(
      "/project",
      "/project/src/user.ts",
    );
    expect(tokens).toEqual({
      data: Uint32Array.from([0, 6, 4, 8, 0, 1, 2, 3, 9, 1]),
      resultId: "semantic-1",
    });
    expect(context.flushPendingDocumentChange).toHaveBeenCalledWith(
      "/project/src/user.ts",
    );
  });

  it("maps range semantic tokens through the language server", async () => {
    const monaco = createMonaco();
    const customLegend = {
      tokenModifiers: ["static", "async"],
      tokenTypes: ["decorator", "enumMember"],
    };
    const gateway = featuresGateway({
      rangeSemanticTokens: {
        data: [0, 2, 4, 8, 0, 1, 4, 3, 9, 1],
        resultId: "range-semantic-1",
      },
    });
    const context = providerContext({
      featuresGateway: gateway,
      getRuntimeStatus: () =>
        runningStatus({ semanticTokensLegend: customLegend }),
    });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(monaco as any, context);
    const model = textModel();

    const rangeSemanticTokensProvider = (
      monaco.languages.registerDocumentRangeSemanticTokensProvider as any
    ).mock.calls[0][1];
    const tokens =
      await rangeSemanticTokensProvider.provideDocumentRangeSemanticTokens(
        model,
        new monaco.Range(2, 3, 4, 12),
        null,
      );

    expect(rangeSemanticTokensProvider.getLegend()).toEqual(customLegend);
    expect(gateway.rangeSemanticTokens).toHaveBeenCalledWith(
      "/project",
      "/project/src/user.ts",
      {
        end: { character: 11, line: 3 },
        start: { character: 2, line: 1 },
      },
    );
    expect(tokens).toEqual({
      data: Uint32Array.from([0, 2, 4, 8, 0, 1, 4, 3, 9, 1]),
      resultId: "range-semantic-1",
    });
    expect(context.flushPendingDocumentChange).toHaveBeenCalledWith(
      "/project/src/user.ts",
    );
  });

  it("drops stale range semantic tokens after the workspace changes", async () => {
    const monaco = createMonaco();
    const gateway = featuresGateway();
    const rangeSemanticTokens = createDeferred<
      Awaited<ReturnType<LanguageServerFeaturesGateway["rangeSemanticTokens"]>>
    >();
    let activeRoot = "/project";
    vi.mocked(gateway.rangeSemanticTokens).mockImplementationOnce(
      async () => rangeSemanticTokens.promise,
    );
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: gateway,
        getWorkspaceRoot: () => activeRoot,
      }),
    );
    const rangeSemanticTokensProvider = (
      monaco.languages.registerDocumentRangeSemanticTokensProvider as any
    ).mock.calls[0][1];
    const tokensPromise =
      rangeSemanticTokensProvider.provideDocumentRangeSemanticTokens(
        textModel(),
        new monaco.Range(2, 3, 4, 12),
        null,
      );

    await Promise.resolve();
    activeRoot = "/other";
    rangeSemanticTokens.resolve({
      data: [0, 2, 4, 8, 0],
      resultId: "range-semantic-1",
    });

    await expect(tokensPromise).resolves.toBeNull();
    expect(gateway.rangeSemanticTokens).toHaveBeenCalledWith(
      "/project",
      "/project/src/user.ts",
      {
        end: { character: 11, line: 3 },
        start: { character: 2, line: 1 },
      },
    );
  });

  it("falls back to the default semantic token legend without a runtime legend", () => {
    const monaco = createMonaco();
    const context = providerContext();
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(monaco as any, context);

    const semanticTokensProvider = (
      monaco.languages.registerDocumentSemanticTokensProvider as any
    ).mock.calls[0][1];

    expect(semanticTokensProvider.getLegend()).toEqual({
      tokenModifiers: [
        "declaration",
        "definition",
        "readonly",
        "static",
        "deprecated",
        "abstract",
        "async",
        "modification",
        "documentation",
        "defaultLibrary",
      ],
      tokenTypes: [
        "namespace",
        "type",
        "class",
        "enum",
        "interface",
        "struct",
        "typeParameter",
        "parameter",
        "variable",
        "property",
        "enumMember",
        "event",
        "function",
        "method",
        "macro",
        "keyword",
        "modifier",
        "comment",
        "string",
        "number",
        "regexp",
        "operator",
      ],
    });
  });

  it("maps references, rename edits, code actions, commands and formatting through the gateway", async () => {
    const monaco = createMonaco();
    const commandOnlyAction = {
      command: {
        arguments: [{ tsActionId: "unusedIdentifier" }],
        command: "_typescript.applyFixAllCodeAction",
        title: "Fix all unused identifiers",
      },
      data: { globalId: 1, providerId: 2 },
      edit: null,
      isPreferred: false,
      kind: "quickfix",
      title: "Fix all unused identifiers",
    };
    const disabledRefactorAction = {
      command: null,
      data: null,
      disabled: {
        reason: "Cannot extract from this selection.",
      },
      edit: null,
      isPreferred: false,
      kind: "refactor.extract",
      title: "Extract function",
    };
    const gateway = featuresGateway({
      codeActions: [
        {
          edit: workspaceEdit("file:///project/src/user.ts", "Account"),
          command: null,
          data: null,
          isPreferred: true,
          kind: "quickfix",
          title: "Rename symbol",
        },
        commandOnlyAction,
        disabledRefactorAction,
      ],
      executeCommandEdit: workspaceEdit("file:///project/src/user.ts", "CommandEdit"),
      formatting: [
        {
          newText: "  ",
          range: range(2, 0, 2, 4),
        },
      ],
      rangeFormatting: [
        {
          newText: "    ",
          range: range(3, 0, 3, 2),
        },
      ],
      onTypeFormatting: [
        {
          newText: "\n  ",
          range: range(4, 0, 4, 0),
        },
      ],
      inlayHints: [
        {
          data: { hintId: 1 },
          kind: 1,
          label: ": Account",
          paddingLeft: true,
          paddingRight: false,
          position: {
            character: 10,
            line: 0,
          },
          textEdits: [
            {
              newText: ": Account",
              range: range(0, 10, 0, 10),
            },
          ],
          tooltip: "Inferred type",
        },
        {
          kind: 2,
          label: [
            {
              command: {
                arguments: [{ file: "/project/src/user.ts" }],
                command: "_typescript.applyCompletionCodeAction",
                title: "Apply import",
              },
              label: "user",
              location: {
                range: range(2, 4, 2, 8),
                uri: "file:///project/src/user.ts",
              },
              tooltip: "User symbol",
            },
            {
              label: ":",
            },
          ],
          paddingLeft: false,
          paddingRight: true,
          position: {
            character: 5,
            line: 1,
          },
          tooltip: null,
        },
      ],
      resolvedInlayHint: {
        data: { hintId: 1 },
        kind: 1,
        label: ": Account",
        paddingLeft: true,
        paddingRight: false,
        position: {
          character: 10,
          line: 0,
        },
        textEdits: [
          {
            newText: ": Account",
            range: range(0, 10, 0, 10),
          },
        ],
        tooltip: "Resolved inferred type",
      },
      prepareRename: {
        defaultBehavior: false,
        placeholder: "user",
        range: range(0, 1, 0, 5),
      },
      signatureHelp: {
        activeParameter: 1,
        activeSignature: 0,
        signatures: [
          {
            documentation: "Loads a user.",
            label: "loadUser(id: string, options?: Options): Promise<User>",
            parameters: [
              {
                documentation: "User id",
                label: "id: string",
              },
              {
                documentation: null,
                label: "options?: Options",
              },
            ],
          },
        ],
      },
      references: [
        {
          range: range(0, 1, 0, 5),
          uri: "file:///project/src/user.ts",
        },
        {
          range: range(0, 1, 0, 5),
          uri: "file:///other/src/user.ts",
        },
      ],
      rename: workspaceEdit("file:///project/src/user.ts", "Account"),
      resolvedCodeAction: {
        ...commandOnlyAction,
        edit: workspaceEdit("file:///project/src/user.ts", "Resolved"),
      },
    });
    const context = providerContext({ featuresGateway: gateway });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(monaco as any, context);
    const model = textModel();
    monaco.editor.getModels.mockReturnValue([model]);
    const position = { column: 4, lineNumber: 1 };

    const referencesProvider = (
      monaco.languages.registerReferenceProvider as any
    ).mock.calls[0][1];
    const references = await referencesProvider.provideReferences(model, position);

    expect(gateway.references).toHaveBeenCalledWith("/project", {
      character: 3,
      line: 0,
      path: "/project/src/user.ts",
    });
    expect(references).toEqual([
      {
        range: expect.objectContaining({
          endColumn: 6,
          endLineNumber: 1,
          startColumn: 2,
          startLineNumber: 1,
        }),
        uri: { fsPath: "/project/src/user.ts", path: "/project/src/user.ts" },
      },
    ]);

    const renameProvider = (monaco.languages.registerRenameProvider as any).mock
      .calls[0][1];
    const renameLocation = await renameProvider.resolveRenameLocation(
      model,
      position,
    );

    expect(gateway.prepareRename).toHaveBeenCalledWith("/project", {
      character: 3,
      line: 0,
      path: "/project/src/user.ts",
    });
    expect(renameLocation).toEqual({
      range: expect.objectContaining({
        endColumn: 6,
        endLineNumber: 1,
        startColumn: 2,
        startLineNumber: 1,
      }),
      text: "user",
    });

    const rename = await renameProvider.provideRenameEdits(
      model,
      position,
      "Account",
    );

    expect(gateway.rename).toHaveBeenCalledWith(
      "/project",
      {
        character: 3,
        line: 0,
        path: "/project/src/user.ts",
      },
      "Account",
    );
    expect(rename.edits).toEqual([
      {
        resource: { fsPath: "/project/src/user.ts", path: "/project/src/user.ts" },
        textEdit: {
          range: expect.objectContaining({
            endColumn: 6,
            endLineNumber: 1,
            startColumn: 2,
            startLineNumber: 1,
          }),
          text: "Account",
        },
        versionId: 7,
      },
    ]);

    const codeActionProvider = (
      monaco.languages.registerCodeActionProvider as any
    ).mock.calls[0][1];
    const actionList = await codeActionProvider.provideCodeActions(
      model,
      new monaco.Range(1, 1, 1, 5),
      {
        markers: [
          {
            code: "2304",
            data: { fixId: "fixMissingImport" },
            endColumn: 5,
            endLineNumber: 1,
            message: "Cannot find name",
            severity: monaco.MarkerSeverity.Error,
            source: "typescript",
            startColumn: 1,
            startLineNumber: 1,
          },
        ],
        only: "quickfix",
        trigger: monaco.languages.CodeActionTriggerType.Invoke,
      },
    );

    expect(gateway.codeActions).toHaveBeenCalledWith(
      "/project",
      "/project/src/user.ts",
      range(0, 0, 0, 4),
      {
        diagnostics: [
          {
            code: "2304",
            data: { fixId: "fixMissingImport" },
            message: "Cannot find name",
            range: range(0, 0, 0, 4),
            severity: 1,
            source: "typescript",
          },
        ],
        only: ["quickfix"],
        triggerKind: 1,
      },
    );
    expect(actionList.actions).toEqual([
      expect.objectContaining({
        isPreferred: true,
        kind: "quickfix",
        title: "Rename symbol",
      }),
      expect.objectContaining({
        command: expect.objectContaining({
          arguments: [
            expect.objectContaining({
              command: commandOnlyAction.command,
              rootPath: "/project",
            }),
          ],
          id: "mockor.javascriptTypeScript.executeLanguageServerCommand",
        }),
        kind: "quickfix",
        title: "Fix all unused identifiers",
      }),
      expect.objectContaining({
        disabled: "Cannot extract from this selection.",
        kind: "refactor.extract",
        title: "Extract function",
      }),
    ]);

    const unresolvedAction = actionList.actions[1];
    const resolvedAction = await codeActionProvider.resolveCodeAction(
      unresolvedAction,
    );

    expect(gateway.resolveCodeAction).toHaveBeenCalledWith(
      "/project",
      commandOnlyAction,
    );
    expect(resolvedAction.edit.edits[0].textEdit.text).toBe("Resolved");

    const commandDescriptor = (monaco.editor.addCommand as any).mock.calls[0][0];
    await commandDescriptor.run(null, unresolvedAction.command.arguments[0]);

    expect(gateway.executeCommand).toHaveBeenCalledWith(
      "/project",
      commandOnlyAction.command,
    );
    expect(model.pushEditOperations).toHaveBeenCalledWith(
      [],
      [
        {
          range: expect.objectContaining({
            endColumn: 6,
            endLineNumber: 1,
            startColumn: 2,
            startLineNumber: 1,
          }),
          text: "CommandEdit",
        },
      ],
      expect.any(Function),
    );

    const formattingProvider = (
      monaco.languages.registerDocumentFormattingEditProvider as any
    ).mock.calls[0][1];
    const formatting = await formattingProvider.provideDocumentFormattingEdits(
      model,
      {
        insertSpaces: true,
        tabSize: 2,
      },
    );

    expect(gateway.formatting).toHaveBeenCalledWith(
      "/project",
      "/project/src/user.ts",
      {
        insertSpaces: true,
        tabSize: 2,
      },
    );
    expect(formatting).toEqual([
      {
        range: expect.objectContaining({
          endColumn: 5,
          endLineNumber: 3,
          startColumn: 1,
          startLineNumber: 3,
        }),
        text: "  ",
      },
    ]);

    const rangeFormattingProvider = (
      monaco.languages.registerDocumentRangeFormattingEditProvider as any
    ).mock.calls[0][1];
    const rangeFormatting =
      await rangeFormattingProvider.provideDocumentRangeFormattingEdits(
        model,
        new monaco.Range(4, 1, 4, 10),
        {
          insertSpaces: true,
          tabSize: 4,
        },
      );

    expect(gateway.rangeFormatting).toHaveBeenCalledWith(
      "/project",
      "/project/src/user.ts",
      range(3, 0, 3, 9),
      {
        insertSpaces: true,
        tabSize: 4,
      },
    );
    expect(rangeFormatting).toEqual([
      {
        range: expect.objectContaining({
          endColumn: 3,
          endLineNumber: 4,
          startColumn: 1,
          startLineNumber: 4,
        }),
        text: "    ",
      },
    ]);

    const onTypeFormattingProvider = (
      monaco.languages.registerOnTypeFormattingEditProvider as any
    ).mock.calls[0][1];
    expect(onTypeFormattingProvider.autoFormatTriggerCharacters).toEqual([
      "}",
      ";",
      "\n",
    ]);
    const onTypeFormatting =
      await onTypeFormattingProvider.provideOnTypeFormattingEdits(
        model,
        { column: 1, lineNumber: 5 },
        "\n",
        {
          insertSpaces: true,
          tabSize: 2,
        },
      );

    expect(gateway.onTypeFormatting).toHaveBeenCalledWith(
      "/project",
      "/project/src/user.ts",
      {
        character: 0,
        line: 4,
      },
      "\n",
      {
        insertSpaces: true,
        tabSize: 2,
      },
    );
    expect(onTypeFormatting).toEqual([
      {
        range: expect.objectContaining({
          endColumn: 1,
          endLineNumber: 5,
          startColumn: 1,
          startLineNumber: 5,
        }),
        text: "\n  ",
      },
    ]);

    const inlayHintsProvider = (monaco.languages.registerInlayHintsProvider as any)
      .mock.calls[0][1];
    const hints = await inlayHintsProvider.provideInlayHints(
      model,
      new monaco.Range(1, 1, 1, 20),
    );

    expect(gateway.inlayHints).toHaveBeenCalledWith(
      "/project",
      "/project/src/user.ts",
      range(0, 0, 0, 19),
    );
    expect(hints).toEqual({
      dispose: expect.any(Function),
      hints: [
        {
          kind: monaco.languages.InlayHintKind.Type,
          label: ": Account",
          paddingLeft: true,
          paddingRight: false,
          position: {
            column: 11,
            lineNumber: 1,
          },
          textEdits: [
            {
              range: expect.objectContaining({
                endColumn: 11,
                endLineNumber: 1,
                startColumn: 11,
                startLineNumber: 1,
              }),
              text: ": Account",
            },
          ],
          tooltip: "Inferred type",
        },
        {
          kind: monaco.languages.InlayHintKind.Parameter,
          label: [
            {
              command: {
                arguments: [
                  expect.objectContaining({
                    command: {
                      arguments: [{ file: "/project/src/user.ts" }],
                      command: "_typescript.applyCompletionCodeAction",
                      title: "Apply import",
                    },
                    rootPath: "/project",
                  }),
                ],
                id: "mockor.javascriptTypeScript.executeLanguageServerCommand",
                title: "Apply import",
              },
              label: "user",
              location: {
                range: expect.objectContaining({
                  endColumn: 9,
                  endLineNumber: 3,
                  startColumn: 5,
                  startLineNumber: 3,
                }),
                uri: {
                  fsPath: "/project/src/user.ts",
                  path: "/project/src/user.ts",
                },
              },
              tooltip: "User symbol",
            },
            {
              label: ":",
            },
          ],
          paddingLeft: false,
          paddingRight: true,
          position: {
            column: 6,
            lineNumber: 2,
          },
          tooltip: undefined,
        },
      ],
    });
    const resolvedHint = await inlayHintsProvider.resolveInlayHint(hints.hints[0]);

    expect(gateway.resolveInlayHint).toHaveBeenCalledWith(
      "/project",
      expect.objectContaining({
        data: { hintId: 1 },
        label: ": Account",
      }),
    );
    expect(resolvedHint).toEqual(
      expect.objectContaining({
        label: ": Account",
        textEdits: [
          expect.objectContaining({
            range: expect.objectContaining({
              endColumn: 11,
              endLineNumber: 1,
              startColumn: 11,
              startLineNumber: 1,
            }),
            text: ": Account",
          }),
        ],
        tooltip: "Resolved inferred type",
      }),
    );

    const signatureProvider = (monaco.languages.registerSignatureHelpProvider as any)
      .mock.calls[0][1];
    const signatureHelp = await signatureProvider.provideSignatureHelp(
      model,
      position,
    );

    expect(gateway.signatureHelp).toHaveBeenCalledWith("/project", {
      character: 3,
      line: 0,
      path: "/project/src/user.ts",
    });
    expect(signatureHelp).toEqual({
      dispose: expect.any(Function),
      value: {
        activeParameter: 1,
        activeSignature: 0,
        signatures: [
          {
            documentation: "Loads a user.",
            label: "loadUser(id: string, options?: Options): Promise<User>",
            parameters: [
              {
                documentation: "User id",
                label: "id: string",
              },
              {
                documentation: undefined,
                label: "options?: Options",
              },
            ],
          },
        ],
      },
    });
    expect(context.flushPendingDocumentChange).toHaveBeenCalledWith(
      "/project/src/user.ts",
    );
  });

  it("passes TypeScript signature help trigger context to the language server", async () => {
    const monaco = createMonaco();
    const gateway = featuresGateway({
      signatureHelp: {
        activeParameter: 1,
        activeSignature: 0,
        signatures: [
          {
            documentation: "Loads a user.",
            label: "loadUser(id: string, options?: Options): Promise<User>",
            parameters: [
              {
                documentation: "User id",
                label: "id: string",
              },
              {
                documentation: null,
                label: "options?: Options",
              },
            ],
          },
        ],
      },
    });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ featuresGateway: gateway }),
    );
    const signatureProvider = (monaco.languages.registerSignatureHelpProvider as any)
      .mock.calls[0][1];

    await signatureProvider.provideSignatureHelp(
      textModel(),
      { column: 5, lineNumber: 1 },
      {},
      {
        activeSignatureHelp: {
          activeParameter: 0,
          activeSignature: 0,
          signatures: [
            {
              documentation: { value: "Previous overload." },
              label: "loadUser(id: string, options?: Options): Promise<User>",
              parameters: [
                {
                  documentation: "User id",
                  label: [9, 19],
                },
                {
                  documentation: undefined,
                  label: "options?: Options",
                },
              ],
            },
          ],
        },
        isRetrigger: true,
        triggerCharacter: ",",
        triggerKind: 2,
      },
    );

    expect(gateway.signatureHelp).toHaveBeenCalledWith(
      "/project",
      {
        character: 4,
        line: 0,
        path: "/project/src/user.ts",
      },
      {
        activeSignatureHelp: {
          activeParameter: 0,
          activeSignature: 0,
          signatures: [
            {
              documentation: "Previous overload.",
              label: "loadUser(id: string, options?: Options): Promise<User>",
              parameters: [
                {
                  documentation: "User id",
                  label: "id: string",
                },
                {
                  documentation: null,
                  label: "options?: Options",
                },
              ],
            },
          ],
        },
        isRetrigger: true,
        triggerCharacter: ",",
        triggerKind: 2,
      },
    );
  });

  it("drops TypeScript signature help when the Monaco cancellation token is cancelled after the response", async () => {
    const monaco = createMonaco();
    const signatureHelp =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["signatureHelp"]>>
      >();
    const gateway = featuresGateway();
    vi.mocked(gateway.signatureHelp).mockImplementationOnce(
      async () => signatureHelp.promise,
    );
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ featuresGateway: gateway }),
    );
    const signatureProvider = (
      monaco.languages.registerSignatureHelpProvider as any
    ).mock.calls[0][1];
    const token = { isCancellationRequested: false };
    const signatureHelpPromise = signatureProvider.provideSignatureHelp(
      textModel(),
      { column: 5, lineNumber: 1 },
      token,
    );

    await Promise.resolve();
    token.isCancellationRequested = true;
    signatureHelp.resolve({
      activeParameter: 1,
      activeSignature: 0,
      signatures: [
        {
          documentation: "Loads a user.",
          label: "loadUser(id: string, options?: Options): Promise<User>",
          parameters: [
            {
              documentation: "User id",
              label: "id: string",
            },
          ],
        },
      ],
    });

    await expect(signatureHelpPromise).resolves.toBeNull();
  });

  it("resolves TypeScript signature help to null when the server does not respond before the timeout", async () => {
    vi.useFakeTimers();

    try {
      const monaco = createMonaco();
      const signatureHelp =
        createDeferred<
          Awaited<ReturnType<LanguageServerFeaturesGateway["signatureHelp"]>>
        >();
      const gateway = featuresGateway();
      vi.mocked(gateway.signatureHelp).mockImplementationOnce(
        async () => signatureHelp.promise,
      );
      registerJavaScriptTypeScriptLanguageServerMonacoProviders(
        monaco as any,
        providerContext({ featuresGateway: gateway }),
      );
      const signatureProvider = (
        monaco.languages.registerSignatureHelpProvider as any
      ).mock.calls[0][1];
      const signatureHelpPromise = signatureProvider.provideSignatureHelp(
        textModel(),
        { column: 5, lineNumber: 1 },
        { isCancellationRequested: false },
      );

      await vi.advanceTimersByTimeAsync(5000);

      await expect(signatureHelpPromise).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves VS Code-like TypeScript completion metadata", async () => {
    const monaco = createMonaco();
    const gateway = featuresGateway({
      completion: {
        isIncomplete: true,
        items: [
          {
            additionalTextEdits: [
              {
                newText: "import { loadUser } from './users';\n",
                range: range(0, 0, 0, 0),
              },
            ],
            commitCharacters: ["."],
            deprecated: true,
            detail: "function loadUser(id: string): Promise<User>",
            documentation: "Loads a user.",
            filterText: "loadUser",
            insertText: "loadUser(${1:id})",
            insertTextFormat: 2,
            kind: 3,
            label: "loadUser",
            labelDetails: {
              description: "Promise<User>",
              detail: "(id: string)",
            },
            preselect: true,
            sortText: "11",
            textEdit: {
              insert: range(1, 2, 1, 5),
              newText: "loadUser(${1:id})",
              replace: range(1, 2, 1, 8),
            },
          },
        ],
      },
    });
    const context = providerContext({ featuresGateway: gateway });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(monaco as any, context);
    const model = textModel();
    const position = { column: 4, lineNumber: 2 };
    const completionProvider = (
      monaco.languages.registerCompletionItemProvider as any
    ).mock.calls[0][1];

    const result = await completionProvider.provideCompletionItems(
      model,
      position,
    );

    expect(gateway.completion).toHaveBeenCalledWith("/project", {
      character: 3,
      line: 1,
      path: "/project/src/user.ts",
    });
    expect(result.suggestions[0]).toEqual(
      expect.objectContaining({
        additionalTextEdits: [
          {
            range: expect.objectContaining({
              endColumn: 1,
              endLineNumber: 1,
              startColumn: 1,
              startLineNumber: 1,
            }),
            text: "import { loadUser } from './users';\n",
          },
        ],
        commitCharacters: ["."],
        detail: "function loadUser(id: string): Promise<User>",
        documentation: "Loads a user.",
        filterText: "loadUser",
        insertText: "loadUser(${1:id})",
        insertTextRules: 4,
        kind: 3,
        label: {
          description: "Promise<User>",
          detail: "(id: string)",
          label: "loadUser",
        },
        preselect: true,
        range: {
          insert: expect.objectContaining({
            endColumn: 6,
            endLineNumber: 2,
            startColumn: 3,
            startLineNumber: 2,
          }),
          replace: expect.objectContaining({
            endColumn: 9,
            endLineNumber: 2,
            startColumn: 3,
            startLineNumber: 2,
          }),
        },
        sortText: "11",
        tags: [monaco.languages.CompletionItemTag.Deprecated],
      }),
    );
    expect(result.incomplete).toBe(true);
  });

  it("keeps same-named TypeScript auto-import completion alternatives from different modules", async () => {
    const monaco = createMonaco();
    const gateway = featuresGateway({
      completion: {
        isIncomplete: false,
        items: [
          {
            detail: "exported from @app/ui",
            documentation: null,
            insertText: "Button",
            kind: 7,
            label: "Button",
            labelDetails: {
              description: "@app/ui",
              detail: "",
            },
            sortText: "11",
          },
          {
            detail: "exported from @app/design-system",
            documentation: null,
            insertText: "Button",
            kind: 7,
            label: "Button",
            labelDetails: {
              description: "@app/design-system",
              detail: "",
            },
            sortText: "12",
          },
          {
            detail: "exported from @app/design-system",
            documentation: null,
            insertText: "Button",
            kind: 7,
            label: "Button",
            labelDetails: {
              description: "@app/design-system",
              detail: "",
            },
            sortText: "12",
          },
        ],
      },
    });
    const context = providerContext({ featuresGateway: gateway });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(monaco as any, context);
    const completionProvider = (
      monaco.languages.registerCompletionItemProvider as any
    ).mock.calls[0][1];

    const result = await completionProvider.provideCompletionItems(
      textModel(),
      { column: 4, lineNumber: 1 },
    );

    expect(result.suggestions).toHaveLength(2);
    expect(
      result.suggestions.map(
        (suggestion: { label: unknown }) => suggestion.label,
      ),
    ).toEqual([
      {
        description: "@app/ui",
        detail: undefined,
        label: "Button",
      },
      {
        description: "@app/design-system",
        detail: undefined,
        label: "Button",
      },
    ]);
  });

  it("preserves plain TypeScript completion text edit ranges", async () => {
    const monaco = createMonaco();
    const gateway = featuresGateway({
      completion: {
        isIncomplete: false,
        items: [
          {
            detail: "function loadUser(id: string): Promise<User>",
            documentation: "Loads a user.",
            insertText: "loadUser(${1:id})",
            insertTextFormat: 2,
            kind: 3,
            label: "loadUser",
            textEdit: {
              newText: "loadUser(${1:id})",
              range: range(1, 2, 1, 5),
            },
          },
        ],
      },
    });
    const context = providerContext({ featuresGateway: gateway });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(monaco as any, context);
    const model = textModel();
    const position = { column: 4, lineNumber: 2 };
    const completionProvider = (
      monaco.languages.registerCompletionItemProvider as any
    ).mock.calls[0][1];

    const result = await completionProvider.provideCompletionItems(
      model,
      position,
    );

    expect(gateway.completion).toHaveBeenCalledWith("/project", {
      character: 3,
      line: 1,
      path: "/project/src/user.ts",
    });
    expect(result.suggestions[0]).toEqual(
      expect.objectContaining({
        detail: "function loadUser(id: string): Promise<User>",
        documentation: "Loads a user.",
        insertText: "loadUser(${1:id})",
        insertTextRules: 4,
        kind: 3,
        label: "loadUser",
        range: expect.objectContaining({
          endColumn: 6,
          endLineNumber: 2,
          startColumn: 3,
          startLineNumber: 2,
        }),
      }),
    );
    expect(result.incomplete).toBeUndefined();
  });

  it("maps TypeScript completion markup documentation and insert text mode", async () => {
    const monaco = createMonaco();
    const gateway = featuresGateway({
      completion: {
        isIncomplete: false,
        items: [
          {
            detail: "const",
            documentation: "**Loads** a user.",
            documentationKind: "markdown",
            insertText: "loadUser",
            insertTextMode: 1,
            kind: 6,
            label: "loadUser",
          },
          {
            detail: "const",
            documentation: "Plain docs.",
            documentationKind: "plaintext",
            insertText: "plainUser",
            kind: 6,
            label: "plainUser",
          },
        ],
      },
    });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ featuresGateway: gateway }),
    );
    const completionProvider = (
      monaco.languages.registerCompletionItemProvider as any
    ).mock.calls[0][1];

    const result = await completionProvider.provideCompletionItems(
      textModel(),
      { column: 4, lineNumber: 1 },
    );

    expect(result.suggestions[0]).toEqual(
      expect.objectContaining({
        documentation: { value: "**Loads** a user." },
        insertText: "loadUser",
        insertTextRules:
          monaco.languages.CompletionItemInsertTextRule.KeepWhitespace,
      }),
    );
    expect(result.suggestions[1]).toEqual(
      expect.objectContaining({
        documentation: "Plain docs.",
        insertText: "plainUser",
      }),
    );
    expect(result.suggestions[1]).not.toHaveProperty("insertTextRules");
  });

  it("preserves explicit TypeScript method insert text as plain text", async () => {
    const monaco = createMonaco();
    const gateway = featuresGateway({
      completion: {
        isIncomplete: false,
        items: [
          {
            detail: "method UserAccount.refresh(): Promise<void>",
            documentation: null,
            insertText: "refresh",
            kind: 2,
            label: "refresh",
          },
          {
            detail: "property UserAccount.status: string",
            documentation: null,
            insertText: "status",
            kind: 10,
            label: "status",
          },
        ],
      },
    });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ featuresGateway: gateway }),
    );
    const completionProvider = (
      monaco.languages.registerCompletionItemProvider as any
    ).mock.calls[0][1];

    const result = await completionProvider.provideCompletionItems(
      textModel(),
      { column: 4, lineNumber: 1 },
    );

    expect(result.suggestions[0]).toEqual(
      expect.objectContaining({
        insertText: "refresh",
        kind: monaco.languages.CompletionItemKind.Method,
        label: "refresh",
      }),
    );
    expect(result.suggestions[0]).not.toHaveProperty("insertTextRules");
    expect(result.suggestions[1]).toEqual(
      expect.objectContaining({
        insertText: "status",
        kind: monaco.languages.CompletionItemKind.Property,
        label: "status",
      }),
    );
    expect(result.suggestions[1]).not.toHaveProperty("insertTextRules");
  });

  it("preserves explicit generic TypeScript function insert text as plain text", async () => {
    const monaco = createMonaco();
    const gateway = featuresGateway({
      completion: {
        isIncomplete: false,
        items: [
          {
            detail: "function mapValues<T>(values: T[]): T[]",
            documentation: null,
            insertText: "mapValues",
            kind: 3,
            label: "mapValues",
          },
          {
            detail: "method QueryBuilder.clone<T>(): QueryBuilder<T>",
            documentation: null,
            insertText: "clone",
            kind: 2,
            label: "clone",
          },
        ],
      },
    });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ featuresGateway: gateway }),
    );
    const completionProvider = (
      monaco.languages.registerCompletionItemProvider as any
    ).mock.calls[0][1];

    const result = await completionProvider.provideCompletionItems(
      textModel(),
      { column: 4, lineNumber: 1 },
    );

    expect(result.suggestions[0]).toEqual(
      expect.objectContaining({
        insertText: "mapValues",
        label: "mapValues",
      }),
    );
    expect(result.suggestions[0]).not.toHaveProperty("command");
    expect(result.suggestions[0]).not.toHaveProperty("insertTextRules");
    expect(result.suggestions[1]).toEqual(
      expect.objectContaining({
        insertText: "clone",
        label: "clone",
      }),
    );
    expect(result.suggestions[1]).not.toHaveProperty("command");
    expect(result.suggestions[1]).not.toHaveProperty("insertTextRules");
  });

  it("keeps TypeScript function completions as plain labels by default", async () => {
    const monaco = createMonaco();
    const gateway = featuresGateway({
      completion: {
        isIncomplete: false,
        items: [
          {
            detail: null,
            documentation: null,
            insertText: null,
            kind: 2,
            label: "setUser",
            labelDetails: {
              description: "void",
              detail: "(user: User)",
            },
          },
        ],
      },
    });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ featuresGateway: gateway }),
    );
    const completionProvider = (
      monaco.languages.registerCompletionItemProvider as any
    ).mock.calls[0][1];

    const result = await completionProvider.provideCompletionItems(
      textModel(),
      { column: 4, lineNumber: 1 },
    );

    expect(result.suggestions[0]).toEqual(
      expect.objectContaining({
        insertText: "setUser",
        label: {
          description: "void",
          detail: "(user: User)",
          label: "setUser",
        },
      }),
    );
    expect(result.suggestions[0]).not.toHaveProperty("command");
    expect(result.suggestions[0]).not.toHaveProperty("insertTextRules");
  });

  it("detects required method parameters from TypeScript label details when complete-function-call completions are enabled", async () => {
    const monaco = createMonaco();
    const gateway = featuresGateway({
      completion: {
        isIncomplete: false,
        items: [
          {
            detail: null,
            documentation: null,
            insertText: null,
            kind: 2,
            label: "setUser",
            labelDetails: {
              description: "void",
              detail: "(user: User)",
            },
          },
        ],
      },
    });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ completeFunctionCalls: true, featuresGateway: gateway }),
    );
    const completionProvider = (
      monaco.languages.registerCompletionItemProvider as any
    ).mock.calls[0][1];

    const result = await completionProvider.provideCompletionItems(
      textModel(),
      { column: 4, lineNumber: 1 },
    );

    expect(result.suggestions[0]).toEqual(
      expect.objectContaining({
        command: {
          id: "editor.action.triggerParameterHints",
          title: "Trigger parameter hints",
        },
        insertText: "setUser($0)",
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        label: {
          description: "void",
          detail: "(user: User)",
          label: "setUser",
        },
      }),
    );
  });

  it("offers JS/TS live-template snippets after language-server suggestions", async () => {
    const monaco = createMonaco();
    const gateway = featuresGateway({
      completion: {
        isIncomplete: false,
        items: [
          {
            detail: null,
            documentation: null,
            insertText: "clamp",
            kind: 3,
            label: "clamp",
          },
        ],
      },
    });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ featuresGateway: gateway }),
    );
    const completionProvider = (
      monaco.languages.registerCompletionItemProvider as any
    ).mock.calls[0][1];

    const result = await completionProvider.provideCompletionItems(
      snippetWordModel("clg"),
      { column: 4, lineNumber: 1 },
    );

    const clg = result.suggestions.find((item: any) => item.label === "clg");

    expect(clg).toEqual(
      expect.objectContaining({
        insertTextRules:
          monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        kind: monaco.languages.CompletionItemKind.Snippet,
        label: "clg",
      }),
    );
    expect(clg.sortText.startsWith("2_")).toBe(true);
    expect(clg.insertText).toContain("$");
  });

  it("offers a user-defined JS/TS snippet from the context", async () => {
    const monaco = createMonaco();
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: featuresGateway({
          completion: { isIncomplete: false, items: [] },
        }),
        getUserSnippets: () => [
          {
            prefix: "mylog",
            body: "myLogger($0);",
            description: "Log via my logger",
            languages: ["typescript"],
          },
        ],
      }),
    );
    const completionProvider = (
      monaco.languages.registerCompletionItemProvider as any
    ).mock.calls[0][1];

    const result = await completionProvider.provideCompletionItems(
      snippetWordModel("myl"),
      { column: 4, lineNumber: 1 },
    );

    const snippet = result.suggestions.find(
      (item: any) => item.label === "mylog",
    );

    expect(snippet).toBeDefined();
    expect(snippet.insertText).toBe("myLogger($0);");
    expect(snippet.insertTextRules).toBe(
      monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    );
  });

  it("does not offer PHP snippets inside a TypeScript document", async () => {
    const monaco = createMonaco();
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext(),
    );
    const completionProvider = (
      monaco.languages.registerCompletionItemProvider as any
    ).mock.calls[0][1];

    const result = await completionProvider.provideCompletionItems(
      snippetWordModel("ncl"),
      { column: 4, lineNumber: 1 },
    );

    expect(
      result.suggestions.map((item: any) => item.label),
    ).not.toContain("nclass");
  });

  it("suppresses snippets after a member-access dot", async () => {
    const monaco = createMonaco();
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext(),
    );
    const completionProvider = (
      monaco.languages.registerCompletionItemProvider as any
    ).mock.calls[0][1];

    const result = await completionProvider.provideCompletionItems(
      snippetWordModel("clg", {
        endColumn: 8,
        lineContent: "foo.clg",
        startColumn: 5,
      }),
      { column: 8, lineNumber: 1 },
    );

    expect(
      result.suggestions.some((item: any) => item.label === "clg"),
    ).toBe(false);
  });

  it("does not offer snippets without a typed prefix", async () => {
    const monaco = createMonaco();
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext(),
    );
    const completionProvider = (
      monaco.languages.registerCompletionItemProvider as any
    ).mock.calls[0][1];

    const result = await completionProvider.provideCompletionItems(
      snippetWordModel("", { startColumn: 4, endColumn: 4 }),
      { column: 4, lineNumber: 1 },
    );

    expect(
      result.suggestions.some(
        (item: any) =>
          item.kind === monaco.languages.CompletionItemKind.Snippet,
      ),
    ).toBe(false);
  });

  it("maps TypeScript completion commands through the guarded language server executor", async () => {
    const monaco = createMonaco();
    const completionCommand = {
      arguments: [{ source: "completion" }],
      command: "_typescript.applyCompletionCodeAction",
      title: "Apply completion code action",
    };
    const gateway = featuresGateway({
      completion: {
        isIncomplete: false,
        items: [
          {
            command: completionCommand,
            detail: "function",
            documentation: null,
            insertText: "loadUser",
            kind: 3,
            label: "loadUser",
          },
        ],
      },
    });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ featuresGateway: gateway }),
    );
    const completionProvider = (
      monaco.languages.registerCompletionItemProvider as any
    ).mock.calls[0][1];

    const result = await completionProvider.provideCompletionItems(
      textModel(),
      { column: 4, lineNumber: 1 },
    );

    expect(result.suggestions[0].command).toEqual({
      arguments: [
        {
          command: completionCommand,
          path: "/project/src/user.ts",
          rootPath: "/project",
          sessionId: 1,
        },
      ],
      id: "mockor.javascriptTypeScript.executeLanguageServerCommand",
      title: "Apply completion code action",
    });

    const commandDescriptor = (monaco.editor.addCommand as any).mock.calls[0][0];
    await commandDescriptor.run(null, result.suggestions[0].command.arguments[0]);

    expect(gateway.executeCommand).toHaveBeenCalledWith(
      "/project",
      completionCommand,
    );
  });

  it("flushes pending document changes before resolving TypeScript completion items", async () => {
    const monaco = createMonaco();
    const resolveFlush = createDeferred<void>();
    const flushPendingDocumentChange = vi.fn(async () => {
      if (flushPendingDocumentChange.mock.calls.length === 2) {
        await resolveFlush.promise;
      }
    });
    const gateway = featuresGateway({
      completion: {
        isIncomplete: false,
        items: [
          {
            data: { entryNames: ["loadUser"] },
            detail: "function",
            documentation: null,
            insertText: "loadUser",
            kind: 3,
            label: "loadUser",
          },
        ],
      },
      resolvedCompletionItem: {
        data: { entryNames: ["loadUser"] },
        detail: "resolved function loadUser(id: string): Promise<User>",
        documentation: "Resolved docs",
        insertText: "loadUser",
        kind: 3,
        label: "loadUser",
      },
    });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: gateway,
        flushPendingDocumentChange,
      }),
    );
    const completionProvider = (
      monaco.languages.registerCompletionItemProvider as any
    ).mock.calls[0][1];
    const completion = await completionProvider.provideCompletionItems(
      textModel(),
      { column: 4, lineNumber: 1 },
    );

    const resolvePromise = completionProvider.resolveCompletionItem(
      completion.suggestions[0],
    );

    await Promise.resolve();

    expect(flushPendingDocumentChange).toHaveBeenNthCalledWith(
      2,
      "/project/src/user.ts",
    );
    expect(gateway.resolveCompletionItem).not.toHaveBeenCalled();

    resolveFlush.resolve(undefined);
    await expect(resolvePromise).resolves.toEqual(
      expect.objectContaining({ detail: "resolved function loadUser(id: string): Promise<User>" }),
    );
    expect(gateway.resolveCompletionItem).toHaveBeenCalledWith(
      "/project",
      expect.objectContaining({ label: "loadUser" }),
    );
  });

  it("uses runtime status when the workspace root only differs by a trailing slash", async () => {
    const monaco = createMonaco();
    const gateway = featuresGateway({
      completion: {
        isIncomplete: false,
        items: [
          {
            detail: "const",
            documentation: null,
            insertText: "account",
            kind: 6,
            label: "account",
          },
        ],
      },
    });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: gateway,
        getRuntimeStatus: () => ({
          ...runningStatus(),
          rootPath: "/project/",
        }),
        getWorkspaceRoot: () => "/project",
      }),
    );
    const completionProvider = (
      monaco.languages.registerCompletionItemProvider as any
    ).mock.calls[0][1];

    const result = await completionProvider.provideCompletionItems(
      textModel(),
      { column: 4, lineNumber: 1 },
    );

    expect(gateway.completion).toHaveBeenCalledWith(
      "/project",
      expect.any(Object),
    );
    expect(result.suggestions).toHaveLength(1);
  });

  it("resolves TypeScript completion items through the language server", async () => {
    const monaco = createMonaco();
    const resolvedCommand = {
      arguments: [{ source: "resolve" }],
      command: "_typescript.applyCompletionCodeAction",
      title: "Apply completion code action",
    };
    const gateway = featuresGateway({
      completion: {
        isIncomplete: false,
        items: [
          {
            data: { entryNames: ["loadUser"] },
            detail: "function",
            documentation: null,
            insertText: "loadUser",
            kind: 3,
            label: "loadUser",
          },
        ],
      },
      resolvedCompletionItem: {
        additionalTextEdits: [
          {
            newText: "import { loadUser } from './users';\n",
            range: range(0, 0, 0, 0),
          },
        ],
        command: resolvedCommand,
        data: { entryNames: ["loadUser"] },
        detail: "function loadUser(id: string): Promise<User>",
        documentation: "Resolved docs",
        insertText: "loadUser(${1:id})",
        insertTextFormat: 2,
        kind: 3,
        label: "loadUser",
      },
    });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ featuresGateway: gateway }),
    );
    const completionProvider = (
      monaco.languages.registerCompletionItemProvider as any
    ).mock.calls[0][1];
    const completion = await completionProvider.provideCompletionItems(
      textModel(),
      { column: 4, lineNumber: 1 },
    );

    const resolved = await completionProvider.resolveCompletionItem(
      completion.suggestions[0],
    );

    expect(gateway.resolveCompletionItem).toHaveBeenCalledWith(
      "/project",
      expect.objectContaining({
        data: { entryNames: ["loadUser"] },
        label: "loadUser",
      }),
    );
    expect(resolved).toEqual(
      expect.objectContaining({
        additionalTextEdits: [
          {
            range: expect.objectContaining({
              startColumn: 1,
              startLineNumber: 1,
            }),
            text: "import { loadUser } from './users';\n",
          },
        ],
        detail: "function loadUser(id: string): Promise<User>",
        documentation: "Resolved docs",
        command: {
          arguments: [
            {
              command: resolvedCommand,
              path: "/project/src/user.ts",
              rootPath: "/project",
              sessionId: 1,
            },
          ],
          id: "mockor.javascriptTypeScript.executeLanguageServerCommand",
          title: "Apply completion code action",
        },
        insertText: "loadUser(${1:id})",
        insertTextRules: 4,
      }),
    );
  });

  it("drops in-flight TypeScript completion resolves after switching project tabs", async () => {
    const monaco = createMonaco();
    let activeRoot = "/project";
    const resolvedCompletion =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["resolveCompletionItem"]>>
      >();
    const gateway = featuresGateway({
      completion: {
        isIncomplete: false,
        items: [
          {
            data: { entryNames: ["loadUser"] },
            detail: "function",
            documentation: null,
            insertText: "loadUser",
            kind: 3,
            label: "loadUser",
          },
        ],
      },
    });
    vi.mocked(gateway.resolveCompletionItem).mockImplementationOnce(
      async () => resolvedCompletion.promise,
    );
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: gateway,
        getWorkspaceRoot: () => activeRoot,
      }),
    );
    const completionProvider = (
      monaco.languages.registerCompletionItemProvider as any
    ).mock.calls[0][1];
    const completion = await completionProvider.provideCompletionItems(
      textModel(),
      { column: 4, lineNumber: 1 },
    );
    const originalItem = completion.suggestions[0];
    const resolvePromise = completionProvider.resolveCompletionItem(originalItem);

    await Promise.resolve();
    activeRoot = "/other";
    resolvedCompletion.resolve({
      additionalTextEdits: [
        {
          newText: "import { loadUser } from './users';\n",
          range: range(0, 0, 0, 0),
        },
      ],
      data: { entryNames: ["loadUser"] },
      detail: "resolved function loadUser(id: string): Promise<User>",
      documentation: "Resolved docs",
      insertText: "loadUser(${1:id})",
      insertTextFormat: 2,
      kind: 3,
      label: "loadUser",
    });

    await expect(resolvePromise).resolves.toBe(originalItem);
    expect(gateway.resolveCompletionItem).toHaveBeenCalledWith(
      "/project",
      expect.objectContaining({ label: "loadUser" }),
    );
  });

  it("drops stale TypeScript completion resolve errors after same-root session restart", async () => {
    const monaco = createMonaco();
    let activeSessionId = 1;
    const resolvedCompletion =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["resolveCompletionItem"]>>
      >();
    const reportError = vi.fn();
    const gateway = featuresGateway({
      completion: {
        isIncomplete: false,
        items: [
          {
            data: { entryNames: ["loadUser"] },
            detail: "function",
            documentation: null,
            insertText: "loadUser",
            kind: 3,
            label: "loadUser",
          },
        ],
      },
    });
    vi.mocked(gateway.resolveCompletionItem).mockImplementationOnce(
      async () => resolvedCompletion.promise,
    );
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: gateway,
        getRuntimeStatus: () => ({
          ...runningStatus(),
          sessionId: activeSessionId,
        }),
        reportError,
      }),
    );
    const completionProvider = (
      monaco.languages.registerCompletionItemProvider as any
    ).mock.calls[0][1];
    const completion = await completionProvider.provideCompletionItems(
      textModel(),
      { column: 4, lineNumber: 1 },
    );
    const originalItem = completion.suggestions[0];
    const resolvePromise = completionProvider.resolveCompletionItem(originalItem);

    await Promise.resolve();
    activeSessionId = 2;
    resolvedCompletion.reject(new Error("stale resolve"));

    await expect(resolvePromise).resolves.toBe(originalItem);
    expect(reportError).not.toHaveBeenCalled();
    expect(gateway.resolveCompletionItem).toHaveBeenCalledWith(
      "/project",
      expect.objectContaining({ label: "loadUser" }),
    );
  });

  it("drops TypeScript code action resolves after switching project tabs during document flush", async () => {
    const monaco = createMonaco();
    let activeRoot = "/project";
    const resolveFlush = createDeferred<void>();
    const flushPendingDocumentChange = vi.fn(async () => {
      if (flushPendingDocumentChange.mock.calls.length === 2) {
        await resolveFlush.promise;
      }
    });
    const codeAction = {
      command: {
        arguments: [{ tsActionId: "unusedIdentifier" }],
        command: "_typescript.applyFixAllCodeAction",
        title: "Fix all unused identifiers",
      },
      data: { globalId: 1, providerId: 2 },
      edit: null,
      isPreferred: false,
      kind: "quickfix",
      title: "Fix all unused identifiers",
    };
    const gateway = featuresGateway({
      codeActions: [codeAction],
      resolvedCodeAction: {
        ...codeAction,
        edit: workspaceEdit("file:///project/src/user.ts", "Resolved"),
      },
    });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: gateway,
        flushPendingDocumentChange,
        getWorkspaceRoot: () => activeRoot,
      }),
    );
    const codeActionProvider = (
      monaco.languages.registerCodeActionProvider as any
    ).mock.calls[0][1];
    const actions = await codeActionProvider.provideCodeActions(
      textModel(),
      new monaco.Range(1, 1, 1, 5),
      {
        markers: [],
        only: "quickfix",
      },
    );
    const originalAction = actions.actions[0];

    const resolvePromise = codeActionProvider.resolveCodeAction(originalAction);

    await Promise.resolve();
    activeRoot = "/other";
    resolveFlush.resolve(undefined);

    await expect(resolvePromise).resolves.toBe(originalAction);
    expect(flushPendingDocumentChange).toHaveBeenNthCalledWith(
      2,
      "/project/src/user.ts",
    );
    expect(gateway.resolveCodeAction).not.toHaveBeenCalled();
  });

  it("drops TypeScript commands after switching project tabs during document flush", async () => {
    const monaco = createMonaco();
    let activeRoot = "/project";
    const resolveFlush = createDeferred<void>();
    const flushPendingDocumentChange = vi.fn(async () => {
      if (flushPendingDocumentChange.mock.calls.length === 2) {
        await resolveFlush.promise;
      }
    });
    const completionCommand = {
      arguments: [{ source: "completion" }],
      command: "_typescript.applyCompletionCodeAction",
      title: "Apply completion code action",
    };
    const gateway = featuresGateway({
      completion: {
        isIncomplete: false,
        items: [
          {
            command: completionCommand,
            detail: "function",
            documentation: null,
            insertText: "loadUser",
            kind: 3,
            label: "loadUser",
          },
        ],
      },
    });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: gateway,
        flushPendingDocumentChange,
        getWorkspaceRoot: () => activeRoot,
      }),
    );
    const completionProvider = (
      monaco.languages.registerCompletionItemProvider as any
    ).mock.calls[0][1];
    const completion = await completionProvider.provideCompletionItems(
      textModel(),
      { column: 4, lineNumber: 1 },
    );
    const commandDescriptor = (monaco.editor.addCommand as any).mock.calls[0][0];

    const commandPromise = commandDescriptor.run(
      null,
      completion.suggestions[0].command.arguments[0],
    );

    await Promise.resolve();
    activeRoot = "/other";
    resolveFlush.resolve(undefined);
    await commandPromise;

    expect(flushPendingDocumentChange).toHaveBeenNthCalledWith(
      2,
      "/project/src/user.ts",
    );
    expect(gateway.executeCommand).not.toHaveBeenCalled();
  });

  it("drops in-flight TypeScript command edits after switching project tabs", async () => {
    const monaco = createMonaco();
    const model = textModel();
    let activeRoot = "/project";
    const applyWorkspaceEdit = vi.fn(async () => undefined);
    const commandEdit =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["executeCommand"]>>
      >();
    const gateway = featuresGateway();
    vi.mocked(gateway.executeCommand).mockImplementationOnce(
      async () => commandEdit.promise,
    );
    monaco.editor.getModels.mockReturnValue([model]);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        applyWorkspaceEdit,
        featuresGateway: gateway,
        getWorkspaceRoot: () => activeRoot,
      }),
    );
    const commandDescriptor = (monaco.editor.addCommand as any).mock.calls[0][0];
    const commandPromise = commandDescriptor.run(null, {
      command: {
        arguments: [{ scope: "file" }],
        command: "_typescript.organizeImports",
        title: "Organize Imports",
      },
      path: "/project/src/user.ts",
      rootPath: "/project",
      sessionId: 1,
    });

    await vi.waitFor(() => {
      expect(gateway.executeCommand).toHaveBeenCalledWith(
        "/project",
        expect.objectContaining({ command: "_typescript.organizeImports" }),
      );
    });
    activeRoot = "/other";
    commandEdit.resolve(workspaceEdit("file:///project/src/user.ts", "Organized"));
    await commandPromise;

    expect(model.pushEditOperations).not.toHaveBeenCalled();
    expect(applyWorkspaceEdit).not.toHaveBeenCalled();
  });

  it("accepts TypeScript workspace edits when Monaco and LSP versions diverge", async () => {
    const monaco = createMonaco();
    const model = textModel();
    const siblingRootModel = {
      ...textModel(),
      uri: {
        fsPath: "/project-neighbor/src/user.ts",
        path: "/project-neighbor/src/user.ts",
      },
    };
    const commandEdit = {
      changes: {
        ...workspaceEdit("file:///project/src/user.ts", "OpenEdit").changes,
        ...workspaceEdit("file:///project/src/helper.ts", "ClosedEdit").changes,
        ...workspaceEdit(
          "file:///project-neighbor/src/user.ts",
          "Ignored sibling root",
        ).changes,
      },
      documentVersions: {
        "file:///project/src/user.ts": 6,
      },
    };
    const applyWorkspaceEdit = vi.fn(async () => {
      expect(model.pushEditOperations).not.toHaveBeenCalled();
    });
    const gateway = featuresGateway({
      executeCommandEdit: commandEdit,
    });
    monaco.editor.getModels.mockReturnValue([model, siblingRootModel]);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        applyWorkspaceEdit,
        featuresGateway: gateway,
      }),
    );
    const commandDescriptor = (monaco.editor.addCommand as any).mock.calls[0][0];

    await commandDescriptor.run(null, {
      command: {
        arguments: [{ scope: "file" }],
        command: "_typescript.organizeImports",
        title: "Organize Imports",
      },
      path: "/project/src/user.ts",
      rootPath: "/project",
      sessionId: 1,
    });

    expect(model.pushEditOperations).toHaveBeenCalledWith(
      [],
      [
        {
          range: expect.objectContaining({
            endColumn: 6,
            endLineNumber: 1,
            startColumn: 2,
            startLineNumber: 1,
          }),
          text: "OpenEdit",
        },
      ],
      expect.any(Function),
    );
    expect(siblingRootModel.pushEditOperations).not.toHaveBeenCalled();
    expect(applyWorkspaceEdit).toHaveBeenCalledWith(
      {
        changes: {
          ...workspaceEdit("file:///project/src/user.ts", "OpenEdit").changes,
          ...workspaceEdit("file:///project/src/helper.ts", "ClosedEdit").changes,
        },
        documentVersions: {
          "file:///project/src/user.ts": 6,
        },
      },
      {
        applyOpenModels: expect.any(Function),
        openPaths: ["/project/src/user.ts"],
        rootPath: "/project",
      },
    );
  });

  it("synchronizes authoritative Monaco ordering, CRLF content, and version in one undo boundary", async () => {
    const monaco = createMonaco();
    let content = "\r\nline";
    let versionId = 11;
    const model = {
      ...textModel(),
      getValue: vi.fn(() => content),
      getVersionId: vi.fn(() => versionId),
      pushEditOperations: vi.fn(
        (_selections, edits: Array<{ text: string }>) => {
          expect(edits.map(({ text }) => text)).toEqual(["X", "Y"]);
          content = "XY\r\nline";
          versionId += 1;
        },
      ),
    };
    const edit = {
      changes: {
        "file:///project/src/user.ts": [
          {
            newText: "X",
            range: {
              end: { character: 0, line: 0 },
              start: { character: 0, line: 0 },
            },
          },
        ],
        "file://localhost/project/src/%75ser.ts": [
          {
            newText: "Y",
            range: {
              end: { character: 0, line: 0 },
              start: { character: 0, line: 0 },
            },
          },
        ],
      },
      documentVersions: {
        "file:///project/src/user.ts": 6,
      },
    };
    let appliedSnapshots: ReturnType<
      NonNullable<JavaScriptTypeScriptWorkspaceEditApplicationContext["applyOpenModels"]>
    > = { documents: [], kind: "applied" };
    const applyWorkspaceEdit = vi.fn(
      async (
        _edit: unknown,
        context: JavaScriptTypeScriptWorkspaceEditApplicationContext,
      ) => {
        appliedSnapshots = context.applyOpenModels?.() ?? {
          documents: [],
          kind: "applied",
        };
        return { kind: "accepted" as const };
      },
    );
    monaco.editor.getModels.mockReturnValue([model]);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        applyWorkspaceEdit,
        featuresGateway: featuresGateway({ executeCommandEdit: edit }),
      }),
    );
    const commandDescriptor = (monaco.editor.addCommand as any).mock.calls[0][0];

    await commandDescriptor.run(null, {
      command: {
        arguments: [],
        command: "_typescript.organizeImports",
        title: "Organize Imports",
      },
      path: "/project/src/user.ts",
      rootPath: "/project",
      sessionId: 1,
    });

    expect(model.pushEditOperations).toHaveBeenCalledOnce();
    expect(appliedSnapshots).toEqual({
      documents: [
        {
          content: "XY\r\nline",
          path: "/project/src/user.ts",
          versionId: 12,
        },
      ],
      kind: "applied",
    });
  });

  it.each([
    {
      edits: [textEditAt("invalid", 0, 9, 0, 9)],
      failure: "out-of-bounds range",
    },
    {
      edits: [textEditAt("first", 0, 0, 0, 2), textEditAt("second", 0, 1, 0, 3)],
      failure: "overlapping ranges",
    },
  ])("rejects all models before push when model B has $failure", async ({ edits }) => {
    const monaco = createMonaco();
    const modelA = stagedTextModel("/project/src/a.ts", "abc", 7);
    const modelB = stagedTextModel("/project/src/b.ts", "abc", 7);
    const edit = {
      changes: {
        "file:///project/src/a.ts": [textEditAt("A", 0, 0, 0, 1)],
        "file:///project/src/b.ts": edits,
      },
    };
    const applyWorkspaceEdit = vi.fn(
      async (
        _edit: unknown,
        context: JavaScriptTypeScriptWorkspaceEditApplicationContext,
      ) => {
        const commit = context.applyOpenModels?.();

        return commit?.kind === "rejected"
          ? commit
          : { kind: "accepted" as const };
      },
    );
    monaco.editor.getModels.mockReturnValue([modelA, modelB]);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        applyWorkspaceEdit,
        featuresGateway: featuresGateway({ executeCommandEdit: edit }),
      }),
    );
    const commandDescriptor = (monaco.editor.addCommand as any).mock.calls[0][0];

    await commandDescriptor.run(null, workspaceEditCommandPayload("/project/src/a.ts"));

    expect(modelA.pushEditOperations).not.toHaveBeenCalled();
    expect(modelB.pushEditOperations).not.toHaveBeenCalled();
  });

  it("rejects all models when model B drifts between staging and commit", async () => {
    const monaco = createMonaco();
    const modelA = stagedTextModel("/project/src/a.ts", "abc", 7);
    const modelB = stagedTextModel("/project/src/b.ts", "abc", 7);
    const edit = {
      changes: {
        "file:///project/src/a.ts": [textEditAt("A", 0, 0, 0, 1)],
        "file:///project/src/b.ts": [textEditAt("B", 0, 0, 0, 1)],
      },
    };
    const applyWorkspaceEdit = vi.fn(
      async (
        _edit: unknown,
        context: JavaScriptTypeScriptWorkspaceEditApplicationContext,
      ) => {
        modelB.setSnapshot("changed", 8);
        const commit = context.applyOpenModels?.();

        return commit?.kind === "rejected"
          ? commit
          : { kind: "accepted" as const };
      },
    );
    monaco.editor.getModels.mockReturnValue([modelA, modelB]);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        applyWorkspaceEdit,
        featuresGateway: featuresGateway({ executeCommandEdit: edit }),
      }),
    );
    const commandDescriptor = (monaco.editor.addCommand as any).mock.calls[0][0];

    await commandDescriptor.run(null, workspaceEditCommandPayload("/project/src/a.ts"));

    expect(modelA.pushEditOperations).not.toHaveBeenCalled();
    expect(modelB.pushEditOperations).not.toHaveBeenCalled();
  });

  it("rejects all models when model B disappears between staging and commit", async () => {
    const monaco = createMonaco();
    const modelA = stagedTextModel("/project/src/a.ts", "abc", 7);
    const modelB = stagedTextModel("/project/src/b.ts", "abc", 7);
    const edit = {
      changes: {
        "file:///project/src/a.ts": [textEditAt("A", 0, 0, 0, 1)],
        "file:///project/src/b.ts": [textEditAt("B", 0, 0, 0, 1)],
      },
    };
    const applyWorkspaceEdit = vi.fn(
      async (
        _edit: unknown,
        context: JavaScriptTypeScriptWorkspaceEditApplicationContext,
      ) => {
        monaco.editor.getModels.mockReturnValue([modelA]);
        const commit = context.applyOpenModels?.();

        return commit?.kind === "rejected"
          ? commit
          : { kind: "accepted" as const };
      },
    );
    monaco.editor.getModels.mockReturnValue([modelA, modelB]);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        applyWorkspaceEdit,
        featuresGateway: featuresGateway({ executeCommandEdit: edit }),
      }),
    );
    const commandDescriptor = (monaco.editor.addCommand as any).mock.calls[0][0];

    await commandDescriptor.run(null, workspaceEditCommandPayload("/project/src/a.ts"));

    expect(modelA.pushEditOperations).not.toHaveBeenCalled();
    expect(modelB.pushEditOperations).not.toHaveBeenCalled();
  });

  it("rolls back model A when applying model B throws", async () => {
    const monaco = createMonaco();
    const modelA = stagedTextModel("/project/src/a.ts", "abc", 7);
    const modelB = stagedTextModel("/project/src/b.ts", "abc", 7);
    modelA.pushEditOperations.mockImplementation(() => {
      modelA.setSnapshot("Abc", 8);
    });
    Object.assign(modelA, {
      setValue: vi.fn((content: string) => modelA.setSnapshot(content, 9)),
    });
    modelB.pushEditOperations.mockImplementation(() => {
      throw new Error("injected second-model failure");
    });
    Object.assign(modelB, {
      setValue: vi.fn((content: string) => modelB.setSnapshot(content, 9)),
    });
    const edit = {
      changes: {
        "file:///project/src/a.ts": [textEditAt("A", 0, 0, 0, 1)],
        "file:///project/src/b.ts": [textEditAt("B", 0, 0, 0, 1)],
      },
    };
    const applyWorkspaceEdit = vi.fn(
      async (
        _edit: unknown,
        context: JavaScriptTypeScriptWorkspaceEditApplicationContext,
      ) => {
        context.applyOpenModels?.();
        return { kind: "accepted" as const };
      },
    );
    monaco.editor.getModels.mockReturnValue([modelA, modelB]);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        applyWorkspaceEdit,
        featuresGateway: featuresGateway({ executeCommandEdit: edit }),
      }),
    );
    const commandDescriptor = (monaco.editor.addCommand as any).mock.calls[0][0];

    await commandDescriptor.run(
      null,
      workspaceEditCommandPayload("/project/src/a.ts"),
    );
    expect(modelA.getValue()).toBe("abc");
    expect(modelB.getValue()).toBe("abc");
    expect((modelA as any).setValue).toHaveBeenCalledWith("abc");
  });

  it("does not overwrite a user edit made after a workspace edit commit", async () => {
    const monaco = createMonaco();
    const model = stagedTextModel("/project/src/a.ts", "abc", 7);
    model.pushEditOperations.mockImplementation(() => {
      model.setSnapshot("Abc", 8);
    });
    Object.assign(model, {
      setValue: vi.fn((content: string) => model.setSnapshot(content, 9)),
    });
    const edit = {
      changes: {
        "file:///project/src/a.ts": [textEditAt("A", 0, 0, 0, 1)],
      },
    };
    const applyWorkspaceEdit = vi.fn(
      async (
        _edit: unknown,
        context: JavaScriptTypeScriptWorkspaceEditApplicationContext,
      ) => {
        const commit = context.applyOpenModels?.();

        if (commit?.kind === "applied") {
          model.setSnapshot("user edit", 9);
          commit.rollback?.();
        }

        return { kind: "accepted" as const };
      },
    );
    monaco.editor.getModels.mockReturnValue([model]);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        applyWorkspaceEdit,
        featuresGateway: featuresGateway({ executeCommandEdit: edit }),
      }),
    );
    const commandDescriptor = (monaco.editor.addCommand as any).mock.calls[0][0];

    await commandDescriptor.run(
      null,
      workspaceEditCommandPayload("/project/src/a.ts"),
    );

    expect(model.getValue()).toBe("user edit");
    expect((model as any).setValue).not.toHaveBeenCalled();
  });

  it("does not mutate TypeScript models when the authoritative LSP version rejects an edit", async () => {
    const monaco = createMonaco();
    const model = textModel();
    const openUri = "file:///project/src/user.ts";
    const closedUri = "file:///project/src/helper.ts";
    const commandEdit = {
      changes: {
        ...workspaceEdit(openUri, "StaleOpenEdit").changes,
        ...workspaceEdit(closedUri, "ClosedEdit").changes,
      },
      documentVersions: {
        [closedUri]: 3,
        [openUri]: 7,
      },
    };
    const applyWorkspaceEdit = vi.fn(async () => ({
      kind: "rejected" as const,
      path: "/project/src/user.ts",
      reason: "staleDocumentVersion" as const,
    }));
    const gateway = featuresGateway({
      executeCommandEdit: commandEdit,
    });
    monaco.editor.getModels.mockReturnValue([model]);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        applyWorkspaceEdit,
        featuresGateway: gateway,
      }),
    );
    const commandDescriptor = (monaco.editor.addCommand as any).mock.calls[0][0];

    await commandDescriptor.run(null, {
      command: {
        arguments: [{ scope: "file" }],
        command: "_typescript.organizeImports",
        title: "Organize Imports",
      },
      path: "/project/src/user.ts",
      rootPath: "/project",
      sessionId: 1,
    });

    expect(model.pushEditOperations).not.toHaveBeenCalled();
    expect(applyWorkspaceEdit).toHaveBeenCalledWith(
      commandEdit,
      {
        applyOpenModels: expect.any(Function),
        openPaths: ["/project/src/user.ts"],
        rootPath: "/project",
      },
    );
  });

  it("persists TypeScript rename edits through the workspace applier while keeping open models current", async () => {
    const monaco = createMonaco();
    const model = textModel();
    const siblingRootModel = {
      ...textModel(),
      uri: {
        fsPath: "/project-neighbor/src/user.ts",
        path: "/project-neighbor/src/user.ts",
      },
    };
    const renameEdit = {
      changes: {
        ...workspaceEdit("file:///project/src/user.ts", "OpenRename").changes,
        ...workspaceEdit("file:///project/src/helper.ts", "ClosedRename").changes,
        ...workspaceEdit(
          "file:///project-neighbor/src/user.ts",
          "Ignored sibling root",
        ).changes,
      },
    };
    const applyWorkspaceEdit = vi.fn(async () => undefined);
    const gateway = featuresGateway({
      rename: renameEdit,
    });
    monaco.editor.getModels.mockReturnValue([model, siblingRootModel]);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        applyWorkspaceEdit,
        featuresGateway: gateway,
      }),
    );
    const renameProvider = (monaco.languages.registerRenameProvider as any).mock
      .calls[0][1];

    const rename = await renameProvider.provideRenameEdits(
      model,
      { column: 4, lineNumber: 1 },
      "Account",
    );

    expect(gateway.rename).toHaveBeenCalledWith(
      "/project",
      {
        character: 3,
        line: 0,
        path: "/project/src/user.ts",
      },
      "Account",
    );
    expect(model.pushEditOperations).toHaveBeenCalledWith(
      [],
      [
        {
          range: expect.objectContaining({
            endColumn: 6,
            endLineNumber: 1,
            startColumn: 2,
            startLineNumber: 1,
          }),
          text: "OpenRename",
        },
      ],
      expect.any(Function),
    );
    expect(siblingRootModel.pushEditOperations).not.toHaveBeenCalled();
    expect(applyWorkspaceEdit).toHaveBeenCalledWith(
      {
        changes: {
          ...workspaceEdit("file:///project/src/user.ts", "OpenRename").changes,
          ...workspaceEdit("file:///project/src/helper.ts", "ClosedRename")
            .changes,
        },
      },
      {
        applyOpenModels: expect.any(Function),
        openPaths: ["/project/src/user.ts"],
        rootPath: "/project",
      },
    );
    expect(rename).toEqual({ edits: [] });
  });

  it("applies a rename only to the originating scoped model for overlapping roots", async () => {
    const monaco = createMonaco();
    const path = "/project/packages/app/src/user.ts";
    const parentModel = textModel();
    const nestedModel = textModel();
    parentModel.uri = URI.parse(workspaceModelUri("/project", path)! as string) as never;
    nestedModel.uri = URI.parse(
      workspaceModelUri("/project/packages/app", path)! as string,
    ) as never;
    monaco.editor.getModels.mockReturnValue([parentModel, nestedModel]);
    const gateway = featuresGateway({
      rename: workspaceEdit(`file://${path}`, "NestedRename"),
    });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        applyWorkspaceEdit: vi.fn(async () => undefined),
        featuresGateway: gateway,
        getActiveDocument: () => ({ ...document(), path }),
        getRuntimeStatus: () => ({
          ...runningStatus(),
          rootPath: "/project/packages/app",
        }),
        getWorkspaceRoot: () => "/project/packages/app",
      }),
    );
    const renameProvider = (monaco.languages.registerRenameProvider as any).mock
      .calls[0][1];

    await renameProvider.provideRenameEdits(
      nestedModel,
      { column: 4, lineNumber: 1 },
      "Account",
    );

    expect(nestedModel.pushEditOperations).toHaveBeenCalledOnce();
    expect(parentModel.pushEditOperations).not.toHaveBeenCalled();
  });

  it("scopes inlay-hint label navigation to the originating nested root", async () => {
    const monaco = createMonaco();
    (monaco.Uri as typeof monaco.Uri & { parse: typeof URI.parse }).parse =
      URI.parse;
    const rootPath = "/project/packages/app";
    const path = `${rootPath}/src/user.ts`;
    const nestedModel = textModel();
    nestedModel.uri = URI.parse(workspaceModelUri(rootPath, path)! as string) as never;
    const gateway = featuresGateway({
      inlayHints: [
        {
          kind: 2,
          label: [
            {
              label: "user",
              location: { range: range(0, 0, 0, 4), uri: `file://${path}` },
            },
          ],
          paddingLeft: false,
          paddingRight: false,
          position: { character: 4, line: 0 },
          tooltip: null,
        },
      ],
    });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: gateway,
        getActiveDocument: () => ({ ...document(), path }),
        getRuntimeStatus: () => ({ ...runningStatus(), rootPath }),
        getWorkspaceRoot: () => rootPath,
      }),
    );
    const provider = (monaco.languages.registerInlayHintsProvider as any).mock
      .calls[0][1];
    const hints = await provider.provideInlayHints(
      nestedModel,
      new monaco.Range(1, 1, 1, 10),
    );

    expect(hints.hints[0].label[0].location.uri.toString()).toBe(
      workspaceModelUri(rootPath, path),
    );
  });

  it("persists edit-bearing TypeScript code actions through the workspace applier", async () => {
    const monaco = createMonaco();
    const model = textModel();
    const codeActionEdit = {
      changes: {
        ...workspaceEdit("file:///project/src/user.ts", "OpenActionEdit").changes,
        ...workspaceEdit("file:///project/src/helper.ts", "ClosedActionEdit")
          .changes,
        ...workspaceEdit(
          "file:///project-neighbor/src/user.ts",
          "Ignored sibling root",
        ).changes,
      },
    };
    const applyWorkspaceEdit = vi.fn(async () => undefined);
    const gateway = featuresGateway({
      codeActions: [
        {
          command: null,
          data: null,
          edit: codeActionEdit,
          isPreferred: true,
          kind: "quickfix",
          title: "Update imports",
        },
      ],
    });
    monaco.editor.getModels.mockReturnValue([model]);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        applyWorkspaceEdit,
        featuresGateway: gateway,
      }),
    );
    const codeActionProvider = (
      monaco.languages.registerCodeActionProvider as any
    ).mock.calls[0][1];

    const actions = await codeActionProvider.provideCodeActions(
      model,
      new monaco.Range(1, 1, 1, 5),
      {
        markers: [],
        only: "quickfix",
      },
    );
    const commandDescriptor = (monaco.editor.addCommand as any).mock.calls[0][0];
    await commandDescriptor.run(null, actions.actions[0].command.arguments[0]);

    expect(actions.actions[0].edit).toBeUndefined();
    expect(model.pushEditOperations).toHaveBeenCalledOnce();
    expect(gateway.executeCommand).not.toHaveBeenCalled();
    expect(applyWorkspaceEdit).toHaveBeenCalledWith(
      {
        changes: {
          ...workspaceEdit("file:///project/src/user.ts", "OpenActionEdit")
            .changes,
          ...workspaceEdit("file:///project/src/helper.ts", "ClosedActionEdit")
            .changes,
        },
      },
      {
        applyOpenModels: expect.any(Function),
        openPaths: ["/project/src/user.ts"],
        rootPath: "/project",
      },
    );
  });

  it("maps TypeScript workspace edit file operations through Monaco and the workspace applier", async () => {
    const monaco = createMonaco();
    (monaco.Uri as typeof monaco.Uri & { parse: typeof URI.parse }).parse =
      URI.parse;
    const model = textModel();
    const codeActionEdit = {
      changes: {},
      fileOperations: [
        {
          kind: "create" as const,
          options: { ignoreIfExists: true },
          uri: "file:///project/src/created.ts",
        },
        {
          kind: "rename" as const,
          newUri: "file:///project/src/NewName.ts",
          oldUri: "file:///project/src/OldName.ts",
          options: { overwrite: true },
        },
        {
          kind: "delete" as const,
          options: { ignoreIfNotExists: true, recursive: true },
          uri: "file:///project/src/stale.ts",
        },
        {
          kind: "create" as const,
          uri: "file:///project-neighbor/src/leak.ts",
        },
      ],
    };
    const filteredEdit = {
      changes: {},
      fileOperations: codeActionEdit.fileOperations.slice(0, 3),
    };
    const applyWorkspaceEdit = vi.fn(async () => undefined);
    const gateway = featuresGateway({
      codeActions: [
        {
          command: null,
          data: null,
          edit: codeActionEdit,
          isPreferred: true,
          kind: "quickfix",
          title: "Apply file operation edits",
        },
      ],
    });
    monaco.editor.getModels.mockReturnValue([model]);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        applyWorkspaceEdit,
        featuresGateway: gateway,
      }),
    );
    const codeActionProvider = (
      monaco.languages.registerCodeActionProvider as any
    ).mock.calls[0][1];

    const actions = await codeActionProvider.provideCodeActions(
      model,
      new monaco.Range(1, 1, 1, 5),
      {
        markers: [],
        only: "quickfix",
      },
    );

    expect(actions.actions[0].edit).toBeUndefined();

    const commandDescriptor = (monaco.editor.addCommand as any).mock.calls[0][0];
    await commandDescriptor.run(null, actions.actions[0].command.arguments[0]);

    expect(applyWorkspaceEdit).toHaveBeenCalledWith(filteredEdit, {
      applyOpenModels: expect.any(Function),
      openPaths: [],
      rootPath: "/project",
    });
  });

  it("drops stale TypeScript prepare-rename rejection after switching project tabs", async () => {
    const monaco = createMonaco();
    let activeRoot = "/project";
    const prepareRename = createDeferred<
      Awaited<ReturnType<LanguageServerFeaturesGateway["prepareRename"]>>
    >();
    const gateway = featuresGateway();
    vi.mocked(gateway.prepareRename).mockImplementationOnce(
      async () => prepareRename.promise,
    );
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: gateway,
        getWorkspaceRoot: () => activeRoot,
      }),
    );
    const renameProvider = (monaco.languages.registerRenameProvider as any).mock
      .calls[0][1];
    const renameLocationPromise = renameProvider.resolveRenameLocation(
      textModel(),
      { column: 4, lineNumber: 1 },
    );

    await Promise.resolve();
    activeRoot = "/other";
    prepareRename.reject(new Error("Cannot rename this symbol."));

    await expect(renameLocationPromise).resolves.toBeNull();
    expect(gateway.prepareRename).toHaveBeenCalledWith("/project", {
      character: 3,
      line: 0,
      path: "/project/src/user.ts",
    });
  });

  it("ignores stale TypeScript lazy resolves after switching project tabs", async () => {
    const monaco = createMonaco();
    let activeRoot = "/project";
    const codeAction = {
      command: {
        arguments: [{ tsActionId: "unusedIdentifier" }],
        command: "_typescript.applyFixAllCodeAction",
        title: "Fix all unused identifiers",
      },
      data: { globalId: 1, providerId: 2 },
      edit: null,
      isPreferred: false,
      kind: "quickfix",
      title: "Fix all unused identifiers",
    };
    const codeLens = {
      command: null,
      data: { kind: "references" },
      range: range(2, 1, 2, 12),
    };
    const gateway = featuresGateway({
      codeActions: [codeAction],
      codeLenses: [codeLens],
      completion: {
        isIncomplete: false,
        items: [
          {
            data: { entryNames: ["loadUser"] },
            detail: "function",
            documentation: null,
            insertText: "loadUser",
            kind: 3,
            label: "loadUser",
          },
        ],
      },
      documentLinks: [
        {
          data: { file: "/project/src/user.ts" },
          range: range(0, 15, 0, 23),
          target: null,
          tooltip: "Open user module",
        },
      ],
      inlayHints: [
        {
          data: { hintId: 1 },
          kind: 1,
          label: [
            {
              command: {
                arguments: [{ file: "/project/src/user.ts" }],
                command: "_typescript.applyCompletionCodeAction",
                title: "Apply import",
              },
              label: "Account",
            },
          ],
          paddingLeft: true,
          paddingRight: false,
          position: {
            character: 10,
            line: 0,
          },
          tooltip: "Inferred type",
        },
      ],
    });
    const context = providerContext({
      featuresGateway: gateway,
      getWorkspaceRoot: () => activeRoot,
    });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(monaco as any, context);
    const model = textModel();
    const position = { column: 4, lineNumber: 1 };
    const completionProvider = (
      monaco.languages.registerCompletionItemProvider as any
    ).mock.calls[0][1];
    const linkProvider = (monaco.languages.registerLinkProvider as any).mock
      .calls[0][1];
    const codeActionProvider = (
      monaco.languages.registerCodeActionProvider as any
    ).mock.calls[0][1];
    const codeLensProvider = (monaco.languages.registerCodeLensProvider as any)
      .mock.calls[0][1];
    const inlayHintsProvider = (
      monaco.languages.registerInlayHintsProvider as any
    ).mock.calls[0][1];
    const completion = await completionProvider.provideCompletionItems(
      model,
      position,
    );
    const links = await linkProvider.provideLinks(model);
    const actions = await codeActionProvider.provideCodeActions(
      model,
      new monaco.Range(1, 1, 1, 5),
      {
        markers: [],
        only: "quickfix",
      },
    );
    const lenses = await codeLensProvider.provideCodeLenses(model);
    const hints = await inlayHintsProvider.provideInlayHints(
      model,
      new monaco.Range(1, 1, 1, 20),
    );

    activeRoot = "/other";

    await completionProvider.resolveCompletionItem(completion.suggestions[0]);
    await linkProvider.resolveLink(links.links[0]);
    await codeActionProvider.resolveCodeAction(actions.actions[0]);
    await codeLensProvider.resolveCodeLens(model, lenses.lenses[0]);
    await inlayHintsProvider.resolveInlayHint(hints.hints[0]);
    const commandDescriptor = (monaco.editor.addCommand as any).mock.calls[0][0];
    await commandDescriptor.run(null, actions.actions[0].command.arguments[0]);
    const inlayLabel = hints.hints[0].label as any[];
    await commandDescriptor.run(null, inlayLabel[0].command.arguments[0]);

    expect(gateway.resolveCompletionItem).not.toHaveBeenCalled();
    expect(gateway.resolveDocumentLink).not.toHaveBeenCalled();
    expect(gateway.resolveCodeAction).not.toHaveBeenCalled();
    expect(gateway.resolveCodeLens).not.toHaveBeenCalled();
    expect(gateway.resolveInlayHint).not.toHaveBeenCalled();
    expect(gateway.executeCommand).not.toHaveBeenCalled();
  });

  it("ignores stale TypeScript lazy resolves after same-root session restart", async () => {
    const monaco = createMonaco();
    let activeSessionId = 1;
    const codeAction = {
      command: {
        arguments: [{ tsActionId: "unusedIdentifier" }],
        command: "_typescript.applyFixAllCodeAction",
        title: "Fix all unused identifiers",
      },
      data: { globalId: 1, providerId: 2 },
      edit: null,
      isPreferred: false,
      kind: "quickfix",
      title: "Fix all unused identifiers",
    };
    const codeLens = {
      command: null,
      data: { kind: "references" },
      range: range(2, 1, 2, 12),
    };
    const gateway = featuresGateway({
      codeActions: [codeAction],
      codeLenses: [codeLens],
      completion: {
        isIncomplete: false,
        items: [
          {
            data: { entryNames: ["loadUser"] },
            detail: "function",
            documentation: null,
            insertText: "loadUser",
            kind: 3,
            label: "loadUser",
          },
        ],
      },
      documentLinks: [
        {
          data: { file: "/project/src/user.ts" },
          range: range(0, 15, 0, 23),
          target: null,
          tooltip: "Open user module",
        },
      ],
      inlayHints: [
        {
          data: { hintId: 1 },
          kind: 1,
          label: [
            {
              command: {
                arguments: [{ file: "/project/src/user.ts" }],
                command: "_typescript.applyCompletionCodeAction",
                title: "Apply import",
              },
              label: "Account",
            },
          ],
          paddingLeft: true,
          paddingRight: false,
          position: {
            character: 10,
            line: 0,
          },
          tooltip: "Inferred type",
        },
      ],
    });
    const context = providerContext({
      featuresGateway: gateway,
      getRuntimeStatus: () => ({
        ...runningStatus(),
        rootPath: "/project",
        sessionId: activeSessionId,
      }),
    });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(monaco as any, context);
    const model = textModel();
    const position = { column: 4, lineNumber: 1 };
    const completionProvider = (
      monaco.languages.registerCompletionItemProvider as any
    ).mock.calls[0][1];
    const linkProvider = (monaco.languages.registerLinkProvider as any).mock
      .calls[0][1];
    const codeActionProvider = (
      monaco.languages.registerCodeActionProvider as any
    ).mock.calls[0][1];
    const codeLensProvider = (monaco.languages.registerCodeLensProvider as any)
      .mock.calls[0][1];
    const inlayHintsProvider = (
      monaco.languages.registerInlayHintsProvider as any
    ).mock.calls[0][1];
    const completion = await completionProvider.provideCompletionItems(
      model,
      position,
    );
    const links = await linkProvider.provideLinks(model);
    const actions = await codeActionProvider.provideCodeActions(
      model,
      new monaco.Range(1, 1, 1, 5),
      {
        markers: [],
        only: "quickfix",
      },
    );
    const lenses = await codeLensProvider.provideCodeLenses(model);
    const hints = await inlayHintsProvider.provideInlayHints(
      model,
      new monaco.Range(1, 1, 1, 20),
    );

    activeSessionId = 2;

    await completionProvider.resolveCompletionItem(completion.suggestions[0]);
    await linkProvider.resolveLink(links.links[0]);
    await codeActionProvider.resolveCodeAction(actions.actions[0]);
    await codeLensProvider.resolveCodeLens(model, lenses.lenses[0]);
    await inlayHintsProvider.resolveInlayHint(hints.hints[0]);
    const commandDescriptor = (monaco.editor.addCommand as any).mock.calls[0][0];
    await commandDescriptor.run(null, actions.actions[0].command.arguments[0]);
    const inlayLabel = hints.hints[0].label as any[];
    await commandDescriptor.run(null, inlayLabel[0].command.arguments[0]);

    expect(gateway.resolveCompletionItem).not.toHaveBeenCalled();
    expect(gateway.resolveDocumentLink).not.toHaveBeenCalled();
    expect(gateway.resolveCodeAction).not.toHaveBeenCalled();
    expect(gateway.resolveCodeLens).not.toHaveBeenCalled();
    expect(gateway.resolveInlayHint).not.toHaveBeenCalled();
    expect(gateway.executeCommand).not.toHaveBeenCalled();
  });

  it("applies server-initiated workspace edits for the active workspace only", async () => {
    const monaco = createMonaco();
    const model = textModel();
    const siblingRootModel = {
      ...textModel(),
      uri: {
        fsPath: "/project-neighbor/src/user.ts",
        path: "/project-neighbor/src/user.ts",
      },
    };
    const applyWorkspaceEdit = vi.fn(async () => undefined);
    const unsubscribe = vi.fn();
    const workspaceEditGateway = {
      subscribeWorkspaceEdits: vi.fn(async (listener) => {
        listener({
          edit: {
            changes: {
              ...workspaceEdit("file:///project/src/user.ts", "Applied").changes,
              ...workspaceEdit("file:///project/src/helper.ts", "Applied closed")
                .changes,
              ...workspaceEdit(
                "file:///project-neighbor/src/user.ts",
                "Ignored sibling root",
              ).changes,
            },
          },
          label: "Organize imports",
          rootPath: "/project/",
          sessionId: 1,
        });
        listener({
          edit: workspaceEdit("file:///other/src/user.ts", "Ignored"),
          label: "Other project",
          rootPath: "/other",
          sessionId: 1,
        });
        listener({
          edit: workspaceEdit("file:///project/src/user.ts", "Rootless"),
          label: "Missing root",
          sessionId: 1,
        } as any);
        return unsubscribe;
      }),
    };
    monaco.editor.getModels.mockReturnValue([model, siblingRootModel]);

    const disposable = registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ applyWorkspaceEdit, workspaceEditGateway }),
    );
    await vi.waitFor(() => {
      expect(model.pushEditOperations).toHaveBeenCalledTimes(1);
    });

    expect(model.pushEditOperations).toHaveBeenCalledWith(
      [],
      [
        {
          range: expect.objectContaining({
            endColumn: 6,
            endLineNumber: 1,
            startColumn: 2,
            startLineNumber: 1,
          }),
          text: "Applied",
        },
      ],
      expect.any(Function),
    );
    expect(siblingRootModel.pushEditOperations).not.toHaveBeenCalled();
    expect(applyWorkspaceEdit).toHaveBeenCalledTimes(1);
    expect(applyWorkspaceEdit).toHaveBeenCalledWith(
      {
        changes: {
          ...workspaceEdit("file:///project/src/user.ts", "Applied").changes,
          ...workspaceEdit("file:///project/src/helper.ts", "Applied closed")
            .changes,
        },
      },
      {
        applyOpenModels: expect.any(Function),
        openPaths: ["/project/src/user.ts"],
        rootPath: "/project/",
      },
    );

    disposable.dispose();

    expect(unsubscribe).toHaveBeenCalled();
  });

  it("drops in-flight server-initiated workspace edits after switching project tabs", async () => {
    const monaco = createMonaco();
    const model = textModel();
    let activeRoot = "/project";
    const applyWorkspaceEdit = vi.fn(async () => undefined);
    const pendingFlush = createDeferred<void>();
    const flushPendingDocumentChange = vi.fn(async () => pendingFlush.promise);
    let editListener:
      | ((event: LanguageServerWorkspaceEditEvent) => void)
      | null = null;
    const workspaceEditGateway: LanguageServerWorkspaceEditGateway = {
      subscribeWorkspaceEdits: vi.fn(async (listener) => {
        editListener = listener;
        return () => undefined;
      }),
    };
    monaco.editor.getModels.mockReturnValue([model]);

    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        applyWorkspaceEdit,
        flushPendingDocumentChange,
        getWorkspaceRoot: () => activeRoot,
        workspaceEditGateway,
      }),
    );
    await vi.waitFor(() => {
      expect(editListener).not.toBeNull();
    });
    const emitWorkspaceEdit = (event: LanguageServerWorkspaceEditEvent) => {
      expect(editListener).not.toBeNull();
      editListener?.(event);
    };

    emitWorkspaceEdit({
      edit: workspaceEdit("file:///project/src/user.ts", "Applied"),
      label: "Organize imports",
      rootPath: "/project",
      sessionId: 1,
    });

    await vi.waitFor(() => {
      expect(flushPendingDocumentChange).toHaveBeenCalledWith(
        "/project/src/user.ts",
      );
    });

    activeRoot = "/other";
    pendingFlush.resolve();
    await flushMicrotasks();

    expect(model.pushEditOperations).not.toHaveBeenCalled();
    expect(applyWorkspaceEdit).not.toHaveBeenCalled();
  });

  it("drops server-initiated workspace edits from stale TypeScript sessions", async () => {
    const monaco = createMonaco();
    const model = textModel();
    const applyWorkspaceEdit = vi.fn(async () => undefined);
    const workspaceEditGateway = {
      subscribeWorkspaceEdits: vi.fn(async (listener) => {
        listener({
          edit: workspaceEdit("file:///project/src/user.ts", "Stale"),
          label: "Old session",
          rootPath: "/project",
          sessionId: 1,
        });
        listener({
          edit: workspaceEdit("file:///project/src/user.ts", "Current"),
          label: "Current session",
          rootPath: "/project",
          sessionId: 2,
        });

        return () => undefined;
      }),
    };
    monaco.editor.getModels.mockReturnValue([model]);

    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        applyWorkspaceEdit,
        getRuntimeStatus: () => ({
          ...runningStatus(),
          rootPath: "/project",
          sessionId: 2,
        }),
        workspaceEditGateway,
      }),
    );
    await vi.waitFor(() => {
      expect(model.pushEditOperations).toHaveBeenCalledTimes(1);
    });

    expect(model.pushEditOperations).toHaveBeenCalledWith(
      [],
      [
        {
          range: expect.objectContaining({
            endColumn: 6,
            endLineNumber: 1,
            startColumn: 2,
            startLineNumber: 1,
          }),
          text: "Current",
        },
      ],
      expect.any(Function),
    );
    expect(applyWorkspaceEdit).toHaveBeenCalledTimes(1);
    expect(applyWorkspaceEdit).toHaveBeenCalledWith(
      workspaceEdit("file:///project/src/user.ts", "Current"),
      {
        applyOpenModels: expect.any(Function),
        openPaths: ["/project/src/user.ts"],
        rootPath: "/project",
      },
    );
  });

  it("drops server-initiated workspace edits while no project tab is active", async () => {
    const monaco = createMonaco();
    const model = textModel();
    const applyWorkspaceEdit = vi.fn(async () => undefined);
    const workspaceEditGateway = {
      subscribeWorkspaceEdits: vi.fn(async (listener) => {
        listener({
          edit: workspaceEdit("file:///project/src/user.ts", "Ignored"),
          label: "Closing project",
          rootPath: "/project",
          sessionId: 1,
        });

        return () => undefined;
      }),
    };
    monaco.editor.getModels.mockReturnValue([model]);

    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        applyWorkspaceEdit,
        getWorkspaceRoot: () => null,
        workspaceEditGateway,
      }),
    );
    await Promise.resolve();

    expect(model.pushEditOperations).not.toHaveBeenCalled();
    expect(applyWorkspaceEdit).not.toHaveBeenCalled();
  });

  it("refreshes CodeLens and inlay hint providers for active server refresh events", async () => {
    const monaco = createMonaco();
    const unsubscribe = vi.fn();
    let refreshListener: ((event: LanguageServerRefreshEvent) => void) | null =
      null;
    const refreshGateway: LanguageServerRefreshGateway = {
      subscribeRefreshEvents: vi.fn(async (listener) => {
        refreshListener = listener;
        return unsubscribe;
      }),
    };
    const disposable = registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        getRuntimeStatus: () => ({
          ...runningStatus(),
          rootPath: "/project",
          sessionId: 2,
        }),
        refreshGateway,
      }),
    );
    await Promise.resolve();
    const codeLensProvider = (monaco.languages.registerCodeLensProvider as any)
      .mock.calls[0][1];
    const inlayHintsProvider = (
      monaco.languages.registerInlayHintsProvider as any
    ).mock.calls[0][1];
    const semanticTokensProvider = (
      monaco.languages.registerDocumentSemanticTokensProvider as any
    ).mock.calls[0][1];
    const codeLensRefresh = vi.fn();
    const inlayHintRefresh = vi.fn();
    const semanticTokensRefresh = vi.fn();
    const codeLensSubscription = codeLensProvider.onDidChange(codeLensRefresh);
    const inlayHintSubscription =
      inlayHintsProvider.onDidChangeInlayHints(inlayHintRefresh);
    const semanticTokensSubscription =
      semanticTokensProvider.onDidChange(semanticTokensRefresh);
    const emitRefresh = (event: LanguageServerRefreshEvent) => {
      expect(refreshListener).not.toBeNull();
      refreshListener?.(event);
    };

    emitRefresh({
      feature: "codeLens",
      rootPath: "/project/",
      sessionId: 2,
    });
    emitRefresh({
      feature: "inlayHint",
      rootPath: "/project",
      sessionId: 2,
    });
    emitRefresh({
      feature: "semanticTokens",
      rootPath: "/project",
      sessionId: 2,
    });
    emitRefresh({
      feature: "codeLens",
      rootPath: "/other",
      sessionId: 2,
    });
    emitRefresh({
      feature: "codeLens",
      sessionId: 2,
    } as any);
    emitRefresh({
      feature: "inlayHint",
      rootPath: "/project",
      sessionId: 1,
    });
    emitRefresh({
      feature: "unknown",
      rootPath: "/project",
      sessionId: 2,
    } as any);

    expect(codeLensRefresh).toHaveBeenCalledTimes(1);
    expect(inlayHintRefresh).toHaveBeenCalledTimes(1);
    expect(semanticTokensRefresh).toHaveBeenCalledTimes(1);

    codeLensSubscription.dispose();
    inlayHintSubscription.dispose();
    semanticTokensSubscription.dispose();
    emitRefresh({
      feature: "codeLens",
      rootPath: "/project",
      sessionId: 2,
    });
    emitRefresh({
      feature: "inlayHint",
      rootPath: "/project",
      sessionId: 2,
    });
    emitRefresh({
      feature: "semanticTokens",
      rootPath: "/project",
      sessionId: 2,
    });

    expect(codeLensRefresh).toHaveBeenCalledTimes(1);
    expect(inlayHintRefresh).toHaveBeenCalledTimes(1);
    expect(semanticTokensRefresh).toHaveBeenCalledTimes(1);

    disposable.dispose();

    expect(unsubscribe).toHaveBeenCalled();
  });
});

function providerContext(
  overrides: Partial<JavaScriptTypeScriptLanguageServerProviderContext> = {},
): JavaScriptTypeScriptLanguageServerProviderContext {
  return {
    applyWorkspaceEdit: overrides.applyWorkspaceEdit,
    completeFunctionCalls: overrides.completeFunctionCalls,
    featuresGateway: overrides.featuresGateway ?? featuresGateway(),
    flushPendingDocumentChange:
      overrides.flushPendingDocumentChange ?? vi.fn(async () => undefined),
    getActiveDocument: overrides.getActiveDocument ?? (() => document()),
    getRuntimeStatus: overrides.getRuntimeStatus ?? (() => runningStatus()),
    getUserSnippets: overrides.getUserSnippets,
    getWorkspaceRoot: overrides.getWorkspaceRoot ?? (() => "/project"),
    limitNavigationResultsToOpenModels:
      overrides.limitNavigationResultsToOpenModels,
    refreshGateway: overrides.refreshGateway,
    reportError: overrides.reportError ?? vi.fn(),
    workspaceEditGateway: overrides.workspaceEditGateway,
  };
}

function featuresGateway(
  responses: Partial<{
    codeActions: Awaited<ReturnType<LanguageServerFeaturesGateway["codeActions"]>>;
    codeLenses: Awaited<ReturnType<LanguageServerFeaturesGateway["codeLenses"]>>;
    completion: Awaited<ReturnType<LanguageServerFeaturesGateway["completion"]>>;
    declaration: Awaited<ReturnType<LanguageServerFeaturesGateway["declaration"]>>;
    definition: Awaited<ReturnType<LanguageServerFeaturesGateway["definition"]>>;
    documentHighlights: Awaited<
      ReturnType<LanguageServerFeaturesGateway["documentHighlights"]>
    >;
    documentLinks: Awaited<ReturnType<LanguageServerFeaturesGateway["documentLinks"]>>;
    documentSymbols: Awaited<
      ReturnType<LanguageServerFeaturesGateway["documentSymbols"]>
    >;
    executeCommandEdit: Awaited<
      ReturnType<LanguageServerFeaturesGateway["executeCommand"]>
    >;
    formatting: Awaited<ReturnType<LanguageServerFeaturesGateway["formatting"]>>;
    foldingRanges: Awaited<
      ReturnType<LanguageServerFeaturesGateway["foldingRanges"]>
    >;
    implementation: Awaited<
      ReturnType<LanguageServerFeaturesGateway["implementation"]>
    >;
    inlayHints: Awaited<ReturnType<LanguageServerFeaturesGateway["inlayHints"]>>;
    linkedEditingRanges: Awaited<
      ReturnType<LanguageServerFeaturesGateway["linkedEditingRanges"]>
    >;
    prepareRename: Awaited<
      ReturnType<LanguageServerFeaturesGateway["prepareRename"]>
    >;
    onTypeFormatting: Awaited<
      ReturnType<LanguageServerFeaturesGateway["onTypeFormatting"]>
    >;
    references: Awaited<ReturnType<LanguageServerFeaturesGateway["references"]>>;
    rangeFormatting: Awaited<
      ReturnType<LanguageServerFeaturesGateway["rangeFormatting"]>
    >;
    rangeSemanticTokens: Awaited<
      ReturnType<LanguageServerFeaturesGateway["rangeSemanticTokens"]>
    >;
    rename: Awaited<ReturnType<LanguageServerFeaturesGateway["rename"]>>;
    selectionRanges: Awaited<
      ReturnType<LanguageServerFeaturesGateway["selectionRanges"]>
    >;
    semanticTokens: Awaited<
      ReturnType<LanguageServerFeaturesGateway["semanticTokens"]>
    >;
    signatureHelp: Awaited<
      ReturnType<LanguageServerFeaturesGateway["signatureHelp"]>
    >;
    workspaceSymbols: Awaited<
      ReturnType<LanguageServerFeaturesGateway["workspaceSymbols"]>
    >;
    typeDefinition: Awaited<
      ReturnType<LanguageServerFeaturesGateway["typeDefinition"]>
    >;
    resolvedCodeAction: Awaited<
      ReturnType<LanguageServerFeaturesGateway["resolveCodeAction"]>
    >;
    resolvedCodeLens: Awaited<
      ReturnType<LanguageServerFeaturesGateway["resolveCodeLens"]>
    >;
    resolvedCompletionItem: Awaited<
      ReturnType<LanguageServerFeaturesGateway["resolveCompletionItem"]>
    >;
    resolvedDocumentLink: Awaited<
      ReturnType<LanguageServerFeaturesGateway["resolveDocumentLink"]>
    >;
    resolvedInlayHint: Awaited<
      ReturnType<LanguageServerFeaturesGateway["resolveInlayHint"]>
    >;
  }> = {},
): LanguageServerFeaturesGateway {
  return {
    codeActions: vi.fn(async () => responses.codeActions ?? []),
    codeLenses: vi.fn(async () => responses.codeLenses ?? []),
    completion: vi.fn(
      async () =>
        responses.completion ?? {
          isIncomplete: false,
          items: [],
        },
    ),
    declaration: vi.fn(async () => responses.declaration ?? []),
    definition: vi.fn(async () => responses.definition ?? []),
    didChangeConfiguration: vi.fn(async () => undefined),
    didChangeWatchedFiles: vi.fn(async () => undefined),
    didCreateFiles: vi.fn(async () => undefined),
    didDeleteFiles: vi.fn(async () => undefined),
    didRenameFiles: vi.fn(async () => undefined),
    documentHighlights: vi.fn(
      async () => responses.documentHighlights ?? [],
    ),
    documentLinks: vi.fn(async () => responses.documentLinks ?? []),
    documentSymbols: vi.fn(async () => responses.documentSymbols ?? []),
    executeCommand: vi.fn(async () => responses.executeCommandEdit ?? null),
    executeCommandLocations: vi.fn(async () => []),
    foldingRanges: vi.fn(async () => responses.foldingRanges ?? []),
    formatting: vi.fn(async () => responses.formatting ?? []),
    hover: vi.fn(async () => null),
    incomingCalls: vi.fn(async () => []),
    implementation: vi.fn(async () => responses.implementation ?? []),
    inlayHints: vi.fn(async () => responses.inlayHints ?? []),
    linkedEditingRanges: vi.fn(
      async () => responses.linkedEditingRanges ?? null,
    ),
    onTypeFormatting: vi.fn(async () => responses.onTypeFormatting ?? []),
    outgoingCalls: vi.fn(async () => []),
    prepareCallHierarchy: vi.fn(async () => []),
    prepareRename: vi.fn(async () => responses.prepareRename ?? null),
    prepareTypeHierarchy: vi.fn(async () => []),
    rangeFormatting: vi.fn(async () => responses.rangeFormatting ?? []),
    rangeSemanticTokens: vi.fn(
      async () => responses.rangeSemanticTokens ?? null,
    ),
    references: vi.fn(async () => responses.references ?? []),
    rename: vi.fn(async () => responses.rename ?? null),
    selectionRanges: vi.fn(async () => responses.selectionRanges ?? []),
    semanticTokens: vi.fn(async () => responses.semanticTokens ?? null),
    signatureHelp: vi.fn(async () => responses.signatureHelp ?? null),
    sourceDefinition: vi.fn(async () => []),
    typeDefinition: vi.fn(async () => responses.typeDefinition ?? []),
    typeHierarchySubtypes: vi.fn(async () => []),
    typeHierarchySupertypes: vi.fn(async () => []),
    willCreateFiles: vi.fn(async () => null),
    willDeleteFiles: vi.fn(async () => null),
    willRenameFiles: vi.fn(async () => null),
    workspaceSymbols: vi.fn(async () => responses.workspaceSymbols ?? []),
    resolveCompletionItem: vi.fn(
      async (_rootPath, item) => responses.resolvedCompletionItem ?? item,
    ),
    resolveCodeAction: vi.fn(
      async (_rootPath, action) => responses.resolvedCodeAction ?? action,
    ),
    resolveCodeLens: vi.fn(
      async (_rootPath, lens) => responses.resolvedCodeLens ?? lens,
    ),
    resolveDocumentLink: vi.fn(
      async (_rootPath, link) => responses.resolvedDocumentLink ?? link,
    ),
    resolveInlayHint: vi.fn(
      async (_rootPath, hint) => responses.resolvedInlayHint ?? hint,
    ),
  };
}

function runningStatus(
  capabilities: Partial<LanguageServerRuntimeCapabilities> = {},
): LanguageServerRuntimeStatus {
  return {
    capabilities: {
      callHierarchy: true,
      codeAction: true,
      codeActionResolve: true,
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

function providerLanguages(registerProvider: unknown): string[] {
  return (registerProvider as { mock: { calls: Array<[string]> } }).mock.calls.map(
    ([language]) => language,
  );
}

async function flushMicrotasks(ticks = 8): Promise<void> {
  for (let index = 0; index < ticks; index += 1) {
    await Promise.resolve();
  }
}

function document(): EditorDocument {
  return {
    content: "const user = account;",
    language: "typescript",
    name: "user.ts",
    path: "/project/src/user.ts",
    savedContent: "const user = account;",
  };
}

function textModel() {
  let value = "const user = account;";

  return {
    getValue: vi.fn(() => value),
    getVersionId: vi.fn(() => 7),
    getValueInRange: vi.fn(() => "user"),
    getWordAtPosition: vi.fn(() => ({
      endColumn: 5,
      startColumn: 1,
      word: "user",
    })),
    getWordUntilPosition: vi.fn(() => ({
      endColumn: 5,
      startColumn: 1,
    })),
    pushEditOperations: vi.fn(
      (_selections, edits: Array<{ text: string }>) => {
        value = edits[edits.length - 1]?.text ?? value;
      },
    ),
    uri: {
      fsPath: "/project/src/user.ts",
      path: "/project/src/user.ts",
    },
  };
}

function stagedTextModel(path: string, initialContent: string, initialVersion: number) {
  let content = initialContent;
  let versionId = initialVersion;

  return {
    ...textModel(),
    getValue: vi.fn(() => content),
    getVersionId: vi.fn(() => versionId),
    pushEditOperations: vi.fn(),
    setSnapshot(nextContent: string, nextVersion: number) {
      content = nextContent;
      versionId = nextVersion;
    },
    uri: { fsPath: path, path },
  };
}

function textEditAt(
  newText: string,
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number,
) {
  return {
    newText,
    range: {
      end: { character: endCharacter, line: endLine },
      start: { character: startCharacter, line: startLine },
    },
  };
}

function workspaceEditCommandPayload(path: string) {
  return {
    command: {
      arguments: [],
      command: "_typescript.organizeImports",
      title: "Organize Imports",
    },
    path,
    rootPath: "/project",
    sessionId: 1,
  };
}

/**
 * A text model whose word-under-cursor and line content are controllable, so
 * snippet-completion tests can drive the typed prefix and the member-access
 * suppression path (character before the word).
 */
function snippetWordModel(
  word: string,
  options: {
    endColumn?: number;
    lineContent?: string;
    startColumn?: number;
  } = {},
) {
  const startColumn = options.startColumn ?? 1;
  const endColumn = options.endColumn ?? startColumn + word.length;
  const lineContent = options.lineContent ?? word;

  return {
    ...textModel(),
    getLineContent: vi.fn(() => lineContent),
    getValue: vi.fn(() => lineContent),
    getWordUntilPosition: vi.fn(() => ({
      endColumn,
      startColumn,
      word,
    })),
  };
}

function workspaceEdit(uri: string, newText: string) {
  return {
    changes: {
      [uri]: [
        {
          newText,
          range: range(0, 1, 0, 5),
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

function createMonaco() {
  const dispose = vi.fn();
  const disposable = () => ({ dispose });

  class Range {
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
  }

  return {
    dispose,
    editor: {
      addCommand: vi.fn(() => disposable()),
      getModel: vi.fn(() => null),
      getModels: vi.fn((): any[] => []),
    },
    languages: {
      CodeActionTriggerType: { Invoke: 1 },
      CompletionItemInsertTextRule: { InsertAsSnippet: 4, KeepWhitespace: 1 },
      CompletionItemKind: {
        Class: 7,
        Constant: 21,
        Enum: 13,
        EnumMember: 20,
        Field: 5,
        File: 17,
        Function: 3,
        Interface: 8,
        Keyword: 14,
        Method: 2,
        Module: 9,
        Property: 10,
        Snippet: 15,
        Text: 1,
        Value: 12,
        Variable: 6,
      },
      CompletionItemTag: {
        Deprecated: 1,
      },
      DocumentHighlightKind: {
        Read: 1,
        Text: 0,
        Write: 2,
      },
      FoldingRangeKind: {
        fromValue: vi.fn((value: string) => ({ value })),
      },
      InlayHintKind: {
        Parameter: 2,
        Type: 1,
      },
      SymbolKind: {
        Array: 17,
        Boolean: 16,
        Class: 4,
        Constant: 13,
        Constructor: 8,
        Enum: 9,
        EnumMember: 21,
        Event: 23,
        Field: 7,
        File: 0,
        Function: 11,
        Interface: 10,
        Key: 19,
        Method: 5,
        Module: 1,
        Namespace: 2,
        Null: 20,
        Number: 15,
        Object: 18,
        Operator: 24,
        Package: 3,
        Property: 6,
        String: 14,
        Struct: 22,
        TypeParameter: 25,
        Variable: 12,
      },
      SymbolTag: {
        Deprecated: 1,
      },
      registerCodeActionProvider: vi.fn(() => disposable()),
      registerCodeLensProvider: vi.fn(() => disposable()),
      registerCompletionItemProvider: vi.fn(() => disposable()),
      registerDeclarationProvider: vi.fn(() => disposable()),
      registerDefinitionProvider: vi.fn(() => disposable()),
      registerDocumentHighlightProvider: vi.fn(() => disposable()),
      registerDocumentFormattingEditProvider: vi.fn(() => disposable()),
      registerDocumentRangeFormattingEditProvider: vi.fn(() => disposable()),
      registerDocumentSymbolProvider: vi.fn(() => disposable()),
      registerFoldingRangeProvider: vi.fn(() => disposable()),
      registerHoverProvider: vi.fn(() => disposable()),
      registerImplementationProvider: vi.fn(() => disposable()),
      registerInlayHintsProvider: vi.fn(() => disposable()),
      registerLinkProvider: vi.fn(() => disposable()),
      registerLinkedEditingRangeProvider: vi.fn(() => disposable()),
      registerOnTypeFormattingEditProvider: vi.fn(() => disposable()),
      registerReferenceProvider: vi.fn(() => disposable()),
      registerRenameProvider: vi.fn(() => disposable()),
      registerSelectionRangeProvider: vi.fn(() => disposable()),
      registerDocumentSemanticTokensProvider: vi.fn(() => disposable()),
      registerDocumentRangeSemanticTokensProvider: vi.fn(() => disposable()),
      registerSignatureHelpProvider: vi.fn(() => disposable()),
      registerTypeDefinitionProvider: vi.fn(() => disposable()),
      registerWorkspaceSymbolProvider: vi.fn(() => disposable()),
    },
    MarkerSeverity: {
      Error: 8,
      Hint: 1,
      Info: 2,
      Warning: 4,
    },
    Range,
    Uri: {
      file: (path: string) => ({ fsPath: path, path }),
    },
  };
}
