// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import type * as Monaco from "monaco-editor";
import type { LanguageServerWorkspaceEdit } from "../../domain/languageServerFeatures";
import { installPerfScenarioBridge } from "../perfScenarioBridge";
import { provideJavaScriptTypeScriptCompletionItems } from "./completion";
import { provideJavaScriptTypeScriptRenameEdits } from "./rename";
import type { JavaScriptTypeScriptProviderRequestBoundary } from "./requestBoundary";

function identified<T>(value: T) {
  return Object.assign(Promise.resolve(value), { requestId: 1, sessionId: 1 });
}

function fakeBoundary<Context>(): JavaScriptTypeScriptProviderRequestBoundary<Context> {
  return {
    attachStoredAuthority: (payload) => payload,
    createFeatureRequest: () =>
      ({
        rootPath: "/root",
        position: { line: 0, character: 0 },
        sessionId: 1,
      }) as never,
    flushActiveRequest: async () => true,
    flushStoredPayload: async () => true,
    isActiveRequest: () => true,
    isStoredPayloadActive: () => true,
    isStoredSessionActive: () => true,
    reportActiveRequestError: () => {},
    reportStoredPayloadError: () => {},
  };
}

const fakeMonaco = {
  languages: {
    CompletionItemKind: {
      Text: 0,
      Method: 1,
      Function: 2,
      Field: 3,
      Variable: 4,
      Class: 5,
      Interface: 6,
      Module: 7,
      Property: 8,
      Value: 9,
      Enum: 10,
      Keyword: 11,
      Snippet: 12,
      File: 13,
      EnumMember: 14,
      Constant: 15,
    },
    CompletionItemInsertTextRule: { InsertAsSnippet: 4, KeepWhitespace: 1 },
    CompletionItemTag: { Deprecated: 1 },
  },
} as unknown as typeof Monaco;

const completionModel = {
  getWordUntilPosition: () => ({ word: "", startColumn: 1, endColumn: 1 }),
  getLineContent: () => "",
} as unknown as Monaco.editor.ITextModel;

const position = { lineNumber: 1, column: 1 } as Monaco.Position;

function bridgeDependencies() {
  return {
    getLatencySnapshot: () => [],
    clearLatencyMetrics: () => {},
    activateDocument: () => {},
    setQuickOpenOpen: () => {},
    setQuickOpenQuery: () => {},
    isQuickOpenLoading: () => false,
    getActiveEditor: () => null,
    getRetainedCounts: () => ({ models: 0, editors: 0 }),
    scheduleFrame: (callback: () => void) => {
      callback();
    },
    now: () => 0,
  };
}

describe("completion provider-ui-ready stop point", () => {
  it("records latency and the probe sample after the UI-ready list is built", async () => {
    const dispose = installPerfScenarioBridge(bridgeDependencies());
    const recordLatency = vi.fn();
    const context = {
      featuresGateway: {
        completion: () =>
          identified({
            isIncomplete: false,
            items: [
              { label: "id", kind: 5, detail: null, insertText: null },
              { label: "label", kind: 5, detail: null, insertText: null },
            ],
          }),
      },
      getActiveDocument: () => ({ language: "typescript" }),
      recordLatency,
    };
    const list = await provideJavaScriptTypeScriptCompletionItems(
      fakeMonaco,
      context as never,
      fakeBoundary(),
      completionModel,
      position,
    );

    expect(list.suggestions).toHaveLength(2);
    expect(recordLatency).toHaveBeenCalledTimes(1);
    expect(recordLatency).toHaveBeenCalledWith("completion", expect.any(Number), "/root");
    expect(window.__codevoPerf!.getProviderProbeSamples("completion")).toEqual([
      { ms: recordLatency.mock.calls[0][1], resultCount: 2 },
    ]);
    dispose();
  });
});

describe("rename provider-ui-ready stop point", () => {
  const workspaceEdit = { changes: {} } as unknown as LanguageServerWorkspaceEdit;
  const resource = { toString: () => "file:///root/a.ts" };
  const convertedEdit = {
    edits: [
      { resource, textEdit: { range: {}, text: "x" } },
      { resource, textEdit: { range: {}, text: "y" } },
    ],
  } as unknown as Monaco.languages.WorkspaceEdit;

  function renameContext(applyWorkspaceEdit: unknown) {
    return {
      applyWorkspaceEdit,
      featuresGateway: {
        identifiedRequests: {
          rename: () => identified(workspaceEdit),
          cancelRequest: async () => {},
        },
      },
      recordLatency: vi.fn(),
    };
  }

  function renameDependencies(applied: { count: number }) {
    return {
      applyWorkspaceEdit: async () => {
        applied.count += 1;
        return true;
      },
      editIsFullyInRoot: () => true,
      toWorkspaceEdit: () => convertedEdit,
    };
  }

  it("computes and converts the edit without applying it while the perf rename probe is armed", async () => {
    const dispose = installPerfScenarioBridge(bridgeDependencies());
    const applied = { count: 0 };
    const context = renameContext(true);
    const renameModel = {} as Monaco.editor.ITextModel;
    let providerResult: Monaco.languages.WorkspaceEdit | null = null;
    let finishAction: (() => void) | null = null;
    const input = document.createElement("input");
    input.value = "OldKind";
    const editor = {
      getAction: (actionId: string) =>
        actionId === "editor.action.rename"
          ? {
              run: () =>
                new Promise<void>((resolve) => {
                  finishAction = resolve;
                }),
            }
          : null,
      trigger: (_source: string, commandId: string) => {
        if (commandId !== "acceptRenameInput") {
          return;
        }

        void provideJavaScriptTypeScriptRenameEdits(
          fakeMonaco,
          context as never,
          fakeBoundary(),
          renameDependencies(applied) as never,
          renameModel,
          position,
          input.value,
        ).then((edit) => {
          providerResult = edit;
          finishAction?.();
        });
      },
    } as unknown as Monaco.editor.ICodeEditor;
    const disposeWithEditor = installPerfScenarioBridge({
      ...bridgeDependencies(),
      getActiveEditor: () => editor,
      getVisibleRenameInput: () => input,
    });

    await expect(window.__codevoPerf!.runRenameWithNewName("OldKindRenamed")).resolves.toBe(true);

    expect(applied.count).toBe(0);
    expect(providerResult).toEqual({ edits: [] });
    expect(context.recordLatency).toHaveBeenCalledWith("rename", expect.any(Number), "/root");
    expect(window.__codevoPerf!.getProviderProbeSamples("rename")).toEqual([
      { ms: context.recordLatency.mock.calls[0][1], resultCount: 1 },
    ]);
    disposeWithEditor();
    dispose();
  });

  it("keeps the normal apply path while still recording the computed+converted sample", async () => {
    const dispose = installPerfScenarioBridge(bridgeDependencies());
    const applied = { count: 0 };
    const context = renameContext(true);
    const result = await provideJavaScriptTypeScriptRenameEdits(
      fakeMonaco,
      context as never,
      fakeBoundary(),
      renameDependencies(applied) as never,
      {} as Monaco.editor.ITextModel,
      position,
      "OldKindRenamed",
    );

    expect(applied.count).toBe(1);
    expect(result).toEqual({ edits: [] });
    expect(context.recordLatency).toHaveBeenCalledTimes(1);
    expect(window.__codevoPerf!.getProviderProbeSamples("rename")).toEqual([
      { ms: context.recordLatency.mock.calls[0][1], resultCount: 1 },
    ]);
    dispose();
  });

  it("never applies a late rename edit after its provider token is cancelled", async () => {
    const dispose = installPerfScenarioBridge(bridgeDependencies());
    const applied = { count: 0 };
    const context = renameContext(true);
    const token = {
      isCancellationRequested: true,
      onCancellationRequested: () => ({ dispose: () => {} }),
    };
    const result = await provideJavaScriptTypeScriptRenameEdits(
      fakeMonaco,
      context as never,
      fakeBoundary(),
      renameDependencies(applied) as never,
      {} as Monaco.editor.ITextModel,
      position,
      "OldKindRenamed",
      token,
    );

    expect(result).toBeNull();
    expect(applied.count).toBe(0);
    dispose();
  });

  it("records the sample even when the edit is rejected as out of root, without applying", async () => {
    const dispose = installPerfScenarioBridge(bridgeDependencies());
    const applied = { count: 0 };
    const context = renameContext(true);
    const dependencies = { ...renameDependencies(applied), editIsFullyInRoot: () => false };
    const result = await provideJavaScriptTypeScriptRenameEdits(
      fakeMonaco,
      context as never,
      fakeBoundary(),
      dependencies as never,
      {} as Monaco.editor.ITextModel,
      position,
      "OldKindRenamed",
    );

    expect(result).toBeNull();
    expect(applied.count).toBe(0);
    expect(window.__codevoPerf!.getProviderProbeSamples("rename")).toHaveLength(1);
    dispose();
  });
});
