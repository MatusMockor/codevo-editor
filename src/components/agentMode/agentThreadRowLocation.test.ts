import { describe, expect, it } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentShipState } from "../../domain/agentShip";
import { surfaceThreadView } from "./agentSurfaceTestFixtures";
import {
  agentThreadRowLocation,
  agentThreadRowProjectLine,
  agentThreadRowServerName,
} from "./agentThreadRowLocation";

const NO_MEMORY = { serverName: null, rememberedBranch: null } as const;

function inPlace(): AgentThreadView {
  const base = surfaceThreadView();
  return surfaceThreadView({
    thread: { ...base.thread, target: { isolation: "in-place", worktreePath: null } },
  });
}

function pendingWorktree(): AgentThreadView {
  const base = surfaceThreadView();
  return surfaceThreadView({
    thread: { ...base.thread, target: { isolation: "worktree", worktreePath: null } },
  });
}

function shipOn(branch: string): AgentShipState {
  return {
    kind: "idle",
    loadingStatus: false,
    status: {
      worktree: { branch, head: "a".repeat(40), dirty: false, changeCount: 0 },
      primary: { branch: "main", head: "b".repeat(40), dirty: false },
      relation: { aheadOfPrimary: 1, behindPrimary: 0, fastForwardable: true },
      remote: null,
    },
  };
}

function remote(view: AgentThreadView, serverId = "linux"): AgentThreadView {
  return {
    ...view,
    execution: {
      kind: "remote",
      serverId,
      runnerId: "runner",
      projectId: "project",
      conversationId: "conversation",
      latestTaskId: "task",
      resume: null,
    },
  };
}

describe("agentThreadRowLocation", () => {
  it("shows the remembered branch of an in-place local thread with the folder glyph", () => {
    expect(
      agentThreadRowLocation(inPlace(), { serverName: null, rememberedBranch: "feature/x" }),
    ).toEqual({
      glyph: "localCheckout",
      label: "feature/x",
      title: "Local checkout · feature/x",
    });
  });

  it("falls back to Local checkout when no branch is remembered", () => {
    expect(agentThreadRowLocation(inPlace(), NO_MEMORY)).toEqual({
      glyph: "localCheckout",
      label: "Local checkout",
      title: "Local checkout",
    });
  });

  it("shows the worktree branch of a worktree thread and ignores the branch memory", () => {
    const view = { ...surfaceThreadView(), ship: shipOn("agent/agt-1") };
    expect(agentThreadRowLocation(view, { serverName: null, rememberedBranch: "main" })).toEqual({
      glyph: "worktree",
      label: "agent/agt-1",
      title: "Worktree · agent/agt-1",
    });
  });

  it("says Worktree or New worktree while the branch is not known", () => {
    expect(agentThreadRowLocation(surfaceThreadView(), NO_MEMORY).label).toBe("Worktree");
    expect(agentThreadRowLocation(pendingWorktree(), NO_MEMORY)).toEqual({
      glyph: "worktree",
      label: "New worktree",
      title: "New worktree",
    });
  });

  it("names the server checkout of a remote thread and never shows a branch", () => {
    expect(
      agentThreadRowLocation(remote(inPlace()), {
        serverName: "build-box",
        rememberedBranch: "main",
      }),
    ).toEqual({ glyph: "server", label: "Server checkout", title: "build-box · Server checkout" });
    const worktree = { ...remote(surfaceThreadView()), ship: shipOn("agent/agt-1") };
    expect(
      agentThreadRowLocation(worktree, { serverName: "build-box", rememberedBranch: null }),
    ).toEqual({ glyph: "server", label: "Worktree", title: "build-box · Worktree" });
  });

  it("never says in place", () => {
    const labels = [inPlace(), surfaceThreadView(), remote(inPlace())].map(
      (view) => agentThreadRowLocation(view, { serverName: "s", rememberedBranch: null }).label,
    );
    expect(labels.join(" ").toLowerCase()).not.toContain("in place");
  });
});

describe("agentThreadRowServerName", () => {
  const servers: ReadonlyMap<string, string> = new Map([["linux", "Linux server"]]);

  it("is null for a local thread", () => {
    expect(agentThreadRowServerName(inPlace(), servers)).toBeNull();
  });

  it("names the server of a remote thread and falls back to Server", () => {
    expect(agentThreadRowServerName(remote(inPlace()), servers)).toBe("Linux server");
    expect(agentThreadRowServerName(remote(inPlace(), "gone"), servers)).toBe("Server");
    expect(agentThreadRowServerName(remote(inPlace()), new Map())).toBe("Server");
  });
});

describe("agentThreadRowProjectLine", () => {
  it("prefixes the server name for a remote thread", () => {
    expect(agentThreadRowProjectLine("orders-api", "build-box")).toBe("build-box · orders-api");
    expect(agentThreadRowProjectLine("app", null)).toBe("app");
  });
});
