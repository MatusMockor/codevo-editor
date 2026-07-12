import { invoke } from "@tauri-apps/api/core";
import type {
  PhpstanAnalysisResult,
  PhpstanDiagnosticsGateway,
} from "../domain/phpstanDiagnostics";

type InvokeCommand = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

const invokeCommand: InvokeCommand = (command, args) => invoke(command, args);

export class TauriPhpstanDiagnosticsGateway
  implements PhpstanDiagnosticsGateway
{
  constructor(private readonly invokeAnalysisCommand = invokeCommand) {}

  async analyse(
    rootPath: string,
    binaryPath: string | null,
    configPath: string | null,
  ): Promise<PhpstanAnalysisResult> {
    return (await this.invokeAnalysisCommand("run_phpstan_analysis", {
      rootPath,
      binaryPath,
      configPath,
    })) as PhpstanAnalysisResult;
  }
}
