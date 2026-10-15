import { agentProjectRootIsRepository, type AgentProjectDescriptor } from "../domain/agentProject";
import { isRemoteFolderProject } from "../domain/remoteProjectKind";
import { localProjectFolderName } from "../domain/remoteProjectCounterpart";
import type { RepositoryIdentityOutcomes } from "./projectRepositoryIdentityDiscovery";
import { remoteAgentProjectKeyParts } from "./remoteAgentProjection";

type Named = Readonly<{ project: AgentProjectDescriptor; scope: string; name: string }>;

const LOCAL_SCOPE = "local";

export function knownRepositoryIdentities(
  outcomes: RepositoryIdentityOutcomes,
): ReadonlyMap<string, string> {
  const identities = new Map<string, string>();
  for (const [rootKey, outcome] of outcomes)
    if (outcome.kind === "identity") identities.set(rootKey, outcome.identity);
  return identities;
}

export function withFolderProjectIdentities(
  projects: readonly AgentProjectDescriptor[],
  outcomes: RepositoryIdentityOutcomes,
  identities: ReadonlyMap<string, string> = knownRepositoryIdentities(outcomes),
): ReadonlyMap<string, string> {
  const named = projects.flatMap(namedProject);
  const unique = uniquelyNamed(named);
  const locals = new Map(
    unique
      .filter((entry) => entry.scope === LOCAL_SCOPE && localFolder(entry.project, outcomes))
      .map((entry) => [entry.name, entry.project.rootKey]),
  );
  if (locals.size === 0) return identities;
  const paired = unique.filter(
    (entry) => entry.scope !== LOCAL_SCOPE && remoteFolder(entry.project) && locals.has(entry.name),
  );
  if (paired.length === 0) return identities;
  const result = new Map(identities);
  for (const remote of paired) {
    const identity = `folder:${remote.name}`;
    result.set(locals.get(remote.name)!, identity);
    result.set(remote.project.rootKey, identity);
  }
  return result;
}

function namedProject(project: AgentProjectDescriptor): readonly Named[] {
  if (!project.rootKey.startsWith("remote:")) {
    const name = localProjectFolderName(project.rootPath);
    return name === null ? [] : [{ project, scope: LOCAL_SCOPE, name }];
  }
  const serverId = remoteAgentProjectKeyParts(project.rootKey)?.serverId;
  if (serverId === undefined) return [];
  return [{ project, scope: `server:${serverId}`, name: project.label }];
}

function uniquelyNamed(entries: readonly Named[]): readonly Named[] {
  const keyOf = (entry: Named) => JSON.stringify([entry.scope, entry.name]);
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(keyOf(entry), (counts.get(keyOf(entry)) ?? 0) + 1);
  return entries.filter((entry) => counts.get(keyOf(entry)) === 1);
}

function localFolder(
  project: AgentProjectDescriptor,
  outcomes: RepositoryIdentityOutcomes,
): boolean {
  if (project.trust !== "trusted" || project.repositoryDiscovery !== "settled") return false;
  if (project.repositoryIdentity || agentProjectRootIsRepository(project)) return false;
  return outcomes.get(project.rootKey)?.kind === "none";
}

function remoteFolder(project: AgentProjectDescriptor): boolean {
  if (project.trust !== "trusted") return false;
  return isRemoteFolderProject({ kind: project.remoteProjectKind });
}
