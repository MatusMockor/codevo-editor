// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { agentRootOwnerId } from "../domain/agentProject";
import type { AgentProjectDescriptor } from "../domain/agentProject";
import type { AgentTaskStatusEvent } from "../domain/agentTask";
import {
  AGENT_THREAD_STORE_FULL_ERROR,
  type AgentThread,
  type AgentTurn,
} from "../domain/agentThread";
import type { ResolvedGitRepository } from "../domain/gitRepositoryMapping";
import { waitForReact } from "../test/reactTestLifecycle";
import type {
  AgentThreadStoreGateway,
  AgentThreadStoreOwnerRequest,
  AgentThreadStoreSnapshot,
  AgentThreadStoreSurface,
  DeleteAgentThreadRequest,
  SaveAgentThreadRequest,
} from "./agentThreadPorts";
import {
  LEGACY_AGENT_THREAD_PIN_STORAGE_KEY_PREFIX,
  useAgentThreadStore,
  type AgentThreadStoreDependencies,
} from "./useAgentThreadStore";

const ROOT_KEY = "/workspace/app";
const OTHER_ROOT_KEY = "/workspace/other";
const OWNER_ID = agentRootOwnerId(ROOT_KEY);
const OTHER_OWNER_ID = agentRootOwnerId(OTHER_ROOT_KEY);
const REPOSITORY_ROOT = "/workspace/app";
const PERSIST_INTERVAL_MS = 40;

function repository(repositoryRoot: string): ResolvedGitRepository {
  return { mapping: { rootRelativePath: "" }, repositoryRoot, repositoryRelativePath: "" };
}

function project(overrides: Partial<AgentProjectDescriptor> = {}): AgentProjectDescriptor {
  return {
    rootKey: ROOT_KEY,
    rootPath: ROOT_KEY,
    ownerId: OWNER_ID,
    label: "app",
    generation: 1,
    trust: "trusted",
    origin: "active-tab",
    repositories: [repository(REPOSITORY_ROOT)],
    isolationPolicy: "auto",
    leaseToken: null,
    ...overrides,
  };
}

function turn(turnId: string): AgentTurn {
  return {
    turnId,
    prompt: "do the thing",
    status: { kind: "pending" },
    startedAtEpochMs: 10,
    endedAtEpochMs: null,
    events: [],
    eventsTruncated: false,
    lastStatusSequence: 0,
    lastOutputSequence: 0,
  };
}

function thread(overrides: Partial<AgentThread> = {}): AgentThread {
  return {
    threadId: "agt-1-0a1b",
    owner: { rootKey: ROOT_KEY, ownerId: OWNER_ID, repositoryRoot: REPOSITORY_ROOT },
    target: { isolation: "worktree", worktreePath: `${REPOSITORY_ROOT}/.worktrees/agt-1-0a1b` },
    provider: { kind: "claudeCode", sessionId: null },
    title: "Fix the parser",
    pinned: false,
    archived: false,
    createdAtEpochMs: 10,
    updatedAtEpochMs: 10,
    turns: [],
    turnsTruncated: false,
    ...overrides,
  };
}

function statusEvent(sequence: number, overrides: Partial<AgentTaskStatusEvent> = {}) {
  return {
    taskId: "agt-1-0a1c",
    workspaceId: OWNER_ID,
    repositoryRoot: REPOSITORY_ROOT,
    isolation: "worktree",
    worktreePath: `${REPOSITORY_ROOT}/.worktrees/agt-1-0a1b`,
    sequence,
    status: { kind: "running" },
    ...overrides,
  } as AgentTaskStatusEvent;
}

function emptySnapshot(): AgentThreadStoreSnapshot {
  return { threads: [], unreadable: [], evicted: 0 };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

interface Environment {
  agentModeActive: boolean;
  projects: ReadonlyArray<AgentProjectDescriptor>;
}

function renderStore(overrides: Partial<Environment> = {}) {
  const environment: Environment = {
    agentModeActive: true,
    projects: [project()],
    ...overrides,
  };

  const snapshots = new Map<string, AgentThreadStoreSnapshot>();
  const loadResults: Array<Promise<AgentThreadStoreSnapshot>> = [];
  const saved: SaveAgentThreadRequest[] = [];

  const gateway = {
    loadAgentThreads: vi.fn(async (request: { rootKey: string; ownerId: string }) => {
      const next = loadResults.shift();
      if (next !== undefined) return next;
      return snapshots.get(request.rootKey) ?? emptySnapshot();
    }),
    saveAgentThread: vi.fn(async (request: SaveAgentThreadRequest) => {
      saved.push(request);
    }),
    deleteAgentThread: vi.fn(async () => undefined),
  };

  const legacyPinStorage = { removeItem: vi.fn() };
  const reportError = vi.fn();
  const setNotice = vi.fn();

  const dependencies = (): AgentThreadStoreDependencies => ({
    agentThreadStoreGateway: gateway as unknown as AgentThreadStoreGateway,
    projects: environment.projects,
    agentModeActive: environment.agentModeActive,
    reportError,
    setNotice,
    legacyPinStorage,
    minimumPersistIntervalMs: PERSIST_INTERVAL_MS,
  });

  const host = document.createElement("div");
  const root = createRoot(host);
  const captured: { value: AgentThreadStoreSurface | null } = { value: null };

  function Harness(props: { readonly dependencies: AgentThreadStoreDependencies }) {
    captured.value = useAgentThreadStore(props.dependencies);
    return null;
  }

  const render = () => act(() => root.render(<Harness dependencies={dependencies()} />));
  render();

  return {
    gateway,
    legacyPinStorage,
    reportError,
    setNotice,
    saved,
    snapshots,
    loadResults,
    hook: () => captured.value as AgentThreadStoreSurface,
    set: (next: Partial<Environment>) => {
      Object.assign(environment, next);
      render();
    },
    unmount: () => act(() => root.unmount()),
  };
}

describe("useAgentThreadStore loading", () => {
  it("loads the admitted project once agent mode is active", async () => {
    const persisted = thread();
    const harness = renderStore({ agentModeActive: false });
    harness.snapshots.set(ROOT_KEY, { threads: [persisted], unreadable: [], evicted: 0 });

    expect(harness.gateway.loadAgentThreads).not.toHaveBeenCalled();

    harness.set({ agentModeActive: true });
    await waitForReact(() => {
      expect(harness.hook().state.threads.get("agt-1-0a1b")).toEqual(persisted);
    });

    expect(harness.gateway.loadAgentThreads).toHaveBeenCalledWith({
      rootKey: ROOT_KEY,
      ownerId: OWNER_ID,
    });
    expect(harness.hook().loadedRootKeys.has(ROOT_KEY)).toBe(true);
    harness.unmount();
  });

  it("removes the legacy pin storage key exactly once per root", async () => {
    const harness = renderStore();

    await waitForReact(() => {
      expect(harness.hook().loadedRootKeys.has(ROOT_KEY)).toBe(true);
    });

    expect(harness.legacyPinStorage.removeItem).toHaveBeenCalledTimes(1);
    expect(harness.legacyPinStorage.removeItem).toHaveBeenCalledWith(
      `${LEGACY_AGENT_THREAD_PIN_STORAGE_KEY_PREFIX}${ROOT_KEY}`,
    );
    harness.unmount();
  });

  it("drops a late workspace A result after A to B to A", async () => {
    const staleA = deferred<AgentThreadStoreSnapshot>();
    const harness = renderStore({ agentModeActive: false });
    harness.loadResults.push(staleA.promise);
    harness.set({ agentModeActive: true });

    await waitForReact(() => {
      expect(harness.gateway.loadAgentThreads).toHaveBeenCalledTimes(1);
    });

    harness.set({ projects: [project({ rootKey: OTHER_ROOT_KEY, ownerId: OTHER_OWNER_ID })] });
    harness.snapshots.set(ROOT_KEY, {
      threads: [thread({ threadId: "agt-2-0a1b", title: "second generation" })],
      unreadable: [],
      evicted: 0,
    });
    harness.set({ projects: [project({ generation: 2 })] });

    await act(async () => {
      staleA.resolve({
        threads: [thread({ threadId: "agt-9-0a1b", title: "stale" })],
        unreadable: [],
        evicted: 0,
      });
      await staleA.promise;
    });
    await waitForReact(() => {
      expect(harness.hook().state.threads.has("agt-2-0a1b")).toBe(true);
    });

    expect(harness.hook().state.threads.has("agt-9-0a1b")).toBe(false);
    harness.unmount();
  });

  it("warns once when saved threads could not be read", async () => {
    const harness = renderStore();
    harness.snapshots.set(ROOT_KEY, {
      threads: [],
      unreadable: [
        { threadId: "agt-7-0a1b", reason: "invalid json" },
        { threadId: "agt-8-0a1b", reason: "schema version" },
      ],
      evicted: 0,
    });
    harness.set({ projects: [project({ generation: 3 })] });

    await waitForReact(() => {
      expect(harness.setNotice).toHaveBeenCalledWith({
        kind: "warning",
        message: "2 saved threads could not be read and were skipped.",
        action: null,
      });
    });

    harness.unmount();
  });

  it("reports a failed load and retries on the next authority change", async () => {
    const failing = deferred<AgentThreadStoreSnapshot>();
    const harness = renderStore();
    harness.loadResults.push(failing.promise);
    harness.set({ projects: [project({ generation: 4 })] });

    await act(async () => {
      failing.reject(new Error("store unavailable"));
      await failing.promise.catch(() => undefined);
    });
    await waitForReact(() => {
      expect(harness.reportError).toHaveBeenCalledWith("Agents", expect.any(Error));
    });

    harness.set({ projects: [project({ generation: 5 })] });
    await waitForReact(() => {
      expect(harness.hook().loadedRootKeys.has(ROOT_KEY)).toBe(true);
    });

    harness.unmount();
  });
});

async function renderLoadedStore() {
  const harness = renderStore();
  await waitForReact(() => {
    expect(harness.hook().loadedRootKeys.has(ROOT_KEY)).toBe(true);
  });
  return harness;
}

describe("useAgentThreadStore persistence", () => {
  it("saves a created thread immediately", async () => {
    const harness = await renderLoadedStore();
    const created = thread();

    act(() => harness.hook().dispatchAction({ kind: "threadCreated", thread: created }));

    await waitForReact(() => {
      expect(harness.saved).toEqual([{ rootKey: ROOT_KEY, ownerId: OWNER_ID, thread: created }]);
    });
    harness.unmount();
  });

  it("coalesces running-turn saves to one per interval", async () => {
    const harness = await renderLoadedStore();
    const created = thread({ turns: [turn("agt-1-0a1c")] });

    act(() => harness.hook().dispatchAction({ kind: "threadCreated", thread: created }));
    await waitForReact(() => {
      expect(harness.gateway.saveAgentThread).toHaveBeenCalledTimes(1);
    });
    harness.gateway.saveAgentThread.mockClear();

    for (const sequence of [1, 2, 3, 4]) {
      act(() =>
        harness.hook().dispatchAction({
          kind: "taskStatusEvent",
          event: statusEvent(sequence),
          nowEpochMs: 20,
        }),
      );
    }

    expect(harness.gateway.saveAgentThread).not.toHaveBeenCalled();
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, PERSIST_INTERVAL_MS * 2));
    });
    await waitForReact(() => {
      expect(harness.gateway.saveAgentThread).toHaveBeenCalledTimes(1);
    });
    harness.unmount();
  });

  it("keeps at most one save in flight per thread and runs the pending one after it", async () => {
    const pending = deferred<void>();
    const harness = await renderLoadedStore();
    const created = thread();
    act(() => harness.hook().dispatchAction({ kind: "threadCreated", thread: created }));
    await waitForReact(() => {
      expect(harness.gateway.saveAgentThread).toHaveBeenCalledTimes(1);
    });
    harness.gateway.saveAgentThread.mockClear();
    harness.gateway.saveAgentThread.mockImplementationOnce(async () => pending.promise);

    act(() => harness.hook().togglePin("agt-1-0a1b"));
    await waitForReact(() => {
      expect(harness.gateway.saveAgentThread).toHaveBeenCalledTimes(1);
    });
    act(() => harness.hook().togglePin("agt-1-0a1b"));
    expect(harness.gateway.saveAgentThread).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve();
      await pending.promise;
    });
    await waitForReact(() => {
      expect(harness.gateway.saveAgentThread).toHaveBeenCalledTimes(2);
    });
    harness.unmount();
  });

  it("surfaces a save failure once and retries on the next trigger", async () => {
    const harness = await renderLoadedStore();
    harness.gateway.saveAgentThread.mockRejectedValue(new Error("disk full"));

    act(() => harness.hook().dispatchAction({ kind: "threadCreated", thread: thread() }));
    await waitForReact(() => {
      expect(harness.setNotice).toHaveBeenCalledWith({
        kind: "warning",
        message: "Some agent conversations could not be saved.",
        action: null,
      });
    });
    const noticesAfterFirstFailure = harness.setNotice.mock.calls.length;

    act(() => harness.hook().togglePin("agt-1-0a1b"));
    await waitForReact(() => {
      expect(harness.gateway.saveAgentThread).toHaveBeenCalledTimes(2);
    });

    expect(harness.setNotice.mock.calls.length).toBe(noticesAfterFirstFailure);
    harness.unmount();
  });

  it("deletes a settled thread from the store and keeps a running one", async () => {
    const harness = await renderLoadedStore();
    const settled = thread();
    const running = thread({ threadId: "agt-2-0a1b", turns: [turn("agt-2-0a1c")] });

    act(() => {
      harness.hook().dispatchAction({ kind: "threadCreated", thread: settled });
      harness.hook().dispatchAction({ kind: "threadCreated", thread: running });
    });
    await waitForReact(() => {
      expect(harness.hook().state.threads.size).toBe(2);
    });

    act(() => harness.hook().remove("agt-2-0a1b"));
    act(() => harness.hook().remove("agt-1-0a1b"));

    await waitForReact(() => {
      expect(harness.gateway.deleteAgentThread).toHaveBeenCalledTimes(1);
    });
    expect(harness.gateway.deleteAgentThread).toHaveBeenCalledWith({
      rootKey: ROOT_KEY,
      ownerId: OWNER_ID,
      threadId: "agt-1-0a1b",
    });
    expect(harness.hook().state.threads.has("agt-2-0a1b")).toBe(true);
    expect(harness.hook().state.threads.has("agt-1-0a1b")).toBe(false);
    harness.unmount();
  });

  it("does not save a thread whose project is no longer admitted", async () => {
    const harness = await renderLoadedStore();
    const created = thread({
      owner: { rootKey: OTHER_ROOT_KEY, ownerId: OTHER_OWNER_ID, repositoryRoot: REPOSITORY_ROOT },
    });

    act(() => harness.hook().dispatchAction({ kind: "threadCreated", thread: created }));
    await waitForReact(() => {
      expect(harness.hook().state.threads.size).toBe(1);
    });

    expect(harness.gateway.saveAgentThread).not.toHaveBeenCalled();
    harness.unmount();
  });
});

const RUNTIME_OWNER_ID = "ws-7f3a2c";
const RUST_OWNER_MISMATCH_ERROR = "The agent thread owner does not match this project root.";
const RUST_SAVED_OWNER_MISMATCH_ERROR = "The saved thread belongs to another agent project root.";

function rustRuleGateway() {
  const files = new Map<string, AgentThread>();
  const ensureOwner = (request: AgentThreadStoreOwnerRequest): void => {
    if (request.ownerId !== agentRootOwnerId(request.rootKey)) {
      throw new Error(RUST_OWNER_MISMATCH_ERROR);
    }
  };
  const gateway = {
    loadAgentThreads: vi.fn(async (request: AgentThreadStoreOwnerRequest) => {
      ensureOwner(request);
      return { threads: [...files.values()], unreadable: [], evicted: 0 };
    }),
    saveAgentThread: vi.fn(async (request: SaveAgentThreadRequest) => {
      ensureOwner(request);
      if (request.thread.owner.rootKey !== request.rootKey) {
        throw new Error(RUST_SAVED_OWNER_MISMATCH_ERROR);
      }
      if (request.thread.owner.ownerId !== agentRootOwnerId(request.rootKey)) {
        throw new Error(RUST_SAVED_OWNER_MISMATCH_ERROR);
      }
      files.set(request.thread.threadId, request.thread);
    }),
    deleteAgentThread: vi.fn(async (request: DeleteAgentThreadRequest) => {
      ensureOwner(request);
      files.delete(request.threadId);
    }),
  };
  return { gateway, files };
}

function renderRuntimeOwnedStore(files: ReadonlyMap<string, AgentThread>, gateway: unknown) {
  const reportError = vi.fn();
  const setNotice = vi.fn();
  const host = document.createElement("div");
  const root = createRoot(host);
  const captured: { value: AgentThreadStoreSurface | null } = { value: null };
  const dependencies: AgentThreadStoreDependencies = {
    agentThreadStoreGateway: gateway as AgentThreadStoreGateway,
    projects: [project({ ownerId: RUNTIME_OWNER_ID })],
    agentModeActive: true,
    reportError,
    setNotice,
    legacyPinStorage: { removeItem: vi.fn() },
    minimumPersistIntervalMs: PERSIST_INTERVAL_MS,
  };
  function Harness() {
    captured.value = useAgentThreadStore(dependencies);
    return null;
  }
  act(() => root.render(<Harness />));
  return {
    files,
    reportError,
    setNotice,
    hook: () => captured.value as AgentThreadStoreSurface,
    unmount: () => act(() => root.unmount()),
  };
}

describe("useAgentThreadStore persistent identity", () => {
  it("loads, saves and deletes with the persistent root owner while threads carry the runtime owner", async () => {
    const { gateway, files } = rustRuleGateway();
    const persistedOwner = agentRootOwnerId(ROOT_KEY);
    files.set(
      "agt-0-0a1b",
      thread({
        threadId: "agt-0-0a1b",
        owner: { rootKey: ROOT_KEY, ownerId: persistedOwner, repositoryRoot: REPOSITORY_ROOT },
      }),
    );
    const harness = renderRuntimeOwnedStore(files, gateway);

    await waitForReact(() => {
      expect(harness.hook().loadedRootKeys.has(ROOT_KEY)).toBe(true);
    });
    expect(gateway.loadAgentThreads).toHaveBeenCalledWith({
      rootKey: ROOT_KEY,
      ownerId: persistedOwner,
    });
    expect(harness.hook().state.threads.get("agt-0-0a1b")?.owner.ownerId).toBe(RUNTIME_OWNER_ID);

    const created = thread({
      owner: { rootKey: ROOT_KEY, ownerId: RUNTIME_OWNER_ID, repositoryRoot: REPOSITORY_ROOT },
    });
    act(() => harness.hook().dispatchAction({ kind: "threadCreated", thread: created }));
    await waitForReact(() => {
      expect(files.has("agt-1-0a1b")).toBe(true);
    });
    expect(files.get("agt-1-0a1b")?.owner.ownerId).toBe(persistedOwner);
    expect(harness.hook().state.threads.get("agt-1-0a1b")?.owner.ownerId).toBe(RUNTIME_OWNER_ID);

    act(() => harness.hook().remove("agt-1-0a1b"));
    await waitForReact(() => {
      expect(files.has("agt-1-0a1b")).toBe(false);
    });
    expect(gateway.deleteAgentThread).toHaveBeenCalledWith({
      rootKey: ROOT_KEY,
      ownerId: persistedOwner,
      threadId: "agt-1-0a1b",
    });
    expect(harness.reportError).not.toHaveBeenCalled();
    expect(harness.setNotice).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("persists turns re-marked as interrupted on load so the store never keeps them running", async () => {
    const { gateway, files } = rustRuleGateway();
    const persistedOwner = agentRootOwnerId(ROOT_KEY);
    files.set(
      "agt-0-0a1b",
      thread({
        threadId: "agt-0-0a1b",
        owner: { rootKey: ROOT_KEY, ownerId: persistedOwner, repositoryRoot: REPOSITORY_ROOT },
        turns: [{ ...turn("agt-0-0a1c"), status: { kind: "running" } }],
      }),
    );
    files.set(
      "agt-2-0a1b",
      thread({
        threadId: "agt-2-0a1b",
        owner: { rootKey: ROOT_KEY, ownerId: persistedOwner, repositoryRoot: REPOSITORY_ROOT },
        turns: [{ ...turn("agt-2-0a1c"), status: { kind: "exited", exitCode: 0 } }],
      }),
    );
    const harness = renderRuntimeOwnedStore(files, gateway);

    await waitForReact(() => {
      expect(files.get("agt-0-0a1b")?.turns[0]?.status).toEqual({ kind: "interrupted" });
    });
    expect(gateway.saveAgentThread).toHaveBeenCalledTimes(1);
    expect(files.get("agt-0-0a1b")?.owner.ownerId).toBe(persistedOwner);
    expect(harness.hook().state.threads.get("agt-0-0a1b")?.turns[0]?.status).toEqual({
      kind: "interrupted",
    });
    harness.unmount();
  });
});

describe("useAgentThreadStore store-full", () => {
  it("surfaces the store-full notice when the backend refuses to evict for a save", async () => {
    const harness = await renderLoadedStore();
    harness.gateway.saveAgentThread.mockRejectedValueOnce(new Error(AGENT_THREAD_STORE_FULL_ERROR));

    act(() => harness.hook().dispatchAction({ kind: "threadCreated", thread: thread() }));

    await waitForReact(() => {
      expect(harness.setNotice).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "warning",
          message: expect.stringContaining("store is full"),
        }),
      );
    });
    expect(harness.reportError).toHaveBeenCalledTimes(1);
    harness.unmount();
  });
});
