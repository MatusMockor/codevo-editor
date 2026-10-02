import type { AgentProjectDescriptor } from "../../domain/agentProject";

export function agentProjectWorkspaceTabRoot(
  projects: ReadonlyArray<AgentProjectDescriptor>,
  projectRootKey: string,
  memberProjectRootKeys: ReadonlyArray<string> = [],
): string | null {
  const keys = new Set([projectRootKey, ...memberProjectRootKeys]);
  const members = projects.filter((candidate) => keys.has(candidate.rootKey));
  if (members.some((member) => member.origin === "active-tab")) return null;
  const project = members.find((member) => member.rootKey === projectRootKey);
  if (project === undefined || project.origin !== "background-tab") return null;
  if (project.rootKey.startsWith("remote:")) return null;
  return project.rootPath;
}
