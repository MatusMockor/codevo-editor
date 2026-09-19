import type { AgentContextWindow } from "../domain/agentContextWindow";
import type { AgentCliKind } from "../domain/agentTask";
import type { AgentTurnEvent } from "../domain/agentThread";
import type {
  AgentTurnLogLease,
  AgentTurnLogLoss,
  AgentTurnLogPage,
  AgentTurnLogScope,
  AgentTurnLogSummary,
  AppendAgentTurnLogReceipt,
  AppendAgentTurnLogRequest,
  DeleteAgentThreadLogRequest,
  DeleteAgentThreadLogResult,
  OpenAgentTurnLogRequest,
  ReadAgentTurnLogPageRequest,
  SummarizeAgentTurnLogsRequest,
} from "../domain/agentTurnLog";

export const AGENT_TURN_LOG_FLUSH_INTERVAL_MS = 1_000;
export const AGENT_TURN_LOG_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const;
export const MAX_AGENT_TURN_LOG_TRANSPORT_ATTEMPTS = 8;
export const MAX_AGENT_TURN_LOG_RETRY_WINDOW_MS = 600_000;
export const MAX_RETAINED_AGENT_TURN_LOG_FINAL_STATUSES = 64;

export const AGENT_TURN_LOG_APPEND_TARGET_BYTES = 524_288;

export const AGENT_TURN_LOG_BACKPRESSURE = {
  ops: 4_096,
  bytes: 4_194_304,
  releaseOps: 2_048,
  releaseBytes: 2_097_152,
} as const;

export interface AgentTurnLogGateway {
  openTurnLog(request: OpenAgentTurnLogRequest): Promise<AgentTurnLogLease>;
  appendTurnLog(request: AppendAgentTurnLogRequest): Promise<AppendAgentTurnLogReceipt>;
  readTurnLogPage(request: ReadAgentTurnLogPageRequest): Promise<AgentTurnLogPage>;
  summarizeTurnLogs(
    request: SummarizeAgentTurnLogsRequest,
  ): Promise<ReadonlyArray<AgentTurnLogSummary>>;
  deleteThreadLog(request: DeleteAgentThreadLogRequest): Promise<DeleteAgentThreadLogResult>;
}

export interface AgentTurnLogTimers {
  readonly now: () => number;
  readonly schedule: (callback: () => void, delayMs: number) => () => void;
}

export const systemAgentTurnLogTimers: AgentTurnLogTimers = {
  now: () => Date.now(),
  schedule: (callback, delayMs) => {
    const handle = setTimeout(callback, delayMs);
    return () => clearTimeout(handle);
  },
};

export interface AgentTurnLogOwnerAuthority {
  ownsTurn(scope: AgentTurnLogScope, generation: number): boolean;
  currentGeneration(scope: AgentTurnLogScope): number | null;
}

export type AgentTurnLogRetryError = "diskFull" | "unreadable" | "busy" | "unavailable";

export const AGENT_TURN_LOG_QUIT_FLUSH_BUDGET_MS = 1_500;

export type AgentTurnLogStopReason =
  | "sealed"
  | "supersededWriter"
  | "ownerMismatch"
  | "sequenceGap"
  | "budgetExhausted"
  | "foreign"
  | "turnCeiling"
  | "failed";

export type AgentTurnLogSlotState =
  | { readonly kind: "opening" }
  | { readonly kind: "writing" }
  | {
      readonly kind: "retrying";
      readonly error: AgentTurnLogRetryError;
      readonly attempts: number;
      readonly nextAttemptAtMs: number;
    }
  | { readonly kind: "stopped"; readonly reason: AgentTurnLogStopReason };

export interface AgentTurnLogSlotStatus {
  readonly turnId: string;
  readonly threadId: string;
  readonly state: AgentTurnLogSlotState;
  readonly loss: AgentTurnLogLoss;
  readonly pendingOps: number;
  readonly pendingBytes: number;
  readonly backpressure: boolean;
  readonly persistedThroughSeq: number;
  readonly bounded: boolean;
  readonly contextWindow: AgentContextWindow | null;
  readonly promptStored: boolean;
}

export interface OpenAgentTurnLogSlotRequest {
  readonly scope: AgentTurnLogScope;
  readonly generation: number;
  readonly provider: AgentCliKind;
  readonly priorLoss: AgentTurnLogLoss;
  readonly prompt: string | null;
}

export interface AgentTurnLogWriter {
  openTurn(request: OpenAgentTurnLogSlotRequest): void;
  recordEvents(turnId: string, events: ReadonlyArray<AgentTurnEvent>): void;
  reportLoss(turnId: string, loss: AgentTurnLogLoss): void;
  sealTurn(turnId: string): void;
  closeTurn(turnId: string): void;
  status(turnId: string): AgentTurnLogSlotStatus | null;
  flushAll(budgetMs?: number): Promise<void>;
  dispose(): void;
}
