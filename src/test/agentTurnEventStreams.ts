import type { AgentTurnEvent } from "../domain/agentThread";
import type {
  AgentTurnEventRetentionPolicy,
  AgentTurnEventRetentionResult,
} from "../domain/agentTurnEventRetention";

type Random = (bound: number) => number;
type SubagentEvent = Extract<AgentTurnEvent, { kind: "subagent" }>;
type BackgroundStatus = Extract<AgentTurnEvent, { kind: "backgroundTask" }>["status"];

interface SubagentShape {
  readonly toolId?: string;
  readonly taskId?: string;
}

const USAGE = { inputTokens: 1, outputTokens: 1, contextTokens: null } as const;

export function seededRandom(seed: number): Random {
  let state = (seed * 2_654_435_761) >>> 0;
  return (bound) => {
    state = (Math.imul(state, 1_103_515_245) + 12_345) >>> 0;
    return state % bound;
  };
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return item;
    const record = item as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, record[key]]),
    );
  });
}

export function legacyMergeTurnEvents(
  existing: ReadonlyArray<AgentTurnEvent>,
  incoming: ReadonlyArray<AgentTurnEvent>,
  policy: AgentTurnEventRetentionPolicy,
): AgentTurnEventRetentionResult {
  if (incoming.length === 0) return { events: existing, truncated: false };
  const events = [...existing];
  let retainedBytes = events.reduce((total, event) => total + policy.eventBytes(event), 0);
  let truncated = false;
  const threads = new Map<string, number>();
  const countThread = (event: AgentTurnEvent, delta: number): void => {
    if (!("agentThreadId" in event)) return;
    const count = (threads.get(event.agentThreadId) ?? 0) + delta;
    threads.delete(event.agentThreadId);
    if (count > 0) threads.set(event.agentThreadId, count);
  };
  events.forEach((event) => countThread(event, 1));
  for (const event of incoming) {
    const eventBytes = policy.eventBytes(event);
    if (eventBytes > policy.maxBytes) {
      truncated = true;
      continue;
    }
    const previous = events[events.length - 1];
    const coalesced = policy.coalesceText(previous, event);
    if (coalesced !== null && previous !== undefined) {
      retainedBytes += policy.eventBytes(coalesced) - policy.eventBytes(previous);
      events[events.length - 1] = coalesced;
    }
    if (coalesced === null || previous === undefined) {
      events.push(event);
      retainedBytes += eventBytes;
      countThread(event, 1);
    }
    while (
      events.length > policy.maxEvents ||
      retainedBytes > policy.maxBytes ||
      threads.size > policy.maxSubagentThreads
    ) {
      const oldestOutput = events.findIndex((candidate) => {
        policy.probe?.step();
        return candidate.kind !== "userMessage";
      });
      const [removed] = events.splice(oldestOutput < 0 ? events.length - 1 : oldestOutput, 1);
      if (removed === undefined) break;
      retainedBytes -= policy.eventBytes(removed);
      countThread(removed, -1);
      truncated = true;
    }
  }
  return { events, truncated };
}

export function hostileAgentTurnStream(seed: number, length: number): AgentTurnEvent[] {
  const next = seededRandom(seed);
  const makers: ReadonlyArray<() => AgentTurnEvent> = [
    () => ({
      kind: "backgroundTask",
      taskId: `t${next(3)}`,
      status: pick(next, [
        "starting",
        "running",
        "running",
        "running",
        "completed",
        "failed",
        "stopped",
      ] as const),
      taskType: pick(next, ["monitor", "shell", "agent", "other"] as const),
      ...(next(3) === 0 ? { description: `d${next(3)}` } : {}),
    }),
    () => ({
      kind: "subagent",
      status: pick(next, [
        "starting",
        "running",
        "running",
        "running",
        "completed",
        "failed",
      ] as const),
      ...(next(4) === 0 ? {} : { toolId: `tool-${next(3)}` }),
      ...(next(4) === 0 ? {} : { taskId: `task-${next(3)}` }),
      ...telemetry(next),
    }),
    () => ({
      kind: "contextUsage",
      model: `m${next(2)}`,
      inputTokens: next(1_000),
      contextWindow: null,
    }),
    () => ({
      kind: "contextUsage",
      model: `m${next(2)}`,
      inputTokens: null,
      contextWindow: 1 + next(1_000),
    }),
    () => ({ kind: "contextCompaction", beforeTokens: null, afterTokens: null }),
    () => ({ kind: "contextCompactionStatus", status: "compacting", message: null }),
    ...sharedMakers(next, 3, 3),
  ];
  return Array.from({ length }, () => pick(next, makers)());
}

export function realisticAgentTurnStream(seed: number, length: number): AgentTurnEvent[] {
  const next = seededRandom(seed);
  const makers = [...progressMakers(next), ...boundaryMakers(next), ...sharedMakers(next, 3, 9)];
  return Array.from({ length }, () => pick(next, makers)());
}

export function agentTurnStream(seed: number, length: number): AgentTurnEvent[] {
  const shape = seed % 3;
  if (shape === 0) return realisticAgentTurnStream(seed, length);
  if (shape === 1) return longRunningAgentTurnStream(seed, length);
  return hostileAgentTurnStream(seed, length);
}

/** Delivery batches as the supervisor produces them; a size of 0 jitters per seed. */
export function batchedAgentTurnStream(
  seed: number,
  length: number,
  batchSize: number,
): AgentTurnEvent[][] {
  const events = agentTurnStream(seed, length);
  const next = seededRandom(seed + 1);
  const batches: AgentTurnEvent[][] = [];
  let index = 0;
  while (index < events.length) {
    const size = batchSize > 0 ? batchSize : 1 + next(97);
    batches.push(events.slice(index, index + size));
    index += size;
  }
  return batches;
}

export function longRunningAgentTurnStream(seed: number, length: number): AgentTurnEvent[] {
  const next = seededRandom(seed);
  const progress = [...progressMakers(next), ...usageMakers(next, 3)];
  const everything = [...progress, ...boundaryMakers(next), ...sharedMakers(next, 3, 9)];
  const quietness = 3 + (seed % 6);
  return Array.from({ length }, () => pick(next, next(quietness) === 0 ? everything : progress)());
}

const SUBAGENT_SHAPES: ReadonlyArray<SubagentShape> = [
  { toolId: "toolu_a", taskId: "task_a" },
  { toolId: "toolu_b", taskId: "task_b" },
  { toolId: "toolu_c" },
  { taskId: "task_d" },
];

function progressMakers(next: Random): ReadonlyArray<() => AgentTurnEvent> {
  return [
    () => subagentTick(next, pick(next, SUBAGENT_SHAPES)),
    () => subagentTick(next, pick(next, SUBAGENT_SHAPES)),
    () => subagentTick(next, pick(next, SUBAGENT_SHAPES)),
    () => backgroundEvent(next, pick(next, SUBAGENT_SHAPES), "running"),
    () => backgroundEvent(next, pick(next, SUBAGENT_SHAPES), "running"),
    () => ({
      kind: "contextUsage",
      model: pick(next, ["claude-main", "claude-main", "claude-fast"] as const),
      inputTokens: next(200_000),
      contextWindow: null,
    }),
    () => ({
      kind: "contextUsage",
      model: pick(next, ["claude-main", "claude-fast"] as const),
      inputTokens: null,
      contextWindow: pick(next, [200_000, 1_000_000] as const),
    }),
  ];
}

function boundaryMakers(next: Random): ReadonlyArray<() => AgentTurnEvent> {
  return [
    () => subagentBoundary(next, pick(next, SUBAGENT_SHAPES)),
    () =>
      backgroundEvent(
        next,
        pick(next, SUBAGENT_SHAPES),
        pick(next, ["starting", "completed", "failed", "stopped"] as const),
      ),
    () => spawnToolEvent(next, pick(next, SUBAGENT_SHAPES)),
    () => parentedToolEvent(next, pick(next, SUBAGENT_SHAPES)),
    () =>
      pick(next, [
        { kind: "contextCompaction", beforeTokens: 150_000, afterTokens: 20_000 },
        { kind: "contextCompactionStatus", status: "compacting", message: null },
        { kind: "contextCompactionStatus", status: "idle", message: null },
      ] as const),
  ];
}

function usageMakers(next: Random, threads: number): ReadonlyArray<() => AgentTurnEvent> {
  return [
    () => ({
      kind: "subagentUsage",
      agentThreadId: `c${next(threads)}`,
      usage: { ...USAGE, inputTokens: next(9_000) },
    }),
  ];
}

function sharedMakers(
  next: Random,
  threads: number,
  texts: number,
): ReadonlyArray<() => AgentTurnEvent> {
  return [
    () => ({ kind: "subagentUsage", agentThreadId: `c${next(threads)}`, usage: USAGE }),
    () => ({
      kind: "subagentUsage",
      agentThreadId: `c${next(threads)}`,
      usage: { ...USAGE, inputTokens: next(9_000) },
    }),
    () => ({
      kind: "subagentTurnDone",
      agentThreadId: `c${next(threads)}`,
      durationMs: next(100),
      isError: next(3) === 0,
    }),
    () => ({
      kind: "subagentActivity",
      agentThreadId: `c${next(threads)}`,
      agentPath: `p${next(2)}`,
      activity: pick(next, ["started", "interacted", "interrupted", "completed"] as const),
    }),
    () => ({
      kind: "subagentEvent",
      agentThreadId: `c${next(threads)}`,
      event: { kind: "assistantText", text: `s${next(texts)}` },
    }),
    () => ({ kind: "assistantText", text: `w${next(texts)}` }),
    () => ({ kind: "reasoning", text: `r${next(texts)}` }),
    () => ({ kind: "userMessage", text: `u${next(texts)}` }),
    () => ({
      kind: "toolCall",
      toolId: `tool-${next(3)}`,
      name: pick(next, ["Task", "Bash", "Read", "Agent", "spawn_agent"] as const),
      inputSummary: `s${next(texts)}`,
    }),
    () => ({
      kind: "toolResult",
      toolId: `tool-${next(3)}`,
      outputSummary: `o${next(texts)}`,
      isError: next(4) === 0,
    }),
    () => ({ kind: "result", text: `res${next(3)}`, isError: next(4) === 0, usage: null }),
    () => ({ kind: "error", message: `e${next(3)}` }),
  ];
}

function subagentTick(next: Random, shape: SubagentShape): AgentTurnEvent {
  return { kind: "subagent", status: "running", ...partialIds(next, shape), ...telemetry(next) };
}

function subagentBoundary(next: Random, shape: SubagentShape): AgentTurnEvent {
  const status = pick(next, ["starting", "starting", "completed", "failed"] as const);
  const ids = status === "starting" ? shape : partialIds(next, shape);
  return { kind: "subagent", status, ...ids, ...telemetry(next) };
}

function partialIds(next: Random, shape: SubagentShape): SubagentShape {
  if (shape.toolId === undefined || shape.taskId === undefined) return shape;
  return pick(next, [shape, { toolId: shape.toolId }, { taskId: shape.taskId }] as const);
}

function telemetry(next: Random): Partial<SubagentEvent> {
  return {
    ...(next(3) === 0 ? { subagentType: `type${next(2)}` } : {}),
    ...(next(3) === 0 ? { description: `desc${next(2)}` } : {}),
    ...(next(2) === 0 ? { durationMs: next(1_000) } : {}),
    ...(next(2) === 0 ? { totalTokens: next(1_000) } : {}),
    ...(next(2) === 0 ? { toolUses: next(9) } : {}),
    ...(next(2) === 0 ? { lastToolName: `Tool${next(3)}` } : {}),
  };
}

function backgroundEvent(
  next: Random,
  shape: SubagentShape,
  status: BackgroundStatus,
): AgentTurnEvent {
  return {
    kind: "backgroundTask",
    taskId: shape.taskId ?? "task_monitor",
    status,
    taskType: pick(next, ["monitor", "shell", "agent", "other"] as const),
    ...(next(3) === 0 ? { description: `d${next(3)}` } : {}),
  };
}

function spawnToolEvent(next: Random, shape: SubagentShape): AgentTurnEvent {
  const toolId = shape.toolId ?? "toolu_main";
  if (next(2) === 0)
    return { kind: "toolCall", toolId, name: "Task", inputSummary: `go${next(3)}` };
  return { kind: "toolResult", toolId, outputSummary: `done${next(3)}`, isError: next(4) === 0 };
}

function parentedToolEvent(next: Random, shape: SubagentShape): AgentTurnEvent {
  const parentToolId = shape.toolId ?? "toolu_main";
  if (next(2) === 0) return { kind: "assistantText", text: `child${next(5)}`, parentToolId };
  return {
    kind: "toolCall",
    toolId: `toolu_child_${next(4)}`,
    name: "Read",
    inputSummary: `file${next(4)}`,
    parentToolId,
  };
}

function pick<T>(next: Random, values: ReadonlyArray<T>): T {
  return values[next(values.length)]!;
}

const NESTED_ROOT_TOOL_IDS = ["toolu_root_a", "toolu_root_b"] as const;
const NESTED_CHILD_TOOL_IDS = ["toolu_child_a", "toolu_child_b", "toolu_child_c"] as const;
const NESTED_TASK_IDS = ["task_a", "task_b", "task_c"] as const;

/** Nested spawn fan-out where child tool ids collide with task-keyed identities already retained. */
export function nestedSpawnAgentTurnStream(seed: number, length: number): AgentTurnEvent[] {
  const next = seededRandom(seed);
  const rootId = (): string => pick(next, NESTED_ROOT_TOOL_IDS);
  const childId = (): string => pick(next, NESTED_CHILD_TOOL_IDS);
  const anyId = (): string => (next(4) === 0 ? rootId() : childId());
  const taskId = (): string => pick(next, NESTED_TASK_IDS);
  const makers: ReadonlyArray<() => AgentTurnEvent> = [
    () => ({
      kind: "toolCall",
      toolId: rootId(),
      name: pick(next, ["Task", "Agent", "SpawnAgent"] as const),
      inputSummary: `top${next(3)}`,
      description: `Top level work ${next(3)}`,
    }),
    () => ({
      kind: "toolCall",
      toolId: anyId(),
      name: pick(next, ["Task", "Agent"] as const),
      inputSummary: `nested${next(3)}`,
      description: `Nested work ${next(3)}`,
      parentToolId: anyId(),
    }),
    () => ({
      kind: "toolCall",
      toolId: childId(),
      name: pick(next, ["Task", "Agent"] as const),
      inputSummary: `nested${next(3)}`,
      description: `Nested work ${next(3)}`,
      parentToolId: rootId(),
    }),
    () => ({
      kind: "toolCall",
      toolId: childId(),
      name: "Read",
      inputSummary: `file${next(3)}`,
      parentToolId: anyId(),
    }),
    () => ({ kind: "subagent", status: "running", taskId: taskId(), ...telemetry(next) }),
    () => ({ kind: "subagent", status: "starting", taskId: taskId(), description: `t${next(3)}` }),
    () => ({
      kind: "subagent",
      status: pick(next, ["starting", "running", "completed", "failed"] as const),
      taskId: taskId(),
      toolId: childId(),
      ...telemetry(next),
    }),
    () => ({
      kind: "toolResult",
      toolId: anyId(),
      outputSummary: `out${next(3)}`,
      isError: next(4) === 0,
    }),
    () => ({
      kind: "backgroundTask",
      taskId: taskId(),
      status: pick(next, ["starting", "running", "stopped"] as const),
      taskType: pick(next, ["agent", "other", "shell"] as const),
    }),
    () => ({
      kind: "subagentActivity",
      agentThreadId: `c${next(2)}`,
      agentPath: `p${next(2)}`,
      activity: pick(next, ["started", "interacted", "interrupted", "completed"] as const),
    }),
    () => ({
      kind: "subagentTurnDone",
      agentThreadId: `c${next(2)}`,
      durationMs: next(99),
      isError: next(3) === 0,
    }),
    () => ({ kind: "assistantText", text: `w${next(3)}` }),
    () => ({ kind: "userMessage", text: `u${next(3)}` }),
  ];
  return Array.from({ length }, () => pick(next, makers)());
}
