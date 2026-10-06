import type { AgentAttachment } from "./agentAttachment.js";
import type { AgentTaskOutputStream } from "./agentProvider.js";
import type { AgentSubagentSpawnEvent } from "./agentSubagentSpawn.js";

export interface AgentSessionFallback {
  readonly previousThreadId: string;
  readonly threadId: string;
}

export type AgentTurnEventsRetention = "serverGap" | "clientWindow";

export interface AgentAppServerTokenBreakdown {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheWriteInputTokens: number;
  readonly outputTokens: number;
  readonly reasoningOutputTokens: number;
  readonly totalTokens: number;
}

export interface AgentAppServerUsage {
  readonly last: AgentAppServerTokenBreakdown;
  readonly total: AgentAppServerTokenBreakdown;
  readonly contextWindow: number | null;
}

export interface AgentTurnUsage {
  readonly scope?: "thread";
  readonly appServerUsage?: AgentAppServerUsage;
  readonly cachedInputTokens?: number | null;
  readonly reasoningOutputTokens?: number | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Provider-reported API-equivalent cost for the turn, when available. */
  readonly costUsd?: number | null;
  /** Legacy provider metric: Codex occupancy; Claude cumulative processed input. */
  readonly contextTokens: number | null;
}

export type AgentSubagentEventStatus = "starting" | "running" | "completed" | "failed";

export type AgentSubagentContentEvent = Extract<
  AgentTurnEvent,
  { kind: "assistantText" | "reasoning" | "toolCall" | "toolResult" }
>;

export type AgentTurnEvent =
  | {
      readonly kind: "backgroundTask";
      readonly taskId: string;
      readonly status: "starting" | "running" | "completed" | "failed" | "stopped";
      readonly taskType: "monitor" | "shell" | "agent" | "other";
      readonly description?: string;
    }
  | {
      readonly kind: "subagentActivity";
      readonly agentThreadId: string;
      readonly agentPath: string;
      readonly activity: "started" | "interacted" | "interrupted" | "completed";
    }
  | {
      readonly kind: "subagentEvent";
      readonly agentThreadId: string;
      readonly event: AgentSubagentContentEvent;
    }
  | AgentSubagentSpawnEvent
  | {
      readonly kind: "subagentUsage";
      readonly agentThreadId: string;
      readonly usage: AgentTurnUsage;
    }
  | {
      readonly kind: "subagentTurnDone";
      readonly agentThreadId: string;
      readonly durationMs: number | null;
      readonly isError: boolean;
    }
  | {
      readonly kind: "queued";
      readonly threadId: string;
      readonly clientUserMessageId: string | null;
    }
  | { readonly kind: "assistantText"; readonly text: string; readonly parentToolId?: string }
  | { readonly kind: "reasoning"; readonly text: string; readonly parentToolId?: string }
  | {
      readonly kind: "userMessage";
      readonly remoteMessageId?: string;
      readonly text: string;
      readonly attachments?: ReadonlyArray<AgentAttachment>;
    }
  | {
      readonly kind: "toolCall";
      readonly toolId: string;
      readonly name: string;
      readonly inputSummary: string;
      readonly description?: string;
      readonly parentToolId?: string;
    }
  | {
      readonly kind: "toolResult";
      readonly toolId: string;
      readonly outputSummary: string;
      readonly isError: boolean;
      readonly parentToolId?: string;
    }
  | {
      readonly kind: "subagent";
      readonly status: AgentSubagentEventStatus;
      readonly toolId?: string;
      readonly taskId?: string;
      readonly subagentType?: string;
      readonly description?: string;
      readonly durationMs?: number;
      readonly totalTokens?: number;
      readonly toolUses?: number;
      readonly lastToolName?: string;
    }
  | {
      readonly kind: "result";
      readonly durationMs?: number | null;
      readonly text: string;
      readonly isError: boolean;
      readonly usage: AgentTurnUsage | null;
    }
  | {
      readonly kind: "contextCompaction";
      readonly beforeTokens: number | null;
      readonly afterTokens: number | null;
    }
  | {
      readonly kind: "contextCompactionStatus";
      readonly status: "compacting" | "idle" | "failed";
      readonly message: string | null;
    }
  | {
      readonly kind: "contextUsage";
      readonly observedAtEpochMs?: number;
      readonly model: string;
      readonly inputTokens: number | null;
      readonly contextWindow: number | null;
    }
  | { readonly kind: "error"; readonly message: string }
  | {
      readonly kind: "unknownLine";
      readonly stream: AgentTaskOutputStream;
      readonly raw: string;
      readonly clipped: boolean;
    };
