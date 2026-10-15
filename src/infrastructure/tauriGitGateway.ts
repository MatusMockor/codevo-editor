import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  emptyGitStatus,
  type GitBranch,
  type GitChangedFile,
  type GitFileDiff,
  type Commit,
  type CommitDetails,
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

  async detectRepositories(
    rootPath: string,
    maxDepth?: number,
  ): Promise<string[] | null> {
    if (!this.isRuntimeAvailable()) {
      return null;
    }

    return this.invokeCommand("detect_git_repositories", {
      maxDepth,
      rootPath,
    }) as Promise<string[]>;
  }

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

  async fetch(rootPath: string): Promise<GitStatus> {
    if (!this.isRuntimeAvailable()) {
      return emptyGitStatus(rootPath);
    }

    return this.invokeCommand("fetch_git_changes", {
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
    files?: FileChange[],
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
      files,
      oldPath,
      path,
      rootPath,
    }) as Promise<DiffPayload>;
  }

  async branchList(rootPath: string): Promise<GitBranch[]> {
    if (!this.isRuntimeAvailable()) {
      return [];
    }

    return this.invokeCommand("list_git_branches", {
      rootPath,
    }) as Promise<GitBranch[]>;
  }

  async remoteBranchList(rootPath: string): Promise<GitBranch[]> {
    if (!this.isRuntimeAvailable()) {
      return [];
    }

    return this.invokeCommand("list_git_remote_branches", {
      rootPath,
    }) as Promise<GitBranch[]>;
  }

  async checkoutRemoteBranch(
    rootPath: string,
    name: string,
  ): Promise<GitBranch[]> {
    if (!this.isRuntimeAvailable()) {
      return [];
    }

    return this.invokeCommand("checkout_git_remote_branch", {
      name,
      rootPath,
    }) as Promise<GitBranch[]>;
  }

  async currentBranch(rootPath: string): Promise<string | null> {
    if (!this.isRuntimeAvailable()) {
      return null;
    }

    return this.invokeCommand("get_git_current_branch", {
      rootPath,
    }) as Promise<string | null>;
  }

  async createBranch(rootPath: string, name: string): Promise<void> {
    if (!this.isRuntimeAvailable()) {
      return;
    }

    await this.invokeCommand("create_git_branch", {
      name,
      rootPath,
    });
  }

  async deleteBranch(
    rootPath: string,
    name: string,
    options: { force: boolean },
  ): Promise<void> {
    if (!this.isRuntimeAvailable()) {
      return;
    }

    await this.invokeCommand("delete_git_branch", {
      force: options.force,
      name,
      rootPath,
    });
  }

  async switchBranch(rootPath: string, name: string): Promise<void> {
    if (!this.isRuntimeAvailable()) {
      return;
    }

    await this.invokeCommand("switch_git_branch", {
      name,
      rootPath,
    });
  }
}

export class TauriGitHistoryGateway
  extends TauriGitGateway
  implements GitHistoryGateway {}
