// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type * as Monaco from "monaco-editor";
import { isSessionPathInWorkspace } from "../application/documentSessionState";
import {
  useWorkspaceEditFileOperations,
  type WorkspaceEditFileOperations,
  type WorkspaceEditFileOperationsDependencies,
} from "../application/useWorkspaceEditFileOperations";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import {
  pathFromLanguageServerUri,
  type LanguageServerFeaturesGateway,
  type LanguageServerWorkspaceEdit,
} from "../domain/languageServerFeatures";
import type { EditorDocument, WorkspaceFileGateway } from "../domain/workspace";
import {
  registerLatteTemplateMonacoProviders,
  type LatteCrossFileBlockMonacoContext,
} from "./latteTemplateMonacoProviders";
import type {
  TemplateLanguageMonacoProviderContext,
  TemplateLanguageMonacoProviderHandlers,
} from "./templateLanguageMonacoTypes";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/ws";
const HOME_PATH = "/ws/app/UI/Home/default.latte";
const LAYOUT_PATH = "/ws/app/UI/@layout.latte";
const HOME_SOURCE = "{extends '../@layout.latte'}\n{block content}Home{/block}";
const LAYOUT_SOURCE = "{block content}Layout{/block content}";
const LARGE_DOCUMENT_POLICY = { characterLimit: 16 * 1024, lineLimit: 500 };

describe("cross-file Latte block rename through the real workspace edit applier", () => {
  it("writes closed-template edits through the gateway and edits the open model", async () => {
    const applyWorkspaceEditSpy = vi.fn(async () => 1);
    const harness = renderWorkspaceEditFileOperations(applyWorkspaceEditSpy);
    const pushedEdits: { range: unknown; text: string }[][] = [];
    const model = latteTextModel(HOME_SOURCE, pushedEdits);
    const registered = latteMonacoHarness();
    const context = latteRenameContext(harness.api);
    registerLatteTemplateMonacoProviders(registered.monaco, context, {
      toCodeAction: vi.fn(),
    } as TemplateLanguageMonacoProviderHandlers<TemplateLanguageMonacoProviderContext>);

    let rename:
      | (Monaco.languages.WorkspaceEdit & Monaco.languages.Rejection)
      | null
      | undefined;

    await act(async () => {
      rename = (await registered.renameProvider?.provideRenameEdits(
        model,
        positionAtOffset(HOME_SOURCE, HOME_SOURCE.indexOf("content") + 1),
        "mainContent",
        {} as never,
      )) as Monaco.languages.WorkspaceEdit & Monaco.languages.Rejection;
    });

    expect(rename?.rejectReason).toBeUndefined();
    expect(rename?.edits).toEqual([]);
    expect(applyWorkspaceEditSpy).toHaveBeenCalledTimes(1);

    const [rootPath, gatewayEdit, skippedPaths] = applyWorkspaceEditSpy.mock
      .calls[0] as unknown as [string, LanguageServerWorkspaceEdit, string[]];

    expect(rootPath).toBe(ROOT);
    expect(skippedPaths).toEqual([HOME_PATH]);

    const changedPaths = Object.keys(gatewayEdit.changes)
      .map((uri) => pathFromLanguageServerUri(uri))
      .sort();

    expect(changedPaths).toEqual([LAYOUT_PATH, HOME_PATH].sort());

    const layoutUri = Object.keys(gatewayEdit.changes).find(
      (uri) => pathFromLanguageServerUri(uri) === LAYOUT_PATH,
    );

    expect(layoutUri).toBeDefined();
    expect(gatewayEdit.changes[layoutUri ?? ""]).toHaveLength(2);
    expect(
      Object.values(gatewayEdit.changes)
        .flat()
        .every((textEdit) => textEdit.newText === "mainContent"),
    ).toBe(true);
    expect(pushedEdits).toHaveLength(1);
    expect(pushedEdits[0]).toEqual([
      { range: expect.anything(), text: "mainContent" },
    ]);

    harness.unmount();
  });

  it("rolls back closed files when open-model finalization detects a race", async () => {
    const applyWorkspaceEditSpy = vi.fn(async () => 1);
    const rollbackClosedFiles = vi.fn(async () => undefined);
    const rollbackOpenModel = vi.fn();
    const harness = renderWorkspaceEditFileOperations(applyWorkspaceEditSpy, {
      rollbackClosedFiles,
    });
    const edit: LanguageServerWorkspaceEdit = {
      changes: {
        [`file://${LAYOUT_PATH}`]: [
          {
            newText: "mainContent",
            range: {
              end: { character: 14, line: 0 },
              start: { character: 7, line: 0 },
            },
          },
        ],
      },
    };

    const decision = await harness
      .api()
      .applyPhpLanguageServerWorkspaceEdit(edit, {
        applyOpenModels: () => ({
          documents: [],
          finalize: () => ({
            kind: "rejected",
            path: HOME_PATH,
            reason: "invalidOpenModelEdits",
          }),
          kind: "applied",
          rollback: rollbackOpenModel,
        }),
        openPaths: [HOME_PATH],
        requiresAtomicFinalization: true,
        rootPath: ROOT,
      });

    expect(decision).toEqual({
      kind: "rejected",
      path: HOME_PATH,
      reason: "invalidOpenModelEdits",
    });
    expect(applyWorkspaceEditSpy).toHaveBeenCalledOnce();
    expect(rollbackOpenModel).toHaveBeenCalledOnce();
    expect(rollbackClosedFiles).toHaveBeenCalledOnce();

    harness.unmount();
  });

  it("rejects a mixed finalizable rename when native transactions are unavailable", async () => {
    const applyWorkspaceEditSpy = vi.fn(async () => 1);
    const harness = renderWorkspaceEditFileOperations(applyWorkspaceEditSpy, {
      transactional: false,
    });

    const decision = await harness.api().applyPhpLanguageServerWorkspaceEdit(
      { changes: {} },
      {
        applyOpenModels: () => ({ documents: [], kind: "applied" }),
        openPaths: [HOME_PATH],
        requiresAtomicFinalization: true,
        rootPath: ROOT,
      },
    );

    expect(decision).toEqual({
      kind: "rejected",
      reason: "atomicWorkspaceEditUnavailable",
    });
    expect(applyWorkspaceEditSpy).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("rolls back controller documents and closed files when finalization throws", async () => {
    const applyWorkspaceEditSpy = vi.fn(async () => 1);
    const rollbackClosedFiles = vi.fn(async () => undefined);
    const rollbackOpenModel = vi.fn();
    const harness = renderWorkspaceEditFileOperations(applyWorkspaceEditSpy, {
      rollbackClosedFiles,
    });
    const contentOffset = HOME_SOURCE.indexOf("content");
    const start = positionAtOffset(HOME_SOURCE, contentOffset);
    const end = positionAtOffset(HOME_SOURCE, contentOffset + "content".length);

    await expect(
      harness.api().applyPhpLanguageServerWorkspaceEdit(
        {
          changes: {
            [`file://${HOME_PATH}`]: [
              {
                newText: "mainContent",
                range: {
                  end: { character: end.column - 1, line: end.lineNumber - 1 },
                  start: {
                    character: start.column - 1,
                    line: start.lineNumber - 1,
                  },
                },
              },
            ],
          },
        },
        {
          applyOpenModels: () => ({
            documents: [],
            finalize: () => {
              throw new Error("finalization failed");
            },
            kind: "applied",
            rollback: rollbackOpenModel,
          }),
          openPaths: [],
          requiresAtomicFinalization: true,
          rootPath: ROOT,
        },
      ),
    ).rejects.toThrow("finalization failed");

    expect(harness.documentContent(HOME_PATH)).toBe(HOME_SOURCE);
    expect(rollbackOpenModel).toHaveBeenCalledOnce();
    expect(rollbackClosedFiles).toHaveBeenCalledOnce();

    harness.unmount();
  });
});

function latteRenameContext(
  api: () => WorkspaceEditFileOperations,
): LatteCrossFileBlockMonacoContext {
  return {
    applyWorkspaceEdit: (edit, applicationContext) =>
      api().applyPhpLanguageServerWorkspaceEdit(edit, applicationContext),
    getActiveDocument: () => homeDocument(),
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
        provideCompletions: vi.fn(async () => []),
        provideDefinition: vi.fn(async () => false),
      },
    }),
    getWorkspaceRoot: () => ROOT,
    listWorkspaceTemplateFiles: async () => [LAYOUT_PATH, HOME_PATH],
    readTemplateFileContent: async (path) =>
      path === LAYOUT_PATH ? LAYOUT_SOURCE : null,
    reportError: vi.fn(),
  };
}

function homeDocument(): EditorDocument {
  return {
    content: HOME_SOURCE,
    language: "latte",
    name: "default.latte",
    path: HOME_PATH,
    savedContent: HOME_SOURCE,
  };
}

function renderWorkspaceEditFileOperations(
  applyWorkspaceEditSpy: (
    rootPath: string,
    edit: LanguageServerWorkspaceEdit,
    skippedPaths: string[],
  ) => Promise<number>,
  options: {
    rollbackClosedFiles?: () => Promise<void>;
    transactional?: boolean;
  } = {},
) {
  let documents: Record<string, EditorDocument> = {
    [HOME_PATH]: homeDocument(),
  };
  const documentsRef = {
    get current() {
      return documents;
    },
    set current(next: Record<string, EditorDocument>) {
      documents = next;
    },
  };
  const workspaceFiles: WorkspaceFileGateway = {
    applyWorkspaceEdit: applyWorkspaceEditSpy,
    createDirectory: vi.fn(async () => undefined),
    createTextFile: vi.fn(async () => undefined),
    deletePath: vi.fn(async () => undefined),
    readDirectory: vi.fn(async () => []),
    readTextFile: vi.fn(async () => ""),
    renamePath: vi.fn(async () => undefined),
    writeTextFile: vi.fn(async () => undefined),
  };
  const rollbackClosedFiles = options.rollbackClosedFiles ?? vi.fn();

  if (options.transactional !== false) {
    workspaceFiles.applyWorkspaceEditTransaction = async (
      rootPath,
      edit,
      skippedPaths,
    ) => ({
      appliedCount: await applyWorkspaceEditSpy(rootPath, edit, skippedPaths),
      rollback: rollbackClosedFiles,
    });
  }
  const dependencies: WorkspaceEditFileOperationsDependencies = {
    currentWorkspaceRootRef: { current: ROOT },
    documentsRef,
    documentVersionsByUriRef: { current: {} },
    hasPhpWorkspace: true,
    isJavaScriptTypeScriptLanguageServerSessionActiveForRoot: () => false,
    isLanguageServerSessionActiveForRoot: () => false,
    isRunningLanguageServerForWorkspace: ((): boolean =>
      false) as unknown as WorkspaceEditFileOperationsDependencies["isRunningLanguageServerForWorkspace"],
    isSessionPathInWorkspace,
    javaScriptTypeScriptDocumentVersionsByUriRef: { current: {} },
    javaScriptTypeScriptLanguageServerFeaturesGateway:
      {} as LanguageServerFeaturesGateway,
    javaScriptTypeScriptLanguageServerRuntimeStatus:
      null as LanguageServerRuntimeStatus | null,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot: null,
    languageServerFeaturesGateway: {} as LanguageServerFeaturesGateway,
    languageServerRuntimeStatus: null,
    languageServerRuntimeStatusRoot: null,
    openPathsRef: { current: [HOME_PATH] },
    previewPathRef: { current: null },
    refreshDirectory: vi.fn(async () => undefined),
    reportChangedDocuments: vi.fn(),
    reportError: vi.fn(),
    setActivePath: vi.fn(),
    setDocuments: (updater) => {
      documents = typeof updater === "function" ? updater(documents) : updater;
    },
    setMessage: vi.fn(),
    setOpenPaths: vi.fn(),
    setPreviewPath: vi.fn(),
    syncClosedDocument: vi.fn(async () => undefined),
    syncClosedJavaScriptTypeScriptDocument: vi.fn(async () => undefined),
    workspaceFiles,
    workspaceRoot: ROOT,
  };

  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { api: WorkspaceEditFileOperations | null } = { api: null };

  function Harness() {
    captured.api = useWorkspaceEditFileOperations(dependencies);
    return null;
  }

  act(() => {
    root.render(<Harness />);
  });

  const api = (): WorkspaceEditFileOperations => {
    expect(captured.api).not.toBeNull();

    return captured.api as WorkspaceEditFileOperations;
  };

  return {
    api,
    documentContent: (path: string) => documents[path]?.content,
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

function latteMonacoHarness() {
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
      getModel: () => null,
    },
    languages: {
      CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
      CompletionItemKind: {},
      registerCodeActionProvider: vi.fn(() => ({ dispose: () => undefined })),
      registerCompletionItemProvider: vi.fn(() => ({
        dispose: () => undefined,
      })),
      registerDefinitionProvider: vi.fn(() => ({ dispose: () => undefined })),
      registerReferenceProvider: vi.fn(() => ({ dispose: () => undefined })),
      registerRenameProvider: vi.fn(
        (_language: string, provider: Monaco.languages.RenameProvider) => {
          renameProvider = provider;

          return { dispose: () => undefined };
        },
      ),
    },
  } as unknown as typeof Monaco;

  return {
    get renameProvider() {
      return renameProvider;
    },
    monaco,
  };
}

function latteTextModel(
  initialValue: string,
  pushedEdits: { range: unknown; text: string }[][],
): Monaco.editor.ITextModel {
  let value = initialValue;
  let versionId = 1;
  const undoStack: { range: Monaco.Range; text: string }[][] = [];

  const applyEdits = (
    edits: { range: Monaco.Range; text: string }[],
    computeUndoEdits = false,
  ) => {
    const inverseEdits = inverseModelEdits(value, edits);
    value = applyModelEdits(value, edits);
    versionId += 1;

    return computeUndoEdits ? inverseEdits : undefined;
  };

  return {
    getValue: () => value,
    getVersionId: () => versionId,
    getWordUntilPosition: () => ({ endColumn: 1, startColumn: 1, word: "" }),
    applyEdits,
    pushEditOperations: (
      _selections: unknown[],
      edits: { range: Monaco.Range; text: string }[],
    ) => {
      pushedEdits.push(edits);
      const inverseEdits = inverseModelEdits(value, edits);
      value = applyModelEdits(value, edits);
      versionId += 1;
      undoStack.push(inverseEdits);
    },
    pushStackElement: () => undefined,
    uri: {
      fsPath: HOME_PATH,
      path: HOME_PATH,
      scheme: "file",
      toString: () => `file://${HOME_PATH}`,
    },
  } as unknown as Monaco.editor.ITextModel;
}

function applyModelEdits(
  source: string,
  edits: readonly { range: Monaco.Range; text: string }[],
): string {
  return [...edits]
    .map((edit) => ({
      end: modelOffsetAt(
        source,
        edit.range.endLineNumber,
        edit.range.endColumn,
      ),
      start: modelOffsetAt(
        source,
        edit.range.startLineNumber,
        edit.range.startColumn,
      ),
      text: edit.text,
    }))
    .sort((left, right) => right.start - left.start)
    .reduce(
      (content, edit) =>
        `${content.slice(0, edit.start)}${edit.text}${content.slice(edit.end)}`,
      source,
    );
}

function inverseModelEdits(
  source: string,
  edits: readonly { range: Monaco.Range; text: string }[],
): { range: Monaco.Range; text: string }[] {
  const appliedSource = applyModelEdits(source, edits);
  let offsetDelta = 0;

  return [...edits]
    .map((edit) => {
      const start = modelOffsetAt(
        source,
        edit.range.startLineNumber,
        edit.range.startColumn,
      );
      const end = modelOffsetAt(
        source,
        edit.range.endLineNumber,
        edit.range.endColumn,
      );

      return { edit, end, start };
    })
    .sort((left, right) => left.start - right.start)
    .map(({ edit, end, start }) => {
      const updatedStart = start + offsetDelta;
      const updatedEnd = updatedStart + edit.text.length;
      const replacedText = source.slice(start, end);
      offsetDelta += edit.text.length - (end - start);

      return {
        range: modelRangeFromOffsets(appliedSource, updatedStart, updatedEnd),
        text: replacedText,
      };
    })
    .reverse();
}

function modelOffsetAt(source: string, lineNumber: number, column: number) {
  const lines = source.split("\n");
  let offset = 0;

  for (let line = 1; line < lineNumber; line += 1) {
    offset += (lines[line - 1]?.length ?? 0) + 1;
  }

  return offset + column - 1;
}

function modelRangeFromOffsets(
  source: string,
  start: number,
  end: number,
): Monaco.Range {
  const startPosition = positionAtOffset(source, start);
  const endPosition = positionAtOffset(source, end);

  return {
    endColumn: endPosition.column,
    endLineNumber: endPosition.lineNumber,
    startColumn: startPosition.column,
    startLineNumber: startPosition.lineNumber,
  } as Monaco.Range;
}

function positionAtOffset(source: string, offset: number): Monaco.Position {
  const before = source.slice(0, offset);
  const lineStart = before.lastIndexOf("\n") + 1;

  return {
    column: offset - lineStart + 1,
    lineNumber: before.split("\n").length,
  } as Monaco.Position;
}
