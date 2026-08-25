import {
  parseGitIntegrationOutcome,
  parseGitPushReceipt,
  parseGitShipStatus,
  validateGitIntegrationBranch,
  validateGitIntegrationMode,
  validateGitIntegrationRepositoryRoot,
  validateGitIntegrationSha,
  validateGitIntegrationWorktreePath,
  validateGitMergeMessage,
  validateOptionalGitIntegrationWorktreePath,
  type GitIntegrateBranchRequest,
  type GitIntegrationOutcome,
  type GitPushBranchRequest,
  type GitPushReceipt,
  type GitShipStatus,
  type GitShipStatusRequest,
} from "../domain/gitIntegration";

export const GET_GIT_SHIP_STATUS_IPC_COMMAND = "get_git_ship_status" as const;
export const PUSH_GIT_BRANCH_UPSTREAM_IPC_COMMAND = "push_git_branch_upstream" as const;
export const INTEGRATE_GIT_WORKTREE_BRANCH_IPC_COMMAND = "integrate_git_worktree_branch" as const;

export const GIT_INTEGRATION_FAILURE_PREFIXES = [
  "noRemote:",
  "rejected:",
  "authRequired:",
  "gitError:",
] as const;

export type GitIntegrationFailurePrefix = (typeof GIT_INTEGRATION_FAILURE_PREFIXES)[number];

export type InvokeGitIntegrationCommand = (
  command: string,
  args: Readonly<Record<string, unknown>>,
) => Promise<unknown>;

export interface GitShipStatusWireRequest {
  readonly repositoryRoot: string;
  readonly worktreePath: string | null;
}

export interface GitPushBranchWireRequest {
  readonly repositoryRoot: string;
  readonly worktreePath: string | null;
}

export interface GitIntegrateBranchWireRequest {
  readonly repositoryRoot: string;
  readonly worktreePath: string;
  readonly mode: string;
  readonly expectedPrimaryBranch: string;
  readonly expectedPrimaryHead: string;
  readonly expectedBranchHead: string;
  readonly mergeMessage: string;
}

export function validateGitShipStatusRequest(
  request: GitShipStatusRequest,
): GitShipStatusWireRequest {
  return {
    repositoryRoot: validateGitIntegrationRepositoryRoot(request.repositoryRoot),
    worktreePath: validateOptionalGitIntegrationWorktreePath(request.worktreePath),
  };
}

export function validateGitPushBranchRequest(
  request: GitPushBranchRequest,
): GitPushBranchWireRequest {
  return {
    repositoryRoot: validateGitIntegrationRepositoryRoot(request.repositoryRoot),
    worktreePath: validateOptionalGitIntegrationWorktreePath(request.worktreePath),
  };
}

export function validateGitIntegrateBranchRequest(
  request: GitIntegrateBranchRequest,
): GitIntegrateBranchWireRequest {
  return {
    repositoryRoot: validateGitIntegrationRepositoryRoot(request.repositoryRoot),
    worktreePath: validateGitIntegrationWorktreePath(request.worktreePath),
    mode: validateGitIntegrationMode(request.mode),
    expectedPrimaryBranch: validateGitIntegrationBranch(
      request.expectedPrimaryBranch,
      "request.expectedPrimaryBranch",
    ),
    expectedPrimaryHead: validateGitIntegrationSha(
      request.expectedPrimaryHead,
      "request.expectedPrimaryHead",
    ),
    expectedBranchHead: validateGitIntegrationSha(
      request.expectedBranchHead,
      "request.expectedBranchHead",
    ),
    mergeMessage: validateGitMergeMessage(request.mergeMessage, "request.mergeMessage"),
  };
}

export async function invokeGetGitShipStatusIpc(
  invokeCommand: InvokeGitIntegrationCommand,
  request: GitShipStatusRequest,
): Promise<GitShipStatus> {
  return parseGitShipStatus(
    await invokeCommand(GET_GIT_SHIP_STATUS_IPC_COMMAND, {
      request: validateGitShipStatusRequest(request),
    }),
  );
}

export async function invokePushGitBranchUpstreamIpc(
  invokeCommand: InvokeGitIntegrationCommand,
  request: GitPushBranchRequest,
): Promise<GitPushReceipt> {
  return parseGitPushReceipt(
    await invokeCommand(PUSH_GIT_BRANCH_UPSTREAM_IPC_COMMAND, {
      request: validateGitPushBranchRequest(request),
    }),
  );
}

export async function invokeIntegrateGitWorktreeBranchIpc(
  invokeCommand: InvokeGitIntegrationCommand,
  request: GitIntegrateBranchRequest,
): Promise<GitIntegrationOutcome> {
  return parseGitIntegrationOutcome(
    await invokeCommand(INTEGRATE_GIT_WORKTREE_BRANCH_IPC_COMMAND, {
      request: validateGitIntegrateBranchRequest(request),
    }),
  );
}
