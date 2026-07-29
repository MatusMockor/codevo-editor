// @vitest-environment jsdom

import { act, type SetStateAction } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { LanguageServerFeaturesGateway } from "../domain/languageServerFeatures";
import type { EditorDocument, WorkspaceFileGateway } from "../domain/workspace";
import {
  useWorkspaceEditFileOperations,
  type WorkspaceEditFileOperations,
  type WorkspaceEditFileOperationsDependencies,
} from "./useWorkspaceEditFileOperations";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";
const OLD_PATH = `${ROOT}/src/old.ts`;
const NEW_PATH = `${ROOT}/src/new.ts`;

const DOCUMENT: EditorDocument = {
  content: "export const value = 1;",
  language: "typescript",
  name: "old.ts",
  path: OLD_PATH,
  savedContent: "export const value = 1;",
};

describe("useWorkspaceEditFileOperations document-session topology", () => {
  it("keeps content-only edits on the no-topology fast path", async () => {
    const harness = renderHarness();
    const nextContent = "export const value = 2;";

    await act(async () => {
      await harness.api().applyJavaScriptTypeScriptLanguageServerWorkspaceEdit(
        {
          changes: {
            [`file://${OLD_PATH}`]: [
              {
                newText: nextContent,
                range: {
                  end: { character: DOCUMENT.content.length, line: 0 },
                  start: { character: 0, line: 0 },
                },
              },
            ],
          },
        },
        { openPaths: [], rootPath: ROOT },
      );
    });

    expect(harness.reconcileDocumentSessionTopology).not.toHaveBeenCalled();
    expect(harness.documents()[OLD_PATH]?.content).toBe(nextContent);
    harness.unmount();
  });

  it("commits a rename through the exact topology reconciler", async () => {
    const harness = renderHarness();

    await act(async () => {
      await harness.api().applyJavaScriptTypeScriptLanguageServerWorkspaceEdit(
        {
          changes: {},
          fileOperations: [
            {
              kind: "rename",
              newUri: `file://${NEW_PATH}`,
              oldUri: `file://${OLD_PATH}`,
            },
          ],
        },
        { openPaths: [], rootPath: ROOT },
      );
    });

    expect(harness.reconcileDocumentSessionTopology).toHaveBeenCalledOnce();
    expect(harness.documents()).toEqual({
      [NEW_PATH]: {
        ...DOCUMENT,
        name: "new.ts",
        path: NEW_PATH,
      },
    });
    expect(harness.topologyCalls()).toEqual(1);
    harness.unmount();
  });

  it("fails closed before a delete topology commit across workspace A to B to A", async () => {
    let releaseClose!: () => void;
    const closeSettlement = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });
    const harness = renderHarness({
      syncClosedJavaScriptTypeScriptDocument: vi.fn(() => closeSettlement),
    });

    let operation!: Promise<unknown>;
    act(() => {
      operation = harness.api().applyJavaScriptTypeScriptLanguageServerWorkspaceEdit(
        {
          changes: {},
          fileOperations: [{ kind: "delete", uri: `file://${OLD_PATH}` }],
        },
        { openPaths: [], rootPath: ROOT },
      );
    });

    await vi.waitFor(() => {
      expect(harness.syncClosedJavaScriptTypeScriptDocument).toHaveBeenCalledOnce();
    });
    harness.currentWorkspaceRootRef.current = "/other-workspace";
    harness.replaceDocuments({ [OLD_PATH]: { ...DOCUMENT } });
    harness.currentWorkspaceRootRef.current = ROOT;
    releaseClose();

    await act(async () => {
      await operation;
    });

    expect(harness.reconcileDocumentSessionTopology).not.toHaveBeenCalled();
    expect(harness.documents()).toEqual({ [OLD_PATH]: DOCUMENT });
    harness.unmount();
  });

  it("fails closed when an edit replaces the document projection while delete waits", async () => {
    let releaseClose!: () => void;
    const closeSettlement = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });
    const harness = renderHarness({
      syncClosedJavaScriptTypeScriptDocument: vi.fn(() => closeSettlement),
    });
    const editedDocument = {
      ...DOCUMENT,
      content: `${DOCUMENT.content}\n// typed while delete waited`,
    };

    let operation!: Promise<unknown>;
    act(() => {
      operation = harness.api().applyJavaScriptTypeScriptLanguageServerWorkspaceEdit(
        {
          changes: {},
          fileOperations: [{ kind: "delete", uri: `file://${OLD_PATH}` }],
        },
        { openPaths: [], rootPath: ROOT },
      );
    });

    await vi.waitFor(() => {
      expect(harness.syncClosedJavaScriptTypeScriptDocument).toHaveBeenCalledOnce();
    });
    harness.replaceDocuments({ [OLD_PATH]: editedDocument });
    releaseClose();

    await act(async () => {
      await operation;
    });

    expect(harness.reconcileDocumentSessionTopology).not.toHaveBeenCalled();
    expect(harness.documents()).toEqual({ [OLD_PATH]: editedDocument });
    harness.unmount();
  });
});

interface Harness {
  api: () => WorkspaceEditFileOperations;
  currentWorkspaceRootRef: { current: string | null };
  documents: () => Record<string, EditorDocument>;
  reconcileDocumentSessionTopology: ReturnType<typeof vi.fn>;
  replaceDocuments: (next: Record<string, EditorDocument>) => void;
  syncClosedJavaScriptTypeScriptDocument: ReturnType<typeof vi.fn>;
  topologyCalls: () => number;
  unmount: () => void;
}

function renderHarness(overrides: Partial<WorkspaceEditFileOperationsDependencies> = {}): Harness {
  let documents: Record<string, EditorDocument> = { [OLD_PATH]: DOCUMENT };
  let topologyCalls = 0;
  const documentsRef = { current: documents };
  const currentWorkspaceRootRef = { current: ROOT as string | null };
  const syncClosedJavaScriptTypeScriptDocument =
    overrides.syncClosedJavaScriptTypeScriptDocument ?? vi.fn(async () => undefined);
  const reconcileDocumentSessionTopology = vi.fn(
    (update: SetStateAction<Record<string, EditorDocument>>) => {
      topologyCalls += 1;
      documents = resolveUpdate(documents, update);
      documentsRef.current = documents;
      return true;
    },
  );
  const workspaceFiles: WorkspaceFileGateway = {
    applyWorkspaceEdit: vi.fn(async () => 0),
    applyWorkspaceEditTransaction: vi.fn(async () => ({
      appliedCount: 0,
      rollback: vi.fn(async () => undefined),
    })),
    createDirectory: vi.fn(async () => undefined),
    createTextFile: vi.fn(async () => undefined),
    deletePath: vi.fn(async () => undefined),
    readDirectory: vi.fn(async () => []),
    readTextFile: vi.fn(async () => ""),
    renamePath: vi.fn(async () => undefined),
    writeTextFile: vi.fn(async () => undefined),
  };
  const dependencies: WorkspaceEditFileOperationsDependencies = {
    currentWorkspaceRootRef,
    documentVersionsByUriRef: { current: {} },
    documentsRef,
    hasPhpWorkspace: false,
    isJavaScriptTypeScriptLanguageServerSessionActiveForRoot: () => false,
    isLanguageServerSessionActiveForRoot: () => false,
    isRunningLanguageServerForWorkspace: (
      status,
    ): status is Extract<NonNullable<typeof status>, { kind: "running" }> =>
      status?.kind === "running",
    isSessionPathInWorkspace: (rootPath, path) =>
      path === rootPath || path.startsWith(`${rootPath}/`),
    javaScriptTypeScriptDocumentVersionsByUriRef: { current: {} },
    javaScriptTypeScriptLanguageServerFeaturesGateway: {} as LanguageServerFeaturesGateway,
    javaScriptTypeScriptLanguageServerRuntimeStatus: null,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot: null,
    languageServerFeaturesGateway: {} as LanguageServerFeaturesGateway,
    languageServerRuntimeStatus: null,
    languageServerRuntimeStatusRoot: null,
    openPathsRef: { current: [OLD_PATH] },
    previewPathRef: { current: null },
    reconcileDocumentSessionTopology,
    refreshDirectory: vi.fn(async () => undefined),
    reportChangedDocuments: vi.fn(),
    reportError: vi.fn(),
    setActivePath: vi.fn(),
    setDocuments: (update) => {
      documents = resolveUpdate(documents, update);
      documentsRef.current = documents;
    },
    setMessage: vi.fn(),
    setOpenPaths: vi.fn(),
    setPreviewPath: vi.fn(),
    syncClosedDocument: vi.fn(async () => undefined),
    syncClosedJavaScriptTypeScriptDocument,
    workspaceFiles,
    workspaceRoot: ROOT,
    ...overrides,
  };
  const container = document.createElement("div");
  const root = createRoot(container);
  let currentApi: WorkspaceEditFileOperations | null = null;

  function Component() {
    currentApi = useWorkspaceEditFileOperations(dependencies);
    return null;
  }

  act(() => {
    root.render(<Component />);
  });

  return {
    api: () => {
      expect(currentApi).not.toBeNull();
      return currentApi as WorkspaceEditFileOperations;
    },
    currentWorkspaceRootRef,
    documents: () => documents,
    reconcileDocumentSessionTopology,
    replaceDocuments: (next) => {
      documents = next;
      documentsRef.current = next;
    },
    syncClosedJavaScriptTypeScriptDocument: vi.mocked(syncClosedJavaScriptTypeScriptDocument),
    topologyCalls: () => topologyCalls,
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

function resolveUpdate(
  current: Record<string, EditorDocument>,
  update: SetStateAction<Record<string, EditorDocument>>,
): Record<string, EditorDocument> {
  return typeof update === "function" ? update(current) : update;
}
