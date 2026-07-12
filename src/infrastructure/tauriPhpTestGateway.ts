import { invoke } from "@tauri-apps/api/core";
import type {
  PhpTestGateway,
  PhpTestRunResponse,
} from "../domain/phpTestResults";

type InvokeCommand = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

const invokeCommand: InvokeCommand = (command, args) => invoke(command, args);

export class TauriPhpTestGateway implements PhpTestGateway {
  constructor(private readonly invokeTestCommand = invokeCommand) {}

  async run(rootPath: string): Promise<PhpTestRunResponse> {
    return (await this.invokeTestCommand("run_php_tests_junit", {
      rootPath,
    })) as PhpTestRunResponse;
  }
}
