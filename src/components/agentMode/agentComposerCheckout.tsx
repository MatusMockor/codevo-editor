import { Folder, FolderGit2, GitBranch, Monitor } from "lucide-react";
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

export function agentComposerCheckoutOptions(
  target: AgentComposerTarget | null,
  worktreeAvailable: boolean,
): ReadonlyArray<AgentPickerOption> {
  const selectedLabel = agentComposerSelectedLabel(target);
  const options: AgentPickerOption[] = [
    agentPickerOption(
      "in-place",
      "Local checkout",
      selectedLabel === null ? "Runs in the project's own checkout." : `Runs in ${selectedLabel}.`,
      null,
      null,
      <Monitor size={15} />,
    ),
  ];
  if (worktreeAvailable) {
    options.push(
      agentPickerOption(
        "worktree",
        "Isolated worktree",
        selectedLabel === null
          ? "Runs in a new git worktree."
          : `Runs in a new git worktree of ${selectedLabel}.`,
        null,
        null,
        <GitBranch size={15} />,
      ),
    );
  }
  if (target === null || target.repositoryOptions.length === 0) return options;
  const rootOption = (repositoryRoot: string, label: string, description: string | null) =>
    agentPickerOption(
      `${RUN_IN_ROOT_PREFIX}${repositoryRoot}`,
      label,
      description,
      null,
      null,
      repositoryRoot === target.projectRoot ? <Folder size={15} /> : <FolderGit2 size={15} />,
      RUN_IN_REPOSITORY_GROUP,
      repositoryRoot === target.selectedRepositoryRoot,
    );
  options.push(rootOption(target.projectRoot, target.projectLabel, "Project folder"));
  for (const repository of target.repositoryOptions) {
    options.push(rootOption(repository.repositoryRoot, repository.label, null));
  }
  return options;
}

export function agentComposerCheckoutChoice(value: string): AgentComposerCheckoutChoice | null {
  if (value === "in-place" || value === "worktree") return { kind: "isolation", isolation: value };
  if (!value.startsWith(RUN_IN_ROOT_PREFIX)) return null;
  const repositoryRoot = value.slice(RUN_IN_ROOT_PREFIX.length);
  if (repositoryRoot === "") return null;
  return { kind: "root", repositoryRoot };
}

export function agentComposerSelectedLabel(target: AgentComposerTarget | null): string | null {
  if (target === null) return null;
  if (target.selectedRepositoryRoot === target.projectRoot) return target.projectLabel;
  return (
    target.repositoryOptions.find(
      (option) => option.repositoryRoot === target.selectedRepositoryRoot,
    )?.label ?? null
  );
}

export function agentComposerNestedTargetLabel(target: AgentComposerTarget | null): string | null {
  if (target === null) return null;
  if (target.selectedRepositoryRoot === target.projectRoot) return null;
  return agentComposerSelectedLabel(target);
}
