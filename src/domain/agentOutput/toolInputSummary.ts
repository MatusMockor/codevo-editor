import { MAX_AGENT_TOOL_SUMMARY_BYTES } from "../agentThread";
import { clipHeadTail } from "./clipHeadTail";
import { boundUtf8Text, utf8ByteLength } from "./utf8Text";

const ELLIPSIS = "…";
const MAX_TODO_ITEMS_SCANNED = 64;
const MAX_TODO_TEXT_BYTES = 96;
const WHITESPACE_RUN = /\s+/gu;

type ToolInputSummarizer = (input: unknown) => string | null;

const SUMMARY_FIELDS: ReadonlyMap<string, string> = new Map([
  ["Read", "file_path"],
  ["Edit", "file_path"],
  ["Write", "file_path"],
  ["MultiEdit", "file_path"],
  ["NotebookEdit", "notebook_path"],
  ["NotebookRead", "notebook_path"],
  ["Bash", "command"],
  ["WebFetch", "url"],
  ["WebSearch", "query"],
  ["Agent", "description"],
  ["Task", "description"],
  ["SpawnAgent", "description"],
  ["spawn_agent", "description"],
]);

const SUMMARIZERS: ReadonlyMap<string, ToolInputSummarizer> = new Map([
  ["Grep", searchSummary],
  ["Glob", searchSummary],
  ["TodoWrite", todoSummary],
]);

const TODO_MARKERS: ReadonlyMap<string, string> = new Map([
  ["completed", "✓"],
  ["in_progress", "→"],
  ["pending", "○"],
]);

export function summarizeToolInput(name: string, input: unknown): string {
  const summary = SUMMARIZERS.get(name)?.(input) ?? fieldSummary(name, input);
  if (summary !== null) return clipHead(summary);
  return clipHead(stringifyToolInput(input));
}

export function summarizeToolOutput(content: unknown): string {
  return clipHeadTail(toolOutputText(content), MAX_AGENT_TOOL_SUMMARY_BYTES).text;
}

function fieldSummary(name: string, input: unknown): string | null {
  const field = SUMMARY_FIELDS.get(name);
  if (field === undefined) return null;
  return stringField(input, field);
}

function searchSummary(input: unknown): string | null {
  const pattern = stringField(input, "pattern");
  if (pattern === null) return null;
  const path = stringField(input, "path");
  if (path === null) return pattern;
  return `${pattern} in ${path}`;
}

function todoSummary(input: unknown): string | null {
  const todos = objectField(input, "todos");
  if (!Array.isArray(todos)) return null;
  const entries = todos
    .slice(0, MAX_TODO_ITEMS_SCANNED)
    .map(todoEntry)
    .filter((entry): entry is string => entry !== null);
  const count = `${todos.length} ${todos.length === 1 ? "todo" : "todos"}`;
  if (entries.length === 0) return count;
  return `${count}: ${entries.join(", ")}`;
}

function todoEntry(todo: unknown): string | null {
  const content = stringField(todo, "content");
  if (content === null) return null;
  const text = content.replace(WHITESPACE_RUN, " ").trim();
  if (text === "") return null;
  const status = stringField(todo, "status");
  const marker = (status === null ? undefined : TODO_MARKERS.get(status)) ?? "•";
  return `${marker} ${clipText(text, MAX_TODO_TEXT_BYTES)}`;
}

function clipHead(text: string): string {
  return clipText(text, MAX_AGENT_TOOL_SUMMARY_BYTES);
}

function clipText(text: string, maxBytes: number): string {
  const whole = boundUtf8Text(text, maxBytes);
  if (!whole.clipped) return whole.text;
  return `${boundUtf8Text(text, maxBytes - utf8ByteLength(ELLIPSIS)).text}${ELLIPSIS}`;
}

function toolOutputText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return stringifyToolInput(content);
  const blocks = content
    .map((block) => stringField(block, "text"))
    .filter((text): text is string => text !== null);
  if (blocks.length === 0) return stringifyToolInput(content);
  return blocks.join("\n");
}

function objectField(value: unknown, field: string): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return (value as Record<string, unknown>)[field];
}

function stringField(value: unknown, field: string): string | null {
  const candidate = objectField(value, field);
  if (typeof candidate !== "string" || candidate.length === 0) return null;
  return candidate;
}

function stringifyToolInput(input: unknown): string {
  if (input === undefined) return "";
  try {
    return JSON.stringify(input) ?? "";
  } catch {
    return "";
  }
}
