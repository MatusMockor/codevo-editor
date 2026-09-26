import { MAX_AGENT_SHIP_COMMIT_MESSAGE_BYTES } from "./agentShip";
import type { GitChangeStatus } from "./git";
import type { GitSurfaceTarget } from "./gitSurfaceStatus";
import {
  wireBoolean,
  wireEnum,
  wireExactRecord,
  wireObjectId,
  wireRecord,
  wireRelativePath,
  wireString,
} from "./wireValue";

export const MAX_AMEND_MESSAGE_BYTES = MAX_AGENT_SHIP_COMMIT_MESSAGE_BYTES;
export const MAX_AMEND_PATHS = 5_000;
const FINGERPRINT_LENGTH = 64;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

export type GitAmendCandidate =
  | { readonly kind: "ready"; readonly headSha: string; readonly message: string }
  | { readonly kind: "noCommit" }
  | { readonly kind: "operationInProgress" }
  | { readonly kind: "pushed"; readonly headSha: string }
  | { readonly kind: "messageTooLarge"; readonly headSha: string };

export interface GitAmendReceipt {
  readonly headSha: string;
  readonly indexSynced: boolean;
}

export type GitAmendFileAction = "stageWorktree" | "stageDeletion";

export interface GitAmendFile {
  readonly relativePath: string;
  readonly action: GitAmendFileAction;
}

export interface GitAmendHeadRequest extends GitSurfaceTarget {
  readonly expectedHead: string;
  readonly message: string;
  readonly files: ReadonlyArray<GitAmendFile>;
}

export const GIT_AMEND_FILE_ACTIONS: ReadonlyArray<GitAmendFileAction> = [
  "stageWorktree",
  "stageDeletion",
];

export interface GitDiscardFile {
  readonly relativePath: string;
  readonly oldRelativePath: string | null;
  readonly expectedStatus: GitChangeStatus;
}

export interface GitPrepareDiscardRequest extends GitSurfaceTarget {
  readonly file: GitDiscardFile;
}

export interface GitDiscardFileRequest extends GitPrepareDiscardRequest {
  readonly fingerprint: string;
}

export interface GitDiscardPreparation {
  readonly fingerprint: string;
}

export type GitDiscardAction = "restored" | "deleted";

export interface GitDiscardReceipt {
  readonly relativePath: string;
  readonly action: GitDiscardAction;
}

export interface GitWorkingTreeGateway {
  getAmendCandidate(target: GitSurfaceTarget): Promise<GitAmendCandidate>;
  amendHead(request: GitAmendHeadRequest): Promise<GitAmendReceipt>;
  prepareDiscard(request: GitPrepareDiscardRequest): Promise<GitDiscardPreparation>;
  discardFile(request: GitDiscardFileRequest): Promise<GitDiscardReceipt>;
}

export type GitDiscardEffect = "delete" | "restore" | "restoreRename" | "blocked";
export type GitDiscardBlock = "conflicted" | "nestedRepository";

export const GIT_CHANGE_STATUSES: ReadonlyArray<GitChangeStatus> = [
  "added",
  "conflicted",
  "deleted",
  "modified",
  "renamed",
  "untracked",
];

const AMEND_CANDIDATE_KINDS: ReadonlyArray<GitAmendCandidate["kind"]> = [
  "ready",
  "noCommit",
  "operationInProgress",
  "pushed",
  "messageTooLarge",
];
const DISCARD_ACTIONS: ReadonlyArray<GitDiscardAction> = ["restored", "deleted"];

export function gitDiscardEffect(status: GitChangeStatus): GitDiscardEffect {
  switch (status) {
    case "untracked":
    case "added":
      return "delete";
    case "modified":
    case "deleted":
      return "restore";
    case "renamed":
      return "restoreRename";
    case "conflicted":
      return "blocked";
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

export function gitDiscardBlock(
  relativePath: string,
  status: GitChangeStatus,
): GitDiscardBlock | null {
  if (status === "conflicted") return "conflicted";
  if (relativePath.endsWith("/")) return "nestedRepository";
  return null;
}

export function parseGitAmendCandidate(
  value: unknown,
  path = "gitAmendCandidate",
): GitAmendCandidate {
  const kind = wireEnum(wireRecord(value, path).kind, `${path}.kind`, AMEND_CANDIDATE_KINDS);
  switch (kind) {
    case "ready": {
      const record = wireExactRecord(value, ["kind", "headSha", "message"], path);
      return {
        kind,
        headSha: wireObjectId(record.headSha, `${path}.headSha`),
        message: wireString(record.message, `${path}.message`, MAX_AMEND_MESSAGE_BYTES),
      };
    }
    case "noCommit":
    case "operationInProgress":
      wireExactRecord(value, ["kind"], path);
      return { kind };
    case "pushed":
    case "messageTooLarge": {
      const record = wireExactRecord(value, ["kind", "headSha"], path);
      return { kind, headSha: wireObjectId(record.headSha, `${path}.headSha`) };
    }
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

export function parseGitAmendReceipt(value: unknown, path = "gitAmendReceipt"): GitAmendReceipt {
  const record = wireExactRecord(value, ["headSha", "indexSynced"], path);
  return {
    headSha: wireObjectId(record.headSha, `${path}.headSha`),
    indexSynced: wireBoolean(record.indexSynced, `${path}.indexSynced`),
  };
}

export function parseGitDiscardPreparation(
  value: unknown,
  path = "gitDiscardPreparation",
): GitDiscardPreparation {
  const record = wireExactRecord(value, ["fingerprint"], path);
  return { fingerprint: wireDiscardFingerprint(record.fingerprint, `${path}.fingerprint`) };
}

export function wireDiscardFingerprint(value: unknown, path: string): string {
  const text = wireString(value, path, FINGERPRINT_LENGTH);
  if (!FINGERPRINT_PATTERN.test(text)) {
    throw new TypeError(`Invalid ${path}: expected a discard fingerprint.`);
  }
  return text;
}

export function parseGitDiscardReceipt(
  value: unknown,
  path = "gitDiscardReceipt",
): GitDiscardReceipt {
  const record = wireExactRecord(value, ["relativePath", "action"], path);
  return {
    relativePath: wireRelativePath(record.relativePath, `${path}.relativePath`),
    action: wireEnum(record.action, `${path}.action`, DISCARD_ACTIONS),
  };
}
