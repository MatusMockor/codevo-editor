// @vitest-environment jsdom

import { act, useCallback, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import type { Bookmark } from "../domain/bookmarks";
import type { BottomPanelView } from "../domain/bottomPanel";
import {
  createInitialEditorGroupsState,
  type EditorGroupsState,
} from "../domain/editorGroups";
import {
  initialIndexProgress,
  type IndexHealthLogEntry,
  type IndexProgressState,
} from "../domain/indexProgress";
import type { MarkdownPreviewTab } from "../domain/markdownPreview";
import {
  createNavigationHistory,
  type NavigationHistory,
} from "../domain/navigation";
import type { RecentFileEntry } from "../domain/recentFiles";
import type { RecentLocation } from "../domain/recentLocations";
import type {
  EditorDocument,
  FileEntry,
  ImageTab,
} from "../domain/workspace";
import type { WorkspaceIdentityDescriptor } from "../infrastructure/tauriWorkspaceIdentityGateway";
import type { SidebarView } from "./useWorkbenchController";
import {
  useWorkspaceStateCache,
  type WorkspaceStateCache,
} from "./useWorkspaceStateCache";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT_A = "/workspace-a";
const ROOT_B = "/workspace-b";

function editorDocument(path: string): EditorDocument {
  return {
    content: `content of ${path}`,
    language: "plaintext",
    name: path.split("/").pop() ?? path,
    path,
    savedContent: `content of ${path}`,
  };
}

const DOC_A = editorDocument(`${ROOT_A}/src/a.ts`);
const DOC_B = editorDocument(`${ROOT_B}/src/b.ts`);
const GIT_DIFF_DOC = editorDocument(`mockor-git-diff:worktree:${ROOT_A}/src/a.ts`);

const BOOKMARK_A: Bookmark = {
  lineNumber: 3,
  path: DOC_A.path,
  preview: "const a = 1;",
};

const IMAGE_TAB_A: ImageTab = {
  byteLength: 4,
  dataUrl: "data:image/png;base64,AAAA",
  name: "logo.png",
  path: `${ROOT_A}/logo.png`,
};

interface HarnessStateView {
  bookmarks: Bookmark[];
  bottomPanelVisible: boolean;
  documents: Record<string, EditorDocument>;
  editorGroups: EditorGroupsState;
  expandedDirectories: Set<string>;
  imageTabs: Record<string, ImageTab>;
  indexProgress: IndexProgressState;
  markdownPreviewTabs: Record<string, MarkdownPreviewTab>;
  sidebarView: SidebarView;
  workspaceIdentityDescriptor: WorkspaceIdentityDescriptor | null;
}

interface HarnessSetters {
  setActivePath: (path: string | null) => void;
  setBookmarks: (bookmarks: Bookmark[]) => void;
  setBottomPanelVisible: (visible: boolean) => void;
  setDocuments: (documents: Record<string, EditorDocument>) => void;
  setEditorGroups: (groups: EditorGroupsState) => void;
  setExpandedDirectories: (directories: Set<string>) => void;
  setImageTabs: (imageTabs: Record<string, ImageTab>) => void;
  setIndexProgress: (progress: IndexProgressState) => void;
  setOpenPaths: (paths: string[]) => void;
  setSidebarView: (view: SidebarView) => void;
}

interface HarnessRefs {
  imageTabsRef: { current: Record<string, ImageTab> };
  markdownPreviewTabsRef: { current: Record<string, MarkdownPreviewTab> };
}

function renderWorkspaceStateCacheHarness() {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: {
    api: WorkspaceStateCache | null;
    refs: HarnessRefs | null;
    setters: HarnessSetters | null;
    state: HarnessStateView | null;
  } = { api: null, refs: null, setters: null, state: null };

  function Harness() {
    const [activePath, setActivePath] = useState<string | null>(null);
    const [openPaths, setOpenPaths] = useState<string[]>([]);
    const [previewPath] = useState<string | null>(null);
    const [documents, setDocuments] = useState<Record<string, EditorDocument>>(
      {},
    );
    const [imageTabs, setImageTabs] = useState<Record<string, ImageTab>>({});
    const [markdownPreviewTabs, setMarkdownPreviewTabs] = useState<
      Record<string, MarkdownPreviewTab>
    >({});
    const [editorGroups, setEditorGroups] = useState<EditorGroupsState>(() =>
      createInitialEditorGroupsState("editor-main"),
    );
    const updateEditorGroups = useCallback(
      (update: (current: EditorGroupsState) => EditorGroupsState) => {
        setEditorGroups((current) => update(current));
      },
      [],
    );
    const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
    const [bottomPanelView, setBottomPanelView] =
      useState<BottomPanelView>("problems");
    const [bottomPanelVisible, setBottomPanelVisible] = useState(false);
    const [entriesByDirectory, setEntriesByDirectory] = useState<
      Record<string, FileEntry[]>
    >({});
    const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(
      new Set(),
    );
    const [manuallyCollapsedDirectories, setManuallyCollapsedDirectories] =
      useState<Set<string>>(new Set());
    const [indexProgress, setIndexProgress] = useState<IndexProgressState>(
      initialIndexProgress,
    );
    const [indexHealthLogs, setIndexHealthLogs] = useState<
      IndexHealthLogEntry[]
    >([]);
    const restoreCachedIndexState = useCallback(
      (progress: IndexProgressState, logs: IndexHealthLogEntry[]) => {
        setIndexProgress(progress);
        setIndexHealthLogs(logs);
      },
      [],
    );
    const [navigationHistory, setNavigationHistory] =
      useState<NavigationHistory>(createNavigationHistory);
    const restoreHistory = useCallback(
      (history: NavigationHistory) => setNavigationHistory(history),
      [],
    );
    const [recentFiles, setRecentFiles] = useState<RecentFileEntry[]>([]);
    const [recentLocations, setRecentLocations] = useState<RecentLocation[]>(
      [],
    );
    const [sidebarView, setSidebarView] = useState<SidebarView>("files");
    const [workspaceIdentityDescriptor, setWorkspaceIdentityDescriptor] =
      useState<WorkspaceIdentityDescriptor | null>(null);
    const imageTabsRef = useRef<Record<string, ImageTab>>({});
    const markdownPreviewTabsRef = useRef<Record<string, MarkdownPreviewTab>>(
      {},
    );

    captured.api = useWorkspaceStateCache({
      activePath,
      bookmarks,
      bottomPanelView,
      bottomPanelVisible,
      documents,
      editorGroups,
      entriesByDirectory,
      expandedDirectories,
      imageTabs,
      imageTabsRef,
      indexHealthLogs,
      indexProgress,
      manuallyCollapsedDirectories,
      markdownPreviewTabs,
      markdownPreviewTabsRef,
      navigationHistory,
      openPaths,
      previewPath,
      recentFiles,
      recentLocations,
      restoreCachedIndexState,
      restoreHistory,
      setBookmarks,
      setBottomPanelView,
      setBottomPanelVisible,
      setDocuments,
      setEntriesByDirectory,
      setExpandedDirectories,
      setImageTabs,
      setManuallyCollapsedDirectories,
      setMarkdownPreviewTabs,
      setRecentFiles,
      setRecentLocations,
      setSidebarView,
      setWorkspaceIdentityDescriptor,
      sidebarView,
      updateEditorGroups,
      workspaceIdentityDescriptor,
    });
    captured.refs = { imageTabsRef, markdownPreviewTabsRef };
    captured.setters = {
      setActivePath,
      setBookmarks,
      setBottomPanelVisible,
      setDocuments,
      setEditorGroups,
      setExpandedDirectories,
      setImageTabs,
      setIndexProgress,
      setOpenPaths,
      setSidebarView,
    };
    captured.state = {
      bookmarks,
      bottomPanelVisible,
      documents,
      editorGroups,
      expandedDirectories,
      imageTabs,
      indexProgress,
      markdownPreviewTabs,
      sidebarView,
      workspaceIdentityDescriptor,
    };
    return null;
  }

  act(() => {
    root.render(<Harness />);
  });

  return {
    api: () => {
      expect(captured.api).not.toBeNull();

      return captured.api as WorkspaceStateCache;
    },
    refs: () => {
      expect(captured.refs).not.toBeNull();

      return captured.refs as HarnessRefs;
    },
    setters: () => {
      expect(captured.setters).not.toBeNull();

      return captured.setters as HarnessSetters;
    },
    state: () => {
      expect(captured.state).not.toBeNull();

      return captured.state as HarnessStateView;
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

function seedWorkspaceA(harness: ReturnType<typeof renderWorkspaceStateCacheHarness>) {
  act(() => {
    harness.setters().setDocuments({ [DOC_A.path]: DOC_A });
    harness.setters().setOpenPaths([DOC_A.path]);
    harness.setters().setActivePath(DOC_A.path);
    harness.setters().setImageTabs({ [IMAGE_TAB_A.path]: IMAGE_TAB_A });
    harness.setters().setEditorGroups(
      createInitialEditorGroupsState("editor-main", {
        activePath: DOC_A.path,
        openPaths: [DOC_A.path, IMAGE_TAB_A.path],
        previewPath: null,
      }),
    );
    harness.setters().setSidebarView("git");
    harness.setters().setBottomPanelVisible(true);
    harness.setters().setBookmarks([BOOKMARK_A]);
    harness.setters().setExpandedDirectories(new Set([`${ROOT_A}/src`]));
    harness.setters().setIndexProgress({
      ...initialIndexProgress(),
      rootPath: ROOT_A,
      status: "completed",
    });
  });
}

function seedWorkspaceB(harness: ReturnType<typeof renderWorkspaceStateCacheHarness>) {
  act(() => {
    harness.setters().setDocuments({ [DOC_B.path]: DOC_B });
    harness.setters().setOpenPaths([DOC_B.path]);
    harness.setters().setActivePath(DOC_B.path);
    harness.setters().setImageTabs({});
    harness.setters().setEditorGroups(
      createInitialEditorGroupsState("editor-main", {
        activePath: DOC_B.path,
        openPaths: [DOC_B.path],
        previewPath: null,
      }),
    );
    harness.setters().setSidebarView("files");
    harness.setters().setBottomPanelVisible(false);
    harness.setters().setBookmarks([]);
    harness.setters().setExpandedDirectories(new Set([`${ROOT_B}/src`]));
    harness.setters().setIndexProgress({
      ...initialIndexProgress(),
      rootPath: ROOT_B,
      status: "scanning",
    });
  });
}

describe("useWorkspaceStateCache", () => {
  it("round-trips cached workspace state per root without leaking between roots", () => {
    const harness = renderWorkspaceStateCacheHarness();

    seedWorkspaceA(harness);
    harness.api().cacheCurrentWorkspaceState(ROOT_A);

    seedWorkspaceB(harness);
    harness.api().cacheCurrentWorkspaceState(ROOT_B);

    const cachedA = harness.api().workspaceStateCacheRef.current[ROOT_A];
    expect(cachedA).toBeDefined();

    act(() => {
      harness.api().restoreCachedWorkspaceState(cachedA);
    });

    expect(Object.keys(harness.state().documents)).toEqual([DOC_A.path]);
    expect(harness.state().imageTabs).toEqual({
      [IMAGE_TAB_A.path]: IMAGE_TAB_A,
    });
    expect(harness.refs().imageTabsRef.current).toEqual({
      [IMAGE_TAB_A.path]: IMAGE_TAB_A,
    });
    expect(harness.state().sidebarView).toBe("git");
    expect(harness.state().bottomPanelVisible).toBe(true);
    expect(harness.state().bookmarks).toEqual([BOOKMARK_A]);
    expect(harness.state().expandedDirectories).toEqual(
      new Set([`${ROOT_A}/src`]),
    );
    expect(harness.state().indexProgress.rootPath).toBe(ROOT_A);
    expect(harness.state().indexProgress.status).toBe("completed");
    expect(
      harness.state().editorGroups.groups["editor-main"].activePath,
    ).toBe(DOC_A.path);
    expect(
      harness.state().editorGroups.groups["editor-main"].openPaths,
    ).toEqual([DOC_A.path, IMAGE_TAB_A.path]);

    const cachedB = harness.api().workspaceStateCacheRef.current[ROOT_B];
    expect(Object.keys(cachedB.editorSurface.documents)).toEqual([DOC_B.path]);
    expect(cachedB.indexProgress.rootPath).toBe(ROOT_B);
    harness.unmount();
  });

  it("caches a defensive copy of directory expansion sets", () => {
    const harness = renderWorkspaceStateCacheHarness();

    seedWorkspaceA(harness);
    harness.api().cacheCurrentWorkspaceState(ROOT_A);

    const cached = harness.api().workspaceStateCacheRef.current[ROOT_A];
    expect(cached.expandedDirectories).toEqual(new Set([`${ROOT_A}/src`]));
    expect(cached.expandedDirectories).not.toBe(
      harness.state().expandedDirectories,
    );
    harness.unmount();
  });

  it("drops non-persistable editor tabs from the cached snapshot", () => {
    const harness = renderWorkspaceStateCacheHarness();

    act(() => {
      harness.setters().setDocuments({
        [DOC_A.path]: DOC_A,
        [GIT_DIFF_DOC.path]: GIT_DIFF_DOC,
      });
      harness.setters().setOpenPaths([DOC_A.path, GIT_DIFF_DOC.path]);
      harness.setters().setActivePath(GIT_DIFF_DOC.path);
    });
    harness.api().cacheCurrentWorkspaceState(ROOT_A);

    const cached = harness.api().workspaceStateCacheRef.current[ROOT_A];
    expect(Object.keys(cached.editorSurface.documents)).toEqual([DOC_A.path]);
    expect(cached.editorSurface.openPaths).toEqual([DOC_A.path]);
    expect(cached.editorSurface.activePath).toBeNull();
    harness.unmount();
  });

  it("clears every cached root while keeping the ref identity stable", () => {
    const harness = renderWorkspaceStateCacheHarness();
    const cacheRef = harness.api().workspaceStateCacheRef;

    seedWorkspaceA(harness);
    harness.api().cacheCurrentWorkspaceState(ROOT_A);
    harness.api().cacheCurrentWorkspaceState(ROOT_B);

    expect(harness.api().workspaceStateCacheRef).toBe(cacheRef);
    expect(Object.keys(cacheRef.current).sort()).toEqual([ROOT_A, ROOT_B]);

    harness.api().clearWorkspaceStateCache();

    expect(cacheRef.current).toEqual({});
    expect(harness.api().workspaceStateCacheRef).toBe(cacheRef);
    harness.unmount();
  });
});
