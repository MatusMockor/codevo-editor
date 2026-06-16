import { invoke, isTauri } from "@tauri-apps/api/core";
import { emptyPhpTree, type PhpTree, type PhpTreeGateway } from "../domain/phpTree";

type InvokePhpTreeCommand = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<PhpTree>;
type RuntimeDetector = () => boolean;

const invokePhpTreeCommand: InvokePhpTreeCommand = (command, args) =>
  invoke<PhpTree>(command, args);

export class TauriPhpTreeGateway implements PhpTreeGateway {
  constructor(
    private readonly invokeCommand: InvokePhpTreeCommand = invokePhpTreeCommand,
    private readonly isRuntimeAvailable: RuntimeDetector = isTauri,
  ) {}

  getPhpTree(root: string): Promise<PhpTree> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve(emptyPhpTree());
    }

    return this.invokeCommand("get_php_tree", { root });
  }
}
