import { describe, expect, it } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentShipState } from "../../domain/agentShip";
import type { AgentCliKind } from "../../domain/agentTask";
import { surfaceThreadView } from "./agentSurfaceTestFixtures";
import {
  agentThreadRowLocation,
  agentThreadRowRuntime,
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
  it("shows the remembered branch of an in-place local thread without a glyph", () => {
    expect(
      agentThreadRowLocation(inPlace(), { serverName: null, rememberedBranch: "feature/x" }),
    ).toEqual({
      branch: { kind: "checkout", name: "feature/x" },
      title: "This computer · Local checkout · feature/x",
    });
  });

  it("shows no branch when an in-place thread has none remembered", () => {
    expect(agentThreadRowLocation(inPlace(), NO_MEMORY)).toEqual({
      branch: { kind: "unknown" },
      title: "This computer · Local checkout",
    });
  });

  it("shows the worktree branch of a worktree thread and ignores the branch memory", () => {
    const view = { ...surfaceThreadView(), ship: shipOn("agent/agt-1") };
    expect(agentThreadRowLocation(view, { serverName: null, rememberedBranch: "main" })).toEqual({
      branch: { kind: "worktree", name: "agent/agt-1" },
      title: "This computer · Worktree · agent/agt-1",
    });
  });

  it("shows no branch while the worktree branch is not known", () => {
    expect(agentThreadRowLocation(surfaceThreadView(), NO_MEMORY)).toEqual({
      branch: { kind: "unknown" },
      title: "This computer · Worktree",
    });
    expect(agentThreadRowLocation(pendingWorktree(), NO_MEMORY)).toEqual({
      branch: { kind: "unknown" },
      title: "This computer · New worktree",
    });
  });

  it("names the server only in the title of a remote thread and never shows a branch", () => {
    expect(
      agentThreadRowLocation(remote(inPlace()), {
        serverName: "build-box",
        rememberedBranch: "main",
      }),
    ).toEqual({ branch: { kind: "unknown" }, title: "build-box · Server checkout" });
    const worktree = { ...remote(surfaceThreadView()), ship: shipOn("agent/agt-1") };
    expect(
      agentThreadRowLocation(worktree, { serverName: "build-box", rememberedBranch: null }),
    ).toEqual({ branch: { kind: "unknown" }, title: "build-box · Worktree" });
  });

  it("never says in place", () => {
    const titles = [inPlace(), surfaceThreadView(), remote(inPlace())].map(
      (view) => agentThreadRowLocation(view, { serverName: "s", rememberedBranch: null }).title,
    );
    expect(titles.join(" ").toLowerCase()).not.toContain("in place");
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

describe("agentThreadRowRuntime", () => {
  function withProvider(view: AgentThreadView, kind: AgentCliKind): AgentThreadView {
    return { ...view, thread: { ...view.thread, provider: { kind, sessionId: null } } };
  }
  const codex = (view: AgentThreadView): AgentThreadView => withProvider(view, "codex");

  it("labels a local thread by its provider", () => {
    expect(agentThreadRowRuntime(withProvider(inPlace(), "claudeCode"), null)).toEqual({
      place: "local",
      provider: "claudeCode",
      label: "Claude Code, local",
    });
    expect(agentThreadRowRuntime(codex(inPlace()), "ignored")).toEqual({
      place: "local",
      provider: "codex",
      label: "Codex, local",
    });
  });

  it("names the connected server of a remote thread", () => {
    expect(agentThreadRowRuntime(codex(remote(inPlace())), "build-box")).toEqual({
      place: "server",
      provider: "codex",
      label: "Codex, on build-box",
    });
  });

  it("falls back to a generic server when the name is unknown or blank", () => {
    expect(agentThreadRowRuntime(codex(remote(inPlace())), null).label).toBe("Codex, on server");
    expect(agentThreadRowRuntime(codex(remote(inPlace())), "  ").label).toBe("Codex, on server");
  });
});
