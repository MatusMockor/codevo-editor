// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInitialEditorGroupsState } from "../domain/editorGroups";
import {
  DEFAULT_WORKSPACE_EDITOR_GROUP_ID,
  defaultWorkspaceSettings,
  type WorkspaceSessionState,
} from "../domain/settings";
import { createWorkspaceSettingsSaveCoordinator } from "./workspaceSettingsSaveCoordinator";
import {
  usePersistCurrentWorkspaceSession,
  usePersistWorkspaceNavigationSession,
} from "./useWorkbenchNavigationSessionPersistence";

const ROOT = "/workspace";

describe("workbench navigation session persistence", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits for a pending navigation write and still snapshots editor view state", async () => {
    const coordinator = createWorkspaceSettingsSaveCoordinator();
    const pendingWrite = deferred<void>();
    const snapshotEditorSurface = vi.fn(() => editorSurfaceSnapshot());
    const baseline = defaultWorkspaceSettings();
    const persistedSession = { ...baseline.session, sidebarView: "git" as const };
    const persistWorkspaceSettings = vi.fn(async () => undefined);
    const captured: {
      current: ((rootPath: string) => Promise<void>) | null;
    } = { current: null };
    const root = createRoot(document.createElement("div"));

    coordinator.scheduleNavigationSave(ROOT, () => pendingWrite.promise);

    function Harness() {
      captured.current = usePersistCurrentWorkspaceSession({
        bottomPanelView: "problems",
        editorSessionOwnerKeyForRoot: (rootPath) => rootPath,
        persistWorkspaceSettings,
        reportErrorForActiveWorkspaceRoot: vi.fn(),
        sidebarView: "files",
        snapshotEditorSurface,
        snapshotPersistedWorkspaceSession: () => persistedSession,
        workspaceEditorViewStatesRef: { current: {} },
        workspaceSessionRestoredRef: { current: true },
        workspaceSettingsRef: { current: baseline },
        workspaceSettingsSaveCoordinator: coordinator,
      });
      return null;
    }

    act(() => {
      root.render(<Harness />);
    });

    const persistCurrentWorkspaceSession = captured.current;
    if (!persistCurrentWorkspaceSession) {
      throw new Error("Persistence hook was not mounted.");
    }

    let settled = false;
    const persistence = persistCurrentWorkspaceSession(ROOT).then(() => {
      settled = true;
    });
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(snapshotEditorSurface).not.toHaveBeenCalled();

    pendingWrite.resolve();
    await persistence;

    expect(snapshotEditorSurface).toHaveBeenCalledWith(ROOT);
    expect(persistWorkspaceSettings).toHaveBeenCalledWith(ROOT, {
      ...baseline,
      session: persistedSession,
    });

    act(() => {
      root.unmount();
    });
  });

  it("cancels a stale debounced save before immediate session persistence", async () => {
    vi.useFakeTimers();
    const coordinator = createWorkspaceSettingsSaveCoordinator();
    const staleSave = vi.fn(async () => undefined);
    const baseline = defaultWorkspaceSettings();
    const persistedSession = { ...baseline.session, sidebarView: "git" as const };
    const persistWorkspaceSettings = vi.fn(async () => undefined);
    const root = createRoot(document.createElement("div"));

    coordinator.scheduleNavigationSave(ROOT, staleSave);

    function Harness() {
      usePersistWorkspaceNavigationSession({
        bottomPanelView: "problems",
        documents: {},
        editorGroups: createInitialEditorGroupsState(DEFAULT_WORKSPACE_EDITOR_GROUP_ID),
        editorSessionOwnerKeyForRoot: (rootPath) => rootPath,
        persistWorkspaceSettings,
        reportErrorForActiveWorkspaceRoot: vi.fn(),
        sidebarView: "files",
        snapshotPersistedWorkspaceSession: () => persistedSession,
        workspaceEditorViewStatesRef: { current: {} },
        workspaceRoot: ROOT,
        workspaceSessionRestoredRef: { current: true },
        workspaceSettingsRef: { current: baseline },
        workspaceSettingsSaveCoordinator: coordinator,
      });
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });

    expect(persistWorkspaceSettings).toHaveBeenCalledWith(ROOT, {
      ...baseline,
      session: persistedSession,
    });
    expect(coordinator.hasScheduledNavigationSave(ROOT)).toBe(false);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(staleSave).not.toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
  });

  it("debounces an activation-only session change instead of persisting it synchronously", async () => {
    vi.useFakeTimers();
    const coordinator = createWorkspaceSettingsSaveCoordinator();
    const baseline = {
      ...defaultWorkspaceSettings(),
      session: sessionWithActivePath("/workspace/a.ts"),
    };
    const activatedSession = sessionWithActivePath("/workspace/b.ts");
    const persistWorkspaceSettings = vi.fn(async () => undefined);
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <NavigationSessionHarness
          coordinator={coordinator}
          persistWorkspaceSettings={persistWorkspaceSettings}
          session={activatedSession}
          settings={baseline}
        />,
      );
      await Promise.resolve();
    });

    expect(persistWorkspaceSettings).not.toHaveBeenCalled();
    expect(coordinator.hasScheduledNavigationSave(ROOT)).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(persistWorkspaceSettings).toHaveBeenCalledTimes(1);
    expect(persistWorkspaceSettings).toHaveBeenCalledWith(ROOT, {
      ...baseline,
      session: activatedSession,
    });

    act(() => {
      root.unmount();
    });
  });

  it("freezes the settings body captured at schedule time, so a ref repointed by a workspace switch cannot leak into the flushed write", async () => {
    vi.useFakeTimers();
    const coordinator = createWorkspaceSettingsSaveCoordinator();
    const settingsA = {
      ...defaultWorkspaceSettings(),
      eslintPath: "eslint-a",
      session: sessionWithActivePath("/workspace/a.ts"),
    };
    const settingsB = {
      ...defaultWorkspaceSettings(),
      eslintPath: "eslint-b",
      session: sessionWithActivePath("/other/x.ts"),
    };
    const activatedSession = sessionWithActivePath("/workspace/b.ts");
    const persistWorkspaceSettings = vi.fn(async () => undefined);
    const workspaceSettingsRef = { current: settingsA };
    const root = createRoot(document.createElement("div"));

    function Harness() {
      usePersistWorkspaceNavigationSession({
        bottomPanelView: "problems",
        documents: {},
        editorGroups: createInitialEditorGroupsState(DEFAULT_WORKSPACE_EDITOR_GROUP_ID),
        editorSessionOwnerKeyForRoot: (rootPath) => rootPath,
        persistWorkspaceSettings,
        reportErrorForActiveWorkspaceRoot: vi.fn(),
        sidebarView: "files",
        snapshotPersistedWorkspaceSession: () => activatedSession,
        workspaceEditorViewStatesRef: { current: {} },
        workspaceRoot: ROOT,
        workspaceSessionRestoredRef: { current: true },
        workspaceSettingsRef,
        workspaceSettingsSaveCoordinator: coordinator,
      });
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });

    expect(persistWorkspaceSettings).not.toHaveBeenCalled();
    expect(coordinator.hasScheduledNavigationSave(ROOT)).toBe(true);

    workspaceSettingsRef.current = settingsB;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(persistWorkspaceSettings).toHaveBeenCalledTimes(1);
    expect(persistWorkspaceSettings).toHaveBeenCalledWith(ROOT, {
      ...settingsA,
      session: activatedSession,
    });

    act(() => {
      root.unmount();
    });
  });

  it("rechecks same-root serialization after idle settles and never reverts a save enqueued in that gap", async () => {
    vi.useFakeTimers();
    const coordinator = createWorkspaceSettingsSaveCoordinator();
    const baseline = {
      ...defaultWorkspaceSettings(),
      eslintPath: "eslint-before",
      session: sessionWithActivePath("/workspace/a.ts"),
    };
    const newerSettings = {
      ...baseline,
      eslintPath: "eslint-after",
      javaScriptTypeScriptValidation: false,
    };
    const newestSettings = {
      ...newerSettings,
      eslintPath: "eslint-newest",
      javaScriptTypeScriptValidation: true,
    };
    const activatedSession = sessionWithActivePath("/workspace/b.ts");
    const newerSettingsWrite = deferred<void>();
    const newestSettingsWrite = deferred<void>();
    let newestSettingsSave: Promise<void> | null = null;
    const persistWorkspaceSettings = vi.fn(async () => undefined);
    const root = createRoot(document.createElement("div"));

    coordinator.captureCommitted(ROOT, baseline);
    const waitForIdle = coordinator.waitForIdle.bind(coordinator);
    let enqueueNewestSettingsAfterIdle = true;
    coordinator.waitForIdle = (rootPath) => {
      const pending = waitForIdle(rootPath);
      if (!pending || !enqueueNewestSettingsAfterIdle) {
        return pending;
      }

      enqueueNewestSettingsAfterIdle = false;
      return pending.then(() => {
        newestSettingsSave = coordinator.save(
          ROOT,
          newerSettings,
          newestSettings,
          () => newestSettingsWrite.promise,
        );
      });
    };

    await act(async () => {
      root.render(
        <NavigationSessionHarness
          coordinator={coordinator}
          persistWorkspaceSettings={persistWorkspaceSettings}
          session={activatedSession}
          settings={baseline}
        />,
      );
      await Promise.resolve();
    });

    const newerSettingsSave = coordinator.save(
      ROOT,
      baseline,
      newerSettings,
      () => newerSettingsWrite.promise,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    newerSettingsWrite.resolve();
    await newerSettingsSave;
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(newestSettingsSave).not.toBeNull();
    expect(persistWorkspaceSettings).not.toHaveBeenCalled();

    newestSettingsWrite.resolve();
    await newestSettingsSave;
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(persistWorkspaceSettings).toHaveBeenCalledTimes(1);
    expect(persistWorkspaceSettings).toHaveBeenCalledWith(ROOT, {
      ...newestSettings,
      session: activatedSession,
    });

    act(() => {
      root.unmount();
    });
  });

  it("drops an activation save superseded while it waits for same-root settings serialization", async () => {
    vi.useFakeTimers();
    const coordinator = createWorkspaceSettingsSaveCoordinator();
    const baseline = {
      ...defaultWorkspaceSettings(),
      session: sessionWithActivePath("/workspace/a.ts"),
    };
    const blockingSettingsWrite = deferred<void>();
    const persistWorkspaceSettings = vi.fn(async () => undefined);
    const root = createRoot(document.createElement("div"));

    coordinator.captureCommitted(ROOT, baseline);
    const blockingSettingsSave = coordinator.save(
      ROOT,
      baseline,
      { ...baseline, eslintPath: "latest-eslint" },
      () => blockingSettingsWrite.promise,
    );

    await act(async () => {
      root.render(
        <NavigationSessionHarness
          coordinator={coordinator}
          persistWorkspaceSettings={persistWorkspaceSettings}
          session={sessionWithActivePath("/workspace/b.ts")}
          settings={baseline}
        />,
      );
      await vi.advanceTimersByTimeAsync(1_000);
    });

    await act(async () => {
      root.render(
        <NavigationSessionHarness
          coordinator={coordinator}
          persistWorkspaceSettings={persistWorkspaceSettings}
          session={sessionWithActivePath("/workspace/a.ts")}
          settings={baseline}
        />,
      );
      await vi.advanceTimersByTimeAsync(1_000);
    });

    blockingSettingsWrite.resolve();
    await blockingSettingsSave;
    await act(async () => {
      await coordinator.flushNavigationSave(ROOT);
    });

    expect(persistWorkspaceSettings).toHaveBeenCalledTimes(1);
    expect(persistWorkspaceSettings).toHaveBeenCalledWith(
      ROOT,
      expect.objectContaining({ session: sessionWithActivePath("/workspace/a.ts") }),
    );

    act(() => {
      root.unmount();
    });
  });

  it("flushes a pending activation save when the workspace root is replaced", async () => {
    vi.useFakeTimers();
    const coordinator = createWorkspaceSettingsSaveCoordinator();
    const baseline = {
      ...defaultWorkspaceSettings(),
      session: sessionWithActivePath("/workspace/a.ts"),
    };
    const activatedSession = sessionWithActivePath("/workspace/b.ts");
    const persistWorkspaceSettings = vi.fn(async () => undefined);
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      root.render(
        <NavigationSessionHarness
          coordinator={coordinator}
          persistWorkspaceSettings={persistWorkspaceSettings}
          session={activatedSession}
          settings={baseline}
        />,
      );
      await Promise.resolve();
    });

    expect(persistWorkspaceSettings).not.toHaveBeenCalled();

    await act(async () => {
      root.render(
        <NavigationSessionHarness
          coordinator={coordinator}
          persistWorkspaceSettings={persistWorkspaceSettings}
          session={activatedSession}
          settings={baseline}
          workspaceRoot="/other-workspace"
        />,
      );
      await Promise.resolve();
    });

    expect(persistWorkspaceSettings).toHaveBeenCalledWith(ROOT, {
      ...baseline,
      session: activatedSession,
    });

    act(() => {
      root.unmount();
    });
  });
});

function NavigationSessionHarness({
  coordinator,
  persistWorkspaceSettings,
  session,
  settings,
  workspaceRoot = ROOT,
}: {
  coordinator: ReturnType<typeof createWorkspaceSettingsSaveCoordinator>;
  persistWorkspaceSettings: (rootPath: string, nextSettings: unknown) => Promise<void>;
  session: WorkspaceSessionState;
  settings: ReturnType<typeof defaultWorkspaceSettings>;
  workspaceRoot?: string;
}) {
  usePersistWorkspaceNavigationSession({
    bottomPanelView: "problems",
    documents: {},
    editorGroups: createInitialEditorGroupsState(DEFAULT_WORKSPACE_EDITOR_GROUP_ID),
    editorSessionOwnerKeyForRoot: (rootPath) => rootPath,
    persistWorkspaceSettings,
    reportErrorForActiveWorkspaceRoot: vi.fn(),
    sidebarView: "files",
    snapshotPersistedWorkspaceSession: () => session,
    workspaceEditorViewStatesRef: { current: {} },
    workspaceRoot,
    workspaceSessionRestoredRef: { current: true },
    workspaceSettingsRef: { current: settings },
    workspaceSettingsSaveCoordinator: coordinator,
  });
  return null;
}

function sessionWithActivePath(activePath: string): WorkspaceSessionState {
  const baseSession = defaultWorkspaceSettings().session;
  return {
    ...baseSession,
    editor: {
      ...baseSession.editor,
      groups: {
        [DEFAULT_WORKSPACE_EDITOR_GROUP_ID]: {
          activePath,
          openPaths: ["/workspace/a.ts", "/workspace/b.ts"],
          previewPath: null,
        },
      },
    },
  };
}

function editorSurfaceSnapshot() {
  return {
    activePath: null,
    documents: {},
    editorGroups: createInitialEditorGroupsState(DEFAULT_WORKSPACE_EDITOR_GROUP_ID),
    imageTabs: {},
    markdownPreviewTabs: {},
    openPaths: [],
    previewPath: null,
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
