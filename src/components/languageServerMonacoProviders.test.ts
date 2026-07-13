import { describe, expect, it, vi } from "vitest";
import { URI } from "monaco-editor/esm/vs/base/common/uri.js";
import {
  registerLanguageServerMonacoProviders,
  type PhpWorkspaceEditApplicationContext,
} from "./languageServerMonacoProviders";
import { workspaceModelUri } from "./phpMonacoDocumentContext";
import type {
  LanguageServerCompletionList,
  LanguageServerCodeAction,
  LanguageServerCodeLens,
  LanguageServerDocumentHighlight,
  LanguageServerDocumentLink,
  LanguageServerDocumentSymbol,
  LanguageServerFeaturesGateway,
  LanguageServerHover,
  LanguageServerInlayHint,
  LanguageServerLinkedEditingRanges,
  LanguageServerLocation,
  LanguageServerRange,
  LanguageServerRefreshEvent,
  LanguageServerRefreshGateway,
  LanguageServerSemanticTokens,
  LanguageServerWorkspaceEdit,
  LanguageServerWorkspaceEditEvent,
  LanguageServerWorkspaceEditGateway,
} from "../domain/languageServerFeatures";
import type {
  LanguageServerRuntimeCapabilities,
  LanguageServerRuntimeStatus,
} from "../domain/languageServerRuntime";
import type {
  PhpMethodCompletion,
  PhpMethodSignature,
} from "../domain/phpMethodCompletions";
import {
  phpFrameworkScopedStringCompletionContextAt,
  phpLaravelFrameworkProvider,
} from "../domain/phpFrameworkProviders";
import type { UserSnippet } from "../domain/snippets";
import type { EditorDocument } from "../domain/workspace";

describe("registerLanguageServerMonacoProviders", () => {
  it("registers php hover, completion, signature, code action, selection range, rename, reference, definition, declaration, implementation, type definition, document highlight, document symbol, workspace symbol, document link, code lens, inlay hint, folding range, formatting, range formatting, on type formatting, linked editing range and semantic token providers and disposes them", () => {
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
      ".",
    ]);
    expect(registered.signatureLanguage).toBe("php");
    expect(registered.codeActionLanguage).toBe("php");
    expect(registered.latteCodeActionLanguage).toBe("latte");
    expect(registered.latteCodeActionMetadata).toEqual({
      providedCodeActionKinds: ["quickfix"],
    });
    expect(registered.selectionRangeLanguage).toBe("php");
    expect(registered.renameLanguage).toBe("php");
    expect(registered.referenceLanguage).toBe("php");
    expect(registered.definitionLanguage).toBe("php");
    expect(registered.declarationLanguage).toBe("php");
    expect(registered.implementationLanguage).toBe("php");
    expect(registered.typeDefinitionLanguage).toBe("php");
    expect(registered.documentHighlightLanguage).toBe("php");
    expect(registered.documentSymbolLanguage).toBe("php");
    expect(
      registered.monaco.languages.registerWorkspaceSymbolProvider,
    ).toHaveBeenCalledTimes(1);
    expect(registered.workspaceSymbolProvider).toEqual(
      expect.objectContaining({
        provideWorkspaceSymbols: expect.any(Function),
      }),
    );
    expect(registered.documentLinkLanguage).toBe("php");
    expect(registered.codeLensLanguage).toBe("php");
    expect(registered.inlayHintsLanguage).toBe("php");
    expect(registered.foldingRangeLanguage).toBe("php");
    expect(registered.documentFormattingLanguage).toBe("php");
    expect(registered.rangeFormattingLanguage).toBe("php");
    expect(registered.onTypeFormattingLanguage).toBe("php");
    expect(registered.onTypeFormattingProvider.autoFormatTriggerCharacters).toEqual(
      [],
    );
    expect(registered.linkedEditingRangeLanguage).toBe("php");
    expect(registered.documentSemanticTokensLanguage).toBe("php");
    expect(registered.rangeSemanticTokensLanguage).toBe("php");
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
    expect(registered.latteCodeActionDispose).toHaveBeenCalled();
    expect(registered.selectionRangeDispose).toHaveBeenCalled();
    expect(registered.renameDispose).toHaveBeenCalled();
    expect(registered.referenceDispose).toHaveBeenCalled();
    expect(registered.definitionDispose).toHaveBeenCalled();
    expect(registered.declarationDispose).toHaveBeenCalled();
    expect(registered.implementationDispose).toHaveBeenCalled();
    expect(registered.typeDefinitionDispose).toHaveBeenCalled();
    expect(registered.documentHighlightDispose).toHaveBeenCalled();
    expect(registered.documentSymbolDispose).toHaveBeenCalled();
    expect(registered.workspaceSymbolDispose).toHaveBeenCalled();
    expect(registered.documentLinkDispose).toHaveBeenCalled();
    expect(registered.codeLensDispose).toHaveBeenCalled();
    expect(registered.inlayHintsDispose).toHaveBeenCalled();
    expect(registered.foldingRangeDispose).toHaveBeenCalled();
    expect(registered.documentFormattingDispose).toHaveBeenCalled();
    expect(registered.rangeFormattingDispose).toHaveBeenCalled();
    expect(registered.onTypeFormattingDispose).toHaveBeenCalled();
    expect(registered.linkedEditingRangeDispose).toHaveBeenCalled();
    expect(registered.documentSemanticTokensDispose).toHaveBeenCalled();
    expect(registered.rangeSemanticTokensDispose).toHaveBeenCalled();
  });

  it("fires PHP provider refresh events only for the active root and session", async () => {
    const registered = createRegisteredProviders();
    let refreshListener: ((event: LanguageServerRefreshEvent) => void) | null =
      null;
    const refreshGateway: LanguageServerRefreshGateway = {
      subscribeRefreshEvents: vi.fn(async (listener) => {
        refreshListener = listener;
        return () => undefined;
      }),
    };
    registerLanguageServerMonacoProviders(
      registered.monaco,
      providerContext({ refreshGateway }),
    );
    await Promise.resolve();
    const codeLensChanged = vi.fn();
    const inlayHintsChanged = vi.fn();
    const semanticTokensChanged = vi.fn();
    registered.codeLensProvider.onDidChange(codeLensChanged);
    registered.inlayHintsProvider.onDidChangeInlayHints(inlayHintsChanged);
    registered.documentSemanticTokensProvider.onDidChange(semanticTokensChanged);
    const emitRefreshEvent = (event: LanguageServerRefreshEvent) => {
      if (!refreshListener) {
        throw new Error("Refresh listener was not registered");
      }

      refreshListener(event);
    };

    emitRefreshEvent({
      feature: "codeLens",
      rootPath: "/project",
      sessionId: 1,
    });
    emitRefreshEvent({
      feature: "inlayHint",
      rootPath: "/project",
      sessionId: 1,
    });
    emitRefreshEvent({
      feature: "semanticTokens",
      rootPath: "/project",
      sessionId: 1,
    });
    emitRefreshEvent({
      feature: "codeLens",
      rootPath: "/other",
      sessionId: 1,
    });
    emitRefreshEvent({
      feature: "inlayHint",
      rootPath: "/project",
      sessionId: 2,
    });

    expect(codeLensChanged).toHaveBeenCalledTimes(1);
    expect(inlayHintsChanged).toHaveBeenCalledTimes(1);
    expect(semanticTokensChanged).toHaveBeenCalledTimes(1);
  });

  it("unsubscribes PHP provider refresh events when disposed before subscription resolves", async () => {
    const registered = createRegisteredProviders();
    const unsubscribe = vi.fn();
    const subscription = createDeferred<() => void>();
    const refreshGateway: LanguageServerRefreshGateway = {
      subscribeRefreshEvents: vi.fn(async () => subscription.promise),
    };
    const disposable = registerLanguageServerMonacoProviders(
      registered.monaco,
      providerContext({ refreshGateway }),
    );

    disposable.dispose();
    subscription.resolve(unsubscribe);

    await vi.waitFor(() => {
      expect(unsubscribe).toHaveBeenCalled();
    });
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

  it("skips expensive PHP smart providers for large active PHP documents without syncing", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway();
    const flushPendingDocumentChange = vi.fn(async () => undefined);
    const providePhpMethodCompletions = vi.fn(async () => []);
    const providePhpMethodSignature = vi.fn(async () => null);
    const providePhpParameterInlayHints = vi.fn(async () => []);
    const largeDocument = {
      ...document(),
      content: `<?php\n${"a".repeat(17 * 1024)}`,
      path: "/project/vendor/CarbonInterface.php",
    };
    const context = providerContext({
      activeDocument: largeDocument,
      featuresGateway: gateway,
      flushPendingDocumentChange,
      getLargeSmartDocumentPolicy: () => ({
        characterLimit: 16 * 1024,
        lineLimit: 500,
      }),
      providePhpMethodCompletions,
      providePhpMethodSignature,
      providePhpParameterInlayHints,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);
    const largeModel = model({ path: largeDocument.path });

    await expect(
      registered.hoverProvider.provideHover(largeModel, position()),
    ).resolves.toBeNull();
    await expect(
      registered.completionProvider.provideCompletionItems(
        largeModel,
        position(),
      ),
    ).resolves.toEqual({ suggestions: [] });
    await expect(
      registered.definitionProvider.provideDefinition(largeModel, position()),
    ).resolves.toBeNull();
    await expect(
      registered.referenceProvider.provideReferences(largeModel, position(), {}),
    ).resolves.toBeNull();
    await expect(
      registered.implementationProvider.provideImplementation(
        largeModel,
        position(),
      ),
    ).resolves.toBeNull();
    await expect(
      registered.typeDefinitionProvider.provideTypeDefinition(
        largeModel,
        position(),
      ),
    ).resolves.toBeNull();
    await expect(
      registered.documentLinkProvider.provideLinks(largeModel),
    ).resolves.toEqual({ dispose: expect.any(Function), links: [] });
    await expect(
      registered.codeLensProvider.provideCodeLenses(largeModel),
    ).resolves.toEqual({ dispose: expect.any(Function), lenses: [] });
    await expect(
      registered.inlayHintsProvider.provideInlayHints(
        largeModel,
        new registered.monaco.Range(1, 1, 1, 5),
      ),
    ).resolves.toEqual({ dispose: expect.any(Function), hints: [] });
    await expect(
      registered.foldingRangeProvider.provideFoldingRanges(largeModel),
    ).resolves.toBeNull();
    await expect(
      registered.documentSemanticTokensProvider.provideDocumentSemanticTokens(
        largeModel,
      ),
    ).resolves.toBeNull();
    await expect(
      registered.rangeSemanticTokensProvider.provideDocumentRangeSemanticTokens(
        largeModel,
        new registered.monaco.Range(1, 1, 1, 5),
      ),
    ).resolves.toBeNull();

    expect(largeModel.getValue).not.toHaveBeenCalled();
    expect(flushPendingDocumentChange).not.toHaveBeenCalled();
    expect(providePhpMethodCompletions).not.toHaveBeenCalled();
    expect(providePhpMethodSignature).not.toHaveBeenCalled();
    expect(providePhpParameterInlayHints).not.toHaveBeenCalled();
    expect(gateway.hover).not.toHaveBeenCalled();
    expect(gateway.completion).not.toHaveBeenCalled();
    expect(gateway.definition).not.toHaveBeenCalled();
    expect(gateway.references).not.toHaveBeenCalled();
    expect(gateway.implementation).not.toHaveBeenCalled();
    expect(gateway.typeDefinition).not.toHaveBeenCalled();
    expect(gateway.documentLinks).not.toHaveBeenCalled();
    expect(gateway.codeLenses).not.toHaveBeenCalled();
    expect(gateway.inlayHints).not.toHaveBeenCalled();
    expect(gateway.foldingRanges).not.toHaveBeenCalled();
    expect(gateway.semanticTokens).not.toHaveBeenCalled();
    expect(gateway.rangeSemanticTokens).not.toHaveBeenCalled();
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

  it("drops PHP hover when the Monaco cancellation token is cancelled after the response", async () => {
    const registered = createRegisteredProviders();
    const hover = createDeferred<LanguageServerHover | null>();
    const gateway = featuresGateway();
    vi.mocked(gateway.hover).mockImplementationOnce(async () => hover.promise);
    const context = providerContext({ featuresGateway: gateway });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const token = { isCancellationRequested: false };
    const hoverPromise = registered.hoverProvider.provideHover(
      model(),
      position(),
      token,
    );

    await Promise.resolve();
    token.isCancellationRequested = true;
    hover.resolve({ contents: "**Stale user**" });

    await expect(hoverPromise).resolves.toBeNull();
  });

  it("resolves PHP hover to null when phpactor does not respond before the timeout", async () => {
    vi.useFakeTimers();

    try {
      const registered = createRegisteredProviders();
      const hover = createDeferred<LanguageServerHover | null>();
      const gateway = featuresGateway();
      vi.mocked(gateway.hover).mockImplementationOnce(async () => hover.promise);
      const context = providerContext({ featuresGateway: gateway });
      registerLanguageServerMonacoProviders(registered.monaco, context);

      const token = { isCancellationRequested: false };
      const hoverPromise = registered.hoverProvider.provideHover(
        model(),
        position(),
        token,
      );

      await vi.advanceTimersByTimeAsync(5000);

      await expect(hoverPromise).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("resolves PHP hover to null within the shorter hover timeout budget", async () => {
    vi.useFakeTimers();

    try {
      const registered = createRegisteredProviders();
      const hover = createDeferred<LanguageServerHover | null>();
      const gateway = featuresGateway();
      vi.mocked(gateway.hover).mockImplementationOnce(async () => hover.promise);
      const context = providerContext({ featuresGateway: gateway });
      registerLanguageServerMonacoProviders(registered.monaco, context);

      const token = { isCancellationRequested: false };
      const hoverPromise = registered.hoverProvider.provideHover(
        model(),
        position(),
        token,
      );

      await vi.advanceTimersByTimeAsync(700);

      await expect(hoverPromise).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the full navigation timeout budget for PHP definition (still pending at the hover timeout)", async () => {
    vi.useFakeTimers();

    try {
      const registered = createRegisteredProviders();
      const locations = createDeferred<LanguageServerLocation[]>();
      const gateway = featuresGateway();
      vi.mocked(gateway.definition).mockImplementationOnce(
        async () => locations.promise,
      );
      const context = providerContext({ featuresGateway: gateway });
      registerLanguageServerMonacoProviders(registered.monaco, context);

      const token = { isCancellationRequested: false };
      const definitionPromise = registered.definitionProvider.provideDefinition(
        model(),
        position(),
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

  it("returns PHP hover when phpactor responds before the timeout and the token stays active", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      hover: { contents: "**Warm user**" },
    });
    const context = providerContext({ featuresGateway: gateway });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const token = { isCancellationRequested: false };

    await expect(
      registered.hoverProvider.provideHover(model(), position(), token),
    ).resolves.toEqual({
      contents: [{ value: "**Warm user**" }],
    });
  });

  it("drops PHP definition when the Monaco cancellation token is cancelled after the response", async () => {
    const registered = createRegisteredProviders();
    const locations = createDeferred<LanguageServerLocation[]>();
    const gateway = featuresGateway();
    vi.mocked(gateway.definition).mockImplementationOnce(
      async () => locations.promise,
    );
    const context = providerContext({ featuresGateway: gateway });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const token = { isCancellationRequested: false };
    const definitionPromise = registered.definitionProvider.provideDefinition(
      model(),
      position(),
      token,
    );

    await Promise.resolve();
    token.isCancellationRequested = true;
    locations.resolve([
      {
        range: range(1, 6, 1, 10),
        uri: "file:///project/src/Models/User.php",
      },
    ]);

    await expect(definitionPromise).resolves.toBeNull();
  });

  it("resolves PHP definition to null when phpactor does not respond before the timeout", async () => {
    vi.useFakeTimers();

    try {
      const registered = createRegisteredProviders();
      const locations = createDeferred<LanguageServerLocation[]>();
      const gateway = featuresGateway();
      vi.mocked(gateway.definition).mockImplementationOnce(
        async () => locations.promise,
      );
      const context = providerContext({ featuresGateway: gateway });
      registerLanguageServerMonacoProviders(registered.monaco, context);

      const token = { isCancellationRequested: false };
      const definitionPromise = registered.definitionProvider.provideDefinition(
        model(),
        position(),
        token,
      );

      await vi.advanceTimersByTimeAsync(5000);

      await expect(definitionPromise).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
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

  it("maps PHP completion additional text edits to Monaco edits", async () => {
    const registered = createRegisteredProviders();
    const source = phpCompletionFixtureSource();
    const gateway = featuresGateway({
      completion: {
        isIncomplete: false,
        items: [
          {
            additionalTextEdits: [
              {
                newText: "use App\\Models\\User;\n",
                range: range(2, 0, 2, 0),
              },
            ],
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

    const result = await registered.completionProvider.provideCompletionItems(
      model({ content: source }),
      position(),
    );
    const suggestion = result.suggestions.find(
      (item: { label: string }) => item.label === "User",
    );

    expect(suggestion.additionalTextEdits).toEqual([
      {
        range: {
          endColumn: 1,
          endLineNumber: 3,
          startColumn: 1,
          startLineNumber: 3,
        },
        text: "use App\\Models\\User;\n",
      },
    ]);
  });

  it("maps every additional text edit from a PHP completion", async () => {
    const registered = createRegisteredProviders();
    const source = phpCompletionFixtureSource();
    const gateway = featuresGateway({
      completion: {
        isIncomplete: false,
        items: [
          {
            additionalTextEdits: [
              {
                newText: "use App\\Contracts\\Identifiable;\n",
                range: range(2, 0, 2, 0),
              },
              {
                newText: "use App\\Models\\User;\n",
                range: range(3, 4, 3, 4),
              },
            ],
            detail: "class",
            documentation: null,
            insertText: "User",
            kind: 7,
            label: "User",
          },
        ],
      },
    });
    const context = providerContext({ featuresGateway: gateway });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const result = await registered.completionProvider.provideCompletionItems(
      model({ content: source }),
      position(),
    );
    const suggestion = result.suggestions.find(
      (item: { label: string }) => item.label === "User",
    );

    expect(suggestion.additionalTextEdits).toEqual([
      {
        range: {
          endColumn: 1,
          endLineNumber: 3,
          startColumn: 1,
          startLineNumber: 3,
        },
        text: "use App\\Contracts\\Identifiable;\n",
      },
      {
        range: {
          endColumn: 5,
          endLineNumber: 4,
          startColumn: 5,
          startLineNumber: 4,
        },
        text: "use App\\Models\\User;\n",
      },
    ]);
  });

  it("forwards the PHP completion incomplete flag so Monaco re-queries while typing", async () => {
    const registered = createRegisteredProviders();
    const source = phpCompletionFixtureSource();
    const gateway = featuresGateway({
      completion: {
        isIncomplete: true,
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

    const result = await registered.completionProvider.provideCompletionItems(
      model({ content: source }),
      position(),
    );

    expect(result.incomplete).toBe(true);
  });

  it("records the completion round-trip latency when the language server responds", async () => {
    const registered = createRegisteredProviders();
    const source = phpCompletionFixtureSource();
    const gateway = featuresGateway({
      completion: { isIncomplete: false, items: [] },
    });
    const recordCompletionLatency = vi.fn();
    const context = {
      ...providerContext({ featuresGateway: gateway }),
      recordCompletionLatency,
    };
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await registered.completionProvider.provideCompletionItems(
      model({ content: source }),
      position(),
    );

    expect(recordCompletionLatency).toHaveBeenCalledTimes(1);
    expect(recordCompletionLatency.mock.calls[0][0]).toBeGreaterThanOrEqual(0);
    expect(recordCompletionLatency.mock.calls[0][1]).toBe("/project");
  });

  it("does not record a latency sample when the completion request times out", async () => {
    vi.useFakeTimers();

    try {
      const registered = createRegisteredProviders();
      const source = phpCompletionFixtureSource();
      const completion = createDeferred<LanguageServerCompletionList>();
      const gateway = featuresGateway();
      vi.mocked(gateway.completion).mockImplementationOnce(
        async () => completion.promise,
      );
      const recordCompletionLatency = vi.fn();
      const context = {
        ...providerContext({ featuresGateway: gateway }),
        recordCompletionLatency,
      };
      registerLanguageServerMonacoProviders(registered.monaco, context);

      const completionPromise =
        registered.completionProvider.provideCompletionItems(
          model({ content: source }),
          position(),
        );

      await vi.advanceTimersByTimeAsync(5000);
      await completionPromise;

      // The timeout sentinel must not pollute the completion latency metric with
      // a synthetic ~timeout-budget sample.
      expect(recordCompletionLatency).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns locally-computed PHP suggestions when the language server does not respond before the timeout", async () => {
    vi.useFakeTimers();

    try {
      const registered = createRegisteredProviders();
      const source = phpCompletionFixtureSource();
      const completion = createDeferred<LanguageServerCompletionList>();
      const gateway = featuresGateway();
      vi.mocked(gateway.completion).mockImplementationOnce(
        async () => completion.promise,
      );
      const context = providerContext({ featuresGateway: gateway });
      registerLanguageServerMonacoProviders(registered.monaco, context);

      const completionPromise =
        registered.completionProvider.provideCompletionItems(
          model({ content: source }),
          position(),
        );

      await vi.advanceTimersByTimeAsync(5000);

      await expect(completionPromise).resolves.toEqual({
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
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops PHP completion when the Monaco cancellation token is cancelled after the response", async () => {
    const registered = createRegisteredProviders();
    const source = phpCompletionFixtureSource();
    const completion = createDeferred<LanguageServerCompletionList>();
    const gateway = featuresGateway();
    vi.mocked(gateway.completion).mockImplementationOnce(
      async () => completion.promise,
    );
    const context = providerContext({ featuresGateway: gateway });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const token = { isCancellationRequested: false };
    const completionPromise =
      registered.completionProvider.provideCompletionItems(
        model({ content: source }),
        position(),
        undefined,
        token,
      );

    for (
      let tick = 0;
      tick < 5 && vi.mocked(gateway.completion).mock.calls.length === 0;
      tick += 1
    ) {
      await Promise.resolve();
    }
    token.isCancellationRequested = true;
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
  });

  it("requests PHP method suggestions and language server completion concurrently", async () => {
    const registered = createRegisteredProviders();
    const source = phpCompletionFixtureSource();
    const method = createDeferred<PhpMethodCompletion[]>();
    const gateway = featuresGateway();
    const context = providerContext({
      featuresGateway: gateway,
      providePhpMethodCompletions: vi.fn(async () => method.promise),
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const completionPromise =
      registered.completionProvider.provideCompletionItems(
        model({ content: source }),
        position(),
      );

    // The language-server completion must be issued while the method collector
    // is still pending; a serial implementation would not call it until the
    // method promise resolves.
    for (
      let tick = 0;
      tick < 10 && vi.mocked(gateway.completion).mock.calls.length === 0;
      tick += 1
    ) {
      await Promise.resolve();
    }

    expect(gateway.completion).toHaveBeenCalledTimes(1);

    method.resolve([]);
    await completionPromise;
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

  it("inserts Laravel config key completions as plain string suffixes", async () => {
    const registered = createRegisteredProviders();
    const providePhpMethodCompletions = vi.fn(async () => [
      {
        declaringClassName: "config/app.php",
        insertText: "name",
        kind: "config" as const,
        name: "app.name",
        parameters: "",
        returnType: null,
      },
    ]);
    const context = providerContext({
      activeDocument: {
        ...document(),
        content:
          "<?php\nfunction name(): string\n{\n    return config('app.na');\n}\n",
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
        lineContent: "    return config('app.na');",
        word: {
          endColumn: 30,
          startColumn: 28,
        },
      }),
      {
        column: 30,
        lineNumber: 4,
      },
    );

    expect(result.suggestions).toEqual([
      expect.objectContaining({
        command: undefined,
        detail: "Laravel config - config/app.php",
        documentation: "Laravel config\n\napp.name",
        insertText: "name",
        insertTextRules: 4,
        kind: 12,
        label: {
          description: "config - config/app.php",
          detail: "",
          label: "app.name",
        },
      }),
    ]);
  });

  it("inserts Laravel env key completions as plain strings", async () => {
    const registered = createRegisteredProviders();
    const providePhpMethodCompletions = vi.fn(async () => [
      {
        declaringClassName: ".env",
        insertText: "APP_NAME",
        kind: "env" as const,
        name: "APP_NAME",
        parameters: "",
        returnType: null,
      },
    ]);
    const context = providerContext({
      activeDocument: {
        ...document(),
        content:
          "<?php\nfunction name(): string\n{\n    return env('APP_NA');\n}\n",
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
        lineContent: "    return env('APP_NA');",
        word: {
          endColumn: 25,
          startColumn: 19,
        },
      }),
      {
        column: 25,
        lineNumber: 4,
      },
    );

    expect(result.suggestions).toEqual([
      expect.objectContaining({
        command: undefined,
        detail: "Laravel env - .env",
        documentation: "Laravel env\n\nAPP_NAME",
        insertText: "APP_NAME",
        insertTextRules: 4,
        kind: 12,
        label: {
          description: "env - .env",
          detail: "",
          label: "APP_NAME",
        },
      }),
    ]);
  });

  it("inserts Laravel database connection completions as plain string suffixes", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      completion: {
        isIncomplete: false,
        items: [
          {
            detail: null,
            documentation: null,
            insertText: "pgbad",
            kind: null,
            label: "pgbad",
          },
        ],
      },
    });
    const providePhpMethodCompletions = vi.fn(async () => [
      {
        declaringClassName: "config/database.php",
        insertText: "pgsql",
        kind: "config" as const,
        name: "pgsql",
        parameters: "",
        returnType: null,
      },
    ]);
    const context = providerContext({
      activeDocument: {
        ...document(),
        content:
          "<?php\nfunction connection(): mixed\n{\n    return DB::connection('pg');\n}\n",
      },
      featuresGateway: gateway,
      providePhpMethodCompletions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const result = await registered.completionProvider.provideCompletionItems(
      model({
        lineContent: "    return DB::connection('pg');",
        word: {
          endColumn: 30,
          startColumn: 29,
        },
      }),
      {
        column: 30,
        lineNumber: 4,
      },
    );

    expect(result.suggestions).toEqual([
      expect.objectContaining({
        command: undefined,
        detail: "Laravel config - config/database.php",
        documentation: "Laravel config\n\npgsql",
        insertText: "pgsql",
        insertTextRules: 4,
        kind: 12,
        label: {
          description: "config - config/database.php",
          detail: "",
          label: "pgsql",
        },
      }),
    ]);
    expect(providePhpMethodCompletions).toHaveBeenCalledWith(
      "<?php\nfunction connection(): mixed\n{\n    return DB::connection('pg');\n}\n",
      {
        column: 30,
        lineNumber: 4,
      },
    );
    expect(gateway.completion).not.toHaveBeenCalled();
  });

  it("inserts Laravel translation key completions as plain string suffixes", async () => {
    const registered = createRegisteredProviders();
    const providePhpMethodCompletions = vi.fn(async () => [
      {
        declaringClassName: "lang/en/messages.php",
        insertText: "welcome",
        kind: "translation" as const,
        name: "messages.welcome",
        parameters: "",
        returnType: null,
      },
    ]);
    const context = providerContext({
      activeDocument: {
        ...document(),
        content:
          "<?php\nfunction label(): string\n{\n    return __('messages.we');\n}\n",
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
        lineContent: "    return __('messages.we');",
        word: {
          endColumn: 27,
          startColumn: 25,
        },
      }),
      {
        column: 27,
        lineNumber: 4,
      },
    );

    expect(result.suggestions).toEqual([
      expect.objectContaining({
        command: undefined,
        detail: "Laravel translation - lang/en/messages.php",
        documentation: "Laravel translation\n\nmessages.welcome",
        insertText: "welcome",
        insertTextRules: 4,
        kind: 12,
        label: {
          description: "translation - lang/en/messages.php",
          detail: "",
          label: "messages.welcome",
        },
      }),
    ]);
  });

  it("inserts Laravel view name completions as plain string suffixes", async () => {
    const registered = createRegisteredProviders();
    const providePhpMethodCompletions = vi.fn(async () => [
      {
        declaringClassName: "resources/views/comments/show.blade.php",
        insertText: "show",
        kind: "view" as const,
        name: "comments.show",
        parameters: "",
        returnType: null,
      },
    ]);
    const context = providerContext({
      activeDocument: {
        ...document(),
        content:
          "<?php\nfunction show(): string\n{\n    return view('comments.sh');\n}\n",
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
        lineContent: "    return view('comments.sh');",
        word: {
          endColumn: 31,
          startColumn: 29,
        },
      }),
      {
        column: 31,
        lineNumber: 4,
      },
    );

    expect(result.suggestions).toEqual([
      expect.objectContaining({
        command: undefined,
        detail:
          "Laravel view - resources/views/comments/show.blade.php",
        documentation: "Laravel view\n\ncomments.show",
        insertText: "show",
        insertTextRules: 4,
        kind: 17,
        label: {
          description: "view - resources/views/comments/show.blade.php",
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

  it("does not offer local variables as a fallback inside Laravel scoped strings", async () => {
    const registered = createRegisteredProviders();
    const providePhpMethodCompletions = vi.fn(async () => []);
    const source = `<?php
function show($user): void
{
    Auth::guard('ad');
}
`;
    const context = providerContext({
      activeDocument: {
        ...document(),
        content: source,
      },
      providePhpMethodCompletions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.completionProvider.provideCompletionItems(
        model({
          content: source,
          lineContent: "    Auth::guard('ad');",
          word: {
            endColumn: 20,
            startColumn: 18,
          },
        }),
        {
          column: 20,
          lineNumber: 4,
        },
      ),
    ).resolves.toEqual({
      suggestions: [],
    });
    expect(providePhpMethodCompletions).toHaveBeenCalled();
  });

  it("does not offer phpactor noise inside Laravel scoped strings", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      completion: {
        isIncomplete: false,
        items: [
          {
            detail: "string",
            documentation: null,
            insertText: "authenticate",
            kind: null,
            label: "authenticate",
          },
        ],
      },
    });
    const providePhpMethodCompletions = vi.fn(async () => []);
    const source = `<?php
function show(): void
{
    Auth::guard('zz');
}
`;
    const context = providerContext({
      activeDocument: {
        ...document(),
        content: source,
      },
      featuresGateway: gateway,
      providePhpMethodCompletions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.completionProvider.provideCompletionItems(
        model({
          content: source,
          lineContent: "    Auth::guard('zz');",
          word: {
            endColumn: 20,
            startColumn: 18,
          },
        }),
        {
          column: 20,
          lineNumber: 4,
        },
      ),
    ).resolves.toEqual({
      suggestions: [],
    });
    expect(providePhpMethodCompletions).toHaveBeenCalled();
    expect(gateway.completion).not.toHaveBeenCalled();
  });

  it("does not offer local variables as a fallback inside Laravel validation rule strings", async () => {
    const registered = createRegisteredProviders();
    const providePhpMethodCompletions = vi.fn(async () => []);
    const source = `<?php
function store($request): void
{
    $request->validate([
        'email' => 're',
    ]);
}
`;
    const context = providerContext({
      activeDocument: {
        ...document(),
        content: source,
      },
      providePhpMethodCompletions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.completionProvider.provideCompletionItems(
        model({
          content: source,
          lineContent: "        'email' => 're',",
          word: {
            endColumn: 22,
            startColumn: 20,
          },
        }),
        {
          column: 22,
          lineNumber: 5,
        },
      ),
    ).resolves.toEqual({
      suggestions: [],
    });
    expect(providePhpMethodCompletions).toHaveBeenCalled();
  });

  it("expands a PHP postfix keyword into a snippet over the receiver range", async () => {
    const registered = createRegisteredProviders();
    const providePhpMethodCompletions = vi.fn(async () => []);
    const gateway = featuresGateway({
      completion: {
        isIncomplete: false,
        items: [
          {
            detail: "class",
            documentation: null,
            insertText: "User",
            kind: 7,
            label: "User",
          },
        ],
      },
    });
    const source = "<?php\nfunction show($user): void\n{\n    $user.if\n}\n";
    const context = providerContext({
      activeDocument: {
        ...document(),
        content: source,
      },
      featuresGateway: gateway,
      providePhpMethodCompletions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const result = await registered.completionProvider.provideCompletionItems(
      model({
        content: source,
        lineContent: "    $user.if",
        word: {
          endColumn: 13,
          startColumn: 11,
        },
      }),
      {
        column: 13,
        lineNumber: 4,
      },
    );

    expect(result.suggestions).toEqual([
      expect.objectContaining({
        insertText: "if ($user) {\n\t$0\n}",
        insertTextRules: 4,
        label: "if",
        range: {
          endColumn: 13,
          endLineNumber: 4,
          startColumn: 5,
          startLineNumber: 4,
        },
      }),
    ]);
    expect(gateway.completion).not.toHaveBeenCalled();
  });

  it("does not treat PHP concatenation as a postfix completion", async () => {
    const registered = createRegisteredProviders();
    const providePhpMethodCompletions = vi.fn(async () => []);
    const gateway = featuresGateway({
      completion: {
        isIncomplete: false,
        items: [
          {
            detail: "variable",
            documentation: null,
            insertText: "$banana",
            kind: 6,
            label: "$banana",
          },
        ],
      },
    });
    const source = "<?php\nfunction show($a, $b): void\n{\n    $a . $b\n}\n";
    const context = providerContext({
      activeDocument: {
        ...document(),
        content: source,
      },
      featuresGateway: gateway,
      providePhpMethodCompletions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const result = await registered.completionProvider.provideCompletionItems(
      model({
        content: source,
        lineContent: "    $a . $b",
        word: {
          endColumn: 11,
          startColumn: 10,
        },
      }),
      {
        column: 11,
        lineNumber: 4,
      },
    );

    const suggestions = result.suggestions as Array<{
      insertText: string;
      insertTextRules?: number;
      label: unknown;
    }>;

    expect(gateway.completion).toHaveBeenCalled();
    expect(
      suggestions.some(
        (suggestion) => suggestion.insertTextRules === 4 &&
          typeof suggestion.insertText === "string" &&
          suggestion.insertText.includes("{\n\t$0\n}"),
      ),
    ).toBe(false);
    expect(
      suggestions.some(
        (suggestion) => suggestion.label === "$banana",
      ),
    ).toBe(true);
  });

  it("offers PHP snippet completions for a typed prefix as InsertAsSnippet", async () => {
    const registered = createRegisteredProviders();
    const providePhpMethodCompletions = vi.fn(async () => []);
    const source = "<?php\nncl\n";
    const context = providerContext({
      activeDocument: {
        ...document(),
        content: source,
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
        content: source,
        lineContent: "ncl",
        word: {
          endColumn: 4,
          startColumn: 1,
          word: "ncl",
        },
      }),
      {
        column: 4,
        lineNumber: 2,
      },
    );

    const snippet = (
      result.suggestions as Array<{
        insertText: string;
        insertTextRules?: number;
        kind: number;
        label: unknown;
        sortText?: string;
      }>
    ).find((item) => item.label === "nclass");

    expect(snippet).toBeDefined();
    expect(snippet?.insertTextRules).toBe(4);
    expect(snippet?.kind).toBe(27);
    expect(snippet?.insertText).toContain("class ${1:ClassName}");
  });

  it("offers a user-defined PHP snippet from the context", async () => {
    const registered = createRegisteredProviders();
    const providePhpMethodCompletions = vi.fn(async () => []);
    const source = "<?php\nmyh\n";
    const context = providerContext({
      activeDocument: {
        ...document(),
        content: source,
      },
      featuresGateway: featuresGateway({
        completion: {
          isIncomplete: false,
          items: [],
        },
      }),
      getUserSnippets: () => [
        {
          prefix: "myhelper",
          body: "helper($0);",
          description: "Call my helper",
          languages: ["php"],
        },
      ],
      providePhpMethodCompletions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const result = await registered.completionProvider.provideCompletionItems(
      model({
        content: source,
        lineContent: "myh",
        word: {
          endColumn: 4,
          startColumn: 1,
          word: "myh",
        },
      }),
      {
        column: 4,
        lineNumber: 2,
      },
    );

    const snippet = (
      result.suggestions as Array<{
        insertText: string;
        insertTextRules?: number;
        label: unknown;
      }>
    ).find((item) => item.label === "myhelper");

    expect(snippet).toBeDefined();
    expect(snippet?.insertText).toBe("helper($0);");
    expect(snippet?.insertTextRules).toBe(4);
  });

  it("sorts PHP snippet completions after LSP suggestions", async () => {
    const registered = createRegisteredProviders();
    const providePhpMethodCompletions = vi.fn(async () => []);
    const source = "<?php\ndd\n";
    const context = providerContext({
      activeDocument: {
        ...document(),
        content: source,
      },
      featuresGateway: featuresGateway({
        completion: {
          isIncomplete: false,
          items: [
            {
              detail: "function",
              documentation: null,
              insertText: "ddd_lsp",
              kind: 3,
              label: "ddd_lsp",
            },
          ],
        },
      }),
      providePhpMethodCompletions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const result = await registered.completionProvider.provideCompletionItems(
      model({
        content: source,
        lineContent: "dd",
        word: {
          endColumn: 3,
          startColumn: 1,
          word: "dd",
        },
      }),
      {
        column: 3,
        lineNumber: 2,
      },
    );

    const items = result.suggestions as Array<{
      label: unknown;
      sortText?: string;
    }>;
    const lsp = items.find((item) => item.label === "ddd_lsp");
    const snippet = items.find((item) => item.label === "dd");

    expect(lsp?.sortText).toBeDefined();
    expect(snippet?.sortText).toBeDefined();
    expect(
      String(snippet?.sortText).localeCompare(String(lsp?.sortText)),
    ).toBeGreaterThan(0);
  });

  it("does not offer PHP snippets inside member access completions", async () => {
    const registered = createRegisteredProviders();
    const providePhpMethodCompletions = vi.fn(async () => []);
    const source = "<?php\nfunction show($user): void\n{\n    $user->dd\n}\n";
    const context = providerContext({
      activeDocument: {
        ...document(),
        content: source,
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
        content: source,
        lineContent: "    $user->dd",
        word: {
          endColumn: 14,
          startColumn: 12,
          word: "dd",
        },
      }),
      {
        column: 14,
        lineNumber: 4,
      },
    );

    const snippet = (result.suggestions as Array<{ kind: number }>).find(
      (item) => item.kind === 27,
    );

    expect(snippet).toBeUndefined();
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

  it("orders Model:: static completions by category and above phpactor noise", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      completion: {
        isIncomplete: false,
        items: [
          {
            detail:
              "App\\Models\\Comment::query(): Illuminate\\Database\\Eloquent\\Builder",
            documentation: null,
            insertText: "query",
            kind: 2,
            label: "query",
          },
        ],
      },
    });
    const providePhpMethodCompletions = vi.fn(async () => [
      {
        declaringClassName: "App\\Models\\Comment",
        kind: "property" as const,
        name: "title",
        parameters: "",
        returnType: "string",
      },
      {
        declaringClassName: "App\\Models\\Comment",
        kind: "relation" as const,
        name: "post",
        parameters: "",
        returnType: "App\\Models\\Post",
      },
      {
        declaringClassName: "App\\Models\\Comment",
        name: "publish",
        parameters: "",
        returnType: "void",
      },
      {
        declaringClassName: "App\\Models\\Comment",
        isStatic: true,
        kind: "magic-where" as const,
        name: "whereTitle",
        parameters: "$value",
        returnType: "Illuminate\\Database\\Eloquent\\Builder",
      },
      {
        declaringClassName: "App\\Models\\Comment",
        isStatic: true,
        name: "create",
        parameters: "array $attributes",
        returnType: "App\\Models\\Comment",
      },
      {
        declaringClassName: "App\\Models\\Comment",
        isStatic: true,
        kind: "scope" as const,
        name: "active",
        parameters: "",
        returnType: "Illuminate\\Database\\Eloquent\\Builder",
      },
    ]);
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

    const rows = result.suggestions.map(
      (suggestion: {
        kind: number;
        label: string | { label: string };
        sortText?: string;
      }) => ({
        kind: suggestion.kind,
        name:
          typeof suggestion.label === "string"
            ? suggestion.label
            : suggestion.label.label,
        sortText: suggestion.sortText,
      }),
    );

    // Static access shares the member category ordering: property (10) ->
    // relation/Field (5) -> methods (2) -> scope/Function (3) ->
    // magic-where/Event (23), all on the `0_` bucket so our Laravel/OOP
    // suggestions sit above the phpactor LSP `query` (`1_`) noise.
    expect(rows).toEqual([
      { kind: 10, name: "title", sortText: "0_0000" },
      { kind: 5, name: "post", sortText: "0_0001" },
      { kind: 2, name: "publish", sortText: "0_0002" },
      { kind: 2, name: "create", sortText: "0_0003" },
      { kind: 3, name: "active", sortText: "0_0004" },
      { kind: 23, name: "whereTitle", sortText: "0_0005" },
      { kind: 2, name: "query", sortText: "1_0000" },
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

  it("surfaces PHP member visibility in Monaco method and property rows", async () => {
    const registered = createRegisteredProviders();
    const providePhpMethodCompletions = vi.fn(async () => [
      {
        declaringClassName: "App\\Models\\Comment",
        name: "publish",
        parameters: "",
        returnType: "bool",
        visibility: "protected" as const,
      },
      {
        declaringClassName: "App\\Models\\Comment",
        kind: "property" as const,
        name: "body",
        parameters: "",
        returnType: "string",
        visibility: "public" as const,
      },
    ]);
    const context = providerContext({
      activeDocument: {
        ...document(),
        content: "<?php\nfunction show(Comment $comment): void\n{\n    $comment->\n}\n",
      },
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

    // Category grouping puts the property ahead of the method regardless of the
    // collector's source order, while visibility metadata is preserved.
    expect(result.suggestions).toEqual([
      expect.objectContaining({
        detail: "public App\\Models\\Comment::$body: string",
        kind: 10,
        label: {
          description: "public property - App\\Models\\Comment",
          detail: ": string",
          label: "body",
        },
      }),
      expect.objectContaining({
        detail: "protected App\\Models\\Comment::publish(): bool",
        kind: 2,
        label: {
          description: "protected method - App\\Models\\Comment",
          detail: "(): bool",
          label: "publish",
        },
      }),
    ]);
  });

  it("orders PHP member completions by category with distinct per-category glyphs", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      completion: { isIncomplete: false, items: [] },
    });
    const providePhpMethodCompletions = vi.fn(async () => [
      {
        declaringClassName: "App\\Models\\Post",
        kind: "magic-where" as const,
        name: "whereTitle",
        parameters: "$value",
        returnType: "Illuminate\\Database\\Eloquent\\Builder",
      },
      {
        declaringClassName: "App\\Models\\Post",
        name: "publish",
        parameters: "",
        returnType: "void",
      },
      {
        declaringClassName: "App\\Models\\Post",
        kind: "scope" as const,
        name: "active",
        parameters: "Builder $query",
        returnType: "Illuminate\\Database\\Eloquent\\Builder",
      },
      {
        declaringClassName: "App\\Models\\Post",
        kind: "property" as const,
        name: "title",
        parameters: "",
        returnType: "string",
      },
      {
        declaringClassName: "App\\Models\\Post",
        kind: "relation" as const,
        name: "author",
        parameters: "",
        returnType: "App\\Models\\User",
      },
    ]);
    const context = providerContext({
      activeDocument: {
        ...document(),
        content: "<?php\nfunction show(Post $post): void\n{\n    $post->\n}\n",
      },
      featuresGateway: gateway,
      providePhpMethodCompletions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const result = await registered.completionProvider.provideCompletionItems(
      model({
        lineContent: "    $post->",
        word: {
          endColumn: 12,
          startColumn: 12,
        },
      }),
      {
        column: 12,
        lineNumber: 4,
      },
    );

    const rows = result.suggestions.map(
      (suggestion: {
        kind: number;
        label: string | { label: string };
        sortText?: string;
      }) => ({
        kind: suggestion.kind,
        name:
          typeof suggestion.label === "string"
            ? suggestion.label
            : suggestion.label.label,
        sortText: suggestion.sortText,
      }),
    );

    // property (10) -> relation/Field (5) -> method (2) -> scope/Function (3) ->
    // magic-where/Event (23), and the `sortText` index follows the category
    // order so each group renders together and above phpactor (`1_`) noise.
    expect(rows).toEqual([
      { kind: 10, name: "title", sortText: "0_0000" },
      { kind: 5, name: "author", sortText: "0_0001" },
      { kind: 2, name: "publish", sortText: "0_0002" },
      { kind: 3, name: "active", sortText: "0_0003" },
      { kind: 23, name: "whereTitle", sortText: "0_0004" },
    ]);
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

  it("lets local Laravel relation completions shadow same-named phpactor methods", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      completion: {
        isIncomplete: false,
        items: [
          {
            detail:
              "App\\Models\\Post::comments(): Illuminate\\Database\\Eloquent\\Relations\\HasMany",
            documentation: null,
            insertText: "comments",
            kind: 2,
            label: "comments",
          },
        ],
      },
    });
    const providePhpMethodCompletions = vi.fn(async () => [
      {
        declaringClassName: "App\\Models\\Post",
        kind: "relation" as const,
        name: "comments",
        parameters: "",
        returnType: "Illuminate\\Database\\Eloquent\\Relations\\HasMany",
      },
    ]);
    const source = "<?php\nfunction show(Post $post): void\n{\n    $post->com\n}\n";
    const context = providerContext({
      activeDocument: {
        ...document(),
        content: source,
      },
      featuresGateway: gateway,
      providePhpMethodCompletions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.completionProvider.provideCompletionItems(
        model({
          content: source,
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

  it("lets local Laravel scope completions shadow same-named phpactor methods", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      completion: {
        isIncomplete: false,
        items: [
          {
            detail:
              "App\\Models\\Post::active(): Illuminate\\Database\\Eloquent\\Builder",
            documentation: null,
            insertText: "active",
            kind: 2,
            label: "active",
          },
        ],
      },
    });
    const providePhpMethodCompletions = vi.fn(async () => [
      {
        declaringClassName: "App\\Models\\Post",
        kind: "scope" as const,
        name: "active",
        parameters: "",
        returnType: "Illuminate\\Database\\Eloquent\\Builder",
      },
    ]);
    const source = "<?php\nPost::act\n";
    const context = providerContext({
      activeDocument: {
        ...document(),
        content: source,
      },
      featuresGateway: gateway,
      providePhpMethodCompletions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.completionProvider.provideCompletionItems(
        model({
          content: source,
          lineContent: "Post::act",
          word: {
            endColumn: 10,
            startColumn: 7,
          },
        }),
        {
          column: 10,
          lineNumber: 2,
        },
      ),
    ).resolves.toEqual({
      suggestions: [
        expect.objectContaining({
          kind: 3,
          label: {
            description: "scope - App\\Models\\Post",
            detail: "()",
            label: "active",
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

  it("maps nested PHP DocumentSymbol responses with deprecated tags", async () => {
    const registered = createRegisteredProviders();
    const symbols: LanguageServerDocumentSymbol[] = [
      {
        children: [
          {
            children: [],
            containerName: null,
            detail: null,
            kind: 6,
            name: "fullName",
            range: range(8, 4, 10, 5),
            selectionRange: range(8, 13, 8, 21),
          },
          {
            children: [],
            containerName: "User",
            detail: "string",
            kind: 7,
            name: "$name",
            range: range(4, 4, 4, 24),
            selectionRange: range(4, 11, 4, 16),
            tags: [1, 99],
          },
        ],
        containerName: "App\\Models",
        detail: null,
        kind: 5,
        name: "User",
        range: range(2, 0, 12, 1),
        selectionRange: range(2, 6, 2, 10),
        tags: [99],
      },
    ];
    const gateway = featuresGateway({ documentSymbols: symbols });
    const flushPendingDocumentChange = vi.fn(async () => undefined);
    const context = providerContext({
      featuresGateway: gateway,
      flushPendingDocumentChange,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.documentSymbolProvider.provideDocumentSymbols(model()),
    ).resolves.toEqual([
      {
        children: [
          {
            children: [],
            containerName: undefined,
            detail: "",
            kind: registered.monaco.languages.SymbolKind.Method,
            name: "fullName",
            range: {
              endColumn: 6,
              endLineNumber: 11,
              startColumn: 5,
              startLineNumber: 9,
            },
            selectionRange: {
              endColumn: 22,
              endLineNumber: 9,
              startColumn: 14,
              startLineNumber: 9,
            },
            tags: [],
          },
          {
            children: [],
            containerName: "User",
            detail: "string",
            kind: registered.monaco.languages.SymbolKind.Property,
            name: "$name",
            range: {
              endColumn: 25,
              endLineNumber: 5,
              startColumn: 5,
              startLineNumber: 5,
            },
            selectionRange: {
              endColumn: 17,
              endLineNumber: 5,
              startColumn: 12,
              startLineNumber: 5,
            },
            tags: [registered.monaco.languages.SymbolTag.Deprecated],
          },
        ],
        containerName: "App\\Models",
        detail: "",
        kind: registered.monaco.languages.SymbolKind.Class,
        name: "User",
        range: {
          endColumn: 2,
          endLineNumber: 13,
          startColumn: 1,
          startLineNumber: 3,
        },
        selectionRange: {
          endColumn: 11,
          endLineNumber: 3,
          startColumn: 7,
          startLineNumber: 3,
        },
        tags: [],
      },
    ]);
    expect(flushPendingDocumentChange).toHaveBeenCalledWith(
      "/project/src/User.php",
    );
    expect(gateway.documentSymbols).toHaveBeenCalledWith(
      "/project",
      "/project/src/User.php",
    );
  });

  it("does not request PHP DocumentSymbol when capability is disabled or runtime root mismatches", async () => {
    const disabledRegistered = createRegisteredProviders();
    const disabledGateway = featuresGateway({
      documentSymbols: [
        {
          children: [],
          containerName: null,
          detail: null,
          kind: 5,
          name: "User",
          range: range(2, 0, 12, 1),
          selectionRange: range(2, 6, 2, 10),
        },
      ],
    });
    const disabledFlush = vi.fn(async () => undefined);
    registerLanguageServerMonacoProviders(
      disabledRegistered.monaco,
      providerContext({
        featuresGateway: disabledGateway,
        flushPendingDocumentChange: disabledFlush,
        runtimeStatus: runningStatus({ documentSymbol: false }),
      }),
    );

    await expect(
      disabledRegistered.documentSymbolProvider.provideDocumentSymbols(model()),
    ).resolves.toBeNull();
    expect(disabledFlush).not.toHaveBeenCalled();
    expect(disabledGateway.documentSymbols).not.toHaveBeenCalled();

    const mismatchedRegistered = createRegisteredProviders();
    const mismatchedGateway = featuresGateway();
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
      mismatchedRegistered.documentSymbolProvider.provideDocumentSymbols(model()),
    ).resolves.toBeNull();
    expect(mismatchedFlush).not.toHaveBeenCalled();
    expect(mismatchedGateway.documentSymbols).not.toHaveBeenCalled();
  });

  it("does not request PHP DocumentSymbol before the document is synced (didOpen)", async () => {
    // BUG 2: an outline / breadcrumb DocumentSymbol request that fires before
    // the document has been opened on the server produces an UnknownDocument
    // error. When an isDocumentSynced gate is supplied and reports the document
    // is not yet open, the provider must skip the request entirely.
    const unsyncedRegistered = createRegisteredProviders();
    const unsyncedGateway = featuresGateway({
      documentSymbols: [
        {
          children: [],
          containerName: null,
          detail: null,
          kind: 5,
          name: "User",
          range: range(2, 0, 12, 1),
          selectionRange: range(2, 6, 2, 10),
        },
      ],
    });
    const unsyncedFlush = vi.fn(async () => undefined);
    registerLanguageServerMonacoProviders(
      unsyncedRegistered.monaco,
      providerContext({
        featuresGateway: unsyncedGateway,
        flushPendingDocumentChange: unsyncedFlush,
        isDocumentSynced: () => false,
      }),
    );

    await expect(
      unsyncedRegistered.documentSymbolProvider.provideDocumentSymbols(model()),
    ).resolves.toBeNull();
    expect(unsyncedFlush).not.toHaveBeenCalled();
    expect(unsyncedGateway.documentSymbols).not.toHaveBeenCalled();

    // Once the document is synced, the request proceeds for the same root/path.
    const syncedRegistered = createRegisteredProviders();
    const syncedGateway = featuresGateway({
      documentSymbols: [
        {
          children: [],
          containerName: null,
          detail: null,
          kind: 5,
          name: "User",
          range: range(2, 0, 12, 1),
          selectionRange: range(2, 6, 2, 10),
        },
      ],
    });
    const syncedFlush = vi.fn(async () => undefined);
    const syncedSeen: Array<{ path: string; rootPath: string }> = [];
    registerLanguageServerMonacoProviders(
      syncedRegistered.monaco,
      providerContext({
        featuresGateway: syncedGateway,
        flushPendingDocumentChange: syncedFlush,
        isDocumentSynced: (rootPath, path) => {
          syncedSeen.push({ path, rootPath });
          return true;
        },
      }),
    );

    const syncedResult =
      await syncedRegistered.documentSymbolProvider.provideDocumentSymbols(
        model(),
      );

    expect(syncedResult).not.toBeNull();
    expect(syncedFlush).toHaveBeenCalledWith("/project/src/User.php");
    expect(syncedGateway.documentSymbols).toHaveBeenCalledWith(
      "/project",
      "/project/src/User.php",
    );
    expect(syncedSeen).toContainEqual({
      path: "/project/src/User.php",
      rootPath: "/project",
    });
  });

  it("drops stale PHP DocumentSymbol results after session or root changes", async () => {
    const sessionRegistered = createRegisteredProviders();
    let activeSessionId = 1;
    const sessionSymbols =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["documentSymbols"]>>
      >();
    const sessionGateway = featuresGateway();
    vi.mocked(sessionGateway.documentSymbols).mockImplementationOnce(
      async () => sessionSymbols.promise,
    );
    registerLanguageServerMonacoProviders(
      sessionRegistered.monaco,
      providerContext({
        featuresGateway: sessionGateway,
        getRuntimeStatus: () => ({
          ...runningStatus(),
          sessionId: activeSessionId,
        }),
      }),
    );

    const sessionPromise =
      sessionRegistered.documentSymbolProvider.provideDocumentSymbols(model());

    await Promise.resolve();
    activeSessionId = 2;
    sessionSymbols.resolve([
      {
        children: [],
        containerName: null,
        detail: null,
        kind: 5,
        name: "StaleUser",
        range: range(2, 0, 12, 1),
        selectionRange: range(2, 6, 2, 15),
      },
    ]);

    await expect(sessionPromise).resolves.toBeNull();

    const rootRegistered = createRegisteredProviders();
    let activeRoot: string | null = "/project";
    const rootSymbols =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["documentSymbols"]>>
      >();
    const rootGateway = featuresGateway();
    vi.mocked(rootGateway.documentSymbols).mockImplementationOnce(
      async () => rootSymbols.promise,
    );
    registerLanguageServerMonacoProviders(
      rootRegistered.monaco,
      providerContext({
        featuresGateway: rootGateway,
        getWorkspaceRoot: () => activeRoot,
      }),
    );

    const rootPromise =
      rootRegistered.documentSymbolProvider.provideDocumentSymbols(model());

    await Promise.resolve();
    activeRoot = "/other";
    rootSymbols.resolve([
      {
        children: [],
        containerName: null,
        detail: null,
        kind: 12,
        name: "stale",
        range: range(1, 0, 1, 12),
        selectionRange: range(1, 9, 1, 14),
      },
    ]);

    await expect(rootPromise).resolves.toBeNull();
  });

  it("maps PHP workspace symbol responses through the active project root", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      workspaceSymbols: [
        {
          containerName: "App\\Models",
          kind: 5,
          location: {
            range: range(2, 6, 2, 10),
            uri: "file:///project/src/User.php",
          },
          name: "User",
        },
        {
          containerName: "App\\Other",
          kind: 12,
          location: {
            range: range(4, 0, 4, 12),
            uri: "file:///other/src/Other.php",
          },
          name: "other_user",
        },
        {
          containerName: "App\\Neighbor",
          kind: 12,
          location: {
            range: range(6, 0, 6, 12),
            uri: "file:///project-neighbor/src/Neighbor.php",
          },
          name: "neighbor_user",
        },
        {
          containerName: null,
          kind: 13,
          location: null,
          name: "$unresolved",
        },
      ],
    });
    registerLanguageServerMonacoProviders(
      registered.monaco,
      providerContext({ featuresGateway: gateway }),
    );

    const symbols =
      await registered.workspaceSymbolProvider.provideWorkspaceSymbols("User");

    expect(gateway.workspaceSymbols).toHaveBeenCalledWith("/project", "User");
    expect(symbols).toEqual([
      {
        containerName: "App\\Models",
        kind: registered.monaco.languages.SymbolKind.Class,
        location: {
          range: expect.objectContaining({
            endColumn: 11,
            endLineNumber: 3,
            startColumn: 7,
            startLineNumber: 3,
          }),
          uri: { fsPath: "/project/src/User.php", path: "/project/src/User.php" },
        },
        name: "User",
      },
    ]);
  });

  it("does not request PHP workspace symbols when capability is disabled or runtime root mismatches", async () => {
    const disabledRegistered = createRegisteredProviders();
    const disabledGateway = featuresGateway({
      workspaceSymbols: [
        {
          containerName: "App\\Models",
          kind: 5,
          location: {
            range: range(2, 6, 2, 10),
            uri: "file:///project/src/User.php",
          },
          name: "User",
        },
      ],
    });
    registerLanguageServerMonacoProviders(
      disabledRegistered.monaco,
      providerContext({
        featuresGateway: disabledGateway,
        runtimeStatus: runningStatus({ workspaceSymbol: false }),
      }),
    );

    await expect(
      disabledRegistered.workspaceSymbolProvider.provideWorkspaceSymbols("User"),
    ).resolves.toEqual([]);
    expect(disabledGateway.workspaceSymbols).not.toHaveBeenCalled();

    const mismatchedRegistered = createRegisteredProviders();
    const mismatchedGateway = featuresGateway();
    registerLanguageServerMonacoProviders(
      mismatchedRegistered.monaco,
      providerContext({
        featuresGateway: mismatchedGateway,
        getWorkspaceRoot: () => "/project",
        runtimeStatus: {
          ...runningStatus(),
          rootPath: "/other",
        },
      }),
    );

    await expect(
      mismatchedRegistered.workspaceSymbolProvider.provideWorkspaceSymbols("User"),
    ).resolves.toEqual([]);
    expect(mismatchedGateway.workspaceSymbols).not.toHaveBeenCalled();
  });

  it("drops stale PHP workspace symbol results after session or root changes", async () => {
    const sessionRegistered = createRegisteredProviders();
    let activeSessionId = 1;
    const sessionSymbols =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["workspaceSymbols"]>>
      >();
    const sessionGateway = featuresGateway();
    vi.mocked(sessionGateway.workspaceSymbols).mockImplementationOnce(
      async () => sessionSymbols.promise,
    );
    registerLanguageServerMonacoProviders(
      sessionRegistered.monaco,
      providerContext({
        featuresGateway: sessionGateway,
        getRuntimeStatus: () => ({
          ...runningStatus(),
          sessionId: activeSessionId,
        }),
      }),
    );

    const sessionPromise =
      sessionRegistered.workspaceSymbolProvider.provideWorkspaceSymbols("User");

    await Promise.resolve();
    activeSessionId = 2;
    sessionSymbols.resolve([
      {
        containerName: "App\\Models",
        kind: 5,
        location: {
          range: range(2, 6, 2, 10),
          uri: "file:///project/src/User.php",
        },
        name: "StaleUser",
      },
    ]);

    await expect(sessionPromise).resolves.toEqual([]);
    expect(sessionGateway.workspaceSymbols).toHaveBeenCalledWith(
      "/project",
      "User",
    );

    const rootRegistered = createRegisteredProviders();
    let activeRoot: string | null = "/project";
    const rootSymbols =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["workspaceSymbols"]>>
      >();
    const rootGateway = featuresGateway();
    vi.mocked(rootGateway.workspaceSymbols).mockImplementationOnce(
      async () => rootSymbols.promise,
    );
    registerLanguageServerMonacoProviders(
      rootRegistered.monaco,
      providerContext({
        featuresGateway: rootGateway,
        getWorkspaceRoot: () => activeRoot,
      }),
    );

    const rootPromise =
      rootRegistered.workspaceSymbolProvider.provideWorkspaceSymbols("User");

    await Promise.resolve();
    activeRoot = "/other";
    rootSymbols.resolve([
      {
        containerName: "App\\Models",
        kind: 5,
        location: {
          range: range(2, 6, 2, 10),
          uri: "file:///project/src/User.php",
        },
        name: "StaleUser",
      },
    ]);

    await expect(rootPromise).resolves.toEqual([]);
    expect(rootGateway.workspaceSymbols).toHaveBeenCalledWith(
      "/project",
      "User",
    );
  });

  it("maps PHP FoldingRange responses with a kind", async () => {
    const registered = createRegisteredProviders();
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
    const flushPendingDocumentChange = vi.fn(async () => undefined);
    const context = providerContext({
      featuresGateway: gateway,
      flushPendingDocumentChange,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.foldingRangeProvider.provideFoldingRanges(model()),
    ).resolves.toEqual([
      {
        end: 9,
        kind: { value: "region" },
        start: 3,
      },
    ]);
    expect(flushPendingDocumentChange).toHaveBeenCalledWith(
      "/project/src/User.php",
    );
    expect(gateway.foldingRanges).toHaveBeenCalledWith(
      "/project",
      "/project/src/User.php",
    );
    expect(
      registered.monaco.languages.FoldingRangeKind.fromValue,
    ).toHaveBeenCalledWith("region");
  });

  it("maps PHP FoldingRange responses without a kind", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      foldingRanges: [
        {
          endCharacter: null,
          endLine: 6,
          kind: null,
          startCharacter: null,
          startLine: 1,
        },
      ],
    });
    const context = providerContext({ featuresGateway: gateway });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.foldingRangeProvider.provideFoldingRanges(model()),
    ).resolves.toEqual([
      {
        end: 7,
        kind: undefined,
        start: 2,
      },
    ]);
    expect(
      registered.monaco.languages.FoldingRangeKind.fromValue,
    ).not.toHaveBeenCalled();
  });

  it("does not request PHP FoldingRange when capability is disabled or runtime root mismatches", async () => {
    const disabledRegistered = createRegisteredProviders();
    const disabledGateway = featuresGateway({
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
    const disabledFlush = vi.fn(async () => undefined);
    registerLanguageServerMonacoProviders(
      disabledRegistered.monaco,
      providerContext({
        featuresGateway: disabledGateway,
        flushPendingDocumentChange: disabledFlush,
        runtimeStatus: runningStatus({ foldingRange: false }),
      }),
    );

    await expect(
      disabledRegistered.foldingRangeProvider.provideFoldingRanges(model()),
    ).resolves.toBeNull();
    expect(disabledFlush).not.toHaveBeenCalled();
    expect(disabledGateway.foldingRanges).not.toHaveBeenCalled();

    const mismatchedRegistered = createRegisteredProviders();
    const mismatchedGateway = featuresGateway({
      foldingRanges: [
        {
          endCharacter: null,
          endLine: 6,
          kind: null,
          startCharacter: null,
          startLine: 1,
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
      mismatchedRegistered.foldingRangeProvider.provideFoldingRanges(model()),
    ).resolves.toBeNull();
    expect(mismatchedFlush).not.toHaveBeenCalled();
    expect(mismatchedGateway.foldingRanges).not.toHaveBeenCalled();
  });

  it("drops stale PHP FoldingRange results after session or root changes", async () => {
    const sessionRegistered = createRegisteredProviders();
    let activeSessionId = 1;
    const sessionRanges =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["foldingRanges"]>>
      >();
    const sessionGateway = featuresGateway();
    vi.mocked(sessionGateway.foldingRanges).mockImplementationOnce(
      async () => sessionRanges.promise,
    );
    registerLanguageServerMonacoProviders(
      sessionRegistered.monaco,
      providerContext({
        featuresGateway: sessionGateway,
        getRuntimeStatus: () => ({
          ...runningStatus(),
          sessionId: activeSessionId,
        }),
      }),
    );

    const sessionPromise =
      sessionRegistered.foldingRangeProvider.provideFoldingRanges(model());

    await Promise.resolve();
    activeSessionId = 2;
    sessionRanges.resolve([
      {
        endCharacter: null,
        endLine: 8,
        kind: "region",
        startCharacter: null,
        startLine: 2,
      },
    ]);

    await expect(sessionPromise).resolves.toBeNull();

    const rootRegistered = createRegisteredProviders();
    let activeRoot: string | null = "/project";
    const rootRanges =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["foldingRanges"]>>
      >();
    const rootGateway = featuresGateway();
    vi.mocked(rootGateway.foldingRanges).mockImplementationOnce(
      async () => rootRanges.promise,
    );
    registerLanguageServerMonacoProviders(
      rootRegistered.monaco,
      providerContext({
        featuresGateway: rootGateway,
        getWorkspaceRoot: () => activeRoot,
      }),
    );

    const rootPromise =
      rootRegistered.foldingRangeProvider.provideFoldingRanges(model());

    await Promise.resolve();
    activeRoot = "/other";
    rootRanges.resolve([
      {
        endCharacter: null,
        endLine: 6,
        kind: null,
        startCharacter: null,
        startLine: 1,
      },
    ]);

    await expect(rootPromise).resolves.toBeNull();
  });

  it("maps PHP document formatting edits and options", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      formatting: [
        {
          newText: "<?php\nfunction show(): void {}\n",
          range: range(0, 0, 5, 1),
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
      registered.documentFormattingProvider.provideDocumentFormattingEdits(
        model(),
        { insertSpaces: false, tabSize: 2 },
      ),
    ).resolves.toEqual([
      {
        range: expect.objectContaining({
          endColumn: 2,
          endLineNumber: 6,
          startColumn: 1,
          startLineNumber: 1,
        }),
        text: "<?php\nfunction show(): void {}\n",
      },
    ]);
    expect(flushPendingDocumentChange).toHaveBeenCalledWith(
      "/project/src/User.php",
    );
    expect(gateway.formatting).toHaveBeenCalledWith(
      "/project",
      "/project/src/User.php",
      {
        insertSpaces: false,
        tabSize: 2,
      },
    );
  });

  it("maps PHP range formatting edits, range and options", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      rangeFormatting: [
        {
          newText: "    echo $user;\n",
          range: range(3, 0, 3, 10),
        },
      ],
    });
    const context = providerContext({ featuresGateway: gateway });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.rangeFormattingProvider.provideDocumentRangeFormattingEdits(
        model(),
        new registered.monaco.Range(4, 1, 4, 11),
        { insertSpaces: true, tabSize: 4 },
      ),
    ).resolves.toEqual([
      {
        range: expect.objectContaining({
          endColumn: 11,
          endLineNumber: 4,
          startColumn: 1,
          startLineNumber: 4,
        }),
        text: "    echo $user;\n",
      },
    ]);
    expect(gateway.rangeFormatting).toHaveBeenCalledWith(
      "/project",
      "/project/src/User.php",
      {
        end: { character: 10, line: 3 },
        start: { character: 0, line: 3 },
      },
      {
        insertSpaces: true,
        tabSize: 4,
      },
    );
  });

  it("uses advertised PHP on-type formatting trigger characters", () => {
    const registered = createRegisteredProviders();
    const context = providerContext({
      runtimeStatus: runningStatus({
        onTypeFormattingTriggerCharacters: [";", "}"],
      }),
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    expect(registered.onTypeFormattingLanguage).toBe("php");
    expect(
      registered.onTypeFormattingProvider.autoFormatTriggerCharacters,
    ).toEqual([";", "}"]);
  });

  it("falls back to empty PHP on-type formatting trigger characters", () => {
    const registered = createRegisteredProviders();
    const context = providerContext({
      runtimeStatus: runningStatus({
        onTypeFormattingTriggerCharacters: [],
      }),
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    expect(
      registered.onTypeFormattingProvider.autoFormatTriggerCharacters,
    ).toEqual([]);
  });

  it("ignores PHP on-type formatting trigger characters from a mismatched runtime root", () => {
    const registered = createRegisteredProviders();
    const context = providerContext({
      getWorkspaceRoot: () => "/project",
      runtimeStatus: {
        ...runningStatus({
          onTypeFormattingTriggerCharacters: [";"],
        }),
        rootPath: "/other",
      },
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    expect(
      registered.onTypeFormattingProvider.autoFormatTriggerCharacters,
    ).toEqual([]);
  });

  it("maps PHP on-type formatting edits, position, character and options", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      onTypeFormatting: [
        {
          newText: "    }\n",
          range: range(4, 0, 4, 1),
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
      registered.onTypeFormattingProvider.provideOnTypeFormattingEdits(
        model(),
        { column: 6, lineNumber: 5 },
        "}",
        { insertSpaces: true, tabSize: 4 },
      ),
    ).resolves.toEqual([
      {
        range: expect.objectContaining({
          endColumn: 2,
          endLineNumber: 5,
          startColumn: 1,
          startLineNumber: 5,
        }),
        text: "    }\n",
      },
    ]);
    expect(flushPendingDocumentChange).toHaveBeenCalledWith(
      "/project/src/User.php",
    );
    expect(gateway.onTypeFormatting).toHaveBeenCalledWith(
      "/project",
      "/project/src/User.php",
      {
        character: 5,
        line: 4,
        path: "/project/src/User.php",
      },
      "}",
      {
        insertSpaces: true,
        tabSize: 4,
      },
    );
  });

  it("does not request PHP on-type formatting when capability is disabled or runtime root mismatches", async () => {
    const disabledRegistered = createRegisteredProviders();
    const disabledGateway = featuresGateway({
      onTypeFormatting: [
        {
          newText: "    }\n",
          range: range(4, 0, 4, 1),
        },
      ],
    });
    const disabledFlush = vi.fn(async () => undefined);
    registerLanguageServerMonacoProviders(
      disabledRegistered.monaco,
      providerContext({
        featuresGateway: disabledGateway,
        flushPendingDocumentChange: disabledFlush,
        runtimeStatus: runningStatus({
          onTypeFormatting: false,
        }),
      }),
    );

    await expect(
      disabledRegistered.onTypeFormattingProvider.provideOnTypeFormattingEdits(
        model(),
        { column: 6, lineNumber: 5 },
        "}",
        { insertSpaces: true, tabSize: 4 },
      ),
    ).resolves.toEqual([]);
    expect(disabledFlush).not.toHaveBeenCalled();
    expect(disabledGateway.onTypeFormatting).not.toHaveBeenCalled();

    const mismatchedRegistered = createRegisteredProviders();
    const mismatchedGateway = featuresGateway({
      onTypeFormatting: [
        {
          newText: "    ;\n",
          range: range(3, 0, 3, 1),
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
      mismatchedRegistered.onTypeFormattingProvider.provideOnTypeFormattingEdits(
        model(),
        { column: 6, lineNumber: 5 },
        ";",
        { insertSpaces: false, tabSize: 2 },
      ),
    ).resolves.toEqual([]);
    expect(mismatchedFlush).not.toHaveBeenCalled();
    expect(mismatchedGateway.onTypeFormatting).not.toHaveBeenCalled();
  });

  it("drops stale PHP on-type formatting results after session or root changes", async () => {
    const sessionRegistered = createRegisteredProviders();
    let activeSessionId = 1;
    const sessionEdits =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["onTypeFormatting"]>>
      >();
    const sessionGateway = featuresGateway();
    vi.mocked(sessionGateway.onTypeFormatting).mockImplementationOnce(
      async () => sessionEdits.promise,
    );
    registerLanguageServerMonacoProviders(
      sessionRegistered.monaco,
      providerContext({
        featuresGateway: sessionGateway,
        getRuntimeStatus: () => ({
          ...runningStatus(),
          sessionId: activeSessionId,
        }),
      }),
    );

    const sessionPromise =
      sessionRegistered.onTypeFormattingProvider.provideOnTypeFormattingEdits(
        model(),
        { column: 6, lineNumber: 5 },
        "}",
        { insertSpaces: true, tabSize: 4 },
      );

    await Promise.resolve();
    activeSessionId = 2;
    sessionEdits.resolve([{ newText: "    }\n", range: range(4, 0, 4, 1) }]);

    await expect(sessionPromise).resolves.toEqual([]);

    const rootRegistered = createRegisteredProviders();
    let activeRoot: string | null = "/project";
    const rootEdits =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["onTypeFormatting"]>>
      >();
    const rootGateway = featuresGateway();
    vi.mocked(rootGateway.onTypeFormatting).mockImplementationOnce(
      async () => rootEdits.promise,
    );
    registerLanguageServerMonacoProviders(
      rootRegistered.monaco,
      providerContext({
        featuresGateway: rootGateway,
        getWorkspaceRoot: () => activeRoot,
      }),
    );

    const rootPromise =
      rootRegistered.onTypeFormattingProvider.provideOnTypeFormattingEdits(
        model(),
        { column: 6, lineNumber: 5 },
        ";",
        { insertSpaces: false, tabSize: 2 },
      );

    await Promise.resolve();
    activeRoot = null;
    rootEdits.resolve([{ newText: "    ;\n", range: range(3, 0, 3, 1) }]);

    await expect(rootPromise).resolves.toEqual([]);
  });

  it("does not request PHP formatting when capability is disabled or runtime root mismatches", async () => {
    const disabledRegistered = createRegisteredProviders();
    const disabledGateway = featuresGateway({
      formatting: [
        {
          newText: "<?php\n",
          range: range(0, 0, 1, 0),
        },
      ],
      rangeFormatting: [
        {
          newText: "echo $user;",
          range: range(3, 0, 3, 10),
        },
      ],
    });
    const disabledFlush = vi.fn(async () => undefined);
    registerLanguageServerMonacoProviders(
      disabledRegistered.monaco,
      providerContext({
        featuresGateway: disabledGateway,
        flushPendingDocumentChange: disabledFlush,
        runtimeStatus: runningStatus({
          formatting: false,
          rangeFormatting: false,
        }),
      }),
    );

    await expect(
      disabledRegistered.documentFormattingProvider.provideDocumentFormattingEdits(
        model(),
        { insertSpaces: true, tabSize: 4 },
      ),
    ).resolves.toEqual([]);
    await expect(
      disabledRegistered.rangeFormattingProvider.provideDocumentRangeFormattingEdits(
        model(),
        new disabledRegistered.monaco.Range(4, 1, 4, 11),
        { insertSpaces: true, tabSize: 4 },
      ),
    ).resolves.toEqual([]);
    expect(disabledFlush).not.toHaveBeenCalled();
    expect(disabledGateway.formatting).not.toHaveBeenCalled();
    expect(disabledGateway.rangeFormatting).not.toHaveBeenCalled();

    const mismatchedRegistered = createRegisteredProviders();
    const mismatchedGateway = featuresGateway();
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
      mismatchedRegistered.documentFormattingProvider.provideDocumentFormattingEdits(
        model(),
        { insertSpaces: true, tabSize: 4 },
      ),
    ).resolves.toEqual([]);
    await expect(
      mismatchedRegistered.rangeFormattingProvider.provideDocumentRangeFormattingEdits(
        model(),
        new mismatchedRegistered.monaco.Range(4, 1, 4, 11),
        { insertSpaces: true, tabSize: 4 },
      ),
    ).resolves.toEqual([]);
    expect(mismatchedFlush).not.toHaveBeenCalled();
    expect(mismatchedGateway.formatting).not.toHaveBeenCalled();
    expect(mismatchedGateway.rangeFormatting).not.toHaveBeenCalled();
  });

  it("drops stale PHP formatting results after session or root changes", async () => {
    const sessionRegistered = createRegisteredProviders();
    let activeSessionId = 1;
    const documentEdits =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["formatting"]>>
      >();
    const rangeEdits =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["rangeFormatting"]>>
      >();
    const sessionGateway = featuresGateway();
    vi.mocked(sessionGateway.formatting).mockImplementationOnce(
      async () => documentEdits.promise,
    );
    vi.mocked(sessionGateway.rangeFormatting).mockImplementationOnce(
      async () => rangeEdits.promise,
    );
    registerLanguageServerMonacoProviders(
      sessionRegistered.monaco,
      providerContext({
        featuresGateway: sessionGateway,
        getRuntimeStatus: () => ({
          ...runningStatus(),
          sessionId: activeSessionId,
        }),
      }),
    );

    const documentPromise =
      sessionRegistered.documentFormattingProvider.provideDocumentFormattingEdits(
        model(),
        { insertSpaces: true, tabSize: 4 },
      );
    const rangePromise =
      sessionRegistered.rangeFormattingProvider.provideDocumentRangeFormattingEdits(
        model(),
        new sessionRegistered.monaco.Range(4, 1, 4, 11),
        { insertSpaces: true, tabSize: 4 },
      );

    await Promise.resolve();
    activeSessionId = 2;
    documentEdits.resolve([{ newText: "<?php\n", range: range(0, 0, 1, 0) }]);
    rangeEdits.resolve([{ newText: "echo $user;", range: range(3, 0, 3, 10) }]);

    await expect(documentPromise).resolves.toEqual([]);
    await expect(rangePromise).resolves.toEqual([]);

    const rootRegistered = createRegisteredProviders();
    let activeRoot: string | null = "/project";
    const rootDocumentEdits =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["formatting"]>>
      >();
    const rootRangeEdits =
      createDeferred<
        Awaited<ReturnType<LanguageServerFeaturesGateway["rangeFormatting"]>>
      >();
    const rootGateway = featuresGateway();
    vi.mocked(rootGateway.formatting).mockImplementationOnce(
      async () => rootDocumentEdits.promise,
    );
    vi.mocked(rootGateway.rangeFormatting).mockImplementationOnce(
      async () => rootRangeEdits.promise,
    );
    registerLanguageServerMonacoProviders(
      rootRegistered.monaco,
      providerContext({
        featuresGateway: rootGateway,
        getWorkspaceRoot: () => activeRoot,
      }),
    );

    const rootDocumentPromise =
      rootRegistered.documentFormattingProvider.provideDocumentFormattingEdits(
        model(),
        { insertSpaces: true, tabSize: 4 },
      );
    const rootRangePromise =
      rootRegistered.rangeFormattingProvider.provideDocumentRangeFormattingEdits(
        model(),
        new rootRegistered.monaco.Range(4, 1, 4, 11),
        { insertSpaces: true, tabSize: 4 },
      );

    await Promise.resolve();
    activeRoot = null;
    rootDocumentEdits.resolve([
      { newText: "<?php\n", range: range(0, 0, 1, 0) },
    ]);
    rootRangeEdits.resolve([
      { newText: "echo $user;", range: range(3, 0, 3, 10) },
    ]);

    await expect(rootDocumentPromise).resolves.toEqual([]);
    await expect(rootRangePromise).resolves.toEqual([]);
  });

  it("maps PHP document semantic tokens and exposes a stable legend", async () => {
    const registered = createRegisteredProviders();
    const tokenData = [0, 1, 4, 12, 0, 0, 6, 5, 8, 1];
    const gateway = featuresGateway({
      semanticTokens: {
        data: tokenData,
        resultId: "full-1",
      },
    });
    const flushPendingDocumentChange = vi.fn(async () => undefined);
    registerLanguageServerMonacoProviders(
      registered.monaco,
      providerContext({
        featuresGateway: gateway,
        flushPendingDocumentChange,
      }),
    );

    await expect(
      registered.documentSemanticTokensProvider.provideDocumentSemanticTokens(
        model(),
      ),
    ).resolves.toEqual({
      data: Uint32Array.from(tokenData),
      resultId: "full-1",
    });
    expect(registered.documentSemanticTokensProvider.getLegend()).toEqual({
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
    expect(flushPendingDocumentChange).toHaveBeenCalledWith(
      "/project/src/User.php",
    );
    expect(gateway.semanticTokens).toHaveBeenCalledWith(
      "/project",
      "/project/src/User.php",
    );
  });

  it("maps PHP range semantic tokens and range", async () => {
    const registered = createRegisteredProviders();
    const tokenData = [0, 0, 3, 15, 0];
    const gateway = featuresGateway({
      rangeSemanticTokens: {
        data: tokenData,
        resultId: null,
      },
    });
    const flushPendingDocumentChange = vi.fn(async () => undefined);
    registerLanguageServerMonacoProviders(
      registered.monaco,
      providerContext({
        featuresGateway: gateway,
        flushPendingDocumentChange,
      }),
    );

    await expect(
      registered.rangeSemanticTokensProvider.provideDocumentRangeSemanticTokens(
        model(),
        new registered.monaco.Range(3, 2, 4, 5),
      ),
    ).resolves.toEqual({
      data: Uint32Array.from(tokenData),
    });
    expect(flushPendingDocumentChange).toHaveBeenCalledWith(
      "/project/src/User.php",
    );
    expect(gateway.rangeSemanticTokens).toHaveBeenCalledWith(
      "/project",
      "/project/src/User.php",
      range(2, 1, 3, 4),
    );
  });

  it("does not request PHP semantic tokens when capability is disabled", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      rangeSemanticTokens: {
        data: [0, 0, 3, 15, 0],
        resultId: null,
      },
      semanticTokens: {
        data: [0, 1, 4, 12, 0],
        resultId: "disabled",
      },
    });
    const flushPendingDocumentChange = vi.fn(async () => undefined);
    registerLanguageServerMonacoProviders(
      registered.monaco,
      providerContext({
        featuresGateway: gateway,
        flushPendingDocumentChange,
        runtimeStatus: runningStatus({ semanticTokens: false }),
      }),
    );

    await expect(
      registered.documentSemanticTokensProvider.provideDocumentSemanticTokens(
        model(),
      ),
    ).resolves.toBeNull();
    await expect(
      registered.rangeSemanticTokensProvider.provideDocumentRangeSemanticTokens(
        model(),
        new registered.monaco.Range(3, 2, 4, 5),
      ),
    ).resolves.toBeNull();
    expect(flushPendingDocumentChange).not.toHaveBeenCalled();
    expect(gateway.semanticTokens).not.toHaveBeenCalled();
    expect(gateway.rangeSemanticTokens).not.toHaveBeenCalled();
  });

  it("drops stale PHP semantic token results after session or root changes", async () => {
    const sessionRegistered = createRegisteredProviders();
    let activeSessionId = 1;
    const fullTokens = createDeferred<LanguageServerSemanticTokens | null>();
    const sessionGateway = featuresGateway();
    vi.mocked(sessionGateway.semanticTokens).mockImplementationOnce(
      async () => fullTokens.promise,
    );
    registerLanguageServerMonacoProviders(
      sessionRegistered.monaco,
      providerContext({
        featuresGateway: sessionGateway,
        getRuntimeStatus: () => ({
          ...runningStatus(),
          sessionId: activeSessionId,
        }),
      }),
    );

    const fullPromise =
      sessionRegistered.documentSemanticTokensProvider.provideDocumentSemanticTokens(
        model(),
      );

    for (
      let tick = 0;
      tick < 5 && vi.mocked(sessionGateway.semanticTokens).mock.calls.length === 0;
      tick += 1
    ) {
      await Promise.resolve();
    }
    expect(sessionGateway.semanticTokens).toHaveBeenCalledTimes(1);
    activeSessionId = 2;
    fullTokens.resolve({
      data: [0, 1, 4, 12, 0],
      resultId: "stale-full",
    });

    await expect(fullPromise).resolves.toBeNull();

    const rootRegistered = createRegisteredProviders();
    let activeRoot: string | null = "/project";
    const rangeTokens = createDeferred<LanguageServerSemanticTokens | null>();
    const rootGateway = featuresGateway();
    vi.mocked(rootGateway.rangeSemanticTokens).mockImplementationOnce(
      async () => rangeTokens.promise,
    );
    registerLanguageServerMonacoProviders(
      rootRegistered.monaco,
      providerContext({
        featuresGateway: rootGateway,
        getWorkspaceRoot: () => activeRoot,
      }),
    );

    const rangePromise =
      rootRegistered.rangeSemanticTokensProvider.provideDocumentRangeSemanticTokens(
        model(),
        new rootRegistered.monaco.Range(3, 2, 4, 5),
      );

    for (
      let tick = 0;
      tick < 5 &&
      vi.mocked(rootGateway.rangeSemanticTokens).mock.calls.length === 0;
      tick += 1
    ) {
      await Promise.resolve();
    }
    expect(rootGateway.rangeSemanticTokens).toHaveBeenCalledTimes(1);
    activeRoot = null;
    rangeTokens.resolve({
      data: [0, 0, 3, 15, 0],
      resultId: "stale-range",
    });

    await expect(rangePromise).resolves.toBeNull();
  });

  it("maps PHP linked editing ranges and wordPattern", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      linkedEditingRanges: {
        ranges: [range(3, 4, 3, 8), range(7, 12, 7, 16)],
        wordPattern: "[A-Za-z_][A-Za-z0-9_]*",
      },
    });
    const flushPendingDocumentChange = vi.fn(async () => undefined);
    const context = providerContext({
      featuresGateway: gateway,
      flushPendingDocumentChange,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.linkedEditingRangeProvider.provideLinkedEditingRanges(
        model(),
        position(),
      ),
    ).resolves.toEqual({
      ranges: [
        expect.objectContaining({
          endColumn: 9,
          endLineNumber: 4,
          startColumn: 5,
          startLineNumber: 4,
        }),
        expect.objectContaining({
          endColumn: 17,
          endLineNumber: 8,
          startColumn: 13,
          startLineNumber: 8,
        }),
      ],
      wordPattern: /[A-Za-z_][A-Za-z0-9_]*/,
    });
    expect(flushPendingDocumentChange).toHaveBeenCalledWith(
      "/project/src/User.php",
    );
    expect(gateway.linkedEditingRanges).toHaveBeenCalledWith("/project", {
      character: 4,
      line: 10,
      path: "/project/src/User.php",
    });
  });

  it("returns null for null or empty PHP linked editing ranges", async () => {
    const nullRegistered = createRegisteredProviders();
    const nullGateway = featuresGateway({ linkedEditingRanges: null });
    registerLanguageServerMonacoProviders(
      nullRegistered.monaco,
      providerContext({ featuresGateway: nullGateway }),
    );

    await expect(
      nullRegistered.linkedEditingRangeProvider.provideLinkedEditingRanges(
        model(),
        position(),
      ),
    ).resolves.toBeNull();

    const emptyRegistered = createRegisteredProviders();
    const emptyGateway = featuresGateway({
      linkedEditingRanges: {
        ranges: [],
        wordPattern: "[A-Za-z]+",
      },
    });
    registerLanguageServerMonacoProviders(
      emptyRegistered.monaco,
      providerContext({ featuresGateway: emptyGateway }),
    );

    await expect(
      emptyRegistered.linkedEditingRangeProvider.provideLinkedEditingRanges(
        model(),
        position(),
      ),
    ).resolves.toBeNull();
  });

  it("omits invalid PHP linked editing word patterns", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      linkedEditingRanges: {
        ranges: [range(3, 4, 3, 8)],
        wordPattern: "[",
      },
    });
    registerLanguageServerMonacoProviders(
      registered.monaco,
      providerContext({ featuresGateway: gateway }),
    );

    await expect(
      registered.linkedEditingRangeProvider.provideLinkedEditingRanges(
        model(),
        position(),
      ),
    ).resolves.toEqual({
      ranges: [
        expect.objectContaining({
          endColumn: 9,
          endLineNumber: 4,
          startColumn: 5,
          startLineNumber: 4,
        }),
      ],
    });
  });

  it("does not request PHP linked editing ranges when capability is disabled or runtime root mismatches", async () => {
    const disabledRegistered = createRegisteredProviders();
    const disabledGateway = featuresGateway({
      linkedEditingRanges: {
        ranges: [range(3, 4, 3, 8)],
        wordPattern: null,
      },
    });
    const disabledFlush = vi.fn(async () => undefined);
    registerLanguageServerMonacoProviders(
      disabledRegistered.monaco,
      providerContext({
        featuresGateway: disabledGateway,
        flushPendingDocumentChange: disabledFlush,
        runtimeStatus: runningStatus({ linkedEditingRange: false }),
      }),
    );

    await expect(
      disabledRegistered.linkedEditingRangeProvider.provideLinkedEditingRanges(
        model(),
        position(),
      ),
    ).resolves.toBeNull();
    expect(disabledFlush).not.toHaveBeenCalled();
    expect(disabledGateway.linkedEditingRanges).not.toHaveBeenCalled();

    const mismatchedRegistered = createRegisteredProviders();
    const mismatchedGateway = featuresGateway({
      linkedEditingRanges: {
        ranges: [range(7, 12, 7, 16)],
        wordPattern: null,
      },
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
      mismatchedRegistered.linkedEditingRangeProvider.provideLinkedEditingRanges(
        model(),
        position(),
      ),
    ).resolves.toBeNull();
    expect(mismatchedFlush).not.toHaveBeenCalled();
    expect(mismatchedGateway.linkedEditingRanges).not.toHaveBeenCalled();
  });

  it("drops stale PHP linked editing range results after session or root changes", async () => {
    const sessionRegistered = createRegisteredProviders();
    let activeSessionId = 1;
    const sessionRanges = createDeferred<LanguageServerLinkedEditingRanges | null>();
    const sessionGateway = featuresGateway();
    vi.mocked(sessionGateway.linkedEditingRanges).mockImplementationOnce(
      async () => sessionRanges.promise,
    );
    registerLanguageServerMonacoProviders(
      sessionRegistered.monaco,
      providerContext({
        featuresGateway: sessionGateway,
        getRuntimeStatus: () => ({
          ...runningStatus(),
          sessionId: activeSessionId,
        }),
      }),
    );

    const sessionPromise =
      sessionRegistered.linkedEditingRangeProvider.provideLinkedEditingRanges(
        model(),
        position(),
      );

    await Promise.resolve();
    activeSessionId = 2;
    sessionRanges.resolve({
      ranges: [range(3, 4, 3, 8)],
      wordPattern: null,
    });

    await expect(sessionPromise).resolves.toBeNull();

    const rootRegistered = createRegisteredProviders();
    let activeRoot: string | null = "/project";
    const rootRanges = createDeferred<LanguageServerLinkedEditingRanges | null>();
    const rootGateway = featuresGateway();
    vi.mocked(rootGateway.linkedEditingRanges).mockImplementationOnce(
      async () => rootRanges.promise,
    );
    registerLanguageServerMonacoProviders(
      rootRegistered.monaco,
      providerContext({
        featuresGateway: rootGateway,
        getWorkspaceRoot: () => activeRoot,
      }),
    );

    const rootPromise =
      rootRegistered.linkedEditingRangeProvider.provideLinkedEditingRanges(
        model(),
        position(),
      );

    await Promise.resolve();
    activeRoot = null;
    rootRanges.resolve({
      ranges: [range(7, 12, 7, 16)],
      wordPattern: null,
    });

    await expect(rootPromise).resolves.toBeNull();
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

  it("resolves and applies lazy PHP code actions when their menu command runs", async () => {
    const registered = createRegisteredProviders();
    const openPath = "/project/src/User.php";
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
    const openModel = {
      ...model({ content: "", path: openPath }),
      pushEditOperations: vi.fn(),
    };
    const gateway = featuresGateway({
      codeActions: [unresolvedAction],
      resolvedCodeAction: resolvedAction,
    });
    const flushPendingDocumentChange = vi.fn(async () => undefined);
    const applyWorkspaceEdit = vi.fn(async () => undefined);
    vi.mocked(registered.monaco.editor.getModels).mockReturnValue([openModel]);
    registerLanguageServerMonacoProviders(
      registered.monaco,
      providerContext({
        applyWorkspaceEdit,
        featuresGateway: gateway,
        flushPendingDocumentChange,
      }),
    );

    const actions = await registered.codeActionProvider.provideCodeActions(
      openModel,
      new registered.monaco.Range(3, 5, 3, 9),
      {
        markers: [],
        only: "quickfix",
        trigger: registered.monaco.languages.CodeActionTriggerType.Invoke,
      },
    );

    const actionCommand = actions.actions[0].command;

    expect(actionCommand).toEqual(
      expect.objectContaining({
        id: "mockor.php.resolveAndApplyCodeAction",
        title: "Import User",
      }),
    );

    const runResolveAndApply =
      registered.commandRunsById["mockor.php.resolveAndApplyCodeAction"];

    if (!runResolveAndApply) {
      throw new Error("PHP resolve-and-apply code action command was not registered");
    }

    await runResolveAndApply(null, actionCommand.arguments[0]);

    expect(flushPendingDocumentChange).toHaveBeenCalledWith(openPath);
    expect(gateway.resolveCodeAction).toHaveBeenCalledWith(
      "/project",
      unresolvedAction,
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
          text: "use App\\Models\\User;\n",
        },
      ],
      expect.any(Function),
    );
    expect(applyWorkspaceEdit).toHaveBeenCalledWith(resolvedAction.edit, {
      applyOpenModels: expect.any(Function),
      openPaths: [openPath],
      rootPath: "/project",
    });
  });

  it("returns PHP code actions that already carry an inline edit without requesting a resolve", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway();
    const context = providerContext({ featuresGateway: gateway });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const inlineEditAction = {
      ...backedCodeAction(),
      __languageServerAction: {
        command: null,
        data: { id: "override-method" },
        edit: workspaceEdit(
          "file:///project/src/User.php",
          "public function handle(): void {}\n",
        ),
        isPreferred: true,
        kind: "quickfix",
        title: "Override one of 3 methods",
      },
      edit: {
        edits: [
          {
            resource: {
              fsPath: "/project/src/User.php",
              path: "/project/src/User.php",
            },
            textEdit: {
              range: new registered.monaco.Range(1, 1, 1, 1),
              text: "public function handle(): void {}\n",
            },
            versionId: 42,
          },
        ],
      },
      title: "Override one of 3 methods",
    };

    const resolved =
      await registered.codeActionProvider.resolveCodeAction(inlineEditAction);

    expect(gateway.resolveCodeAction).not.toHaveBeenCalled();
    expect(resolved).toBe(inlineEditAction);
  });

  it("stages inline PHP LSP edits and leaves open models untouched when authoritative validation rejects", async () => {
    const registered = createRegisteredProviders();
    const openPath = "/project/src/User.php";
    const openUri = "file:///project/src/User.php";
    const edit: LanguageServerWorkspaceEdit = {
      changes: {
        ...workspaceEdit(openUri, "final ").changes,
        ...workspaceEdit("file:///project/src/Helper.php", "final ").changes,
      },
      documentVersions: { [openUri]: 42 },
      fileOperations: [
        {
          kind: "create",
          uri: "file:///project/src/Created.php",
        },
      ],
    };
    const openModel = {
      ...model({ content: "<?php\r\nclass User {}\r\n", path: openPath }),
      pushEditOperations: vi.fn(),
    };
    const gateway = featuresGateway({
      codeActions: [
        {
          command: null,
          data: null,
          edit,
          isPreferred: true,
          kind: "quickfix",
          title: "Make final",
        },
      ],
    });
    const applyWorkspaceEdit = vi.fn(
      async (
        _edit: LanguageServerWorkspaceEdit,
        _context: PhpWorkspaceEditApplicationContext,
      ) => ({
        kind: "rejected" as const,
        path: openPath,
        reason: "staleDocumentVersion" as const,
      }),
    );
    vi.mocked(registered.monaco.editor.getModels).mockReturnValue([openModel]);
    registerLanguageServerMonacoProviders(
      registered.monaco,
      providerContext({ applyWorkspaceEdit, featuresGateway: gateway }),
    );

    const actions = await registered.codeActionProvider.provideCodeActions(
      openModel,
      new registered.monaco.Range(1, 1, 1, 1),
      {
        markers: [],
        only: "quickfix",
        trigger: registered.monaco.languages.CodeActionTriggerType.Invoke,
      },
    );
    const [action] = actions.actions;
    expect(action.edit).toBeUndefined();
    expect(action.command?.id).toBe("mockor.php.resolveAndApplyCodeAction");

    const runApply =
      registered.commandRunsById["mockor.php.resolveAndApplyCodeAction"];
    if (!runApply) {
      throw new Error("PHP staged code action command was not registered");
    }
    await runApply(null, action.command?.arguments?.[0]);

    expect(gateway.resolveCodeAction).not.toHaveBeenCalled();
    expect(openModel.pushEditOperations).not.toHaveBeenCalled();
    expect(applyWorkspaceEdit).toHaveBeenCalledWith(edit, {
      applyOpenModels: expect.any(Function),
      openPaths: [openPath],
      rootPath: "/project",
    });
  });

  it("returns PHP code actions that already carry a command without requesting a resolve", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway();
    const context = providerContext({ featuresGateway: gateway });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const commandAction = {
      ...backedCodeAction(),
      __languageServerAction: {
        command: {
          arguments: [],
          command: "phpactor.fixAll",
          title: "Fix all",
        },
        data: { id: "fix-all" },
        edit: null,
        isPreferred: true,
        kind: "quickfix",
        title: "Fix all",
      },
      command: {
        arguments: [],
        id: "mockor.php.executeLanguageServerCommand",
        title: "Fix all",
      },
      title: "Fix all",
    };

    const resolved =
      await registered.codeActionProvider.resolveCodeAction(commandAction);

    expect(gateway.resolveCodeAction).not.toHaveBeenCalled();
    expect(resolved).toBe(commandAction);
  });

  it("does not report an error when a PHP server without resolve support fails to resolve an edit-less action", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway();
    vi.mocked(gateway.resolveCodeAction).mockRejectedValueOnce(
      new Error("Handler codeAction/resolve not found"),
    );
    const reportError = vi.fn();
    const context = providerContext({ featuresGateway: gateway, reportError });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const editlessAction = backedCodeAction();

    const resolved =
      await registered.codeActionProvider.resolveCodeAction(editlessAction);

    expect(resolved).toBe(editlessAction);
    expect(reportError).not.toHaveBeenCalled();
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

  it("merges the PHP implement-methods code action with phpactor actions", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      codeActions: [
        {
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
      ],
    });
    const providePhpCodeActions = vi.fn(async () => [
      {
        edits: [
          {
            range: {
              endColumn: 1,
              endLineNumber: 5,
              startColumn: 1,
              startLineNumber: 5,
            },
            text: "\n    public function handle(): void\n    {\n        // TODO: Implement handle().\n    }\n",
          },
        ],
        title: "Implement methods",
      },
    ]);
    const context = providerContext({
      featuresGateway: gateway,
      providePhpCodeActions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const actions = await registered.codeActionProvider.provideCodeActions(
      model({ content: "<?php\nclass Foo implements Bar\n{\n}\n" }),
      new registered.monaco.Range(2, 1, 2, 1),
      {
        markers: [],
        only: "quickfix",
        trigger: registered.monaco.languages.CodeActionTriggerType.Invoke,
      },
    );

    expect(providePhpCodeActions).toHaveBeenCalledWith(
      "<?php\nclass Foo implements Bar\n{\n}\n",
      { end: 6, start: 6 },
    );
    expect(actions.actions).toEqual([
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
                  endLineNumber: 5,
                  startColumn: 1,
                  startLineNumber: 5,
                }),
                text: "\n    public function handle(): void\n    {\n        // TODO: Implement handle().\n    }\n",
              },
              versionId: 42,
            },
          ],
        },
        kind: "quickfix",
        title: "Implement methods",
      }),
      expect.objectContaining({ title: "Import User" }),
    ]);
  });

  it("uses the captured PHP workspace root for workspace-edit code actions", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      codeActions: [
        {
          command: {
            arguments: [],
            command: "phpactor.create_member",
            title: "Create member",
          },
          data: { id: "create-member" },
          edit: null,
          isPreferred: false,
          kind: "quickfix",
          title: 'Fix "Method "formatTotals" does not exist"',
        },
      ],
    });
    const applyWorkspaceEdit = vi.fn(async () => ({ kind: "accepted" as const }));
    const workspaceEdit = {
      changes: {
        "file:///project/app/Support/QaBase.php": [
          {
            newText: "\n    protected function formatTotals()\n    {\n    }\n",
            range: {
              end: { character: 1, line: 5 },
              start: { character: 1, line: 5 },
            },
          },
        ],
      },
    };
    const providePhpCodeActions = vi.fn(async () => [
      {
        edits: [],
        isPreferred: true,
        kind: "quickfix",
        title: "Create method 'formatTotals' in 'QaBase'",
        workspaceEdit,
        workspaceRoot: "/project",
      },
    ]);
    const context = providerContext({
      applyWorkspaceEdit,
      featuresGateway: gateway,
      providePhpCodeActions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const actions = await registered.codeActionProvider.provideCodeActions(
      model({
        content:
          "<?php\nclass QaChild extends QaBase\n{\n    public function run(): void\n    {\n        parent::formatTotals();\n    }\n}\n",
      }),
      new registered.monaco.Range(6, 9, 6, 31),
      {
        markers: [],
        only: "quickfix",
        trigger: registered.monaco.languages.CodeActionTriggerType.Invoke,
      },
    );

    expect(actions.actions[0]).toEqual(
      expect.objectContaining({
        command: expect.objectContaining({
          id: "mockor.php.applyCodeActionWorkspaceEdit",
          arguments: [
            expect.objectContaining({
              rootPath: "/project",
              edit: workspaceEdit,
            }),
          ],
        }),
        title: "Create method 'formatTotals' in 'QaBase'",
      }),
    );
    expect(actions.actions.map((action: { title: string }) => action.title)).toContain(
      'Fix "Method "formatTotals" does not exist"',
    );
  });

  it("orders local Create class before external phpactor create-file actions", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      codeActions: [
        phpactorCreateTypeAction("Create class MailDispatcher"),
        phpactorCreateTypeAction("Create interface MailDispatcher"),
        phpactorCreateTypeAction("Create trait MailDispatcher"),
        phpactorCreateTypeAction("Create enum MailDispatcher"),
        {
          command: {
            arguments: ["App\\Services\\MailDispatcher"],
            command: "phpactor.import_class",
            title: "Import class",
          },
          data: { id: "import-class" },
          edit: null,
          isPreferred: false,
          kind: "quickfix",
          title: "Import class",
        },
      ],
    });
    const providePhpCodeActions = vi.fn(async () => [
      {
        edits: [],
        isPreferred: true,
        kind: "quickfix",
        newFile: {
          content:
            "<?php\n\nnamespace App\\Services;\n\nclass MailDispatcher\n{\n}\n",
          path: "/project/src/MailDispatcher.php",
        },
        title: "Create class MailDispatcher",
      },
    ]);
    const context = providerContext({
      applyPhpCodeActionNewFile: vi.fn(async () => true),
      featuresGateway: gateway,
      providePhpCodeActions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const actions = await registered.codeActionProvider.provideCodeActions(
      model({ content: "<?php\n$service = new MailDispatcher();\n" }),
      new registered.monaco.Range(2, 16, 2, 30),
      {
        markers: [],
        only: "quickfix",
        trigger: registered.monaco.languages.CodeActionTriggerType.Invoke,
      },
    );
    const titles = actions.actions.map(
      (action: { title: string }) => action.title,
    );

    expect(titles[0]).toBe("Create class MailDispatcher");
    expect(titles.slice(0, 4)).not.toContain("Create interface MailDispatcher");
    expect(titles.slice(0, 4)).not.toContain("Create trait MailDispatcher");
    expect(titles.slice(0, 4)).not.toContain("Create enum MailDispatcher");
    expect(titles).toContain("Import class");
  });

  it("hides phpactor create-file variants when a safe local Create class action exists", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      codeActions: [
        phpactorCreateTypeAction(
          "Create default file CodevoQaGeneratedService.php",
        ),
        phpactorCreateTypeAction(
          "Create interface file CodevoQaGeneratedService.php",
        ),
        phpactorCreateTypeAction(
          "Create trait file CodevoQaGeneratedService.php",
        ),
        phpactorCreateTypeAction(
          "Create enum file CodevoQaGeneratedService.php",
        ),
        {
          command: {
            arguments: [],
            command: "phpactor.add_missing_properties",
            title: "Add missing properties",
          },
          data: { id: "add-missing-properties" },
          edit: null,
          isPreferred: false,
          kind: "quickfix",
          title: "Add missing properties",
        },
      ],
    });
    const providePhpCodeActions = vi.fn(async () => [
      {
        edits: [],
        isPreferred: true,
        kind: "quickfix",
        newFile: {
          content: "<?php\n\nclass CodevoQaGeneratedService\n{\n}\n",
          path: "/project/src/CodevoQaGeneratedService.php",
        },
        title: "Create class CodevoQaGeneratedService",
      },
    ]);
    const context = providerContext({
      applyPhpCodeActionNewFile: vi.fn(async () => true),
      featuresGateway: gateway,
      providePhpCodeActions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const actions = await registered.codeActionProvider.provideCodeActions(
      model({
        content: "<?php\n$service = new CodevoQaGeneratedService();\n",
      }),
      new registered.monaco.Range(2, 16, 2, 40),
      {
        markers: [],
        only: "quickfix",
        trigger: registered.monaco.languages.CodeActionTriggerType.Invoke,
      },
    );
    const titles = actions.actions.map(
      (action: { title: string }) => action.title,
    );

    expect(titles[0]).toBe("Create class CodevoQaGeneratedService");
    expect(titles).not.toContain(
      "Create default file CodevoQaGeneratedService.php",
    );
    expect(titles).not.toContain(
      "Create interface file CodevoQaGeneratedService.php",
    );
    expect(titles).not.toContain(
      "Create trait file CodevoQaGeneratedService.php",
    );
    expect(titles).not.toContain(
      "Create enum file CodevoQaGeneratedService.php",
    );
    expect(titles).toContain("Add missing properties");
  });

  it("filters duplicate phpactor create class quick fixes while preserving unrelated phpactor actions", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      codeActions: [
        phpactorCreateTypeAction("Create class MailDispatcher"),
        phpactorCreateTypeAction("Create class MailDispatcher"),
        {
          command: {
            arguments: [],
            command: "phpactor.add_missing_properties",
            title: "Add missing properties",
          },
          data: { id: "add-missing-properties" },
          edit: null,
          isPreferred: false,
          kind: "quickfix",
          title: "Add missing properties",
        },
      ],
    });
    const providePhpCodeActions = vi.fn(async () => [
      {
        edits: [],
        isPreferred: true,
        kind: "quickfix",
        newFile: {
          content:
            "<?php\n\nnamespace App\\Services;\n\nclass MailDispatcher\n{\n}\n",
          path: "/project/src/MailDispatcher.php",
        },
        title: "Create class MailDispatcher",
      },
    ]);
    const context = providerContext({
      applyPhpCodeActionNewFile: vi.fn(async () => true),
      featuresGateway: gateway,
      providePhpCodeActions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const actions = await registered.codeActionProvider.provideCodeActions(
      model({ content: "<?php\n$service = new MailDispatcher();\n" }),
      new registered.monaco.Range(2, 16, 2, 30),
      {
        markers: [],
        only: "quickfix",
        trigger: registered.monaco.languages.CodeActionTriggerType.Invoke,
      },
    );
    const titles = actions.actions.map(
      (action: { title: string }) => action.title,
    );

    expect(
      titles.filter(
        (title: string) => title === "Create class MailDispatcher",
      ),
    ).toHaveLength(1);
    expect(titles[0]).toBe("Create class MailDispatcher");
    expect(titles).toContain("Add missing properties");
  });

  it("hides phpactor create method variants when a safe local Create method action exists", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      codeActions: [
        phpactorCreateMemberAction('Create method "doWork"'),
        phpactorCreateMemberAction("Create method App\\Service::doWork"),
        {
          command: {
            arguments: [],
            command: "phpactor.add_missing_properties",
            title: "Add missing properties",
          },
          data: { id: "add-missing-properties" },
          edit: null,
          isPreferred: false,
          kind: "quickfix",
          title: "Add missing properties",
        },
      ],
    });
    const providePhpCodeActions = vi.fn(async () => [
      {
        edits: [
          {
            range: {
              endColumn: 1,
              endLineNumber: 6,
              startColumn: 1,
              startLineNumber: 6,
            },
            text: "\n    private function doWork(): void\n    {\n    }\n",
          },
        ],
        isPreferred: true,
        kind: "quickfix",
        title: "Create method 'doWork'",
      },
    ]);
    const context = providerContext({
      featuresGateway: gateway,
      providePhpCodeActions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const actions = await registered.codeActionProvider.provideCodeActions(
      model({ content: "<?php\nclass Service\n{\n    public function run(): void\n    {\n        $this->doWork();\n    }\n}\n" }),
      new registered.monaco.Range(6, 16, 6, 22),
      {
        markers: [],
        only: "quickfix",
        trigger: registered.monaco.languages.CodeActionTriggerType.Invoke,
      },
    );
    const titles = actions.actions.map(
      (action: { title: string }) => action.title,
    );

    expect(titles[0]).toBe("Create method 'doWork'");
    expect(titles).not.toContain('Create method "doWork"');
    expect(titles).not.toContain("Create method App\\Service::doWork");
    expect(titles).toContain("Add missing properties");
  });

  it("hides phpactor create property variants when a safe local Create property action exists", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      codeActions: [
        phpactorCreateMemberAction("Create property $status"),
        {
          command: {
            arguments: [],
            command: "phpactor.add_missing_properties",
            title: "Add missing properties",
          },
          data: { id: "add-missing-properties" },
          edit: null,
          isPreferred: false,
          kind: "quickfix",
          title: "Add missing properties",
        },
      ],
    });
    const providePhpCodeActions = vi.fn(async () => [
      {
        edits: [
          {
            range: {
              endColumn: 1,
              endLineNumber: 5,
              startColumn: 1,
              startLineNumber: 5,
            },
            text: "\n    private string $status;\n",
          },
        ],
        isPreferred: true,
        kind: "quickfix",
        title: "Create property 'status'",
      },
    ]);
    const context = providerContext({
      featuresGateway: gateway,
      providePhpCodeActions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const actions = await registered.codeActionProvider.provideCodeActions(
      model({ content: "<?php\nclass Service\n{\n    public function run(): string\n    {\n        return $this->status;\n    }\n}\n" }),
      new registered.monaco.Range(6, 23, 6, 29),
      {
        markers: [],
        only: "quickfix",
        trigger: registered.monaco.languages.CodeActionTriggerType.Invoke,
      },
    );
    const titles = actions.actions.map(
      (action: { title: string }) => action.title,
    );

    expect(titles[0]).toBe("Create property 'status'");
    expect(titles).not.toContain("Create property $status");
    expect(titles).toContain("Add missing properties");
  });

  it("maps a PHP code action's newFile to a file-create resource edit plus a content insertion", async () => {
    const registered = createRegisteredProviders();
    (registered.monaco.Uri as typeof registered.monaco.Uri & {
      parse: typeof URI.parse;
    }).parse = URI.parse;
    const gateway = featuresGateway();
    const providePhpCodeActions = vi.fn(async () => [
      {
        edits: [
          {
            range: {
              endColumn: 17,
              endLineNumber: 2,
              startColumn: 17,
              startLineNumber: 2,
            },
            text: " implements GreeterInterface",
          },
        ],
        kind: "refactor.extract",
        newFile: {
          content:
            "<?php\n\ninterface GreeterInterface\n{\n    public function greet(): string;\n}\n",
          path: "/project/src/GreeterInterface.php",
        },
        title: "Extract interface",
      },
    ]);
    const context = providerContext({
      featuresGateway: gateway,
      providePhpCodeActions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const actions = await registered.codeActionProvider.provideCodeActions(
      model({ content: "<?php\nclass Greeter\n{\n}\n" }),
      new registered.monaco.Range(2, 1, 2, 1),
      {
        markers: [],
        only: "refactor",
        trigger: registered.monaco.languages.CodeActionTriggerType.Invoke,
      },
    );

    const extractInterface = actions.actions.find(
      (action: { title: string }) => action.title === "Extract interface",
    );
    expect(extractInterface).toBeDefined();
    const edits = extractInterface?.edit?.edits ?? [];
    // First: the file-create resource edit (newResource, no oldResource).
    const scopedResource = URI.parse(
      workspaceModelUri("/project", "/project/src/GreeterInterface.php")!,
    );
    expect(edits[0]).toEqual({
      newResource: scopedResource,
      options: { ignoreIfExists: true },
    });
    // Second: the content insertion into the new file's model.
    expect(edits[1]).toEqual({
      resource: scopedResource,
      textEdit: {
        range: expect.objectContaining({
          endColumn: 1,
          endLineNumber: 1,
          startColumn: 1,
          startLineNumber: 1,
        }),
        text: "<?php\n\ninterface GreeterInterface\n{\n    public function greet(): string;\n}\n",
      },
      versionId: undefined,
    });
    // Last: the in-document implements edit on the active model.
    expect(edits[2]).toEqual(
      expect.objectContaining({
        textEdit: expect.objectContaining({
          text: " implements GreeterInterface",
        }),
      }),
    );
  });

  it("maps a PHP code action's path-scoped edit to the target workspace file", async () => {
    const registered = createRegisteredProviders();
    (registered.monaco.Uri as typeof registered.monaco.Uri & {
      parse: typeof URI.parse;
    }).parse = URI.parse;
    const gateway = featuresGateway();
    const presenterPath = "/project/app/UI/Home/OtherPresenter.php";
    const providePhpCodeActions = vi.fn(async () => [
      {
        edits: [
          {
            path: presenterPath,
            range: {
              endColumn: 1,
              endLineNumber: 8,
              startColumn: 1,
              startLineNumber: 8,
            },
            text: "\n    public function renderDetail(): void\n    {\n    }\n",
          },
        ],
        kind: "quickfix",
        title: "Create renderDetail",
      },
    ]);
    const source = "<?php\nclass HomePresenter\n{\n}\n";
    const context = providerContext({
      activeDocument: {
        content: source,
        language: "php",
        name: "HomePresenter.php",
        path: "/project/app/UI/Home/HomePresenter.php",
        savedContent: source,
      },
      featuresGateway: gateway,
      providePhpCodeActions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const actions = await registered.codeActionProvider.provideCodeActions(
      model({
        content: source,
        path: "/project/app/UI/Home/HomePresenter.php",
      }),
      new registered.monaco.Range(2, 1, 2, 1),
      {
        markers: [],
        only: "quickfix",
        trigger: registered.monaco.languages.CodeActionTriggerType.Invoke,
      },
    );

    const createRender = actions.actions.find(
      (action: { title: string }) => action.title === "Create renderDetail",
    );
    const edits = createRender?.edit?.edits ?? [];

    expect(edits).toEqual([
      {
        resource: expect.objectContaining({
          path: (URI.parse(workspaceModelUri("/project", presenterPath)!) as {
            path: string;
          }).path,
          scheme: "workspace-file",
        }),
        textEdit: {
          range: expect.objectContaining({
            endColumn: 1,
            endLineNumber: 8,
            startColumn: 1,
            startLineNumber: 8,
          }),
          text: "\n    public function renderDetail(): void\n    {\n    }\n",
        },
        versionId: undefined,
      },
    ]);
  });

  it("keeps the stale-edit version guard when a path-scoped edit targets the active model", async () => {
    const registered = createRegisteredProviders();
    (registered.monaco.Uri as typeof registered.monaco.Uri & {
      parse: typeof URI.parse;
    }).parse = URI.parse;
    const gateway = featuresGateway();
    const sourcePath = "/project/app/UI/Home/HomePresenter.php";
    const source = "<?php\nclass HomePresenter\n{\n}\n";
    const providePhpCodeActions = vi.fn(async () => [
      {
        edits: [
          {
            path: sourcePath,
            range: {
              endColumn: 1,
              endLineNumber: 3,
              startColumn: 1,
              startLineNumber: 3,
            },
            text: "    public function renderDetail(): void {}\n",
          },
        ],
        kind: "quickfix",
        title: "Create renderDetail",
      },
    ]);
    const context = providerContext({
      activeDocument: {
        content: source,
        language: "php",
        name: "HomePresenter.php",
        path: sourcePath,
        savedContent: source,
      },
      featuresGateway: gateway,
      providePhpCodeActions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const actions = await registered.codeActionProvider.provideCodeActions(
      model({ content: source, path: sourcePath }),
      new registered.monaco.Range(2, 1, 2, 1),
      {
        markers: [],
        only: "quickfix",
        trigger: registered.monaco.languages.CodeActionTriggerType.Invoke,
      },
    );

    const createRender = actions.actions.find(
      (action: { title: string }) => action.title === "Create renderDetail",
    );

    expect(createRender?.edit?.edits[0]).toEqual(
      expect.objectContaining({
        versionId: 42,
      }),
    );
  });

  it("forwards a PHP code action's isPreferred flag to Monaco", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway();
    const providePhpCodeActions = vi.fn(async () => [
      {
        edits: [
          {
            range: {
              endColumn: 1,
              endLineNumber: 9,
              startColumn: 1,
              startLineNumber: 9,
            },
            text: "\n    private function doWork(): void\n    {\n    }\n",
          },
        ],
        isPreferred: true,
        kind: "quickfix",
        title: "Create method 'doWork'",
      },
    ]);
    const context = providerContext({
      featuresGateway: gateway,
      providePhpCodeActions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const actions = await registered.codeActionProvider.provideCodeActions(
      model({ content: "<?php\nclass Foo\n{\n}\n" }),
      new registered.monaco.Range(2, 1, 2, 1),
      {
        markers: [],
        only: "quickfix",
        trigger: registered.monaco.languages.CodeActionTriggerType.Invoke,
      },
    );

    const createMethod = actions.actions.find(
      (action: { title: string }) => action.title === "Create method 'doWork'",
    );
    expect(createMethod?.isPreferred).toBe(true);
    expect(createMethod?.kind).toBe("quickfix");
  });

  it("routes a PHP code action's newFile through an atomic disk-persisting command when wired", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway();
    const sourceModel = {
      ...model({
        content: "<?php\nclass Greeter\n{\n}\n",
      }),
      pushEditOperations: vi.fn(),
    };
    const newFile = {
      content:
        "<?php\n\ninterface GreeterInterface\n{\n    public function greet(): string;\n}\n",
      path: "/project/src/GreeterInterface.php",
    };
    const providePhpCodeActions = vi.fn(async () => [
      {
        edits: [
          {
            range: {
              endColumn: 17,
              endLineNumber: 2,
              startColumn: 17,
              startLineNumber: 2,
            },
            text: " implements GreeterInterface",
          },
        ],
        kind: "refactor.extract",
        newFile,
        title: "Extract interface",
      },
    ]);
    // Resolves `true`: the interface file was freshly written, so the command
    // applies the paired `implements` edit.
    const applyPhpCodeActionNewFile = vi.fn(async () => true);
    const clearLanguageServerDiagnosticsForPath = vi.fn();
    const flushPendingDocumentChange = vi.fn(async () => undefined);
    vi.mocked(registered.monaco.editor.getModels).mockReturnValue([
      sourceModel,
    ]);
    const context = providerContext({
      applyPhpCodeActionNewFile,
      clearLanguageServerDiagnosticsForPath,
      featuresGateway: gateway,
      flushPendingDocumentChange,
      providePhpCodeActions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const actions = await registered.codeActionProvider.provideCodeActions(
      sourceModel,
      new registered.monaco.Range(2, 1, 2, 1),
      {
        markers: [],
        only: "refactor",
        trigger: registered.monaco.languages.CodeActionTriggerType.Invoke,
      },
    );

    const extractInterface = actions.actions.find(
      (action: { title: string }) => action.title === "Extract interface",
    );
    expect(extractInterface).toBeDefined();
    const edits = extractInterface?.edit?.edits ?? [];
    // The action carries no eager document edit. Its command writes the file
    // first, then applies the implements edit to the original model.
    expect(edits).toEqual([]);
    expect(extractInterface?.command?.id).toBe(
      "mockor.php.applyCodeActionNewFile",
    );

    const run =
      registered.commandRunsById["mockor.php.applyCodeActionNewFile"];
    expect(run).toBeDefined();
    await run(null, extractInterface?.command?.arguments?.[0]);
    expect(flushPendingDocumentChange).toHaveBeenCalledWith(
      "/project/src/User.php",
    );
    expect(applyPhpCodeActionNewFile).toHaveBeenCalledWith(newFile);
    expect(clearLanguageServerDiagnosticsForPath).toHaveBeenCalledWith(
      "/project/src/User.php",
    );
    expect(sourceModel.pushEditOperations).toHaveBeenCalledWith(
      [],
      [
        {
          range: expect.objectContaining({
            endColumn: 17,
            endLineNumber: 2,
            startColumn: 17,
            startLineNumber: 2,
          }),
          text: " implements GreeterInterface",
        },
      ],
      expect.any(Function),
    );
  });

  it("routes a PHP code action's workspaceEdit through the workspace-edit apply command", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway();
    const sourceModel = {
      ...model({
        content: "<?php\nclass Child extends Base\n{\n}\n",
      }),
      pushEditOperations: vi.fn(),
    };
    const parentEdit = {
      changes: {
        "file:///project/src/Base.php": [
          {
            newText: "\n    protected function helper()\n    {\n    }\n",
            range: {
              end: { character: 0, line: 3 },
              start: { character: 0, line: 3 },
            },
          },
        ],
      },
    };
    const providePhpCodeActions = vi.fn(async () => [
      {
        edits: [],
        isPreferred: true,
        kind: "quickfix",
        title: "Create method 'helper' in 'Base'",
        workspaceEdit: parentEdit,
      },
    ]);
    const applyWorkspaceEdit = vi.fn(async () => undefined);
    vi.mocked(registered.monaco.editor.getModels).mockReturnValue([
      sourceModel,
    ]);
    const context = providerContext({
      applyWorkspaceEdit,
      featuresGateway: gateway,
      providePhpCodeActions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const actions = await registered.codeActionProvider.provideCodeActions(
      sourceModel,
      new registered.monaco.Range(2, 1, 2, 1),
      {
        markers: [],
        only: "quickfix",
        trigger: registered.monaco.languages.CodeActionTriggerType.Invoke,
      },
    );

    const createMethod = actions.actions.find(
      (action: { title: string }) =>
        action.title === "Create method 'helper' in 'Base'",
    );
    expect(createMethod).toBeDefined();
    expect(createMethod?.edit?.edits ?? []).toEqual([]);
    expect(createMethod?.command?.id).toBe(
      "mockor.php.applyCodeActionWorkspaceEdit",
    );

    const run =
      registered.commandRunsById["mockor.php.applyCodeActionWorkspaceEdit"];
    expect(run).toBeDefined();
    await run(null, createMethod?.command?.arguments?.[0]);
    expect(applyWorkspaceEdit).toHaveBeenCalledWith(
      parentEdit,
      expect.objectContaining({
        applyOpenModels: expect.any(Function),
        openPaths: [],
        rootPath: "/project",
      }),
    );
  });

  it("drops a PHP workspaceEdit code action when the workspace-edit applier is not wired", async () => {
    const registered = createRegisteredProviders();
    const sourceModel = {
      ...model({
        content: "<?php\nclass Child extends Base\n{\n}\n",
      }),
      pushEditOperations: vi.fn(),
    };
    const providePhpCodeActions = vi.fn(async () => [
      {
        edits: [],
        isPreferred: true,
        kind: "quickfix",
        title: "Create method 'helper' in 'Base'",
        workspaceEdit: {
          changes: {
            "file:///project/src/Base.php": [
              {
                newText: "\n    protected function helper()\n    {\n    }\n",
                range: {
                  end: { character: 0, line: 3 },
                  start: { character: 0, line: 3 },
                },
              },
            ],
          },
        },
      },
    ]);
    const context = providerContext({ providePhpCodeActions });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const actions = await registered.codeActionProvider.provideCodeActions(
      sourceModel,
      new registered.monaco.Range(2, 1, 2, 1),
      {
        markers: [],
        only: "quickfix",
        trigger: registered.monaco.languages.CodeActionTriggerType.Invoke,
      },
    );

    expect(
      actions.actions.map((action: { title: string }) => action.title),
    ).not.toContain("Create method 'helper' in 'Base'");
  });

  it("drops a PHP workspaceEdit code action when no workspace root is active", async () => {
    const registered = createRegisteredProviders();
    const sourceModel = {
      ...model({
        content: "<?php\nclass Child extends Base\n{\n}\n",
      }),
      pushEditOperations: vi.fn(),
    };
    const providePhpCodeActions = vi.fn(async () => [
      {
        edits: [],
        isPreferred: true,
        kind: "quickfix",
        title: "Create method 'helper' in 'Base'",
        workspaceEdit: {
          changes: {
            "file:///project/src/Base.php": [
              {
                newText: "\n    protected function helper()\n    {\n    }\n",
                range: {
                  end: { character: 0, line: 3 },
                  start: { character: 0, line: 3 },
                },
              },
            ],
          },
        },
      },
    ]);
    const applyWorkspaceEdit = vi.fn(async () => undefined);
    const context = providerContext({
      applyWorkspaceEdit,
      getWorkspaceRoot: () => null,
      providePhpCodeActions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const actions = await registered.codeActionProvider.provideCodeActions(
      sourceModel,
      new registered.monaco.Range(2, 1, 2, 1),
      {
        markers: [],
        only: "quickfix",
        trigger: registered.monaco.languages.CodeActionTriggerType.Invoke,
      },
    );

    expect(
      actions.actions.map((action: { title: string }) => action.title),
    ).not.toContain("Create method 'helper' in 'Base'");
  });

  it("does not apply a PHP workspaceEdit command without a payload edit", async () => {
    const registered = createRegisteredProviders();
    const applyWorkspaceEdit = vi.fn(async () => undefined);
    const context = providerContext({ applyWorkspaceEdit });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const run =
      registered.commandRunsById["mockor.php.applyCodeActionWorkspaceEdit"];
    expect(run).toBeDefined();
    await run(null, undefined);

    expect(applyWorkspaceEdit).not.toHaveBeenCalled();
  });

  it("does not apply a PHP newFile action's document edits when disk persistence fails", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway();
    const sourceModel = {
      ...model({
        content: "<?php\nclass Greeter\n{\n}\n",
      }),
      pushEditOperations: vi.fn(),
    };
    const providePhpCodeActions = vi.fn(async () => [
      {
        edits: [
          {
            range: {
              endColumn: 17,
              endLineNumber: 2,
              startColumn: 17,
              startLineNumber: 2,
            },
            text: " implements GreeterInterface",
          },
        ],
        kind: "refactor.extract",
        newFile: {
          content: "<?php\n\ninterface GreeterInterface\n{\n}\n",
          path: "/project/src/GreeterInterface.php",
        },
        title: "Extract interface",
      },
    ]);
    const failure = new Error("EACCES");
    const applyPhpCodeActionNewFile = vi.fn(async () => {
      throw failure;
    });
    const reportError = vi.fn();
    vi.mocked(registered.monaco.editor.getModels).mockReturnValue([
      sourceModel,
    ]);
    const context = providerContext({
      applyPhpCodeActionNewFile,
      featuresGateway: gateway,
      providePhpCodeActions,
      reportError,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const actions = await registered.codeActionProvider.provideCodeActions(
      sourceModel,
      new registered.monaco.Range(2, 1, 2, 1),
      {
        markers: [],
        only: "refactor",
        trigger: registered.monaco.languages.CodeActionTriggerType.Invoke,
      },
    );
    const extractInterface = actions.actions.find(
      (action: { title: string }) => action.title === "Extract interface",
    );
    const run =
      registered.commandRunsById["mockor.php.applyCodeActionNewFile"];

    await run(null, extractInterface?.command?.arguments?.[0]);

    expect(applyPhpCodeActionNewFile).toHaveBeenCalled();
    expect(sourceModel.pushEditOperations).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledWith(failure);
  });

  it("does not apply a PHP newFile action's document edits when the callback declines the write", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway();
    const sourceModel = {
      ...model({
        content: "<?php\nclass Greeter\n{\n}\n",
      }),
      pushEditOperations: vi.fn(),
    };
    const providePhpCodeActions = vi.fn(async () => [
      {
        edits: [
          {
            range: {
              endColumn: 17,
              endLineNumber: 2,
              startColumn: 17,
              startLineNumber: 2,
            },
            text: " implements GreeterInterface",
          },
        ],
        kind: "refactor.extract",
        newFile: {
          content: "<?php\n\ninterface GreeterInterface\n{\n}\n",
          path: "/project/src/GreeterInterface.php",
        },
        title: "Extract interface",
      },
    ]);
    // Resolves `false`: the target already exists (or the write failed and the
    // controller already surfaced it), so the command must NOT apply the
    // `implements` edit - the class stays untouched and no error is re-reported.
    const applyPhpCodeActionNewFile = vi.fn(async () => false);
    const reportError = vi.fn();
    vi.mocked(registered.monaco.editor.getModels).mockReturnValue([
      sourceModel,
    ]);
    const context = providerContext({
      applyPhpCodeActionNewFile,
      featuresGateway: gateway,
      providePhpCodeActions,
      reportError,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const actions = await registered.codeActionProvider.provideCodeActions(
      sourceModel,
      new registered.monaco.Range(2, 1, 2, 1),
      {
        markers: [],
        only: "refactor",
        trigger: registered.monaco.languages.CodeActionTriggerType.Invoke,
      },
    );
    const extractInterface = actions.actions.find(
      (action: { title: string }) => action.title === "Extract interface",
    );
    const run =
      registered.commandRunsById["mockor.php.applyCodeActionNewFile"];

    await run(null, extractInterface?.command?.arguments?.[0]);

    expect(applyPhpCodeActionNewFile).toHaveBeenCalled();
    expect(sourceModel.pushEditOperations).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("does not apply path-scoped edits through the PHP newFile source-model command", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway();
    const sourceModel = {
      ...model({
        content: "<?php\nclass Greeter\n{\n}\n",
      }),
      pushEditOperations: vi.fn(),
    };
    const applyPhpCodeActionNewFile = vi.fn(async () => true);
    vi.mocked(registered.monaco.editor.getModels).mockReturnValue([
      sourceModel,
    ]);
    const context = providerContext({
      applyPhpCodeActionNewFile,
      featuresGateway: gateway,
      providePhpCodeActions: vi.fn(async () => [
        {
          edits: [
            {
              path: "/project/src/Other.php",
              range: {
                endColumn: 1,
                endLineNumber: 2,
                startColumn: 1,
                startLineNumber: 2,
              },
              text: "    public function run(): void {}\n",
            },
          ],
          kind: "refactor.extract",
          newFile: {
            content: "<?php\n\ninterface GreeterInterface\n{\n}\n",
            path: "/project/src/GreeterInterface.php",
          },
          title: "Extract interface",
        },
      ]),
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const actions = await registered.codeActionProvider.provideCodeActions(
      sourceModel,
      new registered.monaco.Range(2, 1, 2, 1),
      {
        markers: [],
        only: "refactor",
        trigger: registered.monaco.languages.CodeActionTriggerType.Invoke,
      },
    );
    const extractInterface = actions.actions.find(
      (action: { title: string }) => action.title === "Extract interface",
    );
    const run =
      registered.commandRunsById["mockor.php.applyCodeActionNewFile"];

    await run(null, extractInterface?.command?.arguments?.[0]);

    expect(applyPhpCodeActionNewFile).toHaveBeenCalled();
    expect(sourceModel.pushEditOperations).not.toHaveBeenCalled();
  });

  it("omits the PHP implement-methods code action when the callback returns nothing", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway();
    const providePhpCodeActions = vi.fn(async () => []);
    const context = providerContext({
      featuresGateway: gateway,
      providePhpCodeActions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const actions = await registered.codeActionProvider.provideCodeActions(
      model({ content: "<?php\nclass Foo\n{\n}\n" }),
      new registered.monaco.Range(2, 1, 2, 1),
      {
        markers: [],
        only: "quickfix",
        trigger: registered.monaco.languages.CodeActionTriggerType.Invoke,
      },
    );

    expect(providePhpCodeActions).toHaveBeenCalled();
    expect(actions.actions).toEqual([]);
  });

  it("passes the selection range to the PHP code action callback as character offsets", async () => {
    const registered = createRegisteredProviders();
    const content = "<?php\n$total = price() + tax();\n";
    const providePhpCodeActions = vi.fn(async () => []);
    const context = providerContext({
      featuresGateway: featuresGateway(),
      providePhpCodeActions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await registered.codeActionProvider.provideCodeActions(
      model({ content }),
      // Line 2 columns 10..30 select `price() + tax()` within `$total = ...;`.
      new registered.monaco.Range(2, 10, 2, 25),
      {
        markers: [],
        only: "refactor",
        trigger: registered.monaco.languages.CodeActionTriggerType.Invoke,
      },
    );

    expect(providePhpCodeActions).toHaveBeenCalledWith(content, {
      end: content.indexOf("$total") + "$total = price() + tax()".length,
      start: content.indexOf("price()"),
    });
  });

  it("requests PHP code actions for a refactor-only request", async () => {
    const registered = createRegisteredProviders();
    const providePhpCodeActions = vi.fn(async () => [
      {
        edits: [
          {
            range: {
              endColumn: 1,
              endLineNumber: 2,
              startColumn: 1,
              startLineNumber: 2,
            },
            text: "    $extracted = 1;\n",
          },
        ],
        kind: "refactor.extract",
        title: "Extract variable",
      },
    ]);
    const context = providerContext({
      featuresGateway: featuresGateway(),
      providePhpCodeActions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const actions = await registered.codeActionProvider.provideCodeActions(
      model({ content: "<?php\necho 1;\n" }),
      new registered.monaco.Range(2, 6, 2, 7),
      {
        markers: [],
        only: "refactor",
        trigger: registered.monaco.languages.CodeActionTriggerType.Invoke,
      },
    );

    expect(providePhpCodeActions).toHaveBeenCalled();
    expect(actions.actions).toEqual([
      expect.objectContaining({ kind: "refactor.extract", title: "Extract variable" }),
    ]);
  });

  it("serves PHP organize-imports actions for a `source.organizeImports` scope", async () => {
    const registered = createRegisteredProviders();
    const providePhpCodeActions = vi.fn(async () => []);
    const context = providerContext({
      featuresGateway: featuresGateway(),
      providePhpCodeActions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await registered.codeActionProvider.provideCodeActions(
      model({ content: "<?php\nclass Foo\n{\n}\n" }),
      new registered.monaco.Range(2, 1, 2, 1),
      {
        markers: [],
        only: "source.organizeImports",
        trigger: registered.monaco.languages.CodeActionTriggerType.Invoke,
      },
    );

    // "Optimize imports" is our `source.organizeImports` action, so a request
    // narrowed to that family must reach the PHP provider.
    expect(providePhpCodeActions).toHaveBeenCalled();
  });

  it("omits PHP code actions for an unrelated narrow `only` scope", async () => {
    const registered = createRegisteredProviders();
    const providePhpCodeActions = vi.fn(async () => []);
    const context = providerContext({
      featuresGateway: featuresGateway(),
      providePhpCodeActions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await registered.codeActionProvider.provideCodeActions(
      model({ content: "<?php\nclass Foo\n{\n}\n" }),
      new registered.monaco.Range(2, 1, 2, 1),
      {
        markers: [],
        // A sibling source scope we never emit an action for is left to the LSP.
        only: "source.fixAll",
        trigger: registered.monaco.languages.CodeActionTriggerType.Invoke,
      },
    );

    expect(providePhpCodeActions).not.toHaveBeenCalled();
  });

  it("drops in-flight PHP implement-methods code actions when the workspace switches", async () => {
    const registered = createRegisteredProviders();
    let activeRoot: string | null = "/project";
    const implementMethods = createDeferred<
      Array<{
        edits: Array<{
          range: {
            endColumn: number;
            endLineNumber: number;
            startColumn: number;
            startLineNumber: number;
          };
          text: string;
        }>;
        title: string;
      }>
    >();
    const providePhpCodeActions = vi.fn(async () => implementMethods.promise);
    const context = providerContext({
      featuresGateway: featuresGateway(),
      getWorkspaceRoot: () => activeRoot,
      providePhpCodeActions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const actionsPromise = registered.codeActionProvider.provideCodeActions(
      model({ content: "<?php\nclass Foo implements Bar\n{\n}\n" }),
      new registered.monaco.Range(2, 1, 2, 1),
      {
        markers: [],
        only: "quickfix",
        trigger: registered.monaco.languages.CodeActionTriggerType.Invoke,
      },
    );

    await Promise.resolve();
    activeRoot = null;
    implementMethods.resolve([
      {
        edits: [
          {
            range: {
              endColumn: 1,
              endLineNumber: 5,
              startColumn: 1,
              startLineNumber: 5,
            },
            text: "stale",
          },
        ],
        title: "Implement methods",
      },
    ]);

    await expect(actionsPromise).resolves.toEqual({
      actions: [],
      dispose: expect.any(Function),
    });
  });

  it("drops resolved PHP implement-methods actions when the workspace switches during a later LSP await", async () => {
    const registered = createRegisteredProviders();
    let activeRoot: string | null = "/project";
    const flush = createDeferred<void>();
    const providePhpCodeActions = vi.fn(async () => [
      {
        edits: [
          {
            range: {
              endColumn: 1,
              endLineNumber: 5,
              startColumn: 1,
              startLineNumber: 5,
            },
            text: "stale",
          },
        ],
        title: "Implement methods",
      },
    ]);
    const context = providerContext({
      featuresGateway: featuresGateway(),
      flushPendingDocumentChange: vi.fn(async () => flush.promise),
      getWorkspaceRoot: () => activeRoot,
      providePhpCodeActions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const actionsPromise = registered.codeActionProvider.provideCodeActions(
      model({ content: "<?php\nclass Foo implements Bar\n{\n}\n" }),
      new registered.monaco.Range(2, 1, 2, 1),
      {
        markers: [],
        only: "quickfix",
        trigger: registered.monaco.languages.CodeActionTriggerType.Invoke,
      },
    );

    await vi.waitFor(() => {
      expect(providePhpCodeActions).toHaveBeenCalled();
    });
    activeRoot = null;
    flush.resolve();

    await expect(actionsPromise).resolves.toEqual({
      actions: [],
      dispose: expect.any(Function),
    });
  });

  it("accepts PHP workspace edits when Monaco and LSP versions diverge", async () => {
    const registered = createRegisteredProviders();
    const openPath = "/project/src/User.php";
    const openUri = "file:///project/src/User.php";
    const closedUri = "file:///project/src/Helper.php";
    const outsideUri = "file:///other/src/Outside.php";
    const openModel = {
      ...model({ content: "", path: openPath }),
      pushEditOperations: vi.fn(),
    };
    const edit: LanguageServerWorkspaceEdit = {
      changes: {
        ...workspaceEdit(openUri, "Open").changes,
        ...workspaceEdit(closedUri, "Closed").changes,
        ...workspaceEdit(outsideUri, "Outside").changes,
      },
      documentVersions: {
        [openUri]: 41,
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
    const applyWorkspaceEdit = vi.fn(async () => {
      expect(openModel.pushEditOperations).not.toHaveBeenCalled();
    });
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
    await vi.waitFor(() => {
      expect(openModel.pushEditOperations).toHaveBeenCalledOnce();
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
          [openUri]: 41,
        },
      },
      {
        applyOpenModels: expect.any(Function),
        openPaths: [openPath],
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
        applyOpenModels: expect.any(Function),
        openPaths: [],
        rootPath: "/project",
      },
    );
  });

  it("rejects a stale versioned PHP workspace edit before applying any open model", async () => {
    const registered = createRegisteredProviders();
    const openPath = "/project/src/User.php";
    const openUri = "file:///project/src/User.php";
    const openModel = {
      ...model({ content: "", path: openPath }),
      pushEditOperations: vi.fn(),
    };
    let publishWorkspaceEdit: (event: LanguageServerWorkspaceEditEvent) => void =
      () => undefined;
    const workspaceEditGateway: LanguageServerWorkspaceEditGateway = {
      subscribeWorkspaceEdits: vi.fn(async (listener) => {
        publishWorkspaceEdit = listener;
        return () => undefined;
      }),
    };
    const applyWorkspaceEdit = vi.fn(async () => ({
      kind: "rejected" as const,
      path: openPath,
      reason: "staleDocumentVersion" as const,
    }));
    vi.mocked(registered.monaco.editor.getModels).mockReturnValue([openModel]);
    registerLanguageServerMonacoProviders(
      registered.monaco,
      providerContext({ applyWorkspaceEdit, workspaceEditGateway }),
    );
    await Promise.resolve();

    publishWorkspaceEdit({
      edit: {
        ...workspaceEdit(openUri, "final "),
        documentVersions: { [openUri]: 42 },
      },
      label: "Stale edit",
      rootPath: "/project",
      sessionId: 1,
    });
    await Promise.resolve();

    expect(openModel.pushEditOperations).not.toHaveBeenCalled();
    expect(applyWorkspaceEdit).toHaveBeenCalledWith(
      {
        ...workspaceEdit(openUri, "final "),
        documentVersions: { [openUri]: 42 },
      },
      {
        applyOpenModels: expect.any(Function),
        openPaths: [openPath],
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
      ...model({ content: "", path: openPath }),
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
      applyOpenModels: expect.any(Function),
      openPaths: [openPath],
      rootPath: "/project",
    });
  });

  it("rejects every PHP model before push when a later model range is invalid", async () => {
    const registered = createRegisteredProviders();
    const modelA = {
      ...model({ content: "abc", path: "/project/src/A.php" }),
      pushEditOperations: vi.fn(),
    };
    const modelB = {
      ...model({ content: "abc", path: "/project/src/B.php" }),
      pushEditOperations: vi.fn(),
    };
    const edit: LanguageServerWorkspaceEdit = {
      changes: {
        "file:///project/src/A.php": [
          {
            newText: "A",
            range: {
              end: { character: 1, line: 0 },
              start: { character: 0, line: 0 },
            },
          },
        ],
        "file:///project/src/B.php": [
          {
            newText: "B",
            range: {
              end: { character: 9, line: 0 },
              start: { character: 9, line: 0 },
            },
          },
        ],
      },
    };
    const gateway = featuresGateway();
    vi.mocked(gateway.executeCommand).mockResolvedValueOnce(edit);
    const applyWorkspaceEdit = vi.fn(
      async (
        _edit: LanguageServerWorkspaceEdit,
        context: PhpWorkspaceEditApplicationContext,
      ) => {
        const commit = context.applyOpenModels?.();

        return commit?.kind === "rejected"
          ? commit
          : { kind: "accepted" as const };
      },
    );
    vi.mocked(registered.monaco.editor.getModels).mockReturnValue([modelA, modelB]);
    registerLanguageServerMonacoProviders(
      registered.monaco,
      providerContext({ applyWorkspaceEdit, featuresGateway: gateway }),
    );

    if (!registered.commandRun) {
      throw new Error("PHP language server command was not registered");
    }
    await registered.commandRun(null, phpCommandPayload());

    expect(modelA.pushEditOperations).not.toHaveBeenCalled();
    expect(modelB.pushEditOperations).not.toHaveBeenCalled();
  });

  it("keeps PHP execute-command workspace edits open-model-only without an applier", async () => {
    const registered = createRegisteredProviders();
    const openModel = {
      ...model({ content: "", path: "/project/src/User.php" }),
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
      ...model({ content: "", path: openPath }),
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
        applyOpenModels: expect.any(Function),
        openPaths: [openPath],
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

  it("navigates a framework string-helper definition and skips phpactor when handled", async () => {
    const registered = createRegisteredProviders();
    const source = "<?php\n$value = config('app.name');\n";
    const offset = source.indexOf("app.name");
    const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
    const column = offset - lineStart + 1;
    const providePhpFrameworkDefinition = vi.fn(async () => true);
    const gateway = featuresGateway({
      definition: [
        {
          range: range(1, 6, 1, 10),
          uri: "file:///project/config/app.php",
        },
      ],
    });
    const context = providerContext({
      activeDocument: {
        content: source,
        language: "php",
        name: "Service.php",
        path: "/project/src/Service.php",
        savedContent: source,
      },
      featuresGateway: gateway,
      providePhpFrameworkDefinition,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.definitionProvider.provideDefinition(
        model({ content: source, path: "/project/src/Service.php" }),
        { column, lineNumber: 2 },
      ),
    ).resolves.toBeNull();
    expect(providePhpFrameworkDefinition).toHaveBeenCalledTimes(1);
    expect(providePhpFrameworkDefinition).toHaveBeenCalledWith(
      source,
      offset,
      expect.objectContaining({ canNavigate: expect.any(Function) }),
    );
    expect(gateway.definition).not.toHaveBeenCalled();
  });

  it("falls back to phpactor definition when the framework callback does not handle the offset", async () => {
    const registered = createRegisteredProviders();
    const source = "<?php\n$user = $repository->find();\n";
    const providePhpFrameworkDefinition = vi.fn(async () => false);
    const gateway = featuresGateway({
      definition: [
        {
          range: range(1, 6, 1, 10),
          uri: "file:///project/src/Models/User.php",
        },
      ],
    });
    const context = providerContext({
      activeDocument: {
        content: source,
        language: "php",
        name: "Service.php",
        path: "/project/src/Service.php",
        savedContent: source,
      },
      featuresGateway: gateway,
      providePhpFrameworkDefinition,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.definitionProvider.provideDefinition(
        model({ content: source, path: "/project/src/Service.php" }),
        { column: 20, lineNumber: 2 },
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        uri: {
          fsPath: "/project/src/Models/User.php",
          path: "/project/src/Models/User.php",
        },
      }),
    ]);
    expect(providePhpFrameworkDefinition).toHaveBeenCalledTimes(1);
    expect(gateway.definition).toHaveBeenCalledTimes(1);
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

  it("limits PHP navigation locations to open Monaco models when requested", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      definition: [
        {
          range: range(1, 6, 1, 10),
          uri: "file:///project/src/Models/User.php",
        },
      ],
    });
    const context = providerContext({
      featuresGateway: gateway,
      limitNavigationResultsToOpenModels: true,
    });
    registered.monaco.editor.getModel.mockReturnValue(null);
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.definitionProvider.provideDefinition(model(), position()),
    ).resolves.toEqual([]);
    expect(registered.monaco.editor.getModel).toHaveBeenCalledWith({
      fsPath: "/project/src/Models/User.php",
      path: "/project/src/Models/User.php",
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

  it("maps PHP document links and resolves LSP-backed document links lazily", async () => {
    const registered = createRegisteredProviders();
    const sourceLink: LanguageServerDocumentLink = {
      data: { id: "route-link" },
      range: range(2, 4, 2, 19),
      target: "file:///project/routes/web.php",
      tooltip: "Open route",
    };
    const resolvedLink: LanguageServerDocumentLink = {
      ...sourceLink,
      range: range(5, 2, 5, 17),
      target: "file:///project/routes/api.php",
      tooltip: "Open resolved route",
    };
    const gateway = featuresGateway({
      documentLinks: [sourceLink],
      resolvedDocumentLink: resolvedLink,
    });
    const flushPendingDocumentChange = vi.fn(async () => undefined);
    const context = providerContext({
      featuresGateway: gateway,
      flushPendingDocumentChange,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const linksList = await registered.documentLinkProvider.provideLinks(model());

    expect(linksList).toEqual({
      dispose: expect.any(Function),
      links: [
        expect.objectContaining({
          __languageServerLink: sourceLink,
          __languageServerSessionId: 1,
          __sourcePath: "/project/src/User.php",
          __workspaceRoot: "/project",
          range: expect.objectContaining({
            endColumn: 20,
            endLineNumber: 3,
            startColumn: 5,
            startLineNumber: 3,
          }),
          tooltip: "Open route",
          url: "file:///project/routes/web.php",
        }),
      ],
    });
    expect(flushPendingDocumentChange).toHaveBeenCalledWith(
      "/project/src/User.php",
    );
    expect(gateway.documentLinks).toHaveBeenCalledWith(
      "/project",
      "/project/src/User.php",
    );

    const resolved = await registered.documentLinkProvider.resolveLink(
      linksList.links[0],
    );

    expect(flushPendingDocumentChange).toHaveBeenCalledTimes(2);
    expect(gateway.resolveDocumentLink).toHaveBeenCalledWith(
      "/project",
      sourceLink,
    );
    expect(resolved).toEqual(
      expect.objectContaining({
        __languageServerLink: resolvedLink,
        __languageServerSessionId: 1,
        __sourcePath: "/project/src/User.php",
        __workspaceRoot: "/project",
        range: expect.objectContaining({
          endColumn: 18,
          endLineNumber: 6,
          startColumn: 3,
          startLineNumber: 6,
        }),
        tooltip: "Open resolved route",
        url: "file:///project/routes/api.php",
      }),
    );
  });

  it("does not request PHP document links when capability is disabled or runtime root mismatches", async () => {
    const disabledRegistered = createRegisteredProviders();
    const disabledGateway = featuresGateway({
      documentLinks: [
        {
          range: range(2, 4, 2, 19),
          target: "file:///project/routes/web.php",
          tooltip: "Open route",
        },
      ],
    });
    const disabledFlush = vi.fn(async () => undefined);
    registerLanguageServerMonacoProviders(
      disabledRegistered.monaco,
      providerContext({
        featuresGateway: disabledGateway,
        flushPendingDocumentChange: disabledFlush,
        runtimeStatus: runningStatus({ documentLink: false }),
      }),
    );

    await expect(
      disabledRegistered.documentLinkProvider.provideLinks(model()),
    ).resolves.toEqual({
      dispose: expect.any(Function),
      links: [],
    });
    expect(disabledFlush).not.toHaveBeenCalled();
    expect(disabledGateway.documentLinks).not.toHaveBeenCalled();

    const mismatchedRegistered = createRegisteredProviders();
    const mismatchedGateway = featuresGateway({
      documentLinks: [
        {
          range: range(2, 4, 2, 19),
          target: "file:///project/routes/web.php",
          tooltip: "Open route",
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
      mismatchedRegistered.documentLinkProvider.provideLinks(model()),
    ).resolves.toEqual({
      dispose: expect.any(Function),
      links: [],
    });
    expect(mismatchedFlush).not.toHaveBeenCalled();
    expect(mismatchedGateway.documentLinks).not.toHaveBeenCalled();
  });

  it("returns empty PHP document links after in-flight root or session changes", async () => {
    const sessionRegistered = createRegisteredProviders();
    let activeSessionId = 1;
    const sessionLinks = createDeferred<LanguageServerDocumentLink[]>();
    const sessionGateway = featuresGateway();
    vi.mocked(sessionGateway.documentLinks).mockImplementationOnce(
      async () => sessionLinks.promise,
    );
    registerLanguageServerMonacoProviders(
      sessionRegistered.monaco,
      providerContext({
        featuresGateway: sessionGateway,
        getRuntimeStatus: () => ({
          ...runningStatus(),
          sessionId: activeSessionId,
        }),
      }),
    );

    const sessionPromise =
      sessionRegistered.documentLinkProvider.provideLinks(model());

    await Promise.resolve();
    activeSessionId = 2;
    sessionLinks.resolve([
      {
        range: range(2, 4, 2, 19),
        target: "file:///project/routes/web.php",
        tooltip: "Open route",
      },
    ]);

    await expect(sessionPromise).resolves.toEqual({
      dispose: expect.any(Function),
      links: [],
    });

    const rootRegistered = createRegisteredProviders();
    let activeRoot: string | null = "/project";
    const rootLinks = createDeferred<LanguageServerDocumentLink[]>();
    const rootGateway = featuresGateway();
    vi.mocked(rootGateway.documentLinks).mockImplementationOnce(
      async () => rootLinks.promise,
    );
    registerLanguageServerMonacoProviders(
      rootRegistered.monaco,
      providerContext({
        featuresGateway: rootGateway,
        getWorkspaceRoot: () => activeRoot,
      }),
    );

    const rootPromise = rootRegistered.documentLinkProvider.provideLinks(model());

    await Promise.resolve();
    activeRoot = "/other";
    rootLinks.resolve([
      {
        range: range(2, 4, 2, 19),
        target: "file:///project/routes/web.php",
        tooltip: "Open route",
      },
    ]);

    await expect(rootPromise).resolves.toEqual({
      dispose: expect.any(Function),
      links: [],
    });
  });

  it("does not lazily resolve stale or unbacked PHP document links after root or session changes", async () => {
    const registered = createRegisteredProviders();
    let activeSessionId = 1;
    const sourceLink: LanguageServerDocumentLink = {
      data: { id: "route-link" },
      range: range(2, 4, 2, 19),
      target: null,
      tooltip: null,
    };
    const gateway = featuresGateway({
      documentLinks: [sourceLink],
      resolvedDocumentLink: {
        ...sourceLink,
        target: "file:///project/routes/web.php",
        tooltip: "Open route",
      },
    });
    const flushPendingDocumentChange = vi.fn(async () => undefined);
    registerLanguageServerMonacoProviders(
      registered.monaco,
      providerContext({
        featuresGateway: gateway,
        flushPendingDocumentChange,
        getRuntimeStatus: () => ({
          ...runningStatus(),
          sessionId: activeSessionId,
        }),
      }),
    );

    const linksList = await registered.documentLinkProvider.provideLinks(model());
    const backedLink = linksList.links[0];
    const unbackedLink = {
      range: new registered.monaco.Range(2, 4, 2, 19),
      url: "file:///project/routes/web.php",
    };

    activeSessionId = 2;

    await expect(
      registered.documentLinkProvider.resolveLink(backedLink),
    ).resolves.toBe(backedLink);
    await expect(
      registered.documentLinkProvider.resolveLink(unbackedLink),
    ).resolves.toBe(unbackedLink);
    expect(flushPendingDocumentChange).toHaveBeenCalledTimes(1);
    expect(gateway.resolveDocumentLink).not.toHaveBeenCalled();

    const rootRegistered = createRegisteredProviders();
    let activeRoot: string | null = "/project";
    const rootGateway = featuresGateway({
      documentLinks: [sourceLink],
      resolvedDocumentLink: {
        ...sourceLink,
        target: "file:///project/routes/web.php",
        tooltip: "Open route",
      },
    });
    const rootFlushPendingDocumentChange = vi.fn(async () => undefined);
    registerLanguageServerMonacoProviders(
      rootRegistered.monaco,
      providerContext({
        featuresGateway: rootGateway,
        flushPendingDocumentChange: rootFlushPendingDocumentChange,
        getWorkspaceRoot: () => activeRoot,
      }),
    );

    const rootLinksList =
      await rootRegistered.documentLinkProvider.provideLinks(model());
    const rootBackedLink = rootLinksList.links[0];

    activeRoot = "/other";

    await expect(
      rootRegistered.documentLinkProvider.resolveLink(rootBackedLink),
    ).resolves.toBe(rootBackedLink);
    expect(rootFlushPendingDocumentChange).toHaveBeenCalledTimes(1);
    expect(rootGateway.resolveDocumentLink).not.toHaveBeenCalled();
  });

  it("drops stale PHP document link resolve results after async response", async () => {
    const registered = createRegisteredProviders();
    let activeSessionId = 1;
    const sourceLink: LanguageServerDocumentLink = {
      data: { id: "route-link" },
      range: range(2, 4, 2, 19),
      target: null,
      tooltip: null,
    };
    const resolvedLink = createDeferred<LanguageServerDocumentLink>();
    const gateway = featuresGateway({
      documentLinks: [sourceLink],
    });
    vi.mocked(gateway.resolveDocumentLink).mockImplementationOnce(
      async () => resolvedLink.promise,
    );
    registerLanguageServerMonacoProviders(
      registered.monaco,
      providerContext({
        featuresGateway: gateway,
        getRuntimeStatus: () => ({
          ...runningStatus(),
          sessionId: activeSessionId,
        }),
      }),
    );

    const linksList = await registered.documentLinkProvider.provideLinks(model());
    const backedLink = linksList.links[0];
    const resolvePromise =
      registered.documentLinkProvider.resolveLink(backedLink);

    await Promise.resolve();
    expect(gateway.resolveDocumentLink).toHaveBeenCalledWith(
      "/project",
      sourceLink,
    );

    activeSessionId = 2;
    resolvedLink.resolve({
      ...sourceLink,
      target: "file:///project/routes/web.php",
      tooltip: "Open route",
    });

    await expect(resolvePromise).resolves.toBe(backedLink);
  });

  it("maps PHP document highlights with read, write and text kinds", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      documentHighlights: [
        {
          kind: 2,
          range: range(3, 4, 3, 9),
        },
        {
          kind: 3,
          range: range(7, 8, 7, 13),
        },
        {
          kind: null,
          range: range(9, 0, 9, 5),
        },
        {
          kind: 99,
          range: range(11, 2, 11, 7),
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
      registered.documentHighlightProvider.provideDocumentHighlights(
        model(),
        position(),
        { isCancellationRequested: false },
      ),
    ).resolves.toEqual([
      {
        kind: 2,
        range: expect.objectContaining({
          endColumn: 10,
          endLineNumber: 4,
          startColumn: 5,
          startLineNumber: 4,
        }),
      },
      {
        kind: 3,
        range: expect.objectContaining({
          endColumn: 14,
          endLineNumber: 8,
          startColumn: 9,
          startLineNumber: 8,
        }),
      },
      {
        kind: 1,
        range: expect.objectContaining({
          endColumn: 6,
          endLineNumber: 10,
          startColumn: 1,
          startLineNumber: 10,
        }),
      },
      {
        kind: 1,
        range: expect.objectContaining({
          endColumn: 8,
          endLineNumber: 12,
          startColumn: 3,
          startLineNumber: 12,
        }),
      },
    ]);
    expect(flushPendingDocumentChange).toHaveBeenCalledWith(
      "/project/src/User.php",
    );
    expect(gateway.documentHighlights).toHaveBeenCalledWith("/project", {
      character: 4,
      line: 10,
      path: "/project/src/User.php",
    });
  });

  it("does not request PHP document highlights when capability is disabled or runtime root mismatches", async () => {
    const disabledRegistered = createRegisteredProviders();
    const disabledGateway = featuresGateway({
      documentHighlights: [
        {
          kind: 2,
          range: range(3, 4, 3, 9),
        },
      ],
    });
    const disabledFlush = vi.fn(async () => undefined);
    registerLanguageServerMonacoProviders(
      disabledRegistered.monaco,
      providerContext({
        featuresGateway: disabledGateway,
        flushPendingDocumentChange: disabledFlush,
        runtimeStatus: runningStatus({ documentHighlight: false }),
      }),
    );

    await expect(
      disabledRegistered.documentHighlightProvider.provideDocumentHighlights(
        model(),
        position(),
        { isCancellationRequested: false },
      ),
    ).resolves.toBeNull();
    expect(disabledFlush).not.toHaveBeenCalled();
    expect(disabledGateway.documentHighlights).not.toHaveBeenCalled();

    const mismatchedRegistered = createRegisteredProviders();
    const mismatchedGateway = featuresGateway({
      documentHighlights: [
        {
          kind: 3,
          range: range(7, 8, 7, 13),
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
      mismatchedRegistered.documentHighlightProvider.provideDocumentHighlights(
        model(),
        position(),
        { isCancellationRequested: false },
      ),
    ).resolves.toBeNull();
    expect(mismatchedFlush).not.toHaveBeenCalled();
    expect(mismatchedGateway.documentHighlights).not.toHaveBeenCalled();
  });

  it("drops stale PHP document highlights after async response", async () => {
    const sessionRegistered = createRegisteredProviders();
    let activeSessionId = 1;
    const sessionHighlights = createDeferred<LanguageServerDocumentHighlight[]>();
    const sessionGateway = featuresGateway();
    vi.mocked(sessionGateway.documentHighlights).mockImplementationOnce(
      async () => sessionHighlights.promise,
    );
    const sessionContext = providerContext({
      featuresGateway: sessionGateway,
      getRuntimeStatus: () => ({
        ...runningStatus(),
        sessionId: activeSessionId,
      }),
    });
    registerLanguageServerMonacoProviders(
      sessionRegistered.monaco,
      sessionContext,
    );

    const sessionPromise =
      sessionRegistered.documentHighlightProvider.provideDocumentHighlights(
        model(),
        position(),
        { isCancellationRequested: false },
      );

    await Promise.resolve();
    activeSessionId = 2;
    sessionHighlights.resolve([
      {
        kind: 2,
        range: range(3, 4, 3, 9),
      },
    ]);

    await expect(sessionPromise).resolves.toBeNull();

    const rootRegistered = createRegisteredProviders();
    let activeRoot: string | null = "/project";
    const rootHighlights = createDeferred<LanguageServerDocumentHighlight[]>();
    const rootGateway = featuresGateway();
    vi.mocked(rootGateway.documentHighlights).mockImplementationOnce(
      async () => rootHighlights.promise,
    );
    const rootContext = providerContext({
      featuresGateway: rootGateway,
      getWorkspaceRoot: () => activeRoot,
    });
    registerLanguageServerMonacoProviders(rootRegistered.monaco, rootContext);

    const rootPromise =
      rootRegistered.documentHighlightProvider.provideDocumentHighlights(
        model(),
        position(),
        { isCancellationRequested: false },
      );

    await Promise.resolve();
    activeRoot = "/other";
    rootHighlights.resolve([
      {
        kind: 3,
        range: range(7, 8, 7, 13),
      },
    ]);

    await expect(rootPromise).resolves.toBeNull();
  });

  it("drops superseded PHP document highlights when the Monaco cancellation token is cancelled", async () => {
    const registered = createRegisteredProviders();
    const highlights = createDeferred<LanguageServerDocumentHighlight[]>();
    const gateway = featuresGateway();
    vi.mocked(gateway.documentHighlights).mockImplementationOnce(
      async () => highlights.promise,
    );
    const context = providerContext({ featuresGateway: gateway });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const token = { isCancellationRequested: false };
    const promise =
      registered.documentHighlightProvider.provideDocumentHighlights(
        model(),
        position(),
        token,
      );

    await Promise.resolve();
    token.isCancellationRequested = true;
    highlights.resolve([
      {
        kind: 2,
        range: range(3, 4, 3, 9),
      },
    ]);

    await expect(promise).resolves.toBeNull();
  });

  it("applies PHP document highlights when the Monaco cancellation token stays active", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      documentHighlights: [
        {
          kind: 2,
          range: range(3, 4, 3, 9),
        },
      ],
    });
    const context = providerContext({ featuresGateway: gateway });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const token = { isCancellationRequested: false };
    await expect(
      registered.documentHighlightProvider.provideDocumentHighlights(
        model(),
        position(),
        token,
      ),
    ).resolves.toEqual([
      {
        kind: 2,
        range: expect.objectContaining({
          endColumn: 10,
          endLineNumber: 4,
          startColumn: 5,
          startLineNumber: 4,
        }),
      },
    ]);
    expect(gateway.documentHighlights).toHaveBeenCalledTimes(1);
  });

  it("skips repeated PHP document highlight requests for the same word under the cursor", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      documentHighlights: [
        {
          kind: 2,
          range: range(3, 4, 3, 9),
        },
      ],
    });
    const context = providerContext({ featuresGateway: gateway });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const sameWordModel = model({ word: { endColumn: 5, startColumn: 2, word: "$user" } });
    const token = { isCancellationRequested: false };

    const first =
      await registered.documentHighlightProvider.provideDocumentHighlights(
        sameWordModel,
        position(),
        token,
      );
    const second =
      await registered.documentHighlightProvider.provideDocumentHighlights(
        sameWordModel,
        position(),
        token,
      );

    expect(gateway.documentHighlights).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);

    const otherWordModel = model({ word: { endColumn: 10, startColumn: 5, word: "$account" } });
    await registered.documentHighlightProvider.provideDocumentHighlights(
      otherWordModel,
      position(),
      token,
    );

    expect(gateway.documentHighlights).toHaveBeenCalledTimes(2);
  });

  it("maps and resolves PHP CodeLens showReferences commands with workspace filtering", async () => {
    const registered = createRegisteredProviders();
    const sourceLens: LanguageServerCodeLens = {
      command: null,
      data: { id: "references" },
      range: range(1, 0, 1, 12),
    };
    const resolvedLens: LanguageServerCodeLens = {
      ...sourceLens,
      command: {
        arguments: [
          "file:///project/src/User.php",
          { character: 4, line: 2 },
          [
            {
              range: range(2, 4, 2, 8),
              uri: "file:///project/src/User.php",
            },
            {
              range: range(3, 1, 3, 5),
              uri: "file:///project-neighbor/src/User.php",
            },
          ],
        ],
        command: "editor.action.showReferences",
        title: "2 references",
      },
    };
    const gateway = featuresGateway({
      codeLenses: [sourceLens],
      resolvedCodeLens: resolvedLens,
    });
    const flushPendingDocumentChange = vi.fn(async () => undefined);
    registerLanguageServerMonacoProviders(
      registered.monaco,
      providerContext({
        featuresGateway: gateway,
        flushPendingDocumentChange,
      }),
    );

    const lenses = await registered.codeLensProvider.provideCodeLenses(model());

    expect(lenses).toEqual({
      dispose: expect.any(Function),
      lenses: [
        expect.objectContaining({
          __languageServerLens: sourceLens,
          __languageServerSessionId: 1,
          __sourcePath: "/project/src/User.php",
          __workspaceRoot: "/project",
          range: expect.objectContaining({
            endColumn: 13,
            endLineNumber: 2,
            startColumn: 1,
            startLineNumber: 2,
          }),
        }),
      ],
    });
    expect(flushPendingDocumentChange).toHaveBeenCalledWith(
      "/project/src/User.php",
    );
    expect(gateway.codeLenses).toHaveBeenCalledWith(
      "/project",
      "/project/src/User.php",
    );

    const resolved = await registered.codeLensProvider.resolveCodeLens(
      model(),
      lenses.lenses[0],
    );

    expect(flushPendingDocumentChange).toHaveBeenCalledTimes(2);
    expect(gateway.resolveCodeLens).toHaveBeenCalledWith(
      "/project",
      sourceLens,
    );
    expect(resolved).toEqual(
      expect.objectContaining({
        __languageServerLens: resolvedLens,
        command: {
          arguments: [
            {
              fsPath: "/project/src/User.php",
              path: "/project/src/User.php",
            },
            {
              column: 5,
              lineNumber: 3,
            },
            [
              {
                range: expect.objectContaining({
                  endColumn: 9,
                  endLineNumber: 3,
                  startColumn: 5,
                  startLineNumber: 3,
                }),
                uri: {
                  fsPath: "/project/src/User.php",
                  path: "/project/src/User.php",
                },
              },
            ],
          ],
          id: "editor.action.showReferences",
          title: "2 references",
        },
      }),
    );
  });

  it("maps generic PHP CodeLens commands through the language server command executor", async () => {
    const registered = createRegisteredProviders();
    const sourceLens: LanguageServerCodeLens = {
      command: {
        arguments: ["unused"],
        command: "phpactor.fixAll",
        title: "Fix all",
      },
      data: null,
      range: range(4, 2, 4, 12),
    };
    const gateway = featuresGateway({ codeLenses: [sourceLens] });
    registerLanguageServerMonacoProviders(
      registered.monaco,
      providerContext({ featuresGateway: gateway }),
    );

    const lenses = await registered.codeLensProvider.provideCodeLenses(model());

    expect(lenses.lenses[0]).toEqual(
      expect.objectContaining({
        command: {
          arguments: [
            {
              command: sourceLens.command,
              rootPath: "/project",
              sessionId: 1,
            },
          ],
          id: "mockor.php.executeLanguageServerCommand",
          title: "Fix all",
        },
      }),
    );
  });

  it("does not request PHP CodeLens when capability is disabled or runtime root mismatches", async () => {
    const disabledRegistered = createRegisteredProviders();
    const disabledGateway = featuresGateway({
      codeLenses: [
        {
          command: null,
          data: { id: "disabled" },
          range: range(1, 0, 1, 1),
        },
      ],
    });
    const disabledFlush = vi.fn(async () => undefined);
    registerLanguageServerMonacoProviders(
      disabledRegistered.monaco,
      providerContext({
        featuresGateway: disabledGateway,
        flushPendingDocumentChange: disabledFlush,
        runtimeStatus: runningStatus({ codeLens: false }),
      }),
    );

    await expect(
      disabledRegistered.codeLensProvider.provideCodeLenses(model()),
    ).resolves.toEqual({
      dispose: expect.any(Function),
      lenses: [],
    });
    expect(disabledFlush).not.toHaveBeenCalled();
    expect(disabledGateway.codeLenses).not.toHaveBeenCalled();

    const mismatchedRegistered = createRegisteredProviders();
    const mismatchedGateway = featuresGateway({
      codeLenses: [
        {
          command: null,
          data: { id: "other-root" },
          range: range(1, 0, 1, 1),
        },
      ],
    });
    const mismatchedFlush = vi.fn(async () => undefined);
    registerLanguageServerMonacoProviders(
      mismatchedRegistered.monaco,
      providerContext({
        featuresGateway: mismatchedGateway,
        flushPendingDocumentChange: mismatchedFlush,
        runtimeStatus: {
          ...runningStatus(),
          rootPath: "/other",
        },
      }),
    );

    await expect(
      mismatchedRegistered.codeLensProvider.provideCodeLenses(model()),
    ).resolves.toEqual({
      dispose: expect.any(Function),
      lenses: [],
    });
    expect(mismatchedFlush).not.toHaveBeenCalled();
    expect(mismatchedGateway.codeLenses).not.toHaveBeenCalled();
  });

  it("returns an empty PHP CodeLens list for stale in-flight provide results", async () => {
    const registered = createRegisteredProviders();
    let activeSessionId = 1;
    const codeLenses = createDeferred<LanguageServerCodeLens[]>();
    const gateway = featuresGateway();
    vi.mocked(gateway.codeLenses).mockImplementationOnce(
      async () => codeLenses.promise,
    );
    registerLanguageServerMonacoProviders(
      registered.monaco,
      providerContext({
        featuresGateway: gateway,
        getRuntimeStatus: () => ({
          ...runningStatus(),
          sessionId: activeSessionId,
        }),
      }),
    );

    const lensesPromise = registered.codeLensProvider.provideCodeLenses(model());

    await Promise.resolve();
    activeSessionId = 2;
    codeLenses.resolve([
      {
        command: null,
        data: { id: "stale" },
        range: range(1, 0, 1, 1),
      },
    ]);

    await expect(lensesPromise).resolves.toEqual({
      dispose: expect.any(Function),
      lenses: [],
    });

    const rootRegistered = createRegisteredProviders();
    let activeRoot: string | null = "/project";
    const rootCodeLenses = createDeferred<LanguageServerCodeLens[]>();
    const rootGateway = featuresGateway();
    vi.mocked(rootGateway.codeLenses).mockImplementationOnce(
      async () => rootCodeLenses.promise,
    );
    registerLanguageServerMonacoProviders(
      rootRegistered.monaco,
      providerContext({
        featuresGateway: rootGateway,
        getWorkspaceRoot: () => activeRoot,
      }),
    );

    const rootLensesPromise =
      rootRegistered.codeLensProvider.provideCodeLenses(model());

    await Promise.resolve();
    activeRoot = "/other";
    rootCodeLenses.resolve([
      {
        command: null,
        data: { id: "stale-root" },
        range: range(1, 0, 1, 1),
      },
    ]);

    await expect(rootLensesPromise).resolves.toEqual({
      dispose: expect.any(Function),
      lenses: [],
    });
  });

  it("does not resolve stale or unbacked PHP CodeLens instances", async () => {
    const registered = createRegisteredProviders();
    let activeRoot: string | null = "/project";
    const sourceLens: LanguageServerCodeLens = {
      command: null,
      data: { id: "references" },
      range: range(1, 0, 1, 12),
    };
    const gateway = featuresGateway({
      resolvedCodeLens: {
        ...sourceLens,
        command: {
          arguments: [],
          command: "phpactor.references",
          title: "References",
        },
      },
    });
    const flushPendingDocumentChange = vi.fn(async () => undefined);
    registerLanguageServerMonacoProviders(
      registered.monaco,
      providerContext({
        featuresGateway: gateway,
        flushPendingDocumentChange,
        getWorkspaceRoot: () => activeRoot,
      }),
    );
    const backedLens = backedCodeLens(sourceLens);
    const unbackedLens = {
      range: new registered.monaco.Range(2, 1, 2, 13),
    };

    activeRoot = "/other";

    await expect(
      registered.codeLensProvider.resolveCodeLens(model(), backedLens),
    ).resolves.toBe(backedLens);
    await expect(
      registered.codeLensProvider.resolveCodeLens(model(), unbackedLens),
    ).resolves.toBe(unbackedLens);
    expect(flushPendingDocumentChange).not.toHaveBeenCalled();
    expect(gateway.resolveCodeLens).not.toHaveBeenCalled();

    const sessionRegistered = createRegisteredProviders();
    let activeSessionId = 1;
    const sessionGateway = featuresGateway({
      resolvedCodeLens: {
        ...sourceLens,
        command: {
          arguments: [],
          command: "phpactor.references",
          title: "References",
        },
      },
    });
    const sessionFlushPendingDocumentChange = vi.fn(async () => undefined);
    registerLanguageServerMonacoProviders(
      sessionRegistered.monaco,
      providerContext({
        featuresGateway: sessionGateway,
        flushPendingDocumentChange: sessionFlushPendingDocumentChange,
        getRuntimeStatus: () => ({
          ...runningStatus(),
          sessionId: activeSessionId,
        }),
      }),
    );
    const sessionBackedLens = backedCodeLens(sourceLens);

    activeSessionId = 2;

    await expect(
      sessionRegistered.codeLensProvider.resolveCodeLens(
        model(),
        sessionBackedLens,
      ),
    ).resolves.toBe(sessionBackedLens);
    expect(sessionFlushPendingDocumentChange).not.toHaveBeenCalled();
    expect(sessionGateway.resolveCodeLens).not.toHaveBeenCalled();
  });

  it("drops stale PHP CodeLens resolve results after async response", async () => {
    const registered = createRegisteredProviders();
    let activeSessionId = 1;
    const sourceLens: LanguageServerCodeLens = {
      command: null,
      data: { id: "references" },
      range: range(1, 0, 1, 12),
    };
    const resolvedCodeLens = createDeferred<LanguageServerCodeLens>();
    const gateway = featuresGateway();
    vi.mocked(gateway.resolveCodeLens).mockImplementationOnce(
      async () => resolvedCodeLens.promise,
    );
    registerLanguageServerMonacoProviders(
      registered.monaco,
      providerContext({
        featuresGateway: gateway,
        getRuntimeStatus: () => ({
          ...runningStatus(),
          sessionId: activeSessionId,
        }),
      }),
    );
    const backedLens = backedCodeLens(sourceLens);

    const resolvePromise = registered.codeLensProvider.resolveCodeLens(
      model(),
      backedLens,
    );

    await Promise.resolve();
    expect(gateway.resolveCodeLens).toHaveBeenCalledWith(
      "/project",
      sourceLens,
    );

    activeSessionId = 2;
    resolvedCodeLens.resolve({
      ...sourceLens,
      command: {
        arguments: [],
        command: "phpactor.references",
        title: "References",
      },
    });

    await expect(resolvePromise).resolves.toBe(backedLens);

    const rootRegistered = createRegisteredProviders();
    let activeRoot: string | null = "/project";
    const rootResolvedCodeLens = createDeferred<LanguageServerCodeLens>();
    const rootGateway = featuresGateway();
    vi.mocked(rootGateway.resolveCodeLens).mockImplementationOnce(
      async () => rootResolvedCodeLens.promise,
    );
    registerLanguageServerMonacoProviders(
      rootRegistered.monaco,
      providerContext({
        featuresGateway: rootGateway,
        getWorkspaceRoot: () => activeRoot,
      }),
    );
    const rootBackedLens = backedCodeLens(sourceLens);

    const rootResolvePromise = rootRegistered.codeLensProvider.resolveCodeLens(
      model(),
      rootBackedLens,
    );

    await Promise.resolve();
    expect(rootGateway.resolveCodeLens).toHaveBeenCalledWith(
      "/project",
      sourceLens,
    );

    activeRoot = "/other";
    rootResolvedCodeLens.resolve({
      ...sourceLens,
      command: {
        arguments: [],
        command: "phpactor.references",
        title: "References",
      },
    });

    await expect(rootResolvePromise).resolves.toBe(rootBackedLens);
  });

  it("provides mapped PHP InlayHint string and part-label hints", async () => {
    const registered = createRegisteredProviders();
    const stringHint: LanguageServerInlayHint = {
      data: { id: "type" },
      kind: 1,
      label: ": User",
      paddingLeft: true,
      paddingRight: false,
      position: { character: 10, line: 2 },
      textEdits: [
        {
          newText: ": User",
          range: range(2, 10, 2, 10),
        },
      ],
      tooltip: "Inferred type",
    };
    const partHint: LanguageServerInlayHint = {
      data: { id: "parameter" },
      kind: 2,
      label: [
        {
          command: {
            arguments: [{ name: "user" }],
            command: "phpactor.importClass",
            title: "Import User",
          },
          label: "user",
          location: {
            range: range(4, 2, 4, 6),
            uri: "file:///project/src/User.php",
          },
          tooltip: "User symbol",
        },
        {
          label: "external",
          location: {
            range: range(1, 0, 1, 8),
            uri: "file:///other/src/External.php",
          },
        },
      ],
      paddingLeft: false,
      paddingRight: true,
      position: { character: 4, line: 3 },
      tooltip: null,
    };
    const gateway = featuresGateway({ inlayHints: [stringHint, partHint] });
    const flushPendingDocumentChange = vi.fn(async () => undefined);
    const context = providerContext({
      featuresGateway: gateway,
      flushPendingDocumentChange,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const result = await registered.inlayHintsProvider.provideInlayHints(
      model(),
      new registered.monaco.Range(2, 1, 5, 12),
    );

    expect(flushPendingDocumentChange).toHaveBeenCalledWith(
      "/project/src/User.php",
    );
    expect(gateway.inlayHints).toHaveBeenCalledWith(
      "/project",
      "/project/src/User.php",
      range(1, 0, 4, 11),
    );
    expect(result.hints[0]).toMatchObject({
      kind: registered.monaco.languages.InlayHintKind.Type,
      label: ": User",
      paddingLeft: true,
      paddingRight: false,
      position: { column: 11, lineNumber: 3 },
      textEdits: [
        {
          range: new registered.monaco.Range(3, 11, 3, 11),
          text: ": User",
        },
      ],
      tooltip: "Inferred type",
    });
    expect(result.hints[1]).toMatchObject({
      kind: registered.monaco.languages.InlayHintKind.Parameter,
      paddingLeft: false,
      paddingRight: true,
      position: { column: 5, lineNumber: 4 },
      tooltip: undefined,
    });
    expect(result.hints[1].label).toEqual([
      {
        command: {
          arguments: [
            {
              command: {
                arguments: [{ name: "user" }],
                command: "phpactor.importClass",
                title: "Import User",
              },
              path: "/project/src/User.php",
              rootPath: "/project",
              sessionId: 1,
            },
          ],
          id: "mockor.php.executeLanguageServerCommand",
          title: "Import User",
        },
        label: "user",
        location: {
          range: new registered.monaco.Range(5, 3, 5, 7),
          uri: { fsPath: "/project/src/User.php", path: "/project/src/User.php" },
        },
        tooltip: "User symbol",
      },
      {
        label: "external",
      },
    ]);
    expect((result.hints[0] as any).__languageServerInlayHint).toBe(stringHint);
    expect((result.hints[0] as any).__workspaceRoot).toBe("/project");
    expect((result.hints[0] as any).__sourcePath).toBe("/project/src/User.php");
    expect((result.hints[0] as any).__languageServerSessionId).toBe(1);
    expect(Object.keys(result.hints[0])).not.toContain(
      "__languageServerInlayHint",
    );
  });

  it("resolves PHP InlayHint through the stored root and session", async () => {
    const registered = createRegisteredProviders();
    const sourceHint: LanguageServerInlayHint = {
      data: { id: "type" },
      kind: null,
      label: ": mixed",
      paddingLeft: true,
      paddingRight: false,
      position: { character: 5, line: 1 },
      tooltip: null,
    };
    const resolvedHint: LanguageServerInlayHint = {
      ...sourceHint,
      kind: 1,
      label: ": User",
      textEdits: [
        {
          newText: ": User",
          range: range(1, 5, 1, 5),
        },
      ],
      tooltip: "Resolved type",
    };
    const gateway = featuresGateway();
    vi.mocked(gateway.resolveInlayHint).mockResolvedValueOnce(resolvedHint);
    const flushPendingDocumentChange = vi.fn(async () => undefined);
    registerLanguageServerMonacoProviders(
      registered.monaco,
      providerContext({ featuresGateway: gateway, flushPendingDocumentChange }),
    );
    const backedHint = backedInlayHint(sourceHint);

    const resolved = await registered.inlayHintsProvider.resolveInlayHint(
      backedHint,
    );

    expect(flushPendingDocumentChange).toHaveBeenCalledWith(
      "/project/src/User.php",
    );
    expect(gateway.resolveInlayHint).toHaveBeenCalledWith(
      "/project",
      sourceHint,
    );
    expect(resolved).toMatchObject({
      kind: registered.monaco.languages.InlayHintKind.Type,
      label: ": User",
      position: { column: 6, lineNumber: 2 },
      textEdits: [
        {
          range: new registered.monaco.Range(2, 6, 2, 6),
          text: ": User",
        },
      ],
      tooltip: "Resolved type",
    });
    expect((resolved as any).__languageServerInlayHint).toBe(resolvedHint);
    expect(backedHint.kind).toBeUndefined();
  });

  it("does not provide PHP InlayHint when capability is disabled or root is stale", async () => {
    const registered = createRegisteredProviders();
    const disabledGateway = featuresGateway();
    const disabledFlushPendingDocumentChange = vi.fn(async () => undefined);
    registerLanguageServerMonacoProviders(
      registered.monaco,
      providerContext({
        featuresGateway: disabledGateway,
        flushPendingDocumentChange: disabledFlushPendingDocumentChange,
        runtimeStatus: runningStatus({ inlayHint: false }),
      }),
    );

    await expect(
      registered.inlayHintsProvider.provideInlayHints(
        model(),
        new registered.monaco.Range(1, 1, 1, 5),
      ),
    ).resolves.toEqual({ dispose: expect.any(Function), hints: [] });
    expect(disabledFlushPendingDocumentChange).not.toHaveBeenCalled();
    expect(disabledGateway.inlayHints).not.toHaveBeenCalled();

    const rootRegistered = createRegisteredProviders();
    const rootGateway = featuresGateway();
    const rootFlushPendingDocumentChange = vi.fn(async () => undefined);
    registerLanguageServerMonacoProviders(
      rootRegistered.monaco,
      providerContext({
        featuresGateway: rootGateway,
        flushPendingDocumentChange: rootFlushPendingDocumentChange,
        getWorkspaceRoot: () => "/project",
        runtimeStatus: {
          ...runningStatus(),
          rootPath: "/other",
        },
      }),
    );

    await expect(
      rootRegistered.inlayHintsProvider.provideInlayHints(
        model(),
        new rootRegistered.monaco.Range(1, 1, 1, 5),
      ),
    ).resolves.toEqual({ dispose: expect.any(Function), hints: [] });
    expect(rootFlushPendingDocumentChange).not.toHaveBeenCalled();
    expect(rootGateway.inlayHints).not.toHaveBeenCalled();
  });

  it("drops in-flight PHP InlayHint provide results after session restart", async () => {
    const registered = createRegisteredProviders();
    let activeSessionId = 1;
    const inlayHints = createDeferred<LanguageServerInlayHint[]>();
    const gateway = featuresGateway();
    vi.mocked(gateway.inlayHints).mockImplementationOnce(
      async () => inlayHints.promise,
    );
    registerLanguageServerMonacoProviders(
      registered.monaco,
      providerContext({
        featuresGateway: gateway,
        getRuntimeStatus: () => ({
          ...runningStatus(),
          sessionId: activeSessionId,
        }),
      }),
    );

    const hintsPromise = registered.inlayHintsProvider.provideInlayHints(
      model(),
      new registered.monaco.Range(1, 1, 1, 5),
    );

    await Promise.resolve();
    activeSessionId = 2;
    inlayHints.resolve([
      {
        kind: 1,
        label: ": User",
        paddingLeft: true,
        paddingRight: false,
        position: { character: 5, line: 1 },
        tooltip: "Stale",
      },
    ]);

    await expect(hintsPromise).resolves.toEqual({
      dispose: expect.any(Function),
      hints: [],
    });
  });

  it("does not resolve stale or unbacked PHP InlayHint values", async () => {
    const registered = createRegisteredProviders();
    let activeRoot: string | null = "/project";
    const gateway = featuresGateway();
    const flushPendingDocumentChange = vi.fn(async () => undefined);
    registerLanguageServerMonacoProviders(
      registered.monaco,
      providerContext({
        featuresGateway: gateway,
        flushPendingDocumentChange,
        getWorkspaceRoot: () => activeRoot,
      }),
    );
    const sourceHint: LanguageServerInlayHint = {
      kind: 1,
      label: ": User",
      paddingLeft: true,
      paddingRight: false,
      position: { character: 5, line: 1 },
      tooltip: null,
    };
    const backedHint = backedInlayHint(sourceHint);
    const unbackedHint = {
      label: ": User",
      paddingLeft: true,
      paddingRight: false,
      position: { column: 6, lineNumber: 2 },
    };

    activeRoot = "/other";

    await expect(
      registered.inlayHintsProvider.resolveInlayHint(backedHint),
    ).resolves.toBe(backedHint);
    await expect(
      registered.inlayHintsProvider.resolveInlayHint(unbackedHint),
    ).resolves.toBe(unbackedHint);
    expect(flushPendingDocumentChange).not.toHaveBeenCalled();
    expect(gateway.resolveInlayHint).not.toHaveBeenCalled();

    const sessionRegistered = createRegisteredProviders();
    let activeSessionId = 1;
    const sessionGateway = featuresGateway();
    const sessionFlushPendingDocumentChange = vi.fn(async () => undefined);
    registerLanguageServerMonacoProviders(
      sessionRegistered.monaco,
      providerContext({
        featuresGateway: sessionGateway,
        flushPendingDocumentChange: sessionFlushPendingDocumentChange,
        getRuntimeStatus: () => ({
          ...runningStatus(),
          sessionId: activeSessionId,
        }),
      }),
    );
    const sessionBackedHint = backedInlayHint(sourceHint);

    activeSessionId = 2;

    await expect(
      sessionRegistered.inlayHintsProvider.resolveInlayHint(sessionBackedHint),
    ).resolves.toBe(sessionBackedHint);
    expect(sessionFlushPendingDocumentChange).not.toHaveBeenCalled();
    expect(sessionGateway.resolveInlayHint).not.toHaveBeenCalled();

    const flushRegistered = createRegisteredProviders();
    let flushSessionId = 1;
    const flushGateway = featuresGateway();
    const staleAfterFlush = vi.fn(async () => {
      flushSessionId = 2;
    });
    registerLanguageServerMonacoProviders(
      flushRegistered.monaco,
      providerContext({
        featuresGateway: flushGateway,
        flushPendingDocumentChange: staleAfterFlush,
        getRuntimeStatus: () => ({
          ...runningStatus(),
          sessionId: flushSessionId,
        }),
      }),
    );
    const flushBackedHint = backedInlayHint(sourceHint);

    await expect(
      flushRegistered.inlayHintsProvider.resolveInlayHint(flushBackedHint),
    ).resolves.toBe(flushBackedHint);
    expect(staleAfterFlush).toHaveBeenCalledWith("/project/src/User.php");
    expect(flushGateway.resolveInlayHint).not.toHaveBeenCalled();
  });

  it("drops stale PHP InlayHint resolve results after async response", async () => {
    const registered = createRegisteredProviders();
    let activeSessionId = 1;
    const sourceHint: LanguageServerInlayHint = {
      data: { id: "type" },
      kind: null,
      label: ": mixed",
      paddingLeft: true,
      paddingRight: false,
      position: { character: 5, line: 1 },
      tooltip: null,
    };
    const resolvedInlayHint = createDeferred<LanguageServerInlayHint>();
    const gateway = featuresGateway();
    vi.mocked(gateway.resolveInlayHint).mockImplementationOnce(
      async () => resolvedInlayHint.promise,
    );
    registerLanguageServerMonacoProviders(
      registered.monaco,
      providerContext({
        featuresGateway: gateway,
        getRuntimeStatus: () => ({
          ...runningStatus(),
          sessionId: activeSessionId,
        }),
      }),
    );
    const backedHint = backedInlayHint(sourceHint);

    const resolvePromise = registered.inlayHintsProvider.resolveInlayHint(
      backedHint,
    );

    await Promise.resolve();
    expect(gateway.resolveInlayHint).toHaveBeenCalledWith(
      "/project",
      sourceHint,
    );

    activeSessionId = 2;
    resolvedInlayHint.resolve({
      ...sourceHint,
      kind: 1,
      label: ": User",
      tooltip: "Resolved after restart",
    });

    await expect(resolvePromise).resolves.toBe(backedHint);
    expect(backedHint.label).toBe(": mixed");
    expect(backedHint.kind).toBeUndefined();
  });

  it("adds TS-fallback PHP parameter-name InlayHints alongside phpactor hints", async () => {
    const registered = createRegisteredProviders();
    const phpactorHint: LanguageServerInlayHint = {
      kind: 1,
      label: ": int",
      paddingLeft: true,
      paddingRight: false,
      position: { character: 12, line: 1 },
      tooltip: null,
    };
    const gateway = featuresGateway({ inlayHints: [phpactorHint] });
    const providePhpParameterInlayHints = vi.fn(async () => [
      { character: 6, line: 1, name: "count" },
      { character: 9, line: 1, name: "label" },
    ]);
    const context = providerContext({
      featuresGateway: gateway,
      isPhpInlayHintsEnabled: () => true,
      providePhpParameterInlayHints,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const result = await registered.inlayHintsProvider.provideInlayHints(
      model(),
      new registered.monaco.Range(2, 1, 2, 20),
    );

    expect(providePhpParameterInlayHints).toHaveBeenCalled();
    const labels = result.hints.map((hint: any) => hint.label);
    expect(labels).toContain(": int");
    expect(labels).toContain("count:");
    expect(labels).toContain("label:");
    const parameterHint = result.hints.find(
      (hint: any) => hint.label === "count:",
    );
    expect(parameterHint).toMatchObject({
      kind: registered.monaco.languages.InlayHintKind.Parameter,
      paddingRight: true,
      position: { column: 7, lineNumber: 2 },
    });
  });

  it("does not provide any PHP InlayHints when the PHP toggle is disabled", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      inlayHints: [
        {
          kind: 1,
          label: ": int",
          paddingLeft: true,
          paddingRight: false,
          position: { character: 12, line: 1 },
          tooltip: null,
        },
      ],
    });
    const providePhpParameterInlayHints = vi.fn(async () => [
      { character: 6, line: 1, name: "count" },
    ]);
    const context = providerContext({
      featuresGateway: gateway,
      isPhpInlayHintsEnabled: () => false,
      providePhpParameterInlayHints,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.inlayHintsProvider.provideInlayHints(
        model(),
        new registered.monaco.Range(2, 1, 2, 20),
      ),
    ).resolves.toEqual({ dispose: expect.any(Function), hints: [] });
    expect(gateway.inlayHints).not.toHaveBeenCalled();
    expect(providePhpParameterInlayHints).not.toHaveBeenCalled();
  });

  it("drops in-flight TS-fallback PHP parameter hints after switching project tabs", async () => {
    const registered = createRegisteredProviders();
    let activeRoot: string | null = "/project";
    const parameterHints = createDeferred<
      { character: number; line: number; name: string }[]
    >();
    const providePhpParameterInlayHints = vi.fn(async () => parameterHints.promise);
    const context = providerContext({
      featuresGateway: featuresGateway(),
      getWorkspaceRoot: () => activeRoot,
      isPhpInlayHintsEnabled: () => true,
      providePhpParameterInlayHints,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const hintsPromise = registered.inlayHintsProvider.provideInlayHints(
      model(),
      new registered.monaco.Range(2, 1, 2, 20),
    );

    // Flush the phpactor inlay-hints await chain so the flow reaches the
    // TS-fallback resolve, then switch tabs mid-resolution.
    for (let tick = 0; tick < 6; tick += 1) {
      await Promise.resolve();
    }

    expect(providePhpParameterInlayHints).toHaveBeenCalled();
    activeRoot = null;
    parameterHints.resolve([{ character: 6, line: 1, name: "count" }]);

    await expect(hintsPromise).resolves.toEqual({
      dispose: expect.any(Function),
      hints: [],
    });
  });

  it("provides mapped PHP semantic tokens with the active runtime legend", async () => {
    const registered = createRegisteredProviders();
    const customLegend = {
      tokenModifiers: ["static", "deprecated"],
      tokenTypes: ["class", "method"],
    };
    const tokens: LanguageServerSemanticTokens = {
      data: [0, 6, 4, 0, 0, 1, 2, 3, 1, 1],
      resultId: "php-semantic-1",
    };
    const gateway = featuresGateway({ semanticTokens: tokens });
    const flushPendingDocumentChange = vi.fn(async () => undefined);
    registerLanguageServerMonacoProviders(
      registered.monaco,
      providerContext({
        featuresGateway: gateway,
        flushPendingDocumentChange,
        runtimeStatus: runningStatus({ semanticTokensLegend: customLegend }),
      }),
    );

    const result =
      await registered.documentSemanticTokensProvider.provideDocumentSemanticTokens(
        model(),
      );

    expect(registered.documentSemanticTokensProvider.getLegend()).toEqual(
      customLegend,
    );
    expect(flushPendingDocumentChange).toHaveBeenCalledWith(
      "/project/src/User.php",
    );
    expect(gateway.semanticTokens).toHaveBeenCalledWith(
      "/project",
      "/project/src/User.php",
    );
    expect(result).toEqual({
      data: Uint32Array.from(tokens.data),
      resultId: "php-semantic-1",
    });
  });

  it("provides mapped PHP range semantic tokens", async () => {
    const registered = createRegisteredProviders();
    const rangeTokens: LanguageServerSemanticTokens = {
      data: [0, 2, 4, 8, 0, 1, 4, 3, 9, 1],
      resultId: "php-range-semantic-1",
    };
    const gateway = featuresGateway({ rangeSemanticTokens: rangeTokens });
    const flushPendingDocumentChange = vi.fn(async () => undefined);
    registerLanguageServerMonacoProviders(
      registered.monaco,
      providerContext({ featuresGateway: gateway, flushPendingDocumentChange }),
    );

    const result =
      await registered.rangeSemanticTokensProvider.provideDocumentRangeSemanticTokens(
        model(),
        new registered.monaco.Range(2, 3, 4, 12),
      );

    expect(registered.rangeSemanticTokensProvider.getLegend()).toEqual(
      registered.documentSemanticTokensProvider.getLegend(),
    );
    expect(flushPendingDocumentChange).toHaveBeenCalledWith(
      "/project/src/User.php",
    );
    expect(gateway.rangeSemanticTokens).toHaveBeenCalledWith(
      "/project",
      "/project/src/User.php",
      range(1, 2, 3, 11),
    );
    expect(result).toEqual({
      data: Uint32Array.from(rangeTokens.data),
      resultId: "php-range-semantic-1",
    });
  });

  it("does not request PHP semantic tokens when capability is disabled", async () => {
    const registered = createRegisteredProviders();
    const gateway = featuresGateway({
      semanticTokens: {
        data: [0, 1, 1, 0, 0],
        resultId: "disabled",
      },
    });
    const flushPendingDocumentChange = vi.fn(async () => undefined);
    registerLanguageServerMonacoProviders(
      registered.monaco,
      providerContext({
        featuresGateway: gateway,
        flushPendingDocumentChange,
        runtimeStatus: runningStatus({ semanticTokens: false }),
      }),
    );

    await expect(
      registered.documentSemanticTokensProvider.provideDocumentSemanticTokens(
        model(),
      ),
    ).resolves.toBeNull();
    await expect(
      registered.rangeSemanticTokensProvider.provideDocumentRangeSemanticTokens(
        model(),
        new registered.monaco.Range(1, 1, 1, 5),
      ),
    ).resolves.toBeNull();
    expect(flushPendingDocumentChange).not.toHaveBeenCalled();
    expect(gateway.semanticTokens).not.toHaveBeenCalled();
    expect(gateway.rangeSemanticTokens).not.toHaveBeenCalled();
  });

  it("drops stale PHP semantic token results after workspace or session changes", async () => {
    const registered = createRegisteredProviders();
    let activeSessionId = 1;
    const semanticTokens = createDeferred<LanguageServerSemanticTokens | null>();
    const gateway = featuresGateway();
    vi.mocked(gateway.semanticTokens).mockImplementationOnce(
      async () => semanticTokens.promise,
    );
    registerLanguageServerMonacoProviders(
      registered.monaco,
      providerContext({
        featuresGateway: gateway,
        getRuntimeStatus: () => ({
          ...runningStatus(),
          sessionId: activeSessionId,
        }),
      }),
    );

    const tokensPromise =
      registered.documentSemanticTokensProvider.provideDocumentSemanticTokens(
        model(),
      );

    await Promise.resolve();
    activeSessionId = 2;
    semanticTokens.resolve({
      data: [0, 1, 1, 0, 0],
      resultId: "stale-session",
    });

    await expect(tokensPromise).resolves.toBeNull();

    const rootRegistered = createRegisteredProviders();
    let activeRoot: string | null = "/project";
    const rangeTokens = createDeferred<LanguageServerSemanticTokens | null>();
    const rootGateway = featuresGateway();
    vi.mocked(rootGateway.rangeSemanticTokens).mockImplementationOnce(
      async () => rangeTokens.promise,
    );
    registerLanguageServerMonacoProviders(
      rootRegistered.monaco,
      providerContext({
        featuresGateway: rootGateway,
        getWorkspaceRoot: () => activeRoot,
      }),
    );

    const rangeTokensPromise =
      rootRegistered.rangeSemanticTokensProvider.provideDocumentRangeSemanticTokens(
        model(),
        new rootRegistered.monaco.Range(2, 3, 4, 12),
      );

    await Promise.resolve();
    activeRoot = "/other";
    rangeTokens.resolve({
      data: [0, 2, 4, 8, 0],
      resultId: "stale-root",
    });

    await expect(rangeTokensPromise).resolves.toBeNull();
    expect(rootGateway.rangeSemanticTokens).toHaveBeenCalledWith(
      "/project",
      "/project/src/User.php",
      range(1, 2, 3, 11),
    );
  });

});

describe("registerLanguageServerMonacoProviders blade providers", () => {
  it("keeps template registrations stable while requests use the latest registry", async () => {
    const registered = createRegisteredProviders();
    const activeDocument: EditorDocument = {
      content: "@inc",
      language: "blade",
      name: "show.blade.php",
      path: "/project/resources/views/show.blade.php",
      savedContent: "@inc",
    };
    const firstCompletions = vi.fn(async () => [
      { insertText: "@first", kind: "directive" as const, label: "@first" },
    ]);
    const latestCompletions = vi.fn(async () => [
      { insertText: "@latest", kind: "directive" as const, label: "@latest" },
    ]);
    let registry = templateRegistry({ provideBladeCompletions: firstCompletions });
    const context = providerContext({ activeDocument });
    context.getTemplateLanguageProviders = () => registry;
    const disposable = registerLanguageServerMonacoProviders(
      registered.monaco,
      context,
    );
    const providerModel = model({
      content: activeDocument.content,
      path: activeDocument.path,
    });

    await registered.bladeCompletionProvider.provideCompletionItems(
      providerModel,
      { column: 5, lineNumber: 1 },
    );
    registry = templateRegistry({ provideBladeCompletions: latestCompletions });
    const result = await registered.bladeCompletionProvider.provideCompletionItems(
      providerModel,
      { column: 5, lineNumber: 1 },
    );

    expect(firstCompletions).toHaveBeenCalledTimes(1);
    expect(latestCompletions).toHaveBeenCalledTimes(1);
    expect(completionLabels(result.suggestions)).toEqual(["@latest"]);
    expect(
      registered.monaco.languages.registerCompletionItemProvider,
    ).toHaveBeenCalledTimes(4);
    expect(
      registered.monaco.languages.registerDefinitionProvider,
    ).toHaveBeenCalledTimes(4);

    disposable.dispose();

    expect(registered.bladeCompletionDispose).toHaveBeenCalledTimes(1);
    expect(registered.bladeDefinitionDispose).toHaveBeenCalledTimes(1);
    expect(registered.bladeCodeActionDispose).toHaveBeenCalledTimes(1);
    expect(registered.latteCompletionDispose).toHaveBeenCalledTimes(1);
    expect(registered.latteDefinitionDispose).toHaveBeenCalledTimes(1);
    expect(registered.neonCompletionDispose).toHaveBeenCalledTimes(1);
    expect(registered.neonDefinitionDispose).toHaveBeenCalledTimes(1);
  });

  it("registers blade definition and completion providers and disposes them", () => {
    const registered = createRegisteredProviders();
    const disposable = registerLanguageServerMonacoProviders(
      registered.monaco,
      providerContext(),
    );

    expect(registered.bladeDefinitionLanguage).toBe("blade");
    expect(registered.bladeCompletionLanguage).toBe("blade");
    expect(registered.bladeCompletionProvider.triggerCharacters).toEqual([
      "@",
      "'",
      "\"",
      "-",
      ".",
      "$",
      ">",
    ]);

    disposable.dispose();

    expect(registered.bladeDefinitionDispose).toHaveBeenCalled();
    expect(registered.bladeCompletionDispose).toHaveBeenCalled();
  });

  it("delegates blade go-to-definition to the controller and returns null", async () => {
    const registered = createRegisteredProviders();
    const source = "@include('partials.alert')\n";
    const offset = source.indexOf("partials.alert");
    const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
    const column = offset - lineStart + 1;
    const providerModel = model({
      content: source,
      path: "/project/resources/views/show.blade.php",
    });
    const provideBladeDefinition = vi.fn(async (_source, _offset, request) => {
      expect(request?.canNavigate()).toBe(true);
      providerModel.getVersionId.mockReturnValue(43);
      expect(request?.canNavigate()).toBe(false);

      return true;
    });
    const context = providerContext({
      activeDocument: bladeDocument(source),
      provideBladeDefinition,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.bladeDefinitionProvider.provideDefinition(
        providerModel,
        { column, lineNumber: 1 },
      ),
    ).resolves.toBeNull();
    expect(provideBladeDefinition).toHaveBeenCalledTimes(1);
    expect(provideBladeDefinition).toHaveBeenCalledWith(
      source,
      offset,
      expect.objectContaining({ canNavigate: expect.any(Function) }),
    );
  });

  it("does not call the blade definition callback for a non-blade active document", async () => {
    const registered = createRegisteredProviders();
    const provideBladeDefinition = vi.fn(async () => true);
    const context = providerContext({
      activeDocument: document(),
      provideBladeDefinition,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.bladeDefinitionProvider.provideDefinition(
        model({ content: "@include('x')", path: "/project/src/User.php" }),
        { column: 1, lineNumber: 1 },
      ),
    ).resolves.toBeNull();
    expect(provideBladeDefinition).not.toHaveBeenCalled();
  });

  it("maps blade directive completions to keyword items replacing the directive token", async () => {
    const registered = createRegisteredProviders();
    const source = "@inc\n";
    const provideBladeCompletions = vi.fn(async () => [
      {
        detail: "Blade directive",
        insertText: "include",
        kind: "directive" as const,
        label: "@include",
        replaceEnd: 4,
        replaceStart: 1,
      },
    ]);
    const context = providerContext({
      activeDocument: bladeDocument(source),
      provideBladeCompletions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const result = await registered.bladeCompletionProvider.provideCompletionItems(
      model({
        content: source,
        path: "/project/resources/views/show.blade.php",
      }),
      { column: 5, lineNumber: 1 },
    );

    expect(provideBladeCompletions).toHaveBeenCalledWith(source, {
      column: 5,
      lineNumber: 1,
    });
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]).toEqual(
      expect.objectContaining({
        insertText: "include",
        kind: registered.monaco.languages.CompletionItemKind.Keyword,
        label: "@include",
        range: {
          endColumn: 5,
          endLineNumber: 1,
          startColumn: 2,
          startLineNumber: 1,
        },
      }),
    );
  });

  it("maps blade view completions to file items", async () => {
    const registered = createRegisteredProviders();
    const source = "@include('part')\n";
    const provideBladeCompletions = vi.fn(async () => [
      {
        detail: "partials/alert.blade.php",
        insertText: "partials.alert",
        kind: "view" as const,
        label: "partials.alert",
        replaceEnd: source.indexOf("part") + "part".length,
        replaceStart: source.indexOf("part"),
      },
    ]);
    const context = providerContext({
      activeDocument: bladeDocument(source),
      provideBladeCompletions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const result = await registered.bladeCompletionProvider.provideCompletionItems(
      model({
        content: source,
        path: "/project/resources/views/show.blade.php",
      }),
      { column: source.indexOf("part") + 1, lineNumber: 1 },
    );

    expect(result.suggestions[0]).toEqual(
      expect.objectContaining({
        insertText: "partials.alert",
        kind: registered.monaco.languages.CompletionItemKind.File,
        label: "partials.alert",
      }),
    );
  });

  it("maps blade quick fixes to new-file code actions", async () => {
    const registered = createRegisteredProviders();
    const source = "@include('missing.view')\n";
    const newFile = {
      content: "",
      path: "/project/resources/views/missing/view.blade.php",
      title: "Create Blade View",
    };
    const provideBladeCodeActions = vi.fn(async () => [
      {
        edits: [],
        isPreferred: true,
        kind: "quickfix",
        newFile,
        title: "Create Blade view missing.view",
      },
    ]);
    const context = providerContext({
      activeDocument: bladeDocument(source),
      applyPhpCodeActionNewFile: vi.fn(async () => true),
      provideBladeCodeActions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    expect(registered.bladeCodeActionLanguage).toBe("blade");
    expect(registered.bladeCodeActionMetadata).toEqual({
      providedCodeActionKinds: ["quickfix"],
    });

    const result = await registered.bladeCodeActionProvider.provideCodeActions(
      model({
        content: source,
        path: "/project/resources/views/show.blade.php",
      }),
      new registered.monaco.Range(1, 12, 1, 24),
      { markers: [], only: "quickfix" },
    );

    expect(provideBladeCodeActions).toHaveBeenCalledWith(source, {
      end: source.indexOf("missing.view") + "missing.view".length + 1,
      start: source.indexOf("missing.view") + 1,
    });
    expect(result.actions).toEqual([
      expect.objectContaining({
        command: expect.objectContaining({
          arguments: [
            expect.objectContaining({
              edits: [],
              newFile,
              sourcePath: "/project/resources/views/show.blade.php",
              versionId: 42,
            }),
          ],
          title: "Create file",
        }),
        edit: { edits: [] },
        isPreferred: true,
        kind: "quickfix",
        title: "Create Blade view missing.view",
      }),
    ]);
  });

  it("maps blade variable and helper completions to distinct Monaco kinds", async () => {
    const registered = createRegisteredProviders();
    const source = "{{ $co }} {{ ro }}\n";
    const provideBladeCompletions = vi.fn(async () => [
      {
        detail: "view data · Comment",
        insertText: "$comment",
        kind: "variable" as const,
        label: "$comment",
        replaceEnd: source.indexOf("$co") + "$co".length,
        replaceStart: source.indexOf("$co"),
      },
      {
        detail: "Laravel helper",
        insertText: "route()",
        kind: "helper" as const,
        label: "route",
        replaceEnd: source.indexOf("ro") + "ro".length,
        replaceStart: source.indexOf("ro"),
      },
    ]);
    const context = providerContext({
      activeDocument: bladeDocument(source),
      provideBladeCompletions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const result = await registered.bladeCompletionProvider.provideCompletionItems(
      model({
        content: source,
        path: "/project/resources/views/show.blade.php",
      }),
      { column: source.indexOf("$co") + "$co".length + 1, lineNumber: 1 },
    );

    expect(result.suggestions).toEqual([
      expect.objectContaining({
        detail: "view data · Comment",
        insertText: "$comment",
        kind: registered.monaco.languages.CompletionItemKind.Variable,
        label: "$comment",
      }),
      expect.objectContaining({
        insertText: "route()",
        kind: registered.monaco.languages.CompletionItemKind.Function,
        label: "route",
      }),
    ]);
  });

  it("maps blade member completions to method items", async () => {
    const registered = createRegisteredProviders();
    const source = "{{ $comment->ex }}\n";
    const provideBladeCompletions = vi.fn(async () => [
      {
        detail: "App\\Models\\Comment::excerpt(): string",
        insertText: "excerpt()",
        kind: "member" as const,
        label: "excerpt",
        replaceEnd: source.indexOf("ex") + "ex".length,
        replaceStart: source.indexOf("ex"),
      },
    ]);
    const context = providerContext({
      activeDocument: bladeDocument(source),
      provideBladeCompletions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const result = await registered.bladeCompletionProvider.provideCompletionItems(
      model({
        content: source,
        path: "/project/resources/views/show.blade.php",
      }),
      { column: source.indexOf("ex") + "ex".length + 1, lineNumber: 1 },
    );

    expect(result.suggestions).toEqual([
      expect.objectContaining({
        detail: "App\\Models\\Comment::excerpt(): string",
        insertText: "excerpt()",
        kind: registered.monaco.languages.CompletionItemKind.Method,
        label: "excerpt",
      }),
    ]);
  });

  it("offers built-in blade live-template snippets alongside controller completions", async () => {
    const registered = createRegisteredProviders();
    const source = "@fore\n";
    const provideBladeCompletions = vi.fn(async () => [
      {
        detail: "Blade directive",
        insertText: "foreach",
        kind: "directive" as const,
        label: "@foreach",
        replaceEnd: 5,
        replaceStart: 1,
      },
    ]);
    const context = providerContext({
      activeDocument: bladeDocument(source),
      provideBladeCompletions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    // Monaco's getWordUntilPosition strips the leading `@` (not a word char), so
    // the provider must reconstruct the `@fore` abbreviation from the line text.
    const result = await registered.bladeCompletionProvider.provideCompletionItems(
      model({
        content: source,
        lineContent: "@fore",
        path: "/project/resources/views/show.blade.php",
        word: { endColumn: 6, startColumn: 2, word: "fore" },
      }),
      { column: 6, lineNumber: 1 },
    );

    const snippet = result.suggestions.find(
      (item: any) =>
        item.kind === registered.monaco.languages.CompletionItemKind.Snippet &&
        item.label === "@foreach",
    );

    expect(snippet).toEqual(
      expect.objectContaining({
        insertTextRules:
          registered.monaco.languages.CompletionItemInsertTextRule
            .InsertAsSnippet,
        kind: registered.monaco.languages.CompletionItemKind.Snippet,
        label: "@foreach",
        range: expect.objectContaining({
          endColumn: 6,
          startColumn: 1,
        }),
      }),
    );
    expect(snippet.sortText.startsWith("2_")).toBe(true);
    expect(snippet.insertText).toContain("$");
  });

  it("does not offer blade snippets without a typed prefix", async () => {
    const registered = createRegisteredProviders();
    const source = "\n";
    const provideBladeCompletions = vi.fn(async () => []);
    const context = providerContext({
      activeDocument: bladeDocument(source),
      provideBladeCompletions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const result = await registered.bladeCompletionProvider.provideCompletionItems(
      model({
        content: source,
        lineContent: "",
        path: "/project/resources/views/show.blade.php",
        word: { endColumn: 1, startColumn: 1, word: "" },
      }),
      { column: 1, lineNumber: 1 },
    );

    expect(
      result.suggestions.some(
        (item: any) =>
          item.kind ===
          registered.monaco.languages.CompletionItemKind.Snippet,
      ),
    ).toBe(false);
  });

  it("returns no blade completions for a non-blade active document", async () => {
    const registered = createRegisteredProviders();
    const provideBladeCompletions = vi.fn(async () => [
      {
        insertText: "include",
        kind: "directive" as const,
        label: "@include",
      },
    ]);
    const context = providerContext({
      activeDocument: document(),
      provideBladeCompletions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const result = await registered.bladeCompletionProvider.provideCompletionItems(
      model({ content: "@inc", path: "/project/src/User.php" }),
      { column: 5, lineNumber: 1 },
    );

    expect(result.suggestions).toEqual([]);
    expect(provideBladeCompletions).not.toHaveBeenCalled();
  });

  it("drops blade completions when the workspace switches during resolution", async () => {
    const registered = createRegisteredProviders();
    const source = "@include('part')\n";
    let activeRoot = "/project";
    const provideBladeCompletions = vi.fn(async () => {
      activeRoot = "/other";
      return [
        {
          insertText: "partials.alert",
          kind: "view" as const,
          label: "partials.alert",
        },
      ];
    });
    const context = providerContext({
      activeDocument: bladeDocument(source),
      getWorkspaceRoot: () => activeRoot,
      provideBladeCompletions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const result = await registered.bladeCompletionProvider.provideCompletionItems(
      model({
        content: source,
        path: "/project/resources/views/show.blade.php",
      }),
      { column: 12, lineNumber: 1 },
    );

    expect(provideBladeCompletions).toHaveBeenCalledTimes(1);
    expect(result.suggestions).toEqual([]);
  });
});

describe("registerLanguageServerMonacoProviders latte providers", () => {
  it("registers latte definition and completion providers and disposes them", () => {
    const registered = createRegisteredProviders();
    const disposable = registerLanguageServerMonacoProviders(
      registered.monaco,
      providerContext(),
    );

    expect(registered.latteDefinitionLanguage).toBe("latte");
    expect(registered.latteCompletionLanguage).toBe("latte");
    expect(registered.latteCompletionProvider.triggerCharacters).toEqual([
      "{",
      "$",
      "-",
      ">",
      "|",
      "'",
      "\"",
      ".",
      "/",
    ]);

    disposable.dispose();

    expect(registered.latteDefinitionDispose).toHaveBeenCalled();
    expect(registered.latteCompletionDispose).toHaveBeenCalled();
  });

  it("delegates latte go-to-definition to the controller and returns null", async () => {
    const registered = createRegisteredProviders();
    const source = "{include 'partials/menu'}\n";
    const offset = source.indexOf("partials/menu");
    const provideLatteDefinition = vi.fn(async () => true);
    const context = providerContext({
      activeDocument: latteDocument(source),
      provideLatteDefinition,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.latteDefinitionProvider.provideDefinition(
        model({ content: source, path: "/project/app/UI/Home/default.latte" }),
        { column: offset + 1, lineNumber: 1 },
      ),
    ).resolves.toBeNull();
    expect(provideLatteDefinition).toHaveBeenCalledTimes(1);
    expect(provideLatteDefinition).toHaveBeenCalledWith(
      source,
      offset,
      expect.objectContaining({ canNavigate: expect.any(Function) }),
    );
  });

  it("does not call the latte definition callback for a non-latte active document", async () => {
    const registered = createRegisteredProviders();
    const provideLatteDefinition = vi.fn(async () => true);
    const context = providerContext({
      activeDocument: document(),
      provideLatteDefinition,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.latteDefinitionProvider.provideDefinition(
        model({ content: "{include 'x'}", path: "/project/src/User.php" }),
        { column: 1, lineNumber: 1 },
      ),
    ).resolves.toBeNull();
    expect(provideLatteDefinition).not.toHaveBeenCalled();
  });

  it("maps latte tag completions to keyword items", async () => {
    const registered = createRegisteredProviders();
    const source = "{for\n";
    const provideLatteCompletions = vi.fn(async () => [
      {
        detail: "Latte tag",
        insertText: "foreach",
        kind: "tag" as const,
        label: "foreach",
        replaceEnd: 4,
        replaceStart: 1,
      },
    ]);
    const context = providerContext({
      activeDocument: latteDocument(source),
      provideLatteCompletions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const result = await registered.latteCompletionProvider.provideCompletionItems(
      model({ content: source, path: "/project/app/UI/Home/default.latte" }),
      { column: 5, lineNumber: 1 },
    );

    expect(provideLatteCompletions).toHaveBeenCalledWith(source, {
      column: 5,
      lineNumber: 1,
    });
    expect(result.suggestions[0]).toEqual(
      expect.objectContaining({
        insertText: "foreach",
        kind: registered.monaco.languages.CompletionItemKind.Keyword,
        label: "foreach",
        range: {
          endColumn: 5,
          endLineNumber: 1,
          startColumn: 2,
          startLineNumber: 1,
        },
      }),
    );
  });

  it("maps latte template completions to file items", async () => {
    const registered = createRegisteredProviders();
    const source = "{include 'par'}\n";
    const provideLatteCompletions = vi.fn(async () => [
      {
        detail: "Latte template",
        insertText: "partials/menu.latte",
        kind: "template" as const,
        label: "partials/menu.latte",
        replaceEnd: source.indexOf("par") + "par".length,
        replaceStart: source.indexOf("par"),
      },
    ]);
    const context = providerContext({
      activeDocument: latteDocument(source),
      provideLatteCompletions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const result = await registered.latteCompletionProvider.provideCompletionItems(
      model({ content: source, path: "/project/app/UI/Home/default.latte" }),
      { column: source.indexOf("par") + 1, lineNumber: 1 },
    );

    expect(result.suggestions[0]).toEqual(
      expect.objectContaining({
        insertText: "partials/menu.latte",
        kind: registered.monaco.languages.CompletionItemKind.File,
        label: "partials/menu.latte",
      }),
    );
  });

  it("maps latte variable, member and filter completions to their Monaco kinds", async () => {
    const registered = createRegisteredProviders();
    const source = "{$invoice->}\n";
    const provideLatteCompletions = vi.fn(async () => [
      {
        detail: "presenter data",
        insertText: "$invoice",
        kind: "variable" as const,
        label: "$invoice",
      },
      {
        detail: "Invoice::getTotal(): float",
        insertText: "getTotal()",
        kind: "member" as const,
        label: "getTotal",
      },
      {
        detail: "Latte filter",
        insertText: "upper",
        kind: "filter" as const,
        label: "upper",
      },
    ]);
    const context = providerContext({
      activeDocument: latteDocument(source),
      provideLatteCompletions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const result = await registered.latteCompletionProvider.provideCompletionItems(
      model({ content: source, path: "/project/app/UI/Home/default.latte" }),
      { column: source.indexOf("->") + 3, lineNumber: 1 },
    );

    expect(
      result.suggestions.map((suggestion: { kind: number }) => suggestion.kind),
    ).toEqual([
      registered.monaco.languages.CompletionItemKind.Variable,
      registered.monaco.languages.CompletionItemKind.Field,
      registered.monaco.languages.CompletionItemKind.Function,
    ]);
  });

  it("does not call latte completions for a non-latte active document", async () => {
    const registered = createRegisteredProviders();
    const provideLatteCompletions = vi.fn(async () => []);
    const context = providerContext({
      activeDocument: document(),
      provideLatteCompletions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const result = await registered.latteCompletionProvider.provideCompletionItems(
      model({ content: "{for", path: "/project/src/User.php" }),
      { column: 5, lineNumber: 1 },
    );

    expect(provideLatteCompletions).not.toHaveBeenCalled();
    expect(result.suggestions).toEqual([]);
  });

  it("maps latte presenter-link completions to method items", async () => {
    const registered = createRegisteredProviders();
    const source = "{link P}\n";
    const provideLatteCompletions = vi.fn(async () => [
      {
        detail: "Nette presenter action",
        insertText: "Product:show",
        kind: "link" as const,
        label: "Product:show",
        replaceEnd: source.indexOf("P") + 1,
        replaceStart: source.indexOf("P"),
      },
    ]);
    const context = providerContext({
      activeDocument: latteDocument(source),
      provideLatteCompletions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const result = await registered.latteCompletionProvider.provideCompletionItems(
      model({ content: source, path: "/project/app/UI/Home/default.latte" }),
      { column: source.indexOf("P") + 2, lineNumber: 1 },
    );

    expect(result.suggestions[0]).toEqual(
      expect.objectContaining({
        insertText: "Product:show",
        kind: registered.monaco.languages.CompletionItemKind.Method,
        label: "Product:show",
      }),
    );
  });

  it("maps latte {control} component completions to module items", async () => {
    const registered = createRegisteredProviders();
    const source = "{control }\n";
    const provideLatteCompletions = vi.fn(async () => [
      {
        detail: "Nette component",
        insertText: "contactForm",
        kind: "component" as const,
        label: "contactForm",
        replaceEnd: source.indexOf("}"),
        replaceStart: source.indexOf("}"),
      },
    ]);
    const context = providerContext({
      activeDocument: latteDocument(source),
      provideLatteCompletions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const result = await registered.latteCompletionProvider.provideCompletionItems(
      model({ content: source, path: "/project/app/UI/Home/default.latte" }),
      { column: source.indexOf("}") + 1, lineNumber: 1 },
    );

    expect(result.suggestions[0]).toEqual(
      expect.objectContaining({
        insertText: "contactForm",
        kind: registered.monaco.languages.CompletionItemKind.Module,
        label: "contactForm",
      }),
    );
  });
});

describe("registerLanguageServerMonacoProviders neon providers", () => {
  it("registers neon definition and completion providers and disposes them", () => {
    const registered = createRegisteredProviders();
    const disposable = registerLanguageServerMonacoProviders(
      registered.monaco,
      providerContext(),
    );

    expect(registered.neonDefinitionLanguage).toBe("neon");
    expect(registered.neonCompletionLanguage).toBe("neon");
    expect(registered.neonCompletionProvider.triggerCharacters).toEqual([
      "\\",
      ":",
      " ",
      "-",
      "%",
      "@",
    ]);

    disposable.dispose();

    expect(registered.neonDefinitionDispose).toHaveBeenCalled();
    expect(registered.neonCompletionDispose).toHaveBeenCalled();
  });

  it("delegates neon go-to-definition to the controller and returns null", async () => {
    const registered = createRegisteredProviders();
    const source = "services:\n    router: App\\Router\\RouterFactory\n";
    const offset = source.indexOf("App\\Router\\RouterFactory") + 2;
    const provideNeonDefinition = vi.fn(async () => true);
    const context = providerContext({
      activeDocument: neonDocument(source),
      provideNeonDefinition,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.neonDefinitionProvider.provideDefinition(
        model({ content: source, path: "/project/config/services.neon" }),
        positionForOffset(source, offset),
      ),
    ).resolves.toBeNull();
    expect(provideNeonDefinition).toHaveBeenCalledWith(
      source,
      offset,
      expect.objectContaining({ canNavigate: expect.any(Function) }),
    );
  });

  it("does not call neon completions for a non-neon active document", async () => {
    const registered = createRegisteredProviders();
    const provideNeonCompletions = vi.fn(async () => []);
    const context = providerContext({
      activeDocument: document(),
      provideNeonCompletions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const result = await registered.neonCompletionProvider.provideCompletionItems(
      model({ content: "services:\n    - App\\", path: "/project/src/User.php" }),
      { column: 10, lineNumber: 2 },
    );

    expect(provideNeonCompletions).not.toHaveBeenCalled();
    expect(result.suggestions).toEqual([]);
  });

  it("maps neon class completions to class items", async () => {
    const registered = createRegisteredProviders();
    const source = "services:\n    - App\\";
    const provideNeonCompletions = vi.fn(async () => [
      {
        detail: "Nette service class",
        insertText: "App\\Model\\ProductRepository",
        kind: "class" as const,
        label: "App\\Model\\ProductRepository",
        replaceEnd: source.length,
        replaceStart: source.indexOf("App\\"),
      },
    ]);
    const context = providerContext({
      activeDocument: neonDocument(source),
      provideNeonCompletions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const result = await registered.neonCompletionProvider.provideCompletionItems(
      model({ content: source, path: "/project/config/services.neon" }),
      { column: source.length + 1, lineNumber: 2 },
    );

    expect(result.suggestions[0]).toEqual(
      expect.objectContaining({
        insertText: "App\\Model\\ProductRepository",
        kind: registered.monaco.languages.CompletionItemKind.Class,
        label: "App\\Model\\ProductRepository",
      }),
    );
  });

  it("maps neon parameter and service completions to their Monaco kinds", async () => {
    const registered = createRegisteredProviders();
    const source = "parameters:\n    dsn: %db\n";
    const provideNeonCompletions = vi.fn(async () => [
      {
        detail: "Nette parameter",
        insertText: "dbHost",
        kind: "parameter" as const,
        label: "dbHost",
      },
      {
        detail: "Nette service",
        insertText: "logger",
        kind: "service" as const,
        label: "logger",
      },
    ]);
    const context = providerContext({
      activeDocument: neonDocument(source),
      provideNeonCompletions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const result = await registered.neonCompletionProvider.provideCompletionItems(
      model({ content: source, path: "/project/config/services.neon" }),
      { column: source.indexOf("%db") + 4, lineNumber: 2 },
    );

    expect(result.suggestions[0]).toEqual(
      expect.objectContaining({
        insertText: "dbHost",
        kind: registered.monaco.languages.CompletionItemKind.Variable,
        label: "dbHost",
      }),
    );
    expect(result.suggestions[1]).toEqual(
      expect.objectContaining({
        insertText: "logger",
        kind: registered.monaco.languages.CompletionItemKind.Value,
        label: "logger",
      }),
    );
  });
});

describe("registerLanguageServerMonacoProviders PHP presenter-link definition", () => {
  it("delegates a PHP presenter link to the controller and skips phpactor", async () => {
    const registered = createRegisteredProviders();
    const source = "<?php\n$this->link('Product:show');\n";
    const offset = source.indexOf("Product:show") + 2;
    const providePhpPresenterLinkDefinition = vi.fn(async () => true);
    const definitionGateway = featuresGateway();
    const context = providerContext({
      activeDocument: document(),
      featuresGateway: definitionGateway,
      providePhpPresenterLinkDefinition,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.definitionProvider.provideDefinition(
        model({ content: source, path: "/project/src/User.php" }),
        positionForOffset(source, offset),
      ),
    ).resolves.toBeNull();
    expect(providePhpPresenterLinkDefinition).toHaveBeenCalledWith(
      source,
      offset,
      expect.objectContaining({ canNavigate: expect.any(Function) }),
    );
    expect(definitionGateway.definition).not.toHaveBeenCalled();
  });

  it("falls through to phpactor when the link callback does not handle the offset", async () => {
    const registered = createRegisteredProviders();
    const source = "<?php\n$this->products->get(1);\n";
    const providePhpPresenterLinkDefinition = vi.fn(async () => false);
    const definitionGateway = featuresGateway({ definition: [] });
    const context = providerContext({
      activeDocument: document(),
      featuresGateway: definitionGateway,
      providePhpPresenterLinkDefinition,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await registered.definitionProvider.provideDefinition(
      model({ content: source, path: "/project/src/User.php" }),
      { column: 1, lineNumber: 2 },
    );

    expect(providePhpPresenterLinkDefinition).toHaveBeenCalled();
    expect(definitionGateway.definition).toHaveBeenCalled();
  });
});

describe("registerLanguageServerMonacoProviders PHP presenter-link completion", () => {
  it("delegates $this->link('...') completion to the controller and skips phpactor", async () => {
    const registered = createRegisteredProviders();
    const source = "<?php\n$this->link('Pro');\n";
    const offset = source.indexOf("Pro") + 2;
    const isPhpPresenterLinkCompletionContext = vi.fn(() => true);
    const providePhpPresenterLinkCompletions = vi.fn(async () => [
      {
        detail: "Nette presenter action",
        insertText: "Product:show",
        kind: "link" as const,
        label: "Product:show",
        replaceEnd: source.indexOf("Pro") + "Pro".length,
        replaceStart: source.indexOf("Pro"),
      },
    ]);
    const gateway = featuresGateway();
    const context = providerContext({
      activeDocument: document(),
      featuresGateway: gateway,
      isPhpPresenterLinkCompletionContext,
      providePhpPresenterLinkCompletions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const result = await registered.completionProvider.provideCompletionItems(
      model({ content: source, path: "/project/src/User.php" }),
      positionForOffset(source, offset),
    );

    expect(providePhpPresenterLinkCompletions).toHaveBeenCalledWith(
      source,
      offset,
    );
    expect(isPhpPresenterLinkCompletionContext).toHaveBeenCalledWith(
      source,
      offset,
    );
    expect(gateway.completion).not.toHaveBeenCalled();
    expect(result.suggestions).toEqual([
      expect.objectContaining({
        insertText: "Product:show",
        kind: registered.monaco.languages.CompletionItemKind.Method,
        label: "Product:show",
      }),
    ]);
  });

  it("does not call the controller when the cursor is not on a link-call string argument", async () => {
    const registered = createRegisteredProviders();
    const source = phpCompletionFixtureSource();
    const isPhpPresenterLinkCompletionContext = vi.fn(() => false);
    const providePhpPresenterLinkCompletions = vi.fn(async () => []);
    const gateway = featuresGateway({
      completion: { isIncomplete: false, items: [] },
    });
    const context = providerContext({
      featuresGateway: gateway,
      isPhpPresenterLinkCompletionContext,
      providePhpPresenterLinkCompletions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await registered.completionProvider.provideCompletionItems(
      model({ content: source }),
      position(),
    );

    expect(isPhpPresenterLinkCompletionContext).toHaveBeenCalled();
    expect(providePhpPresenterLinkCompletions).not.toHaveBeenCalled();
    expect(gateway.completion).toHaveBeenCalled();
  });

  it("falls through to the regular pipeline when the host does not wire the completion callback", async () => {
    const registered = createRegisteredProviders();
    const source = "<?php\n$this->link('Pro');\n";
    const offset = source.indexOf("Pro") + 2;
    const gateway = featuresGateway({
      completion: { isIncomplete: false, items: [] },
    });
    const context = providerContext({ featuresGateway: gateway });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.completionProvider.provideCompletionItems(
        model({ content: source, path: "/project/src/User.php" }),
        positionForOffset(source, offset),
      ),
    ).resolves.toEqual({ suggestions: [] });
    expect(gateway.completion).toHaveBeenCalled();
  });

  it("falls through to phpactor when the presenter-link callback reports an inactive context", async () => {
    const registered = createRegisteredProviders();
    const source = "<?php\n$this->link('Pro');\n";
    const offset = source.indexOf("Pro") + 2;
    const providePhpPresenterLinkCompletions = vi.fn(async () => null);
    const gateway = featuresGateway({
      completion: { isIncomplete: false, items: [] },
    });
    const context = providerContext({
      featuresGateway: gateway,
      providePhpPresenterLinkCompletions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.completionProvider.provideCompletionItems(
        model({ content: source, path: "/project/src/User.php" }),
        positionForOffset(source, offset),
      ),
    ).resolves.toEqual({ suggestions: [] });
    expect(providePhpPresenterLinkCompletions).toHaveBeenCalledWith(
      source,
      offset,
    );
    expect(gateway.completion).toHaveBeenCalled();
  });

  it("keeps an empty presenter-link completion list authoritative when the context is active", async () => {
    const registered = createRegisteredProviders();
    const source = "<?php\n$this->link('Pro');\n";
    const offset = source.indexOf("Pro") + 2;
    const providePhpPresenterLinkCompletions = vi.fn(async () => []);
    const gateway = featuresGateway({
      completion: { isIncomplete: false, items: [] },
    });
    const context = providerContext({
      featuresGateway: gateway,
      providePhpPresenterLinkCompletions,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.completionProvider.provideCompletionItems(
        model({ content: source, path: "/project/src/User.php" }),
        positionForOffset(source, offset),
      ),
    ).resolves.toEqual({ suggestions: [] });
    expect(providePhpPresenterLinkCompletions).toHaveBeenCalledWith(
      source,
      offset,
    );
    expect(gateway.completion).not.toHaveBeenCalled();
  });

  it("reports an error from the completion callback without falling back to phpactor", async () => {
    const registered = createRegisteredProviders();
    const source = "<?php\n$this->link('Pro');\n";
    const offset = source.indexOf("Pro") + 2;
    const failure = new Error("presenter-link completion failed");
    const providePhpPresenterLinkCompletions = vi.fn(async () => {
      throw failure;
    });
    const reportError = vi.fn();
    const gateway = featuresGateway();
    const context = providerContext({
      featuresGateway: gateway,
      providePhpPresenterLinkCompletions,
      reportError,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    await expect(
      registered.completionProvider.provideCompletionItems(
        model({ content: source, path: "/project/src/User.php" }),
        positionForOffset(source, offset),
      ),
    ).resolves.toEqual({ suggestions: [] });
    expect(reportError).toHaveBeenCalledWith(failure);
    expect(gateway.completion).not.toHaveBeenCalled();
  });

  it("drops a stale presenter-link completion result when no project tab is active", async () => {
    const registered = createRegisteredProviders();
    const source = "<?php\n$this->link('Pro');\n";
    const offset = source.indexOf("Pro") + 2;
    let activeRoot: string | null = "/project";
    const completion = createDeferred<
      Array<{
        detail?: string;
        insertText: string;
        kind: "link";
        label: string;
        replaceEnd: number;
        replaceStart: number;
      }>
    >();
    const providePhpPresenterLinkCompletions = vi.fn(
      async () => completion.promise,
    );
    const reportError = vi.fn();
    const gateway = featuresGateway();
    const context = providerContext({
      featuresGateway: gateway,
      getWorkspaceRoot: () => activeRoot,
      providePhpPresenterLinkCompletions,
      reportError,
    });
    registerLanguageServerMonacoProviders(registered.monaco, context);

    const completionPromise =
      registered.completionProvider.provideCompletionItems(
        model({ content: source, path: "/project/src/User.php" }),
        positionForOffset(source, offset),
      );

    activeRoot = null;
    completion.resolve([
      {
        detail: "Nette presenter action",
        insertText: "Product:show",
        kind: "link",
        label: "Product:show",
        replaceEnd: source.indexOf("Pro") + "Pro".length,
        replaceStart: source.indexOf("Pro"),
      },
    ]);

    await expect(completionPromise).resolves.toEqual({ suggestions: [] });
    expect(reportError).not.toHaveBeenCalled();
  });
});

function positionForOffset(source: string, offset: number) {
  const before = source.slice(0, offset);
  const lineNumber = before.split("\n").length;
  const lineStart = before.lastIndexOf("\n") + 1;

  return { column: offset - lineStart + 1, lineNumber };
}

function createRegisteredProviders() {
  const bladeDefinitionDispose = vi.fn();
  const bladeCompletionDispose = vi.fn();
  const latteDefinitionDispose = vi.fn();
  const latteCompletionDispose = vi.fn();
  const neonDefinitionDispose = vi.fn();
  const neonCompletionDispose = vi.fn();
  const bladeCodeActionDispose = vi.fn();
  const codeActionDispose = vi.fn();
  const codeLensDispose = vi.fn();
  const commandDispose = vi.fn();
  const declarationDispose = vi.fn();
  const definitionDispose = vi.fn();
  const documentHighlightDispose = vi.fn();
  const documentLinkDispose = vi.fn();
  const documentSemanticTokensDispose = vi.fn();
  const documentSymbolDispose = vi.fn();
  const workspaceSymbolDispose = vi.fn();
  const documentFormattingDispose = vi.fn();
  const foldingRangeDispose = vi.fn();
  const hoverDispose = vi.fn();
  const implementationDispose = vi.fn();
  const inlayHintsDispose = vi.fn();
  const linkedEditingRangeDispose = vi.fn();
  const onTypeFormattingDispose = vi.fn();
  const rangeFormattingDispose = vi.fn();
  const rangeSemanticTokensDispose = vi.fn();
  const referenceDispose = vi.fn();
  const completionDispose = vi.fn();
  const renameDispose = vi.fn();
  const selectionRangeDispose = vi.fn();
  const signatureDispose = vi.fn();
  const typeDefinitionDispose = vi.fn();
  const registered: {
    bladeCompletionDispose: ReturnType<typeof vi.fn>;
    bladeCompletionLanguage: string | null;
    bladeCompletionProvider: any;
    bladeCodeActionDispose: ReturnType<typeof vi.fn>;
    bladeCodeActionLanguage: string | null;
    bladeCodeActionMetadata: any;
    bladeCodeActionProvider: any;
    bladeDefinitionDispose: ReturnType<typeof vi.fn>;
    bladeDefinitionLanguage: string | null;
    bladeDefinitionProvider: any;
    latteCompletionDispose: ReturnType<typeof vi.fn>;
    latteCompletionLanguage: string | null;
    latteCompletionProvider: any;
    latteCodeActionDispose: ReturnType<typeof vi.fn>;
    latteCodeActionLanguage: string | null;
    latteCodeActionMetadata: any;
    latteCodeActionProvider: any;
    latteDefinitionDispose: ReturnType<typeof vi.fn>;
    latteDefinitionLanguage: string | null;
    latteDefinitionProvider: any;
    neonCompletionDispose: ReturnType<typeof vi.fn>;
    neonCompletionLanguage: string | null;
    neonCompletionProvider: any;
    neonDefinitionDispose: ReturnType<typeof vi.fn>;
    neonDefinitionLanguage: string | null;
    neonDefinitionProvider: any;
    codeActionDispose: ReturnType<typeof vi.fn>;
    codeActionLanguage: string | null;
    codeActionMetadata: any;
    codeActionProvider: any;
    codeLensDispose: ReturnType<typeof vi.fn>;
    codeLensLanguage: string | null;
    codeLensProvider: any;
    commandDispose: ReturnType<typeof vi.fn>;
    commandRun: ((accessor: unknown, payload?: unknown) => unknown) | null;
    commandRunsById: Record<
      string,
      (accessor: unknown, payload?: unknown) => unknown
    >;
    completionDispose: ReturnType<typeof vi.fn>;
    completionLanguage: string | null;
    completionProvider: any;
    declarationDispose: ReturnType<typeof vi.fn>;
    declarationLanguage: string | null;
    declarationProvider: any;
    definitionDispose: ReturnType<typeof vi.fn>;
    definitionLanguage: string | null;
    definitionProvider: any;
    documentHighlightDispose: ReturnType<typeof vi.fn>;
    documentHighlightLanguage: string | null;
    documentHighlightProvider: any;
    documentLinkDispose: ReturnType<typeof vi.fn>;
    documentLinkLanguage: string | null;
    documentLinkProvider: any;
    documentSemanticTokensDispose: ReturnType<typeof vi.fn>;
    documentSemanticTokensLanguage: string | null;
    documentSemanticTokensProvider: any;
    documentSymbolDispose: ReturnType<typeof vi.fn>;
    documentSymbolLanguage: string | null;
    documentSymbolProvider: any;
    workspaceSymbolDispose: ReturnType<typeof vi.fn>;
    workspaceSymbolProvider: any;
    documentFormattingDispose: ReturnType<typeof vi.fn>;
    documentFormattingLanguage: string | null;
    documentFormattingProvider: any;
    foldingRangeDispose: ReturnType<typeof vi.fn>;
    foldingRangeLanguage: string | null;
    foldingRangeProvider: any;
    hoverDispose: ReturnType<typeof vi.fn>;
    hoverLanguage: string | null;
    hoverProvider: any;
    implementationDispose: ReturnType<typeof vi.fn>;
    implementationLanguage: string | null;
    implementationProvider: any;
    inlayHintsDispose: ReturnType<typeof vi.fn>;
    inlayHintsLanguage: string | null;
    inlayHintsProvider: any;
    linkedEditingRangeDispose: ReturnType<typeof vi.fn>;
    linkedEditingRangeLanguage: string | null;
    linkedEditingRangeProvider: any;
    monaco: any;
    onTypeFormattingDispose: ReturnType<typeof vi.fn>;
    onTypeFormattingLanguage: string | null;
    onTypeFormattingProvider: any;
    rangeFormattingDispose: ReturnType<typeof vi.fn>;
    rangeFormattingLanguage: string | null;
    rangeFormattingProvider: any;
    rangeSemanticTokensDispose: ReturnType<typeof vi.fn>;
    rangeSemanticTokensLanguage: string | null;
    rangeSemanticTokensProvider: any;
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
    bladeCompletionDispose,
    bladeCompletionLanguage: null,
    bladeCompletionProvider: null,
    bladeCodeActionDispose,
    bladeCodeActionLanguage: null,
    bladeCodeActionMetadata: null,
    bladeCodeActionProvider: null,
    bladeDefinitionDispose,
    bladeDefinitionLanguage: null,
    bladeDefinitionProvider: null,
    latteCompletionDispose,
    latteCompletionLanguage: null,
    latteCompletionProvider: null,
    latteCodeActionDispose: vi.fn(),
    latteCodeActionLanguage: null,
    latteCodeActionMetadata: null,
    latteCodeActionProvider: null,
    latteDefinitionDispose,
    latteDefinitionLanguage: null,
    latteDefinitionProvider: null,
    neonCompletionDispose,
    neonCompletionLanguage: null,
    neonCompletionProvider: null,
    neonDefinitionDispose,
    neonDefinitionLanguage: null,
    neonDefinitionProvider: null,
    codeActionDispose,
    codeActionLanguage: null,
    codeActionMetadata: null,
    codeActionProvider: null,
    codeLensDispose,
    codeLensLanguage: null,
    codeLensProvider: null,
    commandDispose,
    commandRun: null,
    commandRunsById: {},
    completionDispose,
    completionLanguage: null,
    completionProvider: null,
    declarationDispose,
    declarationLanguage: null,
    declarationProvider: null,
    definitionDispose,
    definitionLanguage: null,
    definitionProvider: null,
    documentHighlightDispose,
    documentHighlightLanguage: null,
    documentHighlightProvider: null,
    documentLinkDispose,
    documentLinkLanguage: null,
    documentLinkProvider: null,
    documentSemanticTokensDispose,
    documentSemanticTokensLanguage: null,
    documentSemanticTokensProvider: null,
    documentSymbolDispose,
    documentSymbolLanguage: null,
    documentSymbolProvider: null,
    workspaceSymbolDispose,
    workspaceSymbolProvider: null,
    documentFormattingDispose,
    documentFormattingLanguage: null,
    documentFormattingProvider: null,
    foldingRangeDispose,
    foldingRangeLanguage: null,
    foldingRangeProvider: null,
    hoverDispose,
    hoverLanguage: null,
    hoverProvider: null,
    implementationDispose,
    implementationLanguage: null,
    implementationProvider: null,
    inlayHintsDispose,
    inlayHintsLanguage: null,
    inlayHintsProvider: null,
    linkedEditingRangeDispose,
    linkedEditingRangeLanguage: null,
    linkedEditingRangeProvider: null,
    monaco: null,
    onTypeFormattingDispose,
    onTypeFormattingLanguage: null,
    onTypeFormattingProvider: null,
    rangeFormattingDispose,
    rangeFormattingLanguage: null,
    rangeFormattingProvider: null,
    rangeSemanticTokensDispose,
    rangeSemanticTokensLanguage: null,
    rangeSemanticTokensProvider: null,
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
        registered.commandRunsById[command.id] = command.run;
        // Keep `commandRun` pointing at the LSP execute-command run so the
        // existing execute-command tests stay valid even though a second command
        // (the new-file disk-write command) is now registered too.
        if (command.id === "mockor.php.executeLanguageServerCommand") {
          registered.commandRun = command.run;
        }
        return { dispose: commandDispose };
      }),
      getModel: vi.fn(() => null),
      getModels: vi.fn(() => []),
    },
    languages: {
      CodeActionTriggerType: { Invoke: 1 },
      CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
      CompletionItemKind: {
        Class: 7,
        Constant: 21,
        Event: 23,
        Field: 5,
        File: 17,
        Function: 3,
        Interface: 8,
        Keyword: 18,
        Method: 2,
        Property: 10,
        Snippet: 27,
        Text: 1,
        Value: 12,
        Variable: 6,
      },
      DocumentHighlightKind: {
        Read: 2,
        Text: 1,
        Write: 3,
      },
      FoldingRangeKind: {
        fromValue: vi.fn((value) => ({ value })),
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
      registerCodeActionProvider: vi.fn((language, provider, metadata) => {
        if (language === "blade") {
          registered.bladeCodeActionLanguage = language;
          registered.bladeCodeActionProvider = provider;
          registered.bladeCodeActionMetadata = metadata;
          return { dispose: bladeCodeActionDispose };
        }

        if (language === "latte") {
          registered.latteCodeActionLanguage = language;
          registered.latteCodeActionProvider = provider;
          registered.latteCodeActionMetadata = metadata;
          return { dispose: registered.latteCodeActionDispose };
        }

        registered.codeActionLanguage = language;
        registered.codeActionProvider = provider;
        registered.codeActionMetadata = metadata;
        return { dispose: codeActionDispose };
      }),
      registerCodeLensProvider: vi.fn((language, provider) => {
        registered.codeLensLanguage = language;
        registered.codeLensProvider = provider;
        return { dispose: codeLensDispose };
      }),
      registerCompletionItemProvider: vi.fn((language, provider) => {
        if (language === "blade") {
          registered.bladeCompletionLanguage = language;
          registered.bladeCompletionProvider = provider;
          return { dispose: bladeCompletionDispose };
        }

        if (language === "latte") {
          registered.latteCompletionLanguage = language;
          registered.latteCompletionProvider = provider;
          return { dispose: latteCompletionDispose };
        }

        if (language === "neon") {
          registered.neonCompletionLanguage = language;
          registered.neonCompletionProvider = provider;
          return { dispose: neonCompletionDispose };
        }

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
        if (language === "blade") {
          registered.bladeDefinitionLanguage = language;
          registered.bladeDefinitionProvider = provider;
          return { dispose: bladeDefinitionDispose };
        }

        if (language === "latte") {
          registered.latteDefinitionLanguage = language;
          registered.latteDefinitionProvider = provider;
          return { dispose: latteDefinitionDispose };
        }

        if (language === "neon") {
          registered.neonDefinitionLanguage = language;
          registered.neonDefinitionProvider = provider;
          return { dispose: neonDefinitionDispose };
        }

        registered.definitionLanguage = language;
        registered.definitionProvider = provider;
        return { dispose: definitionDispose };
      }),
      registerDocumentHighlightProvider: vi.fn((language, provider) => {
        registered.documentHighlightLanguage = language;
        registered.documentHighlightProvider = provider;
        return { dispose: documentHighlightDispose };
      }),
      registerDocumentFormattingEditProvider: vi.fn((language, provider) => {
        registered.documentFormattingLanguage = language;
        registered.documentFormattingProvider = provider;
        return { dispose: documentFormattingDispose };
      }),
      registerDocumentRangeFormattingEditProvider: vi.fn((language, provider) => {
        registered.rangeFormattingLanguage = language;
        registered.rangeFormattingProvider = provider;
        return { dispose: rangeFormattingDispose };
      }),
      registerDocumentRangeSemanticTokensProvider: vi.fn((language, provider) => {
        registered.rangeSemanticTokensLanguage = language;
        registered.rangeSemanticTokensProvider = provider;
        return { dispose: rangeSemanticTokensDispose };
      }),
      registerDocumentSemanticTokensProvider: vi.fn((language, provider) => {
        registered.documentSemanticTokensLanguage = language;
        registered.documentSemanticTokensProvider = provider;
        return { dispose: documentSemanticTokensDispose };
      }),
      registerDocumentSymbolProvider: vi.fn((language, provider) => {
        registered.documentSymbolLanguage = language;
        registered.documentSymbolProvider = provider;
        return { dispose: documentSymbolDispose };
      }),
      registerWorkspaceSymbolProvider: vi.fn((provider) => {
        registered.workspaceSymbolProvider = provider;
        return { dispose: workspaceSymbolDispose };
      }),
      registerLinkProvider: vi.fn((language, provider) => {
        registered.documentLinkLanguage = language;
        registered.documentLinkProvider = provider;
        return { dispose: documentLinkDispose };
      }),
      registerFoldingRangeProvider: vi.fn((language, provider) => {
        registered.foldingRangeLanguage = language;
        registered.foldingRangeProvider = provider;
        return { dispose: foldingRangeDispose };
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
      registerInlayHintsProvider: vi.fn((language, provider) => {
        registered.inlayHintsLanguage = language;
        registered.inlayHintsProvider = provider;
        return { dispose: inlayHintsDispose };
      }),
      registerLinkedEditingRangeProvider: vi.fn((language, provider) => {
        registered.linkedEditingRangeLanguage = language;
        registered.linkedEditingRangeProvider = provider;
        return { dispose: linkedEditingRangeDispose };
      }),
      registerOnTypeFormattingEditProvider: vi.fn((language, provider) => {
        registered.onTypeFormattingLanguage = language;
        registered.onTypeFormattingProvider = provider;
        return { dispose: onTypeFormattingDispose };
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
    applyPhpCodeActionNewFile: NonNullable<
      Parameters<typeof registerLanguageServerMonacoProviders>[1]["applyPhpCodeActionNewFile"]
    >;
    applyWorkspaceEdit: NonNullable<
      Parameters<typeof registerLanguageServerMonacoProviders>[1]["applyWorkspaceEdit"]
    >;
    clearLanguageServerDiagnosticsForPath: NonNullable<
      Parameters<typeof registerLanguageServerMonacoProviders>[1]["clearLanguageServerDiagnosticsForPath"]
    >;
    featuresGateway: LanguageServerFeaturesGateway;
    flushPendingDocumentChange(path: string): Promise<void>;
    getLargeSmartDocumentPolicy(): { characterLimit: number; lineLimit: number };
    getWorkspaceRoot(): string | null;
    getRuntimeStatus(): LanguageServerRuntimeStatus | null;
    getUserSnippets(): UserSnippet[];
    isDocumentSynced(rootPath: string, path: string): boolean;
    isPhpInlayHintsEnabled(): boolean;
    limitNavigationResultsToOpenModels: boolean;
    provideBladeCompletions: ReturnType<
      Parameters<typeof registerLanguageServerMonacoProviders>[1]["getTemplateLanguageProviders"]
    >["blade"]["provideCompletions"];
    provideBladeCodeActions: ReturnType<
      Parameters<typeof registerLanguageServerMonacoProviders>[1]["getTemplateLanguageProviders"]
    >["blade"]["provideCodeActions"];
    provideBladeDefinition: ReturnType<
      Parameters<typeof registerLanguageServerMonacoProviders>[1]["getTemplateLanguageProviders"]
    >["blade"]["provideDefinition"];
    provideLatteCompletions: ReturnType<
      Parameters<typeof registerLanguageServerMonacoProviders>[1]["getTemplateLanguageProviders"]
    >["latte"]["provideCompletions"];
    provideLatteCodeActions: ReturnType<
      Parameters<typeof registerLanguageServerMonacoProviders>[1]["getTemplateLanguageProviders"]
    >["latte"]["provideCodeActions"];
    provideLatteDefinition: ReturnType<
      Parameters<typeof registerLanguageServerMonacoProviders>[1]["getTemplateLanguageProviders"]
    >["latte"]["provideDefinition"];
    provideNeonCompletions: ReturnType<
      Parameters<typeof registerLanguageServerMonacoProviders>[1]["getTemplateLanguageProviders"]
    >["neon"]["provideCompletions"];
    provideNeonDefinition: ReturnType<
      Parameters<typeof registerLanguageServerMonacoProviders>[1]["getTemplateLanguageProviders"]
    >["neon"]["provideDefinition"];
    providePhpPresenterLinkCompletions: NonNullable<
      Parameters<typeof registerLanguageServerMonacoProviders>[1]["providePhpPresenterLinkCompletions"]
    >;
    providePhpPresenterLinkDefinition: NonNullable<
      Parameters<typeof registerLanguageServerMonacoProviders>[1]["providePhpPresenterLinkDefinition"]
    >;
    isPhpPresenterLinkCompletionContext: NonNullable<
      Parameters<typeof registerLanguageServerMonacoProviders>[1]["isPhpPresenterLinkCompletionContext"]
    >;
    isPhpFrameworkStringCompletionContext: NonNullable<
      Parameters<typeof registerLanguageServerMonacoProviders>[1]["isPhpFrameworkStringCompletionContext"]
    >;
    providePhpCodeActions: NonNullable<
      Parameters<typeof registerLanguageServerMonacoProviders>[1]["providePhpCodeActions"]
    >;
    providePhpFrameworkDefinition: NonNullable<
      Parameters<typeof registerLanguageServerMonacoProviders>[1]["providePhpFrameworkDefinition"]
    >;
    providePhpMethodCompletions: NonNullable<
      Parameters<typeof registerLanguageServerMonacoProviders>[1]["providePhpMethodCompletions"]
    >;
    providePhpMethodSignature: NonNullable<
      Parameters<typeof registerLanguageServerMonacoProviders>[1]["providePhpMethodSignature"]
    >;
    providePhpParameterInlayHints: NonNullable<
      Parameters<typeof registerLanguageServerMonacoProviders>[1]["providePhpParameterInlayHints"]
    >;
    reportError(error: unknown): void;
    refreshGateway: LanguageServerRefreshGateway;
    runtimeStatus: LanguageServerRuntimeStatus | null;
    workspaceEditGateway: LanguageServerWorkspaceEditGateway;
  }> = {},
) {
  const activeDocument = overrides.activeDocument ?? document();
  const runtimeStatus = overrides.runtimeStatus ?? runningStatus();

  return {
    applyPhpCodeActionNewFile: overrides.applyPhpCodeActionNewFile,
    applyWorkspaceEdit: overrides.applyWorkspaceEdit,
    clearLanguageServerDiagnosticsForPath:
      overrides.clearLanguageServerDiagnosticsForPath,
    featuresGateway: overrides.featuresGateway ?? featuresGateway(),
    flushPendingDocumentChange:
      overrides.flushPendingDocumentChange ?? vi.fn(async () => undefined),
    getActiveDocument: () => activeDocument,
    getLargeSmartDocumentPolicy: overrides.getLargeSmartDocumentPolicy,
    getRuntimeStatus: overrides.getRuntimeStatus ?? (() => runtimeStatus),
    getTemplateLanguageProviders: () => ({
      blade: {
        provideCodeActions:
          overrides.provideBladeCodeActions ?? (async () => []),
        provideCompletions:
          overrides.provideBladeCompletions ?? (async () => []),
        provideDefinition:
          overrides.provideBladeDefinition ?? (async () => false),
      },
      latte: {
        provideCodeActions:
          overrides.provideLatteCodeActions ?? (async () => []),
        provideCompletions:
          overrides.provideLatteCompletions ?? (async () => []),
        provideDefinition:
          overrides.provideLatteDefinition ?? (async () => false),
      },
      neon: {
        provideCompletions:
          overrides.provideNeonCompletions ?? (async () => []),
        provideDefinition:
          overrides.provideNeonDefinition ?? (async () => false),
      },
    }),
    getUserSnippets: overrides.getUserSnippets,
    getWorkspaceRoot: overrides.getWorkspaceRoot ?? (() => "/project"),
    isDocumentSynced: overrides.isDocumentSynced,
    isPhpInlayHintsEnabled: overrides.isPhpInlayHintsEnabled,
    limitNavigationResultsToOpenModels:
      overrides.limitNavigationResultsToOpenModels,
    providePhpPresenterLinkCompletions:
      overrides.providePhpPresenterLinkCompletions,
    providePhpPresenterLinkDefinition:
      overrides.providePhpPresenterLinkDefinition,
    isPhpPresenterLinkCompletionContext:
      overrides.isPhpPresenterLinkCompletionContext,
    isPhpFrameworkStringCompletionContext:
      overrides.isPhpFrameworkStringCompletionContext ??
      ((source, position) =>
        phpFrameworkScopedStringCompletionContextAt(source, position, [
          phpLaravelFrameworkProvider,
        ])),
    providePhpCodeActions: overrides.providePhpCodeActions,
    providePhpFrameworkDefinition: overrides.providePhpFrameworkDefinition,
    providePhpMethodCompletions: overrides.providePhpMethodCompletions,
    providePhpMethodSignature: overrides.providePhpMethodSignature,
    providePhpParameterInlayHints: overrides.providePhpParameterInlayHints,
    refreshGateway: overrides.refreshGateway,
    reportError: overrides.reportError ?? vi.fn(),
    workspaceEditGateway: overrides.workspaceEditGateway,
  };
}

function templateRegistry({
  provideBladeCompletions = async () => [],
}: {
  provideBladeCompletions?: ReturnType<
    Parameters<typeof registerLanguageServerMonacoProviders>[1]["getTemplateLanguageProviders"]
  >["blade"]["provideCompletions"];
} = {}) {
  return {
    blade: {
      provideCodeActions: async () => [],
      provideCompletions: provideBladeCompletions,
      provideDefinition: async () => false,
    },
    latte: {
      provideCodeActions: async () => [],
      provideCompletions: async () => [],
      provideDefinition: async () => false,
    },
    neon: {
      provideCompletions: async () => [],
      provideDefinition: async () => false,
    },
  };
}

function featuresGateway(
  responses: Partial<{
    codeActions: Awaited<
      ReturnType<LanguageServerFeaturesGateway["codeActions"]>
    >;
    codeLenses: Awaited<
      ReturnType<LanguageServerFeaturesGateway["codeLenses"]>
    >;
    completion: LanguageServerCompletionList;
    declaration: LanguageServerLocation[];
    definition: LanguageServerLocation[];
    documentHighlights: LanguageServerDocumentHighlight[];
    documentLinks: LanguageServerDocumentLink[];
    documentSymbols: Awaited<
      ReturnType<LanguageServerFeaturesGateway["documentSymbols"]>
    >;
    foldingRanges: Awaited<
      ReturnType<LanguageServerFeaturesGateway["foldingRanges"]>
    >;
    formatting: Awaited<ReturnType<LanguageServerFeaturesGateway["formatting"]>>;
    hover: LanguageServerHover | null;
    implementation: LanguageServerLocation[];
    inlayHints: Awaited<ReturnType<LanguageServerFeaturesGateway["inlayHints"]>>;
    linkedEditingRanges: Awaited<
      ReturnType<LanguageServerFeaturesGateway["linkedEditingRanges"]>
    >;
    onTypeFormatting: Awaited<
      ReturnType<LanguageServerFeaturesGateway["onTypeFormatting"]>
    >;
    prepareRename: Awaited<
      ReturnType<LanguageServerFeaturesGateway["prepareRename"]>
    >;
    rangeFormatting: Awaited<
      ReturnType<LanguageServerFeaturesGateway["rangeFormatting"]>
    >;
    rangeSemanticTokens: Awaited<
      ReturnType<LanguageServerFeaturesGateway["rangeSemanticTokens"]>
    >;
    references: LanguageServerLocation[];
    resolvedCodeAction: Awaited<
      ReturnType<LanguageServerFeaturesGateway["resolveCodeAction"]>
    >;
    resolvedCodeLens: Awaited<
      ReturnType<LanguageServerFeaturesGateway["resolveCodeLens"]>
    >;
    resolvedDocumentLink: Awaited<
      ReturnType<LanguageServerFeaturesGateway["resolveDocumentLink"]>
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
    typeDefinition: LanguageServerLocation[];
    workspaceSymbols: Awaited<
      ReturnType<LanguageServerFeaturesGateway["workspaceSymbols"]>
    >;
  }> = {},
): LanguageServerFeaturesGateway {
  return {
    codeActions: vi.fn(async () => responses.codeActions ?? []),
    codeLenses: vi.fn(async () => responses.codeLenses ?? []),
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
    didCreateFiles: vi.fn(async () => undefined),
    didDeleteFiles: vi.fn(async () => undefined),
    didRenameFiles: vi.fn(async () => undefined),
    documentHighlights: vi.fn(async () => responses.documentHighlights ?? []),
    documentLinks: vi.fn(async () => responses.documentLinks ?? []),
    documentSymbols: vi.fn(async () => responses.documentSymbols ?? []),
    executeCommand: vi.fn(async () => null),
    executeCommandLocations: vi.fn(async () => []),
    foldingRanges: vi.fn(async () => responses.foldingRanges ?? []),
    formatting: vi.fn(async () => responses.formatting ?? []),
    hover: vi.fn(async () => responses.hover ?? null),
    incomingCalls: vi.fn(async () => []),
    implementation: vi.fn(async () => responses.implementation ?? []),
    inlayHints: vi.fn(async () => responses.inlayHints ?? []),
    resolveInlayHint: vi.fn(async (_rootPath, hint) => hint),
    linkedEditingRanges: vi.fn(async () => responses.linkedEditingRanges ?? null),
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
    resolveCompletionItem: vi.fn(async (_rootPath, item) => item),
    resolveCodeAction: vi.fn(
      async (_rootPath, action) => responses.resolvedCodeAction ?? action,
    ),
    resolveCodeLens: vi.fn(
      async (_rootPath, lens) => responses.resolvedCodeLens ?? lens,
    ),
    resolveDocumentLink: vi.fn(
      async (_rootPath, link) => responses.resolvedDocumentLink ?? link,
    ),
  };
}

function backedCodeLens(lens: LanguageServerCodeLens) {
  return {
    __languageServerLens: lens,
    __languageServerSessionId: 1,
    __sourcePath: "/project/src/User.php",
    __workspaceRoot: "/project",
    range: {
      endColumn: lens.range.end.character + 1,
      endLineNumber: lens.range.end.line + 1,
      startColumn: lens.range.start.character + 1,
      startLineNumber: lens.range.start.line + 1,
    },
  };
}

function backedInlayHint(hint: LanguageServerInlayHint) {
  const backedHint = {
    label: hint.label,
    paddingLeft: hint.paddingLeft,
    paddingRight: hint.paddingRight,
    position: {
      column: hint.position.character + 1,
      lineNumber: hint.position.line + 1,
    },
    ...(hint.kind === 1 ? { kind: 1 } : {}),
    ...(hint.kind === 2 ? { kind: 2 } : {}),
    tooltip: hint.tooltip ?? undefined,
  };

  Object.defineProperties(backedHint, {
    __languageServerInlayHint: {
      value: hint,
    },
    __languageServerSessionId: {
      value: 1,
    },
    __sourcePath: {
      value: "/project/src/User.php",
    },
    __workspaceRoot: {
      value: "/project",
    },
  });

  return backedHint;
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

function bladeDocument(content: string): EditorDocument {
  return {
    content,
    language: "blade",
    name: "show.blade.php",
    path: "/project/resources/views/show.blade.php",
    savedContent: content,
  };
}

function latteDocument(content: string): EditorDocument {
  return {
    content,
    language: "latte",
    name: "default.latte",
    path: "/project/app/UI/Home/default.latte",
    savedContent: content,
  };
}

function neonDocument(content: string): EditorDocument {
  return {
    content,
    language: "neon",
    name: "services.neon",
    path: "/project/config/services.neon",
    savedContent: content,
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
    getPositionAt: vi.fn((offset: number) => {
      const source = overrides.content ?? "";
      const clamped = Math.max(0, Math.min(offset, source.length));
      const before = source.slice(0, clamped);
      const lineNumber = before.split("\n").length;
      const lineStart = before.lastIndexOf("\n") + 1;

      return { column: clamped - lineStart + 1, lineNumber };
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

function phpactorCreateTypeAction(title: string): LanguageServerCodeAction {
  return {
    command: {
      arguments: [],
      command: "phpactor.class_new",
      title,
    },
    data: { id: title },
    edit: {
      changes: {},
      fileOperations: [
        { kind: "create", uri: "file:///project/src/MailDispatcher.php" },
      ],
    },
    isPreferred: false,
    kind: "quickfix",
    title,
  };
}

function phpactorCreateMemberAction(title: string): LanguageServerCodeAction {
  return {
    command: {
      arguments: [],
      command: "phpactor.create_member",
      title,
    },
    data: { id: title },
    edit: {
      changes: {},
    },
    isPreferred: false,
    kind: "quickfix",
    title,
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
