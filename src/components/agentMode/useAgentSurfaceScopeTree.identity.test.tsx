// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { FileEntry } from "../../domain/workspace";
import type { AgentSurfaceFileTreeProps } from "./AgentSurfaceFileTree";
import type { AgentSurfaceScope } from "./agentSurfacePolicy";
import { surfaceRepositoryScope, surfaceThreadView } from "./agentSurfaceTestFixtures";
import { chromeFixture } from "./agentWorkbenchChromeTestFixtures";
import { useAgentSurfaceScopeTree } from "./useAgentSurfaceScopeTree";

interface PendingRead {
  readonly path: string;
  resolve(entries: FileEntry[]): void;
}

interface Selection {
  readonly scope: AgentSurfaceScope;
  readonly thread: AgentThreadView | null;
  readonly threadRootPath: string | null;
}

function file(path: string): FileEntry {
  return { name: path.slice(path.lastIndexOf("/") + 1), path, kind: "file" };
}

function ownedThread(threadId: string, rootKey: string, ownerId: string, root: string) {
  const base = surfaceThreadView();
  return surfaceThreadView({
    thread: {
      ...base.thread,
      threadId,
      owner: { rootKey, ownerId, repositoryRoot: root },
      target: { isolation: "in-place", worktreePath: null },
    },
  });
}

function threadSelection(root: string, threadId: string, generation = 1): Selection {
  const scope = surfaceRepositoryScope(root, generation);
  return {
    scope,
    thread: ownedThread(threadId, scope.projectRootKey, scope.ownerId, root),
    threadRootPath: root,
  };
}

function projectSelection(rootKey: string, ownerId: string, root: string): Selection {
  return {
    scope: { ...surfaceRepositoryScope(root), projectRootKey: rootKey, ownerId },
    thread: null,
    threadRootPath: null,
  };
}

describe("surface tree follows exact owner identity", () => {
  let host: HTMLDivElement;
  let root: Root;
  let current: AgentSurfaceFileTreeProps | null;
  let reads: PendingRead[];
  const readDirectory = vi.fn(
    (path: string) =>
      new Promise<FileEntry[]>((resolve) => {
        reads.push({ path, resolve });
      }),
  );
  const chrome = chromeFixture({
    fileTree: {
      files: { readDirectory },
      fileChanges: null,
      activePath: null,
      revealActivePathSignal: 0,
      onOpenFile: () => undefined,
      onPreviewFile: async () => true,
      revealEditor: () => undefined,
    },
  });

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.clearAllMocks();
    reads = [];
    current = null;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function Harness({ selection }: { readonly selection: Selection }) {
    current = useAgentSurfaceScopeTree({
      chrome,
      filesOpen: true,
      scope: selection.scope,
      thread: selection.thread,
      threadRootPath: selection.threadRootPath,
      onSwitchScope: null,
      onTrustScope: () => undefined,
    });
    return null;
  }

  async function select(selection: Selection): Promise<void> {
    await act(async () => root.render(<Harness selection={selection} />));
  }

  async function settle(index: number, entries: FileEntry[]): Promise<void> {
    const read = reads[index];
    expect(read).toBeDefined();
    await act(async () => read?.resolve(entries));
  }

  function shownPaths(rootPath: string): string[] {
    expect(current).not.toBeNull();
    return (current?.tree.entriesByDirectory[rootPath] ?? []).map((entry) => entry.path);
  }

  it("treats thread A after B as a new owner and drops the first A's late results", async () => {
    await select(threadSelection("/a", "thread-a"));
    await select(threadSelection("/b", "thread-b"));
    await select(threadSelection("/a", "thread-a"));
    expect(reads.map((read) => read.path)).toEqual(["/a", "/b", "/a"]);

    await settle(0, [file("/a/stale.ts")]);
    await settle(1, [file("/b/foreign.ts")]);
    expect(current?.tree.rootPath).toBe("/a");
    expect(shownPaths("/a")).toEqual([]);
    expect(shownPaths("/b")).toEqual([]);

    await settle(2, [file("/a/fresh.ts")]);
    expect(shownPaths("/a")).toEqual(["/a/fresh.ts"]);
  });

  it("never conflates two project owners that share a root path", async () => {
    await select(projectSelection("key-a", "owner-a", "/shared"));
    await select(projectSelection("key-b", "owner-b", "/shared"));
    expect(reads.map((read) => read.path)).toEqual(["/shared", "/shared"]);

    await settle(0, [file("/shared/from-a.ts")]);
    expect(shownPaths("/shared")).toEqual([]);
    await settle(1, [file("/shared/from-b.ts")]);
    expect(shownPaths("/shared")).toEqual(["/shared/from-b.ts"]);
  });

  it("re-reads when the same project root comes back as a newer generation", async () => {
    await select(threadSelection("/a", "thread-a", 1));
    await select(threadSelection("/a", "thread-a", 2));
    expect(reads.map((read) => read.path)).toEqual(["/a", "/a"]);
    await settle(0, [file("/a/old-generation.ts")]);
    expect(shownPaths("/a")).toEqual([]);
    await settle(1, [file("/a/new-generation.ts")]);
    expect(shownPaths("/a")).toEqual(["/a/new-generation.ts"]);
  });

  it("does not switch to a thread whose owner differs even when its path matches", async () => {
    const scope = projectSelection("key-b", "owner-b", "/shared").scope;
    await select({
      scope,
      thread: ownedThread("thread-a", "key-a", "owner-a", "/shared"),
      threadRootPath: "/shared",
    });
    expect(readDirectory).not.toHaveBeenCalled();
    expect(current?.tree.rootPath).toBeNull();
    expect(current?.unavailable).toEqual({ kind: "noProject" });
  });
});
