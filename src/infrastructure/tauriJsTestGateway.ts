import { invoke } from "@tauri-apps/api/core";
import type { TestGateway, TestRunResponse } from "../domain/testResults";

type InvokeCommand = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

const invokeCommand: InvokeCommand = (command, args) => invoke(command, args);

export class TauriJsTestGateway implements TestGateway {
  constructor(private readonly invokeTestCommand = invokeCommand) {}

  async run(rootPath: string, filter?: string): Promise<TestRunResponse> {
    return (await this.invokeTestCommand("run_js_tests_json", {
      filter,
      rootPath,
    })) as TestRunResponse;
  }
}
