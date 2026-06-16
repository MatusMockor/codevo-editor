export type GitChangeStatus =
  | "added"
  | "conflicted"
  | "deleted"
  | "modified"
  | "renamed"
  | "untracked";

export interface GitChangedFile {
  oldPath: string | null;
  oldRelativePath: string | null;
  path: string;
  relativePath: string;
  status: GitChangeStatus;
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
  getStatus(rootPath: string): Promise<GitStatus>;
  getDiff(rootPath: string, change: GitChangedFile): Promise<GitFileDiff>;
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
