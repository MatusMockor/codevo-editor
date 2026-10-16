import { isAgentMcpServerName } from "./agentMcpServers";

export const REMOTE_MCP_DEVICE_SYNC_PROJECT_KINDS = ["folder", "git"] as const;
export type RemoteMcpDeviceSyncProjectKind = (typeof REMOTE_MCP_DEVICE_SYNC_PROJECT_KINDS)[number];

export const REMOTE_MCP_DEVICE_SYNC_TRANSPORTS = ["stdio", "http", "sse", "unknown"] as const;
export type RemoteMcpDeviceSyncTransport = (typeof REMOTE_MCP_DEVICE_SYNC_TRANSPORTS)[number];

export const REMOTE_MCP_DEVICE_SYNC_OUTCOMES = [
  "added",
  "updated",
  "unchanged",
  "removed",
  "keptServerEntry",
  "commandMissing",
  "failed",
  "skipped",
  "conflict",
] as const;
export type RemoteMcpDeviceSyncOutcome = (typeof REMOTE_MCP_DEVICE_SYNC_OUTCOMES)[number];

export const REMOTE_MCP_DEVICE_SYNC_HINTS = [
  "mayNeedSignIn",
  "envExpansion",
  "macPath",
  "unsupportedTransport",
  "headersHelper",
  "oauthClient",
  "invalidName",
  "invalidConfig",
  "overLimit",
] as const;
export type RemoteMcpDeviceSyncHint = (typeof REMOTE_MCP_DEVICE_SYNC_HINTS)[number];

export type RemoteMcpDeviceSyncResult = Readonly<{
  name: string;
  transport: RemoteMcpDeviceSyncTransport;
  outcome: RemoteMcpDeviceSyncOutcome;
  hints: readonly RemoteMcpDeviceSyncHint[];
}>;

export type RemoteRunnerMcpDeviceSyncReport = Readonly<{
  version: 1;
  results: readonly RemoteMcpDeviceSyncResult[];
  omitted: number;
}>;

export const REMOTE_MCP_DEVICE_SYNC_LIMITS = Object.freeze({
  maxResults: 128,
  maxOmitted: 100_000,
  maxRootPathBytes: 4096,
  maxNoticeNames: 3,
  maxNoticeNameChars: 48,
  maxNoticeChars: 1000,
  maxFailureDetailChars: 600,
});

const REPORT_KEYS = ["version", "results", "omitted"] as const;
const RESULT_KEYS = ["name", "transport", "outcome", "hints"] as const;
const CONTROL = /\p{Cc}/u;
const UTF8 = new TextEncoder();

function invalid(): never {
  throw new TypeError("Invalid MCP device sync report.");
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid();
  const fields = Object.keys(value);
  if (fields.length !== keys.length || !fields.every((key) => keys.includes(key))) invalid();
  return value as Record<string, unknown>;
}

function member<T extends string>(values: readonly T[], value: unknown): T {
  const found = values.find((candidate) => candidate === value);
  if (found === undefined) invalid();
  return found;
}

function hints(value: unknown): readonly RemoteMcpDeviceSyncHint[] {
  if (!Array.isArray(value) || value.length > REMOTE_MCP_DEVICE_SYNC_HINTS.length) invalid();
  const parsed = value.map((hint) => member(REMOTE_MCP_DEVICE_SYNC_HINTS, hint));
  if (new Set(parsed).size !== parsed.length) invalid();
  return parsed;
}

function result(value: unknown): RemoteMcpDeviceSyncResult {
  const fields = record(value, RESULT_KEYS);
  if (!isAgentMcpServerName(fields.name)) invalid();
  return {
    name: fields.name,
    transport: member(REMOTE_MCP_DEVICE_SYNC_TRANSPORTS, fields.transport),
    outcome: member(REMOTE_MCP_DEVICE_SYNC_OUTCOMES, fields.outcome),
    hints: hints(fields.hints),
  };
}

export function parseRemoteRunnerMcpDeviceSyncReport(
  value: unknown,
): RemoteRunnerMcpDeviceSyncReport {
  const fields = record(value, REPORT_KEYS);
  if (fields.version !== 1) invalid();
  const omitted = fields.omitted;
  if (
    typeof omitted !== "number" ||
    !Number.isSafeInteger(omitted) ||
    omitted < 0 ||
    omitted > REMOTE_MCP_DEVICE_SYNC_LIMITS.maxOmitted
  )
    invalid();
  const results = fields.results;
  if (!Array.isArray(results) || results.length > REMOTE_MCP_DEVICE_SYNC_LIMITS.maxResults)
    invalid();
  const parsed = results.map(result);
  if (new Set(parsed.map((entry) => entry.name)).size !== parsed.length) invalid();
  return { version: 1, results: parsed, omitted };
}

export function isRemoteMcpDeviceSyncProjectKind(
  value: unknown,
): value is RemoteMcpDeviceSyncProjectKind {
  return REMOTE_MCP_DEVICE_SYNC_PROJECT_KINDS.some((kind) => kind === value);
}

export function isRemoteMcpDeviceSyncRootPath(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 2 || !value.startsWith("/")) return false;
  if (CONTROL.test(value) || value.includes("\\")) return false;
  if (UTF8.encode(value).byteLength > REMOTE_MCP_DEVICE_SYNC_LIMITS.maxRootPathBytes) return false;
  return !value
    .slice(1)
    .split("/")
    .some((part) => part === "" || part === "." || part === "..");
}

type NoticeKind = "change" | "persistent";
type NoticeSection = Readonly<{
  lead: string;
  kind: NoticeKind;
  matches(entry: RemoteMcpDeviceSyncResult): boolean;
}>;
export type RemoteMcpDeviceSyncPersistentNotice = "show" | "hide";

const installed = (entry: RemoteMcpDeviceSyncResult) =>
  entry.outcome === "added" || entry.outcome === "updated";
const installedWith = (hint: RemoteMcpDeviceSyncHint) => (entry: RemoteMcpDeviceSyncResult) =>
  installed(entry) && entry.hints.includes(hint);
const outcome = (value: RemoteMcpDeviceSyncOutcome) => (entry: RemoteMcpDeviceSyncResult) =>
  entry.outcome === value;
const skippedWith = (hint: RemoteMcpDeviceSyncHint) => (entry: RemoteMcpDeviceSyncResult) =>
  entry.outcome === "skipped" && entry.hints.includes(hint);
const skippedOtherwise = (entry: RemoteMcpDeviceSyncResult) =>
  entry.outcome === "skipped" &&
  !entry.hints.includes("overLimit") &&
  !entry.hints.includes("invalidConfig");

const PERSISTENT_OUTCOMES: ReadonlySet<RemoteMcpDeviceSyncOutcome> = new Set([
  "commandMissing",
  "keptServerEntry",
  "skipped",
  "conflict",
]);

const NOTICE_SECTIONS: readonly NoticeSection[] = [
  { lead: "Synced MCP servers from this Mac to the server:", kind: "change", matches: installed },
  {
    lead: "Sign in on the server in Settings > MCP servers:",
    kind: "change",
    matches: installedWith("mayNeedSignIn"),
  },
  {
    lead: "Uses a Mac path that may not exist on the server:",
    kind: "change",
    matches: installedWith("macPath"),
  },
  {
    lead: "Uses environment variable references the server must provide:",
    kind: "change",
    matches: installedWith("envExpansion"),
  },
  {
    lead: "Removed synced MCP servers that are no longer on this Mac:",
    kind: "change",
    matches: outcome("removed"),
  },
  {
    lead: "Not installed because the command is missing on the server:",
    kind: "persistent",
    matches: outcome("commandMissing"),
  },
  { lead: "Could not install on the server:", kind: "change", matches: outcome("failed") },
  {
    lead: "Kept the server's own settings for:",
    kind: "persistent",
    matches: outcome("keptServerEntry"),
  },
  {
    lead: "Not synced because their settings on this Mac are invalid:",
    kind: "persistent",
    matches: skippedWith("invalidConfig"),
  },
  {
    lead: "Not synced because they cannot be transferred to the server:",
    kind: "persistent",
    matches: skippedOtherwise,
  },
  {
    lead: "Not synced because at most 32 MCP servers can be synced:",
    kind: "persistent",
    matches: skippedWith("overLimit"),
  },
  {
    lead: "Not synced because nested folders define them differently:",
    kind: "persistent",
    matches: outcome("conflict"),
  },
];

function shortName(name: string): string {
  const max = REMOTE_MCP_DEVICE_SYNC_LIMITS.maxNoticeNameChars;
  const characters = Array.from(name);
  if (characters.length <= max) return name;
  return `${characters.slice(0, max - 1).join("")}…`;
}

function nameList(names: readonly string[]): string {
  const max = REMOTE_MCP_DEVICE_SYNC_LIMITS.maxNoticeNames;
  const shown = names.slice(0, max).map(shortName).join(", ");
  if (names.length <= max) return shown;
  return `${shown} and ${names.length - max} more`;
}

function serverCount(count: number): string {
  return count === 1 ? "1 MCP server" : `${count} MCP servers`;
}

function omittedSentence(omitted: number): readonly string[] {
  if (omitted === 0) return [];
  if (omitted === 1) return ["The name of 1 more MCP server could not be shown."];
  return [`Names of ${omitted} more MCP servers could not be shown.`];
}

function countSummary(entries: readonly RemoteMcpDeviceSyncResult[], omitted: number): string {
  return [
    `MCP server sync from this Mac reported changes for ${serverCount(entries.length)}. Review them in Settings > MCP servers.`,
    ...omittedSentence(omitted),
  ].join(" ");
}

function canonicalHints(hints: readonly RemoteMcpDeviceSyncHint[]): readonly string[] {
  return [...hints].sort();
}

function byName(left: RemoteMcpDeviceSyncResult, right: RemoteMcpDeviceSyncResult): number {
  if (left.name < right.name) return -1;
  return left.name > right.name ? 1 : 0;
}

export function deviceMcpSyncPersistentFingerprint(
  report: RemoteRunnerMcpDeviceSyncReport,
): string | null {
  const entries = report.results
    .filter((entry) => PERSISTENT_OUTCOMES.has(entry.outcome))
    .sort(byName)
    .map((entry) => [entry.name, entry.outcome, canonicalHints(entry.hints)]);
  if (entries.length === 0 && report.omitted === 0) return null;
  return JSON.stringify([entries, report.omitted]);
}

export function deviceMcpSyncNotice(
  report: RemoteRunnerMcpDeviceSyncReport,
  persistent: RemoteMcpDeviceSyncPersistentNotice = "show",
): string | null {
  const sections = NOTICE_SECTIONS.filter(
    (section) => section.kind === "change" || persistent === "show",
  );
  const omitted = persistent === "show" ? report.omitted : 0;
  const sentences = [
    ...sections.flatMap((section) => {
      const names = report.results.filter(section.matches).map((entry) => entry.name);
      return names.length === 0 ? [] : [`${section.lead} ${nameList(names)}.`];
    }),
    ...omittedSentence(omitted),
  ];
  if (sentences.length === 0) return null;
  const notice = sentences.join(" ");
  if (notice.length <= REMOTE_MCP_DEVICE_SYNC_LIMITS.maxNoticeChars) return notice;
  const reported = report.results.filter((entry) =>
    sections.some((section) => section.matches(entry)),
  );
  return countSummary(reported, omitted);
}

export type RemoteMcpDeviceSyncFailure =
  | Readonly<{ kind: "timeout"; seconds: number }>
  | Readonly<{ kind: "failed"; detail: string | null }>;

const FAILURE_TAIL = "The conversation starts with the server's current MCP servers.";

function boundedDetail(detail: string | null): string | null {
  if (detail === null) return null;
  const trimmed = detail.trim();
  if (trimmed.length === 0 || trimmed.length > REMOTE_MCP_DEVICE_SYNC_LIMITS.maxFailureDetailChars)
    return null;
  if (CONTROL.test(trimmed)) return null;
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

export function deviceMcpSyncFailureNotice(failure: RemoteMcpDeviceSyncFailure): string {
  switch (failure.kind) {
    case "timeout":
      return `MCP server sync from this Mac did not finish within ${failure.seconds} seconds. ${FAILURE_TAIL}`;
    case "failed": {
      const detail = boundedDetail(failure.detail);
      const reason = detail === null ? "" : ` ${detail}`;
      return `MCP servers from this Mac could not be synced to the server.${reason} ${FAILURE_TAIL}`;
    }
    default: {
      const unreachable: never = failure;
      return unreachable;
    }
  }
}
