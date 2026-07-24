// @vitest-environment jsdom

import { act, type MutableRefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import type * as Monaco from "monaco-editor";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyLanguageServerCapabilities } from "../domain/languageServerRuntime";
import type {
  LanguageServerCodeAction,
  LanguageServerFeaturesGateway,
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
      getValue: () => content,
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

    const Harness = ({ featureGateway }: { featureGateway: LanguageServerFeaturesGateway }) => {
      actions = useEditorSurfaceImportActions({
        activeDocumentRef,
        captureScope: () => ({ ...scope, modelIdentity: model }),
        editor,
        featureGateway,
        flushPendingDocumentRef: ref(async () => undefined),
        getDocumentSyncVersionRef: ref(() => 7),
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
});

function ref<Value>(current: Value): MutableRefObject<Value> {
  return { current };
}

function gateway(codeActions: ReturnType<typeof vi.fn>): LanguageServerFeaturesGateway {
  return {
    codeActions,
    resolveCodeAction: async (_rootPath: string, action: LanguageServerCodeAction) => action,
  } as unknown as LanguageServerFeaturesGateway;
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
