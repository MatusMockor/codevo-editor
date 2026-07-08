// @vitest-environment jsdom

import { act } from "react";
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
  reportError: ReturnType<typeof vi.fn>;
  reportErrorForActiveWorkspaceRoot: ReturnType<typeof vi.fn>;
  unmount: () => void;
}

function renderLifecycle(
  overrides: Partial<DocumentLifecycleDependencies> = {},
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
  const reportError = vi.fn();
  const reportErrorForActiveWorkspaceRoot = vi.fn();

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
    workspaceSettings: defaultWorkspaceSettings(),
    currentWorkspaceRootRef: rootRef,
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
    reportError,
    reportErrorForActiveWorkspaceRoot,
    ...overrides,
  };

  function HarnessComponent() {
    captured.lifecycle = useDocumentLifecycle(deps);
    return null;
  }

  act(() => {
    root.render(<HarnessComponent />);
  });

  return {
    lifecycle: () => {
      if (!captured.lifecycle) {
        throw new Error("lifecycle not mounted");
      }
      return captured.lifecycle;
    },
    rootRef,
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
    reportError,
    reportErrorForActiveWorkspaceRoot,
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

describe("useDocumentLifecycle", () => {
  describe("saveActiveDocument", () => {
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
  });

  describe("closeDocument", () => {
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
