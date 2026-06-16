import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  emptyGitStatus,
  type GitChangedFile,
  type GitFileDiff,
  type GitGateway,
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
}
