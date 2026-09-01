// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { AgentProjectDescriptor } from "../domain/agentProject";
import type { AgentShipState } from "../domain/agentShip";
import type { AgentThread, AgentThreadsAction, AgentTurn } from "../domain/agentThread";
import type { GitChangedFile, GitStatus } from "../domain/git";
import type {
  GitIntegrateBranchRequest,
  GitIntegrationOutcome,
  GitPushReceipt,
  GitShipStatus,
} from "../domain/gitIntegration";
import type { ResolvedGitRepository } from "../domain/gitRepositoryMapping";
import { waitForReact } from "../test/reactTestLifecycle";
import {
  useAgentShipFlow,
  type AgentShipFlowDependencies,
  type AgentShipFlowSurface,
} from "./useAgentShipFlow";

const ROOT_KEY = "/workspace/app";
const OWNER_ID = "agent-root:0123456789abcdef";
const RUNTIME_OWNER_ID = "workspace-replaced";
const REPOSITORY_ROOT = "/workspace/app";
const THREAD_ID = "agt-1-0a1b";
const WORKTREE = `${REPOSITORY_ROOT}/.worktrees/${THREAD_ID}`;
const BRANCH = `agent/${THREAD_ID}`;
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);
const SHA_M = "d".repeat(40);
const COMPARE_URL = "https://github.com/o/r/compare/main...agent/x?expand=1";

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

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
    threadId: THREAD_ID,
    owner: { rootKey: ROOT_KEY, ownerId: OWNER_ID, repositoryRoot: REPOSITORY_ROOT },
    target: { isolation: "worktree", worktreePath: WORKTREE },
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

function change(index: number): GitChangedFile {
  return {
    isStaged: false,
    isUnversioned: false,
    oldPath: null,
    oldRelativePath: null,
    path: `${WORKTREE}/src/file-${index}.ts`,
    relativePath: `src/file-${index}.ts`,
    status: "modified",
  };
}

function gitStatus(changeCount: number): GitStatus {
  return {
    branch: BRANCH,
    changes: Array.from({ length: changeCount }, (_unused, index) => change(index)),
    isRepository: true,
    rootPath: WORKTREE,
  };
}

function shipStatus(overrides: Partial<GitShipStatus> = {}): GitShipStatus {
  return {
    worktree: { branch: BRANCH, head: SHA_A, dirty: true, changeCount: 2 },
    primary: { branch: "main", head: SHA_B, dirty: false },
    relation: { aheadOfPrimary: 0, behindPrimary: 0, fastForwardable: true },
    remote: { name: "origin", upstream: null, compareUrl: COMPARE_URL },
    ...overrides,
  };
}

interface Environment {
  projects: ReadonlyArray<AgentProjectDescriptor>;
  threads: ReadonlyMap<string, AgentThread>;
  missing: ReadonlySet<string>;
  changeCount: number;
  ship: GitShipStatus;
  confirmResult: boolean | Promise<boolean>;
  now: number;
  withOpener: boolean;
}

function renderFlow(overrides: Partial<Environment> = {}) {
  const environment: Environment = {
    projects: [project()],
    threads: new Map([[THREAD_ID, thread()]]),
    missing: new Set(),
    changeCount: 2,
    ship: shipStatus(),
    confirmResult: true,
    now: 1_000_000,
    withOpener: true,
    ...overrides,
  };

  const gitGateway = {
    getStatus: vi.fn(async () => gitStatus(environment.changeCount)),
    stageFiles: vi.fn(async () => gitStatus(environment.changeCount)),
    commit: vi.fn(async () => gitStatus(0)),
    deleteBranch: vi.fn(async () => undefined),
  };
  const gitIntegrationGateway = {
    getShipStatus: vi.fn(async () => environment.ship),
    pushBranchUpstream: vi.fn(async (): Promise<GitPushReceipt> => ({
      remote: "origin",
      branch: BRANCH,
      compareUrl: COMPARE_URL,
    })),
    integrateWorktreeBranch: vi.fn(
      async (_request: GitIntegrateBranchRequest): Promise<GitIntegrationOutcome> => ({
        kind: "integrated",
        mergeSha: SHA_M,
        intoBranch: "main",
      }),
    ),
  };
  const gitWorktreeGateway = { removeWorktree: vi.fn(async () => undefined) };
  const externalUrlOpener = { openExternal: vi.fn(async () => undefined) };
  const prompter = { confirm: vi.fn(() => environment.confirmResult), prompt: vi.fn(() => null) };
  const actions: AgentThreadsAction[] = [];
  const dispatchThreadAction = vi.fn((action: AgentThreadsAction) => {
    actions.push(action);
    if (action.kind !== "integrationRecorded") return;
    const current = environment.threads.get(action.threadId);
    if (current === undefined) return;
    environment.threads = new Map(environment.threads).set(action.threadId, {
      ...current,
      integration: action.integration,
    });
  });
  const reportError = vi.fn();
  const setNotice = vi.fn();
  const onWorktreeRemoved = vi.fn();
  const onShipStepCompleted = vi.fn();

  const dependencies = (): AgentShipFlowDependencies => ({
    gitGateway,
    gitIntegrationGateway,
    gitWorktreeGateway,
    externalUrlOpener: environment.withOpener ? externalUrlOpener : null,
    prompter,
    projects: environment.projects,
    threads: environment.threads,
    missingWorktreeThreadIds: environment.missing,
    dispatchThreadAction,
    reportError,
    setNotice,
    onWorktreeRemoved,
    onShipStepCompleted,
    now: () => environment.now,
  });

  const host = document.createElement("div");
  const root = createRoot(host);
  const captured: { value: AgentShipFlowSurface | null } = { value: null };

  function Harness(props: { readonly dependencies: AgentShipFlowDependencies }) {
    captured.value = useAgentShipFlow(props.dependencies);
    return null;
  }

  const render = () => act(() => root.render(<Harness dependencies={dependencies()} />));
  render();

  return {
    gitGateway,
    gitIntegrationGateway,
    gitWorktreeGateway,
    externalUrlOpener,
    prompter,
    actions,
    reportError,
    setNotice,
    onWorktreeRemoved,
    onShipStepCompleted,
    hook: () => captured.value as AgentShipFlowSurface,
    state: (): AgentShipState | undefined => captured.value?.states.get(THREAD_ID),
    set: (next: Partial<Environment>) => {
      Object.assign(environment, next);
      render();
    },
    rerender: render,
    unmount: () => act(() => root.unmount()),
  };
}

function lastReceipt(actions: ReadonlyArray<AgentThreadsAction>) {
  const all = receipts(actions);
  return all[all.length - 1];
}

function receipts(actions: ReadonlyArray<AgentThreadsAction>) {
  return actions.flatMap((action) =>
    action.kind === "integrationRecorded" ? [action.integration] : [],
  );
}

describe("useAgentShipFlow happy path", () => {
  it("commits a worktree owned by a retained runtime identity", async () => {
    const runtimeThread = thread({
      owner: { rootKey: ROOT_KEY, ownerId: RUNTIME_OWNER_ID, repositoryRoot: REPOSITORY_ROOT },
    });
    const harness = renderFlow({
      projects: [project({ runtimeOwnerIds: [OWNER_ID, RUNTIME_OWNER_ID] })],
      threads: new Map([[THREAD_ID, runtimeThread]]),
    });
    await act(() => harness.hook().commit(THREAD_ID, "Runtime owner"));
    expect(harness.gitGateway.commit).toHaveBeenCalled();
    harness.unmount();
  });
  it("commits, pushes, integrates and removes with persisted receipts", async () => {
    const harness = renderFlow();

    await act(() => harness.hook().commit(THREAD_ID, "  Fix the parser  "));

    expect(harness.gitGateway.getStatus).toHaveBeenCalledWith(WORKTREE);
    expect(harness.gitGateway.stageFiles).toHaveBeenCalledWith(WORKTREE, gitStatus(2).changes);
    expect(harness.gitGateway.commit).toHaveBeenCalledWith(
      WORKTREE,
      "Fix the parser",
      gitStatus(2).changes,
    );
    expect(harness.state()).toMatchObject({ kind: "committed", commitSha: SHA_A });
    expect(lastReceipt(harness.actions)).toEqual({
      lastCommitSha: SHA_A,
      pushed: null,
      integrated: null,
      branchDeleted: false,
    });
    expect(harness.onShipStepCompleted).toHaveBeenCalledWith(THREAD_ID);

    await act(() => harness.hook().push(THREAD_ID));
    expect(harness.gitIntegrationGateway.pushBranchUpstream).toHaveBeenCalledWith({
      repositoryRoot: REPOSITORY_ROOT,
      worktreePath: WORKTREE,
    });
    expect(harness.state()).toMatchObject({
      kind: "pushed",
      receipt: { remote: "origin", branch: BRANCH, compareUrl: COMPARE_URL },
    });
    expect(lastReceipt(harness.actions)).toMatchObject({
      lastCommitSha: SHA_A,
      pushed: { remote: "origin", branch: BRANCH },
    });

    await act(() => harness.hook().openCompareUrl(THREAD_ID));
    expect(harness.externalUrlOpener.openExternal).toHaveBeenCalledWith(COMPARE_URL);

    await act(() => harness.hook().integrate(THREAD_ID, "fastForward"));
    expect(harness.gitIntegrationGateway.integrateWorktreeBranch).toHaveBeenCalledWith({
      repositoryRoot: REPOSITORY_ROOT,
      worktreePath: WORKTREE,
      mode: "fastForward",
      expectedPrimaryBranch: "main",
      expectedPrimaryHead: SHA_B,
      expectedBranchHead: SHA_A,
      mergeMessage: `Merge ${BRANCH} (Fix the parser)`,
    });
    expect(harness.state()).toMatchObject({
      kind: "integrated",
      mergeSha: SHA_M,
      intoBranch: "main",
    });
    expect(lastReceipt(harness.actions)).toMatchObject({
      integrated: { intoBranch: "main", mergeSha: SHA_M, mode: "fastForward" },
    });

    harness.set({ changeCount: 0 });
    await act(() => harness.hook().removeWorktree(THREAD_ID, { deleteBranch: true }));
    expect(harness.gitWorktreeGateway.removeWorktree).toHaveBeenCalledWith(
      REPOSITORY_ROOT,
      WORKTREE,
      false,
    );
    expect(harness.gitGateway.deleteBranch).toHaveBeenCalledWith(REPOSITORY_ROOT, BRANCH, {
      force: false,
    });
    expect(harness.onWorktreeRemoved).toHaveBeenCalledWith(THREAD_ID);
    expect(harness.state()).toEqual({ kind: "worktreeRemoved", branchDeleted: true });
    expect(lastReceipt(harness.actions)).toMatchObject({ branchDeleted: true });
    expect(harness.setNotice).toHaveBeenLastCalledWith(
      expect.objectContaining({
        message: `The worktree and local branch ${BRANCH} were removed. The remote branch was kept.`,
      }),
    );
    expect(harness.prompter.confirm).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("refreshes status on demand and reconciles a stale committed receipt", async () => {
    const harness = renderFlow({
      threads: new Map([
        [
          THREAD_ID,
          thread({
            integration: {
              lastCommitSha: SHA_C,
              pushed: null,
              integrated: null,
              branchDeleted: false,
            },
          }),
        ],
      ]),
    });

    expect(harness.state()).toBeUndefined();
    await act(() => harness.hook().refreshShipStatus(THREAD_ID));
    expect(harness.state()).toMatchObject({ kind: "idle", status: shipStatus() });
    harness.unmount();
  });

  it("refreshes only the latest status request result", async () => {
    const first = deferred<GitShipStatus>();
    const harness = renderFlow();
    harness.gitIntegrationGateway.getShipStatus.mockReturnValueOnce(first.promise);

    const pending = harness.hook().refreshShipStatus(THREAD_ID);
    await act(() => harness.hook().refreshShipStatus(THREAD_ID));
    expect(harness.state()).toMatchObject({ kind: "idle", status: shipStatus() });

    await act(async () => {
      first.resolve(shipStatus({ primary: { branch: "main", head: SHA_C, dirty: true } }));
      await pending;
    });
    expect(harness.state()).toMatchObject({ kind: "idle", status: shipStatus() });
    harness.unmount();
  });
});

describe("useAgentShipFlow failures", () => {
  it("fails closed with nothingToCommit and refreshes the status", async () => {
    const harness = renderFlow({ changeCount: 0 });
    await act(() => harness.hook().commit(THREAD_ID, "Nothing"));
    expect(harness.state()).toMatchObject({
      kind: "failed",
      failure: { step: "commit", reason: "nothingToCommit" },
      resumeFrom: "idle",
    });
    expect(harness.gitGateway.stageFiles).not.toHaveBeenCalled();
    await waitForReact(() =>
      expect(harness.gitIntegrationGateway.getShipStatus).toHaveBeenCalledTimes(1),
    );
    harness.unmount();
  });

  it("rejects an unbounded or empty commit message without touching git", async () => {
    const harness = renderFlow();
    await act(() => harness.hook().commit(THREAD_ID, "   "));
    await act(() => harness.hook().commit(THREAD_ID, "x".repeat(5_000)));
    expect(harness.gitGateway.getStatus).not.toHaveBeenCalled();
    expect(harness.setNotice).toHaveBeenCalledTimes(2);
    expect(harness.state()).toBeUndefined();
    harness.unmount();
  });

  it("reports a git commit error and leaves the thread resumable", async () => {
    const harness = renderFlow();
    harness.gitGateway.commit.mockRejectedValueOnce(new Error("conflict markers present"));
    await act(() => harness.hook().commit(THREAD_ID, "Fix"));
    expect(harness.state()).toMatchObject({
      kind: "failed",
      failure: { step: "commit", reason: "gitError", message: "conflict markers present" },
      resumeFrom: "idle",
    });
    expect(harness.reportError).toHaveBeenCalled();
    harness.unmount();
  });

  it.each([
    ["noRemote", "noRemote"],
    ["rejected", "rejected"],
    ["authRequired", "authRequired"],
    ["gitError", "gitError"],
    ["somethingElse", "gitError"],
  ])("maps a push failure with reason %s", async (reason, expected) => {
    const harness = renderFlow();
    harness.gitIntegrationGateway.pushBranchUpstream.mockRejectedValueOnce(
      Object.assign(new Error("push failed"), { reason }),
    );
    await act(() => harness.hook().push(THREAD_ID));
    expect(harness.state()).toMatchObject({
      kind: "failed",
      failure: { step: "push", reason: expected, message: "push failed" },
      resumeFrom: "idle",
    });
    expect(receipts(harness.actions)).toEqual([]);
    harness.unmount();
  });

  it("keeps a conflicted integration resumable and refreshes the status", async () => {
    const harness = renderFlow();
    await act(() => harness.hook().commit(THREAD_ID, "Fix"));
    harness.gitIntegrationGateway.integrateWorktreeBranch.mockResolvedValueOnce({
      kind: "conflicted",
      files: ["src/a.ts"],
      truncated: false,
    });
    await act(() => harness.hook().integrate(THREAD_ID, "merge"));
    expect(harness.state()).toMatchObject({
      kind: "failed",
      failure: {
        step: "integrate",
        outcome: { kind: "conflicted", files: ["src/a.ts"], truncated: false },
      },
      resumeFrom: "committed",
    });
    expect(lastReceipt(harness.actions)).toMatchObject({ integrated: null });

    await act(() => harness.hook().integrate(THREAD_ID, "merge"));
    expect(harness.state()).toMatchObject({ kind: "integrated", mergeSha: SHA_M });
    harness.unmount();
  });

  it("refuses to integrate a detached primary and an in-place thread", async () => {
    const harness = renderFlow({
      ship: shipStatus({ primary: { branch: null, head: SHA_B, dirty: false } }),
    });
    await act(() => harness.hook().integrate(THREAD_ID, "fastForward"));
    expect(harness.gitIntegrationGateway.integrateWorktreeBranch).not.toHaveBeenCalled();
    expect(harness.state()).toMatchObject({
      kind: "failed",
      failure: { step: "integrate", outcome: { kind: "primaryDetached" } },
    });

    harness.set({
      threads: new Map([
        [THREAD_ID, thread({ target: { isolation: "in-place", worktreePath: null } })],
      ]),
    });
    await act(() => harness.hook().resetShip(THREAD_ID));
    await act(() => harness.hook().integrate(THREAD_ID, "fastForward"));
    expect(harness.gitIntegrationGateway.integrateWorktreeBranch).not.toHaveBeenCalled();
    expect(harness.setNotice).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: "In-place threads have nothing to integrate." }),
    );
    harness.unmount();
  });

  it("asks before merging a branch that is behind and honours a refusal", async () => {
    const harness = renderFlow({
      ship: shipStatus({
        relation: { aheadOfPrimary: 1, behindPrimary: 3, fastForwardable: false },
      }),
      confirmResult: false,
    });
    await act(() => harness.hook().integrate(THREAD_ID, "merge"));
    expect(harness.prompter.confirm).toHaveBeenCalledWith(
      "The branch is 3 commits behind main. Merge anyway?",
    );
    expect(harness.gitIntegrationGateway.integrateWorktreeBranch).not.toHaveBeenCalled();
    expect(harness.state()?.kind).toBe("idle");
    harness.unmount();
  });

  it("reports a thrown integration error as a git error without claiming an abort failed", async () => {
    const harness = renderFlow();
    harness.gitIntegrationGateway.integrateWorktreeBranch.mockRejectedValueOnce(
      new Error("Another integration is already running for this repository."),
    );
    await act(() => harness.hook().integrate(THREAD_ID, "fastForward"));
    expect(harness.state()).toEqual(
      expect.objectContaining({
        kind: "failed",
        failure: {
          step: "integrate",
          reason: "gitError",
          message: "Another integration is already running for this repository.",
        },
        resumeFrom: "idle",
      }),
    );
    const settled = harness.state();
    expect(settled?.kind === "failed" && "outcome" in settled.failure).toBe(false);
    harness.unmount();
  });

  it("keeps the branch when deletion is refused as not merged", async () => {
    const harness = renderFlow();
    harness.gitGateway.deleteBranch.mockRejectedValueOnce(
      new Error("error: the branch 'agent/x' is not fully merged"),
    );
    await act(() => harness.hook().removeWorktree(THREAD_ID, { deleteBranch: true }));
    expect(harness.gitGateway.deleteBranch).toHaveBeenCalledWith(REPOSITORY_ROOT, BRANCH, {
      force: true,
    });
    expect(harness.onWorktreeRemoved).toHaveBeenCalledWith(THREAD_ID);
    expect(harness.state()).toMatchObject({
      kind: "failed",
      failure: { step: "removeWorktree", reason: "branchNotMerged" },
    });
    expect(receipts(harness.actions)).toEqual([]);
    harness.unmount();
  });

  it("confirms before discarding a dirty worktree and stops on refusal", async () => {
    const harness = renderFlow({ confirmResult: false });
    await act(() => harness.hook().removeWorktree(THREAD_ID, { deleteBranch: false }));
    expect(harness.prompter.confirm).toHaveBeenCalledTimes(1);
    expect(harness.gitWorktreeGateway.removeWorktree).not.toHaveBeenCalled();
    expect(harness.state()).toBeUndefined();

    harness.set({ confirmResult: true });
    await act(() => harness.hook().removeWorktree(THREAD_ID, { deleteBranch: false }));
    expect(harness.gitWorktreeGateway.removeWorktree).toHaveBeenCalledWith(
      REPOSITORY_ROOT,
      WORKTREE,
      true,
    );
    expect(harness.gitGateway.deleteBranch).not.toHaveBeenCalled();
    expect(harness.state()).toEqual({ kind: "worktreeRemoved", branchDeleted: false });
    harness.unmount();
  });

  it("refuses every step while a turn runs or the worktree is missing", async () => {
    const harness = renderFlow({
      threads: new Map([[THREAD_ID, thread({ turns: [runningTurnFixture()] })]]),
    });
    await act(() => harness.hook().commit(THREAD_ID, "Fix"));
    expect(harness.gitGateway.getStatus).not.toHaveBeenCalled();
    expect(harness.setNotice).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: "Stop the agent before shipping its changes." }),
    );

    harness.set({ threads: new Map([[THREAD_ID, thread()]]), missing: new Set([THREAD_ID]) });
    await act(() => harness.hook().push(THREAD_ID));
    expect(harness.gitIntegrationGateway.pushBranchUpstream).not.toHaveBeenCalled();
    expect(harness.state()).toBeUndefined();
    harness.unmount();
  });

  it("shows the URL as a notice without an opener and reports an opener failure", async () => {
    const harness = renderFlow({ withOpener: false });
    await act(() => harness.hook().push(THREAD_ID));
    await act(() => harness.hook().openCompareUrl(THREAD_ID));
    expect(harness.setNotice).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "info", message: `Open the compare page: ${COMPARE_URL}` }),
    );

    harness.set({ withOpener: true });
    harness.externalUrlOpener.openExternal.mockRejectedValueOnce(new Error("denied"));
    await act(() => harness.hook().openCompareUrl(THREAD_ID));
    expect(harness.setNotice).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "error" }));
    harness.unmount();
  });
});

describe("useAgentShipFlow authority and concurrency", () => {
  it("drops a confirmed merge when the same thread id moves to another worktree", async () => {
    const confirmation = deferred<boolean>();
    const harness = renderFlow({
      confirmResult: confirmation.promise,
      ship: shipStatus({
        relation: { aheadOfPrimary: 1, behindPrimary: 3, fastForwardable: false },
      }),
    });
    const pending = harness.hook().integrate(THREAD_ID, "merge");
    await waitForReact(() => expect(harness.prompter.confirm).toHaveBeenCalledTimes(1));

    harness.set({
      threads: new Map([
        [
          THREAD_ID,
          thread({
            target: {
              isolation: "worktree",
              worktreePath: `${REPOSITORY_ROOT}/.worktrees/replacement`,
            },
          }),
        ],
      ]),
    });
    confirmation.resolve(true);
    await act(() => pending);

    expect(harness.gitIntegrationGateway.integrateWorktreeBranch).not.toHaveBeenCalled();
    expect(harness.actions).toEqual([]);
    expect(harness.state()).not.toMatchObject({ kind: "failed" });
    harness.unmount();
  });

  it("drops confirmed removal when the replacement thread starts running", async () => {
    const confirmation = deferred<boolean>();
    const harness = renderFlow({ confirmResult: confirmation.promise });
    const pending = harness.hook().removeWorktree(THREAD_ID, { deleteBranch: false });
    await waitForReact(() => expect(harness.prompter.confirm).toHaveBeenCalledTimes(1));

    harness.set({
      threads: new Map([[THREAD_ID, thread({ turns: [runningTurnFixture()] })]]),
    });
    confirmation.resolve(true);
    await act(() => pending);

    expect(harness.gitWorktreeGateway.removeWorktree).not.toHaveBeenCalled();
    expect(harness.actions).toEqual([]);
    expect(harness.state()).toBeUndefined();
    harness.unmount();
  });

  it("drops a confirmation after project generation replacement without publishing failure", async () => {
    const confirmation = deferred<boolean>();
    const harness = renderFlow({
      confirmResult: confirmation.promise,
      ship: shipStatus({
        relation: { aheadOfPrimary: 1, behindPrimary: 3, fastForwardable: false },
      }),
    });
    const pending = harness.hook().integrate(THREAD_ID, "merge");
    await waitForReact(() => expect(harness.prompter.confirm).toHaveBeenCalledTimes(1));

    harness.set({ projects: [project({ generation: 2 })] });
    confirmation.resolve(true);
    await act(() => pending);

    expect(harness.gitIntegrationGateway.integrateWorktreeBranch).not.toHaveBeenCalled();
    expect(harness.actions).toEqual([]);
    expect(harness.state()).not.toMatchObject({ kind: "failed" });
    harness.unmount();
  });

  it("fails closed when the project generation changes between stage and commit", async () => {
    const staged = deferred<GitStatus>();
    const harness = renderFlow();
    harness.gitGateway.stageFiles.mockReturnValueOnce(staged.promise);

    const pending = harness.hook().commit(THREAD_ID, "Fix");
    await waitForReact(() => expect(harness.gitGateway.stageFiles).toHaveBeenCalledTimes(1));
    expect(harness.state()?.kind).toBe("committing");

    harness.set({ projects: [project({ generation: 2 })] });
    harness.set({ projects: [project({ generation: 3 })] });
    await act(async () => {
      staged.resolve(gitStatus(2));
      await pending;
    });

    expect(harness.gitGateway.commit).not.toHaveBeenCalled();
    expect(harness.state()).toMatchObject({
      kind: "failed",
      failure: { step: "commit", reason: "authorityLost" },
    });
    expect(receipts(harness.actions)).toEqual([]);
    harness.unmount();
  });

  it("discards an integration result after the owner changed", async () => {
    const integrated = deferred<GitIntegrationOutcome>();
    const harness = renderFlow();
    harness.gitIntegrationGateway.integrateWorktreeBranch.mockReturnValueOnce(integrated.promise);

    const pending = harness.hook().integrate(THREAD_ID, "fastForward");
    await waitForReact(() =>
      expect(harness.gitIntegrationGateway.integrateWorktreeBranch).toHaveBeenCalledTimes(1),
    );
    harness.set({ projects: [project({ ownerId: "agent-root:other" })] });
    await act(async () => {
      integrated.resolve({ kind: "integrated", mergeSha: SHA_M, intoBranch: "main" });
      await pending;
    });
    expect(harness.state()).toMatchObject({
      kind: "failed",
      failure: { step: "integrate", reason: "authorityLost" },
    });
    expect(receipts(harness.actions)).toEqual([]);
    harness.unmount();
  });

  it("blames the lost owner instead of git when a step throws after the generation changed", async () => {
    const committed = deferred<GitStatus>();
    const harness = renderFlow();
    harness.gitGateway.commit.mockReturnValueOnce(committed.promise);

    const pending = harness.hook().commit(THREAD_ID, "Fix");
    await waitForReact(() => expect(harness.gitGateway.commit).toHaveBeenCalledTimes(1));
    harness.set({ projects: [project({ generation: 2 })] });

    await act(async () => {
      committed.reject(new Error("index.lock exists"));
      await pending;
    });

    expect(harness.state()).toEqual(
      expect.objectContaining({
        kind: "failed",
        failure: { step: "commit", reason: "authorityLost" },
      }),
    );
    expect(receipts(harness.actions)).toEqual([]);
    harness.unmount();
  });

  it("discards a late status result after the project generation changed back", async () => {
    const late = deferred<GitShipStatus>();
    const harness = renderFlow({
      threads: new Map([
        [
          THREAD_ID,
          thread({
            integration: {
              lastCommitSha: SHA_A,
              pushed: null,
              integrated: { intoBranch: "main", mergeSha: SHA_M, mode: "merge" },
              branchDeleted: false,
            },
          }),
        ],
      ]),
    });
    harness.gitIntegrationGateway.getShipStatus.mockReturnValueOnce(late.promise);

    const pending = harness.hook().refreshShipStatus(THREAD_ID);
    harness.set({ projects: [project({ generation: 2 })] });
    harness.set({ projects: [project({ generation: 3 })] });

    await act(async () => {
      late.resolve(
        shipStatus({ relation: { aheadOfPrimary: 2, behindPrimary: 0, fastForwardable: true } }),
      );
      await pending;
    });

    expect(harness.state()).toBeUndefined();
    harness.unmount();
  });

  it("ignores a second click while a push is in flight", async () => {
    const pushed = deferred<GitPushReceipt>();
    const harness = renderFlow();
    harness.gitIntegrationGateway.pushBranchUpstream.mockReturnValueOnce(pushed.promise);

    const first = harness.hook().push(THREAD_ID);
    const second = harness.hook().push(THREAD_ID);
    await waitForReact(() =>
      expect(harness.gitIntegrationGateway.pushBranchUpstream).toHaveBeenCalledTimes(1),
    );
    await act(async () => {
      pushed.resolve({ remote: "origin", branch: BRANCH, compareUrl: null });
      await Promise.all([first, second]);
    });
    expect(harness.gitIntegrationGateway.pushBranchUpstream).toHaveBeenCalledTimes(1);
    expect(harness.state()?.kind).toBe("pushed");
    harness.unmount();
  });

  it("publishes nothing when unmounted during an in-flight push", async () => {
    const pushed = deferred<GitPushReceipt>();
    const harness = renderFlow();
    harness.gitIntegrationGateway.pushBranchUpstream.mockReturnValueOnce(pushed.promise);

    const pending = harness.hook().push(THREAD_ID);
    await waitForReact(() =>
      expect(harness.gitIntegrationGateway.pushBranchUpstream).toHaveBeenCalledTimes(1),
    );
    harness.unmount();
    pushed.resolve({ remote: "origin", branch: BRANCH, compareUrl: null });
    await pending;
    expect(harness.actions).toEqual([]);
    expect(harness.reportError).not.toHaveBeenCalled();
  });

  it("clears a thread's ship state", async () => {
    const harness = renderFlow();
    await act(() => harness.hook().refreshShipStatus(THREAD_ID));
    expect(harness.state()).toBeDefined();
    act(() => harness.hook().clear(THREAD_ID));
    expect(harness.state()).toBeUndefined();
    harness.unmount();
  });
});
