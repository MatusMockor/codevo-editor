import { isAgentSessionId } from "../agentTask";
import {
  MAX_AGENT_EVENT_TEXT_BYTES,
  MAX_AGENT_TOOL_ID_BYTES,
  MAX_AGENT_TOOL_NAME_BYTES,
  type AgentTurnEvent,
  type AgentTurnUsage,
} from "../agentThread";
import type { ParsedAgentLine } from "./agentOutputParser";
import { summarizeToolInput, summarizeToolOutput } from "./toolInputSummary";
import { boundedUtf8Text, utf8ByteLength } from "./utf8Text";

const IGNORED: ParsedAgentLine = { kind: "ignored" };
const NO_EVENTS: ParsedAgentLine = { kind: "events", events: [], sessionId: null };
const CONTROL_CHARACTER_PATTERN = /\p{Cc}/u;

export function parseClaudeStreamJsonLine(line: string): ParsedAgentLine {
  const value = jsonObject(line);
  if (value === null) return { kind: "unknown", raw: line };
  if (value.type === "system") return parseSystemLine(value);
  if (value.type === "assistant") return parseAssistantLine(value);
  if (value.type === "user") return parseUserLine(value);
  if (value.type === "result") return parseResultLine(value);
  return IGNORED;
}

function parseSystemLine(value: Record<string, unknown>): ParsedAgentLine {
  if (value.subtype !== "init") return IGNORED;
  if (!isAgentSessionId(value.session_id)) return IGNORED;
  return { kind: "events", events: [], sessionId: value.session_id };
}

function parseAssistantLine(value: Record<string, unknown>): ParsedAgentLine {
  const content = messageContent(value);
  if (content === null) return IGNORED;
  const events = content.flatMap(assistantBlockEvents);
  if (events.length === 0) return NO_EVENTS;
  return { kind: "events", events, sessionId: null };
}

function parseUserLine(value: Record<string, unknown>): ParsedAgentLine {
  const content = messageContent(value);
  if (content === null) return IGNORED;
  const events = content.flatMap(toolResultEvents);
  if (events.length === 0) return NO_EVENTS;
  return { kind: "events", events, sessionId: null };
}

function parseResultLine(value: Record<string, unknown>): ParsedAgentLine {
  const text = typeof value.result === "string" ? eventText(value.result) : "";
  const event: AgentTurnEvent = {
    kind: "result",
    text,
    isError: value.is_error === true || value.subtype !== "success",
    usage: parseUsage(value.usage),
  };
  const sessionId = isAgentSessionId(value.session_id) ? value.session_id : null;
  return { kind: "events", events: [event], sessionId };
}

function assistantBlockEvents(value: unknown): ReadonlyArray<AgentTurnEvent> {
  const block = objectValue(value);
  if (block === null) return [];
  if (block.type === "text") return textEvents("assistantText", block.text);
  if (block.type === "thinking") return textEvents("reasoning", block.thinking);
  if (block.type !== "tool_use") return [];
  const toolId = safeIdentifier(block.id, MAX_AGENT_TOOL_ID_BYTES);
  const name = safeIdentifier(block.name, MAX_AGENT_TOOL_NAME_BYTES);
  if (toolId === null || name === null) return [];
  return [{ kind: "toolCall", toolId, name, inputSummary: summarizeToolInput(name, block.input) }];
}

function toolResultEvents(value: unknown): ReadonlyArray<AgentTurnEvent> {
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

function parseUsage(value: unknown): AgentTurnUsage | null {
  const usage = objectValue(value);
  if (usage === null) return null;
  const inputTokens = tokenCount(usage.input_tokens);
  const outputTokens = tokenCount(usage.output_tokens);
  if (inputTokens === null || outputTokens === null) return null;
  return { inputTokens, outputTokens };
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
