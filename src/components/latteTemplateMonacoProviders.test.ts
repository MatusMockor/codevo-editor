import { describe, expect, it, vi } from "vitest";
import type * as Monaco from "monaco-editor";
import {
  registerLatteTemplateMonacoProviders,
  type LatteCrossFileBlockMonacoContext,
} from "./latteTemplateMonacoProviders";
import { workspaceModelUri } from "./phpMonacoDocumentContext";
import type {
  TemplateLanguageMonacoProviderContext,
  TemplateLanguageMonacoProviderHandlers,
  TemplateLanguageProviderRegistry,
} from "./templateLanguageMonacoTypes";

const LARGE_DOCUMENT_POLICY = { characterLimit: 16 * 1024, lineLimit: 500 };
const NORMAL_LATTE_SOURCE = "{include 'partials/card'}";
const LARGE_LATTE_SOURCE = "{include 'partials/card'}\n".repeat(501);

describe("registerLatteTemplateMonacoProviders", () => {
  it("provides Latte completions for a normal document", async () => {
    const registered = registerProviders();
    const provideCompletions = vi.fn(async () => [
      { insertText: "include", kind: "tag" as const, label: "include" },
    ]);
    const context = templateContext({ provideCompletions });
    registerLatteTemplateMonacoProviders(
      registered.monaco,
      context,
      { toCodeAction: vi.fn() } as TemplateLanguageMonacoProviderHandlers<
        TemplateLanguageMonacoProviderContext
      >,
    );

    const result = await registered.completionProvider?.provideCompletionItems(
      textModel(NORMAL_LATTE_SOURCE),
      latteCursorPosition(),
      {} as Monaco.languages.CompletionContext,
      {} as never,
    );

    expect(provideCompletions).toHaveBeenCalledWith(
      NORMAL_LATTE_SOURCE,
      latteCursorPosition(),
    );
    expect(result?.suggestions).toHaveLength(1);
  });

  it("skips Latte completions for a large document", async () => {
    const registered = registerProviders();
    const provideCompletions = vi.fn(async () => [
      { insertText: "include", kind: "tag" as const, label: "include" },
    ]);
    const context = templateContext({
      content: LARGE_LATTE_SOURCE,
      provideCompletions,
    });
    registerLatteTemplateMonacoProviders(
      registered.monaco,
      context,
      { toCodeAction: vi.fn() } as TemplateLanguageMonacoProviderHandlers<
        TemplateLanguageMonacoProviderContext
      >,
    );

    const result = await registered.completionProvider?.provideCompletionItems(
      textModel(LARGE_LATTE_SOURCE),
      latteCursorPosition(),
      {} as Monaco.languages.CompletionContext,
      {} as never,
    );

    expect(provideCompletions).not.toHaveBeenCalled();
    expect(result?.suggestions).toEqual([]);
  });

  it("provides the Latte definition lookup for a normal document", async () => {
    const registered = registerProviders();
    const provideDefinition = vi.fn(async () => true);
    const context = templateContext({ provideDefinition });
    registerLatteTemplateMonacoProviders(
      registered.monaco,
      context,
      { toCodeAction: vi.fn() } as TemplateLanguageMonacoProviderHandlers<
        TemplateLanguageMonacoProviderContext
      >,
    );

    await registered.definitionProvider?.provideDefinition(
      textModel(NORMAL_LATTE_SOURCE),
      latteCursorPosition(),
      {} as never,
    );

    expect(provideDefinition).toHaveBeenCalledWith(
      NORMAL_LATTE_SOURCE,
      0,
      expect.anything(),
    );
  });

  it("skips the Latte definition lookup for a large document", async () => {
    const registered = registerProviders();
    const provideDefinition = vi.fn(async () => true);
    const context = templateContext({
      content: LARGE_LATTE_SOURCE,
      provideDefinition,
    });
    registerLatteTemplateMonacoProviders(
      registered.monaco,
      context,
      { toCodeAction: vi.fn() } as TemplateLanguageMonacoProviderHandlers<
        TemplateLanguageMonacoProviderContext
      >,
    );

    const result = await registered.definitionProvider?.provideDefinition(
      textModel(LARGE_LATTE_SOURCE),
      latteCursorPosition(),
      {} as never,
    );

    expect(provideDefinition).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("navigates same-file block symbols without invoking framework navigation", async () => {
    const source = [
      "{block #emptyState}<p />{/block emptyState}",
      "{include block emptyState}",
    ].join("\n");
    const registered = registerProviders();
    const provideDefinition = vi.fn(async () => true);
    const context = templateContext({ content: source, provideDefinition });
    registerLatteTemplateMonacoProviders(
      registered.monaco,
      context,
      { toCodeAction: vi.fn() } as TemplateLanguageMonacoProviderHandlers<
        TemplateLanguageMonacoProviderContext
      >,
    );
    const model = textModel(source);
    const includeOffset = source.lastIndexOf("emptyState") + 2;

    const result = await registered.definitionProvider?.provideDefinition(
      model,
      positionAtOffset(source, includeOffset),
      {} as never,
    );

    expect(result).toEqual([expect.objectContaining({ uri: model.uri })]);
    expect(provideDefinition).not.toHaveBeenCalled();
  });

  it("navigates duplicate declaration openers and named closers to their own opener", async () => {
    const source = [
      "{block #card}<p>First</p>{/block card}",
      "{block #card}<p>Second</p>{/block card}",
    ].join("\n");
    const registered = registerProviders();
    const context = templateContext({ content: source });
    registerLatteTemplateMonacoProviders(
      registered.monaco,
      context,
      { toCodeAction: vi.fn() } as TemplateLanguageMonacoProviderHandlers<
        TemplateLanguageMonacoProviderContext
      >,
    );
    const model = textModel(source);
    const firstOpening = source.indexOf("card");
    const firstClosing = source.indexOf("card", firstOpening + 1);
    const secondOpening = source.indexOf("card", firstClosing + 1);
    const secondClosing = source.indexOf("card", secondOpening + 1);

    for (const offset of [firstOpening, firstClosing]) {
      const result = await registered.definitionProvider?.provideDefinition(
        model,
        positionAtOffset(source, offset + 1),
        {} as never,
      );

      expect(definitionLocation(result)?.range.startLineNumber).toBe(1);
    }

    for (const offset of [secondOpening, secondClosing]) {
      const result = await registered.definitionProvider?.provideDefinition(
        model,
        positionAtOffset(source, offset + 1),
        {} as never,
      );

      expect(definitionLocation(result)?.range.startLineNumber).toBe(2);
    }
  });

  it("returns same-model references and rename edits including named closers", async () => {
    const source = [
      "{block #emptyState}<p />{/block emptyState}",
      "{define tableRow, $row}<tr />{/define tableRow}",
      "{include block tableRow, row: $row}",
      "{include #emptyState}",
    ].join("\n");
    const registered = registerProviders();
    const context = templateContext({ content: source });
    registerLatteTemplateMonacoProviders(
      registered.monaco,
      context,
      { toCodeAction: vi.fn() } as TemplateLanguageMonacoProviderHandlers<
        TemplateLanguageMonacoProviderContext
      >,
    );
    const model = textModel(source);
    const tableRowPosition = positionAtOffset(source, source.indexOf("tableRow") + 2);

    const references = await registered.referenceProvider?.provideReferences(
      model,
      tableRowPosition,
      { includeDeclaration: true },
      {} as never,
    );
    const rename = await registered.renameProvider?.provideRenameEdits(
      model,
      tableRowPosition,
      "compactRow",
      {} as never,
    );

    expect(references).toHaveLength(3);
    expect(references?.every((location) => location.uri === model.uri)).toBe(true);
    expect(rename?.rejectReason).toBeUndefined();
    expect(rename?.edits).toHaveLength(3);
    expect(
      rename?.edits.every(
        (edit) => "resource" in edit && edit.resource === model.uri,
      ),
    ).toBe(true);

    const invalid = await registered.renameProvider?.provideRenameEdits(
      model,
      tableRowPosition,
      "row name",
      {} as never,
    );
    expect(invalid?.rejectReason).toBe("Enter a valid Latte block name.");
    expect(invalid?.edits).toEqual([]);
  });

  it("bounds same-file references and rename for large documents", async () => {
    const source = `{block #emptyState}{/block emptyState}\n${"x\n".repeat(501)}`;
    const registered = registerProviders();
    const context = templateContext({ content: source });
    registerLatteTemplateMonacoProviders(
      registered.monaco,
      context,
      { toCodeAction: vi.fn() } as TemplateLanguageMonacoProviderHandlers<
        TemplateLanguageMonacoProviderContext
      >,
    );
    const model = textModel(source);
    const position = positionAtOffset(source, source.indexOf("emptyState") + 1);

    expect(
      await registered.referenceProvider?.provideReferences(
        model,
        position,
        { includeDeclaration: true },
        {} as never,
      ),
    ).toBeNull();
    expect(
      await registered.renameProvider?.provideRenameEdits(
        model,
        position,
        "renamed",
        {} as never,
      ),
    ).toMatchObject({ edits: [], rejectReason: expect.any(String) });
  });

  it("maps Latte quick fixes through the shared code-action handler", async () => {
    const registered = registerProviders();
    const descriptor = {
      edits: [],
      isPreferred: true,
      kind: "quickfix",
      title: "Create Latte template partials/card",
    };
    const provideCodeActions = vi.fn(async () => [descriptor]);
    const context = templateContext({ provideCodeActions });
    const toCodeAction = vi.fn(() => ({ title: descriptor.title }));
    const disposable = registerLatteTemplateMonacoProviders(
      registered.monaco,
      context,
      { toCodeAction } as TemplateLanguageMonacoProviderHandlers<
        TemplateLanguageMonacoProviderContext
      >,
    );
    const model = textModel("{include 'partials/card'}");

    const result = await registered.codeActionProvider?.provideCodeActions(
      model,
      {
        endColumn: 18,
        endLineNumber: 1,
        startColumn: 12,
        startLineNumber: 1,
      } as Monaco.Range,
      { markers: [], trigger: "manual" } as unknown as Monaco.languages.CodeActionContext,
      {} as never,
    );

    expect(result?.actions).toEqual([{ title: descriptor.title }]);
    expect(provideCodeActions).toHaveBeenCalledWith("{include 'partials/card'}", {
      end: 17,
      start: 11,
    });
    expect(toCodeAction).toHaveBeenCalledWith(
      registered.monaco,
      context,
      model,
      descriptor,
    );

    disposable.dispose();
    expect(registered.disposed).toEqual([
      "definition",
      "references",
      "rename",
      "completion",
      "actions",
    ]);
  });

  it("maps Monaco markers into the Latte code-action diagnostic context", async () => {
    const registered = registerProviders();
    const provideCodeActions = vi.fn(async () => []);
    const context = templateContext({ provideCodeActions });
    const disposable = registerLatteTemplateMonacoProviders(
      registered.monaco,
      context,
      { toCodeAction: vi.fn() } as TemplateLanguageMonacoProviderHandlers<
        TemplateLanguageMonacoProviderContext
      >,
    );
    const markerData = {
      candidateMethodNames: ["renderDetail"],
      kind: "missing-presenter-method",
      presenterPath: "/ws/app/UI/Home/HomePresenter.php",
      target: "Home:detail",
    };
    const model = textModel("{link Home:detail}");

    await registered.codeActionProvider?.provideCodeActions(
      model,
      {
        endColumn: 18,
        endLineNumber: 1,
        startColumn: 7,
        startLineNumber: 1,
      } as Monaco.Range,
      {
        markers: [
          {
            code: "nette.missingPresenterMethod",
            data: markerData,
            endColumn: 18,
            endLineNumber: 1,
            message: "Missing presenter method.",
            severity: 4,
            source: "Nette",
            startColumn: 7,
            startLineNumber: 1,
          },
        ],
        trigger: "manual",
      } as unknown as Monaco.languages.CodeActionContext,
      {} as never,
    );

    expect(provideCodeActions).toHaveBeenCalledWith(
      "{link Home:detail}",
      { end: 17, start: 6 },
      {
        diagnostics: [
          {
            code: "nette.missingPresenterMethod",
            data: markerData,
            message: "Missing presenter method.",
            range: {
              endColumn: 18,
              endLineNumber: 1,
              startColumn: 7,
              startLineNumber: 1,
            },
            source: "Nette",
          },
        ],
      },
    );

    disposable.dispose();
  });
});

describe("cross-file Latte block navigation", () => {
  const LAYOUT_PATH = "/ws/app/UI/@layout.latte";
  const LAYOUT_SOURCE = "{block content}Layout{/block content}";
  const CHILD_INCLUDE_SOURCE =
    "{extends '../@layout.latte'}\n{include #content}";
  const CHILD_OVERRIDE_SOURCE =
    "{extends '../@layout.latte'}\n{block content}Child{/block}";

  it("navigates an include of a parent-declared block to the layout declaration", async () => {
    const registered = registerProviders();
    const readTemplateFileContent = vi.fn(async (path: string) =>
      path === LAYOUT_PATH ? LAYOUT_SOURCE : null,
    );
    const context = templateContext({
      content: CHILD_INCLUDE_SOURCE,
      readTemplateFileContent,
    });
    registerLatteTemplateMonacoProviders(
      registered.monaco,
      context,
      { toCodeAction: vi.fn() } as TemplateLanguageMonacoProviderHandlers<
        TemplateLanguageMonacoProviderContext
      >,
    );
    const model = textModel(CHILD_INCLUDE_SOURCE);

    const result = await registered.definitionProvider?.provideDefinition(
      model,
      positionAtOffset(
        CHILD_INCLUDE_SOURCE,
        CHILD_INCLUDE_SOURCE.indexOf("#content") + 2,
      ),
      {} as never,
    );

    expect(readTemplateFileContent).toHaveBeenCalledWith(LAYOUT_PATH);
    expect(definitionLocation(result)?.uri.toString()).toBe(
      workspaceModelUri("/ws", LAYOUT_PATH),
    );
    expect(definitionLocation(result)?.range).toMatchObject({
      endColumn: 15,
      endLineNumber: 1,
      startColumn: 8,
      startLineNumber: 1,
    });
  });

  it("navigates a child block override to the nearest ancestor declaration", async () => {
    const registered = registerProviders();
    const context = templateContext({
      content: CHILD_OVERRIDE_SOURCE,
      readTemplateFileContent: async (path) =>
        path === LAYOUT_PATH ? LAYOUT_SOURCE : null,
    });
    registerLatteTemplateMonacoProviders(
      registered.monaco,
      context,
      { toCodeAction: vi.fn() } as TemplateLanguageMonacoProviderHandlers<
        TemplateLanguageMonacoProviderContext
      >,
    );
    const model = textModel(CHILD_OVERRIDE_SOURCE);

    const result = await registered.definitionProvider?.provideDefinition(
      model,
      positionAtOffset(
        CHILD_OVERRIDE_SOURCE,
        CHILD_OVERRIDE_SOURCE.indexOf("content") + 1,
      ),
      {} as never,
    );

    expect(definitionLocation(result)?.uri.toString()).toBe(
      workspaceModelUri("/ws", LAYOUT_PATH),
    );
  });

  it("keeps named closers navigating to their own same-file opener", async () => {
    const registered = registerProviders();
    const source =
      "{extends '../@layout.latte'}\n{block content}Child{/block content}";
    const context = templateContext({
      content: source,
      readTemplateFileContent: async (path) =>
        path === LAYOUT_PATH ? LAYOUT_SOURCE : null,
    });
    registerLatteTemplateMonacoProviders(
      registered.monaco,
      context,
      { toCodeAction: vi.fn() } as TemplateLanguageMonacoProviderHandlers<
        TemplateLanguageMonacoProviderContext
      >,
    );
    const model = textModel(source);

    const result = await registered.definitionProvider?.provideDefinition(
      model,
      positionAtOffset(source, source.lastIndexOf("content") + 1),
      {} as never,
    );

    expect(definitionLocation(result)?.uri).toBe(model.uri);
    expect(definitionLocation(result)?.range.startLineNumber).toBe(2);
  });

  it("returns cross-file references across the template graph", async () => {
    const registered = registerProviders();
    const context = templateContext({
      content: CHILD_OVERRIDE_SOURCE,
      readTemplateFileContent: async (path) =>
        path === LAYOUT_PATH ? LAYOUT_SOURCE : null,
    });
    registerLatteTemplateMonacoProviders(
      registered.monaco,
      context,
      { toCodeAction: vi.fn() } as TemplateLanguageMonacoProviderHandlers<
        TemplateLanguageMonacoProviderContext
      >,
    );
    const model = textModel(CHILD_OVERRIDE_SOURCE);

    const references = await registered.referenceProvider?.provideReferences(
      model,
      positionAtOffset(
        CHILD_OVERRIDE_SOURCE,
        CHILD_OVERRIDE_SOURCE.indexOf("content") + 1,
      ),
      { includeDeclaration: true },
      {} as never,
    );

    expect(references).toHaveLength(3);
    expect(references?.[0]?.uri).toBe(model.uri);
    expect(references?.[1]?.uri.toString()).toBe(
      workspaceModelUri("/ws", LAYOUT_PATH),
    );
    expect(references?.[2]?.uri.toString()).toBe(
      workspaceModelUri("/ws", LAYOUT_PATH),
    );
  });

  it("keeps rename same-file only even when the template read port is wired", async () => {
    const registered = registerProviders();
    const readTemplateFileContent = vi.fn(async (path: string) =>
      path === LAYOUT_PATH ? LAYOUT_SOURCE : null,
    );
    const context = templateContext({
      content: CHILD_OVERRIDE_SOURCE,
      readTemplateFileContent,
    });
    registerLatteTemplateMonacoProviders(
      registered.monaco,
      context,
      { toCodeAction: vi.fn() } as TemplateLanguageMonacoProviderHandlers<
        TemplateLanguageMonacoProviderContext
      >,
    );
    const model = textModel(CHILD_OVERRIDE_SOURCE);

    const rename = await registered.renameProvider?.provideRenameEdits(
      model,
      positionAtOffset(
        CHILD_OVERRIDE_SOURCE,
        CHILD_OVERRIDE_SOURCE.indexOf("content") + 1,
      ),
      "mainContent",
      {} as never,
    );

    expect(readTemplateFileContent).not.toHaveBeenCalled();
    expect(rename?.rejectReason).toBeUndefined();
    expect(rename?.edits).toHaveLength(1);
    expect(rename?.edits[0]).toMatchObject({
      resource: model.uri,
      versionId: 1,
    });
  });

  it("keeps same-file behavior when no template read port is wired", async () => {
    const registered = registerProviders();
    const context = templateContext({ content: CHILD_INCLUDE_SOURCE });
    registerLatteTemplateMonacoProviders(
      registered.monaco,
      context,
      { toCodeAction: vi.fn() } as TemplateLanguageMonacoProviderHandlers<
        TemplateLanguageMonacoProviderContext
      >,
    );

    const result = await registered.definitionProvider?.provideDefinition(
      textModel(CHILD_INCLUDE_SOURCE),
      positionAtOffset(
        CHILD_INCLUDE_SOURCE,
        CHILD_INCLUDE_SOURCE.indexOf("#content") + 2,
      ),
      {} as never,
    );

    expect(result).toBeNull();
  });

  it("drops cross-file results when the workspace root changes mid-flight", async () => {
    const registered = registerProviders();
    let activeRoot = "/ws";
    const context = templateContext({
      content: CHILD_OVERRIDE_SOURCE,
      getWorkspaceRoot: () => activeRoot,
      readTemplateFileContent: async (path) => {
        activeRoot = "/other";
        return path === LAYOUT_PATH ? LAYOUT_SOURCE : null;
      },
    });
    registerLatteTemplateMonacoProviders(
      registered.monaco,
      context,
      { toCodeAction: vi.fn() } as TemplateLanguageMonacoProviderHandlers<
        TemplateLanguageMonacoProviderContext
      >,
    );
    const model = textModel(CHILD_OVERRIDE_SOURCE);

    const references = await registered.referenceProvider?.provideReferences(
      model,
      positionAtOffset(
        CHILD_OVERRIDE_SOURCE,
        CHILD_OVERRIDE_SOURCE.indexOf("content") + 1,
      ),
      { includeDeclaration: true },
      {} as never,
    );

    expect(references).toHaveLength(1);
    expect(references?.[0]?.uri).toBe(model.uri);
  });
});

function registerProviders() {
  const disposed: string[] = [];
  const openModels = new Map<string, Monaco.editor.ITextModel>();
  let codeActionProvider:
    | Monaco.languages.CodeActionProvider
    | undefined;
  let completionProvider:
    | Monaco.languages.CompletionItemProvider
    | undefined;
  let definitionProvider: Monaco.languages.DefinitionProvider | undefined;
  let referenceProvider: Monaco.languages.ReferenceProvider | undefined;
  let renameProvider: Monaco.languages.RenameProvider | undefined;
  const monaco = {
    Range: class {
      constructor(
        public startLineNumber: number,
        public startColumn: number,
        public endLineNumber: number,
        public endColumn: number,
      ) {}
    },
    Uri: {
      parse: (value: string) => ({ toString: () => value }),
    },
    editor: {
      getModel: (uri: { toString(): string }) =>
        openModels.get(uri.toString()) ?? null,
    },
    languages: {
      CompletionItemKind: {
        Field: 1,
        File: 2,
        Function: 3,
        Keyword: 4,
        Method: 5,
        Module: 6,
        Reference: 8,
        Variable: 7,
      },
      registerCodeActionProvider: vi.fn(
        (_language: string, provider: Monaco.languages.CodeActionProvider) => {
          codeActionProvider = provider;

          return { dispose: () => disposed.push("actions") };
        },
      ),
      registerCompletionItemProvider: vi.fn(
        (
          _language: string,
          provider: Monaco.languages.CompletionItemProvider,
        ) => {
          completionProvider = provider;

          return { dispose: () => disposed.push("completion") };
        },
      ),
      registerDefinitionProvider: vi.fn(
        (_language: string, provider: Monaco.languages.DefinitionProvider) => {
          definitionProvider = provider;

          return { dispose: () => disposed.push("definition") };
        },
      ),
      registerReferenceProvider: vi.fn(
        (_language: string, provider: Monaco.languages.ReferenceProvider) => {
          referenceProvider = provider;

          return { dispose: () => disposed.push("references") };
        },
      ),
      registerRenameProvider: vi.fn(
        (_language: string, provider: Monaco.languages.RenameProvider) => {
          renameProvider = provider;

          return { dispose: () => disposed.push("rename") };
        },
      ),
    },
  } as unknown as typeof Monaco;

  return {
    disposed,
    openModels,
    get codeActionProvider() {
      return codeActionProvider;
    },
    get completionProvider() {
      return completionProvider;
    },
    get definitionProvider() {
      return definitionProvider;
    },
    get referenceProvider() {
      return referenceProvider;
    },
    get renameProvider() {
      return renameProvider;
    },
    monaco,
  };
}

function latteCursorPosition(): Monaco.Position {
  return { column: 1, lineNumber: 1 } as Monaco.Position;
}

function positionAtOffset(source: string, offset: number): Monaco.Position {
  const before = source.slice(0, offset);
  const lineStart = before.lastIndexOf("\n") + 1;

  return {
    column: offset - lineStart + 1,
    lineNumber: before.split("\n").length,
  } as Monaco.Position;
}

function definitionLocation(
  definition: Monaco.languages.Definition | null | undefined,
): Monaco.languages.Location | null {
  if (!definition) {
    return null;
  }

  return Array.isArray(definition) ? definition[0] ?? null : definition;
}

function templateContext({
  content = NORMAL_LATTE_SOURCE,
  getWorkspaceRoot = () => "/ws",
  provideCodeActions = vi.fn(async () => []),
  provideCompletions = vi.fn(async () => []),
  provideDefinition = vi.fn(async () => false),
  readTemplateFileContent,
}: {
  content?: string;
  getWorkspaceRoot?: () => string | null;
  provideCodeActions?: TemplateLanguageMonacoProviderContext["getTemplateLanguageProviders"] extends () => infer Registry
    ? Registry extends { latte: { provideCodeActions: infer Provider } }
      ? Provider
      : never
    : never;
  provideCompletions?: TemplateLanguageProviderRegistry["latte"]["provideCompletions"];
  provideDefinition?: TemplateLanguageProviderRegistry["latte"]["provideDefinition"];
  readTemplateFileContent?: LatteCrossFileBlockMonacoContext["readTemplateFileContent"];
}): LatteCrossFileBlockMonacoContext {
  return {
    getActiveDocument: () => ({
      content,
      language: "latte",
      name: "default.latte",
      path: "/ws/app/UI/Home/default.latte",
      savedContent: content,
    }),
    getLargeSmartDocumentPolicy: () => LARGE_DOCUMENT_POLICY,
    readTemplateFileContent,
    getTemplateLanguageProviders: () => ({
      blade: {
        provideCodeActions: vi.fn(async () => []),
        provideCompletions: vi.fn(async () => []),
        provideDefinition: vi.fn(async () => false),
      },
      latte: {
        provideCodeActions,
        provideCompletions,
        provideDefinition,
      },
      neon: {
        provideCompletions: vi.fn(async () => []),
        provideDefinition: vi.fn(async () => false),
      },
    }),
    getWorkspaceRoot,
    reportError: vi.fn(),
  };
}

function textModel(value: string): Monaco.editor.ITextModel {
  return {
    getVersionId: () => 1,
    getValue: () => value,
    getWordUntilPosition: () => ({ endColumn: 1, startColumn: 1, word: "" }),
    uri: {
      fsPath: "/ws/app/UI/Home/default.latte",
      path: "/ws/app/UI/Home/default.latte",
      scheme: "file",
      toString: () => "file:///ws/app/UI/Home/default.latte",
    },
  } as unknown as Monaco.editor.ITextModel;
}
