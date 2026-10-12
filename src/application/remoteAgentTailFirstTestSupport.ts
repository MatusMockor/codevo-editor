import { vi } from "vitest";
import type { AgentTurnEvent } from "../domain/agentThread";
import type {
  RemoteRunnerDescriptor,
  RemoteRunnerGateway,
  RemoteRunnerTask,
} from "../domain/remoteRunner";
import {
  emptyRemoteInventory,
  loadRemoteAgentInventory,
  type RemoteAgentInventorySnapshot,
} from "./remoteAgentInventoryLoad";
import { projectRemoteAgentThreads, remoteAgentThreadKey } from "./remoteAgentProjection";
import { isRemoteTaskTerminal } from "./remoteRunnerTaskState";
import { remoteReplayBackfillPending } from "./remoteAgentTaskReplay";
import { claudeTextLine, type FakeRunnerEvents } from "./remoteAgentTurnActivityTestSupport";

export const TAIL_FIRST_THREAD = remoteAgentThreadKey("server", "runner", "turn-1");

export interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

export function remoteTurn(
  index: number,
  change: Partial<RemoteRunnerTask> = {},
): RemoteRunnerTask {
  return {
    id: `turn-${index}`,
    sequence: index,
    runnerId: "runner",
    provider: "claude",
    status: "succeeded",
    projectId: "project",
    conversationId: "turn-1",
    ...(index > 1 ? { parentTaskId: `turn-${index - 1}` } : {}),
    createdAt: "2026-09-13T00:00:00Z",
    parts: [{ type: "text", text: `Prompt ${index}` }],
    ...change,
  };
}

export function fakeRunnerGateway(
  runner: FakeRunnerEvents,
  tasks: readonly RemoteRunnerTask[],
  capabilities: Partial<RemoteRunnerDescriptor["capabilities"]> = { eventBackwardPaging: true },
) {
  const state = { tasks };
  const calls = {
    getRunner: vi.fn().mockResolvedValue({
      protocolVersion: 1,
      runnerId: "runner",
      name: "Server",
      capabilities: {
        taskExecution: true,
        eventReplay: true,
        taskContinuation: true,
        ...capabilities,
      },
    }),
    listProjects: vi.fn().mockResolvedValue({ items: [{ id: "project", name: "App" }] }),
    listTasks: vi.fn(async ({ after }: { after: number }) => ({
      items: state.tasks
        .filter((task) => task.sequence > after)
        .sort((left, right) => left.sequence - right.sequence),
      nextCursor: null,
    })),
    getTask: vi.fn(async ({ taskId }: { taskId: string }) =>
      state.tasks.find((task) => task.id === taskId),
    ),
    listEvents: vi.fn(runner.listEvents),
    listEventsBefore: vi.fn(runner.listEventsBefore),
    getTaskResume: vi.fn().mockResolvedValue({ available: true, reason: null }),
  };
  return {
    calls,
    gateway: calls as unknown as RemoteRunnerGateway,
    replaceTasks: (next: readonly RemoteRunnerTask[]) => {
      state.tasks = next;
    },
    backward: () => calls.listEventsBefore.mock.calls.map(([request]) => request),
    forward: () => calls.listEvents.mock.calls.map(([request]) => request),
  };
}

export function loadTailFirst(
  gateway: RemoteRunnerGateway,
  previous: RemoteAgentInventorySnapshot = emptyRemoteInventory("server", true),
  progressed?: (snapshot: RemoteAgentInventorySnapshot) => void,
  valid: () => boolean = () => true,
): Promise<RemoteAgentInventorySnapshot> {
  return loadRemoteAgentInventory(
    gateway,
    previous,
    TAIL_FIRST_THREAD,
    valid,
    progressed && ((snapshot) => progressed(snapshot)),
  );
}

export async function loadUntilSettled(
  gateway: RemoteRunnerGateway,
  runner: FakeRunnerEvents,
  progressed?: (snapshot: RemoteAgentInventorySnapshot) => void,
): Promise<RemoteAgentInventorySnapshot> {
  let snapshot = await loadTailFirst(gateway, undefined, progressed);
  for (let pass = 0; pass < 40 && !replaySettled(snapshot, runner); pass += 1)
    snapshot = await loadTailFirst(gateway, snapshot, progressed);
  return snapshot;
}

function replaySettled(snapshot: RemoteAgentInventorySnapshot, runner: FakeRunnerEvents): boolean {
  if (remoteReplayBackfillPending(snapshot)) return false;
  return [...snapshot.replays.keys()].every((taskId) => {
    const task = snapshot.tasks.find((item) => item.id === taskId);
    if (task && isRemoteTaskTerminal(task) && !snapshot.replayComplete.has(taskId)) return false;
    return snapshot.replayCursors?.get(taskId) === (lastOf(runner.eventsOf(taskId))?.sequence ?? 0);
  });
}

export function replayState(snapshot: RemoteAgentInventorySnapshot) {
  return {
    replays: snapshot.replays,
    replayCursors: snapshot.replayCursors,
    replayBackfill: snapshot.replayBackfill,
    replayGaps: snapshot.replayGaps,
    replayComplete: snapshot.replayComplete,
    replayTruncated: snapshot.replayTruncated,
    replayDiscarded: snapshot.replayDiscarded,
    replayServerEvictions: snapshot.replayServerEvictions,
    subagentLifecycles: snapshot.subagentLifecycles,
    resumes: snapshot.resumes,
    tasks: snapshot.tasks,
    error: snapshot.error,
  };
}

export function projectedTurns(snapshot: RemoteAgentInventorySnapshot) {
  return projectRemoteAgentThreads({ ...snapshot, runnerId: "runner" }).find(
    (view) => view.thread.threadId === TAIL_FIRST_THREAD,
  )?.thread.turns;
}

export interface StreamTurn {
  readonly lines: number;
  readonly steerFromEnd?: readonly number[];
  readonly stderrEvery?: number;
  readonly end?: "task.succeeded" | "open";
  readonly lineText?: (index: number) => string;
}

export function emitStreamTurn(runner: FakeRunnerEvents, taskId: string, turn: StreamTurn): void {
  const pieces = streamPieces(turn);
  const steer = turn.steerFromEnd ?? [];
  const closing = turn.end === "open" ? 0 : 1;
  const total = pieces.length + steer.length + 1 + closing;
  let piece = 0;
  let steered = 0;
  runner.lifecycle(taskId, "task.created");
  for (let index = 1; index < total - closing; index += 1) {
    if (steer.includes(total - 1 - index)) {
      runner.input(taskId, `${taskId}-steer-${steered}`, `steer ${steered}`);
      steered += 1;
      continue;
    }
    const next = pieces[piece];
    piece += 1;
    runner.output(taskId, next?.text ?? "", next?.channel ?? "stdout");
    runner.skip(index % 3);
    runner.output("foreign-task", "noise\n");
  }
  if (closing === 1) runner.lifecycle(taskId, "task.succeeded");
}

function streamPieces(
  turn: StreamTurn,
): { readonly text: string; readonly channel: "stdout" | "stderr" }[] {
  const text = turn.lineText ?? ((index) => `line ${String(index).padStart(4, "0")} `);
  const stream = Array.from({ length: turn.lines }, (_, index) => claudeTextLine(text(index))).join(
    "",
  );
  const pieces: { text: string; channel: "stdout" | "stderr" }[] = [];
  for (let offset = 0; offset < stream.length; offset += 97) {
    pieces.push({ text: stream.slice(offset, offset + 97), channel: "stdout" });
    if (turn.stderrEvery !== undefined && pieces.length % turn.stderrEvery === 0)
      pieces.push({ text: `warning ${pieces.length}`, channel: "stderr" });
  }
  return pieces;
}

export function projectedTurn(snapshot: RemoteAgentInventorySnapshot, taskId: string) {
  return projectedTurns(snapshot)?.find((turn) => turn.turnId === taskId);
}

export function turnText(events: ReadonlyArray<AgentTurnEvent>): string {
  return events
    .map((event) => {
      if (event.kind === "assistantText") return event.text;
      if (event.kind === "userMessage") return `<user:${event.text}>`;
      return "";
    })
    .join("");
}

export function numberedLines(count: number, prefix = "line"): string[] {
  return Array.from(
    { length: count },
    (_, index) => `${prefix} ${String(index).padStart(4, "0")} `,
  );
}

export function lineNumbers(text: string): number[] {
  return [...text.matchAll(/line (\d{4}) /g)].map((match) => Number(match[1]));
}

export function lastOf<T>(items: readonly T[]): T | undefined {
  return items[items.length - 1];
}
