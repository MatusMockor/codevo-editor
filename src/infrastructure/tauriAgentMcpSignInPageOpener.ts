import type { ExternalUrlOpenerPort } from "../application/useAgentShipFlow";
import { isAgentMcpServerAuthorizationUrl } from "../domain/agentMcpServerManagement";

export const AGENT_MCP_SIGN_IN_PAGE_OPEN_FAILED =
  "The MCP server sign-in page could not be opened.";

type OpenUrl = (url: string) => Promise<void>;

const openWithTauri: OpenUrl = async (url) => {
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
};

export class TauriAgentMcpSignInPageOpener implements ExternalUrlOpenerPort {
  constructor(private readonly openUrl: OpenUrl = openWithTauri) {}

  async openExternal(url: string): Promise<void> {
    if (!isAgentMcpServerAuthorizationUrl(url)) throw new Error(AGENT_MCP_SIGN_IN_PAGE_OPEN_FAILED);
    try {
      await this.openUrl(url);
    } catch {
      throw new Error(AGENT_MCP_SIGN_IN_PAGE_OPEN_FAILED);
    }
  }
}
