// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  useLocalHistory,
  type LocalHistoryDependencies,
  type LocalHistoryPanel,
} from "./useLocalHistory";
import type { LocalHistoryGateway, LocalHistoryVersion } from "../domain/localHistory";
import type { EditorDocument, WorkspaceFileGateway } from "../domain/workspace";
import {
  createWorkspaceRuntimeOwner,
  type WorkspaceRuntimeOwner,
} from "../domain/workspaceRuntimeOwner";
import {
  createDocumentSaveIdentity,
  legacyDocumentSaveIdentity,
} from "./documentSaveIdentity";
import { DocumentSaveCoordinator } from "./documentSaveCoordinator";
import type { DocumentSaveResult } from "./documentSaveService";
import { OwnerDocumentSaveRepository } from "./ownerDocumentSaveRepository";

const ROOT = "/workspace";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function editorDocument(
  path: string,
  content = "current content",
): EditorDocument {
  return {
    content,
    language: "php",
    name: path.split("/").pop() ?? path,
    path,
    savedContent: content,
  };
}

function version(id: string, sizeBytes = 10): LocalHistoryVersion {
  return { id, sizeBytes, timestampMs: 1700000000000 };
}

function revision(sequence: number): NonNullable<EditorDocument["revision"]> {
  return {
    contentHash: `hash-${sequence}`,
    device: "1",
    inode: "2",
    modifiedNanoseconds: sequence,
    modifiedSeconds: sequence,
    size: sequence,
  };
}

/**
 * A LocalHistoryGateway whose surface is overridable per test. Only the
 * methods the panel actually calls are stubbed; the rest are cast away since
 * the hook never touches them (real storage is never invoked).
 */
function createFakeLocalHistoryGateway(
  overrides: Partial<LocalHistoryGateway> = {},
): LocalHistoryGateway {
  const base = {
    listVersions: vi.fn(async () => [] as LocalHistoryVersion[]),
    readVersion: vi.fn(async () => "stored content"),
    recordSnapshot: vi.fn(async () => null),
  };
  return { ...base, ...overrides } as unknown as LocalHistoryGateway;
}

function createFakeWorkspaceFiles(
  overrides: Partial<WorkspaceFileGateway> = {},
): WorkspaceFileGateway {
  const base = {
    applyWorkspaceEdit: vi.fn(async () => 0),
    createDirectory: vi.fn(async () => undefined),
    createTextFile: vi.fn(async () => undefined),
    deletePath: vi.fn(async () => undefined),
    readDirectory: vi.fn(async () => []),
    readTextFile: vi.fn(async () => ""),
    renamePath: vi.fn(async () => undefined),
    writeTextFile: vi.fn(async () => undefined),
  };
  return { ...base, ...overrides } as unknown as WorkspaceFileGateway;
}

interface Harness {
  panel: () => LocalHistoryPanel;
  rootRef: { current: string | null };
  ownerRef: { current: WorkspaceRuntimeOwner | null };
  activeDocumentRef: { current: EditorDocument | null };
  documentsRef: { current: Record<string, EditorDocument> };
  reportError: ReturnType<typeof vi.fn>;
  reportErrorForActiveWorkspaceRoot: ReturnType<typeof vi.fn>;
  setMessage: ReturnType<typeof vi.fn>;
  captureLocalHistorySnapshot: ReturnType<typeof vi.fn>;
  invalidateOwnerDocumentPrefetch: ReturnType<typeof vi.fn>;
  syncSavedDocument: ReturnType<typeof vi.fn>;
  syncSavedJavaScriptTypeScriptDocument: ReturnType<typeof vi.fn>;
  setDocuments: ReturnType<typeof vi.fn>;
  workspaceFiles: WorkspaceFileGateway;
  documentSaveCoordinator: DocumentSaveCoordinator<DocumentSaveResult>;
  rerender: () => void;
  unmount: () => void;
}

function renderLocalHistory(
  overrides: Partial<LocalHistoryDependencies> = {},
): Harness {
  const container = globalThis.document.createElement("div");
  const root = createRoot(container);
  const captured: { panel: LocalHistoryPanel | null } = { panel: null };

  const rootRef: { current: string | null } = { current: ROOT };
  const ownerRef: { current: WorkspaceRuntimeOwner | null } = {
    current: createWorkspaceRuntimeOwner("workspace-a", ROOT),
  };
  const activeDocument = editorDocument(`${ROOT}/src/User.php`);
  const activeDocumentRef: { current: EditorDocument | null } = {
    current: activeDocument,
  };
  const documentsRef: { current: Record<string, EditorDocument> } = {
    current: { [activeDocument.path]: activeDocument },
  };
  const reportError = vi.fn();
  const reportErrorForActiveWorkspaceRoot = vi.fn();
  const setMessage = vi.fn();
  const captureLocalHistorySnapshot = vi.fn(
    async (_rootPath: string, _path: string, _content: string) => undefined,
  );
  const invalidateOwnerDocumentPrefetch = vi.fn();
  const syncSavedDocument = vi.fn(
    async (_rootPath: string, _document: EditorDocument) => undefined,
  );
  const syncSavedJavaScriptTypeScriptDocument = vi.fn(
    async (_rootPath: string, _document: EditorDocument) => undefined,
  );
  const workspaceFiles = createFakeWorkspaceFiles();
  const setDocuments = vi.fn(
    (
      updater:
        | Record<string, EditorDocument>
        | ((
            current: Record<string, EditorDocument>,
          ) => Record<string, EditorDocument>),
    ) => {
      documentsRef.current =
        typeof updater === "function" ? updater(documentsRef.current) : updater;
    },
  );
  const repositoryIncarnation = {};
  let documentIncarnation = {};
  let trackedDocument = activeDocument;
  const repositoryCandidate = {
    kind: "active" as const,
    get owner() {
      return ownerRef.current ?? createWorkspaceRuntimeOwner("stale", ROOT);
    },
    get rootPath() {
      return rootRef.current ?? ROOT;
    },
    incarnation: repositoryIncarnation,
    readDocument: (identity: string) => {
      const identityParts = identity.split("\0");
      const relativePath = identityParts[identityParts.length - 1];
      const current = relativePath
        ? Object.values(documentsRef.current).find(
            (document) => document.path.endsWith(`/${relativePath}`),
          )
        : null;
      if (!current) {
        return null;
      }
      if (current !== trackedDocument) {
        trackedDocument = current;
        documentIncarnation = {};
      }
      return { document: current, incarnation: documentIncarnation };
    },
    replaceDocument: (
      _identity: string,
      expectedRepositoryIncarnation: object,
      expectedDocumentIncarnation: object,
      expectedDocument: EditorDocument,
      nextDocument: EditorDocument,
    ) => {
      if (expectedRepositoryIncarnation !== repositoryIncarnation) {
        return false;
      }
      if (expectedDocumentIncarnation !== documentIncarnation) {
        return false;
      }
      if (documentsRef.current[expectedDocument.path] !== expectedDocument) {
        return false;
      }
      trackedDocument = nextDocument;
      documentsRef.current = {
        ...documentsRef.current,
        [nextDocument.path]: nextDocument,
      };
      if (activeDocumentRef.current?.path === nextDocument.path) {
        activeDocumentRef.current = nextDocument;
      }
      return true;
    },
  };
  const ownerDocumentSaveRepository = new OwnerDocumentSaveRepository({
    active: () => repositoryCandidate,
    cached: () => null,
  });
  const documentSaveCoordinator =
    new DocumentSaveCoordinator<DocumentSaveResult>();

  const deps: LocalHistoryDependencies = {
    activeDocumentRef,
    beginOwnerDocumentSelfWrite: () => null,
    captureLocalHistorySnapshot: (_owner, requestedRoot, path, content) =>
      captureLocalHistorySnapshot(requestedRoot, path, content),
    currentWorkspaceRootRef: rootRef,
    invalidateOwnerDocumentPrefetch,
    localHistoryGateway: createFakeLocalHistoryGateway(),
    ownerDocumentSaveRepository,
    resolveCurrentWorkspaceRuntimeOwner: () => ownerRef.current,
    resolveDocumentSaveOwnership: (rootPath, path) =>
      legacyDocumentSaveIdentity(rootPath, path),
    reportError,
    reportErrorForActiveWorkspaceRoot,
    requestOwnerDocumentSave: async (ownership, operation) => {
      const outcome = await documentSaveCoordinator.request(
        ownership,
        operation,
      );
      return outcome.status === "saved"
        ? outcome.result
        : { status: "stale" };
    },
    setMessage,
    syncSavedDocument: (_owner, rootPath, document) =>
      syncSavedDocument(rootPath, document),
    syncSavedJavaScriptTypeScriptDocument: (_owner, rootPath, document) =>
      syncSavedJavaScriptTypeScriptDocument(rootPath, document),
    writeOwnerDocument: (_owner, _rootPath, document, content) =>
      document.revision
        ? workspaceFiles.writeTextFile(document.path, content, document.revision)
        : workspaceFiles.writeTextFile(document.path, content),
    workspaceRoot: ROOT,
    ...overrides,
  };

  function Harness() {
    captured.panel = useLocalHistory(deps);
    return null;
  }

  act(() => {
    root.render(<Harness />);
  });

  return {
    activeDocumentRef,
    captureLocalHistorySnapshot,
    documentSaveCoordinator,
    documentsRef,
    invalidateOwnerDocumentPrefetch,
    panel: () => {
      if (!captured.panel) {
        throw new Error("panel not mounted");
      }
      return captured.panel;
    },
    reportError,
    reportErrorForActiveWorkspaceRoot,
    rerender: () => {
      act(() => {
        root.render(<Harness />);
      });
    },
    rootRef,
    ownerRef,
    setDocuments,
    setMessage,
    syncSavedDocument,
    syncSavedJavaScriptTypeScriptDocument,
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
    workspaceFiles,
  };
}

describe("useLocalHistory", () => {
  it("opens the panel, lists versions for the active file, and loads a selected version's diff", async () => {
    const listVersions = vi.fn(async () => [version("v2"), version("v1")]);
    const readVersion = vi.fn(async () => "older content");
    const harness = renderLocalHistory({
      localHistoryGateway: createFakeLocalHistoryGateway({
        listVersions,
        readVersion,
      }),
    });

    await act(async () => {
      await harness.panel().openLocalHistory();
    });

    expect(listVersions).toHaveBeenCalledWith(ROOT, "src/User.php");
    expect(harness.panel().localHistoryPanelOpen).toBe(true);
    expect(harness.panel().localHistoryRelativePath).toBe("src/User.php");
    expect(harness.panel().localHistoryVersions).toHaveLength(2);
    expect(harness.panel().localHistoryLoading).toBe(false);

    await act(async () => {
      await harness.panel().selectLocalHistoryVersion("v1");
    });

    expect(readVersion).toHaveBeenCalledWith(ROOT, "src/User.php", "v1");
    expect(harness.panel().localHistorySelectedId).toBe("v1");
    expect(harness.panel().localHistoryDiff?.originalContent).toBe(
      "older content",
    );
    expect(harness.panel().localHistoryDiff?.modifiedContent).toBe(
      "current content",
    );
    harness.unmount();
  });

  it("closes the panel and resets every field", async () => {
    const listVersions = vi.fn(async () => [version("v1")]);
    const harness = renderLocalHistory({
      localHistoryGateway: createFakeLocalHistoryGateway({ listVersions }),
    });

    await act(async () => {
      await harness.panel().openLocalHistory();
    });
    await act(async () => {
      await harness.panel().selectLocalHistoryVersion("v1");
    });

    act(() => {
      harness.panel().closeLocalHistory();
    });

    expect(harness.panel().localHistoryPanelOpen).toBe(false);
    expect(harness.panel().localHistoryVersions).toEqual([]);
    expect(harness.panel().localHistoryDiff).toBeNull();
    expect(harness.panel().localHistoryRelativePath).toBeNull();
    harness.unmount();
  });

  it("reverts to a selected version: snapshots the pre-revert content, writes the version, and refreshes", async () => {
    let listCalls = 0;
    const listVersions = vi.fn(async () => {
      listCalls += 1;
      return listCalls < 2 ? [version("v2"), version("v1")] : [version("v1")];
    });
    const readVersion = vi.fn(async () => "reverted content");
    const harness = renderLocalHistory({
      localHistoryGateway: createFakeLocalHistoryGateway({
        listVersions,
        readVersion,
      }),
    });

    await act(async () => {
      await harness.panel().openLocalHistory();
    });
    await act(async () => {
      await harness.panel().revertLocalHistoryVersion("v1");
    });

    expect(readVersion).toHaveBeenCalledWith(ROOT, "src/User.php", "v1");
    // Pre-revert content ("current content") is snapshotted first, then the
    // reverted content is captured again as the newest version.
    expect(harness.captureLocalHistorySnapshot).toHaveBeenNthCalledWith(
      1,
      ROOT,
      `${ROOT}/src/User.php`,
      "current content",
    );
    expect(harness.captureLocalHistorySnapshot).toHaveBeenNthCalledWith(
      2,
      ROOT,
      `${ROOT}/src/User.php`,
      "reverted content",
    );
    expect(harness.workspaceFiles.writeTextFile).toHaveBeenCalledWith(
      `${ROOT}/src/User.php`,
      "reverted content",
    );
    expect(harness.syncSavedDocument).toHaveBeenCalledWith(
      ROOT,
      expect.objectContaining({
        path: `${ROOT}/src/User.php`,
        content: "reverted content",
      }),
    );
    expect(harness.syncSavedJavaScriptTypeScriptDocument).toHaveBeenCalledWith(
      ROOT,
      expect.objectContaining({
        path: `${ROOT}/src/User.php`,
        content: "reverted content",
      }),
    );
    expect(harness.setMessage).toHaveBeenCalledWith(
      "Reverted to selected local history version",
    );
    // The refresh re-lists the versions for the panel.
    expect(listVersions).toHaveBeenCalledTimes(2);
    harness.unmount();
  });

  it("keeps an issued revert write visible to a close drain before close/reopen continues", async () => {
    const write = createDeferred<void>();
    const history = createDeferred<void>();
    const nextRevision = revision(2);
    const identity = legacyDocumentSaveIdentity(
      ROOT,
      `${ROOT}/src/User.php`,
    );
    if (!identity) {
      throw new Error("expected a document save identity");
    }
    let diskContent = "current content";
    const writeOwnerDocument = vi.fn(async (
      _owner: WorkspaceRuntimeOwner,
      _rootPath: string,
      _document: EditorDocument,
      content: string,
    ) => {
      await write.promise;
      diskContent = content;
      return { status: "success" as const, revision: nextRevision };
    });
    const harness = renderLocalHistory({
      captureLocalHistorySnapshot: async () => history.promise,
      writeOwnerDocument,
    });

    await act(async () => {
      await harness.panel().openLocalHistory();
    });
    let revertPromise: Promise<void> | null = null;
    act(() => {
      revertPromise = harness.panel().revertLocalHistoryVersion("v1");
    });
    await vi.waitFor(() => expect(writeOwnerDocument).toHaveBeenCalledOnce());

    let contentSeenByClose: string | null = null;
    const closeDrain = harness.documentSaveCoordinator.runWithIssuedWriteDrain(
      {
        kind: "file",
        rootPath: ROOT,
        path: `${ROOT}/src/User.php`,
      },
      async () => {
        contentSeenByClose = diskContent;
        harness.documentSaveCoordinator.invalidate(identity);
        const reopened = {
          ...editorDocument(`${ROOT}/src/User.php`, diskContent),
          revision: nextRevision,
        };
        harness.documentsRef.current = { [reopened.path]: reopened };
        harness.activeDocumentRef.current = reopened;
      },
    );
    await Promise.resolve();
    expect(contentSeenByClose).toBeNull();

    await act(async () => {
      write.resolve();
      await closeDrain;
    });
    expect(harness.syncSavedDocument).not.toHaveBeenCalled();

    await act(async () => {
      history.resolve();
      await revertPromise;
    });

    expect(contentSeenByClose).toBe("stored content");
    expect(harness.activeDocumentRef.current).toEqual(
      expect.objectContaining({
        content: "stored content",
        savedContent: "stored content",
        revision: nextRevision,
      }),
    );
    harness.unmount();
  });

  it("preserves typing during a revert write while acknowledging saved content and revision", async () => {
    const write = createDeferred<void>();
    const nextRevision = revision(3);
    const writeOwnerDocument = vi.fn(async () => {
      await write.promise;
      return { status: "success" as const, revision: nextRevision };
    });
    const harness = renderLocalHistory({ writeOwnerDocument });

    await act(async () => {
      await harness.panel().openLocalHistory();
    });
    let revertPromise: Promise<void> | null = null;
    act(() => {
      revertPromise = harness.panel().revertLocalHistoryVersion("v1");
    });
    await vi.waitFor(() => expect(writeOwnerDocument).toHaveBeenCalledOnce());

    const beforeEdit = harness.activeDocumentRef.current;
    if (!beforeEdit) {
      throw new Error("expected an active document");
    }
    const typed = { ...beforeEdit, content: "typed during revert" };
    harness.documentsRef.current = { [typed.path]: typed };
    harness.activeDocumentRef.current = typed;

    await act(async () => {
      write.resolve();
      await revertPromise;
    });

    expect(harness.documentsRef.current[typed.path]).toEqual(
      expect.objectContaining({
        content: "typed during revert",
        savedContent: "stored content",
        revision: nextRevision,
      }),
    );
    expect(harness.syncSavedDocument).not.toHaveBeenCalled();
    expect(harness.setMessage).toHaveBeenCalledWith(
      "Reverted to selected local history version",
    );
    harness.unmount();
  });

  it("acknowledges an issued revert after the panel closes", async () => {
    const write = createDeferred<void>();
    const nextRevision = revision(31);
    const complete = vi.fn();
    const writeOwnerDocument = vi.fn(async () => {
      await write.promise;
      return { status: "success" as const, revision: nextRevision };
    });
    const harness = renderLocalHistory({
      beginOwnerDocumentSelfWrite: () => ({ abort: vi.fn(), complete }),
      writeOwnerDocument,
    });

    await act(async () => {
      await harness.panel().openLocalHistory();
    });
    let revertPromise: Promise<void> | null = null;
    act(() => {
      revertPromise = harness.panel().revertLocalHistoryVersion("v1");
    });
    await vi.waitFor(() => expect(writeOwnerDocument).toHaveBeenCalledOnce());
    act(() => harness.panel().closeLocalHistory());

    await act(async () => {
      write.resolve();
      await revertPromise;
    });

    expect(complete).toHaveBeenCalledWith(nextRevision);
    expect(harness.activeDocumentRef.current).toEqual(
      expect.objectContaining({
        content: "stored content",
        savedContent: "stored content",
        revision: nextRevision,
      }),
    );
    expect(harness.invalidateOwnerDocumentPrefetch).toHaveBeenCalledWith(
      harness.ownerRef.current,
      `${ROOT}/src/User.php`,
    );
    expect(harness.captureLocalHistorySnapshot).not.toHaveBeenCalled();
    expect(harness.syncSavedDocument).not.toHaveBeenCalled();
    expect(harness.setMessage).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("completes self-write and advances only revision for a partial revert", async () => {
    const write = createDeferred<void>();
    const nextRevision = revision(4);
    const complete = vi.fn();
    const abort = vi.fn();
    const harness = renderLocalHistory({
      beginOwnerDocumentSelfWrite: () => ({ abort, complete }),
      writeOwnerDocument: async () => {
        await write.promise;
        return {
          status: "partial",
          message: "fsync failed",
          revision: nextRevision,
        };
      },
    });

    await act(async () => {
      await harness.panel().openLocalHistory();
    });
    let revertPromise: Promise<void> | null = null;
    act(() => {
      revertPromise = harness.panel().revertLocalHistoryVersion("v1");
    });
    await vi.waitFor(() => expect(complete).not.toHaveBeenCalled());

    await act(async () => {
      write.resolve();
      await revertPromise;
    });

    expect(complete).toHaveBeenCalledWith(nextRevision);
    expect(abort).not.toHaveBeenCalled();
    expect(harness.activeDocumentRef.current).toEqual(
      expect.objectContaining({
        content: "current content",
        savedContent: "current content",
        revision: nextRevision,
      }),
    );
    expect(harness.captureLocalHistorySnapshot).not.toHaveBeenCalled();
    expect(harness.reportErrorForActiveWorkspaceRoot).toHaveBeenCalledWith(
      ROOT,
      "Local History",
      expect.objectContaining({
        message: expect.stringContaining("durability could not be confirmed"),
      }),
    );
    harness.unmount();
  });

  it("acknowledges an issued partial revert after switching tabs", async () => {
    const write = createDeferred<void>();
    const nextRevision = revision(41);
    const complete = vi.fn();
    const writeOwnerDocument = vi.fn(async () => {
      await write.promise;
      return {
        status: "partial" as const,
        message: "fsync failed",
        revision: nextRevision,
      };
    });
    const harness = renderLocalHistory({
      beginOwnerDocumentSelfWrite: () => ({ abort: vi.fn(), complete }),
      writeOwnerDocument,
    });

    await act(async () => {
      await harness.panel().openLocalHistory();
    });
    let revertPromise: Promise<void> | null = null;
    act(() => {
      revertPromise = harness.panel().revertLocalHistoryVersion("v1");
    });
    await vi.waitFor(() => expect(writeOwnerDocument).toHaveBeenCalledOnce());
    const otherDocument = editorDocument(`${ROOT}/src/Account.php`, "other");
    harness.documentsRef.current[otherDocument.path] = otherDocument;
    harness.activeDocumentRef.current = otherDocument;
    harness.rerender();

    await act(async () => {
      write.resolve();
      await revertPromise;
    });

    expect(complete).toHaveBeenCalledWith(nextRevision);
    expect(harness.documentsRef.current[`${ROOT}/src/User.php`]).toEqual(
      expect.objectContaining({
        content: "current content",
        savedContent: "current content",
        revision: nextRevision,
      }),
    );
    expect(harness.invalidateOwnerDocumentPrefetch).toHaveBeenCalledWith(
      harness.ownerRef.current,
      `${ROOT}/src/User.php`,
    );
    expect(harness.reportErrorForActiveWorkspaceRoot).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("does not revert file A after the active document switches to file B", async () => {
    const readVersion = vi.fn(async () => "reverted content");
    const harness = renderLocalHistory({
      localHistoryGateway: createFakeLocalHistoryGateway({ readVersion }),
    });

    await act(async () => {
      await harness.panel().openLocalHistory();
    });

    harness.activeDocumentRef.current = editorDocument(
      `${ROOT}/src/Account.php`,
    );

    await act(async () => {
      await harness.panel().revertLocalHistoryVersion("v1");
    });

    expect(readVersion).not.toHaveBeenCalled();
    expect(harness.workspaceFiles.writeTextFile).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("does not revert after the active workspace owner is replaced at the same root", async () => {
    const readVersion = vi.fn(async () => "reverted content");
    const harness = renderLocalHistory({
      localHistoryGateway: createFakeLocalHistoryGateway({ readVersion }),
    });

    await act(async () => {
      await harness.panel().openLocalHistory();
    });

    harness.ownerRef.current = createWorkspaceRuntimeOwner(
      "workspace-b",
      ROOT,
    );

    await act(async () => {
      await harness.panel().revertLocalHistoryVersion("v1");
    });

    expect(readVersion).not.toHaveBeenCalled();
    expect(harness.workspaceFiles.writeTextFile).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("does not let an old revert write after the panel reopens for another file during read", async () => {
    const deferred = createDeferred<string>();
    const readVersion = vi.fn(() => deferred.promise);
    const harness = renderLocalHistory({
      localHistoryGateway: createFakeLocalHistoryGateway({ readVersion }),
    });

    await act(async () => {
      await harness.panel().openLocalHistory();
    });

    let revertPromise: Promise<void> | null = null;
    act(() => {
      revertPromise = harness.panel().revertLocalHistoryVersion("v1");
    });

    const nextDocument = editorDocument(`${ROOT}/src/Account.php`);
    harness.documentsRef.current[nextDocument.path] = nextDocument;
    harness.activeDocumentRef.current = nextDocument;

    await act(async () => {
      await harness.panel().openLocalHistory();
    });

    await act(async () => {
      deferred.resolve("stale reverted content");
      await revertPromise;
    });

    expect(harness.panel().localHistoryRelativePath).toBe("src/Account.php");
    expect(harness.workspaceFiles.writeTextFile).not.toHaveBeenCalled();
    expect(harness.captureLocalHistorySnapshot).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("keeps a nested-root revert bound to the captured workspace owner", async () => {
    const nestedRoot = `${ROOT}/packages/nested`;
    const nestedPath = `${nestedRoot}/src/User.php`;
    const document = editorDocument(nestedPath);
    const writeOwnerDocument = vi.fn(async () => undefined);
    const harness = renderLocalHistory({
      resolveDocumentSaveOwnership: () =>
        createDocumentSaveIdentity(nestedRoot, "src/User.php"),
      writeOwnerDocument,
    });
    harness.activeDocumentRef.current = document;
    harness.documentsRef.current = { [nestedPath]: document };

    await act(async () => {
      await harness.panel().openLocalHistory();
      await harness.panel().revertLocalHistoryVersion("v1");
    });

    expect(writeOwnerDocument).toHaveBeenCalledWith(
      harness.ownerRef.current,
      ROOT,
      document,
      "stored content",
    );
    harness.unmount();
  });

  it("rejects an old revert after closing and reopening the same file", async () => {
    const deferred = createDeferred<string>();
    const writeOwnerDocument = vi.fn(async () => undefined);
    const harness = renderLocalHistory({
      localHistoryGateway: createFakeLocalHistoryGateway({
        readVersion: vi.fn(() => deferred.promise),
      }),
      writeOwnerDocument,
    });

    await act(async () => {
      await harness.panel().openLocalHistory();
    });
    let revertPromise: Promise<void> | null = null;
    act(() => {
      revertPromise = harness.panel().revertLocalHistoryVersion("v1");
      harness.panel().closeLocalHistory();
    });
    const reopened = editorDocument(`${ROOT}/src/User.php`, "reopened content");
    harness.documentsRef.current = { [reopened.path]: reopened };
    harness.activeDocumentRef.current = reopened;
    await act(async () => {
      await harness.panel().openLocalHistory();
      deferred.resolve("stale content");
      await revertPromise;
    });

    expect(writeOwnerDocument).not.toHaveBeenCalled();
    expect(harness.documentsRef.current[reopened.path]).toBe(reopened);
    harness.unmount();
  });

  it("allows only the newest concurrent revert request to write", async () => {
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    const reads = [first, second];
    const writeOwnerDocument = vi.fn(async () => undefined);
    const harness = renderLocalHistory({
      localHistoryGateway: createFakeLocalHistoryGateway({
        readVersion: vi.fn(() => reads.shift()?.promise ?? Promise.reject()),
      }),
      writeOwnerDocument,
    });

    await act(async () => {
      await harness.panel().openLocalHistory();
    });
    let firstRevert: Promise<void> | null = null;
    let secondRevert: Promise<void> | null = null;
    act(() => {
      firstRevert = harness.panel().revertLocalHistoryVersion("v1");
      secondRevert = harness.panel().revertLocalHistoryVersion("v2");
    });
    await act(async () => {
      second.resolve("newest content");
      await secondRevert;
      first.resolve("stale content");
      await firstRevert;
    });

    expect(writeOwnerDocument).toHaveBeenCalledTimes(1);
    expect(writeOwnerDocument).toHaveBeenCalledWith(
      expect.anything(),
      ROOT,
      expect.anything(),
      "newest content",
    );
    harness.unmount();
  });

  it("clears the panel and loading state when its owner is invalidated", async () => {
    const deferred = createDeferred<LocalHistoryVersion[]>();
    const harness = renderLocalHistory({
      localHistoryGateway: createFakeLocalHistoryGateway({
        listVersions: vi.fn(() => deferred.promise),
      }),
    });
    let openPromise: Promise<void> | null = null;
    act(() => {
      openPromise = harness.panel().openLocalHistory();
    });
    expect(harness.panel().localHistoryLoading).toBe(true);

    harness.ownerRef.current = createWorkspaceRuntimeOwner("workspace-b", ROOT);
    harness.rerender();

    expect(harness.panel().localHistoryPanelOpen).toBe(false);
    expect(harness.panel().localHistoryLoading).toBe(false);
    expect(harness.panel().localHistoryRelativePath).toBeNull();
    await act(async () => {
      deferred.resolve([version("stale")]);
      await openPromise;
    });
    expect(harness.panel().localHistoryVersions).toEqual([]);
    harness.unmount();
  });

  it.each([
    `${ROOT}/../outside.php`,
    `${ROOT}/src/./User.php`,
    `${ROOT}/src//User.php`,
    `${ROOT}-other/User.php`,
  ])("rejects escaped or mismatched panel path %s", async (path) => {
    const listVersions = vi.fn(async () => [] as LocalHistoryVersion[]);
    const harness = renderLocalHistory({
      activeDocumentRef: { current: editorDocument(path) },
      localHistoryGateway: createFakeLocalHistoryGateway({ listVersions }),
    });

    await act(async () => {
      await harness.panel().openLocalHistory();
    });

    expect(listVersions).not.toHaveBeenCalled();
    expect(harness.panel().localHistoryPanelOpen).toBe(false);
    harness.unmount();
  });

  it("skips the pre-revert snapshot when the version content already matches the current content", async () => {
    const readVersion = vi.fn(async () => "current content");
    const harness = renderLocalHistory({
      localHistoryGateway: createFakeLocalHistoryGateway({ readVersion }),
    });

    await act(async () => {
      await harness.panel().openLocalHistory();
    });
    await act(async () => {
      await harness.panel().revertLocalHistoryVersion("v1");
    });

    // Only the post-write "record as newest" snapshot is captured; there is no
    // pre-revert snapshot because nothing actually changed.
    expect(harness.captureLocalHistorySnapshot).toHaveBeenCalledTimes(1);
    harness.unmount();
  });

  it("reports the error and does not write when reading the version to revert fails", async () => {
    const readVersion = vi.fn(async () => {
      throw new Error("read failed");
    });
    const harness = renderLocalHistory({
      localHistoryGateway: createFakeLocalHistoryGateway({ readVersion }),
    });

    await act(async () => {
      await harness.panel().openLocalHistory();
    });
    await act(async () => {
      await harness.panel().revertLocalHistoryVersion("v1");
    });

    expect(harness.workspaceFiles.writeTextFile).not.toHaveBeenCalled();
    expect(harness.reportErrorForActiveWorkspaceRoot).toHaveBeenCalledWith(
      ROOT,
      "Local History",
      expect.any(Error),
    );
    harness.unmount();
  });

  it.each(["conflict", "partial", "error"] as const)(
    "does not apply, sync, report success, or record history on a %s write result",
    async (status) => {
      const writeTextFile = vi.fn(async (
        _path: string,
        _content: string,
        _revision: EditorDocument["revision"],
      ) => {
        if (status === "partial") {
          return { status, message: `${status} result`, revision: null };
        }

        return { status, message: `${status} result` };
      });
      const harness = renderLocalHistory({
        writeOwnerDocument: (_owner, _rootPath, document, content) =>
          writeTextFile(document.path, content, document.revision),
      });

      await act(async () => {
        await harness.panel().openLocalHistory();
        await harness.panel().revertLocalHistoryVersion("v1");
      });

      expect(harness.captureLocalHistorySnapshot).not.toHaveBeenCalled();
      expect(harness.syncSavedDocument).not.toHaveBeenCalled();
      expect(harness.syncSavedJavaScriptTypeScriptDocument).not.toHaveBeenCalled();
      expect(harness.setMessage).not.toHaveBeenCalledWith(
        "Reverted to selected local history version",
      );
      expect(harness.reportErrorForActiveWorkspaceRoot).toHaveBeenCalledWith(
        ROOT,
        "Local History",
        expect.any(Error),
      );
      harness.unmount();
    },
  );

  it("does nothing when there is no active document", async () => {
    const listVersions = vi.fn(async () => []);
    const harness = renderLocalHistory({
      activeDocumentRef: { current: null },
      localHistoryGateway: createFakeLocalHistoryGateway({ listVersions }),
    });

    await act(async () => {
      await harness.panel().openLocalHistory();
    });

    expect(listVersions).not.toHaveBeenCalled();
    expect(harness.panel().localHistoryPanelOpen).toBe(false);
    harness.unmount();
  });

  it("drops a stale version list after the panel is closed (last-open-wins)", async () => {
    const deferred = createDeferred<LocalHistoryVersion[]>();
    const listVersions = vi.fn(() => deferred.promise);
    const harness = renderLocalHistory({
      localHistoryGateway: createFakeLocalHistoryGateway({ listVersions }),
    });

    let openPromise: Promise<void> | null = null;
    act(() => {
      openPromise = harness.panel().openLocalHistory();
    });

    await act(async () => {
      harness.panel().closeLocalHistory();
      await Promise.resolve();
    });

    await act(async () => {
      deferred.resolve([version("stale")]);
      await openPromise;
    });

    expect(harness.panel().localHistoryPanelOpen).toBe(false);
    expect(harness.panel().localHistoryVersions).toEqual([]);
    harness.unmount();
  });

  it("drops a version list whose workspace root changed mid-flight", async () => {
    const deferred = createDeferred<LocalHistoryVersion[]>();
    const listVersions = vi.fn(() => deferred.promise);
    const harness = renderLocalHistory({
      localHistoryGateway: createFakeLocalHistoryGateway({ listVersions }),
    });

    let openPromise: Promise<void> | null = null;
    act(() => {
      openPromise = harness.panel().openLocalHistory();
    });

    await act(async () => {
      // The active tab switched away before the list resolves.
      harness.rootRef.current = "/other";
      harness.ownerRef.current = createWorkspaceRuntimeOwner(
        "workspace-b",
        "/other",
      );
      harness.rerender();
      deferred.resolve([version("stale")]);
      await openPromise;
    });

    expect(harness.panel().localHistoryPanelOpen).toBe(false);
    expect(harness.panel().localHistoryLoading).toBe(false);
    expect(harness.panel().localHistoryVersions).toEqual([]);
    harness.unmount();
  });

  it("keeps only the last diff when version selections race (per-selection last-wins)", async () => {
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    const calls = [first, second];
    let call = 0;
    const readVersion = vi.fn(() => calls[call++].promise);
    const harness = renderLocalHistory({
      localHistoryGateway: createFakeLocalHistoryGateway({ readVersion }),
    });

    await act(async () => {
      await harness.panel().openLocalHistory();
    });

    let firstSelect: Promise<void> | null = null;
    let secondSelect: Promise<void> | null = null;
    act(() => {
      firstSelect = harness.panel().selectLocalHistoryVersion("v-old");
      secondSelect = harness.panel().selectLocalHistoryVersion("v-new");
    });

    await act(async () => {
      // Resolve the superseded (first) request last; its result must be
      // dropped.
      second.resolve("second content");
      await secondSelect;
      first.resolve("first content");
      await firstSelect;
    });

    expect(harness.panel().localHistoryDiff?.originalContent).toBe(
      "second content",
    );
    expect(harness.panel().localHistorySelectedId).toBe("v-new");
    harness.unmount();
  });
});
