// @vitest-environment jsdom

import {
  act,
  useLayoutEffect,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  createInitialEditorGroupsState,
  editorGroupsReducer,
  type EditorGroupsState,
} from "../domain/editorGroups";
import { FilePrefetchCache } from "../domain/filePrefetchCache";
import type { GitStatus } from "../domain/git";
import { defaultAppSettings } from "../domain/settings";
import type {
  EditorDocument,
  FileEntry,
  ImageTab,
  WorkspaceFileGateway,
  WorkspaceFileRevision,
  WorkspaceTextFileSnapshot,
} from "../domain/workspace";
import {
  useWorkbenchDocumentTabs,
  type WorkbenchDocumentTabs,
  type WorkbenchDocumentTabsDependencies,
} from "./useWorkbenchDocumentTabs";
import {
  useEditorSessionState,
  type EditorSessionState,
} from "./useEditorSessionState";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT_A = "/workspace-a";
const ROOT_B = "/workspace-b";

interface Deferred<Value> {
  promise: Promise<Value>;
  reject: (reason: unknown) => void;
  resolve: (value: Value) => void;
}

interface HarnessOptions {
  activePath?: string | null;
  documents?: Record<string, EditorDocument>;
  editorGroups?: EditorGroupsState;
  imageTabs?: Record<string, ImageTab>;
  openPaths?: string[];
  previewPath?: string | null;
  readImage?: (path: string) => Promise<{ base64: string; byteLength: number }>;
  readSnapshot?: (path: string) => Promise<WorkspaceTextFileSnapshot>;
  readText?: (path: string) => Promise<string>;
}

interface HarnessState {
  activePath: string | null;
  documents: Record<string, EditorDocument>;
  imageTabs: Record<string, ImageTab>;
  isOpeningFile: boolean;
  openPaths: string[];
  previewPath: string | null;
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

function entry(path: string): FileEntry {
  return { kind: "file", name: path.split("/").pop() ?? path, path };
}

function document(path: string, content: string, savedContent = content): EditorDocument {
  return {
    content,
    language: "typescript",
    name: path.split("/").pop() ?? path,
    path,
    savedContent,
  };
}

function renderHarness(options: HarnessOptions = {}) {
  const container = window.document.createElement("div");
  const root = createRoot(container);
  const syncClosedDocument = vi.fn(async () => undefined);
  const syncClosedJavaScriptTypeScriptDocument = vi.fn(async () => undefined);
  const reportError = vi.fn();
  const reportErrorForActiveWorkspaceRoot = vi.fn();
  const recordCurrentNavigationLocation = vi.fn();
  const recordRecentFile = vi.fn();
  const filePrefetchCache = new FilePrefetchCache();
  const captured: {
    api: WorkbenchDocumentTabs | null;
    currentWorkspaceRootRef: { current: string | null } | null;
    session: EditorSessionState | null;
    state: HarnessState | null;
  } = {
    api: null,
    currentWorkspaceRootRef: null,
    session: null,
    state: null,
  };
  const readText = options.readText ?? (async () => "content");
  const workspaceFiles = {
    readImageFile: options.readImage,
    readTextFile: readText,
    readTextFileSnapshot: options.readSnapshot ?? (async (path: string) => ({
      content: await readText(path),
      revision: null,
    })),
  } as unknown as WorkspaceFileGateway;

  function Harness() {
    const session = useEditorSessionState();
    const [isOpeningFile, setIsOpeningFile] = useState(false);
    const initializedRef = useRef(false);
    const currentWorkspaceRootRef = useRef<string | null>(ROOT_A);

    useLayoutEffect(() => {
      if (initializedRef.current) {
        return;
      }

      initializedRef.current = true;
      const editorGroups = options.editorGroups ??
        createInitialEditorGroupsState("editor-main", {
          activePath: options.activePath ?? null,
          openPaths: options.openPaths ?? [],
          previewPath: options.previewPath ?? null,
        });
      session.restoreEditorSurface(ROOT_A, {
        activePath: options.activePath ?? null,
        documents: options.documents ?? {},
        editorGroups,
        imageTabs: options.imageTabs ?? {},
        markdownPreviewTabs: {},
        openPaths: options.openPaths ?? [],
        previewPath: options.previewPath ?? null,
      });
    }, [session]);

    const dependencies = {
      appSettingsRef: useRef({
        ...defaultAppSettings(),
        workspaceTabs: [ROOT_A, ROOT_B],
      }),
      currentWorkspaceRootRef,
      documentTabSession: session.documentTabSession,
      emptyDocumentRefreshTimeoutsRef: useRef(new Set()),
      filePrefetchCacheRef: useRef(filePrefetchCache),
      filePrefetchTimersRef: useRef(new Map()),
      forgetExternallyRemovedDocumentPath: vi.fn(),
      gitChangeForDiffDocumentPath: () => null,
      gitDiffRequestTokenRef: useRef(0),
      gitStatus: emptyGitStatus(),
      loadGitDiffDocument: vi.fn(),
      openFileRequestTokenRef: useRef(0),
      openingFileFlagOwnerTokenRef: useRef(null),
      recordCurrentNavigationLocation,
      recordRecentFile,
      refreshLocalPhpDiagnosticsForContent: vi.fn(),
      reportError,
      reportErrorForActiveWorkspaceRoot,
      selectedGitChangeRef: useRef(null),
      setGitDiffLoading: vi.fn(),
      setGitDiffPreview: vi.fn(),
      setIsOpeningFile,
      setMessage: vi.fn(),
      setSelectedGitChange: vi.fn(),
      syncClosedDocument,
      syncClosedJavaScriptTypeScriptDocument,
      workspaceFiles,
      workspacePathBelongsToRoot: (path, workspaceRoot) =>
        Boolean(workspaceRoot && path.startsWith(`${workspaceRoot}/`)),
      workspaceRoot: ROOT_A,
    } as WorkbenchDocumentTabsDependencies;

    captured.api = useWorkbenchDocumentTabs(dependencies);
    captured.currentWorkspaceRootRef = currentWorkspaceRootRef;
    captured.session = session;
    captured.state = {
      activePath: session.activePath,
      documents: session.documents,
      imageTabs: session.imageTabs,
      isOpeningFile,
      openPaths: session.openPaths,
      previewPath: session.previewPath,
    };
    return null;
  }

  act(() => root.render(<Harness />));

  return {
    api: () => captured.api as WorkbenchDocumentTabs,
    currentWorkspaceRootRef: () =>
      captured.currentWorkspaceRootRef as { current: string | null },
    filePrefetchCache,
    mutateDocuments: (
      update: SetStateAction<Record<string, EditorDocument>>,
    ) => act(() => {
      captured.session?.setDocuments(update);
    }),
    recordCurrentNavigationLocation,
    recordRecentFile,
    reportError,
    reportErrorForActiveWorkspaceRoot,
    state: () => captured.state as HarnessState,
    syncClosedDocument,
    syncClosedJavaScriptTypeScriptDocument,
    unmount: () => act(() => root.unmount()),
  };
}

describe("useWorkbenchDocumentTabs", () => {
  it("releases a hung open owner when a newer retained document opens", async () => {
    const hungRead = deferred<string>();
    const retainedPath = `${ROOT_A}/retained.ts`;
    const retainedDocument = document(retainedPath, "retained content");
    const harness = renderHarness({
      documents: { [retainedPath]: retainedDocument },
      openPaths: [retainedPath],
      readText: () => hungRead.promise,
    });
    let hungOpen!: Promise<boolean>;
    act(() => {
      hungOpen = harness.api().openFile(entry(`${ROOT_A}/hung.ts`));
    });

    expect(harness.state().isOpeningFile).toBe(true);

    let retainedOpened = false;
    await act(async () => {
      retainedOpened = await harness.api().openFile(entry(retainedPath));
    });

    expect(retainedOpened).toBe(true);
    expect(harness.state().isOpeningFile).toBe(false);
    expect(harness.state().activePath).toBe(retainedPath);
    void hungOpen;
    harness.unmount();
  });

  it("releases a hung open owner when a newer prefetched document opens", async () => {
    const hungPath = `${ROOT_A}/hung.ts`;
    const prefetchedPath = `${ROOT_A}/prefetched.ts`;
    const hungRead = deferred<WorkspaceTextFileSnapshot>();
    const harness = renderHarness({
      readSnapshot: (path) =>
        path === hungPath
          ? hungRead.promise
          : Promise.resolve({ content: "prefetched", revision: null }),
    });
    harness.filePrefetchCache.set(ROOT_A, prefetchedPath, "prefetched");
    let hungOpen!: Promise<boolean>;
    act(() => {
      hungOpen = harness.api().openFile(entry(hungPath));
    });

    expect(harness.state().isOpeningFile).toBe(true);

    let prefetchedOpened = false;
    await act(async () => {
      prefetchedOpened = await harness.api().openFile(entry(prefetchedPath));
    });

    expect(prefetchedOpened).toBe(true);
    expect(harness.state().isOpeningFile).toBe(false);
    expect(harness.state().documents[prefetchedPath]?.content).toBe(
      "prefetched",
    );
    void hungOpen;
    harness.unmount();
  });

  it("releases a hung open owner when a newer request targets another workspace", async () => {
    const hungRead = deferred<string>();
    const harness = renderHarness({ readText: () => hungRead.promise });
    let hungOpen!: Promise<boolean>;
    act(() => {
      hungOpen = harness.api().openFile(entry(`${ROOT_A}/hung.ts`));
    });

    expect(harness.state().isOpeningFile).toBe(true);

    let foreignOpened = true;
    await act(async () => {
      foreignOpened = await harness.api().openFile(
        entry(`${ROOT_B}/foreign.ts`),
      );
    });

    expect(foreignOpened).toBe(false);
    expect(harness.state().isOpeningFile).toBe(false);
    expect(harness.state().documents).toEqual({});
    void hungOpen;
    harness.unmount();
  });

  it("does not let a slower open override a newer open", async () => {
    const reads = new Map<string, Deferred<string>>();
    const harness = renderHarness({
      readText: (path) => {
        const pending = deferred<string>();
        reads.set(path, pending);
        return pending.promise;
      },
    });
    const firstPath = `${ROOT_A}/first.ts`;
    const secondPath = `${ROOT_A}/second.ts`;
    const firstOpen = harness.api().openFile(entry(firstPath));
    const secondOpen = harness.api().openFile(entry(secondPath));

    await act(async () => reads.get(secondPath)?.resolve("second"));
    await expect(secondOpen).resolves.toBe(true);
    await act(async () => reads.get(firstPath)?.resolve("first"));
    await expect(firstOpen).resolves.toBe(false);

    expect(harness.state().activePath).toBe(secondPath);
    expect(Object.keys(harness.state().documents)).toEqual([secondPath]);
    expect(harness.state().isOpeningFile).toBe(false);
    harness.unmount();
  });

  it("keeps a replaced clean preview that remains visible in another group", async () => {
    const sharedPath = `${ROOT_A}/shared.ts`;
    const replacementPath = `${ROOT_A}/replacement.ts`;
    const shared = document(sharedPath, "shared");
    let editorGroups = createInitialEditorGroupsState("editor-main", {
      activePath: sharedPath,
      openPaths: [],
      previewPath: sharedPath,
    });
    editorGroups = editorGroupsReducer(editorGroups, {
      direction: "right",
      newGroupId: "editor-secondary",
      type: "split-group",
    });
    editorGroups = {
      ...editorGroups,
      activeGroupId: "editor-main",
      groups: {
        ...editorGroups.groups,
        "editor-secondary": {
          activePath: sharedPath,
          openPaths: [sharedPath],
          previewPath: null,
        },
      },
    };
    const harness = renderHarness({
      documents: { [sharedPath]: shared },
      editorGroups,
    });

    await act(async () => {
      await harness.api().openFile(entry(replacementPath));
    });

    expect(harness.state().documents).toMatchObject({
      [sharedPath]: shared,
      [replacementPath]: document(replacementPath, "content"),
    });
    expect(harness.syncClosedDocument).not.toHaveBeenCalled();
    expect(
      harness.syncClosedJavaScriptTypeScriptDocument,
    ).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("drops text and image reads after a workspace switch", async () => {
    const textRead = deferred<string>();
    const imageRead = deferred<{ base64: string; byteLength: number }>();
    const textHarness = renderHarness({ readText: () => textRead.promise });
    const textOpen = textHarness.api().openFile(entry(`${ROOT_A}/slow.ts`));
    textHarness.currentWorkspaceRootRef().current = ROOT_B;

    await act(async () => textRead.resolve("stale"));
    await expect(textOpen).resolves.toBe(false);
    expect(textHarness.state().documents).toEqual({});
    textHarness.unmount();

    const imageHarness = renderHarness({ readImage: () => imageRead.promise });
    const imageOpen = imageHarness.api().openFile(entry(`${ROOT_A}/slow.png`));
    imageHarness.currentWorkspaceRootRef().current = ROOT_B;

    await act(async () => imageRead.resolve({ base64: "AAAA", byteLength: 4 }));
    await expect(imageOpen).resolves.toBe(false);
    expect(imageHarness.state().imageTabs).toEqual({});
    imageHarness.unmount();
  });

  it("preserves a dirty preview but replaces a clean preview", async () => {
    const dirtyPath = `${ROOT_A}/dirty.ts`;
    const dirtyHarness = renderHarness({
      activePath: dirtyPath,
      documents: { [dirtyPath]: document(dirtyPath, "changed", "saved") },
      previewPath: dirtyPath,
    });
    const nextDirtyPath = `${ROOT_A}/next-dirty.ts`;

    await act(async () => {
      await dirtyHarness.api().openFile(entry(nextDirtyPath));
    });

    expect(Object.keys(dirtyHarness.state().documents).sort()).toEqual(
      [dirtyPath, nextDirtyPath].sort(),
    );
    expect(dirtyHarness.syncClosedDocument).not.toHaveBeenCalled();
    expect(
      dirtyHarness.syncClosedJavaScriptTypeScriptDocument,
    ).not.toHaveBeenCalled();
    dirtyHarness.unmount();

    const cleanPath = `${ROOT_A}/clean.ts`;
    const cleanDocument = document(cleanPath, "saved");
    const cleanHarness = renderHarness({
      activePath: cleanPath,
      documents: { [cleanPath]: cleanDocument },
      previewPath: cleanPath,
    });
    const nextCleanPath = `${ROOT_A}/next-clean.ts`;

    await act(async () => {
      await cleanHarness.api().openFile(entry(nextCleanPath));
    });

    expect(Object.keys(cleanHarness.state().documents)).toEqual([nextCleanPath]);
    expect(cleanHarness.syncClosedDocument).toHaveBeenCalledOnce();
    expect(cleanHarness.syncClosedDocument).toHaveBeenCalledWith(cleanDocument);
    expect(
      cleanHarness.syncClosedJavaScriptTypeScriptDocument,
    ).toHaveBeenCalledOnce();
    expect(
      cleanHarness.syncClosedJavaScriptTypeScriptDocument,
    ).toHaveBeenCalledWith(cleanDocument);
    cleanHarness.unmount();
  });

  it("closes a clean text preview displaced by an image exactly once", async () => {
    const previewPath = `${ROOT_A}/preview.ts`;
    const preview = document(previewPath, "saved");
    const imagePath = `${ROOT_A}/diagram.png`;
    const harness = renderHarness({
      activePath: previewPath,
      documents: { [previewPath]: preview },
      previewPath,
      readImage: async () => ({ base64: "AAAA", byteLength: 4 }),
    });

    await act(async () => {
      await harness.api().openFile(entry(imagePath));
    });

    expect(harness.state().documents).not.toHaveProperty(previewPath);
    expect(harness.state().imageTabs).toHaveProperty(imagePath);
    expect(harness.syncClosedDocument).toHaveBeenCalledOnce();
    expect(harness.syncClosedDocument).toHaveBeenCalledWith(preview);
    expect(
      harness.syncClosedJavaScriptTypeScriptDocument,
    ).toHaveBeenCalledOnce();
    expect(
      harness.syncClosedJavaScriptTypeScriptDocument,
    ).toHaveBeenCalledWith(preview);
    harness.unmount();
  });

  it.each([
    ["PHP", "php"],
    ["JavaScript/TypeScript", "typescript"],
  ])(
    "closes a replaced %s preview through each document sync exactly once",
    async (_label, language) => {
      const previewPath = `${ROOT_A}/preview.${language === "php" ? "php" : "ts"}`;
      const preview = { ...document(previewPath, "saved"), language };
      const harness = renderHarness({
        activePath: previewPath,
        documents: { [previewPath]: preview },
        previewPath,
      });

      await act(async () => {
        await harness.api().openFile(entry(`${ROOT_A}/replacement.ts`));
      });

      expect(harness.syncClosedDocument).toHaveBeenCalledOnce();
      expect(harness.syncClosedDocument).toHaveBeenCalledWith(preview);
      expect(
        harness.syncClosedJavaScriptTypeScriptDocument,
      ).toHaveBeenCalledOnce();
      expect(
        harness.syncClosedJavaScriptTypeScriptDocument,
      ).toHaveBeenCalledWith(preview);
      harness.unmount();
    },
  );

  it("re-checks the live document after an async empty refresh read", async () => {
    const path = `${ROOT_A}/empty.ts`;
    const read = deferred<string>();
    const harness = renderHarness({
      activePath: path,
      documents: { [path]: document(path, "") },
      readText: () => read.promise,
    });
    const opening = harness.api().openFile(entry(path));

    harness.mutateDocuments((current) => ({
      ...current,
      [path]: document(path, "local edit", ""),
    }));
    await act(async () => read.resolve("disk content"));
    await expect(opening).resolves.toBe(true);

    expect(harness.state().documents[path]).toMatchObject({
      content: "local edit",
      savedContent: "",
    });
    harness.unmount();
  });

  it("commits an existing empty-document refresh in the same workspace", async () => {
    const path = `${ROOT_A}/empty.ts`;
    const read = deferred<string>();
    const harness = renderHarness({
      activePath: path,
      documents: { [path]: document(path, "") },
      readText: () => read.promise,
    });
    const opening = harness.api().openFile(entry(path));

    await act(async () => read.resolve("disk content"));
    await expect(opening).resolves.toBe(true);

    expect(harness.state().documents[path]).toMatchObject({
      content: "disk content",
      savedContent: "disk content",
    });
    harness.unmount();
  });

  it("drops an existing empty-document refresh after a workspace switch", async () => {
    const path = `${ROOT_A}/empty.ts`;
    const read = deferred<string>();
    const harness = renderHarness({
      activePath: path,
      documents: { [path]: document(path, "") },
      readText: () => read.promise,
    });
    const opening = harness.api().openFile(entry(path));

    harness.currentWorkspaceRootRef().current = ROOT_B;
    await act(async () => read.resolve("foreign content"));
    await expect(opening).resolves.toBe(false);

    expect(harness.state().documents[path]).toMatchObject({
      content: "",
      savedContent: "",
    });
    harness.unmount();
  });

  it("keeps the filesystem revision when prefetched content matches the snapshot", async () => {
    const path = `${ROOT_A}/prefetched.ts`;
    const diskRevision = revision(17);
    const readSnapshot = vi.fn(async () => ({
      content: "prefetched content",
      revision: diskRevision,
    }));
    const harness = renderHarness({ readSnapshot });
    harness.filePrefetchCache.set(ROOT_A, path, "prefetched content");

    await act(async () => {
      await harness.api().openFile(entry(path));
    });

    expect(readSnapshot).toHaveBeenCalledWith(path);
    expect(harness.state().documents[path]).toMatchObject({
      content: "prefetched content",
      revision: diskRevision,
      savedContent: "prefetched content",
    });
    expect(harness.filePrefetchCache.has(ROOT_A, path)).toBe(false);
    harness.unmount();
  });

  it("pins and activates existing tabs without changing their content", () => {
    const firstPath = `${ROOT_A}/first.ts`;
    const secondPath = `${ROOT_A}/second.ts`;
    const first = document(firstPath, "first");
    const second = {
      ...document(secondPath, "second"),
      name: "Readable second tab",
    };
    const harness = renderHarness({
      activePath: firstPath,
      documents: { [firstPath]: first, [secondPath]: second },
      previewPath: firstPath,
    });

    act(() => harness.api().pinDocument(firstPath));
    expect(harness.state()).toMatchObject({
      openPaths: [firstPath],
      previewPath: null,
    });

    act(() => harness.api().activateDocument(secondPath));
    expect(harness.state().activePath).toBe(secondPath);
    expect(harness.state().documents).toEqual({
      [firstPath]: first,
      [secondPath]: second,
    });
    expect(harness.recordCurrentNavigationLocation).toHaveBeenCalledOnce();
    expect(harness.recordRecentFile).toHaveBeenCalledWith({
      name: "Readable second tab",
      path: secondPath,
    });
    harness.unmount();
  });

  it("opens read-only documents as previews or pinned tabs", () => {
    const previewPath = `${ROOT_A}/generated-preview.php`;
    const pinnedPath = `${ROOT_A}/generated-pinned.php`;
    const harness = renderHarness();

    act(() => {
      harness.api().openReadOnlyDocument({
        ...document(previewPath, "preview"),
        language: "php",
      });
    });
    expect(harness.state()).toMatchObject({
      activePath: previewPath,
      openPaths: [],
      previewPath,
    });
    expect(harness.state().documents[previewPath]).toMatchObject({
      content: "preview",
      readOnly: true,
      savedContent: "preview",
    });

    act(() => {
      harness.api().openReadOnlyDocument(
        { ...document(pinnedPath, "pinned"), language: "php" },
        { pin: true },
      );
    });
    expect(harness.state()).toMatchObject({
      activePath: pinnedPath,
      openPaths: [pinnedPath],
      previewPath,
    });
    expect(harness.state().documents[pinnedPath]).toMatchObject({
      content: "pinned",
      readOnly: true,
      savedContent: "pinned",
    });
    expect(harness.recordCurrentNavigationLocation).toHaveBeenCalledTimes(2);
    harness.unmount();
  });

  it("closes a displaced clean read-only preview exactly once", () => {
    const firstPath = `${ROOT_A}/generated-first.php`;
    const secondPath = `${ROOT_A}/generated-second.php`;
    const harness = renderHarness();

    act(() => {
      harness.api().openReadOnlyDocument({
        ...document(firstPath, "first"),
        language: "php",
      });
      harness.api().openReadOnlyDocument({
        ...document(secondPath, "second"),
        language: "php",
      });
    });

    expect(harness.state().documents[firstPath]).toBeUndefined();
    expect(harness.state()).toMatchObject({
      activePath: secondPath,
      previewPath: secondPath,
    });
    expect(harness.syncClosedDocument).toHaveBeenCalledOnce();
    expect(harness.syncClosedDocument).toHaveBeenCalledWith(
      expect.objectContaining({ path: firstPath }),
    );
    expect(
      harness.syncClosedJavaScriptTypeScriptDocument,
    ).toHaveBeenCalledOnce();
    expect(
      harness.syncClosedJavaScriptTypeScriptDocument,
    ).toHaveBeenCalledWith(expect.objectContaining({ path: firstPath }));
    harness.unmount();
  });

  it("lets only the owning request release the opening indicator", async () => {
    const firstRead = deferred<string>();
    const secondRead = deferred<string>();
    const firstPath = `${ROOT_A}/first.ts`;
    const secondPath = `${ROOT_A}/second.ts`;
    const harness = renderHarness({
      readText: (path) =>
        path === firstPath ? firstRead.promise : secondRead.promise,
    });
    const firstOpen = harness.api().openFile(entry(firstPath));
    const secondOpen = harness.api().openFile(entry(secondPath));

    await act(async () => firstRead.reject(new Error("stale failure")));
    await expect(firstOpen).resolves.toBe(false);
    expect(harness.state().isOpeningFile).toBe(true);
    expect(harness.reportError).not.toHaveBeenCalled();
    expect(harness.reportErrorForActiveWorkspaceRoot).not.toHaveBeenCalled();

    await act(async () => secondRead.resolve("second"));
    await expect(secondOpen).resolves.toBe(true);
    expect(harness.state().isOpeningFile).toBe(false);
    harness.unmount();
  });
});

function emptyGitStatus(): GitStatus {
  return {
    branch: null,
    changes: [],
    isRepository: false,
    rootPath: ROOT_A,
  };
}

function revision(contentHash: number): WorkspaceFileRevision {
  return {
    contentHash,
    device: 1,
    inode: 2,
    modifiedNanoseconds: 5,
    modifiedSeconds: 4,
    size: 3,
  };
}
