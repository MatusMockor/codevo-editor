import {
  GIT_COMPARE_URL_HOSTS,
  MAX_GIT_INTEGRATION_CHANGE_COUNT,
  MAX_GIT_INTEGRATION_COUNT,
  MAX_GIT_INTEGRATION_URL_BYTES,
  type GitShipStatus,
} from "./gitIntegration";
import { isCanonicalRepositoryIdentity } from "./repositoryIdentity";
import {
  isRemoteGitBranchName,
  isRemoteGitErrorBody,
  isRemoteGitOperation,
  type RemoteGitBranchList,
  type RemoteGitCheckoutStatus,
  type RemoteGitCommitResult,
  type RemoteGitConnection,
  type RemoteGitErrorCode,
  type RemoteGitOperation,
  type RemoteGitOperationKind,
  type RemoteGitOperationResult,
  type RemoteGitPushTarget,
  type RemoteThreadGitStatus,
} from "./remoteGitSyncWire";
import { isWireRecord, utf8Bytes, type WireCheck } from "./remoteWireChecks";

export type {
  RemoteGitBranchList,
  RemoteGitCheckoutStatus,
  RemoteGitCommitResult,
  RemoteGitConnection,
  RemoteGitErrorCode,
  RemoteGitOperation,
  RemoteGitOperationKind,
  RemoteGitOperationResult,
  RemoteGitPushTarget,
  RemoteStartBase,
  RemoteThreadGitStatus,
} from "./remoteGitSyncWire";

export const REMOTE_GIT_REMOTE_NAME = "origin";
export const REMOTE_GIT_INVALID_RESPONSE = "Invalid runner Git sync response.";

export type RemoteGitProjectKey = RemoteGitConnection & Readonly<{ projectId: string }>;
export type RemoteGitThreadKey = RemoteGitConnection & Readonly<{ taskId: string }>;

export type RemoteGitAdmission<T> =
  | Readonly<{ kind: "accepted"; value: T }>
  | Readonly<{ kind: "refused"; error: RemoteGitErrorCode }>;

export type RemoteGitPoll =
  Readonly<{ kind: "operation"; operation: RemoteGitOperation }> | Readonly<{ kind: "unknown" }>;

export type RemoteGitOperationOutcome =
  | Readonly<{ kind: "succeeded"; result: RemoteGitOperationResult }>
  | Readonly<{ kind: "failed"; error: RemoteGitErrorCode }>
  | Readonly<{ kind: "unknown" }>
  | Readonly<{ kind: "timedOut" }>
  | Readonly<{ kind: "aborted" }>;

export interface RemoteGitSyncPort {
  branches(project: RemoteGitProjectKey): Promise<RemoteGitBranchList>;
  projectStatus(project: RemoteGitProjectKey): Promise<RemoteGitCheckoutStatus>;
  fetch(
    project: RemoteGitProjectKey,
    idempotencyKey: string,
  ): Promise<RemoteGitAdmission<RemoteGitOperation>>;
  update(
    project: RemoteGitProjectKey,
    idempotencyKey: string,
  ): Promise<RemoteGitAdmission<RemoteGitOperation>>;
  threadStatus(thread: RemoteGitThreadKey): Promise<RemoteThreadGitStatus>;
  commit(
    thread: RemoteGitThreadKey,
    message: string,
  ): Promise<RemoteGitAdmission<RemoteGitCommitResult>>;
  push(
    thread: RemoteGitThreadKey,
    idempotencyKey: string,
    target: RemoteGitPushTarget,
  ): Promise<RemoteGitAdmission<RemoteGitOperation>>;
  pollOperation(connection: RemoteGitConnection, operationId: string): Promise<RemoteGitPoll>;
  awaitOperation(
    connection: RemoteGitConnection,
    operation: RemoteGitOperation,
    signal?: AbortSignal,
  ): Promise<RemoteGitOperationOutcome>;
}

export function parseRemoteGitAdmission<T>(
  value: unknown,
  accepted: WireCheck,
): RemoteGitAdmission<T> {
  if (isRemoteGitErrorBody(value)) {
    return { kind: "refused", error: (value as { error: RemoteGitErrorCode }).error };
  }
  if (!accepted(value)) throw new Error(REMOTE_GIT_INVALID_RESPONSE);
  return { kind: "accepted", value: value as T };
}

export const isRemoteGitOperationOf =
  (kind: RemoteGitOperationKind): WireCheck =>
  (value) =>
    isRemoteGitOperation(value) && (value as RemoteGitOperation).kind === kind;

export function parseRemoteGitPoll(value: unknown, operationId: string): RemoteGitPoll {
  if (isWireRecord(value) && Object.keys(value).length === 1 && value.outcome === "unknown") {
    return { kind: "unknown" };
  }
  if (!isRemoteGitOperation(value) || (value as RemoteGitOperation).id !== operationId) {
    throw new Error(REMOTE_GIT_INVALID_RESPONSE);
  }
  return { kind: "operation", operation: value as RemoteGitOperation };
}

export function settledRemoteGitOperation(
  operation: RemoteGitOperation,
): RemoteGitOperationOutcome | null {
  switch (operation.status) {
    case "running":
      return null;
    case "succeeded":
      if (operation.result === null) throw new Error(REMOTE_GIT_INVALID_RESPONSE);
      return { kind: "succeeded", result: operation.result };
    case "failed":
      if (operation.error === null) throw new Error(REMOTE_GIT_INVALID_RESPONSE);
      return { kind: "failed", error: operation.error };
    default:
      return unsupported(operation.status);
  }
}

export function remoteGitErrorMessage(code: RemoteGitErrorCode): string {
  switch (code) {
    case "git_remote_unavailable":
      return "The server could not reach origin. Check its network access and try again.";
    case "git_auth_failed":
      return "The server could not sign in to origin. Check the server account's SSH key or Git credentials.";
    case "git_timeout":
      return "Git on the server took too long and was stopped. Try again.";
    case "git_no_remote":
      return "This repository on the server has no origin remote.";
    case "git_remote_unsupported":
      return "The origin URL on the server cannot be used for sync. It must not contain credentials or point to a local path.";
    case "git_branch_not_found":
      return "This branch no longer exists on origin. Fetch and choose another branch.";
    case "git_detached_head":
      return "The server checkout is not on a branch.";
    case "git_no_upstream":
      return "The server checkout branch does not track a branch on origin.";
    case "git_dirty":
      return "The server checkout has uncommitted changes.";
    case "git_diverged":
      return "The server checkout and origin have diverged, so it cannot be fast-forwarded.";
    case "git_operation_in_progress":
      return "A merge, rebase or other Git operation is in progress on the server checkout.";
    case "git_rejected_non_fast_forward":
      return "Origin has newer commits on this branch. The push was rejected and nothing was overwritten.";
    case "git_rejected":
      return "Origin rejected the push.";
    case "git_nothing_to_commit":
      return "Nothing to commit.";
    case "git_identity_missing":
      return "The server runner has no Git author. Set CODEVO_GIT_AUTHOR_NAME and CODEVO_GIT_AUTHOR_EMAIL, or user.name and user.email in the repository.";
    case "busy":
      return "A conversation is still running in this server checkout. Wait for it to finish and try again.";
    case "conflict":
      return "This request conflicts with an earlier one. Refresh and try again.";
    default:
      return unsupported(code);
  }
}

export function remoteThreadBranchName(
  status: RemoteThreadGitStatus,
  conversationId: string,
): string {
  if (status.branch !== null) return status.branch;
  if (status.mode === "in-place") return "HEAD";
  return `codevo/${conversationId.slice(0, 8)}`;
}

const SAFE_URL_SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/u;

function encodeRefForUrl(value: string): string {
  return Array.from(new TextEncoder().encode(value), (byte) => {
    const character = String.fromCharCode(byte);
    if (/^[A-Za-z0-9\-._~/]$/u.test(character)) return character;
    return `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }).join("");
}

export function remoteCompareUrl(
  repositoryKey: string | null,
  base: string,
  branch: string,
): string | null {
  if (repositoryKey === null || !isCanonicalRepositoryIdentity(repositoryKey)) return null;
  if (!isRemoteGitBranchName(base) || !isRemoteGitBranchName(branch)) return null;
  const [host, owner, repository, ...rest] = repositoryKey.split("/");
  if (
    rest.length > 0 ||
    owner === undefined ||
    repository === undefined ||
    !SAFE_URL_SEGMENT.test(owner) ||
    !SAFE_URL_SEGMENT.test(repository) ||
    !(GIT_COMPARE_URL_HOSTS as readonly string[]).includes(host ?? "")
  ) {
    return null;
  }
  const from = encodeRefForUrl(base);
  const to = encodeRefForUrl(branch);
  const url =
    host === "github.com"
      ? `https://github.com/${owner}/${repository}/compare/${from}...${to}?expand=1`
      : host === "gitlab.com"
        ? `https://gitlab.com/${owner}/${repository}/-/merge_requests/new?merge_request[source_branch]=${to}&merge_request[target_branch]=${from}`
        : `https://bitbucket.org/${owner}/${repository}/pull-requests/new?source=${to}&dest=${from}`;
  return utf8Bytes(url) <= MAX_GIT_INTEGRATION_URL_BYTES ? url : null;
}

const count = (value: number) => Math.min(value, MAX_GIT_INTEGRATION_COUNT);

export function remoteThreadShipStatus(
  status: RemoteThreadGitStatus,
  conversationId: string,
  repositoryKey: string | null,
): GitShipStatus {
  const branch = remoteThreadBranchName(status, conversationId);
  const changeCount = Math.min(
    status.dirty.tracked + status.dirty.untracked,
    MAX_GIT_INTEGRATION_CHANGE_COUNT,
  );
  const base = status.base;
  return {
    worktree: { branch, head: status.headSha, dirty: changeCount > 0, changeCount },
    primary: {
      branch: base === null ? null : `${REMOTE_GIT_REMOTE_NAME}/${base.branch}`,
      head: base?.sha ?? status.headSha,
      dirty: false,
    },
    relation: {
      aheadOfPrimary: count(base?.ahead ?? 0),
      behindPrimary: count(base?.behind ?? 0),
      fastForwardable: base !== null && base.behind === 0,
    },
    remote: {
      name: REMOTE_GIT_REMOTE_NAME,
      upstream:
        status.published === null
          ? null
          : { ahead: count(status.published.ahead), behind: count(status.published.behind) },
      compareUrl:
        base === null || status.published === null
          ? null
          : remoteCompareUrl(repositoryKey, base.branch, branch),
    },
  };
}

function unsupported(value: never): never {
  throw new TypeError(`Unsupported remote Git value: ${String(value)}.`);
}
