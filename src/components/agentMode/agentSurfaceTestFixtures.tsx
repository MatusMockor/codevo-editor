import {
  agentThreadAttention,
  agentThreadUnread,
  type AgentThread,
} from "../../domain/agentThread";
import type { AgentTaskChangeSummary, AgentThreadView } from "../../application/agentThreadPorts";
import type { GitChangeStatus, GitChangedFile } from "../../domain/git";

export const SURFACE_FIXTURE_ROOT = "/workspace/app";
export const SURFACE_FIXTURE_WORKTREE = `${SURFACE_FIXTURE_ROOT}/.worktrees/agt-1`;

export function surfaceThreadView(overrides: Partial<AgentThreadView> = {}): AgentThreadView {
  const thread: AgentThread = {
    threadId: "agt-1",
    owner: {
      rootKey: SURFACE_FIXTURE_ROOT,
      ownerId: "agent-root:app",
      repositoryRoot: SURFACE_FIXTURE_ROOT,
    },
    target: { isolation: "worktree", worktreePath: SURFACE_FIXTURE_WORKTREE },
    provider: { kind: "claudeCode", sessionId: "session-abcdefgh" },
    title: "Refactor the parser",
    pinned: false,
    archived: false,
    createdAtEpochMs: 1_700_000_000_000,
    updatedAtEpochMs: 1_700_000_000_000,
    turns: [],
    turnsTruncated: false,
    viewedAtEpochMs: null,
    externalOrigin: null,
    integration: null,
    ...(overrides.thread ?? {}),
  };
  return {
    ship: { kind: "idle", status: null, loadingStatus: false },
    editorAvailability: { kind: "available" },
    attention: agentThreadAttention(thread),
    unread: agentThreadUnread(thread),
    lifecycle: "settled",
    repositoryLabel: "app",
    projectOrigin: "active-tab",
    worktreeRemoved: false,
    worktreeMissing: false,
    changeSummary: null,
    ...overrides,
    thread,
  };
}

export function surfaceSummary(
  overrides: Partial<AgentTaskChangeSummary> = {},
): AgentTaskChangeSummary {
  return {
    loading: false,
    error: null,
    files: [],
    truncated: false,
    removing: false,
    diff: null,
    ...overrides,
  };
}

export function surfaceChangedFile(
  relativePath: string,
  status: GitChangeStatus = "modified",
): GitChangedFile {
  return {
    isStaged: false,
    isUnversioned: false,
    oldPath: null,
    oldRelativePath: null,
    path: `${SURFACE_FIXTURE_WORKTREE}/${relativePath}`,
    relativePath,
    status,
  };
}
