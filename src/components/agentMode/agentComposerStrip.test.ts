import { REMOTE_RUNNER_REACHABLE } from "../../domain/remoteRunnerReachability";
import { describe, expect, it } from "vitest";
import type { GitShipStatus } from "../../domain/gitIntegration";
import { THIS_COMPUTER, agentThreadLocation } from "../../domain/agentWorkspaceLocation";
import {
  SURFACE_FIXTURE_ROOT,
  SURFACE_FIXTURE_WORKTREE,
  surfaceThreadView,
} from "./agentSurfaceTestFixtures";
import { agentComposerStrip, agentComposerThreadBranch } from "./agentComposerStrip";

const BUILD_BOX = { kind: "server", name: "build-box" } as const;

function shipStatus(ahead: number, primary: string | null): GitShipStatus {
  return {
    worktree: { branch: "agent/agt-1", head: "abc", dirty: false, changeCount: 0 },
    primary: { branch: primary, head: "def", dirty: false },
    relation: { aheadOfPrimary: ahead, behindPrimary: 0, fastForwardable: true },
    remote: null,
  };
}

describe("agentComposerStrip", () => {
  it("hides Run on for a new draft when no server is configured", () => {
    expect(
      agentComposerStrip({
        kind: "draft",
        isolation: "in-place",
        serverName: null,
        serversConfigured: false,
        previousWorktreeSelected: false,
      }),
    ).toEqual({
      runOn: { kind: "hidden" },
      checkout: { kind: "picker", checkout: "localCheckout" },
    });
  });

  it("offers Run on for a new draft once a server is configured and names the machine", () => {
    expect(
      agentComposerStrip({
        kind: "draft",
        isolation: "worktree",
        serverName: null,
        serversConfigured: true,
        previousWorktreeSelected: false,
      }),
    ).toEqual({
      runOn: { kind: "picker", machine: THIS_COMPUTER },
      checkout: { kind: "picker", checkout: "newWorktree" },
    });
    expect(
      agentComposerStrip({
        kind: "draft",
        isolation: "in-place",
        serverName: "build-box",
        serversConfigured: true,
        previousWorktreeSelected: false,
      }),
    ).toEqual({
      runOn: { kind: "picker", machine: BUILD_BOX },
      checkout: { kind: "picker", checkout: "serverCheckout" },
    });
  });

  it("reads Worktree while a previous worktree is selected", () => {
    expect(
      agentComposerStrip({
        kind: "draft",
        isolation: "worktree",
        serverName: null,
        serversConfigured: false,
        previousWorktreeSelected: true,
      }).checkout,
    ).toEqual({ kind: "picker", checkout: "worktree" });
  });

  it("locks a started local thread to a muted checkout label without Run on", () => {
    const location = agentThreadLocation({
      isolation: "in-place",
      worktreePath: null,
      repositoryRoot: SURFACE_FIXTURE_ROOT,
      serverName: null,
      branch: "main",
    });
    expect(
      agentComposerStrip({
        kind: "started",
        location,
        isolation: "in-place",
        serverName: null,
      }),
    ).toEqual({
      runOn: { kind: "hidden" },
      checkout: { kind: "label", checkout: "localCheckout" },
    });
  });

  it("says Worktree once the worktree exists and New worktree only while it is created", () => {
    const started = (worktreePath: string | null) =>
      agentComposerStrip({
        kind: "started",
        location: agentThreadLocation({
          isolation: "worktree",
          worktreePath,
          repositoryRoot: SURFACE_FIXTURE_ROOT,
          serverName: null,
          branch: null,
        }),
        isolation: "worktree",
        serverName: null,
      }).checkout;
    expect(started(SURFACE_FIXTURE_WORKTREE)).toEqual({ kind: "label", checkout: "worktree" });
    expect(started(null)).toEqual({ kind: "label", checkout: "newWorktree" });
  });

  it("names the server as a muted label for a started remote thread", () => {
    expect(
      agentComposerStrip({
        kind: "started",
        location: agentThreadLocation({
          isolation: "in-place",
          worktreePath: null,
          repositoryRoot: "/srv/app",
          serverName: "build-box",
          branch: null,
        }),
        isolation: "in-place",
        serverName: "build-box",
      }),
    ).toEqual({
      runOn: { kind: "label", machine: BUILD_BOX },
      checkout: { kind: "label", checkout: "serverCheckout" },
    });
  });

  it("falls back to the thread's machine and an existing worktree without a location", () => {
    expect(
      agentComposerStrip({
        kind: "started",
        location: null,
        isolation: "worktree",
        serverName: "build-box",
      }),
    ).toEqual({
      runOn: { kind: "label", machine: BUILD_BOX },
      checkout: { kind: "label", checkout: "worktree" },
    });
  });
});

describe("agentComposerThreadBranch", () => {
  it("keeps the branch live for a started in-place local thread", () => {
    const view = surfaceThreadView({
      lifecycle: "running",
      thread: {
        ...surfaceThreadView().thread,
        target: { isolation: "in-place", worktreePath: null },
      },
    });
    expect(agentComposerThreadBranch(view)).toEqual({
      kind: "live",
      identity: { threadId: "agt-1", rootKey: SURFACE_FIXTURE_ROOT, ownerId: "agent-root:app" },
      repositoryRoot: SURFACE_FIXTURE_ROOT,
      running: true,
    });
  });

  it("shows a worktree thread's branch read-only with its lead over the primary branch", () => {
    const view = surfaceThreadView({
      ship: { kind: "idle", status: shipStatus(2, "main"), loadingStatus: false },
    });
    expect(agentComposerThreadBranch(view)).toEqual({
      kind: "worktree",
      branch: "agent/agt-1",
      detail: "2 ahead of main",
    });
    const detached = surfaceThreadView({
      ship: { kind: "idle", status: shipStatus(1, null), loadingStatus: false },
    });
    expect(agentComposerThreadBranch(detached)).toEqual({
      kind: "worktree",
      branch: "agent/agt-1",
      detail: null,
    });
    expect(agentComposerThreadBranch(surfaceThreadView())).toEqual({
      kind: "worktree",
      branch: null,
      detail: null,
    });
  });

  it("shows no branch for a remote thread or without a thread", () => {
    const remote = surfaceThreadView({
      execution: {
        kind: "remote",
        serverId: "linux",
        runnerId: "runner",
        projectId: "project",
        conversationId: "c-1",
        latestTaskId: "task-1",
        resume: null,
        reachability: REMOTE_RUNNER_REACHABLE,
      },
      thread: {
        ...surfaceThreadView().thread,
        target: { isolation: "in-place", worktreePath: null },
      },
    });
    expect(agentComposerThreadBranch(remote)).toEqual({ kind: "none" });
    expect(agentComposerThreadBranch(null)).toEqual({ kind: "none" });
  });

  it("shows a server thread branch from its origin base once Git sync is available", () => {
    const execution = {
      kind: "remote",
      serverId: "linux",
      runnerId: "runner",
      projectId: "project",
      conversationId: "c-1",
      latestTaskId: "task-1",
      resume: null,
      reachability: REMOTE_RUNNER_REACHABLE,
      gitShip: true,
    } as const;
    const status: GitShipStatus = {
      ...shipStatus(2, "origin/main"),
      worktree: { branch: "codevo/7389088c", head: "abc", dirty: false, changeCount: 0 },
    };
    const worktree = surfaceThreadView({
      execution,
      ship: { kind: "idle", status, loadingStatus: false },
    });
    expect(agentComposerThreadBranch(worktree)).toEqual({
      kind: "worktree",
      branch: "codevo/7389088c",
      detail: "from origin/main",
    });
    expect(agentComposerThreadBranch({ ...worktree, ship: surfaceThreadView().ship })).toEqual({
      kind: "none",
    });
    const checkout = surfaceThreadView({
      execution,
      thread: {
        ...surfaceThreadView().thread,
        target: { isolation: "in-place", worktreePath: null },
      },
    });
    expect(agentComposerThreadBranch(checkout)).toEqual({ kind: "serverCheckout" });
  });
});
