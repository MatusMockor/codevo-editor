// @vitest-environment jsdom

import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  useDocumentLifecycle,
  type DocumentLifecycle,
  type DocumentLifecycleDependencies,
} from "./useDocumentLifecycle";
import type { GitChangedFile } from "../domain/git";
import { emptyGitStatus } from "../domain/git";
import type { LocalHistoryGateway } from "../domain/localHistory";
import { defaultWorkspaceSettings } from "../domain/settings";
import {
  nextActiveEditorPathAfterClose,
  type EditorDocument,
  type WorkspaceFileGateway,
} from "../domain/workspace";
import { FilePrefetchCache } from "../domain/filePrefetchCache";
import {
  emptyRecentlyClosedTabs,
  hasRecentlyClosedTabs,
} from "../domain/recentlyClosedTabs";
import type { DocumentCloseSessionPort } from "./useDocumentCloseLifecycle";

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
  savedContent = content,
): EditorDocument {
  return {
    content,
    language: "php",
    name: path.split("/").pop() ?? path,
    path,
    savedContent,
  };
}

function replaceLiveDocument(harness: Harness, document: EditorDocument): void {
  harness.documentsRef.current = {
    ...harness.documentsRef.current,
    [document.path]: document,
  };
  if (harness.activeDocumentRef.current?.path === document.path) {
    harness.activeDocumentRef.current = document;
  }
}

function gitChangedFile(path: string): GitChangedFile {
  return {
    isStaged: false,
    isUnversioned: false,
    oldPath: null,
    oldRelativePath: null,
    path,
    relativePath: path.replace(`${ROOT}/`, ""),
    status: "modified",
  };
}

function gitDiffDocumentPath(change: GitChangedFile): string {
  return `mockor-git-diff:worktree:${change.path}`;
}

function createFakeLocalHistoryGateway(
  overrides: Partial<LocalHistoryGateway> = {},
): LocalHistoryGateway {
  const base = {
    listVersions: vi.fn(async () => []),
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
  lifecycle: () => DocumentLifecycle;
  rootRef: { current: string | null };
  workspaceRequestTokenRef: { current: number };
  activeDocumentRef: { current: EditorDocument | null };
  documentsRef: { current: Record<string, EditorDocument> };
  openPathsRef: { current: string[] };
  previewPathRef: { current: string | null };
  localHistoryGateway: LocalHistoryGateway;
  workspaceFiles: WorkspaceFileGateway;
  prompter: { confirm: ReturnType<typeof vi.fn>; prompt: ReturnType<typeof vi.fn> };
  formattedContentForSave: ReturnType<typeof vi.fn>;
  optimizedImportsContentForSave: ReturnType<typeof vi.fn>;
  organizedImportsContentForSave: ReturnType<typeof vi.fn>;
  resolveEditorConfigForFile: ReturnType<typeof vi.fn>;
  syncSavedDocument: ReturnType<typeof vi.fn>;
  syncSavedJavaScriptTypeScriptDocument: ReturnType<typeof vi.fn>;
  syncClosedDocument: ReturnType<typeof vi.fn>;
  syncClosedJavaScriptTypeScriptDocument: ReturnType<typeof vi.fn>;
  clearPhpLocalDiagnosticsForPath: ReturnType<typeof vi.fn>;
  clearLanguageServerDiagnosticsForPath: ReturnType<typeof vi.fn>;
  loadGitDiffDocument: ReturnType<typeof vi.fn>;
  closeGitDiffPreview: ReturnType<typeof vi.fn>;
  closeEmptyWorkbenchSurface: ReturnType<typeof vi.fn>;
  setActivePath: ReturnType<typeof vi.fn>;
  setOpenPaths: ReturnType<typeof vi.fn>;
  setPreviewPath: ReturnType<typeof vi.fn>;
  setMessage: ReturnType<typeof vi.fn>;
  reportErrorForActiveWorkspaceRoot: ReturnType<typeof vi.fn>;
  runEslintAnalysisOnSave: ReturnType<typeof vi.fn>;
  runPhpstanAnalysisOnSave: ReturnType<typeof vi.fn>;
  recentlyClosedTabsRef: {
    current: ReturnType<typeof emptyRecentlyClosedTabs>;
  };
  openRecentlyClosedDocument: ReturnType<typeof vi.fn>;
  restoreRecentlyClosedDocumentViewState: ReturnType<typeof vi.fn>;
  rerender: (overrides: Partial<DocumentLifecycleDependencies>) => void;
  unmount: () => void;
}

function renderLifecycle(
  overrides: Partial<DocumentLifecycleDependencies> = {},
  options: { strictMode?: boolean } = {},
): Harness {
  const container = globalThis.document.createElement("div");
  const root = createRoot(container);
  const captured: { lifecycle: DocumentLifecycle | null } = { lifecycle: null };

  const defaultActiveDocument = editorDocument(`${ROOT}/src/User.php`);
  const activeDocument =
    "activeDocument" in overrides
      ? overrides.activeDocument ?? null
      : defaultActiveDocument;
  const initialDocuments = overrides.documents ?? {
    ...(activeDocument ? { [activeDocument.path]: activeDocument } : {}),
  };
  const initialOpenPaths =
    overrides.openPaths ?? (activeDocument ? [activeDocument.path] : []);
  const initialPreviewPath = overrides.previewPath ?? null;
  const initialActivePath =
    "activePath" in overrides
      ? overrides.activePath ?? null
      : activeDocument?.path ?? null;
  const rootRef: { current: string | null } = { current: ROOT };
  const workspaceRequestTokenRef = { current: 1 };
  const activeDocumentRef: { current: EditorDocument | null } = {
    current: activeDocument,
  };
  const documentsRef: { current: Record<string, EditorDocument> } = {
    current: initialDocuments,
  };
  const openPathsRef: { current: string[] } = { current: initialOpenPaths };
  const previewPathRef: { current: string | null } = {
    current: initialPreviewPath,
  };
  const filePrefetchCacheRef = { current: new FilePrefetchCache() };
  const externallyRemovedDocumentRootByPathRef: {
    current: Record<string, string>;
  } = { current: {} };
  const gitDiffRequestTokenRef = { current: 0 };
  const selectedGitChangeRef: { current: GitChangedFile | null } = {
    current: null,
  };
  const recentlyClosedTabsRef = { current: emptyRecentlyClosedTabs() };

  const localHistoryGateway = createFakeLocalHistoryGateway();
  const workspaceFiles = createFakeWorkspaceFiles();
  const prompter = { confirm: vi.fn(() => true), prompt: vi.fn(() => null) };

  const formattedContentForSave = vi.fn(
    async (document: EditorDocument) => document.content,
  );
  const optimizedImportsContentForSave = vi.fn(
    (_document: EditorDocument, content: string) => content,
  );
  const organizedImportsContentForSave = vi.fn(
    async (_document: EditorDocument, content: string) => content,
  );
  const resolveEditorConfigForFile = vi.fn(async () => ({}));

  const syncSavedDocument = vi.fn(async () => undefined);
  const syncSavedJavaScriptTypeScriptDocument = vi.fn(async () => undefined);
  const syncClosedDocument = vi.fn(async () => undefined);
  const syncClosedJavaScriptTypeScriptDocument = vi.fn(async () => undefined);

  const clearPhpLocalDiagnosticsForPath = vi.fn();
  const clearLanguageServerDiagnosticsForPath = vi.fn();
  const loadGitDiffDocument = vi.fn();
  const closeGitDiffPreview = vi.fn();
  const closeEmptyWorkbenchSurface = vi.fn();

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
  const setPreviewPath = vi.fn(
    (
      updater:
        | string
        | null
        | ((current: string | null) => string | null),
    ) => {
      previewPathRef.current =
        typeof updater === "function"
          ? updater(previewPathRef.current)
          : updater;
    },
  );
  const setOpenPaths = vi.fn(
    (updater: string[] | ((current: string[]) => string[])) => {
      openPathsRef.current =
        typeof updater === "function" ? updater(openPathsRef.current) : updater;
    },
  );
  const setActivePath = vi.fn();
  const setGitDiffLoading = vi.fn();
  const setSelectedGitChange = vi.fn();
  const setGitDiffPreview = vi.fn();
  const setMessage = vi.fn();
  const reportErrorForActiveWorkspaceRoot = vi.fn();
  const runEslintAnalysisOnSave = vi.fn();
  const runPhpstanAnalysisOnSave = vi.fn();
  const openRecentlyClosedDocument = vi.fn(async () => true);
  const restoreRecentlyClosedDocumentViewState = vi.fn();
  const documentTabSession: DocumentCloseSessionPort =
    overrides.documentTabSession ?? {
      getActivePath: () => activeDocumentRef.current?.path ?? null,
      getDocument: (path) => documentsRef.current[path] ?? null,
      removeDocument: (path) => {
        const removedDocument = documentsRef.current[path] ?? null;
        const activePath = activeDocumentRef.current?.path ?? null;

        if (!removedDocument) {
          return {
            closedActiveDocument: false,
            nextActivePath: activePath,
            removedDocument: null,
          };
        }

        const closedActiveDocument = activePath === path;
        const nextActivePath = closedActiveDocument
          ? nextActiveEditorPathAfterClose(
              path,
              openPathsRef.current,
              previewPathRef.current,
            )
          : activePath;
        const nextDocuments = { ...documentsRef.current };
        delete nextDocuments[path];
        const nextOpenPaths = openPathsRef.current.filter(
          (openPath) => openPath !== path,
        );
        const nextPreviewPath =
          previewPathRef.current === path ? null : previewPathRef.current;

        documentsRef.current = nextDocuments;
        openPathsRef.current = nextOpenPaths;
        previewPathRef.current = nextPreviewPath;
        if (closedActiveDocument) {
          activeDocumentRef.current = nextActivePath
            ? (nextDocuments[nextActivePath] ?? null)
            : null;
        }

        setDocuments(nextDocuments);
        setOpenPaths(nextOpenPaths);
        setPreviewPath(nextPreviewPath);
        if (closedActiveDocument) {
          setActivePath(nextActivePath);
        }

        return { closedActiveDocument, nextActivePath, removedDocument };
      },
    };

  const deps: DocumentLifecycleDependencies = {
    workspaceRoot: ROOT,
    activeDocument,
    documents: initialDocuments,
    openPaths: initialOpenPaths,
    activePath: initialActivePath,
    previewPath: initialPreviewPath,
    gitStatus: emptyGitStatus(),
    selectedGitChange: null,
    gitDiffLoading: false,
    documentTabSession,
    workspaceSettings: defaultWorkspaceSettings(),
    currentWorkspaceRootRef: rootRef,
    workspaceRequestTokenRef,
    activeDocumentRef,
    documentsRef,
    openPathsRef,
    previewPathRef,
    filePrefetchCacheRef,
    externallyRemovedDocumentRootByPathRef,
    gitDiffRequestTokenRef,
    selectedGitChangeRef,
    setDocuments:
      setDocuments as unknown as DocumentLifecycleDependencies["setDocuments"],
    setPreviewPath,
    setOpenPaths,
    setActivePath,
    setGitDiffLoading,
    setSelectedGitChange,
    setGitDiffPreview,
    setMessage,
    localHistoryGateway,
    workspaceFiles,
    prompter: prompter as unknown as DocumentLifecycleDependencies["prompter"],
    formattedContentForSave,
    optimizedImportsContentForSave,
    organizedImportsContentForSave,
    resolveEditorConfigForFile,
    syncSavedDocument,
    syncSavedJavaScriptTypeScriptDocument,
    syncClosedDocument,
    syncClosedJavaScriptTypeScriptDocument,
    clearPhpLocalDiagnosticsForPath,
    clearLanguageServerDiagnosticsForPath,
    loadGitDiffDocument,
    closeGitDiffPreview,
    closeEmptyWorkbenchSurface,
    isGitDiffDocumentPath: (path: string) =>
      path.startsWith("mockor-git-diff:"),
    gitChangeForDiffDocumentPath: () => null,
    reportErrorForActiveWorkspaceRoot,
    runEslintAnalysisOnSave,
    runPhpstanAnalysisOnSave,
    recentlyClosedTabsRef,
    recentlyClosedDocumentViewState: () => undefined,
    openRecentlyClosedDocument,
    restoreRecentlyClosedDocumentViewState,
    onRecentlyClosedTabsChange: vi.fn(),
    ...overrides,
  };

  function HarnessComponent() {
    captured.lifecycle = useDocumentLifecycle(deps);
    return null;
  }

  act(() => {
    root.render(
      options.strictMode ? (
        <StrictMode>
          <HarnessComponent />
        </StrictMode>
      ) : (
        <HarnessComponent />
      ),
    );
  });

  return {
    lifecycle: () => {
      if (!captured.lifecycle) {
        throw new Error("lifecycle not mounted");
      }
      return captured.lifecycle;
    },
    rootRef,
    workspaceRequestTokenRef,
    activeDocumentRef,
    documentsRef,
    openPathsRef,
    previewPathRef,
    localHistoryGateway,
    workspaceFiles,
    prompter,
    formattedContentForSave,
    optimizedImportsContentForSave,
    organizedImportsContentForSave,
    resolveEditorConfigForFile,
    syncSavedDocument,
    syncSavedJavaScriptTypeScriptDocument,
    syncClosedDocument,
    syncClosedJavaScriptTypeScriptDocument,
    clearPhpLocalDiagnosticsForPath,
    clearLanguageServerDiagnosticsForPath,
    loadGitDiffDocument,
    closeGitDiffPreview,
    closeEmptyWorkbenchSurface,
    setActivePath,
    setOpenPaths,
    setPreviewPath,
    setMessage,
    reportErrorForActiveWorkspaceRoot,
    runEslintAnalysisOnSave,
    runPhpstanAnalysisOnSave,
    recentlyClosedTabsRef,
    openRecentlyClosedDocument,
    restoreRecentlyClosedDocumentViewState,
    rerender: (nextOverrides) => {
      Object.assign(deps, nextOverrides);
      act(() => {
        root.render(<HarnessComponent />);
      });
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

describe("useDocumentLifecycle", () => {
  it("exposes result-bearing path saves while retaining the void active facade", async () => {
    const harness = renderLifecycle();
    const path = harness.activeDocumentRef.current?.path;
    if (!path) {
      throw new Error("expected active document");
    }

    let result!: Awaited<ReturnType<DocumentLifecycle["saveDocument"]>>;
    let facadeResult!: void;
    await act(async () => {
      result = await harness.lifecycle().saveDocument(path);
      facadeResult = await harness.lifecycle().saveActiveDocument();
    });

    expect(result.status).toBe("saved");
    expect(facadeResult).toBeUndefined();
    harness.unmount();
  });

  describe("saveActiveDocument", () => {
    it("publishes an authoritative disk snapshot on a typed revision conflict and blocks stale retry", async () => {
      const loadedRevision = revision(1);
      const diskRevision = revision(2);
      const document = {
        ...editorDocument(`${ROOT}/src/User.php`, "editor", "baseline"),
        revision: loadedRevision,
      };
      let conflicted = false;
      const detectSaveConflict = vi.fn(() => {
        conflicted = true;
      });
      const workspaceFiles = createFakeWorkspaceFiles({
        readTextFileSnapshot: vi.fn(async () => ({
          content: "disk",
          revision: diskRevision,
        })),
        writeTextFile: vi.fn(async () => ({
          status: "conflict" as const,
          message: "changed",
        })),
      });
      const harness = renderLifecycle({
        activeDocument: document,
        documents: { [document.path]: document },
        detectSaveConflict,
        hasExternalFileConflict: () => conflicted,
        workspaceFiles,
      });

      await act(async () => {
        await harness.lifecycle().saveActiveDocument();
        await harness.lifecycle().saveActiveDocument();
      });

      expect(workspaceFiles.writeTextFile).toHaveBeenCalledOnce();
      expect(workspaceFiles.writeTextFile).toHaveBeenCalledWith(
        document.path,
        "editor",
        loadedRevision,
      );
      expect(detectSaveConflict).toHaveBeenCalledWith(ROOT, document, {
        content: "disk",
        revision: diskRevision,
      });
      expect(harness.syncSavedDocument).not.toHaveBeenCalled();
      expect(harness.localHistoryGateway.recordSnapshot).not.toHaveBeenCalled();
      harness.unmount();
    });

    it("publishes a retryable unreadable conflict when the save-conflict snapshot fails", async () => {
      const document = {
        ...editorDocument(`${ROOT}/src/User.php`, "editor", "baseline"),
        revision: revision(1),
      };
      let conflicted = false;
      const detectSaveConflict = vi.fn(() => { conflicted = true; });
      const workspaceFiles = createFakeWorkspaceFiles({
        readTextFileSnapshot: vi.fn(async () => { throw new Error("unreadable"); }),
        writeTextFile: vi.fn(async () => ({
          status: "conflict" as const,
          message: "changed",
        })),
      });
      const harness = renderLifecycle({
        activeDocument: document,
        documents: { [document.path]: document },
        detectSaveConflict,
        hasExternalFileConflict: () => conflicted,
        workspaceFiles,
      });

      await act(async () => {
        await harness.lifecycle().saveActiveDocument();
        await harness.lifecycle().saveActiveDocument();
      });

      expect(detectSaveConflict).toHaveBeenCalledWith(ROOT, document, null);
      expect(workspaceFiles.writeTextFile).toHaveBeenCalledOnce();
      expect(harness.syncSavedDocument).not.toHaveBeenCalled();
      expect(harness.setMessage).toHaveBeenCalledWith(
        "The file changed on disk. Review the conflict before saving.",
      );
      harness.unmount();
    });

    it("does not show a disk-change message when the workspace switches during the conflict read", async () => {
      const snapshot = createDeferred<{
        content: string;
        revision: ReturnType<typeof revision>;
      }>();
      const document = {
        ...editorDocument(`${ROOT}/src/User.php`, "editor", "baseline"),
        revision: revision(1),
      };
      const detectSaveConflict = vi.fn();
      const workspaceFiles = createFakeWorkspaceFiles({
        readTextFileSnapshot: vi.fn(() => snapshot.promise),
        writeTextFile: vi.fn(async () => ({
          status: "conflict" as const,
          message: "changed",
        })),
      });
      const harness = renderLifecycle({
        activeDocument: document,
        documents: { [document.path]: document },
        detectSaveConflict,
        workspaceFiles,
      });

      let save!: Promise<void>;
      await act(async () => {
        save = harness.lifecycle().saveActiveDocument();
        await Promise.resolve();
      });
      harness.rootRef.current = "/other-workspace";
      await act(async () => {
        snapshot.resolve({ content: "disk", revision: revision(2) });
        await save;
      });

      expect(detectSaveConflict).not.toHaveBeenCalled();
      expect(harness.setMessage).not.toHaveBeenCalledWith(
        "The file changed on disk. Review the conflict before saving.",
      );
      harness.unmount();
    });

    it("uses the current save-conflict callback after dependency replacement", async () => {
      const document = {
        ...editorDocument(`${ROOT}/src/User.php`, "editor", "baseline"),
        revision: revision(1),
      };
      const staleDetectSaveConflict = vi.fn();
      const currentDetectSaveConflict = vi.fn();
      const workspaceFiles = createFakeWorkspaceFiles({
        readTextFileSnapshot: vi.fn(async () => ({
          content: "disk",
          revision: revision(2),
        })),
        writeTextFile: vi.fn(async () => ({
          status: "conflict" as const,
          message: "changed",
        })),
      });
      const harness = renderLifecycle({
        activeDocument: document,
        documents: { [document.path]: document },
        detectSaveConflict: staleDetectSaveConflict,
        workspaceFiles,
      });
      harness.rerender({ detectSaveConflict: currentDetectSaveConflict });

      await act(async () => {
        await harness.lifecycle().saveActiveDocument();
      });

      expect(staleDetectSaveConflict).not.toHaveBeenCalled();
      expect(currentDetectSaveConflict).toHaveBeenCalledWith(
        ROOT,
        document,
        { content: "disk", revision: revision(2) },
      );
      harness.unmount();
    });

    it("keeps a partial write dirty but advances revision for a consistent retry", async () => {
      const oldRevision = revision(1);
      const partialRevision = revision(2);
      const finalRevision = revision(3);
      const document = {
        ...editorDocument(`${ROOT}/src/User.php`, "editor", "baseline"),
        revision: oldRevision,
      };
      const writeTextFile = vi
        .fn()
        .mockResolvedValueOnce({
          status: "partial" as const,
          message: "directory sync failed",
          revision: partialRevision,
        })
        .mockResolvedValueOnce({
          status: "success" as const,
          revision: finalRevision,
        });
      const harness = renderLifecycle({
        activeDocument: document,
        documents: { [document.path]: document },
        workspaceFiles: createFakeWorkspaceFiles({ writeTextFile }),
      });

      await act(async () => {
        await harness.lifecycle().saveActiveDocument();
      });
      expect(harness.documentsRef.current[document.path].savedContent).toBe("baseline");
      expect(harness.documentsRef.current[document.path].revision).toEqual(partialRevision);
      expect(harness.syncSavedDocument).not.toHaveBeenCalled();

      await act(async () => {
        await harness.lifecycle().saveActiveDocument();
      });
      expect(writeTextFile).toHaveBeenNthCalledWith(
        2,
        document.path,
        "editor",
        partialRevision,
      );
      expect(harness.documentsRef.current[document.path].savedContent).toBe("editor");
      expect(harness.documentsRef.current[document.path].revision).toEqual(finalRevision);
      expect(harness.syncSavedDocument).toHaveBeenCalledOnce();
      harness.unmount();
    });

    it("aborts with zero writes when a conflict arrives during preparation", async () => {
      const formatting = createDeferred<string>();
      let conflicted = false;
      const activeDocument = editorDocument(
        `${ROOT}/src/User.php`,
        "edited",
        "saved",
      );
      const harness = renderLifecycle({
        activeDocument,
        documents: { [activeDocument.path]: activeDocument },
        formattedContentForSave: vi.fn(() => formatting.promise),
        hasExternalFileConflict: () => conflicted,
      });

      let save!: Promise<void>;
      act(() => { save = harness.lifecycle().saveActiveDocument(); });
      conflicted = true;
      await act(async () => { formatting.resolve("formatted"); await save; });

      expect(harness.workspaceFiles.writeTextFile).not.toHaveBeenCalled();
      expect(harness.setMessage).toHaveBeenCalledWith(
        "Resolve the external file conflict before saving.",
      );
      harness.unmount();
    });

    it("does not acknowledge or sync when a conflict arrives during the write", async () => {
      const write = createDeferred<void>();
      let conflicted = false;
      const writeTextFile = vi.fn(() => write.promise);
      const activeDocument = editorDocument(
        `${ROOT}/src/User.php`,
        "edited",
        "saved",
      );
      const harness = renderLifecycle({
        activeDocument,
        documents: { [activeDocument.path]: activeDocument },
        hasExternalFileConflict: () => conflicted,
        workspaceFiles: createFakeWorkspaceFiles({ writeTextFile }),
      });

      let save!: Promise<void>;
      act(() => { save = harness.lifecycle().saveActiveDocument(); });
      await vi.waitFor(() => expect(writeTextFile).toHaveBeenCalledTimes(1));
      conflicted = true;
      await act(async () => { write.resolve(); await save; });

      expect(harness.documentsRef.current[activeDocument.path].savedContent).toBe(
        "saved",
      );
      expect(harness.syncSavedDocument).not.toHaveBeenCalled();
      expect(harness.localHistoryGateway.recordSnapshot).not.toHaveBeenCalled();
      harness.unmount();
    });
    it("composes format + organize-imports + editorconfig, writes, snapshots, syncs, and clears dirty", async () => {
      const activeDocument = editorDocument(
        `${ROOT}/src/User.php`,
        "edited",
        "original",
      );
      const harness = renderLifecycle({
        activeDocument,
        documents: { [activeDocument.path]: activeDocument },
      });
      harness.activeDocumentRef.current = activeDocument;

      await act(async () => {
        await harness.lifecycle().saveActiveDocument();
      });

      expect(harness.formattedContentForSave).toHaveBeenCalledWith(
        activeDocument,
        ROOT,
      );
      expect(harness.optimizedImportsContentForSave).toHaveBeenCalledWith(
        activeDocument,
        "edited",
      );
      expect(harness.organizedImportsContentForSave).toHaveBeenCalledWith(
        activeDocument,
        "edited",
        ROOT,
      );
      expect(harness.resolveEditorConfigForFile).toHaveBeenCalledWith(
        ROOT,
        activeDocument.path,
      );
      expect(harness.workspaceFiles.writeTextFile).toHaveBeenCalledWith(
        activeDocument.path,
        "edited",
      );
      // Local History snapshot records the just-saved content in the requested
      // workspace's bucket (relative path).
      expect(harness.localHistoryGateway.recordSnapshot).toHaveBeenCalledWith(
        ROOT,
        "src/User.php",
        "edited",
      );
      expect(harness.syncSavedDocument).toHaveBeenCalled();
      expect(harness.syncSavedJavaScriptTypeScriptDocument).toHaveBeenCalled();
      // Dirty flag cleared: savedContent now equals the written content.
      expect(harness.documentsRef.current[activeDocument.path].savedContent).toBe(
        "edited",
      );
      expect(harness.setMessage).toHaveBeenCalledWith("Saved User.php");
      harness.unmount();
    });

    it("records the Local History snapshot before the did-save sync", async () => {
      const order: string[] = [];
      const recordSnapshot = vi.fn(async () => {
        order.push("snapshot");
        return null;
      });
      const syncSavedDocument = vi.fn(async () => {
        order.push("sync");
        return undefined;
      });
      const activeDocument = editorDocument(`${ROOT}/src/User.php`, "edited");
      const harness = renderLifecycle({
        activeDocument,
        documents: { [activeDocument.path]: activeDocument },
        localHistoryGateway: createFakeLocalHistoryGateway({ recordSnapshot }),
        syncSavedDocument,
      });
      harness.activeDocumentRef.current = activeDocument;

      await act(async () => {
        await harness.lifecycle().saveActiveDocument();
      });

      expect(order).toEqual(["snapshot", "sync"]);
      harness.unmount();
    });

    it("does nothing when there is no active document", async () => {
      const harness = renderLifecycle();
      harness.activeDocumentRef.current = null;

      await act(async () => {
        await harness.lifecycle().saveActiveDocument();
      });

      expect(harness.formattedContentForSave).not.toHaveBeenCalled();
      expect(harness.workspaceFiles.writeTextFile).not.toHaveBeenCalled();
      harness.unmount();
    });

    it("does nothing for a read-only document", async () => {
      const readOnly = { ...editorDocument(`${ROOT}/src/User.php`), readOnly: true };
      const harness = renderLifecycle({ activeDocument: readOnly });
      harness.activeDocumentRef.current = readOnly;

      await act(async () => {
        await harness.lifecycle().saveActiveDocument();
      });

      expect(harness.formattedContentForSave).not.toHaveBeenCalled();
      harness.unmount();
    });

    it("does nothing when there is no workspace root", async () => {
      const harness = renderLifecycle({ workspaceRoot: null });

      await act(async () => {
        await harness.lifecycle().saveActiveDocument();
      });

      expect(harness.formattedContentForSave).not.toHaveBeenCalled();
      harness.unmount();
    });

    it("drops the write when the workspace root changes mid-format (stale tab)", async () => {
      const deferred = createDeferred<string>();
      const formattedContentForSave = vi.fn(() => deferred.promise);
      const activeDocument = editorDocument(`${ROOT}/src/User.php`, "edited");
      const harness = renderLifecycle({
        activeDocument,
        documents: { [activeDocument.path]: activeDocument },
        formattedContentForSave,
      });
      harness.activeDocumentRef.current = activeDocument;

      let savePromise: Promise<void> | null = null;
      act(() => {
        savePromise = harness.lifecycle().saveActiveDocument();
      });

      await act(async () => {
        // The active tab switched away before formatting resolves.
        harness.rootRef.current = "/other";
        deferred.resolve("edited");
        await savePromise;
      });

      expect(harness.workspaceFiles.writeTextFile).not.toHaveBeenCalled();
      expect(harness.syncSavedDocument).not.toHaveBeenCalled();
      harness.unmount();
    });

    it("does not write a deleted path when close invalidates a save during preparation", async () => {
      const formatting = createDeferred<string>();
      const formattedContentForSave = vi.fn(() => formatting.promise);
      const activeDocument = editorDocument(
        `${ROOT}/src/User.php`,
        "edited",
        "saved",
      );
      const harness = renderLifecycle({
        activeDocument,
        documents: { [activeDocument.path]: activeDocument },
        formattedContentForSave,
      });

      let savePromise!: Promise<void>;
      act(() => {
        savePromise = harness.lifecycle().saveActiveDocument();
      });
      await vi.waitFor(() => {
        expect(formattedContentForSave).toHaveBeenCalledOnce();
      });

      act(() => {
        harness.lifecycle().closeDocument(activeDocument.path, {
          recordRecentlyClosed: false,
          skipConfirmation: true,
        });
      });
      await act(async () => {
        formatting.resolve("formatted");
        await savePromise;
      });

      expect(harness.workspaceFiles.writeTextFile).not.toHaveBeenCalled();
      expect(harness.documentsRef.current[activeDocument.path]).toBeUndefined();
      harness.unmount();
    });

    it("acknowledges an active save before the exclusion callback begins", async () => {
      const write = createDeferred<void>();
      const events: string[] = [];
      const writeTextFile = vi.fn(async () => {
        await write.promise;
        events.push("write");
      });
      const recordSnapshot = vi.fn(async () => {
        events.push("history");
        return null;
      });
      const syncSavedDocument = vi.fn(async () => {
        events.push("didSave");
      });
      const activeDocument = editorDocument(
        `${ROOT}/src/User.php`,
        "edited",
        "saved",
      );
      const harness = renderLifecycle({
        activeDocument,
        documents: { [activeDocument.path]: activeDocument },
        localHistoryGateway: createFakeLocalHistoryGateway({ recordSnapshot }),
        syncSavedDocument,
        workspaceFiles: createFakeWorkspaceFiles({ writeTextFile }),
      });

      let savePromise!: Promise<void>;
      act(() => {
        savePromise = harness.lifecycle().saveActiveDocument();
      });
      await vi.waitFor(() => expect(writeTextFile).toHaveBeenCalledOnce());

      const exclusionCallback = vi.fn(async () => {
        events.push("callback");
        expect(
          harness.documentsRef.current[activeDocument.path].savedContent,
        ).toBe("edited");
        expect(recordSnapshot).toHaveBeenCalledOnce();
        expect(syncSavedDocument).toHaveBeenCalledOnce();
        return "excluded";
      });
      let exclusionPromise!: Promise<string>;
      act(() => {
        exclusionPromise = harness.lifecycle().runWithDocumentSaveExclusion(
          {
            kind: "file",
            path: activeDocument.path,
            rootPath: ROOT,
          },
          exclusionCallback,
        );
      });
      await Promise.resolve();
      expect(exclusionCallback).not.toHaveBeenCalled();

      let result!: string;
      await act(async () => {
        write.resolve();
        [, result] = await Promise.all([savePromise, exclusionPromise]);
      });

      expect(result).toBe("excluded");
      expect(events).toEqual(["write", "history", "didSave", "callback"]);
      harness.unmount();
    });

    it("exposes the issued-write drain through the composition facade", async () => {
      const formatting = createDeferred<string>();
      const activeDocument = editorDocument(
        `${ROOT}/src/User.php`,
        "edited",
        "saved",
      );
      const formattedContentForSave = vi.fn(() => formatting.promise);
      const harness = renderLifecycle({
        activeDocument,
        documents: { [activeDocument.path]: activeDocument },
        formattedContentForSave,
      });

      const save = harness.lifecycle().saveActiveDocument();
      await vi.waitFor(() =>
        expect(formattedContentForSave).toHaveBeenCalledOnce(),
      );
      const callback = vi.fn(async () => "drained");

      await expect(
        harness.lifecycle().runWithIssuedWriteDrain(
          { kind: "workspace", rootPath: ROOT },
          callback,
        ),
      ).resolves.toBe("drained");
      expect(callback).toHaveBeenCalledOnce();

      formatting.resolve("formatted");
      await save;
      expect(harness.workspaceFiles.writeTextFile).not.toHaveBeenCalled();
      harness.unmount();
    });

    it("drops a pending save when an exclusion starts", async () => {
      const firstWrite = createDeferred<void>();
      const writeTextFile = vi.fn(() => firstWrite.promise);
      const activeDocument = editorDocument(
        `${ROOT}/src/User.php`,
        "first",
        "saved",
      );
      const harness = renderLifecycle({
        activeDocument,
        documents: { [activeDocument.path]: activeDocument },
        workspaceFiles: createFakeWorkspaceFiles({ writeTextFile }),
      });

      let firstSave!: Promise<void>;
      act(() => {
        firstSave = harness.lifecycle().saveActiveDocument();
      });
      await vi.waitFor(() => expect(writeTextFile).toHaveBeenCalledOnce());

      replaceLiveDocument(harness, { ...activeDocument, content: "pending" });
      let pendingSave!: Promise<void>;
      act(() => {
        pendingSave = harness.lifecycle().saveActiveDocument();
      });

      const exclusionCallback = vi.fn(async () => undefined);
      let exclusionPromise!: Promise<void>;
      act(() => {
        exclusionPromise = harness.lifecycle().runWithDocumentSaveExclusion(
          { kind: "file", path: activeDocument.path, rootPath: ROOT },
          exclusionCallback,
        );
      });

      await act(async () => {
        firstWrite.resolve();
        await Promise.all([firstSave, pendingSave, exclusionPromise]);
      });

      expect(writeTextFile).toHaveBeenCalledOnce();
      expect(exclusionCallback).toHaveBeenCalledOnce();
      harness.unmount();
    });

    it("does not run new saves while the exclusion callback is active", async () => {
      const callback = createDeferred<void>();
      const activeDocument = editorDocument(
        `${ROOT}/src/User.php`,
        "edited",
        "saved",
      );
      const harness = renderLifecycle({
        activeDocument,
        documents: { [activeDocument.path]: activeDocument },
      });

      const exclusionCallback = vi.fn(() => callback.promise);
      let exclusionPromise!: Promise<void>;
      act(() => {
        exclusionPromise = harness.lifecycle().runWithDocumentSaveExclusion(
          { kind: "file", path: activeDocument.path, rootPath: ROOT },
          exclusionCallback,
        );
      });
      await vi.waitFor(() => expect(exclusionCallback).toHaveBeenCalledOnce());

      let savePromise!: Promise<void>;
      act(() => {
        savePromise = harness.lifecycle().saveActiveDocument();
      });
      await act(async () => {
        await savePromise;
      });
      expect(harness.formattedContentForSave).not.toHaveBeenCalled();
      expect(harness.workspaceFiles.writeTextFile).not.toHaveBeenCalled();

      await act(async () => {
        callback.resolve();
        await exclusionPromise;
      });

      expect(harness.formattedContentForSave).not.toHaveBeenCalled();
      expect(harness.workspaceFiles.writeTextFile).not.toHaveBeenCalled();
      harness.unmount();
    });

    it("keeps an in-flight save current across a rerender", async () => {
      const formatting = createDeferred<string>();
      const formattedContentForSave = vi.fn(() => formatting.promise);
      const activeDocument = editorDocument(
        `${ROOT}/src/User.php`,
        "edited",
        "saved",
      );
      const harness = renderLifecycle({
        activeDocument,
        documents: { [activeDocument.path]: activeDocument },
        formattedContentForSave,
      });

      let savePromise!: Promise<void>;
      act(() => {
        savePromise = harness.lifecycle().saveActiveDocument();
      });
      await vi.waitFor(() => {
        expect(formattedContentForSave).toHaveBeenCalledOnce();
      });

      harness.rerender({ workspaceSettings: defaultWorkspaceSettings() });
      await act(async () => {
        formatting.resolve("formatted");
        await savePromise;
      });

      expect(harness.workspaceFiles.writeTextFile).toHaveBeenCalledWith(
        activeDocument.path,
        "formatted",
      );
      harness.unmount();
    });

    it("disposes the stable coordinator on unmount", async () => {
      const formatting = createDeferred<string>();
      const formattedContentForSave = vi.fn(() => formatting.promise);
      const activeDocument = editorDocument(
        `${ROOT}/src/User.php`,
        "edited",
        "saved",
      );
      const harness = renderLifecycle({
        activeDocument,
        documents: { [activeDocument.path]: activeDocument },
        formattedContentForSave,
      });

      let savePromise!: Promise<void>;
      act(() => {
        savePromise = harness.lifecycle().saveActiveDocument();
      });
      await vi.waitFor(() => expect(formattedContentForSave).toHaveBeenCalledOnce());

      harness.unmount();
      formatting.resolve("formatted");
      await savePromise;

      expect(harness.workspaceFiles.writeTextFile).not.toHaveBeenCalled();
    });

    it("keeps the live coordinator usable through StrictMode effect replay", async () => {
      const activeDocument = editorDocument(
        `${ROOT}/src/User.php`,
        "edited",
        "saved",
      );
      const harness = renderLifecycle(
        {
          activeDocument,
          documents: { [activeDocument.path]: activeDocument },
        },
        { strictMode: true },
      );

      await act(async () => {
        await harness.lifecycle().saveActiveDocument();
      });

      expect(harness.workspaceFiles.writeTextFile).toHaveBeenCalledWith(
        activeDocument.path,
        activeDocument.content,
      );
      harness.unmount();
    });

    it("does not write the old path after rename invalidates a save during preparation", async () => {
      const formatting = createDeferred<string>();
      const formattedContentForSave = vi.fn(() => formatting.promise);
      const activeDocument = editorDocument(
        `${ROOT}/src/User.php`,
        "edited",
        "saved",
      );
      const renamedDocument = {
        ...activeDocument,
        name: "Account.php",
        path: `${ROOT}/src/Account.php`,
      };
      const harness = renderLifecycle({
        activeDocument,
        documents: { [activeDocument.path]: activeDocument },
        formattedContentForSave,
      });

      let savePromise!: Promise<void>;
      act(() => {
        savePromise = harness.lifecycle().saveActiveDocument();
      });
      await vi.waitFor(() => {
        expect(formattedContentForSave).toHaveBeenCalledOnce();
      });

      act(() => {
        harness.lifecycle().closeDocument(activeDocument.path, {
          recordRecentlyClosed: false,
          skipConfirmation: true,
        });
      });
      harness.documentsRef.current = { [renamedDocument.path]: renamedDocument };
      harness.activeDocumentRef.current = renamedDocument;
      await act(async () => {
        formatting.resolve("formatted");
        await savePromise;
      });

      expect(harness.workspaceFiles.writeTextFile).not.toHaveBeenCalled();
      expect(harness.documentsRef.current[renamedDocument.path]).toBe(
        renamedDocument,
      );
      harness.unmount();
    });

    it("restarts formatting with the latest content when typing occurs during format", async () => {
      const firstFormat = createDeferred<string>();
      const formattedContentForSave = vi
        .fn<(document: EditorDocument) => Promise<string>>()
        .mockImplementationOnce(() => firstFormat.promise)
        .mockImplementation(async (document) => document.content);
      const activeDocument = editorDocument(
        `${ROOT}/src/User.php`,
        "first",
        "saved",
      );
      const harness = renderLifecycle({
        activeDocument,
        documents: { [activeDocument.path]: activeDocument },
        formattedContentForSave,
      });

      let savePromise!: Promise<void>;
      act(() => {
        savePromise = harness.lifecycle().saveActiveDocument();
      });
      replaceLiveDocument(harness, { ...activeDocument, content: "latest" });

      await act(async () => {
        firstFormat.resolve("stale formatted");
        await savePromise;
      });

      expect(formattedContentForSave).toHaveBeenCalledTimes(2);
      expect(harness.workspaceFiles.writeTextFile).toHaveBeenCalledTimes(1);
      expect(harness.workspaceFiles.writeTextFile).toHaveBeenCalledWith(
        activeDocument.path,
        "latest",
      );
      expect(harness.documentsRef.current[activeDocument.path].content).toBe(
        "latest",
      );
      harness.unmount();
    });

    it("restarts when typing and undo restore the same content during an await", async () => {
      const firstFormat = createDeferred<string>();
      const formattedContentForSave = vi
        .fn<(document: EditorDocument) => Promise<string>>()
        .mockImplementationOnce(() => firstFormat.promise)
        .mockImplementation(async (document) => document.content);
      const activeDocument = editorDocument(
        `${ROOT}/src/User.php`,
        "unchanged bytes",
        "saved",
      );
      const harness = renderLifecycle({
        activeDocument,
        documents: { [activeDocument.path]: activeDocument },
        formattedContentForSave,
      });

      let savePromise!: Promise<void>;
      act(() => {
        savePromise = harness.lifecycle().saveActiveDocument();
      });
      replaceLiveDocument(harness, { ...activeDocument });

      await act(async () => {
        firstFormat.resolve("stale transform");
        await savePromise;
      });

      expect(formattedContentForSave).toHaveBeenCalledTimes(2);
      expect(harness.workspaceFiles.writeTextFile).toHaveBeenCalledWith(
        activeDocument.path,
        "unchanged bytes",
      );
      harness.unmount();
    });

    it("restarts the full pipeline when typing occurs during organize imports", async () => {
      const firstOrganize = createDeferred<string>();
      const organizedImportsContentForSave = vi
        .fn<
          (
            document: EditorDocument,
            content: string,
            root: string,
          ) => Promise<string>
        >()
        .mockImplementationOnce(() => firstOrganize.promise)
        .mockImplementation(async (_document, content) => content);
      const activeDocument = editorDocument(
        `${ROOT}/src/User.php`,
        "first",
        "saved",
      );
      const harness = renderLifecycle({
        activeDocument,
        documents: { [activeDocument.path]: activeDocument },
        organizedImportsContentForSave,
      });

      let savePromise!: Promise<void>;
      act(() => {
        savePromise = harness.lifecycle().saveActiveDocument();
      });
      await vi.waitFor(() => {
        expect(organizedImportsContentForSave).toHaveBeenCalledTimes(1);
      });
      replaceLiveDocument(harness, { ...activeDocument, content: "latest" });

      await act(async () => {
        firstOrganize.resolve("stale organized");
        await savePromise;
      });

      expect(harness.formattedContentForSave).toHaveBeenCalledTimes(2);
      expect(harness.workspaceFiles.writeTextFile).toHaveBeenCalledWith(
        activeDocument.path,
        "latest",
      );
      harness.unmount();
    });

    it("restarts the full pipeline when typing occurs during EditorConfig resolution", async () => {
      const firstEditorConfig = createDeferred<{}>();
      const resolveEditorConfigForFile = vi
        .fn<() => Promise<{}>>()
        .mockImplementationOnce(() => firstEditorConfig.promise)
        .mockImplementation(async () => ({}));
      const activeDocument = editorDocument(
        `${ROOT}/src/User.php`,
        "first",
        "saved",
      );
      const harness = renderLifecycle({
        activeDocument,
        documents: { [activeDocument.path]: activeDocument },
        resolveEditorConfigForFile,
      });

      let savePromise!: Promise<void>;
      act(() => {
        savePromise = harness.lifecycle().saveActiveDocument();
      });
      await vi.waitFor(() => {
        expect(resolveEditorConfigForFile).toHaveBeenCalledTimes(1);
      });
      replaceLiveDocument(harness, { ...activeDocument, content: "latest" });

      await act(async () => {
        firstEditorConfig.resolve({});
        await savePromise;
      });

      expect(harness.formattedContentForSave).toHaveBeenCalledTimes(2);
      expect(harness.workspaceFiles.writeTextFile).toHaveBeenCalledWith(
        activeDocument.path,
        "latest",
      );
      harness.unmount();
    });

    it("acknowledges bytes written while preserving newer typing and dirty state", async () => {
      const write = createDeferred<void>();
      const writeTextFile = vi.fn(() => write.promise);
      const activeDocument = editorDocument(
        `${ROOT}/src/User.php`,
        "first",
        "saved",
      );
      const harness = renderLifecycle({
        activeDocument,
        documents: { [activeDocument.path]: activeDocument },
        formattedContentForSave: vi.fn(async () => "formatted first"),
        workspaceFiles: createFakeWorkspaceFiles({ writeTextFile }),
      });

      let savePromise!: Promise<void>;
      act(() => {
        savePromise = harness.lifecycle().saveActiveDocument();
      });
      await vi.waitFor(() => expect(writeTextFile).toHaveBeenCalledTimes(1));
      replaceLiveDocument(harness, {
        ...activeDocument,
        content: "typed during write",
      });

      await act(async () => {
        write.resolve();
        await savePromise;
      });

      const saved = harness.documentsRef.current[activeDocument.path];
      expect(saved.content).toBe("typed during write");
      expect(saved.savedContent).toBe("formatted first");
      expect(saved.content).not.toBe(saved.savedContent);
      expect(harness.activeDocumentRef.current).toEqual(saved);
      expect(harness.syncSavedDocument).not.toHaveBeenCalled();
      harness.unmount();
    });

    it("serializes concurrent saves and coalesces queued requests to latest content", async () => {
      const firstWrite = createDeferred<void>();
      const secondWrite = createDeferred<void>();
      const firstHistory = createDeferred<void>();
      const events: string[] = [];
      const writeTextFile = vi.fn(async (_path: string, content: string) => {
        events.push(`start:${content}`);
        if (content === "A") {
          await firstWrite.promise;
        } else {
          await secondWrite.promise;
        }
        events.push(`finish:${content}`);
      });
      const recordSnapshot = vi.fn(
        async (_root: string, _path: string, content: string) => {
          if (content === "A") {
            await firstHistory.promise;
          }
          return null;
        },
      );
      const activeDocument = editorDocument(
        `${ROOT}/src/User.php`,
        "A",
        "saved",
      );
      const harness = renderLifecycle({
        activeDocument,
        documents: { [activeDocument.path]: activeDocument },
        localHistoryGateway: createFakeLocalHistoryGateway({ recordSnapshot }),
        workspaceFiles: createFakeWorkspaceFiles({ writeTextFile }),
      });

      let firstSave!: Promise<void>;
      act(() => {
        firstSave = harness.lifecycle().saveActiveDocument();
      });
      await vi.waitFor(() => expect(writeTextFile).toHaveBeenCalledTimes(1));
      replaceLiveDocument(harness, { ...activeDocument, content: "B" });
      let secondSave!: Promise<void>;
      act(() => {
        secondSave = harness.lifecycle().saveActiveDocument();
      });
      replaceLiveDocument(harness, { ...activeDocument, content: "C" });
      let autoSave!: Promise<void>;
      act(() => {
        autoSave = harness.lifecycle().saveActiveDocument();
      });

      secondWrite.resolve();
      await Promise.resolve();
      expect(writeTextFile).toHaveBeenCalledTimes(1);
      expect(events).toEqual(["start:A"]);

      firstWrite.resolve();
      await vi.waitFor(() => expect(recordSnapshot).toHaveBeenCalledTimes(1));
      expect(writeTextFile).toHaveBeenCalledTimes(1);
      firstHistory.resolve();
      await vi.waitFor(() => expect(writeTextFile).toHaveBeenCalledTimes(2));
      await act(async () => {
        await Promise.all([firstSave, secondSave, autoSave]);
      });

      expect(events).toEqual(["start:A", "finish:A", "start:C", "finish:C"]);
      expect(harness.documentsRef.current[activeDocument.path]).toEqual(
        expect.objectContaining({ content: "C", savedContent: "C" }),
      );
      expect(recordSnapshot).toHaveBeenNthCalledWith(
        1,
        ROOT,
        "src/User.php",
        "A",
      );
      expect(recordSnapshot).toHaveBeenNthCalledWith(
        2,
        ROOT,
        "src/User.php",
        "C",
      );
      expect(harness.syncSavedDocument).toHaveBeenCalledTimes(1);
      expect(harness.syncSavedDocument).toHaveBeenCalledWith(
        ROOT,
        expect.objectContaining({ content: "C" }),
        expect.any(Function),
      );
      harness.unmount();
    });

    it("close invalidates a queued save for the same path", async () => {
      const firstWrite = createDeferred<void>();
      const writeTextFile = vi.fn(() => firstWrite.promise);
      const activeDocument = editorDocument(
        `${ROOT}/src/User.php`,
        "first",
        "saved",
      );
      const harness = renderLifecycle({
        activeDocument,
        documents: { [activeDocument.path]: activeDocument },
        workspaceFiles: createFakeWorkspaceFiles({ writeTextFile }),
      });

      let firstSave!: Promise<void>;
      act(() => {
        firstSave = harness.lifecycle().saveActiveDocument();
      });
      await vi.waitFor(() => expect(writeTextFile).toHaveBeenCalledOnce());

      replaceLiveDocument(harness, {
        ...activeDocument,
        content: "queued",
      });
      let queuedSave!: Promise<void>;
      act(() => {
        queuedSave = harness.lifecycle().saveActiveDocument();
      });
      act(() => {
        harness.lifecycle().closeDocument(activeDocument.path, {
          recordRecentlyClosed: false,
          skipConfirmation: true,
        });
      });

      await act(async () => {
        firstWrite.resolve();
        await Promise.all([firstSave, queuedSave]);
      });

      expect(writeTextFile).toHaveBeenCalledOnce();
      expect(writeTextFile).toHaveBeenCalledWith(
        activeDocument.path,
        "first",
      );
      expect(harness.documentsRef.current[activeDocument.path]).toBeUndefined();
      harness.unmount();
    });

    it("drops old-instance didSave when close and reopen occur during sync flush", async () => {
      const flush = createDeferred<void>();
      const downstreamDidSave = vi.fn();
      const syncSavedDocument = vi.fn(
        async (
          _rootPath: string,
          document: EditorDocument,
          shouldEmit: (() => boolean) | undefined,
        ) => {
          await flush.promise;
          if (shouldEmit?.()) {
            downstreamDidSave(document);
          }
        },
      );
      const activeDocument = editorDocument(
        `${ROOT}/src/User.php`,
        "old instance",
        "saved",
      );
      const harness = renderLifecycle({
        activeDocument,
        documents: { [activeDocument.path]: activeDocument },
        syncSavedDocument,
      });

      let savePromise!: Promise<void>;
      act(() => {
        savePromise = harness.lifecycle().saveActiveDocument();
      });
      await vi.waitFor(() => expect(syncSavedDocument).toHaveBeenCalledTimes(1));
      act(() => harness.lifecycle().closeDocument(activeDocument.path));
      const reopened = editorDocument(activeDocument.path, "reopened", "reopened");
      harness.documentsRef.current = { [reopened.path]: reopened };
      harness.activeDocumentRef.current = reopened;

      await act(async () => {
        flush.resolve();
        await savePromise;
      });

      expect(downstreamDidSave).not.toHaveBeenCalled();
      expect(harness.syncSavedJavaScriptTypeScriptDocument).not.toHaveBeenCalled();
      expect(harness.setMessage).not.toHaveBeenCalled();
      expect(harness.documentsRef.current[reopened.path]).toBe(reopened);
      harness.unmount();
    });

    it("does not apply a write completion to a closed and reopened same path", async () => {
      const write = createDeferred<void>();
      const writeTextFile = vi.fn(() => write.promise);
      const activeDocument = editorDocument(
        `${ROOT}/src/User.php`,
        "old instance",
        "saved",
      );
      const harness = renderLifecycle({
        activeDocument,
        documents: { [activeDocument.path]: activeDocument },
        workspaceFiles: createFakeWorkspaceFiles({ writeTextFile }),
      });

      let savePromise!: Promise<void>;
      act(() => {
        savePromise = harness.lifecycle().saveActiveDocument();
      });
      await vi.waitFor(() => expect(writeTextFile).toHaveBeenCalledTimes(1));
      act(() => harness.lifecycle().closeDocument(activeDocument.path));
      const reopened = editorDocument(
        activeDocument.path,
        "reopened",
        "reopened",
      );
      harness.documentsRef.current = { [reopened.path]: reopened };
      harness.activeDocumentRef.current = reopened;

      await act(async () => {
        write.resolve();
        await savePromise;
      });

      expect(harness.documentsRef.current[reopened.path]).toBe(reopened);
      expect(harness.syncSavedDocument).not.toHaveBeenCalled();
      expect(harness.setMessage).not.toHaveBeenCalled();
      harness.unmount();
    });

    it("does not apply a write completion after a workspace A-B-A switch", async () => {
      const write = createDeferred<void>();
      const writeTextFile = vi.fn(() => write.promise);
      const activeDocument = editorDocument(
        `${ROOT}/src/User.php`,
        "workspace A",
      );
      const harness = renderLifecycle({
        activeDocument,
        documents: { [activeDocument.path]: activeDocument },
        workspaceFiles: createFakeWorkspaceFiles({ writeTextFile }),
      });

      let savePromise!: Promise<void>;
      act(() => {
        savePromise = harness.lifecycle().saveActiveDocument();
      });
      await vi.waitFor(() => expect(writeTextFile).toHaveBeenCalledTimes(1));
      harness.rootRef.current = "/workspace-b";
      harness.workspaceRequestTokenRef.current += 1;
      harness.rootRef.current = ROOT;
      harness.workspaceRequestTokenRef.current += 1;

      await act(async () => {
        write.resolve();
        await savePromise;
      });

      expect(harness.documentsRef.current[activeDocument.path]).toBe(
        activeDocument,
      );
      expect(harness.syncSavedDocument).not.toHaveBeenCalled();
      expect(harness.setMessage).not.toHaveBeenCalled();
      harness.unmount();
    });

    it("preserves edits to the saved document after it becomes inactive", async () => {
      const write = createDeferred<void>();
      const writeTextFile = vi.fn(() => write.promise);
      const first = editorDocument(`${ROOT}/src/A.php`, "first", "saved");
      const second = editorDocument(`${ROOT}/src/B.php`, "second");
      const harness = renderLifecycle({
        activeDocument: first,
        documents: { [first.path]: first, [second.path]: second },
        openPaths: [first.path, second.path],
        workspaceFiles: createFakeWorkspaceFiles({ writeTextFile }),
      });

      let savePromise!: Promise<void>;
      act(() => {
        savePromise = harness.lifecycle().saveActiveDocument();
      });
      await vi.waitFor(() => expect(writeTextFile).toHaveBeenCalledTimes(1));
      harness.activeDocumentRef.current = second;
      replaceLiveDocument(harness, { ...first, content: "inactive edit" });

      await act(async () => {
        write.resolve();
        await savePromise;
      });

      expect(harness.documentsRef.current[first.path]).toEqual(
        expect.objectContaining({
          content: "inactive edit",
          savedContent: "first",
        }),
      );
      expect(harness.activeDocumentRef.current).toBe(second);
      harness.unmount();
    });

    it("reports a save failure through the workspace-root isolated reporter", async () => {
      const writeTextFile = vi.fn(async () => {
        throw new Error("disk full");
      });
      const activeDocument = editorDocument(`${ROOT}/src/User.php`, "edited");
      const harness = renderLifecycle({
        activeDocument,
        documents: { [activeDocument.path]: activeDocument },
        workspaceFiles: createFakeWorkspaceFiles({ writeTextFile }),
      });
      harness.activeDocumentRef.current = activeDocument;

      await act(async () => {
        await harness.lifecycle().saveActiveDocument();
      });

      expect(harness.reportErrorForActiveWorkspaceRoot).toHaveBeenCalledWith(
        ROOT,
        "Save File",
        expect.any(Error),
      );
      harness.unmount();
    });

    it("updates live document refs after saving before React rerenders", async () => {
      const activeDocument = editorDocument(
        `${ROOT}/src/User.php`,
        "edited",
        "original",
      );
      const harness = renderLifecycle({
        activeDocument,
        documents: { [activeDocument.path]: activeDocument },
      });
      harness.activeDocumentRef.current = activeDocument;

      await act(async () => {
        await harness.lifecycle().saveActiveDocument();
      });

      expect(harness.activeDocumentRef.current?.content).toBe("edited");
      expect(harness.activeDocumentRef.current?.savedContent).toBe("edited");
      harness.unmount();
    });

    it("keeps analyse on save off by default", async () => {
      vi.useFakeTimers();
      const harness = renderLifecycle();

      await act(async () => {
        await harness.lifecycle().saveActiveDocument();
        await vi.advanceTimersByTimeAsync(500);
      });

      expect(harness.runEslintAnalysisOnSave).not.toHaveBeenCalled();
      expect(harness.runPhpstanAnalysisOnSave).not.toHaveBeenCalled();
      harness.unmount();
      vi.useRealTimers();
    });

    it("debounces successful PHP saves into one PHPStan analysis", async () => {
      vi.useFakeTimers();
      const settings = {
        ...defaultWorkspaceSettings(),
        eslintAnalyseOnSave: true,
        phpstanAnalyseOnSave: true,
      };
      const harness = renderLifecycle({ workspaceSettings: settings });

      await act(async () => {
        await harness.lifecycle().saveActiveDocument();
        await vi.advanceTimersByTimeAsync(300);
        await harness.lifecycle().saveActiveDocument();
        await vi.advanceTimersByTimeAsync(499);
      });
      expect(harness.runPhpstanAnalysisOnSave).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });

      expect(harness.runPhpstanAnalysisOnSave).toHaveBeenCalledOnce();
      expect(harness.runPhpstanAnalysisOnSave).toHaveBeenCalledWith(ROOT);
      expect(harness.runEslintAnalysisOnSave).not.toHaveBeenCalled();
      harness.unmount();
      vi.useRealTimers();
    });

    it.each([
      ["javascript", "index.js"],
      ["typescript", "index.ts"],
      ["javascriptreact", "index.jsx"],
      ["typescriptreact", "index.tsx"],
      ["vue", "Component.vue"],
    ])("routes %s saves only to ESLint", async (language, name) => {
      vi.useFakeTimers();
      const document = {
        ...editorDocument(`${ROOT}/src/${name}`),
        language,
      };
      const harness = renderLifecycle({
        activeDocument: document,
        documents: { [document.path]: document },
        workspaceSettings: {
          ...defaultWorkspaceSettings(),
          eslintAnalyseOnSave: true,
          phpstanAnalyseOnSave: true,
        },
      });

      await act(async () => {
        await harness.lifecycle().saveActiveDocument();
        await vi.advanceTimersByTimeAsync(500);
      });

      expect(harness.runEslintAnalysisOnSave).toHaveBeenCalledWith(ROOT);
      expect(harness.runPhpstanAnalysisOnSave).not.toHaveBeenCalled();
      harness.unmount();
      vi.useRealTimers();
    });

    it("does not analyse a non-matching saved document", async () => {
      vi.useFakeTimers();
      const document = {
        ...editorDocument(`${ROOT}/README.md`),
        language: "markdown",
      };
      const harness = renderLifecycle({
        activeDocument: document,
        documents: { [document.path]: document },
        workspaceSettings: {
          ...defaultWorkspaceSettings(),
          eslintAnalyseOnSave: true,
          phpstanAnalyseOnSave: true,
        },
      });

      await act(async () => {
        await harness.lifecycle().saveActiveDocument();
        await vi.advanceTimersByTimeAsync(500);
      });

      expect(harness.runEslintAnalysisOnSave).not.toHaveBeenCalled();
      expect(harness.runPhpstanAnalysisOnSave).not.toHaveBeenCalled();
      harness.unmount();
      vi.useRealTimers();
    });

    it("does not analyse failed or conflicted saves", async () => {
      vi.useFakeTimers();
      const settings = {
        ...defaultWorkspaceSettings(),
        phpstanAnalyseOnSave: true,
      };
      const failed = renderLifecycle({
        workspaceSettings: settings,
        workspaceFiles: createFakeWorkspaceFiles({
          writeTextFile: vi.fn(async () => {
            throw new Error("disk full");
          }),
        }),
      });
      const conflicted = renderLifecycle({
        workspaceSettings: settings,
        workspaceFiles: createFakeWorkspaceFiles({
          writeTextFile: vi.fn(async () => ({
            status: "conflict" as const,
            message: "changed",
          })),
        }),
      });

      await act(async () => {
        await failed.lifecycle().saveActiveDocument();
        await conflicted.lifecycle().saveActiveDocument();
        await vi.advanceTimersByTimeAsync(500);
      });

      expect(failed.runPhpstanAnalysisOnSave).not.toHaveBeenCalled();
      expect(conflicted.runPhpstanAnalysisOnSave).not.toHaveBeenCalled();
      failed.unmount();
      conflicted.unmount();
      vi.useRealTimers();
    });

    it("cancels pending analysis when the workspace root changes", async () => {
      vi.useFakeTimers();
      const harness = renderLifecycle({
        workspaceSettings: {
          ...defaultWorkspaceSettings(),
          phpstanAnalyseOnSave: true,
        },
      });

      await act(async () => {
        await harness.lifecycle().saveActiveDocument();
      });
      harness.rootRef.current = "/other";
      harness.rerender({ workspaceRoot: "/other" });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });

      expect(harness.runPhpstanAnalysisOnSave).not.toHaveBeenCalled();
      harness.unmount();
      vi.useRealTimers();
    });
  });

  describe("closeDocument", () => {
    it("records normal closes and excludes programmatic closes", () => {
      const normal = editorDocument(`${ROOT}/src/Normal.php`);
      const programmatic = editorDocument(`${ROOT}/src/Programmatic.php`);
      const harness = renderLifecycle({
        activeDocument: normal,
        documents: {
          [normal.path]: normal,
          [programmatic.path]: programmatic,
        },
        openPaths: [normal.path, programmatic.path],
        activePath: normal.path,
      });

      act(() => harness.lifecycle().closeDocument(normal.path));
      expect(hasRecentlyClosedTabs(harness.recentlyClosedTabsRef.current, ROOT)).toBe(
        true,
      );

      harness.recentlyClosedTabsRef.current = emptyRecentlyClosedTabs();
      act(() =>
        harness.lifecycle().closeDocument(programmatic.path, {
          recordRecentlyClosed: false,
        }),
      );

      expect(hasRecentlyClosedTabs(harness.recentlyClosedTabsRef.current, ROOT)).toBe(
        false,
      );
      harness.unmount();
    });

    it("clears external conflict state only after close is confirmed", () => {
      const dirty = editorDocument(`${ROOT}/src/A.php`, "edited", "saved");
      const clearExternalFileConflict = vi.fn();
      const confirm = vi.fn(() => false);
      const harness = renderLifecycle({
        activeDocument: dirty,
        documents: { [dirty.path]: dirty },
        openPaths: [dirty.path],
        hasExternalFileConflict: () => true,
        clearExternalFileConflict,
        prompter: { confirm, prompt: vi.fn() } as unknown as DocumentLifecycleDependencies["prompter"],
      });

      act(() => harness.lifecycle().closeDocument(dirty.path));
      expect(clearExternalFileConflict).not.toHaveBeenCalled();
      confirm.mockReturnValue(true);
      act(() => harness.lifecycle().closeDocument(dirty.path));
      expect(clearExternalFileConflict).toHaveBeenCalledWith(ROOT, dirty.path);
      harness.unmount();
    });
    it("syncs the close, clears diagnostics, removes the tab, and reselects the neighbor", async () => {
      const first = editorDocument(`${ROOT}/src/A.php`);
      const second = editorDocument(`${ROOT}/src/B.php`);
      const harness = renderLifecycle({
        activeDocument: first,
        documents: {
          [first.path]: first,
          [second.path]: second,
        },
        openPaths: [first.path, second.path],
        activePath: first.path,
      });

      act(() => {
        harness.lifecycle().closeDocument(first.path);
      });

      expect(harness.syncClosedDocument).toHaveBeenCalledWith(first);
      expect(harness.syncClosedJavaScriptTypeScriptDocument).toHaveBeenCalledWith(
        first,
      );
      expect(harness.clearPhpLocalDiagnosticsForPath).toHaveBeenCalledWith(
        first.path,
      );
      expect(harness.setOpenPaths).toHaveBeenCalled();
      // Closing the active tab reselects its neighbor.
      expect(harness.setActivePath).toHaveBeenCalledWith(second.path);
      expect(harness.documentsRef.current[first.path]).toBeUndefined();
      harness.unmount();
    });

    it("aborts the close when the user declines the discard-changes prompt", () => {
      const dirty = editorDocument(`${ROOT}/src/A.php`, "edited", "original");
      const harness = renderLifecycle({
        documents: { [dirty.path]: dirty },
        openPaths: [dirty.path],
        activePath: dirty.path,
        prompter: {
          confirm: vi.fn(() => false),
          prompt: vi.fn(() => null),
        } as unknown as DocumentLifecycleDependencies["prompter"],
      });

      act(() => {
        harness.lifecycle().closeDocument(dirty.path);
      });

      expect(harness.syncClosedDocument).not.toHaveBeenCalled();
      expect(harness.setActivePath).not.toHaveBeenCalled();
      harness.unmount();
    });

    it("clears language-server diagnostics for an externally removed document", () => {
      const removed = editorDocument(`${ROOT}/src/Gone.php`);
      const externallyRemovedDocumentRootByPathRef = {
        current: { [removed.path]: ROOT },
      };
      const harness = renderLifecycle({
        documents: { [removed.path]: removed },
        openPaths: [removed.path],
        activePath: removed.path,
        externallyRemovedDocumentRootByPathRef,
      });

      act(() => {
        harness.lifecycle().closeDocument(removed.path);
      });

      expect(
        harness.clearLanguageServerDiagnosticsForPath,
      ).toHaveBeenCalledWith(ROOT, removed.path);
      harness.unmount();
    });

    it("uses the live document ref when closing a tab opened after the render snapshot", () => {
      const first = editorDocument(`${ROOT}/src/A.php`);
      const second = editorDocument(`${ROOT}/src/B.php`);
      const harness = renderLifecycle({
        documents: { [first.path]: first },
        openPaths: [first.path],
        activePath: first.path,
      });
      harness.documentsRef.current = {
        [first.path]: first,
        [second.path]: second,
      };
      harness.openPathsRef.current = [first.path, second.path];

      act(() => {
        harness.lifecycle().closeDocument(second.path);
      });

      expect(harness.syncClosedDocument).toHaveBeenCalledWith(second);
      expect(harness.documentsRef.current[second.path]).toBeUndefined();
      expect(harness.openPathsRef.current).toEqual([first.path]);
      harness.unmount();
    });

    it("uses the live active document ref to reselect after closing", () => {
      const first = editorDocument(`${ROOT}/src/A.php`);
      const second = editorDocument(`${ROOT}/src/B.php`);
      const harness = renderLifecycle({
        documents: { [first.path]: first },
        openPaths: [first.path],
        activePath: first.path,
      });
      harness.documentsRef.current = {
        [first.path]: first,
        [second.path]: second,
      };
      harness.openPathsRef.current = [first.path, second.path];
      harness.activeDocumentRef.current = second;

      act(() => {
        harness.lifecycle().closeDocument(second.path);
      });

      expect(harness.setActivePath).toHaveBeenCalledWith(first.path);
      expect(harness.activeDocumentRef.current).toBe(first);
      harness.unmount();
    });

    it("does not treat a stale activePath snapshot as active when the live ref points elsewhere", () => {
      const first = editorDocument(`${ROOT}/src/A.php`);
      const second = editorDocument(`${ROOT}/src/B.php`);
      const harness = renderLifecycle({
        documents: { [first.path]: first },
        openPaths: [first.path],
        activePath: first.path,
      });
      harness.documentsRef.current = {
        [first.path]: first,
        [second.path]: second,
      };
      harness.openPathsRef.current = [first.path, second.path];
      harness.activeDocumentRef.current = second;

      act(() => {
        harness.lifecycle().closeDocument(first.path);
      });

      expect(harness.setActivePath).not.toHaveBeenCalled();
      expect(harness.activeDocumentRef.current).toBe(second);
      expect(harness.documentsRef.current[first.path]).toBeUndefined();
      harness.unmount();
    });

    it("prompts from the live dirty document ref before closing", () => {
      const first = editorDocument(`${ROOT}/src/A.php`);
      const dirtySecond = editorDocument(
        `${ROOT}/src/B.php`,
        "edited",
        "original",
      );
      const prompter = {
        confirm: vi.fn(() => false),
        prompt: vi.fn(() => null),
      };
      const harness = renderLifecycle({
        documents: { [first.path]: first },
        openPaths: [first.path],
        activePath: first.path,
        prompter:
          prompter as unknown as DocumentLifecycleDependencies["prompter"],
      });
      harness.documentsRef.current = {
        [first.path]: first,
        [dirtySecond.path]: dirtySecond,
      };
      harness.openPathsRef.current = [first.path, dirtySecond.path];

      act(() => {
        harness.lifecycle().closeDocument(dirtySecond.path);
      });

      expect(prompter.confirm).toHaveBeenCalledWith("Discard changes?");
      expect(harness.syncClosedDocument).not.toHaveBeenCalled();
      expect(harness.documentsRef.current[dirtySecond.path]).toBe(dirtySecond);
      harness.unmount();
    });

    it("clears preview refs when closing a preview document", () => {
      const pinned = editorDocument(`${ROOT}/src/Pinned.php`);
      const preview = editorDocument(`${ROOT}/src/Preview.php`);
      const harness = renderLifecycle({
        documents: {
          [pinned.path]: pinned,
          [preview.path]: preview,
        },
        openPaths: [pinned.path],
        activePath: preview.path,
        previewPath: preview.path,
      });
      harness.activeDocumentRef.current = preview;

      act(() => {
        harness.lifecycle().closeDocument(preview.path);
      });

      expect(harness.previewPathRef.current).toBeNull();
      expect(harness.openPathsRef.current).toEqual([pinned.path]);
      expect(harness.activeDocumentRef.current).toBe(pinned);
      expect(harness.setActivePath).toHaveBeenCalledWith(pinned.path);
      harness.unmount();
    });

    it("loads the next git diff tab when closing the active git diff document", () => {
      const firstChange = gitChangedFile(`${ROOT}/src/A.php`);
      const secondChange = gitChangedFile(`${ROOT}/src/B.php`);
      const firstPath = gitDiffDocumentPath(firstChange);
      const secondPath = gitDiffDocumentPath(secondChange);
      const firstDocument = {
        ...editorDocument(firstPath),
        readOnly: true,
      };
      const secondDocument = {
        ...editorDocument(secondPath),
        readOnly: true,
      };
      const harness = renderLifecycle({
        documents: {
          [firstPath]: firstDocument,
          [secondPath]: secondDocument,
        },
        openPaths: [firstPath, secondPath],
        activePath: firstPath,
        gitStatus: {
          ...emptyGitStatus(),
          changes: [firstChange, secondChange],
        },
        gitChangeForDiffDocumentPath: (path, changes) =>
          changes.find((change) => gitDiffDocumentPath(change) === path) ??
          null,
      });
      harness.activeDocumentRef.current = firstDocument;

      act(() => {
        harness.lifecycle().closeDocument(firstPath);
      });

      expect(harness.loadGitDiffDocument).toHaveBeenCalledWith(
        secondPath,
        secondChange,
      );
      expect(harness.documentsRef.current[firstPath]).toBeUndefined();
      expect(harness.openPathsRef.current).toEqual([secondPath]);
      expect(harness.setMessage).toHaveBeenCalledWith(null);
      harness.unmount();
    });
  });

  describe("closeActiveSurface", () => {
    it("closes the git-diff preview first when one is selected", () => {
      const change = { path: "src/A.php" } as unknown as GitChangedFile;
      const harness = renderLifecycle({ selectedGitChange: change });

      act(() => {
        harness.lifecycle().closeActiveSurface();
      });

      expect(harness.closeGitDiffPreview).toHaveBeenCalled();
      expect(harness.syncClosedDocument).not.toHaveBeenCalled();
      harness.unmount();
    });

    it("closes the active document when there is no git-diff surface", () => {
      const active = editorDocument(`${ROOT}/src/A.php`);
      const harness = renderLifecycle({
        activeDocument: active,
        documents: { [active.path]: active },
        openPaths: [active.path],
        activePath: active.path,
      });

      act(() => {
        harness.lifecycle().closeActiveSurface();
      });

      expect(harness.closeGitDiffPreview).not.toHaveBeenCalled();
      expect(harness.syncClosedDocument).toHaveBeenCalledWith(active);
      harness.unmount();
    });

    it("closes the live active document for Cmd+W before the next render", () => {
      const first = editorDocument(`${ROOT}/src/A.php`);
      const second = editorDocument(`${ROOT}/src/B.php`);
      const harness = renderLifecycle({
        activeDocument: first,
        documents: { [first.path]: first },
        openPaths: [first.path],
        activePath: first.path,
      });
      harness.documentsRef.current = {
        [first.path]: first,
        [second.path]: second,
      };
      harness.openPathsRef.current = [first.path, second.path];
      harness.activeDocumentRef.current = second;

      act(() => {
        harness.lifecycle().closeActiveSurface();
      });

      expect(harness.syncClosedDocument).toHaveBeenCalledWith(second);
      expect(harness.setActivePath).toHaveBeenCalledWith(first.path);
      harness.unmount();
    });

    it("delegates Cmd+W with no active document to the workbench shell", () => {
      const harness = renderLifecycle({
        activeDocument: null,
        activePath: null,
        documents: {},
        openPaths: [],
      });

      act(() => {
        harness.lifecycle().closeActiveSurface();
      });

      expect(harness.closeGitDiffPreview).not.toHaveBeenCalled();
      expect(harness.syncClosedDocument).not.toHaveBeenCalled();
      expect(harness.closeEmptyWorkbenchSurface).toHaveBeenCalledTimes(1);
      harness.unmount();
    });
  });

  describe("reopenClosedDocument", () => {
    it("round-trips a user-closed document with its captured view state", async () => {
      const document = editorDocument(`${ROOT}/src/A.php`);
      const viewState = {
        column: 7,
        foldedLines: [3, 8],
        line: 12,
        scrollTop: 420,
      };
      const harness = renderLifecycle({
        activeDocument: document,
        documents: { [document.path]: document },
        openPaths: [document.path],
        activePath: document.path,
        recentlyClosedDocumentViewState: () => viewState,
      });

      act(() => harness.lifecycle().closeDocument(document.path));
      await act(async () => harness.lifecycle().reopenClosedDocument());

      expect(harness.openRecentlyClosedDocument).toHaveBeenCalledWith(
        ROOT,
        document.path,
      );
      expect(
        harness.restoreRecentlyClosedDocumentViewState,
      ).toHaveBeenCalledWith(ROOT, document.path, viewState);
      expect(harness.lifecycle().canReopenClosedDocument).toBe(false);
      harness.unmount();
    });

    it("drops deleted files and continues to the next entry", async () => {
      const deleted = editorDocument(`${ROOT}/src/Deleted.php`);
      const available = editorDocument(`${ROOT}/src/Available.php`);
      const openRecentlyClosedDocument = vi.fn(
        async (_root: string, path: string) => path === available.path,
      );
      const harness = renderLifecycle({ openRecentlyClosedDocument });

      harness.documentsRef.current[available.path] = available;
      harness.openPathsRef.current.push(available.path);
      act(() => harness.lifecycle().closeDocument(available.path));
      harness.documentsRef.current[deleted.path] = deleted;
      harness.openPathsRef.current.push(deleted.path);
      act(() => harness.lifecycle().closeDocument(deleted.path));
      await act(async () => harness.lifecycle().reopenClosedDocument());

      expect(openRecentlyClosedDocument.mock.calls).toEqual([
        [ROOT, deleted.path],
        [ROOT, available.path],
      ]);
      expect(harness.lifecycle().canReopenClosedDocument).toBe(false);
      harness.unmount();
    });

    it("drops already-open files and continues to the next entry", async () => {
      const alreadyOpen = editorDocument(`${ROOT}/src/Open.php`);
      const available = editorDocument(`${ROOT}/src/Available.php`);
      const harness = renderLifecycle();

      harness.documentsRef.current[available.path] = available;
      harness.openPathsRef.current.push(available.path);
      act(() => harness.lifecycle().closeDocument(available.path));
      harness.documentsRef.current[alreadyOpen.path] = alreadyOpen;
      harness.openPathsRef.current.push(alreadyOpen.path);
      act(() => harness.lifecycle().closeDocument(alreadyOpen.path));
      harness.documentsRef.current[alreadyOpen.path] = alreadyOpen;
      harness.openPathsRef.current.push(alreadyOpen.path);
      await act(async () => harness.lifecycle().reopenClosedDocument());

      expect(harness.openRecentlyClosedDocument).toHaveBeenCalledTimes(1);
      expect(harness.openRecentlyClosedDocument).toHaveBeenCalledWith(
        ROOT,
        available.path,
      );
      expect(harness.lifecycle().canReopenClosedDocument).toBe(false);
      harness.unmount();
    });
  });

  describe("captureLocalHistorySnapshot", () => {
    it("records a snapshot at the workspace-relative path", async () => {
      const harness = renderLifecycle();

      await act(async () => {
        await harness
          .lifecycle()
          .captureLocalHistorySnapshot(ROOT, `${ROOT}/src/User.php`, "content");
      });

      expect(harness.localHistoryGateway.recordSnapshot).toHaveBeenCalledWith(
        ROOT,
        "src/User.php",
        "content",
      );
      harness.unmount();
    });

    it("skips recording when the path is outside the workspace root", async () => {
      const harness = renderLifecycle();

      await act(async () => {
        await harness
          .lifecycle()
          .captureLocalHistorySnapshot(ROOT, "/elsewhere/User.php", "content");
      });

      expect(harness.localHistoryGateway.recordSnapshot).not.toHaveBeenCalled();
      harness.unmount();
    });

    it("swallows a snapshot failure instead of throwing", async () => {
      const recordSnapshot = vi.fn(async () => {
        throw new Error("snapshot failed");
      });
      const harness = renderLifecycle({
        localHistoryGateway: createFakeLocalHistoryGateway({ recordSnapshot }),
      });

      await act(async () => {
        await expect(
          harness
            .lifecycle()
            .captureLocalHistorySnapshot(ROOT, `${ROOT}/src/User.php`, "content"),
        ).resolves.toBeUndefined();
      });

      harness.unmount();
    });
  });
});

function revision(contentHash: number) {
  return {
    device: 1,
    inode: 2,
    size: 3,
    modifiedSeconds: 4,
    modifiedNanoseconds: 5,
    contentHash,
  };
}
