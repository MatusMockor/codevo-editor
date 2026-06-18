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

export interface GitFileDiff {
  change: GitChangedFile;
  language: string;
  modifiedContent: string;
  originalContent: string;
}

export interface GitGateway {
  commit(rootPath: string, message: string): Promise<GitStatus>;
  getStatus(rootPath: string): Promise<GitStatus>;
  getDiff(rootPath: string, change: GitChangedFile): Promise<GitFileDiff>;
  push(rootPath: string): Promise<GitStatus>;
  revertFiles(rootPath: string, changes: GitChangedFile[]): Promise<GitStatus>;
  stageFiles(rootPath: string, changes: GitChangedFile[]): Promise<GitStatus>;
  unstageFiles(rootPath: string, changes: GitChangedFile[]): Promise<GitStatus>;
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
