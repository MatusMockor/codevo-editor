import { describe, expect, it } from "vitest";
import type { GitShipStatus } from "../../domain/gitIntegration";
import {
  SURFACE_FIXTURE_ROOT,
  SURFACE_FIXTURE_WORKTREE,
  surfaceThreadView,
} from "./agentSurfaceTestFixtures";
import {
  agentComposerThreadLocation,
  agentWorkspaceLocationEqual,
} from "./agentComposerThreadLocation";

const SERVERS = [{ id: "linux", name: "Linux server" }];
const LIVE = new Map<string, string | null>([[SURFACE_FIXTURE_ROOT, "feature/sidebar"]]);

function inPlace() {
  return surfaceThreadView({
    thread: {
      ...surfaceThreadView().thread,
      target: { isolation: "in-place", worktreePath: null },
    },
  });
}

function shipStatus(): GitShipStatus {
  return {
    worktree: { branch: "agent/agt-1", head: "abc", dirty: false, changeCount: 0 },
    primary: { branch: "main", head: "def", dirty: false },
    relation: { aheadOfPrimary: 2, behindPrimary: 0, fastForwardable: true },
    remote: null,
  };
}

describe("agentComposerThreadLocation", () => {
  it("returns null without a selected thread", () => {
    expect(agentComposerThreadLocation(null, SERVERS, LIVE)).toBeNull();
  });

  it("reads a local checkout thread with the live branch of its repository", () => {
    expect(agentComposerThreadLocation(inPlace(), SERVERS, LIVE)).toEqual({
      machine: { kind: "thisComputer" },
      checkout: "localCheckout",
      branch: "feature/sidebar",
      path: SURFACE_FIXTURE_ROOT,
    });
  });

  it("reads a worktree thread with the ship branch and New worktree while no path exists", () => {
    const view = surfaceThreadView({
      ship: { kind: "idle", status: shipStatus(), loadingStatus: false },
    });
    expect(agentComposerThreadLocation(view, SERVERS, LIVE)).toEqual({
      machine: { kind: "thisComputer" },
      checkout: "worktree",
      branch: "agent/agt-1",
      path: SURFACE_FIXTURE_WORKTREE,
    });
    const creating = surfaceThreadView({
      thread: {
        ...surfaceThreadView().thread,
        target: { isolation: "worktree", worktreePath: null },
      },
    });
    expect(agentComposerThreadLocation(creating, SERVERS, LIVE)?.checkout).toBe("newWorktree");
  });

  it("names the server for a remote thread and never borrows a local branch", () => {
    const remote = surfaceThreadView({
      execution: {
        kind: "remote",
        serverId: "linux",
        runnerId: "runner",
        projectId: "project",
        conversationId: "c-1",
        latestTaskId: "task-1",
        resume: null,
      },
      thread: inPlace().thread,
    });
    expect(agentComposerThreadLocation(remote, SERVERS, LIVE)).toEqual({
      machine: { kind: "server", name: "Linux server" },
      checkout: "serverCheckout",
      branch: null,
      path: null,
    });
    expect(agentComposerThreadLocation(remote, [], LIVE)?.machine).toEqual({
      kind: "server",
      name: "Server",
    });
  });

  it("compares locations by value", () => {
    const left = agentComposerThreadLocation(inPlace(), SERVERS, LIVE);
    const right = agentComposerThreadLocation(inPlace(), SERVERS, new Map(LIVE));
    expect(left).not.toBe(right);
    expect(agentWorkspaceLocationEqual(left, right)).toBe(true);
    expect(agentWorkspaceLocationEqual(left, null)).toBe(false);
    expect(agentWorkspaceLocationEqual(null, null)).toBe(true);
    expect(
      agentWorkspaceLocationEqual(
        left,
        agentComposerThreadLocation(inPlace(), SERVERS, new Map([[SURFACE_FIXTURE_ROOT, "main"]])),
      ),
    ).toBe(false);
  });
});
