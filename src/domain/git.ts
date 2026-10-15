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
  upstream?: GitUpstreamTracking | null;
}

export interface GitUpstreamTracking {
  ahead: number;
  behind: number;
  branch: string;
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
  readonly allBranches?: boolean;
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
  previewUnavailableReason?: "binary" | "large" | null;
}

export interface GitBranch {
  isCurrent: boolean;
  name: string;
}

export interface GitGateway {
  commit(
    rootPath: string,
    message: string,
    changes: GitChangedFile[],
  ): Promise<GitStatus>;
  /**
   * Finds every git repository nested inside `rootPath` (a PhpStorm-style
   * multi-repo "directory mapping" workspace), returning root-relative paths.
   * The root itself is represented by an empty string when it is a
   * repository. `maxDepth` bounds how many directory levels below the root
   * are walked; omit it to use the backend's default.
   *
   * Optional: existing gateways/mocks predate this capability and are not
   * required to implement it.
   */
  detectRepositories?(rootPath: string, maxDepth?: number): Promise<string[] | null>;
  getStatus(rootPath: string): Promise<GitStatus>;
  getDiff(rootPath: string, change: GitChangedFile): Promise<GitFileDiff>;
  push(rootPath: string): Promise<GitStatus>;
  stageFiles(rootPath: string, changes: GitChangedFile[]): Promise<GitStatus>;
  branchList(rootPath: string): Promise<GitBranch[]>;
  remoteBranchList?(rootPath: string): Promise<GitBranch[]>;
  checkoutRemoteBranch?(
    rootPath: string,
    name: string,
  ): Promise<GitBranch[]>;
  currentBranch(rootPath: string): Promise<string | null>;
  createBranch(rootPath: string, name: string): Promise<void>;
  deleteBranch?(
    rootPath: string,
    name: string,
    options: { force: boolean },
  ): Promise<void>;
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
    files?: FileChange[],
  ): Promise<DiffPayload>;
  getCommitFiles(rootPath: string, commitHash: string): Promise<FileChange[]>;
  getCommitLog(
    rootPath: string,
    filters: GitCommitFilters,
  ): Promise<Commit[]>;
  getRepoStatus(rootPath: string): Promise<GitRepoStatus>;
}

export function gitChangeKey(change: GitChangedFile): string {
  return `${change.isStaged ? "staged" : "worktree"}:${change.relativePath}`;
}

/**
 * A commit/reconcile inclusion key that stays unique across every repository in
 * a multi-repo (PhpStorm-style directory-mapping) workspace.
 *
 * `gitChangeKey` alone is `{staged|worktree}:{relativePath}`, and `relativePath`
 * is repository-root-relative, so two repositories that each hold a file with
 * the same relative path collide: a primary `README.md` and a nested
 * `workbench/lcsk/x/README.md` both key to `worktree:README.md`. Selecting the
 * one the panel shows would then silently match the one it does not. Prefixing
 * with the repository's workspace-root-relative directory removes the ambiguity.
 *
 * The primary (workspace-root) repository uses the empty prefix and therefore
 * returns a key byte-identical to {@link gitChangeKey}. The single-repo UI
 * surface (GitChangesPanel keys its primary changes with `gitChangeKey`) keeps
 * working unchanged, and single-repo behaviour stays identical.
 */
export function gitChangeKeyForRepository(
  repositoryRootRelative: string,
  change: GitChangedFile,
): string {
  if (repositoryRootRelative === "") {
    return gitChangeKey(change);
  }

  return `${repositoryRootRelative}:${gitChangeKey(change)}`;
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
