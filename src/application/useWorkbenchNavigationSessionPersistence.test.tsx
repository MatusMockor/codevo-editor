// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInitialEditorGroupsState } from "../domain/editorGroups";
import {
  DEFAULT_WORKSPACE_EDITOR_GROUP_ID,
  defaultWorkspaceSettings,
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
});

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
