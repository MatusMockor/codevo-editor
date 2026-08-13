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
  readonly repositoryResolved: boolean;
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
  pinnedTaskIds: ReadonlyArray<string> = [],
): ReadonlyArray<AgentRepositoryGroup> {
  const pinRanks = agentThreadPinRanks(pinnedTaskIds);
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
      true,
      pinRanks,
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
    .map((root) => buildGroup(root, root, threads, orphans, false, pinRanks));

  return [...groups, ...detached];
}

function buildGroup(
  repositoryRoot: string,
  label: string,
  threads: ReadonlyArray<AgentTaskView>,
  orphans: ReadonlyArray<OrphanedWorktreeView>,
  repositoryResolved: boolean,
  pinRanks: ReadonlyMap<string, number>,
): AgentRepositoryGroup {
  const groupThreads = orderPinnedThreadsFirst(
    threads.filter((thread) => thread.record.owner.repositoryRoot === repositoryRoot),
    pinRanks,
  );

  return {
    repositoryRoot,
    label,
    repositoryResolved,
    threads: groupThreads,
    orphans: orphans.filter((orphan) => orphan.repositoryRoot === repositoryRoot),
    liveCount: groupThreads.filter((thread) => !thread.terminal).length,
  };
}

function agentThreadPinRanks(pinnedTaskIds: ReadonlyArray<string>): ReadonlyMap<string, number> {
  const ranks = new Map<string, number>();
  for (const [rank, taskId] of pinnedTaskIds.entries()) {
    if (ranks.has(taskId)) {
      continue;
    }
    ranks.set(taskId, rank);
  }
  return ranks;
}

function orderPinnedThreadsFirst(
  threads: ReadonlyArray<AgentTaskView>,
  pinRanks: ReadonlyMap<string, number>,
): ReadonlyArray<AgentTaskView> {
  if (pinRanks.size === 0) {
    return threads;
  }
  return [...threads].sort(
    (left, right) => threadPinRank(left, pinRanks) - threadPinRank(right, pinRanks),
  );
}

function threadPinRank(thread: AgentTaskView, pinRanks: ReadonlyMap<string, number>): number {
  return pinRanks.get(thread.record.owner.taskId) ?? Number.MAX_SAFE_INTEGER;
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
