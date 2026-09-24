import {
  parseGitBranchChanges,
  parseGitBranchFileSides,
  validateGitBaseRef,
  type GitBranchChanges,
  type GitBranchChangesRequest,
  type GitBranchFileSides,
  type GitBranchFileSidesRequest,
} from "../domain/gitBranchDiff";
import {
  parseGitSurfaceStatus,
  type GitSurfaceStatus,
  type GitSurfaceTarget,
} from "../domain/gitSurfaceStatus";
import { wireAbsolutePath, wireObjectId, wireRelativePath } from "../domain/wireValue";

export const GET_GIT_SURFACE_STATUS_IPC_COMMAND = "get_git_surface_status" as const;
export const GET_GIT_BRANCH_CHANGES_IPC_COMMAND = "get_git_branch_changes" as const;
export const GET_GIT_BRANCH_FILE_DIFF_IPC_COMMAND = "get_git_branch_file_diff" as const;

export type InvokeGitSurfaceCommand = (
  command: string,
  args: Readonly<Record<string, unknown>>,
) => Promise<unknown>;

export function validateGitSurfaceTargetRequest(request: GitSurfaceTarget): GitSurfaceTarget {
  return {
    repositoryRoot: wireAbsolutePath(request.repositoryRoot, "request.repositoryRoot"),
    worktreePath:
      request.worktreePath === null
        ? null
        : wireAbsolutePath(request.worktreePath, "request.worktreePath"),
  };
}

export function validateGitBranchChangesRequest(
  request: GitBranchChangesRequest,
): GitBranchChangesRequest {
  return {
    ...validateGitSurfaceTargetRequest(request),
    baseRef: validateGitBaseRef(request.baseRef),
  };
}

export function validateGitBranchFileDiffRequest(
  request: GitBranchFileSidesRequest,
): GitBranchFileSidesRequest {
  return {
    ...validateGitSurfaceTargetRequest(request),
    mergeBase: wireObjectId(request.mergeBase, "request.mergeBase"),
    headCommit: wireObjectId(request.headCommit, "request.headCommit"),
    relativePath: wireRelativePath(request.relativePath, "request.relativePath"),
    oldRelativePath:
      request.oldRelativePath === null
        ? null
        : wireRelativePath(request.oldRelativePath, "request.oldRelativePath"),
  };
}

export async function invokeGetGitSurfaceStatusIpc(
  invoke: InvokeGitSurfaceCommand,
  request: GitSurfaceTarget,
): Promise<GitSurfaceStatus> {
  const validated = validateGitSurfaceTargetRequest(request);
  return parseGitSurfaceStatus(
    await invoke(GET_GIT_SURFACE_STATUS_IPC_COMMAND, { request: validated }),
  );
}

export async function invokeGetGitBranchChangesIpc(
  invoke: InvokeGitSurfaceCommand,
  request: GitBranchChangesRequest,
): Promise<GitBranchChanges> {
  const validated = validateGitBranchChangesRequest(request);
  return parseGitBranchChanges(
    await invoke(GET_GIT_BRANCH_CHANGES_IPC_COMMAND, { request: validated }),
  );
}

export async function invokeGetGitBranchFileDiffIpc(
  invoke: InvokeGitSurfaceCommand,
  request: GitBranchFileSidesRequest,
): Promise<GitBranchFileSides> {
  const validated = validateGitBranchFileDiffRequest(request);
  return parseGitBranchFileSides(
    await invoke(GET_GIT_BRANCH_FILE_DIFF_IPC_COMMAND, { request: validated }),
  );
}
