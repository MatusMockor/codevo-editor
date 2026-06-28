import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  emptyGitStatus,
  type GitChangedFile,
  type GitFileDiff,
  type Commit,
  type CommitDetails,
  type CommitGraphNode,
  type DiffPayload,
  type FileChange,
  type GitBranches,
  type GitGateway,
  type GitHistoryGateway,
  type GitRepoStatus,
  type GitCommitFilters,
  type GitStatus,
} from "../domain/git";

type InvokeGitCommand = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;
type RuntimeDetector = () => boolean;

const invokeGitCommand: InvokeGitCommand = (command, args) =>
  invoke<unknown>(command, args);

export class TauriGitGateway implements GitGateway {
  constructor(
    private readonly invokeCommand: InvokeGitCommand = invokeGitCommand,
    private readonly isRuntimeAvailable: RuntimeDetector = isTauri,
  ) {}

  async getStatus(rootPath: string): Promise<GitStatus> {
    if (!this.isRuntimeAvailable()) {
      return emptyGitStatus(rootPath);
    }

    return this.invokeCommand("get_git_status", { rootPath }) as Promise<GitStatus>;
  }

  async getDiff(
    rootPath: string,
    change: GitChangedFile,
  ): Promise<GitFileDiff> {
    if (!this.isRuntimeAvailable()) {
      return {
        change,
        language: "plaintext",
        modifiedContent: "",
        originalContent: "",
      };
    }

    return this.invokeCommand("get_git_diff", {
      change,
      rootPath,
    }) as Promise<GitFileDiff>;
  }

  async stageFiles(
    rootPath: string,
    changes: GitChangedFile[],
  ): Promise<GitStatus> {
    if (!this.isRuntimeAvailable()) {
      return emptyGitStatus(rootPath);
    }

    return this.invokeCommand("stage_git_files", {
      changes,
      rootPath,
    }) as Promise<GitStatus>;
  }

  async unstageFiles(
    rootPath: string,
    changes: GitChangedFile[],
  ): Promise<GitStatus> {
    if (!this.isRuntimeAvailable()) {
      return emptyGitStatus(rootPath);
    }

    return this.invokeCommand("unstage_git_files", {
      changes,
      rootPath,
    }) as Promise<GitStatus>;
  }

  async revertFiles(
    rootPath: string,
    changes: GitChangedFile[],
  ): Promise<GitStatus> {
    if (!this.isRuntimeAvailable()) {
      return emptyGitStatus(rootPath);
    }

    return this.invokeCommand("revert_git_files", {
      changes,
      rootPath,
    }) as Promise<GitStatus>;
  }

  async commit(
    rootPath: string,
    message: string,
    changes: GitChangedFile[],
  ): Promise<GitStatus> {
    if (!this.isRuntimeAvailable()) {
      return emptyGitStatus(rootPath);
    }

    return this.invokeCommand("commit_git_changes", {
      changes,
      message,
      rootPath,
    }) as Promise<GitStatus>;
  }

  async push(rootPath: string): Promise<GitStatus> {
    if (!this.isRuntimeAvailable()) {
      return emptyGitStatus(rootPath);
    }

    return this.invokeCommand("push_git_changes", {
      rootPath,
    }) as Promise<GitStatus>;
  }

  async getRepoStatus(rootPath: string): Promise<GitRepoStatus> {
    if (!this.isRuntimeAvailable()) {
      return {
        gitAvailable: false,
        isRepository: false,
      };
    }

    return this.invokeCommand("get_git_repo_status", {
      rootPath,
    }) as Promise<GitRepoStatus>;
  }

  async getBranches(rootPath: string): Promise<GitBranches> {
    if (!this.isRuntimeAvailable()) {
      return {
        current: null,
        local: [],
        remotes: {},
      };
    }

    return this.invokeCommand("get_git_branches", {
      rootPath,
    }) as Promise<GitBranches>;
  }

  async getCommitLog(
    rootPath: string,
    filters: GitCommitFilters,
  ): Promise<Commit[]> {
    if (!this.isRuntimeAvailable()) {
      return [];
    }

    return this.invokeCommand("get_git_commit_log", {
      filters,
      rootPath,
    }) as Promise<Commit[]>;
  }

  async getCommitGraphPage(
    rootPath: string,
    cursor: string | null = null,
  ): Promise<CommitGraphNode[]> {
    if (!this.isRuntimeAvailable()) {
      return [];
    }

    return this.invokeCommand("get_git_commit_graph_page", {
      cursor,
      rootPath,
    }) as Promise<CommitGraphNode[]>;
  }

  async getCommitDetails(
    rootPath: string,
    commitHash: string,
  ): Promise<CommitDetails> {
    if (!this.isRuntimeAvailable()) {
      throw new Error("Git unavailable.");
    }

    return this.invokeCommand("get_git_commit_details", {
      commitHash,
      rootPath,
    }) as Promise<CommitDetails>;
  }

  async getCommitFiles(
    rootPath: string,
    commitHash: string,
  ): Promise<FileChange[]> {
    if (!this.isRuntimeAvailable()) {
      return [];
    }

    return this.invokeCommand("get_git_commit_files", {
      commitHash,
      rootPath,
    }) as Promise<FileChange[]>;
  }

  async getCommitDiff(
    rootPath: string,
    commitHash: string,
    path: string,
    oldPath?: string | null,
  ): Promise<DiffPayload> {
    if (!this.isRuntimeAvailable()) {
      return {
        commitHash,
        isRename: false,
        language: "plaintext",
        modifiedContent: "",
        oldPath: oldPath ?? null,
        originalContent: "",
        path,
        status: "M",
      };
    }

    return this.invokeCommand("get_git_commit_diff", {
      commitHash,
      oldPath,
      path,
      rootPath,
    }) as Promise<DiffPayload>;
  }
}

export class TauriGitHistoryGateway
  extends TauriGitGateway
  implements GitHistoryGateway {}
