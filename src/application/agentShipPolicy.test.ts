import { describe, expect, it } from "vitest";
import { utf8ByteLength } from "../domain/agentOutput/utf8Text";
import { MAX_AGENT_SHIP_COMMIT_MESSAGE_BYTES, type AgentShipState } from "../domain/agentShip";
import { UNTITLED_AGENT_THREAD_TITLE, type AgentThread } from "../domain/agentThread";
import type { GitShipStatus } from "../domain/gitIntegration";
import type { AgentThreadView } from "./agentThreadPorts";
import {
  AGENT_STILL_RUNNING_REASON,
  BEHIND_PRIMARY_REASON,
  COMMIT_BEFORE_PUSHING_REASON,
  INTEGRATE_BEFORE_DELETING_REASON,
  IN_PLACE_INTEGRATE_REASON,
  IN_PLACE_REMOVE_REASON,
  NOTHING_TO_COMMIT_REASON,
  NOTHING_TO_INTEGRATE_REASON,
  NO_REMOTE_REASON,
  PRIMARY_DETACHED_REASON,
  PRIMARY_DIRTY_REASON,
  SHIP_STATUS_UNAVAILABLE_REASON,
  SHIP_STEP_RUNNING_REASON,
  WORKTREE_GONE_REASON,
  commitAvailability,
  defaultCommitMessage,
  defaultIntegrationMode,
  integrateAvailability,
  pushAvailability,
  reconcile,
  removeAvailability,
} from "./agentShipPolicy";

const WORKTREE_HEAD = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);
const MERGE_SHA = "c".repeat(40);

function shipStatus(overrides: Partial<GitShipStatus> = {}): GitShipStatus {
  return {
    worktree: { branch: "agent/agt-0001", head: WORKTREE_HEAD, dirty: true, changeCount: 3 },
    primary: { branch: "main", head: OTHER_SHA, dirty: false },
    relation: { aheadOfPrimary: 2, behindPrimary: 0, fastForwardable: true },
    remote: { name: "origin", upstream: { ahead: 2, behind: 0 }, compareUrl: null },
    ...overrides,
  };
}

function agentThread(overrides: Partial<AgentThread> = {}): AgentThread {
  return {
    threadId: "agt-0001",
    owner: { rootKey: "root", ownerId: "owner", repositoryRoot: "/repo" },
    target: { isolation: "worktree", worktreePath: "/repo/.worktrees/agt-0001" },
    provider: { kind: "claudeCode", sessionId: null },
    title: "Fix the parser",
    pinned: false,
    archived: false,
    createdAtEpochMs: 1,
    updatedAtEpochMs: 2,
    turns: [],
    turnsTruncated: false,
    integration: null,
    ...overrides,
  };
}

function threadView(
  ship: AgentShipState,
  overrides: Partial<AgentThreadView> = {},
): AgentThreadView {
  return {
    thread: agentThread(),
    lifecycle: "settled",
    repositoryLabel: "repo",
    projectOrigin: "active-tab",
    worktreeRemoved: false,
    worktreeMissing: false,
    changeSummary: null,
    ship,
    editorAvailability: { kind: "available" },
    ...overrides,
  };
}

function idle(status: GitShipStatus | null): AgentShipState {
  return { kind: "idle", status, loadingStatus: false };
}

function blockedReason(availability: { kind: string; reason?: string }): string {
  return availability.kind === "blocked" ? (availability.reason ?? "") : "available";
}

describe("commitAvailability", () => {
  it("blocks while the agent is still running", () => {
    const view = threadView(idle(shipStatus()), { lifecycle: "running" });

    expect(blockedReason(commitAvailability(view, view.ship))).toBe(AGENT_STILL_RUNNING_REASON);
  });

  it("blocks when the worktree is gone", () => {
    const missing = threadView(idle(shipStatus()), { worktreeMissing: true });
    const removedView = threadView(idle(shipStatus()), { worktreeRemoved: true });
    const removedState = threadView({ kind: "worktreeRemoved", branchDeleted: false });

    expect(blockedReason(commitAvailability(missing, missing.ship))).toBe(WORKTREE_GONE_REASON);
    expect(blockedReason(commitAvailability(removedView, removedView.ship))).toBe(
      WORKTREE_GONE_REASON,
    );
    expect(blockedReason(commitAvailability(removedState, removedState.ship))).toBe(
      WORKTREE_GONE_REASON,
    );
  });

  it("blocks while another ship step runs and while the status is unknown", () => {
    const busy = threadView({
      kind: "pushing",
      status: shipStatus(),
      commitSha: null,
      resumeFrom: "idle",
    });
    const unknown = threadView(idle(null));

    expect(blockedReason(commitAvailability(busy, busy.ship))).toBe(SHIP_STEP_RUNNING_REASON);
    expect(blockedReason(commitAvailability(unknown, unknown.ship))).toBe(
      SHIP_STATUS_UNAVAILABLE_REASON,
    );
  });

  it("blocks a clean worktree and allows a dirty one", () => {
    const clean = threadView(
      idle(
        shipStatus({
          worktree: { branch: "agent/agt-0001", head: WORKTREE_HEAD, dirty: false, changeCount: 0 },
        }),
      ),
    );
    const dirty = threadView(idle(shipStatus()));

    expect(blockedReason(commitAvailability(clean, clean.ship))).toBe(NOTHING_TO_COMMIT_REASON);
    expect(commitAvailability(dirty, dirty.ship)).toEqual({ kind: "available" });
  });
});

describe("pushAvailability", () => {
  it("blocks when the repository has no remote", () => {
    const view = threadView(idle(shipStatus({ remote: null })));

    expect(blockedReason(pushAvailability(view, view.ship))).toBe(NO_REMOTE_REASON);
  });

  it("blocks when nothing new exists on the branch", () => {
    const view = threadView(
      idle(
        shipStatus({
          relation: { aheadOfPrimary: 0, behindPrimary: 0, fastForwardable: true },
          remote: { name: "origin", upstream: { ahead: 0, behind: 0 }, compareUrl: null },
        }),
      ),
    );

    expect(blockedReason(pushAvailability(view, view.ship))).toBe(COMMIT_BEFORE_PUSHING_REASON);
  });

  it("blocks an unpushed branch that carries no commits", () => {
    const view = threadView(
      idle(
        shipStatus({
          relation: { aheadOfPrimary: 0, behindPrimary: 0, fastForwardable: true },
          remote: { name: "origin", upstream: null, compareUrl: null },
        }),
      ),
    );

    expect(blockedReason(pushAvailability(view, view.ship))).toBe(COMMIT_BEFORE_PUSHING_REASON);
  });

  it("allows a push right after a commit even when the branch matches the primary", () => {
    const status = shipStatus({
      relation: { aheadOfPrimary: 0, behindPrimary: 0, fastForwardable: true },
      remote: { name: "origin", upstream: { ahead: 0, behind: 0 }, compareUrl: null },
    });
    const view = threadView({ kind: "committed", status, commitSha: WORKTREE_HEAD });

    expect(pushAvailability(view, view.ship)).toEqual({ kind: "available" });
  });

  it("allows a push for an in-place thread that is ahead of its upstream", () => {
    const view = threadView(
      idle(
        shipStatus({
          relation: { aheadOfPrimary: 0, behindPrimary: 0, fastForwardable: true },
          remote: { name: "origin", upstream: { ahead: 1, behind: 0 }, compareUrl: null },
        }),
      ),
      { thread: agentThread({ target: { isolation: "in-place", worktreePath: null } }) },
    );

    expect(pushAvailability(view, view.ship)).toEqual({ kind: "available" });
  });
});

describe("integrateAvailability", () => {
  it("refuses in-place threads", () => {
    const view = threadView(idle(shipStatus()), {
      thread: agentThread({ target: { isolation: "in-place", worktreePath: null } }),
    });

    expect(blockedReason(integrateAvailability(view, view.ship, "merge"))).toBe(
      IN_PLACE_INTEGRATE_REASON,
    );
  });

  it("blocks a detached or dirty main checkout", () => {
    const detached = threadView(
      idle(shipStatus({ primary: { branch: null, head: OTHER_SHA, dirty: false } })),
    );
    const dirty = threadView(
      idle(shipStatus({ primary: { branch: "main", head: OTHER_SHA, dirty: true } })),
    );

    expect(blockedReason(integrateAvailability(detached, detached.ship, "merge"))).toBe(
      PRIMARY_DETACHED_REASON,
    );
    expect(blockedReason(integrateAvailability(dirty, dirty.ship, "merge"))).toBe(
      PRIMARY_DIRTY_REASON,
    );
  });

  it("blocks a branch without commits", () => {
    const view = threadView(
      idle(
        shipStatus({ relation: { aheadOfPrimary: 0, behindPrimary: 0, fastForwardable: true } }),
      ),
    );

    expect(blockedReason(integrateAvailability(view, view.ship, "merge"))).toBe(
      NOTHING_TO_INTEGRATE_REASON,
    );
  });

  it("blocks fast-forward for a branch behind the main checkout but allows a merge", () => {
    const view = threadView(
      idle(
        shipStatus({ relation: { aheadOfPrimary: 2, behindPrimary: 3, fastForwardable: false } }),
      ),
    );

    expect(blockedReason(integrateAvailability(view, view.ship, "fastForward"))).toBe(
      BEHIND_PRIMARY_REASON,
    );
    expect(integrateAvailability(view, view.ship, "merge")).toEqual({ kind: "available" });
  });

  it("allows a fast-forward when the branch is strictly ahead", () => {
    const view = threadView(idle(shipStatus()));

    expect(integrateAvailability(view, view.ship, "fastForward")).toEqual({ kind: "available" });
  });
});

describe("removeAvailability", () => {
  it("refuses in-place threads", () => {
    const view = threadView(idle(shipStatus()), {
      thread: agentThread({ target: { isolation: "in-place", worktreePath: null } }),
    });

    expect(blockedReason(removeAvailability(view, view.ship))).toBe(IN_PLACE_REMOVE_REASON);
  });

  it("requires an integrated branch", () => {
    const notIntegrated = threadView(idle(shipStatus()));
    const integrated = threadView({
      kind: "integrated",
      status: shipStatus(),
      mergeSha: MERGE_SHA,
      intoBranch: "main",
    });

    expect(blockedReason(removeAvailability(notIntegrated, notIntegrated.ship))).toBe(
      INTEGRATE_BEFORE_DELETING_REASON,
    );
    expect(removeAvailability(integrated, integrated.ship)).toEqual({ kind: "available" });
  });

  it("blocks once the worktree is already removed", () => {
    const view = threadView({ kind: "worktreeRemoved", branchDeleted: true });

    expect(blockedReason(removeAvailability(view, view.ship))).toBe(WORKTREE_GONE_REASON);
  });
});

describe("reconcile", () => {
  it("attaches a fresh status to an idle state without promoting it", () => {
    const status = shipStatus();

    expect(reconcile(idle(null), status)).toEqual({
      kind: "idle",
      status,
      loadingStatus: false,
    });
  });

  it("keeps a committed state whose sha is still the worktree head", () => {
    const status = shipStatus();
    const state: AgentShipState = { kind: "committed", status: null, commitSha: WORKTREE_HEAD };

    expect(reconcile(state, status)).toEqual({
      kind: "committed",
      status,
      commitSha: WORKTREE_HEAD,
    });
  });

  it("re-anchors a stale committed receipt to the real head and drops it when nothing is ahead", () => {
    const ahead = shipStatus();
    const level = shipStatus({
      relation: { aheadOfPrimary: 0, behindPrimary: 0, fastForwardable: true },
    });
    const state: AgentShipState = { kind: "committed", status: null, commitSha: OTHER_SHA };

    expect(reconcile(state, ahead)).toEqual({
      kind: "committed",
      status: ahead,
      commitSha: WORKTREE_HEAD,
    });
    expect(reconcile(state, level)).toEqual({ kind: "idle", status: level, loadingStatus: false });
  });

  it("keeps a pushed receipt only while the upstream still contains the branch tip", () => {
    const receipt = { remote: "origin", branch: "agent/agt-0001", compareUrl: null } as const;
    const state: AgentShipState = { kind: "pushed", status: null, receipt };
    const pushed = shipStatus({
      remote: { name: "origin", upstream: { ahead: 0, behind: 0 }, compareUrl: null },
    });
    const ahead = shipStatus();
    const noRemote = shipStatus({ remote: null });

    expect(reconcile(state, pushed)).toEqual({ kind: "pushed", status: pushed, receipt });
    expect(reconcile(state, ahead)).toEqual({
      kind: "committed",
      status: ahead,
      commitSha: WORKTREE_HEAD,
    });
    expect(reconcile(state, noRemote)).toEqual({
      kind: "committed",
      status: noRemote,
      commitSha: WORKTREE_HEAD,
    });
  });

  it("drops an integrated receipt that the primary branch does not confirm", () => {
    const state: AgentShipState = {
      kind: "integrated",
      status: null,
      mergeSha: MERGE_SHA,
      intoBranch: "main",
    };
    const merged = shipStatus({
      relation: { aheadOfPrimary: 0, behindPrimary: 2, fastForwardable: false },
    });
    const stillAhead = shipStatus();
    const otherBranch = shipStatus({
      primary: { branch: "release", head: OTHER_SHA, dirty: false },
      relation: { aheadOfPrimary: 0, behindPrimary: 0, fastForwardable: true },
    });

    expect(reconcile(state, merged)).toEqual({
      kind: "integrated",
      status: merged,
      mergeSha: MERGE_SHA,
      intoBranch: "main",
    });
    expect(reconcile(state, stillAhead)).toEqual({
      kind: "committed",
      status: stillAhead,
      commitSha: WORKTREE_HEAD,
    });
    expect(reconcile(state, otherBranch)).toEqual({
      kind: "idle",
      status: otherBranch,
      loadingStatus: false,
    });
  });

  it("keeps a failure and its resume point while refreshing the status", () => {
    const status = shipStatus();
    const state: AgentShipState = {
      kind: "failed",
      status: null,
      failure: { step: "push", reason: "authRequired", message: "no credentials" },
      resumeFrom: "committed",
    };

    expect(reconcile(state, status)).toEqual({
      kind: "failed",
      status,
      failure: { step: "push", reason: "authRequired", message: "no credentials" },
      resumeFrom: "committed",
    });
  });

  it("never touches a busy or terminal state", () => {
    const busy: AgentShipState = {
      kind: "integrating",
      status: null,
      mode: "merge",
      resumeFrom: "committed",
    };
    const removed: AgentShipState = { kind: "worktreeRemoved", branchDeleted: false };

    expect(reconcile(busy, shipStatus())).toBe(busy);
    expect(reconcile(removed, shipStatus())).toBe(removed);
  });
});

describe("defaults", () => {
  it("prefills the commit message from the thread title", () => {
    expect(defaultCommitMessage(agentThread())).toBe("Fix the parser");
    expect(defaultCommitMessage(agentThread({ title: "  spaced  " }))).toBe("spaced");
    expect(defaultCommitMessage(agentThread({ title: "   " }))).toBe(UNTITLED_AGENT_THREAD_TITLE);
  });

  it("truncates an oversize title on a UTF-8 boundary", () => {
    const title = "é".repeat(MAX_AGENT_SHIP_COMMIT_MESSAGE_BYTES);
    const message = defaultCommitMessage(agentThread({ title }));

    expect(utf8ByteLength(message)).toBeLessThanOrEqual(MAX_AGENT_SHIP_COMMIT_MESSAGE_BYTES);
    expect(message).toBe("é".repeat(MAX_AGENT_SHIP_COMMIT_MESSAGE_BYTES / 2));
    expect(message).not.toContain("�");
  });

  it("defaults to a fast-forward only when the branch is strictly ahead", () => {
    expect(defaultIntegrationMode(shipStatus())).toBe("fastForward");
    expect(
      defaultIntegrationMode(
        shipStatus({ relation: { aheadOfPrimary: 1, behindPrimary: 2, fastForwardable: false } }),
      ),
    ).toBe("merge");
  });
});
