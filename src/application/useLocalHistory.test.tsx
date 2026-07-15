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
import { FilePrefetchCache } from "../domain/filePrefetchCache";

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
  activeDocumentRef: { current: EditorDocument | null };
  documentsRef: { current: Record<string, EditorDocument> };
  reportError: ReturnType<typeof vi.fn>;
  reportErrorForActiveWorkspaceRoot: ReturnType<typeof vi.fn>;
  setMessage: ReturnType<typeof vi.fn>;
  captureLocalHistorySnapshot: ReturnType<typeof vi.fn>;
  syncSavedDocument: ReturnType<typeof vi.fn>;
  syncSavedJavaScriptTypeScriptDocument: ReturnType<typeof vi.fn>;
  setDocuments: ReturnType<typeof vi.fn>;
  workspaceFiles: WorkspaceFileGateway;
  unmount: () => void;
}

function renderLocalHistory(
  overrides: Partial<LocalHistoryDependencies> = {},
): Harness {
  const container = globalThis.document.createElement("div");
  const root = createRoot(container);
  const captured: { panel: LocalHistoryPanel | null } = { panel: null };

  const rootRef: { current: string | null } = { current: ROOT };
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
  const captureLocalHistorySnapshot = vi.fn(async () => undefined);
  const syncSavedDocument = vi.fn(async () => undefined);
  const syncSavedJavaScriptTypeScriptDocument = vi.fn(async () => undefined);
  const filePrefetchCacheRef = { current: new FilePrefetchCache() };
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

  const deps: LocalHistoryDependencies = {
    activeDocumentRef,
    captureLocalHistorySnapshot,
    currentWorkspaceRootRef: rootRef,
    documentsRef,
    filePrefetchCacheRef,
    localHistoryGateway: createFakeLocalHistoryGateway(),
    reportError,
    reportErrorForActiveWorkspaceRoot,
    setDocuments: setDocuments as unknown as LocalHistoryDependencies["setDocuments"],
    setMessage,
    syncSavedDocument,
    syncSavedJavaScriptTypeScriptDocument,
    workspaceFiles,
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
    documentsRef,
    panel: () => {
      if (!captured.panel) {
        throw new Error("panel not mounted");
      }
      return captured.panel;
    },
    reportError,
    reportErrorForActiveWorkspaceRoot,
    rootRef,
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
      const writeTextFile = vi.fn(async () => {
        if (status === "partial") {
          return { status, message: `${status} result`, revision: null };
        }

        return { status, message: `${status} result` };
      });
      const harness = renderLocalHistory({
        workspaceFiles: createFakeWorkspaceFiles({ writeTextFile }),
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
      deferred.resolve([version("stale")]);
      await openPromise;
    });

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
