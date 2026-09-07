// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { AgentProjectDescriptor } from "../domain/agentProject";
import type { AgentThread } from "../domain/agentThread";
import type { WorkspaceFileChangeEvent } from "../domain/workspaceFileChange";
import {
  externalAgentWorktreeRoot,
  useAgentWorktreeFileChanges,
} from "./useAgentWorktreeFileChanges";

const project: AgentProjectDescriptor = {
  rootKey: "/repo",
  rootPath: "/repo",
  ownerId: "owner",
  label: "repo",
  generation: 1,
  trust: "trusted",
  origin: "active-tab",
  repositories: [],
  isolationPolicy: "auto",
  leaseToken: 1,
};
const thread: AgentThread = {
  threadId: "thread",
  owner: { rootKey: "/repo", ownerId: "owner", repositoryRoot: "/repo" },
  target: { isolation: "worktree", worktreePath: "/external/worktree" },
  provider: { kind: "codex", sessionId: null },
  title: "task",
  pinned: false,
  archived: false,
  createdAtEpochMs: 1,
  updatedAtEpochMs: 1,
  turns: [],
  turnsTruncated: false,
  integration: null,
  viewedAtEpochMs: null,
  externalOrigin: null,
};

function fixture() {
  const listeners: ((event: WorkspaceFileChangeEvent) => void)[] = [];
  const dispose = vi.fn();
  return {
    project,
    thread,
    openWorkspaceRoots: ["/repo"],
    workspaceOwnerKey: "session-1",
    handleChange: vi.fn(
      async (_event: WorkspaceFileChangeEvent, _isCurrent: () => boolean) => undefined,
    ),
    reportError: vi.fn(),
    gateway: {
      startWatching: vi.fn(async (_root: string) => undefined),
      releaseRoot: vi.fn(async (_root: string) => undefined),
      subscribeFileChanges: vi.fn(async (listener: (event: WorkspaceFileChangeEvent) => void) => {
        listeners.push(listener);
        return dispose;
      }),
    },
    listeners,
    dispose,
  };
}

describe("external agent worktree synchronization", () => {
  it("derives only an admitted thread worktree outside every open workspace", () => {
    const input = fixture();
    expect(externalAgentWorktreeRoot(input)).toBe("/external/worktree");
    expect(
      externalAgentWorktreeRoot({ ...input, project: { ...project, ownerId: "other" } }),
    ).toBeNull();
    expect(externalAgentWorktreeRoot({ ...input, openWorkspaceRoots: ["/external"] })).toBeNull();
    expect(
      externalAgentWorktreeRoot({ ...input, openWorkspaceRoots: ["/external/worktree/nested"] }),
    ).toBeNull();
    expect(
      externalAgentWorktreeRoot({
        ...input,
        thread: { ...thread, target: { isolation: "worktree", worktreePath: "/external/../repo" } },
      }),
    ).toBeNull();
  });
  it("starts one watcher, performs initial rescan and rejects foreign and stale events across A B A", async () => {
    vi.useFakeTimers();
    const input = fixture();
    const root = createRoot(document.createElement("div"));
    function Harness({ owner }: { owner: string }) {
      useAgentWorktreeFileChanges({ ...input, workspaceOwnerKey: owner });
      return null;
    }
    try {
      await act(async () => root.render(<Harness owner="a" />));
      expect(input.handleChange).toHaveBeenCalledOnce();
      const lease = input.handleChange.mock.calls[0][1];
      const event: WorkspaceFileChangeEvent = {
        rootPath: "/external/worktree",
        path: "/external/worktree/a",
        relativePath: "a",
        kind: "modified",
      };
      input.listeners[0]({ ...event, rootPath: "/foreign" });
      await act(async () => vi.advanceTimersByTimeAsync(101));
      expect(input.handleChange).toHaveBeenCalledOnce();
      input.listeners[0](event);
      input.listeners[0](event);
      await act(async () => vi.advanceTimersByTimeAsync(101));
      expect(input.handleChange).toHaveBeenCalledTimes(2);
      await act(async () => root.render(<Harness owner="b" />));
      await act(async () => root.render(<Harness owner="a" />));
      expect(lease()).toBe(false);
      expect(input.gateway.releaseRoot).toHaveBeenCalledTimes(2);
      const count = input.handleChange.mock.calls.length;
      input.listeners[0](event);
      await act(async () => vi.advanceTimersByTimeAsync(101));
      expect(input.handleChange).toHaveBeenCalledTimes(count);
    } finally {
      await act(async () => root.unmount());
      vi.useRealTimers();
    }
  });
  it("does not release a watcher that became an open workspace", async () => {
    const input = fixture();
    const root = createRoot(document.createElement("div"));
    function Harness({ roots }: { roots: string[] }) {
      useAgentWorktreeFileChanges({ ...input, openWorkspaceRoots: roots });
      return null;
    }
    await act(async () => root.render(<Harness roots={["/repo"]} />));
    await act(async () => root.render(<Harness roots={["/repo", "/external/worktree"]} />));
    expect(input.gateway.releaseRoot).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });
});
