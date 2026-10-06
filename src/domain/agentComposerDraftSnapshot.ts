import { utf8ByteLength } from "@codevo/agent-events";
import { MAX_AGENT_TASK_PROMPT_BYTES } from "./agentTask";

export type AgentComposerDraftEntry = readonly [key: string, text: string];

export const AGENT_COMPOSER_DRAFT_SNAPSHOT_VERSION = 1;
export const MAX_AGENT_COMPOSER_DRAFT_TEXT_BYTES = 2 * MAX_AGENT_TASK_PROMPT_BYTES;
export const MAX_AGENT_COMPOSER_DRAFT_KEY_CHARS = 4_160;
export const MAX_PERSISTED_AGENT_COMPOSER_DRAFTS = 32;
export const MAX_PERSISTED_AGENT_COMPOSER_DRAFT_TOTAL_BYTES = 256 * 1_024;
export const MAX_AGENT_COMPOSER_DRAFT_SNAPSHOT_RAW_CHARS = 512 * 1_024;

const EPHEMERAL_DRAFT_KEY_PREFIX = "clone:";
const NO_ENTRIES: readonly AgentComposerDraftEntry[] = Object.freeze([]);

export function isAgentComposerDraftTextRetainable(text: string): boolean {
  if (text === "") return false;
  if (text.length > MAX_AGENT_COMPOSER_DRAFT_TEXT_BYTES) return false;
  if (text.length * 3 <= MAX_AGENT_COMPOSER_DRAFT_TEXT_BYTES) return true;
  return utf8ByteLength(text) <= MAX_AGENT_COMPOSER_DRAFT_TEXT_BYTES;
}

export function parseAgentComposerDraftSnapshot(
  raw: string | null,
): readonly AgentComposerDraftEntry[] {
  if (raw === null || raw === "" || raw.length > MAX_AGENT_COMPOSER_DRAFT_SNAPSHOT_RAW_CHARS) {
    return NO_ENTRIES;
  }
  const value = parseJson(raw);
  if (!isRecord(value)) return NO_ENTRIES;
  const fields = Object.keys(value).sort();
  if (fields.length !== 2 || fields[0] !== "drafts" || fields[1] !== "version") return NO_ENTRIES;
  if (value.version !== AGENT_COMPOSER_DRAFT_SNAPSHOT_VERSION) return NO_ENTRIES;
  if (!Array.isArray(value.drafts)) return NO_ENTRIES;
  const drafts: readonly unknown[] = value.drafts;
  return boundAgentComposerDraftEntries(drafts.filter(isEntryShape));
}

export function serializeAgentComposerDraftSnapshot(
  entries: readonly AgentComposerDraftEntry[],
): string {
  let bounded = boundAgentComposerDraftEntries(entries);
  let raw = wireFormat(bounded);
  while (raw.length > MAX_AGENT_COMPOSER_DRAFT_SNAPSHOT_RAW_CHARS && bounded.length > 0) {
    bounded = bounded.slice(1);
    raw = wireFormat(bounded);
  }
  return raw;
}

export function boundAgentComposerDraftEntries(
  entries: readonly AgentComposerDraftEntry[],
): readonly AgentComposerDraftEntry[] {
  const kept: AgentComposerDraftEntry[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (kept.length >= MAX_PERSISTED_AGENT_COMPOSER_DRAFTS) break;
    const [key, text] = entries[index];
    if (seen.has(key)) continue;
    seen.add(key);
    if (!isPersistableEntry(key, text)) continue;
    const entryBytes = utf8ByteLength(key) + utf8ByteLength(text);
    if (totalBytes + entryBytes > MAX_PERSISTED_AGENT_COMPOSER_DRAFT_TOTAL_BYTES) continue;
    totalBytes += entryBytes;
    kept.push([key, text]);
  }
  return kept.reverse();
}

function isPersistableEntry(key: string, text: string): boolean {
  if (key === "" || key.length > MAX_AGENT_COMPOSER_DRAFT_KEY_CHARS) return false;
  if (key.startsWith(EPHEMERAL_DRAFT_KEY_PREFIX)) return false;
  return isAgentComposerDraftTextRetainable(text);
}

function wireFormat(entries: readonly AgentComposerDraftEntry[]): string {
  return JSON.stringify({ version: AGENT_COMPOSER_DRAFT_SNAPSHOT_VERSION, drafts: entries });
}

function isEntryShape(value: unknown): value is AgentComposerDraftEntry {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "string" &&
    typeof value[1] === "string"
  );
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
