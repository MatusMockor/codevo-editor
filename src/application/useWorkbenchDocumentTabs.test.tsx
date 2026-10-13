// @vitest-environment jsdom

import { act, useLayoutEffect, useRef, useState, type SetStateAction } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  createInitialEditorGroupsState,
  editorGroupsReducer,
  type EditorGroupsState,
} from "../domain/editorGroups";
import { FilePrefetchCache } from "../domain/filePrefetchCache";
import type { GitChangedFile, GitFileDiff } from "../domain/git";
import { defaultAppSettings } from "../domain/settings";
import {
  createWorkspaceRuntimeOwner,
  type WorkspaceRuntimeOwner,
} from "../domain/workspaceRuntimeOwner";
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
import { useEditorSessionState, type EditorSessionState } from "./useEditorSessionState";
import type { AgentLocalFileOpenOutcome } from "../domain/agentMarkdown/agentLocalFileLinkFailure";
import {
  openOutsideLinkedFile,
  type AgentOutsideLinkedFileOpening,
  type AgentOutsideTextFile,
} from "./agentOutsideLinkedFile";

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
  selectedGitChange?: GitChangedFile | null;
  gitDiffPreview?: GitFileDiff | null;
  gitDiffLoading?: boolean;
  gitDiffRead?: Deferred<GitFileDiff>;
  gitChanges?: GitChangedFile[];
  message?: string | null;
  workspaceRoot?: string;
  workspaceTabs?: string[];
}

interface HarnessState {
  activePath: string | null;
  documents: Record<string, EditorDocument>;
  imageTabs: Record<string, ImageTab>;
  isOpeningFile: boolean;
  gitDiffLoading: boolean;
  gitDiffPreview: GitFileDiff | null;
  message: string | null;
  openPaths: string[];
  previewPath: string | null;
  selectedGitChange: GitChangedFile | null;
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
  const workspaceRoot = options.workspaceRoot ?? ROOT_A;
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
    currentWorkspaceRuntimeOwnerRef: {
      current: WorkspaceRuntimeOwner | null;
    } | null;
    gitDiffRequestTokenRef: { current: number } | null;
    session: EditorSessionState | null;
    state: HarnessState | null;
  } = {
    api: null,
    currentWorkspaceRootRef: null,
    currentWorkspaceRuntimeOwnerRef: null,
    gitDiffRequestTokenRef: null,
    session: null,
    state: null,
  };
  const readText = options.readText ?? (async () => "content");
  const workspaceFiles = {
    readImageFile: options.readImage,
    readTextFile: readText,
    readTextFileSnapshot:
      options.readSnapshot ??
      (async (path: string) => ({
        content: await readText(path),
        revision: null,
      })),
  } as unknown as WorkspaceFileGateway;

  function Harness() {
    const session = useEditorSessionState();
    const [isOpeningFile, setIsOpeningFile] = useState(false);
    const [selectedGitChange, setSelectedGitChange] = useState(options.selectedGitChange ?? null);
    const [gitDiffPreview, setGitDiffPreview] = useState(options.gitDiffPreview ?? null);
    const [gitDiffLoading, setGitDiffLoading] = useState(options.gitDiffLoading ?? false);
    const [message, setMessage] = useState(options.message ?? null);
    const initializedRef = useRef(false);
    const currentWorkspaceRootRef = useRef<string | null>(workspaceRoot);
    const currentWorkspaceRuntimeOwnerRef = useRef<WorkspaceRuntimeOwner | null>(
      createWorkspaceRuntimeOwner("workspace-a", workspaceRoot),
    );
    const gitDiffRequestTokenRef = useRef(0);
    const selectedGitChangeRef = useRef<GitChangedFile | null>(options.selectedGitChange ?? null);
    const clearGitDiffPreviewState = () => {
      selectedGitChangeRef.current = null;
      setSelectedGitChange(null);
      setGitDiffPreview(null);
      setGitDiffLoading(false);
      setMessage(null);
    };
    const loadGitDiffDocument = (path: string) => {
      const change = options.gitChanges?.find((candidate) => candidate.path === path);

      if (!change) {
        return;
      }

      const requestToken = gitDiffRequestTokenRef.current + 1;
      gitDiffRequestTokenRef.current = requestToken;
      selectedGitChangeRef.current = change;
      setSelectedGitChange(change);
      setGitDiffPreview(null);
      setGitDiffLoading(true);
      session.documentTabSession.activate(path);

      void options.gitDiffRead?.promise.then((diff) => {
        if (
          gitDiffRequestTokenRef.current !== requestToken ||
          selectedGitChangeRef.current !== change
        ) {
          return;
        }

        setGitDiffPreview(diff);
        setGitDiffLoading(false);
        setMessage(`Diff ${change.relativePath}`);
      });
    };

    useLayoutEffect(() => {
      if (initializedRef.current) {
        return;
      }

      initializedRef.current = true;
      const editorGroups =
        options.editorGroups ??
        createInitialEditorGroupsState("editor-main", {
          activePath: options.activePath ?? null,
          openPaths: options.openPaths ?? [],
          previewPath: options.previewPath ?? null,
        });
      session.restoreEditorSurface(workspaceRoot, {
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
        workspaceTabs: options.workspaceTabs ?? [ROOT_A, ROOT_B],
      }),
      currentWorkspaceRootRef,
      resolveCurrentWorkspaceRuntimeOwner: () => currentWorkspaceRuntimeOwnerRef.current,
      documentTabSession: session.documentTabSession,
      emptyDocumentRefreshTimeoutsRef: useRef(new Set()),
      filePrefetchCacheRef: useRef(filePrefetchCache),
      filePrefetchTimersRef: useRef(new Map()),
      forgetExternallyRemovedDocumentPath: vi.fn(),
      clearGitDiffPreviewState,
      loadGitDiffDocument,
      isGitDiffDocumentPath: (path: string) =>
        options.gitChanges?.some((change) => change.path === path) === true,
      openFileRequestTokenRef: useRef(0),
      openingFileFlagOwnerTokenRef: useRef(null),
      recordCurrentNavigationLocation,
      recordRecentFile,
      refreshLocalPhpDiagnosticsForContent: vi.fn(),
      reportError,
      reportErrorForActiveWorkspaceRoot,
      setIsOpeningFile,
      syncClosedDocument,
      syncClosedJavaScriptTypeScriptDocument,
      workspaceFiles,
      workspacePathBelongsToRoot: (path, workspaceRoot) =>
        Boolean(workspaceRoot && path.startsWith(`${workspaceRoot}/`)),
      workspaceRoot,
    } as WorkbenchDocumentTabsDependencies;

    captured.api = useWorkbenchDocumentTabs(dependencies);
    captured.currentWorkspaceRootRef = currentWorkspaceRootRef;
    captured.currentWorkspaceRuntimeOwnerRef = currentWorkspaceRuntimeOwnerRef;
    captured.gitDiffRequestTokenRef = gitDiffRequestTokenRef;
    captured.session = session;
    captured.state = {
      activePath: session.activePath,
      documents: session.documents,
      imageTabs: session.imageTabs,
      isOpeningFile,
      gitDiffLoading,
      gitDiffPreview,
      message,
      openPaths: session.openPaths,
      previewPath: session.previewPath,
      selectedGitChange,
    };
    return null;
  }

  act(() => root.render(<Harness />));

  return {
    api: () => captured.api as WorkbenchDocumentTabs,
    currentWorkspaceRootRef: () => captured.currentWorkspaceRootRef as { current: string | null },
    currentWorkspaceRuntimeOwnerRef: () =>
      captured.currentWorkspaceRuntimeOwnerRef as { current: WorkspaceRuntimeOwner | null },
    gitDiffRequestTokenRef: () => captured.gitDiffRequestTokenRef as { current: number },
    filePrefetchCache,
    mutateDocuments: (update: SetStateAction<Record<string, EditorDocument>>) =>
      act(() => {
        captured.session?.setDocuments(update);
      }),
    recordCurrentNavigationLocation,
    recordRecentFile,
    reportError,
    reportErrorForActiveWorkspaceRoot,
    replaceWorkspaceRuntimeOwner: (owner: WorkspaceRuntimeOwner | null) => {
      const ownerRef = captured.currentWorkspaceRuntimeOwnerRef;
      if (!ownerRef) {
        return;
      }

      ownerRef.current = owner;
    },
    state: () => captured.state as HarnessState,
    syncClosedDocument,
    syncClosedJavaScriptTypeScriptDocument,
    unmount: () => act(() => root.unmount()),
  };
}

describe("useWorkbenchDocumentTabs", () => {
  it("prefers an active nested workspace over an inactive parent while blocking siblings", async () => {
    const parentRoot = "/workspace";
    const nestedRoot = `${parentRoot}/nested`;
    const siblingRoot = `${parentRoot}/sibling`;
    const nestedPath = `${nestedRoot}/README.md`;
    const siblingPath = `${siblingRoot}/README.md`;
    const readText = vi.fn(async (path: string) => `content:${path}`);
    const harness = renderHarness({
      readText,
      workspaceRoot: nestedRoot,
      workspaceTabs: [parentRoot, nestedRoot, siblingRoot],
    });

    let nestedOpened = false;
    await act(async () => {
      nestedOpened = await harness.api().openFile(entry(nestedPath));
    });

    expect(nestedOpened).toBe(true);
    expect(harness.state().documents[nestedPath]?.content).toBe(`content:${nestedPath}`);

    let siblingOpened = true;
    await act(async () => {
      siblingOpened = await harness.api().openFile(entry(siblingPath));
    });

    expect(siblingOpened).toBe(false);
    expect(readText).toHaveBeenCalledOnce();
    expect(harness.state().documents[siblingPath]).toBeUndefined();
    harness.unmount();
  });

  it.each([
    ["drive casing and mixed separators", "C:\\Workspace", "c:/workspace/src/file.ts"],
    ["UNC casing and separator aliases", "\\\\Server\\Share", "//server/share/src/file.ts"],
    ["the POSIX filesystem root", "/", "/README.md"],
    ["a Windows drive root", "C:\\", "c:/README.md"],
    ["a native percent filename", "/workspace", "/workspace/%ZZ.ts"],
    ["a POSIX backslash filename", "/workspace", "/workspace/a\\..\\b.ts"],
    ["an encoded POSIX backslash filename", "/workspace", "file:///workspace/a%5C..%5Cb.ts"],
  ])("opens a path owned through %s", async (_label, workspaceRoot, filePath) => {
    const readText = vi.fn(async () => "owned content");
    const harness = renderHarness({
      readText,
      workspaceRoot,
      workspaceTabs: [workspaceRoot],
    });

    let opened = false;
    await act(async () => {
      opened = await harness.api().openFile(entry(filePath));
    });

    expect(opened).toBe(true);
    expect(readText).toHaveBeenCalledOnce();
    expect(harness.state().documents[filePath]?.content).toBe("owned content");
    harness.unmount();
  });

  it.each([
    ["a traversal alias", "/workspace/nested/../sibling/README.md"],
    ["an encoded traversal alias", "file:///workspace/nested/%2e%2e/sibling/README.md"],
    ["encoded slash traversal", "file:///workspace/nested/a%2F..%2Fsibling/README.md"],
    ["Windows backslash traversal", "C:\\workspace\\..\\outside.ts"],
    ["malformed percent encoding", "file:///workspace/nested/%ZZ/README.md"],
    ["a relative path", "nested/README.md"],
  ])("blocks %s before reading from the filesystem", async (_label, rejectedPath) => {
    const nestedRoot = "/workspace/nested";
    const readText = vi.fn(async () => "unexpected content");
    const harness = renderHarness({
      readText,
      workspaceRoot: nestedRoot,
      workspaceTabs: ["/workspace", nestedRoot, "/workspace/sibling"],
    });

    let opened = true;
    await act(async () => {
      opened = await harness.api().openFile(entry(rejectedPath));
    });

    expect(opened).toBe(false);
    expect(readText).not.toHaveBeenCalled();
    expect(harness.state().documents).toEqual({});
    harness.unmount();
  });

  it("opens a safe external path outside every workspace tab", async () => {
    const externalPath = "/external-library/definition.ts";
    const readText = vi.fn(async () => "external content");
    const harness = renderHarness({
      readText,
      workspaceRoot: "/workspace/nested",
      workspaceTabs: ["/workspace", "/workspace/nested", "/workspace/sibling"],
    });

    let opened = false;
    await act(async () => {
      opened = await harness.api().openFile(entry(externalPath), { readOnly: true });
    });

    expect(opened).toBe(true);
    expect(readText).toHaveBeenCalledOnce();
    expect(harness.state().documents[externalPath]).toMatchObject({
      content: "external content",
      readOnly: true,
    });
    harness.unmount();
  });

  describe("read-only snapshot opens", () => {
    const OUTSIDE = "/Users/me/handoffs/02-cms-slideshow.md";
    const snapshotOptions = (read: () => Promise<string | null>) => ({
      readOnlySnapshot: read,
      recordNavigation: false,
    });

    it("opens the supplied text read-only without reading the path or recording a recent file", async () => {
      const readText = vi.fn(async () => "read by path");
      const read = vi.fn(async () => "# Handoff");
      const harness = renderHarness({ readText });

      let opened = false;
      await act(async () => {
        opened = await harness.api().openFile(entry(OUTSIDE), snapshotOptions(read));
      });

      expect(opened).toBe(true);
      expect(read).toHaveBeenCalledOnce();
      expect(readText).not.toHaveBeenCalled();
      expect(harness.state().documents[OUTSIDE]).toMatchObject({
        content: "# Handoff",
        savedContent: "# Handoff",
        readOnly: true,
        revision: null,
      });
      expect(harness.state().activePath).toBe(OUTSIDE);
      expect(harness.recordRecentFile).not.toHaveBeenCalled();
      expect(harness.state().isOpeningFile).toBe(false);
      harness.unmount();
    });

    it("never re-reads an empty snapshot by path, on open or on a later activation", async () => {
      vi.useFakeTimers();
      const readText = vi.fn(async () => "grown after the bounded read");
      const reopen = vi.fn(async () => "second read");
      const harness = renderHarness({ readText });

      await act(async () => {
        await harness.api().openFile(
          entry(OUTSIDE),
          snapshotOptions(async () => ""),
        );
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      await act(async () => {
        await harness.api().openFile(entry(OUTSIDE), snapshotOptions(reopen));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      vi.useRealTimers();

      expect(readText).not.toHaveBeenCalled();
      expect(reopen).not.toHaveBeenCalled();
      expect(harness.state().documents[OUTSIDE]).toMatchObject({ content: "", readOnly: true });
      expect(harness.recordRecentFile).not.toHaveBeenCalled();
      harness.unmount();
    });

    it("keeps an empty snapshot from a later plain open of the same path that would re-read it", async () => {
      vi.useFakeTimers();
      const readText = vi.fn(async () => "changed on disk after the bounded read");
      const harness = renderHarness({ readText });

      await act(async () => {
        await harness.api().openFile(entry(OUTSIDE), {
          ...snapshotOptions(async () => ""),
          pin: true,
        });
      });
      let reopened = false;
      await act(async () => {
        reopened = await harness.api().openFile(entry(OUTSIDE));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      vi.useRealTimers();

      expect(reopened).toBe(true);
      expect(readText).not.toHaveBeenCalled();
      expect(harness.state().documents[OUTSIDE]).toMatchObject({
        content: "",
        savedContent: "",
        readOnly: true,
        readOnlySnapshot: true,
      });
      expect(harness.recordRecentFile).not.toHaveBeenCalled();
      harness.unmount();
    });

    it("does not let a refresh scheduled for an earlier empty document rewrite a snapshot", async () => {
      vi.useFakeTimers();
      const readText = vi.fn(async () => "");
      const harness = renderHarness({ readText });

      await act(async () => {
        await harness.api().openFile(entry(OUTSIDE));
      });
      harness.mutateDocuments((documents) => ({
        ...documents,
        [OUTSIDE]: { ...document(OUTSIDE, ""), readOnly: true, readOnlySnapshot: true },
      }));
      readText.mockResolvedValue("grown on disk");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      vi.useRealTimers();

      expect(harness.state().documents[OUTSIDE]).toMatchObject({ content: "", savedContent: "" });
      harness.unmount();
    });

    it("keeps a snapshot out of recent files when its tab is activated again", async () => {
      const other = `${ROOT_A}/other.ts`;
      const harness = renderHarness({ readText: async () => "other" });

      await act(async () => {
        await harness.api().openFile(entry(OUTSIDE), {
          ...snapshotOptions(async () => "# Handoff"),
          pin: true,
        });
      });
      await act(async () => {
        await harness.api().openPinnedFile(entry(other));
      });
      act(() => harness.api().activateDocument(OUTSIDE));

      expect(harness.state().activePath).toBe(OUTSIDE);
      expect(harness.recordRecentFile.mock.calls.map(([recent]) => recent.path)).toEqual([other]);

      act(() => harness.api().activateDocument(other));

      expect(harness.recordRecentFile.mock.calls.map(([recent]) => recent.path)).toEqual([
        other,
        other,
      ]);
      harness.unmount();
    });

    it("activates an already-open dirty document as it is instead of replacing or locking it", async () => {
      const path = `${ROOT_A}/packages/web/App.tsx`;
      const other = `${ROOT_A}/other.ts`;
      const read = vi.fn(async () => "content from disk");
      const harness = renderHarness({
        activePath: other,
        documents: {
          [other]: document(other, "other"),
          [path]: document(path, "unsaved edit", "saved"),
        },
        openPaths: [other, path],
      });

      let opened = false;
      await act(async () => {
        opened = await harness
          .api()
          .openFile(entry(path), { ...snapshotOptions(read), readOnly: true });
      });

      expect(opened).toBe(true);
      expect(read).not.toHaveBeenCalled();
      expect(harness.state().activePath).toBe(path);
      expect(harness.state().documents[path]).toMatchObject({
        content: "unsaved edit",
        savedContent: "saved",
      });
      expect(harness.state().documents[path]?.readOnly).toBeUndefined();
      expect(harness.recordRecentFile).not.toHaveBeenCalled();
      harness.unmount();
    });

    it("opens nothing and reports nothing when the reader declines", async () => {
      const harness = renderHarness();

      let opened = true;
      await act(async () => {
        opened = await harness.api().openFile(
          entry(OUTSIDE),
          snapshotOptions(async () => null),
        );
      });

      expect(opened).toBe(false);
      expect(harness.state().documents).toEqual({});
      expect(harness.state().isOpeningFile).toBe(false);
      expect(harness.reportError).not.toHaveBeenCalled();
      expect(harness.reportErrorForActiveWorkspaceRoot).not.toHaveBeenCalled();
      harness.unmount();
    });

    it("opens text whose name looks like an image without the image reader", async () => {
      const readImage = vi.fn(async () => ({ base64: "AAAA", byteLength: 4 }));
      const harness = renderHarness({ readImage });
      const path = "/Users/me/notes.png";

      await act(async () => {
        await harness.api().openFile(
          entry(path),
          snapshotOptions(async () => "plain text"),
        );
      });

      expect(readImage).not.toHaveBeenCalled();
      expect(harness.state().documents[path]).toMatchObject({ content: "plain text" });
      expect(harness.state().imageTabs).toEqual({});
      harness.unmount();
    });

    it("refuses a path owned by an inactive workspace tab before reading", async () => {
      const read = vi.fn(async () => "foreign");
      const harness = renderHarness();

      let opened = true;
      await act(async () => {
        opened = await harness.api().openFile(entry(`${ROOT_B}/src/a.ts`), snapshotOptions(read));
      });

      expect(opened).toBe(false);
      expect(read).not.toHaveBeenCalled();
      expect(harness.state().documents).toEqual({});
      harness.unmount();
    });

    it("drops the text after a workspace switch, an owner replacement or a newer open", async () => {
      const switched = deferred<string | null>();
      const switchHarness = renderHarness();
      const switchOpen = switchHarness.api().openFile(
        entry(OUTSIDE),
        snapshotOptions(() => switched.promise),
      );
      switchHarness.currentWorkspaceRootRef().current = ROOT_B;
      await act(async () => switched.resolve("stale"));
      await expect(switchOpen).resolves.toBe(false);
      expect(switchHarness.state().documents).toEqual({});
      switchHarness.unmount();

      const replaced = deferred<string | null>();
      const ownerHarness = renderHarness();
      const ownerOpen = ownerHarness.api().openFile(
        entry(OUTSIDE),
        snapshotOptions(() => replaced.promise),
      );
      ownerHarness.replaceWorkspaceRuntimeOwner(
        createWorkspaceRuntimeOwner("workspace-a-replacement", ROOT_A),
      );
      await act(async () => replaced.resolve("stale"));
      await expect(ownerOpen).resolves.toBe(false);
      expect(ownerHarness.state().documents).toEqual({});
      ownerHarness.unmount();

      const superseded = deferred<string | null>();
      const newerHarness = renderHarness({ readText: async () => "newer" });
      const olderOpen = newerHarness.api().openFile(
        entry(OUTSIDE),
        snapshotOptions(() => superseded.promise),
      );
      await act(async () => {
        await newerHarness.api().openFile(entry(`${ROOT_A}/newer.ts`));
      });
      await act(async () => superseded.resolve("stale"));
      await expect(olderOpen).resolves.toBe(false);
      expect(Object.keys(newerHarness.state().documents)).toEqual([`${ROOT_A}/newer.ts`]);
      newerHarness.unmount();
    });

    it("lets an exact commit guard reject same-id A1 to B to A2 before the snapshot commits", async () => {
      const read = deferred<string | null>();
      const harness = renderHarness();
      const ownerA1 = harness.currentWorkspaceRuntimeOwnerRef().current;
      const opening = harness.api().openFile(entry(OUTSIDE), {
        ...snapshotOptions(() => read.promise),
        shouldCommit: () => harness.currentWorkspaceRuntimeOwnerRef().current === ownerA1,
      });

      harness.replaceWorkspaceRuntimeOwner(createWorkspaceRuntimeOwner("workspace-b", ROOT_A));
      harness.replaceWorkspaceRuntimeOwner(createWorkspaceRuntimeOwner("workspace-a", ROOT_A));
      await act(async () => read.resolve("stale reopen"));

      await expect(opening).resolves.toBe(false);
      expect(harness.state().documents).toEqual({});
      harness.unmount();
    });
  });

  describe("agent links to files outside the thread checkout", () => {
    const OUTSIDE = "/Users/me/handoffs/02-cms-slideshow.md";

    function linkOpening(
      harness: ReturnType<typeof renderHarness>,
      file: AgentOutsideTextFile,
      isCurrent: () => boolean = () => true,
    ) {
      const readOutsideTextFile = vi.fn(async (_path: string) => file);
      const opening: AgentOutsideLinkedFileOpening = {
        outsideFiles: { readOutsideTextFile },
        directories: {},
        workspace: () => ({ root: ROOT_A, tabs: [ROOT_A, ROOT_B] }),
        isCurrent,
        open: (path) =>
          harness.api().openFile(entry(path), { recordNavigation: false, shouldCommit: isCurrent }),
        openSnapshot: (path, read) =>
          harness.api().openFile(entry(path), {
            readOnlySnapshot: read,
            recordNavigation: false,
            shouldCommit: isCurrent,
          }),
      };
      return { opening, readOutsideTextFile };
    }

    it("opens an outside file read-only from the bounded read and keeps it out of recent files", async () => {
      const readText = vi.fn(async () => "read by path");
      const harness = renderHarness({ readText });
      const link = linkOpening(harness, {
        kind: "file",
        canonicalPath: OUTSIDE,
        content: "# Handoff",
      });

      let outcome: AgentLocalFileOpenOutcome = "failed";
      await act(async () => {
        outcome = await openOutsideLinkedFile(OUTSIDE, link.opening);
      });

      expect(outcome).toBe("opened");
      expect(harness.state().documents[OUTSIDE]).toMatchObject({
        content: "# Handoff",
        readOnly: true,
      });
      expect(readText).not.toHaveBeenCalled();
      expect(harness.recordRecentFile).not.toHaveBeenCalled();
      harness.unmount();
    });

    it("keeps an open dirty workspace file editable and dirty when a link outside the thread root targets it", async () => {
      const path = `${ROOT_A}/packages/web/App.tsx`;
      const harness = renderHarness({
        activePath: path,
        documents: { [path]: document(path, "unsaved edit", "saved") },
        openPaths: [path],
      });
      const link = linkOpening(harness, { kind: "file", canonicalPath: path, content: "saved" });

      let outcome: AgentLocalFileOpenOutcome = "failed";
      await act(async () => {
        outcome = await openOutsideLinkedFile(path, link.opening);
      });

      expect(outcome).toBe("opened");
      expect(link.readOutsideTextFile).not.toHaveBeenCalled();
      expect(harness.state().documents[path]).toMatchObject({
        content: "unsaved edit",
        savedContent: "saved",
      });
      expect(harness.state().documents[path]?.readOnly).toBeUndefined();
      harness.unmount();
    });

    it("opens a not-yet-open workspace file editable through the workspace read", async () => {
      const path = `${ROOT_A}/packages/web/App.tsx`;
      const readText = vi.fn(async () => "from the workspace");
      const harness = renderHarness({ readText });
      const link = linkOpening(harness, { kind: "file", canonicalPath: path, content: "bounded" });

      await act(async () => {
        await openOutsideLinkedFile(path, link.opening);
      });

      expect(link.readOutsideTextFile).not.toHaveBeenCalled();
      expect(harness.state().documents[path]).toMatchObject({ content: "from the workspace" });
      expect(harness.state().documents[path]?.readOnly).toBeUndefined();
      harness.unmount();
    });

    it("keeps an outside document that is already open editable as it is", async () => {
      const harness = renderHarness({ readText: async () => "saved" });
      await act(async () => {
        await harness.api().openFile(entry(OUTSIDE));
      });
      harness.mutateDocuments((documents) => ({
        ...documents,
        [OUTSIDE]: document(OUTSIDE, "typed", "saved"),
      }));
      const link = linkOpening(harness, { kind: "doesNotExist" });

      let outcome: AgentLocalFileOpenOutcome = "failed";
      await act(async () => {
        outcome = await openOutsideLinkedFile(OUTSIDE, link.opening);
      });

      expect(outcome).toBe("opened");
      expect(link.readOutsideTextFile).not.toHaveBeenCalled();
      expect(harness.state().documents[OUTSIDE]).toMatchObject({ content: "typed" });
      expect(harness.state().documents[OUTSIDE]?.readOnly).toBeUndefined();
      harness.unmount();
    });

    it("opens nothing for a missing outside file and reports no workbench error", async () => {
      const harness = renderHarness();
      const link = linkOpening(harness, { kind: "doesNotExist" });

      let outcome: AgentLocalFileOpenOutcome = "opened";
      await act(async () => {
        outcome = await openOutsideLinkedFile(OUTSIDE, link.opening);
      });

      expect(outcome).toBe("doesNotExist");
      expect(harness.state().documents).toEqual({});
      expect(harness.reportError).not.toHaveBeenCalled();
      expect(harness.reportErrorForActiveWorkspaceRoot).not.toHaveBeenCalled();
      harness.unmount();
    });

    it("supersedes the open when the live workspace root flipped before the screen rerendered", async () => {
      const harness = renderHarness();
      const link = linkOpening(harness, {
        kind: "file",
        canonicalPath: OUTSIDE,
        content: "# Handoff",
      });
      link.readOutsideTextFile.mockImplementationOnce(async () => {
        harness.currentWorkspaceRootRef().current = ROOT_B;
        return { kind: "file", canonicalPath: OUTSIDE, content: "# Handoff" };
      });

      let outcome: AgentLocalFileOpenOutcome = "opened";
      await act(async () => {
        outcome = await openOutsideLinkedFile(OUTSIDE, link.opening);
      });

      expect(outcome).toBe("superseded");
      expect(harness.state().documents).toEqual({});
      harness.unmount();
    });

    it("supersedes the open after A to B to A when the click's authority no longer holds", async () => {
      const harness = renderHarness();
      const authority = { current: true };
      const link = linkOpening(
        harness,
        { kind: "file", canonicalPath: OUTSIDE, content: "# Handoff" },
        () => authority.current,
      );
      link.readOutsideTextFile.mockImplementationOnce(async () => {
        harness.currentWorkspaceRootRef().current = ROOT_B;
        harness.currentWorkspaceRootRef().current = ROOT_A;
        authority.current = false;
        return { kind: "file", canonicalPath: OUTSIDE, content: "# Handoff" };
      });

      let outcome: AgentLocalFileOpenOutcome = "opened";
      await act(async () => {
        outcome = await openOutsideLinkedFile(OUTSIDE, link.opening);
      });

      expect(outcome).toBe("superseded");
      expect(harness.state().documents).toEqual({});
      harness.unmount();
    });
  });

  it("invalidates a loading Git diff when an ordinary tab is activated", async () => {
    const diffPath = `${ROOT_A}/changed.ts`;
    const ordinaryPath = `${ROOT_A}/ordinary.ts`;
    const change = gitChange(diffPath);
    const diffRead = deferred<GitFileDiff>();
    const harness = renderHarness({
      activePath: ordinaryPath,
      documents: {
        [diffPath]: { ...document(diffPath, ""), readOnly: true },
        [ordinaryPath]: document(ordinaryPath, "ordinary"),
      },
      gitChanges: [change],
      gitDiffRead: diffRead,
      openPaths: [diffPath, ordinaryPath],
    });

    act(() => harness.api().activateDocument(diffPath));
    expect(harness.state()).toMatchObject({
      activePath: diffPath,
      gitDiffLoading: true,
      selectedGitChange: change,
    });
    const loadingRequestToken = harness.gitDiffRequestTokenRef().current;

    act(() => harness.api().activateDocument(ordinaryPath));
    expect(harness.gitDiffRequestTokenRef().current).toBe(loadingRequestToken);
    expect(harness.state()).toMatchObject({
      activePath: ordinaryPath,
      gitDiffLoading: false,
      gitDiffPreview: null,
      message: null,
      selectedGitChange: null,
    });

    await act(async () => diffRead.resolve(gitDiff(change)));
    expect(harness.state()).toMatchObject({
      activePath: ordinaryPath,
      gitDiffLoading: false,
      gitDiffPreview: null,
      message: null,
      selectedGitChange: null,
    });
    harness.unmount();
  });

  it("clears Git diff ownership before an ordinary file read finishes", async () => {
    const ordinaryPath = `${ROOT_A}/ordinary.ts`;
    const read = deferred<string>();
    const change = gitChange(`${ROOT_A}/changed.ts`);
    const harness = renderHarness({
      gitDiffLoading: true,
      message: "Loading diff",
      readText: () => read.promise,
      selectedGitChange: change,
    });
    const previousToken = harness.gitDiffRequestTokenRef().current;

    let opening!: Promise<boolean>;
    act(() => {
      opening = harness.api().openFile(entry(ordinaryPath));
    });

    expect(harness.gitDiffRequestTokenRef().current).toBe(previousToken);
    expect(harness.state()).toMatchObject({
      gitDiffLoading: false,
      gitDiffPreview: null,
      message: null,
      selectedGitChange: null,
    });

    await act(async () => read.resolve("ordinary"));
    await expect(opening).resolves.toBe(true);
    expect(harness.state().activePath).toBe(ordinaryPath);
    harness.unmount();
  });

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
    expect(harness.state().documents[prefetchedPath]?.content).toBe("prefetched");
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
      foreignOpened = await harness.api().openFile(entry(`${ROOT_B}/foreign.ts`));
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
    expect(harness.syncClosedJavaScriptTypeScriptDocument).not.toHaveBeenCalled();
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

  it("drops a first-time text read after same-path owner replacement", async () => {
    const path = `${ROOT_A}/slow.ts`;
    const read = deferred<string>();
    const harness = renderHarness({ readText: () => read.promise });
    const opening = harness.api().openFile(entry(path));

    harness.replaceWorkspaceRuntimeOwner(
      createWorkspaceRuntimeOwner("workspace-a-replacement", ROOT_A),
    );
    await act(async () => read.resolve("stale content"));
    await expect(opening).resolves.toBe(false);

    expect(harness.state().documents).toEqual({});
    harness.unmount();
  });

  it("drops a first-time image read after same-path owner replacement", async () => {
    const path = `${ROOT_A}/slow.png`;
    const read = deferred<{ base64: string; byteLength: number }>();
    const harness = renderHarness({ readImage: () => read.promise });
    const opening = harness.api().openFile(entry(path));

    harness.replaceWorkspaceRuntimeOwner(
      createWorkspaceRuntimeOwner("workspace-a-replacement", ROOT_A),
    );
    await act(async () => read.resolve({ base64: "AAAA", byteLength: 4 }));
    await expect(opening).resolves.toBe(false);

    expect(harness.state().imageTabs).toEqual({});
    harness.unmount();
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
    expect(dirtyHarness.syncClosedJavaScriptTypeScriptDocument).not.toHaveBeenCalled();
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
    expect(cleanHarness.syncClosedJavaScriptTypeScriptDocument).toHaveBeenCalledOnce();
    expect(cleanHarness.syncClosedJavaScriptTypeScriptDocument).toHaveBeenCalledWith(cleanDocument);
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
    expect(harness.syncClosedJavaScriptTypeScriptDocument).toHaveBeenCalledOnce();
    expect(harness.syncClosedJavaScriptTypeScriptDocument).toHaveBeenCalledWith(preview);
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
      expect(harness.syncClosedJavaScriptTypeScriptDocument).toHaveBeenCalledOnce();
      expect(harness.syncClosedJavaScriptTypeScriptDocument).toHaveBeenCalledWith(preview);
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
    harness.replaceWorkspaceRuntimeOwner(createWorkspaceRuntimeOwner("workspace-b", ROOT_B));
    await act(async () => read.resolve("foreign content"));
    await expect(opening).resolves.toBe(false);

    expect(harness.state().documents[path]).toMatchObject({
      content: "",
      savedContent: "",
    });
    harness.unmount();
  });

  it("drops an existing empty-document refresh after same-path owner replacement", async () => {
    const path = `${ROOT_A}/empty.ts`;
    const read = deferred<string>();
    const harness = renderHarness({
      activePath: path,
      documents: { [path]: document(path, "") },
      readText: () => read.promise,
    });
    const opening = harness.api().openFile(entry(path));

    harness.replaceWorkspaceRuntimeOwner(
      createWorkspaceRuntimeOwner("workspace-a-replacement", ROOT_A),
    );
    await act(async () => read.resolve("stale content"));
    await expect(opening).resolves.toBe(false);

    expect(harness.state().documents[path]).toMatchObject({
      content: "",
      savedContent: "",
    });
    harness.unmount();
  });

  it("lets an exact reopen predicate reject same-id A1 to B to A2 before commit", async () => {
    const path = `${ROOT_A}/reopen.ts`;
    const read = deferred<string>();
    const harness = renderHarness({ readText: () => read.promise });
    const ownerA1 = harness.currentWorkspaceRuntimeOwnerRef().current;
    const opening = harness
      .api()
      .openPinnedFile(
        entry(path),
        () => harness.currentWorkspaceRuntimeOwnerRef().current === ownerA1,
      );

    harness.replaceWorkspaceRuntimeOwner(createWorkspaceRuntimeOwner("workspace-b", ROOT_A));
    harness.replaceWorkspaceRuntimeOwner(createWorkspaceRuntimeOwner("workspace-a", ROOT_A));
    await act(async () => read.resolve("stale reopen"));
    await expect(opening).resolves.toBe(false);

    expect(harness.state().documents[path]).toBeUndefined();
    expect(harness.recordRecentFile).not.toHaveBeenCalledWith(entry(path));
    harness.unmount();
  });

  it("drops a delayed empty-document reread after same-path owner replacement", async () => {
    vi.useFakeTimers();
    const path = `${ROOT_A}/empty.ts`;
    const delayedRead = deferred<string>();
    const readText = vi
      .fn<(path: string) => Promise<string>>()
      .mockResolvedValueOnce("")
      .mockImplementationOnce(() => delayedRead.promise);
    const harness = renderHarness({ readText });

    try {
      await act(async () => {
        await harness.api().openFile(entry(path));
      });
      await act(async () => vi.advanceTimersByTime(150));
      expect(readText).toHaveBeenCalledTimes(2);

      harness.replaceWorkspaceRuntimeOwner(
        createWorkspaceRuntimeOwner("workspace-a-replacement", ROOT_A),
      );
      await act(async () => delayedRead.resolve("stale content"));

      expect(harness.state().documents[path]).toMatchObject({
        content: "",
        savedContent: "",
      });
    } finally {
      harness.unmount();
      vi.useRealTimers();
    }
  });

  it("drops a hover prefetch after owner replacement before the timer", async () => {
    vi.useFakeTimers();
    const path = `${ROOT_A}/prefetched.ts`;
    const readText = vi.fn(async () => "stale prefetched content");
    const harness = renderHarness({ readText });

    try {
      act(() => harness.api().prefetchFile(entry(path)));
      harness.replaceWorkspaceRuntimeOwner(
        createWorkspaceRuntimeOwner("workspace-a-replacement", ROOT_A),
      );
      await act(async () => vi.advanceTimersByTime(80));

      expect(readText).not.toHaveBeenCalled();
      expect(harness.filePrefetchCache.has(ROOT_A, path)).toBe(false);
    } finally {
      harness.unmount();
      vi.useRealTimers();
    }
  });

  it("drops a hover prefetch after owner replacement during the read", async () => {
    vi.useFakeTimers();
    const path = `${ROOT_A}/prefetched.ts`;
    const read = deferred<string>();
    const readText = vi.fn(() => read.promise);
    const harness = renderHarness({ readText });

    try {
      act(() => harness.api().prefetchFile(entry(path)));
      await act(async () => vi.advanceTimersByTime(80));
      expect(readText).toHaveBeenCalledOnce();

      harness.replaceWorkspaceRuntimeOwner(
        createWorkspaceRuntimeOwner("workspace-a-replacement", ROOT_A),
      );
      await act(async () => read.resolve("stale prefetched content"));

      expect(harness.filePrefetchCache.has(ROOT_A, path)).toBe(false);
    } finally {
      harness.unmount();
      vi.useRealTimers();
    }
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
      harness
        .api()
        .openReadOnlyDocument(
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
    expect(harness.syncClosedJavaScriptTypeScriptDocument).toHaveBeenCalledOnce();
    expect(harness.syncClosedJavaScriptTypeScriptDocument).toHaveBeenCalledWith(
      expect.objectContaining({ path: firstPath }),
    );
    harness.unmount();
  });

  it("lets only the owning request release the opening indicator", async () => {
    const firstRead = deferred<string>();
    const secondRead = deferred<string>();
    const firstPath = `${ROOT_A}/first.ts`;
    const secondPath = `${ROOT_A}/second.ts`;
    const harness = renderHarness({
      readText: (path) => (path === firstPath ? firstRead.promise : secondRead.promise),
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

function gitChange(path: string): GitChangedFile {
  return {
    isStaged: false,
    isUnversioned: false,
    oldPath: null,
    oldRelativePath: null,
    path,
    relativePath: path.split("/").pop() ?? path,
    status: "modified",
  };
}

function gitDiff(change: GitChangedFile): GitFileDiff {
  return {
    change,
    language: "typescript",
    modifiedContent: "modified",
    originalContent: "original",
  };
}

function revision(contentHash: number): WorkspaceFileRevision {
  return {
    contentHash: String(contentHash),
    device: "1",
    inode: "2",
    modifiedNanoseconds: 5,
    modifiedSeconds: 4,
    size: 3,
  };
}
