import { describe, expect, it } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import {
  agentThreadAttention,
  agentThreadUnread,
  type AgentThread,
} from "../../domain/agentThread";
import {
  composerTargetLabel,
  composerTargetView,
  resolveComposerTarget,
  type AgentComposerProjectOption,
} from "./agentComposerTarget";

const ACTIVE_ROOT = "/workspace/app";
const BACKGROUND_ROOT = "/workspace/api";

describe("resolveComposerTarget", () => {
  it("validates automatic project scope authority before consulting remembered membership", () => {
    const nested = `${ACTIVE_ROOT}/api`;
    const project = {
      ...activeProject(),
      repositories: [{ repositoryRoot: nested, label: "api" }],
    };
    const preferences = new Map([[ACTIVE_ROOT, nested]]);
    const scope = { ...selection(ACTIVE_ROOT, "agent-root:app", 1), kind: "project" as const };
    expect(resolveComposerTarget([project], null, null, scope, preferences)?.repositoryRoot).toBe(
      nested,
    );
    expect(
      resolveComposerTarget([{ ...project, generation: 2 }], null, null, scope, preferences),
    ).toBeNull();
    expect(
      resolveComposerTarget(
        [{ ...project, ownerId: "replacement" }],
        null,
        null,
        scope,
        preferences,
      ),
    ).toBeNull();
    expect(resolveComposerTarget([], null, null, scope, preferences)).toBeNull();
  });

  it("uses remembered membership only for the active default target and falls back after removal", () => {
    const nested = `${ACTIVE_ROOT}/api`;
    const project = {
      ...activeProject(),
      repositories: [{ repositoryRoot: nested, label: "api" }],
    };
    const preferences = new Map([
      [ACTIVE_ROOT, nested],
      [BACKGROUND_ROOT, `${BACKGROUND_ROOT}/web`],
    ]);
    expect(resolveComposerTarget([project], null, null, null, preferences)?.repositoryRoot).toBe(
      nested,
    );
    expect(
      resolveComposerTarget([activeProject()], null, null, null, preferences)?.repositoryRoot,
    ).toBe(ACTIVE_ROOT);
    expect(resolveComposerTarget([], null, null, null, preferences)).toBeNull();
    expect(
      resolveComposerTarget(
        [project],
        selection(ACTIVE_ROOT, "agent-root:app", 0),
        null,
        null,
        preferences,
      ),
    ).toBeNull();
    expect(
      resolveComposerTarget(
        [project],
        { kind: "missing", projectRootKey: ACTIVE_ROOT, repositoryRoot: nested },
        null,
        null,
        preferences,
      ),
    ).toBeNull();
    expect(
      resolveComposerTarget(
        [project],
        null,
        null,
        { ...selection(ACTIVE_ROOT, "agent-root:app", 1), kind: "repository" },
        preferences,
      )?.repositoryRoot,
    ).toBe(ACTIVE_ROOT);
    expect(
      resolveComposerTarget([project], null, threadView(BACKGROUND_ROOT), null, preferences)
        ?.repositoryRoot,
    ).toBe(BACKGROUND_ROOT);
  });

  it("targets the active-tab project when no project is scoped", () => {
    const target = resolveComposerTarget([backgroundProject(), activeProject()], null, null, null);

    expect(target).toEqual({ projectRootKey: ACTIVE_ROOT, repositoryRoot: ACTIVE_ROOT });
  });

  it("blocks the start target when no active-tab project is available", () => {
    expect(resolveComposerTarget([backgroundProject()], null, null, null)).toBeNull();
  });

  it("keeps an explicit repository scope even when it is a background project", () => {
    const target = resolveComposerTarget([backgroundProject(), activeProject()], null, null, {
      kind: "repository",
      projectRootKey: BACKGROUND_ROOT,
      repositoryRoot: BACKGROUND_ROOT,
      ownerId: "agent-root:api",
      generation: 1,
    });

    expect(target).toEqual({ projectRootKey: BACKGROUND_ROOT, repositoryRoot: BACKGROUND_ROOT });
  });

  it("keeps an explicit selection over the active-tab fallback", () => {
    const target = resolveComposerTarget(
      [backgroundProject(), activeProject()],
      selection(BACKGROUND_ROOT, "agent-root:api", 1),
      null,
      null,
    );

    expect(target).toEqual({ projectRootKey: BACKGROUND_ROOT, repositoryRoot: BACKGROUND_ROOT });
  });

  it("fails closed when an explicit selection no longer exists", () => {
    const target = resolveComposerTarget(
      [backgroundProject(), activeProject()],
      selection("/workspace/gone", "agent-root:gone", 1),
      null,
      null,
    );

    expect(target).toBeNull();
  });

  it("fails closed when an explicit scope no longer exists", () => {
    const target = resolveComposerTarget([backgroundProject(), activeProject()], null, null, {
      kind: "repository",
      projectRootKey: "/workspace/gone",
      repositoryRoot: "/workspace/gone",
      ownerId: "agent-root:gone",
      generation: 1,
    });

    expect(target).toBeNull();
  });

  it("prefers a repository selection inside the scoped project", () => {
    const nested = `${ACTIVE_ROOT}/packages/api`;
    const target = resolveComposerTarget(
      [{ ...activeProject(), repositories: [{ repositoryRoot: nested, label: "api" }] }],
      selection(ACTIVE_ROOT, "agent-root:app", 1, nested),
      null,
      {
        kind: "repository",
        projectRootKey: ACTIVE_ROOT,
        repositoryRoot: ACTIVE_ROOT,
        ownerId: "agent-root:app",
        generation: 1,
      },
    );

    expect(target).toEqual({ projectRootKey: ACTIVE_ROOT, repositoryRoot: nested });
  });

  it("lets an explicit selection retarget the composer inside a scoped rail", () => {
    const target = resolveComposerTarget(
      [backgroundProject(), activeProject()],
      selection(BACKGROUND_ROOT, "agent-root:api", 1),
      null,
      {
        kind: "repository",
        projectRootKey: ACTIVE_ROOT,
        repositoryRoot: ACTIVE_ROOT,
        ownerId: "agent-root:app",
        generation: 1,
      },
    );

    expect(target).toEqual({ projectRootKey: BACKGROUND_ROOT, repositoryRoot: BACKGROUND_ROOT });
  });

  it("fails closed on a missing selection even while a repository scope is live", () => {
    const target = resolveComposerTarget(
      [backgroundProject(), activeProject()],
      { kind: "missing", projectRootKey: "/workspace/gone", repositoryRoot: "/workspace/gone" },
      null,
      {
        kind: "repository",
        projectRootKey: ACTIVE_ROOT,
        repositoryRoot: ACTIVE_ROOT,
        ownerId: "agent-root:app",
        generation: 1,
      },
    );

    expect(target).toBeNull();
  });

  it("does not rebind a selection after the same roots are registered by a new generation", () => {
    const target = resolveComposerTarget(
      [{ ...activeProject(), generation: 2 }],
      selection(ACTIVE_ROOT, "agent-root:app", 1),
      null,
      null,
    );

    expect(target).toBeNull();
  });

  it("follows the owner of the selected thread over any project fallback", () => {
    const target = resolveComposerTarget(
      [activeProject()],
      null,
      threadView(BACKGROUND_ROOT),
      null,
    );

    expect(target).toEqual({ projectRootKey: BACKGROUND_ROOT, repositoryRoot: BACKGROUND_ROOT });
  });
});

describe("composerTargetView", () => {
  it("projects the label, the project folder and the nested repositories of the resolved project", () => {
    const nested = `${ACTIVE_ROOT}/packages/api`;
    const project = {
      ...activeProject(),
      repositories: [{ repositoryRoot: nested, label: "api" }],
    };
    const view = composerTargetView([project], {
      projectRootKey: ACTIVE_ROOT,
      repositoryRoot: ACTIVE_ROOT,
    });

    expect(view).toEqual({
      projectLabel: "app",
      projectRoot: ACTIVE_ROOT,
      repositoryOptions: [{ repositoryRoot: nested, label: "api" }],
      selectedRepositoryRoot: ACTIVE_ROOT,
    });
    expect(
      composerTargetLabel([project], { projectRootKey: ACTIVE_ROOT, repositoryRoot: nested }),
    ).toBe("api");
    expect(
      composerTargetLabel([project], { projectRootKey: ACTIVE_ROOT, repositoryRoot: ACTIVE_ROOT }),
    ).toBe("app");
  });

  it("defaults a project that is only a folder of repositories to the folder itself", () => {
    const nested = `${ACTIVE_ROOT}/pa-ai-be`;
    const folder = {
      ...activeProject(),
      repositories: [{ repositoryRoot: nested, label: "pa-ai-be" }],
    };

    expect(resolveComposerTarget([folder], null, null, null)).toEqual({
      projectRootKey: ACTIVE_ROOT,
      repositoryRoot: ACTIVE_ROOT,
    });
    expect(
      resolveComposerTarget(
        [folder],
        selection(ACTIVE_ROOT, "agent-root:app", 1, nested),
        null,
        null,
      ),
    ).toEqual({ projectRootKey: ACTIVE_ROOT, repositoryRoot: nested });
    expect(
      resolveComposerTarget(
        [folder],
        selection(ACTIVE_ROOT, "agent-root:app", 1, `${ACTIVE_ROOT}/mongo-init`),
        null,
        null,
      ),
    ).toBeNull();
  });

  it("returns no view for a target whose project is gone", () => {
    expect(
      composerTargetView([activeProject()], {
        projectRootKey: BACKGROUND_ROOT,
        repositoryRoot: BACKGROUND_ROOT,
      }),
    ).toBeNull();
  });
});

function activeProject(): AgentComposerProjectOption {
  return {
    projectRootKey: ACTIVE_ROOT,
    ownerId: "agent-root:app",
    generation: 1,
    label: "app",
    origin: "active-tab",
    rootPath: ACTIVE_ROOT,
    repositories: [],
  };
}

function backgroundProject(): AgentComposerProjectOption {
  return {
    projectRootKey: BACKGROUND_ROOT,
    ownerId: "agent-root:api",
    generation: 1,
    label: "api-service",
    origin: "background-tab",
    rootPath: BACKGROUND_ROOT,
    repositories: [],
  };
}

function selection(root: string, ownerId: string, generation: number, repositoryRoot = root) {
  return {
    kind: "bound" as const,
    projectRootKey: root,
    repositoryRoot,
    ownerId,
    generation,
  };
}

function threadView(root: string): AgentThreadView {
  const thread: AgentThread = {
    threadId: "agt-1",
    owner: { rootKey: root, ownerId: "agent-root:api", repositoryRoot: root },
    target: { isolation: "in-place", worktreePath: null },
    provider: { kind: "claudeCode", sessionId: null },
    title: "Fix the parser",
    pinned: false,
    archived: false,
    createdAtEpochMs: 1_700_000_000_000,
    updatedAtEpochMs: 1_700_000_000_000,
    turns: [],
    turnsTruncated: false,
    viewedAtEpochMs: null,
    externalOrigin: null,
    integration: null,
  };
  return {
    ship: { kind: "idle", status: null, loadingStatus: false },
    editorAvailability: { kind: "available" },
    attention: agentThreadAttention(thread),
    unread: agentThreadUnread(thread),
    thread,
    lifecycle: "settled",
    repositoryLabel: "api-service",
    projectOrigin: "background-tab",
    worktreeRemoved: false,
    worktreeMissing: false,
    changeSummary: null,
  };
}
