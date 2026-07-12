import { invoke } from "@tauri-apps/api/core";

export type PintFormatResult =
  | { status: "ok"; changedFiles?: number }
  | { status: "unavailable"; message?: string }
  | { status: "error"; message: string };

export interface PintGateway {
  format(rootPath: string, relativePath: string | null): Promise<PintFormatResult>;
}

type InvokeCommand = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

const invokeCommand: InvokeCommand = (command, args) => invoke(command, args);

export class TauriPintGateway implements PintGateway {
  constructor(private readonly invokeFormatCommand = invokeCommand) {}

  async format(
    rootPath: string,
    relativePath: string | null,
  ): Promise<PintFormatResult> {
    return (await this.invokeFormatCommand("run_pint_format", {
      rootPath,
      relativePath,
    })) as PintFormatResult;
  }
}
