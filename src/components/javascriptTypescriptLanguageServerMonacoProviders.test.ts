import { describe, expect, it, vi } from "vitest";
import { URI } from "monaco-editor/esm/vs/base/common/uri.js";
import type {
  JavaScriptTypeScriptLanguageServerFeaturesGateway as LanguageServerFeaturesGateway,
  LanguageServerLocation,
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
import { defaultLargeSmartDocumentPolicy } from "../domain/largeDocumentPolicy";
import { MAX_DOCUMENT_HIGHLIGHT_RESULTS } from "../domain/documentHighlightRequestTracker";
import {
  MAX_LINKED_EDITING_RANGES,
  MAX_LINKED_EDITING_WORD_PATTERN_UTF8_BYTES,
} from "../domain/linkedEditingRangesPolicy";
import {
  MAX_CODE_ACTION_DIAGNOSTICS,
  MAX_CODE_ACTION_ITEM_UTF8_BYTES,
  MAX_CODE_ACTION_RESULTS,
} from "../domain/codeActionProjection";
import {
  MAX_WORKSPACE_SYMBOL_RESULTS,
  WORKSPACE_SYMBOL_REQUEST_TIMEOUT_MS,
} from "../domain/workspaceSymbolProjection";
import {
  registerJavaScriptTypeScriptLanguageServerMonacoProviders,
  type JavaScriptTypeScriptWorkspaceEditApplicationContext,
  type JavaScriptTypeScriptLanguageServerProviderContext,
} from "./javascriptTypescriptLanguageServerMonacoProviders";
import { attachStoredJavaScriptTypeScriptDocumentAuthority } from "./javascriptTypescriptProviderDocumentAuthority";
import {
  CODE_ACTION_REQUEST_TIMEOUT_MS,
  CODE_ACTION_RESOLVE_REQUEST_TIMEOUT_MS,
  DOCUMENT_HIGHLIGHT_REQUEST_TIMEOUT_MS,
  LINKED_EDITING_RANGE_REQUEST_TIMEOUT_MS,
} from "./languageServerRequestCancellation";
import { workspaceModelUri } from "./phpMonacoDocumentContext";
import { provideJavaScriptTypeScriptDocumentHighlights as legacyDocumentHighlights } from "./javascriptTypescriptDocumentHighlightProvider";
import { runBoundedJavaScriptTypeScriptProviderRequest as legacyBoundedProviderRequest } from "./javascriptTypescriptProviderRequestBoundary";
import { provideJavaScriptTypeScriptDocumentHighlights as productionDocumentHighlights } from "./javascriptTypescriptProviders/documentHighlight";
import { runBoundedJavaScriptTypeScriptProviderRequest as productionBoundedProviderRequest } from "./javascriptTypescriptProviders/requestBoundary";

const JAVASCRIPT_TYPESCRIPT_PROVIDER_LANGUAGES = [
  "javascript",
  "typescript",
  "javascriptreact",
  "typescriptreact",
  "vue",
];
const DEFAULT_OWNER_IDENTITY = Object.freeze({});

describe("registerJavaScriptTypeScriptLanguageServerMonacoProviders", () => {
  it("keeps legacy direct-import provider entry points aligned with production", () => {
    expect(legacyDocumentHighlights).toBe(productionDocumentHighlights);
    expect(legacyBoundedProviderRequest).toBe(productionBoundedProviderRequest);
  });

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
    expect(monaco.languages.registerDocumentFormattingEditProvider).toHaveBeenCalledTimes(5);
    expect(monaco.languages.registerDocumentRangeFormattingEditProvider).toHaveBeenCalledTimes(5);
    expect(monaco.languages.registerOnTypeFormattingEditProvider).toHaveBeenCalledTimes(5);
    expect(monaco.languages.registerInlayHintsProvider).toHaveBeenCalledTimes(5);
    expect(monaco.languages.registerDocumentHighlightProvider).toHaveBeenCalledTimes(5);
    expect(monaco.languages.registerDocumentSymbolProvider).toHaveBeenCalledTimes(5);
    expect(monaco.languages.registerWorkspaceSymbolProvider).toHaveBeenCalledTimes(1);
    expect(monaco.languages.registerLinkProvider).toHaveBeenCalledTimes(5);
    expect(monaco.languages.registerFoldingRangeProvider).toHaveBeenCalledTimes(5);
    expect(monaco.languages.registerSelectionRangeProvider).toHaveBeenCalledTimes(5);
    expect(monaco.languages.registerLinkedEditingRangeProvider).toHaveBeenCalledTimes(5);
    expect(monaco.languages.registerCodeLensProvider).toHaveBeenCalledTimes(5);
    expect(monaco.languages.registerDocumentSemanticTokensProvider).toHaveBeenCalledTimes(5);
    expect(monaco.languages.registerDocumentRangeSemanticTokensProvider).toHaveBeenCalledTimes(5);
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
      expect(providerLanguages(registerProvider)).toEqual(JAVASCRIPT_TYPESCRIPT_PROVIDER_LANGUAGES);
    }
    expect(
      (monaco.languages.registerCompletionItemProvider as any).mock.calls[0][1].triggerCharacters,
    ).toEqual([".", "'", '"', "`", "/", "@", "<", "#"]);
    expect(
      (monaco.languages.registerCodeActionProvider as any).mock.calls[0][2].providedCodeActionKinds,
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

  it("rolls back every acquired registration when a later provider registration throws", () => {
    const monaco = createMonaco();
    const acquiredDisposers = [vi.fn(), vi.fn(), vi.fn(), vi.fn()];
    monaco.languages.registerWorkspaceSymbolProvider.mockImplementationOnce(() => ({
      dispose: acquiredDisposers[0],
    }));
    monaco.languages.registerHoverProvider.mockImplementationOnce(() => ({
      dispose: acquiredDisposers[1],
    }));
    monaco.languages.registerCompletionItemProvider.mockImplementationOnce(() => ({
      dispose: acquiredDisposers[2],
    }));
    monaco.languages.registerSignatureHelpProvider.mockImplementationOnce(() => ({
      dispose: acquiredDisposers[3],
    }));
    monaco.languages.registerDefinitionProvider.mockImplementationOnce(() => {
      throw new Error("definition registration failed");
    });

    expect(() =>
      registerJavaScriptTypeScriptLanguageServerMonacoProviders(monaco as any, providerContext()),
    ).toThrow("definition registration failed");

    for (const dispose of acquiredDisposers) {
      expect(dispose).toHaveBeenCalledTimes(1);
    }
  });

  it("continues disposal after one provider disposer throws and reports the failure", () => {
    const monaco = createMonaco();
    const reportError = vi.fn();
    const throwingDispose = vi.fn(() => {
      throw new Error("completion dispose failed");
    });
    monaco.languages.registerCompletionItemProvider.mockImplementationOnce(() => ({
      dispose: throwingDispose,
    }));
    const registration = registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ reportError }),
    );

    registration.dispose();

    expect(throwingDispose).toHaveBeenCalledTimes(1);
    expect(monaco.dispose).toHaveBeenCalledTimes(116);
    expect(reportError).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: "completion dispose failed" }),
    );
  });

  it("restores the previous registration authority when its replacement rolls back", async () => {
    const monaco = createMonaco();
    const gateway = featuresGateway();
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ featuresGateway: gateway }),
    );
    const originalCompletionProvider = (monaco.languages.registerCompletionItemProvider as any).mock
      .calls[0][1];
    monaco.languages.registerDefinitionProvider.mockImplementationOnce(() => {
      throw new Error("replacement registration failed");
    });

    expect(() =>
      registerJavaScriptTypeScriptLanguageServerMonacoProviders(monaco as any, providerContext()),
    ).toThrow("replacement registration failed");
    await originalCompletionProvider.provideCompletionItems(textModel(), {
      column: 4,
      lineNumber: 2,
    });

    expect(gateway.completion).toHaveBeenCalledTimes(1);
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

    const onTypeFormattingProvider = (monaco.languages.registerOnTypeFormattingEditProvider as any)
      .mock.calls[0][1];

    expect(onTypeFormattingProvider.autoFormatTriggerCharacters).toEqual(["}", ";", "\n", ","]);
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
    const completionProvider = (monaco.languages.registerCompletionItemProvider as any).mock
      .calls[3][1];

    const result = await completionProvider.provideCompletionItems(model, position, {
      triggerCharacter: ".",
      triggerKind: 1,
    });

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
      1,
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
    vi.mocked(gateway.hover).mockImplementationOnce((_rootPath, _position, sessionId) =>
      identifiedResponse(
        {
          contents: "const message: string",
        },
        sessionId,
      ),
    );
    const vueDocument = {
      ...document(),
      content: '<script setup lang="ts">\nconst message = "hello";\nmessage\n</script>\n',
      language: "vue",
      name: "App.vue",
      path: "/project/src/App.vue",
      savedContent: '<script setup lang="ts">\nconst message = "hello";\nmessage\n</script>\n',
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
    const completionProvider = (monaco.languages.registerCompletionItemProvider as any).mock
      .calls[4][1];
    const hoverProvider = (monaco.languages.registerHoverProvider as any).mock.calls[4][1];
    const definitionProvider = (monaco.languages.registerDefinitionProvider as any).mock
      .calls[4][1];
    const codeActionProvider = (monaco.languages.registerCodeActionProvider as any).mock
      .calls[4][1];

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
    await codeActionProvider.provideCodeActions(model, new monaco.Range(2, 1, 2, 8), {
      markers: [],
      only: "quickfix",
    });

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
      1,
    );
    expect(gateway.hover).toHaveBeenCalledWith("/project", expectedDocument, 1);
    expect(gateway.definition).toHaveBeenCalledWith("/project", expectedDocument, 1);
    expect(gateway.codeActions).toHaveBeenCalledWith(
      "/project",
      "/project/src/App.vue",
      range(1, 0, 1, 7),
      {
        diagnostics: [],
        only: ["quickfix"],
        triggerKind: null,
      },
      1,
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
    const completionProvider = (monaco.languages.registerCompletionItemProvider as any).mock
      .calls[3][1];

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

  it("forwards the selected refactor range and publishes only refactor actions", async () => {
    const monaco = createMonaco();
    const gateway = featuresGateway({
      codeActions: [
        {
          command: null,
          data: null,
          edit: workspaceEdit("file:///project/src/user.ts", "extracted"),
          isPreferred: true,
          kind: "refactor.extract",
          title: "Extract function",
        },
        {
          command: null,
          data: null,
          edit: workspaceEdit("file:///project/src/user.ts", "fixed"),
          isPreferred: false,
          kind: "quickfix",
          title: "Unrelated quick fix",
        },
        {
          command: null,
          data: null,
          edit: workspaceEdit("file:///project/src/user.ts", "moved"),
          isPreferred: false,
          kind: "refactor.move",
          title: "Move to file",
        },
      ],
    });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ featuresGateway: gateway }),
    );
    const provider = (monaco.languages.registerCodeActionProvider as any).mock.calls[1][1];
    const selection = new monaco.Range(2, 3, 4, 9);

    const result = await provider.provideCodeActions(textModel(), selection, {
      markers: [],
      only: "refactor",
      trigger: monaco.languages.CodeActionTriggerType.Invoke,
    });

    expect(gateway.codeActions).toHaveBeenCalledWith(
      "/project",
      "/project/src/user.ts",
      range(1, 2, 3, 8),
      {
        diagnostics: [],
        only: ["refactor"],
        triggerKind: 1,
      },
      1,
    );
    expect(
      result.actions.map(({ kind, title }: { kind: string; title: string }) => [kind, title]),
    ).toEqual([
      ["refactor.extract", "Extract function"],
      ["refactor.move", "Move to file"],
    ]);
  });

  it.each(["version", "model"] as const)(
    "drops refactors when the exact Monaco %s drifts during the request",
    async (drift) => {
      const monaco = createMonaco();
      const original = stagedTextModel("/project/src/user.ts", "const user = account;", 7);
      let activeModel: unknown = original;
      const pending =
        createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["codeActions"]>>>();
      const gateway = featuresGateway();
      vi.mocked(gateway.codeActions).mockImplementation(() => pending.promise);
      registerJavaScriptTypeScriptLanguageServerMonacoProviders(
        monaco as any,
        providerContext({
          featuresGateway: gateway,
          getActiveModel: () => activeModel as any,
        }),
      );
      const provider = (monaco.languages.registerCodeActionProvider as any).mock.calls[0][1];
      const request = provider.provideCodeActions(original, new monaco.Range(1, 1, 1, 5), {
        markers: [],
        only: "refactor",
      });
      await vi.waitFor(() => expect(gateway.codeActions).toHaveBeenCalledOnce());

      if (drift === "version") {
        original.setSnapshot("const changed = account;", 8);
      } else {
        activeModel = textModel();
      }
      pending.resolve([refactorAction("Extract function")]);

      await expect(request).resolves.toEqual({
        actions: [],
        dispose: expect.any(Function),
      });
    },
  );

  it("drops old provider refactors across a same-root owner A-B-A transition", async () => {
    const monaco = createMonaco();
    const model = textModel();
    const pending =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["codeActions"]>>>();
    const gateway = featuresGateway();
    vi.mocked(gateway.codeActions).mockImplementation(() => pending.promise);
    const owner = (workspaceId: string) =>
      ({
        canonicalRoot: "/project",
        policy: { caseSensitive: true, unicodeNormalization: "none" },
        selectedPath: "/project",
        workspaceId,
      }) as any;
    const oldRegistration = registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: gateway,
        getActiveModel: () => model as any,
        getWorkspaceIdentityDescriptor: () => owner("workspace-a"),
      }),
    );
    const oldProvider = (monaco.languages.registerCodeActionProvider as any).mock.calls[0][1];
    const request = oldProvider.provideCodeActions(model, new monaco.Range(1, 1, 1, 5), {
      markers: [],
      only: "refactor",
    });
    await vi.waitFor(() => expect(gateway.codeActions).toHaveBeenCalledOnce());

    oldRegistration.dispose();
    const middle = registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ getWorkspaceIdentityDescriptor: () => owner("workspace-b") }),
    );
    middle.dispose();
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ getWorkspaceIdentityDescriptor: () => owner("workspace-a") }),
    );
    pending.resolve([refactorAction("Extract function")]);

    await expect(request).resolves.toEqual({
      actions: [],
      dispose: expect.any(Function),
    });
  });

  it("drops refactors after an unobserved same-root owner epoch A-B-A transition", async () => {
    const monaco = createMonaco();
    const model = textModel();
    let ownerEpoch = 1;
    const pending =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["codeActions"]>>>();
    const gateway = featuresGateway();
    vi.mocked(gateway.codeActions).mockImplementation(() => pending.promise);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: gateway,
        getActiveJavaScriptTypeScriptOwnerEpoch: () => ownerEpoch,
        getActiveModel: () => model as any,
      }),
    );
    const provider = (monaco.languages.registerCodeActionProvider as any).mock.calls[0][1];
    const request = provider.provideCodeActions(model, new monaco.Range(1, 1, 1, 5), {
      markers: [],
      only: "refactor",
    });
    await vi.waitFor(() => expect(gateway.codeActions).toHaveBeenCalledOnce());

    ownerEpoch = 2;
    ownerEpoch = 3;
    pending.resolve([refactorAction("Extract function")]);

    await expect(request).resolves.toEqual({
      actions: [],
      dispose: expect.any(Function),
    });
  });

  it.each(["quickfix", null] as const)(
    "fails a refactor resolve closed when its kind mutates to %s",
    async (resolvedKind) => {
      const monaco = createMonaco();
      const model = textModel();
      const unresolved = {
        ...refactorAction("Extract function"),
        data: { id: "extract" },
        edit: null,
      };
      const gateway = featuresGateway({
        codeActions: [unresolved],
        resolvedCodeAction: {
          ...unresolved,
          edit: workspaceEdit("file:///project/src/user.ts", "unsafe"),
          kind: resolvedKind,
        },
      });
      registerJavaScriptTypeScriptLanguageServerMonacoProviders(
        monaco as any,
        providerContext({
          featuresGateway: gateway,
          getActiveModel: () => model as any,
        }),
      );
      const provider = (monaco.languages.registerCodeActionProvider as any).mock.calls[0][1];
      const actions = await provider.provideCodeActions(model, new monaco.Range(1, 1, 1, 5), {
        markers: [],
        only: "refactor",
      });

      await expect(provider.resolveCodeAction(actions.actions[0])).resolves.toBe(
        actions.actions[0],
      );
    },
  );

  it("keeps owner and raw LSP action metadata out of enumeration and serialization", async () => {
    const monaco = createMonaco();
    const model = textModel();
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: featuresGateway({
          codeActions: [
            {
              ...refactorAction("Extract function"),
              data: { secret: "server-private" },
              edit: null,
            },
          ],
        }),
        getActiveModel: () => model as any,
        getWorkspaceIdentityDescriptor: () =>
          ({
            canonicalRoot: "/project",
            policy: { caseSensitive: true, unicodeNormalization: "none" },
            selectedPath: "/project",
            workspaceId: "private-owner",
          }) as any,
      }),
    );
    const provider = (monaco.languages.registerCodeActionProvider as any).mock.calls[0][1];
    const actions = await provider.provideCodeActions(model, new monaco.Range(1, 1, 1, 5), {
      markers: [],
      only: "refactor",
    });
    const action = actions.actions[0];

    expect(Object.keys(action).some((key) => key.startsWith("__"))).toBe(false);
    expect(JSON.stringify(action)).not.toContain("server-private");
    expect(JSON.stringify(action)).not.toContain("private-owner");
    expect(JSON.stringify(action)).not.toContain("/project");
  });

  it("drops in-flight TypeScript completions after switching project tabs", async () => {
    const monaco = createMonaco();
    let activeRoot = "/project";
    const completion =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["completion"]>>>();
    const gateway = featuresGateway();
    vi.mocked(gateway.completion).mockImplementationOnce(() => completion.promise);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        applyWorkspaceEdit: vi.fn(async () => undefined),
        featuresGateway: gateway,
        getWorkspaceRoot: () => activeRoot,
      }),
    );
    const completionProvider = (monaco.languages.registerCompletionItemProvider as any).mock
      .calls[0][1];
    const completionPromise = completionProvider.provideCompletionItems(textModel(), {
      column: 4,
      lineNumber: 2,
    });

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
    expect(gateway.completion).toHaveBeenCalledWith(
      "/project",
      {
        character: 3,
        line: 1,
        path: "/project/src/user.ts",
      },
      undefined,
      1,
    );
  });

  it("drops in-flight TypeScript completions when no project tab is active", async () => {
    const monaco = createMonaco();
    let activeRoot: string | null = "/project";
    const completion =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["completion"]>>>();
    const gateway = featuresGateway();
    vi.mocked(gateway.completion).mockImplementationOnce(() => completion.promise);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: gateway,
        getWorkspaceRoot: () => activeRoot,
      }),
    );
    const completionProvider = (monaco.languages.registerCompletionItemProvider as any).mock
      .calls[0][1];
    const completionPromise = completionProvider.provideCompletionItems(textModel(), {
      column: 4,
      lineNumber: 2,
    });

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
    expect(gateway.completion).toHaveBeenCalledWith(
      "/project",
      {
        character: 3,
        line: 1,
        path: "/project/src/user.ts",
      },
      undefined,
      1,
    );
  });

  it("drops stale TypeScript provider errors after switching project tabs", async () => {
    const monaco = createMonaco();
    let activeRoot = "/project";
    const completion =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["completion"]>>>();
    const reportError = vi.fn();
    const gateway = featuresGateway();
    vi.mocked(gateway.completion).mockImplementationOnce(() => completion.promise);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: gateway,
        getWorkspaceRoot: () => activeRoot,
        reportError,
      }),
    );
    const completionProvider = (monaco.languages.registerCompletionItemProvider as any).mock
      .calls[0][1];
    const completionPromise = completionProvider.provideCompletionItems(textModel(), {
      column: 4,
      lineNumber: 2,
    });

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
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["completion"]>>>();
    const reportError = vi.fn();
    const gateway = featuresGateway();
    vi.mocked(gateway.completion).mockImplementationOnce(() => completion.promise);
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
    const completionProvider = (monaco.languages.registerCompletionItemProvider as any).mock
      .calls[0][1];
    const completionPromise = completionProvider.provideCompletionItems(textModel(), {
      column: 4,
      lineNumber: 2,
    });

    await Promise.resolve();
    activeSessionId = 2;
    completion.reject(new Error("stale completion"));

    await expect(completionPromise).resolves.toEqual({ suggestions: [] });
    expect(reportError).not.toHaveBeenCalled();
  });

  it("consumes a late rejection from mismatched provider request authority", async () => {
    const monaco = createMonaco();
    const hover = createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["hover"]>>>();
    Object.assign(hover.promise, { sessionId: 2 });
    const reportError = vi.fn();
    const cancelRequest = vi.fn(async () => undefined);
    const gateway = featuresGateway();
    vi.mocked(gateway.hover).mockImplementationOnce(() => hover.promise);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ cancelRequest, featuresGateway: gateway, reportError }),
    );
    const hoverProvider = (monaco.languages.registerHoverProvider as any).mock.calls[0][1];

    await expect(
      hoverProvider.provideHover(textModel(), { column: 4, lineNumber: 2 }),
    ).resolves.toBeNull();
    hover.reject(new Error("late foreign rejection"));
    await Promise.resolve();

    expect(cancelRequest).toHaveBeenCalledExactlyOnceWith("/project", 2, hover.promise.requestId);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("drops successful TypeScript provider responses after same-root session restart", async () => {
    const position = { column: 4, lineNumber: 2 };

    {
      const monaco = createMonaco();
      let activeSessionId = 1;
      const hover = createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["hover"]>>>();
      const gateway = featuresGateway();
      vi.mocked(gateway.hover).mockImplementationOnce(() => hover.promise);
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
      const hoverProvider = (monaco.languages.registerHoverProvider as any).mock.calls[0][1];
      const hoverPromise = hoverProvider.provideHover(textModel(), position);

      await Promise.resolve();
      activeSessionId = 2;
      hover.resolve({
        contents: "type User = { id: string }",
      });

      await expect(hoverPromise).resolves.toBeNull();
      expect(gateway.hover).toHaveBeenCalledWith(
        "/project",
        {
          character: 3,
          line: 1,
          path: "/project/src/user.ts",
        },
        1,
      );
    }

    {
      const monaco = createMonaco();
      let activeSessionId = 1;
      const references =
        createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["references"]>>>();
      const gateway = featuresGateway();
      vi.mocked(gateway.references).mockImplementationOnce(() => references.promise);
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
      const referenceProvider = (monaco.languages.registerReferenceProvider as any).mock
        .calls[0][1];
      const referencesPromise = referenceProvider.provideReferences(textModel(), position);

      await Promise.resolve();
      activeSessionId = 2;
      references.resolve([
        {
          range: range(0, 6, 0, 20),
          uri: "file:///project/src/stale.ts",
        },
      ]);

      await expect(referencesPromise).resolves.toBeNull();
      expect(gateway.references).toHaveBeenCalledWith(
        "/project",
        {
          character: 3,
          line: 1,
          path: "/project/src/user.ts",
        },
        1,
      );
    }

    {
      const monaco = createMonaco();
      let activeSessionId = 1;
      const rename = createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["rename"]>>>();
      const gateway = featuresGateway();
      vi.mocked(gateway.rename).mockImplementationOnce(() => rename.promise);
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
      const renameProvider = (monaco.languages.registerRenameProvider as any).mock.calls[0][1];
      const renamePromise = renameProvider.provideRenameEdits(textModel(), position, "account");

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

  it("invalidates an old in-flight request when a replacement registers on the same Monaco", async () => {
    const monaco = createMonaco();
    const oldCompletion =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["completion"]>>>();
    const oldGateway = featuresGateway();
    vi.mocked(oldGateway.completion).mockImplementationOnce(() => oldCompletion.promise);
    const oldRegistration = registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ featuresGateway: oldGateway }),
    );
    const oldProvider = (monaco.languages.registerCompletionItemProvider as any).mock.calls[0][1];
    const oldResult = oldProvider.provideCompletionItems(textModel(), {
      column: 4,
      lineNumber: 2,
    });

    registerJavaScriptTypeScriptLanguageServerMonacoProviders(monaco as any, providerContext());
    oldCompletion.resolve({
      isIncomplete: false,
      items: [
        {
          detail: null,
          documentation: null,
          insertText: "stale",
          kind: 6,
          label: "stale",
        },
      ],
    });

    await expect(oldResult).resolves.toEqual({ suggestions: [] });
    oldRegistration.dispose();
    const replacementProvider = (monaco.languages.registerCompletionItemProvider as any).mock
      .calls[5][1];
    await expect(
      replacementProvider.provideCompletionItems(textModel(), {
        column: 4,
        lineNumber: 2,
      }),
    ).resolves.toEqual({ suggestions: [] });
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
    const completionProvider = (monaco.languages.registerCompletionItemProvider as any).mock
      .calls[0][1];
    const completionPromise = completionProvider.provideCompletionItems(textModel(), {
      column: 4,
      lineNumber: 2,
    });

    await Promise.resolve();
    activeRoot = "/other";
    documentFlush.resolve(undefined);

    await expect(completionPromise).resolves.toEqual({ suggestions: [] });
    expect(gateway.completion).not.toHaveBeenCalled();
  });

  it("drops TypeScript completion when the Monaco cancellation token is cancelled after the response", async () => {
    const monaco = createMonaco();
    const completion =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["completion"]>>>();
    const gateway = featuresGateway();
    vi.mocked(gateway.completion).mockImplementationOnce(() => completion.promise);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ featuresGateway: gateway }),
    );
    const completionProvider = (monaco.languages.registerCompletionItemProvider as any).mock
      .calls[0][1];
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

  it("cancels only pending TypeScript completion requests", async () => {
    const monaco = createMonaco();
    const pending =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["completion"]>>>();
    const resolved =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["completion"]>>>();
    const gateway = featuresGateway();
    vi.mocked(gateway.completion)
      .mockImplementationOnce(() => Object.assign(pending.promise, { requestId: 41 }))
      .mockImplementationOnce(() => Object.assign(resolved.promise, { requestId: 42 }));
    const cancelRequest = vi.fn(async () => undefined);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ cancelRequest, featuresGateway: gateway }),
    );
    const completionProvider = (monaco.languages.registerCompletionItemProvider as any).mock
      .calls[0][1];
    const pendingToken = cancellableToken();
    const pendingResult = completionProvider.provideCompletionItems(
      textModel(),
      { column: 4, lineNumber: 2 },
      undefined,
      pendingToken,
    );

    await Promise.resolve();
    await Promise.resolve();
    pendingToken.fire();
    pendingToken.fire();
    expect(cancelRequest).toHaveBeenCalledExactlyOnceWith("/project", 1, 41);
    pending.resolve({ isIncomplete: false, items: [] });
    await expect(pendingResult).resolves.toEqual({ suggestions: [] });

    const resolvedToken = cancellableToken();
    const resolvedResult = completionProvider.provideCompletionItems(
      textModel(),
      { column: 4, lineNumber: 2 },
      undefined,
      resolvedToken,
    );
    await Promise.resolve();
    await Promise.resolve();
    resolved.resolve({ isIncomplete: false, items: [] });
    await expect(resolvedResult).resolves.toEqual({ suggestions: [] });
    resolvedToken.fire();

    expect(cancelRequest).toHaveBeenCalledTimes(1);
  });

  it("resolves TypeScript completion to empty when the server does not respond before the timeout", async () => {
    vi.useFakeTimers();

    try {
      const monaco = createMonaco();
      const completion =
        createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["completion"]>>>();
      const gateway = featuresGateway();
      vi.mocked(gateway.completion).mockImplementationOnce(() =>
        Object.assign(completion.promise, { requestId: 51 }),
      );
      const cancelRequest = vi.fn(async () => undefined);
      registerJavaScriptTypeScriptLanguageServerMonacoProviders(
        monaco as any,
        providerContext({ cancelRequest, featuresGateway: gateway }),
      );
      const completionProvider = (monaco.languages.registerCompletionItemProvider as any).mock
        .calls[0][1];
      const completionPromise = completionProvider.provideCompletionItems(textModel(), {
        column: 4,
        lineNumber: 2,
      });

      await vi.advanceTimersByTimeAsync(5000);

      await expect(completionPromise).resolves.toEqual({ suggestions: [] });
      expect(cancelRequest).toHaveBeenCalledExactlyOnceWith("/project", 1, 51);
      completion.resolve({ isIncomplete: false, items: [] });
      await flushMicrotasks();
      expect(cancelRequest).toHaveBeenCalledTimes(1);
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
    const completionProvider = (monaco.languages.registerCompletionItemProvider as any).mock
      .calls[0][1];

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
    const hover = createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["hover"]>>>();
    const gateway = featuresGateway();
    vi.mocked(gateway.hover).mockImplementationOnce(() => hover.promise);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: gateway,
        getWorkspaceRoot: () => activeRoot,
      }),
    );
    const hoverProvider = (monaco.languages.registerHoverProvider as any).mock.calls[0][1];
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
    expect(gateway.hover).toHaveBeenCalledWith(
      "/project",
      {
        character: 3,
        line: 1,
        path: "/project/src/user.ts",
      },
      1,
    );
  });

  it("drops in-flight TypeScript definitions after switching project tabs", async () => {
    const monaco = createMonaco();
    let activeRoot = "/project";
    const definition =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["definition"]>>>();
    const gateway = featuresGateway();
    vi.mocked(gateway.definition).mockImplementationOnce(() => definition.promise);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: gateway,
        getWorkspaceRoot: () => activeRoot,
      }),
    );
    const definitionProvider = (monaco.languages.registerDefinitionProvider as any).mock
      .calls[0][1];
    const definitionPromise = definitionProvider.provideDefinition(textModel(), {
      column: 4,
      lineNumber: 2,
    });

    await Promise.resolve();
    activeRoot = "/other";
    definition.resolve([
      {
        range: range(0, 6, 0, 20),
        uri: "file:///project/src/stale.ts",
      },
    ]);

    await expect(definitionPromise).resolves.toBeNull();
    expect(gateway.definition).toHaveBeenCalledWith(
      "/project",
      {
        character: 3,
        line: 1,
        path: "/project/src/user.ts",
      },
      1,
    );
  });

  it("drops TypeScript hover when the Monaco cancellation token is cancelled after the response", async () => {
    const monaco = createMonaco();
    const hover = createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["hover"]>>>();
    const gateway = featuresGateway();
    vi.mocked(gateway.hover).mockImplementationOnce(() => hover.promise);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ featuresGateway: gateway }),
    );
    const hoverProvider = (monaco.languages.registerHoverProvider as any).mock.calls[0][1];
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
      const hover = createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["hover"]>>>();
      const gateway = featuresGateway();
      vi.mocked(gateway.hover).mockImplementationOnce(() => hover.promise);
      registerJavaScriptTypeScriptLanguageServerMonacoProviders(
        monaco as any,
        providerContext({ featuresGateway: gateway }),
      );
      const hoverProvider = (monaco.languages.registerHoverProvider as any).mock.calls[0][1];
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
      const hover = createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["hover"]>>>();
      const gateway = featuresGateway();
      vi.mocked(gateway.hover).mockImplementationOnce(() =>
        Object.assign(hover.promise, { requestId: 52 }),
      );
      const cancelRequest = vi.fn(async () => undefined);
      registerJavaScriptTypeScriptLanguageServerMonacoProviders(
        monaco as any,
        providerContext({ cancelRequest, featuresGateway: gateway }),
      );
      const hoverProvider = (monaco.languages.registerHoverProvider as any).mock.calls[0][1];
      const token = { isCancellationRequested: false };
      const hoverPromise = hoverProvider.provideHover(
        textModel(),
        { column: 4, lineNumber: 2 },
        token,
      );

      await vi.advanceTimersByTimeAsync(700);

      await expect(hoverPromise).resolves.toBeNull();
      expect(cancelRequest).toHaveBeenCalledExactlyOnceWith("/project", 1, 52);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the full navigation timeout budget for TypeScript definition (still pending at the hover timeout)", async () => {
    vi.useFakeTimers();

    try {
      const monaco = createMonaco();
      const definition =
        createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["definition"]>>>();
      const gateway = featuresGateway();
      vi.mocked(gateway.definition).mockImplementationOnce(() => definition.promise);
      registerJavaScriptTypeScriptLanguageServerMonacoProviders(
        monaco as any,
        providerContext({ featuresGateway: gateway }),
      );
      const definitionProvider = (monaco.languages.registerDefinitionProvider as any).mock
        .calls[0][1];
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
    vi.mocked(gateway.hover).mockImplementationOnce((_rootPath, _position, sessionId) =>
      identifiedResponse(
        {
          contents: "type User = { id: string }",
        },
        sessionId,
      ),
    );
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ featuresGateway: gateway }),
    );
    const hoverProvider = (monaco.languages.registerHoverProvider as any).mock.calls[0][1];
    const token = { isCancellationRequested: false };

    await expect(
      hoverProvider.provideHover(textModel(), { column: 4, lineNumber: 2 }, token),
    ).resolves.toEqual({
      contents: [{ value: "type User = { id: string }" }],
    });
  });

  it("records completed TypeScript completion and definition latency for the captured root", async () => {
    const monaco = createMonaco();
    const gateway = featuresGateway({
      definition: [
        {
          range: range(0, 0, 0, 4),
          uri: "file:///project/src/target.ts",
        },
      ],
    });
    const recordLatency = vi.fn();
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ featuresGateway: gateway, recordLatency }),
    );
    const completionProvider = (monaco.languages.registerCompletionItemProvider as any).mock
      .calls[0][1];
    const definitionProvider = (monaco.languages.registerDefinitionProvider as any).mock
      .calls[0][1];

    await completionProvider.provideCompletionItems(textModel(), {
      column: 4,
      lineNumber: 2,
    });
    await definitionProvider.provideDefinition(textModel(), {
      column: 4,
      lineNumber: 2,
    });

    expect(recordLatency).toHaveBeenNthCalledWith(1, "completion", expect.any(Number), "/project");
    expect(recordLatency).toHaveBeenNthCalledWith(2, "definition", expect.any(Number), "/project");
    expect(recordLatency.mock.calls.every(([, duration]) => duration >= 0)).toBe(true);
  });

  it("does not record a late TypeScript definition after an A-B-A owner replacement", async () => {
    const monaco = createMonaco();
    const definition =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["definition"]>>>();
    const gateway = featuresGateway();
    vi.mocked(gateway.definition).mockImplementationOnce(() => definition.promise);
    let ownerEpoch = 1;
    const recordLatency = vi.fn();
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: gateway,
        getActiveJavaScriptTypeScriptOwnerEpoch: () => ownerEpoch,
        recordLatency,
      }),
    );
    const definitionProvider = (monaco.languages.registerDefinitionProvider as any).mock
      .calls[0][1];
    const pending = definitionProvider.provideDefinition(textModel(), {
      column: 4,
      lineNumber: 2,
    });

    ownerEpoch = 2;
    ownerEpoch = 3;
    definition.resolve([]);

    await expect(pending).resolves.toBeNull();
    expect(recordLatency).not.toHaveBeenCalled();
  });

  it("resolves TypeScript definition to null when the server does not respond before the timeout", async () => {
    vi.useFakeTimers();

    try {
      const monaco = createMonaco();
      const definition =
        createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["definition"]>>>();
      const gateway = featuresGateway();
      vi.mocked(gateway.definition).mockImplementationOnce(() =>
        Object.assign(definition.promise, { requestId: 53 }),
      );
      const cancelRequest = vi.fn(async () => undefined);
      registerJavaScriptTypeScriptLanguageServerMonacoProviders(
        monaco as any,
        providerContext({ cancelRequest, featuresGateway: gateway }),
      );
      const definitionProvider = (monaco.languages.registerDefinitionProvider as any).mock
        .calls[0][1];
      const token = { isCancellationRequested: false };
      const definitionPromise = definitionProvider.provideDefinition(
        textModel(),
        { column: 4, lineNumber: 2 },
        token,
      );

      await vi.advanceTimersByTimeAsync(5000);

      await expect(definitionPromise).resolves.toBeNull();
      expect(cancelRequest).toHaveBeenCalledExactlyOnceWith("/project", 1, 53);
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops in-flight TypeScript code actions after switching project tabs", async () => {
    const monaco = createMonaco();
    let activeRoot = "/project";
    const codeActions =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["codeActions"]>>>();
    const gateway = featuresGateway();
    vi.mocked(gateway.codeActions).mockImplementationOnce(() => codeActions.promise);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: gateway,
        getWorkspaceRoot: () => activeRoot,
      }),
    );
    const codeActionProvider = (monaco.languages.registerCodeActionProvider as any).mock
      .calls[0][1];
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
    expect(gateway.codeActions).not.toHaveBeenCalled();
  });

  it("drops in-flight TypeScript code actions when no project tab is active", async () => {
    const monaco = createMonaco();
    let activeRoot: string | null = "/project";
    const codeActions =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["codeActions"]>>>();
    const gateway = featuresGateway();
    vi.mocked(gateway.codeActions).mockImplementationOnce(() => codeActions.promise);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: gateway,
        getWorkspaceRoot: () => activeRoot,
      }),
    );
    const codeActionProvider = (monaco.languages.registerCodeActionProvider as any).mock
      .calls[0][1];
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
    expect(gateway.codeActions).not.toHaveBeenCalled();
  });

  it("cancels pending TypeScript code-action provide and resolve requests exactly once", async () => {
    const monaco = createMonaco();
    const pendingActions =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["codeActions"]>>>();
    const pendingResolve =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["resolveCodeAction"]>>>();
    const gateway = featuresGateway({
      codeActions: [
        {
          command: null,
          data: { resolve: true },
          edit: null,
          isPreferred: false,
          kind: "quickfix",
          title: "Resolve me",
        },
      ],
    });
    vi.mocked(gateway.codeActions)
      .mockImplementationOnce(() => pendingActions.promise)
      .mockImplementationOnce((_root, _path, _range, _context, sessionId) =>
        identifiedResponse(
          [
            {
              command: null,
              data: { resolve: true },
              edit: null,
              isPreferred: false,
              kind: "quickfix",
              title: "Resolve me",
            },
          ],
          sessionId,
        ),
      );
    vi.mocked(gateway.resolveCodeAction).mockImplementationOnce(() => pendingResolve.promise);
    const cancelRequest = vi.fn(async () => undefined);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ cancelRequest, featuresGateway: gateway }),
    );
    const provider = (monaco.languages.registerCodeActionProvider as any).mock.calls[0][1];
    const provideToken = cancellableToken();
    const provide = provider.provideCodeActions(
      textModel(),
      new monaco.Range(1, 1, 1, 5),
      { markers: [], only: "quickfix" },
      provideToken,
    );

    await vi.waitFor(() => expect(gateway.codeActions).toHaveBeenCalledOnce());
    provideToken.fire();
    provideToken.fire();
    expect(cancelRequest).toHaveBeenCalledExactlyOnceWith(
      "/project",
      1,
      pendingActions.promise.requestId,
    );
    pendingActions.resolve([]);
    await expect(provide).resolves.toEqual({
      actions: [],
      dispose: expect.any(Function),
    });

    const actions = await provider.provideCodeActions(textModel(), new monaco.Range(1, 1, 1, 5), {
      markers: [],
      only: "quickfix",
    });
    const resolveToken = cancellableToken();
    const originalAction = actions.actions[0];
    const resolve = provider.resolveCodeAction(originalAction, resolveToken);

    await vi.waitFor(() => expect(gateway.resolveCodeAction).toHaveBeenCalledOnce());
    resolveToken.fire();
    resolveToken.fire();
    expect(cancelRequest).toHaveBeenNthCalledWith(
      2,
      "/project",
      1,
      pendingResolve.promise.requestId,
    );
    pendingResolve.resolve({
      command: null,
      data: { resolve: true },
      edit: null,
      isPreferred: false,
      kind: "quickfix",
      title: "Resolved too late",
    });
    await expect(resolve).resolves.toBe(originalAction);
    expect(cancelRequest).toHaveBeenCalledTimes(2);
  });

  it("times out pending TypeScript code-action provide and resolve requests", async () => {
    vi.useFakeTimers();

    try {
      const monaco = createMonaco();
      const pendingActions =
        createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["codeActions"]>>>();
      const pendingResolve =
        createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["resolveCodeAction"]>>>();
      const gateway = featuresGateway();
      vi.mocked(gateway.codeActions)
        .mockImplementationOnce(() => pendingActions.promise)
        .mockImplementationOnce((_root, _path, _range, _context, sessionId) =>
          identifiedResponse(
            [
              {
                command: null,
                data: { resolve: true },
                edit: null,
                isPreferred: false,
                kind: "quickfix",
                title: "Resolve me",
              },
            ],
            sessionId,
          ),
        );
      vi.mocked(gateway.resolveCodeAction).mockImplementationOnce(() => pendingResolve.promise);
      const cancelRequest = vi.fn(async () => undefined);
      registerJavaScriptTypeScriptLanguageServerMonacoProviders(
        monaco as any,
        providerContext({ cancelRequest, featuresGateway: gateway }),
      );
      const provider = (monaco.languages.registerCodeActionProvider as any).mock.calls[0][1];
      const provide = provider.provideCodeActions(textModel(), new monaco.Range(1, 1, 1, 5), {
        markers: [],
        only: "quickfix",
      });

      await vi.advanceTimersByTimeAsync(CODE_ACTION_REQUEST_TIMEOUT_MS);
      await expect(provide).resolves.toEqual({
        actions: [],
        dispose: expect.any(Function),
      });
      expect(cancelRequest).toHaveBeenCalledExactlyOnceWith(
        "/project",
        1,
        pendingActions.promise.requestId,
      );

      const actions = await provider.provideCodeActions(textModel(), new monaco.Range(1, 1, 1, 5), {
        markers: [],
        only: "quickfix",
      });
      const originalAction = actions.actions[0];
      const resolve = provider.resolveCodeAction(originalAction);

      await vi.advanceTimersByTimeAsync(CODE_ACTION_RESOLVE_REQUEST_TIMEOUT_MS);
      await expect(resolve).resolves.toBe(originalAction);
      expect(cancelRequest).toHaveBeenNthCalledWith(
        2,
        "/project",
        1,
        pendingResolve.promise.requestId,
      );
      expect(cancelRequest).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed when TypeScript code-action provide or resolve exceeds projection bounds", async () => {
    const monaco = createMonaco();
    const rawAction = {
      command: null,
      data: { resolve: true },
      edit: null,
      isPreferred: false,
      kind: "quickfix",
      title: "Resolve me",
    };
    const gateway = featuresGateway();
    vi.mocked(gateway.codeActions)
      .mockImplementationOnce((_root, _path, _range, _context, sessionId) =>
        identifiedResponse(
          Array.from({ length: MAX_CODE_ACTION_RESULTS + 1 }, (_, index) => ({
            ...rawAction,
            title: `Fix ${index}`,
          })),
          sessionId,
        ),
      )
      .mockImplementationOnce((_root, _path, _range, _context, sessionId) =>
        identifiedResponse([rawAction], sessionId),
      );
    vi.mocked(gateway.resolveCodeAction).mockImplementationOnce((_root, action, sessionId) =>
      identifiedResponse(
        {
          ...action,
          data: { payload: "x".repeat(MAX_CODE_ACTION_ITEM_UTF8_BYTES) },
        },
        sessionId,
      ),
    );
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ featuresGateway: gateway }),
    );
    const provider = (monaco.languages.registerCodeActionProvider as any).mock.calls[0][1];

    await expect(
      provider.provideCodeActions(textModel(), new monaco.Range(1, 1, 1, 5), {
        markers: [],
        only: "quickfix",
      }),
    ).resolves.toEqual({
      actions: [],
      dispose: expect.any(Function),
    });

    const actions = await provider.provideCodeActions(textModel(), new monaco.Range(1, 1, 1, 5), {
      markers: [],
      only: "quickfix",
    });
    const originalAction = actions.actions[0];
    await expect(provider.resolveCodeAction(originalAction)).resolves.toBe(originalAction);
  });

  it("rejects too many code-action markers before mapping or invoking the gateway", async () => {
    const monaco = createMonaco();
    const gateway = featuresGateway();
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ featuresGateway: gateway }),
    );
    const provider = (monaco.languages.registerCodeActionProvider as any).mock.calls[0][1];
    const marker = {
      endColumn: 2,
      endLineNumber: 1,
      message: "bounded",
      severity: monaco.MarkerSeverity.Error,
      startColumn: 1,
      startLineNumber: 1,
    };

    await expect(
      provider.provideCodeActions(textModel(), new monaco.Range(1, 1, 1, 5), {
        markers: Array.from({ length: MAX_CODE_ACTION_DIAGNOSTICS + 1 }, () => marker),
        only: "quickfix",
      }),
    ).resolves.toEqual({
      actions: [],
      dispose: expect.any(Function),
    });
    expect(gateway.codeActions).not.toHaveBeenCalled();
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

    const linkProvider = (monaco.languages.registerLinkProvider as any).mock.calls[0][1];
    const links = await linkProvider.provideLinks(model);

    expect(gateway.documentLinks).toHaveBeenCalledWith("/project", "/project/src/user.ts");
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
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["documentLinks"]>>>();
    const gateway = featuresGateway();
    vi.mocked(gateway.documentLinks).mockImplementationOnce(() => documentLinks.promise);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: gateway,
        getWorkspaceRoot: () => activeRoot,
      }),
    );
    const linkProvider = (monaco.languages.registerLinkProvider as any).mock.calls[0][1];
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
    expect(gateway.documentLinks).toHaveBeenCalledWith("/project", "/project/src/user.ts");
  });

  it("drops in-flight TypeScript document links when no project tab is active", async () => {
    const monaco = createMonaco();
    let activeRoot: string | null = "/project";
    const documentLinks =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["documentLinks"]>>>();
    const gateway = featuresGateway();
    vi.mocked(gateway.documentLinks).mockImplementationOnce(() => documentLinks.promise);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: gateway,
        getWorkspaceRoot: () => activeRoot,
      }),
    );
    const linkProvider = (monaco.languages.registerLinkProvider as any).mock.calls[0][1];
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
    expect(gateway.documentLinks).toHaveBeenCalledWith("/project", "/project/src/user.ts");
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

    const symbolProvider = (monaco.languages.registerDocumentSymbolProvider as any).mock
      .calls[0][1];
    const symbols = await symbolProvider.provideDocumentSymbols(textModel());

    expect(gateway.documentSymbols).toHaveBeenCalledWith("/project", "/project/src/user.ts");
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
    expect(context.flushPendingDocumentChange).toHaveBeenCalledWith("/project/src/user.ts");
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

    const symbolProvider = (monaco.languages.registerWorkspaceSymbolProvider as any).mock
      .calls[0][0];
    const symbols = await symbolProvider.provideWorkspaceSymbols("User");

    expect(gateway.workspaceSymbols).toHaveBeenCalledWith("/project", "User", 1);
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
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["workspaceSymbols"]>>>();
    const gateway = featuresGateway();
    vi.mocked(gateway.workspaceSymbols).mockImplementationOnce(() => workspaceSymbols.promise);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: gateway,
        getWorkspaceRoot: () => activeRoot,
      }),
    );
    const symbolProvider = (monaco.languages.registerWorkspaceSymbolProvider as any).mock
      .calls[0][0];
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
    expect(gateway.workspaceSymbols).toHaveBeenCalledWith("/project", "User", 1);
  });

  it("drops workspace symbols after an unobserved A-B-A owner transition", async () => {
    const monaco = createMonaco();
    let ownerEpoch = 1;
    const pending =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["workspaceSymbols"]>>>();
    const gateway = featuresGateway();
    vi.mocked(gateway.workspaceSymbols).mockImplementationOnce(() => pending.promise);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: gateway,
        getActiveJavaScriptTypeScriptOwnerEpoch: () => ownerEpoch,
      }),
    );
    const symbolProvider = (monaco.languages.registerWorkspaceSymbolProvider as any).mock
      .calls[0][0];
    const symbolsPromise = symbolProvider.provideWorkspaceSymbols("User");

    await Promise.resolve();
    ownerEpoch = 2;
    ownerEpoch = 3;
    pending.resolve([
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
  });

  it("drops workspace symbols after their exact provider registration is disposed", async () => {
    const monaco = createMonaco();
    const pending =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["workspaceSymbols"]>>>();
    const gateway = featuresGateway();
    vi.mocked(gateway.workspaceSymbols).mockImplementationOnce(() => pending.promise);
    const registration = registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ featuresGateway: gateway }),
    );
    const symbolProvider = (monaco.languages.registerWorkspaceSymbolProvider as any).mock
      .calls[0][0];
    const symbolsPromise = symbolProvider.provideWorkspaceSymbols("User");

    await Promise.resolve();
    registration.dispose();
    pending.resolve([
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
  });

  it("drops in-flight TypeScript workspace symbols when no project tab is active", async () => {
    const monaco = createMonaco();
    let activeRoot: string | null = "/project";
    const workspaceSymbols =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["workspaceSymbols"]>>>();
    const gateway = featuresGateway();
    vi.mocked(gateway.workspaceSymbols).mockImplementationOnce(() => workspaceSymbols.promise);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: gateway,
        getWorkspaceRoot: () => activeRoot,
      }),
    );
    const symbolProvider = (monaco.languages.registerWorkspaceSymbolProvider as any).mock
      .calls[0][0];
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
    expect(gateway.workspaceSymbols).toHaveBeenCalledWith("/project", "User", 1);
  });

  it("publishes only the latest overlapping TypeScript workspace-symbol query", async () => {
    const monaco = createMonaco();
    const first =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["workspaceSymbols"]>>>();
    const second =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["workspaceSymbols"]>>>();
    const gateway = featuresGateway();
    vi.mocked(gateway.workspaceSymbols)
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ featuresGateway: gateway }),
    );
    const provider = (monaco.languages.registerWorkspaceSymbolProvider as any).mock.calls[0][0];
    const stale = provider.provideWorkspaceSymbols("Us");
    const latest = provider.provideWorkspaceSymbols("User");
    second.resolve([
      {
        containerName: "App",
        kind: 5,
        location: {
          range: range(0, 0, 0, 4),
          uri: "file:///project/src/user.ts",
        },
        name: "User",
      },
    ]);
    await expect(latest).resolves.toHaveLength(1);
    first.resolve([
      {
        containerName: "App",
        kind: 5,
        location: {
          range: range(0, 0, 0, 2),
          uri: "file:///project/src/us.ts",
        },
        name: "Us",
      },
    ]);
    await expect(stale).resolves.toEqual([]);
  });

  it("cancels pending TypeScript workspace symbols exactly once", async () => {
    const monaco = createMonaco();
    const pending =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["workspaceSymbols"]>>>();
    const gateway = featuresGateway();
    vi.mocked(gateway.workspaceSymbols).mockImplementationOnce(() => pending.promise);
    const cancelRequest = vi.fn(async () => undefined);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ cancelRequest, featuresGateway: gateway }),
    );
    const provider = (monaco.languages.registerWorkspaceSymbolProvider as any).mock.calls[0][0];
    const token = cancellableToken();
    const result = provider.provideWorkspaceSymbols("User", token);

    await vi.waitFor(() => expect(gateway.workspaceSymbols).toHaveBeenCalledOnce());
    token.fire();
    token.fire();
    expect(cancelRequest).toHaveBeenCalledExactlyOnceWith("/project", 1, pending.promise.requestId);
    pending.resolve([]);
    await expect(result).resolves.toEqual([]);
  });

  it("times out and bounds TypeScript workspace-symbol results", async () => {
    vi.useFakeTimers();
    try {
      const monaco = createMonaco();
      const pending =
        createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["workspaceSymbols"]>>>();
      const gateway = featuresGateway();
      vi.mocked(gateway.workspaceSymbols)
        .mockImplementationOnce(() => pending.promise)
        .mockImplementationOnce((_root, _query, sessionId) =>
          identifiedResponse(
            Array.from({ length: MAX_WORKSPACE_SYMBOL_RESULTS + 1 }, (_, index) => ({
              containerName: "App",
              kind: 5,
              location: {
                range: range(index, 0, index, 1),
                uri: `file:///project/src/symbol-${index}.ts`,
              },
              name: `Symbol${index}`,
            })),
            sessionId,
          ),
        );
      const cancelRequest = vi.fn(async () => undefined);
      registerJavaScriptTypeScriptLanguageServerMonacoProviders(
        monaco as any,
        providerContext({ cancelRequest, featuresGateway: gateway }),
      );
      const provider = (monaco.languages.registerWorkspaceSymbolProvider as any).mock.calls[0][0];
      const timedOut = provider.provideWorkspaceSymbols("User");

      await vi.advanceTimersByTimeAsync(WORKSPACE_SYMBOL_REQUEST_TIMEOUT_MS);
      await expect(timedOut).resolves.toEqual([]);
      expect(cancelRequest).toHaveBeenCalledExactlyOnceWith(
        "/project",
        1,
        pending.promise.requestId,
      );
      await expect(provider.provideWorkspaceSymbols("User")).resolves.toEqual([]);
    } finally {
      vi.useRealTimers();
    }
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

    const provider = (monaco.languages.registerTypeDefinitionProvider as any).mock.calls[0][1];
    const locations = await provider.provideTypeDefinition(model, position);

    expect(gateway.typeDefinition).toHaveBeenCalledWith(
      "/project",
      {
        character: 3,
        line: 1,
        path: "/project/src/user.ts",
      },
      1,
    );
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

    const definitionProvider = (monaco.languages.registerDefinitionProvider as any).mock
      .calls[0][1];
    const definitions = await definitionProvider.provideDefinition(model, position);

    expect(gateway.definition).toHaveBeenCalledWith(
      "/project",
      {
        character: 3,
        line: 1,
        path: "/project/src/user.ts",
      },
      1,
    );
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
          fsPath: "/Applications/Codevo Editor.app/Contents/Resources/typescript/lib/lib.dom.d.ts",
          path: "/Applications/Codevo Editor.app/Contents/Resources/typescript/lib/lib.dom.d.ts",
        },
      },
    ]);

    const declarationProvider = (monaco.languages.registerDeclarationProvider as any).mock
      .calls[0][1];
    const declarations = await declarationProvider.provideDeclaration(model, position);

    expect(gateway.declaration).toHaveBeenCalledWith(
      "/project",
      {
        character: 3,
        line: 1,
        path: "/project/src/user.ts",
      },
      1,
    );
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

    const implementationProvider = (monaco.languages.registerImplementationProvider as any).mock
      .calls[0][1];
    const implementations = await implementationProvider.provideImplementation(model, position);

    expect(gateway.implementation).toHaveBeenCalledWith(
      "/project",
      {
        character: 3,
        line: 1,
        path: "/project/src/user.ts",
      },
      1,
    );
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

  it("returns and prepares a definition location in a closed file from another package", async () => {
    const monaco = createMonaco();
    const gateway = featuresGateway({
      definition: [
        {
          range: range(2, 0, 8, 1),
          uri: "file:///project/packages/service/src/definition.ts",
        },
      ],
    });
    const prepareNavigationModels = vi.fn(async (locations: readonly LanguageServerLocation[]) =>
      locations.map((location) => ({ location })),
    );
    const context = providerContext({
      featuresGateway: gateway,
      prepareNavigationModels,
    });
    monaco.editor.getModel.mockReturnValue(null);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(monaco as any, context);

    const definitionProvider = (monaco.languages.registerDefinitionProvider as any).mock
      .calls[0][1];

    await expect(
      definitionProvider.provideDefinition(textModel(), {
        column: 4,
        lineNumber: 2,
      }),
    ).resolves.toEqual([
      {
        range: expect.objectContaining({
          endColumn: 2,
          endLineNumber: 9,
          startColumn: 1,
          startLineNumber: 3,
        }),
        uri: {
          fsPath: "/project/packages/service/src/definition.ts",
          path: "/project/packages/service/src/definition.ts",
        },
      },
    ]);
    expect(prepareNavigationModels).toHaveBeenCalledWith(
      [
        {
          range: range(2, 0, 8, 1),
          uri: "file:///project/packages/service/src/definition.ts",
        },
      ],
      expect.any(Function),
      "definition",
    );
  });

  it("publishes the actual URI of an already-open legacy target model", async () => {
    const monaco = createMonaco();
    const path = "/project/packages/service/src/legacy.ts";
    const legacyUri = {
      fsPath: path,
      path,
      scheme: "file",
      toString: () => `file://${path}`,
    };
    const legacyModel = { ...textModel(), uri: legacyUri };
    monaco.editor.getModels.mockReturnValue([legacyModel]);
    const gateway = featuresGateway({
      definition: [
        {
          range: range(0, 0, 0, 6),
          uri: `file://${path}`,
        },
      ],
    });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ featuresGateway: gateway }),
    );
    const definitionProvider = (monaco.languages.registerDefinitionProvider as any).mock
      .calls[0][1];

    const definitions = await definitionProvider.provideDefinition(textModel(), {
      column: 4,
      lineNumber: 2,
    });

    expect(definitions).toEqual([
      expect.objectContaining({
        uri: legacyUri,
      }),
    ]);
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

    const provider = (monaco.languages.registerLinkedEditingRangeProvider as any).mock.calls[0][1];
    const linkedRanges = await provider.provideLinkedEditingRanges(model, position);

    expect(gateway.linkedEditingRanges).toHaveBeenCalledWith(
      "/project",
      {
        character: 2,
        line: 1,
        path: "/project/src/user.ts",
      },
      1,
    );
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

  it("cancels the exact TypeScript linked-editing request through the Monaco token", async () => {
    const monaco = createMonaco();
    const pending =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["linkedEditingRanges"]>>>();
    const gateway = featuresGateway();
    const cancelRequest = vi.fn(async () => undefined);
    vi.mocked(gateway.linkedEditingRanges).mockImplementationOnce(() => pending.promise);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ cancelRequest, featuresGateway: gateway }),
    );
    const provider = (monaco.languages.registerLinkedEditingRangeProvider as any).mock.calls[0][1];
    const token = cancellableToken();
    const result = provider.provideLinkedEditingRanges(
      textModel(),
      { column: 3, lineNumber: 2 },
      token,
    );

    await vi.waitFor(() => expect(gateway.linkedEditingRanges).toHaveBeenCalledOnce());
    token.fire();

    await expect(result).resolves.toBeNull();
    expect(cancelRequest).toHaveBeenCalledExactlyOnceWith("/project", 1, pending.promise.requestId);
  });

  it("times out and cancels a never-settling TypeScript linked-editing request", async () => {
    vi.useFakeTimers();
    const monaco = createMonaco();
    const pending =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["linkedEditingRanges"]>>>();
    const gateway = featuresGateway();
    const cancelRequest = vi.fn(async () => undefined);
    vi.mocked(gateway.linkedEditingRanges).mockImplementationOnce(() => pending.promise);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ cancelRequest, featuresGateway: gateway }),
    );
    const provider = (monaco.languages.registerLinkedEditingRangeProvider as any).mock.calls[0][1];

    try {
      const result = provider.provideLinkedEditingRanges(
        textModel(),
        { column: 3, lineNumber: 2 },
        cancellableToken(),
      );
      await vi.advanceTimersByTimeAsync(LINKED_EDITING_RANGE_REQUEST_TIMEOUT_MS);

      await expect(result).resolves.toBeNull();
      expect(cancelRequest).toHaveBeenCalledExactlyOnceWith(
        "/project",
        1,
        pending.promise.requestId,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed when TypeScript linked-editing ranges exceed the bounded projection", async () => {
    const monaco = createMonaco();
    const gateway = featuresGateway({
      linkedEditingRanges: {
        ranges: Array.from({ length: MAX_LINKED_EDITING_RANGES + 1 }, (_, index) =>
          range(index, 0, index, 1),
        ),
        wordPattern: null,
      },
    });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ featuresGateway: gateway }),
    );
    const provider = (monaco.languages.registerLinkedEditingRangeProvider as any).mock.calls[0][1];

    await expect(
      provider.provideLinkedEditingRanges(textModel(), { column: 3, lineNumber: 2 }),
    ).resolves.toBeNull();
  });

  it("fails closed when the linked-editing word pattern exceeds its bounded projection", async () => {
    const monaco = createMonaco();
    const gateway = featuresGateway({
      linkedEditingRanges: {
        ranges: [range(1, 1, 1, 4)],
        wordPattern: "a".repeat(MAX_LINKED_EDITING_WORD_PATTERN_UTF8_BYTES + 1),
      },
    });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ featuresGateway: gateway }),
    );
    const provider = (monaco.languages.registerLinkedEditingRangeProvider as any).mock.calls[0][1];

    await expect(
      provider.provideLinkedEditingRanges(textModel(), { column: 3, lineNumber: 2 }),
    ).resolves.toBeNull();
  });

  it("omits a potentially catastrophic linked-editing word pattern", async () => {
    const monaco = createMonaco();
    const gateway = featuresGateway({
      linkedEditingRanges: {
        ranges: [range(1, 1, 1, 4)],
        wordPattern: "(a+)+$",
      },
    });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ featuresGateway: gateway }),
    );
    const provider = (monaco.languages.registerLinkedEditingRangeProvider as any).mock.calls[0][1];

    await expect(
      provider.provideLinkedEditingRanges(textModel(), { column: 3, lineNumber: 2 }),
    ).resolves.toEqual({
      ranges: [
        expect.objectContaining({
          endColumn: 5,
          endLineNumber: 2,
          startColumn: 2,
          startLineNumber: 2,
        }),
      ],
    });
  });

  it("drops late TypeScript linked-editing ranges after an A-B-A owner replacement", async () => {
    const monaco = createMonaco();
    const pending =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["linkedEditingRanges"]>>>();
    const gateway = featuresGateway();
    vi.mocked(gateway.linkedEditingRanges).mockImplementationOnce(() => pending.promise);
    let ownerEpoch = 1;
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: gateway,
        getActiveJavaScriptTypeScriptOwnerEpoch: () => ownerEpoch,
      }),
    );
    const provider = (monaco.languages.registerLinkedEditingRangeProvider as any).mock.calls[0][1];
    const result = provider.provideLinkedEditingRanges(textModel(), {
      column: 3,
      lineNumber: 2,
    });

    ownerEpoch = 2;
    ownerEpoch = 3;
    pending.resolve({
      ranges: [range(1, 1, 1, 4), range(1, 8, 1, 11)],
      wordPattern: null,
    });

    await expect(result).resolves.toBeNull();
  });

  it("drops late TypeScript linked-editing ranges after the document snapshot becomes stale", async () => {
    const monaco = createMonaco();
    const pending =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["linkedEditingRanges"]>>>();
    const gateway = featuresGateway();
    vi.mocked(gateway.linkedEditingRanges).mockImplementationOnce(() => pending.promise);
    let syncVersion = 1;
    const model = stagedTextModel("/project/src/user.ts", "const user = account;", syncVersion);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: gateway,
        getActiveModel: () => model as any,
        getDocumentSyncVersion: () => syncVersion,
      }),
    );
    const provider = (monaco.languages.registerLinkedEditingRangeProvider as any).mock.calls[0][1];
    const result = provider.provideLinkedEditingRanges(model, {
      column: 3,
      lineNumber: 2,
    });

    syncVersion = 2;
    model.setSnapshot("const user = replacement;", syncVersion);
    pending.resolve({
      ranges: [range(1, 1, 1, 4), range(1, 8, 1, 11)],
      wordPattern: null,
    });

    await expect(result).resolves.toBeNull();
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

    const provider = (monaco.languages.registerCodeLensProvider as any).mock.calls[0][1];
    const provided = await provider.provideCodeLenses(model);

    expect(gateway.codeLenses).toHaveBeenCalledWith("/project", "/project/src/user.ts");
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

    const foldingProvider = (monaco.languages.registerFoldingRangeProvider as any).mock.calls[0][1];
    const ranges = await foldingProvider.provideFoldingRanges(model);

    expect(gateway.foldingRanges).toHaveBeenCalledWith("/project", "/project/src/user.ts");
    expect(monaco.languages.FoldingRangeKind.fromValue).toHaveBeenCalledWith("region");
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

    const highlightProvider = (monaco.languages.registerDocumentHighlightProvider as any).mock
      .calls[0][1];
    const highlights = await highlightProvider.provideDocumentHighlights(
      model,
      {
        column: 9,
        lineNumber: 4,
      },
      { isCancellationRequested: false },
    );

    expect(gateway.documentHighlights).toHaveBeenCalledWith(
      "/project",
      {
        character: 8,
        line: 3,
        path: "/project/src/user.ts",
      },
      1,
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

    const selectionRangeProvider = (monaco.languages.registerSelectionRangeProvider as any).mock
      .calls[0][1];
    const selectionRanges = await selectionRangeProvider.provideSelectionRanges(model, [
      { column: 12, lineNumber: 4 },
    ]);

    expect(gateway.selectionRanges).toHaveBeenCalledWith("/project", "/project/src/user.ts", [
      { character: 11, line: 3 },
    ]);
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
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["documentHighlights"]>>>();
    const gateway = featuresGateway();
    const cancelRequest = vi.fn(async () => undefined);
    vi.mocked(gateway.documentHighlights).mockImplementationOnce(() => highlights.promise);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ cancelRequest, featuresGateway: gateway }),
    );
    const highlightProvider = (monaco.languages.registerDocumentHighlightProvider as any).mock
      .calls[0][1];

    const token = cancellableToken();
    const requestId = highlights.promise.requestId;
    const promise = highlightProvider.provideDocumentHighlights(
      textModel(),
      { column: 9, lineNumber: 4 },
      token,
    );

    await vi.waitFor(() => expect(gateway.documentHighlights).toHaveBeenCalledOnce());
    token.fire();

    await expect(promise).resolves.toBeNull();
    expect(cancelRequest).toHaveBeenCalledExactlyOnceWith("/project", 1, requestId);
  });

  it("cancels a valid mismatched document-highlight request exactly once", async () => {
    const monaco = createMonaco();
    const highlights =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["documentHighlights"]>>>();
    Object.assign(highlights.promise, { sessionId: 2 });
    const gateway = featuresGateway();
    const cancelRequest = vi.fn(async () => undefined);
    vi.mocked(gateway.documentHighlights).mockImplementationOnce(() => highlights.promise);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ cancelRequest, featuresGateway: gateway }),
    );
    const provider = (monaco.languages.registerDocumentHighlightProvider as any).mock.calls[0][1];

    await expect(
      provider.provideDocumentHighlights(textModel(), { column: 9, lineNumber: 4 }),
    ).resolves.toBeNull();
    highlights.resolve([]);
    await flushMicrotasks();

    expect(cancelRequest).toHaveBeenCalledExactlyOnceWith(
      "/project",
      2,
      highlights.promise.requestId,
    );
  });

  it("drops a resolved TypeScript document highlight when cancellation wins before publication", async () => {
    const monaco = createMonaco();
    const pending =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["documentHighlights"]>>>();
    const gateway = featuresGateway();
    vi.mocked(gateway.documentHighlights).mockImplementationOnce(() => pending.promise);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ featuresGateway: gateway }),
    );
    const provider = (monaco.languages.registerDocumentHighlightProvider as any).mock.calls[0][1];
    const token = cancellableToken();
    const result = provider.provideDocumentHighlights(
      textModel(),
      { column: 9, lineNumber: 4 },
      token,
    );

    await vi.waitFor(() => expect(gateway.documentHighlights).toHaveBeenCalledOnce());
    pending.resolve([{ kind: 2, range: range(0, 6, 0, 10) }]);
    token.fire();

    await expect(result).resolves.toBeNull();
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
    const highlightProvider = (monaco.languages.registerDocumentHighlightProvider as any).mock
      .calls[0][1];

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
    const highlightProvider = (monaco.languages.registerDocumentHighlightProvider as any).mock
      .calls[0][1];

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

  it("does not share TypeScript highlight cache entries between same-word occurrences", async () => {
    const monaco = createMonaco();
    const gateway = featuresGateway({
      documentHighlights: [{ kind: 2, range: range(0, 0, 0, 4) }],
    });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ featuresGateway: gateway }),
    );
    const provider = (monaco.languages.registerDocumentHighlightProvider as any).mock.calls[0][1];
    const model = {
      ...textModel(),
      getWordAtPosition: vi.fn(() => ({
        endColumn: 5,
        startColumn: 1,
        word: "value",
      })),
    };

    await provider.provideDocumentHighlights(model, { column: 3, lineNumber: 1 });
    await provider.provideDocumentHighlights(model, { column: 3, lineNumber: 4 });

    expect(gateway.documentHighlights).toHaveBeenCalledTimes(2);
  });

  it("does not reuse TypeScript highlight cache entries after a server-session replacement", async () => {
    const monaco = createMonaco();
    let sessionId = 1;
    const gateway = featuresGateway({
      documentHighlights: [{ kind: 2, range: range(0, 0, 0, 4) }],
    });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: gateway,
        getRuntimeStatus: () => ({ ...runningStatus(), sessionId }),
      }),
    );
    const provider = (monaco.languages.registerDocumentHighlightProvider as any).mock.calls[0][1];
    const model = textModel();
    const position = { column: 3, lineNumber: 1 };

    await provider.provideDocumentHighlights(model, position);
    sessionId = 2;
    await provider.provideDocumentHighlights(model, position);

    expect(gateway.documentHighlights).toHaveBeenCalledTimes(2);
    expect(gateway.documentHighlights).toHaveBeenLastCalledWith("/project", expect.any(Object), 2);
  });

  it("drops resolved TypeScript linked-editing ranges when cancellation wins before publication", async () => {
    const monaco = createMonaco();
    const pending =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["linkedEditingRanges"]>>>();
    const gateway = featuresGateway();
    vi.mocked(gateway.linkedEditingRanges).mockImplementationOnce(() => pending.promise);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ featuresGateway: gateway }),
    );
    const provider = (monaco.languages.registerLinkedEditingRangeProvider as any).mock.calls[0][1];
    const token = cancellableToken();
    const result = provider.provideLinkedEditingRanges(
      textModel(),
      { column: 3, lineNumber: 2 },
      token,
    );

    await vi.waitFor(() => expect(gateway.linkedEditingRanges).toHaveBeenCalledOnce());
    pending.resolve({
      ranges: [range(1, 1, 1, 4), range(1, 8, 1, 11)],
      wordPattern: null,
    });
    token.fire();

    await expect(result).resolves.toBeNull();
  });

  it("drops in-flight TypeScript selection ranges after switching project tabs", async () => {
    const monaco = createMonaco();
    let activeRoot = "/project";
    const selectionRanges =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["selectionRanges"]>>>();
    const gateway = featuresGateway();
    vi.mocked(gateway.selectionRanges).mockImplementationOnce(() => selectionRanges.promise);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: gateway,
        getWorkspaceRoot: () => activeRoot,
      }),
    );
    const selectionRangeProvider = (monaco.languages.registerSelectionRangeProvider as any).mock
      .calls[0][1];
    const selectionRangesPromise = selectionRangeProvider.provideSelectionRanges(textModel(), [
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
    expect(gateway.selectionRanges).toHaveBeenCalledWith("/project", "/project/src/user.ts", [
      { character: 11, line: 3 },
    ]);
  });

  it("fails closed when TypeScript document highlights exceed the bounded projection", async () => {
    const monaco = createMonaco();
    const gateway = featuresGateway({
      documentHighlights: Array.from(
        { length: MAX_DOCUMENT_HIGHLIGHT_RESULTS + 1 },
        (_, index) => ({
          kind: 2,
          range: range(index, 0, index, 1),
        }),
      ),
    });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ featuresGateway: gateway }),
    );
    const highlightProvider = (monaco.languages.registerDocumentHighlightProvider as any).mock
      .calls[0][1];

    await expect(
      highlightProvider.provideDocumentHighlights(
        textModel(),
        { column: 9, lineNumber: 4 },
        cancellableToken(),
      ),
    ).resolves.toBeNull();
  });

  it("bounds a never-settling TypeScript document-highlight request and cancels its exact session", async () => {
    vi.useFakeTimers();
    const monaco = createMonaco();
    const highlights =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["documentHighlights"]>>>();
    const gateway = featuresGateway();
    const cancelRequest = vi.fn(async () => undefined);
    vi.mocked(gateway.documentHighlights).mockImplementationOnce(() => highlights.promise);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ cancelRequest, featuresGateway: gateway }),
    );
    const highlightProvider = (monaco.languages.registerDocumentHighlightProvider as any).mock
      .calls[0][1];

    try {
      const request = highlightProvider.provideDocumentHighlights(
        textModel(),
        { column: 9, lineNumber: 4 },
        cancellableToken(),
      );
      await vi.advanceTimersByTimeAsync(DOCUMENT_HIGHLIGHT_REQUEST_TIMEOUT_MS);

      await expect(request).resolves.toBeNull();
      expect(cancelRequest).toHaveBeenCalledExactlyOnceWith(
        "/project",
        1,
        highlights.promise.requestId,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops in-flight TypeScript selection ranges when no project tab is active", async () => {
    const monaco = createMonaco();
    let activeRoot: string | null = "/project";
    const selectionRanges =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["selectionRanges"]>>>();
    const gateway = featuresGateway();
    vi.mocked(gateway.selectionRanges).mockImplementationOnce(() => selectionRanges.promise);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: gateway,
        getWorkspaceRoot: () => activeRoot,
      }),
    );
    const selectionRangeProvider = (monaco.languages.registerSelectionRangeProvider as any).mock
      .calls[0][1];
    const selectionRangesPromise = selectionRangeProvider.provideSelectionRanges(textModel(), [
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
    expect(gateway.selectionRanges).toHaveBeenCalledWith("/project", "/project/src/user.ts", [
      { character: 11, line: 3 },
    ]);
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
      getRuntimeStatus: () => runningStatus({ semanticTokensLegend: customLegend }),
    });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(monaco as any, context);
    const model = textModel();

    const semanticTokensProvider = (monaco.languages.registerDocumentSemanticTokensProvider as any)
      .mock.calls[0][1];
    const tokens = await semanticTokensProvider.provideDocumentSemanticTokens(model, null);

    expect(semanticTokensProvider.getLegend()).toEqual(customLegend);
    expect(gateway.semanticTokens).toHaveBeenCalledWith("/project", "/project/src/user.ts", 1);
    expect(tokens).toEqual({
      data: Uint32Array.from([0, 6, 4, 8, 0, 1, 2, 3, 9, 1]),
      resultId: "semantic-1",
    });
    expect(context.flushPendingDocumentChange).toHaveBeenCalledWith("/project/src/user.ts");
  });

  it("bounds a never-settling semantic token request and cancels its exact session", async () => {
    vi.useFakeTimers();

    try {
      const monaco = createMonaco();
      const semanticTokens =
        createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["semanticTokens"]>>>();
      const gateway = featuresGateway();
      vi.mocked(gateway.semanticTokens).mockImplementationOnce(() => semanticTokens.promise);
      const cancelRequest = vi.fn(async () => undefined);
      registerJavaScriptTypeScriptLanguageServerMonacoProviders(
        monaco as any,
        providerContext({ cancelRequest, featuresGateway: gateway }),
      );
      const semanticTokensProvider = (
        monaco.languages.registerDocumentSemanticTokensProvider as any
      ).mock.calls[0][1];

      const result = semanticTokensProvider.provideDocumentSemanticTokens(textModel(), null);
      await vi.advanceTimersByTimeAsync(2_500);

      await expect(result).resolves.toBeNull();
      expect(cancelRequest).toHaveBeenCalledExactlyOnceWith(
        "/project",
        1,
        semanticTokens.promise.requestId,
      );
    } finally {
      vi.useRealTimers();
    }
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
      getRuntimeStatus: () => runningStatus({ semanticTokensLegend: customLegend }),
    });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(monaco as any, context);
    const model = textModel();

    const rangeSemanticTokensProvider = (
      monaco.languages.registerDocumentRangeSemanticTokensProvider as any
    ).mock.calls[0][1];
    const tokens = await rangeSemanticTokensProvider.provideDocumentRangeSemanticTokens(
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
      1,
    );
    expect(tokens).toEqual({
      data: Uint32Array.from([0, 2, 4, 8, 0, 1, 4, 3, 9, 1]),
      resultId: "range-semantic-1",
    });
    expect(context.flushPendingDocumentChange).toHaveBeenCalledWith("/project/src/user.ts");
  });

  it("drops stale range semantic tokens after the workspace changes", async () => {
    const monaco = createMonaco();
    const gateway = featuresGateway();
    const rangeSemanticTokens =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["rangeSemanticTokens"]>>>();
    let activeRoot = "/project";
    vi.mocked(gateway.rangeSemanticTokens).mockImplementationOnce(
      () => rangeSemanticTokens.promise,
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
    const tokensPromise = rangeSemanticTokensProvider.provideDocumentRangeSemanticTokens(
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
      1,
    );
  });

  it("falls back to the default semantic token legend without a runtime legend", () => {
    const monaco = createMonaco();
    const context = providerContext();
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(monaco as any, context);

    const semanticTokensProvider = (monaco.languages.registerDocumentSemanticTokensProvider as any)
      .mock.calls[0][1];

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

    const referencesProvider = (monaco.languages.registerReferenceProvider as any).mock.calls[0][1];
    const references = await referencesProvider.provideReferences(model, position);

    expect(gateway.references).toHaveBeenCalledWith(
      "/project",
      {
        character: 3,
        line: 0,
        path: "/project/src/user.ts",
      },
      1,
    );
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

    const renameProvider = (monaco.languages.registerRenameProvider as any).mock.calls[0][1];
    const renameLocation = await renameProvider.resolveRenameLocation(model, position);

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

    const rename = await renameProvider.provideRenameEdits(model, position, "Account");

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

    const codeActionProvider = (monaco.languages.registerCodeActionProvider as any).mock
      .calls[0][1];
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
      1,
    );
    expect(actionList.actions).toEqual([
      expect.objectContaining({
        isPreferred: true,
        kind: "quickfix",
        title: "Rename symbol",
      }),
      expect.objectContaining({
        command: expect.objectContaining({
          arguments: [expect.any(Object)],
          id: "mockor.javascriptTypeScript.executeLanguageServerCommand",
        }),
        kind: "quickfix",
        title: "Fix all unused identifiers",
      }),
    ]);

    const unresolvedAction = actionList.actions[1];
    expect(unresolvedAction.command.arguments[0].command).toBe(commandOnlyAction.command);
    expect(JSON.stringify(unresolvedAction.command.arguments[0])).toBe("{}");
    const resolvedAction = await codeActionProvider.resolveCodeAction(unresolvedAction);

    expect(gateway.resolveCodeAction).toHaveBeenCalledWith("/project", commandOnlyAction, 1);
    expect(resolvedAction.edit.edits[0].textEdit.text).toBe("Resolved");

    const commandDescriptor = (monaco.editor.addCommand as any).mock.calls[0][0];
    await commandDescriptor.run(null, unresolvedAction.command.arguments[0]);

    expect(gateway.executeCommand).toHaveBeenCalledWith("/project", commandOnlyAction.command);
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

    const formattingProvider = (monaco.languages.registerDocumentFormattingEditProvider as any).mock
      .calls[0][1];
    const formatting = await formattingProvider.provideDocumentFormattingEdits(model, {
      insertSpaces: true,
      tabSize: 2,
    });

    expect(gateway.formatting).toHaveBeenCalledWith("/project", "/project/src/user.ts", {
      insertSpaces: true,
      tabSize: 2,
    });
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
    const rangeFormatting = await rangeFormattingProvider.provideDocumentRangeFormattingEdits(
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

    const onTypeFormattingProvider = (monaco.languages.registerOnTypeFormattingEditProvider as any)
      .mock.calls[0][1];
    expect(onTypeFormattingProvider.autoFormatTriggerCharacters).toEqual(["}", ";", "\n"]);
    const onTypeFormatting = await onTypeFormattingProvider.provideOnTypeFormattingEdits(
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

    const inlayHintsProvider = (monaco.languages.registerInlayHintsProvider as any).mock
      .calls[0][1];
    const hints = await inlayHintsProvider.provideInlayHints(model, new monaco.Range(1, 1, 1, 20));

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

    const signatureProvider = (monaco.languages.registerSignatureHelpProvider as any).mock
      .calls[0][1];
    const signatureHelp = await signatureProvider.provideSignatureHelp(model, position);

    expect(gateway.signatureHelp).toHaveBeenCalledWith(
      "/project",
      {
        character: 3,
        line: 0,
        path: "/project/src/user.ts",
      },
      undefined,
      1,
    );
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
    expect(context.flushPendingDocumentChange).toHaveBeenCalledWith("/project/src/user.ts");
  });

  it("prepares closed reference targets and publishes only the hydrated receipt", async () => {
    const monaco = createMonaco();
    const locations = [
      {
        range: range(0, 1, 0, 5),
        uri: "file:///project/packages/a/src/user.ts",
      },
      {
        range: range(1, 1, 1, 5),
        uri: "file:///project/packages/b/src/user.ts",
      },
    ];
    const gateway = featuresGateway({ references: locations });
    const prepareNavigationModels = vi.fn(async () => [{ location: locations[0]! }]);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ featuresGateway: gateway, prepareNavigationModels }),
    );
    const referencesProvider = (monaco.languages.registerReferenceProvider as any).mock.calls[0][1];

    const references = await referencesProvider.provideReferences(
      textModel(),
      { column: 4, lineNumber: 1 },
      { isCancellationRequested: false },
    );

    expect(prepareNavigationModels).toHaveBeenCalledWith(
      locations,
      expect.any(Function),
      "references",
    );
    expect(references).toHaveLength(1);
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
    const signatureProvider = (monaco.languages.registerSignatureHelpProvider as any).mock
      .calls[0][1];

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
      1,
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
      1,
    );
  });

  it("drops TypeScript signature help when the Monaco cancellation token is cancelled after the response", async () => {
    const monaco = createMonaco();
    const signatureHelp =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["signatureHelp"]>>>();
    const gateway = featuresGateway();
    vi.mocked(gateway.signatureHelp).mockImplementationOnce(() => signatureHelp.promise);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ featuresGateway: gateway }),
    );
    const signatureProvider = (monaco.languages.registerSignatureHelpProvider as any).mock
      .calls[0][1];
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
        createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["signatureHelp"]>>>();
      const gateway = featuresGateway();
      vi.mocked(gateway.signatureHelp).mockImplementationOnce(() => signatureHelp.promise);
      registerJavaScriptTypeScriptLanguageServerMonacoProviders(
        monaco as any,
        providerContext({ featuresGateway: gateway }),
      );
      const signatureProvider = (monaco.languages.registerSignatureHelpProvider as any).mock
        .calls[0][1];
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
    const completionProvider = (monaco.languages.registerCompletionItemProvider as any).mock
      .calls[0][1];

    const result = await completionProvider.provideCompletionItems(model, position);

    expect(gateway.completion).toHaveBeenCalledWith(
      "/project",
      {
        character: 3,
        line: 1,
        path: "/project/src/user.ts",
      },
      undefined,
      1,
    );
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
    const completionProvider = (monaco.languages.registerCompletionItemProvider as any).mock
      .calls[0][1];

    const result = await completionProvider.provideCompletionItems(textModel(), {
      column: 4,
      lineNumber: 1,
    });

    expect(result.suggestions).toHaveLength(2);
    expect(result.suggestions.map((suggestion: { label: unknown }) => suggestion.label)).toEqual([
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
    const completionProvider = (monaco.languages.registerCompletionItemProvider as any).mock
      .calls[0][1];

    const result = await completionProvider.provideCompletionItems(model, position);

    expect(gateway.completion).toHaveBeenCalledWith(
      "/project",
      {
        character: 3,
        line: 1,
        path: "/project/src/user.ts",
      },
      undefined,
      1,
    );
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
    const completionProvider = (monaco.languages.registerCompletionItemProvider as any).mock
      .calls[0][1];

    const result = await completionProvider.provideCompletionItems(textModel(), {
      column: 4,
      lineNumber: 1,
    });

    expect(result.suggestions[0]).toEqual(
      expect.objectContaining({
        documentation: { value: "**Loads** a user." },
        insertText: "loadUser",
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.KeepWhitespace,
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
    const completionProvider = (monaco.languages.registerCompletionItemProvider as any).mock
      .calls[0][1];

    const result = await completionProvider.provideCompletionItems(textModel(), {
      column: 4,
      lineNumber: 1,
    });

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
    const completionProvider = (monaco.languages.registerCompletionItemProvider as any).mock
      .calls[0][1];

    const result = await completionProvider.provideCompletionItems(textModel(), {
      column: 4,
      lineNumber: 1,
    });

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
    const completionProvider = (monaco.languages.registerCompletionItemProvider as any).mock
      .calls[0][1];

    const result = await completionProvider.provideCompletionItems(textModel(), {
      column: 4,
      lineNumber: 1,
    });

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
    const completionProvider = (monaco.languages.registerCompletionItemProvider as any).mock
      .calls[0][1];

    const result = await completionProvider.provideCompletionItems(textModel(), {
      column: 4,
      lineNumber: 1,
    });

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
    const completionProvider = (monaco.languages.registerCompletionItemProvider as any).mock
      .calls[0][1];

    const result = await completionProvider.provideCompletionItems(snippetWordModel("clg"), {
      column: 4,
      lineNumber: 1,
    });

    const clg = result.suggestions.find((item: any) => item.label === "clg");

    expect(clg).toEqual(
      expect.objectContaining({
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
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
    const completionProvider = (monaco.languages.registerCompletionItemProvider as any).mock
      .calls[0][1];

    const result = await completionProvider.provideCompletionItems(snippetWordModel("myl"), {
      column: 4,
      lineNumber: 1,
    });

    const snippet = result.suggestions.find((item: any) => item.label === "mylog");

    expect(snippet).toBeDefined();
    expect(snippet.insertText).toBe("myLogger($0);");
    expect(snippet.insertTextRules).toBe(
      monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    );
  });

  it("does not offer PHP snippets inside a TypeScript document", async () => {
    const monaco = createMonaco();
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(monaco as any, providerContext());
    const completionProvider = (monaco.languages.registerCompletionItemProvider as any).mock
      .calls[0][1];

    const result = await completionProvider.provideCompletionItems(snippetWordModel("ncl"), {
      column: 4,
      lineNumber: 1,
    });

    expect(result.suggestions.map((item: any) => item.label)).not.toContain("nclass");
  });

  it("suppresses snippets after a member-access dot", async () => {
    const monaco = createMonaco();
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(monaco as any, providerContext());
    const completionProvider = (monaco.languages.registerCompletionItemProvider as any).mock
      .calls[0][1];

    const result = await completionProvider.provideCompletionItems(
      snippetWordModel("clg", {
        endColumn: 8,
        lineContent: "foo.clg",
        startColumn: 5,
      }),
      { column: 8, lineNumber: 1 },
    );

    expect(result.suggestions.some((item: any) => item.label === "clg")).toBe(false);
  });

  it("does not offer snippets without a typed prefix", async () => {
    const monaco = createMonaco();
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(monaco as any, providerContext());
    const completionProvider = (monaco.languages.registerCompletionItemProvider as any).mock
      .calls[0][1];

    const result = await completionProvider.provideCompletionItems(
      snippetWordModel("", { startColumn: 4, endColumn: 4 }),
      { column: 4, lineNumber: 1 },
    );

    expect(
      result.suggestions.some(
        (item: any) => item.kind === monaco.languages.CompletionItemKind.Snippet,
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
    const completionProvider = (monaco.languages.registerCompletionItemProvider as any).mock
      .calls[0][1];

    const result = await completionProvider.provideCompletionItems(textModel(), {
      column: 4,
      lineNumber: 1,
    });

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

    expect(gateway.executeCommand).toHaveBeenCalledWith("/project", completionCommand);
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
    const completionProvider = (monaco.languages.registerCompletionItemProvider as any).mock
      .calls[0][1];
    const completion = await completionProvider.provideCompletionItems(textModel(), {
      column: 4,
      lineNumber: 1,
    });

    const resolvePromise = completionProvider.resolveCompletionItem(completion.suggestions[0]);

    await Promise.resolve();

    expect(flushPendingDocumentChange).toHaveBeenNthCalledWith(2, "/project/src/user.ts");
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
    const completionProvider = (monaco.languages.registerCompletionItemProvider as any).mock
      .calls[0][1];

    const result = await completionProvider.provideCompletionItems(textModel(), {
      column: 4,
      lineNumber: 1,
    });

    expect(gateway.completion).toHaveBeenCalledWith("/project", expect.any(Object), undefined, 1);
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
    const completionProvider = (monaco.languages.registerCompletionItemProvider as any).mock
      .calls[0][1];
    const completion = await completionProvider.provideCompletionItems(textModel(), {
      column: 4,
      lineNumber: 1,
    });

    const resolved = await completionProvider.resolveCompletionItem(completion.suggestions[0]);

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
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["resolveCompletionItem"]>>>();
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
    const completionProvider = (monaco.languages.registerCompletionItemProvider as any).mock
      .calls[0][1];
    const completion = await completionProvider.provideCompletionItems(textModel(), {
      column: 4,
      lineNumber: 1,
    });
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
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["resolveCompletionItem"]>>>();
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
    const completionProvider = (monaco.languages.registerCompletionItemProvider as any).mock
      .calls[0][1];
    const completion = await completionProvider.provideCompletionItems(textModel(), {
      column: 4,
      lineNumber: 1,
    });
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
    const codeActionProvider = (monaco.languages.registerCodeActionProvider as any).mock
      .calls[0][1];
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
    expect(flushPendingDocumentChange).toHaveBeenNthCalledWith(2, "/project/src/user.ts");
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
    const completionProvider = (monaco.languages.registerCompletionItemProvider as any).mock
      .calls[0][1];
    const completion = await completionProvider.provideCompletionItems(textModel(), {
      column: 4,
      lineNumber: 1,
    });
    const commandDescriptor = (monaco.editor.addCommand as any).mock.calls[0][0];

    const commandPromise = commandDescriptor.run(
      null,
      completion.suggestions[0].command.arguments[0],
    );

    await Promise.resolve();
    activeRoot = "/other";
    resolveFlush.resolve(undefined);
    await commandPromise;

    expect(flushPendingDocumentChange).toHaveBeenNthCalledWith(2, "/project/src/user.ts");
    expect(gateway.executeCommand).not.toHaveBeenCalled();
  });

  it("drops in-flight TypeScript command edits after switching project tabs", async () => {
    const monaco = createMonaco();
    const model = textModel();
    let activeRoot = "/project";
    const applyWorkspaceEdit = vi.fn(async () => undefined);
    const commandEdit =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["executeCommand"]>>>();
    const gateway = featuresGateway();
    vi.mocked(gateway.executeCommand).mockImplementationOnce(() => commandEdit.promise);
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
    const commandPromise = commandDescriptor.run(
      null,
      workspaceEditCommandPayload("/project/src/user.ts", model),
    );

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

  it.each(["completion", "codeLens", "codeAction"] as const)(
    "rejects a stale nested %s command after an unobserved A-B-A owner transition",
    async (kind) => {
      const monaco = createMonaco();
      const model = textModel();
      let ownerEpoch = 1;
      const command = {
        arguments: [{ scope: "file" }],
        command: "_typescript.organizeImports",
        title: "Organize Imports",
      };
      const gateway = featuresGateway({
        codeActions: [
          {
            command,
            data: null,
            edit: null,
            isPreferred: false,
            kind: "quickfix",
            title: "Organize imports",
          },
        ],
        codeLenses: [{ command, data: null, range: range(0, 0, 0, 1) }],
        completion: {
          isIncomplete: false,
          items: [
            {
              command,
              detail: null,
              documentation: null,
              insertText: "organize",
              kind: 3,
              label: "organize",
            },
          ],
        },
      });
      registerJavaScriptTypeScriptLanguageServerMonacoProviders(
        monaco as any,
        providerContext({
          featuresGateway: gateway,
          getActiveJavaScriptTypeScriptOwnerEpoch: () => ownerEpoch,
          getActiveModel: () => model as any,
        }),
      );
      let payload: unknown;
      if (kind === "completion") {
        const provider = (monaco.languages.registerCompletionItemProvider as any).mock.calls[0][1];
        const result = await provider.provideCompletionItems(model, {
          column: 1,
          lineNumber: 1,
        });
        payload = result.suggestions[0].command.arguments[0];
      } else if (kind === "codeLens") {
        const provider = (monaco.languages.registerCodeLensProvider as any).mock.calls[0][1];
        const result = await provider.provideCodeLenses(model);
        payload = result.lenses[0].command.arguments[0];
      } else {
        const provider = (monaco.languages.registerCodeActionProvider as any).mock.calls[0][1];
        const result = await provider.provideCodeActions(model, new monaco.Range(1, 1, 1, 2), {
          markers: [],
          only: "quickfix",
        });
        payload = result.actions[0].command.arguments[0];
      }

      ownerEpoch = 2;
      ownerEpoch = 3;
      const commandDescriptor = (monaco.editor.addCommand as any).mock.calls[0][0];
      await commandDescriptor.run(null, payload);

      expect(gateway.executeCommand).not.toHaveBeenCalled();
    },
  );

  it("rejects a nested completion command after its provider registration is disposed", async () => {
    const monaco = createMonaco();
    const model = textModel();
    const command = {
      arguments: [],
      command: "_typescript.organizeImports",
      title: "Organize Imports",
    };
    const gateway = featuresGateway({
      completion: {
        isIncomplete: false,
        items: [
          {
            command,
            detail: null,
            documentation: null,
            insertText: "organize",
            kind: 3,
            label: "organize",
          },
        ],
      },
    });
    const registration = registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: gateway,
        getActiveModel: () => model as any,
      }),
    );
    const provider = (monaco.languages.registerCompletionItemProvider as any).mock.calls[0][1];
    const result = await provider.provideCompletionItems(model, {
      column: 1,
      lineNumber: 1,
    });
    const payload = result.suggestions[0].command.arguments[0];

    registration.dispose();
    const commandDescriptor = (monaco.editor.addCommand as any).mock.calls[0][0];
    await commandDescriptor.run(null, payload);

    expect(gateway.executeCommand).not.toHaveBeenCalled();
  });

  it("drops a pending old-registration completion command after same-root replacement", async () => {
    const monaco = createMonaco();
    const model = textModel();
    const applyWorkspaceEdit = vi.fn(async () => undefined);
    const executeCommand =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["executeCommand"]>>>();
    const gateway = featuresGateway({
      completion: {
        isIncomplete: false,
        items: [
          {
            command: {
              arguments: [],
              command: "_typescript.organizeImports",
              title: "Organize Imports",
            },
            detail: null,
            documentation: null,
            insertText: "organize",
            kind: 3,
            label: "organize",
          },
        ],
      },
    });
    vi.mocked(gateway.executeCommand).mockImplementationOnce(() => executeCommand.promise);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        applyWorkspaceEdit,
        featuresGateway: gateway,
        getActiveModel: () => model as any,
      }),
    );
    const provider = (monaco.languages.registerCompletionItemProvider as any).mock.calls[0][1];
    const completion = await provider.provideCompletionItems(model, {
      column: 1,
      lineNumber: 1,
    });
    const commandDescriptor = (monaco.editor.addCommand as any).mock.calls[0][0];
    const command = commandDescriptor.run(null, completion.suggestions[0].command.arguments[0]);
    await vi.waitFor(() => expect(gateway.executeCommand).toHaveBeenCalledOnce());

    registerJavaScriptTypeScriptLanguageServerMonacoProviders(monaco as any, providerContext());
    executeCommand.resolve(workspaceEdit("file:///project/src/user.ts", "Stale"));
    await command;

    expect(applyWorkspaceEdit).not.toHaveBeenCalled();
    expect(model.pushEditOperations).not.toHaveBeenCalled();
  });

  it("does not commit a refactor edit when owner authority drifts during the applier await", async () => {
    const monaco = createMonaco();
    const model = textModel();
    monaco.editor.getModels.mockReturnValue([model]);
    let workspaceId = "workspace-a";
    const release = createDeferred<void>();
    const applyWorkspaceEdit = vi.fn(async (_edit, context) => {
      await release.promise;
      expect(context.applyOpenModels?.()).toEqual(expect.objectContaining({ kind: "rejected" }));
      return { kind: "accepted" } as const;
    });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        applyWorkspaceEdit,
        featuresGateway: featuresGateway({ codeActions: [refactorAction("Extract function")] }),
        getActiveModel: () => model as any,
        getWorkspaceIdentityDescriptor: () =>
          ({
            canonicalRoot: "/project",
            policy: { caseSensitive: true, unicodeNormalization: "none" },
            selectedPath: "/project",
            workspaceId,
          }) as any,
      }),
    );
    const provider = (monaco.languages.registerCodeActionProvider as any).mock.calls[0][1];
    const actions = await provider.provideCodeActions(model, new monaco.Range(1, 1, 1, 5), {
      markers: [],
      only: "refactor",
    });
    const commandDescriptor = (monaco.editor.addCommand as any).mock.calls[0][0];
    const execution = commandDescriptor.run(null, actions.actions[0].command.arguments[0]);
    await vi.waitFor(() => expect(applyWorkspaceEdit).toHaveBeenCalledOnce());

    workspaceId = "workspace-b";
    release.resolve(undefined);
    await execution;

    expect(model.pushEditOperations).not.toHaveBeenCalled();
  });

  it("does not execute a refactor command after its required edit is rejected", async () => {
    const monaco = createMonaco();
    const model = textModel();
    const action = {
      ...refactorAction("Extract and notify"),
      command: {
        arguments: [],
        command: "_typescript.finishRefactor",
        title: "Finish refactor",
      },
    };
    const gateway = featuresGateway({ codeActions: [action] });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        applyWorkspaceEdit: vi.fn(async () => ({
          kind: "rejected" as const,
          reason: "staleDocumentVersion" as const,
        })),
        featuresGateway: gateway,
        getActiveModel: () => model as any,
      }),
    );
    const provider = (monaco.languages.registerCodeActionProvider as any).mock.calls[0][1];
    const actions = await provider.provideCodeActions(model, new monaco.Range(1, 1, 1, 5), {
      markers: [],
      only: "refactor",
    });
    const commandDescriptor = (monaco.editor.addCommand as any).mock.calls[0][0];

    await commandDescriptor.run(null, actions.actions[0].command.arguments[0]);

    expect(gateway.executeCommand).not.toHaveBeenCalled();
    expect(model.pushEditOperations).not.toHaveBeenCalled();
  });

  it("flushes and rebases exact document authority before continuing an accepted edit command", async () => {
    const monaco = createMonaco();
    const model = stagedTextModel("/project/src/user.ts", "const user = account;", 7);
    let ownerEpoch = 1;
    let syncVersion = 1;
    const continuationAcknowledged = createDeferred<void>();
    const action = {
      ...refactorAction("Extract and notify"),
      command: {
        arguments: [],
        command: "_typescript.finishRefactor",
        title: "Finish refactor",
      },
    };
    const gateway = featuresGateway({ codeActions: [action] });
    const flushPendingDocumentChange = vi.fn(async () => {
      if (model.getVersionId() === 8) {
        await continuationAcknowledged.promise;
        ownerEpoch = 2;
        syncVersion = 2;
      }
    });
    vi.mocked(model.pushEditOperations).mockImplementation(() => {
      model.setSnapshot("const refactored = account;", 8);
      return null;
    });
    const applyWorkspaceEdit = vi.fn(async (_edit, context) => {
      expect(context.applyOpenModels?.()).toEqual(expect.objectContaining({ kind: "applied" }));
      return { kind: "accepted" as const };
    });
    monaco.editor.getModels.mockReturnValue([model as any]);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        applyWorkspaceEdit,
        featuresGateway: gateway,
        flushPendingDocumentChange,
        getActiveJavaScriptTypeScriptOwnerEpoch: () => ownerEpoch,
        getActiveModel: () => model as any,
        getDocumentSyncVersion: () => syncVersion,
      }),
    );
    const provider = (monaco.languages.registerCodeActionProvider as any).mock.calls[0][1];
    const actions = await provider.provideCodeActions(model, new monaco.Range(1, 1, 1, 5), {
      markers: [],
      only: "refactor",
    });
    const commandDescriptor = (monaco.editor.addCommand as any).mock.calls[0][0];
    const execution = commandDescriptor.run(null, actions.actions[0].command.arguments[0]);

    await vi.waitFor(() => expect(model.getVersionId()).toBe(8));
    expect(gateway.executeCommand).not.toHaveBeenCalled();
    continuationAcknowledged.resolve(undefined);
    await execution;

    expect(flushPendingDocumentChange).toHaveBeenLastCalledWith("/project/src/user.ts");
    expect(applyWorkspaceEdit).toHaveBeenCalledOnce();
    expect(gateway.executeCommand).toHaveBeenCalledOnce();
  });

  it.each(["foreignEdit", "foreignOwner", "ownerAba"] as const)(
    "drops an accepted edit command after %s drift during its sync flush",
    async (drift) => {
      const monaco = createMonaco();
      const model = stagedTextModel("/project/src/user.ts", "const user = account;", 7);
      let ownerEpoch = 1;
      let ownerIdentity: object = DEFAULT_OWNER_IDENTITY;
      const continuationAcknowledged = createDeferred<void>();
      const action = {
        ...refactorAction("Extract and notify"),
        command: {
          arguments: [],
          command: "_typescript.finishRefactor",
          title: "Finish refactor",
        },
      };
      const gateway = featuresGateway({ codeActions: [action] });
      const flushPendingDocumentChange = vi.fn(async () => {
        if (model.getVersionId() >= 8) {
          await continuationAcknowledged.promise;
        }
      });
      vi.mocked(model.pushEditOperations).mockImplementation(() => {
        model.setSnapshot("const refactored = account;", 8);
        return null;
      });
      monaco.editor.getModels.mockReturnValue([model as any]);
      registerJavaScriptTypeScriptLanguageServerMonacoProviders(
        monaco as any,
        providerContext({
          applyWorkspaceEdit: vi.fn(async (_edit, context) => {
            context.applyOpenModels?.();
            return { kind: "accepted" as const };
          }),
          featuresGateway: gateway,
          flushPendingDocumentChange,
          getActiveJavaScriptTypeScriptOwnerEpoch: () => ownerEpoch,
          getActiveJavaScriptTypeScriptOwnerIdentity: () => ownerIdentity,
          getActiveModel: () => model as any,
        }),
      );
      const provider = (monaco.languages.registerCodeActionProvider as any).mock.calls[0][1];
      const actions = await provider.provideCodeActions(model, new monaco.Range(1, 1, 1, 5), {
        markers: [],
        only: "refactor",
      });
      const commandDescriptor = (monaco.editor.addCommand as any).mock.calls[0][0];
      const execution = commandDescriptor.run(null, actions.actions[0].command.arguments[0]);

      await vi.waitFor(() => expect(model.getVersionId()).toBe(8));
      if (drift === "foreignEdit") {
        model.setSnapshot("const foreign = account;", 9);
      } else if (drift === "foreignOwner") {
        ownerEpoch = 2;
        ownerIdentity = Object.freeze({});
      } else {
        ownerEpoch = 2;
        ownerEpoch = 3;
      }
      continuationAcknowledged.resolve(undefined);
      await execution;

      expect(gateway.executeCommand).not.toHaveBeenCalled();
    },
  );

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
        ...workspaceEdit("file:///project-neighbor/src/user.ts", "Ignored sibling root").changes,
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

    await commandDescriptor.run(null, workspaceEditCommandPayload("/project/src/user.ts", model));

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
        requiresAtomicFinalization: true,
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
      pushEditOperations: vi.fn((_selections, edits: Array<{ text: string }>) => {
        expect(edits.map(({ text }) => text)).toEqual(["X", "Y"]);
        content = "XY\r\nline";
        versionId += 1;
      }),
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
      async (_edit: unknown, context: JavaScriptTypeScriptWorkspaceEditApplicationContext) => {
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

    await commandDescriptor.run(null, workspaceEditCommandPayload("/project/src/user.ts", model));

    expect(model.pushEditOperations).toHaveBeenCalledOnce();
    expect(appliedSnapshots).toEqual({
      documents: [
        {
          content: "XY\r\nline",
          path: "/project/src/user.ts",
          versionId: 12,
        },
      ],
      finalize: expect.any(Function),
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
      async (_edit: unknown, context: JavaScriptTypeScriptWorkspaceEditApplicationContext) => {
        const commit = context.applyOpenModels?.();

        return commit?.kind === "rejected" ? commit : { kind: "accepted" as const };
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

    await commandDescriptor.run(null, workspaceEditCommandPayload("/project/src/a.ts", modelA));

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
      async (_edit: unknown, context: JavaScriptTypeScriptWorkspaceEditApplicationContext) => {
        modelB.setSnapshot("changed", 8);
        const commit = context.applyOpenModels?.();

        return commit?.kind === "rejected" ? commit : { kind: "accepted" as const };
      },
    );
    monaco.editor.getModels.mockReturnValue([modelA, modelB]);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        applyWorkspaceEdit,
        featuresGateway: featuresGateway({ executeCommandEdit: edit }),
        getActiveDocument: () => ({ ...document(), path: "/project/src/a.ts" }),
        getActiveModel: () => modelA as any,
      }),
    );
    const commandDescriptor = (monaco.editor.addCommand as any).mock.calls[0][0];

    await commandDescriptor.run(null, workspaceEditCommandPayload("/project/src/a.ts", modelA));

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
      async (_edit: unknown, context: JavaScriptTypeScriptWorkspaceEditApplicationContext) => {
        monaco.editor.getModels.mockReturnValue([modelA]);
        const commit = context.applyOpenModels?.();

        return commit?.kind === "rejected" ? commit : { kind: "accepted" as const };
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
      async (_edit: unknown, context: JavaScriptTypeScriptWorkspaceEditApplicationContext) => {
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
        getActiveDocument: () => ({ ...document(), path: "/project/src/a.ts" }),
        getActiveModel: () => modelA as any,
      }),
    );
    const commandDescriptor = (monaco.editor.addCommand as any).mock.calls[0][0];

    await commandDescriptor.run(null, workspaceEditCommandPayload("/project/src/a.ts", modelA));
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
      async (_edit: unknown, context: JavaScriptTypeScriptWorkspaceEditApplicationContext) => {
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
        getActiveDocument: () => ({ ...document(), path: "/project/src/a.ts" }),
        getActiveModel: () => model as any,
      }),
    );
    const commandDescriptor = (monaco.editor.addCommand as any).mock.calls[0][0];

    await commandDescriptor.run(null, workspaceEditCommandPayload("/project/src/a.ts", model));

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

    await commandDescriptor.run(null, workspaceEditCommandPayload("/project/src/user.ts", model));

    expect(model.pushEditOperations).not.toHaveBeenCalled();
    expect(applyWorkspaceEdit).toHaveBeenCalledWith(commandEdit, {
      applyOpenModels: expect.any(Function),
      openPaths: ["/project/src/user.ts"],
      requiresAtomicFinalization: true,
      rootPath: "/project",
    });
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
    const renameProvider = (monaco.languages.registerRenameProvider as any).mock.calls[0][1];

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
          ...workspaceEdit("file:///project/src/helper.ts", "ClosedRename").changes,
        },
      },
      {
        applyOpenModels: expect.any(Function),
        openPaths: ["/project/src/user.ts"],
        requiresAtomicFinalization: true,
        rootPath: "/project",
      },
    );
    expect(rename).toEqual({ edits: [] });
  });

  it("rejects and rolls back atomic closed-file finalization after same-root replacement", async () => {
    const monaco = createMonaco();
    const hostCommit = createDeferred<void>();
    const closedFileRollback = vi.fn();
    let applicationContext: JavaScriptTypeScriptWorkspaceEditApplicationContext | null = null;
    const applyWorkspaceEdit = vi.fn(async (_edit, context) => {
      applicationContext = context;
      const openModelCommit = context.applyOpenModels?.();
      await hostCommit.promise;
      const finalized =
        openModelCommit?.kind === "applied" ? openModelCommit.finalize?.() : openModelCommit;
      if (finalized?.kind === "rejected") {
        closedFileRollback();
        return { kind: "rejected" as const, reason: "inactiveWorkspace" as const };
      }
      return { kind: "accepted" as const };
    });
    const gateway = featuresGateway({
      rename: workspaceEdit("file:///project/src/closed.ts", "Account"),
    });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ applyWorkspaceEdit, featuresGateway: gateway }),
    );
    const renameProvider = (monaco.languages.registerRenameProvider as any).mock.calls[0][1];
    const rename = renameProvider.provideRenameEdits(
      textModel(),
      { column: 3, lineNumber: 1 },
      "Account",
    );
    await vi.waitFor(() => expect(applicationContext).not.toBeNull());

    registerJavaScriptTypeScriptLanguageServerMonacoProviders(monaco as any, providerContext());
    hostCommit.resolve();

    await expect(rename).resolves.toBeNull();
    expect(applicationContext).toEqual(
      expect.objectContaining({
        openPaths: [],
        requiresAtomicFinalization: true,
      }),
    );
    expect(closedFileRollback).toHaveBeenCalledTimes(1);
  });

  it("returns no rename edit when the workspace applier rejects the operation", async () => {
    const monaco = createMonaco();
    const model = textModel();
    const applyWorkspaceEdit = vi.fn(async () => ({
      kind: "rejected" as const,
      path: "/project/src/user.ts",
      reason: "staleDocumentVersion" as const,
    }));
    const gateway = featuresGateway({
      rename: workspaceEdit("file:///project/src/user.ts", "Account"),
    });
    monaco.editor.getModels.mockReturnValue([model]);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ applyWorkspaceEdit, featuresGateway: gateway }),
    );
    const renameProvider = (monaco.languages.registerRenameProvider as any).mock.calls[0][1];

    const rename = await renameProvider.provideRenameEdits(
      model,
      { column: 4, lineNumber: 1 },
      "Account",
    );

    expect(rename).toBeNull();
    expect(model.pushEditOperations).not.toHaveBeenCalled();
  });

  it("rejects a rename atomically when it includes foreign edits or file operations", async () => {
    const monaco = createMonaco();
    const model = textModel();
    const applyWorkspaceEdit = vi.fn(async () => undefined);
    const gateway = featuresGateway({
      rename: {
        changes: {
          ...workspaceEdit("file:///project/src/user.ts", "Account").changes,
          ...workspaceEdit("file:///project-neighbor/src/user.ts", "Foreign").changes,
        },
        fileOperations: [
          {
            kind: "rename",
            newUri: "file:///project-neighbor/src/renamed.ts",
            oldUri: "file:///project/src/user.ts",
          },
        ],
      },
    });
    monaco.editor.getModels.mockReturnValue([model]);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ applyWorkspaceEdit, featuresGateway: gateway }),
    );
    const renameProvider = (monaco.languages.registerRenameProvider as any).mock.calls[0][1];

    const rename = await renameProvider.provideRenameEdits(
      model,
      { column: 4, lineNumber: 1 },
      "Account",
    );

    expect(rename).toBeNull();
    expect(applyWorkspaceEdit).not.toHaveBeenCalled();
    expect(model.pushEditOperations).not.toHaveBeenCalled();
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
    const renameProvider = (monaco.languages.registerRenameProvider as any).mock.calls[0][1];

    await renameProvider.provideRenameEdits(nestedModel, { column: 4, lineNumber: 1 }, "Account");

    expect(nestedModel.pushEditOperations).toHaveBeenCalledOnce();
    expect(parentModel.pushEditOperations).not.toHaveBeenCalled();
  });

  it("scopes inlay-hint label navigation to the originating nested root", async () => {
    const monaco = createMonaco();
    (monaco.Uri as typeof monaco.Uri & { parse: typeof URI.parse }).parse = URI.parse;
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
    const provider = (monaco.languages.registerInlayHintsProvider as any).mock.calls[0][1];
    const hints = await provider.provideInlayHints(nestedModel, new monaco.Range(1, 1, 1, 10));

    expect(hints.hints[0].label[0].location.uri.toString()).toBe(workspaceModelUri(rootPath, path));
  });

  it.each([
    ["advertised", true, true],
    ["disabled", false, false],
    ["absent", undefined, false],
  ] as const)(
    "resolves TypeScript inlay hints only when resolve support is %s",
    async (_description, inlayHintResolve, shouldResolve) => {
      const monaco = createMonaco();
      const gateway = featuresGateway({
        inlayHints: [
          {
            data: { hintId: 1 },
            kind: 1,
            label: ": Account",
            paddingLeft: true,
            paddingRight: false,
            position: { character: 10, line: 0 },
            tooltip: null,
          },
        ],
      });
      const flushPendingDocumentChange = vi.fn(async () => undefined);
      const reportError = vi.fn();
      const runtimeStatus = runningStatus({ inlayHintResolve });

      if (runtimeStatus.kind === "running" && inlayHintResolve === undefined) {
        delete runtimeStatus.capabilities.inlayHintResolve;
      }

      registerJavaScriptTypeScriptLanguageServerMonacoProviders(
        monaco as any,
        providerContext({
          featuresGateway: gateway,
          flushPendingDocumentChange,
          getRuntimeStatus: () => runtimeStatus,
          reportError,
        }),
      );
      const provider = (monaco.languages.registerInlayHintsProvider as any).mock.calls[0][1];
      const hints = await provider.provideInlayHints(textModel(), new monaco.Range(1, 1, 1, 20));
      const originalHint = hints.hints[0];
      flushPendingDocumentChange.mockClear();
      vi.mocked(gateway.resolveInlayHint).mockClear();

      const resolvedHint = await provider.resolveInlayHint(originalHint);

      if (shouldResolve) {
        expect(flushPendingDocumentChange).toHaveBeenCalledWith("/project/src/user.ts");
        expect(gateway.resolveInlayHint).toHaveBeenCalledWith(
          "/project",
          expect.objectContaining({ data: { hintId: 1 } }),
        );
        expect(resolvedHint).not.toBe(originalHint);
      } else {
        expect(flushPendingDocumentChange).not.toHaveBeenCalled();
        expect(gateway.resolveInlayHint).not.toHaveBeenCalled();
        expect(resolvedHint).toBe(originalHint);
      }
      expect(reportError).not.toHaveBeenCalled();
    },
  );

  it("persists edit-bearing TypeScript code actions through the workspace applier", async () => {
    const monaco = createMonaco();
    const model = textModel();
    const codeActionEdit = {
      changes: {
        ...workspaceEdit("file:///project/src/user.ts", "OpenActionEdit").changes,
        ...workspaceEdit("file:///project/src/helper.ts", "ClosedActionEdit").changes,
        ...workspaceEdit("file:///project-neighbor/src/user.ts", "Ignored sibling root").changes,
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
    const codeActionProvider = (monaco.languages.registerCodeActionProvider as any).mock
      .calls[0][1];

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
          ...workspaceEdit("file:///project/src/user.ts", "OpenActionEdit").changes,
          ...workspaceEdit("file:///project/src/helper.ts", "ClosedActionEdit").changes,
        },
      },
      {
        applyOpenModels: expect.any(Function),
        openPaths: ["/project/src/user.ts"],
        requiresAtomicFinalization: true,
        rootPath: "/project",
      },
    );
  });

  it("maps TypeScript workspace edit file operations through Monaco and the workspace applier", async () => {
    const monaco = createMonaco();
    (monaco.Uri as typeof monaco.Uri & { parse: typeof URI.parse }).parse = URI.parse;
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
    const codeActionProvider = (monaco.languages.registerCodeActionProvider as any).mock
      .calls[0][1];

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
      requiresAtomicFinalization: true,
      rootPath: "/project",
    });
  });

  it("drops stale TypeScript prepare-rename rejection after switching project tabs", async () => {
    const monaco = createMonaco();
    let activeRoot = "/project";
    const prepareRename =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["prepareRename"]>>>();
    const gateway = featuresGateway();
    vi.mocked(gateway.prepareRename).mockImplementationOnce(() => prepareRename.promise);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: gateway,
        getWorkspaceRoot: () => activeRoot,
      }),
    );
    const renameProvider = (monaco.languages.registerRenameProvider as any).mock.calls[0][1];
    const renameLocationPromise = renameProvider.resolveRenameLocation(textModel(), {
      column: 4,
      lineNumber: 1,
    });

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
    const completionProvider = (monaco.languages.registerCompletionItemProvider as any).mock
      .calls[0][1];
    const linkProvider = (monaco.languages.registerLinkProvider as any).mock.calls[0][1];
    const codeActionProvider = (monaco.languages.registerCodeActionProvider as any).mock
      .calls[0][1];
    const codeLensProvider = (monaco.languages.registerCodeLensProvider as any).mock.calls[0][1];
    const inlayHintsProvider = (monaco.languages.registerInlayHintsProvider as any).mock
      .calls[0][1];
    const completion = await completionProvider.provideCompletionItems(model, position);
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
    const hints = await inlayHintsProvider.provideInlayHints(model, new monaco.Range(1, 1, 1, 20));

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
    const completionProvider = (monaco.languages.registerCompletionItemProvider as any).mock
      .calls[0][1];
    const linkProvider = (monaco.languages.registerLinkProvider as any).mock.calls[0][1];
    const codeActionProvider = (monaco.languages.registerCodeActionProvider as any).mock
      .calls[0][1];
    const codeLensProvider = (monaco.languages.registerCodeLensProvider as any).mock.calls[0][1];
    const inlayHintsProvider = (monaco.languages.registerInlayHintsProvider as any).mock
      .calls[0][1];
    const completion = await completionProvider.provideCompletionItems(model, position);
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
    const hints = await inlayHintsProvider.provideInlayHints(model, new monaco.Range(1, 1, 1, 20));

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
              ...workspaceEdit("file:///project/src/helper.ts", "Applied closed").changes,
              ...workspaceEdit("file:///project-neighbor/src/user.ts", "Ignored sibling root")
                .changes,
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
          ...workspaceEdit("file:///project/src/helper.ts", "Applied closed").changes,
        },
      },
      {
        applyOpenModels: expect.any(Function),
        openPaths: ["/project/src/user.ts"],
        requiresAtomicFinalization: true,
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
    let editListener: ((event: LanguageServerWorkspaceEditEvent) => void) | null = null;
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
      expect(flushPendingDocumentChange).toHaveBeenCalledWith("/project/src/user.ts");
    });

    activeRoot = "/other";
    pendingFlush.resolve();
    await flushMicrotasks();

    expect(model.pushEditOperations).not.toHaveBeenCalled();
    expect(applyWorkspaceEdit).not.toHaveBeenCalled();
  });

  it("drops an old registration workspace edit across dispose and same-root re-registration", async () => {
    const monaco = createMonaco();
    const model = textModel();
    const pendingFlush = createDeferred<void>();
    const applyWorkspaceEdit = vi.fn(async () => undefined);
    const listeners: Array<(event: LanguageServerWorkspaceEditEvent) => void> = [];
    const workspaceEditGateway: LanguageServerWorkspaceEditGateway = {
      subscribeWorkspaceEdits: vi.fn(async (listener) => {
        listeners.push(listener);
        return () => undefined;
      }),
    };
    monaco.editor.getModels.mockReturnValue([model]);
    const first = registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        applyWorkspaceEdit,
        flushPendingDocumentChange: vi.fn(async () => pendingFlush.promise),
        workspaceEditGateway,
      }),
    );
    await vi.waitFor(() => expect(listeners).toHaveLength(1));

    listeners[0]?.({
      edit: workspaceEdit("file:///project/src/user.ts", "Stale"),
      label: "Old registration",
      rootPath: "/project",
      sessionId: 1,
    });
    first.dispose();
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ applyWorkspaceEdit, workspaceEditGateway }),
    );
    await vi.waitFor(() => expect(listeners).toHaveLength(2));

    pendingFlush.resolve();
    await flushMicrotasks();

    expect(model.pushEditOperations).not.toHaveBeenCalled();
    expect(applyWorkspaceEdit).not.toHaveBeenCalled();
  });

  it("does not report a late subscription failure after its registration is disposed", async () => {
    const monaco = createMonaco();
    const subscription = createDeferred<() => void>();
    const reportError = vi.fn();
    const refreshGateway: LanguageServerRefreshGateway = {
      subscribeRefreshEvents: vi.fn(() => subscription.promise),
    };
    const registration = registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ refreshGateway, reportError }),
    );

    registration.dispose();
    subscription.reject(new Error("late subscribe failure"));
    await flushMicrotasks();

    expect(reportError).not.toHaveBeenCalled();
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
        requiresAtomicFinalization: true,
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
    let refreshListener: ((event: LanguageServerRefreshEvent) => void) | null = null;
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
    const codeLensProvider = (monaco.languages.registerCodeLensProvider as any).mock.calls[0][1];
    const inlayHintsProvider = (monaco.languages.registerInlayHintsProvider as any).mock
      .calls[0][1];
    const semanticTokensProvider = (monaco.languages.registerDocumentSemanticTokensProvider as any)
      .mock.calls[0][1];
    const codeLensRefresh = vi.fn();
    const inlayHintRefresh = vi.fn();
    const semanticTokensRefresh = vi.fn();
    const codeLensSubscription = codeLensProvider.onDidChange(codeLensRefresh);
    const inlayHintSubscription = inlayHintsProvider.onDidChangeInlayHints(inlayHintRefresh);
    const semanticTokensSubscription = semanticTokensProvider.onDidChange(semanticTokensRefresh);
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
  it("fails closed for large JS/TS documents before flushing or requesting expensive features", async () => {
    const monaco = createMonaco();
    const largeDocument = {
      ...document(),
      content: "x".repeat(16 * 1024 + 1),
    };
    const gateway = featuresGateway();
    const flush = vi.fn(async () => undefined);
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: gateway,
        flushPendingDocumentChange: flush,
        getActiveDocument: () => largeDocument,
        getLargeSmartDocumentPolicy: () => ({
          characterLimit: 16 * 1024,
          lineLimit: 500,
        }),
      }),
    );
    const hoverProvider = (monaco.languages.registerHoverProvider as any).mock.calls[0][1];
    const formattingProvider = (monaco.languages.registerDocumentFormattingEditProvider as any).mock
      .calls[0][1];

    await expect(
      hoverProvider.provideHover(textModel(), { column: 1, lineNumber: 1 }),
    ).resolves.toBeNull();
    await expect(
      formattingProvider.provideDocumentFormattingEdits(textModel(), {
        insertSpaces: true,
        tabSize: 2,
      }),
    ).resolves.toEqual([]);
    expect(flush).not.toHaveBeenCalled();
    expect(gateway.hover).not.toHaveBeenCalled();
    expect(gateway.formatting).not.toHaveBeenCalled();
  });

  it("re-enables providers exactly across normal-large-normal sync transitions", async () => {
    const monaco = createMonaco();
    let activeDocument = document();
    let syncVersion: number | null = null;
    const gateway = featuresGateway();
    vi.mocked(gateway.hover).mockImplementation((_rootPath, _position, sessionId) =>
      identifiedResponse({ contents: "type User" }, sessionId),
    );
    const flush = vi.fn(async () => {
      if (activeDocument.content.length <= 16 * 1024) {
        syncVersion = (syncVersion ?? 0) + 1;
      }
    });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: gateway,
        flushPendingDocumentChange: flush,
        getActiveDocument: () => activeDocument,
        getDocumentSyncVersion: () => syncVersion,
        getLargeSmartDocumentPolicy: () => ({
          characterLimit: 16 * 1024,
          lineLimit: 500,
        }),
      }),
    );
    const provider = (monaco.languages.registerHoverProvider as any).mock.calls[0][1];
    const model = stagedTextModel("/project/src/user.ts", activeDocument.content, 1);

    await expect(provider.provideHover(model, { column: 1, lineNumber: 1 })).resolves.toEqual({
      contents: [{ value: "type User" }],
    });
    activeDocument = { ...activeDocument, content: "x".repeat(16 * 1024 + 1) };
    model.setSnapshot(activeDocument.content, 2);
    syncVersion = null;
    await expect(provider.provideHover(model, { column: 1, lineNumber: 1 })).resolves.toBeNull();
    activeDocument = { ...activeDocument, content: "const user = account;" };
    model.setSnapshot(activeDocument.content, 3);
    await expect(provider.provideHover(model, { column: 1, lineNumber: 1 })).resolves.toEqual({
      contents: [{ value: "type User" }],
    });

    expect(gateway.hover).toHaveBeenCalledTimes(2);
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it("drops a pending provider result after sync generation replacement", async () => {
    const monaco = createMonaco();
    const pending = createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["hover"]>>>();
    const gateway = featuresGateway();
    vi.mocked(gateway.hover).mockImplementation(() => pending.promise);
    let syncVersion = 7;
    const model = textModel();
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: gateway,
        getActiveModel: () => model as any,
        getDocumentSyncVersion: () => syncVersion,
      }),
    );
    const provider = (monaco.languages.registerHoverProvider as any).mock.calls[0][1];
    const request = provider.provideHover(model, { column: 1, lineNumber: 1 });
    await vi.waitFor(() => expect(gateway.hover).toHaveBeenCalledOnce());

    syncVersion = 8;
    pending.resolve({ contents: "stale" });

    await expect(request).resolves.toBeNull();
  });

  it("rejects lazy resolves after the exact acknowledged document snapshot changes", async () => {
    const monaco = createMonaco();
    let syncVersion = 1;
    const gateway = featuresGateway({
      codeActions: [
        {
          command: null,
          data: { id: 1 },
          edit: null,
          isPreferred: false,
          kind: "quickfix",
          title: "Fix user",
        },
      ],
      codeLenses: [{ command: null, data: { id: 1 }, range: range(0, 0, 0, 1) }],
      completion: {
        isIncomplete: false,
        items: [
          {
            data: { id: 1 },
            detail: null,
            documentation: null,
            insertText: "user",
            kind: 3,
            label: "user",
          },
        ],
      },
      documentLinks: [{ data: { id: 1 }, range: range(0, 0, 0, 1), target: null, tooltip: null }],
      inlayHints: [
        {
          data: { id: 1 },
          kind: 1,
          label: "User",
          paddingLeft: false,
          paddingRight: false,
          position: { character: 0, line: 0 },
          tooltip: null,
        },
      ],
    });
    const model = textModel();
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({
        featuresGateway: gateway,
        getActiveModel: () => model as any,
        getDocumentSyncVersion: () => syncVersion,
      }),
    );
    const completionProvider = (monaco.languages.registerCompletionItemProvider as any).mock
      .calls[0][1];
    const linkProvider = (monaco.languages.registerLinkProvider as any).mock.calls[0][1];
    const codeActionProvider = (monaco.languages.registerCodeActionProvider as any).mock
      .calls[0][1];
    const codeLensProvider = (monaco.languages.registerCodeLensProvider as any).mock.calls[0][1];
    const inlayProvider = (monaco.languages.registerInlayHintsProvider as any).mock.calls[0][1];
    const completion = await completionProvider.provideCompletionItems(model, {
      column: 1,
      lineNumber: 1,
    });
    const links = await linkProvider.provideLinks(model);
    const actions = await codeActionProvider.provideCodeActions(
      model,
      new monaco.Range(1, 1, 1, 2),
      { markers: [], only: "quickfix" },
    );
    const lenses = await codeLensProvider.provideCodeLenses(model);
    const hints = await inlayProvider.provideInlayHints(model, new monaco.Range(1, 1, 1, 2));

    syncVersion = 2;
    await completionProvider.resolveCompletionItem(completion.suggestions[0]);
    await linkProvider.resolveLink(links.links[0]);
    await codeActionProvider.resolveCodeAction(actions.actions[0]);
    await codeLensProvider.resolveCodeLens(model, lenses.lenses[0]);
    await inlayProvider.resolveInlayHint(hints.hints[0]);

    expect(gateway.resolveCompletionItem).not.toHaveBeenCalled();
    expect(gateway.resolveDocumentLink).not.toHaveBeenCalled();
    expect(gateway.resolveCodeAction).not.toHaveBeenCalled();
    expect(gateway.resolveCodeLens).not.toHaveBeenCalled();
    expect(gateway.resolveInlayHint).not.toHaveBeenCalled();
  });
});

function providerContext(
  overrides: Partial<JavaScriptTypeScriptLanguageServerProviderContext> = {},
): JavaScriptTypeScriptLanguageServerProviderContext {
  return {
    applyWorkspaceEdit: overrides.applyWorkspaceEdit,
    cancelRequest: overrides.cancelRequest,
    completeFunctionCalls: overrides.completeFunctionCalls,
    featuresGateway: overrides.featuresGateway ?? featuresGateway(),
    flushPendingDocumentChange:
      overrides.flushPendingDocumentChange ?? vi.fn(async () => undefined),
    getActiveJavaScriptTypeScriptOwnerEpoch:
      overrides.getActiveJavaScriptTypeScriptOwnerEpoch ?? (() => 1),
    getActiveJavaScriptTypeScriptOwnerIdentity:
      overrides.getActiveJavaScriptTypeScriptOwnerIdentity ?? (() => DEFAULT_OWNER_IDENTITY),
    getActiveDocument: overrides.getActiveDocument ?? (() => document()),
    getActiveModel: overrides.getActiveModel,
    getDocumentSyncVersion: overrides.getDocumentSyncVersion ?? (() => 1),
    getLargeSmartDocumentPolicy:
      overrides.getLargeSmartDocumentPolicy ?? (() => defaultLargeSmartDocumentPolicy),
    getRuntimeStatus: overrides.getRuntimeStatus ?? (() => runningStatus()),
    getUserSnippets: overrides.getUserSnippets,
    getWorkspaceRoot: overrides.getWorkspaceRoot ?? (() => "/project"),
    getWorkspaceIdentityDescriptor: overrides.getWorkspaceIdentityDescriptor,
    prepareNavigationModels: overrides.prepareNavigationModels,
    recordLatency: overrides.recordLatency,
    refreshGateway: overrides.refreshGateway,
    reportError: overrides.reportError ?? vi.fn(),
    workspaceEditGateway: overrides.workspaceEditGateway,
  };
}

function cancellableToken() {
  let cancelled = false;
  let listener: (() => void) | undefined;

  return {
    fire: () => {
      cancelled = true;
      listener?.();
      return undefined;
    },
    get isCancellationRequested() {
      return cancelled;
    },
    onCancellationRequested: (nextListener: () => void) => {
      listener = nextListener;
      return { dispose: () => (listener = undefined) };
    },
  };
}

function featuresGateway(
  responses: Partial<{
    codeActions: Awaited<ReturnType<LanguageServerFeaturesGateway["codeActions"]>>;
    codeLenses: Awaited<ReturnType<LanguageServerFeaturesGateway["codeLenses"]>>;
    completion: Awaited<ReturnType<LanguageServerFeaturesGateway["completion"]>>;
    declaration: Awaited<ReturnType<LanguageServerFeaturesGateway["declaration"]>>;
    definition: Awaited<ReturnType<LanguageServerFeaturesGateway["definition"]>>;
    documentHighlights: Awaited<ReturnType<LanguageServerFeaturesGateway["documentHighlights"]>>;
    documentLinks: Awaited<ReturnType<LanguageServerFeaturesGateway["documentLinks"]>>;
    documentSymbols: Awaited<ReturnType<LanguageServerFeaturesGateway["documentSymbols"]>>;
    executeCommandEdit: Awaited<ReturnType<LanguageServerFeaturesGateway["executeCommand"]>>;
    formatting: Awaited<ReturnType<LanguageServerFeaturesGateway["formatting"]>>;
    foldingRanges: Awaited<ReturnType<LanguageServerFeaturesGateway["foldingRanges"]>>;
    implementation: Awaited<ReturnType<LanguageServerFeaturesGateway["implementation"]>>;
    inlayHints: Awaited<ReturnType<LanguageServerFeaturesGateway["inlayHints"]>>;
    linkedEditingRanges: Awaited<ReturnType<LanguageServerFeaturesGateway["linkedEditingRanges"]>>;
    prepareRename: Awaited<ReturnType<LanguageServerFeaturesGateway["prepareRename"]>>;
    onTypeFormatting: Awaited<ReturnType<LanguageServerFeaturesGateway["onTypeFormatting"]>>;
    references: Awaited<ReturnType<LanguageServerFeaturesGateway["references"]>>;
    rangeFormatting: Awaited<ReturnType<LanguageServerFeaturesGateway["rangeFormatting"]>>;
    rangeSemanticTokens: Awaited<ReturnType<LanguageServerFeaturesGateway["rangeSemanticTokens"]>>;
    rename: Awaited<ReturnType<LanguageServerFeaturesGateway["rename"]>>;
    selectionRanges: Awaited<ReturnType<LanguageServerFeaturesGateway["selectionRanges"]>>;
    semanticTokens: Awaited<ReturnType<LanguageServerFeaturesGateway["semanticTokens"]>>;
    signatureHelp: Awaited<ReturnType<LanguageServerFeaturesGateway["signatureHelp"]>>;
    workspaceSymbols: Awaited<ReturnType<LanguageServerFeaturesGateway["workspaceSymbols"]>>;
    typeDefinition: Awaited<ReturnType<LanguageServerFeaturesGateway["typeDefinition"]>>;
    resolvedCodeAction: Awaited<ReturnType<LanguageServerFeaturesGateway["resolveCodeAction"]>>;
    resolvedCodeLens: Awaited<ReturnType<LanguageServerFeaturesGateway["resolveCodeLens"]>>;
    resolvedCompletionItem: Awaited<
      ReturnType<LanguageServerFeaturesGateway["resolveCompletionItem"]>
    >;
    resolvedDocumentLink: Awaited<ReturnType<LanguageServerFeaturesGateway["resolveDocumentLink"]>>;
    resolvedInlayHint: Awaited<ReturnType<LanguageServerFeaturesGateway["resolveInlayHint"]>>;
  }> = {},
): LanguageServerFeaturesGateway {
  return {
    codeActions: vi.fn((_rootPath, _path, _range, _context, sessionId) =>
      identifiedResponse(responses.codeActions ?? [], sessionId),
    ),
    codeLenses: vi.fn(async () => responses.codeLenses ?? []),
    completion: vi.fn((_rootPath, _position, _context, sessionId) =>
      identifiedResponse(
        responses.completion ?? {
          isIncomplete: false,
          items: [],
        },
        sessionId,
      ),
    ),
    declaration: vi.fn((_rootPath, _position, sessionId) =>
      identifiedResponse(responses.declaration ?? [], sessionId),
    ),
    definition: vi.fn((_rootPath, _position, sessionId) =>
      identifiedResponse(responses.definition ?? [], sessionId),
    ),
    didChangeConfiguration: vi.fn(async () => undefined),
    didChangeWatchedFiles: vi.fn(async () => undefined),
    didCreateFiles: vi.fn(async () => undefined),
    didDeleteFiles: vi.fn(async () => undefined),
    didRenameFiles: vi.fn(async () => undefined),
    documentHighlights: vi.fn((_rootPath, _position, sessionId) =>
      identifiedResponse(responses.documentHighlights ?? [], sessionId),
    ),
    documentLinks: vi.fn(async () => responses.documentLinks ?? []),
    documentSymbols: vi.fn(async () => responses.documentSymbols ?? []),
    executeCommand: vi.fn(async () => responses.executeCommandEdit ?? null),
    executeCommandLocations: vi.fn(async () => []),
    foldingRanges: vi.fn(async () => responses.foldingRanges ?? []),
    formatting: vi.fn(async () => responses.formatting ?? []),
    hover: vi.fn((_rootPath, _position, sessionId) => identifiedResponse(null, sessionId)),
    incomingCalls: vi.fn(async () => []),
    implementation: vi.fn((_rootPath, _position, sessionId) =>
      identifiedResponse(responses.implementation ?? [], sessionId),
    ),
    inlayHints: vi.fn(async () => responses.inlayHints ?? []),
    linkedEditingRanges: vi.fn((_rootPath, _position, sessionId) =>
      identifiedResponse(responses.linkedEditingRanges ?? null, sessionId),
    ),
    onTypeFormatting: vi.fn(async () => responses.onTypeFormatting ?? []),
    outgoingCalls: vi.fn(async () => []),
    prepareCallHierarchy: vi.fn(async () => []),
    prepareRename: vi.fn(async () => responses.prepareRename ?? null),
    prepareTypeHierarchy: vi.fn(async () => []),
    rangeFormatting: vi.fn(async () => responses.rangeFormatting ?? []),
    rangeSemanticTokens: vi.fn((_rootPath, _path, _range, sessionId) =>
      identifiedResponse(responses.rangeSemanticTokens ?? null, sessionId),
    ),
    references: vi.fn((_rootPath, _position, sessionId) =>
      identifiedResponse(responses.references ?? [], sessionId),
    ),
    rename: vi.fn(async () => responses.rename ?? null),
    selectionRanges: vi.fn(async () => responses.selectionRanges ?? []),
    semanticTokens: vi.fn((_rootPath, _path, sessionId) =>
      identifiedResponse(responses.semanticTokens ?? null, sessionId),
    ),
    signatureHelp: vi.fn((_rootPath, _position, _context, sessionId) =>
      identifiedResponse(responses.signatureHelp ?? null, sessionId),
    ),
    sourceDefinition: vi.fn((_rootPath, _position, sessionId) => identifiedResponse([], sessionId)),
    typeDefinition: vi.fn((_rootPath, _position, sessionId) =>
      identifiedResponse(responses.typeDefinition ?? [], sessionId),
    ),
    typeHierarchySubtypes: vi.fn(async () => []),
    typeHierarchySupertypes: vi.fn(async () => []),
    willCreateFiles: vi.fn(async () => null),
    willDeleteFiles: vi.fn(async () => null),
    willRenameFiles: vi.fn(async () => null),
    workspaceSymbols: vi.fn((_rootPath, _query, sessionId) =>
      identifiedResponse(responses.workspaceSymbols ?? [], sessionId),
    ),
    resolveCompletionItem: vi.fn(
      async (_rootPath, item) => responses.resolvedCompletionItem ?? item,
    ),
    resolveCodeAction: vi.fn((_rootPath, action, sessionId) =>
      identifiedResponse(responses.resolvedCodeAction ?? action, sessionId),
    ),
    resolveCodeLens: vi.fn(async (_rootPath, lens) => responses.resolvedCodeLens ?? lens),
    resolveDocumentLink: vi.fn(async (_rootPath, link) => responses.resolvedDocumentLink ?? link),
    resolveInlayHint: vi.fn(async (_rootPath, hint) => responses.resolvedInlayHint ?? hint),
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
      inlayHintResolve: true,
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

function identifiedResponse<T>(value: T, sessionId = 1) {
  return Object.assign(Promise.resolve(value), {
    requestId: nextTestRequestId++,
    sessionId,
  });
}

function createDeferred<T>(): {
  promise: Promise<T> & { readonly requestId: number; readonly sessionId: number };
  reject(reason?: unknown): void;
  resolve(value: T): void;
} {
  let rejectValue: ((reason?: unknown) => void) | null = null;
  let resolveValue: ((value: T) => void) | null = null;
  const promise = new Promise<T>((resolve, reject) => {
    rejectValue = reject;
    resolveValue = resolve;
  });
  const identifiedPromise = Object.assign(promise, {
    requestId: nextTestRequestId++,
    sessionId: 1,
  });

  return {
    promise: identifiedPromise,
    reject(reason?: unknown): void {
      rejectValue?.(reason);
    },
    resolve(value: T): void {
      resolveValue?.(value);
    },
  };
}

let nextTestRequestId = 10_000;

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

function refactorAction(title: string) {
  return {
    command: null,
    data: null,
    edit: workspaceEdit("file:///project/src/user.ts", "refactored"),
    isPreferred: true,
    kind: "refactor.extract",
    title,
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
    pushEditOperations: vi.fn((_selections, edits: Array<{ text: string }>) => {
      value = edits[edits.length - 1]?.text ?? value;
    }),
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

function workspaceEditCommandPayload(path: string, model = textModel()) {
  return attachStoredJavaScriptTypeScriptDocumentAuthority(
    {
      command: {
        arguments: [],
        command: "_typescript.organizeImports",
        title: "Organize Imports",
      },
      path,
      rootPath: "/project",
      sessionId: 1,
    },
    {
      model: model as any,
      modelVersion: model.getVersionId(),
      ownerEpoch: 1,
      path,
      registrationLease: { active: true },
      rootPath: "/project",
      sessionId: 1,
      syncVersion: 1,
    },
  );
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
