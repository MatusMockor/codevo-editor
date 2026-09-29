import { compareAgentThreadOrder } from "../domain/agentThreadOrganization";
import { agentProjectOwnsOwner, type AgentProjectDescriptor } from "../domain/agentProject";
import {
  agentThreadAttention,
  agentThreadLifecycle,
  agentThreadUnread,
  type AgentThread,
} from "../domain/agentThread";
import {
  initialAgentShipState,
  type AgentShipAvailability,
  type AgentShipState,
} from "../domain/agentShip";
import type { ResolvedGitRepository } from "../domain/gitRepositoryMapping";
import type { AgentTaskChangeSummary, AgentThreadView } from "./agentThreadPorts";
import type { AgentEditorBridgeSurface } from "./useAgentEditorBridge";

export function agentThreadViews(
  previous: ReadonlyMap<string, AgentThreadView>,
  threads: ReadonlyMap<string, AgentThread>,
  summaries: ReadonlyMap<string, AgentTaskChangeSummary>,
  removedWorktrees: ReadonlySet<string>,
  missingWorktrees: ReadonlySet<string>,
  shipStates: ReadonlyMap<string, AgentShipState>,
  editor: AgentEditorBridgeSurface,
  projects: ReadonlyArray<AgentProjectDescriptor>,
): ReadonlyArray<AgentThreadView> {
  const projectsByRootKey = new Map<string, AgentProjectDescriptor[]>();
  for (const project of projects) {
    const siblings = projectsByRootKey.get(project.rootKey);
    if (siblings === undefined) {
      projectsByRootKey.set(project.rootKey, [project]);
      continue;
    }
    siblings.push(project);
  }
  const views: AgentThreadView[] = [];
  for (const thread of threads.values()) {
    const project = projectsByRootKey
      .get(thread.owner.rootKey)
      ?.find((candidate) => agentProjectOwnsOwner(candidate, thread.owner));
    if (project === undefined) continue;
    const next: AgentThreadView = {
      thread,
      lifecycle: agentThreadLifecycle(thread),
      repositoryLabel: repositoryLabel(thread.owner.repositoryRoot, project.rootPath),
      projectOrigin: project.origin,
      worktreeRemoved: removedWorktrees.has(thread.threadId),
      worktreeMissing: missingWorktrees.has(thread.threadId),
      changeSummary: summaries.get(thread.threadId) ?? null,
      ship: shipStates.get(thread.threadId) ?? fallbackShipState(thread),
      editorAvailability: editor.canOpenInEditor(thread.threadId),
      attention: agentThreadAttention(thread),
      unread: agentThreadUnread(thread),
    };
    const cached = previous.get(thread.threadId);
    views.push(cached !== undefined && sameThreadView(cached, next) ? cached : next);
  }
  return views.sort(compareThreadViews);
}

const fallbackShipStates = new WeakMap<AgentThread, AgentShipState>();

export function fallbackShipState(thread: AgentThread): AgentShipState {
  const memoized = fallbackShipStates.get(thread);
  if (memoized !== undefined) return memoized;
  const initial = initialAgentShipState(thread.integration);
  fallbackShipStates.set(thread, initial);
  return initial;
}

function sameThreadView(cached: AgentThreadView, next: AgentThreadView): boolean {
  if (cached.thread !== next.thread) return false;
  if (cached.changeSummary !== next.changeSummary) return false;
  if (cached.ship !== next.ship) return false;
  if (cached.worktreeRemoved !== next.worktreeRemoved) return false;
  if (cached.worktreeMissing !== next.worktreeMissing) return false;
  if (cached.projectOrigin !== next.projectOrigin) return false;
  if (cached.repositoryLabel !== next.repositoryLabel) return false;
  return sameAvailability(cached.editorAvailability, next.editorAvailability);
}

function sameAvailability(left: AgentShipAvailability, right: AgentShipAvailability): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "blocked" && right.kind === "blocked") return left.reason === right.reason;
  return true;
}

function compareThreadViews(left: AgentThreadView, right: AgentThreadView): number {
  if (left.thread.pinned !== right.thread.pinned) return left.thread.pinned ? -1 : 1;
  return compareAgentThreadOrder(left.thread, right.thread);
}

export function flattenProjectRepositories(
  projects: ReadonlyArray<AgentProjectDescriptor>,
): ReadonlyArray<ResolvedGitRepository> {
  const seen = new Set<string>();
  const repositories: ResolvedGitRepository[] = [];
  for (const project of projects) {
    for (const repository of project.repositories) {
      if (seen.has(repository.repositoryRoot)) continue;
      seen.add(repository.repositoryRoot);
      repositories.push(repository);
    }
  }
  return repositories;
}

function repositoryLabel(repositoryRoot: string, projectRootPath: string): string {
  if (repositoryRoot === projectRootPath) return lastSegment(projectRootPath);
  if (!repositoryRoot.startsWith(`${projectRootPath}/`)) return repositoryRoot;
  return repositoryRoot.slice(projectRootPath.length + 1);
}

function lastSegment(path: string): string {
  const segments = path.split("/").filter((segment) => segment !== "");
  return segments[segments.length - 1] ?? path;
}
