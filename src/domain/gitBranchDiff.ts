import type { GitChangeStatus } from "./git";
import {
  hasControlCharacter,
  wireArray,
  wireBoolean,
  wireEnum,
  wireExactRecord,
  wireNullableCount,
  wireObjectId,
  wireRelativePath,
  wireString,
} from "./wireValue";

export const MAX_GIT_BRANCH_DIFF_FILES = 500;
export const MAX_GIT_BRANCH_DIFF_SIDE_BYTES = 128 * 1024;
export const MAX_GIT_BASE_REF_BYTES = 256;
const MAX_LINE_COUNT = 100_000_000;
const MAX_WIRE_SIDE_BYTES = MAX_GIT_BRANCH_DIFF_SIDE_BYTES * 3;
const FORBIDDEN_REF_CHARACTERS = "~^:?*[\\";

const BRANCH_STATUSES = ["added", "deleted", "modified", "renamed"] as const;
const UNAVAILABLE_REASONS = ["binary", "large"] as const;

export type GitBranchFileStatus = Extract<GitChangeStatus, (typeof BRANCH_STATUSES)[number]>;
export type GitBranchUnavailableReason = (typeof UNAVAILABLE_REASONS)[number];

export interface GitBranchChangesRequest {
  readonly repositoryRoot: string;
  readonly worktreePath: string | null;
  readonly baseRef: string;
}

export interface GitBranchFileSidesRequest {
  readonly repositoryRoot: string;
  readonly worktreePath: string | null;
  readonly mergeBase: string;
  readonly headCommit: string;
  readonly relativePath: string;
  readonly oldRelativePath: string | null;
}

export interface GitBranchChangedFile {
  readonly relativePath: string;
  readonly oldRelativePath: string | null;
  readonly status: GitBranchFileStatus;
  readonly added: number | null;
  readonly deleted: number | null;
}

export interface GitBranchChanges {
  readonly mergeBase: string;
  readonly headCommit: string;
  readonly files: ReadonlyArray<GitBranchChangedFile>;
  readonly truncated: boolean;
  readonly statsTruncated: boolean;
}

export interface GitBranchSide {
  readonly text: string;
}

export interface GitBranchFileSides {
  readonly original: GitBranchSide;
  readonly modified: GitBranchSide;
  readonly unavailableReason: GitBranchUnavailableReason | null;
}

export interface GitBranchDiffGateway {
  getBranchChanges(request: GitBranchChangesRequest): Promise<GitBranchChanges>;
  getBranchFileSides(request: GitBranchFileSidesRequest): Promise<GitBranchFileSides>;
}

export function validateGitBaseRef(value: unknown): string {
  const text = wireString(value, "baseRef", MAX_GIT_BASE_REF_BYTES);
  const invalid =
    text.length === 0 ||
    text.startsWith("-") ||
    text.startsWith("/") ||
    text.endsWith("/") ||
    text.endsWith(".lock") ||
    text.includes("..") ||
    text.includes("@{") ||
    /\s/.test(text) ||
    hasControlCharacter(text) ||
    [...text].some((character) => FORBIDDEN_REF_CHARACTERS.includes(character));
  if (invalid) {
    throw new TypeError("Invalid baseRef: expected a branch name.");
  }
  return text;
}

export function parseGitBranchChanges(value: unknown, path = "branchChanges"): GitBranchChanges {
  const record = wireExactRecord(
    value,
    ["mergeBase", "headCommit", "files", "truncated", "statsTruncated"],
    path,
  );
  return {
    mergeBase: wireObjectId(record.mergeBase, `${path}.mergeBase`),
    headCommit: wireObjectId(record.headCommit, `${path}.headCommit`),
    files: wireArray(record.files, `${path}.files`, MAX_GIT_BRANCH_DIFF_FILES).map((item, index) =>
      parseChangedFile(item, `${path}.files[${index}]`),
    ),
    truncated: wireBoolean(record.truncated, `${path}.truncated`),
    statsTruncated: wireBoolean(record.statsTruncated, `${path}.statsTruncated`),
  };
}

export function parseGitBranchFileSides(
  value: unknown,
  path = "branchFileSides",
): GitBranchFileSides {
  const record = wireExactRecord(value, ["original", "modified", "unavailableReason"], path);
  return {
    original: parseSide(record.original, `${path}.original`),
    modified: parseSide(record.modified, `${path}.modified`),
    unavailableReason:
      record.unavailableReason === null
        ? null
        : wireEnum(record.unavailableReason, `${path}.unavailableReason`, UNAVAILABLE_REASONS),
  };
}

function parseChangedFile(value: unknown, path: string): GitBranchChangedFile {
  const file = wireExactRecord(
    value,
    ["relativePath", "oldRelativePath", "status", "added", "deleted"],
    path,
  );
  return {
    relativePath: wireRelativePath(file.relativePath, `${path}.relativePath`),
    oldRelativePath:
      file.oldRelativePath === null
        ? null
        : wireRelativePath(file.oldRelativePath, `${path}.oldRelativePath`),
    status: wireEnum(file.status, `${path}.status`, BRANCH_STATUSES),
    added: wireNullableCount(file.added, `${path}.added`, MAX_LINE_COUNT),
    deleted: wireNullableCount(file.deleted, `${path}.deleted`, MAX_LINE_COUNT),
  };
}

function parseSide(value: unknown, path: string): GitBranchSide {
  const record = wireExactRecord(value, ["text"], path);
  return {
    text: wireString(record.text, `${path}.text`, MAX_WIRE_SIDE_BYTES),
  };
}
