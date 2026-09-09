import { describe, expect, it } from "vitest";
import { agentGitHistoryScope } from "./agentGitHistoryTarget";
import { NO_AGENT_SURFACE_SCOPE, type AgentSurfaceScope } from "./agentSurfacePolicy";
import {
  SURFACE_FIXTURE_ROOT,
  SURFACE_FIXTURE_WORKTREE,
  surfaceThreadView,
} from "./agentSurfaceTestFixtures";
import { FIXTURE_NESTED_ROOT, projectFixture } from "./agentThreadsSurfaceTestFixtures";

const project = projectFixture();
const scope: Extract<AgentSurfaceScope, { kind: "repository" }> = {
  kind: "repository",
  projectRootKey: project.rootKey,
  rootPath: project.rootPath,
  repositoryRoot: project.rootPath,
  ownerId: project.ownerId,
  generation: project.generation,
};
const resolve = (
  projects = [project],
  thread = null as ReturnType<typeof surfaceThreadView> | null,
  selected: string | null = null,
  root: string | null = SURFACE_FIXTURE_ROOT,
  trusted = true,
  currentScope: AgentSurfaceScope = scope,
) => agentGitHistoryScope(projects, thread, currentScope, root, trusted, selected);

describe("agentGitHistoryScope", () => {
  it("targets the selected nested repository, in-place repository and exact worktree", () => {
    expect(resolve([project], null, FIXTURE_NESTED_ROOT)).toMatchObject({
      kind: "available",
      target: { rootPath: FIXTURE_NESTED_ROOT },
    });
    const thread = surfaceThreadView();
    const nested = surfaceThreadView({
      thread: {
        ...thread.thread,
        owner: { ...thread.thread.owner, repositoryRoot: FIXTURE_NESTED_ROOT },
        target: { isolation: "in-place", worktreePath: null },
      },
    });
    expect(resolve([project], nested)).toMatchObject({
      kind: "available",
      target: { rootPath: FIXTURE_NESTED_ROOT },
    });
    expect(resolve([project], thread)).toMatchObject({
      kind: "available",
      target: { rootPath: SURFACE_FIXTURE_WORKTREE },
    });
  });

  it("accepts a registered runtime owner and rejects foreign runtime owners", () => {
    const thread = surfaceThreadView();
    const runtime = {
      ...project,
      ownerId: "current-owner",
      runtimeOwnerIds: [thread.thread.owner.ownerId],
    };
    expect(resolve([runtime], thread).kind).toBe("available");
    expect(resolve([{ ...runtime, runtimeOwnerIds: [] }], thread).kind).toBe("unavailable");
  });

  it("rejects stale project scopes after replacement or trust revocation", () => {
    expect(resolve([{ ...project, generation: project.generation + 1 }]).kind).toBe("unavailable");
    expect(resolve([{ ...project, ownerId: "replacement" }]).kind).toBe("unavailable");
    expect(resolve([{ ...project, trust: "untrusted" }]).kind).toBe("unavailable");
    expect(resolve([{ ...project, origin: "closed-tab-live-tasks" }]).kind).toBe("unavailable");
    expect(resolve([project], null, null, "/workspace/foreign").kind).toBe("unavailable");
  });

  it("fails closed for absent projects, repositories, trust and removed worktrees", () => {
    const thread = surfaceThreadView();
    expect(resolve([]).kind).toBe("unavailable");
    expect(resolve([project], null, "/workspace/foreign").kind).toBe("unavailable");
    expect(resolve([project], thread, null, SURFACE_FIXTURE_ROOT, false).kind).toBe("unavailable");
    expect(resolve([project], surfaceThreadView({ worktreeMissing: true })).kind).toBe(
      "unavailable",
    );
    expect(resolve([{ ...project, origin: "closed-tab-live-tasks" }], thread).kind).toBe(
      "unavailable",
    );
    expect(resolve([project], thread, null, "/workspace/app-other").kind).toBe("unavailable");
    expect(
      resolve([project], null, null, SURFACE_FIXTURE_ROOT, true, NO_AGENT_SURFACE_SCOPE).kind,
    ).toBe("unavailable");
  });

  it("does not fall back to the repository while a worktree checkout is not ready", () => {
    const thread = surfaceThreadView();
    const pending = surfaceThreadView({
      thread: { ...thread.thread, target: { isolation: "worktree", worktreePath: null } },
    });
    expect(resolve([project], pending)).toMatchObject({ kind: "unavailable" });
  });

  it("does not use an ancestor workspace for a separately selected nested project", () => {
    expect(resolve([project], null, null, "/workspace").kind).toBe("unavailable");
    expect(resolve([project], surfaceThreadView(), null, "/workspace").kind).toBe("unavailable");
  });

  it("changes history authority when a project generation or thread changes", () => {
    const thread = surfaceThreadView();
    const initial = resolve([project], thread);
    const replacement = resolve([{ ...project, generation: project.generation + 1 }], thread);
    const other = resolve(
      [project],
      surfaceThreadView({ thread: { ...thread.thread, threadId: "agt-2" } }),
    );
    expect(initial.kind).toBe("available");
    expect(replacement.kind).toBe("available");
    expect(other.kind).toBe("available");
    if (
      initial.kind !== "available" ||
      replacement.kind !== "available" ||
      other.kind !== "available"
    )
      throw new Error("Expected available history");
    expect(initial.target.ownerKey).not.toBe(replacement.target.ownerKey);
    expect(initial.target.ownerKey).not.toBe(other.target.ownerKey);
  });
});
