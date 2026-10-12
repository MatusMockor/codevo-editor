import { invoke } from "@tauri-apps/api/core";
import {
  MAX_REMOTE_REPLAY_CACHE_IDENTIFIER_BYTES,
  MAX_REMOTE_REPLAY_CACHE_RECORD_BYTES,
  MAX_REMOTE_REPLAY_CACHE_TASKS,
  MAX_REMOTE_REPLAY_CACHE_THREAD_BYTES,
  type RemoteAgentReplayCacheGateway,
  type RemoteAgentReplayCacheKey,
  type RemoteAgentReplayCacheLoadResult,
  type RemoteAgentReplayCachePutResult,
  type RemoteAgentReplayCacheRecord,
  type RemoteAgentReplayCacheRejectionReason,
  type RemoteAgentReplayCacheRemoveResult,
} from "../application/remoteAgentReplayCachePorts";

export type InvokeRemoteAgentReplayCacheCommand = (
  command: string,
  args: Readonly<{ request: unknown }>,
) => Promise<unknown>;

export const REMOTE_AGENT_REPLAY_CACHE_COMMANDS = {
  loadThread: "remote_replay_cache_load_thread",
  putTask: "remote_replay_cache_put_task",
  removeThread: "remote_replay_cache_remove_thread",
  removeServer: "remote_replay_cache_remove_server",
  clear: "remote_replay_cache_clear",
} as const;

const encoder = new TextEncoder();

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fields(value: Record<string, unknown>, expected: ReadonlyArray<string>): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function identifier(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\u0000")) return false;
  if (value.length > MAX_REMOTE_REPLAY_CACHE_IDENTIFIER_BYTES) return false;
  return encoder.encode(value).length <= MAX_REMOTE_REPLAY_CACHE_IDENTIFIER_BYTES;
}

function validKey(value: unknown): value is RemoteAgentReplayCacheKey {
  if (!object(value) || !fields(value, ["serverId", "endpoint", "runnerId", "threadKey"]))
    return false;
  return [value.serverId, value.endpoint, value.runnerId, value.threadKey].every(identifier);
}

type RecordValidation =
  | { readonly kind: "valid"; readonly bytes: number }
  | { readonly kind: "rejected"; readonly reason: "invalidRecord" | "recordTooLarge" };

function validateRecord(value: unknown): RecordValidation {
  if (typeof value !== "string") return { kind: "rejected", reason: "invalidRecord" };
  if (value.length > MAX_REMOTE_REPLAY_CACHE_RECORD_BYTES)
    return { kind: "rejected", reason: "recordTooLarge" };
  const bytes = encoder.encode(value).length;
  if (bytes > MAX_REMOTE_REPLAY_CACHE_RECORD_BYTES)
    return { kind: "rejected", reason: "recordTooLarge" };
  try {
    const parsed: unknown = JSON.parse(value);
    if (!object(parsed)) return { kind: "rejected", reason: "invalidRecord" };
    return { kind: "valid", bytes };
  } catch {
    return { kind: "rejected", reason: "invalidRecord" };
  }
}

function parseLoad(value: unknown): RemoteAgentReplayCacheLoadResult {
  if (!object(value)) return { kind: "miss" };
  if (value.kind === "miss" && fields(value, ["kind"])) return { kind: "miss" };
  if (value.kind !== "hit" || !fields(value, ["kind", "records"])) return { kind: "miss" };
  if (!Array.isArray(value.records) || value.records.length > MAX_REMOTE_REPLAY_CACHE_TASKS)
    return { kind: "miss" };
  const records: RemoteAgentReplayCacheRecord[] = [];
  const taskIds = new Set<string>();
  let bytes = 0;
  for (const entry of value.records as ReadonlyArray<unknown>) {
    if (!object(entry) || !fields(entry, ["taskId", "record"])) return { kind: "miss" };
    if (!identifier(entry.taskId) || typeof entry.record !== "string") return { kind: "miss" };
    if (taskIds.has(entry.taskId)) return { kind: "miss" };
    const validated = validateRecord(entry.record);
    if (validated.kind === "rejected") return { kind: "miss" };
    bytes += validated.bytes;
    if (bytes > MAX_REMOTE_REPLAY_CACHE_THREAD_BYTES) return { kind: "miss" };
    taskIds.add(entry.taskId);
    records.push({ taskId: entry.taskId, record: entry.record });
  }
  return { kind: "hit", records };
}

function rejectionReason(value: unknown): RemoteAgentReplayCacheRejectionReason | null {
  switch (value) {
    case "invalidIdentifier":
    case "recordTooLarge":
    case "invalidRecord":
    case "threadTooLarge":
    case "tooManyTasks":
      return value;
    default:
      return null;
  }
}

function parsePut(value: unknown): RemoteAgentReplayCachePutResult {
  if (!object(value)) return { kind: "unavailable" };
  if (value.kind === "stored" && fields(value, ["kind"])) return { kind: "stored" };
  if (value.kind === "unavailable" && fields(value, ["kind"])) return { kind: "unavailable" };
  if (value.kind !== "rejected" || !fields(value, ["kind", "reason"]))
    return { kind: "unavailable" };
  const reason = rejectionReason(value.reason);
  if (reason === null) return { kind: "unavailable" };
  return { kind: "rejected", reason };
}

function parseRemove(value: unknown): RemoteAgentReplayCacheRemoveResult {
  if (!object(value) || !fields(value, ["kind"])) return { kind: "unavailable" };
  if (value.kind === "removed") return { kind: "removed" };
  return { kind: "unavailable" };
}

export class TauriRemoteAgentReplayCacheGateway implements RemoteAgentReplayCacheGateway {
  constructor(private readonly invokeCommand: InvokeRemoteAgentReplayCacheCommand = invoke) {}

  async loadThread(key: RemoteAgentReplayCacheKey): Promise<RemoteAgentReplayCacheLoadResult> {
    try {
      if (!validKey(key)) return { kind: "miss" };
      return parseLoad(await this.send(REMOTE_AGENT_REPLAY_CACHE_COMMANDS.loadThread, { key }));
    } catch {
      return { kind: "miss" };
    }
  }

  async putTask(
    key: RemoteAgentReplayCacheKey,
    taskId: string,
    record: string,
  ): Promise<RemoteAgentReplayCachePutResult> {
    try {
      if (!validKey(key) || !identifier(taskId))
        return { kind: "rejected", reason: "invalidIdentifier" };
      const validated = validateRecord(record);
      if (validated.kind === "rejected") return validated;
      return parsePut(
        await this.send(REMOTE_AGENT_REPLAY_CACHE_COMMANDS.putTask, { key, taskId, record }),
      );
    } catch {
      return { kind: "unavailable" };
    }
  }

  async removeThread(key: RemoteAgentReplayCacheKey): Promise<RemoteAgentReplayCacheRemoveResult> {
    try {
      if (!validKey(key)) return { kind: "unavailable" };
      return parseRemove(await this.send(REMOTE_AGENT_REPLAY_CACHE_COMMANDS.removeThread, { key }));
    } catch {
      return { kind: "unavailable" };
    }
  }

  async removeServer(serverId: string): Promise<RemoteAgentReplayCacheRemoveResult> {
    try {
      if (!identifier(serverId)) return { kind: "unavailable" };
      return parseRemove(
        await this.send(REMOTE_AGENT_REPLAY_CACHE_COMMANDS.removeServer, { serverId }),
      );
    } catch {
      return { kind: "unavailable" };
    }
  }

  async clear(): Promise<RemoteAgentReplayCacheRemoveResult> {
    try {
      return parseRemove(await this.send(REMOTE_AGENT_REPLAY_CACHE_COMMANDS.clear, {}));
    } catch {
      return { kind: "unavailable" };
    }
  }

  private send(command: string, request: unknown): Promise<unknown> {
    return this.invokeCommand(command, { request });
  }
}
