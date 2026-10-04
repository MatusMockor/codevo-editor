import type { AgentProjectDescriptor } from "../domain/agentProject";

const isRemoteKey = (rootKey: string): boolean => rootKey.startsWith("remote:");

export function repositoryIdentityCandidates(
  projects: readonly AgentProjectDescriptor[],
  links: ReadonlyMap<string, string>,
): readonly AgentProjectDescriptor[] {
  const localRoots = new Set(
    projects.map((project) => project.rootKey).filter((rootKey) => !isRemoteKey(rootKey)),
  );
  const explicitlyLinked = (rootKey: string): boolean => {
    if (!isRemoteKey(rootKey)) return false;
    const localRoot = links.get(rootKey);
    return localRoot !== undefined && localRoots.has(localRoot);
  };
  return projects.filter((project) => !explicitlyLinked(project.rootKey));
}
