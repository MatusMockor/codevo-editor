// @vitest-environment jsdom

import { act, useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { Bookmark } from "../domain/bookmarks";
import type { Breakpoint } from "../domain/debug";
import type { BottomPanelView } from "../domain/bottomPanel";
import { createInitialEditorGroupsState, editorGroupsReducer } from "../domain/editorGroups";
import {
  initialIndexProgress,
  type IndexHealthLogEntry,
  type IndexProgressState,
} from "../domain/indexProgress";
import type { MarkdownPreviewTab } from "../domain/markdownPreview";
import { createNavigationHistory, type NavigationHistory } from "../domain/navigation";
import type { RecentFileEntry } from "../domain/recentFiles";
import type { RecentLocation } from "../domain/recentLocations";
import {
  normalizeWorkspaceSession,
  normalizeWorkspaceSessionNavigation,
  type WorkspaceSessionNavigation,
} from "../domain/settings";
import type { EditorDocument, FileEntry, ImageTab } from "../domain/workspace";
import type { WorkspaceIdentityDescriptor } from "../infrastructure/tauriWorkspaceIdentityGateway";
import type { SidebarView } from "./useWorkbenchController";
import { useEditorSessionState, type EditorSessionState } from "./useEditorSessionState";
import {
  useWorkspaceStateCache,
  workspaceIdentityStateCacheKey,
  type CachedWorkspaceWorkbenchState,
  type WorkspaceStateCache,
} from "./useWorkspaceStateCache";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT_A = "/workspace-a";
const ROOT_B = "/workspace-b";
const CANONICAL_ROOT_A = "/real/workspace-a";

function workspaceIdentity(
  selectedPath = ROOT_A,
  canonicalRoot = CANONICAL_ROOT_A,
  workspaceId = "workspace-a-id",
): WorkspaceIdentityDescriptor {
  return {
    workspaceId,
    selectedPath,
    canonicalRoot,
    caseSensitive: true,
    unicodeNormalizationPolicy: "preserved",
    policy: { caseSensitive: true, unicodeNormalization: "none" },
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

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
  bottomPanelView: BottomPanelView;
  bottomPanelVisible: boolean;
  debugBreakpoints: Breakpoint[];
  expandedDirectories: Set<string>;
  indexProgress: IndexProgressState;
  navigationHistory: NavigationHistory;
  recentFiles: RecentFileEntry[];
  recentLocations: RecentLocation[];
  sidebarView: SidebarView;
  workspaceIdentityDescriptor: WorkspaceIdentityDescriptor | null;
}

interface HarnessSetters {
  setBookmarks: (bookmarks: Bookmark[]) => void;
  setBottomPanelView: (view: BottomPanelView) => void;
  setBottomPanelVisible: (visible: boolean) => void;
  setDebugBreakpoints: (breakpoints: Breakpoint[]) => void;
  setExpandedDirectories: (directories: Set<string>) => void;
  setIndexProgress: (progress: IndexProgressState) => void;
  setNavigationHistory: (history: NavigationHistory) => void;
  setRecentFiles: (files: RecentFileEntry[]) => void;
  setRecentLocations: (locations: RecentLocation[]) => void;
  setSidebarView: (view: SidebarView) => void;
  setWorkspaceIdentityDescriptor: (descriptor: WorkspaceIdentityDescriptor | null) => void;
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
    const [debugBreakpoints, setDebugBreakpoints] = useState<Breakpoint[]>([]);
    const restoreBreakpoints = useCallback(
      (breakpoints: Breakpoint[]) => setDebugBreakpoints(breakpoints),
      [],
    );
    const [bottomPanelView, setBottomPanelView] = useState<BottomPanelView>("problems");
    const [bottomPanelVisible, setBottomPanelVisible] = useState(false);
    const [entriesByDirectory, setEntriesByDirectory] = useState<Record<string, FileEntry[]>>({});
    const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(new Set());
    const [manuallyCollapsedDirectories, setManuallyCollapsedDirectories] = useState<Set<string>>(
      new Set(),
    );
    const [indexProgress, setIndexProgress] = useState<IndexProgressState>(initialIndexProgress);
    const [indexHealthLogs, setIndexHealthLogs] = useState<IndexHealthLogEntry[]>([]);
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
    const [recentLocations, setRecentLocations] = useState<RecentLocation[]>([]);
    const [sidebarView, setSidebarView] = useState<SidebarView>("files");
    const [workspaceIdentityDescriptor, setWorkspaceIdentityDescriptor] =
      useState<WorkspaceIdentityDescriptor | null>(null);
    captured.api = useWorkspaceStateCache({
      bookmarks,
      bottomPanelView,
      bottomPanelVisible,
      breakpoints: debugBreakpoints,
      entriesByDirectory,
      expandedDirectories,
      indexHealthLogs,
      indexProgress,
      manuallyCollapsedDirectories,
      navigationHistory,
      recentFiles,
      recentLocations,
      restoreBreakpoints,
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
      setBottomPanelView,
      setBottomPanelVisible,
      setDebugBreakpoints,
      setExpandedDirectories,
      setIndexProgress,
      setNavigationHistory,
      setRecentFiles,
      setRecentLocations,
      setSidebarView,
      setWorkspaceIdentityDescriptor,
    };
    captured.state = {
      bookmarks,
      bottomPanelView,
      bottomPanelVisible,
      debugBreakpoints,
      expandedDirectories,
      indexProgress,
      navigationHistory,
      recentFiles,
      recentLocations,
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
  it("does not restore a cached Search tab across an A to B to A switch", () => {
    const harness = renderWorkspaceStateCacheHarness();

    act(() => {
      harness.setters().setBottomPanelView("search");
      harness.setters().setBottomPanelVisible(true);
    });
    harness.api().cacheCurrentWorkspaceState(ROOT_A);

    const cached = harness.api().resolveCachedWorkspaceState(ROOT_A);
    expect(cached?.bottomPanelView).toBe("problems");
    expect(cached?.bottomPanelVisible).toBe(false);

    act(() => {
      harness.setters().setBottomPanelView("terminal");
      harness.setters().setBottomPanelVisible(true);
    });
    harness.api().cacheCurrentWorkspaceState(ROOT_B);
    act(() => {
      harness.api().restoreCachedWorkspaceState(ROOT_A, cached as CachedWorkspaceWorkbenchState);
    });

    expect(harness.state().bottomPanelView).toBe("problems");
    expect(harness.state().bottomPanelVisible).toBe(false);

    act(() => {
      harness.api().restoreCachedWorkspaceState(ROOT_A, {
        ...(cached as CachedWorkspaceWorkbenchState),
        bottomPanelView: "search",
        bottomPanelVisible: true,
      });
    });

    expect(harness.state().bottomPanelView).toBe("problems");
    expect(harness.state().bottomPanelVisible).toBe(false);
    harness.unmount();
  });

  it("reuses one full navigation snapshot across simulated keystrokes", () => {
    const harness = renderWorkspaceStateCacheHarness();
    const navigationHistory: NavigationHistory = {
      backStack: Array.from({ length: 100 }, (_, index) => ({
        path: `${ROOT_A}/back-${index}.ts`,
        position: { column: 1, lineNumber: index + 1 },
      })),
      forwardStack: Array.from({ length: 100 }, (_, index) => ({
        path: `${ROOT_A}/forward-${index}.ts`,
        position: { column: 1, lineNumber: index + 1 },
      })),
    };
    const recentFiles = Array.from({ length: 50 }, (_, index) => ({
      name: `file-${index}.ts`,
      path: `${ROOT_A}/file-${index}.ts`,
    }));
    const recentLocations = Array.from({ length: 50 }, (_, index) => ({
      column: 1,
      line: index + 1,
      name: `file-${index}.ts`,
      path: `${ROOT_A}/file-${index}.ts`,
      relativePath: `file-${index}.ts`,
      snippet: `line ${index + 1}`,
    }));
    act(() => {
      harness.setters().setNavigationHistory(navigationHistory);
      harness.setters().setRecentFiles(recentFiles);
      harness.setters().setRecentLocations(recentLocations);
    });
    const baseline = normalizeWorkspaceSession({});
    const encode = vi.spyOn(TextEncoder.prototype, "encode");
    const legacyCandidate: WorkspaceSessionNavigation = {
      backStack: navigationHistory.backStack,
      forwardStack: navigationHistory.forwardStack,
      recentFiles,
      recentLocations,
    };
    for (const entry of legacyCandidate.backStack) {
      normalizeWorkspaceSessionNavigation({
        backStack: [entry],
        forwardStack: [],
        recentFiles: [],
        recentLocations: [],
      });
    }
    for (const entry of legacyCandidate.forwardStack) {
      normalizeWorkspaceSessionNavigation({
        backStack: [],
        forwardStack: [entry],
        recentFiles: [],
        recentLocations: [],
      });
    }
    for (const entry of legacyCandidate.recentFiles) {
      normalizeWorkspaceSessionNavigation({
        backStack: [],
        forwardStack: [],
        recentFiles: [entry],
        recentLocations: [],
      });
    }
    for (const entry of legacyCandidate.recentLocations) {
      normalizeWorkspaceSessionNavigation({
        backStack: [],
        forwardStack: [],
        recentFiles: [],
        recentLocations: [entry],
      });
    }
    new TextEncoder().encode(JSON.stringify(legacyCandidate));
    normalizeWorkspaceSessionNavigation(legacyCandidate);
    const legacyEncodeCount = encode.mock.calls.length;
    encode.mockClear();
    const first = harness
      .api()
      .snapshotPersistedWorkspaceSession(ROOT_A, { ...baseline, sidebarView: "files" }, baseline);
    const buildEncodeCount = encode.mock.calls.length;
    const snapshots = Array.from({ length: 20 }, (_, index) =>
      harness.api().snapshotPersistedWorkspaceSession(
        ROOT_A,
        {
          ...baseline,
          sidebarView: index % 2 === 0 ? "files" : "git",
        },
        baseline,
      ),
    );

    expect(first?.navigation).toBeDefined();
    expect(legacyEncodeCount).toBe(1_302);
    expect(buildEncodeCount).toBe(501);
    expect(encode).toHaveBeenCalledTimes(buildEncodeCount);
    for (const snapshot of snapshots) {
      expect(snapshot?.navigation).toBe(first?.navigation);
    }
    encode.mockRestore();
    harness.unmount();
  });

  it("restores persisted navigation only for the exact normalized workspace root", async () => {
    const harness = renderWorkspaceStateCacheHarness();
    const session = normalizeWorkspaceSession({
      ...normalizeWorkspaceSession({}),
      navigation: {
        backStack: [
          {
            path: `${ROOT_A}/a.ts`,
            position: { column: 2, lineNumber: 3 },
          },
        ],
        forwardStack: [],
        recentFiles: [{ name: "a.ts", path: `${ROOT_A}/a.ts` }],
        recentLocations: [
          {
            column: 2,
            line: 3,
            name: "a.ts",
            path: `${ROOT_A}/a.ts`,
            relativePath: "a.ts",
            snippet: "const a = 1;",
          },
        ],
      },
    });

    act(() => {
      expect(harness.api().restorePersistedWorkspaceNavigation(ROOT_A, ROOT_B, session)).toBe(
        false,
      );
    });
    expect(harness.state().recentFiles).toEqual([]);

    await act(async () => {
      expect(
        await harness.api().restorePersistedNavigationSession(
          `${ROOT_A}/`,
          () => ROOT_A,
          session,
          false,
          async () => undefined,
          () => true,
        ),
      ).toBe(true);
    });
    expect(harness.state().recentFiles[0]?.path).toBe(`${ROOT_A}/a.ts`);
    expect(harness.state().recentLocations[0]?.snippet).toBe("const a = 1;");
    expect(harness.state().navigationHistory.backStack[0]?.path).toBe(`${ROOT_A}/a.ts`);

    await act(async () => {
      expect(
        await harness.api().restorePersistedNavigationSession(
          ROOT_A,
          () => ROOT_A,
          session,
          true,
          async () => undefined,
          () => true,
        ),
      ).toBe(true);
    });
    expect(harness.state().recentFiles).toEqual([]);
    expect(harness.state().recentLocations).toEqual([]);
    expect(harness.state().navigationHistory).toEqual(createNavigationHistory());
    harness.unmount();
  });

  it("marks session restore complete when navigation is skipped for a post-await root change", async () => {
    const harness = renderWorkspaceStateCacheHarness();
    let activeRoot = ROOT_A;
    const restore = deferred<void>();
    const foreignSession = normalizeWorkspaceSession({
      navigation: {
        backStack: [
          {
            path: `${ROOT_A}/src/a.ts`,
            position: { column: 4, lineNumber: 9 },
          },
        ],
        forwardStack: [],
        recentFiles: [{ name: "a.ts", path: `${ROOT_A}/src/a.ts` }],
        recentLocations: [
          {
            column: 4,
            line: 9,
            name: "a.ts",
            path: `${ROOT_A}/src/a.ts`,
            relativePath: "src/a.ts",
            snippet: "const foreign = true;",
          },
        ],
      },
    });
    const pending = harness.api().restorePersistedNavigationSession(
      ROOT_A,
      () => activeRoot,
      foreignSession,
      false,
      () => restore.promise,
      () => true,
    );

    let restored = false;
    await act(async () => {
      activeRoot = ROOT_B;
      restore.resolve();
      restored = await pending;
    });

    expect(restored).toBe(true);
    expect(harness.state().navigationHistory).toEqual(createNavigationHistory());
    expect(harness.state().recentFiles).toEqual([]);
    expect(harness.state().recentLocations).toEqual([]);
    harness.unmount();
  });

  it("captures and restores debug breakpoints with the workspace state", () => {
    const harness = renderWorkspaceStateCacheHarness();
    const breakpoint: Breakpoint = {
      id: "bp-1",
      filePath: `${ROOT_A}/src/a.ts`,
      lineNumber: 5,
      enabled: true,
    };

    seedWorkspaceA(harness);
    act(() => {
      harness.setters().setDebugBreakpoints([breakpoint]);
    });
    harness.api().cacheCurrentWorkspaceState(ROOT_A);
    act(() => {
      harness.setters().setDebugBreakpoints([]);
    });

    const cached = harness.api().resolveCachedWorkspaceState(ROOT_A);
    expect(cached).not.toBeNull();
    expect(cached?.breakpoints).toEqual([breakpoint]);

    act(() => {
      harness.api().restoreCachedWorkspaceState(ROOT_A, cached as CachedWorkspaceWorkbenchState);
    });

    expect(harness.state().debugBreakpoints).toEqual([breakpoint]);
    harness.unmount();
  });

  it("captures identity-backed state under its stable workspace id key", () => {
    const harness = renderWorkspaceStateCacheHarness();
    const identity = workspaceIdentity(ROOT_A, `${CANONICAL_ROOT_A}/packages/..`);

    act(() => {
      harness.setters().setWorkspaceIdentityDescriptor(identity);
    });
    seedWorkspaceA(harness);
    harness.api().cacheCurrentWorkspaceState(ROOT_A);

    const cache = harness.api().workspaceStateCacheRef.current;
    const identityKey = workspaceIdentityStateCacheKey(
      identity.workspaceId,
      identity.canonicalRoot,
    );
    expect(Object.keys(cache)).toEqual([identityKey]);
    expect(cache[identityKey].workspaceIdentityDescriptor).toBe(identity);
    harness.unmount();
  });

  it("uses the selected runtime root when snapshotting canonical-owned state", () => {
    const harness = renderWorkspaceStateCacheHarness();
    const identity = workspaceIdentity();

    act(() => {
      harness.setters().setWorkspaceIdentityDescriptor(identity);
    });
    seedWorkspaceA(harness);
    harness.api().cacheCurrentWorkspaceState(ROOT_A);

    const cached =
      harness.api().workspaceStateCacheRef.current[
        workspaceIdentityStateCacheKey(identity.workspaceId, identity.canonicalRoot)
      ];
    expect(Object.keys(cached.editorSurface.documents)).toEqual([DOC_A.path]);
    expect(cached.editorSurface.imageTabs).toEqual({
      [IMAGE_TAB_A.path]: IMAGE_TAB_A,
    });
    harness.unmount();
  });

  it("migrates a matching selected-root alias to identity ownership", () => {
    const harness = renderWorkspaceStateCacheHarness();
    const identity = workspaceIdentity();

    seedWorkspaceA(harness);
    harness.api().cacheCurrentWorkspaceState(ROOT_A);
    const legacyState = harness.api().workspaceStateCacheRef.current[ROOT_A];
    legacyState.workspaceIdentityDescriptor = identity;

    const resolved = harness.api().resolveCachedWorkspaceState(ROOT_A, identity);

    expect(resolved).toBe(legacyState);
    expect(harness.api().workspaceStateCacheRef.current).toEqual({
      [workspaceIdentityStateCacheKey(identity.workspaceId, identity.canonicalRoot)]: legacyState,
    });
    harness.unmount();
  });

  it("keeps the identity-owned object unchanged when an alias collides", () => {
    const harness = renderWorkspaceStateCacheHarness();
    const identity = workspaceIdentity();

    seedWorkspaceA(harness);
    harness.api().cacheCurrentWorkspaceState(ROOT_A);
    const captured = harness.api().workspaceStateCacheRef.current[ROOT_A];
    const canonicalState = {
      ...captured,
      workspaceIdentityDescriptor: identity,
    };
    const aliasState = {
      ...captured,
      bookmarks: [],
      workspaceIdentityDescriptor: identity,
    };
    harness.api().workspaceStateCacheRef.current = {
      [workspaceIdentityStateCacheKey(identity.workspaceId, identity.canonicalRoot)]:
        canonicalState,
      [ROOT_A]: aliasState,
    };

    const winner = harness.api().coalesceWorkspaceStateCache(identity, ROOT_A);

    expect(winner).toBe(canonicalState);
    expect(harness.api().workspaceStateCacheRef.current).toEqual({
      [workspaceIdentityStateCacheKey(identity.workspaceId, identity.canonicalRoot)]:
        canonicalState,
    });
    harness.unmount();
  });

  it("collapses every alias describing the same canonical root", () => {
    const harness = renderWorkspaceStateCacheHarness();
    const identity = workspaceIdentity();
    const secondIdentity = workspaceIdentity("/second-link/workspace-a");

    seedWorkspaceA(harness);
    harness.api().cacheCurrentWorkspaceState(ROOT_A);
    const captured = harness.api().workspaceStateCacheRef.current[ROOT_A];
    const firstAlias = { ...captured, workspaceIdentityDescriptor: identity };
    const secondAlias = {
      ...captured,
      workspaceIdentityDescriptor: secondIdentity,
    };
    harness.api().workspaceStateCacheRef.current = {
      [ROOT_A]: firstAlias,
      [secondIdentity.selectedPath]: secondAlias,
    };

    const winner = harness.api().coalesceWorkspaceStateCache(identity, ROOT_A);

    expect(winner).toBe(firstAlias);
    expect(harness.api().workspaceStateCacheRef.current).toEqual({
      [workspaceIdentityStateCacheKey(identity.workspaceId, identity.canonicalRoot)]: firstAlias,
    });
    harness.unmount();
  });

  it("keeps owners with identical aliases independent while same-id aliases coalesce", () => {
    const harness = renderWorkspaceStateCacheHarness();
    const identityA = workspaceIdentity(ROOT_A, CANONICAL_ROOT_A, "owner-a");
    const identityB = workspaceIdentity(ROOT_A, CANONICAL_ROOT_A, "owner-b");

    seedWorkspaceA(harness);
    const captured = harness.api().workspaceStateCacheRef.current;
    harness.api().cacheCurrentWorkspaceState(ROOT_A);
    const baseState = Object.values(captured)[0];
    const ownerAState = {
      ...baseState,
      bookmarks: [BOOKMARK_A],
      editorSurface: {
        ...baseState.editorSurface,
        activePath: DIRTY_DOC_A.path,
        documents: { [DIRTY_DOC_A.path]: DIRTY_DOC_A },
        openPaths: [DIRTY_DOC_A.path],
      },
      navigationHistory: {
        backStack: [
          {
            path: DIRTY_DOC_A.path,
            position: { column: 2, lineNumber: 4 },
          },
        ],
        forwardStack: [],
        ownerKey: "owner-a",
      },
      recentLocations: [
        {
          column: 2,
          line: 4,
          name: "a.ts",
          path: DIRTY_DOC_A.path,
          relativePath: "src/a.ts",
          snippet: "owner a",
        },
      ],
      workspaceIdentityDescriptor: identityA,
    };
    const ownerBState = {
      ...baseState,
      bookmarks: [],
      editorSurface: {
        ...baseState.editorSurface,
        activePath: DOC_A_SECOND.path,
        documents: { [DOC_A_SECOND.path]: DOC_A_SECOND },
        openPaths: [DOC_A_SECOND.path],
      },
      navigationHistory: {
        backStack: [],
        forwardStack: [
          {
            path: DOC_A_SECOND.path,
            position: { column: 1, lineNumber: 8 },
          },
        ],
        ownerKey: "owner-b",
      },
      recentLocations: [
        {
          column: 1,
          line: 8,
          name: "second.ts",
          path: DOC_A_SECOND.path,
          relativePath: "src/second.ts",
          snippet: "owner b",
        },
      ],
      workspaceIdentityDescriptor: identityB,
    };
    harness.api().workspaceStateCacheRef.current = {
      [workspaceIdentityStateCacheKey(identityA.workspaceId, identityA.canonicalRoot)]: ownerAState,
      [workspaceIdentityStateCacheKey(identityB.workspaceId, identityB.canonicalRoot)]: ownerBState,
      [ROOT_A]: { ...ownerAState },
    };

    const resolvedA = harness.api().coalesceWorkspaceStateCache(identityA, ROOT_A);
    const resolvedB = harness.api().resolveCachedWorkspaceState(CANONICAL_ROOT_A, identityB);

    expect(resolvedA).toBe(ownerAState);
    expect(resolvedB).toBe(ownerBState);
    expect(resolvedA?.editorSurface.documents).toEqual({
      [DIRTY_DOC_A.path]: DIRTY_DOC_A,
    });
    expect(resolvedA?.editorSurface.activePath).toBe(DIRTY_DOC_A.path);
    expect(resolvedA?.bookmarks).toEqual([BOOKMARK_A]);
    expect(resolvedA?.navigationHistory.backStack).toHaveLength(1);
    expect(resolvedA?.navigationHistory.ownerKey).toBe("owner-a");
    expect(resolvedA?.recentLocations[0].snippet).toBe("owner a");
    expect(resolvedB?.editorSurface.documents).toEqual({
      [DOC_A_SECOND.path]: DOC_A_SECOND,
    });
    expect(resolvedB?.editorSurface.activePath).toBe(DOC_A_SECOND.path);
    expect(resolvedB?.bookmarks).toEqual([]);
    expect(resolvedB?.navigationHistory.forwardStack).toHaveLength(1);
    expect(resolvedB?.navigationHistory.ownerKey).toBe("owner-b");
    expect(resolvedB?.recentLocations[0].snippet).toBe("owner b");
    expect(harness.api().workspaceStateCacheRef.current).toEqual({
      [workspaceIdentityStateCacheKey(identityA.workspaceId, identityA.canonicalRoot)]: ownerAState,
      [workspaceIdentityStateCacheKey(identityB.workspaceId, identityB.canonicalRoot)]: ownerBState,
    });
    harness.unmount();
  });

  it("does not restore state from a replaced owner at the same root", () => {
    const harness = renderWorkspaceStateCacheHarness();
    const ownerA = workspaceIdentity(ROOT_A, CANONICAL_ROOT_A, "owner-a");
    const ownerB = workspaceIdentity(ROOT_A, CANONICAL_ROOT_A, "owner-b");

    act(() => {
      harness.setters().setWorkspaceIdentityDescriptor(ownerA);
    });
    seedWorkspaceA(harness);
    harness.api().cacheCurrentWorkspaceState(ROOT_A);

    expect(harness.api().resolveCachedWorkspaceState(ROOT_A, ownerB)).toBeNull();
    expect(harness.api().resolveCachedWorkspaceState(ROOT_A, ownerA)).not.toBeNull();
    harness.unmount();
  });

  it("round-trips one owner across an alias A to B to A sequence", () => {
    const harness = renderWorkspaceStateCacheHarness();
    const aliasA = workspaceIdentity("/alias-a/workspace", CANONICAL_ROOT_A, "owner-a");
    const aliasB = workspaceIdentity("/alias-b/workspace", `${CANONICAL_ROOT_A}/`, "owner-a");

    act(() => {
      harness.setters().setWorkspaceIdentityDescriptor(aliasA);
    });
    seedWorkspaceA(harness);
    harness.api().cacheCurrentWorkspaceState(aliasA.selectedPath);
    const captured = harness.api().resolveCachedWorkspaceState(aliasB.selectedPath, aliasB);

    expect(captured?.bookmarks).toEqual([BOOKMARK_A]);
    expect(harness.api().resolveCachedWorkspaceState(aliasA.selectedPath, aliasA)).toBe(captured);
    expect(Object.keys(harness.api().workspaceStateCacheRef.current)).toEqual([
      workspaceIdentityStateCacheKey(aliasA.workspaceId, CANONICAL_ROOT_A),
    ]);
    harness.unmount();
  });

  it("forgets canonical state and all aliases for an identity", () => {
    const harness = renderWorkspaceStateCacheHarness();
    const identity = workspaceIdentity();
    const secondIdentity = workspaceIdentity("/second-link/workspace-a");

    seedWorkspaceA(harness);
    harness.api().cacheCurrentWorkspaceState(ROOT_A);
    const captured = harness.api().workspaceStateCacheRef.current[ROOT_A];
    const ownedState = { ...captured, workspaceIdentityDescriptor: identity };
    const secondAlias = {
      ...captured,
      workspaceIdentityDescriptor: secondIdentity,
    };
    harness.api().workspaceStateCacheRef.current = {
      [CANONICAL_ROOT_A]: ownedState,
      [ROOT_A]: ownedState,
      [secondIdentity.selectedPath]: secondAlias,
      [ROOT_B]: captured,
    };

    harness.api().forgetCachedWorkspaceState(ROOT_A, identity);

    expect(harness.api().workspaceStateCacheRef.current).toEqual({
      [ROOT_B]: captured,
    });
    harness.unmount();
  });

  it("preserves normalized-root legacy behavior without an identity", () => {
    const harness = renderWorkspaceStateCacheHarness();

    seedWorkspaceA(harness);
    harness.api().cacheCurrentWorkspaceState(ROOT_A);
    const cached = harness.api().workspaceStateCacheRef.current[ROOT_A];

    expect(harness.api().resolveCachedWorkspaceState(ROOT_A)).toBe(cached);
    expect(harness.api().resolveCachedWorkspaceState(`${ROOT_A}/`)).toBe(cached);

    harness.api().forgetCachedWorkspaceState(`${ROOT_A}/`);
    expect(harness.api().workspaceStateCacheRef.current).toEqual({});
    harness.unmount();
  });

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
    expect(harness.state().expandedDirectories).toEqual(new Set([`${ROOT_A}/src`]));
    expect(harness.state().indexProgress.rootPath).toBe(ROOT_A);
    expect(harness.state().indexProgress.status).toBe("completed");
    expect(harness.session().editorGroups.groups["editor-main"].activePath).toBe(DOC_A.path);
    expect(harness.session().editorGroups.groups["editor-main"].openPaths).toEqual([
      DOC_A.path,
      IMAGE_TAB_A.path,
    ]);

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
    expect(cached.expandedDirectories).not.toBe(harness.state().expandedDirectories);
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
    expect(cached.editorSurface.documents[DIRTY_DOC_A.path]).toEqual(DIRTY_DOC_A);
    expect(cached.editorSurface.editorGroups?.activeGroupId).toBe("editor-1");

    act(() => {
      const session = harness.session();
      session.resetEditorSurfaceState();
      harness.api().restoreCachedWorkspaceState(ROOT_A, cached);

      expect(session.documentsRef.current[DIRTY_DOC_A.path]).toEqual(DIRTY_DOC_A);
      expect(session.imageTabsRef.current[IMAGE_TAB_A.path]).toEqual(IMAGE_TAB_A);
      expect(session.markdownPreviewTabsRef.current[MARKDOWN_PREVIEW_A.path]).toEqual(
        MARKDOWN_PREVIEW_A,
      );
      expect(session.editorGroupsRef.current).toEqual(groups);
      expect(session.openPathsRef.current).toEqual([DIRTY_DOC_A.path, IMAGE_TAB_A.path]);
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
    expect(restored.markdownPreviewTabs[MARKDOWN_PREVIEW_A.path]).toEqual(MARKDOWN_PREVIEW_A);
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
    expect(Object.keys(restored.markdownPreviewTabs)).toEqual([MARKDOWN_PREVIEW_A.path]);
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
