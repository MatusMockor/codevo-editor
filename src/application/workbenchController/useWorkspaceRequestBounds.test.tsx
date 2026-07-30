// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileEntry } from "../../domain/workspace";
import {
  BoundedInFlightDirectoryLoads,
  MAX_DIRECTORY_ENTRIES_PER_LOAD,
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
