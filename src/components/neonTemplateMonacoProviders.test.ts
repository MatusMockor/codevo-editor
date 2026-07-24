import { describe, expect, it, vi } from "vitest";
import type * as Monaco from "monaco-editor";
import type { NeonCrossFileRepository } from "../application/neonCrossFileSymbolSweep";
import { registerNeonTemplateMonacoProviders } from "./neonTemplateMonacoProviders";
import type {
  TemplateLanguageMonacoProviderContext,
  TemplateLanguageProviderRegistry,
} from "./templateLanguageMonacoTypes";

const LARGE_DOCUMENT_POLICY = { characterLimit: 16 * 1024, lineLimit: 500 };
const NORMAL_NEON_SOURCE = "services:\n  - App\\Model\\UserFacade";
const LARGE_NEON_SOURCE = "services:\n".repeat(501);

describe("registerNeonTemplateMonacoProviders", () => {
  it("provides NEON completions for a normal document", async () => {
    const registered = registerProviders();
    const provideCompletions = vi.fn(async () => [
      { insertText: "services", kind: "service" as const, label: "services" },
    ]);
    const context = templateContext({
      provideCompletions,
      source: NORMAL_NEON_SOURCE,
    });
    registerNeonTemplateMonacoProviders(registered.monaco, context);

    const result = await registered.completionProvider?.provideCompletionItems(
      textModel(NORMAL_NEON_SOURCE),
      position(),
      {} as Monaco.languages.CompletionContext,
      {} as never,
    );

    expect(provideCompletions).toHaveBeenCalledWith(NORMAL_NEON_SOURCE, position());
    expect(result?.suggestions).toHaveLength(1);
  });

  it("skips NEON completions for a large document", async () => {
    const registered = registerProviders();
    const provideCompletions = vi.fn(async () => [
      { insertText: "services", kind: "service" as const, label: "services" },
    ]);
    const context = templateContext({
      provideCompletions,
      source: LARGE_NEON_SOURCE,
    });
    registerNeonTemplateMonacoProviders(registered.monaco, context);

    const result = await registered.completionProvider?.provideCompletionItems(
      textModel(LARGE_NEON_SOURCE),
      position(),
      {} as Monaco.languages.CompletionContext,
      {} as never,
    );

    expect(provideCompletions).not.toHaveBeenCalled();
    expect(result?.suggestions).toEqual([]);
  });

  it("runs the NEON definition lookup for a normal document", async () => {
    const registered = registerProviders();
    const provideDefinition = vi.fn(async () => false);
    const context = templateContext({
      provideDefinition,
      source: NORMAL_NEON_SOURCE,
    });
    registerNeonTemplateMonacoProviders(registered.monaco, context);

    await registered.definitionProvider?.provideDefinition(
      textModel(NORMAL_NEON_SOURCE),
      position(),
      {} as never,
    );

    expect(provideDefinition).toHaveBeenCalledWith(NORMAL_NEON_SOURCE, 0, expect.anything());
  });

  it("skips the NEON definition lookup for a large document", async () => {
    const registered = registerProviders();
    const provideDefinition = vi.fn(async () => false);
    const context = templateContext({
      provideDefinition,
      source: LARGE_NEON_SOURCE,
    });
    registerNeonTemplateMonacoProviders(registered.monaco, context);

    const result = await registered.definitionProvider?.provideDefinition(
      textModel(LARGE_NEON_SOURCE),
      position(),
      {} as never,
    );

    expect(provideDefinition).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("provides conservative same-document references and an atomic rename for scratch NEON", async () => {
    const source = "services:\n  mailer: App\\Mailer\n  consumer: App\\Consumer(@mailer)";
    const registered = registerProviders();
    registerNeonTemplateMonacoProviders(registered.monaco, templateContext({ root: null, source }));
    const model = textModel(source);
    const cursor = positionAt(source, source.lastIndexOf("mailer") + 2);

    const references = await registered.referenceProvider?.provideReferences(
      model,
      cursor,
      { includeDeclaration: true },
      {} as never,
    );
    expect(references).toHaveLength(2);

    const rename = await registered.renameProvider?.provideRenameEdits(
      model,
      cursor,
      "primaryMailer",
      {} as never,
    );
    expect(rename?.edits).toHaveLength(2);
    expect(
      rename?.edits.every((edit) => "textEdit" in edit && edit.textEdit.text === "primaryMailer"),
    ).toBe(true);
  });

  it("rejects a rename when the workspace root changes before edits commit", async () => {
    const source = "services:\n  mailer: App\\Mailer\n  consumer: App\\Consumer(@mailer)";
    const registered = registerProviders();
    let rootReads = 0;
    const context = templateContext({ source });
    context.getWorkspaceRoot = () => (++rootReads === 1 ? "/ws" : "/other");
    registerNeonTemplateMonacoProviders(registered.monaco, context);

    const result = await registered.renameProvider?.provideRenameEdits(
      textModel(source),
      positionAt(source, source.lastIndexOf("mailer") + 2),
      "primaryMailer",
      {} as never,
    );
    expect(result).toEqual({
      edits: [],
      rejectReason: "NEON workspace rename is unavailable or stale.",
    });
  });

  it("returns complete cross-file references from dirty open overlays", async () => {
    const config = "includes:\n  - services\n  - wiring\n";
    const services = "services:\n  mailer: App\\Mailer\n";
    const wiring = "services:\n  consumer: App\\Consumer(@mailer)\n";
    const files = new Map([
      ["/ws/config/config.neon", config],
      ["/ws/config/services.neon", services],
      ["/ws/config/wiring.neon", "services:\n  stale: App\\Stale\n"],
    ]);
    const registered = registerProviders();
    const model = textModel(wiring, "/ws/config/wiring.neon");
    const sibling = textModel(services, "/ws/config/services.neon");
    registered.setModels([model, sibling]);
    const context = templateContext({
      path: "/ws/config/wiring.neon",
      source: wiring,
      overrides: {
        createNeonSemanticDiagnosticsRepository: ({
          activePath,
          isCurrent,
          openOverlays,
          rootPath,
        }) => ({
          activePath,
          isCurrent,
          openOverlays,
          rootPath,
          listNeonFiles: async () => [...files.keys()],
          readFile: async (path) => files.get(path) ?? null,
        }),
      },
    });
    registerNeonTemplateMonacoProviders(registered.monaco, context);

    const references = await registered.referenceProvider?.provideReferences(
      model,
      positionAt(wiring, wiring.indexOf("mailer") + 2),
      { includeDeclaration: true },
      {} as never,
    );

    expect(references).toHaveLength(2);
    expect(references?.map(({ uri }) => uri.toString())).toEqual([
      expect.stringMatching(/^workspace-file:/),
      expect.stringMatching(/^workspace-file:/),
    ]);
    expect(references?.[0]?.uri.toString()).not.toBe(references?.[1]?.uri.toString());
    expect(references?.map(({ range }) => range.startLineNumber)).toEqual([2, 2]);
  });

  it("drops workspace references when any captured open model changes", async () => {
    const source = "services:\n  mailer: App\\Mailer\n";
    let releaseList: (() => void) | undefined;
    const listGate = new Promise<void>((resolve) => {
      releaseList = resolve;
    });
    const registered = registerProviders();
    const model = textModel(source);
    const sibling = textModel("services:\n  other: App\\Other\n", "/ws/config/other.neon");
    registered.setModels([model, sibling]);
    const context = templateContext({
      source,
      overrides: {
        createNeonSemanticDiagnosticsRepository: ({
          activePath,
          isCurrent,
          openOverlays,
          rootPath,
        }) => ({
          activePath,
          isCurrent,
          openOverlays,
          rootPath,
          listNeonFiles: async () => {
            await listGate;
            return [activePath, "/ws/config/other.neon"];
          },
          readFile: async () => source,
        }),
      },
    });
    registerNeonTemplateMonacoProviders(registered.monaco, context);

    const pending = registered.referenceProvider?.provideReferences(
      model,
      positionAt(source, source.indexOf("mailer") + 2),
      { includeDeclaration: true },
      {} as never,
    );
    sibling.setValue("services:\n  changed: App\\Changed\n");
    releaseList?.();

    await expect(pending).resolves.toBeNull();
  });

  it("fails closed when error reporting throws in references, prepare, and rename", async () => {
    const source = "services:\n  mailer: App\\Mailer\n";
    const registered = registerProviders();
    const model = textModel(source);
    registered.setModels([model]);
    const context = templateContext({
      source,
      overrides: {
        createNeonSemanticDiagnosticsRepository: ({ activePath }) => throwingRepository(activePath),
        reportError: () => {
          throw new Error("reporting failed");
        },
      },
    });
    registerNeonTemplateMonacoProviders(registered.monaco, context);
    const cursor = positionAt(source, source.indexOf("mailer") + 2);

    await expect(
      registered.referenceProvider?.provideReferences(
        model,
        cursor,
        { includeDeclaration: true },
        {} as never,
      ),
    ).resolves.toBeNull();
    await expect(
      registered.renameProvider?.resolveRenameLocation?.(model, cursor, {} as never),
    ).resolves.toMatchObject({ rejectReason: "NEON workspace rename is unavailable or stale." });
    await expect(
      registered.renameProvider?.provideRenameEdits(model, cursor, "primary", {} as never),
    ).resolves.toEqual({
      edits: [],
      rejectReason: "NEON workspace rename is unavailable or stale.",
    });
  });

  it("uses a fresh rename snapshot and returns no Monaco edits after atomic acceptance", async () => {
    const source = "services:\n  mailer: App\\Mailer\n  consumer: App\\Consumer(@mailer)\n";
    const registered = registerProviders();
    const model = textModel(source);
    registered.setModels([model]);
    const createRepository = vi.fn(({ activePath, isCurrent, openOverlays, rootPath }) => ({
      activePath,
      isCurrent,
      openOverlays,
      rootPath,
      listNeonFiles: async () => [activePath],
      readFile: async () => source,
    }));
    const rename = vi.fn(async () => ({ kind: "accepted" as const }));
    const context = templateContext({
      source,
      overrides: {
        applyNeonWorkspaceEdit: vi.fn(async () => ({ kind: "accepted" as const })),
        createNeonSemanticDiagnosticsRepository: createRepository,
        createNeonWorkspaceRenameCapture: async (request) => ({
          activePath: request.activePath,
          activeUri: request.activeUri,
          activeVersionId: request.activeVersionId,
          closedFileHashes: {},
          generation: request.generation,
          isCurrent: request.isCurrent,
          isTrusted: () => true,
          openDocuments: request.openDocuments,
          rootPath: request.rootPath,
          workspaceOwnerKey: "workspace-1",
        }),
        getNeonWorkspaceRenameService: () => ({ cancel: () => false, rename }),
      },
    });
    registerNeonTemplateMonacoProviders(registered.monaco, context);
    const cursor = positionAt(source, source.lastIndexOf("mailer") + 2);

    await expect(
      registered.renameProvider?.resolveRenameLocation?.(model, cursor, {} as never),
    ).resolves.toMatchObject({ text: "mailer" });
    const result = await registered.renameProvider?.provideRenameEdits(
      model,
      cursor,
      "primaryMailer",
      {
        isCancellationRequested: false,
        onCancellationRequested: () => ({
          dispose: () => {
            throw new Error("host disposable failed");
          },
        }),
      } as never,
    );

    expect(createRepository).toHaveBeenCalledTimes(2);
    expect(rename).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ edits: [] });
    expect(model.getValue()).toBe(source);
  });
});

function position(): Monaco.Position {
  return { column: 1, lineNumber: 1 } as Monaco.Position;
}

function registerProviders() {
  let completionProvider: Monaco.languages.CompletionItemProvider | undefined;
  let definitionProvider: Monaco.languages.DefinitionProvider | undefined;
  let referenceProvider: Monaco.languages.ReferenceProvider | undefined;
  let renameProvider: Monaco.languages.RenameProvider | undefined;
  let models: Monaco.editor.ITextModel[] = [];
  const uri = (value: string) => ({
    fsPath: value.startsWith("file://") ? value.slice("file://".length) : value,
    path: value.startsWith("file://") ? value.slice("file://".length) : value,
    scheme: value.split(":", 1)[0] ?? "file",
    toString: () => value,
  });
  const monaco = {
    Range: class {
      constructor(
        readonly startLineNumber: number,
        readonly startColumn: number,
        readonly endLineNumber: number,
        readonly endColumn: number,
      ) {}
    },
    Uri: {
      file: (path: string) => uri(`file://${path}`),
      parse: (value: string) => uri(value),
    },
    editor: {
      getModels: () => models,
      onDidCreateModel: () => ({ dispose: () => undefined }),
      setModelMarkers: vi.fn(),
    },
    languages: {
      CompletionItemKind: {
        Class: 1,
        Field: 2,
        Keyword: 3,
        Module: 4,
        Property: 5,
        Value: 6,
        Variable: 7,
      },
      registerCompletionItemProvider: vi.fn(
        (_language: string, provider: Monaco.languages.CompletionItemProvider) => {
          completionProvider = provider;

          return { dispose: () => undefined };
        },
      ),
      registerDefinitionProvider: vi.fn(
        (_language: string, provider: Monaco.languages.DefinitionProvider) => {
          definitionProvider = provider;

          return { dispose: () => undefined };
        },
      ),
      registerReferenceProvider: vi.fn(
        (_language: string, provider: Monaco.languages.ReferenceProvider) => {
          referenceProvider = provider;
          return { dispose: () => undefined };
        },
      ),
      registerRenameProvider: vi.fn(
        (_language: string, provider: Monaco.languages.RenameProvider) => {
          renameProvider = provider;
          return { dispose: () => undefined };
        },
      ),
    },
  } as unknown as typeof Monaco;

  return {
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
    setModels(next: Monaco.editor.ITextModel[]) {
      models = next;
    },
    monaco,
  };
}

function templateContext({
  overrides = {},
  path = "/ws/config/services.neon",
  provideCompletions = vi.fn(async () => []),
  provideDefinition = vi.fn(async () => false),
  root = "/ws",
  source,
}: {
  overrides?: Partial<TemplateLanguageMonacoProviderContext>;
  path?: string;
  provideCompletions?: TemplateLanguageProviderRegistry["neon"]["provideCompletions"];
  provideDefinition?: TemplateLanguageProviderRegistry["neon"]["provideDefinition"];
  root?: string | null;
  source: string;
}): TemplateLanguageMonacoProviderContext {
  return {
    getActiveDocument: () => ({
      content: source,
      language: "neon",
      name: path.split("/").slice(-1)[0] ?? "services.neon",
      path,
      savedContent: source,
    }),
    getLargeSmartDocumentPolicy: () => LARGE_DOCUMENT_POLICY,
    getTemplateLanguageProviders: () => ({
      blade: {
        provideCodeActions: vi.fn(async () => []),
        provideCompletions: vi.fn(async () => []),
        provideDefinition: vi.fn(async () => false),
      },
      latte: {
        provideCodeActions: vi.fn(async () => []),
        provideCompletions: vi.fn(async () => []),
        provideDefinition: vi.fn(async () => false),
      },
      neon: {
        provideCompletions,
        provideDefinition,
      },
    }),
    getWorkspaceRoot: () => root,
    reportError: vi.fn(),
    ...overrides,
  };
}

function textModel(
  initialValue: string,
  path = "/ws/config/services.neon",
): Monaco.editor.ITextModel & { setValue(value: string): void } {
  let value = initialValue;
  let version = 7;
  const model = {
    getFullModelRange: () => ({
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: value.split("\n").length,
      endColumn: (value.split("\n").slice(-1)[0]?.length ?? 0) + 1,
    }),
    getLanguageId: () => "neon",
    getLineContent: () => "",
    getValue: () => value,
    getVersionId: () => version,
    getWordUntilPosition: () => ({ endColumn: 1, startColumn: 1, word: "" }),
    onDidChangeContent: () => ({ dispose: () => undefined }),
    onWillDispose: () => ({ dispose: () => undefined }),
    pushEditOperations: (_before: unknown, edits: readonly { text: string }[]) => {
      value = edits[0]?.text ?? value;
      version += 1;
      return null;
    },
    setValue: (next: string) => {
      value = next;
      version += 1;
    },
    uri: {
      fsPath: path,
      path,
      scheme: "file",
      toString: () => `file://${path}`,
    },
  };
  return model as unknown as Monaco.editor.ITextModel & { setValue(value: string): void };
}

function positionAt(source: string, offset: number): Monaco.Position {
  const before = source.slice(0, offset);
  return {
    lineNumber: before.split("\n").length,
    column: offset - before.lastIndexOf("\n"),
  } as Monaco.Position;
}

function throwingRepository(activePath: string): NeonCrossFileRepository {
  const repository = {
    activePath,
    listNeonFiles: async () => [],
    readFile: async () => null,
  } as unknown as NeonCrossFileRepository;
  Object.defineProperty(repository, "rootPath", {
    get: () => {
      throw new Error("repository failed");
    },
  });
  return repository;
}
