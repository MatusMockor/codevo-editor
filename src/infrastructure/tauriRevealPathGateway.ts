import { invoke, isTauri } from "@tauri-apps/api/core";

export const REVEAL_PATH_UNAVAILABLE = "Revealing a path requires the native runtime.";
export const REVEAL_PATH_FAILED = "Unable to reveal that path in the file manager.";

export interface RevealPathRequest {
  readonly rootPath: string;
  readonly path: string;
}

export interface RevealPathGateway {
  revealPath(request: RevealPathRequest): Promise<void>;
}

export type RevealPathCommand = (
  command: "reveal_item_in_dir",
  args: RevealPathRequest,
) => Promise<unknown>;

export type RevealPathRuntimeDetector = () => boolean;

const invokeRevealPathCommand: RevealPathCommand = (command, args) =>
  invoke(command, { path: args.path, rootPath: args.rootPath });

export class TauriRevealPathGateway implements RevealPathGateway {
  constructor(
    private readonly invokeCommand: RevealPathCommand = invokeRevealPathCommand,
    private readonly isRuntimeAvailable: RevealPathRuntimeDetector = isTauri,
  ) {}

  async revealPath(request: RevealPathRequest): Promise<void> {
    if (!this.isRuntimeAvailable()) {
      throw new Error(REVEAL_PATH_UNAVAILABLE);
    }
    try {
      await this.invokeCommand("reveal_item_in_dir", request);
    } catch {
      throw new Error(REVEAL_PATH_FAILED);
    }
  }
}
