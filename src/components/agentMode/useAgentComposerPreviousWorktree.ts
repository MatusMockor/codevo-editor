import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import type { AgentThreadView, AgentThreadWorktreeReuse } from "../../application/agentThreadPorts";
import {
  MAX_PREVIOUS_WORKTREE_CANDIDATES,
  resolveAgentPreviousWorktreeSeed,
  resolveAgentWorktreeUser,
  type AgentPreviousWorktreeCandidate,
  type AgentPreviousWorktreeSeed,
  type AgentPreviousWorktreeState,
} from "../../domain/agentPreviousWorktree";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import type { AgentComposerPreviousWorktreeChoice } from "./agentComposerPreviousWorktree";
import { agentShipBranchLabel } from "./agentModePresentation";

export interface AgentComposerPreviousWorktreeScope {
  readonly project: AgentProjectDescriptor;
  readonly repositoryRoot: string;
}

export interface AgentComposerPreviousWorktreeState {
  readonly choice: AgentComposerPreviousWorktreeChoice | null;
  readonly reuse: AgentThreadWorktreeReuse | null;
  clear(): void;
}

interface PreviousWorktreeSelection {
  readonly scopeKey: string;
  readonly worktreePath: string;
}

const NO_THREADS: ReadonlyArray<AgentThreadView> = [];

export function useAgentComposerPreviousWorktree(
  threads: ReadonlyArray<AgentThreadView> | undefined,
  scope: AgentComposerPreviousWorktreeScope | null,
  onSelected: () => void,
): AgentComposerPreviousWorktreeState {
  const views = threads ?? NO_THREADS;
  const project = scope?.project ?? null;
  const repositoryRoot = scope?.repositoryRoot ?? null;
  const scopeKey = previousWorktreeScopeKey(project, repositoryRoot);
  const candidates = useMemo(
    () =>
      project === null || repositoryRoot === null
        ? null
        : views.slice(0, MAX_PREVIOUS_WORKTREE_CANDIDATES).map(previousWorktreeCandidate),
    [project, repositoryRoot, views],
  );
  const [selection, setSelection] = useState<PreviousWorktreeSelection | null>(null);
  const selectedPath =
    selection !== null && selection.scopeKey === scopeKey ? selection.worktreePath : null;
  const seed = useStableSeed(
    project === null || repositoryRoot === null || candidates === null
      ? null
      : resolveAgentPreviousWorktreeSeed({ project, repositoryRoot }, candidates),
  );
  const selectedUser = useStableSeed(
    project === null || repositoryRoot === null || candidates === null || selectedPath === null
      ? null
      : resolveAgentWorktreeUser({ project, repositoryRoot }, candidates, selectedPath),
  );
  const selectedUserPath = selectedUser?.worktreePath ?? null;
  useLayoutEffect(() => {
    setSelection((current) =>
      current !== null && current.scopeKey === scopeKey && current.worktreePath === selectedUserPath
        ? current
        : null,
    );
  }, [scopeKey, selectedUserPath]);
  const shown = selectedUser ?? seed;
  const shownPath = shown?.worktreePath ?? null;
  const select = useCallback(() => {
    if (scopeKey === null || shownPath === null) return;
    setSelection({ scopeKey, worktreePath: shownPath });
    onSelected();
  }, [onSelected, scopeKey, shownPath]);
  const clear = useCallback(() => setSelection(null), []);
  const selected = selectedUser !== null;
  const choice = useMemo<AgentComposerPreviousWorktreeChoice | null>(
    () => (shown === null ? null : { available: shown, selected, onSelect: select }),
    [select, selected, shown],
  );
  const reuse = useMemo<AgentThreadWorktreeReuse | null>(
    () => (selectedUserPath === null ? null : { worktreePath: selectedUserPath }),
    [selectedUserPath],
  );
  return { choice, reuse, clear };
}

function useStableSeed(
  resolved: AgentPreviousWorktreeSeed | null,
): AgentPreviousWorktreeSeed | null {
  const threadId = resolved?.threadId ?? null;
  const worktreePath = resolved?.worktreePath ?? null;
  const branch = resolved?.branch ?? null;
  return useMemo(
    () => (threadId === null || worktreePath === null ? null : { threadId, worktreePath, branch }),
    [branch, threadId, worktreePath],
  );
}

function previousWorktreeScopeKey(
  project: AgentProjectDescriptor | null,
  repositoryRoot: string | null,
): string | null {
  if (project === null || repositoryRoot === null) return null;
  return JSON.stringify([
    project.rootKey,
    project.ownerId,
    project.generation,
    project.runtimeOwnerIds ?? [],
    repositoryRoot,
  ]);
}

function previousWorktreeCandidate(view: AgentThreadView): AgentPreviousWorktreeCandidate {
  return {
    threadId: view.thread.threadId,
    owner: view.thread.owner,
    placement: view.execution === undefined ? "local" : "remote",
    isolation: view.thread.target.isolation,
    worktreePath: view.thread.target.worktreePath,
    archived: view.thread.archived,
    worktreeState: previousWorktreeState(view),
    updatedAtEpochMs: view.thread.updatedAtEpochMs,
    branch: agentShipBranchLabel(view.ship),
  };
}

function previousWorktreeState(view: AgentThreadView): AgentPreviousWorktreeState {
  if (view.worktreeRemoved || view.ship.kind === "worktreeRemoved") return "removed";
  if (view.worktreeMissing) return "missing";
  if (view.ship.kind === "removingWorktree" || view.changeSummary?.removing === true) {
    return "removing";
  }
  return "present";
}
