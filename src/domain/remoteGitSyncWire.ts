import {
  boundedArray,
  exactObject,
  integerIn,
  isGitSha,
  isRunnerId,
  isRunnerIdentifier,
  isWireBoolean,
  isWireRecord,
  isWireTimestamp,
  isWellFormedText,
  isWireUuid,
  nullable,
  oneOf,
  optional,
  utf8Bytes,
  type WireCheck,
} from "./remoteWireChecks";

export const REMOTE_GIT_ERROR_CODES = [
  "git_remote_unavailable",
  "git_auth_failed",
  "git_timeout",
  "git_no_remote",
  "git_remote_unsupported",
  "git_branch_not_found",
  "git_detached_head",
  "git_no_upstream",
  "git_dirty",
  "git_diverged",
  "git_operation_in_progress",
  "git_rejected_non_fast_forward",
  "git_rejected",
  "git_nothing_to_commit",
  "git_identity_missing",
  "busy",
  "conflict",
] as const;

export const REMOTE_GIT_LIMITS = Object.freeze({
  branchBytes: 255,
  branches: 500,
  dirtyCount: 10_000,
  commitMessageBytes: 4096,
});

export type RemoteGitErrorCode = (typeof REMOTE_GIT_ERROR_CODES)[number];
export type RemoteStartBase =
  Readonly<{ kind: "origin-branch"; branch: string }> | Readonly<{ kind: "checkout-head" }>;
export type RemoteGitBranch = Readonly<{ name: string; sha: string; committedAt: string }>;
export type RemoteGitBranchList = Readonly<{
  defaultBranch: string | null;
  checkoutBranch: string | null;
  fetchedAt: string | null;
  branches: readonly RemoteGitBranch[];
  truncated: boolean;
}>;
export type RemoteGitDirtySummary = Readonly<{
  tracked: number;
  untracked: number;
  truncated: boolean;
}>;
export type RemoteGitTracking = Readonly<{ ref: string; ahead: number; behind: number }>;
export type RemoteGitCheckoutOperation =
  "none" | "merge" | "rebase" | "cherry-pick" | "revert" | "bisect";
export type RemoteGitCheckoutStatus = Readonly<{
  branch: string | null;
  headSha: string;
  upstream: RemoteGitTracking | null;
  dirty: RemoteGitDirtySummary;
  operation: RemoteGitCheckoutOperation;
  inPlaceTaskActive: boolean;
  fetchedAt: string | null;
}>;
export type RemoteThreadGitBase = Readonly<{
  branch: string;
  sha: string;
  fetchedAt: string | null;
  ahead: number;
  behind: number;
}>;
export type RemoteThreadGitStatus = Readonly<{
  mode: "worktree" | "in-place";
  branch: string | null;
  headSha: string;
  base: RemoteThreadGitBase | null;
  published: RemoteGitTracking | null;
  dirty: RemoteGitDirtySummary;
  active: boolean;
}>;
export type RemoteGitCommitResult = Readonly<{ commitSha: string; status: RemoteThreadGitStatus }>;
export type RemoteGitOperationKind = "fetch" | "update" | "push";
export type RemoteGitOperationResult =
  | Readonly<{ kind: "fetch"; fetchedAt: string }>
  | Readonly<{ kind: "update"; headSha: string; fastForwarded: number }>
  | Readonly<{ kind: "push"; remoteRef: string; pushedSha: string; created: boolean }>;
export type RemoteGitOperation = Readonly<{
  id: string;
  kind: RemoteGitOperationKind;
  status: "running" | "succeeded" | "failed";
  error: RemoteGitErrorCode | null;
  result: RemoteGitOperationResult | null;
}>;
export type RemoteGitPushTarget = "thread-branch" | "base-branch";
export type RemoteGitConnection = Readonly<{ serverId: string; runnerId: string }>;
export type RemoteGitRequest = RemoteGitConnection &
  (
    | Readonly<{ operation: "projectBranches" | "projectStatus"; projectId: string }>
    | Readonly<{
        operation: "projectFetch" | "projectUpdate";
        projectId: string;
        idempotencyKey: string;
      }>
    | Readonly<{ operation: "threadStatus"; taskId: string }>
    | Readonly<{ operation: "threadCommit"; taskId: string; message: string }>
    | Readonly<{
        operation: "threadPush";
        taskId: string;
        idempotencyKey: string;
        target: RemoteGitPushTarget;
      }>
    | Readonly<{ operation: "operation"; operationId: string }>
  );

const CLONE_BRANCH_FORBIDDEN = /[\u0000-\u0020\u007f~^:?*[\\]/u;
const COMMIT_MESSAGE_FORBIDDEN = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u;

export const isRemoteGitBranchName: WireCheck = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  utf8Bytes(value) <= REMOTE_GIT_LIMITS.branchBytes &&
  value !== "HEAD" &&
  value !== "@" &&
  !value.startsWith("+") &&
  isWellFormedText(value) &&
  !CLONE_BRANCH_FORBIDDEN.test(value) &&
  !value.includes("..") &&
  !value.includes("@{") &&
  !value.includes("//") &&
  !value.startsWith("-") &&
  !value.startsWith("/") &&
  !/[/.]$/u.test(value) &&
  !value.split("/").some((part) => part.startsWith(".") || part.endsWith(".lock"));

export const isRemoteGitCommitMessage: WireCheck = (value) =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  utf8Bytes(value) <= REMOTE_GIT_LIMITS.commitMessageBytes &&
  isWellFormedText(value) &&
  !COMMIT_MESSAGE_FORBIDDEN.test(value);

const isPublishedBranchRef: WireCheck = (value) =>
  typeof value === "string" &&
  value.startsWith("refs/heads/") &&
  isRemoteGitBranchName(value.slice("refs/heads/".length));

const count = integerIn(0);
const isErrorCode = oneOf(...REMOTE_GIT_ERROR_CODES);
const isPushTarget = oneOf("thread-branch", "base-branch");

export const isRemoteStartBase: WireCheck = (value) =>
  exactObject({ kind: oneOf("origin-branch"), branch: isRemoteGitBranchName })(value) ||
  exactObject({ kind: oneOf("checkout-head") })(value);

const dirtySummary = exactObject({
  tracked: integerIn(0, REMOTE_GIT_LIMITS.dirtyCount),
  untracked: integerIn(0, REMOTE_GIT_LIMITS.dirtyCount),
  truncated: isWireBoolean,
});
const tracking = exactObject({ ref: isRemoteGitBranchName, ahead: count, behind: count });

export const isRemoteGitBranchList = exactObject({
  defaultBranch: nullable(isRemoteGitBranchName),
  checkoutBranch: nullable(isRemoteGitBranchName),
  fetchedAt: nullable(isWireTimestamp),
  branches: boundedArray(
    exactObject({ name: isRemoteGitBranchName, sha: isGitSha, committedAt: isWireTimestamp }),
    REMOTE_GIT_LIMITS.branches,
  ),
  truncated: isWireBoolean,
});

export const isRemoteGitCheckoutStatus = exactObject({
  branch: nullable(isRemoteGitBranchName),
  headSha: isGitSha,
  upstream: nullable(tracking),
  dirty: dirtySummary,
  operation: oneOf("none", "merge", "rebase", "cherry-pick", "revert", "bisect"),
  inPlaceTaskActive: isWireBoolean,
  fetchedAt: nullable(isWireTimestamp),
});

export const isRemoteThreadGitStatus = exactObject({
  mode: oneOf("worktree", "in-place"),
  branch: nullable(isRemoteGitBranchName),
  headSha: isGitSha,
  base: nullable(
    exactObject({
      branch: isRemoteGitBranchName,
      sha: isGitSha,
      fetchedAt: nullable(isWireTimestamp),
      ahead: count,
      behind: count,
    }),
  ),
  published: nullable(tracking),
  dirty: dirtySummary,
  active: isWireBoolean,
});

export const isRemoteGitCommitResult = exactObject({
  commitSha: isGitSha,
  status: isRemoteThreadGitStatus,
});

const operationResult = (kind: unknown): WireCheck => {
  switch (kind) {
    case "fetch":
      return exactObject({ kind: oneOf("fetch"), fetchedAt: isWireTimestamp });
    case "update":
      return exactObject({ kind: oneOf("update"), headSha: isGitSha, fastForwarded: count });
    case "push":
      return exactObject({
        kind: oneOf("push"),
        remoteRef: isPublishedBranchRef,
        pushedSha: isGitSha,
        created: isWireBoolean,
      });
    default:
      return () => false;
  }
};

const operationOutcome: WireCheck = (value) => {
  if (!isWireRecord(value)) return false;
  switch (value.status) {
    case "running":
      return value.error === null && value.result === null;
    case "succeeded":
      return value.error === null && operationResult(value.kind)(value.result);
    case "failed":
      return isErrorCode(value.error) && value.result === null;
    default:
      return false;
  }
};

export const isRemoteGitOperation: WireCheck = (value) =>
  exactObject({
    id: isWireUuid,
    kind: oneOf("fetch", "update", "push"),
    status: oneOf("running", "succeeded", "failed"),
    error: nullable(isErrorCode),
    result: (result) => result === null || isWireRecord(result),
  })(value) && operationOutcome(value);

export const isRemoteGitErrorBody = exactObject({ error: isErrorCode });

const connection = { serverId: isRunnerIdentifier, runnerId: isRunnerId };
const project = { ...connection, projectId: isRunnerIdentifier };
const thread = { ...connection, taskId: isWireUuid };
const requestFields: Readonly<Record<RemoteGitRequest["operation"], WireCheck>> = {
  projectBranches: exactObject({ ...project, operation: oneOf("projectBranches") }),
  projectStatus: exactObject({ ...project, operation: oneOf("projectStatus") }),
  projectFetch: exactObject({
    ...project,
    operation: oneOf("projectFetch"),
    idempotencyKey: isWireUuid,
  }),
  projectUpdate: exactObject({
    ...project,
    operation: oneOf("projectUpdate"),
    idempotencyKey: isWireUuid,
  }),
  threadStatus: exactObject({ ...thread, operation: oneOf("threadStatus") }),
  threadCommit: exactObject({
    ...thread,
    operation: oneOf("threadCommit"),
    message: isRemoteGitCommitMessage,
  }),
  threadPush: exactObject({
    ...thread,
    operation: oneOf("threadPush"),
    idempotencyKey: isWireUuid,
    target: isPushTarget,
  }),
  operation: exactObject({ ...connection, operation: oneOf("operation"), operationId: isWireUuid }),
};

export const isRemoteGitRequest = (value: unknown): value is RemoteGitRequest =>
  isWireRecord(value) &&
  typeof value.operation === "string" &&
  Object.prototype.hasOwnProperty.call(requestFields, value.operation) &&
  requestFields[value.operation as RemoteGitRequest["operation"]](value);

export const remoteGitSyncWireChecks: Readonly<Record<string, WireCheck>> = {
  startBody: exactObject({ projectId: isRunnerIdentifier, base: optional(isRemoteStartBase) }),
  fetchOrUpdateBody: exactObject({ idempotencyKey: isWireUuid }),
  commitBody: exactObject({ message: isRemoteGitCommitMessage }),
  pushBody: exactObject({ idempotencyKey: isWireUuid, target: isPushTarget }),
  branchList: isRemoteGitBranchList,
  checkoutStatus: isRemoteGitCheckoutStatus,
  threadGitStatus: isRemoteThreadGitStatus,
  commitResult: isRemoteGitCommitResult,
  gitOperation: isRemoteGitOperation,
  errorBody: isRemoteGitErrorBody,
  editorGitRequest: isRemoteGitRequest,
};
