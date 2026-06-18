import type { GitChangeStatus } from "../domain/git";

export function getTreeGitStatusClassName(status: GitChangeStatus): string {
  if (status === "added" || status === "renamed") {
    return "tree-row-status tree-row-status-added";
  }

  if (status === "modified") {
    return "tree-row-status tree-row-status-modified";
  }

  return `tree-row-status tree-row-status-${status}`;
}
