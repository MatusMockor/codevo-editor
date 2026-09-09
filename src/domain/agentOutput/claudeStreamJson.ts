import { isAgentSessionId } from "../agentTask";
import {
  MAX_AGENT_EVENT_TEXT_BYTES,
  MAX_AGENT_TOOL_ID_BYTES,
  MAX_AGENT_TOOL_NAME_BYTES,
  MAX_AGENT_TOOL_SUMMARY_BYTES,
  type AgentSubagentEventStatus,
  type AgentTurnEvent,
  type AgentTurnUsage,
} from "../agentThread";
import type { ParsedAgentLine } from "./agentOutputParser";
import type { AgentAccountUsageWindow } from "../agentAccountUsage";
import { summarizeToolInput, summarizeToolOutput } from "./toolInputSummary";
import { boundedUtf8Text, utf8ByteLength } from "./utf8Text";

const IGNORED: ParsedAgentLine = { kind: "ignored" };
const NO_EVENTS: ParsedAgentLine = { kind: "events", events: [], sessionId: null };
const CONTROL_CHARACTER_PATTERN = /\p{Cc}/u;
const LOCAL_AGENT_TASK_TYPE = "local_agent";

export function parseClaudeStreamJsonLine(line: string): ParsedAgentLine {
  const value = jsonObject(line);
  if (value === null) return { kind: "unknown", raw: line };
  if (value.type === "system") return parseSystemLine(value);
  if (value.type === "assistant") return parseAssistantLine(value);
  if (value.type === "user") return parseUserLine(value);
  if (value.type === "result") return parseResultLine(value);
  if (value.type === "rate_limit_event") return parseRateLimitEvent(value);
  return IGNORED;
}

function parseRateLimitEvent(value: Record<string, unknown>): ParsedAgentLine {
  const info = objectValue(value.rate_limit_info);
  if (info === null) return IGNORED;
  const windows: AgentAccountUsageWindow[] = [];
  const unified = objectValue(info.unifiedWindows);
  if (unified !== null && Object.keys(unified).length <= 12) {
    for (const [id, candidate] of Object.entries(unified)) {
      const window = claudeLimitWindow(id, candidate);
      if (window !== null) windows.push(window);
    }
  }
  if (windows.length === 0 && typeof info.rateLimitType === "string") {
    const window = claudeLimitWindow(info.rateLimitType, info);
    if (window !== null) windows.push(window);
  }
  return windows.length === 0
    ? IGNORED
    : { kind: "accountUsage", observation: { provider: "claudeCode", windows } };
}

function claudeLimitWindow(id: string, value: unknown): AgentAccountUsageWindow | null {
  if (id.includes("overage") && id !== "seven_day_overage_included") return null;
  const window = objectValue(value);
  if (window === null) return null;
  const utilization = window.utilization;
  if (typeof utilization !== "number" || !Number.isFinite(utilization)) return null;
  if (utilization < 0 || utilization > 1) return null;
  const resetsAtSeconds = window.resetsAt;
  const resetsAtEpochMs =
    typeof resetsAtSeconds === "number" &&
    Number.isSafeInteger(resetsAtSeconds) &&
    resetsAtSeconds >= 0 &&
    Number.isSafeInteger(resetsAtSeconds * 1_000)
      ? resetsAtSeconds * 1_000
      : null;
  return {
    id: id === "seven_day_overage_included" ? "seven_day_fable" : id,
    label: claudeLimitLabel(id),
    usedPercent: utilization * 100,
    windowDurationMinutes: id === "five_hour" ? 300 : id.startsWith("seven_day") ? 10_080 : null,
    resetsAtEpochMs,
    resetsLabel: null,
  };
}

function claudeLimitLabel(id: string): string {
  if (id === "five_hour") return "5-hour limit";
  if (id === "seven_day") return "Weekly limit";
  if (id === "seven_day_opus") return "Weekly Opus limit";
  if (id === "seven_day_sonnet") return "Weekly Sonnet limit";
  if (id === "seven_day_overage_included") return "Weekly Fable limit";
  return id
    .split("_")
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function parseSystemLine(value: Record<string, unknown>): ParsedAgentLine {
  if (value.subtype === "init") {
    if (!isAgentSessionId(value.session_id)) return IGNORED;
    return { kind: "events", events: [], sessionId: value.session_id };
  }
  if (value.subtype === "compact_boundary") return parseCompactBoundaryLine(value);
  const event = subagentTelemetryEvent(value);
  if (event === null) return IGNORED;
  return { kind: "events", events: [event], sessionId: null };
}

function parseCompactBoundaryLine(value: Record<string, unknown>): ParsedAgentLine {
  const metadata = objectValue(value.compact_metadata ?? value.compactMetadata);
  return {
    kind: "events",
    events: [
      {
        kind: "contextCompaction",
        beforeTokens: tokenCount(metadata?.pre_tokens ?? metadata?.preTokens),
        afterTokens: tokenCount(metadata?.post_tokens ?? metadata?.postTokens),
      },
    ],
    sessionId: isAgentSessionId(value.session_id) ? value.session_id : null,
  };
}

function subagentTelemetryEvent(value: Record<string, unknown>): AgentTurnEvent | null {
  const status = telemetryStatus(value);
  if (status === null) return null;
  const toolId = optionalIdentifier(value.tool_use_id, MAX_AGENT_TOOL_ID_BYTES);
  const taskId = optionalIdentifier(value.task_id, MAX_AGENT_TOOL_ID_BYTES);
  if (toolId === undefined && taskId === undefined) return null;
  const usage = objectValue(value.usage);
  return {
    kind: "subagent",
    status,
    ...present("toolId", toolId),
    ...present("taskId", taskId),
    ...present("subagentType", optionalIdentifier(value.subagent_type, MAX_AGENT_TOOL_NAME_BYTES)),
    ...present("description", optionalSummary(value.description)),
    ...present("durationMs", optionalMetric(usage?.duration_ms)),
    ...present("totalTokens", optionalMetric(usage?.total_tokens)),
    ...present("toolUses", optionalMetric(usage?.tool_uses)),
    ...present("lastToolName", optionalIdentifier(value.last_tool_name, MAX_AGENT_TOOL_NAME_BYTES)),
  };
}

function telemetryStatus(value: Record<string, unknown>): AgentSubagentEventStatus | null {
  if (value.task_type !== undefined && value.task_type !== LOCAL_AGENT_TASK_TYPE) return null;
  if (value.subtype === "task_started") return "starting";
  if (value.subtype === "task_progress") return "running";
  if (value.subtype === "task_notification") return subagentStatus(value.status);
  if (value.subtype !== "task_updated") return null;
  return subagentStatus(objectValue(value.patch)?.status);
}

function subagentStatus(value: unknown): AgentSubagentEventStatus | null {
  if (value === "starting" || value === "running") return value;
  if (value === "completed" || value === "failed") return value;
  return null;
}

function parseAssistantLine(value: Record<string, unknown>): ParsedAgentLine {
  const content = messageContent(value);
  if (content === null) return IGNORED;
  const parentToolId = optionalIdentifier(value.parent_tool_use_id, MAX_AGENT_TOOL_ID_BYTES);
  const events = content.flatMap((block) => assistantBlockEvents(block, parentToolId));
  if (events.length === 0) return NO_EVENTS;
  return { kind: "events", events, sessionId: null };
}

function parseUserLine(value: Record<string, unknown>): ParsedAgentLine {
  const content = messageContent(value);
  if (content === null) return IGNORED;
  const parentToolId = optionalIdentifier(value.parent_tool_use_id, MAX_AGENT_TOOL_ID_BYTES);
  const results = content.flatMap((block) => toolResultEvents(block, parentToolId));
  const completion = subagentCompletionEvent(value.tool_use_result, results);
  const events = completion === null ? results : [...results, completion];
  if (events.length === 0) return NO_EVENTS;
  return { kind: "events", events, sessionId: null };
}

function subagentCompletionEvent(
  value: unknown,
  results: ReadonlyArray<AgentTurnEvent>,
): AgentTurnEvent | null {
  const result = objectValue(value);
  if (result === null) return null;
  const taskId = optionalIdentifier(result.agentId, MAX_AGENT_TOOL_ID_BYTES);
  const subagentType = optionalIdentifier(result.agentType, MAX_AGENT_TOOL_NAME_BYTES);
  if (taskId === undefined || subagentType === undefined) return null;
  const status = subagentStatus(result.status);
  if (status === null) return null;
  const owner = results.length === 1 ? results[0] : undefined;
  return {
    kind: "subagent",
    status,
    ...present("toolId", owner?.kind === "toolResult" ? owner.toolId : undefined),
    taskId,
    subagentType,
    ...present("durationMs", optionalMetric(result.totalDurationMs)),
    ...present("totalTokens", optionalMetric(result.totalTokens)),
    ...present("toolUses", optionalMetric(result.totalToolUseCount)),
  };
}

function present<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
}

function optionalIdentifier(value: unknown, maxBytes: number): string | undefined {
  return safeIdentifier(value, maxBytes) ?? undefined;
}

function optionalSummary(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  if (value.includes("\u0000")) return undefined;
  const summary = boundedUtf8Text(value, MAX_AGENT_TOOL_SUMMARY_BYTES);
  return summary === "" ? undefined : summary;
}

function optionalMetric(value: unknown): number | undefined {
  return tokenCount(value) ?? undefined;
}

function parseResultLine(value: Record<string, unknown>): ParsedAgentLine {
  const text = typeof value.result === "string" ? eventText(value.result) : "";
  const event: AgentTurnEvent = {
    kind: "result",
    text,
    isError: value.is_error === true || value.subtype !== "success",
    usage: parseUsage(value.usage, value.total_cost_usd),
  };
  const sessionId = isAgentSessionId(value.session_id) ? value.session_id : null;
  return { kind: "events", events: [event], sessionId };
}

function assistantBlockEvents(
  value: unknown,
  parentToolId: string | undefined,
): ReadonlyArray<AgentTurnEvent> {
  const block = objectValue(value);
  if (block === null) return [];
  if (block.type === "text") return textEvents("assistantText", block.text);
  if (block.type === "thinking") return textEvents("reasoning", block.thinking);
  if (block.type !== "tool_use") return [];
  const toolId = safeIdentifier(block.id, MAX_AGENT_TOOL_ID_BYTES);
  const name = safeIdentifier(block.name, MAX_AGENT_TOOL_NAME_BYTES);
  if (toolId === null || name === null) return [];
  return [
    {
      kind: "toolCall",
      toolId,
      name,
      inputSummary: summarizeToolInput(name, block.input),
      ...present("parentToolId", parentToolId),
    },
  ];
}

function toolResultEvents(
  value: unknown,
  parentToolId: string | undefined,
): ReadonlyArray<AgentTurnEvent> {
  const block = objectValue(value);
  if (block === null) return [];
  if (block.type !== "tool_result") return [];
  const toolId = safeIdentifier(block.tool_use_id, MAX_AGENT_TOOL_ID_BYTES);
  if (toolId === null) return [];
  return [
    {
      kind: "toolResult",
      toolId,
      outputSummary: summarizeToolOutput(block.content),
      isError: block.is_error === true,
      ...present("parentToolId", parentToolId),
    },
  ];
}

function textEvents(
  kind: "assistantText" | "reasoning",
  value: unknown,
): ReadonlyArray<AgentTurnEvent> {
  if (typeof value !== "string") return [];
  const text = eventText(value);
  if (text === "") return [];
  return [{ kind, text }];
}

function parseUsage(value: unknown, totalCostUsd: unknown): AgentTurnUsage | null {
  const usage = objectValue(value);
  if (usage === null) return null;
  const inputTokens = tokenCount(usage.input_tokens);
  const outputTokens = tokenCount(usage.output_tokens);
  if (inputTokens === null || outputTokens === null) return null;
  const cacheCreationTokens = tokenCount(usage.cache_creation_input_tokens) ?? 0;
  const cacheReadTokens = tokenCount(usage.cache_read_input_tokens) ?? 0;
  const contextTokens = safeTokenSum(inputTokens, cacheCreationTokens, cacheReadTokens);
  const costUsd = nonNegativeFiniteNumber(totalCostUsd);
  return {
    inputTokens,
    outputTokens,
    contextTokens,
    ...(costUsd === null ? {} : { costUsd }),
  };
}

function nonNegativeFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function safeTokenSum(...values: ReadonlyArray<number>): number | null {
  const total = values.reduce((sum, value) => sum + value, 0);
  return Number.isSafeInteger(total) ? total : null;
}

function tokenCount(value: unknown): number | null {
  if (!Number.isSafeInteger(value) || (value as number) < 0) return null;
  return value as number;
}

function messageContent(value: Record<string, unknown>): ReadonlyArray<unknown> | null {
  const message = objectValue(value.message);
  if (message === null) return null;
  if (!Array.isArray(message.content)) return null;
  return message.content;
}

function safeIdentifier(value: unknown, maxBytes: number): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  if (CONTROL_CHARACTER_PATTERN.test(value)) return null;
  if (utf8ByteLength(value) > maxBytes) return null;
  return value;
}

function eventText(value: string): string {
  return boundedUtf8Text(value, MAX_AGENT_EVENT_TEXT_BYTES);
}

function objectValue(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function jsonObject(line: string): Record<string, unknown> | null {
  try {
    return objectValue(JSON.parse(line) as unknown);
  } catch {
    return null;
  }
}
