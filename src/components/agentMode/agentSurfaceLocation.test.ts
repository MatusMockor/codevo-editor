import { describe, expect, it } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import {
  agentSurfaceLocation,
  agentSurfaceRemoteProjectRootKey,
  type AgentSurfaceLocationInput,
} from "./agentSurfaceLocation";
import type { AgentSurfaceScope } from "./agentSurfacePolicy";
import {
  SURFACE_FIXTURE_ROOT,
  SURFACE_FIXTURE_WORKTREE,
  surfaceActivation,
  surfaceRepositoryScope,
  surfaceThreadView,
} from "./agentSurfaceTestFixtures";

const ROOT = SURFACE_FIXTURE_ROOT;
const REMOTE_SCOPE = { serverId: "srv-1", runnerId: "runner", projectId: "orders" } as const;

function project(overrides: Partial<AgentProjectDescriptor> = {}): AgentProjectDescriptor {
  return {
    rootKey: ROOT,
    rootPath: ROOT,
    ownerId: `agent-root:${ROOT}`,
    runtimeOwnerIds: ["agent-root:app"],
    label: "editor",
    generation: 1,
    trust: "trusted",
    origin: "active-tab",
    repositories: [],
    isolationPolicy: "auto",
    leaseToken: null,
    ...overrides,
  };
}

function inPlaceThread(overrides: Partial<AgentThreadView> = {}): AgentThreadView {
  const base = surfaceThreadView();
  return surfaceThreadView({
    ...overrides,
    thread: { ...base.thread, target: { isolation: "in-place", worktreePath: null } },
  });
}

function worktreeThread(worktreePath: string | null): AgentThreadView {
  const base = surfaceThreadView();
  return surfaceThreadView({
    ship: {
      kind: "pushed",
      status: null,
      receipt: { remote: "origin", branch: "agent/agt-12", compareUrl: null },
    },
    thread: { ...base.thread, target: { isolation: "worktree", worktreePath } },
  });
}

function remoteThread(isolation: "in-place" | "worktree" = "in-place"): AgentThreadView {
  const base = surfaceThreadView();
  return surfaceThreadView({
    repositoryLabel: "orders-api",
    execution: {
      kind: "remote",
      ...REMOTE_SCOPE,
      conversationId: "conversation",
      latestTaskId: "task",
      resume: null,
    },
    thread: {
      ...base.thread,
      threadId: "remote-thread:srv-1:conversation",
      owner: {
        rootKey: agentSurfaceRemoteProjectRootKey(REMOTE_SCOPE),
        ownerId: "remote-owner",
        repositoryRoot: "/srv/orders",
      },
      target: { isolation, worktreePath: isolation === "worktree" ? "/srv/wt" : null },
    },
  });
}

function local(overrides: Partial<AgentSurfaceLocationInput> = {}): AgentSurfaceLocationInput {
  return {
    thread: null,
    threadRootPath: null,
    scope: surfaceRepositoryScope(),
    workspaceRoot: ROOT,
    activation: surfaceActivation("ready"),
    projects: [project()],
    liveBranches: new Map([[ROOT, "main"]]),
    draftIsolation: "in-place",
    draftPreviousWorktree: null,
    remote: null,
    ...overrides,
  };
}

function remote(
  thread: AgentThreadView | null,
  overrides: Partial<NonNullable<AgentSurfaceLocationInput["remote"]>> = {},
): AgentSurfaceLocationInput {
  return local({
    thread,
    scope: { kind: "none" },
    projects: [
      project({
        rootKey: agentSurfaceRemoteProjectRootKey(REMOTE_SCOPE),
        rootPath: "/srv/orders",
        label: "orders-api",
      }),
    ],
    remote: {
      scope: thread === null ? REMOTE_SCOPE : { ...REMOTE_SCOPE, taskId: "task" },
      serverName: "build-box",
      ...overrides,
    },
  });
}

describe("agentSurfaceLocation", () => {
  it("names a draft's project root as its local checkout with the live branch", () => {
    expect(agentSurfaceLocation(local())).toEqual({
      kind: "shown",
      projectLabel: "editor",
      glyph: "folder",
      token: "Local checkout · main",
      description: "Right panel shows Local checkout · main of editor",
      path: ROOT,
      location: {
        machine: { kind: "thisComputer" },
        checkout: "localCheckout",
        branch: "main",
        path: ROOT,
      },
    });
  });

  it("says a draft's new worktree does not exist yet and that the panel shows the project root", () => {
    expect(agentSurfaceLocation(local({ draftIsolation: "worktree" }))).toEqual({
      kind: "shown",
      projectLabel: "editor",
      glyph: "branch",
      token: "New worktree (not created yet) · shows project root",
      description: "Right panel shows the project root of editor. New worktree not created yet.",
      path: ROOT,
      location: {
        machine: { kind: "thisComputer" },
        checkout: "newWorktree",
        branch: null,
        path: ROOT,
      },
    });
  });

  it("names a draft's chosen previous worktree without claiming the panel shows it", () => {
    const previous = {
      threadId: "agt-7",
      worktreePath: `${ROOT}/.worktrees/agt-7`,
      branch: "agent/agt-7",
    };
    expect(
      agentSurfaceLocation(local({ draftIsolation: "worktree", draftPreviousWorktree: previous })),
    ).toEqual({
      kind: "shown",
      projectLabel: "editor",
      glyph: "branch",
      token: "Previous worktree (agent/agt-7) · shows project root",
      description: `Right panel shows the project root of editor. Sending continues in Previous worktree (agent/agt-7) at ${ROOT}/.worktrees/agt-7.`,
      path: ROOT,
      location: {
        machine: { kind: "thisComputer" },
        checkout: "previousWorktree",
        branch: "agent/agt-7",
        path: `${ROOT}/.worktrees/agt-7`,
      },
    });
    expect(
      agentSurfaceLocation(
        local({
          draftIsolation: "worktree",
          draftPreviousWorktree: { ...previous, branch: null },
        }),
      ),
    ).toMatchObject({ token: "Previous worktree · shows project root", path: ROOT });
  });

  it("ignores a previous worktree once the draft is back on the local checkout", () => {
    expect(
      agentSurfaceLocation(
        local({
          draftIsolation: "in-place",
          draftPreviousWorktree: {
            threadId: "agt-7",
            worktreePath: `${ROOT}/.worktrees/agt-7`,
            branch: "agent/agt-7",
          },
        }),
      ),
    ).toMatchObject({ token: "Local checkout · main", path: ROOT });
  });

  it("names a server draft's new worktree by server without a path", () => {
    expect(agentSurfaceLocation({ ...remote(null), draftIsolation: "worktree" })).toMatchObject({
      kind: "shown",
      token: "build-box · New worktree",
      path: null,
    });
  });

  it("names a started in-place thread with the live branch of the shown checkout", () => {
    const thread = inPlaceThread();
    expect(agentSurfaceLocation(local({ thread, threadRootPath: ROOT }))).toMatchObject({
      kind: "shown",
      projectLabel: "editor",
      glyph: "folder",
      token: "Local checkout · main",
      path: ROOT,
    });
  });

  it("omits the branch when the live branch is unknown instead of guessing", () => {
    const thread = inPlaceThread();
    for (const liveBranches of [null, new Map<string, string | null>(), new Map([[ROOT, null]])]) {
      expect(
        agentSurfaceLocation(local({ thread, threadRootPath: ROOT, liveBranches })),
      ).toMatchObject({ kind: "shown", token: "Local checkout", path: ROOT });
    }
    expect(
      agentSurfaceLocation(
        local({ thread, threadRootPath: ROOT, liveBranches: new Map([["/elsewhere", "dev"]]) }),
      ),
    ).toMatchObject({ token: "Local checkout" });
  });

  it("names a worktree thread with its ship branch and worktree path", () => {
    expect(
      agentSurfaceLocation(
        local({
          thread: worktreeThread(SURFACE_FIXTURE_WORKTREE),
          threadRootPath: SURFACE_FIXTURE_WORKTREE,
        }),
      ),
    ).toMatchObject({
      kind: "shown",
      glyph: "branch",
      token: "Worktree · agent/agt-12",
      path: SURFACE_FIXTURE_WORKTREE,
    });
  });

  it("says New worktree without a path while the worktree is being created", () => {
    expect(
      agentSurfaceLocation(local({ thread: worktreeThread(null), threadRootPath: ROOT })),
    ).toMatchObject({
      kind: "shown",
      glyph: "branch",
      token: "New worktree · agent/agt-12",
      path: null,
    });
  });

  it("does not claim a worktree the panel is not rooted at", () => {
    expect(
      agentSurfaceLocation(
        local({ thread: worktreeThread(SURFACE_FIXTURE_WORKTREE), threadRootPath: ROOT }),
      ),
    ).toEqual({ kind: "hidden" });
  });

  it("names a server thread by server, without path or branch", () => {
    expect(agentSurfaceLocation(remote(remoteThread()))).toEqual({
      kind: "shown",
      projectLabel: "orders-api",
      glyph: "server",
      token: "build-box · Server checkout",
      description: "Right panel shows build-box · Server checkout of orders-api",
      path: null,
      location: {
        machine: { kind: "server", name: "build-box" },
        checkout: "serverCheckout",
        branch: null,
        path: null,
      },
    });
    expect(agentSurfaceLocation(remote(remoteThread("worktree")))).toMatchObject({
      glyph: "server",
      token: "build-box · Worktree",
      path: null,
    });
  });

  it("falls back to a neutral server word when the server name is unknown", () => {
    expect(agentSurfaceLocation(remote(remoteThread(), { serverName: null }))).toMatchObject({
      token: "Server · Server checkout",
    });
  });

  it("names a server draft by its exact server project", () => {
    expect(agentSurfaceLocation(remote(null))).toMatchObject({
      kind: "shown",
      projectLabel: "orders-api",
      token: "build-box · Server checkout",
      path: null,
    });
    expect(
      agentSurfaceLocation(remote(null, { scope: { ...REMOTE_SCOPE, projectId: "other" } })),
    ).toEqual({ kind: "hidden" });
  });

  it("hides a server location the panel is not attached to", () => {
    expect(agentSurfaceLocation(remote(remoteThread(), { scope: null }))).toEqual({
      kind: "hidden",
    });
    expect(
      agentSurfaceLocation(remote(null, { scope: { ...REMOTE_SCOPE, taskId: "task" } })),
    ).toEqual({ kind: "hidden" });
  });

  it("stays hidden while the project's workspace is not ready", () => {
    const hidden = { kind: "hidden" };
    const thread = inPlaceThread();
    const activations: ReadonlyArray<AgentSurfaceLocationInput["activation"]> = [
      surfaceActivation("pending"),
      { ...surfaceActivation("pending"), kind: "failed", message: "Could not open editor." },
      { kind: "none", rootPath: null },
      surfaceActivation("ready", surfaceRepositoryScope("/workspace/other")),
      { ...surfaceActivation("ready"), owner: { ownerId: "agent-root:replaced", generation: 1 } },
      { ...surfaceActivation("ready"), owner: { ownerId: `agent-root:${ROOT}`, generation: 2 } },
    ];
    for (const activation of activations) {
      expect(agentSurfaceLocation(local({ activation }))).toEqual(hidden);
      expect(agentSurfaceLocation(local({ thread, threadRootPath: ROOT, activation }))).toEqual(
        hidden,
      );
    }
    expect(agentSurfaceLocation(local({ workspaceRoot: "/workspace/other" }))).toEqual(hidden);
  });

  it("stays hidden for foreign, untrusted and missing scopes", () => {
    const scopes: ReadonlyArray<AgentSurfaceScope> = [
      { kind: "none" },
      {
        kind: "foreignRoot",
        projectRootKey: ROOT,
        repositoryRoot: ROOT,
        rootPath: ROOT,
        label: "editor",
      },
      { kind: "untrusted", projectRootKey: ROOT, repositoryRoot: ROOT },
    ];
    for (const scope of scopes) {
      expect(agentSurfaceLocation(local({ scope }))).toEqual({ kind: "hidden" });
    }
  });

  it("stays hidden when the thread's owner does not match the scope's project", () => {
    const foreignOwner = surfaceThreadView({
      thread: {
        ...inPlaceThread().thread,
        owner: { rootKey: ROOT, ownerId: "agent-root:someone-else", repositoryRoot: ROOT },
      },
    });
    expect(agentSurfaceLocation(local({ thread: foreignOwner, threadRootPath: ROOT }))).toEqual({
      kind: "hidden",
    });
    const foreignLaunchRoot = surfaceThreadView({
      thread: {
        ...inPlaceThread().thread,
        owner: { rootKey: ROOT, ownerId: "agent-root:app", repositoryRoot: "/workspace/nested" },
      },
    });
    expect(
      agentSurfaceLocation(local({ thread: foreignLaunchRoot, threadRootPath: ROOT })),
    ).toEqual({ kind: "hidden" });
  });

  it("stays hidden once the thread's worktree is gone", () => {
    const gone = { ...worktreeThread(SURFACE_FIXTURE_WORKTREE), worktreeRemoved: true };
    expect(
      agentSurfaceLocation(local({ thread: gone, threadRootPath: SURFACE_FIXTURE_WORKTREE })),
    ).toEqual({ kind: "hidden" });
  });

  it("never conflates two projects that share a root path", () => {
    const first = project({ rootKey: "key-a", ownerId: "owner-a", label: "editor" });
    const second = project({ rootKey: "key-b", ownerId: "owner-b", label: "editor copy" });
    const scopeB = {
      ...surfaceRepositoryScope(),
      projectRootKey: "key-b",
      ownerId: "owner-b",
    };
    expect(
      agentSurfaceLocation(
        local({
          scope: scopeB,
          activation: surfaceActivation("ready", scopeB),
          projects: [first, second],
        }),
      ),
    ).toMatchObject({
      kind: "shown",
      projectLabel: "editor copy",
    });
    const scopeA = { ...scopeB, projectRootKey: "key-a", ownerId: "owner-a" };
    expect(
      agentSurfaceLocation(
        local({
          scope: scopeB,
          activation: surfaceActivation("ready", scopeA),
          projects: [first, second],
        }),
      ),
    ).toEqual({ kind: "hidden" });
    const threadOfA = surfaceThreadView({
      thread: {
        ...inPlaceThread().thread,
        owner: { rootKey: "key-a", ownerId: "owner-a", repositoryRoot: ROOT },
      },
    });
    expect(
      agentSurfaceLocation(
        local({
          scope: scopeB,
          activation: surfaceActivation("ready", scopeB),
          projects: [first, second],
          thread: threadOfA,
          threadRootPath: ROOT,
        }),
      ),
    ).toEqual({ kind: "hidden" });
  });

  it("does not resolve the project from a stale owner generation at the same root", () => {
    expect(agentSurfaceLocation(local({ projects: [project({ generation: 2 })] }))).toEqual({
      kind: "hidden",
    });
    expect(
      agentSurfaceLocation(local({ projects: [project({ ownerId: "agent-root:replaced" })] })),
    ).toEqual({ kind: "hidden" });
  });

  it("never follows a bare path when the owner identity differs", () => {
    const pathTwin = surfaceThreadView({
      thread: {
        ...inPlaceThread().thread,
        owner: { rootKey: "/workspace/twin", ownerId: "agent-root:app", repositoryRoot: ROOT },
      },
    });
    expect(
      agentSurfaceLocation(local({ thread: pathTwin, threadRootPath: ROOT, workspaceRoot: ROOT })),
    ).toEqual({ kind: "hidden" });
  });
});
