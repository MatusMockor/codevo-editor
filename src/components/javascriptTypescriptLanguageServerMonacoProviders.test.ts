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

    expect(monaco.languages.registerHoverProvider).toHaveBeenCalledTimes(4);
    expect(monaco.languages.registerCompletionItemProvider).toHaveBeenCalledTimes(4);
    expect(monaco.languages.registerDefinitionProvider).toHaveBeenCalledTimes(4);
    expect(monaco.languages.registerImplementationProvider).toHaveBeenCalledTimes(4);
    expect(monaco.languages.registerTypeDefinitionProvider).toHaveBeenCalledTimes(4);
    expect(monaco.languages.registerSignatureHelpProvider).toHaveBeenCalledTimes(4);
    expect(monaco.languages.registerReferenceProvider).toHaveBeenCalledTimes(4);
    expect(monaco.languages.registerRenameProvider).toHaveBeenCalledTimes(4);
    expect(monaco.languages.registerCodeActionProvider).toHaveBeenCalledTimes(4);
    expect(
      monaco.languages.registerDocumentFormattingEditProvider,
    ).toHaveBeenCalledTimes(4);
    expect(
      monaco.languages.registerDocumentRangeFormattingEditProvider,
    ).toHaveBeenCalledTimes(4);
    expect(
      monaco.languages.registerOnTypeFormattingEditProvider,
    ).toHaveBeenCalledTimes(4);
    expect(monaco.languages.registerInlayHintsProvider).toHaveBeenCalledTimes(4);
    expect(monaco.languages.registerDocumentHighlightProvider).toHaveBeenCalledTimes(4);
    expect(monaco.languages.registerLinkProvider).toHaveBeenCalledTimes(4);
    expect(monaco.languages.registerFoldingRangeProvider).toHaveBeenCalledTimes(4);
    expect(monaco.languages.registerSelectionRangeProvider).toHaveBeenCalledTimes(4);
    expect(monaco.languages.registerLinkedEditingRangeProvider).toHaveBeenCalledTimes(4);
    expect(monaco.languages.registerCodeLensProvider).toHaveBeenCalledTimes(4);
    expect(
      monaco.languages.registerDocumentSemanticTokensProvider,
    ).toHaveBeenCalledTimes(4);
    expect(
      (monaco.languages.registerCompletionItemProvider as any).mock.calls.map(
        ([language]: [string]) => language,
      ),
    ).toEqual([
      "javascript",
      "typescript",
      "javascriptreact",
      "typescriptreact",
    ]);
    expect(
      (monaco.languages.registerCompletionItemProvider as any).mock.calls[0][1]
        .triggerCharacters,
    ).toEqual([".", "'", "\"", "`", "/", "@", "<", "#"]);

    disposable.dispose();

    expect(monaco.dispose).toHaveBeenCalledTimes(81);
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
        insertText: "useUser()$0",
        kind: 3,
        label: "useUser",
      }),
    );
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

  it("maps TypeScript type definitions through the language server", async () => {
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

  it("maps TypeScript semantic tokens through the language server", async () => {
    const monaco = createMonaco();
    const gateway = featuresGateway({
      semanticTokens: {
        data: [0, 6, 4, 8, 0, 1, 2, 3, 9, 1],
        resultId: "semantic-1",
      },
    });
    const context = providerContext({ featuresGateway: gateway });
    registerJavaScriptTypeScriptLanguageServerMonacoProviders(monaco as any, context);
    const model = textModel();

    const semanticTokensProvider = (
      monaco.languages.registerDocumentSemanticTokensProvider as any
    ).mock.calls[0][1];
    const tokens = await semanticTokensProvider.provideDocumentSemanticTokens(
      model,
      null,
    );

    expect(semanticTokensProvider.getLegend()).toEqual({
      tokenModifiers: expect.arrayContaining(["readonly", "static"]),
      tokenTypes: expect.arrayContaining(["class", "method", "variable"]),
    });
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

  it("keeps the cursor inside generic TypeScript function completions with parameters", async () => {
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
        command: {
          id: "editor.action.triggerParameterHints",
          title: "Trigger parameter hints",
        },
        insertText: "mapValues($0)",
        insertTextRules: 4,
        label: "mapValues",
      }),
    );
    expect(result.suggestions[1]).toEqual(
      expect.objectContaining({
        insertText: "clone()$0",
        insertTextRules: 4,
        label: "clone",
      }),
    );
    expect(result.suggestions[1]).not.toHaveProperty("command");
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
          rootPath: "/project",
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
              rootPath: "/project",
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

  it("drops in-flight TypeScript command edits after switching project tabs", async () => {
    const monaco = createMonaco();
    const model = textModel();
    let activeRoot = "/project";
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
      rootPath: "/project",
    });

    await Promise.resolve();
    activeRoot = "/other";
    commandEdit.resolve(workspaceEdit("file:///project/src/user.ts", "Organized"));
    await commandPromise;

    expect(gateway.executeCommand).toHaveBeenCalledWith(
      "/project",
      expect.objectContaining({ command: "_typescript.organizeImports" }),
    );
    expect(model.pushEditOperations).not.toHaveBeenCalled();
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

    activeRoot = "/other";

    await completionProvider.resolveCompletionItem(completion.suggestions[0]);
    await linkProvider.resolveLink(links.links[0]);
    await codeActionProvider.resolveCodeAction(actions.actions[0]);
    await codeLensProvider.resolveCodeLens(model, lenses.lenses[0]);
    const commandDescriptor = (monaco.editor.addCommand as any).mock.calls[0][0];
    await commandDescriptor.run(null, actions.actions[0].command.arguments[0]);

    expect(gateway.resolveCompletionItem).not.toHaveBeenCalled();
    expect(gateway.resolveDocumentLink).not.toHaveBeenCalled();
    expect(gateway.resolveCodeAction).not.toHaveBeenCalled();
    expect(gateway.resolveCodeLens).not.toHaveBeenCalled();
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
    const unsubscribe = vi.fn();
    const workspaceEditGateway = {
      subscribeWorkspaceEdits: vi.fn(async (listener) => {
        listener({
          edit: {
            changes: {
              ...workspaceEdit("file:///project/src/user.ts", "Applied").changes,
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
        return unsubscribe;
      }),
    };
    monaco.editor.getModels.mockReturnValue([model, siblingRootModel]);

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
    expect(siblingRootModel.pushEditOperations).not.toHaveBeenCalled();

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
    codeLenses: Awaited<ReturnType<LanguageServerFeaturesGateway["codeLenses"]>>;
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
    foldingRanges: Awaited<
      ReturnType<LanguageServerFeaturesGateway["foldingRanges"]>
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
    definition: vi.fn(async () => []),
    didChangeConfiguration: vi.fn(async () => undefined),
    didChangeWatchedFiles: vi.fn(async () => undefined),
    didRenameFiles: vi.fn(async () => undefined),
    documentHighlights: vi.fn(
      async () => responses.documentHighlights ?? [],
    ),
    documentLinks: vi.fn(async () => responses.documentLinks ?? []),
    documentSymbols: vi.fn(async () => responses.documentSymbols ?? []),
    executeCommand: vi.fn(async () => responses.executeCommandEdit ?? null),
    foldingRanges: vi.fn(async () => responses.foldingRanges ?? []),
    formatting: vi.fn(async () => responses.formatting ?? []),
    hover: vi.fn(async () => null),
    incomingCalls: vi.fn(async () => []),
    implementation: vi.fn(async () => []),
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
    references: vi.fn(async () => responses.references ?? []),
    rename: vi.fn(async () => responses.rename ?? null),
    selectionRanges: vi.fn(async () => responses.selectionRanges ?? []),
    semanticTokens: vi.fn(async () => responses.semanticTokens ?? null),
    signatureHelp: vi.fn(async () => responses.signatureHelp ?? null),
    typeDefinition: vi.fn(async () => responses.typeDefinition ?? []),
    typeHierarchySubtypes: vi.fn(async () => []),
    typeHierarchySupertypes: vi.fn(async () => []),
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
      definition: true,
      documentHighlight: true,
      documentLink: true,
      documentSymbol: true,
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
      typeDefinition: true,
      typeHierarchy: true,
      willRenameFiles: true,
      workspaceSymbol: true,
      ...capabilities,
    },
    kind: "running",
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
      registerCodeActionProvider: vi.fn(() => disposable()),
      registerCodeLensProvider: vi.fn(() => disposable()),
      registerCompletionItemProvider: vi.fn(() => disposable()),
      registerDefinitionProvider: vi.fn(() => disposable()),
      registerDocumentHighlightProvider: vi.fn(() => disposable()),
      registerDocumentFormattingEditProvider: vi.fn(() => disposable()),
      registerDocumentRangeFormattingEditProvider: vi.fn(() => disposable()),
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
      registerSignatureHelpProvider: vi.fn(() => disposable()),
      registerTypeDefinitionProvider: vi.fn(() => disposable()),
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
