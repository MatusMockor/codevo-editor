import type {
  RemoteRunnerEvent,
  RemoteRunnerEventPage,
  RemoteRunnerEventsBeforeRequest,
  RemoteRunnerPart,
} from "../domain/remoteRunner";
import { MAX_REMOTE_RUNNER_EVENT_PAGE_ITEMS } from "../domain/remoteRunnerBackwardPage";
import type { RemoteAgentInventorySnapshot } from "./remoteAgentInventoryLoad";
import { MAX_REMOTE_REPLAY_INPUTS } from "./remoteAgentReplayWindow";
import type { RemoteTurnEventsPort } from "./remoteAgentTurnRawPages";

export const REMOTE_RUNNER_EVENT_PAGE_BYTE_BUDGET = 3 * 1_024 * 1_024;
export const MAX_REMOTE_REPLAY_RETENTION_TASKS = 64;

const MAX_JSON_BYTES_PER_UTF16_UNIT = 6;
const MAX_EVENT_ENVELOPE_BYTES = 1_024;
const MAX_PART_ENVELOPE_BYTES = 128;

export interface RemoteTurnLocalReplay {
  readonly events: readonly RemoteRunnerEvent[];
  readonly serverRetention: boolean;
}

export type RemoteTurnLocalReplaySource = (taskId: string) => RemoteTurnLocalReplay | null;

export function remoteAgentTurnLocalReplayPort(
  gateway: RemoteTurnEventsPort,
  replay: RemoteTurnLocalReplaySource,
): RemoteTurnEventsPort {
  const retentionSeen = new Set<string>();
  const untrusted = (taskId: string): boolean =>
    retentionSeen.has(taskId) || retentionSeen.size >= MAX_REMOTE_REPLAY_RETENTION_TASKS;
  return {
    listEventsBefore: async (request) => {
      const local = untrusted(request.taskId)
        ? null
        : remoteTurnLocalReplayPage(replay(request.taskId), request);
      if (local !== null) return local;
      const page = await gateway.listEventsBefore(request);
      if (page.outputTruncatedBeforeSequence !== undefined && !untrusted(request.taskId))
        retentionSeen.add(request.taskId);
      return page;
    },
  };
}

export function remoteTurnLocalReplayOf(
  snapshot: RemoteAgentInventorySnapshot | null,
  taskId: string,
): RemoteTurnLocalReplay | null {
  const events = snapshot?.replays.get(taskId);
  if (!snapshot || !events) return null;
  const evictions = snapshot.replayServerEvictions;
  return {
    events,
    serverRetention:
      evictions === undefined ||
      evictions.has(taskId) ||
      snapshot.replayDiscarded?.has(taskId) === true,
  };
}

export function remoteTurnLocalReplayPage(
  replay: RemoteTurnLocalReplay | null,
  request: Pick<RemoteRunnerEventsBeforeRequest, "taskId" | "before">,
): RemoteRunnerEventPage | null {
  if (replay === null || replay.serverRetention) return null;
  const events = replay.events;
  const last = events[events.length - 1];
  const complete = completeSuffixStart(events);
  if (last === undefined || complete === null || request.before > last.sequence + 1) return null;
  const end = countBefore(events, request.before);
  const start = end - MAX_REMOTE_RUNNER_EVENT_PAGE_ITEMS;
  if (start - 1 < complete) return null;
  if (!ownedAscending(events, start - 1, end, request.taskId)) return null;
  const items = events.slice(start, end);
  const oldest = items[0];
  if (oldest === undefined || pageBytesAtMost(items) > REMOTE_RUNNER_EVENT_PAGE_BYTE_BUDGET)
    return null;
  return { items, nextCursor: oldest.sequence };
}

function completeSuffixStart(events: readonly RemoteRunnerEvent[]): number | null {
  const firstOutput = events.findIndex((event) => event.type !== "task.input");
  if (firstOutput < 0) return null;
  const inputs = events.reduce((count, event) => count + (event.type === "task.input" ? 1 : 0), 0);
  if (inputs < MAX_REMOTE_REPLAY_INPUTS) return firstOutput;
  return Math.max(
    firstOutput,
    events.findIndex((event) => event.type === "task.input"),
  );
}

function countBefore(events: readonly RemoteRunnerEvent[], before: number): number {
  let end = events.length;
  while (end > 0 && (events[end - 1]?.sequence ?? before) >= before) end -= 1;
  return end;
}

function ownedAscending(
  events: readonly RemoteRunnerEvent[],
  from: number,
  to: number,
  taskId: string,
): boolean {
  for (let index = from; index < to; index += 1) {
    const event = events[index];
    const older = events[index - 1];
    if (event === undefined || event.taskId !== taskId) return false;
    if (index > from && (older === undefined || older.sequence >= event.sequence)) return false;
  }
  return true;
}

function pageBytesAtMost(items: readonly RemoteRunnerEvent[]): number {
  return items.reduce((total, event) => total + eventBytesAtMost(event), 0);
}

function eventBytesAtMost(event: RemoteRunnerEvent): number {
  const units =
    event.taskId.length +
    event.createdAt.length +
    (event.messageId?.length ?? 0) +
    (event.text?.length ?? 0) +
    (event.error?.length ?? 0);
  return (
    MAX_EVENT_ENVELOPE_BYTES +
    units * MAX_JSON_BYTES_PER_UTF16_UNIT +
    (event.parts ?? []).reduce((total, part) => total + partBytesAtMost(part), 0)
  );
}

function partBytesAtMost(part: RemoteRunnerPart): number {
  const units = part.type === "text" ? part.text.length : part.attachmentId.length;
  return MAX_PART_ENVELOPE_BYTES + units * MAX_JSON_BYTES_PER_UTF16_UNIT;
}
