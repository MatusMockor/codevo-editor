import { expect } from "vitest";
import { MAX_REMOTE_RUNNER_EVENT_PAGE_ITEMS } from "../domain/remoteRunnerBackwardPage";
import type { RemoteRunnerTask } from "../domain/remoteRunner";
import { retainRemoteReplayWindow, MAX_REMOTE_REPLAY_INPUTS } from "./remoteAgentReplayWindow";
import {
  fakeRunnerGateway,
  lastOf,
  loadTailFirst,
  remoteTurn,
} from "./remoteAgentTailFirstTestSupport";
import { claudeTextLine, FakeRunnerEvents } from "./remoteAgentTurnActivityTestSupport";

export const SEEDS = [7, 42, 0xc0de, 0xdecafbad] as const;
export const CASES_PER_SEED = 168;
export const EXTRA_CASES: readonly (readonly [number, number])[] = [];
const PAGE = MAX_REMOTE_RUNNER_EVENT_PAGE_ITEMS;

export function randomFor(seed: number, index: number): () => number {
  let state = (seed ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function seededDeselectionPasses(seed: number, index: number): readonly number[] {
  const random = randomFor(seed ^ 0xa71e5ec7, index);
  return Array.from({ length: Math.floor(random() * 4) }, () => 1 + Math.floor(random() * 6)).sort(
    (left, right) => left - right,
  );
}

export interface ReplayLimits {
  readonly events: number;
  readonly bytes: number;
}

export async function discoverReplayLimits(): Promise<ReplayLimits> {
  const probe = new FakeRunnerEvents();
  for (let index = 0; index < PAGE * PAGE; index += 1) probe.output("turn-1", "");
  const events = retainRemoteReplayWindow(probe.eventsOf("turn-1"), Infinity).events.length;
  const chunk = "x".repeat(32_000);
  const runner = new FakeRunnerEvents();
  for (let index = 0; index < PAGE; index += 1) runner.output("turn-1", chunk);
  const snapshot = await loadTailFirst(fakeRunnerGateway(runner, [remoteTurn(1)], {}).gateway);
  const retained = snapshot.replays.get("turn-1")?.length ?? 0;
  expect(retained, "byte limit probe must evict at least one bounded output chunk").toBeLessThan(
    PAGE,
  );
  const base = retained * chunk.length;
  let low = 0;
  let high = chunk.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = new FakeRunnerEvents();
    for (let index = 0; index < retained; index += 1) candidate.output("turn-1", chunk);
    candidate.output("turn-1", "x".repeat(middle));
    const loaded = await loadTailFirst(fakeRunnerGateway(candidate, [remoteTurn(1)], {}).gateway);
    if (loaded.replays.get("turn-1")?.length === retained + 1) {
      low = middle;
      continue;
    }
    high = middle - 1;
  }
  return { events, bytes: (base + low) * 2 };
}

type Mode =
  | "small"
  | "countBelow"
  | "countAt"
  | "countAbove"
  | "countFar"
  | "byteBelow"
  | "byteAt"
  | "byteAbove"
  | "byteFar"
  | "boundary"
  | "lookbehindCount"
  | "lookbehindBytes"
  | "lookbehindExhaustion";
const LARGE_MODES: readonly Mode[] = [
  "countBelow",
  "countAt",
  "countAbove",
  "countFar",
  "byteBelow",
  "byteAt",
  "byteAbove",
  "byteFar",
  "boundary",
  "countFar",
  "boundary",
];
const BYTE_CHUNK = "x".repeat(30_000);

export interface GeneratedStream {
  readonly runner: FakeRunnerEvents;
  readonly tasks: readonly RemoteRunnerTask[];
  readonly description: string;
  readonly mode: Mode;
  readonly failureAt: number | null;
  readonly suspension: {
    readonly phase: "pending" | "scanningInputs" | "scanningBoundary";
    readonly passes: number;
  } | null;
  readonly inputCount: number;
  readonly serverLoss: boolean;
  readonly countClass: "under" | "at" | "over";
  readonly byteClass: "under" | "at" | "over";
}

export function generateStream(
  seed: number,
  caseIndex: number,
  limits: ReplayLimits,
): GeneratedStream {
  if (caseIndex >= 80) return generateLookbehind(seed, caseIndex, limits);
  const random = randomFor(seed, caseIndex);
  const integer = (max: number) => Math.floor(random() * max);
  const mode = LARGE_MODES[caseIndex] ?? "small";
  const taskCount =
    mode.startsWith("byte") || (mode === "small" && random() < 0.3) ? 2 + integer(3) : 1;
  const pageSize = mode === "small" && caseIndex % 7 === 0 ? 1 : PAGE;
  const runner = new FakeRunnerEvents(pageSize);
  const tasks: RemoteRunnerTask[] = [];
  const descriptions: string[] = [];
  let totalInputs = 0;
  let serverLoss = false;
  let countClass: GeneratedStream["countClass"] = "under";
  let byteClass: GeneratedStream["byteClass"] = "under";
  for (let turn = 1; turn <= taskCount; turn += 1) {
    const taskId = `turn-${turn}`;
    const running = turn === taskCount && random() < 0.35;
    tasks.push(remoteTurn(turn, { status: running ? "running" : "succeeded" }));
    const inputCount =
      mode === "boundary"
        ? MAX_REMOTE_REPLAY_INPUTS
        : caseIndex === 9
          ? integer(MAX_REMOTE_REPLAY_INPUTS)
          : integer(41);
    totalInputs += inputCount;
    const positions = new Map<number, number>();
    let count = 3 + integer(240);
    if (pageSize === 1) count = Math.max(count, PAGE * 2);
    if (mode === "countBelow") count = limits.events - 1;
    if (mode === "countAt") count = limits.events;
    if (mode === "countAbove") count = limits.events + 1;
    if (mode === "countFar") count = limits.events * 3;
    if (mode.startsWith("byte")) count = Math.ceil(limits.bytes / (BYTE_CHUNK.length * 2)) + 3;
    if (mode === "boundary") count = limits.events + 400;
    for (let input = 0; input < inputCount; input += 1) {
      const choices = [
        0,
        integer(count),
        Math.max(0, count - limits.events - integer(20)),
        Math.min(count - 1, PAGE * (1 + integer(3)) - 1),
      ];
      const at = mode === "boundary" ? 380 : choices[integer(choices.length)]!;
      positions.set(at, (positions.get(at) ?? 0) + 1);
    }
    const pendingPieces: string[] = [];
    const unterminated = random() < 0.5;
    const taskByteLimit =
      turn === taskCount ? limits.bytes : Math.floor(limits.bytes / Math.max(1, taskCount - 1));
    let byteRemaining = taskByteLimit / 2;
    if (mode === "byteBelow") byteRemaining -= 1;
    if (mode === "byteAbove") byteRemaining += 1;
    if (mode === "byteFar") byteRemaining *= 3;
    if (mode === "byteFar") count *= 3;
    let emittedInputs = 0;
    for (let index = 0; index < count; index += 1) {
      runner.skip(integer(6));
      for (let input = 0; input < (positions.get(index) ?? 0); input += 1) {
        runner.input(taskId, `${taskId}-input-${emittedInputs}`, `steer ${emittedInputs} é🧪`);
        emittedInputs += 1;
      }
      if (mode.startsWith("byte")) {
        const size = Math.min(BYTE_CHUNK.length, byteRemaining);
        runner.output(taskId, size === BYTE_CHUNK.length ? BYTE_CHUNK : BYTE_CHUNK.slice(0, size));
        byteRemaining -= size;
        continue;
      }
      if (mode === "boundary") {
        if (index === 0 || index === count - 1) {
          runner.output(taskId, claudeTextLine(`boundary ${index}`));
          continue;
        }
        runner.output(taskId, "", "stderr");
        continue;
      }
      if (index === 0) {
        runner.lifecycle(taskId, "task.created");
        continue;
      }
      if (index === 1) {
        runner.lifecycle(taskId, "task.running");
        continue;
      }
      if (index === count - 1 && !running) {
        runner.lifecycle(taskId, "task.succeeded");
        continue;
      }
      if (unterminated && index === count - (running ? 1 : 2)) {
        runner.output(taskId, claudeTextLine(`unterminated ${index} é中🧪`).trimEnd());
        continue;
      }
      if (pendingPieces.length > 0) {
        runner.output(taskId, pendingPieces.shift()!);
        continue;
      }
      if (random() < 0.15) {
        runner.output(taskId, random() < 0.3 ? "" : `warning ${index} é`, "stderr");
        continue;
      }
      if (random() < 0.1) {
        runner.output(taskId, "");
        continue;
      }
      const line = claudeTextLine(`line ${index} café 中🧪 `).replace(
        /\n$/,
        random() < 0.3 ? "\r\n" : "\n",
      );
      const characters = Array.from(line);
      const pieces = random() < 0.55 ? 2 + integer(4) : 1;
      for (let piece = 0; piece < pieces; piece += 1) {
        const start = Math.floor((characters.length * piece) / pieces);
        const end = Math.floor((characters.length * (piece + 1)) / pieces);
        pendingPieces.push(characters.slice(start, end).join(""));
      }
      runner.output(taskId, pendingPieces.shift()!);
    }
    const all = runner.eventsOf(taskId);
    const lossCandidates = all.filter((event) => event.type === "task.output" && event.text !== "");
    let loss: number | null = null;
    if (
      (mode === "countFar" || (mode === "small" && pageSize !== 1 && random() < 0.25)) &&
      lossCandidates.length > 1
    ) {
      const placement = integer(3);
      const target =
        mode === "countFar"
          ? PAGE
          : placement === 0
            ? all.length - 25
            : placement === 1
              ? PAGE
              : Math.max(0, all.length - limits.events - 20);
      const output = lossCandidates.reduce((closest, event) =>
        Math.abs(all.indexOf(event) - target) < Math.abs(all.indexOf(closest) - target)
          ? event
          : closest,
      );
      loss = output.sequence;
      const lastDiscardedStdout = lastOf(
        all.filter(
          (event) =>
            event.type === "task.output" && event.channel !== "stderr" && event.sequence <= loss!,
        ),
      );
      runner.discardOutputThrough(taskId, loss, lastDiscardedStdout?.text?.endsWith("\n") ?? true);
      serverLoss = true;
    }
    const nonInputs = all.filter((event) => event.type !== "task.input");
    const bytes = nonInputs.reduce((sum, event) => sum + (event.text?.length ?? 0) * 2, 0);
    if (nonInputs.length === limits.events) countClass = "at";
    if (nonInputs.length > limits.events) countClass = "over";
    if (bytes === taskByteLimit) byteClass = "at";
    if (bytes > taskByteLimit) byteClass = "over";
    descriptions.push(
      `${taskId}:${running ? "running" : "terminal"},unterminated=${unterminated},n=${all.length},bytes=${bytes},kinds=${JSON.stringify(Object.fromEntries(["task.created", "task.running", "task.succeeded", "stdout", "stderr", "task.input"].map((kind) => [kind, all.filter((event) => (event.type === "task.output" ? event.channel : event.type) === kind).length])))},inputs@${all
        .filter((event) => event.type === "task.input")
        .map((event) => all.indexOf(event))
        .join("/")},loss=${loss}`,
    );
  }
  const suspension =
    mode === "boundary" && caseIndex < 9
      ? { phase: "scanningBoundary" as const, passes: 1 + integer(3) }
      : mode === "countFar" && caseIndex < 9
        ? { phase: "scanningInputs" as const, passes: 1 + integer(3) }
        : pageSize === 1
          ? { phase: "pending" as const, passes: 1 + integer(3) }
          : null;
  return {
    runner,
    tasks,
    description: `page=${pageSize};${descriptions.join(";")}`,
    mode,
    inputCount: totalInputs,
    serverLoss,
    countClass,
    byteClass,
    failureAt:
      caseIndex === 9 || caseIndex === 10
        ? 26 + integer(caseIndex === 9 ? 20 : 3)
        : suspension === null && random() < 0.3
          ? 1 +
            integer(
              Math.max(
                1,
                Math.ceil(
                  tasks.reduce((sum, task) => sum + runner.eventsOf(task.id).length, 0) / pageSize,
                ),
              ),
            )
          : null,
    suspension,
  };
}

function generateLookbehind(
  seed: number,
  caseIndex: number,
  limits: ReplayLimits,
): GeneratedStream {
  const random = randomFor(seed, caseIndex);
  const integer = (max: number) => Math.floor(random() * max);
  const variant = caseIndex - 80;
  const seedIndex = SEEDS.findIndex((candidate) => candidate === seed);
  const exhaustion = variant >= 80;
  const byteWindow = seedIndex % 2 === 1;
  const distance = [0, PAGE, PAGE * 4, PAGE * 28, PAGE * 52][variant % 5]!;
  const inputCount = [0, 7, 32, 39][
    exhaustion ? Math.floor((variant - 80) / 2) : Math.floor(variant / 5) % 4
  ]!;
  const lifecycleOnly = exhaustion && variant === 84 && !byteWindow;
  const lossPosition = exhaustion ? variant % 2 : Math.floor(variant / 20);
  const endsAtBoundary = (seedIndex + variant) % 2 === 0;
  const inputsFirst = (seedIndex + Math.floor(variant / 5)) % 2 === 0;
  const newerInputs = inputsFirst ? (variant % 5 === 1 ? Math.min(31, inputCount) : inputCount) : 0;
  const olderInputs = inputCount - newerInputs;
  const runner = new FakeRunnerEvents();
  const taskCount = variant === 79 ? 3 : 1;
  const tasks = Array.from({ length: taskCount }, (_, index) => remoteTurn(index + 1));
  const descriptions: string[] = [];
  let countClass: GeneratedStream["countClass"] = "under";
  let byteClass: GeneratedStream["byteClass"] = "under";
  for (const task of tasks) {
    const taskId = task.id;
    let emittedInputs = 0;
    const lifecycle = (count: number) => {
      for (let index = 0; index < count; index += 1) {
        runner.skip(integer(3));
        runner.lifecycle(taskId, index % 2 === 0 ? "task.created" : "task.running");
      }
    };
    const inputs = (count: number) => {
      for (let index = 0; index < count; index += 1) {
        runner.input(taskId, `${taskId}-input-${emittedInputs}`, `lookbehind ${emittedInputs} é🧪`);
        emittedInputs += 1;
        lifecycle(1 + integer(3));
        if (!inputsFirst && inputCount === 32 && index === 0) lifecycle(PAGE * 2);
      }
    };
    lifecycle(exhaustion ? variant % 4 : 100 + integer(PAGE));
    inputs(olderInputs);
    lifecycle(exhaustion ? 0 : PAGE * 3);
    const lossBelow = exhaustion
      ? lifecycleOnly
        ? runner.lifecycle(taskId, "task.created")
        : runner.output(taskId, "discarded error", "stderr")
      : runner.output(taskId, endsAtBoundary ? "old\n" : "old");
    lifecycle(exhaustion ? 0 : PAGE);
    let stdout = lossBelow;
    if (!exhaustion) {
      runner.output(taskId, endsAtBoundary ? "older partial" : "older complete\n");
      stdout = runner.output(taskId, endsAtBoundary ? "boundary\n" : "boundary é🧪");
    }
    lifecycle(distance);
    const lossAbove = lifecycleOnly
      ? runner.lifecycle(taskId, "task.running")
      : runner.output(taskId, "discarded newer stderr", "stderr");
    inputs(newerInputs);
    const taskByteLimit =
      task === tasks[tasks.length - 1]
        ? limits.bytes
        : Math.floor(limits.bytes / Math.max(1, tasks.length - 1));
    const windowCount = byteWindow
      ? Math.floor(taskByteLimit / (BYTE_CHUNK.length * 2)) + 2
      : limits.events + 1 + integer(PAGE);
    for (let index = 0; index < windowCount; index += 1) {
      if (byteWindow) {
        runner.output(taskId, BYTE_CHUNK, "stderr");
        continue;
      }
      if (lifecycleOnly) {
        lifecycle(1);
        continue;
      }
      if (exhaustion && variant % 4 === 0) {
        runner.output(taskId, "", "stderr");
        continue;
      }
      if (index % 3 === 0) {
        runner.output(taskId, "", "stderr");
        continue;
      }
      lifecycle(1);
    }
    if (!exhaustion && variant % 3 === 0) runner.output(taskId, "");
    const nonInputs = runner.eventsOf(taskId).filter((event) => event.type !== "task.input");
    const bytes = nonInputs.reduce((sum, event) => sum + (event.text?.length ?? 0) * 2, 0);
    if (nonInputs.length === limits.events) countClass = "at";
    if (nonInputs.length > limits.events) countClass = "over";
    if (bytes === taskByteLimit) byteClass = "at";
    if (bytes > taskByteLimit) byteClass = "over";
    const loss = [null, lossBelow, stdout, lossAbove][lossPosition] ?? null;
    if (loss !== null) runner.discardOutputThrough(taskId, loss, endsAtBoundary);
    descriptions.push(
      `${taskId}:distance=${distance},stdout=${exhaustion ? "none" : stdout},newline=${endsAtBoundary},inputs=${olderInputs}/${newerInputs},lossPosition=${lossPosition},loss=${loss},window=${windowCount}`,
    );
  }
  return {
    runner,
    tasks,
    description: descriptions.join(";"),
    mode: exhaustion ? "lookbehindExhaustion" : byteWindow ? "lookbehindBytes" : "lookbehindCount",
    inputCount: inputCount * taskCount,
    serverLoss: lossPosition > 0,
    countClass,
    byteClass,
    failureAt: variant % 11 === 0 ? 1 + integer(10) : null,
    suspension: null,
  };
}
