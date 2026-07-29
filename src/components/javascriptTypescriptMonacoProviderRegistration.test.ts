import { describe, expect, it, vi, type Mock } from "vitest";
import type * as Monaco from "monaco-editor";
import {
  createJavaScriptTypeScriptTransientNavigationModels,
  isJavaScriptTypeScriptMonacoLanguage,
  MAX_JAVASCRIPT_TYPESCRIPT_TRANSIENT_NAVIGATION_MODELS,
  registerJavaScriptTypeScriptMonacoProviderBindings,
  type JavaScriptTypeScriptMonacoProviderBindings,
} from "./javascriptTypescriptMonacoProviderRegistration";
import { disposeUnretainedEditorRuntimeModels } from "./editorRuntimeModels";
import { monacoModelRegistry } from "./monacoModelRegistry";
import { disposeWorkspaceModels, workspaceModelUri } from "./phpMonacoDocumentContext";

const languageRegistrationNames = [
  "registerHoverProvider",
  "registerCompletionItemProvider",
  "registerSignatureHelpProvider",
  "registerDefinitionProvider",
  "registerDeclarationProvider",
  "registerImplementationProvider",
  "registerTypeDefinitionProvider",
  "registerReferenceProvider",
  "registerRenameProvider",
  "registerCodeActionProvider",
  "registerCodeLensProvider",
  "registerDocumentFormattingEditProvider",
  "registerDocumentRangeFormattingEditProvider",
  "registerOnTypeFormattingEditProvider",
  "registerInlayHintsProvider",
  "registerDocumentHighlightProvider",
  "registerDocumentSymbolProvider",
  "registerLinkProvider",
  "registerFoldingRangeProvider",
  "registerSelectionRangeProvider",
  "registerLinkedEditingRangeProvider",
  "registerDocumentSemanticTokensProvider",
  "registerDocumentRangeSemanticTokensProvider",
] as const;

const providerKeyByRegistration = {
  registerCodeActionProvider: "codeAction",
  registerCodeLensProvider: "codeLens",
  registerCompletionItemProvider: "completion",
  registerDeclarationProvider: "declaration",
  registerDefinitionProvider: "definition",
  registerDocumentFormattingEditProvider: "documentFormatting",
  registerDocumentHighlightProvider: "documentHighlight",
  registerDocumentRangeFormattingEditProvider: "documentRangeFormatting",
  registerDocumentRangeSemanticTokensProvider: "documentRangeSemanticTokens",
  registerDocumentSemanticTokensProvider: "documentSemanticTokens",
  registerDocumentSymbolProvider: "documentSymbol",
  registerFoldingRangeProvider: "foldingRange",
  registerHoverProvider: "hover",
  registerImplementationProvider: "implementation",
  registerInlayHintsProvider: "inlayHints",
  registerLinkedEditingRangeProvider: "linkedEditingRange",
  registerLinkProvider: "links",
  registerOnTypeFormattingEditProvider: "onTypeFormatting",
  registerReferenceProvider: "references",
  registerRenameProvider: "rename",
  registerSelectionRangeProvider: "selectionRange",
  registerSignatureHelpProvider: "signatureHelp",
  registerTypeDefinitionProvider: "typeDefinition",
} as const satisfies Record<
  (typeof languageRegistrationNames)[number],
  keyof JavaScriptTypeScriptMonacoProviderBindings
>;

function providerBindings(): JavaScriptTypeScriptMonacoProviderBindings {
  return {
    codeAction: {},
    codeLens: {},
    completion: {},
    declaration: {},
    definition: {},
    documentFormatting: {},
    documentHighlight: {},
    documentRangeFormatting: {},
    documentRangeSemanticTokens: {},
    documentSemanticTokens: {},
    documentSymbol: {},
    foldingRange: {},
    hover: {},
    implementation: {},
    inlayHints: {},
    linkedEditingRange: {},
    links: {},
    onTypeFormatting: {},
    references: {},
    rename: {},
    selectionRange: {},
    signatureHelp: {},
    typeDefinition: {},
    workspaceSymbols: {
      provideWorkspaceSymbols: vi.fn(async () => []),
    },
  } as unknown as JavaScriptTypeScriptMonacoProviderBindings;
}

describe("JavaScript/TypeScript Monaco provider registration", () => {
  it("reuses an open workspace model instead of creating a duplicate transient model", async () => {
    const harness = transientNavigationModelHarness();
    const controller = createJavaScriptTypeScriptTransientNavigationModels(harness.options);
    const path = "/workspace/packages/service/src/definition.ts";

    harness.registerOpenWorkspaceModel(path, "export const dirty = true;\n");
    const prepared = await controller.prepare([navigationLocation(path)], () => true, "definition");

    expect(harness.options.readFile).not.toHaveBeenCalled();
    expect(harness.createModel).not.toHaveBeenCalled();
    expect(controller.modelCount()).toBe(0);
    expect(prepared[0]?.resource).toBe(harness.options.monaco.editor.getModels()[0]?.uri);
    controller.dispose();
  });

  it("does not create a duplicate when a workspace model opens during the file read", async () => {
    let resolveRead: (content: string) => void = () => undefined;
    const harness = transientNavigationModelHarness();
    harness.options.readFile = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveRead = resolve;
        }),
    );
    const controller = createJavaScriptTypeScriptTransientNavigationModels(harness.options);
    const path = "/workspace/packages/service/src/definition.ts";
    const preparing = controller.prepare([navigationLocation(path)], () => true, "definition");

    harness.registerOpenWorkspaceModel(path, "export const dirty = true;\n");
    resolveRead("export const stale = true;\n");
    await preparing;

    expect(harness.createModel).not.toHaveBeenCalled();
    expect(controller.modelCount()).toBe(0);
    controller.dispose();
  });

  it("retires a cached transient model when its file becomes an open workspace tab", async () => {
    const harness = transientNavigationModelHarness();
    const controller = createJavaScriptTypeScriptTransientNavigationModels(harness.options);
    const path = "/workspace/packages/service/src/definition.ts";
    const location = navigationLocation(path);

    await controller.prepare([location], () => true, "definition");
    harness.registerOpenWorkspaceModel(path, "export const dirty = true;\n");
    await controller.prepare([location], () => true, "definition");

    expect(harness.createModel).toHaveBeenCalledTimes(1);
    expect(harness.models[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(controller.modelCount()).toBe(0);
    controller.dispose();
  });

  it("disposes an on-demand closed-file model when its peek closes", async () => {
    const harness = transientNavigationModelHarness();
    const controller = createJavaScriptTypeScriptTransientNavigationModels(harness.options);

    await controller.prepare(
      [navigationLocation("/workspace/packages/service/src/definition.ts")],
      () => true,
      "definition",
    );

    expect(harness.createModel).toHaveBeenCalledTimes(1);
    harness.openPeek();
    disposeUnretainedEditorRuntimeModels(harness.options.monaco, "/workspace", []);
    expect(harness.models[0]?.dispose).not.toHaveBeenCalled();
    expect(controller.modelCount()).toBe(1);
    harness.closePeek();
    expect(harness.models[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(controller.modelCount()).toBe(0);
    controller.dispose();
  });

  it("reclaims an existing transient model before replacing the active peek", async () => {
    const harness = transientNavigationModelHarness();
    const controller = createJavaScriptTypeScriptTransientNavigationModels(harness.options);
    const location = navigationLocation("/workspace/packages/service/src/definition.ts");

    await controller.prepare([location], () => true, "definition");
    harness.openPeek();
    await controller.prepare([location], () => true, "definition");
    harness.openPeek();

    expect(harness.createModel).toHaveBeenCalledTimes(1);
    expect(harness.models[0]?.dispose).not.toHaveBeenCalled();
    expect(controller.modelCount()).toBe(1);

    harness.closePeek();
    expect(harness.models[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(controller.modelCount()).toBe(0);
    controller.dispose();
  });

  it("reuses a cached transient model without rereading the full file", async () => {
    const harness = transientNavigationModelHarness();
    harness.options.readFile = vi
      .fn()
      .mockResolvedValueOnce("export const value = 1;")
      .mockResolvedValueOnce("export const value = 2;");
    const controller = createJavaScriptTypeScriptTransientNavigationModels(harness.options);
    const location = navigationLocation("/workspace/packages/service/src/definition.ts");

    await controller.prepare([location], () => true, "definition");
    await controller.prepare([location], () => true, "definition");

    expect(harness.createModel).toHaveBeenCalledTimes(1);
    expect(harness.options.readFile).toHaveBeenCalledTimes(1);
    expect(harness.models[0]?.setValue).not.toHaveBeenCalled();
    expect(harness.models[0]?.getValue()).toBe("export const value = 1;");
    controller.dispose();
  });

  it("hydrates distinct closed targets concurrently", async () => {
    const harness = transientNavigationModelHarness();
    const reads = [createDeferred<string>(), createDeferred<string>(), createDeferred<string>()];
    let readIndex = 0;
    harness.options.readFile = vi.fn((_path: string) => reads[readIndex++]!.promise);
    const controller = createJavaScriptTypeScriptTransientNavigationModels(harness.options);
    const preparing = controller.prepare(
      [
        navigationLocation("/workspace/packages/a/src/index.ts"),
        navigationLocation("/workspace/packages/b/src/index.ts"),
        navigationLocation("/workspace/packages/c/src/index.ts"),
      ],
      () => true,
      "definition",
    );

    await vi.waitFor(() => expect(harness.options.readFile).toHaveBeenCalledTimes(3));
    for (const read of reads) {
      read.resolve("export const value = 1;");
    }
    await preparing;

    expect(controller.modelCount()).toBe(3);
    controller.dispose();
  });

  it("returns only targets that were actually hydrated within the model cap", async () => {
    const harness = transientNavigationModelHarness();
    const controller = createJavaScriptTypeScriptTransientNavigationModels(harness.options);
    const locations = Array.from(
      { length: MAX_JAVASCRIPT_TYPESCRIPT_TRANSIENT_NAVIGATION_MODELS + 3 },
      (_, index) => navigationLocation(`/workspace/packages/package-${index}/src/index.ts`),
    );

    const prepared = await controller.prepare(locations, () => true, "references");

    expect(prepared.map(({ location }) => location)).toEqual(
      locations.slice(0, MAX_JAVASCRIPT_TYPESCRIPT_TRANSIENT_NAVIGATION_MODELS),
    );
    expect(controller.modelCount()).toBe(MAX_JAVASCRIPT_TYPESCRIPT_TRANSIENT_NAVIGATION_MODELS);
    controller.dispose();
  });

  it("does not evict an early target from the same parallel preparation batch", async () => {
    const harness = transientNavigationModelHarness();
    const controller = createJavaScriptTypeScriptTransientNavigationModels(harness.options);
    const cachedLocations = Array.from({ length: 4 }, (_, index) =>
      navigationLocation(`/workspace/cached/package-${index}/index.ts`),
    );
    for (const location of cachedLocations) {
      await controller.prepare([location], () => true, "definition");
    }
    const batch = Array.from(
      { length: MAX_JAVASCRIPT_TYPESCRIPT_TRANSIENT_NAVIGATION_MODELS },
      (_, index) => navigationLocation(`/workspace/batch/package-${index}/index.ts`),
    );

    const prepared = await controller.prepare(batch, () => true, "references");

    expect(prepared.map(({ location }) => location)).toEqual(batch);
    expect(controller.modelCount()).toBe(MAX_JAVASCRIPT_TYPESCRIPT_TRANSIENT_NAVIGATION_MODELS);
    expect(harness.models.slice(0, 4).every((model) => model.dispose.mock.calls.length === 1)).toBe(
      true,
    );
    expect(harness.models.slice(4).every((model) => model.dispose.mock.calls.length === 0)).toBe(
      true,
    );
    controller.dispose();
  });

  it("keeps readable targets when another target fails to hydrate", async () => {
    const harness = transientNavigationModelHarness();
    const readable = navigationLocation("/workspace/packages/readable/index.ts");
    const unreadable = navigationLocation("/workspace/packages/unreadable/index.ts");
    harness.options.readFile = vi.fn(async (path: string) => {
      if (path.includes("/unreadable/")) {
        throw new Error("permission denied");
      }
      return "export const readable = true;";
    });
    const controller = createJavaScriptTypeScriptTransientNavigationModels(harness.options);

    const prepared = await controller.prepare([unreadable, readable], () => true, "references");

    expect(prepared.map(({ location }) => location)).toEqual([readable]);
    expect(controller.modelCount()).toBe(1);
    controller.dispose();
  });

  it("retains a transient model across runtime cleanup until its controller releases it", async () => {
    const harness = transientNavigationModelHarness();
    const controller = createJavaScriptTypeScriptTransientNavigationModels(harness.options);
    const location = navigationLocation("/workspace/packages/service/src/definition.ts");

    await controller.prepare([location], () => true, "definition");
    disposeUnretainedEditorRuntimeModels(harness.options.monaco, "/workspace", []);

    expect(controller.modelCount()).toBe(1);
    expect(harness.models[0]?.dispose).not.toHaveBeenCalled();

    await controller.prepare([location], () => true, "definition");

    expect(harness.createModel).toHaveBeenCalledTimes(1);
    expect(controller.modelCount()).toBe(1);
    controller.dispose();
    expect(harness.models[0]?.dispose).toHaveBeenCalledTimes(1);
  });

  it("lets forced workspace teardown invalidate a pending lease before A returns", async () => {
    const harness = transientNavigationModelHarness();
    const controller = createJavaScriptTypeScriptTransientNavigationModels(harness.options);
    const location = navigationLocation("/workspace/packages/service/src/recreated.ts");

    await controller.prepare([location], () => true, "definition");
    disposeWorkspaceModels(harness.options.monaco, "/workspace");

    expect(harness.models[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(controller.modelCount()).toBe(0);

    await controller.prepare([location], () => true, "definition");
    expect(harness.createModel).toHaveBeenCalledTimes(2);
    expect(controller.modelCount()).toBe(1);
    expect(harness.models[1]?.dispose).not.toHaveBeenCalled();
    controller.dispose();
    expect(harness.models[1]?.dispose).toHaveBeenCalledTimes(1);
  });

  it("keeps a shared transient alive until the final controller lease releases", async () => {
    const harness = transientNavigationModelHarness();
    const firstController = createJavaScriptTypeScriptTransientNavigationModels(harness.options);
    const secondController = createJavaScriptTypeScriptTransientNavigationModels(harness.options);
    const location = navigationLocation("/workspace/packages/service/src/shared.ts");

    await firstController.prepare([location], () => true, "references");
    await secondController.prepare([location], () => true, "references");
    expect(harness.createModel).toHaveBeenCalledTimes(1);
    expect(firstController.modelCount()).toBe(1);
    expect(secondController.modelCount()).toBe(1);

    firstController.dispose();
    expect(harness.models[0]?.dispose).not.toHaveBeenCalled();
    disposeUnretainedEditorRuntimeModels(harness.options.monaco, "/workspace", []);
    expect(harness.models[0]?.dispose).not.toHaveBeenCalled();

    secondController.dispose();
    expect(harness.models[0]?.dispose).toHaveBeenCalledTimes(1);
  });

  it("hands an editor-attached transient back to runtime retention on controller teardown", async () => {
    const harness = transientNavigationModelHarness();
    const controller = createJavaScriptTypeScriptTransientNavigationModels(harness.options);
    const path = "/workspace/packages/service/src/adopted.ts";

    await controller.prepare([navigationLocation(path)], () => true, "definition");
    harness.models[0]?.setAttachedToEditor(true);
    controller.dispose();
    await Promise.resolve();

    expect(harness.models[0]?.dispose).not.toHaveBeenCalled();
    disposeUnretainedEditorRuntimeModels(harness.options.monaco, "/workspace", []);
    expect(harness.models[0]?.dispose).not.toHaveBeenCalled();

    harness.models[0]?.setAttachedToEditor(false);
    disposeUnretainedEditorRuntimeModels(harness.options.monaco, "/workspace", []);
    expect(harness.models[0]?.dispose).toHaveBeenCalledTimes(1);
  });

  it("preserves an inactive adopted tab through exact runtime retain paths", async () => {
    const harness = transientNavigationModelHarness();
    const controller = createJavaScriptTypeScriptTransientNavigationModels(harness.options);
    const path = "/workspace/packages/service/src/inactive.ts";
    const retentionPublisher = monacoModelRegistry(
      harness.options.monaco,
    ).createRuntimeRetentionPublisher();

    await controller.prepare([navigationLocation(path)], () => true, "definition");
    disposeUnretainedEditorRuntimeModels(
      harness.options.monaco,
      "/workspace",
      [{ activePath: null, retainPaths: [path] }],
      new WeakSet(),
      retentionPublisher,
    );
    harness.models[0]?.setAttachedToEditor(false);
    controller.dispose();

    expect(harness.models[0]?.dispose).not.toHaveBeenCalled();
    disposeUnretainedEditorRuntimeModels(
      harness.options.monaco,
      "/workspace",
      [{ activePath: null, retainPaths: [path] }],
      new WeakSet(),
      retentionPublisher,
    );
    expect(harness.models[0]?.dispose).not.toHaveBeenCalled();

    disposeUnretainedEditorRuntimeModels(
      harness.options.monaco,
      "/workspace",
      [],
      new WeakSet(),
      retentionPublisher,
    );
    expect(harness.models[0]?.dispose).toHaveBeenCalledTimes(1);
    retentionPublisher.release();
  });

  it("keeps 100 transient model leases bounded and releases every eviction", async () => {
    const harness = transientNavigationModelHarness();
    const controller = createJavaScriptTypeScriptTransientNavigationModels(harness.options);
    const locations = Array.from({ length: 100 }, (_, index) =>
      navigationLocation(`/workspace/packages/package-${index}/src/index.ts`),
    );

    for (const location of locations) {
      await controller.prepare([location], () => true, "definition");
    }

    expect(controller.modelCount()).toBe(MAX_JAVASCRIPT_TYPESCRIPT_TRANSIENT_NAVIGATION_MODELS);
    expect(harness.models).toHaveLength(100);
    expect(harness.models.filter((model) => !model.dispose.mock.calls.length)).toHaveLength(
      MAX_JAVASCRIPT_TYPESCRIPT_TRANSIENT_NAVIGATION_MODELS,
    );
    disposeUnretainedEditorRuntimeModels(harness.options.monaco, "/workspace", []);
    expect(harness.models.filter((model) => !model.dispose.mock.calls.length)).toHaveLength(
      MAX_JAVASCRIPT_TYPESCRIPT_TRANSIENT_NAVIGATION_MODELS,
    );
    controller.dispose();
    expect(harness.models.every((model) => model.dispose.mock.calls.length === 1)).toBe(true);
  });

  it("evicts unprotected transient models in FIFO order", async () => {
    const harness = transientNavigationModelHarness();
    const controller = createJavaScriptTypeScriptTransientNavigationModels(harness.options);
    const locations = Array.from(
      { length: MAX_JAVASCRIPT_TYPESCRIPT_TRANSIENT_NAVIGATION_MODELS + 2 },
      (_, index) => navigationLocation(`/workspace/packages/package-${index}/src/index.ts`),
    );

    for (const location of locations) {
      await controller.prepare([location], () => true, "definition");
    }

    expect(harness.models[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(harness.models[1]?.dispose).toHaveBeenCalledTimes(1);
    expect(harness.models.slice(2).every((model) => model.dispose.mock.calls.length === 0)).toBe(
      true,
    );
    controller.dispose();
  });

  it("does not evict the transient model displayed in the peek widget", async () => {
    const harness = transientNavigationModelHarness();
    const controller = createJavaScriptTypeScriptTransientNavigationModels(harness.options);
    const locations = Array.from(
      { length: MAX_JAVASCRIPT_TYPESCRIPT_TRANSIENT_NAVIGATION_MODELS + 1 },
      (_, index) => navigationLocation(`/workspace/packages/package-${index}/src/index.ts`),
    );

    await controller.prepare([locations[0]!], () => true, "definition");
    harness.openPeek();
    await controller.prepare([locations[0]!], () => true, "definition");
    for (const location of locations.slice(1)) {
      await controller.prepare([location], () => true, "definition");
    }

    expect(harness.models[0]?.dispose).not.toHaveBeenCalled();
    expect(harness.models[1]?.dispose).toHaveBeenCalledTimes(1);
    expect(controller.modelCount()).toBe(MAX_JAVASCRIPT_TYPESCRIPT_TRANSIENT_NAVIGATION_MODELS);
    controller.dispose();
  });

  it("routes Monaco's built-in cross-file definition open through the custom opener", async () => {
    const openDefinition = vi.fn();
    const harness = transientNavigationModelHarness({ openDefinition });
    const controller = createJavaScriptTypeScriptTransientNavigationModels(harness.options);
    const path = "/workspace/packages/service/src/definition.ts";

    await controller.prepare([navigationLocation(path)], () => true, "definition");

    expect(harness.models[0]?.uri.toString()).toBe(workspaceModelUri("/workspace", path));
    await expect(harness.openCodeEditor(path)).resolves.toBe(true);
    expect(openDefinition).toHaveBeenCalledTimes(1);
    controller.dispose();
    expect(harness.models[0]?.dispose).not.toHaveBeenCalled();

    disposeUnretainedEditorRuntimeModels(harness.options.monaco, "/workspace", [
      { activePath: path, retainPaths: [] },
    ]);
    expect(harness.models[0]?.dispose).not.toHaveBeenCalled();
    disposeUnretainedEditorRuntimeModels(harness.options.monaco, "/workspace", []);
    expect(harness.models[0]?.dispose).toHaveBeenCalledTimes(1);
  });

  it("routes an already-open legacy file resource through the exact definition opener", async () => {
    const openDefinition = vi.fn();
    const harness = transientNavigationModelHarness({ openDefinition });
    const controller = createJavaScriptTypeScriptTransientNavigationModels(harness.options);
    const path = "/workspace/packages/service/src/legacy.ts";
    harness.registerOpenLegacyModel(path, "export const legacy = true;");

    const prepared = await controller.prepare([navigationLocation(path)], () => true, "definition");

    expect(prepared[0]?.resource?.toString()).toBe(`file://${path}`);
    await expect(
      harness.openCodeEditor(
        path,
        {
          endColumn: 2,
          endLineNumber: 1,
          startColumn: 1,
          startLineNumber: 1,
        },
        `file://${path}`,
      ),
    ).resolves.toBe(true);
    expect(openDefinition).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it("does not hijack the selected target from a multi-definition peek", async () => {
    const openDefinition = vi.fn();
    const harness = transientNavigationModelHarness({ openDefinition });
    const controller = createJavaScriptTypeScriptTransientNavigationModels(harness.options);
    const firstPath = "/workspace/packages/a/src/definition.ts";
    const secondPath = "/workspace/packages/b/src/definition.ts";

    await controller.prepare(
      [navigationLocation(firstPath), navigationLocation(secondPath)],
      () => true,
      "definition",
    );

    await expect(harness.openCodeEditor(firstPath)).resolves.toBe(false);
    expect(openDefinition).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("does not intercept a later unrelated open to the same definition URI", async () => {
    const openDefinition = vi.fn();
    const harness = transientNavigationModelHarness({ openDefinition });
    const controller = createJavaScriptTypeScriptTransientNavigationModels(harness.options);
    const path = "/workspace/packages/service/src/definition.ts";

    await controller.prepare([navigationLocation(path)], () => true, "definition");
    await new Promise((resolve) => setTimeout(resolve, 0));

    await expect(harness.openCodeEditor(path)).resolves.toBe(false);
    expect(openDefinition).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("requires the exact definition range before consuming the one-shot opener", async () => {
    const openDefinition = vi.fn();
    const harness = transientNavigationModelHarness({ openDefinition });
    const controller = createJavaScriptTypeScriptTransientNavigationModels(harness.options);
    const path = "/workspace/packages/service/src/definition.ts";

    await controller.prepare([navigationLocation(path)], () => true, "definition");

    await expect(
      harness.openCodeEditor(path, {
        endColumn: 3,
        endLineNumber: 1,
        startColumn: 2,
        startLineNumber: 1,
      }),
    ).resolves.toBe(false);
    await expect(harness.openCodeEditor(path)).resolves.toBe(true);
    await expect(harness.openCodeEditor(path)).resolves.toBe(false);
    expect(openDefinition).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it("publishes no model or opener after an A-B-A owner generation change", async () => {
    const read = createDeferred<string>();
    const openDefinition = vi.fn();
    const harness = transientNavigationModelHarness({ openDefinition });
    harness.options.readFile = vi.fn(() => read.promise);
    const controller = createJavaScriptTypeScriptTransientNavigationModels(harness.options);
    let ownerGeneration = 1;
    const capturedGeneration = ownerGeneration;
    const isCurrent = () => ownerGeneration === capturedGeneration;
    const path = "/workspace/packages/service/src/definition.ts";
    const preparing = controller.prepare([navigationLocation(path)], isCurrent, "definition");

    ownerGeneration = 2;
    ownerGeneration = 3;
    read.resolve("export const stale = true;");
    await preparing;

    expect(controller.modelCount()).toBe(0);
    await expect(harness.openCodeEditor(path)).resolves.toBe(false);
    expect(openDefinition).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("does not create a model after its surface is disposed during the bounded read", async () => {
    let resolveRead: (content: string) => void = () => undefined;
    const harness = transientNavigationModelHarness();
    harness.options.readFile = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveRead = resolve;
        }),
    );
    const controller = createJavaScriptTypeScriptTransientNavigationModels(harness.options);
    const preparing = controller.prepare(
      [navigationLocation("/workspace/packages/service/src/late.ts")],
      () => true,
      "definition",
    );

    controller.dispose();
    resolveRead("export const late = true;");
    await preparing;

    expect(harness.createModel).not.toHaveBeenCalled();
    expect(controller.modelCount()).toBe(0);
  });

  it("registers every binding for every supported language with disposable ownership", () => {
    const dispose = vi.fn();
    const receivers: unknown[] = [];
    const languages = Object.fromEntries(
      languageRegistrationNames.map((name) => [
        name,
        vi.fn(function (this: unknown, _language: string, _provider: unknown, _metadata?: unknown) {
          receivers.push(this);
          return { dispose };
        }),
      ]),
    );
    const registerWorkspaceSymbolProvider = vi.fn(() => ({ dispose }));
    const monaco = {
      languages: {
        ...languages,
        registerWorkspaceSymbolProvider,
      },
    } as unknown as typeof Monaco;
    const providers = providerBindings();

    const disposables = registerJavaScriptTypeScriptMonacoProviderBindings(monaco, providers);

    expect(registerWorkspaceSymbolProvider).toHaveBeenCalledWith(providers.workspaceSymbols);
    expect(disposables).toHaveLength(1 + languageRegistrationNames.length * 5);
    for (const name of languageRegistrationNames) {
      expect(languages[name]).toHaveBeenCalledTimes(5);
      expect(languages[name].mock.calls.map(([language]) => language)).toEqual([
        "javascript",
        "typescript",
        "javascriptreact",
        "typescriptreact",
        "vue",
      ]);
      expect(
        languages[name].mock.calls.every(
          ([, provider]) => provider === providers[providerKeyByRegistration[name]],
        ),
      ).toBe(true);
    }
    expect(receivers.every((receiver) => receiver === monaco.languages)).toBe(true);
    expect(languages.registerCodeActionProvider).toHaveBeenCalledWith(
      "javascript",
      providers.codeAction,
      {
        providedCodeActionKinds: [
          "quickfix",
          "refactor",
          "refactor.move",
          "source",
          "source.fixAll",
          "source.fixAll.ts",
          "source.addMissingImports.ts",
          "source.organizeImports",
          "source.organizeImports.ts",
          "source.removeUnused.ts",
          "source.removeUnusedImports.ts",
          "source.sortImports.ts",
        ],
      },
    );
    disposables.forEach((disposable) => disposable.dispose());
    expect(dispose).toHaveBeenCalledTimes(disposables.length);
  });

  it("skips unavailable optional Monaco registries without fabricating disposables", () => {
    const monaco = { languages: {} } as unknown as typeof Monaco;

    expect(registerJavaScriptTypeScriptMonacoProviderBindings(monaco, providerBindings())).toEqual(
      [],
    );
  });

  it("recognizes only the exact JS/TS provider language set", () => {
    expect(
      ["javascript", "typescript", "javascriptreact", "typescriptreact", "vue"].every(
        isJavaScriptTypeScriptMonacoLanguage,
      ),
    ).toBe(true);
    expect(isJavaScriptTypeScriptMonacoLanguage("php")).toBe(false);
    expect(isJavaScriptTypeScriptMonacoLanguage("JavaScript")).toBe(false);
  });
});

function navigationLocation(path: string) {
  return {
    range: {
      end: { character: 1, line: 0 },
      start: { character: 0, line: 0 },
    },
    uri: `file://${path}`,
  };
}

function transientNavigationModelHarness({
  openDefinition = vi.fn(),
}: {
  openDefinition?: () => void;
} = {}) {
  const models: Array<{
    dispose: Mock<() => void>;
    getValue: Mock<() => string>;
    isAttachedToEditor: Mock<() => boolean>;
    onWillDispose: (listener: () => void) => { dispose: Mock<() => void> };
    setAttachedToEditor: (attached: boolean) => void;
    setValue: Mock<(value: string) => void>;
    uri: { toString(): string };
  }> = [];
  const byUri = new Map<string, (typeof models)[number]>();
  let closeListener: (() => void) | null = null;
  const referencesController = {
    _widget: undefined as
      | {
          onDidClose(listener: () => void): { dispose(): void };
        }
      | undefined,
    toggleWidget: vi.fn(function (this: typeof referencesController) {
      closeListener?.();
      const widget = {
        onDidClose: vi.fn((listener: () => void) => {
          closeListener = listener;
          return {
            dispose: vi.fn(() => {
              if (closeListener === listener) {
                closeListener = null;
              }
            }),
          };
        }),
      };
      this._widget = widget;
    }),
  };
  const createModel = vi.fn(
    (_content: string, _language: string | undefined, uri: { toString(): string }) => {
      let content = _content;
      let attachedToEditor = false;
      const disposeListeners = new Set<() => void>();
      const model = {
        dispose: vi.fn(() => {
          disposeListeners.forEach((listener) => listener());
          disposeListeners.clear();
          byUri.delete(uri.toString());
        }),
        getValue: vi.fn(() => content),
        isAttachedToEditor: vi.fn(() => attachedToEditor),
        onWillDispose: (listener: () => void) => {
          disposeListeners.add(listener);
          return {
            dispose: vi.fn(() => {
              disposeListeners.delete(listener);
            }),
          };
        },
        setAttachedToEditor: (attached: boolean) => {
          attachedToEditor = attached;
        },
        setValue: vi.fn((value: string) => {
          content = value;
        }),
        uri,
      };
      models.push(model);
      byUri.set(uri.toString(), model);
      return model;
    },
  );
  const monaco = {
    editor: {
      createModel,
      getModel: vi.fn((uri: { toString(): string }) => byUri.get(uri.toString()) ?? null),
      getModels: vi.fn(() => [...byUri.values()]),
      registerEditorOpener: vi.fn(
        (opener: {
          openCodeEditor(
            source: unknown,
            resource: { toString(): string },
            selectionOrPosition?: Monaco.IRange | Monaco.IPosition,
          ): boolean | Promise<boolean>;
        }) => {
          editorOpener = opener;
          return { dispose: vi.fn() };
        },
      ),
    },
    Uri: {
      file: (path: string) => ({
        fsPath: path,
        path,
        toString: () => `file://${path}`,
      }),
      parse: (uri: string) => ({
        toString: () => uri,
      }),
    },
  };
  const editor = {
    getContribution: () => referencesController,
  } as unknown as Pick<Monaco.editor.ICodeEditor, "getContribution">;
  let editorOpener:
    | {
        openCodeEditor(
          source: unknown,
          resource: { toString(): string },
          selectionOrPosition?: Monaco.IRange | Monaco.IPosition,
        ): boolean | Promise<boolean>;
      }
    | undefined;

  return {
    closePeek: () => closeListener?.(),
    createModel,
    models,
    openCodeEditor: async (
      path: string,
      selectionOrPosition: Monaco.IRange | Monaco.IPosition = {
        endColumn: 2,
        endLineNumber: 1,
        startColumn: 1,
        startLineNumber: 1,
      },
      resource = workspaceModelUri("/workspace", path)!,
    ) =>
      Boolean(
        await editorOpener?.openCodeEditor(
          editor,
          {
            toString: () => resource,
          },
          selectionOrPosition,
        ),
      ),
    openPeek: () => referencesController.toggleWidget(),
    registerOpenLegacyModel: (path: string, content: string) => {
      const uri = `file://${path}`;
      const legacyUri = {
        fsPath: path,
        path,
        toString: () => uri,
      };
      byUri.set(uri, {
        dispose: vi.fn(),
        getValue: vi.fn(() => content),
        isAttachedToEditor: vi.fn(() => true),
        onWillDispose: () => ({ dispose: vi.fn() }),
        setAttachedToEditor: () => undefined,
        setValue: vi.fn(),
        uri: legacyUri,
      });
    },
    registerOpenWorkspaceModel: (path: string, content: string) => {
      const uri = workspaceModelUri("/workspace", path)!;
      byUri.set(uri, {
        dispose: vi.fn(),
        getValue: vi.fn(() => content),
        isAttachedToEditor: vi.fn(() => true),
        onWillDispose: () => ({ dispose: vi.fn() }),
        setAttachedToEditor: () => undefined,
        setValue: vi.fn(),
        uri: { toString: () => uri },
      });
    },
    options: {
      editor,
      monaco: monaco as unknown as typeof Monaco,
      openDefinition,
      readFile: vi.fn(async (_path: string) => "export const value = 1;"),
      workspaceRoot: "/workspace",
    },
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
