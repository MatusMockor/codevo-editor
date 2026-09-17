import type { AgentProjectDescriptor } from "../../domain/agentProject";
import type { AgentProjectGroup } from "./agentModePresentation";
import type { ComposerScope } from "./agentComposerTarget";

/** Display membership only: never rewrites a thread's execution owner or repository. */
export function groupedEnvironmentProjects(
  groups: readonly AgentProjectGroup[],
  projects: readonly AgentProjectDescriptor[],
  links: ReadonlyMap<string, string>,
): readonly AgentProjectGroup[] {
  const aliases = new Map<string, string>();
  for (const [remoteKey, localRoot] of links) {
    if (!remoteKey.startsWith("remote:")) continue;
    const local = projects.find(
      (project) => !project.rootKey.startsWith("remote:") && project.rootKey === localRoot,
    );
    if (local && groups.some((group) => group.projectRootKey === remoteKey))
      aliases.set(remoteKey, local.rootKey);
  }
  return groups
    .filter((group) => !aliases.has(group.projectRootKey))
    .map((group) => {
      const members = groups.filter(
        (candidate) => aliases.get(candidate.projectRootKey) === group.projectRootKey,
      );
      if (members.length === 0) return group;
      return {
        ...group,
        memberProjectRootKeys: [
          group.projectRootKey,
          ...members.map((member) => member.projectRootKey),
        ],
        repos: [...group.repos, ...members.flatMap((member) => member.repos)],
        liveCount: group.liveCount + members.reduce((sum, member) => sum + member.liveCount, 0),
      };
    });
}

/** Resolve an exact member of the displayed project, never an arbitrary project on a server. */
export function environmentComposerScope(
  scope: ComposerScope | null,
  groups: readonly AgentProjectGroup[],
  projects: readonly AgentProjectDescriptor[],
  serverId: string | null,
): ComposerScope | null {
  if (scope === null || scope.kind === "missing") return scope;
  const group = groups.find(
    (candidate) =>
      candidate.projectRootKey === scope.projectRootKey ||
      candidate.memberProjectRootKeys?.includes(scope.projectRootKey),
  );
  const members = group?.memberProjectRootKeys ?? [scope.projectRootKey];
  const prefix = serverId === null ? null : `remote:${encodeURIComponent(serverId)}:`;
  const candidates = projects.filter(
    (project) =>
      members.includes(project.rootKey) &&
      (prefix === null
        ? !project.rootKey.startsWith("remote:")
        : project.rootKey.startsWith(prefix)),
  );
  // Multiple linked checkouts on the same server require an explicit selection, not a guess.
  if (candidates.length !== 1)
    return {
      kind: "missing",
      projectRootKey: scope.projectRootKey,
      repositoryRoot: scope.repositoryRoot,
    };
  const target = candidates[0]!;
  if (target.rootKey === scope.projectRootKey) return scope;
  return {
    kind: "project",
    projectRootKey: target.rootKey,
    repositoryRoot: target.rootPath,
    ownerId: target.ownerId,
    generation: target.generation,
  };
}
