import type { DiffViewComputationGateway } from "../../../application/diffViewComputation";
import type { GitGateway, GitStatus } from "../../../domain/git";
import type { GitBranchDiffGateway } from "../../../domain/gitBranchDiff";
import type { GitSurfaceStatusGateway } from "../../../domain/gitSurfaceStatus";
import type { BranchWorktreeReceipt, BranchWorktreeRequest } from "../../../domain/gitWorktree";
import type { PullRequestGateway } from "../../../domain/pullRequest";
import type { FileSearchGateway } from "../../../domain/workspace";
import { BrowserDiffViewGateway } from "../../../infrastructure/browserDiffViewGateway";
import { TauriGitGateway } from "../../../infrastructure/tauriGitGateway";
import { TauriGitSurfaceGateway } from "../../../infrastructure/tauriGitSurfaceGateway";
import { TauriGitWorktreeGateway } from "../../../infrastructure/tauriGitWorktreeGateway";
import {
  TauriForgeUrlOpener,
  TauriPullRequestGateway,
  type ForgeUrlOpener,
} from "../../../infrastructure/tauriPullRequestGateway";

export interface AgentRightPanelGateways {
  readonly git: Pick<
    GitGateway,
    "getStatus" | "getDiff" | "stageFiles" | "commit" | "push" | "createBranch" | "switchBranch"
  > & { fetch(rootPath: string): Promise<GitStatus> };
  readonly surfaceStatus: GitSurfaceStatusGateway;
  readonly branchDiff: GitBranchDiffGateway;
  readonly diffComputation: DiffViewComputationGateway;
  readonly fileSearch: FileSearchGateway;
  readonly pullRequest: PullRequestGateway;
  readonly worktrees: {
    addBranchWorktree(request: BranchWorktreeRequest): Promise<BranchWorktreeReceipt>;
  };
  readonly externalUrl: ForgeUrlOpener;
}

export function createDefaultAgentRightPanelGateways(
  fileSearch: FileSearchGateway,
): AgentRightPanelGateways {
  const surface = new TauriGitSurfaceGateway();
  return {
    git: new TauriGitGateway(),
    surfaceStatus: surface,
    branchDiff: surface,
    diffComputation: new BrowserDiffViewGateway(),
    fileSearch,
    pullRequest: new TauriPullRequestGateway(),
    worktrees: new TauriGitWorktreeGateway(),
    externalUrl: new TauriForgeUrlOpener(),
  };
}

export const UNAVAILABLE_AGENT_FILE_SEARCH: FileSearchGateway = Object.freeze({
  searchFiles: () => Promise.reject(new Error("File search is unavailable.")),
});
