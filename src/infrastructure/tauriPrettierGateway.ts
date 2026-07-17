import { invoke } from "@tauri-apps/api/core";
import type {
  PrettierFormatResult,
  PrettierFormattingGateway,
} from "../domain/prettierFormatting";

type InvokeCommand = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

const invokeCommand: InvokeCommand = (command, args) => invoke(command, args);

export class TauriPrettierGateway implements PrettierFormattingGateway {
  constructor(private readonly invokeFormatCommand = invokeCommand) {}

  async format(
    rootPath: string,
    relativePath: string,
    content: string,
  ): Promise<PrettierFormatResult> {
    const result = await this.invokeFormatCommand("run_prettier_format", {
      rootPath,
      relativePath,
      content,
    });

    return result as PrettierFormatResult;
  }
}
