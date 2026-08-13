import type {
  AgentProjectDescriptor,
  AgentProjectOrigin,
  AgentProjectTrust,
} from "../../domain/agentProject";
import type { AgentTaskIsolation, AgentTaskStatus } from "../../domain/agentTask";
import type { GitChangeStatus } from "../../domain/git";
import { gitRepositoryDisplayName } from "../../domain/gitRepositoryMapping";
import { localHistoryRelativeTime } from "../../domain/localHistory";
import type { AgentTaskView, OrphanedWorktreeView } from "../../application/useAgentTasks";

export const MAX_AGENT_THREAD_TITLE_CHARACTERS = 96;

export const DETACHED_AGENT_PROJECT_ROOT_KEY = "agent-project:detached";
export const DETACHED_AGENT_PROJECT_LABEL = "Removed projects";

export type AgentThreadTone = "running" | "queued" | "done" | "failed" | "stopped";

export type AgentProjectGroupKind = "project" | "detached";

export interface AgentRepositoryGroup {
  readonly repositoryRoot: string;
  readonly label: string;
  readonly repositoryResolved: boolean;
  readonly threads: ReadonlyArray<AgentTaskView>;
  readonly orphans: ReadonlyArray<OrphanedWorktreeView>;
  readonly liveCount: number;
}

export interface AgentProjectGroup {
  readonly projectRootKey: string;
  readonly kind: AgentProjectGroupKind;
  readonly label: string;
  readonly trust: AgentProjectTrust;
  readonly origin: AgentProjectOrigin;
  readonly singleRepo: boolean;
  readonly repos: ReadonlyArray<AgentRepositoryGroup>;
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

export function agentProjectTrustNotice(trust: AgentProjectTrust): string | null {
  switch (trust) {
    case "trusted":
      return null;
    case "untrusted":
      return "This project is not trusted, so agents cannot start here.";
    case "unknown":
      return "This project's trust could not be read, so agents cannot start here.";
    default:
      return unsupportedTrust(trust);
  }
}

export function agentProjectOriginBadge(origin: AgentProjectOrigin): string | null {
  switch (origin) {
    case "active-tab":
      return null;
    case "background-tab":
      return "Background";
    case "closed-tab-live-tasks":
      return "Tab closed";
    default:
      return unsupportedOrigin(origin);
  }
}

export function agentProjectWorktreeOnly(origin: AgentProjectOrigin): boolean {
  switch (origin) {
    case "active-tab":
      return false;
    case "background-tab":
      return true;
    case "closed-tab-live-tasks":
      return true;
    default:
      return unsupportedOrigin(origin);
  }
}

export function agentProjectWorktreeOnlyReason(origin: AgentProjectOrigin): string | null {
  switch (origin) {
    case "active-tab":
      return null;
    case "background-tab":
      return "This project is not the active tab, so the agent only runs in an isolated worktree.";
    case "closed-tab-live-tasks":
      return "This project's tab is closed, so the agent only runs in an isolated worktree.";
    default:
      return unsupportedOrigin(origin);
  }
}

export function agentProjectGroups(
  projects: ReadonlyArray<AgentProjectDescriptor>,
  threads: ReadonlyArray<AgentTaskView>,
  orphans: ReadonlyArray<OrphanedWorktreeView>,
  pinnedTaskIds: ReadonlyArray<string> = [],
): ReadonlyArray<AgentProjectGroup> {
  const pinRanks = agentThreadPinRanks(pinnedTaskIds);
  const claimedRepositoryRoots = new Set<string>();
  const claimedProjectRootKeys = new Set<string>();
  const claimedOwnerIds = new Set<string>();
  const knownOwnerIds = new Set(projects.map((project) => project.ownerId));
  const groups: AgentProjectGroup[] = [];

  for (const project of projects) {
    if (claimedProjectRootKeys.has(project.rootKey)) {
      continue;
    }
    claimedProjectRootKeys.add(project.rootKey);
    const ownsThreads = !claimedOwnerIds.has(project.ownerId);
    claimedOwnerIds.add(project.ownerId);
    const projectThreads = ownsThreads
      ? threads.filter((thread) => thread.record.owner.workspaceId === project.ownerId)
      : [];
    groups.push(
      buildProjectGroup(project, projectThreads, orphans, pinRanks, claimedRepositoryRoots),
    );
  }

  const detachedThreads = threads.filter(
    (thread) => !knownOwnerIds.has(thread.record.owner.workspaceId),
  );
  const detachedOrphans = orphans.filter(
    (orphan) => !claimedRepositoryRoots.has(orphan.repositoryRoot),
  );
  const detachedRoots = [
    ...new Set([
      ...detachedThreads.map((thread) => thread.record.owner.repositoryRoot),
      ...detachedOrphans.map((orphan) => orphan.repositoryRoot),
    ]),
  ].sort();

  if (detachedRoots.length === 0) {
    return groups;
  }

  const detachedRepos = detachedRoots.map((root) =>
    buildGroup(
      root,
      root,
      detachedThreads.filter((thread) => thread.record.owner.repositoryRoot === root),
      detachedOrphans.filter((orphan) => orphan.repositoryRoot === root),
      false,
      pinRanks,
    ),
  );

  return [
    ...groups,
    {
      projectRootKey: DETACHED_AGENT_PROJECT_ROOT_KEY,
      kind: "detached",
      label: DETACHED_AGENT_PROJECT_LABEL,
      trust: "unknown",
      origin: "closed-tab-live-tasks",
      singleRepo: false,
      repos: detachedRepos,
      liveCount: totalLiveCount(detachedRepos),
    },
  ];
}

function buildProjectGroup(
  project: AgentProjectDescriptor,
  projectThreads: ReadonlyArray<AgentTaskView>,
  orphans: ReadonlyArray<OrphanedWorktreeView>,
  pinRanks: ReadonlyMap<string, number>,
  claimedRepositoryRoots: Set<string>,
): AgentProjectGroup {
  const repositories = project.repositories.filter(
    (repository) => !claimedRepositoryRoots.has(repository.repositoryRoot),
  );
  for (const repository of repositories) {
    claimedRepositoryRoots.add(repository.repositoryRoot);
  }

  const ownedRoots = new Set(repositories.map((repository) => repository.repositoryRoot));
  const repos = repositories.map((repository) =>
    buildGroup(
      repository.repositoryRoot,
      gitRepositoryDisplayName(repository.mapping.rootRelativePath, project.rootPath),
      projectThreads.filter(
        (thread) => thread.record.owner.repositoryRoot === repository.repositoryRoot,
      ),
      orphans.filter((orphan) => orphan.repositoryRoot === repository.repositoryRoot),
      true,
      pinRanks,
    ),
  );

  const strayRoots = [
    ...new Set(
      projectThreads
        .map((thread) => thread.record.owner.repositoryRoot)
        .filter((root) => !ownedRoots.has(root)),
    ),
  ].sort();
  const strayRepos = strayRoots.map((root) =>
    buildGroup(
      root,
      strayRepositoryLabel(root, project.rootPath),
      projectThreads.filter((thread) => thread.record.owner.repositoryRoot === root),
      [],
      false,
      pinRanks,
    ),
  );

  const repoGroups = [...repos, ...strayRepos];
  return {
    projectRootKey: project.rootKey,
    kind: "project",
    label: project.label,
    trust: project.trust,
    origin: project.origin,
    singleRepo:
      strayRepos.length === 0 &&
      repositories.length === 1 &&
      repositories[0]?.mapping.rootRelativePath === "",
    repos: repoGroups,
    liveCount: totalLiveCount(repoGroups),
  };
}

function strayRepositoryLabel(repositoryRoot: string, projectRootPath: string): string {
  if (repositoryRoot === projectRootPath) {
    return gitRepositoryDisplayName("", projectRootPath);
  }
  if (repositoryRoot.startsWith(`${projectRootPath}/`)) {
    return repositoryRoot.slice(projectRootPath.length + 1);
  }
  return repositoryRoot;
}

function totalLiveCount(repos: ReadonlyArray<AgentRepositoryGroup>): number {
  return repos.reduce((total, repo) => total + repo.liveCount, 0);
}

function buildGroup(
  repositoryRoot: string,
  label: string,
  threads: ReadonlyArray<AgentTaskView>,
  orphans: ReadonlyArray<OrphanedWorktreeView>,
  repositoryResolved: boolean,
  pinRanks: ReadonlyMap<string, number>,
): AgentRepositoryGroup {
  const groupThreads = orderPinnedThreadsFirst(threads, pinRanks);

  return {
    repositoryRoot,
    label,
    repositoryResolved,
    threads: groupThreads,
    orphans,
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

function unsupportedTrust(trust: never): never {
  throw new TypeError(`Unsupported agent project trust: ${String(trust)}.`);
}

function unsupportedOrigin(origin: never): never {
  throw new TypeError(`Unsupported agent project origin: ${String(origin)}.`);
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
