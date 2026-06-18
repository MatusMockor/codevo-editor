import { invoke, isTauri } from "@tauri-apps/api/core";
import type { WorkspaceRuntimeLifecycleGateway } from "../domain/workspaceRuntimeLifecycle";

const DEFAULT_RUNTIME_COMMANDS = {
  disposeWorkspace: "dispose_workspace_root",
};

type InvokeWorkspaceRuntimeLifecycleCommand = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;
type RuntimeDetector = () => boolean;

const invokeWorkspaceRuntimeLifecycleCommand: InvokeWorkspaceRuntimeLifecycleCommand = (
  command,
  args,
) => invoke(command, args);

export interface TauriWorkspaceRuntimeLifecycleCommands {
  disposeWorkspace: string;
}

export class TauriWorkspaceRuntimeLifecycleGateway
  implements WorkspaceRuntimeLifecycleGateway
{
  constructor(
    private readonly invokeCommand: InvokeWorkspaceRuntimeLifecycleCommand =
      invokeWorkspaceRuntimeLifecycleCommand,
    private readonly isRuntimeAvailable: RuntimeDetector = isTauri,
    private readonly commands: TauriWorkspaceRuntimeLifecycleCommands =
      DEFAULT_RUNTIME_COMMANDS,
  ) {}

  disposeWorkspace(rootPath: string): Promise<void> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve();
    }

    return this.invokeCommand(this.commands.disposeWorkspace, {
      rootPath,
    }) as Promise<void>;
  }
}
