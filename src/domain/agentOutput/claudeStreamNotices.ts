import { MAX_AGENT_EVENT_TEXT_BYTES, type AgentTurnEvent } from "../agentThread";
import { boundUtf8Text, utf8ByteLength } from "./utf8Text";

const MAX_NOTICE_BYTES = 1_024;
const MAX_LISTED_NAMES = 8;
const MAX_SCANNED_ENTRIES = 256;
const MAX_NAME_BYTES = 128;
const MAX_FRAME_TYPE_BYTES = 64;
const MAX_RETRY_ATTEMPTS = 1_000;
const MAX_RETRY_DELAY_MS = 86_400_000;
const CONTROL_CHARACTER_PATTERN = /\p{Cc}/u;
const ERROR_CLASS_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u;
const FRAME_TYPE_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]*$/u;

const FAILED_MCP_STATUS = "failed";
const RETRY_NOTICE_PREFIX = "Claude API request failed; retry";
const UNKNOWN_FRAME_NOTICE_PREFIX = "Unsupported Claude stream frame: ";

export type ClaudeNoticeClass =
  { readonly kind: "apiRetry" } | { readonly kind: "unknownFrame"; readonly frameType: string };

export function claudeNoticeClass(event: AgentTurnEvent): ClaudeNoticeClass | null {
  if (event.kind !== "unknownLine" || event.stream !== "stdout") return null;
  if (event.raw.startsWith(RETRY_NOTICE_PREFIX)) return { kind: "apiRetry" };
  if (!event.raw.startsWith(UNKNOWN_FRAME_NOTICE_PREFIX)) return null;
  return { kind: "unknownFrame", frameType: event.raw.slice(UNKNOWN_FRAME_NOTICE_PREFIX.length) };
}

export function claudeNoticeLine(text: string): AgentTurnEvent {
  return notice(text);
}

export function claudeApiRetryNotice(value: Record<string, unknown>): AgentTurnEvent {
  const attempt = boundedInteger(value.attempt, MAX_RETRY_ATTEMPTS);
  const maxRetries = boundedInteger(value.max_retries, MAX_RETRY_ATTEMPTS);
  const delayMs = boundedInteger(value.retry_delay_ms, MAX_RETRY_DELAY_MS);
  const status = boundedInteger(value.error_status, 999);
  const errorClass =
    typeof value.error === "string" && ERROR_CLASS_PATTERN.test(value.error) ? value.error : null;
  const progress = retryProgressLabel(attempt, maxRetries);
  const delay = delayMs === null ? "" : ` in ${retryDelayLabel(delayMs)}`;
  const reasons = [errorClass, status === null ? null : `HTTP ${status}`].filter(
    (reason): reason is string => reason !== null,
  );
  const reason = reasons.length === 0 ? "" : ` (${reasons.join(", ")})`;
  return notice(`${RETRY_NOTICE_PREFIX}${progress}${delay}${reason}`);
}

export function claudeFailedMcpNotice(servers: unknown): AgentTurnEvent | null {
  if (!Array.isArray(servers)) return null;
  const names = servers
    .slice(0, MAX_SCANNED_ENTRIES)
    .map(failedMcpServerName)
    .filter((entry): entry is string => entry !== null);
  if (names.length === 0) return null;
  return notice(`Warning: MCP servers failed to start: ${listedNames(names)}`);
}

export function claudePermissionDenialNotice(denials: unknown): AgentTurnEvent | null {
  if (!Array.isArray(denials) || denials.length === 0) return null;
  const names = denials
    .slice(0, MAX_SCANNED_ENTRIES)
    .map((denial) => safeName(objectValue(denial)?.tool_name))
    .map((name) => name ?? "unknown tool");
  const count = denials.length === 1 ? "1 tool call" : `${denials.length} tool calls`;
  return notice(`Permission denied for ${count}: ${listedNames(names, denials.length)}`);
}

export function claudeUnknownFrameNotice(type: unknown): AgentTurnEvent {
  return notice(`${UNKNOWN_FRAME_NOTICE_PREFIX}${frameTypeLabel(type)}`);
}

function failedMcpServerName(value: unknown): string | null {
  const server = objectValue(value);
  if (server === null || server.status !== FAILED_MCP_STATUS) return null;
  return safeName(server.name);
}

function listedNames(names: ReadonlyArray<string>, total = names.length): string {
  const listed = names.slice(0, MAX_LISTED_NAMES).join(", ");
  const hidden = total - Math.min(names.length, MAX_LISTED_NAMES);
  return hidden > 0 ? `${listed}, +${hidden} more` : listed;
}

function retryProgressLabel(attempt: number | null, maxRetries: number | null): string {
  if (attempt === null) return "";
  if (maxRetries === null) return ` ${attempt}`;
  return ` ${attempt}/${maxRetries}`;
}

function retryDelayLabel(delayMs: number): string {
  if (delayMs < 1_000) return `${delayMs}ms`;
  return `${Math.round(delayMs / 100) / 10}s`;
}

function frameTypeLabel(type: unknown): string {
  if (typeof type !== "string") return "<missing type>";
  if (utf8ByteLength(type) > MAX_FRAME_TYPE_BYTES) return "<invalid type>";
  if (!FRAME_TYPE_PATTERN.test(type)) return "<invalid type>";
  return type;
}

function safeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  if (name === "" || CONTROL_CHARACTER_PATTERN.test(name)) return null;
  if (utf8ByteLength(name) > MAX_NAME_BYTES) return null;
  return name;
}

function boundedInteger(value: unknown, max: number): number | null {
  if (!Number.isSafeInteger(value)) return null;
  const number = value as number;
  if (number < 0 || number > max) return null;
  return number;
}

function notice(text: string): AgentTurnEvent {
  const bounded = boundUtf8Text(text, Math.min(MAX_NOTICE_BYTES, MAX_AGENT_EVENT_TEXT_BYTES));
  return { kind: "unknownLine", stream: "stdout", raw: bounded.text, clipped: bounded.clipped };
}

function objectValue(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
