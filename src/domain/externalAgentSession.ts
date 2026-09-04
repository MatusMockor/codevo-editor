import { MAX_AGENT_TASK_PATH_BYTES, type AgentCliKind } from "./agentTask";
import { MAX_AGENT_EVENT_TEXT_BYTES, MAX_AGENT_THREAD_TITLE_BYTES } from "./agentThreadLimits";

export const MAX_EXTERNAL_SESSION_ENTRIES = 200;
export const MAX_PREVIEW_EXCHANGES = 40;
export const PREVIEW_TOTAL_BYTES = 64 * 1_024;
export const MAX_HISTORY_EXCHANGES = 256;
export const HISTORY_TOTAL_BYTES = 128 * 1_024;
export const MAX_EXTERNAL_SESSION_TITLE_BYTES = MAX_AGENT_THREAD_TITLE_BYTES;
export const MAX_EXTERNAL_SESSION_TEXT_BYTES = MAX_AGENT_EVENT_TEXT_BYTES;
export const MAX_EXTERNAL_SESSION_PATH_BYTES = MAX_AGENT_TASK_PATH_BYTES;
export const MAX_EXTERNAL_SESSION_TURN_COUNT = 1_000_000;
export const MAX_EXTERNAL_SESSION_FILE_BYTES = 64 * 1_024 * 1_024 * 1_024;

export const EXTERNAL_AGENT_SESSION_ID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export type ExternalSessionExchangeRole = "user" | "assistant";

export interface ExternalAgentSessionSummary {
  readonly provider: AgentCliKind;
  readonly sessionId: string;
  readonly cwd: string;
  readonly title: string;
  readonly firstPrompt: string;
  readonly startedAtEpochMs: number;
  readonly lastActivityEpochMs: number;
  readonly turnCount: number;
  readonly turnCountExact: boolean;
  readonly fileBytes: number;
}

export interface ExternalAgentSessionView extends ExternalAgentSessionSummary {
  readonly alreadyImportedThreadId: string | null;
}

export interface ExternalSessionListSnapshot {
  readonly sessions: ReadonlyArray<ExternalAgentSessionSummary>;
  readonly skipped: number;
  readonly truncated: boolean;
}

export interface ExternalSessionExchange {
  readonly role: ExternalSessionExchangeRole;
  readonly text: string;
}

export interface ExternalAgentSessionPreview {
  readonly provider: AgentCliKind;
  readonly sessionId: string;
  readonly exchanges: ReadonlyArray<ExternalSessionExchange>;
  readonly exchangesTruncated: boolean;
  readonly totalPreviewBytes: number;
}

export interface ExternalSessionListRequest {
  readonly projectRoot: string;
  readonly repositoryRoot: string;
}

export type ExternalAgentSessionHistory = ExternalAgentSessionPreview;

export interface ExternalSessionHistoryRequest extends ExternalSessionPreviewRequest {
  readonly beforeEpochMs: number;
}

export interface ExternalSessionPreviewRequest {
  readonly provider: AgentCliKind;
  readonly sessionId: string;
  readonly projectRoot: string;
  readonly repositoryRoot: string;
}

const UTF8_ENCODER = new TextEncoder();

const CONTROL_CHARACTERS = /\p{Cc}/u;
const MULTILINE_CONTROL_CHARACTERS = /[^\P{Cc}\n\t]/u;

export function isExternalAgentSessionId(value: unknown): value is string {
  return typeof value === "string" && EXTERNAL_AGENT_SESSION_ID_PATTERN.test(value);
}

export function validateExternalSessionId(value: unknown, path = "sessionId"): string {
  if (!isExternalAgentSessionId(value)) invalid(path, "a canonical UUID external session id");
  return value;
}

export function validateExternalSessionProvider(value: unknown, path = "provider"): AgentCliKind {
  if (value !== "claudeCode" && value !== "codex") invalid(path, "either claudeCode or codex");
  return value;
}

export function validateExternalSessionRepositoryRoot(
  value: unknown,
  path = "repositoryRoot",
): string {
  const candidate = boundedText(value, path, MAX_EXTERNAL_SESSION_PATH_BYTES);
  if (candidate === "" || !candidate.startsWith("/")) {
    invalid(path, "a non-empty absolute repository root path");
  }
  return candidate;
}

export function isExternalSessionWithinRepository(sessionRoot: string, scopeRoot: string): boolean {
  if (!isLexicallyCanonicalAbsolutePath(sessionRoot)) return false;
  if (!isLexicallyCanonicalAbsolutePath(scopeRoot)) return false;
  if (sessionRoot === scopeRoot) return true;
  if (scopeRoot === "/") return sessionRoot.startsWith("/");
  return sessionRoot.startsWith(`${scopeRoot}/`);
}

function isLexicallyCanonicalAbsolutePath(value: string): boolean {
  if (!value.startsWith("/")) return false;
  if (value === "/") return true;
  if (value.endsWith("/") || value.includes("//")) return false;
  return value
    .split("/")
    .slice(1)
    .every((segment) => segment !== "." && segment !== "..");
}

export function parseExternalSessionListSnapshot(
  value: unknown,
  path = "externalSessions",
): ExternalSessionListSnapshot {
  const snapshot = record(value, path);
  exactKeys(snapshot, ["sessions", "skipped", "truncated"], path);
  return {
    sessions: parseSummaries(snapshot.sessions, `${path}.sessions`),
    skipped: boundedCount(snapshot.skipped, `${path}.skipped`, MAX_EXTERNAL_SESSION_TURN_COUNT),
    truncated: booleanFlag(snapshot.truncated, `${path}.truncated`),
  };
}

export function parseExternalAgentSessionSummary(
  value: unknown,
  path = "externalSession",
): ExternalAgentSessionSummary {
  const summary = record(value, path);
  exactKeys(
    summary,
    [
      "provider",
      "sessionId",
      "cwd",
      "title",
      "firstPrompt",
      "startedAtEpochMs",
      "lastActivityEpochMs",
      "turnCount",
      "turnCountExact",
      "fileBytes",
    ],
    path,
  );
  return {
    provider: validateExternalSessionProvider(summary.provider, `${path}.provider`),
    sessionId: validateExternalSessionId(summary.sessionId, `${path}.sessionId`),
    cwd: validateExternalSessionRepositoryRoot(summary.cwd, `${path}.cwd`),
    title: boundedText(summary.title, `${path}.title`, MAX_EXTERNAL_SESSION_TITLE_BYTES),
    firstPrompt: boundedMultilineText(
      summary.firstPrompt,
      `${path}.firstPrompt`,
      MAX_EXTERNAL_SESSION_TEXT_BYTES,
    ),
    startedAtEpochMs: unsignedSafeInteger(summary.startedAtEpochMs, `${path}.startedAtEpochMs`),
    lastActivityEpochMs: unsignedSafeInteger(
      summary.lastActivityEpochMs,
      `${path}.lastActivityEpochMs`,
    ),
    turnCount: boundedCount(
      summary.turnCount,
      `${path}.turnCount`,
      MAX_EXTERNAL_SESSION_TURN_COUNT,
    ),
    turnCountExact: booleanFlag(summary.turnCountExact, `${path}.turnCountExact`),
    fileBytes: boundedCount(
      summary.fileBytes,
      `${path}.fileBytes`,
      MAX_EXTERNAL_SESSION_FILE_BYTES,
    ),
  };
}

export function parseExternalAgentSessionPreview(
  value: unknown,
  path = "externalSessionPreview",
): ExternalAgentSessionPreview {
  return parseSessionTranscript(value, path, MAX_PREVIEW_EXCHANGES, PREVIEW_TOTAL_BYTES);
}

export function parseExternalAgentSessionHistory(
  value: unknown,
  path = "externalSessionHistory",
): ExternalAgentSessionHistory {
  return parseSessionTranscript(value, path, MAX_HISTORY_EXCHANGES, HISTORY_TOTAL_BYTES);
}

function parseSessionTranscript(
  value: unknown,
  path: string,
  maximumExchanges: number,
  maximumBytes: number,
): ExternalAgentSessionPreview {
  const preview = record(value, path);
  exactKeys(
    preview,
    ["provider", "sessionId", "exchanges", "exchangesTruncated", "totalPreviewBytes"],
    path,
  );
  const exchanges = parseExchanges(preview.exchanges, `${path}.exchanges`, maximumExchanges);
  const actualBytes = exchanges.reduce(
    (total, exchange) => total + UTF8_ENCODER.encode(exchange.text).byteLength,
    0,
  );
  if (actualBytes > maximumBytes)
    invalid(`${path}.exchanges`, `at most ${maximumBytes} total text bytes`);
  const totalPreviewBytes = boundedCount(
    preview.totalPreviewBytes,
    `${path}.totalPreviewBytes`,
    maximumBytes,
  );
  if (maximumExchanges === MAX_HISTORY_EXCHANGES && totalPreviewBytes !== actualBytes) {
    invalid(`${path}.totalPreviewBytes`, "the actual total UTF-8 text bytes");
  }
  return {
    provider: validateExternalSessionProvider(preview.provider, `${path}.provider`),
    sessionId: validateExternalSessionId(preview.sessionId, `${path}.sessionId`),
    exchanges,
    exchangesTruncated: booleanFlag(preview.exchangesTruncated, `${path}.exchangesTruncated`),
    totalPreviewBytes,
  };
}

function parseSummaries(value: unknown, path: string): ReadonlyArray<ExternalAgentSessionSummary> {
  if (!Array.isArray(value) || value.length > MAX_EXTERNAL_SESSION_ENTRIES) {
    invalid(path, `an array of at most ${MAX_EXTERNAL_SESSION_ENTRIES} sessions`);
  }
  const seen = new Set<string>();
  return value.map((candidate, index) => {
    const summary = parseExternalAgentSessionSummary(candidate, `${path}[${index}]`);
    const identity = `${summary.provider}:${summary.sessionId}`;
    if (seen.has(identity)) invalid(`${path}[${index}]`, "a session listed exactly once");
    seen.add(identity);
    return summary;
  });
}

function parseExchanges(
  value: unknown,
  path: string,
  maximum: number,
): ReadonlyArray<ExternalSessionExchange> {
  if (!Array.isArray(value) || value.length > maximum) {
    invalid(path, `an array of at most ${maximum} exchanges`);
  }
  return value.map((candidate, index) => parseExchange(candidate, `${path}[${index}]`));
}

function parseExchange(value: unknown, path: string): ExternalSessionExchange {
  const exchange = record(value, path);
  exactKeys(exchange, ["role", "text"], path);
  return {
    role: exchangeRole(exchange.role, `${path}.role`),
    text: boundedMultilineText(exchange.text, `${path}.text`, MAX_EXTERNAL_SESSION_TEXT_BYTES),
  };
}

function exchangeRole(value: unknown, path: string): ExternalSessionExchangeRole {
  if (value !== "user" && value !== "assistant") invalid(path, "either user or assistant");
  return value;
}

function boundedCount(value: unknown, path: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    invalid(path, `an integer between 0 and ${maximum}`);
  }
  return value as number;
}

function unsignedSafeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    invalid(path, "a non-negative safe integer");
  }
  return value as number;
}

function booleanFlag(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") invalid(path, "a boolean");
  return value;
}

function boundedText(value: unknown, path: string, maxBytes: number): string {
  if (
    typeof value !== "string" ||
    CONTROL_CHARACTERS.test(value) ||
    UTF8_ENCODER.encode(value).byteLength > maxBytes
  ) {
    invalid(path, `a control-free string of at most ${maxBytes} UTF-8 bytes`);
  }
  return value;
}

function boundedMultilineText(value: unknown, path: string, maxBytes: number): string {
  if (
    typeof value !== "string" ||
    MULTILINE_CONTROL_CHARACTERS.test(value) ||
    UTF8_ENCODER.encode(value).byteLength > maxBytes
  ) {
    invalid(path, `a bounded string of at most ${maxBytes} UTF-8 bytes`);
  }
  return value;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value);
  if (actual.length !== expected.length || actual.some((key) => !expected.includes(key))) {
    invalid(path, `exactly the fields ${expected.join(", ")}`);
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(path, "an object");
  }
  return value as Record<string, unknown>;
}

function invalid(path: string, expectation: string): never {
  throw new TypeError(`Invalid external agent session value at ${path}: expected ${expectation}.`);
}
