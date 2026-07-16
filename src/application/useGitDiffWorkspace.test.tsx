// @vitest-environment jsdom

import { act, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  createInitialEditorGroupsState,
  editorGroupsReducer,
} from "../domain/editorGroups";
import type { GitChangedFile, GitFileDiff, GitGateway } from "../domain/git";
import type { EditorDocument } from "../domain/workspace";
import {
  gitChangeForDiffDocumentPath,
  gitChangesReferToSameDiff,
  gitDiffDocumentPath,
  useGitDiffWorkspace,
  type GitDiffWorkspace,
  type GitDiffWorkspaceDependencies,
} from "./useGitDiffWorkspace";
import {
  useGitDiffPreviewCloseLifecycle,
  type GitDiffPreviewCloseLifecycle,
} from "./useGitDiffPreviewCloseLifecycle";
import {
  useEditorSessionState,
  type EditorSessionState,
} from "./useEditorSessionState";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";

interface Deferred<T> {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T) => void;
}

interface Harness {
  activateDocument: ReturnType<typeof vi.fn>;
  currentWorkspaceRootRef: { current: string | null };
  git: () => GitDiffWorkspace;
  lifecycle: () => GitDiffPreviewCloseLifecycle;
  onDocumentReplaced: ReturnType<typeof vi.fn>;
  recordCurrentNavigationLocation: ReturnType<typeof vi.fn>;
  reportError: ReturnType<typeof vi.fn>;
  session: () => EditorSessionState;
  message: () => string | null;
  unmount: () => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

function changedFile(
  relativePath: string,
  overrides: Partial<GitChangedFile> = {},
): GitChangedFile {
  return {
    isStaged: false,
    isUnversioned: false,
    oldPath: null,
    oldRelativePath: null,
    path: `${ROOT}/${relativePath}`,
    relativePath,
    status: "modified",
    ...overrides,
  };
}

function diff(change: GitChangedFile): GitFileDiff {
  return {
    change,
    language: "typescript",
    modifiedContent: "modified",
    originalContent: "original",
  };
}

function document(
  path: string,
  content = "saved",
  savedContent = content,
): EditorDocument {
  const pathSegments = path.split("/");

  return {
    content,
    language: "typescript",
    name: pathSegments[pathSegments.length - 1] ?? path,
    path,
    savedContent,
  };
}

function createFakeGitGateway(
  getDiff: GitGateway["getDiff"] = vi.fn(async (_root, change) => diff(change)),
): GitGateway {
  return { getDiff } as unknown as GitGateway;
}

function renderGitDiffWorkspace(
  overrides: Partial<GitDiffWorkspaceDependencies> = {},
): Harness {
  const container = window.document.createElement("div");
  const root = createRoot(container);
  const currentWorkspaceRootRef = { current: ROOT };
  const activateDocument = vi.fn();
  const recordCurrentNavigationLocation = vi.fn();
  const reportError = vi.fn();
  const onDocumentReplaced = vi.fn();
  const gitGateway = createFakeGitGateway();
  const captured: {
    git: GitDiffWorkspace | null;
    lifecycle: GitDiffPreviewCloseLifecycle | null;
    message: string | null;
    session: EditorSessionState | null;
  } = { git: null, lifecycle: null, message: null, session: null };

  function HarnessComponent() {
    const session = useEditorSessionState();
    const [message, setMessage] = useState<string | null>(null);
    const documentTabSession = useMemo(
      () => ({
        ...session.documentTabSession,
        activate: (path: string) => {
          activateDocument(path);
          session.documentTabSession.activate(path);
        },
      }),
      [session.documentTabSession],
    );
    captured.session = session;
    const git = useGitDiffWorkspace({
      workspaceRoot: ROOT,
      gitGateway,
      currentWorkspaceRootRef,
      documentTabSession,
      setMessage,
      recordCurrentNavigationLocation,
      reportError,
      onDocumentReplaced,
      ...overrides,
    });
    captured.git = git;
    captured.lifecycle = useGitDiffPreviewCloseLifecycle({
      documentTabSession,
      cancelGitDiffDocument: git.cancelGitDiffDocument,
      getGitDiffDocument: git.getGitDiffDocument,
      getSelectedGitDiffDocument: git.getSelectedGitDiffDocument,
      gitChangeForDiffDocumentPath,
      loadGitDiffDocument: git.loadGitDiffDocument,
      reloadGitDiffDocument: git.reloadGitDiffDocument,
      reconcileGitDiffDocument: git.reconcileGitDiffDocument,
    });
    captured.message = message;
    return null;
  }

  act(() => {
    root.render(<HarnessComponent />);
  });

  const required = <Value,>(value: Value | null, name: string): Value => {
    if (!value) {
      throw new Error(`${name} not mounted`);
    }
    return value;
  };

  return {
    activateDocument,
    currentWorkspaceRootRef,
    git: () => required(captured.git, "hook"),
    lifecycle: () => required(captured.lifecycle, "lifecycle"),
    onDocumentReplaced,
    recordCurrentNavigationLocation,
    reportError,
    session: () => required(captured.session, "session"),
    message: () => captured.message,
    unmount: () => {
      act(() => root.unmount());
    },
  };
}

function seedPreview(harness: Harness, preview: EditorDocument): void {
  act(() => {
    harness.session().setDocuments({ [preview.path]: preview });
    harness.session().updateEditorGroups(() =>
      createInitialEditorGroupsState("editor-main", {
        activePath: preview.path,
        openPaths: [],
        previewPath: preview.path,
      }),
    );
  });
}

describe("git diff workspace helpers", () => {
  it("matches worktree and staged pseudo-document paths independently", () => {
    const worktreeChange = changedFile("src/App.tsx");
    const stagedChange = changedFile("src/App.tsx", { isStaged: true });

    expect(gitDiffDocumentPath(worktreeChange)).toBe(
      "mockor-git-diff:worktree:/workspace/src/App.tsx",
    );
    expect(gitDiffDocumentPath(stagedChange)).toBe(
      "mockor-git-diff:staged:/workspace/src/App.tsx",
    );
    expect(
      gitChangeForDiffDocumentPath(gitDiffDocumentPath(stagedChange), [
        worktreeChange,
        stagedChange,
      ]),
    ).toBe(stagedChange);
    expect(gitChangesReferToSameDiff(worktreeChange, stagedChange)).toBe(false);
  });
});

describe("useGitDiffWorkspace", () => {
  it("replaces a clean preview and reports the replaced document", async () => {
    const cleanPreview = document(`${ROOT}/src/Preview.ts`);
    const change = changedFile("src/App.tsx");
    const harness = renderGitDiffWorkspace();
    seedPreview(harness, cleanPreview);

    await act(async () => {
      await harness.git().previewGitChange(change);
    });

    const path = gitDiffDocumentPath(change);
    expect(harness.session().documents[cleanPreview.path]).toBeUndefined();
    expect(harness.session().documents[path]).toMatchObject({
      path,
      readOnly: true,
    });
    expect(harness.session().activePath).toBe(path);
    expect(harness.session().previewPath).toBe(path);
    expect(harness.onDocumentReplaced).toHaveBeenCalledOnce();
    expect(harness.onDocumentReplaced).toHaveBeenCalledWith(cleanPreview);

    harness.unmount();
  });

  it("preserves a dirty preview when opening a git diff preview", async () => {
    const dirtyPreview = document(`${ROOT}/src/Dirty.ts`, "changed", "saved");
    const change = changedFile("src/App.tsx");
    const harness = renderGitDiffWorkspace();
    seedPreview(harness, dirtyPreview);

    await act(async () => {
      await harness.git().previewGitChange(change);
    });

    expect(harness.session().documents[dirtyPreview.path]).toBe(dirtyPreview);
    expect(harness.session().openPaths).toEqual([dirtyPreview.path]);
    expect(harness.session().previewPath).toBe(gitDiffDocumentPath(change));
    expect(harness.onDocumentReplaced).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("opens a pinned read-only diff without replacing an unrelated preview", async () => {
    const cleanPreview = document(`${ROOT}/src/Preview.ts`);
    const change = changedFile("src/App.tsx");
    const harness = renderGitDiffWorkspace();
    seedPreview(harness, cleanPreview);

    await act(async () => {
      await harness.git().openGitChange(change);
    });

    const path = gitDiffDocumentPath(change);
    expect(harness.session().documents[cleanPreview.path]).toBe(cleanPreview);
    expect(harness.session().documents[path]).toMatchObject({ readOnly: true });
    expect(harness.session().activePath).toBe(path);
    expect(harness.session().openPaths).toEqual([path]);
    expect(harness.session().previewPath).toBe(cleanPreview.path);
    expect(harness.onDocumentReplaced).not.toHaveBeenCalled();
    expect(harness.git().selectedGitChange).toBe(change);
    expect(harness.git().gitDiffPreview).toEqual(diff(change));
    expect(harness.message()).toBe("Diff src/App.tsx");

    harness.unmount();
  });

  it("promotes the same preview path to pinned without duplicating it", async () => {
    const change = changedFile("src/App.tsx");
    const harness = renderGitDiffWorkspace();

    await act(async () => {
      await harness.git().previewGitChange(change);
    });
    await act(async () => {
      await harness.git().openGitChange(change);
    });

    const path = gitDiffDocumentPath(change);
    expect(harness.session().activePath).toBe(path);
    expect(harness.session().openPaths).toEqual([path]);
    expect(harness.session().previewPath).toBeNull();
    expect(Object.keys(harness.session().documents)).toEqual([path]);
    expect(harness.onDocumentReplaced).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("retains a replaced preview that remains visible in another group", async () => {
    const firstChange = changedFile("src/First.ts");
    const secondChange = changedFile("src/Second.ts");
    const firstPath = gitDiffDocumentPath(firstChange);
    const firstDocument: EditorDocument = {
      content: "",
      language: "plaintext",
      name: "Diff: First.ts",
      path: firstPath,
      readOnly: true,
      savedContent: "",
    };
    const harness = renderGitDiffWorkspace();
    let groups = editorGroupsReducer(
      createInitialEditorGroupsState("editor-main", {
        activePath: firstPath,
        openPaths: [],
        previewPath: firstPath,
      }),
      {
        type: "split-group",
        groupId: "editor-main",
        newGroupId: "editor-side",
        direction: "right",
      },
    );
    groups = {
      ...groups,
      activeGroupId: "editor-main",
      groups: {
        ...groups.groups,
        "editor-side": {
          activePath: firstPath,
          openPaths: [firstPath],
          previewPath: null,
        },
      },
    };
    act(() => {
      harness.session().setDocuments({ [firstPath]: firstDocument });
      harness.session().updateEditorGroups(() => groups);
    });

    await act(async () => {
      await harness.git().previewGitChange(secondChange);
    });

    expect(harness.session().documents[firstPath]).toBe(firstDocument);
    expect(
      harness.session().documents[gitDiffDocumentPath(secondChange)],
    ).toBeDefined();
    expect(harness.onDocumentReplaced).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("activates an existing diff document before loading it", async () => {
    const change = changedFile("src/App.tsx");
    const path = gitDiffDocumentPath(change);
    const existing = document(path);
    const harness = renderGitDiffWorkspace();
    act(() => {
      harness.session().setDocuments({ [path]: existing });
    });

    await act(async () => {
      harness.git().loadGitDiffDocument(path, change);
    });

    expect(harness.session().activePath).toBe(path);
    expect(harness.git().selectedGitChange).toBe(change);
    expect(harness.git().gitDiffPreview).toEqual(diff(change));
    expect(harness.recordCurrentNavigationLocation).toHaveBeenCalledOnce();

    harness.unmount();
  });

  it("reloads the status fallback without activating it or recording history", async () => {
    const firstChange = changedFile("src/First.ts");
    const removedChange = changedFile("src/Removed.ts");
    const firstPath = gitDiffDocumentPath(firstChange);
    const removedPath = gitDiffDocumentPath(removedChange);
    const getDiff = vi.fn<GitGateway["getDiff"]>(async (_root, change) =>
      diff(change),
    );
    const harness = renderGitDiffWorkspace({
      gitGateway: createFakeGitGateway(getDiff),
    });

    await act(async () => {
      await harness.git().openGitChange(firstChange);
      await harness.git().openGitChange(removedChange);
    });
    harness.activateDocument.mockClear();
    harness.recordCurrentNavigationLocation.mockClear();
    getDiff.mockClear();

    await act(async () => {
      harness.lifecycle().reconcileSelectedGitDiffPreviewForRepository(
        ROOT,
        [firstChange],
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(harness.session().activePath).toBe(firstPath);
    expect(harness.session().documents[removedPath]).toBeUndefined();
    expect(harness.git().selectedGitChange).toBe(firstChange);
    expect(harness.git().gitDiffPreview).toEqual(diff(firstChange));
    expect(getDiff).toHaveBeenCalledOnce();
    expect(getDiff).toHaveBeenCalledWith(ROOT, firstChange);
    expect(harness.activateDocument).not.toHaveBeenCalled();
    expect(harness.recordCurrentNavigationLocation).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("retains each pinned diff payload while simultaneous requests resolve", async () => {
    const firstChange = changedFile("src/First.ts");
    const secondChange = changedFile("src/Second.ts");
    const firstDeferred = createDeferred<GitFileDiff>();
    const secondDeferred = createDeferred<GitFileDiff>();
    const getDiff = vi
      .fn<GitGateway["getDiff"]>()
      .mockReturnValueOnce(firstDeferred.promise)
      .mockReturnValueOnce(secondDeferred.promise);
    const harness = renderGitDiffWorkspace({
      gitGateway: createFakeGitGateway(getDiff),
    });
    let firstOpen!: Promise<void>;
    let secondOpen!: Promise<void>;

    act(() => {
      firstOpen = harness.git().openGitChange(firstChange);
      secondOpen = harness.git().openGitChange(secondChange);
    });

    await act(async () => {
      secondDeferred.resolve(diff(secondChange));
      firstDeferred.resolve(diff(firstChange));
      await Promise.all([firstOpen, secondOpen]);
    });

    expect(harness.git().gitDiffDocuments).toMatchObject({
      [gitDiffDocumentPath(firstChange)]: {
        change: firstChange,
        diff: diff(firstChange),
        isLoading: false,
        repositoryRoot: ROOT,
      },
      [gitDiffDocumentPath(secondChange)]: {
        change: secondChange,
        diff: diff(secondChange),
        isLoading: false,
        repositoryRoot: ROOT,
      },
    });
    expect(harness.git().gitDiffPreview).toEqual(diff(secondChange));

    harness.unmount();
  });

  it("uses and retains the nested repository root when reactivating a diff", async () => {
    const repositoryRoot = `${ROOT}/packages/nested`;
    const change = changedFile("packages/nested/src/App.ts", {
      path: `${repositoryRoot}/src/App.ts`,
      relativePath: "src/App.ts",
    });
    const getDiff = vi.fn<GitGateway["getDiff"]>(async (_root, selected) =>
      diff(selected),
    );
    const harness = renderGitDiffWorkspace({
      gitGateway: createFakeGitGateway(getDiff),
    });

    await act(async () => {
      await harness.git().openGitChange(change, repositoryRoot);
    });
    act(() => {
      harness.git().setGitDiffPreview(null);
      harness.git().setSelectedGitChange(null);
    });
    await act(async () => {
      harness.git().loadGitDiffDocument(gitDiffDocumentPath(change), change);
    });

    expect(getDiff).toHaveBeenNthCalledWith(1, repositoryRoot, change);
    expect(getDiff).toHaveBeenNthCalledWith(2, repositoryRoot, change);
    expect(harness.git().gitDiffDocuments[gitDiffDocumentPath(change)]).toEqual({
      change,
      diff: diff(change),
      documentPath: gitDiffDocumentPath(change),
      isLoading: false,
      repositoryRoot,
    });

    harness.unmount();
  });

  it("keeps document payloads when the active diff closes and another reactivates", async () => {
    const firstChange = changedFile("src/First.ts");
    const secondChange = changedFile("src/Second.ts");
    const harness = renderGitDiffWorkspace();

    await act(async () => {
      await harness.git().openGitChange(firstChange);
      await harness.git().openGitChange(secondChange);
    });
    act(() => {
      harness.git().clearGitDiffPreviewState();
    });

    expect(harness.git().selectedGitChange).toBeNull();
    expect(harness.git().gitDiffDocuments[gitDiffDocumentPath(firstChange)]?.diff)
      .toEqual(diff(firstChange));
    expect(harness.git().gitDiffDocuments[gitDiffDocumentPath(secondChange)]?.diff)
      .toEqual(diff(secondChange));

    await act(async () => {
      harness.git().loadGitDiffDocument(
        gitDiffDocumentPath(firstChange),
        firstChange,
      );
    });

    expect(harness.git().gitDiffPreview).toEqual(diff(firstChange));
    expect(harness.git().gitDiffDocuments[gitDiffDocumentPath(secondChange)]?.diff)
      .toEqual(diff(secondChange));

    harness.unmount();
  });

  it("does not mutate the tab session through a stale-root preview callback", async () => {
    const firstChange = changedFile("src/First.ts");
    const staleChange = changedFile("src/Stale.ts");
    const harness = renderGitDiffWorkspace();

    await act(async () => {
      await harness.git().previewGitChange(firstChange);
    });
    const before = harness.session().documentTabSession.snapshot();
    harness.currentWorkspaceRootRef.current = "/other-workspace";

    await act(async () => {
      await harness.git().previewGitChange(staleChange);
    });

    expect(harness.session().documentTabSession.snapshot()).toEqual(before);
    expect(harness.recordCurrentNavigationLocation).toHaveBeenCalledOnce();
    expect(harness.onDocumentReplaced).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("ignores stale diff responses after a newer change is selected", async () => {
    const firstChange = changedFile("src/First.ts");
    const secondChange = changedFile("src/Second.ts");
    const firstDiff = createDeferred<GitFileDiff>();
    const secondDiff = createDeferred<GitFileDiff>();
    const getDiff = vi
      .fn<GitGateway["getDiff"]>()
      .mockReturnValueOnce(firstDiff.promise)
      .mockReturnValueOnce(secondDiff.promise);
    const harness = renderGitDiffWorkspace({
      gitGateway: createFakeGitGateway(getDiff),
    });
    let firstOpen!: Promise<void>;
    let secondOpen!: Promise<void>;

    act(() => {
      firstOpen = harness.git().openGitChange(firstChange);
    });
    act(() => {
      secondOpen = harness.git().openGitChange(secondChange);
    });

    await act(async () => {
      secondDiff.resolve(diff(secondChange));
      await secondOpen;
    });
    expect(harness.git().selectedGitChange).toBe(secondChange);
    expect(harness.git().gitDiffPreview).toEqual(diff(secondChange));
    expect(harness.git().gitDiffLoading).toBe(false);

    await act(async () => {
      firstDiff.resolve(diff(firstChange));
      await firstOpen;
    });
    expect(harness.git().selectedGitChange).toBe(secondChange);
    expect(harness.git().gitDiffPreview).toEqual(diff(secondChange));
    expect(harness.message()).toBe("Diff src/Second.ts");
    expect(
      harness.git().gitDiffDocuments[gitDiffDocumentPath(firstChange)]?.diff,
    ).toEqual(diff(firstChange));

    harness.unmount();
  });

  it("does not report a late failure from an inactive retained diff", async () => {
    const firstChange = changedFile("src/First.ts");
    const secondChange = changedFile("src/Second.ts");
    const firstReload = createDeferred<GitFileDiff>();
    const getDiff = vi
      .fn<GitGateway["getDiff"]>()
      .mockResolvedValueOnce(diff(firstChange))
      .mockResolvedValueOnce(diff(secondChange))
      .mockReturnValueOnce(firstReload.promise)
      .mockResolvedValueOnce(diff(secondChange));
    const harness = renderGitDiffWorkspace({
      gitGateway: createFakeGitGateway(getDiff),
    });

    await act(async () => {
      await harness.git().openGitChange(firstChange);
      await harness.git().openGitChange(secondChange);
    });

    act(() => {
      harness.git().loadGitDiffDocument(gitDiffDocumentPath(firstChange));
      harness.git().loadGitDiffDocument(gitDiffDocumentPath(secondChange));
    });
    await act(async () => {
      await Promise.resolve();
      firstReload.reject(new Error("inactive diff failed"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(harness.git().selectedGitChange).toBe(secondChange);
    expect(harness.git().gitDiffPreview).toEqual(diff(secondChange));
    expect(harness.reportError).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("does not reuse request identity after a same-root reset", async () => {
    const staleChange = changedFile("src/App.tsx");
    const currentChange = { ...staleChange, status: "renamed" as const };
    const staleRequest = createDeferred<GitFileDiff>();
    const currentRequest = createDeferred<GitFileDiff>();
    const getDiff = vi
      .fn<GitGateway["getDiff"]>()
      .mockReturnValueOnce(staleRequest.promise)
      .mockReturnValueOnce(currentRequest.promise);
    const harness = renderGitDiffWorkspace({
      gitGateway: createFakeGitGateway(getDiff),
    });
    let staleOpen!: Promise<void>;
    let currentOpen!: Promise<void>;

    act(() => {
      staleOpen = harness.git().openGitChange(staleChange);
    });
    const firstOwnerGeneration = harness.git().gitDiffRequestTokenRef.current;
    act(() => {
      harness.git().resetGitDiffWorkspaceState();
      currentOpen = harness.git().openGitChange(currentChange);
    });

    expect(harness.git().gitDiffRequestTokenRef.current).toBeGreaterThan(
      firstOwnerGeneration,
    );

    await act(async () => {
      currentRequest.resolve(diff(currentChange));
      await currentOpen;
      staleRequest.resolve(diff(staleChange));
      await staleOpen;
    });

    expect(harness.git().selectedGitChange).toBe(currentChange);
    expect(harness.git().gitDiffPreview).toEqual(diff(currentChange));
    expect(
      harness.git().gitDiffDocuments[gitDiffDocumentPath(currentChange)]?.change,
    ).toBe(currentChange);
    harness.unmount();
  });

  it("cancels one diff without stranding another split loader", async () => {
    const firstChange = changedFile("src/First.ts");
    const secondChange = changedFile("src/Second.ts");
    const firstRequest = createDeferred<GitFileDiff>();
    const secondRequest = createDeferred<GitFileDiff>();
    const getDiff = vi
      .fn<GitGateway["getDiff"]>()
      .mockReturnValueOnce(firstRequest.promise)
      .mockReturnValueOnce(secondRequest.promise);
    const harness = renderGitDiffWorkspace({
      gitGateway: createFakeGitGateway(getDiff),
    });
    let firstOpen!: Promise<void>;
    let secondOpen!: Promise<void>;

    act(() => {
      firstOpen = harness.git().openGitChange(firstChange);
      secondOpen = harness.git().openGitChange(secondChange);
      harness.git().cancelGitDiffDocument(gitDiffDocumentPath(firstChange));
    });

    await act(async () => {
      secondRequest.resolve(diff(secondChange));
      await secondOpen;
      firstRequest.resolve(diff(firstChange));
      await firstOpen;
    });

    expect(
      harness.git().gitDiffDocuments[gitDiffDocumentPath(firstChange)],
    ).toBeUndefined();
    expect(
      harness.git().gitDiffDocuments[gitDiffDocumentPath(secondChange)]?.diff,
    ).toEqual(diff(secondChange));
    expect(harness.git().gitDiffLoading).toBe(false);
    harness.unmount();
  });

  it("lets retained split loaders finish after diff focus is released", async () => {
    const firstChange = changedFile("src/First.ts");
    const secondChange = changedFile("src/Second.ts");
    const firstRequest = createDeferred<GitFileDiff>();
    const secondRequest = createDeferred<GitFileDiff>();
    const getDiff = vi
      .fn<GitGateway["getDiff"]>()
      .mockReturnValueOnce(firstRequest.promise)
      .mockReturnValueOnce(secondRequest.promise);
    const harness = renderGitDiffWorkspace({
      gitGateway: createFakeGitGateway(getDiff),
    });
    let firstOpen!: Promise<void>;
    let secondOpen!: Promise<void>;

    act(() => {
      firstOpen = harness.git().openGitChange(firstChange);
      secondOpen = harness.git().openGitChange(secondChange);
      harness.git().clearGitDiffPreviewState();
    });

    await act(async () => {
      firstRequest.resolve(diff(firstChange));
      secondRequest.resolve(diff(secondChange));
      await Promise.all([firstOpen, secondOpen]);
    });

    expect(harness.git().selectedGitChange).toBeNull();
    expect(harness.git().gitDiffPreview).toBeNull();
    expect(harness.git().gitDiffDocuments[gitDiffDocumentPath(firstChange)]?.diff)
      .toEqual(diff(firstChange));
    expect(harness.git().gitDiffDocuments[gitDiffDocumentPath(secondChange)]?.diff)
      .toEqual(diff(secondChange));
    harness.unmount();
  });
});
