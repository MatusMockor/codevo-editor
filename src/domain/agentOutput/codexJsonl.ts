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
import { clipHeadTail } from "./clipHeadTail";
import { redactToolArguments } from "./toolArgumentRedaction";
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
const TODO_LIST_TOOL_NAME = "update_plan";
const CONTROL_CHARACTER_PATTERN = /\p{Cc}/u;
const MAX_EXEC_TYPE_LABEL_BYTES = 64;
const MAX_TODO_ITEMS = 32;
const MAX_CHANGE_ENTRIES = 64;
const MAX_MCP_CONTENT_PARTS = 16;
const IGNORED_EVENT_TYPES: ReadonlySet<string> = new Set(["turn.started", "item.updated"]);

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
  if (typeof value.type === "string" && IGNORED_EVENT_TYPES.has(value.type))
    return { result: IGNORED, state };
  return {
    result: { kind: "unknown", raw: `Unsupported Codex exec event: ${typeLabel(value.type)}` },
    state,
  };
}

function typeLabel(value: unknown): string {
  return safeIdentifier(value, MAX_EXEC_TYPE_LABEL_BYTES) ?? "<invalid type>";
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
  if (item.type === "context_compaction" || item.type === "contextCompaction") {
    return compactionEvents(item, completed, state);
  }
  const itemId = safeIdentifier(item.id, MAX_AGENT_TOOL_ID_BYTES);
  if (itemId === null) return NO_ITEM_EVENTS;
  if (item.type === "command_execution") return commandEvents(item, itemId, completed, state);
  if (item.type === "file_change") return fileChangeEvents(item, itemId, completed, state);
  if (item.type === "mcp_tool_call") return mcpToolCallEvents(item, itemId, completed, state);
  if (item.type === "web_search") return webSearchEvents(item, itemId, completed, state);
  if (item.type === "todo_list") return todoListEvents(item, itemId, completed, state);
  if (item.type === "error") return errorItemEvents(item, itemId, state);
  return unknownItemEvents(item, itemId, state);
}

function unknownItemEvents(
  item: Record<string, unknown>,
  itemId: string,
  state: ReadonlySet<string>,
): CodexItemEvents {
  if (state.has(itemId)) return NO_ITEM_EVENTS;
  return {
    events: [
      {
        kind: "unknownLine",
        stream: "stdout",
        raw: `Unsupported Codex exec item: ${typeLabel(item.type)}`,
        clipped: false,
      },
    ],
    emittedItemId: itemId,
  };
}

function toolEvents(
  call: Extract<AgentTurnEvent, { kind: "toolCall" }>,
  result: Extract<AgentTurnEvent, { kind: "toolResult" }> | null,
  state: ReadonlySet<string>,
): CodexItemEvents {
  const alreadyEmitted = state.has(call.toolId);
  const events: AgentTurnEvent[] = alreadyEmitted ? [] : [call];
  if (result !== null) events.push(result);
  if (events.length === 0) return NO_ITEM_EVENTS;
  return { events, emittedItemId: alreadyEmitted ? null : call.toolId };
}

function compactionEvents(
  item: Record<string, unknown>,
  completed: boolean,
  state: ReadonlySet<string>,
): CodexItemEvents {
  if (!completed) return NO_ITEM_EVENTS;
  const itemId = safeIdentifier(item.id, MAX_AGENT_TOOL_ID_BYTES);
  if (itemId !== null && state.has(itemId)) return NO_ITEM_EVENTS;
  return {
    events: [
      {
        kind: "contextCompaction",
        beforeTokens: tokenCount(item.pre_tokens ?? item.preTokens),
        afterTokens: tokenCount(item.post_tokens ?? item.postTokens),
      },
    ],
    emittedItemId: itemId,
  };
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
  return toolEvents(
    {
      kind: "toolCall",
      toolId: itemId,
      name: SHELL_TOOL_NAME,
      inputSummary: toolSummary(item.command),
    },
    completed
      ? {
          kind: "toolResult",
          toolId: itemId,
          outputSummary: commandOutputSummary(item),
          isError: item.exit_code !== 0,
        }
      : null,
    state,
  );
}

function commandOutputSummary(item: Record<string, unknown>): string {
  const output = typeof item.aggregated_output === "string" ? item.aggregated_output : "";
  const prefix = commandStatusPrefix(item);
  if (prefix === null) return clipHeadTail(output, MAX_AGENT_TOOL_SUMMARY_BYTES).text;
  const header = output === "" ? prefix : `${prefix}\n`;
  const budget = MAX_AGENT_TOOL_SUMMARY_BYTES - utf8ByteLength(header);
  return `${header}${clipHeadTail(output, budget).text}`;
}

function commandStatusPrefix(item: Record<string, unknown>): string | null {
  if (item.status === "declined") return "declined";
  const exitCode = item.exit_code;
  if (!Number.isSafeInteger(exitCode) || exitCode === 0) return null;
  return `exit ${exitCode as number}`;
}

function fileChangeEvents(
  item: Record<string, unknown>,
  itemId: string,
  completed: boolean,
  state: ReadonlySet<string>,
): CodexItemEvents {
  const failed = item.status !== "completed";
  return toolEvents(
    {
      kind: "toolCall",
      toolId: itemId,
      name: APPLY_PATCH_TOOL_NAME,
      inputSummary: boundedUtf8Text(changedPaths(item.changes), MAX_AGENT_TOOL_SUMMARY_BYTES),
    },
    completed
      ? {
          kind: "toolResult",
          toolId: itemId,
          outputSummary: fileChangeSummary(item),
          isError: failed,
        }
      : null,
    state,
  );
}

function fileChangeSummary(item: Record<string, unknown>): string {
  const status = item.status === "completed" ? [] : [statusLabel("patch", item.status)];
  const changes = Array.isArray(item.changes) ? item.changes.slice(0, MAX_CHANGE_ENTRIES) : [];
  const lines = changes.flatMap((change) => {
    const record = objectValue(change);
    if (record === null || typeof record.path !== "string") return [];
    const kind = typeof record.kind === "string" ? record.kind : "change";
    return [`${kind} ${record.path}`];
  });
  return boundedUtf8Text([...status, ...lines].join("\n"), MAX_AGENT_TOOL_SUMMARY_BYTES);
}

function mcpToolCallEvents(
  item: Record<string, unknown>,
  itemId: string,
  completed: boolean,
  state: ReadonlySet<string>,
): CodexItemEvents {
  const name = mcpToolName(item);
  if (name === null) return NO_ITEM_EVENTS;
  const error = objectValue(item.error);
  return toolEvents(
    { kind: "toolCall", toolId: itemId, name, inputSummary: argumentsSummary(item.arguments) },
    completed
      ? {
          kind: "toolResult",
          toolId: itemId,
          outputSummary: mcpResultSummary(item, error),
          isError: item.status !== "completed" || error !== null,
        }
      : null,
    state,
  );
}

function mcpResultSummary(
  item: Record<string, unknown>,
  error: Record<string, unknown> | null,
): string {
  if (error !== null && typeof error.message === "string")
    return clipHeadTail(error.message, MAX_AGENT_TOOL_SUMMARY_BYTES).text;
  if (item.status !== "completed") return statusLabel("MCP call", item.status);
  const result = objectValue(item.result);
  if (result === null) return "";
  const content = Array.isArray(result.content) ? result.content : [];
  if (content.length === 0) return toolSummary(result.structured_content);
  const parts = content.slice(0, MAX_MCP_CONTENT_PARTS).map((part) => {
    const record = objectValue(part);
    if (record?.type === "text" && typeof record.text === "string") return record.text;
    const label = safeIdentifier(record?.type, MAX_EXEC_TYPE_LABEL_BYTES);
    return label === null ? "[content]" : `[${label}]`;
  });
  return clipHeadTail(parts.join("\n"), MAX_AGENT_TOOL_SUMMARY_BYTES).text;
}

function webSearchEvents(
  item: Record<string, unknown>,
  itemId: string,
  completed: boolean,
  state: ReadonlySet<string>,
): CodexItemEvents {
  return toolEvents(
    {
      kind: "toolCall",
      toolId: itemId,
      name: WEB_SEARCH_TOOL_NAME,
      inputSummary: toolSummary(item.query),
    },
    completed
      ? {
          kind: "toolResult",
          toolId: itemId,
          outputSummary: toolSummary(item.query),
          isError: false,
        }
      : null,
    state,
  );
}

function statusLabel(subject: string, status: unknown): string {
  if (status === "failed" || status === "declined") return `${subject} ${status}`;
  if (status === "in_progress") return `${subject} did not finish`;
  const label = safeIdentifier(status, MAX_EXEC_TYPE_LABEL_BYTES) ?? "<missing>";
  return `${subject} status unknown: ${label}`;
}

function todoListEvents(
  item: Record<string, unknown>,
  itemId: string,
  completed: boolean,
  state: ReadonlySet<string>,
): CodexItemEvents {
  const summary = todoListSummary(item.items);
  return toolEvents(
    { kind: "toolCall", toolId: itemId, name: TODO_LIST_TOOL_NAME, inputSummary: summary },
    completed
      ? { kind: "toolResult", toolId: itemId, outputSummary: summary, isError: false }
      : null,
    state,
  );
}

function todoListSummary(value: unknown): string {
  if (!Array.isArray(value)) return "";
  const lines = value.slice(0, MAX_TODO_ITEMS).flatMap((entry) => {
    const record = objectValue(entry);
    if (record === null || typeof record.text !== "string") return [];
    return [`${record.completed === true ? "[x]" : "[ ]"} ${record.text}`];
  });
  const omitted = value.length > MAX_TODO_ITEMS ? [`… ${value.length - MAX_TODO_ITEMS} more`] : [];
  return boundedUtf8Text([...lines, ...omitted].join("\n"), MAX_AGENT_TOOL_SUMMARY_BYTES);
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
  return { inputTokens, outputTokens, contextTokens: inputTokens };
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

function argumentsSummary(value: unknown): string {
  if (value === undefined || value === null) return "";
  return toolSummary(redactToolArguments(value).value);
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
