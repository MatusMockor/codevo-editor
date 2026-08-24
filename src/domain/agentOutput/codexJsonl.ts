import { isAgentSessionId } from "../agentTask";
import {
  MAX_AGENT_EVENT_TEXT_BYTES,
  MAX_AGENT_TOOL_ID_BYTES,
  MAX_AGENT_TOOL_NAME_BYTES,
  MAX_AGENT_TOOL_SUMMARY_BYTES,
  type AgentTurnEvent,
  type AgentTurnUsage,
} from "../agentThread";
import type { ParsedAgentLine } from "./agentOutputParser";
import { boundedUtf8Text, utf8ByteLength } from "./utf8Text";

export const MAX_CODEX_EMITTED_ITEM_IDS = 1_024;

export interface CodexJsonlParseResult {
  readonly result: ParsedAgentLine;
  readonly state: ReadonlySet<string>;
}

const IGNORED: ParsedAgentLine = { kind: "ignored" };
const SHELL_TOOL_NAME = "shell";
const APPLY_PATCH_TOOL_NAME = "apply_patch";
const WEB_SEARCH_TOOL_NAME = "web_search";
const CONTROL_CHARACTER_PATTERN = /\p{Cc}/u;

interface CodexItemEvents {
  readonly events: ReadonlyArray<AgentTurnEvent>;
  readonly emittedItemId: string | null;
}

const NO_ITEM_EVENTS: CodexItemEvents = { events: [], emittedItemId: null };

export function parseCodexJsonlLine(
  line: string,
  state: ReadonlySet<string>,
): CodexJsonlParseResult {
  const value = jsonObject(line);
  if (value === null) return { result: { kind: "unknown", raw: line }, state };
  if (value.type === "thread.started") return { result: threadStarted(value), state };
  if (value.type === "item.started") return itemLine(value, false, state);
  if (value.type === "item.completed") return itemLine(value, true, state);
  if (value.type === "turn.completed") return { result: turnCompleted(value), state };
  if (value.type === "turn.failed") return { result: turnFailed(value), state };
  if (value.type === "error") return { result: topLevelError(value), state };
  return { result: IGNORED, state };
}

function threadStarted(value: Record<string, unknown>): ParsedAgentLine {
  if (!isAgentSessionId(value.thread_id)) return IGNORED;
  return { kind: "events", events: [], sessionId: value.thread_id };
}

function turnCompleted(value: Record<string, unknown>): ParsedAgentLine {
  const event: AgentTurnEvent = {
    kind: "result",
    text: "",
    isError: false,
    usage: parseUsage(value.usage),
  };
  return { kind: "events", events: [event], sessionId: null };
}

function turnFailed(value: Record<string, unknown>): ParsedAgentLine {
  const error = objectValue(value.error);
  const message = error === null ? null : error.message;
  const event: AgentTurnEvent = {
    kind: "result",
    text: typeof message === "string" ? eventText(message) : "",
    isError: true,
    usage: null,
  };
  return { kind: "events", events: [event], sessionId: null };
}

function topLevelError(value: Record<string, unknown>): ParsedAgentLine {
  if (typeof value.message !== "string") return IGNORED;
  return {
    kind: "events",
    events: [{ kind: "error", message: eventText(value.message) }],
    sessionId: null,
  };
}

function itemLine(
  value: Record<string, unknown>,
  completed: boolean,
  state: ReadonlySet<string>,
): CodexJsonlParseResult {
  const item = objectValue(value.item);
  if (item === null) return { result: IGNORED, state };
  const parsed = itemEvents(item, completed, state);
  if (parsed.events.length === 0) return { result: IGNORED, state };
  return {
    result: { kind: "events", events: parsed.events, sessionId: null },
    state: rememberItemId(state, parsed.emittedItemId),
  };
}

function itemEvents(
  item: Record<string, unknown>,
  completed: boolean,
  state: ReadonlySet<string>,
): CodexItemEvents {
  if (item.type === "agent_message") return messageEvents("assistantText", item.text, completed);
  if (item.type === "reasoning") return messageEvents("reasoning", item.text, completed);
  const itemId = safeIdentifier(item.id, MAX_AGENT_TOOL_ID_BYTES);
  if (itemId === null) return NO_ITEM_EVENTS;
  if (item.type === "command_execution") return commandEvents(item, itemId, completed, state);
  if (item.type === "file_change") return fileChangeEvents(item, itemId, state);
  if (item.type === "mcp_tool_call") return mcpToolCallEvents(item, itemId, state);
  if (item.type === "web_search") return webSearchEvents(item, itemId, state);
  if (item.type === "error") return errorItemEvents(item, itemId, state);
  return NO_ITEM_EVENTS;
}

function messageEvents(
  kind: "assistantText" | "reasoning",
  value: unknown,
  completed: boolean,
): CodexItemEvents {
  if (!completed) return NO_ITEM_EVENTS;
  if (typeof value !== "string") return NO_ITEM_EVENTS;
  const text = eventText(value);
  if (text === "") return NO_ITEM_EVENTS;
  return { events: [{ kind, text }], emittedItemId: null };
}

function commandEvents(
  item: Record<string, unknown>,
  itemId: string,
  completed: boolean,
  state: ReadonlySet<string>,
): CodexItemEvents {
  const events: AgentTurnEvent[] = [];
  const alreadyEmitted = state.has(itemId);
  if (!alreadyEmitted) {
    events.push({
      kind: "toolCall",
      toolId: itemId,
      name: SHELL_TOOL_NAME,
      inputSummary: toolSummary(item.command),
    });
  }
  if (completed) {
    events.push({
      kind: "toolResult",
      toolId: itemId,
      outputSummary: toolSummary(item.aggregated_output),
      isError: item.exit_code !== 0,
    });
  }
  if (events.length === 0) return NO_ITEM_EVENTS;
  return { events, emittedItemId: alreadyEmitted ? null : itemId };
}

function fileChangeEvents(
  item: Record<string, unknown>,
  itemId: string,
  state: ReadonlySet<string>,
): CodexItemEvents {
  if (state.has(itemId)) return NO_ITEM_EVENTS;
  return {
    events: [
      {
        kind: "toolCall",
        toolId: itemId,
        name: APPLY_PATCH_TOOL_NAME,
        inputSummary: boundedUtf8Text(changedPaths(item.changes), MAX_AGENT_TOOL_SUMMARY_BYTES),
      },
    ],
    emittedItemId: itemId,
  };
}

function mcpToolCallEvents(
  item: Record<string, unknown>,
  itemId: string,
  state: ReadonlySet<string>,
): CodexItemEvents {
  if (state.has(itemId)) return NO_ITEM_EVENTS;
  const name = mcpToolName(item);
  if (name === null) return NO_ITEM_EVENTS;
  return {
    events: [{ kind: "toolCall", toolId: itemId, name, inputSummary: toolSummary(item.arguments) }],
    emittedItemId: itemId,
  };
}

function webSearchEvents(
  item: Record<string, unknown>,
  itemId: string,
  state: ReadonlySet<string>,
): CodexItemEvents {
  if (state.has(itemId)) return NO_ITEM_EVENTS;
  return {
    events: [
      {
        kind: "toolCall",
        toolId: itemId,
        name: WEB_SEARCH_TOOL_NAME,
        inputSummary: toolSummary(item.query),
      },
    ],
    emittedItemId: itemId,
  };
}

function errorItemEvents(
  item: Record<string, unknown>,
  itemId: string,
  state: ReadonlySet<string>,
): CodexItemEvents {
  if (state.has(itemId)) return NO_ITEM_EVENTS;
  if (typeof item.message !== "string") return NO_ITEM_EVENTS;
  return {
    events: [{ kind: "error", message: eventText(item.message) }],
    emittedItemId: itemId,
  };
}

function mcpToolName(item: Record<string, unknown>): string | null {
  const server = safeIdentifier(item.server, MAX_AGENT_TOOL_NAME_BYTES);
  const tool = safeIdentifier(item.tool, MAX_AGENT_TOOL_NAME_BYTES);
  if (server === null || tool === null) return null;
  return safeIdentifier(`${server}/${tool}`, MAX_AGENT_TOOL_NAME_BYTES);
}

function changedPaths(value: unknown): string {
  if (!Array.isArray(value)) return "";
  const paths = value
    .map((change) => {
      const record = objectValue(change);
      if (record === null) return null;
      if (typeof record.path !== "string") return null;
      return record.path;
    })
    .filter((path): path is string => path !== null);
  return paths.join(", ");
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

function rememberItemId(state: ReadonlySet<string>, itemId: string | null): ReadonlySet<string> {
  if (itemId === null) return state;
  if (state.has(itemId)) return state;
  if (state.size < MAX_CODEX_EMITTED_ITEM_IDS) return new Set([...state, itemId]);
  const retained = [...state].slice(state.size - MAX_CODEX_EMITTED_ITEM_IDS + 1);
  return new Set([...retained, itemId]);
}

function toolSummary(value: unknown): string {
  if (typeof value === "string") return boundedUtf8Text(value, MAX_AGENT_TOOL_SUMMARY_BYTES);
  if (value === undefined || value === null) return "";
  return boundedUtf8Text(stringify(value), MAX_AGENT_TOOL_SUMMARY_BYTES);
}

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
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
