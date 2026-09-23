import { isAgentSessionId } from "../agentTask";
import {
  MAX_AGENT_EVENT_TEXT_BYTES,
  MAX_AGENT_TOOL_ID_BYTES,
  MAX_AGENT_TOOL_NAME_BYTES,
  MAX_AGENT_TOOL_SUMMARY_BYTES,
  type AgentTurnEvent,
  type AgentAppServerTokenBreakdown,
  type AgentTurnUsage,
} from "../agentThread";
import type { ParsedAgentLine } from "./agentOutputParser";
import { utf8ByteLength } from "./utf8Text";

type RecordValue = Record<string, unknown>;
type InnerEvent = Extract<
  AgentTurnEvent,
  { kind: "assistantText" | "reasoning" | "toolCall" | "toolResult" }
>;
type ContextUsageEvent = Extract<AgentTurnEvent, { kind: "contextUsage" }>;
const UNKNOWN = Symbol("invalid app-server event");
const CODEX_CONTEXT_MODEL = "codex";
const NOTICE_TOOL_NAMES = { info: "Codex notice", warning: "Codex warning" } as const;

export function parseCodexAppServerLine(line: string): ParsedAgentLine {
  try {
    const value = record(JSON.parse(line) as unknown);
    if (value.v !== 1) throw UNKNOWN;
    if (value.t === "sessionFallback") {
      keys(value, ["v", "t", "previousThreadId", "threadId"]);
      if (!isAgentSessionId(value.previousThreadId) || !isAgentSessionId(value.threadId))
        throw UNKNOWN;
      if (value.previousThreadId === value.threadId) throw UNKNOWN;
      return {
        kind: "events",
        events: [],
        sessionId: value.threadId,
        sessionFallback: { previousThreadId: value.previousThreadId, threadId: value.threadId },
      };
    }
    if (value.t === "session") {
      keys(value, ["v", "t", "threadId"]);
      if (!isAgentSessionId(value.threadId)) throw UNKNOWN;
      return { kind: "events", events: [], sessionId: value.threadId };
    }
    const events = [...parseEvents(value)];
    if (
      value.clipped === true ||
      (value.t === "subagentItem" && record(value.inner).clipped === true)
    ) {
      events.push({
        kind: "unknownLine",
        stream: "stdout",
        raw: "<app-server output was truncated>",
        clipped: true,
      });
    }
    return { kind: "events", events, sessionId: null };
  } catch {
    return { kind: "unknown", raw: line };
  }
}

function parseEvents(value: RecordValue): ReadonlyArray<AgentTurnEvent> {
  if (value.t === "notice") return noticeEvents(value);
  if (value.t === "usage") return usageEvents(value);
  const event = parseEvent(value);
  return event === null ? [] : [event];
}

function noticeEvents(value: RecordValue): ReadonlyArray<AgentTurnEvent> {
  keys(value, ["v", "t", "noticeId", "severity", "message", "clipped"]);
  flag(value.clipped);
  const severity = value.severity;
  if (severity !== "info" && severity !== "warning") throw UNKNOWN;
  const toolId = identifier(value.noticeId);
  const message = text(value.message, MAX_AGENT_TOOL_SUMMARY_BYTES);
  return [
    { kind: "toolCall", toolId, name: NOTICE_TOOL_NAMES[severity], inputSummary: message },
    { kind: "toolResult", toolId, outputSummary: "", isError: false },
  ];
}

function usageEvents(value: RecordValue): ReadonlyArray<AgentTurnEvent> {
  keys(value, ["v", "t", "scope", "threadId", "usage"]);
  const agentThreadId = identifier(value.threadId);
  const usage = parseUsage(value.usage);
  if (usage === null) throw UNKNOWN;
  if (value.scope === "thread") return threadContextUsage(usage);
  if (value.scope !== "subagent") throw UNKNOWN;
  return [{ kind: "subagentUsage", agentThreadId, usage }];
}

function threadContextUsage(usage: AgentTurnUsage): ReadonlyArray<ContextUsageEvent> {
  const measured = usage.appServerUsage;
  if (measured === undefined) return [];
  const occupancy: ContextUsageEvent = {
    kind: "contextUsage",
    model: CODEX_CONTEXT_MODEL,
    inputTokens: measured.last.totalTokens,
    contextWindow: null,
  };
  if (measured.contextWindow === null || measured.contextWindow === 0) return [occupancy];
  return [
    {
      kind: "contextUsage",
      model: CODEX_CONTEXT_MODEL,
      inputTokens: null,
      contextWindow: measured.contextWindow,
    },
    occupancy,
  ];
}

function parseEvent(value: RecordValue): AgentTurnEvent | null {
  const item = innerEvent(value, true);
  if (item !== null) return item;
  switch (value.t) {
    case "subagent": {
      keys(value, ["v", "t", "kind", "agentThreadId", "agentPath", "clipped"]);
      flag(value.clipped);
      const activity = value.kind;
      if (
        activity !== "started" &&
        activity !== "interacted" &&
        activity !== "interrupted" &&
        activity !== "completed"
      )
        throw UNKNOWN;
      return {
        kind: "subagentActivity",
        activity,
        agentThreadId: identifier(value.agentThreadId),
        agentPath: text(value.agentPath, MAX_AGENT_TOOL_ID_BYTES),
      };
    }
    case "subagentItem": {
      keys(value, ["v", "t", "agentThreadId", "inner"]);
      const event = innerEvent(record(value.inner), false);
      if (event === null) throw UNKNOWN;
      return { kind: "subagentEvent", agentThreadId: identifier(value.agentThreadId), event };
    }
    case "result":
      keys(value, ["v", "t", "isError", "durationMs", "text", "clipped", "usage"]);
      flag(value.clipped);
      return {
        kind: "result",
        text: text(value.text),
        isError: flag(value.isError),
        durationMs: metric(value.durationMs),
        usage: parseUsage(value.usage),
      };
    case "subagentTurnCompleted":
      keys(value, ["v", "t", "agentThreadId", "durationMs", "isError"]);
      return {
        kind: "subagentTurnDone",
        agentThreadId: identifier(value.agentThreadId),
        durationMs: metric(value.durationMs),
        isError: flag(value.isError),
      };
    case "compaction":
      keys(value, ["v", "t", "beforeTokens", "afterTokens"]);
      return {
        kind: "contextCompaction",
        beforeTokens: metric(value.beforeTokens),
        afterTokens: metric(value.afterTokens),
      };
    case "queued":
      keys(value, ["v", "t", "threadId", "clientUserMessageId"]);
      return {
        kind: "queued",
        threadId: identifier(value.threadId),
        clientUserMessageId:
          value.clientUserMessageId === null ? null : identifier(value.clientUserMessageId),
      };
    case "error":
      keys(value, ["v", "t", "message", "clipped", "threadId"]);
      flag(value.clipped);
      if (value.threadId !== null) identifier(value.threadId);
      return { kind: "error", message: text(value.message) };
    case "unknownFrame":
      keys(value, ["v", "t", "method"]);
      return {
        kind: "unknownLine",
        stream: "stdout",
        raw: `Unsupported app-server frame: ${identifier(value.method)}`,
        clipped: false,
      };
    default:
      throw UNKNOWN;
  }
}

function innerEvent(value: RecordValue, root: boolean): InnerEvent | null {
  const prefix = root ? ["v", "t"] : ["t"];
  switch (value.t) {
    case "text": {
      keys(value, [...prefix, "role", "text", "clipped"]);
      flag(value.clipped);
      if (value.role !== "assistant" && value.role !== "reasoning") throw UNKNOWN;
      return {
        kind: value.role === "assistant" ? "assistantText" : "reasoning",
        text: text(value.text),
      };
    }
    case "toolCall":
      keys(value, [...prefix, "toolId", "name", "inputSummary", "clipped"]);
      flag(value.clipped);
      return {
        kind: "toolCall",
        toolId: identifier(value.toolId),
        name: identifier(value.name, MAX_AGENT_TOOL_NAME_BYTES),
        inputSummary: text(value.inputSummary, MAX_AGENT_TOOL_SUMMARY_BYTES),
      };
    case "toolResult":
      keys(value, [...prefix, "toolId", "outputSummary", "isError", "clipped"]);
      flag(value.clipped);
      return {
        kind: "toolResult",
        toolId: identifier(value.toolId),
        outputSummary: text(value.outputSummary, MAX_AGENT_TOOL_SUMMARY_BYTES),
        isError: flag(value.isError),
      };
    default:
      return null;
  }
}

function parseUsage(value: unknown): AgentTurnUsage | null {
  if (value === null) return null;
  const usage = record(value);
  keys(usage, ["last", "total", "contextWindow"]);
  const contextWindow = metric(usage.contextWindow);
  const last = breakdown(usage.last);
  const total = breakdown(usage.total);
  return {
    scope: "thread",
    appServerUsage: { last, total, contextWindow },
    inputTokens: total.inputTokens,
    outputTokens: total.outputTokens,
    cachedInputTokens: total.cachedInputTokens,
    reasoningOutputTokens: total.reasoningOutputTokens,
    contextTokens: last.totalTokens,
  };
}

function breakdown(value: unknown): AgentAppServerTokenBreakdown {
  const entry = record(value);
  keys(entry, [
    "inputTokens",
    "cachedInputTokens",
    "cacheWriteInputTokens",
    "outputTokens",
    "reasoningOutputTokens",
    "totalTokens",
  ]);
  return {
    inputTokens: count(entry.inputTokens),
    cachedInputTokens: count(entry.cachedInputTokens),
    cacheWriteInputTokens: count(entry.cacheWriteInputTokens),
    outputTokens: count(entry.outputTokens),
    reasoningOutputTokens: count(entry.reasoningOutputTokens),
    totalTokens: count(entry.totalTokens),
  };
}

function count(value: unknown): number {
  const number = metric(value);
  if (number === null) throw UNKNOWN;
  return number;
}

function record(value: unknown): RecordValue {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw UNKNOWN;
  return value as RecordValue;
}

function keys(value: RecordValue, expected: readonly string[]): void {
  const actual = Object.keys(value);
  if (actual.length !== expected.length || actual.some((key) => !expected.includes(key)))
    throw UNKNOWN;
}

function text(value: unknown, limit = MAX_AGENT_EVENT_TEXT_BYTES): string {
  if (typeof value !== "string" || value.includes("\0") || utf8ByteLength(value) > limit)
    throw UNKNOWN;
  return value;
}

function identifier(value: unknown, limit = MAX_AGENT_TOOL_ID_BYTES): string {
  const id = text(value, limit);
  if (id.length === 0 || /\p{Cc}/u.test(id)) throw UNKNOWN;
  return id;
}

function flag(value: unknown): boolean {
  if (typeof value !== "boolean") throw UNKNOWN;
  return value;
}

function metric(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw UNKNOWN;
  return value;
}
