import { invoke } from "@tauri-apps/api/core";
import type {
  EslintAnalysisResult,
  EslintDiagnosticsGateway,
} from "../domain/eslintDiagnostics";

type InvokeCommand = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

const invokeCommand: InvokeCommand = (command, args) => invoke(command, args);

export class TauriEslintDiagnosticsGateway implements EslintDiagnosticsGateway {
  constructor(private readonly invokeAnalysisCommand = invokeCommand) {}

  async analyse(
    rootPath: string,
    binaryPath: string | null,
  ): Promise<EslintAnalysisResult> {
    return (await this.invokeAnalysisCommand("run_eslint_analysis", {
      rootPath,
      binaryPath,
    })) as EslintAnalysisResult;
  }
}
