import type { AgentProjectDescriptor } from "../domain/agentProject";
import { isRemoteFolderProject } from "../domain/remoteProjectKind";

const isRemoteKey = (rootKey: string): boolean => rootKey.startsWith("remote:");
const isFolderProject = (project: AgentProjectDescriptor): boolean =>
  isRemoteKey(project.rootKey) && isRemoteFolderProject({ kind: project.remoteProjectKind });

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
  return projects.filter(
    (project) => !isFolderProject(project) && !explicitlyLinked(project.rootKey),
  );
}
