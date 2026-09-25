import { Folder, FolderGit2 } from "lucide-react";
import type { AgentTaskIsolation } from "../../domain/agentTask";
import { agentPickerOption, type AgentPickerOption } from "./agentPickerOption";

const RUN_IN_REPOSITORY_GROUP = "Run in repository";
const RUN_IN_ROOT_PREFIX = "root:";

export interface AgentComposerRepositoryOption {
  readonly repositoryRoot: string;
  readonly label: string;
}

export interface AgentComposerTarget {
  readonly projectLabel: string;
  readonly projectRoot: string;
  readonly repositoryOptions: ReadonlyArray<AgentComposerRepositoryOption>;
  readonly selectedRepositoryRoot: string;
}

export type AgentComposerCheckoutChoice =
  | { readonly kind: "isolation"; readonly isolation: AgentTaskIsolation }
  | { readonly kind: "root"; readonly repositoryRoot: string };

export function agentComposerRepositoryOptions(
  target: AgentComposerTarget | null,
): ReadonlyArray<AgentPickerOption> {
  if (target === null || target.repositoryOptions.length === 0) return [];
  const rootOption = (repositoryRoot: string, label: string, description: string | null) =>
    agentPickerOption(
      agentComposerRepositoryValue(repositoryRoot),
      label,
      description,
      null,
      null,
      repositoryRoot === target.projectRoot ? <Folder size={15} /> : <FolderGit2 size={15} />,
      RUN_IN_REPOSITORY_GROUP,
      repositoryRoot === target.selectedRepositoryRoot,
    );
  return [
    rootOption(target.projectRoot, target.projectLabel, "Project folder"),
    ...target.repositoryOptions.map((repository) =>
      rootOption(repository.repositoryRoot, repository.label, null),
    ),
  ];
}

export function agentComposerRepositoryValue(repositoryRoot: string): string {
  return `${RUN_IN_ROOT_PREFIX}${repositoryRoot}`;
}

export function agentComposerCheckoutChoice(value: string): AgentComposerCheckoutChoice | null {
  if (value === "in-place" || value === "worktree") return { kind: "isolation", isolation: value };
  if (!value.startsWith(RUN_IN_ROOT_PREFIX)) return null;
  const repositoryRoot = value.slice(RUN_IN_ROOT_PREFIX.length);
  if (repositoryRoot === "") return null;
  return { kind: "root", repositoryRoot };
}
