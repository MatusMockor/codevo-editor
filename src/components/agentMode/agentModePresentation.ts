import type { AgentTaskIsolation, AgentTaskStatus } from "../../domain/agentTask";
import type { GitChangeStatus } from "../../domain/git";
import {
  gitRepositoryDisplayName,
  type ResolvedGitRepository,
} from "../../domain/gitRepositoryMapping";
import { localHistoryRelativeTime } from "../../domain/localHistory";
import type { AgentTaskView, OrphanedWorktreeView } from "../../application/useAgentTasks";

export const MAX_AGENT_THREAD_TITLE_CHARACTERS = 96;

export type AgentThreadTone = "running" | "queued" | "done" | "failed" | "stopped";

export interface AgentRepositoryGroup {
  readonly repositoryRoot: string;
  readonly label: string;
  readonly threads: ReadonlyArray<AgentTaskView>;
  readonly orphans: ReadonlyArray<OrphanedWorktreeView>;
  readonly liveCount: number;
}

export function agentThreadTone(status: AgentTaskStatus): AgentThreadTone {
  switch (status.kind) {
    case "pending":
      return "queued";
    case "running":
      return "running";
    case "exited":
      return status.exitCode === 0 ? "done" : "failed";
    case "failed":
      return "failed";
    case "stopped":
      return "stopped";
    default:
      return unsupportedStatus(status);
  }
}

export function agentThreadStatusLabel(status: AgentTaskStatus): string {
  switch (status.kind) {
    case "pending":
      return "Queued";
    case "running":
      return "Running";
    case "exited":
      return status.exitCode === 0 ? "Finished" : `Exited ${status.exitCode}`;
    case "failed":
      return "Failed";
    case "stopped":
      return "Stopped";
    default:
      return unsupportedStatus(status);
  }
}

export function agentThreadTitle(prompt: string): string {
  const title = firstNonEmptyLine(prompt);

  if (title === "") {
    return "Untitled thread";
  }

  const codePoints = Array.from(title);

  if (codePoints.length <= MAX_AGENT_THREAD_TITLE_CHARACTERS) {
    return title;
  }

  return `${codePoints.slice(0, MAX_AGENT_THREAD_TITLE_CHARACTERS).join("")}…`;
}

function firstNonEmptyLine(prompt: string): string {
  for (const line of prompt.split("\n")) {
    const trimmed = line.trim();
    if (trimmed !== "") {
      return trimmed;
    }
  }

  return "";
}

export function agentThreadTimeLabel(startedAtEpochMs: number, now: number): string {
  return localHistoryRelativeTime(startedAtEpochMs, now);
}

export function agentIsolationBadgeLabel(isolation: AgentTaskIsolation): string {
  switch (isolation) {
    case "worktree":
      return "Worktree";
    case "in-place":
      return "In place";
    default:
      return unsupportedIsolation(isolation);
  }
}

export function agentIsolationBadgeReason(isolation: AgentTaskIsolation): string {
  switch (isolation) {
    case "worktree":
      return "The agent works in a dedicated Git worktree, so your checkout stays untouched.";
    case "in-place":
      return "The agent works directly in your checkout of this repository.";
    default:
      return unsupportedIsolation(isolation);
  }
}

export function agentChangeStatusLetter(status: GitChangeStatus): string {
  switch (status) {
    case "added":
      return "A";
    case "conflicted":
      return "C";
    case "deleted":
      return "D";
    case "modified":
      return "M";
    case "renamed":
      return "R";
    case "untracked":
      return "U";
    default:
      return unsupportedChangeStatus(status);
  }
}

export function agentRepositoryGroups(
  repositories: ReadonlyArray<ResolvedGitRepository>,
  threads: ReadonlyArray<AgentTaskView>,
  orphans: ReadonlyArray<OrphanedWorktreeView>,
  workspaceRoot: string | null,
): ReadonlyArray<AgentRepositoryGroup> {
  const roots = new Set(repositories.map((repository) => repository.repositoryRoot));
  const groups = repositories.map((repository) =>
    buildGroup(
      repository.repositoryRoot,
      gitRepositoryDisplayName(
        repository.mapping.rootRelativePath,
        workspaceRoot ?? repository.repositoryRoot,
      ),
      threads,
      orphans,
    ),
  );

  const detachedRoots = new Set(
    [
      ...threads.map((thread) => thread.record.owner.repositoryRoot),
      ...orphans.map((orphan) => orphan.repositoryRoot),
    ].filter((root) => !roots.has(root)),
  );

  const detached = [...detachedRoots]
    .sort()
    .map((root) => buildGroup(root, root, threads, orphans));

  return [...groups, ...detached];
}

function buildGroup(
  repositoryRoot: string,
  label: string,
  threads: ReadonlyArray<AgentTaskView>,
  orphans: ReadonlyArray<OrphanedWorktreeView>,
): AgentRepositoryGroup {
  const groupThreads = threads.filter(
    (thread) => thread.record.owner.repositoryRoot === repositoryRoot,
  );

  return {
    repositoryRoot,
    label,
    threads: groupThreads,
    orphans: orphans.filter((orphan) => orphan.repositoryRoot === repositoryRoot),
    liveCount: groupThreads.filter((thread) => !thread.terminal).length,
  };
}

function unsupportedStatus(status: never): never {
  throw new TypeError(`Unsupported agent task status: ${JSON.stringify(status)}.`);
}

function unsupportedIsolation(isolation: never): never {
  throw new TypeError(`Unsupported agent task isolation: ${String(isolation)}.`);
}

function unsupportedChangeStatus(status: never): never {
  throw new TypeError(`Unsupported Git change status: ${String(status)}.`);
}
