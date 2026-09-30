import { describe, expect, it } from "vitest";
import {
  THIS_COMPUTER,
  agentCheckoutLabel,
  agentDraftLocation,
  agentLocationTokenText,
  agentMachineLabel,
  agentPreviousWorktreeLabel,
  agentThreadLocation,
} from "./agentWorkspaceLocation";

describe("agentWorkspaceLocation", () => {
  it("uses t3code's checkout vocabulary", () => {
    expect(agentCheckoutLabel("localCheckout")).toBe("Local checkout");
    expect(agentCheckoutLabel("serverCheckout")).toBe("Server checkout");
    expect(agentCheckoutLabel("newWorktree")).toBe("New worktree");
    expect(agentCheckoutLabel("worktree")).toBe("Worktree");
    expect(agentCheckoutLabel("previousWorktree")).toBe("Previous worktree");
    expect(agentPreviousWorktreeLabel("agent/agt-1")).toBe("Previous worktree (agent/agt-1)");
    expect(agentPreviousWorktreeLabel(null)).toBe("Previous worktree");
  });

  it("names the machine only by server name", () => {
    expect(agentMachineLabel(THIS_COMPUTER)).toBe("This computer");
    expect(agentMachineLabel({ kind: "server", name: "build-box" })).toBe("build-box");
  });

  it("maps a new local draft", () => {
    const location = agentDraftLocation({
      isolation: "in-place",
      serverName: null,
      projectRoot: "/repo",
      branch: "main",
    });
    expect(location).toEqual({
      machine: THIS_COMPUTER,
      checkout: "localCheckout",
      branch: "main",
      path: "/repo",
    });
    expect(agentLocationTokenText(location)).toBe("Local checkout · main");
  });

  it("maps a draft that will create a worktree", () => {
    const location = agentDraftLocation({
      isolation: "worktree",
      serverName: null,
      projectRoot: "/repo",
      branch: null,
    });
    expect(location.checkout).toBe("newWorktree");
    expect(agentLocationTokenText(location)).toBe("New worktree");
  });

  it("maps a server draft to the server checkout", () => {
    const location = agentDraftLocation({
      isolation: "in-place",
      serverName: "build-box",
      projectRoot: "/srv/repo",
      branch: null,
    });
    expect(location).toEqual({
      machine: { kind: "server", name: "build-box" },
      checkout: "serverCheckout",
      branch: null,
      path: null,
    });
    expect(agentLocationTokenText(location)).toBe("build-box · Server checkout");
  });

  it("maps a started in-place local thread", () => {
    const location = agentThreadLocation({
      isolation: "in-place",
      worktreePath: null,
      repositoryRoot: "/repo",
      serverName: null,
      branch: "feature/x",
    });
    expect(location).toEqual({
      machine: THIS_COMPUTER,
      checkout: "localCheckout",
      branch: "feature/x",
      path: "/repo",
    });
    expect(agentLocationTokenText(location)).toBe("Local checkout · feature/x");
  });

  it("maps a started worktree thread to Worktree, never New worktree", () => {
    const location = agentThreadLocation({
      isolation: "worktree",
      worktreePath: "/repo/.worktrees/agt-1",
      repositoryRoot: "/repo",
      serverName: null,
      branch: "agent/agt-1",
    });
    expect(location.checkout).toBe("worktree");
    expect(location.path).toBe("/repo/.worktrees/agt-1");
    expect(agentLocationTokenText(location)).toBe("Worktree · agent/agt-1");
  });

  it("keeps New worktree while the worktree is still being created", () => {
    const location = agentThreadLocation({
      isolation: "worktree",
      worktreePath: null,
      repositoryRoot: "/repo",
      serverName: null,
      branch: null,
    });
    expect(location.checkout).toBe("newWorktree");
    expect(location.path).toBeNull();
  });

  it("maps a remote thread without a local path", () => {
    const inPlace = agentThreadLocation({
      isolation: "in-place",
      worktreePath: null,
      repositoryRoot: "remote:abc:/srv/repo",
      serverName: "build-box",
      branch: null,
    });
    expect(agentLocationTokenText(inPlace)).toBe("build-box · Server checkout");
    expect(inPlace.path).toBeNull();
    const worktree = agentThreadLocation({
      isolation: "worktree",
      worktreePath: null,
      repositoryRoot: "remote:abc:/srv/repo",
      serverName: "build-box",
      branch: null,
    });
    expect(agentLocationTokenText(worktree)).toBe("build-box · Worktree");
    expect(worktree.path).toBeNull();
  });

  it("drops blank branches instead of rendering an empty segment", () => {
    const location = agentThreadLocation({
      isolation: "in-place",
      worktreePath: null,
      repositoryRoot: "/repo",
      serverName: null,
      branch: "   ",
    });
    expect(location.branch).toBeNull();
    expect(agentLocationTokenText(location)).toBe("Local checkout");
  });

  it("falls back to a generic server name when the server name is blank", () => {
    const location = agentThreadLocation({
      isolation: "in-place",
      worktreePath: null,
      repositoryRoot: "remote:abc:/srv/repo",
      serverName: "  ",
      branch: null,
    });
    expect(location.machine).toEqual({ kind: "server", name: "Server" });
  });
});
