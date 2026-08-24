import type {
  AgentThreadStoreOwnerRequest,
  AgentThreadStoreSnapshot,
  DeleteAgentThreadRequest,
  SaveAgentThreadRequest,
  UnreadableAgentThreadReport,
} from "../application/agentThreadPorts";
import { agentRootOwnerId } from "../domain/agentProject";
import {
  AGENT_TASK_ID_PATTERN,
  MAX_AGENT_TASK_ID_BYTES,
  MAX_AGENT_TASK_PATH_BYTES,
  MAX_AGENT_TASK_WORKSPACE_ID_BYTES,
} from "../domain/agentTask";
import {
  MAX_AGENT_THREADS_PER_ROOT,
  parseAgentThread,
  serializeAgentThread,
  type AgentThread,
} from "../domain/agentThread";

export const LOAD_AGENT_THREADS_IPC_COMMAND = "load_agent_threads" as const;
export const SAVE_AGENT_THREAD_IPC_COMMAND = "save_agent_thread" as const;
export const DELETE_AGENT_THREAD_IPC_COMMAND = "delete_agent_thread" as const;

export const MAX_UNREADABLE_AGENT_THREAD_REPORTS = 16;
export const MAX_UNREADABLE_AGENT_THREAD_REASON_BYTES = 512;
export const UNKNOWN_AGENT_THREAD_ID = "unknown";

export type InvokeAgentThreadStoreCommand = (
  command: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

const UTF8_ENCODER = new TextEncoder();

export function validateAgentThreadStoreOwnerRequest(
  request: AgentThreadStoreOwnerRequest,
): AgentThreadStoreOwnerRequest {
  const rootKey = boundedText(request.rootKey, "request.rootKey", MAX_AGENT_TASK_PATH_BYTES);
  const ownerId = boundedText(
    request.ownerId,
    "request.ownerId",
    MAX_AGENT_TASK_WORKSPACE_ID_BYTES,
  );
  if (ownerId !== agentRootOwnerId(rootKey)) {
    invalid("request.ownerId", "the persistent agent root owner id");
  }
  return { rootKey, ownerId };
}

export function validateSaveAgentThreadRequest(
  request: SaveAgentThreadRequest,
): Record<string, unknown> {
  const owner = validateAgentThreadStoreOwnerRequest(request);
  const serialized = serializeAgentThread(request.thread);
  const thread = parseAgentThread(serialized);
  if (thread.owner.rootKey !== owner.rootKey) {
    invalid("request.thread.owner.rootKey", "the requested root key");
  }
  if (thread.owner.ownerId !== owner.ownerId) {
    invalid("request.thread.owner.ownerId", "the requested owner id");
  }
  return { ...owner, thread: serialized };
}

export function validateDeleteAgentThreadRequest(
  request: DeleteAgentThreadRequest,
): DeleteAgentThreadRequest {
  return {
    ...validateAgentThreadStoreOwnerRequest(request),
    threadId: agentThreadId(request.threadId, "request.threadId"),
  };
}

export async function invokeLoadAgentThreadsIpc(
  invokeCommand: InvokeAgentThreadStoreCommand,
  request: AgentThreadStoreOwnerRequest,
): Promise<AgentThreadStoreSnapshot> {
  const validated = validateAgentThreadStoreOwnerRequest(request);
  return parseAgentThreadStoreSnapshot(
    await invokeCommand(LOAD_AGENT_THREADS_IPC_COMMAND, { request: validated }),
    validated,
  );
}

export async function invokeSaveAgentThreadIpc(
  invokeCommand: InvokeAgentThreadStoreCommand,
  request: SaveAgentThreadRequest,
): Promise<void> {
  return invokeUnit(
    invokeCommand,
    SAVE_AGENT_THREAD_IPC_COMMAND,
    validateSaveAgentThreadRequest(request),
  );
}

export async function invokeDeleteAgentThreadIpc(
  invokeCommand: InvokeAgentThreadStoreCommand,
  request: DeleteAgentThreadRequest,
): Promise<void> {
  return invokeUnit(
    invokeCommand,
    DELETE_AGENT_THREAD_IPC_COMMAND,
    validateDeleteAgentThreadRequest(request),
  );
}

export function parseAgentThreadStoreSnapshot(
  value: unknown,
  owner: AgentThreadStoreOwnerRequest,
): AgentThreadStoreSnapshot {
  const result = record(value, "result");
  exactKeys(result, ["threads", "unreadable", "evicted"], "result");
  const reported = parseUnreadableReports(result.unreadable, "result.unreadable");
  const threads = parseThreads(result.threads, "result.threads", owner);
  return {
    threads: threads.threads,
    unreadable: [...reported, ...threads.unreadable].slice(0, MAX_UNREADABLE_AGENT_THREAD_REPORTS),
    evicted: unsignedSafeInteger(result.evicted, "result.evicted"),
  };
}

interface ParsedThreads {
  readonly threads: ReadonlyArray<AgentThread>;
  readonly unreadable: ReadonlyArray<UnreadableAgentThreadReport>;
}

function parseThreads(
  value: unknown,
  path: string,
  owner: AgentThreadStoreOwnerRequest,
): ParsedThreads {
  if (!Array.isArray(value) || value.length > MAX_AGENT_THREADS_PER_ROOT) {
    invalid(path, `an array of at most ${MAX_AGENT_THREADS_PER_ROOT} items`);
  }
  const threads: AgentThread[] = [];
  const unreadable: UnreadableAgentThreadReport[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    const parsed = parseOwnedThread(candidate, owner);
    if (parsed.kind === "unreadable") {
      unreadable.push(parsed.report);
      continue;
    }
    if (seen.has(parsed.thread.threadId)) {
      unreadable.push({ threadId: parsed.thread.threadId, reason: "duplicate thread id" });
      continue;
    }
    seen.add(parsed.thread.threadId);
    threads.push(parsed.thread);
  }
  return { threads, unreadable };
}

type OwnedThreadParse =
  | { readonly kind: "thread"; readonly thread: AgentThread }
  | { readonly kind: "unreadable"; readonly report: UnreadableAgentThreadReport };

function parseOwnedThread(value: unknown, owner: AgentThreadStoreOwnerRequest): OwnedThreadParse {
  try {
    const thread = parseAgentThread(value);
    if (
      thread.owner.rootKey !== owner.rootKey ||
      thread.owner.ownerId !== agentRootOwnerId(owner.rootKey)
    ) {
      return {
        kind: "unreadable",
        report: { threadId: thread.threadId, reason: "foreign owner" },
      };
    }
    return { kind: "thread", thread };
  } catch (error) {
    return {
      kind: "unreadable",
      report: { threadId: candidateThreadId(value), reason: clipReason(errorMessageOf(error)) },
    };
  }
}

function candidateThreadId(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return UNKNOWN_AGENT_THREAD_ID;
  }
  const threadId = (value as Record<string, unknown>).threadId;
  if (typeof threadId !== "string" || !AGENT_TASK_ID_PATTERN.test(threadId)) {
    return UNKNOWN_AGENT_THREAD_ID;
  }
  return threadId;
}

function parseUnreadableReports(
  value: unknown,
  path: string,
): ReadonlyArray<UnreadableAgentThreadReport> {
  if (!Array.isArray(value) || value.length > MAX_UNREADABLE_AGENT_THREAD_REPORTS) {
    invalid(path, `an array of at most ${MAX_UNREADABLE_AGENT_THREAD_REPORTS} items`);
  }
  return value.map((candidate, index) => {
    const report = record(candidate, `${path}[${index}]`);
    exactKeys(report, ["threadId", "reason"], `${path}[${index}]`);
    return {
      threadId: boundedText(report.threadId, `${path}[${index}].threadId`, MAX_AGENT_TASK_ID_BYTES),
      reason: clipReason(
        boundedText(
          report.reason,
          `${path}[${index}].reason`,
          MAX_UNREADABLE_AGENT_THREAD_REASON_BYTES,
        ),
      ),
    };
  });
}

async function invokeUnit(
  invokeCommand: InvokeAgentThreadStoreCommand,
  command: string,
  request: object,
): Promise<void> {
  const value = await invokeCommand(command, { request });
  if (value !== null) {
    throw new TypeError("Invalid agent thread store value at result: expected null.");
  }
}

function clipReason(reason: string): string {
  if (reason === "") return "unreadable";
  if (reason.length <= MAX_UNREADABLE_AGENT_THREAD_REASON_BYTES) return reason;
  return reason.slice(0, MAX_UNREADABLE_AGENT_THREAD_REASON_BYTES);
}

function errorMessageOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "";
}

function agentThreadId(value: unknown, path: string): string {
  const candidate = boundedText(value, path, MAX_AGENT_TASK_ID_BYTES);
  if (!AGENT_TASK_ID_PATTERN.test(candidate)) invalid(path, "a safe agent thread id");
  return candidate;
}

function boundedText(value: unknown, path: string, maxBytes: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    /\p{Cc}/u.test(value) ||
    UTF8_ENCODER.encode(value).byteLength > maxBytes
  ) {
    invalid(path, "a non-empty bounded UTF-8 string");
  }
  return value;
}

function unsignedSafeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    invalid(path, "a non-negative safe integer");
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

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(path, "an object");
  }
  return value as Record<string, unknown>;
}

function invalid(path: string, expectation: string): never {
  throw new TypeError(`Invalid agent thread store value at ${path}: expected ${expectation}.`);
}
