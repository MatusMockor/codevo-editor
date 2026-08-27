// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Dispatch, SetStateAction } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileEntry } from "../../domain/workspace";
import {
  BoundedInFlightDirectoryLoads,
  MAX_DIRECTORY_ENTRIES_PER_LOAD,
  boundedInFlightDirectoryLoadsFor,
} from "./boundedInFlightDirectoryLoads";
import {
  loadCompleteWorkspaceDirectoryEntries,
  useWorkspaceDirectoryLoader,
} from "./useWorkspaceDirectoryLoader";
import { useWorkspaceOpenRequestLifecycle } from "./useWorkspaceOpenRequestLifecycle";
import { LatestWorkspaceRequestTokenRegistry } from "./workspaceRequestTokenRegistry";

const mountedRoots: Root[] = [];

afterEach(() => {
  for (const root of mountedRoots.splice(0)) {
    act(() => root.unmount());
  }
  vi.useRealTimers();
});

describe("workspace request bounds", () => {
  it("retires a never-settling superseded open token while preserving the winner", async () => {
    const never = new Promise<never>(() => undefined);
    const registry = new LatestWorkspaceRequestTokenRegistry();
    const completeDeferredIdentityCleanup = vi.fn();
    const openPath = vi.fn((path: string) =>
      path === "/a"
        ? never
        : Promise.resolve({
            workspaceId: "b",
            selectedPath: "/b",
            canonicalRoot: "/b",
            caseSensitive: true,
            unicodeNormalizationPolicy: "preserved" as const,
            policy: {
              caseSensitive: true as const,
              unicodeNormalization: "none" as const,
            },
          }),
    );
    let lifecycle!: ReturnType<typeof useWorkspaceOpenRequestLifecycle>;
    render(() => {
      lifecycle = useWorkspaceOpenRequestLifecycle({
        completeDeferredIdentityCleanup,
        currentWorkspaceRootRef: { current: null },
        openWorkspaceRequestInFlightTokenRef: { current: null },
        openWorkspaceRequestPathRef: { current: null },
        openWorkspaceRequestTokenRef: { current: 0 },
        ownedWorkspaceIdentityGenerationByIdRef: { current: {} },
        pendingWorkspaceIdentityRequestTokensRef: { current: registry },
        performOpenWorkspacePath: async () => undefined,
        reportError: vi.fn(),
        resolveCachedWorkspaceState: () => null,
        withManagedWorkspaceIdentityLease: async (_descriptor, leaseOperation) =>
          leaseOperation(() => undefined),
        workbenchMountedRef: { current: true },
        workspaceCloseGenerationByRootRef: { current: {} },
        workspaceCloseOwnershipByKeyRef: { current: {} },
        workspaceCloseOwnershipGenerationRef: { current: 0 },
        workspaceIdentityByRootRef: { current: {} },
        workspaceIdentityGateway: {
          openFromPicker: async () => ({ status: "cancelled" }),
          openPath,
          getDescriptor: async (workspaceId) => ({
            workspaceId,
            selectedRootPath: "/b",
            canonicalRootPath: "/b",
            caseSensitive: true,
            unicodeNormalizationPolicy: "preserved",
          }),
          unregister: async () => undefined,
        },
        workspaceRoot: null,
      });
    });

    void lifecycle.openWorkspacePath("/a");
    expect(registry.pendingToken()).toBe(1);

    await act(async () => lifecycle.openWorkspacePath("/b"));
    expect(openPath).toHaveBeenCalledTimes(2);
    expect(registry.hasPending()).toBe(false);
    expect(completeDeferredIdentityCleanup).toHaveBeenCalledTimes(1);
  });

  it("rejects a new physical directory read when the in-flight capacity is exhausted", async () => {
    const never = new Promise<{ entries: readonly FileEntry[]; truncated: boolean }>(
      () => undefined,
    );
    const readDirectoryBounded = vi.fn(() => never);
    const setMessage = vi.fn();
    let loadDirectory!: ReturnType<typeof useWorkspaceDirectoryLoader>;
    render(() => {
      loadDirectory = useWorkspaceDirectoryLoader({
        currentWorkspaceRootRef: { current: "/workspace" },
        inFlightLoadsRef: { current: new BoundedInFlightDirectoryLoads(2, 1) },
        openWorkspaceRequestTokenRef: { current: 1 },
        reportError: vi.fn(),
        setEntriesByDirectory: vi.fn(),
        setFailedDirectories: vi.fn(),
        setLoadingDirectories: vi.fn(),
        setMessage,
        workspaceFiles: { readDirectoryBounded } as never,
      });
    });

    void loadDirectory("/workspace/one");
    await Promise.resolve();
    await act(async () => {
      await loadDirectory("/workspace/two");
    });

    expect(readDirectoryBounded).toHaveBeenCalledTimes(1);
    expect(setMessage).toHaveBeenCalledWith(
      "Too many directory reads are still pending. Wait for one to finish.",
    );
  });

  it("retires a stale directory generation so a replacement workspace can read", async () => {
    const never = new Promise<{ entries: readonly FileEntry[]; truncated: boolean }>(
      () => undefined,
    );
    const readDirectoryBounded = vi
      .fn<() => Promise<{ entries: readonly FileEntry[]; truncated: boolean }>>()
      .mockReturnValueOnce(never)
      .mockResolvedValueOnce({ entries: [], truncated: false });
    const rootRef = { current: "/a" as string | null };
    const generationRef = { current: 1 };
    let loadDirectory!: ReturnType<typeof useWorkspaceDirectoryLoader>;
    render(() => {
      loadDirectory = useWorkspaceDirectoryLoader({
        currentWorkspaceRootRef: rootRef,
        inFlightLoadsRef: { current: new BoundedInFlightDirectoryLoads(2, 1) },
        openWorkspaceRequestTokenRef: generationRef,
        reportError: vi.fn(),
        setEntriesByDirectory: vi.fn(),
        setFailedDirectories: vi.fn(),
        setLoadingDirectories: vi.fn(),
        setMessage: vi.fn(),
        workspaceFiles: { readDirectoryBounded } as never,
      });
    });

    void loadDirectory("/a/src");
    await Promise.resolve();
    rootRef.current = "/b";
    generationRef.current = 2;
    await act(async () => {
      await loadDirectory("/b/src");
    });

    expect(readDirectoryBounded).toHaveBeenCalledTimes(2);
  });

  it("uses only the bounded directory path and surfaces truncation", async () => {
    const readDirectory = vi.fn(async () => []);
    const readDirectoryBounded = vi.fn(async () => ({
      entries: [] as FileEntry[],
      truncated: true,
    }));
    const setMessage = vi.fn();
    let loadDirectory!: ReturnType<typeof useWorkspaceDirectoryLoader>;
    render(() => {
      loadDirectory = useWorkspaceDirectoryLoader({
        currentWorkspaceRootRef: { current: "/workspace" },
        inFlightLoadsRef: { current: new BoundedInFlightDirectoryLoads() },
        openWorkspaceRequestTokenRef: { current: 1 },
        reportError: vi.fn(),
        setEntriesByDirectory: vi.fn(),
        setFailedDirectories: vi.fn(),
        setLoadingDirectories: vi.fn(),
        setMessage,
        workspaceFiles: { readDirectory, readDirectoryBounded } as never,
      });
    });

    let result;
    await act(async () => {
      result = await loadDirectory("/workspace/src");
    });

    expect(readDirectoryBounded).toHaveBeenCalledWith(
      "/workspace/src",
      MAX_DIRECTORY_ENTRIES_PER_LOAD,
    );
    expect(readDirectory).not.toHaveBeenCalled();
    expect(setMessage).toHaveBeenCalledWith(expect.stringContaining("Showing the first"));
    expect(result).toEqual({ entries: [], truncated: true });
  });

  it("never reuses a cached partial projection for complete-only discovery", async () => {
    const load = vi.fn(async () => ({
      entries: [{ kind: "file" as const, name: "package.json", path: "/workspace/package.json" }],
      truncated: true,
    }));

    await expect(loadCompleteWorkspaceDirectoryEntries(load)).resolves.toBeNull();
    expect(load).toHaveBeenCalledOnce();
  });

  it("settles a never-ending logical load and retires its frontend capacity at the deadline", async () => {
    vi.useFakeTimers();
    const read = deferred<{ entries: readonly FileEntry[]; truncated: boolean }>();
    const harness = renderDirectoryLoader({
      deadlineMs: 50,
      readDirectoryBounded: vi.fn(() => read.promise),
    });

    const pending = harness.load("/workspace/src");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
      await pending;
    });

    expect(harness.readDirectoryBounded).toHaveBeenCalledOnce();
    expect(harness.loading.current.has("/workspace/src")).toBe(false);
    expect(harness.failed.current.has("/workspace/src")).toBe(true);
    expect(harness.message.current).toBe("This folder took too long to load. Retry to try again.");
    expect(harness.store.size()).toBe(0);
  });

  it("starts a fresh backend-admitted retry after the prior logical deadline", async () => {
    vi.useFakeTimers();
    const staleRead = deferred<{ entries: readonly FileEntry[]; truncated: boolean }>();
    const harness = renderDirectoryLoader({
      deadlineMs: 50,
      readDirectoryBounded: vi
        .fn()
        .mockReturnValueOnce(staleRead.promise)
        .mockResolvedValueOnce({
          entries: [{ kind: "file", name: "index.ts", path: "/workspace/src/index.ts" }],
          truncated: false,
        }),
    });

    const first = harness.load("/workspace/src");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
      await first;
    });
    const retry = harness.load("/workspace/src");
    await act(async () => {
      await retry;
    });

    expect(harness.readDirectoryBounded).toHaveBeenCalledTimes(2);
    expect(harness.entries.current["/workspace/src"]).toEqual([
      { kind: "file", name: "index.ts", path: "/workspace/src/index.ts" },
    ]);
    expect(harness.failed.current.has("/workspace/src")).toBe(false);
    expect(harness.loading.current.has("/workspace/src")).toBe(false);
    expect(harness.store.size()).toBe(0);
  });

  it("does not publish a physical result that arrives after the logical deadline", async () => {
    vi.useFakeTimers();
    const read = deferred<{ entries: readonly FileEntry[]; truncated: boolean }>();
    const harness = renderDirectoryLoader({
      deadlineMs: 50,
      readDirectoryBounded: vi.fn(() => read.promise),
    });

    const pending = harness.load("/workspace/src");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
      await pending;
    });
    read.resolve({
      entries: [{ kind: "file", name: "late.ts", path: "/workspace/src/late.ts" }],
      truncated: false,
    });
    await act(async () => {
      await read.promise;
    });

    expect(harness.entries.current).toEqual({});
    expect(harness.failed.current.has("/workspace/src")).toBe(true);
    expect(harness.store.size()).toBe(0);
  });

  it("preserves cached entries and marks retryable failure for a non-ENOENT error", async () => {
    const harness = renderDirectoryLoader({
      initialEntries: {
        "/workspace/src": [{ kind: "file", name: "cached.ts", path: "/workspace/src/cached.ts" }],
      },
      readDirectoryBounded: vi.fn(async () => {
        throw new Error("permission denied");
      }),
    });

    await act(async () => {
      await harness.load("/workspace/src");
    });

    expect(harness.entries.current["/workspace/src"]?.[0]?.name).toBe("cached.ts");
    expect(harness.failed.current.has("/workspace/src")).toBe(true);
    expect(harness.loading.current.has("/workspace/src")).toBe(false);
    expect(harness.reportError).toHaveBeenCalledOnce();
  });

  it("retires remounted frontend ownership while a stale backend read remains fenced", async () => {
    vi.useFakeTimers();
    const staleRead = deferred<{ entries: readonly FileEntry[]; truncated: boolean }>();
    const readDirectoryBounded = vi
      .fn()
      .mockReturnValueOnce(staleRead.promise)
      .mockResolvedValueOnce({ entries: [], truncated: false });
    const gateway = { readDirectoryBounded };
    const first = renderDirectoryLoader({
      deadlineMs: 50,
      gateway,
      store: boundedInFlightDirectoryLoadsFor(gateway),
    });

    const timedOut = first.load("/workspace/src");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
      await timedOut;
    });
    const firstRoot = mountedRoots.shift();
    act(() => firstRoot?.unmount());

    const remounted = renderDirectoryLoader({
      deadlineMs: 50,
      gateway,
      store: boundedInFlightDirectoryLoadsFor(gateway),
    });
    const retry = remounted.load("/workspace/src");
    await act(async () => {
      await retry;
    });

    expect(readDirectoryBounded).toHaveBeenCalledTimes(2);
    expect(remounted.failed.current.has("/workspace/src")).toBe(false);
    expect(remounted.loading.current.has("/workspace/src")).toBe(false);
  });

  it("does not let an old overlapping unmount retire a replacement presentation physical read", async () => {
    vi.useFakeTimers();
    const read = deferred<{ entries: readonly FileEntry[]; truncated: boolean }>();
    const readDirectoryBounded = vi.fn(() => read.promise);
    const gateway = { readDirectoryBounded };
    const first = renderDirectoryLoader({
      deadlineMs: 50,
      gateway,
      store: boundedInFlightDirectoryLoadsFor(gateway),
    });
    const firstPending = first.load("/workspace/src");
    await act(async () => {
      await Promise.resolve();
    });

    const second = renderDirectoryLoader({
      deadlineMs: 50,
      gateway,
      store: boundedInFlightDirectoryLoadsFor(gateway),
    });
    const secondPending = second.load("/workspace/src");
    const firstRoot = mountedRoots.shift();
    act(() => firstRoot?.unmount());

    const third = renderDirectoryLoader({
      deadlineMs: 50,
      gateway,
      store: boundedInFlightDirectoryLoadsFor(gateway),
    });
    const thirdPending = third.load("/workspace/src");
    read.resolve({
      entries: [{ kind: "file", name: "winner.ts", path: "/workspace/src/winner.ts" }],
      truncated: false,
    });
    await act(async () => {
      await Promise.all([firstPending, secondPending, thirdPending]);
    });

    expect(readDirectoryBounded).toHaveBeenCalledOnce();
    expect(third.entries.current["/workspace/src"]?.[0]?.name).toBe("winner.ts");
  });

  it("keeps a hundred concurrent retries on one bounded physical request", async () => {
    vi.useFakeTimers();
    const read = deferred<{ entries: readonly FileEntry[]; truncated: boolean }>();
    const harness = renderDirectoryLoader({
      deadlineMs: 50,
      readDirectoryBounded: vi.fn(() => read.promise),
    });

    const attempts = Array.from({ length: 100 }, () => harness.load("/workspace/src"));
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
      await Promise.all(attempts);
    });

    expect(harness.readDirectoryBounded).toHaveBeenCalledOnce();
    expect(harness.store.size()).toBe(0);
    expect(harness.loading.current.has("/workspace/src")).toBe(false);
    expect(harness.failed.current.has("/workspace/src")).toBe(true);
  });

  it("releases frontend capacity after thirty-two distinct never-settling deadlines", async () => {
    vi.useFakeTimers();
    const readDirectoryBounded = vi.fn(() => new Promise<never>(() => undefined));
    const harness = renderDirectoryLoader({
      deadlineMs: 50,
      readDirectoryBounded,
    });

    for (let index = 0; index < 32; index += 1) {
      const pending = harness.load(`/workspace/directory-${index}`);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
        await pending;
      });
      expect(harness.store.size()).toBe(0);
    }

    expect(readDirectoryBounded).toHaveBeenCalledTimes(32);
  });

  it("coalesces repeated same-path retries into one bounded backend busy response", async () => {
    vi.useFakeTimers();
    const worker = deferred<{ entries: readonly FileEntry[]; truncated: boolean }>();
    let admittedWorkerCount = 0;
    const readDirectoryBounded = vi.fn(() => {
      if (admittedWorkerCount === 0) {
        admittedWorkerCount += 1;
        return worker.promise;
      }
      return Promise.reject(new Error("WORKSPACE_DIRECTORY_BUSY: bounded by backend admission"));
    });
    const harness = renderDirectoryLoader({
      deadlineMs: 50,
      readDirectoryBounded,
    });

    const first = harness.load("/workspace/src");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
      await first;
    });
    const retries = Array.from({ length: 100 }, () => harness.load("/workspace/src"));
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => {
      await Promise.all(retries);
    });

    expect(admittedWorkerCount).toBe(1);
    expect(readDirectoryBounded).toHaveBeenCalledTimes(2);
    expect(harness.failed.current.has("/workspace/src")).toBe(true);
    expect(harness.message.current).toBe("This folder is busy. Retry in a moment.");
    expect(harness.store.size()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("marks local admission saturation as an inline retryable failure", async () => {
    const store = new BoundedInFlightDirectoryLoads(1, 1);
    expect(
      store.admit("occupied", {
        generation: 1,
        path: "/workspace/occupied",
        promise: new Promise<never>(() => undefined),
        requestId: Symbol("occupied"),
        rootPath: "/workspace",
      }),
    ).toBe(true);
    const harness = renderDirectoryLoader({
      readDirectoryBounded: vi.fn(async () => ({ entries: [], truncated: false })),
      store,
    });

    await act(async () => {
      await harness.load("/workspace/src");
    });

    expect(harness.readDirectoryBounded).not.toHaveBeenCalled();
    expect(harness.failed.current.has("/workspace/src")).toBe(true);
    expect(harness.loading.current.has("/workspace/src")).toBe(false);
    expect(harness.message.current).toBe(
      "Too many directory reads are still pending. Wait for one to finish.",
    );
  });

  it("maps backend busy saturation to a retryable generic state without reporting raw details", async () => {
    const harness = renderDirectoryLoader({
      readDirectoryBounded: vi.fn(async () => {
        throw new Error("WORKSPACE_DIRECTORY_BUSY: secret path and internal details");
      }),
    });

    await act(async () => {
      await harness.load("/workspace/src");
    });

    expect(harness.failed.current.has("/workspace/src")).toBe(true);
    expect(harness.message.current).toBe("This folder is busy. Retry in a moment.");
    expect(harness.reportError).not.toHaveBeenCalled();
  });

  it("revalidates workspace authority after the admission microtask before invoking the gateway", async () => {
    const rootRef = { current: "/workspace" as string | null };
    const generationRef = { current: 1 };
    const readDirectoryBounded = vi.fn(async () => ({ entries: [], truncated: false }));
    const harness = renderDirectoryLoader({
      generationRef,
      readDirectoryBounded,
      rootRef,
    });

    const pending = harness.load("/workspace/src");
    rootRef.current = "/replacement";
    generationRef.current = 2;
    await act(async () => {
      await pending;
    });

    expect(readDirectoryBounded).not.toHaveBeenCalled();
    expect(harness.entries.current).toEqual({});
  });

  it("does not let a stale A generation clear the current A generation loading state", async () => {
    vi.useFakeTimers();
    const firstRead = deferred<{ entries: readonly FileEntry[]; truncated: boolean }>();
    const currentRead = deferred<{ entries: readonly FileEntry[]; truncated: boolean }>();
    const rootRef = { current: "/workspace" as string | null };
    const generationRef = { current: 1 };
    const harness = renderDirectoryLoader({
      deadlineMs: 50,
      generationRef,
      readDirectoryBounded: vi
        .fn()
        .mockReturnValueOnce(firstRead.promise)
        .mockReturnValueOnce(currentRead.promise),
      rootRef,
    });

    const stale = harness.load("/workspace/src");
    await act(async () => {
      await Promise.resolve();
    });
    rootRef.current = "/replacement";
    generationRef.current = 2;
    rootRef.current = "/workspace";
    generationRef.current = 3;
    const current = harness.load("/workspace/src");

    firstRead.resolve({ entries: [], truncated: false });
    await act(async () => {
      await stale;
    });
    expect(harness.loading.current.has("/workspace/src")).toBe(true);

    currentRead.resolve({
      entries: [{ kind: "file", name: "current.ts", path: "/workspace/src/current.ts" }],
      truncated: false,
    });
    await act(async () => {
      await current;
    });
    expect(harness.loading.current.has("/workspace/src")).toBe(false);
    expect(harness.entries.current["/workspace/src"]?.[0]?.name).toBe("current.ts");
  });

  it("retires a stale A deadline without clearing a newer B load", async () => {
    vi.useFakeTimers();
    const staleRead = deferred<{ entries: readonly FileEntry[]; truncated: boolean }>();
    const currentRead = deferred<{ entries: readonly FileEntry[]; truncated: boolean }>();
    const rootRef = { current: "/workspace" as string | null };
    const generationRef = { current: 1 };
    const harness = renderDirectoryLoader({
      deadlineMs: 50,
      generationRef,
      readDirectoryBounded: vi
        .fn()
        .mockReturnValueOnce(staleRead.promise)
        .mockReturnValueOnce(currentRead.promise),
      rootRef,
    });

    const stale = harness.load("/workspace/src");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(25);
    });
    rootRef.current = "/replacement";
    generationRef.current = 2;
    harness.loading.setter(new Set());
    const current = harness.load("/replacement/src");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(25);
      await stale;
    });

    expect(harness.store.size()).toBe(1);
    expect(harness.loading.current.has("/replacement/src")).toBe(true);
    expect(harness.loading.current.has("/workspace/src")).toBe(false);

    currentRead.resolve({ entries: [], truncated: false });
    await act(async () => {
      await current;
    });
    expect(harness.loading.current.has("/replacement/src")).toBe(false);
  });

  it("cancels the owned logical timer on unmount without releasing the physical permit", async () => {
    vi.useFakeTimers();
    const read = deferred<{ entries: readonly FileEntry[]; truncated: boolean }>();
    const harness = renderDirectoryLoader({
      deadlineMs: 50,
      readDirectoryBounded: vi.fn(() => read.promise),
    });

    const pending = harness.load("/workspace/src");
    expect(vi.getTimerCount()).toBe(1);
    const mountedRoot = mountedRoots.shift();
    act(() => mountedRoot?.unmount());
    await act(async () => {
      await pending;
    });

    expect(vi.getTimerCount()).toBe(0);
    expect(harness.failed.current.has("/workspace/src")).toBe(false);
    expect(harness.store.size()).toBe(0);
  });

  it("counts trailing-separator root aliases in the same per-owner quota", () => {
    const store = new BoundedInFlightDirectoryLoads(2, 1);
    const requestId = Symbol("first");
    expect(
      store.admit("first", {
        generation: 1,
        path: "/workspace/one",
        promise: new Promise<never>(() => undefined),
        requestId,
        rootPath: "/workspace",
      }),
    ).toBe(true);

    expect(store.canAdmit("alias", 1, "/workspace/")).toBe(false);
    expect(store.canAdmit("next-generation", 2, "/workspace/")).toBe(true);
  });
});

function render(useHooks: () => void): void {
  const container = document.createElement("div");
  const root = createRoot(container);
  mountedRoots.push(root);

  function Harness() {
    useHooks();
    return null;
  }

  act(() => root.render(<Harness />));
}

interface DirectoryLoaderHarnessOptions {
  readonly deadlineMs?: number;
  readonly gateway?: { readonly readDirectoryBounded: ReturnType<typeof vi.fn> };
  readonly initialEntries?: Record<string, FileEntry[]>;
  readonly generationRef?: { current: number };
  readonly readDirectoryBounded?: ReturnType<typeof vi.fn>;
  readonly rootRef?: { current: string | null };
  readonly store?: BoundedInFlightDirectoryLoads;
}

function renderDirectoryLoader({
  deadlineMs = 5_000,
  gateway,
  generationRef = { current: 1 },
  initialEntries = {},
  readDirectoryBounded = vi.fn(async () => ({ entries: [], truncated: false })),
  rootRef = { current: "/workspace" },
  store = new BoundedInFlightDirectoryLoads(),
}: DirectoryLoaderHarnessOptions) {
  const workspaceFiles = gateway ?? { readDirectoryBounded };
  const entries = stateHarness<Record<string, FileEntry[]>>(initialEntries);
  const failed = stateHarness(new Set<string>());
  const loading = stateHarness(new Set<string>());
  const message = stateHarness<string | null>(null);
  const reportError = vi.fn();
  let load!: ReturnType<typeof useWorkspaceDirectoryLoader>;
  render(() => {
    load = useWorkspaceDirectoryLoader({
      currentWorkspaceRootRef: rootRef,
      inFlightLoadsRef: { current: store },
      interactiveDeadlineMs: deadlineMs,
      openWorkspaceRequestTokenRef: generationRef,
      reportError,
      setEntriesByDirectory: entries.setter,
      setFailedDirectories: failed.setter,
      setLoadingDirectories: loading.setter,
      setMessage: message.setter,
      workspaceFiles: workspaceFiles as never,
    });
  });
  return {
    entries,
    failed,
    load,
    loading,
    message,
    readDirectoryBounded: workspaceFiles.readDirectoryBounded,
    reportError,
    store,
  };
}

function stateHarness<T>(initial: T): {
  readonly current: T;
  readonly setter: Dispatch<SetStateAction<T>>;
} {
  let current = initial;
  return {
    get current() {
      return current;
    },
    setter: (update) => {
      current = typeof update === "function" ? (update as (previous: T) => T)(current) : update;
    },
  };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly reject: (error: unknown) => void;
  readonly resolve: (value: T) => void;
} {
  let reject!: (error: unknown) => void;
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}
