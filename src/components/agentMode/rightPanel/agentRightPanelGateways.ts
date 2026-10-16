import type { DiffViewComputationGateway } from "../../../application/diffViewComputation";
import type { GitGateway, GitStatus } from "../../../domain/git";
import type { GitBranchDiffGateway } from "../../../domain/gitBranchDiff";
import type { GitSurfaceStatusGateway } from "../../../domain/gitSurfaceStatus";
import type { GitWorkingTreeGateway } from "../../../domain/gitWorkingTree";
import type { BranchWorktreeReceipt, BranchWorktreeRequest } from "../../../domain/gitWorktree";
import type { PullRequestGateway } from "../../../domain/pullRequest";
import type { FileSearchGateway } from "../../../domain/workspace";
import type { ForgeUrlOpener } from "../../../infrastructure/tauriPullRequestGateway";

export interface AgentRightPanelGateways {
  readonly git: Pick<
    GitGateway,
    "getStatus" | "getDiff" | "stageFiles" | "commit" | "push" | "createBranch" | "switchBranch"
  > & { fetch(rootPath: string): Promise<GitStatus> };
  readonly surfaceStatus: GitSurfaceStatusGateway;
  readonly workingTree: GitWorkingTreeGateway;
  readonly branchDiff: GitBranchDiffGateway;
  readonly diffComputation: DiffViewComputationGateway;
  readonly fileSearch: FileSearchGateway;
  readonly pullRequest: PullRequestGateway;
  readonly worktrees: {
    addBranchWorktree(request: BranchWorktreeRequest): Promise<BranchWorktreeReceipt>;
  };
  readonly externalUrl: ForgeUrlOpener;
}

export const UNAVAILABLE_AGENT_FILE_SEARCH: FileSearchGateway = Object.freeze({
  searchFiles: () => Promise.reject(new Error("File search is unavailable.")),
});
