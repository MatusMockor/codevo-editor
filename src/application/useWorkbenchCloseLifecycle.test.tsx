// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultAppSettings, type AppSettings } from "../domain/settings";
import type { EditorDocument } from "../domain/workspace";
import {
  useWorkbenchCloseLifecycle,
  type WorkbenchCloseLifecycle,
  type WorkbenchCloseLifecycleDependencies,
} from "./useWorkbenchCloseLifecycle";
import { DOCUMENT_SYNC_CLOSE_GRACE_MS } from "./closeCoordinator";

const tauriMocks = vi.hoisted(() => ({
  closeWindow: vi.fn(async () => undefined),
  invoke: vi.fn(async () => undefined),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauriMocks.invoke,
  isTauri: () => true,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    close: tauriMocks.closeWindow,
  }),
}));

const WORKSPACE_A = "/workspace-a";
const WORKSPACE_B = "/workspace-b";

afterEach(() => {
  vi.useRealTimers();
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
}

function dirtyDocument(path: string): EditorDocument {
  return {
    content: "edited",
    language: "php",
    name: path.split("/").pop() ?? path,
    path,
    savedContent: "saved",
  };
}

interface Harness {
  appSettingsRef: { current: AppSettings };
  closeSyncedJavaScriptTypeScriptDocumentsForRoot: ReturnType<typeof vi.fn>;
  closeSyncedLanguageServerDocumentsForRoot: ReturnType<typeof vi.fn>;
  lifecycle: () => WorkbenchCloseLifecycle;
  persistAppSettings: ReturnType<typeof vi.fn>;
  prompter: { confirm: ReturnType<typeof vi.fn>; prompt: ReturnType<typeof vi.fn> };
  stopProjectRuntimes: ReturnType<typeof vi.fn>;
  unmount: () => void;
  workspaceStateCacheRef: {
    current: WorkbenchCloseLifecycleDependencies["workspaceStateCacheRef"]["current"];
  };
}

function renderLifecycle(
  overrides: Partial<WorkbenchCloseLifecycleDependencies> = {},
): Harness {
  const container = globalThis.document.createElement("div");
  const root = createRoot(container);
  const captured: { lifecycle: WorkbenchCloseLifecycle | null } = {
    lifecycle: null,
  };
  const appSettingsRef: { current: AppSettings } = {
    current: {
      ...defaultAppSettings(),
      recentWorkspacePath: WORKSPACE_B,
      workspaceTabs: [WORKSPACE_A, WORKSPACE_B],
    },
  };
  const workspaceStateCacheRef = {
    current: {},
  };
  const editorConfigCacheRef = {
    current: {},
  };
  const prompter = { confirm: vi.fn(() => true), prompt: vi.fn(() => null) };
  const persistAppSettings = vi.fn(async (settings: AppSettings) => {
    appSettingsRef.current = settings;
  });
  const closeSyncedLanguageServerDocumentsForRoot = vi.fn(
    async () => undefined,
  );
  const closeSyncedJavaScriptTypeScriptDocumentsForRoot = vi.fn(
    async () => undefined,
  );
  const stopProjectRuntimes = vi.fn(async () => undefined);

  const dependencies: WorkbenchCloseLifecycleDependencies = {
    appSettingsRef,
    clearActiveWorkspace: vi.fn(async () => undefined),
    clearExternalFileConflictsForRoot: vi.fn(),
    closeSyncedJavaScriptTypeScriptDocumentsForRoot,
    closeSyncedLanguageServerDocumentsForRoot,
    dirtyCount: 0,
    editorConfigCacheRef,
    editorGitBaselineRequestTokenRef: { current: 0 },
    forgetLanguageServerRuntimeStatuses: vi.fn(),
    forgetLatencyTrackerForRoot: vi.fn(),
    gitDiffRequestTokenRef: { current: 0 },
    openFileRequestTokenRef: { current: 0 },
    openWorkspacePath: vi.fn(async () => undefined),
    openWorkspaceRequestPathRef: { current: null },
    openWorkspaceRequestTokenRef: { current: 0 },
    persistAppSettings,
    prompter,
    reportError: vi.fn(),
    stopProjectRuntimes,
    workspaceRoot: WORKSPACE_B,
    workspaceStateCacheRef,
    workspaceIdentityByRootRef: { current: {} },
    unregisterWorkspace: vi.fn(async () => undefined),
    workspaceHasExternalFileConflicts: vi.fn(() => false),
    ...overrides,
  };

  function TestHost(): null {
    captured.lifecycle = useWorkbenchCloseLifecycle(dependencies);
    return null;
  }

  act(() => {
    root.render(<TestHost />);
  });

  return {
    appSettingsRef,
    closeSyncedJavaScriptTypeScriptDocumentsForRoot,
    closeSyncedLanguageServerDocumentsForRoot,
    lifecycle: () => {
      if (!captured.lifecycle) {
        throw new Error("Lifecycle not rendered");
      }

      return captured.lifecycle;
    },
    persistAppSettings,
    prompter,
    stopProjectRuntimes,
    unmount: () => root.unmount(),
    workspaceStateCacheRef,
  };
}

describe("useWorkbenchCloseLifecycle", () => {
  it("unregisters the opaque identity when its workspace tab closes", async () => {
    const unregisterWorkspace = vi.fn(async () => undefined);
    const descriptor = {
      workspaceId: "ws-a",
      selectedPath: WORKSPACE_A,
      canonicalRoot: "/real/workspace-a",
      caseSensitive: null,
      unicodeNormalizationPolicy: "unknown" as const,
      policy: { caseSensitive: true as const, unicodeNormalization: "none" as const },
    };
    const harness = renderLifecycle({
      unregisterWorkspace,
      workspaceIdentityByRootRef: {
        current: {
          [WORKSPACE_A]: descriptor,
          [descriptor.canonicalRoot]: descriptor,
        },
      },
    });

    await act(async () => {
      await harness.lifecycle().closeWorkspaceTab(WORKSPACE_A);
    });

    expect(unregisterWorkspace).toHaveBeenCalledOnce();
    expect(unregisterWorkspace).toHaveBeenCalledWith("ws-a");
  });

  it("keeps descriptor and resources alive when settings persistence fails", async () => {
    const unregisterWorkspace = vi.fn(async () => undefined);
    const clearExternalFileConflictsForRoot = vi.fn();
    const descriptor = {
      workspaceId: "ws-a",
      selectedPath: WORKSPACE_A,
      canonicalRoot: "/real/workspace-a",
      caseSensitive: true,
      unicodeNormalizationPolicy: "preserved" as const,
      policy: { caseSensitive: true as const, unicodeNormalization: "none" as const },
    };
    const identities = { [WORKSPACE_A]: descriptor };
    const harness = renderLifecycle({
      clearExternalFileConflictsForRoot,
      persistAppSettings: vi.fn(async () => {
        throw new Error("settings failed");
      }),
      unregisterWorkspace,
      workspaceIdentityByRootRef: { current: identities },
    });
    harness.workspaceStateCacheRef.current[WORKSPACE_A] = { documents: {} };

    await act(async () => {
      await harness.lifecycle().closeWorkspaceTab(WORKSPACE_A);
    });

    expect(unregisterWorkspace).not.toHaveBeenCalled();
    expect(clearExternalFileConflictsForRoot).not.toHaveBeenCalled();
    expect(identities[WORKSPACE_A]).toBe(descriptor);
    expect(harness.workspaceStateCacheRef.current[WORKSPACE_A]).toBeDefined();
    expect(harness.stopProjectRuntimes).not.toHaveBeenCalled();
  });

  it("prompts for a conflict-only inactive workspace and preserves it when declined", async () => {
    const harness = renderLifecycle({
      workspaceHasExternalFileConflicts: vi.fn((root) => root === WORKSPACE_A),
    });
    harness.workspaceStateCacheRef.current[WORKSPACE_A] = { documents: {} };
    harness.prompter.confirm.mockReturnValueOnce(false);

    await act(async () => {
      await harness.lifecycle().closeWorkspaceTab(WORKSPACE_A);
    });

    expect(harness.prompter.confirm).toHaveBeenCalledWith(
      "Close workspace and discard unsaved changes?",
    );
    expect(harness.persistAppSettings).not.toHaveBeenCalled();
  });

  it("keeps an inactive dirty workspace tab when discard is declined", async () => {
    const harness = renderLifecycle();
    harness.workspaceStateCacheRef.current[WORKSPACE_A] = {
      documents: {
        [`${WORKSPACE_A}/src/Dirty.php`]: dirtyDocument(
          `${WORKSPACE_A}/src/Dirty.php`,
        ),
      },
    };
    harness.prompter.confirm.mockReturnValueOnce(false);

    await act(async () => {
      await harness.lifecycle().closeWorkspaceTab(WORKSPACE_A);
    });

    expect(harness.prompter.confirm).toHaveBeenCalledWith(
      "Close workspace and discard unsaved changes?",
    );
    expect(harness.persistAppSettings).not.toHaveBeenCalled();
    expect(harness.stopProjectRuntimes).not.toHaveBeenCalled();
    expect(harness.appSettingsRef.current.workspaceTabs).toEqual([
      WORKSPACE_A,
      WORKSPACE_B,
    ]);
    harness.unmount();
  });

  it("closes synced documents before stopping an inactive workspace runtime", async () => {
    const phpClosed = createDeferred<void>();
    const jsClosed = createDeferred<void>();
    const closePhpDocuments = vi.fn(() => phpClosed.promise);
    const closeJavaScriptTypeScriptDocuments = vi.fn(() => jsClosed.promise);
    const harness = renderLifecycle({
      closeSyncedJavaScriptTypeScriptDocumentsForRoot:
        closeJavaScriptTypeScriptDocuments,
      closeSyncedLanguageServerDocumentsForRoot: closePhpDocuments,
    });

    let closePromise!: Promise<void>;

    await act(async () => {
      closePromise = harness.lifecycle().closeWorkspaceTab(WORKSPACE_A);
      await Promise.resolve();
    });

    expect(harness.stopProjectRuntimes).not.toHaveBeenCalled();

    phpClosed.resolve();
    jsClosed.resolve();

    await act(async () => {
      await closePromise;
    });

    expect(closePhpDocuments).toHaveBeenCalledWith(WORKSPACE_A);
    expect(closeJavaScriptTypeScriptDocuments).toHaveBeenCalledWith(WORKSPACE_A);
    expect(harness.stopProjectRuntimes).toHaveBeenCalledWith(WORKSPACE_A);
    expect(harness.persistAppSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        recentWorkspacePath: WORKSPACE_B,
        workspaceTabs: [WORKSPACE_B],
      }),
    );
    harness.unmount();
  });

  it("stops workspace runtimes when synced document close hangs", async () => {
    vi.useFakeTimers();
    const neverClosed = new Promise<void>(() => undefined);
    const closePhpDocuments = vi.fn(() => neverClosed);
    const closeJavaScriptTypeScriptDocuments = vi.fn(async () => undefined);
    const harness = renderLifecycle({
      closeSyncedJavaScriptTypeScriptDocumentsForRoot:
        closeJavaScriptTypeScriptDocuments,
      closeSyncedLanguageServerDocumentsForRoot: closePhpDocuments,
    });

    await act(async () => {
      const closePromise = harness.lifecycle().closeWorkspaceTab(WORKSPACE_A);
      await Promise.resolve();
      expect(harness.stopProjectRuntimes).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(DOCUMENT_SYNC_CLOSE_GRACE_MS);
      await closePromise;
    });

    expect(closePhpDocuments).toHaveBeenCalledWith(WORKSPACE_A);
    expect(closeJavaScriptTypeScriptDocuments).toHaveBeenCalledWith(WORKSPACE_A);
    expect(harness.stopProjectRuntimes).toHaveBeenCalledWith(WORKSPACE_A);
    harness.unmount();
  });

  it("stops workspace runtimes when synced document close fails", async () => {
    const closePhpDocuments = vi.fn(async () => {
      throw new Error("close failed");
    });
    const harness = renderLifecycle({
      closeSyncedLanguageServerDocumentsForRoot: closePhpDocuments,
    });

    await act(async () => {
      await harness.lifecycle().closeWorkspaceTab(WORKSPACE_A);
    });

    expect(closePhpDocuments).toHaveBeenCalledWith(WORKSPACE_A);
    expect(harness.stopProjectRuntimes).toHaveBeenCalledWith(WORKSPACE_A);
    harness.unmount();
  });

  it("persists the active workspace session before closing the Tauri window", async () => {
    const persistWorkspaceSession = vi.fn(async () => undefined);
    const harness = renderLifecycle({ persistWorkspaceSession });
    tauriMocks.closeWindow.mockClear();

    await act(async () => {
      harness.lifecycle().closeApplicationWindow();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(persistWorkspaceSession).toHaveBeenCalledWith(WORKSPACE_B);
    expect(tauriMocks.closeWindow).toHaveBeenCalledTimes(1);
    harness.unmount();
  });
});
