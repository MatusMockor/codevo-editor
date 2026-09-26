import type { AgentGitDiscardPending } from "../../../../application/rightPanel/useAgentGitDiscard";
import type { GitDiscardBlock } from "../../../../domain/gitWorkingTree";

export const AMEND_CHECKING_TEXT = "Checking the last commit…";
export const DISCARD_BLOCKED_REASONS: Readonly<Record<GitDiscardBlock, string>> = {
  conflicted: "Resolve the conflict before discarding this file.",
  nestedRepository: "Nested repositories can't be discarded here.",
};
export const AMEND_MESSAGE_ONLY_HINT =
  "Only the message changes. Include files to add them to the commit.";

export interface AgentGitDiscardCopy {
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
}

export function relativeAge(epochSeconds: number, nowMs: number): string {
  const seconds = Math.max(0, Math.round(nowMs / 1000 - epochSeconds));
  if (seconds < 60) return "now";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

export function discardCopy(pending: AgentGitDiscardPending): AgentGitDiscardCopy {
  const path = `“${pending.relativePath}”`;
  switch (pending.effect) {
    case "delete":
      return pending.status === "untracked"
        ? {
            title: "Delete untracked file?",
            description: `${path} is not tracked by Git and will be deleted from disk. This cannot be undone.`,
            confirmLabel: "Delete file",
          }
        : {
            title: "Delete new file?",
            description: `${path} is removed from the index and deleted from disk. This cannot be undone.`,
            confirmLabel: "Delete file",
          };
    case "restore":
      return {
        title: "Discard changes?",
        description: `All changes to ${path} are discarded and the file is restored to the last commit. This cannot be undone.`,
        confirmLabel: "Discard changes",
      };
    case "restoreRename":
      return {
        title: "Discard changes?",
        description: `${path} is removed and “${pending.oldRelativePath ?? ""}” is restored to the last commit. This cannot be undone.`,
        confirmLabel: "Discard changes",
      };
    default: {
      const exhaustive: never = pending.effect;
      return exhaustive;
    }
  }
}
