import type { GitBranchChanges, GitBranchDiffGateway } from "../../domain/gitBranchDiff";
import type {
  AgentDiffFile,
  AgentDiffFileList,
  AgentDiffSides,
  AgentDiffSource,
} from "./agentDiffSources";

export interface BranchDiffSourceInput {
  readonly repositoryRoot: string;
  readonly worktreePath: string | null;
  readonly baseRef: string;
  readonly revision: number;
  readonly gateway: GitBranchDiffGateway;
}

interface ListedRange {
  readonly mergeBase: string;
  readonly headCommit: string;
}

const MISSING_SIDES: AgentDiffSides = {
  original: "",
  modified: "",
  truncated: false,
  unavailableReason: "missing",
};

export function branchDiffSource(input: BranchDiffSourceInput): AgentDiffSource {
  let listedRange: ListedRange | null = null;
  const fileRoot = input.worktreePath ?? input.repositoryRoot;
  const identity = JSON.stringify([
    "branch",
    input.repositoryRoot,
    input.worktreePath,
    input.baseRef,
  ]);

  function listedFiles(changes: GitBranchChanges): AgentDiffFileList {
    return {
      files: changes.files.map((file): AgentDiffFile => ({
        repositoryRoot: fileRoot,
        relativePath: file.relativePath,
        displayPath: file.relativePath,
        oldRelativePath: file.oldRelativePath,
        status: file.status,
        added: file.added,
        deleted: file.deleted,
      })),
      truncated: changes.truncated,
      statsPartial: changes.statsTruncated,
      unavailableReason: null,
    };
  }

  return {
    key: JSON.stringify([identity, input.revision]),
    identity,
    async listFiles() {
      try {
        const changes = await input.gateway.getBranchChanges({
          repositoryRoot: input.repositoryRoot,
          worktreePath: input.worktreePath,
          baseRef: input.baseRef,
        });
        listedRange = { mergeBase: changes.mergeBase, headCommit: changes.headCommit };
        return listedFiles(changes);
      } catch (error) {
        return {
          files: [],
          truncated: false,
          statsPartial: false,
          unavailableReason:
            error instanceof Error ? error.message : "Branch changes are unavailable.",
        };
      }
    },
    async readSides(file) {
      if (listedRange === null) {
        return MISSING_SIDES;
      }
      const sides = await input.gateway.getBranchFileSides({
        repositoryRoot: input.repositoryRoot,
        worktreePath: input.worktreePath,
        mergeBase: listedRange.mergeBase,
        headCommit: listedRange.headCommit,
        relativePath: file.relativePath,
        oldRelativePath: file.oldRelativePath,
      });
      return {
        original: sides.original.text,
        modified: sides.modified.text,
        truncated: false,
        unavailableReason: sides.unavailableReason,
      };
    },
  };
}
