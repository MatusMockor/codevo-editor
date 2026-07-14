// @vitest-environment jsdom

import { act, useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import type { Bookmark } from "../domain/bookmarks";
import type { BottomPanelView } from "../domain/bottomPanel";
import {
  createInitialEditorGroupsState,
  editorGroupsReducer,
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
  useEditorSessionState,
  type EditorSessionState,
} from "./useEditorSessionState";
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
const DOC_A_SECOND = editorDocument(`${ROOT_A}/src/second.ts`);
const DOC_B = editorDocument(`${ROOT_B}/src/b.ts`);
const GIT_DIFF_DOC = editorDocument(`mockor-git-diff:worktree:${ROOT_A}/src/a.ts`);

const DIRTY_DOC_A: EditorDocument = {
  ...DOC_A,
  content: "const changedWithoutSaving = true;",
};

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

const IMAGE_TAB_B: ImageTab = {
  ...IMAGE_TAB_A,
  name: "foreign.png",
  path: `${ROOT_B}/foreign.png`,
};

const MARKDOWN_PREVIEW_A: MarkdownPreviewTab = {
  content: "# Workspace A",
  html: "<h1>Workspace A</h1>",
  name: "README.md Preview",
  path: `markdown-preview://${ROOT_A}/README.md`,
  sourcePath: `${ROOT_A}/README.md`,
};

const MARKDOWN_PREVIEW_B: MarkdownPreviewTab = {
  content: "# Workspace B",
  html: "<h1>Workspace B</h1>",
  name: "README.md Preview",
  path: `markdown-preview://${ROOT_B}/README.md`,
  sourcePath: `${ROOT_B}/README.md`,
};

interface HarnessStateView {
  bookmarks: Bookmark[];
  bottomPanelVisible: boolean;
  expandedDirectories: Set<string>;
  indexProgress: IndexProgressState;
  sidebarView: SidebarView;
  workspaceIdentityDescriptor: WorkspaceIdentityDescriptor | null;
}

interface HarnessSetters {
  setBookmarks: (bookmarks: Bookmark[]) => void;
  setBottomPanelVisible: (visible: boolean) => void;
  setExpandedDirectories: (directories: Set<string>) => void;
  setIndexProgress: (progress: IndexProgressState) => void;
  setSidebarView: (view: SidebarView) => void;
}

function renderWorkspaceStateCacheHarness() {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: {
    api: WorkspaceStateCache | null;
    session: EditorSessionState | null;
    setters: HarnessSetters | null;
    state: HarnessStateView | null;
  } = { api: null, session: null, setters: null, state: null };

  function Harness() {
    const editorSession = useEditorSessionState();
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
    captured.api = useWorkspaceStateCache({
      bookmarks,
      bottomPanelView,
      bottomPanelVisible,
      entriesByDirectory,
      expandedDirectories,
      indexHealthLogs,
      indexProgress,
      manuallyCollapsedDirectories,
      navigationHistory,
      recentFiles,
      recentLocations,
      restoreCachedIndexState,
      restoreEditorSurface: editorSession.restoreEditorSurface,
      restoreHistory,
      setBookmarks,
      setBottomPanelView,
      setBottomPanelVisible,
      setEntriesByDirectory,
      setExpandedDirectories,
      setManuallyCollapsedDirectories,
      setRecentFiles,
      setRecentLocations,
      setSidebarView,
      setWorkspaceIdentityDescriptor,
      sidebarView,
      snapshotEditorSurface: editorSession.snapshotEditorSurface,
      workspaceIdentityDescriptor,
    });
    captured.session = editorSession;
    captured.setters = {
      setBookmarks,
      setBottomPanelVisible,
      setExpandedDirectories,
      setIndexProgress,
      setSidebarView,
    };
    captured.state = {
      bookmarks,
      bottomPanelVisible,
      expandedDirectories,
      indexProgress,
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
    session: () => {
      expect(captured.session).not.toBeNull();

      return captured.session as EditorSessionState;
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
    harness.session().setDocuments({ [DOC_A.path]: DOC_A });
    harness.session().setImageTabs({ [IMAGE_TAB_A.path]: IMAGE_TAB_A });
    harness.session().updateEditorGroups(() =>
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
    harness.session().setDocuments({ [DOC_B.path]: DOC_B });
    harness.session().setImageTabs({});
    harness.session().updateEditorGroups(() =>
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
      harness.api().restoreCachedWorkspaceState(ROOT_A, cachedA);
    });

    expect(Object.keys(harness.session().documents)).toEqual([DOC_A.path]);
    expect(harness.session().imageTabs).toEqual({
      [IMAGE_TAB_A.path]: IMAGE_TAB_A,
    });
    expect(harness.session().imageTabsRef.current).toEqual({
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
      harness.session().editorGroups.groups["editor-main"].activePath,
    ).toBe(DOC_A.path);
    expect(
      harness.session().editorGroups.groups["editor-main"].openPaths,
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

  it("round-trips same-tick editor updates through the session snapshot ports", () => {
    const harness = renderWorkspaceStateCacheHarness();
    let groups = createInitialEditorGroupsState("editor-main", {
      activePath: DOC_A_SECOND.path,
      openPaths: [DOC_A_SECOND.path],
      previewPath: null,
    });
    groups = editorGroupsReducer(groups, {
      direction: "right",
      newGroupId: "editor-1",
      type: "split-group",
    });
    groups = {
      ...groups,
      groups: {
        ...groups.groups,
        "editor-1": {
          activePath: DIRTY_DOC_A.path,
          openPaths: [DIRTY_DOC_A.path, IMAGE_TAB_A.path],
          previewPath: MARKDOWN_PREVIEW_A.path,
        },
      },
    };

    act(() => {
      const session = harness.session();
      session.setDocuments({
        [DIRTY_DOC_A.path]: DIRTY_DOC_A,
        [DOC_A_SECOND.path]: DOC_A_SECOND,
      });
      session.setImageTabs({ [IMAGE_TAB_A.path]: IMAGE_TAB_A });
      session.setMarkdownPreviewTabs({
        [MARKDOWN_PREVIEW_A.path]: MARKDOWN_PREVIEW_A,
      });
      session.updateEditorGroups(() => groups);
      harness.api().cacheCurrentWorkspaceState(ROOT_A);
    });

    const cached = harness.api().workspaceStateCacheRef.current[ROOT_A];
    expect(cached.editorSurface.documents[DIRTY_DOC_A.path]).toEqual(
      DIRTY_DOC_A,
    );
    expect(cached.editorSurface.editorGroups?.activeGroupId).toBe("editor-1");

    act(() => {
      const session = harness.session();
      session.resetEditorSurfaceState();
      harness.api().restoreCachedWorkspaceState(ROOT_A, cached);

      expect(session.documentsRef.current[DIRTY_DOC_A.path]).toEqual(
        DIRTY_DOC_A,
      );
      expect(session.imageTabsRef.current[IMAGE_TAB_A.path]).toEqual(
        IMAGE_TAB_A,
      );
      expect(
        session.markdownPreviewTabsRef.current[MARKDOWN_PREVIEW_A.path],
      ).toEqual(MARKDOWN_PREVIEW_A);
      expect(session.editorGroupsRef.current).toEqual(groups);
      expect(session.openPathsRef.current).toEqual([
        DIRTY_DOC_A.path,
        IMAGE_TAB_A.path,
      ]);
      expect(session.previewPathRef.current).toBe(MARKDOWN_PREVIEW_A.path);
      expect(session.activeDocumentRef.current).toEqual(DIRTY_DOC_A);
    });

    const restored = harness.session();
    expect(restored.documents[DIRTY_DOC_A.path].content).not.toBe(
      restored.documents[DIRTY_DOC_A.path].savedContent,
    );
    expect(restored.activeGroupId).toBe("editor-1");
    expect(restored.activePath).toBe(DIRTY_DOC_A.path);
    expect(restored.previewPath).toBe(MARKDOWN_PREVIEW_A.path);
    expect(restored.markdownPreviewTabs[MARKDOWN_PREVIEW_A.path]).toEqual(
      MARKDOWN_PREVIEW_A,
    );
    harness.unmount();
  });

  it("never caches or restores editor surface state from another root", () => {
    const harness = renderWorkspaceStateCacheHarness();
    let groups = createInitialEditorGroupsState("editor-main", {
      activePath: DOC_B.path,
      openPaths: [DOC_A.path, DOC_B.path, GIT_DIFF_DOC.path],
      previewPath: MARKDOWN_PREVIEW_B.path,
    });
    groups = editorGroupsReducer(groups, {
      direction: "right",
      newGroupId: "editor-1",
      type: "split-group",
    });
    groups = {
      ...groups,
      activeGroupId: "editor-1",
      groups: {
        ...groups.groups,
        "editor-1": {
          activePath: MARKDOWN_PREVIEW_A.path,
          openPaths: [IMAGE_TAB_A.path, IMAGE_TAB_B.path],
          previewPath: MARKDOWN_PREVIEW_A.path,
        },
      },
    };

    act(() => {
      const session = harness.session();
      session.setDocuments({
        [DOC_A.path]: DOC_A,
        [DOC_B.path]: DOC_B,
        [GIT_DIFF_DOC.path]: GIT_DIFF_DOC,
      });
      session.setImageTabs({
        [IMAGE_TAB_A.path]: IMAGE_TAB_A,
        [IMAGE_TAB_B.path]: IMAGE_TAB_B,
      });
      session.setMarkdownPreviewTabs({
        [MARKDOWN_PREVIEW_A.path]: MARKDOWN_PREVIEW_A,
        [MARKDOWN_PREVIEW_B.path]: MARKDOWN_PREVIEW_B,
      });
      session.updateEditorGroups(() => groups);
      harness.api().cacheCurrentWorkspaceState(ROOT_A);
    });

    const cached = harness.api().workspaceStateCacheRef.current[ROOT_A];
    expect(Object.keys(cached.editorSurface.documents)).toEqual([DOC_A.path]);
    expect(cached.editorSurface.imageTabs).toEqual({
      [IMAGE_TAB_A.path]: IMAGE_TAB_A,
    });
    expect(cached.editorSurface.markdownPreviewTabs).toEqual({
      [MARKDOWN_PREVIEW_A.path]: MARKDOWN_PREVIEW_A,
    });
    expect(cached.editorSurface.editorGroups?.groups["editor-main"]).toEqual({
      activePath: DOC_A.path,
      openPaths: [DOC_A.path],
      previewPath: null,
    });
    expect(cached.editorSurface.editorGroups?.groups["editor-1"]).toEqual({
      activePath: MARKDOWN_PREVIEW_A.path,
      openPaths: [IMAGE_TAB_A.path],
      previewPath: MARKDOWN_PREVIEW_A.path,
    });
    expect(cached.editorSurface.activePath).toBe(MARKDOWN_PREVIEW_A.path);
    expect(cached.editorSurface.openPaths).toEqual([IMAGE_TAB_A.path]);
    expect(cached.editorSurface.previewPath).toBe(MARKDOWN_PREVIEW_A.path);

    act(() => {
      harness.session().resetEditorSurfaceState();
      harness.api().restoreCachedWorkspaceState(ROOT_A, cached);
    });

    const restored = harness.session();
    expect(Object.keys(restored.documents)).toEqual([DOC_A.path]);
    expect(Object.keys(restored.imageTabs)).toEqual([IMAGE_TAB_A.path]);
    expect(Object.keys(restored.markdownPreviewTabs)).toEqual([
      MARKDOWN_PREVIEW_A.path,
    ]);
    expect(restored.editorGroups).toEqual(cached.editorSurface.editorGroups);
    expect(restored.activeGroupId).toBe("editor-1");
    expect(restored.activePath).toBe(MARKDOWN_PREVIEW_A.path);
    expect(restored.openPaths).toEqual([IMAGE_TAB_A.path]);
    expect(restored.previewPath).toBe(MARKDOWN_PREVIEW_A.path);
    harness.unmount();
  });

  it("drops non-persistable editor tabs from the cached snapshot", () => {
    const harness = renderWorkspaceStateCacheHarness();

    act(() => {
      harness.session().setDocuments({
        [DOC_A.path]: DOC_A,
        [GIT_DIFF_DOC.path]: GIT_DIFF_DOC,
      });
      harness.session().setOpenPaths([DOC_A.path, GIT_DIFF_DOC.path]);
      harness.session().setActivePath(GIT_DIFF_DOC.path);
    });
    harness.api().cacheCurrentWorkspaceState(ROOT_A);

    const cached = harness.api().workspaceStateCacheRef.current[ROOT_A];
    expect(Object.keys(cached.editorSurface.documents)).toEqual([DOC_A.path]);
    expect(cached.editorSurface.openPaths).toEqual([DOC_A.path]);
    expect(cached.editorSurface.activePath).toBe(DOC_A.path);
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
