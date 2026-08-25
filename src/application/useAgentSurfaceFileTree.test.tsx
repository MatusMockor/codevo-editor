// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { FileEntry } from "../domain/workspace";
import type { WorkspaceFileChangeEvent } from "../domain/workspaceFileChange";
import { waitForReact } from "../test/reactTestLifecycle";
import {
  AGENT_SURFACE_TREE_ROOT_ERROR,
  MAX_AGENT_SURFACE_TREE_DIRECTORIES,
  MAX_AGENT_SURFACE_TREE_ENTRIES,
  agentSurfaceTreeDepth,
  orderAgentSurfaceEntries,
  useAgentSurfaceFileTree,
  type AgentSurfaceFileTreeDependencies,
  type AgentSurfaceFileTreeSurface,
  type AgentSurfaceFileTreeTarget,
} from "./useAgentSurfaceFileTree";

const ROOT = "/workspace/app";
const WORKTREE = `${ROOT}/.worktrees/agt-1`;
const TARGET: AgentSurfaceFileTreeTarget = {
  workspaceId: "ws-1",
  threadId: "agt-1",
  rootPath: WORKTREE,
};

function directory(path: string): FileEntry {
  return { name: path.slice(path.lastIndexOf("/") + 1), path, kind: "directory" };
}

function file(path: string): FileEntry {
  return { name: path.slice(path.lastIndexOf("/") + 1), path, kind: "file" };
}

interface Listing {
  readonly entries: FileEntry[];
  readonly truncated: boolean;
}

function renderTree(options: {
  readonly listings?: Record<string, Listing | Error>;
  readonly target?: AgentSurfaceFileTreeTarget | null;
  readonly bounded?: boolean;
  readonly withChanges?: boolean;
}) {
  const listings: Record<string, Listing | Error> = options.listings ?? {};
  const readDirectory = vi.fn(async (path: string): Promise<FileEntry[]> => {
    const listing = listings[path];
    if (listing instanceof Error) throw listing;
    if (listing === undefined) return [];
    return listing.entries;
  });
  const readDirectoryBounded = vi.fn(async (path: string, maxEntries: number) => {
    const listing = listings[path];
    if (listing instanceof Error) throw listing;
    if (listing === undefined) return { entries: [], truncated: false };
    return {
      entries: listing.entries.slice(0, maxEntries),
      truncated: listing.truncated || listing.entries.length > maxEntries,
    };
  });
  const listeners: Array<(event: WorkspaceFileChangeEvent) => void> = [];
  const unsubscribe = vi.fn();
  const subscribeFileChanges = vi.fn(
    async (listener: (event: WorkspaceFileChangeEvent) => void) => {
      listeners.push(listener);
      return unsubscribe;
    },
  );
  const environment = { target: options.target === undefined ? TARGET : options.target };
  const dependencies = (): AgentSurfaceFileTreeDependencies => ({
    target: environment.target,
    files: {
      readDirectory,
      readDirectoryBounded: options.bounded === false ? undefined : readDirectoryBounded,
    },
    fileChanges: options.withChanges === true ? { subscribeFileChanges } : null,
  });

  const host = document.createElement("div");
  const root = createRoot(host);
  const captured: { value: AgentSurfaceFileTreeSurface | null } = { value: null };

  function Harness(props: { readonly dependencies: AgentSurfaceFileTreeDependencies }) {
    captured.value = useAgentSurfaceFileTree(props.dependencies);
    return null;
  }

  const render = () => act(() => root.render(<Harness dependencies={dependencies()} />));
  render();

  return {
    readDirectory,
    readDirectoryBounded,
    listeners,
    unsubscribe,
    hook: () => captured.value as AgentSurfaceFileTreeSurface,
    setTarget: (target: AgentSurfaceFileTreeTarget | null) => {
      environment.target = target;
      render();
    },
    emit: (event: WorkspaceFileChangeEvent) => act(() => listeners.forEach((l) => l(event))),
    unmount: () => act(() => root.unmount()),
  };
}

describe("useAgentSurfaceFileTree", () => {
  it("loads the root lazily and orders directories before files", async () => {
    const harness = renderTree({
      listings: {
        [WORKTREE]: {
          entries: [
            file(`${WORKTREE}/zeta.ts`),
            directory(`${WORKTREE}/src`),
            file(`${WORKTREE}/Alpha.md`),
          ],
          truncated: false,
        },
      },
    });
    await waitForReact(() => expect(harness.hook().entriesByDirectory[WORKTREE]).toBeDefined());
    expect(harness.hook().entriesByDirectory[WORKTREE]?.map((entry) => entry.name)).toEqual([
      "src",
      "Alpha.md",
      "zeta.ts",
    ]);
    expect(harness.readDirectoryBounded).toHaveBeenCalledWith(
      WORKTREE,
      MAX_AGENT_SURFACE_TREE_ENTRIES,
    );
    expect(harness.readDirectoryBounded).toHaveBeenCalledTimes(1);
    expect(harness.hook().rootPath).toBe(WORKTREE);
    harness.unmount();
  });

  it("expands a directory with one read, collapses without re-reading and refuses foreign paths", async () => {
    const harness = renderTree({
      listings: {
        [WORKTREE]: { entries: [directory(`${WORKTREE}/src`)], truncated: false },
        [`${WORKTREE}/src`]: { entries: [file(`${WORKTREE}/src/a.ts`)], truncated: false },
      },
    });
    await waitForReact(() => expect(harness.hook().entriesByDirectory[WORKTREE]).toBeDefined());

    act(() => harness.hook().toggleDirectory(`${WORKTREE}/src`));
    expect(harness.hook().loadingDirectories.has(`${WORKTREE}/src`)).toBe(true);
    await waitForReact(() =>
      expect(harness.hook().entriesByDirectory[`${WORKTREE}/src`]).toHaveLength(1),
    );
    expect(harness.hook().expandedDirectories.has(`${WORKTREE}/src`)).toBe(true);

    act(() => harness.hook().toggleDirectory(`${WORKTREE}/src`));
    act(() => harness.hook().toggleDirectory(`${WORKTREE}/src`));
    act(() => harness.hook().toggleDirectory(`${ROOT}/src`));
    act(() => harness.hook().toggleDirectory(`${WORKTREE}/../secret`));
    expect(harness.readDirectoryBounded).toHaveBeenCalledTimes(2);
    expect(harness.hook().expandedDirectories.has(`${WORKTREE}/src`)).toBe(true);
    harness.unmount();
  });

  it("marks truncated directories and falls back to the unbounded reader", async () => {
    const entries = Array.from({ length: MAX_AGENT_SURFACE_TREE_ENTRIES + 5 }, (_, index) =>
      file(`${WORKTREE}/file-${String(index).padStart(5, "0")}.ts`),
    );
    const harness = renderTree({
      listings: { [WORKTREE]: { entries, truncated: false } },
      bounded: false,
    });
    await waitForReact(() => expect(harness.hook().entriesByDirectory[WORKTREE]).toBeDefined());
    expect(harness.hook().entriesByDirectory[WORKTREE]).toHaveLength(
      MAX_AGENT_SURFACE_TREE_ENTRIES,
    );
    expect(harness.hook().truncatedDirectories.has(WORKTREE)).toBe(true);
    expect(harness.readDirectory).toHaveBeenCalledTimes(1);
    harness.unmount();
  });

  it("records a failed directory, reports the root error and retries on demand", async () => {
    const harness = renderTree({ listings: { [WORKTREE]: new Error("EACCES") } });
    await waitForReact(() => expect(harness.hook().failedDirectories.has(WORKTREE)).toBe(true));
    expect(harness.hook().rootError).toBe(AGENT_SURFACE_TREE_ROOT_ERROR);

    act(() => harness.hook().retryDirectory(WORKTREE));
    expect(harness.readDirectoryBounded).toHaveBeenCalledTimes(2);
    harness.unmount();
  });

  it("drops the cache and late results when the thread changes", async () => {
    let release: (entries: FileEntry[]) => void = () => undefined;
    const harness = renderTree({
      listings: { [WORKTREE]: { entries: [file(`${WORKTREE}/a.ts`)], truncated: false } },
    });
    await waitForReact(() => expect(harness.hook().entriesByDirectory[WORKTREE]).toBeDefined());

    harness.readDirectoryBounded.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = (entries) => resolve({ entries, truncated: false });
        }),
    );
    act(() => harness.hook().toggleDirectory(`${WORKTREE}/src`));
    await waitForReact(() => expect(harness.readDirectoryBounded).toHaveBeenCalledTimes(2));

    const other = `${ROOT}/.worktrees/agt-2`;
    harness.setTarget({ workspaceId: "ws-1", threadId: "agt-2", rootPath: other });
    await act(async () => {
      release([file(`${WORKTREE}/src/late.ts`)]);
      await Promise.resolve();
    });
    expect(harness.hook().entriesByDirectory[`${WORKTREE}/src`]).toBeUndefined();
    expect(harness.hook().entriesByDirectory[WORKTREE]).toBeUndefined();
    expect(harness.hook().expandedDirectories.size).toBe(0);
    await waitForReact(() => expect(harness.hook().entriesByDirectory[other]).toBeDefined());

    harness.setTarget(null);
    expect(harness.hook().rootPath).toBeNull();
    expect(harness.hook().entriesByDirectory).toEqual({});
    harness.unmount();
  });

  it("evicts collapsed directories first, then the oldest expanded ones, never the root", async () => {
    const total = MAX_AGENT_SURFACE_TREE_DIRECTORIES + 4;
    const child = (index: number) => `${WORKTREE}/d${String(index).padStart(3, "0")}`;
    const listings: Record<string, Listing> = {
      [WORKTREE]: {
        entries: Array.from({ length: total }, (_, index) => directory(child(index))),
        truncated: false,
      },
    };
    const harness = renderTree({ listings });
    await waitForReact(() => expect(harness.hook().entriesByDirectory[WORKTREE]).toBeDefined());

    for (let index = 0; index < total; index += 1) {
      act(() => harness.hook().toggleDirectory(child(index)));
      await waitForReact(() =>
        expect(harness.hook().entriesByDirectory[child(index)]).toBeDefined(),
      );
      if (index === 1 || index === 2) act(() => harness.hook().toggleDirectory(child(index)));
    }
    const cached = Object.keys(harness.hook().entriesByDirectory);
    expect(cached).toHaveLength(MAX_AGENT_SURFACE_TREE_DIRECTORIES);
    expect(cached).toContain(WORKTREE);
    expect(harness.hook().entriesByDirectory[WORKTREE]).toHaveLength(total);
    for (const evicted of [1, 2, 0, 3, 4]) {
      expect(cached).not.toContain(child(evicted));
      expect(harness.hook().expandedDirectories.has(child(evicted))).toBe(false);
    }
    expect(cached).toContain(child(5));
    expect(cached).toContain(child(total - 1));
    harness.unmount();
  });

  it("re-reads an expanded directory on file-change events and forgets collapsed ones", async () => {
    const harness = renderTree({
      listings: {
        [WORKTREE]: {
          entries: [directory(`${WORKTREE}/src`), directory(`${WORKTREE}/docs`)],
          truncated: false,
        },
        [`${WORKTREE}/src`]: { entries: [], truncated: false },
        [`${WORKTREE}/docs`]: { entries: [], truncated: false },
      },
      withChanges: true,
    });
    await waitForReact(() => expect(harness.listeners).toHaveLength(1));
    await waitForReact(() => expect(harness.hook().entriesByDirectory[WORKTREE]).toBeDefined());
    act(() => harness.hook().toggleDirectory(`${WORKTREE}/src`));
    act(() => harness.hook().toggleDirectory(`${WORKTREE}/docs`));
    await waitForReact(() =>
      expect(harness.hook().entriesByDirectory[`${WORKTREE}/docs`]).toBeDefined(),
    );
    act(() => harness.hook().toggleDirectory(`${WORKTREE}/docs`));
    const reads = harness.readDirectoryBounded.mock.calls.length;

    harness.emit(change(`${WORKTREE}/src/new.ts`));
    harness.emit(change(`${WORKTREE}/docs/new.md`));
    harness.emit(change(`${ROOT}/src/other.ts`));
    await waitForReact(() =>
      expect(harness.readDirectoryBounded.mock.calls.length).toBe(reads + 1),
    );
    expect(harness.readDirectoryBounded).toHaveBeenLastCalledWith(
      `${WORKTREE}/src`,
      MAX_AGENT_SURFACE_TREE_ENTRIES,
    );
    expect(harness.hook().entriesByDirectory[`${WORKTREE}/docs`]).toBeUndefined();

    harness.unmount();
    expect(harness.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("exposes pure helpers for depth and ordering", () => {
    expect(agentSurfaceTreeDepth(WORKTREE, WORKTREE)).toBe(0);
    expect(agentSurfaceTreeDepth(WORKTREE, `${WORKTREE}/a/b/c`)).toBe(3);
    expect(
      orderAgentSurfaceEntries([file("/r/b"), file("/r/B"), directory("/r/z"), file("/r/a")]).map(
        (entry) => entry.name,
      ),
    ).toEqual(["z", "a", "B", "b"]);
  });
});

function change(path: string): WorkspaceFileChangeEvent {
  return {
    rootPath: ROOT,
    kind: "created",
    path,
    relativePath: path.slice(ROOT.length + 1),
    fileKind: "file",
  };
}
