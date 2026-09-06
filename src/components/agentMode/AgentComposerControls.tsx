import { memo, useMemo, type ReactNode } from "react";
import { Folder, FolderGit2 } from "lucide-react";
import type { AgentTaskIsolation } from "../../domain/agentTask";
import {
  agentComposerCheckoutChoice,
  agentComposerCheckoutOptions,
  type AgentComposerTarget,
} from "./agentComposerCheckout";
import { AgentPickerMenu } from "./AgentPickerMenu";
import type { AgentPickerOption } from "./agentPickerOption";

const CHECKOUT_ID = "agent-checkout";

export const AgentComposerCheckout = memo(function AgentComposerCheckout({
  disabled,
  isolation,
  onIsolationChange,
  onRefreshIsolation,
  onSelectRepository,
  target,
  worktreeAvailable,
  worktreeOnly,
}: {
  readonly isolation: AgentTaskIsolation;
  readonly disabled: boolean;
  readonly target: AgentComposerTarget | null;
  readonly worktreeAvailable: boolean;
  readonly worktreeOnly: boolean;
  onIsolationChange(isolation: AgentTaskIsolation): void;
  onRefreshIsolation?(): void;
  onSelectRepository(repositoryRoot: string): void;
}) {
  const projectLabel = target?.projectLabel;
  const projectRoot = target?.projectRoot;
  const selectedRepositoryRoot = target?.selectedRepositoryRoot;
  const repositoryOptions = target?.repositoryOptions;
  const searchIdentity = useMemo(
    () => ({
      target:
        projectLabel === undefined ||
        projectRoot === undefined ||
        selectedRepositoryRoot === undefined ||
        repositoryOptions === undefined
          ? null
          : { projectLabel, projectRoot, selectedRepositoryRoot, repositoryOptions },
    }),
    [projectLabel, projectRoot, selectedRepositoryRoot, repositoryOptions],
  );
  const options = useMemo(
    () =>
      worktreeOnly
        ? lockedWorktreeOptions(searchIdentity.target)
        : agentComposerCheckoutOptions(searchIdentity.target, worktreeAvailable),
    [searchIdentity, worktreeOnly, worktreeAvailable],
  );
  const lockedWithoutChoice =
    worktreeOnly && options.length < 2 && onRefreshIsolation === undefined;
  const choose = (value: string): void => {
    const choice = agentComposerCheckoutChoice(value);
    if (choice === null) return;
    if (choice.kind === "root") {
      onSelectRepository(choice.repositoryRoot);
      return;
    }
    if (worktreeOnly) return;
    onIsolationChange(choice.isolation);
  };
  return (
    <AgentPickerMenu
      align="start"
      confirmation={null}
      describedBy={null}
      disabled={disabled || lockedWithoutChoice}
      icon={isolationGlyph(isolation)}
      id={CHECKOUT_ID}
      label="Checkout for this thread"
      menuLayout="checkout"
      searchIdentity={searchIdentity}
      onChange={choose}
      onOpen={onRefreshIsolation}
      options={options}
      prefix={null}
      tone={null}
      value={isolation}
      variant="ghost"
    />
  );
});

function lockedWorktreeOptions(
  target: AgentComposerTarget | null,
): ReadonlyArray<AgentPickerOption> {
  return agentComposerCheckoutOptions(target, true).filter((option) => option.value !== "in-place");
}

export function AgentComposerLockedCheckout({
  isolation,
}: {
  readonly isolation: AgentTaskIsolation;
}) {
  return (
    <span className="agent-composer__lock">
      <span aria-hidden="true" className="agent-composer__lock-glyph">
        {isolationGlyph(isolation)}
      </span>
      <span className="agent-visually-hidden">Checkout:</span>
      {isolationLabel(isolation)}
    </span>
  );
}

function isolationGlyph(isolation: AgentTaskIsolation): ReactNode {
  if (isolation === "worktree") return <FolderGit2 size={12} />;
  return <Folder size={12} />;
}

function isolationLabel(isolation: AgentTaskIsolation): string {
  if (isolation === "worktree") return "Isolated worktree";
  return "Local checkout";
}
