import { remoteRunnerChecks } from "../domain/remoteRunnerValidation";
import type { RemoteRunnerEvent } from "../domain/remoteRunner";
import type { RemoteReplayMemoryTask, RemoteReplayTaskIdentity } from "./remoteAgentReplayMemory";
import type { RemoteReplayEarlier, RemoteTaskReplay } from "./remoteAgentTaskReplay";
import { MAX_REMOTE_REPLAY_CACHE_RECORD_BYTES } from "./remoteAgentReplayCachePorts";
import { MAX_REMOTE_REPLAY_INPUTS } from "./remoteAgentReplayWindow";

const UTF8 = new TextEncoder();
const MAX_REPLAY_OUTPUT_EVENTS = 1100;
const EVENT_PAGE_ITEMS = 50;
const IDENTITY_FIELDS = [
  "id",
  "runnerId",
  "conversationId",
  "parentTaskId",
  "provider",
  "createdAt",
  "sequence",
  "status",
  "projectId",
  "isolation",
] as const;
const REPLAY_FIELDS = [
  "events",
  "cursor",
  "earlier",
  "gap",
  "truncated",
  "discarded",
  "evictedThrough",
  "complete",
  "lifecycle",
] as const;

type JsonObject = Readonly<Record<string, unknown>>;
export type RemoteReplayCacheEncoding =
  | { readonly kind: "encoded"; readonly record: string }
  | { readonly kind: "tooLarge" }
  | { readonly kind: "notPersistable" };

export function encodeRemoteAgentReplayCacheRecord(
  record: RemoteReplayMemoryTask,
): RemoteReplayCacheEncoding {
  if (
    !terminalStatus(record.identity.status) ||
    !record.replay.complete ||
    !validEarlier(record.replay)
  )
    return { kind: "notPersistable" };
  const value = { v: 1, ...record };
  const text = JSON.stringify(value);
  if (
    text.length > MAX_REMOTE_REPLAY_CACHE_RECORD_BYTES ||
    UTF8.encode(text).byteLength > MAX_REMOTE_REPLAY_CACHE_RECORD_BYTES
  )
    return { kind: "tooLarge" };
  if (decodeRecord(value, record.identity) === null) return { kind: "notPersistable" };
  return { kind: "encoded", record: text };
}

export function decodeRemoteAgentReplayCacheRecord(
  text: string,
  expectedIdentity: RemoteReplayTaskIdentity,
): RemoteReplayMemoryTask | null {
  if (
    text.length > MAX_REMOTE_REPLAY_CACHE_RECORD_BYTES ||
    UTF8.encode(text).byteLength > MAX_REMOTE_REPLAY_CACHE_RECORD_BYTES
  )
    return null;
  try {
    return decodeRecord(JSON.parse(text), expectedIdentity);
  } catch {
    return null;
  }
}

function decodeRecord(
  value: unknown,
  expectedIdentity: RemoteReplayTaskIdentity,
): RemoteReplayMemoryTask | null {
  if (!object(value, ["v", "identity", "replay", "resume"]) || value.v !== 1) return null;
  const identity = decodeIdentity(value.identity, expectedIdentity);
  if (identity === null) return null;
  const replay = decodeReplay(value.replay, identity);
  if (replay === null) return null;
  if (value.resume === undefined) return { identity, replay };
  if (!remoteRunnerChecks.getTaskResume.response(value.resume)) return null;
  return { identity, replay, resume: value.resume as RemoteReplayMemoryTask["resume"] };
}

function object(value: unknown, fields: readonly string[]): value is JsonObject {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).every((field) => fields.includes(field))
  );
}

function integer(value: unknown, minimum = 0): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}

function decodeIdentity(
  value: unknown,
  expected: RemoteReplayTaskIdentity,
): RemoteReplayTaskIdentity | null {
  if (!object(value, IDENTITY_FIELDS)) return null;
  if (
    !remoteRunnerChecks.getTask.response({
      ...value,
      parts: [{ type: "text", text: "cached" }],
    })
  )
    return null;
  if (!IDENTITY_FIELDS.every((field) => value[field] === expected[field])) return null;
  const identity = value as unknown as RemoteReplayTaskIdentity;
  if (!terminalStatus(identity.status)) return null;
  return identity;
}

function decodeEarlier(value: unknown): RemoteReplayEarlier | null {
  if (!object(value, ["kind", "before", "stdoutBoundary"])) return null;
  switch (value.kind) {
    case "loaded":
    case "retained":
      if (!object(value, ["kind"])) return null;
      return { kind: value.kind };
    default:
      return null;
  }
}

function decodeReplay(value: unknown, identity: RemoteReplayTaskIdentity): RemoteTaskReplay | null {
  if (
    !object(value, REPLAY_FIELDS) ||
    !Array.isArray(value.events) ||
    !integer(value.cursor) ||
    !integer(value.evictedThrough) ||
    typeof value.truncated !== "boolean" ||
    typeof value.discarded !== "boolean" ||
    value.complete !== true
  )
    return null;
  const earlier = decodeEarlier(value.earlier);
  if (earlier === null) return null;
  if (!validEvents(value.events, identity.id)) return null;
  const events = value.events as readonly RemoteRunnerEvent[];
  const lastSequence = events[events.length - 1]?.sequence;
  if (lastSequence !== undefined && value.cursor !== lastSequence) return null;
  if (value.evictedThrough > value.cursor) return null;
  const metadata = {
    earlier,
    truncated: value.truncated,
    cursor: value.cursor,
  };
  if (!validEarlier(metadata)) return null;
  if (!validGap(value.gap, metadata)) return null;
  if (value.discarded && (value.evictedThrough === 0 || !value.truncated)) return null;
  if (
    !remoteRunnerChecks.listEvents.response({
      items: [],
      nextCursor: null,
      ...(value.lifecycle === undefined ? {} : { subagentLifecycle: value.lifecycle }),
    })
  )
    return null;
  return { ...value, events, earlier } as unknown as RemoteTaskReplay;
}

function validEvents(events: readonly unknown[], taskId: string): boolean {
  if (events.length > MAX_REPLAY_OUTPUT_EVENTS + MAX_REMOTE_REPLAY_INPUTS) return false;
  for (let offset = 0; offset < events.length; offset += EVENT_PAGE_ITEMS) {
    if (
      !remoteRunnerChecks.listEvents.response({
        items: events.slice(offset, offset + EVENT_PAGE_ITEMS),
        nextCursor: null,
      })
    )
      return false;
  }
  const validated = events as readonly RemoteRunnerEvent[];
  let inputs = 0;
  let outputs = 0;
  let prior = 0;
  for (const event of validated) {
    if (event.taskId !== taskId || event.sequence <= prior) return false;
    prior = event.sequence;
    if (event.type === "task.input") {
      inputs += 1;
      continue;
    }
    outputs += 1;
  }
  return inputs <= MAX_REMOTE_REPLAY_INPUTS && outputs <= MAX_REPLAY_OUTPUT_EVENTS;
}

type ReplayMetadata = Pick<RemoteTaskReplay, "earlier" | "truncated" | "cursor">;

function validEarlier({ earlier, truncated }: ReplayMetadata): boolean {
  switch (earlier.kind) {
    case "loaded":
      return true;
    case "retained":
      return truncated;
    case "pending":
    case "scanningInputs":
    case "scanningBoundary":
      return false;
    default: {
      const unsupported: never = earlier;
      return unsupported;
    }
  }
}

function validGap(value: unknown, { cursor, truncated }: ReplayMetadata): boolean {
  if (value === undefined) return true;
  return (
    object(value, ["throughSequence", "startsAtLineBoundary"]) &&
    integer(value.throughSequence, 1) &&
    value.throughSequence <= cursor &&
    typeof value.startsAtLineBoundary === "boolean" &&
    truncated
  );
}

function terminalStatus(status: RemoteReplayTaskIdentity["status"]): boolean {
  switch (status) {
    case "draft":
    case "queued":
    case "running":
      return false;
    case "succeeded":
    case "failed":
    case "interrupted":
    case "cancelled":
      return true;
    default: {
      const unsupported: never = status;
      return unsupported;
    }
  }
}
