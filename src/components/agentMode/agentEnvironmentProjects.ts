import type { AgentProjectDescriptor } from "../../domain/agentProject";
import type { AgentProjectGroup } from "./agentModePresentation";
import type { ComposerScope } from "./agentComposerTarget";

/** Display membership only: never rewrites a thread's execution owner or repository. */
export function groupedEnvironmentProjects(
  groups: readonly AgentProjectGroup[],
  projects: readonly AgentProjectDescriptor[],
  links: ReadonlyMap<string, string>,
  repositoryIdentities: ReadonlyMap<string, string> = new Map(),
): readonly AgentProjectGroup[] {
  // Explicit connections override automatic identity for their remote member. This
  // preserves an intentional association even if that checkout uses a fork remote.
  const projectByKey = new Map(projects.map((project) => [project.rootKey, project]));
  const groupByKey = new Map(groups.map((group) => [group.projectRootKey, group]));
  const identities = new Map<string, string>();
  for (const project of projects) {
    const identity = repositoryIdentities.get(project.rootKey) ?? project.repositoryIdentity;
    if (identity) identities.set(project.rootKey, identity);
  }
  const explicit = new Map<string, string>();
  for (const [remoteKey, localRoot] of links) {
    if (
      remoteKey.startsWith("remote:") &&
      !localRoot.startsWith("remote:") &&
      projectByKey.has(localRoot) &&
      groupByKey.has(remoteKey) &&
      groupByKey.has(localRoot)
    )
      explicit.set(remoteKey, localRoot);
  }
  const buckets = new Map<string, AgentProjectGroup[]>();
  for (const group of groups) {
    const root = explicit.get(group.projectRootKey) ?? group.projectRootKey;
    const identity = identities.get(root);
    const key = identity ? `repository:${identity}` : `physical:${root}`;
    const members = buckets.get(key) ?? [];
    members.push(group);
    buckets.set(key, members);
  }
  return [...buckets.values()].map((members) => {
    if (members.length === 1) return members[0]!;
    // Prefer a local representative so discovery order cannot hide local actions.
    const representative =
      members.find((member) => !member.projectRootKey.startsWith("remote:")) ?? members[0]!;
    return {
      ...representative,
      memberProjectRootKeys: members.map((member) => member.projectRootKey),
      repos: members.flatMap((member) => member.repos),
      liveCount: members.reduce((sum, member) => sum + member.liveCount, 0),
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
  // An explicit physical project selection is already an exact destination, even
  // when the display group contains multiple linked projects on this server.
  if (scope.kind === "repository") {
    const selected = projects.find((project) => project.rootKey === scope.projectRootKey);
    const prefix = serverId === null ? null : `remote:${encodeURIComponent(serverId)}:`;
    const sameEnvironment =
      prefix === null
        ? !scope.projectRootKey.startsWith("remote:")
        : scope.projectRootKey.startsWith(prefix);
    if (
      sameEnvironment &&
      selected?.ownerId === scope.ownerId &&
      selected.generation === scope.generation
    )
      return scope;
  }

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
