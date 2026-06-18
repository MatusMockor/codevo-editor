import { describe, expect, it, vi } from "vitest";
import type {
  LanguageServerFeaturesGateway,
  LanguageServerRange,
} from "../domain/languageServerFeatures";
import type {
  LanguageServerCapabilities,
  LanguageServerRuntimeStatus,
} from "../domain/languageServerRuntime";
import type { EditorDocument } from "../domain/workspace";
import {
  registerJavaScriptTypeScriptLanguageServerMonacoProviders,
  type JavaScriptTypeScriptLanguageServerProviderContext,
} from "./javascriptTypescriptLanguageServerMonacoProviders";

describe("registerJavaScriptTypeScriptLanguageServerMonacoProviders", () => {
  it("registers VS Code-like navigation, actions, rename and formatting providers", () => {
    const monaco = createMonaco();
    const disposable = registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext(),
    );

    expect(monaco.languages.registerHoverProvider).toHaveBeenCalledTimes(2);
    expect(monaco.languages.registerCompletionItemProvider).toHaveBeenCalledTimes(2);
    expect(monaco.languages.registerDefinitionProvider).toHaveBeenCalledTimes(2);
    expect(monaco.languages.registerImplementationProvider).toHaveBeenCalledTimes(2);
    expect(monaco.languages.registerSignatureHelpProvider).toHaveBeenCalledTimes(2);
    expect(monaco.languages.registerReferenceProvider).toHaveBeenCalledTimes(2);
    expect(monaco.languages.registerRenameProvider).toHaveBeenCalledTimes(2);
    expect(monaco.languages.registerCodeActionProvider).toHaveBeenCalledTimes(2);
    expect(
      monaco.languages.registerDocumentFormattingEditProvider,
    ).toHaveBeenCalledTimes(2);
    expect(
      monaco.languages.registerDocumentRangeFormattingEditProvider,
    ).toHaveBeenCalledTimes(2);
    expect(monaco.languages.registerInlayHintsProvider).toHaveBeenCalledTimes(2);
    expect(monaco.languages.registerDocumentHighlightProvider).toHaveBeenCalledTimes(2);
    expect(monaco.languages.registerLinkProvider).toHaveBeenCalledTimes(2);
    expect(monaco.languages.registerSelectionRangeProvider).toHaveBeenCalledTimes(2);

    disposable.dispose();

    expect(monaco.dispose).toHaveBeenCalledTimes(29);
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
    const highlights = await highlightProvider.provideDocumentHighlights(model, {
      column: 9,
      lineNumber: 4,
    });

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
      inlayHints: [
        {
          kind: 1,
          label: ": Account",
          paddingLeft: true,
          paddingRight: false,
          position: {
            character: 10,
            line: 0,
          },
          tooltip: "Inferred type",
        },
      ],
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
            message: "Cannot find name",
            range: range(0, 0, 0, 4),
            severity: 1,
            source: "typescript",
          },
        ],
        only: ["quickfix"],
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
            {
              command: commandOnlyAction.command,
              rootPath: "/project",
            },
          ],
          id: "mockor.javascriptTypeScript.executeLanguageServerCommand",
        }),
        kind: "quickfix",
        title: "Fix all unused identifiers",
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
          tooltip: "Inferred type",
        },
      ],
    });

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
            detail: "function loadUser(id: string): Promise<User>",
            documentation: "Loads a user.",
            filterText: "loadUser",
            insertText: "loadUser(${1:id})",
            insertTextFormat: 2,
            kind: 3,
            label: "loadUser",
            preselect: true,
            sortText: "11",
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
        label: "loadUser",
        preselect: true,
        range: expect.objectContaining({
          endColumn: 6,
          endLineNumber: 2,
          startColumn: 3,
          startLineNumber: 2,
        }),
        sortText: "11",
      }),
    );
    expect(result.incomplete).toBe(true);
  });

  it("resolves TypeScript completion items through the language server", async () => {
    const monaco = createMonaco();
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
        insertText: "loadUser(${1:id})",
        insertTextRules: 4,
      }),
    );
  });

  it("applies server-initiated workspace edits for the active workspace only", async () => {
    const monaco = createMonaco();
    const model = textModel();
    const unsubscribe = vi.fn();
    const workspaceEditGateway = {
      subscribeWorkspaceEdits: vi.fn(async (listener) => {
        listener({
          edit: workspaceEdit("file:///project/src/user.ts", "Applied"),
          label: "Organize imports",
          rootPath: "/project",
          sessionId: 1,
        });
        listener({
          edit: workspaceEdit("file:///other/src/user.ts", "Ignored"),
          label: "Other project",
          rootPath: "/other",
          sessionId: 1,
        });
        return unsubscribe;
      }),
    };
    monaco.editor.getModels.mockReturnValue([model]);

    const disposable = registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monaco as any,
      providerContext({ workspaceEditGateway }),
    );
    await Promise.resolve();

    expect(model.pushEditOperations).toHaveBeenCalledTimes(1);
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

    disposable.dispose();

    expect(unsubscribe).toHaveBeenCalled();
  });
});

function providerContext(
  overrides: Partial<JavaScriptTypeScriptLanguageServerProviderContext> = {},
): JavaScriptTypeScriptLanguageServerProviderContext {
  return {
    featuresGateway: overrides.featuresGateway ?? featuresGateway(),
    flushPendingDocumentChange:
      overrides.flushPendingDocumentChange ?? vi.fn(async () => undefined),
    getActiveDocument: overrides.getActiveDocument ?? (() => document()),
    getRuntimeStatus: overrides.getRuntimeStatus ?? (() => runningStatus()),
    getWorkspaceRoot: overrides.getWorkspaceRoot ?? (() => "/project"),
    reportError: overrides.reportError ?? vi.fn(),
    workspaceEditGateway: overrides.workspaceEditGateway,
  };
}

function featuresGateway(
  responses: Partial<{
    codeActions: Awaited<ReturnType<LanguageServerFeaturesGateway["codeActions"]>>;
    completion: Awaited<ReturnType<LanguageServerFeaturesGateway["completion"]>>;
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
    inlayHints: Awaited<ReturnType<LanguageServerFeaturesGateway["inlayHints"]>>;
    references: Awaited<ReturnType<LanguageServerFeaturesGateway["references"]>>;
    rangeFormatting: Awaited<
      ReturnType<LanguageServerFeaturesGateway["rangeFormatting"]>
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
    resolvedCodeAction: Awaited<
      ReturnType<LanguageServerFeaturesGateway["resolveCodeAction"]>
    >;
    resolvedCompletionItem: Awaited<
      ReturnType<LanguageServerFeaturesGateway["resolveCompletionItem"]>
    >;
    resolvedDocumentLink: Awaited<
      ReturnType<LanguageServerFeaturesGateway["resolveDocumentLink"]>
    >;
  }> = {},
): LanguageServerFeaturesGateway {
  return {
    codeActions: vi.fn(async () => responses.codeActions ?? []),
    completion: vi.fn(
      async () =>
        responses.completion ?? {
          isIncomplete: false,
          items: [],
        },
    ),
    definition: vi.fn(async () => []),
    documentHighlights: vi.fn(
      async () => responses.documentHighlights ?? [],
    ),
    documentLinks: vi.fn(async () => responses.documentLinks ?? []),
    documentSymbols: vi.fn(async () => responses.documentSymbols ?? []),
    executeCommand: vi.fn(async () => responses.executeCommandEdit ?? null),
    formatting: vi.fn(async () => responses.formatting ?? []),
    hover: vi.fn(async () => null),
    implementation: vi.fn(async () => []),
    inlayHints: vi.fn(async () => responses.inlayHints ?? []),
    rangeFormatting: vi.fn(async () => responses.rangeFormatting ?? []),
    references: vi.fn(async () => responses.references ?? []),
    rename: vi.fn(async () => responses.rename ?? null),
    selectionRanges: vi.fn(async () => responses.selectionRanges ?? []),
    signatureHelp: vi.fn(async () => responses.signatureHelp ?? null),
    workspaceSymbols: vi.fn(async () => responses.workspaceSymbols ?? []),
    resolveCompletionItem: vi.fn(
      async (_rootPath, item) => responses.resolvedCompletionItem ?? item,
    ),
    resolveCodeAction: vi.fn(
      async (_rootPath, action) => responses.resolvedCodeAction ?? action,
    ),
    resolveDocumentLink: vi.fn(
      async (_rootPath, link) => responses.resolvedDocumentLink ?? link,
    ),
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
    content: "const user = account;",
    language: "typescript",
    name: "user.ts",
    path: "/project/src/user.ts",
    savedContent: "const user = account;",
  };
}

function textModel() {
  return {
    getVersionId: vi.fn(() => 7),
    getWordUntilPosition: vi.fn(() => ({
      endColumn: 5,
      startColumn: 1,
    })),
    pushEditOperations: vi.fn(),
    uri: {
      fsPath: "/project/src/user.ts",
      path: "/project/src/user.ts",
    },
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
      getModels: vi.fn((): any[] => []),
    },
    languages: {
      CodeActionTriggerType: { Invoke: 1 },
      CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
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
      DocumentHighlightKind: {
        Read: 1,
        Text: 0,
        Write: 2,
      },
      InlayHintKind: {
        Parameter: 2,
        Type: 1,
      },
      registerCodeActionProvider: vi.fn(() => disposable()),
      registerCompletionItemProvider: vi.fn(() => disposable()),
      registerDefinitionProvider: vi.fn(() => disposable()),
      registerDocumentHighlightProvider: vi.fn(() => disposable()),
      registerDocumentFormattingEditProvider: vi.fn(() => disposable()),
      registerDocumentRangeFormattingEditProvider: vi.fn(() => disposable()),
      registerHoverProvider: vi.fn(() => disposable()),
      registerImplementationProvider: vi.fn(() => disposable()),
      registerInlayHintsProvider: vi.fn(() => disposable()),
      registerLinkProvider: vi.fn(() => disposable()),
      registerReferenceProvider: vi.fn(() => disposable()),
      registerRenameProvider: vi.fn(() => disposable()),
      registerSelectionRangeProvider: vi.fn(() => disposable()),
      registerSignatureHelpProvider: vi.fn(() => disposable()),
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
