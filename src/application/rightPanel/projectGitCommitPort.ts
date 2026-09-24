import { validateCommitMessage } from "../../domain/commitMessageDraft";
import type { GitGateway } from "../../domain/git";
import {
  STALE_COMMIT_SELECTION_MESSAGE,
  selectCommitChanges,
  type AgentCommitSelection,
} from "../../domain/gitCommitSelection";

export type AgentGitCommitOutcome =
  | { readonly kind: "committed" }
  | { readonly kind: "pushed" }
  | { readonly kind: "pushFailed"; readonly message: string }
  | { readonly kind: "failed"; readonly message: string };

export interface AgentGitCommitPort {
  commit(message: string, selection: AgentCommitSelection): Promise<AgentGitCommitOutcome>;
  commitAndPush(message: string, selection: AgentCommitSelection): Promise<AgentGitCommitOutcome>;
}

export type ProjectGitCommitGateway = Pick<
  GitGateway,
  "getStatus" | "stageFiles" | "commit" | "push"
>;

export const NOTHING_TO_COMMIT_MESSAGE = "Nothing to commit.";

export function projectGitCommitPort(
  git: ProjectGitCommitGateway,
  rootPath: string,
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
  return {
    commit: commitSelected,
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

function failed(message: string): AgentGitCommitOutcome {
  return { kind: "failed", message };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return "Git reported an error.";
}
