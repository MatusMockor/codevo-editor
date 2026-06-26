import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  emptyGitStatus,
  type GitBlameLine,
  type GitChangedFile,
  type GitFileDiff,
  type GitFileHistoryEntry,
  type GitGateway,
  type GitStashEntry,
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

  async blame(rootPath: string, relativePath: string): Promise<GitBlameLine[]> {
    if (!this.isRuntimeAvailable()) {
      return [];
    }

    return this.invokeCommand("get_git_blame", {
      relativePath,
      rootPath,
    }) as Promise<GitBlameLine[]>;
  }

  async fileHistory(
    rootPath: string,
    relativePath: string,
  ): Promise<GitFileHistoryEntry[]> {
    if (!this.isRuntimeAvailable()) {
      return [];
    }

    return this.invokeCommand("get_git_file_history", {
      relativePath,
      rootPath,
    }) as Promise<GitFileHistoryEntry[]>;
  }

  async fileCommitDiff(
    rootPath: string,
    relativePath: string,
    sha: string,
  ): Promise<GitFileDiff> {
    if (!this.isRuntimeAvailable()) {
      return {
        change: {
          isStaged: false,
          isUnversioned: false,
          oldPath: null,
          oldRelativePath: null,
          path: relativePath,
          relativePath,
          status: "modified",
        },
        language: "plaintext",
        modifiedContent: "",
        originalContent: "",
      };
    }

    return this.invokeCommand("get_git_file_commit_diff", {
      relativePath,
      rootPath,
      sha,
    }) as Promise<GitFileDiff>;
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

  async stashSave(rootPath: string, message: string): Promise<void> {
    if (!this.isRuntimeAvailable()) {
      return;
    }

    await this.invokeCommand("save_git_stash", {
      message,
      rootPath,
    });
  }

  async stashList(rootPath: string): Promise<GitStashEntry[]> {
    if (!this.isRuntimeAvailable()) {
      return [];
    }

    return this.invokeCommand("get_git_stash_list", {
      rootPath,
    }) as Promise<GitStashEntry[]>;
  }

  async stashApply(rootPath: string, index: number): Promise<void> {
    if (!this.isRuntimeAvailable()) {
      return;
    }

    await this.invokeCommand("stash_apply_git", {
      index: String(index),
      rootPath,
    });
  }

  async stashPop(rootPath: string, index: number): Promise<void> {
    if (!this.isRuntimeAvailable()) {
      return;
    }

    await this.invokeCommand("stash_pop_git", {
      index: String(index),
      rootPath,
    });
  }

  async stashShow(rootPath: string, index: number): Promise<string> {
    if (!this.isRuntimeAvailable()) {
      return "";
    }

    return this.invokeCommand("get_git_stash_diff", {
      index: String(index),
      rootPath,
    }) as Promise<string>;
  }

  async stashDrop(rootPath: string, index: number): Promise<void> {
    if (!this.isRuntimeAvailable()) {
      return;
    }

    await this.invokeCommand("stash_drop_git", {
      index: String(index),
      rootPath,
    });
  }
}
