import {
  wireArray,
  wireBoolean,
  wireCount,
  wireExactRecord,
  wireNullableCount,
  wireNullableString,
  wireObjectId,
  wireRelativePath,
  wireString,
  wireStringArray,
} from "./wireValue";

export const MAX_GIT_SURFACE_UNPUSHED = 20;
export const MAX_GIT_SURFACE_LINE_STATS = 2_000;
export const MAX_GIT_SURFACE_BRANCHES = 200;
export const MAX_GIT_SURFACE_WORKTREE_BRANCHES = 64;
const MAX_REF_BYTES = 512;
const MAX_SUBJECT_BYTES = 200;
const MAX_SHORT_SHA_BYTES = 12;
const MAX_COUNT = 1_000_000;
const MAX_LINE_COUNT = 100_000_000;

export interface GitSurfaceTarget {
  readonly repositoryRoot: string;
  readonly worktreePath: string | null;
}

export interface GitUnpushedCommit {
  readonly sha: string;
  readonly shortSha: string;
  readonly subject: string;
  readonly authoredAtEpochSeconds: number;
}

export interface GitLineStat {
  readonly relativePath: string;
  readonly added: number | null;
  readonly deleted: number | null;
}

export interface GitSurfaceUpstream {
  readonly name: string;
  readonly ahead: number;
  readonly behind: number;
}

export interface GitSurfaceStatus {
  readonly branch: string | null;
  readonly defaultBase: string | null;
  readonly hasRemote: boolean;
  readonly upstream: GitSurfaceUpstream | null;
  readonly unpushed: ReadonlyArray<GitUnpushedCommit>;
  readonly unpushedTruncated: boolean;
  readonly lineStats: ReadonlyArray<GitLineStat>;
  readonly lineStatsTruncated: boolean;
  readonly localBranches: ReadonlyArray<string>;
  readonly remoteBranches: ReadonlyArray<string>;
  readonly worktreeBranches: ReadonlyArray<string>;
  readonly branchesTruncated: boolean;
}

export interface GitSurfaceStatusGateway {
  getSurfaceStatus(target: GitSurfaceTarget): Promise<GitSurfaceStatus>;
}

const STATUS_KEYS = [
  "branch",
  "defaultBase",
  "hasRemote",
  "upstream",
  "unpushed",
  "unpushedTruncated",
  "lineStats",
  "lineStatsTruncated",
  "localBranches",
  "remoteBranches",
  "worktreeBranches",
  "branchesTruncated",
] as const;

export function parseGitSurfaceStatus(value: unknown, path = "gitSurfaceStatus"): GitSurfaceStatus {
  const record = wireExactRecord(value, STATUS_KEYS, path);
  return {
    branch: wireNullableString(record.branch, `${path}.branch`, MAX_REF_BYTES),
    defaultBase: wireNullableString(record.defaultBase, `${path}.defaultBase`, MAX_REF_BYTES),
    hasRemote: wireBoolean(record.hasRemote, `${path}.hasRemote`),
    upstream: parseUpstream(record.upstream, `${path}.upstream`),
    unpushed: wireArray(record.unpushed, `${path}.unpushed`, MAX_GIT_SURFACE_UNPUSHED).map(
      (item, index) => parseCommit(item, `${path}.unpushed[${index}]`),
    ),
    unpushedTruncated: wireBoolean(record.unpushedTruncated, `${path}.unpushedTruncated`),
    lineStats: wireArray(record.lineStats, `${path}.lineStats`, MAX_GIT_SURFACE_LINE_STATS).map(
      (item, index) => parseLineStat(item, `${path}.lineStats[${index}]`),
    ),
    lineStatsTruncated: wireBoolean(record.lineStatsTruncated, `${path}.lineStatsTruncated`),
    localBranches: wireStringArray(
      record.localBranches,
      `${path}.localBranches`,
      MAX_GIT_SURFACE_BRANCHES,
      MAX_REF_BYTES,
    ),
    remoteBranches: wireStringArray(
      record.remoteBranches,
      `${path}.remoteBranches`,
      MAX_GIT_SURFACE_BRANCHES,
      MAX_REF_BYTES,
    ),
    worktreeBranches: wireStringArray(
      record.worktreeBranches,
      `${path}.worktreeBranches`,
      MAX_GIT_SURFACE_WORKTREE_BRANCHES,
      MAX_REF_BYTES,
    ),
    branchesTruncated: wireBoolean(record.branchesTruncated, `${path}.branchesTruncated`),
  };
}

function parseUpstream(value: unknown, path: string): GitSurfaceUpstream | null {
  if (value === null) {
    return null;
  }
  const record = wireExactRecord(value, ["name", "ahead", "behind"], path);
  return {
    name: wireString(record.name, `${path}.name`, MAX_REF_BYTES),
    ahead: wireCount(record.ahead, `${path}.ahead`, MAX_COUNT),
    behind: wireCount(record.behind, `${path}.behind`, MAX_COUNT),
  };
}

function parseCommit(value: unknown, path: string): GitUnpushedCommit {
  const record = wireExactRecord(
    value,
    ["sha", "shortSha", "subject", "authoredAtEpochSeconds"],
    path,
  );
  return {
    sha: wireObjectId(record.sha, `${path}.sha`),
    shortSha: wireString(record.shortSha, `${path}.shortSha`, MAX_SHORT_SHA_BYTES),
    subject: wireString(record.subject, `${path}.subject`, MAX_SUBJECT_BYTES),
    authoredAtEpochSeconds: parseEpochSeconds(
      record.authoredAtEpochSeconds,
      `${path}.authoredAtEpochSeconds`,
    ),
  };
}

function parseLineStat(value: unknown, path: string): GitLineStat {
  const record = wireExactRecord(value, ["relativePath", "added", "deleted"], path);
  return {
    relativePath: wireRelativePath(record.relativePath, `${path}.relativePath`),
    added: wireNullableCount(record.added, `${path}.added`, MAX_LINE_COUNT),
    deleted: wireNullableCount(record.deleted, `${path}.deleted`, MAX_LINE_COUNT),
  };
}

function parseEpochSeconds(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new TypeError(`Invalid ${path}: expected a safe integer.`);
  }
  return value;
}
