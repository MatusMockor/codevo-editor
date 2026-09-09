import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentGitHistoryTarget } from "../../application/useAgentGitHistory";
import { agentProjectOwnsLaunchRoot, type AgentProjectDescriptor } from "../../domain/agentProject";
import { agentSurfaceTargetGone, agentSurfaceTargetPath } from "./agentModePresentation";
import type { AgentSurfaceScope } from "./agentSurfacePolicy";

export type AgentGitHistoryScope =
  | { readonly kind: "available"; readonly target: AgentGitHistoryTarget }
  | { readonly kind: "unavailable"; readonly reason: string };

export function agentGitHistoryScope(
  projects: ReadonlyArray<AgentProjectDescriptor>,
  thread: AgentThreadView | null,
  scope: AgentSurfaceScope,
  workspaceRoot: string | null,
  workspaceTrusted: boolean,
  selectedRepositoryRoot: string | null,
): AgentGitHistoryScope {
  if (!workspaceTrusted)
    return unavailable("Project unavailable. Reopen it or check its workspace settings.");
  if (thread === null) {
    if (scope.kind === "none") return unavailable("Add a project to browse its Git history.");
    if (scope.kind === "foreignRoot")
      return unavailable(`Switch to ${scope.label} to browse its Git history.`);
    if (scope.kind === "untrusted")
      return unavailable("Project unavailable. Reopen it or check its workspace settings.");
    const project = projects.find((candidate) => candidate.rootKey === scope.projectRootKey);
    const rootPath = selectedRepositoryRoot ?? scope.repositoryRoot;
    if (
      project === undefined ||
      project.ownerId !== scope.ownerId ||
      project.generation !== scope.generation ||
      project.trust !== "trusted" ||
      project.origin === "closed-tab-live-tasks" ||
      workspaceRoot === null ||
      workspaceRoot !== project.rootPath ||
      !agentProjectOwnsLaunchRoot(project, rootPath)
    )
      return unavailable("Select an available repository.");
    return available(rootPath, [scope.projectRootKey, scope.ownerId, scope.generation]);
  }
  if (agentSurfaceTargetGone(thread))
    return unavailable("This thread's checkout no longer exists.");
  if (thread.thread.target.isolation === "worktree" && thread.thread.target.worktreePath === null)
    return unavailable("This thread’s checkout is not ready yet.");
  const owner = thread.thread.owner;
  const project = projects.find((candidate) => candidate.rootKey === owner.rootKey);
  if (project === undefined || project.origin === "closed-tab-live-tasks")
    return unavailable("Reopen this thread's project to browse its Git history.");
  if (
    project.ownerId !== owner.ownerId &&
    project.runtimeOwnerIds?.includes(owner.ownerId) !== true
  )
    return unavailable("This thread's project is no longer available.");
  if (workspaceRoot !== project.rootPath)
    return unavailable(`Switch to ${project.label} to browse its Git history.`);
  if (project.trust !== "trusted" || !agentProjectOwnsLaunchRoot(project, owner.repositoryRoot))
    return unavailable("Project unavailable. Reopen it or check its workspace settings.");
  return available(agentSurfaceTargetPath(thread), [
    project.rootKey,
    project.ownerId,
    project.generation,
    owner.ownerId,
    thread.thread.threadId,
  ]);
}

function available(
  rootPath: string,
  identity: ReadonlyArray<string | number>,
): AgentGitHistoryScope {
  return { kind: "available", target: { rootPath, ownerKey: JSON.stringify(identity) } };
}

function unavailable(reason: string): AgentGitHistoryScope {
  return { kind: "unavailable", reason };
}
