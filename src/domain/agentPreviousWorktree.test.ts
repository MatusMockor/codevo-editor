import { describe, expect, it } from "vitest";
import { agentRootOwnerId } from "./agentProject";
import type { AgentThread } from "./agentThread";
import {
  agentWorktreeCoTenant,
  MAX_PREVIOUS_WORKTREE_CANDIDATES,
  resolveAgentPreviousWorktreeSeed,
  resolveAgentWorktreeUser,
  type AgentPreviousWorktreeCandidate,
  type AgentPreviousWorktreeDraft,
} from "./agentPreviousWorktree";

const ROOT_A = "/workspace/app";
const ROOT_B = "/workspace/other";
const OWNER_A = "workspace-a";
const OWNER_B = "workspace-b";

const DRAFT_A: AgentPreviousWorktreeDraft = {
  project: { rootKey: ROOT_A, ownerId: OWNER_A },
  repositoryRoot: ROOT_A,
};

function candidate(
  overrides: Partial<AgentPreviousWorktreeCandidate> = {},
): AgentPreviousWorktreeCandidate {
  const threadId = overrides.threadId ?? "agt-1";
  return {
    threadId,
    owner: { rootKey: ROOT_A, ownerId: OWNER_A, repositoryRoot: ROOT_A },
    placement: "local",
    isolation: "worktree",
    worktreePath: `${ROOT_A}/.worktrees/${threadId}`,
    archived: false,
    worktreeState: "present",
    updatedAtEpochMs: 100,
    branch: `agent/${threadId}`,
    ...overrides,
  };
}

function thread(overrides: Partial<AgentThread> = {}): AgentThread {
  return {
    threadId: "agt-1",
    owner: { rootKey: ROOT_A, ownerId: OWNER_A, repositoryRoot: ROOT_A },
    target: { isolation: "worktree", worktreePath: `${ROOT_A}/.worktrees/agt-1` },
    provider: { kind: "claudeCode", sessionId: null },
    title: "Fix the parser",
    pinned: false,
    archived: false,
    createdAtEpochMs: 10,
    updatedAtEpochMs: 10,
    turns: [],
    turnsTruncated: false,
    integration: null,
    viewedAtEpochMs: null,
    externalOrigin: null,
    ...overrides,
  };
}

describe("resolveAgentPreviousWorktreeSeed", () => {
  it("picks the most recently updated worktree of the exact draft project", () => {
    const seed = resolveAgentPreviousWorktreeSeed(DRAFT_A, [
      candidate({ threadId: "agt-old", updatedAtEpochMs: 100 }),
      candidate({ threadId: "agt-new", updatedAtEpochMs: 300 }),
      candidate({ threadId: "agt-mid", updatedAtEpochMs: 200 }),
    ]);

    expect(seed).toEqual({
      threadId: "agt-new",
      worktreePath: `${ROOT_A}/.worktrees/agt-new`,
      branch: "agent/agt-new",
    });
  });

  it("breaks an updated-at tie deterministically by thread id regardless of order", () => {
    const left = candidate({ threadId: "agt-b", updatedAtEpochMs: 500 });
    const right = candidate({ threadId: "agt-a", updatedAtEpochMs: 500 });

    expect(resolveAgentPreviousWorktreeSeed(DRAFT_A, [left, right])?.threadId).toBe("agt-a");
    expect(resolveAgentPreviousWorktreeSeed(DRAFT_A, [right, left])?.threadId).toBe("agt-a");
  });

  it("excludes another project, another owner, and another repository", () => {
    const seed = resolveAgentPreviousWorktreeSeed(DRAFT_A, [
      candidate({
        threadId: "agt-other-project",
        owner: { rootKey: ROOT_B, ownerId: OWNER_A, repositoryRoot: ROOT_A },
        updatedAtEpochMs: 900,
      }),
      candidate({
        threadId: "agt-other-owner",
        owner: { rootKey: ROOT_A, ownerId: OWNER_B, repositoryRoot: ROOT_A },
        updatedAtEpochMs: 800,
      }),
      candidate({
        threadId: "agt-other-repository",
        owner: { rootKey: ROOT_A, ownerId: OWNER_A, repositoryRoot: `${ROOT_A}/packages/api` },
        updatedAtEpochMs: 700,
      }),
    ]);

    expect(seed).toBeNull();
  });

  it("accepts a retained runtime owner or the durable root owner of the same project", () => {
    const draft: AgentPreviousWorktreeDraft = {
      project: { rootKey: ROOT_A, ownerId: OWNER_A, runtimeOwnerIds: [OWNER_B] },
      repositoryRoot: ROOT_A,
    };

    expect(
      resolveAgentPreviousWorktreeSeed(draft, [
        candidate({ owner: { rootKey: ROOT_A, ownerId: OWNER_B, repositoryRoot: ROOT_A } }),
      ])?.threadId,
    ).toBe("agt-1");
    expect(
      resolveAgentPreviousWorktreeSeed(DRAFT_A, [
        candidate({
          owner: { rootKey: ROOT_A, ownerId: agentRootOwnerId(ROOT_A), repositoryRoot: ROOT_A },
        }),
      ])?.threadId,
    ).toBe("agt-1");
  });

  it.each([
    ["an archived thread", { archived: true }],
    ["a remote thread", { placement: "remote" as const }],
    ["an in-place thread", { isolation: "in-place" as const, worktreePath: null }],
    ["a thread without a worktree path", { worktreePath: null }],
    ["a removed worktree", { worktreeState: "removed" as const }],
    ["a missing worktree", { worktreeState: "missing" as const }],
    ["a worktree being removed", { worktreeState: "removing" as const }],
  ])("excludes %s", (_label, overrides: Partial<AgentPreviousWorktreeCandidate>) => {
    expect(resolveAgentPreviousWorktreeSeed(DRAFT_A, [candidate(overrides)])).toBeNull();
  });

  it("falls back to an older eligible worktree when the newest is ineligible", () => {
    const seed = resolveAgentPreviousWorktreeSeed(DRAFT_A, [
      candidate({ threadId: "agt-archived", archived: true, updatedAtEpochMs: 900 }),
      candidate({ threadId: "agt-live", updatedAtEpochMs: 100, branch: null }),
    ]);

    expect(seed).toEqual({
      threadId: "agt-live",
      worktreePath: `${ROOT_A}/.worktrees/agt-live`,
      branch: null,
    });
  });

  it("ignores a non-finite update time", () => {
    expect(
      resolveAgentPreviousWorktreeSeed(DRAFT_A, [candidate({ updatedAtEpochMs: Number.NaN })]),
    ).toBeNull();
  });

  it("considers only a bounded number of candidates", () => {
    const filler = Array.from({ length: MAX_PREVIOUS_WORKTREE_CANDIDATES }, (_unused, index) =>
      candidate({ threadId: `agt-filler-${index}`, archived: true }),
    );

    expect(
      resolveAgentPreviousWorktreeSeed(DRAFT_A, [
        ...filler,
        candidate({ threadId: "agt-late", updatedAtEpochMs: 10_000 }),
      ]),
    ).toBeNull();
  });
});

describe("resolveAgentWorktreeUser", () => {
  const shared = `${ROOT_A}/.worktrees/agt-1`;

  it("keeps a worktree while any eligible thread of the project still uses its exact path", () => {
    const user = resolveAgentWorktreeUser(
      DRAFT_A,
      [
        candidate({ threadId: "agt-1", archived: true, updatedAtEpochMs: 900 }),
        candidate({ threadId: "agt-2", worktreePath: shared, updatedAtEpochMs: 200 }),
        candidate({ threadId: "agt-3", updatedAtEpochMs: 999 }),
      ],
      shared,
    );

    expect(user).toEqual({ threadId: "agt-2", worktreePath: shared, branch: "agent/agt-2" });
  });

  it("finds no user when only another owner, a remote thread, or a removed worktree uses it", () => {
    const user = resolveAgentWorktreeUser(
      DRAFT_A,
      [
        candidate({ owner: { rootKey: ROOT_A, ownerId: OWNER_B, repositoryRoot: ROOT_A } }),
        candidate({ threadId: "agt-2", worktreePath: shared, placement: "remote" }),
        candidate({ threadId: "agt-3", worktreePath: shared, worktreeState: "removed" }),
      ],
      shared,
    );

    expect(user).toBeNull();
  });
});

describe("agentWorktreeCoTenant", () => {
  const shared = `${ROOT_A}/.worktrees/agt-1`;

  it("finds another live thread targeting the same worktree", () => {
    const source = thread();
    const reuser = thread({ threadId: "agt-2", title: "Continue the parser" });

    expect(agentWorktreeCoTenant([source, reuser], "agt-1", shared)?.threadId).toBe("agt-2");
    expect(agentWorktreeCoTenant([source, reuser], "agt-2", shared)?.threadId).toBe("agt-1");
  });

  it("ignores archived threads, the removing thread itself, and other worktrees", () => {
    const threads = [
      thread(),
      thread({ threadId: "agt-2", archived: true }),
      thread({
        threadId: "agt-3",
        target: { isolation: "worktree", worktreePath: `${ROOT_A}/.worktrees/agt-3` },
      }),
      thread({ threadId: "agt-4", target: { isolation: "in-place", worktreePath: null } }),
    ];

    expect(agentWorktreeCoTenant(threads, "agt-1", shared)).toBeNull();
  });

  it("names the most recently updated co-tenant deterministically", () => {
    const threads = [
      thread(),
      thread({ threadId: "agt-3", updatedAtEpochMs: 50 }),
      thread({ threadId: "agt-2", updatedAtEpochMs: 50 }),
      thread({ threadId: "agt-9", updatedAtEpochMs: 20 }),
    ];

    expect(agentWorktreeCoTenant(threads, "agt-1", shared)?.threadId).toBe("agt-2");
  });
});
