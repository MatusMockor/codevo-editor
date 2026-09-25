import { memo, useMemo, type ReactNode } from "react";
import { Folder, FolderGit2, Server } from "lucide-react";
import type { AgentTaskIsolation } from "../../domain/agentTask";
import {
  agentComposerCheckoutChoice,
  agentComposerRepositoryOptions,
  agentComposerRepositoryValue,
  type AgentComposerTarget,
} from "./agentComposerCheckout";
import { AgentPickerMenu } from "./AgentPickerMenu";
import "./pickers/agentPickers.css";

const REPOSITORY_ID = "agent-repository";

export const AgentRepositoryPicker = memo(function AgentRepositoryPicker({
  disabled,
  onRefreshIsolation,
  onSelectRepository,
  target,
}: {
  readonly disabled: boolean;
  readonly target: AgentComposerTarget | null;
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
    () => agentComposerRepositoryOptions(searchIdentity.target),
    [searchIdentity],
  );
  if (searchIdentity.target === null || options.length === 0) return null;
  const selectedRoot = searchIdentity.target.selectedRepositoryRoot;
  const choose = (value: string): void => {
    const choice = agentComposerCheckoutChoice(value);
    if (choice === null || choice.kind !== "root") return;
    onSelectRepository(choice.repositoryRoot);
  };
  return (
    <AgentPickerMenu
      align="start"
      confirmation={null}
      describedBy={null}
      disabled={disabled}
      icon={
        selectedRoot === searchIdentity.target.projectRoot ? (
          <Folder size={12} />
        ) : (
          <FolderGit2 size={12} />
        )
      }
      id={REPOSITORY_ID}
      label="Repository for this thread"
      menuLayout="checkout"
      searchIdentity={searchIdentity}
      onChange={choose}
      onOpen={onRefreshIsolation}
      options={options}
      prefix={null}
      tone={null}
      value={agentComposerRepositoryValue(selectedRoot)}
      variant="ghost"
    />
  );
});

export function AgentComposerLockedCheckout({
  executionServerName = null,
  isolation,
  remote = false,
}: {
  readonly executionServerName?: string | null;
  readonly isolation: AgentTaskIsolation;
  readonly remote?: boolean;
}) {
  return (
    <span className="agent-composer__lock">
      {executionServerName === null ? null : (
        <>
          <span aria-hidden="true" className="agent-composer__lock-glyph">
            <Server size={12} />
          </span>
          <span className="agent-visually-hidden">Runs on:</span>
          {executionServerName}
          <span aria-hidden="true">·</span>
        </>
      )}
      <span aria-hidden="true" className="agent-composer__lock-glyph">
        {isolationGlyph(isolation)}
      </span>
      <span className="agent-visually-hidden">Checkout:</span>
      {isolationLabel(isolation, remote)}
    </span>
  );
}

function isolationGlyph(isolation: AgentTaskIsolation): ReactNode {
  if (isolation === "worktree") return <FolderGit2 size={12} />;
  return <Folder size={12} />;
}

function isolationLabel(isolation: AgentTaskIsolation, remote: boolean): string {
  if (isolation === "worktree") return "New worktree";
  return remote ? "Server checkout" : "Local checkout";
}
