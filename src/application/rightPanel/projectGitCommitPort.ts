import { validateCommitMessage } from "../../domain/commitMessageDraft";
import type { GitChangedFile, GitGateway } from "../../domain/git";
import type { GitSurfaceTarget } from "../../domain/gitSurfaceStatus";
import type {
  GitAmendCandidate,
  GitAmendFile,
  GitAmendFileAction,
  GitWorkingTreeGateway,
} from "../../domain/gitWorkingTree";
import {
  STALE_COMMIT_SELECTION_MESSAGE,
  selectCommitChanges,
  type AgentCommitSelection,
} from "../../domain/gitCommitSelection";

export type AgentGitCommitOutcome =
  | { readonly kind: "committed" }
  | { readonly kind: "amended" }
  | { readonly kind: "amendedIndexStale" }
  | { readonly kind: "pushed" }
  | { readonly kind: "pushFailed"; readonly message: string }
  | { readonly kind: "failed"; readonly message: string };

export type AgentGitAmendAvailability =
  | { readonly kind: "ready"; readonly headSha: string; readonly message: string }
  | { readonly kind: "unavailable"; readonly reason: string };

export interface AgentGitCommitPort {
  commit(message: string, selection: AgentCommitSelection): Promise<AgentGitCommitOutcome>;
  commitAndPush(message: string, selection: AgentCommitSelection): Promise<AgentGitCommitOutcome>;
  amendCandidate(): Promise<AgentGitAmendAvailability>;
  amend(
    expectedHead: string,
    message: string,
    selection: AgentCommitSelection,
  ): Promise<AgentGitCommitOutcome>;
}

export interface AgentGitAmender {
  readonly gateway: Pick<GitWorkingTreeGateway, "getAmendCandidate" | "amendHead">;
  readonly target: GitSurfaceTarget;
}

export const AMEND_FOLDER_ROW_MESSAGE =
  "Nested repositories and folders can't be added to the last commit. Exclude them and try again.";

export const AMEND_UNAVAILABLE_REASONS = Object.freeze({
  noCommit: "There is no commit to amend yet.",
  pushed: "The last commit is already pushed. Amending it would rewrite published history.",
  messageTooLarge: "The last commit message is too long to edit here.",
  operationInProgress:
    "A merge, rebase, cherry-pick or revert is in progress. Finish or abort it before amending.",
  thread: "Amend works on project changes. Agent threads commit through their own ship flow.",
  unsupported: "Amend is unavailable for this repository.",
});

export type ProjectGitCommitGateway = Pick<
  GitGateway,
  "getStatus" | "stageFiles" | "commit" | "push"
>;

export const NOTHING_TO_COMMIT_MESSAGE = "Nothing to commit.";

export function projectGitCommitPort(
  git: ProjectGitCommitGateway,
  rootPath: string,
  amender: AgentGitAmender | null,
): AgentGitCommitPort {
  const commitSelected = async (
    message: string,
    selection: AgentCommitSelection,
  ): Promise<AgentGitCommitOutcome> => {
    const validated = validateCommitMessage(message);
    if (validated.kind === "invalid") return failed(validated.reason);
    try {
      const status = await git.getStatus(rootPath);
      const selected = selectCommitChanges(status.changes, selection);
      if (selected.kind === "empty") return failed(NOTHING_TO_COMMIT_MESSAGE);
      if (selected.kind === "stale") return failed(STALE_COMMIT_SELECTION_MESSAGE);
      const changes = [...selected.changes];
      const unstaged = changes.filter((change) => !change.isStaged);
      if (unstaged.length > 0) await git.stageFiles(rootPath, unstaged);
      await git.commit(rootPath, validated.message, changes);
      return { kind: "committed" };
    } catch (error) {
      return failed(errorMessage(error));
    }
  };
  const amendSelected = async (
    expectedHead: string,
    message: string,
    selection: AgentCommitSelection,
  ): Promise<AgentGitCommitOutcome> => {
    if (amender === null) return failed(AMEND_UNAVAILABLE_REASONS.unsupported);
    const validated = validateCommitMessage(message);
    if (validated.kind === "invalid") return failed(validated.reason);
    try {
      const status = await git.getStatus(rootPath);
      const selected = selectCommitChanges(status.changes, selection);
      if (selected.kind === "stale") return failed(STALE_COMMIT_SELECTION_MESSAGE);
      const changes = selected.kind === "ok" ? selected.changes : [];
      if (changes.some((change) => change.relativePath.endsWith("/"))) {
        return failed(AMEND_FOLDER_ROW_MESSAGE);
      }
      const receipt = await amender.gateway.amendHead({
        ...amender.target,
        expectedHead,
        message: validated.message,
        files: amendFiles(changes),
      });
      return { kind: receipt.indexSynced ? "amended" : "amendedIndexStale" };
    } catch (error) {
      return failed(errorMessage(error));
    }
  };
  return {
    commit: commitSelected,
    amend: amendSelected,
    async amendCandidate() {
      if (amender === null) return unavailable(AMEND_UNAVAILABLE_REASONS.unsupported);
      return amendAvailability(await amender.gateway.getAmendCandidate(amender.target));
    },
    async commitAndPush(message, selection) {
      const committed = await commitSelected(message, selection);
      if (committed.kind !== "committed") return committed;
      try {
        await git.push(rootPath);
        return { kind: "pushed" };
      } catch (error) {
        return { kind: "pushFailed", message: pushFailureMessage(errorMessage(error)) };
      }
    },
  };
}

export function pushFailureMessage(detail: string): string {
  return `Committed, but the push failed: ${detail}`;
}

function amendFiles(changes: ReadonlyArray<GitChangedFile>): ReadonlyArray<GitAmendFile> {
  const actions = new Map<string, GitAmendFileAction>();
  const include = (relativePath: string, action: GitAmendFileAction): void => {
    if (actions.get(relativePath) === "stageWorktree") return;
    actions.set(relativePath, action);
  };
  for (const change of changes) {
    include(change.relativePath, change.status === "deleted" ? "stageDeletion" : "stageWorktree");
    if (change.oldRelativePath !== null) include(change.oldRelativePath, "stageDeletion");
  }
  return [...actions].map(([relativePath, action]) => ({ relativePath, action }));
}

export function amendAvailability(candidate: GitAmendCandidate): AgentGitAmendAvailability {
  switch (candidate.kind) {
    case "ready":
      return { kind: "ready", headSha: candidate.headSha, message: candidate.message };
    case "noCommit":
      return unavailable(AMEND_UNAVAILABLE_REASONS.noCommit);
    case "operationInProgress":
      return unavailable(AMEND_UNAVAILABLE_REASONS.operationInProgress);
    case "pushed":
      return unavailable(AMEND_UNAVAILABLE_REASONS.pushed);
    case "messageTooLarge":
      return unavailable(AMEND_UNAVAILABLE_REASONS.messageTooLarge);
    default: {
      const exhaustive: never = candidate;
      return exhaustive;
    }
  }
}

function unavailable(reason: string): AgentGitAmendAvailability {
  return { kind: "unavailable", reason };
}

function failed(message: string): AgentGitCommitOutcome {
  return { kind: "failed", message };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return "Git reported an error.";
}
