export type GitChangeStatus =
  | "added"
  | "conflicted"
  | "deleted"
  | "modified"
  | "renamed"
  | "untracked";

export interface GitChangedFile {
  isStaged: boolean;
  isUnversioned: boolean;
  oldPath: string | null;
  oldRelativePath: string | null;
  path: string;
  relativePath: string;
  status: GitChangeStatus;
}

export interface GitChangeGroup {
  changes: GitChangedFile[];
  id: "changes" | "unversioned";
  title: string;
}

export interface GitStatus {
  branch: string | null;
  changes: GitChangedFile[];
  isRepository: boolean;
  rootPath: string;
}

export interface GitRepoStatus {
  gitAvailable: boolean;
  isRepository: boolean;
}

export interface GitBranches {
  current: string | null;
  local: string[];
  remotes: Record<string, string[]>;
}

export interface Commit {
  abbrevHash: string;
  authorEmail: string;
  authorName: string;
  date: string;
  hash: string;
  labels: string[];
  parents: string[];
  subject: string;
}

export interface CommitDetails extends Commit {
  body: string;
  containingBranches: string[];
}

export interface GitCommitFilters {
  author?: string;
  branch?: string | null;
  cursor?: string;
  limit?: number;
  path?: string;
  query?: string;
}

export interface FileChange {
  isRename: boolean;
  oldPath: string | null;
  newPath: string | null;
  path: string;
  status: "A" | "M" | "D" | "R";
}

export interface CommitGraphNode {
  children: string[];
  commit: Commit;
  depth: number;
  hash: string;
  isMerge: boolean;
}

export interface DiffPayload {
  commitHash: string;
  isRename: boolean;
  language: string;
  modifiedContent: string;
  originalContent: string;
  oldPath: string | null;
  path: string;
  status: "A" | "M" | "D" | "R";
}

export interface GitFileDiff {
  change: GitChangedFile;
  language: string;
  modifiedContent: string;
  originalContent: string;
}

/**
 * A single hunk from `git diff` (or `git diff --cached`) for one file. `index`
 * is the hunk's position within that file's diff and is the stable id sent back
 * to stage/unstage exactly that hunk. `header` is the `@@ ... @@` line; `lines`
 * are the body lines with their leading `-`/`+`/` ` markers preserved.
 */
export interface GitDiffHunk {
  header: string;
  index: number;
  lines: string[];
  isStaged: boolean;
}

export interface GitBlameLine {
  author: string;
  lineNumber: number;
  sha: string;
  timestamp: number;
}

export interface GitFileHistoryEntry {
  author: string;
  sha: string;
  subject: string;
  timestamp: number;
}

export interface GitStashEntry {
  branch: string | null;
  index: number;
  message: string;
  timestamp: number;
}

export interface GitBranch {
  isCurrent: boolean;
  name: string;
}

export interface GitGateway {
  blame(rootPath: string, relativePath: string): Promise<GitBlameLine[]>;
  commit(
    rootPath: string,
    message: string,
    changes: GitChangedFile[],
  ): Promise<GitStatus>;
  fileCommitDiff(
    rootPath: string,
    relativePath: string,
    sha: string,
  ): Promise<GitFileDiff>;
  fileHistory(
    rootPath: string,
    relativePath: string,
  ): Promise<GitFileHistoryEntry[]>;
  getStatus(rootPath: string): Promise<GitStatus>;
  getDiff(rootPath: string, change: GitChangedFile): Promise<GitFileDiff>;
  getFileHunks(
    rootPath: string,
    relativePath: string,
    staged: boolean,
  ): Promise<GitDiffHunk[]>;
  push(rootPath: string): Promise<GitStatus>;
  revertFiles(rootPath: string, changes: GitChangedFile[]): Promise<GitStatus>;
  stageFiles(rootPath: string, changes: GitChangedFile[]): Promise<GitStatus>;
  stageHunk(
    rootPath: string,
    relativePath: string,
    hunkIndex: number,
  ): Promise<GitStatus>;
  unstageFiles(rootPath: string, changes: GitChangedFile[]): Promise<GitStatus>;
  unstageHunk(
    rootPath: string,
    relativePath: string,
    hunkIndex: number,
  ): Promise<GitStatus>;
  stashSave(rootPath: string, message: string): Promise<void>;
  stashList(rootPath: string): Promise<GitStashEntry[]>;
  stashApply(rootPath: string, index: number): Promise<void>;
  stashPop(rootPath: string, index: number): Promise<void>;
  stashShow(rootPath: string, index: number): Promise<string>;
  stashDrop(rootPath: string, index: number): Promise<void>;
  branchList(rootPath: string): Promise<GitBranch[]>;
  currentBranch(rootPath: string): Promise<string | null>;
  createBranch(rootPath: string, name: string): Promise<void>;
  switchBranch(rootPath: string, name: string): Promise<void>;
}

export interface GitHistoryGateway {
  getBranches(rootPath: string): Promise<GitBranches>;
  getCommitDetails(rootPath: string, commitHash: string): Promise<CommitDetails>;
  getCommitDiff(
    rootPath: string,
    commitHash: string,
    path: string,
    oldPath?: string | null,
  ): Promise<DiffPayload>;
  getCommitFiles(rootPath: string, commitHash: string): Promise<FileChange[]>;
  getCommitGraphPage(
    rootPath: string,
    cursor?: string | null,
  ): Promise<CommitGraphNode[]>;
  getCommitLog(
    rootPath: string,
    filters: GitCommitFilters,
  ): Promise<Commit[]>;
  getRepoStatus(rootPath: string): Promise<GitRepoStatus>;
}

export function gitChangeKey(change: GitChangedFile): string {
  return `${change.isStaged ? "staged" : "worktree"}:${change.relativePath}`;
}

export function emptyGitStatus(rootPath: string | null = null): GitStatus {
  return {
    branch: null,
    changes: [],
    isRepository: false,
    rootPath: rootPath || "",
  };
}

export function gitStatusLabel(status: GitChangeStatus): string {
  if (status === "added") {
    return "A";
  }

  if (status === "deleted") {
    return "D";
  }

  if (status === "renamed") {
    return "R";
  }

  if (status === "untracked") {
    return "U";
  }

  if (status === "conflicted") {
    return "!";
  }

  return "M";
}

export function gitStatusTitle(status: GitChangeStatus): string {
  if (status === "added") {
    return "Added";
  }

  if (status === "deleted") {
    return "Deleted";
  }

  if (status === "renamed") {
    return "Renamed";
  }

  if (status === "untracked") {
    return "Untracked";
  }

  if (status === "conflicted") {
    return "Conflicted";
  }

  return "Modified";
}

export function groupGitChanges(changes: GitChangedFile[]): GitChangeGroup[] {
  const tracked = changes.filter((change) => !change.isUnversioned);
  const unversioned = changes.filter((change) => change.isUnversioned);
  const groups: GitChangeGroup[] = [];

  if (tracked.length > 0) {
    groups.push({
      changes: tracked,
      id: "changes",
      title: "Changes",
    });
  }

  if (unversioned.length > 0) {
    groups.push({
      changes: unversioned,
      id: "unversioned",
      title: "Unversioned Files",
    });
  }

  return groups;
}

export function hasStagedGitChanges(changes: GitChangedFile[]): boolean {
  return changes.some((change) => change.isStaged);
}

const UNCOMMITTED_BLAME_SHA = /^0+$/;

export function isUncommittedBlameLine(line: GitBlameLine): boolean {
  return UNCOMMITTED_BLAME_SHA.test(line.sha);
}

export function gitBlameAnnotation(
  line: GitBlameLine,
  now: number = Date.now(),
): string {
  const author = line.author.trim() || "Unknown";

  if (isUncommittedBlameLine(line)) {
    return author;
  }

  return `${author}, ${gitBlameRelativeDate(line.timestamp, now)}`;
}

export function gitBlameRelativeDate(
  timestampSeconds: number,
  now: number = Date.now(),
): string {
  const elapsedSeconds = Math.max(0, Math.floor(now / 1000) - timestampSeconds);

  if (elapsedSeconds < 60) {
    return "just now";
  }

  const units: Array<{ label: string; seconds: number }> = [
    { label: "year", seconds: 365 * 86400 },
    { label: "month", seconds: 30 * 86400 },
    { label: "week", seconds: 7 * 86400 },
    { label: "day", seconds: 86400 },
    { label: "hour", seconds: 3600 },
    { label: "minute", seconds: 60 },
  ];

  for (const unit of units) {
    const value = Math.floor(elapsedSeconds / unit.seconds);

    if (value >= 1) {
      return `${value} ${unit.label}${value === 1 ? "" : "s"} ago`;
    }
  }

  return "just now";
}
