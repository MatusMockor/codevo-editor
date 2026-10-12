import {
  backwardWindowFraming,
  remoteWindowEvictedStdout,
  scannedStdoutBoundary,
  type RemoteReplayStdoutBoundary,
} from "./remoteAgentReplayFraming";
import type { AgentSubagentLifecycle } from "@codevo/agent-events";
import type {
  RemoteRunnerEvent,
  RemoteRunnerEventPage,
  RemoteRunnerTask,
} from "../domain/remoteRunner";
import { assertRemoteRunnerBackwardPage } from "../domain/remoteRunnerBackwardPage";
import type { RemoteAgentInventorySnapshot } from "./remoteAgentInventoryLoad";
import {
  droppedServerEvictedOutput,
  MAX_REMOTE_REPLAY_INPUTS,
  retainRemoteReplayWindow,
  type RemoteReplayGap,
  type RemoteReplayWindow,
} from "./remoteAgentReplayWindow";
import { isRemoteTaskTerminal } from "./remoteRunnerTaskState";

export const REMOTE_TASK_REPLAY_TAIL_BEFORE = Number.MAX_SAFE_INTEGER;
export const MAX_REMOTE_TASK_REPLAY_PAGES_PER_PASS = 24;
export const MAX_REMOTE_REPLAY_BACKWARD_PAGES_PER_PASS = 48;
export type RemoteReplayDirection = "forward" | "backward";
export const REMOTE_BACKFILL_PAGES_PER_LIVE_POLL = 4;

interface RemoteReplayInputScan {
  readonly kind: "scanningInputs";
  readonly before: number;
  readonly stdoutBoundary?: RemoteReplayStdoutBoundary;
}

interface RemoteReplayBoundaryScan {
  readonly kind: "scanningBoundary";
  readonly before: number;
}

export type RemoteReplayEarlier =
  | { readonly kind: "loaded" }
  | { readonly kind: "retained" }
  | { readonly kind: "pending"; readonly before: number }
  | RemoteReplayInputScan
  | RemoteReplayBoundaryScan;

export type RemoteReplayBackfill =
  | RemoteReplayInputScan
  | RemoteReplayBoundaryScan
  | { readonly kind: "loaded" }
  | { readonly kind: "retained" }
  | {
      readonly kind: "pending";
      readonly before: number;
      readonly truncated: boolean;
      readonly gap?: RemoteReplayGap;
    };

export interface RemoteTaskReplay {
  readonly events: readonly RemoteRunnerEvent[];
  readonly cursor: number;
  readonly earlier: RemoteReplayEarlier;
  readonly gap?: RemoteReplayGap;
  readonly truncated: boolean;
  readonly discarded: boolean;
  readonly evictedThrough: number;
  readonly complete: boolean;
  readonly lifecycle?: AgentSubagentLifecycle;
}

export interface RemoteReplayIndex {
  readonly replays: ReadonlyMap<string, readonly RemoteRunnerEvent[]>;
  readonly replayCursors: ReadonlyMap<string, number>;
  readonly replayBackfill: ReadonlyMap<string, RemoteReplayBackfill>;
  readonly replayGaps: ReadonlyMap<string, RemoteReplayGap>;
  readonly subagentLifecycles: ReadonlyMap<string, AgentSubagentLifecycle>;
  readonly replayComplete: ReadonlySet<string>;
  readonly replayTruncated: ReadonlySet<string>;
  readonly replayDiscarded: ReadonlySet<string>;
  readonly replayServerEvictions: ReadonlyMap<string, number>;
}

interface RemoteReplayLoss {
  readonly truncated: boolean;
  readonly gap?: RemoteReplayGap;
}

const LOADED: RemoteReplayEarlier = { kind: "loaded" };
const RETAINED: RemoteReplayEarlier = { kind: "retained" };

export function remoteTaskReplayUnread(
  previous: RemoteAgentInventorySnapshot,
  taskId: string,
): boolean {
  if (previous.replayCursors?.has(taskId) === true) return false;
  return (previous.replays.get(taskId)?.length ?? 0) === 0;
}

export function remoteReplayBackfillPending(snapshot: RemoteAgentInventorySnapshot): boolean {
  return [...(snapshot.replayBackfill?.values() ?? [])].some(
    (state) =>
      state.kind === "pending" ||
      state.kind === "scanningInputs" ||
      state.kind === "scanningBoundary",
  );
}

export function remoteReplayBackfillAdvanced(
  previous: RemoteAgentInventorySnapshot,
  current: RemoteAgentInventorySnapshot,
): boolean {
  for (const [taskId, state] of current.replayBackfill ?? []) {
    const prior = previous.replayBackfill?.get(taskId);
    if (prior === undefined) {
      if (
        state.kind === "pending" ||
        state.kind === "scanningInputs" ||
        state.kind === "scanningBoundary"
      )
        return true;
      continue;
    }
    if (
      prior.kind !== "pending" &&
      prior.kind !== "scanningInputs" &&
      prior.kind !== "scanningBoundary"
    )
      continue;
    if (
      state.kind !== "pending" &&
      state.kind !== "scanningInputs" &&
      state.kind !== "scanningBoundary"
    )
      return true;
    if (prior.kind !== state.kind || state.before < prior.before) return true;
  }
  return false;
}

export function priorRemoteTaskReplay(
  previous: RemoteAgentInventorySnapshot,
  task: RemoteRunnerTask,
  direction: RemoteReplayDirection,
): RemoteTaskReplay {
  if (remoteTaskReplayUnread(previous, task.id)) return unreadRemoteTaskReplay(direction);
  const events = previous.replays.get(task.id) ?? [];
  return {
    events,
    cursor: previous.replayCursors?.get(task.id) ?? events[events.length - 1]?.sequence ?? 0,
    ...priorEarlier(previous, task.id),
    discarded: previous.replayDiscarded?.has(task.id) === true,
    evictedThrough: previous.replayServerEvictions?.get(task.id) ?? 0,
    complete: isRemoteTaskTerminal(task) && previous.replayComplete.has(task.id),
    lifecycle: previous.subagentLifecycles?.get(task.id),
  };
}

export function forwardRemoteTaskReplay(
  replay: RemoteTaskReplay,
  task: RemoteRunnerTask,
  page: RemoteRunnerEventPage,
  maxBytes: number,
): RemoteTaskReplay {
  let next = replay.cursor;
  for (const event of page.items) {
    if (event.taskId !== task.id || event.sequence <= next)
      throw new Error("The runner returned invalid event ordering; output is incomplete.");
    next = event.sequence;
  }
  if (page.nextCursor !== null && (page.nextCursor !== next || next === replay.cursor))
    throw new Error("The runner returned an invalid event page cursor.");
  const applied = appendedRemoteEventPage(replay, page, next, maxBytes);
  if (page.nextCursor !== null) return applied;
  return { ...applied, complete: isRemoteTaskTerminal(task) };
}

export function tailRemoteTaskReplay(
  task: RemoteRunnerTask,
  page: RemoteRunnerEventPage,
  maxBytes: number,
): RemoteTaskReplay {
  const loaded = backfilledRemoteTaskReplay(
    unreadRemoteTaskReplay("backward"),
    task,
    page,
    maxBytes,
  );
  return {
    ...loaded,
    cursor: page.items[page.items.length - 1]?.sequence ?? 0,
    complete: isRemoteTaskTerminal(task),
  };
}

export function backfilledRemoteTaskReplay(
  replay: RemoteTaskReplay,
  task: RemoteRunnerTask,
  page: RemoteRunnerEventPage,
  maxBytes: number,
): RemoteTaskReplay {
  if (replay.earlier.kind !== "pending") return replay;
  assertRemoteRunnerBackwardPage(page, { taskId: task.id, before: replay.earlier.before });
  const removed = page.outputTruncatedBeforeSequence ?? 0;
  const evictedThrough = Math.max(replay.evictedThrough, removed);
  const gap =
    removed > (replay.gap?.throughSequence ?? 0)
      ? { throughSequence: removed, startsAtLineBoundary: page.outputStartsAtLineBoundary === true }
      : replay.gap;
  const merged = [...page.items, ...replay.events];
  const window = retainRemoteReplayWindow(merged, maxBytes, gap);
  const evicted = outputWindowEvicted(merged, window);
  const framing = backwardWindowFraming(gap, merged, window, page.nextCursor);
  const earlier = earlierAfterBackwardPage(merged, window, page.nextCursor, framing.boundary);
  return {
    ...replay,
    events: window.events,
    earlier,
    gap: evicted ? framing.gap : gap,
    truncated: replay.truncated || removed > 0 || window.truncated,
    discarded:
      replay.discarded || removed > 0 || droppedServerEvictedOutput(window, evictedThrough),
    evictedThrough,
    lifecycle: page.subagentLifecycle ?? replay.lifecycle,
  };
}

export function appliedRemoteBackwardPage(
  replay: RemoteTaskReplay,
  task: RemoteRunnerTask,
  page: RemoteRunnerEventPage,
  maxBytes: number,
): RemoteTaskReplay {
  switch (replay.earlier.kind) {
    case "loaded":
    case "retained":
      return replay;
    case "pending":
      return backfilledRemoteTaskReplay(replay, task, page, maxBytes);
    case "scanningInputs":
    case "scanningBoundary":
      return scannedRemoteTaskInputs(replay, task, page);
    default:
      return unsupportedBackfill(replay.earlier);
  }
}

export function retainedRemoteTaskReplay(
  replay: RemoteTaskReplay,
  maxBytes: number,
): RemoteTaskReplay {
  const window = retainRemoteReplayWindow(replay.events, maxBytes, replay.gap);
  if (!outputWindowEvicted(replay.events, window))
    return { ...replay, events: window.events, truncated: replay.truncated || window.truncated };
  return {
    ...replay,
    events: window.events,
    earlier: earlierAfterForwardEviction(replay, replay.events, window),
    gap: gapAfterForwardEviction(replay, replay.events, window),
    truncated: replay.truncated || window.truncated,
    discarded: replay.discarded || droppedServerEvictedOutput(window, replay.evictedThrough),
  };
}

export function remoteReplayOutputDiscarded(
  replays: ReadonlyMap<string, RemoteTaskReplay>,
): boolean {
  return [...replays.values()].some(
    (replay) => shownRemoteReplayLoss(replay).truncated && replay.discarded,
  );
}

export function remoteReplayIndex(
  replays: ReadonlyMap<string, RemoteTaskReplay>,
  unloaded: readonly string[],
): RemoteReplayIndex {
  const index = {
    replays: new Map<string, readonly RemoteRunnerEvent[]>(),
    replayCursors: new Map<string, number>(),
    replayBackfill: new Map<string, RemoteReplayBackfill>(),
    replayGaps: new Map<string, RemoteReplayGap>(),
    subagentLifecycles: new Map<string, AgentSubagentLifecycle>(),
    replayComplete: new Set<string>(),
    replayTruncated: new Set<string>(unloaded),
    replayDiscarded: new Set<string>(),
    replayServerEvictions: new Map<string, number>(),
  };
  for (const [taskId, replay] of replays) {
    const shown = shownRemoteReplayLoss(replay);
    index.replays.set(taskId, replay.events);
    index.replayCursors.set(taskId, replay.cursor);
    index.replayBackfill.set(taskId, storedBackfill(replay));
    if (shown.gap) index.replayGaps.set(taskId, shown.gap);
    if (replay.lifecycle) index.subagentLifecycles.set(taskId, replay.lifecycle);
    if (replay.complete) index.replayComplete.add(taskId);
    if (shown.truncated) index.replayTruncated.add(taskId);
    if (replay.discarded) index.replayDiscarded.add(taskId);
    if (replay.evictedThrough > 0) index.replayServerEvictions.set(taskId, replay.evictedThrough);
  }
  return index;
}

function unreadRemoteTaskReplay(direction: RemoteReplayDirection): RemoteTaskReplay {
  return {
    events: [],
    cursor: 0,
    earlier: unreadEarlier(direction),
    truncated: false,
    discarded: false,
    evictedThrough: 0,
    complete: false,
  };
}

function unreadEarlier(direction: RemoteReplayDirection): RemoteReplayEarlier {
  switch (direction) {
    case "forward":
      return LOADED;
    case "backward":
      return { kind: "pending", before: REMOTE_TASK_REPLAY_TAIL_BEFORE };
    default:
      return unsupportedBackfill(direction);
  }
}

function priorEarlier(
  previous: RemoteAgentInventorySnapshot,
  taskId: string,
): Pick<RemoteTaskReplay, "earlier" | "truncated" | "gap"> {
  const stored = previous.replayBackfill?.get(taskId);
  const truncated = previous.replayTruncated.has(taskId);
  const gap = previous.replayGaps?.get(taskId);
  if (stored === undefined) return { earlier: truncated ? RETAINED : LOADED, truncated, gap };
  switch (stored.kind) {
    case "loaded":
    case "retained":
    case "scanningInputs":
    case "scanningBoundary":
      return { earlier: stored, truncated, gap };
    case "pending":
      return {
        earlier: { kind: "pending", before: stored.before },
        truncated: stored.truncated,
        gap: stored.gap,
      };
    default:
      return unsupportedBackfill(stored);
  }
}

function storedBackfill(replay: RemoteTaskReplay): RemoteReplayBackfill {
  switch (replay.earlier.kind) {
    case "loaded":
    case "retained":
    case "scanningInputs":
    case "scanningBoundary":
      return replay.earlier;
    case "pending":
      return {
        kind: "pending",
        before: replay.earlier.before,
        truncated: replay.truncated,
        gap: replay.gap,
      };
    default:
      return unsupportedBackfill(replay.earlier);
  }
}

function shownRemoteReplayLoss(replay: RemoteTaskReplay): RemoteReplayLoss {
  switch (replay.earlier.kind) {
    case "loaded":
      return { truncated: replay.truncated, gap: replay.gap };
    case "retained":
    case "scanningInputs":
    case "scanningBoundary":
      return { truncated: true, gap: replay.gap };
    case "pending":
      return { truncated: true, gap: laterGap(replay.gap, unloadedBefore(replay.earlier.before)) };
    default:
      return unsupportedBackfill(replay.earlier);
  }
}

function unloadedBefore(sequence: number): RemoteReplayGap {
  return { throughSequence: sequence - 1, startsAtLineBoundary: false };
}

function gapBehindEviction(
  earlier: RemoteReplayEarlier,
  gap: RemoteReplayGap | undefined,
): RemoteReplayGap | undefined {
  if (earlier.kind !== "pending") return gap;
  return laterGap(gap, unloadedBefore(earlier.before));
}

function earlierAfterBackwardPage(
  merged: readonly RemoteRunnerEvent[],
  window: RemoteReplayWindow,
  olderCursor: number | null,
  boundary: { readonly stdoutBoundary: RemoteReplayStdoutBoundary } | undefined,
): RemoteReplayEarlier {
  if (outputWindowEvicted(merged, window))
    return inputScanEarlier(window.events, olderCursor, boundary?.stdoutBoundary);
  if (olderCursor === null) return LOADED;
  return { kind: "pending", before: olderCursor };
}

function inputScanEarlier(
  events: readonly RemoteRunnerEvent[],
  before: number | null,
  stdoutBoundary?: RemoteReplayStdoutBoundary,
): RemoteReplayEarlier {
  if (before === null) return RETAINED;
  if (retainedInputCount(events) < MAX_REMOTE_REPLAY_INPUTS)
    return { kind: "scanningInputs", before, ...(stdoutBoundary && { stdoutBoundary }) };
  if (stdoutBoundary) return { kind: "scanningBoundary", before };
  return RETAINED;
}

function retainedInputCount(events: readonly RemoteRunnerEvent[]): number {
  return events.filter((event) => event.type === "task.input").length;
}

function earlierAfterForwardEviction(
  replay: RemoteTaskReplay,
  merged: readonly RemoteRunnerEvent[],
  window: RemoteReplayWindow,
): RemoteReplayEarlier {
  switch (replay.earlier.kind) {
    case "loaded":
    case "retained":
      return RETAINED;
    case "pending": {
      const framing = backwardWindowFraming(replay.gap, merged, window, replay.earlier.before);
      return inputScanEarlier(
        window.events,
        replay.earlier.before,
        framing.boundary?.stdoutBoundary,
      );
    }
    case "scanningInputs":
    case "scanningBoundary": {
      const boundary =
        replay.earlier.kind === "scanningBoundary"
          ? ({ kind: "pending" } as const)
          : replay.earlier.stdoutBoundary;
      return inputScanEarlier(
        window.events,
        replay.earlier.before,
        remoteWindowEvictedStdout(merged, window) ? undefined : boundary,
      );
    }
    default:
      return unsupportedBackfill(replay.earlier);
  }
}

function gapAfterForwardEviction(
  replay: RemoteTaskReplay,
  merged: readonly RemoteRunnerEvent[],
  window: RemoteReplayWindow,
): RemoteReplayGap | undefined {
  if (replay.earlier.kind === "pending")
    return backwardWindowFraming(replay.gap, merged, window, replay.earlier.before).gap;
  return gapBehindEviction(replay.earlier, window.gap);
}

export function scannedRemoteTaskInputs(
  replay: RemoteTaskReplay,
  task: RemoteRunnerTask,
  page: RemoteRunnerEventPage,
): RemoteTaskReplay {
  if (replay.earlier.kind !== "scanningInputs" && replay.earlier.kind !== "scanningBoundary")
    return replay;
  assertRemoteRunnerBackwardPage(page, { taskId: task.id, before: replay.earlier.before });
  const inputs = [
    ...page.items.filter((event) => event.type === "task.input"),
    ...replay.events.filter((event) => event.type === "task.input"),
  ].slice(-MAX_REMOTE_REPLAY_INPUTS);
  const events = page.items.some((event) => event.type === "task.input")
    ? [...inputs, ...replay.events.filter((event) => event.type !== "task.input")].sort(
        (left, right) => left.sequence - right.sequence,
      )
    : replay.events;
  const removed = page.outputTruncatedBeforeSequence ?? 0;
  const gap =
    removed > (replay.gap?.throughSequence ?? 0)
      ? { throughSequence: removed, startsAtLineBoundary: page.outputStartsAtLineBoundary === true }
      : replay.gap;
  const boundary =
    replay.earlier.kind === "scanningBoundary"
      ? ({ kind: "pending" } as const)
      : replay.earlier.stdoutBoundary;
  const framing = scannedStdoutBoundary(boundary, gap, page);
  const earlier = inputScanEarlier(events, page.nextCursor, framing.boundary?.stdoutBoundary);
  return {
    ...replay,
    events,
    earlier,
    gap: framing.gap,
    discarded: replay.discarded || removed > 0,
    evictedThrough: Math.max(replay.evictedThrough, removed),
    lifecycle: page.subagentLifecycle ?? replay.lifecycle,
  };
}

function outputWindowEvicted(
  events: readonly RemoteRunnerEvent[],
  window: RemoteReplayWindow,
): boolean {
  return firstRetainedOutput(events) !== firstRetainedOutput(window.events);
}

function firstRetainedOutput(events: readonly RemoteRunnerEvent[]): RemoteRunnerEvent | undefined {
  return events.find((event) => event.type !== "task.input");
}

function laterGap(known: RemoteReplayGap | undefined, floor: RemoteReplayGap): RemoteReplayGap {
  if (known !== undefined && known.throughSequence >= floor.throughSequence) return known;
  return floor;
}

function appendedRemoteEventPage(
  replay: RemoteTaskReplay,
  page: RemoteRunnerEventPage,
  cursor: number,
  maxBytes: number,
): RemoteTaskReplay {
  const removed = page.outputTruncatedBeforeSequence ?? 0;
  const lost = removed > replay.cursor || (replay.truncated && removed > 0);
  const evictedThrough = Math.max(replay.evictedThrough, removed);
  const serverGap = lost && removed > (replay.gap?.throughSequence ?? 0);
  const gap = serverGap
    ? { throughSequence: removed, startsAtLineBoundary: page.outputStartsAtLineBoundary === true }
    : replay.gap;
  const merged = [...replay.events, ...page.items];
  const window = retainRemoteReplayWindow(merged, maxBytes, gap);
  const truncated = replay.truncated || serverGap || window.truncated;
  const evicted = outputWindowEvicted(merged, window);
  return {
    events: window.events,
    cursor,
    earlier: evicted ? earlierAfterForwardEviction(replay, merged, window) : replay.earlier,
    gap: evicted ? gapAfterForwardEviction(replay, merged, window) : window.gap,
    truncated,
    discarded:
      replay.discarded ||
      lost ||
      (truncated && removed > 0) ||
      droppedServerEvictedOutput(window, evictedThrough),
    evictedThrough,
    complete: replay.complete,
    lifecycle: page.subagentLifecycle ?? replay.lifecycle,
  };
}

function unsupportedBackfill(state: never): never {
  throw new TypeError(`Unsupported remote replay backfill state: ${JSON.stringify(state)}.`);
}
