import type { AgentProjectDescriptor } from "../../domain/agentProject";
import {
  DEFAULT_AGENT_PROJECT_GROUPING_SETTINGS,
  resolveGroupingMode,
  unsupportedAgentProjectGroupingMode,
  type AgentProjectGroupingMode,
  type AgentProjectGroupingSettings,
} from "../../domain/agentProjectGrouping";
import type { AgentProjectGroup } from "./agentModePresentation";
import type { ComposerScope } from "./agentComposerTarget";

const NO_REPOSITORY_IDENTITIES: ReadonlyMap<string, string> = new Map();
const NO_LINKS: ReadonlyMap<string, string> = new Map();

/** Display membership only: never rewrites a thread's execution owner or repository. */
export function groupedEnvironmentProjects(
  groups: readonly AgentProjectGroup[],
  projects: readonly AgentProjectDescriptor[],
  links: ReadonlyMap<string, string>,
  repositoryIdentities: ReadonlyMap<string, string> = new Map(),
  grouping: AgentProjectGroupingSettings = DEFAULT_AGENT_PROJECT_GROUPING_SETTINGS,
): readonly AgentProjectGroup[] {
  // Explicit connections override automatic identity for their remote member. This
  // preserves an intentional association even if that checkout uses a fork remote.
  const projectByKey = new Map(projects.map((project) => [project.rootKey, project]));
  const groupByKey = new Map(groups.map((group) => [group.projectRootKey, group]));
  const identities = new Map<string, string>();
  for (const project of projects) {
    const identity = repositoryIdentityOf(project, repositoryIdentities);
    if (identity !== null) identities.set(project.rootKey, identity);
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
    const key = bucketKey(root, identities.get(root), resolveGroupingMode(root, grouping));
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

function bucketKey(
  root: string,
  identity: string | undefined,
  mode: AgentProjectGroupingMode,
): string {
  switch (mode) {
    case "repository":
      return identity ? `repository:${identity}` : `physical:${root}`;
    case "separate":
      return `physical:${root}`;
    default:
      return unsupportedAgentProjectGroupingMode(mode);
  }
}

function repositoryIdentityOf(
  project: AgentProjectDescriptor,
  repositoryIdentities: ReadonlyMap<string, string>,
): string | null {
  const identity = repositoryIdentities.get(project.rootKey) ?? project.repositoryIdentity;
  return identity ? identity : null;
}

export function projectRunsOn(rootKey: string, serverId: string | null): boolean {
  if (serverId === null) return !rootKey.startsWith("remote:");
  return rootKey.startsWith(`remote:${encodeURIComponent(serverId)}:`);
}

function acceptsDraft(project: AgentProjectDescriptor): boolean {
  return project.trust === "trusted" && project.origin !== "closed-tab-live-tasks";
}

function linkedToAnotherProject(
  project: AgentProjectDescriptor,
  members: readonly string[],
  projects: readonly AgentProjectDescriptor[],
  links: ReadonlyMap<string, string>,
): boolean {
  if (!project.rootKey.startsWith("remote:")) return false;
  const localRoot = links.get(project.rootKey);
  if (localRoot === undefined || localRoot.startsWith("remote:")) return false;
  if (members.includes(localRoot)) return false;
  return projects.some((candidate) => candidate.rootKey === localRoot);
}

function repositoryCounterparts(
  source: AgentProjectDescriptor | undefined,
  members: readonly string[],
  projects: readonly AgentProjectDescriptor[],
  reachable: readonly AgentProjectDescriptor[],
  repositoryIdentities: ReadonlyMap<string, string>,
  links: ReadonlyMap<string, string>,
): readonly AgentProjectDescriptor[] {
  if (source === undefined) return [];
  const identity = repositoryIdentityOf(source, repositoryIdentities);
  if (identity === null) return [];
  return reachable.filter(
    (project) =>
      acceptsDraft(project) &&
      repositoryIdentityOf(project, repositoryIdentities) === identity &&
      !linkedToAnotherProject(project, members, projects, links),
  );
}

/**
 * Resolve an exact member of the displayed project, or the only checkout of the scoped
 * project's repository that accepts a draft when none of its members runs there and no
 * explicit connection binds that checkout to another project, never an arbitrary project
 * on a server.
 */
export function environmentComposerScope(
  scope: ComposerScope | null,
  groups: readonly AgentProjectGroup[],
  projects: readonly AgentProjectDescriptor[],
  serverId: string | null,
  repositoryIdentities: ReadonlyMap<string, string> = NO_REPOSITORY_IDENTITIES,
  links: ReadonlyMap<string, string> = NO_LINKS,
): ComposerScope | null {
  if (scope === null || scope.kind === "missing") return scope;
  const selected = projects.find((project) => project.rootKey === scope.projectRootKey);
  // An explicit physical project selection is already an exact destination, even
  // when the display group contains multiple linked projects on this server.
  if (scope.kind === "repository") {
    if (
      projectRunsOn(scope.projectRootKey, serverId) &&
      selected?.ownerId === scope.ownerId &&
      selected.generation === scope.generation
    )
      return scope;
  }

  const candidates = environmentCandidates(
    scope.projectRootKey,
    groups,
    projects,
    serverId,
    repositoryIdentities,
    links,
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

function environmentCandidates(
  projectRootKey: string,
  groups: readonly AgentProjectGroup[],
  projects: readonly AgentProjectDescriptor[],
  serverId: string | null,
  repositoryIdentities: ReadonlyMap<string, string>,
  links: ReadonlyMap<string, string>,
): readonly AgentProjectDescriptor[] {
  const selected = projects.find((project) => project.rootKey === projectRootKey);
  const group = groups.find(
    (candidate) =>
      candidate.projectRootKey === projectRootKey ||
      candidate.memberProjectRootKeys?.includes(projectRootKey),
  );
  const members = group?.memberProjectRootKeys ?? [projectRootKey];
  const reachable = projects.filter((project) => projectRunsOn(project.rootKey, serverId));
  const displayed = reachable.filter((project) => members.includes(project.rootKey));
  if (displayed.length > 0) return displayed;
  return repositoryCounterparts(
    selected,
    members,
    projects,
    reachable,
    repositoryIdentities,
    links,
  );
}

export function missingServerCounterpart(
  scope: ComposerScope | null,
  groups: readonly AgentProjectGroup[],
  projects: readonly AgentProjectDescriptor[],
  serverId: string | null,
  repositoryIdentities: ReadonlyMap<string, string> = NO_REPOSITORY_IDENTITIES,
  links: ReadonlyMap<string, string> = NO_LINKS,
): AgentProjectDescriptor | null {
  if (serverId === null || scope === null || scope.kind === "missing") return null;
  const source = projects.find((project) => project.rootKey === scope.projectRootKey);
  if (source === undefined || !acceptsDraft(source) || !projectRunsOn(source.rootKey, null))
    return null;
  const candidates = environmentCandidates(
    source.rootKey,
    groups,
    projects,
    serverId,
    repositoryIdentities,
    links,
  );
  if (candidates.length > 0) return null;
  const namesake = projects.some(
    (project) =>
      projectRunsOn(project.rootKey, serverId) &&
      acceptsDraft(project) &&
      project.label === source.label,
  );
  if (namesake) return null;
  return source;
}

/** New-thread commands retain the selected environment for a linked display project. */
export function newThreadEnvironmentProjectRootKey(
  projectRootKey: string | null,
  groups: readonly AgentProjectGroup[],
  projects: readonly AgentProjectDescriptor[],
  serverId: string | null,
  selectedScope: ComposerScope | null = null,
): string | null {
  if (projectRootKey === null) return null;
  const group = groups.find((candidate) => candidate.projectRootKey === projectRootKey);
  // Unlinked project commands select that project's environment before creating a draft.
  if (group?.memberProjectRootKeys === undefined) return projectRootKey;
  const project = projects.find((candidate) => candidate.rootKey === projectRootKey);
  if (project === undefined) return null;
  const requestedScope: ComposerScope =
    selectedScope !== null && group.memberProjectRootKeys.includes(selectedScope.projectRootKey)
      ? selectedScope
      : {
          kind: "project",
          projectRootKey,
          repositoryRoot: project.rootPath,
          ownerId: project.ownerId,
          generation: project.generation,
        };
  const scope = environmentComposerScope(requestedScope, groups, projects, serverId);
  return scope?.kind === "missing" ? null : (scope?.projectRootKey ?? null);
}
