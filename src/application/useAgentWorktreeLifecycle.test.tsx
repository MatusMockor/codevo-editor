// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { AgentProjectDescriptor } from "../domain/agentProject";
import type { AgentThread, AgentTurn } from "../domain/agentThread";
import type { GitStatus } from "../domain/git";
import type { GitWorktreeDescriptor, GitWorktreeGateway } from "../domain/gitWorktree";
import type { ResolvedGitRepository } from "../domain/gitRepositoryMapping";
import { waitForReact } from "../test/reactTestLifecycle";
import {
  useAgentWorktreeLifecycle,
  type AgentWorktreeLifecycleDependencies,
  type AgentWorktreeLifecycleSurface,
} from "./useAgentWorktreeLifecycle";

const ROOT_KEY = "/workspace/app";
const OWNER_ID = "agent-root:0123456789abcdef";
const RUNTIME_OWNER_ID = "workspace-replaced";
const REPOSITORY_ROOT = "/workspace/app";
const OWNED_WORKTREE = "/workspace/app/.worktrees/agt-1-0a1b";
const ORPHAN_WORKTREE = "/workspace/app/.worktrees/agt-9-0a1b";

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

function runningTurnFixture(): AgentTurn {
  return {
    turnId: "agt-1-0a1c",
    prompt: "do the thing",
    status: { kind: "running" },
    startedAtEpochMs: 10,
    endedAtEpochMs: null,
    events: [],
    eventsTruncated: false,
    lastStatusSequence: 1,
    lastOutputSequence: 0,
    launch: null,
    cliVersion: null,
  };
}

function thread(overrides: Partial<AgentThread> = {}): AgentThread {
  return {
    threadId: "agt-1-0a1b",
    owner: { rootKey: ROOT_KEY, ownerId: OWNER_ID, repositoryRoot: REPOSITORY_ROOT },
    target: { isolation: "worktree", worktreePath: OWNED_WORKTREE },
    provider: { kind: "claudeCode", sessionId: null },
    title: "Fix the parser",
    pinned: false,
    archived: false,
    createdAtEpochMs: 10,
    updatedAtEpochMs: 10,
    turns: [],
    turnsTruncated: false,
    viewedAtEpochMs: null,
    externalOrigin: null,
    integration: null,
    ...overrides,
  };
}

function worktree(
  worktreePath: string,
  overrides: Partial<GitWorktreeDescriptor> = {},
): GitWorktreeDescriptor {
  return {
    worktreePath,
    branch: "agent/agt-1",
    head: "abc",
    isPrimary: false,
    locked: false,
    prunable: false,
    ...overrides,
  };
}

function gitStatus(changeCount: number): GitStatus {
  return {
    branch: "main",
    changes: Array.from({ length: changeCount }, (_unused, index) => ({
      isStaged: false,
      isUnversioned: false,
      oldPath: null,
      oldRelativePath: null,
      path: `/workspace/app/src/file-${index}.ts`,
      relativePath: `src/file-${index}.ts`,
      status: "modified" as const,
    })),
    isRepository: true,
    rootPath: REPOSITORY_ROOT,
  };
}

interface Environment {
  projects: ReadonlyArray<AgentProjectDescriptor>;
  threads: ReadonlyMap<string, AgentThread>;
  loadedRootKeys: ReadonlySet<string>;
  worktrees: ReadonlyArray<GitWorktreeDescriptor>;
  changeCount: number;
  confirmResult: boolean;
}

function renderLifecycle(overrides: Partial<Environment> = {}) {
  const environment: Environment = {
    projects: [project()],
    threads: new Map([["agt-1-0a1b", thread()]]),
    loadedRootKeys: new Set([ROOT_KEY]),
    worktrees: [worktree(OWNED_WORKTREE)],
    changeCount: 0,
    confirmResult: true,
    ...overrides,
  };

  const gitWorktreeGateway = {
    listWorktrees: vi.fn(async () => environment.worktrees),
    addAgentWorktree: vi.fn(async () => ({
      worktreePath: OWNED_WORKTREE,
      branch: "agent/agt-1",
      trusted: true,
    })),
    removeWorktree: vi.fn(async () => undefined),
    pruneWorktrees: vi.fn(async () => []),
  };
  const gitGateway = { getStatus: vi.fn(async () => gitStatus(environment.changeCount)) };
  const prompter = { confirm: vi.fn(() => environment.confirmResult), prompt: vi.fn(() => null) };
  const reportError = vi.fn();
  const setNotice = vi.fn();
  const onWorktreeRemovalChanged = vi.fn();
  const onWorktreeRemoved = vi.fn();

  const dependencies = (): AgentWorktreeLifecycleDependencies => ({
    gitWorktreeGateway: gitWorktreeGateway as unknown as GitWorktreeGateway,
    gitGateway,
    prompter,
    projects: environment.projects,
    threads: environment.threads,
    loadedRootKeys: environment.loadedRootKeys,
    reportError,
    setNotice,
    onWorktreeRemovalChanged,
    onWorktreeRemoved,
  });

  const host = document.createElement("div");
  const root = createRoot(host);
  const captured: { value: AgentWorktreeLifecycleSurface | null } = { value: null };

  function Harness(props: { readonly dependencies: AgentWorktreeLifecycleDependencies }) {
    captured.value = useAgentWorktreeLifecycle(props.dependencies);
    return null;
  }

  const render = () => act(() => root.render(<Harness dependencies={dependencies()} />));
  render();

  return {
    gitWorktreeGateway,
    gitGateway,
    prompter,
    reportError,
    setNotice,
    onWorktreeRemovalChanged,
    onWorktreeRemoved,
    hook: () => captured.value as AgentWorktreeLifecycleSurface,
    set: (next: Partial<Environment>) => {
      Object.assign(environment, next);
      render();
    },
    unmount: () => act(() => root.unmount()),
  };
}

describe("useAgentWorktreeLifecycle orphans", () => {
  it("reports an agent worktree without a thread and keeps the referenced one", async () => {
    const harness = renderLifecycle({
      worktrees: [worktree(OWNED_WORKTREE), worktree(ORPHAN_WORKTREE)],
    });

    await waitForReact(() => {
      expect(harness.hook().orphanedWorktrees).toHaveLength(1);
    });

    expect(harness.hook().orphanedWorktrees[0]?.worktreePath).toBe(ORPHAN_WORKTREE);
    expect(harness.hook().orphanedWorktrees[0]?.removing).toBe(false);
    harness.unmount();
  });

  it("reports no orphans before the root is loaded", async () => {
    const harness = renderLifecycle({
      loadedRootKeys: new Set(),
      worktrees: [worktree(ORPHAN_WORKTREE)],
    });

    await waitForReact(() => {
      expect(harness.hook().orphanedWorktrees).toEqual([]);
    });

    expect(harness.gitWorktreeGateway.listWorktrees).not.toHaveBeenCalled();

    harness.set({ loadedRootKeys: new Set([ROOT_KEY]) });
    await waitForReact(() => {
      expect(harness.hook().orphanedWorktrees).toHaveLength(1);
    });
    harness.unmount();
  });

  it("skips an untrusted project", async () => {
    const harness = renderLifecycle({
      projects: [project({ trust: "untrusted" })],
      worktrees: [worktree(ORPHAN_WORKTREE)],
    });

    await waitForReact(() => {
      expect(harness.hook().orphanedWorktrees).toEqual([]);
    });

    expect(harness.gitWorktreeGateway.listWorktrees).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("refuses to prune while an uncertain worktree is retained", async () => {
    const harness = renderLifecycle();
    await waitForReact(() => {
      expect(harness.gitWorktreeGateway.listWorktrees).toHaveBeenCalled();
    });

    act(() => harness.hook().retainUncertainWorktree(ORPHAN_WORKTREE));
    await act(async () => {
      await harness.hook().pruneOrphanedWorktrees(REPOSITORY_ROOT);
    });

    expect(harness.gitWorktreeGateway.pruneWorktrees).not.toHaveBeenCalled();
    expect(harness.setNotice).toHaveBeenCalledWith({
      kind: "warning",
      message:
        "Worktrees with uncertain live agents cannot be pruned until terminal cleanup is proven.",
      action: null,
    });
    harness.unmount();
  });

  it("removes an orphaned worktree after confirming its dirty changes", async () => {
    const harness = renderLifecycle({
      worktrees: [worktree(ORPHAN_WORKTREE)],
      changeCount: 2,
    });
    await waitForReact(() => {
      expect(harness.hook().orphanedWorktrees).toHaveLength(1);
    });

    await act(async () => {
      await harness.hook().removeOrphanedWorktree(ORPHAN_WORKTREE);
    });

    expect(harness.prompter.confirm).toHaveBeenCalledTimes(1);
    expect(harness.gitWorktreeGateway.removeWorktree).toHaveBeenCalledWith(
      REPOSITORY_ROOT,
      ORPHAN_WORKTREE,
      true,
    );
    harness.unmount();
  });

  it("publishes no orphan removal result after the project owner is replaced", async () => {
    const harness = renderLifecycle({ worktrees: [worktree(ORPHAN_WORKTREE)] });
    await waitForReact(() => expect(harness.hook().orphanedWorktrees).toHaveLength(1));
    const pendingRemoval = createDeferred<undefined>();
    harness.gitWorktreeGateway.removeWorktree.mockImplementationOnce(
      async () => pendingRemoval.promise,
    );

    let removal: Promise<void> | null = null;
    act(() => {
      removal = harness.hook().removeOrphanedWorktree(ORPHAN_WORKTREE);
    });
    await waitForReact(() => {
      expect(harness.gitWorktreeGateway.removeWorktree).toHaveBeenCalledTimes(1);
    });
    harness.set({ projects: [project({ generation: 2 })] });
    const noticeCount = harness.setNotice.mock.calls.length;
    const reportCount = harness.reportError.mock.calls.length;
    pendingRemoval.resolve(undefined);
    await act(async () => {
      await removal;
    });

    expect(harness.setNotice).toHaveBeenCalledTimes(noticeCount);
    expect(harness.reportError).toHaveBeenCalledTimes(reportCount);
    await waitForReact(() => {
      expect(harness.hook().orphanedWorktrees[0]?.removing).toBe(false);
    });
    harness.unmount();
  });

  it("publishes no orphan removal error after the project owner is replaced", async () => {
    const harness = renderLifecycle({ worktrees: [worktree(ORPHAN_WORKTREE)] });
    await waitForReact(() => expect(harness.hook().orphanedWorktrees).toHaveLength(1));
    const pendingRemoval = createDeferred<undefined>();
    harness.gitWorktreeGateway.removeWorktree.mockImplementationOnce(
      async () => pendingRemoval.promise,
    );

    let removal: Promise<void> | null = null;
    act(() => {
      removal = harness.hook().removeOrphanedWorktree(ORPHAN_WORKTREE);
    });
    await waitForReact(() => {
      expect(harness.gitWorktreeGateway.removeWorktree).toHaveBeenCalledTimes(1);
    });
    harness.set({ projects: [project({ generation: 2 })] });
    const noticeCount = harness.setNotice.mock.calls.length;
    const reportCount = harness.reportError.mock.calls.length;
    pendingRemoval.reject(new Error("remove failed"));
    await act(async () => {
      await removal;
    });

    expect(harness.setNotice).toHaveBeenCalledTimes(noticeCount);
    expect(harness.reportError).toHaveBeenCalledTimes(reportCount);
    harness.unmount();
  });
});

describe("useAgentWorktreeLifecycle missing worktrees", () => {
  it("keeps a freshly created worktree present while an older listing settles", async () => {
    const harness = renderLifecycle({ worktrees: [] });
    await waitForReact(() => {
      expect([...harness.hook().missingWorktreeThreadIds]).toEqual(["agt-1-0a1b"]);
    });
    const pendingListing = createDeferred<ReadonlyArray<GitWorktreeDescriptor>>();
    harness.gitWorktreeGateway.listWorktrees.mockImplementationOnce(
      async () => pendingListing.promise,
    );

    let refresh: Promise<void> | null = null;
    act(() => {
      refresh = harness.hook().refreshOrphanedWorktrees();
    });
    await waitForReact(() => {
      expect(harness.gitWorktreeGateway.listWorktrees).toHaveBeenCalledTimes(2);
    });
    act(() => harness.hook().noteCreatedWorktree(REPOSITORY_ROOT, OWNED_WORKTREE));
    expect([...harness.hook().missingWorktreeThreadIds]).toEqual([]);

    harness.set({ worktrees: [worktree(OWNED_WORKTREE)] });
    await act(async () => {
      await harness.hook().refreshOrphanedWorktrees();
    });
    expect([...harness.hook().missingWorktreeThreadIds]).toEqual([]);

    pendingListing.resolve([]);
    await act(async () => {
      await refresh;
    });
    expect([...harness.hook().missingWorktreeThreadIds]).toEqual([]);

    harness.set({ worktrees: [] });
    await act(async () => {
      await harness.hook().refreshOrphanedWorktrees();
    });
    expect([...harness.hook().missingWorktreeThreadIds]).toEqual(["agt-1-0a1b"]);
    harness.unmount();
  });

  it("rejects a listing from before an A to B to A ownership round trip", async () => {
    const harness = renderLifecycle();
    await waitForReact(() => {
      expect([...harness.hook().missingWorktreeThreadIds]).toEqual([]);
    });
    const pendingListing = createDeferred<ReadonlyArray<GitWorktreeDescriptor>>();
    harness.gitWorktreeGateway.listWorktrees.mockImplementationOnce(
      async () => pendingListing.promise,
    );

    let staleRefresh: Promise<void> | null = null;
    act(() => {
      staleRefresh = harness.hook().refreshOrphanedWorktrees();
    });
    await waitForReact(() => {
      expect(harness.gitWorktreeGateway.listWorktrees).toHaveBeenCalledTimes(2);
    });
    harness.set({
      projects: [project({ rootKey: "/workspace/other", ownerId: "workspace-b", generation: 2 })],
    });
    harness.set({ projects: [project({ generation: 3 })] });
    pendingListing.resolve([]);
    await act(async () => {
      await staleRefresh;
    });

    expect([...harness.hook().missingWorktreeThreadIds]).toEqual([]);
    harness.unmount();
  });

  it("suppresses a listing error from before an A to B to A ownership round trip", async () => {
    const harness = renderLifecycle();
    await waitForReact(() => expect(harness.gitWorktreeGateway.listWorktrees).toHaveBeenCalled());
    const pendingListing = createDeferred<ReadonlyArray<GitWorktreeDescriptor>>();
    harness.gitWorktreeGateway.listWorktrees.mockImplementationOnce(
      async () => pendingListing.promise,
    );

    let staleRefresh: Promise<void> | null = null;
    act(() => {
      staleRefresh = harness.hook().refreshOrphanedWorktrees();
    });
    await waitForReact(() => {
      expect(harness.gitWorktreeGateway.listWorktrees).toHaveBeenCalledTimes(2);
    });
    harness.set({
      projects: [project({ rootKey: "/workspace/other", ownerId: "workspace-b", generation: 2 })],
    });
    harness.set({ projects: [project({ generation: 3 })] });
    const reportCount = harness.reportError.mock.calls.length;
    pendingListing.reject(new Error("stale listing failed"));
    await act(async () => {
      await staleRefresh;
    });

    expect(harness.reportError).toHaveBeenCalledTimes(reportCount);
    harness.unmount();
  });

  it("marks a thread whose worktree is gone or prunable", async () => {
    const harness = renderLifecycle({ worktrees: [] });

    await waitForReact(() => {
      expect([...harness.hook().missingWorktreeThreadIds]).toEqual(["agt-1-0a1b"]);
    });

    harness.set({ worktrees: [worktree(OWNED_WORKTREE)] });
    await act(async () => {
      await harness.hook().refreshOrphanedWorktrees();
    });
    expect([...harness.hook().missingWorktreeThreadIds]).toEqual([]);

    harness.set({ worktrees: [worktree(OWNED_WORKTREE, { prunable: true })] });
    await act(async () => {
      await harness.hook().refreshOrphanedWorktrees();
    });
    expect([...harness.hook().missingWorktreeThreadIds]).toEqual(["agt-1-0a1b"]);
    harness.unmount();
  });

  it("does not mark a thread when the repository could not be listed", async () => {
    const harness = renderLifecycle();
    harness.gitWorktreeGateway.listWorktrees.mockRejectedValue(new Error("git unavailable"));
    harness.set({ projects: [project({ generation: 2 })] });

    await waitForReact(() => {
      expect(harness.reportError).toHaveBeenCalledWith("Agents", expect.any(Error));
    });

    expect([...harness.hook().missingWorktreeThreadIds]).toEqual([]);
    harness.unmount();
  });
});

function createDeferred<T>(): {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
} {
  let resolve = (_value: T): void => undefined;
  let reject = (_error: unknown): void => undefined;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

describe("useAgentWorktreeLifecycle removeWorktree", () => {
  it("removes a worktree owned by a retained runtime identity", async () => {
    const runtimeThread = thread({
      owner: { rootKey: ROOT_KEY, ownerId: RUNTIME_OWNER_ID, repositoryRoot: REPOSITORY_ROOT },
    });
    const harness = renderLifecycle({
      projects: [project({ runtimeOwnerIds: [OWNER_ID, RUNTIME_OWNER_ID] })],
      threads: new Map([[runtimeThread.threadId, runtimeThread]]),
    });
    await act(() => harness.hook().removeWorktree(runtimeThread.threadId));
    expect(harness.gitWorktreeGateway.removeWorktree).toHaveBeenCalledWith(
      REPOSITORY_ROOT,
      OWNED_WORKTREE,
      false,
    );
    harness.unmount();
  });
  it("removes the worktree of a settled thread and marks it removed", async () => {
    const harness = renderLifecycle();
    await waitForReact(() => {
      expect(harness.gitWorktreeGateway.listWorktrees).toHaveBeenCalled();
    });

    await act(async () => {
      await harness.hook().removeWorktree("agt-1-0a1b");
    });

    expect(harness.onWorktreeRemovalChanged).toHaveBeenCalledWith("agt-1-0a1b", true);
    expect(harness.gitWorktreeGateway.removeWorktree).toHaveBeenCalledWith(
      REPOSITORY_ROOT,
      OWNED_WORKTREE,
      false,
    );
    expect(harness.onWorktreeRemoved).toHaveBeenCalledWith("agt-1-0a1b");
    expect(harness.hook().removedWorktreeThreadIds.has("agt-1-0a1b")).toBe(true);
    harness.unmount();
  });

  it("refuses to remove the worktree of a running thread", async () => {
    const running = thread({ turns: [runningTurnFixture()] });
    const harness = renderLifecycle({ threads: new Map([["agt-1-0a1b", running]]) });

    await act(async () => {
      await harness.hook().removeWorktree("agt-1-0a1b");
    });

    expect(harness.gitWorktreeGateway.removeWorktree).not.toHaveBeenCalled();
    expect(harness.setNotice).toHaveBeenCalledWith({
      kind: "warning",
      message: "Stop the agent before removing its worktree.",
      action: null,
    });
    harness.unmount();
  });

  it("keeps the removal flag off when the dirty confirmation is refused", async () => {
    const harness = renderLifecycle({ changeCount: 1, confirmResult: false });
    await waitForReact(() => {
      expect(harness.gitWorktreeGateway.listWorktrees).toHaveBeenCalled();
    });

    await act(async () => {
      await harness.hook().removeWorktree("agt-1-0a1b");
    });

    expect(harness.gitWorktreeGateway.removeWorktree).not.toHaveBeenCalled();
    expect(harness.onWorktreeRemovalChanged).toHaveBeenLastCalledWith("agt-1-0a1b", false);
    harness.unmount();
  });

  it("does not remove a replacement thread that starts while confirmation is pending", async () => {
    const harness = renderLifecycle({ changeCount: 1 });
    const pendingConfirmation = createDeferred<boolean>();
    harness.prompter.confirm.mockImplementationOnce(() => pendingConfirmation.promise as never);

    let removal: Promise<void> | null = null;
    act(() => {
      removal = harness.hook().removeWorktree("agt-1-0a1b");
    });
    await waitForReact(() => expect(harness.prompter.confirm).toHaveBeenCalledTimes(1));
    const replacement = thread({ turns: [runningTurnFixture()] });
    harness.set({ threads: new Map([[replacement.threadId, replacement]]) });
    pendingConfirmation.resolve(true);
    await act(async () => {
      await removal;
    });

    expect(harness.gitWorktreeGateway.removeWorktree).not.toHaveBeenCalled();
    expect(harness.onWorktreeRemovalChanged).toHaveBeenCalledTimes(1);
    harness.unmount();
  });

  it("publishes no confirmation error after an A to B to A ownership round trip", async () => {
    const harness = renderLifecycle({ changeCount: 1 });
    const pendingConfirmation = createDeferred<boolean>();
    harness.prompter.confirm.mockImplementationOnce(() => pendingConfirmation.promise as never);

    let removal: Promise<void> | null = null;
    act(() => {
      removal = harness.hook().removeWorktree("agt-1-0a1b");
    });
    await waitForReact(() => expect(harness.prompter.confirm).toHaveBeenCalledTimes(1));
    harness.set({
      projects: [project({ rootKey: "/workspace/other", ownerId: "workspace-b", generation: 2 })],
    });
    harness.set({ projects: [project({ generation: 3 })] });
    const noticeCount = harness.setNotice.mock.calls.length;
    const reportCount = harness.reportError.mock.calls.length;
    pendingConfirmation.reject(new Error("dialog unavailable"));
    await act(async () => {
      await removal;
    });

    expect(harness.setNotice).toHaveBeenCalledTimes(noticeCount);
    expect(harness.reportError).toHaveBeenCalledTimes(reportCount);
    expect(harness.onWorktreeRemovalChanged).toHaveBeenCalledTimes(1);
    harness.unmount();
  });

  it("fails closed when the dirty confirmation rejects", async () => {
    const harness = renderLifecycle({ changeCount: 1 });
    harness.prompter.confirm.mockImplementationOnce(
      () => Promise.reject(new Error("dialog unavailable")) as never,
    );
    await waitForReact(() => {
      expect(harness.gitWorktreeGateway.listWorktrees).toHaveBeenCalled();
    });

    await act(async () => {
      await harness.hook().removeWorktree("agt-1-0a1b");
    });

    expect(harness.gitWorktreeGateway.removeWorktree).not.toHaveBeenCalled();
    expect(harness.onWorktreeRemovalChanged).toHaveBeenLastCalledWith("agt-1-0a1b", false);
    harness.unmount();
  });
});

describe("useAgentWorktreeLifecycle markWorktreeRemoved", () => {
  it("marks a thread's worktree removed without touching git and refreshes orphans", async () => {
    const harness = renderLifecycle();
    await waitForReact(() => {
      expect(harness.gitWorktreeGateway.listWorktrees).toHaveBeenCalledTimes(1);
    });

    act(() => harness.hook().markWorktreeRemoved("agt-1-0a1b"));

    expect(harness.hook().removedWorktreeThreadIds.has("agt-1-0a1b")).toBe(true);
    expect(harness.onWorktreeRemoved).toHaveBeenCalledWith("agt-1-0a1b");
    expect(harness.gitWorktreeGateway.removeWorktree).not.toHaveBeenCalled();
    await waitForReact(() => {
      expect(harness.gitWorktreeGateway.listWorktrees).toHaveBeenCalledTimes(2);
    });
    harness.unmount();
  });
});
