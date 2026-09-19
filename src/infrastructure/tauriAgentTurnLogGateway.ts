import { invoke } from "@tauri-apps/api/core";
import type { AgentTurnLogGateway } from "../application/agentTurnLogPorts";
import type {
  AgentTurnLogLease,
  AgentTurnLogPage,
  AgentTurnLogSummary,
  AppendAgentTurnLogReceipt,
  AppendAgentTurnLogRequest,
  DeleteAgentThreadLogRequest,
  DeleteAgentThreadLogResult,
  OpenAgentTurnLogRequest,
  ReadAgentTurnLogPageRequest,
  SummarizeAgentTurnLogsRequest,
} from "../domain/agentTurnLog";
import {
  agentTurnLogFailureFrom,
  parseAgentTurnLogLease,
  parseAgentTurnLogPage,
  parseAgentTurnLogSummaries,
  parseAppendAgentTurnLogReceipt,
  parseDeleteAgentThreadLogResult,
  validateAppendAgentTurnLogRequest,
  validateDeleteAgentThreadLogRequest,
  validateOpenAgentTurnLogRequest,
  validateReadAgentTurnLogPageRequest,
  validateSummarizeAgentTurnLogsRequest,
} from "../domain/agentTurnLogWire";

export type InvokeAgentTurnLogCommand = (
  command: string,
  args: Readonly<{ request: unknown }>,
) => Promise<unknown>;

export const AGENT_TURN_LOG_COMMANDS = {
  open: "open_agent_turn_log",
  append: "append_agent_turn_log",
  readPage: "read_agent_turn_log_page",
  summarize: "summarize_agent_turn_logs",
  deleteThreadLog: "delete_agent_thread_log",
} as const;

export class TauriAgentTurnLogGateway implements AgentTurnLogGateway {
  constructor(private readonly invokeCommand: InvokeAgentTurnLogCommand = invoke) {}

  async openTurnLog(request: OpenAgentTurnLogRequest): Promise<AgentTurnLogLease> {
    const validated = validateOpenAgentTurnLogRequest(request);
    return parseAgentTurnLogLease(await this.send(AGENT_TURN_LOG_COMMANDS.open, validated));
  }

  async appendTurnLog(request: AppendAgentTurnLogRequest): Promise<AppendAgentTurnLogReceipt> {
    const validated = validateAppendAgentTurnLogRequest(request);
    return parseAppendAgentTurnLogReceipt(
      await this.send(AGENT_TURN_LOG_COMMANDS.append, validated),
    );
  }

  async readTurnLogPage(request: ReadAgentTurnLogPageRequest): Promise<AgentTurnLogPage> {
    const validated = validateReadAgentTurnLogPageRequest(request);
    return parseAgentTurnLogPage(await this.send(AGENT_TURN_LOG_COMMANDS.readPage, validated));
  }

  async summarizeTurnLogs(
    request: SummarizeAgentTurnLogsRequest,
  ): Promise<ReadonlyArray<AgentTurnLogSummary>> {
    const validated = validateSummarizeAgentTurnLogsRequest(request);
    return parseAgentTurnLogSummaries(
      await this.send(AGENT_TURN_LOG_COMMANDS.summarize, validated),
    );
  }

  async deleteThreadLog(request: DeleteAgentThreadLogRequest): Promise<DeleteAgentThreadLogResult> {
    const validated = validateDeleteAgentThreadLogRequest(request);
    return parseDeleteAgentThreadLogResult(
      await this.send(AGENT_TURN_LOG_COMMANDS.deleteThreadLog, validated),
    );
  }

  private async send(command: string, request: unknown): Promise<unknown> {
    try {
      return await this.invokeCommand(command, { request });
    } catch (error) {
      const failure = agentTurnLogFailureFrom(error);
      if (failure === null) throw error;
      throw failure;
    }
  }
}
