import { invoke } from "@tauri-apps/api/core";
import type { AgentCommandCatalogGateway } from "../application/agentCommandCatalogGateway";
import {
  parseAgentCommandCatalog,
  parseAgentCommandCatalogRequest,
  type AgentCommandCatalog,
  type AgentCommandCatalogRequest,
} from "../domain/agentCommandCatalog";

export const GET_AGENT_COMMAND_CATALOG_IPC_COMMAND = "get_agent_command_catalog" as const;

export class TauriAgentCommandCatalogGateway implements AgentCommandCatalogGateway {
  async read(request: AgentCommandCatalogRequest): Promise<AgentCommandCatalog> {
    const { repositoryRoot, provider } = parseAgentCommandCatalogRequest(request);
    const catalog = parseAgentCommandCatalog(
      await invoke<unknown>(GET_AGENT_COMMAND_CATALOG_IPC_COMMAND, {
        request: { repositoryRoot, provider },
      }),
    );
    if (catalog.provider !== provider)
      throw new TypeError("Agent command catalog answered for a different provider.");
    return catalog;
  }
}
