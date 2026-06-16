import { invoke } from "@tauri-apps/api/core";
import type {
  ProjectSymbolSearchGateway,
  ProjectSymbolSearchResult,
} from "../domain/projectSymbols";

export class TauriProjectSymbolSearchGateway
  implements ProjectSymbolSearchGateway
{
  searchProjectSymbols(
    root: string,
    query: string,
    limit: number,
  ): Promise<ProjectSymbolSearchResult[]> {
    return invoke<ProjectSymbolSearchResult[]>("search_project_symbols", {
      root,
      query,
      limit,
    });
  }
}
