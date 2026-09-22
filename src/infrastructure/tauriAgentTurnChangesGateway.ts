import { invoke } from "@tauri-apps/api/core";
import {
  isAgentTurnChangePath,
  parseAgentTurnChangeSummary,
  parseAgentTurnFileDiff,
  type AgentTurnChangesGateway,
  type AgentTurnChangeSummary,
  type AgentTurnFileDiff,
} from "../domain/agentTurnChanges";

export type InvokeAgentTurnChanges = (
  command: string,
  args: Readonly<{
    request: Readonly<{ rootPath: string; turnId: string; relativePath?: string }>;
  }>,
) => Promise<unknown>;

const encoder = new TextEncoder();
function validateAuthority(rootPath: string, turnId: string): void {
  if (
    typeof rootPath !== "string" ||
    !rootPath.startsWith("/") ||
    encoder.encode(rootPath).length > 4096 ||
    /[\u0000-\u001f\u007f]/u.test(rootPath) ||
    typeof turnId !== "string" ||
    !turnId ||
    encoder.encode(turnId).length > 256 ||
    /[\u0000-\u001f\u007f]/u.test(turnId)
  )
    throw new Error("Invalid turn changes authority.");
}

/** Native turn snapshots remain authoritative; responses must match the captured request. */
export class TauriAgentTurnChangesGateway implements AgentTurnChangesGateway {
  constructor(private readonly invokeCommand: InvokeAgentTurnChanges = invoke) {}

  async getSummary(rootPath: string, turnId: string): Promise<AgentTurnChangeSummary> {
    validateAuthority(rootPath, turnId);
    const result = parseAgentTurnChangeSummary(
      await this.invokeCommand("agent_turn_changes_get", {
        request: { rootPath, turnId },
      }),
    );
    if (result.turnId !== turnId) throw new Error("Turn changes response belongs to another turn.");
    return result;
  }

  async getFileDiff(
    rootPath: string,
    turnId: string,
    relativePath: string,
  ): Promise<AgentTurnFileDiff> {
    validateAuthority(rootPath, turnId);
    if (!isAgentTurnChangePath(relativePath)) throw new Error("Invalid turn diff path.");
    const result = parseAgentTurnFileDiff(
      await this.invokeCommand("agent_turn_changes_diff", {
        request: { rootPath, turnId, relativePath },
      }),
    );
    if (result.relativePath !== relativePath)
      throw new Error("Turn diff response belongs to another file.");
    return result;
  }
}
