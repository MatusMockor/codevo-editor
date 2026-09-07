import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import { isInsideAgentSurfaceRoot } from "../../application/useAgentSurfaceFileTree";
import type { AgentGitHistoryScope } from "./agentGitHistoryTarget";
import type { AgentSurfaceScope } from "./agentSurfacePolicy";

export interface AgentHistoryRepository {
  readonly value: string;
  readonly label: string;
  readonly description: string;
  readonly scope: AgentGitHistoryScope;
}

export interface AgentHistoryRepositories {
  readonly identity: string;
  readonly projectLabel: string;
  readonly options: ReadonlyArray<AgentHistoryRepository>;
  readonly defaultValue: string;
}

export function agentHistoryRepositories(
  projects: ReadonlyArray<AgentProjectDescriptor>,
  thread: AgentThreadView | null,
  surface: AgentSurfaceScope,
  scope: AgentGitHistoryScope,
): AgentHistoryRepositories | null {
  if (scope.kind !== "available") return null;
  const rootKey =
    thread?.thread.owner.rootKey ?? (surface.kind === "repository" ? surface.projectRootKey : null);
  const project = projects.find((candidate) => candidate.rootKey === rootKey);
  if (project === undefined) return null;
  const roots = [
    ...new Set(project.repositories.map((repository) => repository.repositoryRoot)),
  ].filter((root) => isInsideAgentSurfaceRoot(project.rootPath, root));
  if (roots.length === 0) return null;
  const options: AgentHistoryRepository[] = [];
  if (thread !== null)
    options.push({
      value: "root:checkout",
      label: "Thread checkout",
      description: scope.target.rootPath,
      scope,
    });
  if (thread === null)
    options.push({
      value: "root:choose",
      label: "Choose a repository",
      description: project.label,
      scope: {
        kind: "unavailable",
        reason: "Choose a repository to browse its commits and changed files.",
      },
    });
  for (const root of roots) {
    options.push({
      value: `root:${root}`,
      label: root.split("/").filter(Boolean).slice(-1)[0] ?? project.label,
      description:
        root === project.rootPath
          ? "Project root"
          : root.slice(project.rootPath.replace(/\/$/, "").length + 1),
      scope: { kind: "available", target: { rootPath: root, ownerKey: scope.target.ownerKey } },
    });
  }
  const defaultValue =
    thread !== null
      ? "root:checkout"
      : roots.includes(project.rootPath)
        ? `root:${project.rootPath}`
        : roots.length === 1
          ? `root:${roots[0]}`
          : "root:choose";
  return {
    identity: JSON.stringify([scope.target.ownerKey, roots]),
    projectLabel: project.label,
    options,
    defaultValue,
  };
}
