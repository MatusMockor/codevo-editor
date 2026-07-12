import { invoke } from "@tauri-apps/api/core";
import type {
  ArtisanRoutesGateway,
  ArtisanRoutesResult,
} from "../domain/artisanRoutes";

type InvokeCommand = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

const invokeCommand: InvokeCommand = (command, args) => invoke(command, args);

export class TauriArtisanRoutesGateway implements ArtisanRoutesGateway {
  constructor(private readonly invokeRoutesCommand = invokeCommand) {}

  async list(rootPath: string): Promise<ArtisanRoutesResult> {
    return (await this.invokeRoutesCommand("run_artisan_route_list", {
      rootPath,
    })) as ArtisanRoutesResult;
  }
}
