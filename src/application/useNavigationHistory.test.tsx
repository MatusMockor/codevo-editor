// @vitest-environment jsdom

import { act, startTransition, Suspense, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { useNavigationHistoryLifecycle } from "./useNavigationHistoryLifecycle";
import {
  useNavigationHistory,
  useRecentNavigation,
  type NavigationHistoryPlayback,
  type RecentNavigation,
} from "./useNavigationHistory";
import {
  createNavigationHistory,
  type NavigationHistory,
  type NavigationLocation,
} from "../domain/navigation";
import type { RecentFileEntry } from "../domain/recentFiles";
import type { RecentLocation } from "../domain/recentLocations";
import type { EditorDocument } from "../domain/workspace";
import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  createWorkspaceRuntimeOwner,
  transferWorkspaceRuntimeOwner,
  type WorkspaceRuntimeOwner,
} from "../domain/workspaceRuntimeOwner";

const ROOT = "/workspace";

function editorDocument(path: string, content = ""): EditorDocument {
  return {
    content,
    language: "typescript",
    name: path.split("/").pop() ?? path,
    path,
    savedContent: content,
  };
}

interface Harness {
  recentNavigation: () => RecentNavigation;
  navigation: () => NavigationHistoryPlayback;
  recentFiles: () => RecentFileEntry[];
  recentLocations: () => RecentLocation[];
  navigationHistory: () => NavigationHistory;
  recentFilesSwitcherOpen: () => boolean;
  recentLocationsPanelOpen: () => boolean;
  quickOpenOpen: () => boolean;
  classOpenOpen: () => boolean;
  workspaceSymbolsOpen: () => boolean;
  editorRevealTarget: () => NavigationLocation | null;
  currentWorkspaceRootRef: { current: string | null };
  activeEditorPositionRef: { current: EditorPosition | null };
  documentsRef: { current: Record<string, EditorDocument> };
  openPathForNavigation: ReturnType<typeof vi.fn>;
  shouldOpenNavigationTargetReadOnly: ReturnType<typeof vi.fn>;
  setActiveDocument: (document: EditorDocument | null) => void;
  setWorkspaceRuntimeOwner: (owner: WorkspaceRuntimeOwner | null) => void;
  setWorkspaceRoot: (root: string | null) => void;
  resetNavigationHistory: () => void;
  interruptNavigationHistoryReset: () => void;
  openQuickOpenClassAndWorkspaceSymbols: () => void;
  unmount: () => void;
}

/**
 * Mounts useRecentNavigation and useNavigationHistory together, exactly like
 * the shell does: useRecentNavigation first, then its returned
 * currentNavigationLocation/recordCurrentNavigationLocation/
 * forgetRecentLocationsForPath fed into useNavigationHistory. Every piece of
 * cached per-tab state (recentFiles, recentLocations, navigationHistory, the
 * switcher/panel toggles, the overlay-exclusivity toggles) is owned by the
 * harness component or by the same lifecycle hook the shell uses, mirroring
 * the dependency-injection contract.
 */
function renderNavigationHistory(
  initialWorkspaceRoot: string | null = ROOT,
): Harness {
  const container = window.document.createElement("div");
  const root = createRoot(container);

  const captured: {
    recentNavigation: RecentNavigation | null;
    navigation: NavigationHistoryPlayback | null;
    recentFiles: RecentFileEntry[];
    recentLocations: RecentLocation[];
    navigationHistory: NavigationHistory;
    recentFilesSwitcherOpen: boolean;
    recentLocationsPanelOpen: boolean;
    quickOpenOpen: boolean;
    classOpenOpen: boolean;
    workspaceSymbolsOpen: boolean;
    editorRevealTarget: NavigationLocation | null;
  } = {
    classOpenOpen: false,
    editorRevealTarget: null,
    navigation: null,
    navigationHistory: createNavigationHistory(),
    quickOpenOpen: false,
    recentFiles: [],
    recentFilesSwitcherOpen: false,
    recentLocations: [],
    recentLocationsPanelOpen: false,
    recentNavigation: null,
    workspaceSymbolsOpen: false,
  };

  const currentWorkspaceRootRef: { current: string | null } = {
    current: initialWorkspaceRoot,
  };
  let currentWorkspaceRuntimeOwner = initialWorkspaceRoot
    ? createWorkspaceRuntimeOwner("workspace-a", initialWorkspaceRoot)
    : null;
  const resolveCurrentWorkspaceRuntimeOwner = () =>
    currentWorkspaceRuntimeOwner;
  const activeEditorPositionRef: { current: EditorPosition | null } = {
    current: null,
  };
  const documentsRef: { current: Record<string, EditorDocument> } = {
    current: {},
  };
  const openPathForNavigation = vi.fn(
    async (_path: string, _options?: { readOnly?: boolean }) => true,
  );
  const shouldOpenNavigationTargetReadOnly = vi.fn(
    (_rootPath: string, _path: string) => false,
  );

  let setActiveDocumentState: (document: EditorDocument | null) => void =
    () => {};
  let setWorkspaceRootState: (rootPath: string | null) => void = () => {};
  let triggerOpenOverlays: () => void = () => {};
  let resetNavigationHistoryState: () => void = () => {};
  let suspendOnEmptyNavigationHistory = false;
  const suspendedRender = new Promise<void>(() => {});

  function HarnessComponent() {
    const [recentFiles, setRecentFiles] = useState<RecentFileEntry[]>([]);
    const [recentLocations, setRecentLocations] = useState<RecentLocation[]>(
      [],
    );
    const {
      navigationHistory,
      resetHistory,
      setNavigationHistory,
    } = useNavigationHistoryLifecycle();
    const [recentFilesSwitcherOpen, setRecentFilesSwitcherOpen] =
      useState(false);
    const [recentLocationsPanelOpen, setRecentLocationsPanelOpen] =
      useState(false);
    const [quickOpenOpen, setQuickOpenOpen] = useState(false);
    const [classOpenOpen, setClassOpenOpen] = useState(false);
    const [workspaceSymbolsOpen, setWorkspaceSymbolsOpen] = useState(false);
    const [editorRevealTarget, setEditorRevealTarget] =
      useState<NavigationLocation | null>(null);
    const [activeDocument, setActiveDocument] =
      useState<EditorDocument | null>(null);
    const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(
      initialWorkspaceRoot,
    );

    setActiveDocumentState = setActiveDocument;
    setWorkspaceRootState = setWorkspaceRoot;
    triggerOpenOverlays = () => {
      setQuickOpenOpen(true);
      setClassOpenOpen(true);
      setWorkspaceSymbolsOpen(true);
    };
    resetNavigationHistoryState = resetHistory;

    captured.recentFiles = recentFiles;
    captured.recentLocations = recentLocations;
    captured.navigationHistory = navigationHistory;
    captured.recentFilesSwitcherOpen = recentFilesSwitcherOpen;
    captured.recentLocationsPanelOpen = recentLocationsPanelOpen;
    captured.quickOpenOpen = quickOpenOpen;
    captured.classOpenOpen = classOpenOpen;
    captured.workspaceSymbolsOpen = workspaceSymbolsOpen;
    captured.editorRevealTarget = editorRevealTarget;

    const recentNavigation = useRecentNavigation({
      activeDocument,
      activeEditorPositionRef,
      currentWorkspaceRootRef,
      documentsRef,
      setClassOpenOpen,
      setNavigationHistory,
      setQuickOpenOpen,
      setRecentFiles,
      setRecentFilesSwitcherOpen,
      setRecentLocations,
      setRecentLocationsPanelOpen,
      setWorkspaceSymbolsOpen,
    });
    captured.recentNavigation = recentNavigation;

    const navigation = useNavigationHistory({
      currentNavigationLocation: recentNavigation.currentNavigationLocation,
      currentWorkspaceRootRef,
      forgetRecentLocationsForPath:
        recentNavigation.forgetRecentLocationsForPath,
      navigationHistory,
      openPathForNavigation,
      recordCurrentNavigationLocation:
        recentNavigation.recordCurrentNavigationLocation,
      resolveCurrentWorkspaceRuntimeOwner,
      setEditorRevealTarget,
      setNavigationHistory,
      setRecentLocationsPanelOpen,
      shouldOpenNavigationTargetReadOnly,
      workspaceRoot,
    });
    captured.navigation = navigation;

    if (
      suspendOnEmptyNavigationHistory &&
      navigationHistory.backStack.length === 0 &&
      navigationHistory.forwardStack.length === 0
    ) {
      throw suspendedRender;
    }

    return null;
  }

  act(() => {
    root.render(
      <Suspense fallback={null}>
        <HarnessComponent />
      </Suspense>,
    );
  });

  return {
    activeEditorPositionRef,
    classOpenOpen: () => captured.classOpenOpen,
    currentWorkspaceRootRef,
    documentsRef,
    editorRevealTarget: () => captured.editorRevealTarget,
    navigation: () => {
      if (!captured.navigation) {
        throw new Error("navigation hook not mounted");
      }
      return captured.navigation;
    },
    navigationHistory: () => captured.navigationHistory,
    openPathForNavigation,
    openQuickOpenClassAndWorkspaceSymbols: () => {
      act(() => {
        triggerOpenOverlays();
      });
    },
    interruptNavigationHistoryReset: () => {
      suspendOnEmptyNavigationHistory = true;
      act(() => {
        startTransition(() => {
          resetNavigationHistoryState();
        });
      });
    },
    quickOpenOpen: () => captured.quickOpenOpen,
    recentFiles: () => captured.recentFiles,
    recentFilesSwitcherOpen: () => captured.recentFilesSwitcherOpen,
    resetNavigationHistory: () => {
      act(() => {
        resetNavigationHistoryState();
      });
    },
    recentLocations: () => captured.recentLocations,
    recentLocationsPanelOpen: () => captured.recentLocationsPanelOpen,
    recentNavigation: () => {
      if (!captured.recentNavigation) {
        throw new Error("recentNavigation hook not mounted");
      }
      return captured.recentNavigation;
    },
    setActiveDocument: (document: EditorDocument | null) => {
      act(() => {
        setActiveDocumentState(document);
      });
    },
    setWorkspaceRuntimeOwner: (owner: WorkspaceRuntimeOwner | null) => {
      currentWorkspaceRuntimeOwner = owner;
    },
    setWorkspaceRoot: (rootPath: string | null) => {
      act(() => {
        setWorkspaceRootState(rootPath);
      });
      currentWorkspaceRootRef.current = rootPath;
    },
    shouldOpenNavigationTargetReadOnly,
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
    workspaceSymbolsOpen: () => captured.workspaceSymbolsOpen,
  };
}

describe("useRecentNavigation", () => {
  it("records a recently opened file at the head of the MRU", () => {
    const harness = renderNavigationHistory();

    act(() => {
      harness.recentNavigation().recordRecentFile({ name: "a.ts", path: `${ROOT}/a.ts` });
    });
    act(() => {
      harness.recentNavigation().recordRecentFile({ name: "b.ts", path: `${ROOT}/b.ts` });
    });

    expect(harness.recentFiles()).toEqual([
      { name: "b.ts", path: `${ROOT}/b.ts` },
      { name: "a.ts", path: `${ROOT}/a.ts` },
    ]);

    harness.unmount();
  });

  it("forgets a recent file that no longer exists", () => {
    const harness = renderNavigationHistory();

    act(() => {
      harness.recentNavigation().recordRecentFile({ name: "a.ts", path: `${ROOT}/a.ts` });
    });
    act(() => {
      harness.recentNavigation().forgetRecentFile(`${ROOT}/a.ts`);
    });

    expect(harness.recentFiles()).toEqual([]);

    harness.unmount();
  });

  it("remaps a renamed recent file in place", () => {
    const harness = renderNavigationHistory();

    act(() => {
      harness.recentNavigation().recordRecentFile({ name: "a.ts", path: `${ROOT}/a.ts` });
    });
    act(() => {
      harness
        .recentNavigation()
        .remapRecentFile(`${ROOT}/a.ts`, { name: "renamed.ts", path: `${ROOT}/renamed.ts` });
    });

    expect(harness.recentFiles()).toEqual([
      { name: "renamed.ts", path: `${ROOT}/renamed.ts` },
    ]);

    harness.unmount();
  });

  it("opens the recent files switcher, closing the other overlays, gated on an active workspace", () => {
    const harness = renderNavigationHistory();
    harness.openQuickOpenClassAndWorkspaceSymbols();
    act(() => {
      harness.recentNavigation().openRecentLocationsPanel();
    });

    act(() => {
      harness.recentNavigation().openRecentFilesSwitcher();
    });

    expect(harness.recentFilesSwitcherOpen()).toBe(true);
    expect(harness.recentLocationsPanelOpen()).toBe(false);
    expect(harness.quickOpenOpen()).toBe(false);
    expect(harness.classOpenOpen()).toBe(false);
    expect(harness.workspaceSymbolsOpen()).toBe(false);

    harness.unmount();
  });

  it("never opens the recent files switcher without an active workspace", () => {
    const harness = renderNavigationHistory(null);

    act(() => {
      harness.recentNavigation().openRecentFilesSwitcher();
    });

    expect(harness.recentFilesSwitcherOpen()).toBe(false);

    harness.unmount();
  });

  it("opens the recent locations panel, closing the switcher, gated on an active workspace", () => {
    const harness = renderNavigationHistory();
    act(() => {
      harness.recentNavigation().openRecentFilesSwitcher();
    });

    act(() => {
      harness.recentNavigation().openRecentLocationsPanel();
    });

    expect(harness.recentLocationsPanelOpen()).toBe(true);
    expect(harness.recentFilesSwitcherOpen()).toBe(false);

    harness.unmount();
  });

  it("never opens the recent locations panel without an active workspace", () => {
    const harness = renderNavigationHistory(null);

    act(() => {
      harness.recentNavigation().openRecentLocationsPanel();
    });

    expect(harness.recentLocationsPanelOpen()).toBe(false);

    harness.unmount();
  });

  it("returns null for the current navigation location without an active document", () => {
    const harness = renderNavigationHistory();

    expect(harness.recentNavigation().currentNavigationLocation()).toBeNull();

    harness.unmount();
  });

  it("reads the current navigation location from the active document and caret", () => {
    const harness = renderNavigationHistory();
    harness.setActiveDocument(editorDocument(`${ROOT}/a.ts`));
    harness.activeEditorPositionRef.current = { column: 4, lineNumber: 7 };

    expect(harness.recentNavigation().currentNavigationLocation()).toEqual({
      path: `${ROOT}/a.ts`,
      position: { column: 4, lineNumber: 7 },
    });

    harness.unmount();
  });

  it("records a navigation-history snapshot of a location", () => {
    const harness = renderNavigationHistory();

    act(() => {
      harness.recentNavigation().recordNavigationLocationSnapshot({
        path: `${ROOT}/a.ts`,
        position: { column: 1, lineNumber: 1 },
      });
    });

    expect(harness.navigationHistory().backStack).toEqual([
      { path: `${ROOT}/a.ts`, position: { column: 1, lineNumber: 1 } },
    ]);

    harness.unmount();
  });

  it("records a recent-location snapshot built from the document content", () => {
    const harness = renderNavigationHistory();
    harness.documentsRef.current = {
      [`${ROOT}/a.ts`]: editorDocument(`${ROOT}/a.ts`, "one\ntwo\nthree\n"),
    };

    act(() => {
      harness.recentNavigation().recordRecentLocationSnapshot({
        path: `${ROOT}/a.ts`,
        position: { column: 1, lineNumber: 2 },
      });
    });

    expect(harness.recentLocations()).toEqual([
      {
        column: 1,
        line: 2,
        name: "a.ts",
        path: `${ROOT}/a.ts`,
        relativePath: "a.ts",
        snippet: "two",
      },
    ]);

    harness.unmount();
  });

  it("drops a recent-location snapshot without an active workspace root", () => {
    const harness = renderNavigationHistory(null);

    act(() => {
      harness.recentNavigation().recordRecentLocationSnapshot({
        path: `${ROOT}/a.ts`,
        position: { column: 1, lineNumber: 2 },
      });
    });

    expect(harness.recentLocations()).toEqual([]);

    harness.unmount();
  });

  it("forgets recent locations for a deleted path", () => {
    const harness = renderNavigationHistory();
    harness.documentsRef.current = {
      [`${ROOT}/a.ts`]: editorDocument(`${ROOT}/a.ts`, "one\n"),
    };

    act(() => {
      harness.recentNavigation().recordRecentLocationSnapshot({
        path: `${ROOT}/a.ts`,
        position: { column: 1, lineNumber: 1 },
      });
    });
    act(() => {
      harness.recentNavigation().forgetRecentLocationsForPath(`${ROOT}/a.ts`);
    });

    expect(harness.recentLocations()).toEqual([]);

    harness.unmount();
  });

  it("remaps recent locations for a renamed path", () => {
    const harness = renderNavigationHistory();
    harness.documentsRef.current = {
      [`${ROOT}/a.ts`]: editorDocument(`${ROOT}/a.ts`, "one\n"),
    };

    act(() => {
      harness.recentNavigation().recordRecentLocationSnapshot({
        path: `${ROOT}/a.ts`,
        position: { column: 1, lineNumber: 1 },
      });
    });
    act(() => {
      harness.recentNavigation().remapRecentLocations(`${ROOT}/a.ts`, {
        name: "renamed.ts",
        path: `${ROOT}/renamed.ts`,
        relativePath: "renamed.ts",
      });
    });

    expect(harness.recentLocations()).toEqual([
      expect.objectContaining({ name: "renamed.ts", path: `${ROOT}/renamed.ts` }),
    ]);

    harness.unmount();
  });

  it("records both the navigation-history and recent-location snapshots for the current spot", () => {
    const harness = renderNavigationHistory();
    harness.setActiveDocument(editorDocument(`${ROOT}/a.ts`, "one\ntwo\n"));
    harness.activeEditorPositionRef.current = { column: 1, lineNumber: 1 };
    harness.documentsRef.current = {
      [`${ROOT}/a.ts`]: editorDocument(`${ROOT}/a.ts`, "one\ntwo\n"),
    };

    act(() => {
      harness.recentNavigation().recordCurrentNavigationLocation();
    });

    expect(harness.navigationHistory().backStack).toEqual([
      { path: `${ROOT}/a.ts`, position: { column: 1, lineNumber: 1 } },
    ]);
    expect(harness.recentLocations()).toEqual([
      expect.objectContaining({ path: `${ROOT}/a.ts`, line: 1 }),
    ]);

    harness.unmount();
  });

  it("resets the back/forward stack through the lifecycle owner", () => {
    const harness = renderNavigationHistory();

    act(() => {
      harness.recentNavigation().recordNavigationLocationSnapshot({
        path: `${ROOT}/a.ts`,
        position: { column: 1, lineNumber: 1 },
      });
    });

    harness.resetNavigationHistory();

    expect(harness.navigationHistory()).toEqual(createNavigationHistory());

    harness.unmount();
  });
});

describe("useNavigationHistory", () => {
  it("does nothing navigating backward with an empty back stack", async () => {
    const harness = renderNavigationHistory();

    await act(async () => {
      await harness.navigation().navigateBackward();
    });

    expect(harness.openPathForNavigation).not.toHaveBeenCalled();
    expect(harness.editorRevealTarget()).toBeNull();

    harness.unmount();
  });

  it("does nothing navigating forward with an empty forward stack", async () => {
    const harness = renderNavigationHistory();

    await act(async () => {
      await harness.navigation().navigateForwardInHistory();
    });

    expect(harness.openPathForNavigation).not.toHaveBeenCalled();
    expect(harness.editorRevealTarget()).toBeNull();

    harness.unmount();
  });

  it("navigates backward, revealing the previous location and enabling forward", async () => {
    const harness = renderNavigationHistory();

    act(() => {
      harness.recentNavigation().recordNavigationLocationSnapshot({
        path: `${ROOT}/a.ts`,
        position: { column: 1, lineNumber: 1 },
      });
    });
    harness.setActiveDocument(editorDocument(`${ROOT}/b.ts`));
    harness.activeEditorPositionRef.current = { column: 2, lineNumber: 5 };

    await act(async () => {
      await harness.navigation().navigateBackward();
    });

    expect(harness.openPathForNavigation).toHaveBeenCalledWith(
      `${ROOT}/a.ts`,
      expect.objectContaining({ readOnly: false }),
    );
    expect(harness.editorRevealTarget()).toEqual({
      path: `${ROOT}/a.ts`,
      position: { column: 1, lineNumber: 1 },
    });
    expect(harness.navigationHistory().backStack).toEqual([]);
    expect(harness.navigationHistory().forwardStack).toEqual([
      { path: `${ROOT}/b.ts`, position: { column: 2, lineNumber: 5 } },
    ]);

    harness.unmount();
  });

  it("preserves backward history when the target fails to open", async () => {
    const harness = renderNavigationHistory();
    const previousLocation: NavigationLocation = {
      path: `${ROOT}/a.ts`,
      position: { column: 1, lineNumber: 1 },
    };

    act(() => {
      harness
        .recentNavigation()
        .recordNavigationLocationSnapshot(previousLocation);
    });
    harness.setActiveDocument(editorDocument(`${ROOT}/b.ts`));
    harness.activeEditorPositionRef.current = { column: 2, lineNumber: 5 };
    harness.openPathForNavigation.mockResolvedValueOnce(false);

    await act(async () => {
      await harness.navigation().navigateBackward();
    });

    expect(harness.navigationHistory()).toEqual({
      backStack: [previousLocation],
      forwardStack: [],
    });
    expect(harness.editorRevealTarget()).toBeNull();

    harness.unmount();
  });

  it("preserves backward history when the workspace switches during the open", async () => {
    const harness = renderNavigationHistory();
    const previousLocation: NavigationLocation = {
      path: `${ROOT}/a.ts`,
      position: { column: 1, lineNumber: 1 },
    };
    let resolveOpen: (value: boolean) => void = () => {};

    act(() => {
      harness
        .recentNavigation()
        .recordNavigationLocationSnapshot(previousLocation);
    });
    harness.setActiveDocument(editorDocument(`${ROOT}/b.ts`));
    harness.activeEditorPositionRef.current = { column: 2, lineNumber: 5 };
    harness.openPathForNavigation.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveOpen = resolve;
        }),
    );

    const pending = act(async () => {
      await harness.navigation().navigateBackward();
    });

    harness.setWorkspaceRoot("/other-workspace");
    resolveOpen(true);
    await pending;

    expect(harness.navigationHistory()).toEqual({
      backStack: [previousLocation],
      forwardStack: [],
    });
    expect(harness.editorRevealTarget()).toBeNull();

    harness.unmount();
  });

  it("cancels backward activation when another owner replaces the same root", async () => {
    const harness = renderNavigationHistory();
    const previousLocation: NavigationLocation = {
      path: `${ROOT}/a.ts`,
      position: { column: 1, lineNumber: 1 },
    };
    let activePath = `${ROOT}/b.ts`;
    let resolveOpen: () => void = () => {};

    act(() => {
      harness
        .recentNavigation()
        .recordNavigationLocationSnapshot(previousLocation);
    });
    harness.setActiveDocument(editorDocument(activePath));
    harness.openPathForNavigation.mockImplementationOnce(
      async (path, options) => {
        await new Promise<void>((resolve) => {
          resolveOpen = resolve;
        });

        if (options?.shouldCommit?.() === false) {
          return false;
        }

        activePath = path;
        return true;
      },
    );

    const pending = harness.navigation().navigateBackward();

    harness.setWorkspaceRuntimeOwner(
      createWorkspaceRuntimeOwner("workspace-b", ROOT),
    );
    resolveOpen();
    await act(async () => {
      await pending;
    });

    expect(activePath).toBe(`${ROOT}/b.ts`);
    expect(harness.navigationHistory()).toEqual({
      backStack: [previousLocation],
      forwardStack: [],
    });
    expect(harness.editorRevealTarget()).toBeNull();

    harness.unmount();
  });

  it("allows backward activation after a same-owner alias transfer", async () => {
    const harness = renderNavigationHistory();
    const owner = createWorkspaceRuntimeOwner("workspace-a", ROOT);
    const previousLocation: NavigationLocation = {
      path: `${ROOT}/a.ts`,
      position: { column: 1, lineNumber: 1 },
    };
    let resolveOpen: () => void = () => {};

    harness.setWorkspaceRuntimeOwner(owner);
    act(() => {
      harness
        .recentNavigation()
        .recordNavigationLocationSnapshot(previousLocation);
    });
    harness.setActiveDocument(editorDocument(`${ROOT}/b.ts`));
    harness.openPathForNavigation.mockImplementationOnce(
      async (_path, options) => {
        await new Promise<void>((resolve) => {
          resolveOpen = resolve;
        });
        return options?.shouldCommit?.() !== false;
      },
    );

    const pending = harness.navigation().navigateBackward();

    harness.setWorkspaceRuntimeOwner(
      transferWorkspaceRuntimeOwner(owner, `${ROOT}/alias`),
    );
    resolveOpen();
    await act(async () => {
      await pending;
    });

    expect(harness.navigationHistory()).toEqual({
      backStack: [],
      forwardStack: [
        {
          path: `${ROOT}/b.ts`,
          position: { column: 1, lineNumber: 1 },
        },
      ],
    });
    expect(harness.editorRevealTarget()).toEqual(previousLocation);

    harness.unmount();
  });

  it("preserves a newer location recorded while backward navigation is pending", async () => {
    const harness = renderNavigationHistory();
    const previousLocation: NavigationLocation = {
      path: `${ROOT}/a.ts`,
      position: { column: 1, lineNumber: 1 },
    };
    const newerLocation: NavigationLocation = {
      path: `${ROOT}/c.ts`,
      position: { column: 3, lineNumber: 8 },
    };
    let resolveOpen: (value: boolean) => void = () => {};

    act(() => {
      harness
        .recentNavigation()
        .recordNavigationLocationSnapshot(previousLocation);
    });
    harness.setActiveDocument(editorDocument(`${ROOT}/b.ts`));
    harness.activeEditorPositionRef.current = { column: 2, lineNumber: 5 };
    harness.openPathForNavigation.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveOpen = resolve;
        }),
    );

    const pending = harness.navigation().navigateBackward();

    act(() => {
      harness
        .recentNavigation()
        .recordNavigationLocationSnapshot(newerLocation);
    });
    resolveOpen(true);
    await act(async () => {
      await pending;
    });

    expect(harness.navigationHistory()).toEqual({
      backStack: [previousLocation, newerLocation],
      forwardStack: [],
    });
    expect(harness.editorRevealTarget()).toBeNull();

    harness.unmount();
  });

  it("does not reveal a stale backward target when newer history is recorded in the same tick", async () => {
    const harness = renderNavigationHistory();
    const previousLocation: NavigationLocation = {
      path: `${ROOT}/a.ts`,
      position: { column: 1, lineNumber: 1 },
    };
    const newerLocation: NavigationLocation = {
      path: `${ROOT}/c.ts`,
      position: { column: 3, lineNumber: 8 },
    };
    let resolveOpen: (value: boolean) => void = () => {};

    act(() => {
      harness
        .recentNavigation()
        .recordNavigationLocationSnapshot(previousLocation);
    });
    harness.setActiveDocument(editorDocument(`${ROOT}/b.ts`));
    harness.activeEditorPositionRef.current = { column: 2, lineNumber: 5 };
    harness.openPathForNavigation.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveOpen = resolve;
        }),
    );

    const pending = harness.navigation().navigateBackward();

    await act(async () => {
      harness
        .recentNavigation()
        .recordNavigationLocationSnapshot(newerLocation);
      resolveOpen(true);
      await pending;
    });

    expect(harness.navigationHistory()).toEqual({
      backStack: [previousLocation, newerLocation],
      forwardStack: [],
    });
    expect(harness.editorRevealTarget()).toBeNull();

    harness.unmount();
  });

  it("does not activate a stale backward target after history changes during the open", async () => {
    const harness = renderNavigationHistory();
    const previousLocation: NavigationLocation = {
      path: `${ROOT}/a.ts`,
      position: { column: 1, lineNumber: 1 },
    };
    const newerLocation: NavigationLocation = {
      path: `${ROOT}/c.ts`,
      position: { column: 3, lineNumber: 8 },
    };
    let activePath = `${ROOT}/b.ts`;
    let resolveOpen: () => void = () => {};

    act(() => {
      harness
        .recentNavigation()
        .recordNavigationLocationSnapshot(previousLocation);
    });
    harness.setActiveDocument(editorDocument(activePath));
    harness.openPathForNavigation.mockImplementationOnce(
      async (path, options) => {
        await new Promise<void>((resolve) => {
          resolveOpen = resolve;
        });

        if (options?.shouldCommit?.() === false) {
          return false;
        }

        activePath = path;
        return true;
      },
    );

    const pending = harness.navigation().navigateBackward();

    act(() => {
      harness
        .recentNavigation()
        .recordNavigationLocationSnapshot(newerLocation);
    });
    resolveOpen();
    await act(async () => {
      await pending;
    });

    expect(activePath).toBe(`${ROOT}/b.ts`);
    expect(harness.editorRevealTarget()).toBeNull();

    harness.unmount();
  });

  it("ignores history from an interrupted concurrent render", async () => {
    const harness = renderNavigationHistory();
    const previousLocation: NavigationLocation = {
      path: `${ROOT}/a.ts`,
      position: { column: 1, lineNumber: 1 },
    };
    let activePath = `${ROOT}/b.ts`;
    let resolveOpen: () => void = () => {};

    act(() => {
      harness
        .recentNavigation()
        .recordNavigationLocationSnapshot(previousLocation);
    });
    harness.setActiveDocument(editorDocument(activePath));
    harness.openPathForNavigation.mockImplementationOnce(
      async (path, options) => {
        await new Promise<void>((resolve) => {
          resolveOpen = resolve;
        });

        if (options?.shouldCommit?.() === false) {
          return false;
        }

        activePath = path;
        return true;
      },
    );

    const pending = harness.navigation().navigateBackward();

    harness.interruptNavigationHistoryReset();
    resolveOpen();
    await act(async () => {
      await pending;
    });

    expect(activePath).toBe(previousLocation.path);
    expect(harness.editorRevealTarget()).toEqual(previousLocation);

    harness.unmount();
  });

  it("navigates forward after navigating backward", async () => {
    const harness = renderNavigationHistory();

    act(() => {
      harness.recentNavigation().recordNavigationLocationSnapshot({
        path: `${ROOT}/a.ts`,
        position: { column: 1, lineNumber: 1 },
      });
    });
    harness.setActiveDocument(editorDocument(`${ROOT}/b.ts`));
    harness.activeEditorPositionRef.current = { column: 2, lineNumber: 5 };

    await act(async () => {
      await harness.navigation().navigateBackward();
    });

    harness.setActiveDocument(editorDocument(`${ROOT}/a.ts`));
    harness.activeEditorPositionRef.current = { column: 1, lineNumber: 1 };

    await act(async () => {
      await harness.navigation().navigateForwardInHistory();
    });

    expect(harness.openPathForNavigation).toHaveBeenLastCalledWith(
      `${ROOT}/b.ts`,
      expect.objectContaining({ readOnly: false }),
    );
    expect(harness.editorRevealTarget()).toEqual({
      path: `${ROOT}/b.ts`,
      position: { column: 2, lineNumber: 5 },
    });
    expect(harness.navigationHistory().forwardStack).toEqual([]);

    harness.unmount();
  });

  it("preserves forward history when the target fails to open", async () => {
    const harness = renderNavigationHistory();
    const previousLocation: NavigationLocation = {
      path: `${ROOT}/a.ts`,
      position: { column: 1, lineNumber: 1 },
    };
    const currentLocation: NavigationLocation = {
      path: `${ROOT}/b.ts`,
      position: { column: 2, lineNumber: 5 },
    };

    act(() => {
      harness
        .recentNavigation()
        .recordNavigationLocationSnapshot(previousLocation);
    });
    harness.setActiveDocument(editorDocument(currentLocation.path));
    harness.activeEditorPositionRef.current = currentLocation.position;
    await act(async () => {
      await harness.navigation().navigateBackward();
    });

    harness.setActiveDocument(editorDocument(previousLocation.path));
    harness.activeEditorPositionRef.current = previousLocation.position;
    harness.openPathForNavigation.mockResolvedValueOnce(false);

    await act(async () => {
      await harness.navigation().navigateForwardInHistory();
    });

    expect(harness.navigationHistory()).toEqual({
      backStack: [],
      forwardStack: [currentLocation],
    });
    expect(harness.editorRevealTarget()).toEqual(previousLocation);

    harness.unmount();
  });

  it("preserves forward history when the workspace switches during the open", async () => {
    const harness = renderNavigationHistory();
    const previousLocation: NavigationLocation = {
      path: `${ROOT}/a.ts`,
      position: { column: 1, lineNumber: 1 },
    };
    const currentLocation: NavigationLocation = {
      path: `${ROOT}/b.ts`,
      position: { column: 2, lineNumber: 5 },
    };
    let resolveOpen: (value: boolean) => void = () => {};

    act(() => {
      harness
        .recentNavigation()
        .recordNavigationLocationSnapshot(previousLocation);
    });
    harness.setActiveDocument(editorDocument(currentLocation.path));
    harness.activeEditorPositionRef.current = currentLocation.position;
    await act(async () => {
      await harness.navigation().navigateBackward();
    });

    harness.setActiveDocument(editorDocument(previousLocation.path));
    harness.activeEditorPositionRef.current = previousLocation.position;
    harness.openPathForNavigation.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveOpen = resolve;
        }),
    );

    const pending = act(async () => {
      await harness.navigation().navigateForwardInHistory();
    });

    harness.setWorkspaceRoot("/other-workspace");
    resolveOpen(true);
    await pending;

    expect(harness.navigationHistory()).toEqual({
      backStack: [],
      forwardStack: [currentLocation],
    });
    expect(harness.editorRevealTarget()).toEqual(previousLocation);

    harness.unmount();
  });

  it("cancels forward activation when another owner replaces the same root", async () => {
    const harness = renderNavigationHistory();
    const previousLocation: NavigationLocation = {
      path: `${ROOT}/a.ts`,
      position: { column: 1, lineNumber: 1 },
    };
    const currentLocation: NavigationLocation = {
      path: `${ROOT}/b.ts`,
      position: { column: 2, lineNumber: 5 },
    };
    let activePath = previousLocation.path;
    let resolveOpen: () => void = () => {};

    act(() => {
      harness
        .recentNavigation()
        .recordNavigationLocationSnapshot(previousLocation);
    });
    harness.setActiveDocument(editorDocument(currentLocation.path));
    harness.activeEditorPositionRef.current = currentLocation.position;
    await act(async () => {
      await harness.navigation().navigateBackward();
    });

    harness.setActiveDocument(editorDocument(previousLocation.path));
    harness.activeEditorPositionRef.current = previousLocation.position;
    harness.openPathForNavigation.mockImplementationOnce(
      async (path, options) => {
        await new Promise<void>((resolve) => {
          resolveOpen = resolve;
        });

        if (options?.shouldCommit?.() === false) {
          return false;
        }

        activePath = path;
        return true;
      },
    );

    const pending = harness.navigation().navigateForwardInHistory();

    harness.setWorkspaceRuntimeOwner(
      createWorkspaceRuntimeOwner("workspace-b", ROOT),
    );
    resolveOpen();
    await act(async () => {
      await pending;
    });

    expect(activePath).toBe(previousLocation.path);
    expect(harness.navigationHistory()).toEqual({
      backStack: [],
      forwardStack: [currentLocation],
    });
    expect(harness.editorRevealTarget()).toEqual(previousLocation);

    harness.unmount();
  });

  it("preserves a newer location recorded while forward navigation is pending", async () => {
    const harness = renderNavigationHistory();
    const previousLocation: NavigationLocation = {
      path: `${ROOT}/a.ts`,
      position: { column: 1, lineNumber: 1 },
    };
    const currentLocation: NavigationLocation = {
      path: `${ROOT}/b.ts`,
      position: { column: 2, lineNumber: 5 },
    };
    const newerLocation: NavigationLocation = {
      path: `${ROOT}/c.ts`,
      position: { column: 3, lineNumber: 8 },
    };
    let resolveOpen: (value: boolean) => void = () => {};

    act(() => {
      harness
        .recentNavigation()
        .recordNavigationLocationSnapshot(previousLocation);
    });
    harness.setActiveDocument(editorDocument(currentLocation.path));
    harness.activeEditorPositionRef.current = currentLocation.position;
    await act(async () => {
      await harness.navigation().navigateBackward();
    });

    harness.setActiveDocument(editorDocument(previousLocation.path));
    harness.activeEditorPositionRef.current = previousLocation.position;
    harness.openPathForNavigation.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveOpen = resolve;
        }),
    );

    const pending = harness.navigation().navigateForwardInHistory();

    act(() => {
      harness
        .recentNavigation()
        .recordNavigationLocationSnapshot(newerLocation);
    });
    resolveOpen(true);
    await act(async () => {
      await pending;
    });

    expect(harness.navigationHistory()).toEqual({
      backStack: [newerLocation],
      forwardStack: [],
    });
    expect(harness.editorRevealTarget()).toEqual(previousLocation);

    harness.unmount();
  });

  it("jumps to a recent location, snapshotting the current spot first and closing the panel", async () => {
    const harness = renderNavigationHistory();
    harness.setActiveDocument(editorDocument(`${ROOT}/current.ts`));
    harness.activeEditorPositionRef.current = { column: 1, lineNumber: 1 };
    act(() => {
      harness.recentNavigation().openRecentLocationsPanel();
    });

    const target: RecentLocation = {
      column: 3,
      line: 10,
      name: "target.ts",
      path: `${ROOT}/target.ts`,
      relativePath: "target.ts",
      snippet: "const x = 1;",
    };

    await act(async () => {
      await harness.navigation().openRecentLocation(target);
    });

    expect(harness.openPathForNavigation).toHaveBeenCalledWith(
      `${ROOT}/target.ts`,
      expect.objectContaining({ readOnly: false }),
    );
    expect(harness.editorRevealTarget()).toEqual({
      path: `${ROOT}/target.ts`,
      position: { column: 3, lineNumber: 10 },
    });
    expect(harness.recentLocationsPanelOpen()).toBe(false);
    expect(harness.navigationHistory().backStack).toEqual([
      { path: `${ROOT}/current.ts`, position: { column: 1, lineNumber: 1 } },
    ]);

    harness.unmount();
  });

  it("does nothing jumping to a recent location without an active workspace", async () => {
    const harness = renderNavigationHistory(null);

    const target: RecentLocation = {
      column: 1,
      line: 1,
      name: "target.ts",
      path: `${ROOT}/target.ts`,
      relativePath: "target.ts",
      snippet: "",
    };

    await act(async () => {
      await harness.navigation().openRecentLocation(target);
    });

    expect(harness.openPathForNavigation).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("forgets a dead recent location and closes the panel when the jump target no longer opens", async () => {
    const harness = renderNavigationHistory();
    harness.openPathForNavigation.mockResolvedValueOnce(false);
    harness.documentsRef.current = {
      [`${ROOT}/dead.ts`]: editorDocument(`${ROOT}/dead.ts`, "x\n"),
    };
    act(() => {
      harness.recentNavigation().recordRecentLocationSnapshot({
        path: `${ROOT}/dead.ts`,
        position: { column: 1, lineNumber: 1 },
      });
    });
    act(() => {
      harness.recentNavigation().openRecentLocationsPanel();
    });

    const target: RecentLocation = {
      column: 1,
      line: 1,
      name: "dead.ts",
      path: `${ROOT}/dead.ts`,
      relativePath: "dead.ts",
      snippet: "x",
    };

    await act(async () => {
      await harness.navigation().openRecentLocation(target);
    });

    expect(harness.recentLocations()).toEqual([]);
    expect(harness.recentLocationsPanelOpen()).toBe(false);
    expect(harness.editorRevealTarget()).toBeNull();

    harness.unmount();
  });

  it("drops the jump result when the workspace switches away mid-navigation", async () => {
    const harness = renderNavigationHistory();
    let resolveOpen: (value: boolean) => void = () => {};
    harness.openPathForNavigation.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveOpen = resolve;
        }),
    );

    const target: RecentLocation = {
      column: 1,
      line: 1,
      name: "target.ts",
      path: `${ROOT}/target.ts`,
      relativePath: "target.ts",
      snippet: "",
    };

    const pending = act(async () => {
      await harness.navigation().openRecentLocation(target);
    });

    harness.setWorkspaceRoot("/other-workspace");
    resolveOpen(true);
    await pending;

    expect(harness.editorRevealTarget()).toBeNull();

    harness.unmount();
  });

  it("cancels a recent-location activation when another owner replaces the same root", async () => {
    const harness = renderNavigationHistory();
    const target: RecentLocation = {
      column: 1,
      line: 1,
      name: "target.ts",
      path: `${ROOT}/target.ts`,
      relativePath: "target.ts",
      snippet: "",
    };
    let activePath = `${ROOT}/current.ts`;
    let resolveOpen: () => void = () => {};

    harness.setActiveDocument(editorDocument(activePath));
    act(() => {
      harness.recentNavigation().openRecentLocationsPanel();
    });
    harness.openPathForNavigation.mockImplementationOnce(
      async (path, options) => {
        await new Promise<void>((resolve) => {
          resolveOpen = resolve;
        });

        if (options?.shouldCommit?.() === false) {
          return false;
        }

        activePath = path;
        return true;
      },
    );

    const pending = harness.navigation().openRecentLocation(target);

    harness.setWorkspaceRuntimeOwner(
      createWorkspaceRuntimeOwner("workspace-b", ROOT),
    );
    resolveOpen();
    await act(async () => {
      await pending;
    });

    expect(activePath).toBe(`${ROOT}/current.ts`);
    expect(harness.editorRevealTarget()).toBeNull();
    expect(harness.recentLocationsPanelOpen()).toBe(true);

    harness.unmount();
  });

  it("preserves recent-location state when a failed open belongs to a replaced owner", async () => {
    const harness = renderNavigationHistory();
    const target: RecentLocation = {
      column: 1,
      line: 1,
      name: "dead.ts",
      path: `${ROOT}/dead.ts`,
      relativePath: "dead.ts",
      snippet: "x",
    };
    let resolveOpen: (opened: boolean) => void = () => {};

    harness.documentsRef.current = {
      [target.path]: editorDocument(target.path, "x\n"),
    };
    act(() => {
      harness.recentNavigation().recordRecentLocationSnapshot({
        path: target.path,
        position: { column: 1, lineNumber: 1 },
      });
      harness.recentNavigation().openRecentLocationsPanel();
    });
    harness.openPathForNavigation.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveOpen = resolve;
        }),
    );

    const pending = harness.navigation().openRecentLocation(target);

    harness.setWorkspaceRuntimeOwner(
      createWorkspaceRuntimeOwner("workspace-b", ROOT),
    );
    resolveOpen(false);
    await act(async () => {
      await pending;
    });

    expect(harness.recentLocations()).toHaveLength(1);
    expect(harness.recentLocationsPanelOpen()).toBe(true);
    expect(harness.editorRevealTarget()).toBeNull();

    harness.unmount();
  });

  it("routes the read-only decision through the injected resolver", async () => {
    const harness = renderNavigationHistory();
    harness.shouldOpenNavigationTargetReadOnly.mockReturnValue(true);

    const target: RecentLocation = {
      column: 1,
      line: 1,
      name: "target.ts",
      path: `${ROOT}/target.ts`,
      relativePath: "target.ts",
      snippet: "",
    };

    await act(async () => {
      await harness.navigation().openRecentLocation(target);
    });

    expect(harness.shouldOpenNavigationTargetReadOnly).toHaveBeenCalledWith(
      ROOT,
      `${ROOT}/target.ts`,
    );
    expect(harness.openPathForNavigation).toHaveBeenCalledWith(
      `${ROOT}/target.ts`,
      expect.objectContaining({ readOnly: true }),
    );

    harness.unmount();
  });
});
