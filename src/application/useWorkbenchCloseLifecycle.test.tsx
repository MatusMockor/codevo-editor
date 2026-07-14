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
  invoke: vi.fn<(command: string, args?: unknown) => Promise<void>>(
    async () => undefined,
  ),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauriMocks.invoke,
  isTauri: () => true,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    async (event: string, handler: (event: { payload: unknown }) => void) => {
      tauriMocks.listeners.set(event, handler);
      return () => tauriMocks.listeners.delete(event);
    },
  ),
}));

const WORKSPACE_A = "/workspace-a";
const WORKSPACE_B = "/workspace-b";

afterEach(() => {
  vi.useRealTimers();
  tauriMocks.invoke.mockReset();
  tauriMocks.invoke.mockResolvedValue(undefined);
  tauriMocks.listeners.clear();
});

function requestNativeClose(kind: "close" | "quit" = "close"): void {
  tauriMocks.listeners.get("mockor-native-close-requested")?.({
    payload: kind,
  });
}

function nativeShutdownInvocationCount(): number {
  return tauriMocks.invoke.mock.calls.filter(
    ([command]) => command === "confirm_native_shutdown",
  ).length;
}

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

function cleanDocument(path: string): EditorDocument {
  return {
    ...dirtyDocument(path),
    savedContent: "edited",
  };
}

interface Harness {
  appSettingsRef: { current: AppSettings };
  closeSyncedJavaScriptTypeScriptDocumentsForRoot: ReturnType<typeof vi.fn>;
  closeSyncedLanguageServerDocumentsForRoot: ReturnType<typeof vi.fn>;
  lifecycle: () => WorkbenchCloseLifecycle;
  persistAppSettings: ReturnType<typeof vi.fn>;
  prompter: {
    confirm: ReturnType<typeof vi.fn>;
    prompt: ReturnType<typeof vi.fn>;
  };
  reportError: ReturnType<typeof vi.fn>;
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
  const reportError = vi.fn();

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
    reportError,
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
    prompter: dependencies.prompter as Harness["prompter"],
    reportError: dependencies.reportError as Harness["reportError"],
    stopProjectRuntimes,
    unmount: () => root.unmount(),
    workspaceStateCacheRef,
  };
}

describe("useWorkbenchCloseLifecycle", () => {
  it("advertises native close listener readiness while mounted", async () => {
    const harness = renderLifecycle();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(tauriMocks.invoke).toHaveBeenCalledWith(
      "set_native_close_listener_ready",
      { ready: true },
    );

    act(() => harness.unmount());

    expect(tauriMocks.invoke).toHaveBeenCalledWith(
      "set_native_close_listener_ready",
      { ready: false },
    );
  });

  it("unregisters the opaque identity when its workspace tab closes", async () => {
    const unregisterWorkspace = vi.fn(async () => undefined);
    const descriptor = {
      workspaceId: "ws-a",
      selectedPath: WORKSPACE_A,
      canonicalRoot: "/real/workspace-a",
      caseSensitive: null,
      unicodeNormalizationPolicy: "unknown" as const,
      policy: {
        caseSensitive: true as const,
        unicodeNormalization: "none" as const,
      },
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
      policy: {
        caseSensitive: true as const,
        unicodeNormalization: "none" as const,
      },
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
    harness.workspaceStateCacheRef.current[WORKSPACE_A] = {
      editorSurface: { documents: {} },
    };

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
    harness.workspaceStateCacheRef.current[WORKSPACE_A] = {
      editorSurface: { documents: {} },
    };
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
      editorSurface: {
        documents: {
          [`${WORKSPACE_A}/src/Dirty.php`]: dirtyDocument(
            `${WORKSPACE_A}/src/Dirty.php`,
          ),
        },
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
    expect(closeJavaScriptTypeScriptDocuments).toHaveBeenCalledWith(
      WORKSPACE_A,
    );
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
    expect(closeJavaScriptTypeScriptDocuments).toHaveBeenCalledWith(
      WORKSPACE_A,
    );
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

    await act(async () => {
      harness.lifecycle().closeApplicationWindow();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(persistWorkspaceSession).toHaveBeenCalledWith(WORKSPACE_B);
    expect(tauriMocks.invoke).toHaveBeenCalledWith("confirm_native_shutdown", {
      kind: "close",
    });
    harness.unmount();
  });

  it("blocks a keyboard quit when active dirty changes are not confirmed", async () => {
    const persistWorkspaceSession = vi.fn(async () => undefined);
    const harness = renderLifecycle({
      dirtyCount: 1,
      persistWorkspaceSession,
      prompter: { confirm: vi.fn(() => false), prompt: vi.fn(() => null) },
    });

    await act(async () => {
      harness.lifecycle().quitApplication();
    });

    expect(harness.prompter.confirm).toHaveBeenCalledOnce();
    expect(harness.prompter.confirm).toHaveBeenCalledWith(
      "Quit and discard unsaved changes?",
    );
    expect(persistWorkspaceSession).not.toHaveBeenCalled();
    expect(tauriMocks.invoke).not.toHaveBeenCalledWith("quit_application");
    harness.unmount();
  });

  it("persists and quits when active dirty changes are confirmed", async () => {
    const persistWorkspaceSession = vi.fn(async () => undefined);
    const harness = renderLifecycle({
      dirtyCount: 1,
      persistWorkspaceSession,
    });

    await act(async () => {
      harness.lifecycle().quitApplication();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(harness.prompter.confirm).toHaveBeenCalledOnce();
    expect(persistWorkspaceSession).toHaveBeenCalledWith(WORKSPACE_B);
    expect(tauriMocks.invoke).toHaveBeenCalledWith("quit_application");
    harness.unmount();
  });

  it("blocks shutdown for dirty documents in an inactive cached workspace", async () => {
    const persistWorkspaceSession = vi.fn(async () => undefined);
    const harness = renderLifecycle({ persistWorkspaceSession });
    harness.workspaceStateCacheRef.current[WORKSPACE_A] = {
      editorSurface: {
        documents: {
          [`${WORKSPACE_A}/src/Dirty.php`]: dirtyDocument(
            `${WORKSPACE_A}/src/Dirty.php`,
          ),
        },
      },
    };
    harness.prompter.confirm.mockReturnValueOnce(false);

    await act(async () => {
      requestNativeClose("quit");
    });

    expect(harness.prompter.confirm).toHaveBeenCalledOnce();
    expect(persistWorkspaceSession).not.toHaveBeenCalled();
    expect(nativeShutdownInvocationCount()).toBe(0);
    harness.unmount();
  });

  it("blocks shutdown for conflicts in an inactive cached workspace", async () => {
    const persistWorkspaceSession = vi.fn(async () => undefined);
    const harness = renderLifecycle({
      persistWorkspaceSession,
      workspaceHasExternalFileConflicts: vi.fn(
        (root) => root === WORKSPACE_A,
      ),
    });
    harness.workspaceStateCacheRef.current[WORKSPACE_A] = {
      editorSurface: { documents: {} },
    };
    harness.prompter.confirm.mockReturnValueOnce(false);

    await act(async () => {
      harness.lifecycle().closeApplicationWindow();
    });

    expect(harness.prompter.confirm).toHaveBeenCalledOnce();
    expect(persistWorkspaceSession).not.toHaveBeenCalled();
    expect(nativeShutdownInvocationCount()).toBe(0);
    harness.unmount();
  });

  it("does not treat an active workspace cache alias as inactive", async () => {
    const persistWorkspaceSession = vi.fn(async () => undefined);
    const workspaceHasExternalFileConflicts = vi.fn(() => false);
    const harness = renderLifecycle({
      persistWorkspaceSession,
      workspaceHasExternalFileConflicts,
    });
    harness.workspaceStateCacheRef.current[`${WORKSPACE_B}/`] = {
      editorSurface: {
        documents: {
          [`${WORKSPACE_B}/src/Stale.php`]: dirtyDocument(
            `${WORKSPACE_B}/src/Stale.php`,
          ),
        },
      },
    };

    await act(async () => {
      requestNativeClose();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(harness.prompter.confirm).not.toHaveBeenCalled();
    expect(workspaceHasExternalFileConflicts).toHaveBeenCalledTimes(1);
    expect(nativeShutdownInvocationCount()).toBe(1);
    harness.unmount();
  });

  it("merges inactive cache aliases and checks every exact conflict key", async () => {
    const persistWorkspaceSession = vi.fn(async () => undefined);
    const workspaceHasExternalFileConflicts = vi.fn(() => false);
    const harness = renderLifecycle({
      persistWorkspaceSession,
      workspaceHasExternalFileConflicts,
    });
    harness.workspaceStateCacheRef.current[WORKSPACE_A] = {
      editorSurface: { documents: {} },
    };
    harness.workspaceStateCacheRef.current[`${WORKSPACE_A}/`] = {
      editorSurface: {
        documents: {
          [`${WORKSPACE_A}/src/Dirty.php`]: dirtyDocument(
            `${WORKSPACE_A}/src/Dirty.php`,
          ),
        },
      },
    };
    harness.prompter.confirm.mockReturnValueOnce(false);

    await act(async () => {
      requestNativeClose();
    });

    expect(harness.prompter.confirm).toHaveBeenCalledOnce();
    expect(workspaceHasExternalFileConflicts).toHaveBeenCalledTimes(3);
    expect(workspaceHasExternalFileConflicts).toHaveBeenNthCalledWith(
      2,
      WORKSPACE_A,
    );
    expect(workspaceHasExternalFileConflicts).toHaveBeenNthCalledWith(
      3,
      `${WORKSPACE_A}/`,
    );
    expect(persistWorkspaceSession).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("blocks shutdown for a conflict on an alternate clean cache alias", async () => {
    const persistWorkspaceSession = vi.fn(async () => undefined);
    const alternateRoot = `${WORKSPACE_A}/`;
    const workspaceHasExternalFileConflicts = vi.fn(
      (root) => root === alternateRoot,
    );
    const harness = renderLifecycle({
      persistWorkspaceSession,
      workspaceHasExternalFileConflicts,
    });
    harness.workspaceStateCacheRef.current[WORKSPACE_A] = {
      editorSurface: {
        documents: {
          [`${WORKSPACE_A}/src/Clean.php`]: cleanDocument(
            `${WORKSPACE_A}/src/Clean.php`,
          ),
        },
      },
    };
    harness.workspaceStateCacheRef.current[alternateRoot] = {
      editorSurface: { documents: {} },
    };
    harness.prompter.confirm.mockReturnValueOnce(false);

    await act(async () => {
      requestNativeClose();
    });

    expect(harness.prompter.confirm).toHaveBeenCalledOnce();
    expect(workspaceHasExternalFileConflicts).toHaveBeenCalledWith(
      alternateRoot,
    );
    expect(persistWorkspaceSession).not.toHaveBeenCalled();
    expect(nativeShutdownInvocationCount()).toBe(0);
    harness.unmount();
  });

  it("blocks a native close when dirty changes are not confirmed", async () => {
    const persistWorkspaceSession = vi.fn(async () => undefined);
    const harness = renderLifecycle({
      dirtyCount: 1,
      persistWorkspaceSession,
      prompter: { confirm: vi.fn(() => false), prompt: vi.fn(() => null) },
    });

    await act(async () => {
      requestNativeClose();
      requestNativeClose();
    });

    expect(harness.prompter.confirm).toHaveBeenCalledTimes(1);
    expect(persistWorkspaceSession).not.toHaveBeenCalled();
    expect(nativeShutdownInvocationCount()).toBe(0);
    harness.unmount();
  });

  it("persists the session and confirms a clean native close", async () => {
    const persistWorkspaceSession = vi.fn(async () => undefined);
    const harness = renderLifecycle({ persistWorkspaceSession });

    await act(async () => {
      requestNativeClose();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(persistWorkspaceSession).toHaveBeenCalledWith(WORKSPACE_B);
    expect(tauriMocks.invoke).toHaveBeenCalledWith("confirm_native_shutdown", {
      kind: "close",
    });
    harness.unmount();
  });

  it("ignores an invalid native close payload without blocking the next request", async () => {
    const persistWorkspaceSession = vi.fn(async () => undefined);
    const harness = renderLifecycle({ persistWorkspaceSession });

    await act(async () => {
      tauriMocks.listeners.get("mockor-native-close-requested")?.({
        payload: "restart",
      });
      requestNativeClose("quit");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(harness.reportError).toHaveBeenCalledWith(
      "Application",
      expect.any(Error),
    );
    expect(persistWorkspaceSession).toHaveBeenCalledOnce();
    expect(tauriMocks.invoke).toHaveBeenCalledWith("confirm_native_shutdown", {
      kind: "quit",
    });
    harness.unmount();
  });

  it("coalesces repeated native close requests while shutdown is in flight", async () => {
    const persistence = createDeferred<void>();
    const persistWorkspaceSession = vi.fn(() => persistence.promise);
    const harness = renderLifecycle({ dirtyCount: 1, persistWorkspaceSession });

    await act(async () => {
      requestNativeClose("quit");
      requestNativeClose("quit");
    });

    expect(harness.prompter.confirm).toHaveBeenCalledTimes(1);
    expect(persistWorkspaceSession).toHaveBeenCalledTimes(1);

    await act(async () => {
      persistence.resolve();
      await persistence.promise;
      await Promise.resolve();
    });

    expect(nativeShutdownInvocationCount()).toBe(1);
    expect(tauriMocks.invoke).toHaveBeenCalledWith("confirm_native_shutdown", {
      kind: "quit",
    });
    harness.unmount();
  });

  it("coalesces keyboard and native requests while shutdown is in flight", async () => {
    const persistence = createDeferred<void>();
    const persistWorkspaceSession = vi.fn(() => persistence.promise);
    const harness = renderLifecycle({ dirtyCount: 1, persistWorkspaceSession });

    await act(async () => {
      harness.lifecycle().quitApplication();
      requestNativeClose("quit");
      harness.lifecycle().closeApplicationWindow();
    });

    expect(harness.prompter.confirm).toHaveBeenCalledTimes(1);
    expect(persistWorkspaceSession).toHaveBeenCalledTimes(1);

    await act(async () => {
      persistence.resolve();
      await persistence.promise;
      await Promise.resolve();
    });

    expect(tauriMocks.invoke).toHaveBeenCalledWith("quit_application");
    expect(nativeShutdownInvocationCount()).toBe(0);
    harness.unmount();
  });
});
