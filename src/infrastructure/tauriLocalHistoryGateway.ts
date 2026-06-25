import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  LocalHistoryGateway,
  LocalHistoryVersion,
} from "../domain/localHistory";

type InvokeLocalHistoryCommand = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;
type RuntimeDetector = () => boolean;

const invokeLocalHistoryCommand: InvokeLocalHistoryCommand = (command, args) =>
  invoke<unknown>(command, args);

export class TauriLocalHistoryGateway implements LocalHistoryGateway {
  constructor(
    private readonly invokeCommand: InvokeLocalHistoryCommand = invokeLocalHistoryCommand,
    private readonly isRuntimeAvailable: RuntimeDetector = isTauri,
  ) {}

  async recordSnapshot(
    rootPath: string,
    relativePath: string,
    content: string,
  ): Promise<LocalHistoryVersion | null> {
    if (!this.isRuntimeAvailable()) {
      return null;
    }

    const version = (await this.invokeCommand("record_local_history_snapshot", {
      content,
      relativePath,
      rootPath,
    })) as LocalHistoryVersion | null;

    return version ?? null;
  }

  async listVersions(
    rootPath: string,
    relativePath: string,
  ): Promise<LocalHistoryVersion[]> {
    if (!this.isRuntimeAvailable()) {
      return [];
    }

    return this.invokeCommand("get_local_history_versions", {
      relativePath,
      rootPath,
    }) as Promise<LocalHistoryVersion[]>;
  }

  async readVersion(
    rootPath: string,
    relativePath: string,
    versionId: string,
  ): Promise<string> {
    if (!this.isRuntimeAvailable()) {
      return "";
    }

    return this.invokeCommand("get_local_history_version_content", {
      relativePath,
      rootPath,
      versionId,
    }) as Promise<string>;
  }
}
