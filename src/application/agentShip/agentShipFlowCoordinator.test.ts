import { describe, expect, it, vi } from "vitest";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import {
  MAX_AGENT_SHIP_COMMIT_MESSAGE_BYTES,
  MAX_AGENT_SHIP_FAILURE_BYTES,
  type AgentShipState,
} from "../../domain/agentShip";
import type { AgentThread } from "../../domain/agentThread";
import type { GitShipStatus } from "../../domain/gitIntegration";
import { MAX_GIT_INTEGRATION_MESSAGE_BYTES } from "../../domain/gitIntegration";
import type { AgentShipFlowDependencies } from "./agentShipFlowContract";
import { createAgentShipFlowCoordinator } from "./agentShipFlowCoordinator";
import {
  boundedCommitMessage,
  branchDeleteFailure,
  gitErrorFailure,
  mergeMessage,
  pushFailure,
} from "./agentShipFailures";

const ROOT = "/workspace/app";
const OWNER_ID = "workspace-app";
const THREAD_ID = "agt-1-0a1b";
const WORKTREE = `${ROOT}/.worktrees/${THREAD_ID}`;

function project(): AgentProjectDescriptor {
  return {
    rootKey: ROOT,
    rootPath: ROOT,
    ownerId: OWNER_ID,
    label: "app",
    generation: 1,
    trust: "trusted",
    origin: "active-tab",
    repositories: [
      { mapping: { rootRelativePath: "" }, repositoryRoot: ROOT, repositoryRelativePath: "" },
    ],
    isolationPolicy: "auto",
    leaseToken: null,
  };
}

function thread(): AgentThread {
  return {
    threadId: THREAD_ID,
    owner: { rootKey: ROOT, ownerId: OWNER_ID, repositoryRoot: ROOT },
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
  };
}

function shipStatus(head: string): GitShipStatus {
  return {
    worktree: { branch: `agent/${THREAD_ID}`, head, dirty: false, changeCount: 0 },
    primary: { branch: "main", head: "b".repeat(40), dirty: false },
    relation: { aheadOfPrimary: 1, behindPrimary: 0, fastForwardable: true },
    remote: null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

function flowHarness(getShipStatus: () => Promise<GitShipStatus>) {
  let states: ReadonlyMap<string, AgentShipState> = new Map();
  const dependencies: AgentShipFlowDependencies = {
    gitGateway: { getStatus: vi.fn(), stageFiles: vi.fn(), commit: vi.fn() },
    gitIntegrationGateway: {
      getShipStatus: vi.fn(getShipStatus),
      pushBranchUpstream: vi.fn(),
      integrateWorktreeBranch: vi.fn(),
    },
    gitWorktreeGateway: { removeWorktree: vi.fn() },
    externalUrlOpener: null,
    prompter: { confirm: () => true, prompt: () => null },
    projects: [project()],
    threads: new Map([[THREAD_ID, thread()]]),
    missingWorktreeThreadIds: new Set(),
    dispatchThreadAction: vi.fn(),
    reportError: vi.fn(),
    setNotice: vi.fn(),
    onWorktreeRemoved: vi.fn(),
  };
  const flow = createAgentShipFlowCoordinator(dependencies, (next) => {
    states = next;
  });
  return { flow, dependencies, states: () => states };
}

describe("agent ship failure policies", () => {
  it("bounds commit messages and rejects NUL bytes", () => {
    expect(boundedCommitMessage("  fix: parser  ")).toBe("fix: parser");
    expect(boundedCommitMessage("   ")).toBeNull();
    expect(boundedCommitMessage("a\u0000b")).toBeNull();
    expect(boundedCommitMessage("x".repeat(MAX_AGENT_SHIP_COMMIT_MESSAGE_BYTES + 1))).toBeNull();
  });

  it("strips control characters from merge titles and truncates UTF-8 safely", () => {
    expect(mergeMessage("agent/x", "a\u0007b")).toBe("Merge agent/x (a b)");
    expect(mergeMessage("agent/x", "")).toBe("Merge agent/x");
    const long = mergeMessage("agent/x", "é".repeat(MAX_GIT_INTEGRATION_MESSAGE_BYTES));
    expect(new TextEncoder().encode(long).byteLength).toBeLessThanOrEqual(
      MAX_GIT_INTEGRATION_MESSAGE_BYTES,
    );
    expect(long.endsWith("�")).toBe(false);
  });

  it("maps only known push reasons and falls back to gitError", () => {
    expect(pushFailure({ reason: "rejected", message: "no" })).toMatchObject({
      reason: "rejected",
    });
    expect(pushFailure({ reason: "exotic" })).toMatchObject({ reason: "gitError" });
    expect(pushFailure(new Error("boom"))).toMatchObject({ reason: "gitError" });
    expect(gitErrorFailure("integrate", "")).toEqual({
      step: "integrate",
      reason: "gitError",
      message: "Git failed.",
    });
  });

  it("classifies unmerged branch deletion failures within the byte budget", () => {
    const failed = branchDeleteFailure("agent/x", new Error("branch is not fully merged"));
    expect(failed).toMatchObject({ step: "removeWorktree", reason: "branchNotMerged" });
    const bounded = branchDeleteFailure("agent/x", new Error("x".repeat(10_000)));
    expect(
      new TextEncoder().encode("message" in bounded ? bounded.message : "").byteLength,
    ).toBeLessThanOrEqual(MAX_AGENT_SHIP_FAILURE_BYTES);
  });
});

describe("agent ship flow coordinator", () => {
  it("publishes only the latest of overlapping status refreshes", async () => {
    const first = deferred<GitShipStatus>();
    const second = deferred<GitShipStatus>();
    const pending = [first, second];
    const harness = flowHarness(() => pending.shift()?.promise ?? Promise.reject(new Error("x")));

    const older = harness.flow.refreshShipStatus(THREAD_ID);
    const newer = harness.flow.refreshShipStatus(THREAD_ID);
    second.resolve(shipStatus("c".repeat(40)));
    await newer;
    first.resolve(shipStatus("a".repeat(40)));
    await older;

    const state = harness.states().get(THREAD_ID);
    expect(state?.kind).toBe("idle");
    expect(state?.kind === "idle" ? state.status?.worktree.head : null).toBe("c".repeat(40));
  });

  it("drops status published after unmount and refuses foreign threads", async () => {
    const status = deferred<GitShipStatus>();
    const harness = flowHarness(() => status.promise);
    const refresh = harness.flow.refreshShipStatus(THREAD_ID);
    harness.flow.setMounted(false);
    status.resolve(shipStatus("a".repeat(40)));
    await refresh;
    await settle();
    expect(harness.states().get(THREAD_ID)).toMatchObject({
      kind: "idle",
      status: null,
      loadingStatus: true,
    });

    await expect(harness.flow.commit("agt-unknown", "message")).resolves.toEqual({
      kind: "notRun",
      message: "This thread cannot ship changes right now.",
    });
    expect(harness.dependencies.gitGateway.getStatus).not.toHaveBeenCalled();
  });
});
