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
import type { AgentRailScope } from "./agentSidebarPresentation";

const ACTIVE_ROOT = "/workspace/app";
const BACKGROUND_ROOT = "/workspace/api";
const ALL_SCOPE: AgentRailScope = { kind: "all" };

describe("resolveComposerTarget", () => {
  it("targets the active-tab project when the rail shows all projects", () => {
    const target = resolveComposerTarget(
      [backgroundProject(), activeProject()],
      null,
      null,
      ALL_SCOPE,
    );

    expect(target).toEqual({ projectRootKey: ACTIVE_ROOT, repositoryRoot: ACTIVE_ROOT });
  });

  it("blocks the start target when no active-tab project is available", () => {
    expect(resolveComposerTarget([backgroundProject()], null, null, ALL_SCOPE)).toBeNull();
  });

  it("keeps an explicit repository scope even when it is a background project", () => {
    const target = resolveComposerTarget([backgroundProject(), activeProject()], null, null, {
      kind: "repository",
      projectRootKey: BACKGROUND_ROOT,
      repositoryRoot: BACKGROUND_ROOT,
    });

    expect(target).toEqual({ projectRootKey: BACKGROUND_ROOT, repositoryRoot: BACKGROUND_ROOT });
  });

  it("keeps an explicit selection over the active-tab fallback", () => {
    const target = resolveComposerTarget(
      [backgroundProject(), activeProject()],
      { projectRootKey: BACKGROUND_ROOT, repositoryRoot: BACKGROUND_ROOT },
      null,
      ALL_SCOPE,
    );

    expect(target).toEqual({ projectRootKey: BACKGROUND_ROOT, repositoryRoot: BACKGROUND_ROOT });
  });

  it("falls back to the active-tab project when the selection no longer exists", () => {
    const target = resolveComposerTarget(
      [backgroundProject(), activeProject()],
      { projectRootKey: "/workspace/gone", repositoryRoot: "/workspace/gone" },
      null,
      ALL_SCOPE,
    );

    expect(target).toEqual({ projectRootKey: ACTIVE_ROOT, repositoryRoot: ACTIVE_ROOT });
  });

  it("follows the owner of the selected thread over any project fallback", () => {
    const target = resolveComposerTarget(
      [activeProject()],
      null,
      threadView(BACKGROUND_ROOT),
      ALL_SCOPE,
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
    label: "app",
    origin: "active-tab",
    repositories: [{ repositoryRoot: ACTIVE_ROOT, label: "app" }],
  };
}

function backgroundProject(): AgentComposerProjectOption {
  return {
    projectRootKey: BACKGROUND_ROOT,
    label: "api-service",
    origin: "background-tab",
    repositories: [{ repositoryRoot: BACKGROUND_ROOT, label: "api-service" }],
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
