import { describe, expect, it } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import {
  agentThreadAttention,
  agentThreadUnread,
  type AgentThread,
} from "../../domain/agentThread";
import {
  composerTargetView,
  resolveComposerTarget,
  type AgentComposerProjectOption,
} from "./agentComposerTarget";

const ACTIVE_ROOT = "/workspace/app";
const BACKGROUND_ROOT = "/workspace/api";

describe("resolveComposerTarget", () => {
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
  it("projects the label and repositories of the resolved project", () => {
    const view = composerTargetView([activeProject()], {
      projectRootKey: ACTIVE_ROOT,
      repositoryRoot: ACTIVE_ROOT,
    });

    expect(view).toEqual({
      projectLabel: "app",
      repositoryOptions: [{ repositoryRoot: ACTIVE_ROOT, label: "app" }],
      selectedRepositoryRoot: ACTIVE_ROOT,
    });
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
    repositories: [{ repositoryRoot: ACTIVE_ROOT, label: "app" }],
  };
}

function backgroundProject(): AgentComposerProjectOption {
  return {
    projectRootKey: BACKGROUND_ROOT,
    ownerId: "agent-root:api",
    generation: 1,
    label: "api-service",
    origin: "background-tab",
    repositories: [{ repositoryRoot: BACKGROUND_ROOT, label: "api-service" }],
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
