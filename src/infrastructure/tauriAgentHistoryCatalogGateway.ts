import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AgentHistoryCatalogGateway } from "../application/useAgentHistoryCatalog";
import {
  parseAgentHistoryThreadPage,
  type ReadAgentHistoryThreadsRequest,
} from "../domain/agentHistoryCatalog";
import type { ReadAgentHistoryTurnsRequest } from "../domain/agentHistory";
import { readAgentHistoryTurns } from "./tauriAgentHistoryIpcContract";
import { AGENT_TASK_ID_PATTERN } from "../domain/agentTask";
import {
  validateAgentThreadStoreOwnerRequest,
  type InvokeAgentThreadStoreCommand,
} from "./tauriAgentThreadStoreIpcContract";

export class TauriAgentHistoryCatalogGateway implements AgentHistoryCatalogGateway {
  constructor(
    private readonly invokeCommand: InvokeAgentThreadStoreCommand = (command, args) =>
      invoke(command, args),
    private readonly available: () => boolean = isTauri,
  ) {}
  async readAgentHistoryTurns(request: ReadAgentHistoryTurnsRequest) {
    if (!this.available()) return { turns: [], hasEarlier: false, beforeTurnId: null, revision: 0 };
    return readAgentHistoryTurns(this.invokeCommand, request);
  }
  async readAgentHistoryThreads(request: ReadAgentHistoryThreadsRequest) {
    const owner = validateAgentThreadStoreOwnerRequest(request);
    if (
      Object.keys(request).length !== 3 ||
      Object.keys(request).some((key) => !["rootKey", "ownerId", "beforeThreadId"].includes(key))
    )
      throw new TypeError("Invalid saved conversation request.");
    if (
      request.beforeThreadId !== null &&
      (typeof request.beforeThreadId !== "string" ||
        !AGENT_TASK_ID_PATTERN.test(request.beforeThreadId))
    )
      throw new TypeError("Invalid saved conversation cursor.");
    if (!this.available()) return { threads: [], hasEarlier: false, beforeThreadId: null };
    return parseAgentHistoryThreadPage(
      await this.invokeCommand("read_agent_history_threads", {
        request: { ...owner, beforeThreadId: request.beforeThreadId },
      }),
      request,
    );
  }
}
