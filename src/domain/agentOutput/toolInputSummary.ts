import { MAX_AGENT_TOOL_SUMMARY_BYTES } from "../agentThread";
import { boundedUtf8Text } from "./utf8Text";

const SUMMARY_FIELDS: ReadonlyMap<string, string> = new Map([
  ["Read", "file_path"],
  ["Edit", "file_path"],
  ["Write", "file_path"],
  ["MultiEdit", "file_path"],
  ["Bash", "command"],
  ["Grep", "pattern"],
  ["Glob", "pattern"],
]);

export function summarizeToolInput(name: string, input: unknown): string {
  const field = SUMMARY_FIELDS.get(name);
  const direct = field === undefined ? null : stringField(input, field);
  if (direct !== null) return boundedUtf8Text(direct, MAX_AGENT_TOOL_SUMMARY_BYTES);
  return boundedUtf8Text(stringifyToolInput(input), MAX_AGENT_TOOL_SUMMARY_BYTES);
}

export function summarizeToolOutput(content: unknown): string {
  return boundedUtf8Text(toolOutputText(content), MAX_AGENT_TOOL_SUMMARY_BYTES);
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

function stringField(value: unknown, field: string): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = (value as Record<string, unknown>)[field];
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
