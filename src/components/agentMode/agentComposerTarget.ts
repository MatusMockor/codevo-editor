import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentProjectOrigin } from "../../domain/agentProject";
import type { AgentComposerRepositoryOption, AgentComposerTarget } from "./agentComposerCheckout";

export interface AgentComposerProjectOption {
  readonly projectRootKey: string;
  readonly ownerId: string;
  readonly generation: number;
  readonly label: string;
  readonly origin: AgentProjectOrigin;
  readonly rootPath: string;
  readonly repositories: ReadonlyArray<AgentComposerRepositoryOption>;
}

export interface ComposerTarget {
  readonly projectRootKey: string;
  readonly repositoryRoot: string;
}

export type ComposerSelection =
  | ({
      readonly kind: "bound";
      readonly ownerId: string;
      readonly generation: number;
    } & ComposerTarget)
  | ({ readonly kind: "missing" } & ComposerTarget);

export type ComposerScope =
  | ({
      readonly kind: "repository";
      readonly ownerId: string;
      readonly generation: number;
    } & ComposerTarget)
  | ({ readonly kind: "missing" } & ComposerTarget);

export function composerProjectOwnsRoot(
  project: AgentComposerProjectOption,
  repositoryRoot: string,
): boolean {
  if (repositoryRoot === project.rootPath) return true;
  return project.repositories.some((candidate) => candidate.repositoryRoot === repositoryRoot);
}

export function resolveComposerTarget(
  projects: ReadonlyArray<AgentComposerProjectOption>,
  selection: ComposerSelection | null,
  selectedThread: AgentThreadView | null,
  scope: ComposerScope | null,
): ComposerTarget | null {
  if (selectedThread !== null) {
    const owner = selectedThread.thread.owner;
    return { projectRootKey: owner.rootKey, repositoryRoot: owner.repositoryRoot };
  }

  if (selection?.kind === "missing") return null;
  if (scope?.kind === "missing") return null;
  if (selection !== null) return findComposerTarget(projects, selection);
  if (scope !== null) return findComposerTarget(projects, scope);

  const project = projects.find((candidate) => candidate.origin === "active-tab") ?? null;
  if (project === null) {
    return null;
  }

  return { projectRootKey: project.projectRootKey, repositoryRoot: project.rootPath };
}

function findComposerTarget(
  projects: ReadonlyArray<AgentComposerProjectOption>,
  preferred: ComposerTarget | ComposerSelection,
): ComposerTarget | null {
  const project =
    projects.find((candidate) => candidate.projectRootKey === preferred.projectRootKey) ?? null;
  if (project === null) return null;
  if ("kind" in preferred && preferred.kind === "missing") return null;
  if ("ownerId" in preferred && project.ownerId !== preferred.ownerId) return null;
  if ("generation" in preferred && project.generation !== preferred.generation) return null;
  if (!composerProjectOwnsRoot(project, preferred.repositoryRoot)) return null;
  return { projectRootKey: project.projectRootKey, repositoryRoot: preferred.repositoryRoot };
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
    projectRoot: project.rootPath,
    repositoryOptions: project.repositories,
    selectedRepositoryRoot: target.repositoryRoot,
  };
}

export function composerTargetLabel(
  projects: ReadonlyArray<AgentComposerProjectOption>,
  target: ComposerTarget | null,
): string | null {
  if (target === null) return null;
  const project = projects.find((candidate) => candidate.projectRootKey === target.projectRootKey);
  if (project === undefined) return null;
  if (target.repositoryRoot === project.rootPath) return project.label;
  return (
    project.repositories.find((candidate) => candidate.repositoryRoot === target.repositoryRoot)
      ?.label ?? null
  );
}
