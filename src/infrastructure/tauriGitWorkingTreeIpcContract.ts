import type { GitSurfaceTarget } from "../domain/gitSurfaceStatus";
import {
  GIT_AMEND_FILE_ACTIONS,
  GIT_CHANGE_STATUSES,
  MAX_AMEND_MESSAGE_BYTES,
  MAX_AMEND_PATHS,
  parseGitAmendCandidate,
  parseGitAmendReceipt,
  parseGitDiscardPreparation,
  parseGitDiscardReceipt,
  wireDiscardFingerprint,
  type GitAmendCandidate,
  type GitAmendHeadRequest,
  type GitAmendReceipt,
  type GitDiscardFileRequest,
  type GitDiscardPreparation,
  type GitPrepareDiscardRequest,
  type GitDiscardReceipt,
} from "../domain/gitWorkingTree";
import {
  wireArray,
  wireEnum,
  wireExactRecord,
  wireObjectId,
  wireRelativePath,
  wireString,
} from "../domain/wireValue";
import {
  validateGitSurfaceTargetRequest,
  type InvokeGitSurfaceCommand,
} from "./tauriGitSurfaceIpcContract";

export const GET_GIT_AMEND_CANDIDATE_IPC_COMMAND = "get_git_amend_candidate" as const;
export const AMEND_GIT_HEAD_IPC_COMMAND = "amend_git_head" as const;
export const DISCARD_GIT_FILE_IPC_COMMAND = "discard_git_file" as const;
export const PREPARE_GIT_DISCARD_IPC_COMMAND = "prepare_git_discard" as const;

export function validateGitAmendHeadRequest(request: GitAmendHeadRequest): GitAmendHeadRequest {
  return {
    ...validateGitSurfaceTargetRequest(request),
    expectedHead: wireObjectId(request.expectedHead, "request.expectedHead"),
    message: wireString(request.message, "request.message", MAX_AMEND_MESSAGE_BYTES),
    files: wireArray(request.files, "request.files", MAX_AMEND_PATHS).map((file, index) => {
      const record = wireExactRecord(file, ["relativePath", "action"], `request.files[${index}]`);
      return {
        relativePath: wireRelativePath(record.relativePath, `request.files[${index}].relativePath`),
        action: wireEnum(record.action, `request.files[${index}].action`, GIT_AMEND_FILE_ACTIONS),
      };
    }),
  };
}

export function validateGitDiscardFileRequest(
  request: GitDiscardFileRequest,
): GitDiscardFileRequest {
  return {
    ...validateGitPrepareDiscardRequest(request),
    fingerprint: wireDiscardFingerprint(request.fingerprint, "request.fingerprint"),
  };
}

export function validateGitPrepareDiscardRequest(
  request: GitPrepareDiscardRequest,
): GitPrepareDiscardRequest {
  const { file } = request;
  return {
    ...validateGitSurfaceTargetRequest(request),
    file: {
      relativePath: wireRelativePath(file.relativePath, "request.file.relativePath"),
      oldRelativePath:
        file.oldRelativePath === null
          ? null
          : wireRelativePath(file.oldRelativePath, "request.file.oldRelativePath"),
      expectedStatus: wireEnum(
        file.expectedStatus,
        "request.file.expectedStatus",
        GIT_CHANGE_STATUSES,
      ),
    },
  };
}

export async function invokeGetGitAmendCandidateIpc(
  invoke: InvokeGitSurfaceCommand,
  target: GitSurfaceTarget,
): Promise<GitAmendCandidate> {
  const request = validateGitSurfaceTargetRequest(target);
  return parseGitAmendCandidate(await invoke(GET_GIT_AMEND_CANDIDATE_IPC_COMMAND, { request }));
}

export async function invokeAmendGitHeadIpc(
  invoke: InvokeGitSurfaceCommand,
  request: GitAmendHeadRequest,
): Promise<GitAmendReceipt> {
  const validated = validateGitAmendHeadRequest(request);
  return parseGitAmendReceipt(await invoke(AMEND_GIT_HEAD_IPC_COMMAND, { request: validated }));
}

export async function invokePrepareGitDiscardIpc(
  invoke: InvokeGitSurfaceCommand,
  request: GitPrepareDiscardRequest,
): Promise<GitDiscardPreparation> {
  const validated = validateGitPrepareDiscardRequest(request);
  return parseGitDiscardPreparation(
    await invoke(PREPARE_GIT_DISCARD_IPC_COMMAND, { request: validated }),
  );
}

export async function invokeDiscardGitFileIpc(
  invoke: InvokeGitSurfaceCommand,
  request: GitDiscardFileRequest,
): Promise<GitDiscardReceipt> {
  const validated = validateGitDiscardFileRequest(request);
  return parseGitDiscardReceipt(await invoke(DISCARD_GIT_FILE_IPC_COMMAND, { request: validated }));
}
