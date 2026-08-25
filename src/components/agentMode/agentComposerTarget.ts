import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentProjectOrigin } from "../../domain/agentProject";
import type { AgentComposerRepositoryOption, AgentComposerTarget } from "./AgentComposer";
import type { AgentRailScope } from "./agentSidebarPresentation";

export interface AgentComposerProjectOption {
  readonly projectRootKey: string;
  readonly label: string;
  readonly origin: AgentProjectOrigin;
  readonly repositories: ReadonlyArray<AgentComposerRepositoryOption>;
}

export interface ComposerTarget {
  readonly projectRootKey: string;
  readonly repositoryRoot: string;
}

export function resolveComposerTarget(
  projects: ReadonlyArray<AgentComposerProjectOption>,
  selection: ComposerTarget | null,
  selectedThread: AgentThreadView | null,
  scope: AgentRailScope,
): ComposerTarget | null {
  if (selectedThread !== null) {
    const owner = selectedThread.thread.owner;
    return { projectRootKey: owner.rootKey, repositoryRoot: owner.repositoryRoot };
  }

  const preferred = selection ?? (scope.kind === "repository" ? scope : null);
  const project =
    projects.find((candidate) => candidate.projectRootKey === preferred?.projectRootKey) ??
    projects.find((candidate) => candidate.origin === "active-tab") ??
    null;
  if (project === null) {
    return null;
  }

  const repository =
    project.repositories.find(
      (candidate) => candidate.repositoryRoot === preferred?.repositoryRoot,
    ) ??
    project.repositories[0] ??
    null;
  if (repository === null) {
    return null;
  }

  return { projectRootKey: project.projectRootKey, repositoryRoot: repository.repositoryRoot };
}

export function composerTargetView(
  projects: ReadonlyArray<AgentComposerProjectOption>,
  target: ComposerTarget | null,
): AgentComposerTarget | null {
  if (target === null) return null;
  const project = projects.find((candidate) => candidate.projectRootKey === target.projectRootKey);
  if (project === undefined) return null;
  return {
    projectLabel: project.label,
    repositoryOptions: project.repositories,
    selectedRepositoryRoot: target.repositoryRoot,
  };
}
