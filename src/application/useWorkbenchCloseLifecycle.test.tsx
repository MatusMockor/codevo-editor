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
import { workspaceIdentityStateCacheKey } from "./useWorkspaceStateCache";
import { DOCUMENT_SYNC_CLOSE_GRACE_MS } from "./closeCoordinator";
import type {
  DocumentSaveInvalidationScope,
  RunWithDocumentSaveExclusion,
} from "./documentSaveCoordinator";

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

function workspaceIdentity(
  selectedPath = WORKSPACE_A,
  canonicalRoot = "/real/workspace-a",
) {
  return {
    workspaceId: "ws-a",
    selectedPath,
    canonicalRoot,
    caseSensitive: true,
    unicodeNormalizationPolicy: "preserved" as const,
    policy: {
      caseSensitive: true as const,
      unicodeNormalization: "none" as const,
    },
  };
}

function mutableCloseOwnership() {
  let current = true;
  return {
    invalidate: () => {
      current = false;
    },
    ownership: { isCurrent: () => current },
  };
}

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

type DocumentSaveExclusionMock = RunWithDocumentSaveExclusion &
  ReturnType<typeof vi.fn>;

function documentSaveExclusionMock(
  implementation: (
    scope: DocumentSaveInvalidationScope,
    operation: () => Promise<void>,
  ) => Promise<void> = async (_scope, operation) => operation(),
): DocumentSaveExclusionMock {
  return vi.fn(implementation) as unknown as DocumentSaveExclusionMock;
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
  runWithDocumentSaveExclusion: DocumentSaveExclusionMock;
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
  const runWithDocumentSaveExclusion = documentSaveExclusionMock();
  const stopProjectRuntimes = vi.fn(async () => undefined);
  const reportError = vi.fn();
  const liveWorkspaceRoot =
    overrides.workspaceRoot === undefined
      ? WORKSPACE_B
      : overrides.workspaceRoot;
  const liveDirtyCount = overrides.dirtyCount ?? 0;
  const liveWorkspaceHasExternalFileConflicts =
    overrides.workspaceHasExternalFileConflicts ?? vi.fn(() => false);

  const dependencies: WorkbenchCloseLifecycleDependencies = {
    appSettingsRef,
    clearActiveWorkspace: vi.fn(async () => undefined),
    clearExternalFileConflictsForRoot: vi.fn(),
    commitWorkspaceClose: vi.fn(),
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
    runWithDocumentSaveExclusion,
    stopProjectRuntimes,
    workspaceRoot: WORKSPACE_B,
    workspaceCloseSession: {
      current: () => ({
        activeRoot: liveWorkspaceRoot,
        needsAttention:
          liveDirtyCount > 0 ||
          Boolean(
            liveWorkspaceRoot &&
              liveWorkspaceHasExternalFileConflicts(liveWorkspaceRoot),
          ),
      }),
    },
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
    runWithDocumentSaveExclusion:
      dependencies.runWithDocumentSaveExclusion as DocumentSaveExclusionMock,
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

  it("prompts from canonical dirty state when closing a selected alias", async () => {
    const descriptor = workspaceIdentity();
    const canonicalState = {
      editorSurface: {
        documents: {
          [`${descriptor.canonicalRoot}/Dirty.php`]: dirtyDocument(
            `${descriptor.canonicalRoot}/Dirty.php`,
          ),
        },
      },
      workspaceIdentityDescriptor: descriptor,
    };
    const cache = { [descriptor.canonicalRoot]: canonicalState };
    const resolveCachedWorkspaceState = vi.fn(() => canonicalState) as unknown as
      NonNullable<
        WorkbenchCloseLifecycleDependencies["resolveCachedWorkspaceState"]
      >;
    const harness = renderLifecycle({
      resolveCachedWorkspaceState,
      workspaceIdentityByRootRef: {
        current: {
          [descriptor.selectedPath]: descriptor,
          [descriptor.canonicalRoot]: descriptor,
        },
      },
      workspaceStateCacheRef: { current: cache },
    });
    harness.prompter.confirm.mockReturnValueOnce(false);

    await act(async () => {
      await harness.lifecycle().closeWorkspaceTab(descriptor.selectedPath);
    });

    expect(harness.prompter.confirm).toHaveBeenCalledWith(
      "Close workspace and discard unsaved changes?",
    );
    expect(harness.persistAppSettings).not.toHaveBeenCalled();
    expect(cache[descriptor.canonicalRoot]).toBe(canonicalState);
    expect(resolveCachedWorkspaceState).toHaveBeenCalledWith(
      descriptor.selectedPath,
      descriptor,
    );
    harness.unmount();
  });

  it("atomically forgets identity aliases and coalesces duplicate close calls", async () => {
    const persistence = createDeferred<void>();
    const descriptor = workspaceIdentity();
    const unregisterWorkspace = vi.fn(async () => undefined);
    const persistAppSettings = vi.fn(async () => persistence.promise);
    const describedAlias = "/described-workspace-a";
    const cachedState = {
      editorSurface: { documents: {} },
      workspaceIdentityDescriptor: descriptor,
    };
    const cache = {
      [descriptor.selectedPath]: cachedState,
      [descriptor.canonicalRoot]: cachedState,
      [describedAlias]: cachedState,
    };
    const identities = {
      [descriptor.selectedPath]: descriptor,
      [descriptor.canonicalRoot]: descriptor,
      [describedAlias]: descriptor,
    };
    const forgetCachedWorkspaceState = vi.fn(
      (_rootPath: string, identity = descriptor) => {
        for (const [key, cached] of Object.entries(cache)) {
          if (cached.workspaceIdentityDescriptor !== identity) {
            continue;
          }

          delete cache[key as keyof typeof cache];
        }
      },
    );
    const resolveCachedWorkspaceState = vi.fn(
      () => cache[descriptor.canonicalRoot],
    ) as unknown as NonNullable<
      WorkbenchCloseLifecycleDependencies["resolveCachedWorkspaceState"]
    >;
    const harness = renderLifecycle({
      forgetCachedWorkspaceState,
      persistAppSettings,
      resolveCachedWorkspaceState,
      unregisterWorkspace,
      workspaceIdentityByRootRef: { current: identities },
      workspaceStateCacheRef: { current: cache },
    });

    let selectedClose!: Promise<void>;
    let canonicalClose!: Promise<void>;
    await act(async () => {
      selectedClose = harness
        .lifecycle()
        .closeWorkspaceTab(descriptor.selectedPath);
      canonicalClose = harness
        .lifecycle()
        .closeWorkspaceTab(descriptor.canonicalRoot);
      await Promise.resolve();
    });

    expect(persistAppSettings).toHaveBeenCalledOnce();
    expect(unregisterWorkspace).not.toHaveBeenCalled();
    expect(Object.keys(cache)).toHaveLength(3);

    persistence.resolve();
    await act(async () => {
      await Promise.all([selectedClose, canonicalClose]);
    });

    expect(cache).toEqual({});
    expect(identities).toEqual({});
    expect(unregisterWorkspace).toHaveBeenCalledOnce();
    expect(unregisterWorkspace).toHaveBeenCalledWith(descriptor.workspaceId);
    expect(forgetCachedWorkspaceState).toHaveBeenCalledOnce();
    expect(forgetCachedWorkspaceState).toHaveBeenCalledWith(
      descriptor.selectedPath,
      descriptor,
    );
    expect(harness.stopProjectRuntimes).toHaveBeenCalledOnce();
    expect(harness.stopProjectRuntimes).toHaveBeenCalledWith(
      descriptor.selectedPath,
    );
    harness.unmount();
  });

  it("coalesces a canonical-first close into the selected workspace tab close", async () => {
    const persistence = createDeferred<void>();
    const descriptor = workspaceIdentity();
    const persistAppSettings = vi.fn(async () => persistence.promise);
    const unregisterWorkspace = vi.fn(async () => undefined);
    const harness = renderLifecycle({
      persistAppSettings,
      unregisterWorkspace,
      workspaceIdentityByRootRef: {
        current: {
          [descriptor.selectedPath]: descriptor,
          [descriptor.canonicalRoot]: descriptor,
        },
      },
    });

    let canonicalClose!: Promise<void>;
    let selectedClose!: Promise<void>;
    await act(async () => {
      canonicalClose = harness
        .lifecycle()
        .closeWorkspaceTab(descriptor.canonicalRoot);
      selectedClose = harness
        .lifecycle()
        .closeWorkspaceTab(descriptor.selectedPath);
      await Promise.resolve();
    });

    expect(persistAppSettings).toHaveBeenCalledOnce();
    expect(persistAppSettings).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceTabs: [WORKSPACE_B] }),
    );

    persistence.resolve();
    await act(async () => {
      await Promise.all([canonicalClose, selectedClose]);
    });

    expect(unregisterWorkspace).toHaveBeenCalledOnce();
    expect(harness.stopProjectRuntimes).toHaveBeenCalledOnce();
    expect(harness.stopProjectRuntimes).toHaveBeenCalledWith(
      descriptor.selectedPath,
    );
    harness.unmount();
  });

  it("preserves a same-id alias reopened during close settings persistence", async () => {
    const settings = createDeferred<void>();
    const oldDescriptor = workspaceIdentity();
    const reopenedDescriptor = workspaceIdentity(
      "/reopened/workspace-a",
      oldDescriptor.canonicalRoot,
    );
    const closeOwnership = mutableCloseOwnership();
    const commitWorkspaceClose = vi.fn(() => closeOwnership.ownership);
    const forgetCachedWorkspaceState = vi.fn();
    const unregisterWorkspace = vi.fn(async () => undefined);
    const stopProjectRuntimes = vi.fn(async () => undefined);
    const identities = {
      [oldDescriptor.selectedPath]: oldDescriptor,
      [oldDescriptor.canonicalRoot]: oldDescriptor,
    };
    const cache = {
      [oldDescriptor.canonicalRoot]: {
        editorSurface: { documents: {} },
        workspaceIdentityDescriptor: oldDescriptor,
      },
    };
    const harness = renderLifecycle({
      commitWorkspaceClose,
      forgetCachedWorkspaceState,
      persistAppSettings: vi.fn(() => settings.promise),
      stopProjectRuntimes,
      unregisterWorkspace,
      workspaceIdentityByRootRef: { current: identities },
      workspaceStateCacheRef: { current: cache },
    });

    let closing!: Promise<void>;
    await act(async () => {
      closing = harness.lifecycle().closeWorkspaceTab(oldDescriptor.selectedPath);
      await Promise.resolve();
    });

    closeOwnership.invalidate();
    delete identities[oldDescriptor.selectedPath];
    identities[reopenedDescriptor.selectedPath] = reopenedDescriptor;
    identities[oldDescriptor.canonicalRoot] = reopenedDescriptor;
    cache[oldDescriptor.canonicalRoot] = {
      editorSurface: { documents: {} },
      workspaceIdentityDescriptor: reopenedDescriptor,
    };
    harness.appSettingsRef.current.workspaceTabs = [
      reopenedDescriptor.selectedPath,
      WORKSPACE_B,
    ];

    settings.resolve();
    await act(async () => closing);

    expect(forgetCachedWorkspaceState).not.toHaveBeenCalled();
    expect(unregisterWorkspace).not.toHaveBeenCalled();
    expect(stopProjectRuntimes).not.toHaveBeenCalled();
    expect(identities[reopenedDescriptor.selectedPath]).toBe(
      reopenedDescriptor,
    );
    expect(cache[oldDescriptor.canonicalRoot].workspaceIdentityDescriptor).toBe(
      reopenedDescriptor,
    );
    expect(harness.appSettingsRef.current.workspaceTabs).toContain(
      reopenedDescriptor.selectedPath,
    );
    harness.unmount();
  });

  it("preserves a reused native identity reopened while unregister waits", async () => {
    const unregister = createDeferred<void>();
    const oldDescriptor = workspaceIdentity();
    const reopenedDescriptor = workspaceIdentity(
      "/reopened-during-unregister",
      oldDescriptor.canonicalRoot,
    );
    const closeOwnership = mutableCloseOwnership();
    const forgetCachedWorkspaceState = vi.fn();
    const stopProjectRuntimes = vi.fn(async () => undefined);
    const unregisterWorkspace = vi.fn(() => unregister.promise);
    const identities = {
      [oldDescriptor.selectedPath]: oldDescriptor,
      [oldDescriptor.canonicalRoot]: oldDescriptor,
    };
    const cache = {
      [oldDescriptor.canonicalRoot]: {
        editorSurface: { documents: {} },
        workspaceIdentityDescriptor: oldDescriptor,
      },
    };
    const harness = renderLifecycle({
      commitWorkspaceClose: vi.fn(() => closeOwnership.ownership),
      forgetCachedWorkspaceState,
      stopProjectRuntimes,
      unregisterWorkspace,
      workspaceIdentityByRootRef: { current: identities },
      workspaceStateCacheRef: { current: cache },
    });

    let closing!: Promise<void>;
    await act(async () => {
      closing = harness.lifecycle().closeWorkspaceTab(oldDescriptor.selectedPath);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(unregisterWorkspace).toHaveBeenCalledOnce();

    closeOwnership.invalidate();
    delete identities[oldDescriptor.selectedPath];
    identities[reopenedDescriptor.selectedPath] = reopenedDescriptor;
    identities[oldDescriptor.canonicalRoot] = reopenedDescriptor;
    cache[oldDescriptor.canonicalRoot] = {
      editorSurface: { documents: {} },
      workspaceIdentityDescriptor: reopenedDescriptor,
    };
    harness.appSettingsRef.current.workspaceTabs = [
      reopenedDescriptor.selectedPath,
      WORKSPACE_B,
    ];

    unregister.resolve();
    await act(async () => closing);

    expect(forgetCachedWorkspaceState).not.toHaveBeenCalled();
    expect(stopProjectRuntimes).not.toHaveBeenCalled();
    expect(unregisterWorkspace).toHaveBeenCalledOnce();
    expect(identities[reopenedDescriptor.selectedPath]).toBe(
      reopenedDescriptor,
    );
    expect(cache[oldDescriptor.canonicalRoot].workspaceIdentityDescriptor).toBe(
      reopenedDescriptor,
    );
    harness.unmount();
  });

  it("preserves reopened resources when the old runtime stop completes late", async () => {
    const runtimeStop = createDeferred<void>();
    const oldDescriptor = workspaceIdentity();
    const reopenedDescriptor = workspaceIdentity(
      "/reopened-during-runtime-stop",
      oldDescriptor.canonicalRoot,
    );
    const closeOwnership = mutableCloseOwnership();
    const forgetCachedWorkspaceState = vi.fn();
    const forgetLanguageServerRuntimeStatuses = vi.fn();
    const forgetLatencyTrackerForRoot = vi.fn();
    const stopProjectRuntimes = vi.fn(() => runtimeStop.promise);
    const identities = {
      [oldDescriptor.selectedPath]: oldDescriptor,
      [oldDescriptor.canonicalRoot]: oldDescriptor,
    };
    const cache = {
      [oldDescriptor.canonicalRoot]: {
        editorSurface: { documents: {} },
        workspaceIdentityDescriptor: oldDescriptor,
      },
    };
    const harness = renderLifecycle({
      commitWorkspaceClose: vi.fn(() => closeOwnership.ownership),
      forgetCachedWorkspaceState,
      forgetLanguageServerRuntimeStatuses,
      forgetLatencyTrackerForRoot,
      stopProjectRuntimes,
      workspaceIdentityByRootRef: { current: identities },
      workspaceStateCacheRef: { current: cache },
    });

    let closing!: Promise<void>;
    await act(async () => {
      closing = harness.lifecycle().closeWorkspaceTab(oldDescriptor.selectedPath);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(stopProjectRuntimes).toHaveBeenCalledOnce();

    closeOwnership.invalidate();
    delete identities[oldDescriptor.selectedPath];
    identities[reopenedDescriptor.selectedPath] = reopenedDescriptor;
    identities[oldDescriptor.canonicalRoot] = reopenedDescriptor;
    cache[oldDescriptor.canonicalRoot] = {
      editorSurface: { documents: {} },
      workspaceIdentityDescriptor: reopenedDescriptor,
    };
    harness.appSettingsRef.current.workspaceTabs = [
      reopenedDescriptor.selectedPath,
      WORKSPACE_B,
    ];

    runtimeStop.resolve();
    await act(async () => closing);

    expect(forgetCachedWorkspaceState).not.toHaveBeenCalled();
    expect(forgetLanguageServerRuntimeStatuses).not.toHaveBeenCalled();
    expect(forgetLatencyTrackerForRoot).not.toHaveBeenCalled();
    expect(identities[reopenedDescriptor.selectedPath]).toBe(
      reopenedDescriptor,
    );
    expect(cache[oldDescriptor.canonicalRoot].workspaceIdentityDescriptor).toBe(
      reopenedDescriptor,
    );
    harness.unmount();
  });

  it("does not forget a replacement owner admitted at the same paths while close waits", async () => {
    const unregister = createDeferred<void>();
    const closingIdentity = workspaceIdentity();
    const replacementIdentity = {
      ...closingIdentity,
      workspaceId: "ws-replacement",
    };
    const closingState = {
      editorSurface: { documents: {} },
      workspaceIdentityDescriptor: closingIdentity,
    };
    const replacementState = {
      editorSurface: {
        documents: {
          [`${replacementIdentity.selectedPath}/Replacement.php`]:
            dirtyDocument(
              `${replacementIdentity.selectedPath}/Replacement.php`,
            ),
        },
      },
      workspaceIdentityDescriptor: replacementIdentity,
    };
    const identities = {
      [closingIdentity.selectedPath]: closingIdentity,
      [closingIdentity.canonicalRoot]: closingIdentity,
    };
    const cache = {
      [workspaceIdentityStateCacheKey(closingIdentity.workspaceId)]:
        closingState,
    };
    const harness = renderLifecycle({
      unregisterWorkspace: vi.fn(() => unregister.promise),
      workspaceIdentityByRootRef: { current: identities },
      workspaceStateCacheRef: { current: cache },
    });

    let closing!: Promise<void>;
    await act(async () => {
      closing = harness
        .lifecycle()
        .closeWorkspaceTab(closingIdentity.selectedPath);
      await Promise.resolve();
      await Promise.resolve();
    });

    delete cache[workspaceIdentityStateCacheKey(closingIdentity.workspaceId)];
    cache[workspaceIdentityStateCacheKey(replacementIdentity.workspaceId)] =
      replacementState;
    cache[replacementIdentity.selectedPath] = replacementState;
    identities[replacementIdentity.selectedPath] = replacementIdentity;
    identities[replacementIdentity.canonicalRoot] = replacementIdentity;
    harness.appSettingsRef.current.workspaceTabs = [
      replacementIdentity.selectedPath,
      WORKSPACE_B,
    ];

    unregister.resolve();
    await act(async () => closing);

    expect(cache).toEqual({
      [workspaceIdentityStateCacheKey(replacementIdentity.workspaceId)]:
        replacementState,
      [replacementIdentity.selectedPath]: replacementState,
    });
    expect(identities[replacementIdentity.selectedPath]).toBe(
      replacementIdentity,
    );
    expect(identities[replacementIdentity.canonicalRoot]).toBe(
      replacementIdentity,
    );
    harness.unmount();
  });

  it("does not treat a read-only Git diff document as dirty cached work", async () => {
    const harness = renderLifecycle();
    harness.workspaceStateCacheRef.current[WORKSPACE_A] = {
      editorSurface: {
        documents: {
          "git-diff://workspace-a/Dirty.php": {
            ...dirtyDocument("git-diff://workspace-a/Dirty.php"),
            readOnly: true,
          },
        },
      },
    };

    await act(async () => {
      await harness.lifecycle().closeWorkspaceTab(WORKSPACE_A);
    });

    expect(harness.prompter.confirm).not.toHaveBeenCalled();
    expect(harness.persistAppSettings).toHaveBeenCalledOnce();
    harness.unmount();
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
    const commitWorkspaceClose = vi.fn();
    const harness = renderLifecycle({ commitWorkspaceClose });
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
    expect(harness.runWithDocumentSaveExclusion).not.toHaveBeenCalled();
    expect(commitWorkspaceClose).not.toHaveBeenCalled();
    expect(harness.stopProjectRuntimes).not.toHaveBeenCalled();
    expect(harness.appSettingsRef.current.workspaceTabs).toEqual([
      WORKSPACE_A,
      WORKSPACE_B,
    ]);
    harness.unmount();
  });

  it("preserves an active conflict-only workspace when discard is declined", async () => {
    const commitWorkspaceClose = vi.fn();
    const openWorkspaceRequestPathRef = {
      current: WORKSPACE_B as string | null,
    };
    const openWorkspaceRequestTokenRef = { current: 11 };
    const openFileRequestTokenRef = { current: 12 };
    const gitDiffRequestTokenRef = { current: 13 };
    const editorGitBaselineRequestTokenRef = { current: 14 };
    const persistWorkspaceSession = vi.fn(async () => undefined);
    const openWorkspacePath = vi.fn(async () => undefined);
    const clearActiveWorkspace = vi.fn(async () => undefined);
    const clearExternalFileConflictsForRoot = vi.fn();
    const harness = renderLifecycle({
      clearActiveWorkspace,
      clearExternalFileConflictsForRoot,
      commitWorkspaceClose,
      dirtyCount: 0,
      editorGitBaselineRequestTokenRef,
      gitDiffRequestTokenRef,
      openFileRequestTokenRef,
      openWorkspacePath,
      openWorkspaceRequestPathRef,
      openWorkspaceRequestTokenRef,
      persistWorkspaceSession,
      workspaceHasExternalFileConflicts: vi.fn(
        (root) => root === WORKSPACE_B,
      ),
    });
    harness.prompter.confirm.mockReturnValueOnce(false);

    await act(async () => {
      await harness.lifecycle().closeWorkspaceTab(WORKSPACE_B);
    });

    expect(harness.prompter.confirm).toHaveBeenCalledWith(
      "Close workspace and discard unsaved changes?",
    );
    expect(openWorkspaceRequestPathRef.current).toBe(WORKSPACE_B);
    expect(openWorkspaceRequestTokenRef.current).toBe(11);
    expect(openFileRequestTokenRef.current).toBe(12);
    expect(gitDiffRequestTokenRef.current).toBe(13);
    expect(editorGitBaselineRequestTokenRef.current).toBe(14);
    expect(harness.appSettingsRef.current.workspaceTabs).toEqual([
      WORKSPACE_A,
      WORKSPACE_B,
    ]);
    expect(harness.runWithDocumentSaveExclusion).not.toHaveBeenCalled();
    expect(commitWorkspaceClose).not.toHaveBeenCalled();
    expect(persistWorkspaceSession).not.toHaveBeenCalled();
    expect(harness.persistAppSettings).not.toHaveBeenCalled();
    expect(clearExternalFileConflictsForRoot).not.toHaveBeenCalled();
    expect(
      harness.closeSyncedLanguageServerDocumentsForRoot,
    ).not.toHaveBeenCalled();
    expect(
      harness.closeSyncedJavaScriptTypeScriptDocumentsForRoot,
    ).not.toHaveBeenCalled();
    expect(harness.stopProjectRuntimes).not.toHaveBeenCalled();
    expect(openWorkspacePath).not.toHaveBeenCalled();
    expect(clearActiveWorkspace).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("uses the live active workspace and attention after a same-tick switch", async () => {
    let activeSession = {
      activeRoot: WORKSPACE_A as string | null,
      needsAttention: false,
    };
    const commitWorkspaceClose = vi.fn();
    const persistWorkspaceSession = vi.fn(async () => undefined);
    const harness = renderLifecycle({
      commitWorkspaceClose,
      persistWorkspaceSession,
      workspaceRoot: WORKSPACE_A,
      workspaceCloseSession: { current: () => activeSession },
    });
    activeSession = { activeRoot: WORKSPACE_B, needsAttention: true };
    harness.prompter.confirm.mockReturnValueOnce(false);

    await act(async () => {
      await harness.lifecycle().closeWorkspaceTab(WORKSPACE_B);
    });

    expect(harness.prompter.confirm).toHaveBeenCalledWith(
      "Close workspace and discard unsaved changes?",
    );
    expect(commitWorkspaceClose).not.toHaveBeenCalled();
    expect(harness.runWithDocumentSaveExclusion).not.toHaveBeenCalled();
    expect(persistWorkspaceSession).not.toHaveBeenCalled();
    expect(harness.persistAppSettings).not.toHaveBeenCalled();
    expect(harness.appSettingsRef.current.workspaceTabs).toEqual([
      WORKSPACE_A,
      WORKSPACE_B,
    ]);
    harness.unmount();
  });

  it("uses the inactive cache after a same-tick switch away from the closing root", async () => {
    let activeRoot: string | null = WORKSPACE_A;
    const commitWorkspaceClose = vi.fn();
    const persistWorkspaceSession = vi.fn(async () => undefined);
    const harness = renderLifecycle({
      commitWorkspaceClose,
      persistWorkspaceSession,
      workspaceRoot: WORKSPACE_A,
      workspaceCloseSession: {
        current: () => ({ activeRoot, needsAttention: false }),
      },
    });
    harness.workspaceStateCacheRef.current[WORKSPACE_A] = {
      editorSurface: {
        documents: {
          [`${WORKSPACE_A}/src/Dirty.php`]: dirtyDocument(
            `${WORKSPACE_A}/src/Dirty.php`,
          ),
        },
      },
    };
    harness.appSettingsRef.current.recentWorkspacePath = WORKSPACE_A;
    activeRoot = WORKSPACE_B;

    await act(async () => {
      await harness.lifecycle().closeWorkspaceTab(WORKSPACE_A);
    });

    expect(harness.prompter.confirm).toHaveBeenCalledWith(
      "Close workspace and discard unsaved changes?",
    );
    expect(commitWorkspaceClose).toHaveBeenCalledWith(WORKSPACE_A, null);
    expect(persistWorkspaceSession).not.toHaveBeenCalled();
    expect(harness.persistAppSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        recentWorkspacePath: WORKSPACE_B,
        workspaceTabs: [WORKSPACE_B],
      }),
    );
    harness.unmount();
  });

  it("holds the exact inactive workspace exclusion through persistence and runtime disposal", async () => {
    const runtimeStop = createDeferred<void>();
    const events: string[] = [];
    const runWithDocumentSaveExclusion = documentSaveExclusionMock(
      async (_scope, operation: () => Promise<void>) => {
        events.push("lock");
        try {
          await operation();
        } finally {
          events.push("unlock");
        }
      },
    );
    const persistAppSettings = vi.fn(async () => {
      events.push("persist");
    });
    const commitWorkspaceClose = vi.fn((rootPath: string) => {
      events.push(`commit:${rootPath}`);
    });
    const stopProjectRuntimes = vi.fn(() => {
      events.push("runtime");
      return runtimeStop.promise;
    });
    const harness = renderLifecycle({
      commitWorkspaceClose,
      persistAppSettings,
      runWithDocumentSaveExclusion,
      stopProjectRuntimes,
    });
    harness.workspaceStateCacheRef.current[WORKSPACE_A] = {
      editorSurface: { documents: {} },
    };

    let closePromise!: Promise<void>;
    await act(async () => {
      closePromise = harness.lifecycle().closeWorkspaceTab(`${WORKSPACE_A}/`);
      await Promise.resolve();
    });

    expect(runWithDocumentSaveExclusion).toHaveBeenCalledOnce();
    expect(runWithDocumentSaveExclusion.mock.calls[0]?.[0]).toEqual({
      kind: "workspace",
      rootPath: WORKSPACE_A,
    });
    expect(events).toEqual([
      `commit:${WORKSPACE_A}`,
      "lock",
      "persist",
      "runtime",
    ]);

    runtimeStop.resolve();
    await act(async () => {
      await closePromise;
    });

    expect(persistAppSettings).toHaveBeenCalledOnce();
    expect(harness.workspaceStateCacheRef.current[WORKSPACE_A]).toBeUndefined();
    expect(stopProjectRuntimes).toHaveBeenCalledWith(WORKSPACE_A);
    expect(events).toEqual([
      `commit:${WORKSPACE_A}`,
      "lock",
      "persist",
      "runtime",
      "unlock",
    ]);
    harness.unmount();
  });

  it("holds the exact active workspace exclusion through persistence, disposal, and switching", async () => {
    const workspaceSwitch = createDeferred<void>();
    const events: string[] = [];
    const runWithDocumentSaveExclusion = documentSaveExclusionMock(
      async (_scope, operation: () => Promise<void>) => {
        events.push("lock");
        try {
          await operation();
        } finally {
          events.push("unlock");
        }
      },
    );
    const persistWorkspaceSession = vi.fn(async () => {
      events.push("session");
    });
    const commitWorkspaceClose = vi.fn((rootPath: string) => {
      events.push(`commit:${rootPath}`);
    });
    const persistAppSettings = vi.fn(async () => {
      events.push("settings");
    });
    const stopProjectRuntimes = vi.fn(async () => {
      events.push("runtime");
    });
    const openWorkspacePath = vi.fn(() => {
      events.push("switch");
      return workspaceSwitch.promise;
    });
    const harness = renderLifecycle({
      commitWorkspaceClose,
      dirtyCount: 1,
      openWorkspacePath,
      persistAppSettings,
      persistWorkspaceSession,
      runWithDocumentSaveExclusion,
      stopProjectRuntimes,
    });

    let closePromise!: Promise<void>;
    await act(async () => {
      closePromise = harness.lifecycle().closeWorkspaceTab(`${WORKSPACE_B}/`);
      await Promise.resolve();
    });

    expect(harness.prompter.confirm).toHaveBeenCalledWith(
      "Close workspace and discard unsaved changes?",
    );
    expect(runWithDocumentSaveExclusion).toHaveBeenCalledOnce();
    expect(runWithDocumentSaveExclusion.mock.calls[0]?.[0]).toEqual({
      kind: "workspace",
      rootPath: WORKSPACE_B,
    });
    expect(events).toEqual([
      `commit:${WORKSPACE_B}`,
      "lock",
      "session",
      "settings",
      "runtime",
      "switch",
    ]);

    workspaceSwitch.resolve();
    await act(async () => {
      await closePromise;
    });

    expect(persistWorkspaceSession).toHaveBeenCalledWith(WORKSPACE_B);
    expect(persistAppSettings).toHaveBeenCalledOnce();
    expect(stopProjectRuntimes).toHaveBeenCalledWith(WORKSPACE_B);
    expect(openWorkspacePath).toHaveBeenCalledWith(WORKSPACE_A, {
      cachePreviousWorkspace: false,
    });
    expect(events[events.length - 1]).toBe("unlock");
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

  it("waits for every normalized workspace exclusion before closing the Tauri window", async () => {
    const barrier = createDeferred<void>();
    const persistWorkspaceSession = vi.fn(async () => undefined);
    const runWithDocumentSaveExclusion = documentSaveExclusionMock(
      async (scope, operation: () => Promise<void>) => {
        if (scope.rootPath === WORKSPACE_B) {
          await barrier.promise;
        }

        await operation();
      },
    );
    const harness = renderLifecycle({
      persistWorkspaceSession,
      runWithDocumentSaveExclusion,
    });
    harness.appSettingsRef.current.workspaceTabs = [
      `${WORKSPACE_A}/`,
      WORKSPACE_A,
      `${WORKSPACE_B}/`,
    ];

    await act(async () => {
      harness.lifecycle().closeApplicationWindow();
      await Promise.resolve();
    });

    expect(
      runWithDocumentSaveExclusion.mock.calls.map(([scope]) => scope),
    ).toEqual([
      { kind: "workspace", rootPath: WORKSPACE_A },
      { kind: "workspace", rootPath: WORKSPACE_B },
    ]);
    expect(persistWorkspaceSession).not.toHaveBeenCalled();
    expect(tauriMocks.invoke).not.toHaveBeenCalledWith(
      "confirm_native_shutdown",
      expect.anything(),
    );

    await act(async () => {
      barrier.resolve();
      await barrier.promise;
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
    expect(harness.runWithDocumentSaveExclusion).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("waits for every normalized workspace exclusion before quitting", async () => {
    const barrier = createDeferred<void>();
    const persistWorkspaceSession = vi.fn(async () => undefined);
    const runWithDocumentSaveExclusion = documentSaveExclusionMock(
      async (scope, operation: () => Promise<void>) => {
        if (scope.rootPath === WORKSPACE_B) {
          await barrier.promise;
        }

        await operation();
      },
    );
    const harness = renderLifecycle({
      dirtyCount: 1,
      persistWorkspaceSession,
      runWithDocumentSaveExclusion,
    });
    harness.appSettingsRef.current.workspaceTabs = [
      `${WORKSPACE_A}/`,
      WORKSPACE_A,
    ];

    await act(async () => {
      harness.lifecycle().quitApplication();
      await Promise.resolve();
    });

    expect(harness.prompter.confirm).toHaveBeenCalledOnce();
    expect(
      runWithDocumentSaveExclusion.mock.calls.map(([scope]) => scope),
    ).toEqual([
      { kind: "workspace", rootPath: WORKSPACE_A },
      { kind: "workspace", rootPath: WORKSPACE_B },
    ]);
    expect(persistWorkspaceSession).not.toHaveBeenCalled();
    expect(tauriMocks.invoke).not.toHaveBeenCalledWith("quit_application");

    await act(async () => {
      barrier.resolve();
      await barrier.promise;
      await Promise.resolve();
      await Promise.resolve();
    });

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
      workspaceHasExternalFileConflicts: vi.fn((root) => root === WORKSPACE_A),
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

  it("checks identity-keyed inactive conflicts through path aliases", async () => {
    const descriptor = workspaceIdentity();
    const identityKey = workspaceIdentityStateCacheKey(descriptor.workspaceId);
    const workspaceHasExternalFileConflicts = vi.fn(
      (root: string) => root === descriptor.selectedPath,
    );
    const harness = renderLifecycle({
      workspaceHasExternalFileConflicts,
      workspaceStateCacheRef: {
        current: {
          [identityKey]: {
            editorSurface: { documents: {} },
            workspaceIdentityDescriptor: descriptor,
          },
        },
      },
    });
    harness.prompter.confirm.mockReturnValueOnce(false);

    await act(async () => {
      requestNativeClose();
    });

    expect(harness.prompter.confirm).toHaveBeenCalledOnce();
    expect(workspaceHasExternalFileConflicts).toHaveBeenCalledWith(
      descriptor.selectedPath,
    );
    expect(workspaceHasExternalFileConflicts).not.toHaveBeenCalledWith(
      identityKey,
    );
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

  it("excludes an active selected alias canonical cache from shutdown dirtiness", async () => {
    const descriptor = workspaceIdentity(
      WORKSPACE_B,
      "/real/workspace-b",
    );
    const persistWorkspaceSession = vi.fn(async () => undefined);
    const canonicalState = {
      editorSurface: {
        documents: {
          [`${descriptor.canonicalRoot}/Dirty.php`]: dirtyDocument(
            `${descriptor.canonicalRoot}/Dirty.php`,
          ),
        },
      },
      workspaceIdentityDescriptor: descriptor,
    };
    const harness = renderLifecycle({
      persistWorkspaceSession,
      workspaceIdentityByRootRef: {
        current: {
          [descriptor.selectedPath]: descriptor,
          [descriptor.canonicalRoot]: descriptor,
        },
      },
      workspaceStateCacheRef: {
        current: { [descriptor.canonicalRoot]: canonicalState },
      },
    });

    await act(async () => {
      requestNativeClose();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(harness.prompter.confirm).not.toHaveBeenCalled();
    expect(persistWorkspaceSession).toHaveBeenCalledWith(WORKSPACE_B);
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
    expect(harness.runWithDocumentSaveExclusion).not.toHaveBeenCalled();
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
