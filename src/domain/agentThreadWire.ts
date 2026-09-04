import { parseAgentCliVersion } from "./agentCliVersion";
import {
  parseStoredAgentLaunchOptions,
  serializeAgentLaunchOptions,
  type AgentLaunchOptions,
} from "./agentLaunch";
import {
  AGENT_TASK_ID_PATTERN,
  MAX_AGENT_TASK_FAILURE_BYTES,
  MAX_AGENT_TASK_ID_BYTES,
  MAX_AGENT_TASK_PATH_BYTES,
  MAX_AGENT_TASK_PROMPT_BYTES,
  MAX_AGENT_TASK_WORKSPACE_ID_BYTES,
  isAgentSessionId,
  type AgentCliKind,
  type AgentTaskIsolation,
  type AgentTaskOutputStream,
} from "./agentTask";
import {
  MAX_AGENT_EVENTS_PER_TURN,
  MAX_AGENT_EVENT_TEXT_BYTES,
  MAX_AGENT_THREAD_TITLE_BYTES,
  MAX_AGENT_TOOL_ID_BYTES,
  MAX_AGENT_TOOL_NAME_BYTES,
  MAX_AGENT_TOOL_SUMMARY_BYTES,
  MAX_AGENT_TURNS_PER_THREAD,
  isTerminalAgentTurnStatus,
  type AgentProviderSession,
  type AgentThread,
  type AgentThreadExternalOrigin,
  type AgentThreadIntegration,
  type AgentThreadIntegrationReceipt,
  type AgentThreadOwner,
  type AgentThreadPushReceipt,
  type AgentThreadTarget,
  type AgentTurn,
  type AgentTurnEvent,
  type AgentTurnStreamMetrics,
  type AgentTurnStatus,
  type AgentTurnUsage,
} from "./agentThread";
import {
  GIT_REMOTE_NAME_PATTERN,
  GIT_SHA_PATTERN,
  MAX_GIT_INTEGRATION_BRANCH_BYTES,
  type GitIntegrationMode,
} from "./gitIntegration";

const UTF8_ENCODER = new TextEncoder();

export function serializeAgentThread(thread: AgentThread): Record<string, unknown> {
  return {
    threadId: thread.threadId,
    owner: {
      rootKey: thread.owner.rootKey,
      ownerId: thread.owner.ownerId,
      repositoryRoot: thread.owner.repositoryRoot,
    },
    target: { isolation: thread.target.isolation, worktreePath: thread.target.worktreePath },
    provider: { kind: thread.provider.kind, sessionId: thread.provider.sessionId },
    title: thread.title,
    pinned: thread.pinned,
    archived: thread.archived,
    createdAtEpochMs: thread.createdAtEpochMs,
    updatedAtEpochMs: thread.updatedAtEpochMs,
    turns: thread.turns.map(serializeTurn),
    turnsTruncated: thread.turnsTruncated,
    integration: serializeIntegration(thread.integration),
    viewedAtEpochMs: thread.viewedAtEpochMs,
    externalOrigin: serializeExternalOrigin(thread.externalOrigin),
  };
}

function serializeExternalOrigin(
  origin: AgentThreadExternalOrigin | null,
): Record<string, unknown> | null {
  if (origin === null) return null;
  return {
    provider: origin.provider,
    sessionId: origin.sessionId,
    importedAtEpochMs: origin.importedAtEpochMs,
  };
}

function serializeIntegration(
  integration: AgentThreadIntegration | null,
): Record<string, unknown> | null {
  if (integration === null) return null;
  return {
    lastCommitSha: integration.lastCommitSha,
    pushed:
      integration.pushed === null
        ? null
        : { remote: integration.pushed.remote, branch: integration.pushed.branch },
    integrated:
      integration.integrated === null
        ? null
        : {
            intoBranch: integration.integrated.intoBranch,
            mergeSha: integration.integrated.mergeSha,
            mode: integration.integrated.mode,
          },
    branchDeleted: integration.branchDeleted,
  };
}

function serializeTurn(turn: AgentTurn): Record<string, unknown> {
  return {
    turnId: turn.turnId,
    prompt: turn.prompt,
    status: serializeTurnStatus(turn.status),
    startedAtEpochMs: turn.startedAtEpochMs,
    endedAtEpochMs: turn.endedAtEpochMs,
    events: turn.events.map(serializeTurnEvent),
    eventsTruncated: turn.eventsTruncated,
    lastStatusSequence: turn.lastStatusSequence,
    lastOutputSequence: turn.lastOutputSequence,
    streamMetrics: turn.streamMetrics ?? null,
    launch: turn.launch === null ? null : serializeAgentLaunchOptions(turn.launch),
    cliVersion: turn.cliVersion,
  };
}

function serializeTurnStatus(status: AgentTurnStatus): Record<string, unknown> {
  switch (status.kind) {
    case "exited":
      return { kind: status.kind, exitCode: status.exitCode };
    case "failed":
      return { kind: status.kind, message: status.message };
    case "pending":
    case "running":
    case "stopped":
    case "interrupted":
      return { kind: status.kind };
    default:
      return unsupportedTurnStatus(status);
  }
}

function serializeTurnEvent(event: AgentTurnEvent): Record<string, unknown> {
  switch (event.kind) {
    case "assistantText":
    case "reasoning":
      return { kind: event.kind, text: event.text };
    case "toolCall":
      return {
        kind: event.kind,
        toolId: event.toolId,
        name: event.name,
        inputSummary: event.inputSummary,
      };
    case "toolResult":
      return {
        kind: event.kind,
        toolId: event.toolId,
        outputSummary: event.outputSummary,
        isError: event.isError,
      };
    case "result":
      return {
        kind: event.kind,
        text: event.text,
        isError: event.isError,
        usage:
          event.usage === null
            ? null
            : {
                inputTokens: event.usage.inputTokens,
                outputTokens: event.usage.outputTokens,
                contextTokens: event.usage.contextTokens,
                ...(event.usage.costUsd === undefined ? {} : { costUsd: event.usage.costUsd }),
              },
      };
    case "contextCompaction":
      return {
        kind: event.kind,
        beforeTokens: event.beforeTokens,
        afterTokens: event.afterTokens,
      };
    case "error":
      return { kind: event.kind, message: event.message };
    case "unknownLine":
      return { kind: event.kind, stream: event.stream, raw: event.raw, clipped: event.clipped };
    default:
      return unsupportedTurnEvent(event);
  }
}

export function parseAgentThread(value: unknown): AgentThread {
  const thread = record(value, "thread");
  boundedKeys(
    thread,
    [
      "threadId",
      "owner",
      "target",
      "provider",
      "title",
      "pinned",
      "archived",
      "createdAtEpochMs",
      "updatedAtEpochMs",
      "turns",
      "turnsTruncated",
    ],
    ["integration", "viewedAtEpochMs", "externalOrigin"],
    "thread",
  );
  const provider = parseProvider(thread.provider, "thread.provider");
  return {
    threadId: agentId(thread.threadId, "thread.threadId"),
    owner: parseOwner(thread.owner, "thread.owner"),
    target: parseTarget(thread.target, "thread.target"),
    provider,
    title: boundedText(thread.title, "thread.title", MAX_AGENT_THREAD_TITLE_BYTES, false),
    pinned: booleanFlag(thread.pinned, "thread.pinned"),
    archived: booleanFlag(thread.archived, "thread.archived"),
    createdAtEpochMs: unsignedSafeInteger(thread.createdAtEpochMs, "thread.createdAtEpochMs"),
    updatedAtEpochMs: unsignedSafeInteger(thread.updatedAtEpochMs, "thread.updatedAtEpochMs"),
    turns: parseTurns(thread.turns, "thread.turns"),
    turnsTruncated: booleanFlag(thread.turnsTruncated, "thread.turnsTruncated"),
    integration: parseIntegration(thread.integration, "thread.integration"),
    viewedAtEpochMs: parseViewedAt(thread.viewedAtEpochMs, "thread.viewedAtEpochMs"),
    externalOrigin: parseExternalOrigin(
      thread.externalOrigin,
      "thread.externalOrigin",
      provider.kind,
    ),
  };
}

function parseExternalOrigin(
  value: unknown,
  path: string,
  providerKind: AgentCliKind,
): AgentThreadExternalOrigin | null {
  if (value === undefined || value === null) return null;
  const origin = record(value, path);
  exactKeys(origin, ["provider", "sessionId", "importedAtEpochMs"], path);
  const provider = agentCliKind(origin.provider, `${path}.provider`);
  if (provider !== providerKind) invalid(`${path}.provider`, "the thread provider kind");
  return {
    provider,
    sessionId: externalSessionId(origin.sessionId, `${path}.sessionId`),
    importedAtEpochMs: unsignedSafeInteger(origin.importedAtEpochMs, `${path}.importedAtEpochMs`),
  };
}

function parseViewedAt(value: unknown, path: string): number | null {
  if (value === undefined) return null;
  return optionalUnsignedSafeInteger(value, path);
}

function parseLaunch(value: unknown, path: string): AgentLaunchOptions | null {
  if (value === undefined || value === null) return null;
  return parseStoredAgentLaunchOptions(value, path);
}

function parseIntegration(value: unknown, path: string): AgentThreadIntegration | null {
  if (value === undefined || value === null) return null;
  const integration = record(value, path);
  exactKeys(integration, ["lastCommitSha", "pushed", "integrated", "branchDeleted"], path);
  return {
    lastCommitSha: optionalGitSha(integration.lastCommitSha, `${path}.lastCommitSha`),
    pushed: parseIntegrationPush(integration.pushed, `${path}.pushed`),
    integrated: parseIntegrationMerge(integration.integrated, `${path}.integrated`),
    branchDeleted: booleanFlag(integration.branchDeleted, `${path}.branchDeleted`),
  };
}

function parseIntegrationPush(value: unknown, path: string): AgentThreadPushReceipt | null {
  if (value === null) return null;
  const pushed = record(value, path);
  exactKeys(pushed, ["remote", "branch"], path);
  return {
    remote: gitRemoteName(pushed.remote, `${path}.remote`),
    branch: gitBranchName(pushed.branch, `${path}.branch`),
  };
}

function parseIntegrationMerge(value: unknown, path: string): AgentThreadIntegrationReceipt | null {
  if (value === null) return null;
  const integrated = record(value, path);
  exactKeys(integrated, ["intoBranch", "mergeSha", "mode"], path);
  return {
    intoBranch: gitBranchName(integrated.intoBranch, `${path}.intoBranch`),
    mergeSha: gitSha(integrated.mergeSha, `${path}.mergeSha`),
    mode: gitIntegrationMode(integrated.mode, `${path}.mode`),
  };
}

function optionalGitSha(value: unknown, path: string): string | null {
  if (value === null) return null;
  return gitSha(value, path);
}

function gitSha(value: unknown, path: string): string {
  if (typeof value !== "string" || !GIT_SHA_PATTERN.test(value)) {
    invalid(path, "a 40 character lowercase hexadecimal object id");
  }
  return value;
}

function gitRemoteName(value: unknown, path: string): string {
  if (typeof value !== "string" || !GIT_REMOTE_NAME_PATTERN.test(value)) {
    invalid(path, "a safe git remote name");
  }
  return value;
}

function gitBranchName(value: unknown, path: string): string {
  const branch = boundedText(value, path, MAX_GIT_INTEGRATION_BRANCH_BYTES, false, true);
  if (branch.startsWith("-") || branch.includes("@{") || branch.includes("..")) {
    invalid(path, "a branch name without option or revision syntax");
  }
  return branch;
}

function gitIntegrationMode(value: unknown, path: string): GitIntegrationMode {
  if (value !== "fastForward" && value !== "merge") invalid(path, "fastForward or merge");
  return value;
}

function parseOwner(value: unknown, path: string): AgentThreadOwner {
  const owner = record(value, path);
  exactKeys(owner, ["rootKey", "ownerId", "repositoryRoot"], path);
  return {
    rootKey: boundedText(owner.rootKey, `${path}.rootKey`, MAX_AGENT_TASK_PATH_BYTES, false, true),
    ownerId: boundedText(
      owner.ownerId,
      `${path}.ownerId`,
      MAX_AGENT_TASK_WORKSPACE_ID_BYTES,
      false,
      true,
    ),
    repositoryRoot: agentPath(owner.repositoryRoot, `${path}.repositoryRoot`),
  };
}

function parseTarget(value: unknown, path: string): AgentThreadTarget {
  const target = record(value, path);
  exactKeys(target, ["isolation", "worktreePath"], path);
  const isolation = agentTaskIsolation(target.isolation, `${path}.isolation`);
  return {
    isolation,
    worktreePath: worktreePath(target.worktreePath, isolation, `${path}.worktreePath`),
  };
}

function parseProvider(value: unknown, path: string): AgentProviderSession {
  const provider = record(value, path);
  exactKeys(provider, ["kind", "sessionId"], path);
  return {
    kind: agentCliKind(provider.kind, `${path}.kind`),
    sessionId: optionalSessionId(provider.sessionId, `${path}.sessionId`),
  };
}

function parseTurns(value: unknown, path: string): ReadonlyArray<AgentTurn> {
  const turns = boundedArray(value, path, MAX_AGENT_TURNS_PER_THREAD);
  const parsed = turns.map((turn, index) => parseTurn(turn, `${path}[${index}]`));
  const seen = new Set<string>();
  for (const turn of parsed) {
    if (seen.has(turn.turnId)) invalid(path, "unique turn ids");
    seen.add(turn.turnId);
  }
  parsed.forEach((turn, index) => {
    if (index < parsed.length - 1 && !isTerminalAgentTurnStatus(turn.status)) {
      invalid(`${path}[${index}].status`, "a terminal status for every turn but the last");
    }
  });
  return parsed;
}

function parseTurn(value: unknown, path: string): AgentTurn {
  const turn = record(value, path);
  boundedKeys(
    turn,
    [
      "turnId",
      "prompt",
      "status",
      "startedAtEpochMs",
      "endedAtEpochMs",
      "events",
      "eventsTruncated",
      "lastStatusSequence",
      "lastOutputSequence",
    ],
    ["launch", "cliVersion", "streamMetrics"],
    path,
  );
  return {
    turnId: agentId(turn.turnId, `${path}.turnId`),
    prompt: boundedText(turn.prompt, `${path}.prompt`, MAX_AGENT_TASK_PROMPT_BYTES, false),
    status: parseTurnStatus(turn.status, `${path}.status`),
    startedAtEpochMs: unsignedSafeInteger(turn.startedAtEpochMs, `${path}.startedAtEpochMs`),
    endedAtEpochMs: optionalUnsignedSafeInteger(turn.endedAtEpochMs, `${path}.endedAtEpochMs`),
    events: boundedArray(turn.events, `${path}.events`, MAX_AGENT_EVENTS_PER_TURN).map(
      (event, index) => parseTurnEvent(event, `${path}.events[${index}]`),
    ),
    eventsTruncated: booleanFlag(turn.eventsTruncated, `${path}.eventsTruncated`),
    lastStatusSequence: unsignedSafeInteger(turn.lastStatusSequence, `${path}.lastStatusSequence`),
    lastOutputSequence: unsignedSafeInteger(turn.lastOutputSequence, `${path}.lastOutputSequence`),
    streamMetrics: parseStreamMetrics(turn.streamMetrics, `${path}.streamMetrics`),
    launch: parseLaunch(turn.launch, `${path}.launch`),
    cliVersion: parseCliVersion(turn.cliVersion, `${path}.cliVersion`),
  };
}

function parseStreamMetrics(value: unknown, path: string): AgentTurnStreamMetrics | null {
  if (value === undefined || value === null) return null;
  const metrics = record(value, path);
  exactKeys(metrics, ["receivedUtf8Bytes", "complete"], path);
  return {
    receivedUtf8Bytes: unsignedSafeInteger(metrics.receivedUtf8Bytes, `${path}.receivedUtf8Bytes`),
    complete: booleanFlag(metrics.complete, `${path}.complete`),
  };
}

function parseCliVersion(value: unknown, path: string): string | null {
  if (value === undefined || value === null) return null;
  const version = parseAgentCliVersion(value);
  if (version === null || version !== value) invalid(path, "a bounded agent CLI version");
  return version;
}

function parseTurnStatus(value: unknown, path: string): AgentTurnStatus {
  const status = record(value, path);
  const kind = turnStatusKind(status.kind, `${path}.kind`);
  switch (kind) {
    case "exited":
      exactKeys(status, ["kind", "exitCode"], path);
      return { kind, exitCode: signedExitCode(status.exitCode, `${path}.exitCode`) };
    case "failed":
      exactKeys(status, ["kind", "message"], path);
      return {
        kind,
        message: boundedText(
          status.message,
          `${path}.message`,
          MAX_AGENT_TASK_FAILURE_BYTES,
          false,
        ),
      };
    case "pending":
    case "running":
    case "stopped":
    case "interrupted":
      exactKeys(status, ["kind"], path);
      return { kind };
    default:
      return unsupportedTurnStatusKind(kind);
  }
}

function parseTurnEvent(value: unknown, path: string): AgentTurnEvent {
  const event = record(value, path);
  const kind = turnEventKind(event.kind, `${path}.kind`);
  switch (kind) {
    case "assistantText":
    case "reasoning":
      exactKeys(event, ["kind", "text"], path);
      return { kind, text: eventText(event.text, `${path}.text`) };
    case "toolCall":
      exactKeys(event, ["kind", "toolId", "name", "inputSummary"], path);
      return {
        kind,
        toolId: boundedText(event.toolId, `${path}.toolId`, MAX_AGENT_TOOL_ID_BYTES, false, true),
        name: boundedText(event.name, `${path}.name`, MAX_AGENT_TOOL_NAME_BYTES, false, true),
        inputSummary: toolSummary(event.inputSummary, `${path}.inputSummary`),
      };
    case "toolResult":
      exactKeys(event, ["kind", "toolId", "outputSummary", "isError"], path);
      return {
        kind,
        toolId: boundedText(event.toolId, `${path}.toolId`, MAX_AGENT_TOOL_ID_BYTES, false, true),
        outputSummary: toolSummary(event.outputSummary, `${path}.outputSummary`),
        isError: booleanFlag(event.isError, `${path}.isError`),
      };
    case "result":
      exactKeys(event, ["kind", "text", "isError", "usage"], path);
      return {
        kind,
        text: eventText(event.text, `${path}.text`),
        isError: booleanFlag(event.isError, `${path}.isError`),
        usage: parseUsage(event.usage, `${path}.usage`),
      };
    case "contextCompaction":
      exactKeys(event, ["kind", "beforeTokens", "afterTokens"], path);
      return {
        kind,
        beforeTokens: optionalUnsignedSafeInteger(event.beforeTokens, `${path}.beforeTokens`),
        afterTokens: optionalUnsignedSafeInteger(event.afterTokens, `${path}.afterTokens`),
      };
    case "error":
      exactKeys(event, ["kind", "message"], path);
      return { kind, message: eventText(event.message, `${path}.message`) };
    case "unknownLine":
      exactKeys(event, ["kind", "stream", "raw", "clipped"], path);
      return {
        kind,
        stream: outputStream(event.stream, `${path}.stream`),
        raw: eventText(event.raw, `${path}.raw`),
        clipped: booleanFlag(event.clipped, `${path}.clipped`),
      };
    default:
      return unsupportedTurnEventKind(kind);
  }
}

function parseUsage(value: unknown, path: string): AgentTurnUsage | null {
  if (value === null) return null;
  const usage = record(value, path);
  boundedKeys(usage, ["inputTokens", "outputTokens"], ["contextTokens", "costUsd"], path);
  return {
    inputTokens: unsignedSafeInteger(usage.inputTokens, `${path}.inputTokens`),
    outputTokens: unsignedSafeInteger(usage.outputTokens, `${path}.outputTokens`),
    contextTokens:
      usage.contextTokens === undefined
        ? null
        : optionalUnsignedSafeInteger(usage.contextTokens, `${path}.contextTokens`),
    ...(usage.costUsd === undefined
      ? {}
      : { costUsd: optionalNonNegativeFiniteNumber(usage.costUsd, `${path}.costUsd`) }),
  };
}

function optionalNonNegativeFiniteNumber(value: unknown, path: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    invalid(path, "a non-negative finite number or null");
  }
  return value;
}

function turnStatusKind(value: unknown, path: string): AgentTurnStatus["kind"] {
  if (
    value !== "pending" &&
    value !== "running" &&
    value !== "exited" &&
    value !== "failed" &&
    value !== "stopped" &&
    value !== "interrupted"
  ) {
    invalid(path, "pending, running, exited, failed, stopped, or interrupted");
  }
  return value;
}

function turnEventKind(value: unknown, path: string): AgentTurnEvent["kind"] {
  if (
    value !== "assistantText" &&
    value !== "reasoning" &&
    value !== "toolCall" &&
    value !== "toolResult" &&
    value !== "result" &&
    value !== "contextCompaction" &&
    value !== "error" &&
    value !== "unknownLine"
  ) {
    invalid(path, "a supported agent turn event kind");
  }
  return value;
}

function agentTaskIsolation(value: unknown, path: string): AgentTaskIsolation {
  if (value !== "worktree" && value !== "in-place") invalid(path, "worktree or in-place");
  return value;
}

function externalSessionId(value: unknown, path: string): string {
  if (!isAgentSessionId(value)) invalid(path, "a safe agent session id");
  return value;
}

function agentCliKind(value: unknown, path: string): AgentCliKind {
  if (value !== "claudeCode" && value !== "codex") invalid(path, "claudeCode or codex");
  return value;
}

function outputStream(value: unknown, path: string): AgentTaskOutputStream {
  if (value !== "stdout" && value !== "stderr") invalid(path, "stdout or stderr");
  return value;
}

function worktreePath(value: unknown, isolation: AgentTaskIsolation, path: string): string | null {
  if (isolation === "in-place") {
    if (value !== null) invalid(path, "null for an in-place agent thread");
    return null;
  }
  return agentPath(value, path);
}

function optionalSessionId(value: unknown, path: string): string | null {
  if (value === null) return null;
  if (!isAgentSessionId(value)) invalid(path, "null or a safe agent session id");
  return value;
}

function agentPath(value: unknown, path: string): string {
  const candidate = boundedText(value, path, MAX_AGENT_TASK_PATH_BYTES, false);
  if (candidate.trim() === "") invalid(path, "a non-blank bounded path");
  return candidate;
}

function agentId(value: unknown, path: string): string {
  const candidate = boundedText(value, path, MAX_AGENT_TASK_ID_BYTES, false, true);
  if (!AGENT_TASK_ID_PATTERN.test(candidate)) invalid(path, "a safe agent id");
  return candidate;
}

function eventText(value: unknown, path: string): string {
  return boundedText(value, path, MAX_AGENT_EVENT_TEXT_BYTES, true);
}

function toolSummary(value: unknown, path: string): string {
  return boundedText(value, path, MAX_AGENT_TOOL_SUMMARY_BYTES, true);
}

function boundedArray(value: unknown, path: string, maxItems: number): ReadonlyArray<unknown> {
  if (!Array.isArray(value) || value.length > maxItems) {
    invalid(path, `an array of at most ${maxItems} items`);
  }
  return value;
}

function boundedText(
  value: unknown,
  path: string,
  maxBytes: number,
  allowEmpty: boolean,
  rejectControls = false,
): string {
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.length === 0) ||
    value.includes("\0") ||
    (rejectControls && /\p{Cc}/u.test(value)) ||
    UTF8_ENCODER.encode(value).byteLength > maxBytes
  ) {
    invalid(path, `${allowEmpty ? "a" : "a non-empty"} bounded UTF-8 string`);
  }
  return value;
}

function booleanFlag(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") invalid(path, "a boolean");
  return value;
}

function unsignedSafeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    invalid(path, "a non-negative safe integer");
  }
  return value as number;
}

function optionalUnsignedSafeInteger(value: unknown, path: string): number | null {
  if (value === null) return null;
  return unsignedSafeInteger(value, path);
}

function signedExitCode(value: unknown, path: string): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < -2_147_483_648 ||
    (value as number) > 2_147_483_647
  ) {
    invalid(path, "a signed 32-bit integer");
  }
  return value as number;
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

function boundedKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value);
  const unexpected = actual.some((key) => !required.includes(key) && !optional.includes(key));
  const missing = required.some((key) => !actual.includes(key));
  if (unexpected || missing) {
    invalid(path, `the fields ${required.join(", ")} and optionally ${optional.join(", ")}`);
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(path, "an object");
  }
  return value as Record<string, unknown>;
}

function unsupportedTurnStatus(status: never): never {
  throw new TypeError(`Unsupported agent turn status: ${JSON.stringify(status)}.`);
}

function unsupportedTurnStatusKind(kind: never): never {
  throw new TypeError(`Unsupported agent turn status kind: ${String(kind)}.`);
}

function unsupportedTurnEvent(event: never): never {
  throw new TypeError(`Unsupported agent turn event: ${JSON.stringify(event)}.`);
}

function unsupportedTurnEventKind(kind: never): never {
  throw new TypeError(`Unsupported agent turn event kind: ${String(kind)}.`);
}

function invalid(path: string, expectation: string): never {
  throw new TypeError(`Invalid agent thread value at ${path}: expected ${expectation}.`);
}
