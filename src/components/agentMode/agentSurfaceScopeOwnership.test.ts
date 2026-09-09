import { describe, expect, it } from "vitest";
import { agentSurfaceTreeTarget, agentSurfaceTreeUnavailable } from "./useAgentSurfaceScopeTree";
import {
  surfaceRepositoryScope,
  surfaceThreadView,
  SURFACE_FIXTURE_WORKTREE,
} from "./agentSurfaceTestFixtures";
import type { AgentSurfaceScope } from "./agentSurfacePolicy";
import { agentSurfaceTreeTargetKey } from "../../application/useAgentSurfaceFileTree";

describe("surface tree project ownership", () => {
  const thread = surfaceThreadView();
  const foreign: AgentSurfaceScope = {
    kind: "foreignRoot",
    projectRootKey: thread.thread.owner.rootKey,
    repositoryRoot: thread.thread.owner.repositoryRoot,
    rootPath: thread.thread.owner.repositoryRoot,
    label: "Selected project",
  };

  it("does not read a selected thread through the previous workspace during activation", () => {
    expect(
      agentSurfaceTreeTarget("old-workspace", thread, SURFACE_FIXTURE_WORKTREE, foreign, true),
    ).toBeNull();
    expect(agentSurfaceTreeUnavailable(thread, foreign, null)).toMatchObject({
      kind: "foreignRoot",
    });
  });

  it("requires the selected scope to own the thread before resolving its checkout", () => {
    expect(
      agentSurfaceTreeTarget(
        "workspace",
        thread,
        SURFACE_FIXTURE_WORKTREE,
        surfaceRepositoryScope("/other"),
        true,
      ),
    ).toBeNull();
    expect(
      agentSurfaceTreeTarget(
        "workspace",
        thread,
        SURFACE_FIXTURE_WORKTREE,
        surfaceRepositoryScope(),
        true,
      ),
    ).toMatchObject({
      kind: "thread",
      rootPath: SURFACE_FIXTURE_WORKTREE,
      threadId: thread.thread.threadId,
    });
  });

  it("fails closed after the project is released or becomes unavailable", () => {
    const none: AgentSurfaceScope = { kind: "none" };
    expect(
      agentSurfaceTreeTarget("workspace", thread, SURFACE_FIXTURE_WORKTREE, none, true),
    ).toBeNull();
    expect(agentSurfaceTreeUnavailable(thread, none, null)).toEqual({ kind: "noProject" });
  });

  it("invalidates a thread tree when the project owner is replaced at the same path", () => {
    const scope = surfaceRepositoryScope();
    const first = agentSurfaceTreeTarget(
      "workspace",
      thread,
      SURFACE_FIXTURE_WORKTREE,
      scope,
      true,
    );
    const second = agentSurfaceTreeTarget(
      "workspace",
      thread,
      SURFACE_FIXTURE_WORKTREE,
      { ...scope, generation: scope.generation + 1 },
      true,
    );
    expect(agentSurfaceTreeTargetKey(first)).not.toBe(agentSurfaceTreeTargetKey(second));
  });
});
