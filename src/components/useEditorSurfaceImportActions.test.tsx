// @vitest-environment jsdom

import { act, type MutableRefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import type * as Monaco from "monaco-editor";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyLanguageServerCapabilities } from "../domain/languageServerRuntime";
import {
  MAX_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT,
  MIN_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT,
  type LargeSmartDocumentPolicy,
} from "../domain/largeDocumentPolicy";
import type {
  JavaScriptTypeScriptLanguageServerFeaturesGateway,
  LanguageServerCodeAction,
} from "../domain/languageServerFeatures";
import { fileUriFromPath } from "../domain/languageServerDocumentSync";
import type { EditorDocument } from "../domain/workspace";
import { useEditorSurfaceImportActions } from "./useEditorSurfaceImportActions";

const path = "/workspace/src/example.ts";
const content = "import { b, a } from './values';\n";
const scope = {
  documentPath: path,
  modelIdentity: {} as object,
  ownerKey: null,
  surfaceIdentity: {},
};

describe("useEditorSurfaceImportActions", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("keeps one request in flight and fences a replacement feature gateway", async () => {
    const firstActions = deferred<ReturnType<typeof importSortAction>[]>();
    const firstGateway = gateway(vi.fn(() => firstActions.promise));
    const secondGateway = gateway(vi.fn(async () => [importSortAction()]));
    const executeEdits = vi.fn(() => true);
    const model = {
      getLanguageId: () => "typescript",
      getLineCount: () => 2,
      getValue: () => content,
      getValueLength: () => content.length,
      getVersionId: () => 7,
    } as Monaco.editor.ITextModel;
    const editor = {
      getModel: () => model,
      executeEdits,
    } as unknown as Monaco.editor.IStandaloneCodeEditor;
    const document: EditorDocument = {
      content,
      language: "typescript",
      name: "example.ts",
      path,
      savedContent: content,
    };
    const activeDocumentRef = { current: document };
    const runtimeStatus = {
      capabilities: { ...emptyLanguageServerCapabilities(), codeAction: true },
      kind: "running" as const,
      rootPath: "/workspace",
      sessionId: 41,
    };
    const runtimeStatusRef = { current: runtimeStatus };
    const workspaceRootRef = { current: "/workspace" };
    let actions!: ReturnType<typeof useEditorSurfaceImportActions>;

    const Harness = ({
      featureGateway,
    }: {
      featureGateway: JavaScriptTypeScriptLanguageServerFeaturesGateway;
    }) => {
      actions = useEditorSurfaceImportActions({
        activeDocumentRef,
        captureScope: () => ({ ...scope, modelIdentity: model }),
        editor,
        featureGateway,
        flushPendingDocumentRef: ref(async () => undefined),
        getDocumentSyncVersionRef: ref(() => 7),
        largeSmartDocumentPolicyRef: ref({
          characterLimit: MIN_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT,
          lineLimit: 500,
        }),
        modelMatchesDocument: (candidate, rootPath, documentPath) =>
          candidate === model && rootPath === "/workspace" && documentPath === path,
        reportErrorRef: ref(vi.fn()),
        runtimeStatus,
        runtimeStatusRef,
        workspaceOwnerKey: null,
        workspaceRoot: "/workspace",
        workspaceRootRef,
        workspaceTrusted: true,
      });
      return null;
    };

    await act(async () => root.render(<Harness featureGateway={firstGateway} />));
    expect(actions.isEnabled("typescript.sortImports")).toBe(true);
    await act(async () => {
      actions.run("typescript.sortImports");
      actions.run("typescript.sortImports");
      await Promise.resolve();
    });
    expect(firstGateway.codeActions).toHaveBeenCalledTimes(1);
    expect(actions.isEnabled("typescript.sortImports")).toBe(false);

    await act(async () => root.render(<Harness featureGateway={secondGateway} />));
    expect(actions.isEnabled("typescript.sortImports")).toBe(true);
    await act(async () => {
      actions.run("typescript.sortImports");
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(secondGateway.codeActions).toHaveBeenCalledTimes(1);
    expect(executeEdits).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstActions.resolve([importSortAction()]);
      await firstActions.promise;
      await Promise.resolve();
    });
    expect(executeEdits).toHaveBeenCalledTimes(1);
  });

  it("checks cheap model metrics before reading ordinary import-action content", async () => {
    const codeActions = vi.fn(async () => [importSortAction()]);
    const getValue = vi.fn(() => content);
    const model = modelWithMetrics({
      getValue,
      lineCount: 2,
      utf16Length: content.length,
    });
    const rendered = await renderActions({ codeActions, model });

    expect(rendered.actions.isEnabled("typescript.sortImports")).toBe(true);
    expect(getValue).not.toHaveBeenCalled();

    await act(async () => {
      rendered.actions.run("typescript.sortImports");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getValue).toHaveBeenCalledTimes(1);
    expect(codeActions).toHaveBeenCalledTimes(1);
    act(() => rendered.unmount());
  });

  it("admits the exact configured character threshold and rejects one unit over it", async () => {
    const characterLimit = MIN_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT;
    const exactGetValue = vi.fn(() => "x".repeat(characterLimit));
    const exact = await renderActions({
      codeActions: vi.fn(async () => []),
      model: modelWithMetrics({
        getValue: exactGetValue,
        lineCount: 1,
        utf16Length: characterLimit,
      }),
    });
    expect(exact.actions.isEnabled("typescript.sortImports")).toBe(true);
    expect(exactGetValue).not.toHaveBeenCalled();
    await act(async () => {
      exact.actions.run("typescript.sortImports");
      await Promise.resolve();
    });
    expect(exactGetValue).toHaveBeenCalledTimes(1);
    act(() => exact.unmount());

    const overGetValue = vi.fn(() => {
      throw new Error("large model must not be read");
    });
    const codeActions = vi.fn(async () => []);
    const over = await renderActions({
      codeActions,
      model: modelWithMetrics({
        getValue: overGetValue,
        lineCount: 1,
        utf16Length: characterLimit + 1,
      }),
    });
    expect(over.actions.isEnabled("typescript.sortImports")).toBe(false);
    act(() => over.actions.run("typescript.sortImports"));
    expect(overGetValue).not.toHaveBeenCalled();
    expect(codeActions).not.toHaveBeenCalled();
    act(() => over.unmount());
  });

  it("rejects line-heavy and over-10-MiB fallback models without a full value read", async () => {
    for (const metrics of [
      { lineCount: 501, utf16Length: 500 },
      {
        lineCount: 1,
        utf16Length: MAX_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT + 1,
      },
    ]) {
      const getValue = vi.fn(() => {
        throw new Error("ineligible model must not be read");
      });
      const codeActions = vi.fn(async () => []);
      const rendered = await renderActions({
        codeActions,
        model: modelWithMetrics({ getValue, ...metrics }),
        policy: {
          characterLimit: MAX_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT,
          lineLimit: 500,
        },
      });

      expect(rendered.actions.isEnabled("typescript.sortImports")).toBe(false);
      act(() => rendered.actions.run("typescript.sortImports"));
      expect(getValue).not.toHaveBeenCalled();
      expect(codeActions).not.toHaveBeenCalled();
      act(() => rendered.unmount());
    }
  });

  it("drops an in-flight import action when the live large-file policy becomes stricter", async () => {
    const pending = deferred<ReturnType<typeof importSortAction>[]>();
    const getValue = vi.fn(() => content);
    const rendered = await renderActions({
      codeActions: vi.fn(() => pending.promise),
      model: modelWithMetrics({
        getValue,
        lineCount: 2,
        utf16Length: MIN_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT + 1,
      }),
      policy: {
        characterLimit: MIN_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT + 1,
        lineLimit: 500,
      },
    });

    await act(async () => {
      rendered.actions.run("typescript.sortImports");
      await Promise.resolve();
    });
    rendered.policyRef.current = {
      characterLimit: MIN_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT,
      lineLimit: 500,
    };
    await act(async () => {
      pending.resolve([importSortAction()]);
      await pending.promise;
      await Promise.resolve();
    });

    expect(rendered.executeEdits).not.toHaveBeenCalled();
    act(() => rendered.unmount());
  });
});

function modelWithMetrics({
  getValue,
  lineCount,
  utf16Length,
}: {
  getValue(): string;
  lineCount: number;
  utf16Length: number;
}): Monaco.editor.ITextModel {
  return {
    getLanguageId: () => "typescript",
    getLineCount: () => lineCount,
    getValue,
    getValueLength: () => utf16Length,
    getVersionId: () => 7,
  } as Monaco.editor.ITextModel;
}

async function renderActions({
  codeActions,
  model,
  policy = {
    characterLimit: MIN_LARGE_SMART_DOCUMENT_CHARACTER_LIMIT,
    lineLimit: 500,
  },
}: {
  codeActions: ReturnType<typeof vi.fn>;
  model: Monaco.editor.ITextModel;
  policy?: LargeSmartDocumentPolicy;
}) {
  const host = document.createElement("div");
  document.body.append(host);
  const hookRoot = createRoot(host);
  const activeDocumentRef = {
    current: {
      content,
      language: "typescript",
      name: "example.ts",
      path,
      savedContent: content,
    } satisfies EditorDocument,
  };
  const runtimeStatus = {
    capabilities: { ...emptyLanguageServerCapabilities(), codeAction: true },
    kind: "running" as const,
    rootPath: "/workspace",
    sessionId: 41,
  };
  const runtimeStatusRef = { current: runtimeStatus };
  const workspaceRootRef = { current: "/workspace" };
  const policyRef = ref(policy);
  let actions!: ReturnType<typeof useEditorSurfaceImportActions>;
  const executeEdits = vi.fn(() => true);
  const editor = {
    executeEdits,
    getModel: () => model,
  } as unknown as Monaco.editor.IStandaloneCodeEditor;
  const Harness = () => {
    actions = useEditorSurfaceImportActions({
      activeDocumentRef,
      captureScope: () => ({ ...scope, modelIdentity: model }),
      editor,
      featureGateway: gateway(codeActions),
      flushPendingDocumentRef: ref(async () => undefined),
      getDocumentSyncVersionRef: ref(() => 7),
      largeSmartDocumentPolicyRef: policyRef,
      modelMatchesDocument: (candidate, rootPath, documentPath) =>
        candidate === model && rootPath === "/workspace" && documentPath === path,
      reportErrorRef: ref(vi.fn()),
      runtimeStatus,
      runtimeStatusRef,
      workspaceOwnerKey: null,
      workspaceRoot: "/workspace",
      workspaceRootRef,
      workspaceTrusted: true,
    });
    return null;
  };
  await act(async () => hookRoot.render(<Harness />));
  return {
    actions,
    executeEdits,
    policyRef,
    unmount: () => {
      hookRoot.unmount();
      host.remove();
    },
  };
}

function ref<Value>(current: Value): MutableRefObject<Value> {
  return { current };
}

function gateway(
  codeActions: ReturnType<typeof vi.fn>,
): JavaScriptTypeScriptLanguageServerFeaturesGateway {
  const invokeCodeActions = codeActions as unknown as (...args: unknown[]) => unknown;
  return {
    codeActions: vi.fn(
      (rootPath: string, path: string, range: unknown, context: unknown, sessionId: number) =>
        Object.assign(Promise.resolve(invokeCodeActions(rootPath, path, range, context)), {
          requestId: 1,
          sessionId,
        }),
    ),
    resolveCodeAction: vi.fn(
      (_rootPath: string, action: LanguageServerCodeAction, sessionId: number) =>
        Object.assign(Promise.resolve(action), { requestId: 2, sessionId }),
    ),
  } as unknown as JavaScriptTypeScriptLanguageServerFeaturesGateway;
}

function importSortAction() {
  const uri = fileUriFromPath(path);
  return {
    command: null,
    data: null,
    isPreferred: false,
    kind: "source.sortImports.ts",
    title: "Sort imports",
    edit: {
      changes: {
        [uri]: [
          {
            range: {
              start: { line: 0, character: 9 },
              end: { line: 0, character: 13 },
            },
            newText: "a, b",
          },
        ],
      },
      documentVersions: { [uri]: 7 },
    },
  };
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
