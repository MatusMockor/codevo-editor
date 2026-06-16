import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  emptyPhpFileOutline,
  type PhpFileOutline,
  type PhpFileOutlineGateway,
} from "../domain/phpFileOutline";

type InvokePhpFileOutlineCommand = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<PhpFileOutline>;
type RuntimeDetector = () => boolean;

const invokePhpFileOutlineCommand: InvokePhpFileOutlineCommand = (
  command,
  args,
) => invoke<PhpFileOutline>(command, args);

export class TauriPhpFileOutlineGateway implements PhpFileOutlineGateway {
  constructor(
    private readonly invokeCommand: InvokePhpFileOutlineCommand = invokePhpFileOutlineCommand,
    private readonly isRuntimeAvailable: RuntimeDetector = isTauri,
  ) {}

  getPhpFileOutline(root: string, path: string): Promise<PhpFileOutline> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve(emptyPhpFileOutline());
    }

    return this.invokeCommand("get_php_file_outline", { path, root });
  }
}
