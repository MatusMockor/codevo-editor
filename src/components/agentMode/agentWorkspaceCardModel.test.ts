import { describe, expect, it } from "vitest";
import type { GitShipStatus } from "../../domain/gitIntegration";
import {
  SURFACE_FIXTURE_ROOT,
  SURFACE_FIXTURE_WORKTREE,
  surfaceThreadView,
} from "./agentSurfaceTestFixtures";
import { agentComposerThreadLocation } from "./agentComposerThreadLocation";
import { agentWorkspaceCard, type AgentWorkspaceCardProject } from "./agentWorkspaceCardModel";

const PROJECT: AgentWorkspaceCardProject = {
  projectRootKey: SURFACE_FIXTURE_ROOT,
  repositoryRoot: SURFACE_FIXTURE_ROOT,
  label: "editor",
};
const SERVERS = [{ id: "build", name: "build-box" }];
const LIVE = new Map<string, string | null>([[SURFACE_FIXTURE_ROOT, "main"]]);

function inPlaceThread() {
  return surfaceThreadView({
    thread: {
      ...surfaceThreadView().thread,
      target: { isolation: "in-place", worktreePath: null },
    },
  });
}

function shipStatus(): GitShipStatus {
  return {
    worktree: { branch: "agent/agt-mue1wenj-7ede", head: "abc", dirty: false, changeCount: 0 },
    primary: { branch: "main", head: "def", dirty: false },
    relation: { aheadOfPrimary: 2, behindPrimary: 1, fastForwardable: false },
    remote: null,
  };
}

function worktreeThread() {
  return surfaceThreadView({ ship: { kind: "idle", status: shipStatus(), loadingStatus: false } });
}

function serverThread() {
  return surfaceThreadView({
    repositoryLabel: "orders-api",
    execution: {
      kind: "remote",
      serverId: "build",
      runnerId: "runner",
      projectId: "orders",
      conversationId: "c-1",
      latestTaskId: "task-1",
      resume: null,
    },
    thread: inPlaceThread().thread,
  });
}

describe("agentWorkspaceCard", () => {
  it("shows a local draft as Local checkout and the live branch of the project root", () => {
    const card = agentWorkspaceCard({
      kind: "draft",
      project: PROJECT,
      isolation: "in-place",
      serverName: null,
      previousWorktree: null,
      liveBranches: LIVE,
    });

    expect(card).toMatchObject({
      state: "draft",
      projectLabel: "editor",
      monogram: "E",
      glyph: "folder",
      lead: "Local checkout",
      rest: "main",
      accessibleLabel: "Workspace: editor, Local checkout, main",
      revealPath: SURFACE_FIXTURE_ROOT,
    });
    expect(card.details).toEqual({
      machine: "This computer",
      checkout: "Local checkout",
      branch: "main",
      relation: null,
      path: SURFACE_FIXTURE_ROOT,
    });
  });

  it("shows a pending new worktree without inventing a branch or a path", () => {
    const card = agentWorkspaceCard({
      kind: "draft",
      project: PROJECT,
      isolation: "worktree",
      serverName: null,
      previousWorktree: null,
      liveBranches: LIVE,
    });

    expect(card).toMatchObject({ lead: "New worktree", rest: null, glyph: "branch" });
    expect(card.accessibleLabel).toBe("Workspace: editor, New worktree");
    expect(card.details.path).toBeNull();
    expect(card.revealPath).toBeNull();
  });

  it("shows the picked previous worktree of a draft", () => {
    const card = agentWorkspaceCard({
      kind: "draft",
      project: PROJECT,
      isolation: "worktree",
      serverName: null,
      previousWorktree: {
        threadId: "old",
        worktreePath: SURFACE_FIXTURE_WORKTREE,
        branch: "agent/old",
      },
      liveBranches: LIVE,
    });

    expect(card).toMatchObject({ lead: "Previous worktree", rest: "agent/old", glyph: "branch" });
    expect(card.details.path).toBe(SURFACE_FIXTURE_WORKTREE);
  });

  it("names the server for a server draft", () => {
    const card = agentWorkspaceCard({
      kind: "draft",
      project: { ...PROJECT, label: "orders-api" },
      isolation: "in-place",
      serverName: "build-box",
      previousWorktree: null,
      liveBranches: LIVE,
    });

    expect(card).toMatchObject({ lead: "build-box", rest: "Server checkout", glyph: "server" });
    expect(card.accessibleLabel).toBe("Workspace: orders-api, build-box, Server checkout");
    expect(card.revealPath).toBeNull();
  });

  it("shows a local checkout thread with the same location the composer strip uses", () => {
    const view = inPlaceThread();
    const card = agentWorkspaceCard({
      kind: "thread",
      project: PROJECT,
      view,
      servers: SERVERS,
      liveBranches: LIVE,
      rememberedBranch: "feature/old",
    });

    expect(card).toMatchObject({
      state: "thread",
      lead: "Local checkout",
      rest: "main",
      accessibleLabel: "Workspace: editor, Local checkout, main",
    });
    expect(card.location).toEqual(agentComposerThreadLocation(view, SERVERS, LIVE));
  });

  it("falls back to the remembered branch when the live branch is unknown", () => {
    const card = agentWorkspaceCard({
      kind: "thread",
      project: PROJECT,
      view: inPlaceThread(),
      servers: SERVERS,
      liveBranches: new Map(),
      rememberedBranch: "feature/old",
    });

    expect(card.rest).toBe("feature/old");
  });

  it("shows a worktree thread with its branch, path and ahead/behind", () => {
    const card = agentWorkspaceCard({
      kind: "thread",
      project: PROJECT,
      view: worktreeThread(),
      servers: SERVERS,
      liveBranches: LIVE,
      rememberedBranch: null,
    });

    expect(card).toMatchObject({
      lead: "Worktree",
      rest: "agent/agt-mue1wenj-7ede",
      glyph: "branch",
      accessibleLabel: "Workspace: editor, Worktree, agent/agt-mue1wenj-7ede",
      revealPath: SURFACE_FIXTURE_WORKTREE,
    });
    expect(card.details).toEqual({
      machine: "This computer",
      checkout: "Worktree",
      branch: "agent/agt-mue1wenj-7ede",
      relation: "2 ahead · 1 behind main",
      path: SURFACE_FIXTURE_WORKTREE,
    });
  });

  it("names the server for a server thread and never borrows a local branch or path", () => {
    const card = agentWorkspaceCard({
      kind: "thread",
      project: { ...PROJECT, label: "orders-api" },
      view: serverThread(),
      servers: SERVERS,
      liveBranches: LIVE,
      rememberedBranch: "main",
    });

    expect(card).toMatchObject({
      lead: "build-box",
      rest: "Server checkout",
      glyph: "server",
      accessibleLabel: "Workspace: orders-api, build-box, Server checkout",
      revealPath: null,
    });
    expect(card.details).toEqual({
      machine: "build-box",
      checkout: "Server checkout",
      branch: null,
      relation: null,
      path: null,
    });
  });
});
