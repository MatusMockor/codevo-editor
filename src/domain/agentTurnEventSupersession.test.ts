import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  hostileAgentTurnStream,
  legacyMergeTurnEvents,
  longRunningAgentTurnStream,
  realisticAgentTurnStream,
} from "../test/agentTurnEventStreams";
import { projectAgentBackgroundActivity } from "./agentBackgroundActivity";
import { agentContextWindow } from "./agentContextWindow";
import { parseClaudeStreamJsonLine } from "./agentOutput/claudeStreamJson";
import { retainAgentSubagentLifecycle } from "./agentSubagentLifecycle";
import {
  MAX_AGENT_EVENT_BYTES_PER_TURN,
  MAX_AGENT_EVENTS_PER_TURN,
  MAX_SUBAGENT_THREADS_PER_TURN,
  agentTurnEventUtf8Bytes,
  capPersistedTurnEvents,
  coalesceAgentTextEvents,
  mergeTurnEvents,
  type AgentThread,
  type AgentTurnEvent,
} from "./agentThread";
import {
  capAgentTurnEvents,
  retainAgentTurnEvents,
  type AgentTurnEventRetentionPolicy,
  type AgentTurnEventRetentionResult,
} from "./agentTurnEventRetention";
import {
  agentTurnEventSupersession,
  isAgentTurnSnapshotEvent,
  mergeSupersededAgentTurnEvent,
} from "./agentTurnEventSupersession";

const TURN_POLICY: AgentTurnEventRetentionPolicy = {
  maxEvents: MAX_AGENT_EVENTS_PER_TURN,
  maxBytes: MAX_AGENT_EVENT_BYTES_PER_TURN,
  maxSubagentThreads: MAX_SUBAGENT_THREADS_PER_TURN,
  eventBytes: agentTurnEventUtf8Bytes,
  coalesceText: coalesceAgentTextEvents,
};

const SMALL_POLICY: AgentTurnEventRetentionPolicy = {
  ...TURN_POLICY,
  maxEvents: 20,
  maxBytes: 1_200,
  maxSubagentThreads: 3,
};

const UNBOUNDED = {
  maxEvents: Number.MAX_SAFE_INTEGER,
  maxBytes: Number.MAX_SAFE_INTEGER,
  maxSubagentThreads: Number.MAX_SAFE_INTEGER,
};

function mergeInBatches(
  incoming: ReadonlyArray<AgentTurnEvent>,
  size: number,
  policy: AgentTurnEventRetentionPolicy,
): AgentTurnEventRetentionResult {
  let events: ReadonlyArray<AgentTurnEvent> = [];
  let truncated = false;
  for (let index = 0; index < incoming.length; index += size) {
    const merged = retainAgentTurnEvents(events, incoming.slice(index, index + size), policy);
    events = merged.events;
    truncated ||= merged.truncated;
  }
  return { events, truncated };
}

type BackgroundStatus = Extract<AgentTurnEvent, { kind: "backgroundTask" }>["status"];
type SubagentStatus = Extract<AgentTurnEvent, { kind: "subagent" }>["status"];

function background(
  taskId: string,
  status: BackgroundStatus,
  extra: { taskType?: "monitor" | "shell" | "agent" | "other"; description?: string } = {},
): AgentTurnEvent {
  return {
    kind: "backgroundTask",
    taskId,
    status,
    taskType: extra.taskType ?? "other",
    ...(extra.description === undefined ? {} : { description: extra.description }),
  };
}

function subagent(
  taskId: string,
  status: SubagentStatus,
  extra: Partial<Extract<AgentTurnEvent, { kind: "subagent" }>> = {},
): AgentTurnEvent {
  return { kind: "subagent", status, toolId: `tool-${taskId}`, taskId, ...extra };
}

function tick(taskId: string, step: number): AgentTurnEvent[] {
  return [
    subagent(taskId, "running", {
      durationMs: step * 1_000,
      totalTokens: step * 10,
      toolUses: step,
      lastToolName: `Tool${step % 3}`,
    }),
    background(taskId, "running"),
  ];
}

function toolCall(index: number): AgentTurnEvent {
  return { kind: "toolCall", toolId: `call-${index}`, name: "Bash", inputSummary: `echo ${index}` };
}

function occupancy(inputTokens: number, model = "claude-main"): AgentTurnEvent {
  return { kind: "contextUsage", model, inputTokens, contextWindow: null };
}

function capacity(contextWindow: number, model = "claude-main"): AgentTurnEvent {
  return { kind: "contextUsage", model, inputTokens: null, contextWindow };
}

function recountBytes(events: ReadonlyArray<AgentTurnEvent>): number {
  return events.reduce(
    (total, event) => total + agentTurnEventUtf8Bytes(structuredClone(event)),
    0,
  );
}

function carriesSnapshot(candidate: AgentTurnEvent, snapshot: AgentTurnEvent): boolean {
  if (candidate.kind === "subagent" && snapshot.kind === "subagent")
    return (
      candidate.status === "running" &&
      (snapshot.toolId === undefined || candidate.toolId === snapshot.toolId) &&
      (snapshot.taskId === undefined || candidate.taskId === snapshot.taskId) &&
      (snapshot.toolUses === undefined || candidate.toolUses === snapshot.toolUses)
    );
  if (candidate.kind === "backgroundTask" && snapshot.kind === "backgroundTask")
    return candidate.status === "running" && candidate.taskId === snapshot.taskId;
  return canonicalJson(candidate) === canonicalJson(snapshot);
}

function subagentScenario(): AgentTurnEvent[] {
  const events: AgentTurnEvent[] = [
    { kind: "toolCall", toolId: "tool-a", name: "Task", inputSummary: "explore a" },
    { kind: "toolCall", toolId: "tool-b", name: "Task", inputSummary: "explore b" },
    subagent("a", "starting", { subagentType: "Explore", description: "Map consumers" }),
    background("a", "starting", { taskType: "agent", description: "Map consumers" }),
    subagent("b", "starting", { subagentType: "Plan", description: "Plan the fix" }),
    background("b", "starting", { taskType: "agent", description: "Plan the fix" }),
  ];
  for (let step = 1; step <= 300; step += 1) {
    events.push(...tick("a", step), toolCall(step), ...tick("b", step));
  }
  return events;
}

function threadWith(events: ReadonlyArray<AgentTurnEvent>, eventsTruncated: boolean): AgentThread {
  return {
    provider: { kind: "claudeCode", sessionId: null },
    turns: [{ events, eventsTruncated, status: { kind: "running" } }],
  } as unknown as AgentThread;
}

describe("agentTurnEventSupersession", () => {
  it.each<[string, AgentTurnEvent, "snapshot" | "barrier" | "content"]>([
    ["running background task", background("t", "running"), "snapshot"],
    ["starting background task", background("t", "starting"), "barrier"],
    ["completed background task", background("t", "completed"), "barrier"],
    ["failed background task", background("t", "failed"), "barrier"],
    ["stopped background task", background("t", "stopped"), "barrier"],
    ["running subagent", subagent("t", "running"), "snapshot"],
    ["starting subagent", subagent("t", "starting"), "barrier"],
    ["completed subagent", subagent("t", "completed"), "barrier"],
    ["failed subagent", subagent("t", "failed"), "barrier"],
    ["anonymous running subagent", { kind: "subagent", status: "running" }, "content"],
    ["occupancy", occupancy(10), "snapshot"],
    ["capacity", capacity(200_000), "snapshot"],
    [
      "combined context usage",
      { kind: "contextUsage", model: "m", inputTokens: 1, contextWindow: 2 },
      "barrier",
    ],
    ["invalid occupancy", occupancy(-1), "barrier"],
    ["compaction", { kind: "contextCompaction", beforeTokens: 1, afterTokens: 1 }, "barrier"],
    ["error", { kind: "error", message: "boom" }, "barrier"],
    ["failed result", { kind: "result", text: "", isError: true, usage: null }, "barrier"],
    ["clean result", { kind: "result", text: "", isError: false, usage: null }, "content"],
    ["user message", { kind: "userMessage", text: "steer" }, "content"],
    ["tool call", toolCall(1), "barrier"],
    [
      "subagent tool call",
      {
        kind: "toolCall",
        toolId: "call-1",
        name: "Bash",
        inputSummary: "echo 1",
        parentToolId: "tool-a",
      },
      "content",
    ],
    [
      "tool result",
      { kind: "toolResult", toolId: "call-1", outputSummary: "ok", isError: false },
      "barrier",
    ],
    [
      "subagent tool result",
      {
        kind: "toolResult",
        toolId: "call-1",
        outputSummary: "ok",
        isError: false,
        parentToolId: "tool-a",
      },
      "content",
    ],
    [
      "codex turn done",
      { kind: "subagentTurnDone", agentThreadId: "c", durationMs: null, isError: false },
      "barrier",
    ],
    ["assistant text", { kind: "assistantText", text: "hello" }, "content"],
    [
      "codex activity",
      { kind: "subagentActivity", agentThreadId: "c", agentPath: "p", activity: "interacted" },
      "barrier",
    ],
  ])("classifies %s", (_label, event, expected) => {
    expect(agentTurnEventSupersession(event).kind).toBe(expected);
    expect(isAgentTurnSnapshotEvent(event)).toBe(expected === "snapshot");
  });

  it("separates identities per task, per model capacity, and per codex thread", () => {
    expect(agentTurnEventSupersession(background("a", "running"))).not.toEqual(
      agentTurnEventSupersession(background("b", "running")),
    );
    expect(agentTurnEventSupersession(capacity(1, "x"))).not.toEqual(
      agentTurnEventSupersession(capacity(1, "y")),
    );
    expect(agentTurnEventSupersession(occupancy(1, "x"))).toEqual(
      agentTurnEventSupersession(occupancy(2, "y")),
    );
  });

  it("refuses to merge terminal, foreign, or description-conflicting snapshots", () => {
    expect(
      mergeSupersededAgentTurnEvent(background("a", "starting"), background("a", "running")),
    ).toBeNull();
    expect(
      mergeSupersededAgentTurnEvent(background("a", "running"), background("b", "running")),
    ).toBeNull();
    expect(
      mergeSupersededAgentTurnEvent(
        subagent("a", "running", { description: "one" }),
        subagent("a", "running", { description: "two" }),
      ),
    ).toBeNull();
    expect(mergeSupersededAgentTurnEvent(toolCall(1), background("a", "running"))).toBeNull();
  });
});

describe("mergeTurnEvents supersession", () => {
  it("keeps every real event when two subagents tick 300 times each", () => {
    const incoming = subagentScenario();
    const merged = mergeTurnEvents([], incoming);
    const real = incoming.filter((event) => !isAgentTurnSnapshotEvent(event));
    expect(merged.truncated).toBe(false);
    expect(merged.events.length).toBeLessThanOrEqual(MAX_AGENT_EVENTS_PER_TURN);
    expect(merged.events.filter((event) => !isAgentTurnSnapshotEvent(event))).toEqual(real);
    expect(merged.events.filter(isAgentTurnSnapshotEvent)).toHaveLength(4);
  });

  it("projects the same background activity and subagent lifecycle as the raw stream", () => {
    const incoming = subagentScenario();
    const merged = mergeTurnEvents([], incoming);
    expect(projectAgentBackgroundActivity(merged.events, true, merged.truncated)).toEqual(
      projectAgentBackgroundActivity(incoming, true, false),
    );
    expect(retainAgentSubagentLifecycle(undefined, merged.events)).toEqual(
      retainAgentSubagentLifecycle(undefined, incoming),
    );
  });

  it("never supersedes starting or terminal events", () => {
    const incoming: AgentTurnEvent[] = [
      background("a", "starting", { taskType: "agent" }),
      background("a", "starting", { taskType: "agent" }),
      subagent("a", "starting"),
      subagent("a", "starting"),
      background("a", "completed"),
      background("a", "completed"),
      subagent("a", "completed"),
      subagent("a", "completed"),
    ];
    expect(mergeTurnEvents([], incoming).events).toEqual(incoming);
  });

  it("does not resurrect a task when a tick follows its terminal event", () => {
    const incoming: AgentTurnEvent[] = [
      background("a", "starting", { taskType: "agent" }),
      background("a", "running"),
      background("a", "completed"),
      background("a", "running"),
      background("a", "running"),
    ];
    const merged = mergeTurnEvents([], incoming);
    expect(
      merged.events.map((event) => (event.kind === "backgroundTask" ? event.status : "")),
    ).toEqual(["starting", "running", "completed", "running"]);
    expect(projectAgentBackgroundActivity(merged.events, true).tasks).toEqual([]);
  });

  it("carries description and task type forward through replacement", () => {
    const incoming: AgentTurnEvent[] = [
      background("a", "starting"),
      background("a", "running", { taskType: "agent", description: "Audit the store" }),
      background("a", "running"),
      subagent("a", "starting"),
      subagent("a", "running", { subagentType: "Explore", description: "Audit the store" }),
      subagent("a", "running", { toolUses: 4 }),
    ];
    const merged = mergeTurnEvents([], incoming);
    expect(merged.events).toHaveLength(4);
    expect(projectAgentBackgroundActivity(merged.events, true).tasks).toEqual([
      { taskId: "a", taskType: "agent", description: "Audit the store" },
    ]);
    expect(projectAgentBackgroundActivity(merged.events, true)).toEqual(
      projectAgentBackgroundActivity(incoming, true),
    );
    expect(retainAgentSubagentLifecycle(undefined, merged.events)).toEqual(
      retainAgentSubagentLifecycle(undefined, incoming),
    );
  });

  it("keeps conflicting subagent descriptions as separate events", () => {
    const incoming: AgentTurnEvent[] = [
      subagent("a", "running", { description: "first" }),
      subagent("a", "running", { description: "second" }),
      subagent("a", "running", { description: "second", toolUses: 2 }),
    ];
    const merged = mergeTurnEvents([], incoming);
    expect(merged.events).toHaveLength(2);
    expect(retainAgentSubagentLifecycle(undefined, merged.events)).toEqual(
      retainAgentSubagentLifecycle(undefined, incoming),
    );
  });

  it("keeps interleaved, duplicate, and reordered ticks at one stable index per task", () => {
    const head: AgentTurnEvent[] = [
      background("a", "starting", { taskType: "agent" }),
      background("b", "starting", { taskType: "agent" }),
      ...tick("a", 1),
      toolCall(1),
      ...tick("b", 1),
      toolCall(2),
    ];
    const first = mergeTurnEvents([], head).events;
    const noisy = [...tick("b", 3), ...tick("a", 2), ...tick("a", 2), ...tick("b", 2), toolCall(3)];
    const second = mergeTurnEvents(first, noisy).events;
    expect(second).toHaveLength(first.length + 1);
    expect(second.map((event) => event.kind)).toEqual([
      ...first.map((event) => event.kind),
      "toolCall",
    ]);
    expect(second[2]).toMatchObject({ kind: "subagent", taskId: "a", toolUses: 2 });
    expect(second[5]).toMatchObject({ kind: "subagent", taskId: "b", toolUses: 2 });
  });

  it("keeps only the latest context occupancy and one capacity per model", () => {
    const incoming: AgentTurnEvent[] = [capacity(200_000), occupancy(100)];
    for (let step = 0; step < 200; step += 1)
      incoming.push(toolCall(step), occupancy(1_000 + step));
    incoming.push(capacity(1_000_000, "claude-other"), capacity(200_000));
    const merged = mergeTurnEvents([], incoming);
    expect(merged.events.filter((event) => event.kind === "contextUsage")).toEqual([
      capacity(200_000),
      occupancy(1_199),
      capacity(1_000_000, "claude-other"),
    ]);
    expect(agentContextWindow(threadWith(merged.events, merged.truncated))).toEqual(
      agentContextWindow(threadWith(incoming, false)),
    );
  });

  it("does not move fresh context usage in front of an invalidating event", () => {
    const incoming: AgentTurnEvent[] = [
      capacity(200_000),
      occupancy(150_000),
      { kind: "contextCompaction", beforeTokens: 150_000, afterTokens: 20_000 },
      capacity(200_000),
      occupancy(20_000),
    ];
    const merged = mergeTurnEvents([], incoming);
    expect(merged.events).toEqual(incoming);
    expect(agentContextWindow(threadWith(merged.events, false))).toEqual({
      usedTokens: 20_000,
      contextWindow: 200_000,
    });
  });

  it("keeps only the latest codex subagent usage per child thread", () => {
    const usage = (inputTokens: number) =>
      ({ inputTokens, outputTokens: 1, contextTokens: null }) as const;
    const incoming: AgentTurnEvent[] = [
      { kind: "subagentUsage", agentThreadId: "x", usage: usage(1) },
      { kind: "subagentUsage", agentThreadId: "y", usage: usage(2) },
      { kind: "subagentUsage", agentThreadId: "x", usage: usage(3) },
    ];
    expect(mergeTurnEvents([], incoming).events).toEqual([incoming[2], incoming[1]]);
  });

  it("resets codex usage supersession when the child thread id is reused after its turn ends", () => {
    const usage = (inputTokens: number) =>
      ({ inputTokens, outputTokens: 1, contextTokens: null }) as const;
    const incoming: AgentTurnEvent[] = [
      { kind: "subagentUsage", agentThreadId: "x", usage: usage(1) },
      { kind: "subagentUsage", agentThreadId: "x", usage: usage(2) },
      { kind: "subagentTurnDone", agentThreadId: "x", durationMs: 5, isError: false },
      { kind: "subagentUsage", agentThreadId: "x", usage: usage(3) },
      { kind: "subagentUsage", agentThreadId: "x", usage: usage(4) },
    ];
    expect(mergeTurnEvents([], incoming).events).toEqual([incoming[1], incoming[2], incoming[4]]);
  });

  it("regression: a buffer full of real content supersedes a known identity in place", () => {
    const content = Array.from({ length: MAX_AGENT_EVENTS_PER_TURN - 4 }, (_, index) =>
      toolCall(index),
    );
    const started = background("a", "starting", { taskType: "agent" });
    const full = mergeTurnEvents(
      [],
      [started, background("a", "running"), capacity(200_000), occupancy(5), ...content],
    );
    expect(full.truncated).toBe(false);
    expect(full.events).toHaveLength(MAX_AGENT_EVENTS_PER_TURN);

    const ticked = mergeTurnEvents(full.events, [
      background("a", "running", { description: "fresh" }),
      occupancy(7),
    ]);
    expect(ticked.truncated).toBe(false);
    expect(ticked.events).toHaveLength(MAX_AGENT_EVENTS_PER_TURN);
    expect(ticked.events.slice(0, 4)).toEqual([
      started,
      background("a", "running", { description: "fresh" }),
      capacity(200_000),
      occupancy(7),
    ]);
    expect(ticked.events.slice(4)).toEqual(content);
    expect(projectAgentBackgroundActivity(ticked.events, true, false).tasks).toEqual([
      { taskId: "a", taskType: "agent", description: "fresh" },
    ]);
    expect(agentContextWindow(threadWith(ticked.events, false))).toEqual({
      usedTokens: 7,
      contextWindow: 200_000,
    });
  });

  it("regression: a new identity arriving at a full buffer evicts the oldest event truthfully", () => {
    const content = Array.from({ length: MAX_AGENT_EVENTS_PER_TURN }, (_, index) =>
      toolCall(index),
    );
    const full = mergeTurnEvents([], content);
    const arrived = mergeTurnEvents(full.events, [background("new", "running"), occupancy(9)]);
    expect(arrived.truncated).toBe(true);
    expect(arrived.events).toEqual([
      ...content.slice(2),
      background("new", "running"),
      occupancy(9),
    ]);

    const ticked = mergeTurnEvents(arrived.events, [
      background("new", "running", { description: "still here" }),
      occupancy(11),
    ]);
    expect(ticked.truncated).toBe(false);
    expect(ticked.events.slice(-2)).toEqual([
      background("new", "running", { description: "still here" }),
      occupancy(11),
    ]);
  });

  it("regression P1-A: a terminal barrier never makes the absorbed snapshot silently evictable", () => {
    const raw: AgentTurnEvent[] = [
      { kind: "toolCall", toolId: "T", name: "Task", inputSummary: "explore" },
      {
        kind: "subagent",
        status: "running",
        toolId: "T",
        subagentType: "Explore",
        toolUses: 5,
        totalTokens: 900,
      },
      { kind: "subagent", status: "completed", toolId: "T" },
      { kind: "reasoning", text: "thinking" },
      ...Array.from({ length: MAX_AGENT_EVENTS_PER_TURN - 3 }, (_, index) => toolCall(index)),
    ];
    const merged = mergeTurnEvents([], raw);
    const lifecycle = retainAgentSubagentLifecycle(undefined, raw);
    expect(lifecycle?.entries[0]).toMatchObject({ steps: 5, totalTokens: 900 });
    expect(retainAgentSubagentLifecycle(undefined, merged.events)).not.toEqual(lifecycle);
    expect(merged.truncated).toBe(true);
    expect(merged).toEqual(legacyMergeTurnEvents([], raw, TURN_POLICY));
  });

  it("regression P1-A: one scope barrier does not demote every live subagent snapshot", () => {
    const policy = { ...TURN_POLICY, maxEvents: 5 };
    const head: AgentTurnEvent[] = [
      { kind: "subagent", status: "running", toolId: "a", subagentType: "Alpha", toolUses: 3 },
      { kind: "subagent", status: "running", toolId: "b", subagentType: "Beta", toolUses: 4 },
      { kind: "subagentActivity", agentThreadId: "c0", agentPath: "p", activity: "started" },
    ];
    const withinCap = retainAgentTurnEvents([], [...head, toolCall(1), toolCall(2)], policy);
    expect(withinCap).toEqual({ events: [...head, toolCall(1), toolCall(2)], truncated: false });

    const raw = [...head, toolCall(1), toolCall(2), toolCall(3), toolCall(4)];
    for (const size of [1, 2, 7]) {
      const merged = mergeInBatches(raw, size, policy);
      expect(merged.truncated).toBe(true);
      expect(merged.events).toEqual(legacyMergeTurnEvents([], raw, policy).events);
    }
  });

  it("regression: a full buffer keeps accepting subagent telemetry instead of dropping it", () => {
    const head: AgentTurnEvent[] = [
      { kind: "subagent", status: "starting", toolId: "t1", subagentType: "Explore" },
      { kind: "subagent", status: "running", toolId: "t1", toolUses: 3, totalTokens: 100 },
    ];
    const filler = Array.from({ length: MAX_AGENT_EVENTS_PER_TURN - 2 }, (_, i) => toolCall(i));
    const full = mergeTurnEvents([], [...head, ...filler]);
    const afterOneMore = mergeTurnEvents(full.events, [toolCall(9_000)]);
    expect(afterOneMore.truncated).toBe(true);
    expect(afterOneMore.events).toContainEqual(head[1]);
    const later = mergeTurnEvents(afterOneMore.events, [
      { kind: "subagent", status: "running", toolId: "t1", toolUses: 42, totalTokens: 9_000 },
    ]);
    expect(later.events).toContainEqual({
      kind: "subagent",
      status: "running",
      toolId: "t1",
      toolUses: 42,
      totalTokens: 9_000,
    });
    expect(retainAgentSubagentLifecycle(undefined, later.events)?.entries[0]).toMatchObject({
      steps: 42,
      totalTokens: 9_000,
    });
  });

  it("regression: a full buffer keeps the background description and the context meter fresh", () => {
    const head: AgentTurnEvent[] = [
      toolCall(-3),
      toolCall(-2),
      toolCall(-1),
      background("a", "starting", { taskType: "agent" }),
      background("a", "running", { taskType: "agent", description: "Indexing 40k files" }),
      capacity(200_000),
      occupancy(150_000),
    ];
    const filler = Array.from({ length: MAX_AGENT_EVENTS_PER_TURN - 5 }, (_, i) => toolCall(i));
    const full = mergeTurnEvents([], [...head, ...filler]);
    expect(full.truncated).toBe(true);
    expect(full.events[0]).toEqual(toolCall(-1));
    const fresh = mergeTurnEvents(full.events, [
      background("a", "running", { description: "Indexing 41k files" }),
      occupancy(190_000),
    ]);
    expect(fresh.truncated).toBe(false);
    expect(projectAgentBackgroundActivity(fresh.events, true, true).tasks).toEqual([
      { taskId: "a", taskType: "agent", description: "Indexing 41k files" },
    ]);
    expect(agentContextWindow(threadWith(fresh.events, false))).toEqual({
      usedTokens: 190_000,
      contextWindow: 200_000,
    });
  });

  it("evicts distinct snapshot identities oldest first and reports the loss", () => {
    const ticks = Array.from({ length: MAX_AGENT_EVENTS_PER_TURN + 3 }, (_, index) =>
      background(`task-${index}`, "running"),
    );
    const merged = mergeTurnEvents([], ticks);
    expect(merged.truncated).toBe(true);
    expect(merged.events).toEqual(ticks.slice(3));
  });

  it("never lets an accepted snapshot disappear while truncated stays false", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      let events: ReadonlyArray<AgentTurnEvent> = [];
      for (const event of hostileAgentTurnStream(seed, 150)) {
        const merged = retainAgentTurnEvents(events, [event], SMALL_POLICY);
        events = merged.events;
        if (!isAgentTurnSnapshotEvent(event) || merged.truncated) continue;
        const retained = events.some((candidate) => carriesSnapshot(candidate, event));
        expect(retained, `seed ${seed}: ${JSON.stringify(event)}`).toBe(true);
      }
    }
  });

  it("reports truncation for an oversized event", () => {
    const oversized: AgentTurnEvent = {
      kind: "unknownLine",
      stream: "stdout",
      raw: "r".repeat(MAX_AGENT_EVENT_BYTES_PER_TURN + 1),
      clipped: false,
    };
    expect(mergeTurnEvents([], [oversized])).toEqual({ events: [], truncated: true });
  });

  it("never evicts accepted user steering messages", () => {
    const steer: AgentTurnEvent = { kind: "userMessage", text: "please also fix lint" };
    const incoming = [steer, ...subagentScenario()];
    for (let index = 0; index < 600; index += 1) incoming.push(toolCall(10_000 + index));
    const merged = mergeTurnEvents([], incoming);
    expect(merged.truncated).toBe(true);
    expect(merged.events).toHaveLength(MAX_AGENT_EVENTS_PER_TURN);
    expect(merged.events[0]).toEqual(steer);
  });

  it.each([1, 2, 7, 71, 513])("merging in batches of %i equals one big batch", (size) => {
    const incoming = [...subagentScenario(), occupancy(1), capacity(10), occupancy(2)];
    for (let index = 0; index < 400; index += 1) incoming.push(toolCall(20_000 + index));
    const burst = mergeTurnEvents([], incoming);
    const batched = mergeInBatches(incoming, size, TURN_POLICY);
    expect(batched.events).toEqual(burst.events);
    expect(batched.truncated).toBe(burst.truncated);
  });
});

describe("supersession identity follows the consumers", () => {
  function parseClaude(lines: ReadonlyArray<Record<string, unknown>>): AgentTurnEvent[] {
    return lines.flatMap((line) => {
      const parsed = parseClaudeStreamJsonLine(JSON.stringify(line));
      return parsed.kind === "events" ? [...parsed.events] : [];
    });
  }

  const claudeTelemetry: ReadonlyArray<Record<string, unknown>> = [
    {
      type: "system",
      subtype: "task_started",
      tool_use_id: "toolu_01",
      task_id: "task_01",
      subagent_type: "Explore",
    },
    { type: "system", subtype: "task_progress", task_id: "task_01", usage: { tool_uses: 1 } },
    {
      type: "system",
      subtype: "task_notification",
      tool_use_id: "toolu_01",
      status: "running",
      usage: { tool_uses: 2, total_tokens: 100 },
    },
    {
      type: "system",
      subtype: "task_progress",
      task_id: "task_01",
      usage: { tool_uses: 7, total_tokens: 9_000 },
    },
  ];

  it("regression: aliased Claude task ids keep one slot holding the newest telemetry", () => {
    const raw = parseClaude(claudeTelemetry);
    const merged = mergeTurnEvents([], raw);
    expect(merged.truncated).toBe(false);
    expect(merged.events.filter((event) => event.kind === "subagent")).toEqual([
      {
        kind: "subagent",
        status: "starting",
        toolId: "toolu_01",
        taskId: "task_01",
        subagentType: "Explore",
      },
      {
        kind: "subagent",
        status: "running",
        toolId: "toolu_01",
        taskId: "task_01",
        toolUses: 7,
        totalTokens: 9_000,
      },
    ]);
    const entry = retainAgentSubagentLifecycle(undefined, merged.events)?.entries[0];
    expect(entry).toMatchObject({ steps: 7, totalTokens: 9_000 });
    expect(retainAgentSubagentLifecycle(undefined, merged.events)).toEqual(
      retainAgentSubagentLifecycle(undefined, raw),
    );
  });

  it("regression: conflicting task links stop supersession so lifecycle entries match", () => {
    const raw: AgentTurnEvent[] = [
      { kind: "subagent", status: "running", taskId: "task-2", toolId: "tool-0" },
      { kind: "subagent", status: "running", taskId: "task-2", toolId: "tool-1" },
      { kind: "toolCall", name: "Task", toolId: "tool-0", inputSummary: "" },
      { kind: "subagent", status: "running", taskId: "task-2", toolId: "tool-1" },
    ];
    const merged = mergeTurnEvents([], raw);
    expect(merged.events).toEqual(raw);
    expect(retainAgentSubagentLifecycle(undefined, merged.events)?.entries).toHaveLength(2);
    expect(retainAgentSubagentLifecycle(undefined, merged.events)).toEqual(
      retainAgentSubagentLifecycle(undefined, raw),
    );
  });

  it("appends a task-only tick once a later event links the task to a new tool id", () => {
    const raw: AgentTurnEvent[] = [
      { kind: "subagent", status: "running", taskId: "task-9", toolUses: 5 },
      { kind: "subagent", status: "running", taskId: "task-9", toolUses: 6 },
      { kind: "subagent", status: "running", toolId: "tool-9", taskId: "task-9" },
      { kind: "subagent", status: "running", toolId: "tool-9", totalTokens: 3 },
    ];
    const merged = mergeTurnEvents([], raw);
    expect(merged.events).toEqual([
      { kind: "subagent", status: "running", taskId: "task-9", toolUses: 6 },
      { kind: "subagent", status: "running", toolId: "tool-9", taskId: "task-9", totalTokens: 3 },
    ]);
    expect(retainAgentSubagentLifecycle(undefined, merged.events)).toEqual(
      retainAgentSubagentLifecycle(undefined, raw),
    );
  });

  it("does not supersede across a spawn tool call or result of the same tool id", () => {
    const raw: AgentTurnEvent[] = [
      { kind: "subagent", status: "running", toolId: "tool-a", toolUses: 1 },
      { kind: "toolCall", toolId: "tool-a", name: "Task", inputSummary: "explore" },
      { kind: "subagent", status: "running", toolId: "tool-a", subagentType: "Explore" },
      { kind: "toolResult", toolId: "tool-a", outputSummary: "ok", isError: false },
      { kind: "subagent", status: "running", toolId: "tool-a", toolUses: 2 },
    ];
    expect(mergeTurnEvents([], raw).events).toEqual(raw);
  });

  it("does not supersede across codex child activity that prunes spawn acknowledgements", () => {
    const raw: AgentTurnEvent[] = [
      { kind: "toolCall", toolId: "tool-1", name: "spawn_agent", inputSummary: "delegate" },
      { kind: "subagent", status: "running", toolId: "tool-1", toolUses: 1 },
      { kind: "subagentActivity", agentThreadId: "c0", agentPath: "worker", activity: "started" },
      { kind: "subagent", status: "running", toolId: "tool-1", subagentType: "Explore" },
    ];
    const merged = mergeTurnEvents([], raw);
    expect(merged.events).toEqual(raw);
    expect(retainAgentSubagentLifecycle(undefined, merged.events)).toEqual(
      retainAgentSubagentLifecycle(undefined, raw),
    );
  });

  it("regression: a superseded tick never glues two separate assistant messages together", () => {
    const raw: AgentTurnEvent[] = [
      { kind: "assistantText", text: "First message." },
      occupancy(10),
      { kind: "assistantText", text: "Second message." },
      occupancy(20),
      { kind: "assistantText", text: "Third message." },
    ];
    const texts = (events: ReadonlyArray<AgentTurnEvent>) =>
      events.flatMap((event) => (event.kind === "assistantText" ? [event.text] : []));
    const expected = ["First message.", "Second message.", "Third message."];
    expect(texts(mergeTurnEvents([], raw).events)).toEqual(expected);
    expect(texts(mergeInBatches(raw, 1, TURN_POLICY).events)).toEqual(expected);
  });

  it("appends a tick behind a text tail instead of superseding and reports the eviction it causes", () => {
    const policy = { ...SMALL_POLICY, maxEvents: 4, maxBytes: 100_000 };
    const raw: AgentTurnEvent[] = [
      { kind: "assistantText", text: "one" },
      occupancy(10),
      { kind: "assistantText", text: "two" },
      occupancy(20),
      toolCall(1),
    ];
    const merged = retainAgentTurnEvents([], raw, policy);
    expect(merged).toEqual({ events: raw.slice(1), truncated: true });
    expect(capAgentTurnEvents(merged.events, policy).events).toEqual(merged.events);

    const unseparated = retainAgentTurnEvents([], [toolCall(0), ...raw.slice(1)], policy);
    expect(unseparated).toEqual({ events: raw.slice(1), truncated: true });
  });

  it("never leaves two coalescible texts adjacent after evictions under tiny caps", () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const raw = [...realisticAgentTurnStream(seed, 120), ...hostileAgentTurnStream(seed, 120)];
      const merged = mergeInBatches(raw, 1 + (seed % 5), SMALL_POLICY);
      const capped = capAgentTurnEvents(merged.events, SMALL_POLICY);
      expect(capped.events, `seed ${seed}`).toEqual(merged.events);
    }
  });

  it.each([1, 2, 3, 4, 5, 6])(
    "projects the same domain consumers as the raw stream for realistic seed block %i",
    (block) => {
      const divergences: string[] = [];
      for (let seed = block * 1_000; seed < block * 1_000 + 400; seed += 1) {
        const raw = realisticAgentTurnStream(seed, 20 + (seed % 90));
        const legacy = legacyMergeTurnEvents([], raw, TURN_POLICY);
        const merged = mergeInBatches(raw, 1 + (seed % 7), TURN_POLICY);
        expect(legacy.truncated).toBe(false);
        expect(merged.truncated).toBe(false);
        if (domainProjection(merged.events) !== domainProjection(legacy.events))
          divergences.push(`seed ${seed}`);
      }
      expect(divergences).toEqual([]);
    },
  );

  it("projects the same domain consumers as the raw stream for hostile id shapes", () => {
    const divergences: string[] = [];
    for (let seed = 1; seed <= 3_000; seed += 1) {
      const raw = hostileAgentTurnStream(seed, 40);
      const legacy = legacyMergeTurnEvents([], raw, TURN_POLICY);
      const merged = mergeTurnEvents([], raw);
      if (domainProjection(merged.events) !== domainProjection(legacy.events))
        divergences.push(`seed ${seed}`);
    }
    expect(divergences).toEqual([]);
  });

  function domainProjection(events: ReadonlyArray<AgentTurnEvent>): string {
    return canonicalJson({
      background: projectAgentBackgroundActivity(events, true, false),
      lifecycle: retainAgentSubagentLifecycle(undefined, events),
      context: agentContextWindow(threadWith(events, false)),
      content: events.filter((event) => !isAgentTurnSnapshotEvent(event)),
    });
  }
});

describe("capped streams against the uncapped ground truth", () => {
  const BATCH_SIZES = [1, 7, 64] as const;

  function longStream(seed: number): AgentTurnEvent[] {
    const length = 600 + ((seed * 37) % 1_400);
    if (seed % 2 === 0) return realisticAgentTurnStream(seed, length);
    return longRunningAgentTurnStream(seed, length);
  }

  function groundTruth(raw: ReadonlyArray<AgentTurnEvent>): ReadonlyArray<AgentTurnEvent> {
    return legacyMergeTurnEvents([], raw, { ...TURN_POLICY, ...UNBOUNDED }).events;
  }

  function projection(events: ReadonlyArray<AgentTurnEvent>): string {
    return canonicalJson({
      background: projectAgentBackgroundActivity(events, true, false),
      lifecycle: retainAgentSubagentLifecycle(undefined, events),
      context: agentContextWindow(threadWith(events, false)),
      content: events.filter((event) => !isAgentTurnSnapshotEvent(event)),
    });
  }

  it.each([0, 1, 2, 3, 4, 5])(
    "never diverges from the raw stream while truncated stays false for seed block %i",
    { timeout: 120_000 },
    (block) => {
      const divergences: string[] = [];
      for (let seed = block * 50 + 1; seed <= block * 50 + 50; seed += 1) {
        const raw = longStream(seed);
        const truth = projection(groundTruth(raw));
        for (const size of BATCH_SIZES) {
          const merged = mergeInBatches(raw, size, TURN_POLICY);
          expect(merged.events.length).toBeLessThanOrEqual(MAX_AGENT_EVENTS_PER_TURN);
          if (merged.truncated) continue;
          if (projection(merged.events) !== truth) divergences.push(`seed ${seed} size ${size}`);
        }
      }
      expect(divergences).toEqual([]);
    },
  );

  it("covers untruncated streams well past the event cap and truncated ones", () => {
    let untruncated = 0;
    let truncated = 0;
    let longestUntruncated = 0;
    for (let seed = 1; seed <= 300; seed += 1) {
      const raw = longStream(seed);
      const merged = mergeInBatches(raw, 64, TURN_POLICY);
      if (merged.truncated) {
        truncated += 1;
        continue;
      }
      untruncated += 1;
      longestUntruncated = Math.max(longestUntruncated, groundTruth(raw).length);
    }
    expect(untruncated).toBeGreaterThanOrEqual(60);
    expect(truncated).toBeGreaterThanOrEqual(60);
    expect(longestUntruncated).toBeGreaterThan(MAX_AGENT_EVENTS_PER_TURN * 2);
  });

  it("reports truncation whenever the capped projection differs from the raw stream", () => {
    const silent: string[] = [];
    for (let seed = 1; seed <= 300; seed += 1) {
      const raw = [...hostileAgentTurnStream(seed, 80), ...realisticAgentTurnStream(seed, 80)];
      const truth = projection(groundTruth(raw));
      const merged = mergeInBatches(raw, 1 + (seed % 9), SMALL_POLICY);
      if (!merged.truncated && projection(merged.events) !== truth) silent.push(`seed ${seed}`);
    }
    expect(silent).toEqual([]);
  });
});

describe("persisted turns are capped without supersession", () => {
  it("returns a legacy turn with 200 raw ticks unchanged", () => {
    const events = subagentScenario().slice(0, 6 + 200);
    const capped = capPersistedTurnEvents(events);
    expect(capped.events).toEqual(events);
    expect(capped.truncated).toBe(false);
    expect(capped.events.map((event, index) => event === events[index])).not.toContain(false);
  });

  it("matches the pre-supersession algorithm event for event on oversized legacy turns", () => {
    const events = subagentScenario();
    const legacy = legacyMergeTurnEvents([], events, TURN_POLICY);
    const capped = capPersistedTurnEvents(events);
    expect(legacy.truncated).toBe(true);
    expect(capped.truncated).toBe(legacy.truncated);
    expect(capped.events).toEqual(legacy.events);
  });

  it.each([1, 2, 3])(
    "matches the pre-supersession algorithm under tiny caps for block %i",
    (block) => {
      for (let seed = block * 100; seed < block * 100 + 100; seed += 1) {
        const events = [
          ...hostileAgentTurnStream(seed, 120),
          ...realisticAgentTurnStream(seed, 120),
        ];
        expect(capAgentTurnEvents(events, SMALL_POLICY)).toEqual(
          legacyMergeTurnEvents([], events, SMALL_POLICY),
        );
      }
    },
  );

  it("leaves arrays produced by the live path untouched", () => {
    const live = mergeTurnEvents([], subagentScenario());
    expect(capPersistedTurnEvents(live.events).events).toEqual(live.events);
  });
});

describe("retention invariants", () => {
  it("never reports truncated=false while real content is lost", () => {
    const problems: string[] = [];
    for (let seed = 1; seed <= 500; seed += 1) {
      const raw = hostileAgentTurnStream(seed, 120);
      const merged = mergeInBatches(raw, 7, SMALL_POLICY);
      if (merged.truncated) continue;
      const realRaw = legacyMergeTurnEvents([], raw, { ...SMALL_POLICY, ...UNBOUNDED }).events;
      const kept = merged.events.filter((event) => !isAgentTurnSnapshotEvent(event)).length;
      const expected = realRaw.filter((event) => !isAgentTurnSnapshotEvent(event)).length;
      if (kept < expected) problems.push(`seed ${seed}: kept ${kept}/${expected}`);
    }
    expect(problems).toEqual([]);
  });

  it("stays byte-exact and within caps across incremental merges", () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const raw = [...hostileAgentTurnStream(seed, 100), ...realisticAgentTurnStream(seed, 100)];
      let events: ReadonlyArray<AgentTurnEvent> = [];
      for (let index = 0; index < raw.length; index += 3) {
        events = retainAgentTurnEvents(events, raw.slice(index, index + 3), SMALL_POLICY).events;
        expect(events.length).toBeLessThanOrEqual(SMALL_POLICY.maxEvents);
        expect(recountBytes(events)).toBeLessThanOrEqual(SMALL_POLICY.maxBytes);
      }
    }
  });

  it.each<
    [string, (seed: number, length: number) => AgentTurnEvent[], AgentTurnEventRetentionPolicy]
  >([
    ["realistic streams under tiny caps", realisticAgentTurnStream, SMALL_POLICY],
    ["hostile id shapes under tiny caps", hostileAgentTurnStream, SMALL_POLICY],
    ["hostile id shapes under the real caps", hostileAgentTurnStream, TURN_POLICY],
  ])("matches one-shot merging in any batch size for %s", (_label, stream, policy) => {
    const mismatches: string[] = [];
    for (let seed = 1; seed <= 300; seed += 1) {
      const raw = stream(seed, 150);
      const burst = retainAgentTurnEvents([], raw, policy);
      for (const size of [1, 2, 5, 11, 37]) {
        const batched = mergeInBatches(raw, size, policy);
        if (canonicalJson(batched) !== canonicalJson(burst))
          mismatches.push(`seed ${seed} size ${size}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("returns the same array identity for empty incoming", () => {
    const existing: ReadonlyArray<AgentTurnEvent> = [toolCall(1)];
    expect(mergeTurnEvents(existing, []).events).toBe(existing);
  });

  it("tolerates existing arrays that already contain duplicate snapshots", () => {
    const existing = [background("a", "running"), background("a", "running")];
    const merged = mergeTurnEvents(existing, [background("a", "running", { description: "x" })]);
    expect(merged.events).toEqual([
      background("a", "running"),
      background("a", "running", { description: "x" }),
    ]);
    expect(merged.truncated).toBe(false);
  });

  it.each<[string, Partial<AgentTurnEventRetentionPolicy>]>([
    ["no event budget", { maxEvents: 0 }],
    ["negative byte budget", { maxBytes: -1 }],
    ["no subagent thread budget", { maxSubagentThreads: -1 }],
    ["non-numeric sizes", { eventBytes: () => Number.NaN }],
    ["negative sizes", { eventBytes: () => -5 }],
  ])("terminates under a hostile policy with %s", (_label, override) => {
    let steps = 0;
    const raw = [...hostileAgentTurnStream(7, 400), ...realisticAgentTurnStream(7, 400)];
    const merged = retainAgentTurnEvents(raw.slice(0, 50), raw.slice(50), {
      ...SMALL_POLICY,
      ...override,
      probe: { step: () => (steps += 1) },
    });
    expect(merged.events.length).toBeLessThanOrEqual(raw.length);
    expect(steps).toBeLessThanOrEqual(raw.length * 8);
  });

  function countedSteps(
    retain: typeof retainAgentTurnEvents,
    existing: ReadonlyArray<AgentTurnEvent>,
    incoming: ReadonlyArray<AgentTurnEvent>,
    policy: AgentTurnEventRetentionPolicy,
  ): { readonly steps: number; readonly merged: AgentTurnEventRetentionResult } {
    let steps = 0;
    const merged = retain(existing, incoming, { ...policy, probe: { step: () => (steps += 1) } });
    return { steps, merged };
  }

  function churn(count: number): AgentTurnEvent[] {
    return Array.from({ length: count }, (_, index): AgentTurnEvent => {
      if (index < 400) return { kind: "userMessage", text: `steer ${index}` };
      if (index % 4 === 0) return toolCall(index);
      if (index % 4 === 1) return background(`t${index % 5}`, "running");
      if (index % 4 === 2) return subagent(`s${index % 7}`, "running", { toolUses: index });
      return { kind: "subagent", status: "running", taskId: `s${index % 7}`, toolUses: index };
    });
  }

  it("does linear work for one 20k batch and the guard rejects a quadratic scan", () => {
    const budget = (count: number): number => count * 8;
    const linear = countedSteps(retainAgentTurnEvents, [], churn(20_000), TURN_POLICY);
    expect(linear.merged.events).toHaveLength(MAX_AGENT_EVENTS_PER_TURN);
    expect(linear.steps).toBeLessThanOrEqual(budget(20_000));
    expect(linear.steps).toBeLessThanOrEqual(
      countedSteps(retainAgentTurnEvents, [], churn(2_000), TURN_POLICY).steps * 11,
    );

    const quadratic = countedSteps(legacyMergeTurnEvents, [], churn(20_000), TURN_POLICY);
    expect(quadratic.merged.events).toHaveLength(MAX_AGENT_EVENTS_PER_TURN);
    expect(quadratic.steps).toBeGreaterThan(budget(20_000));
  });

  it("does bounded work per incremental merge and the guard rejects a history replay", () => {
    const incrementalSteps = (
      retain: typeof retainAgentTurnEvents,
      count: number,
    ): { readonly total: number; readonly worst: number } => {
      let events: ReadonlyArray<AgentTurnEvent> = [];
      let total = 0;
      let worst = 0;
      for (const event of churn(count)) {
        const counted = countedSteps(retain, events, [event], TURN_POLICY);
        events = counted.merged.events;
        total += counted.steps;
        worst = Math.max(worst, counted.steps);
      }
      return { total, worst };
    };
    const perMergeBudget = (MAX_AGENT_EVENTS_PER_TURN + 1) * 3;
    const bounded = incrementalSteps(retainAgentTurnEvents, 4_000);
    expect(bounded.worst).toBeLessThanOrEqual(perMergeBudget);
    expect(bounded.total).toBeLessThanOrEqual(4_000 * perMergeBudget);

    const replaysHistory: typeof retainAgentTurnEvents = (existing, incoming, policy) =>
      retainAgentTurnEvents(existing, incoming, { ...policy, ...UNBOUNDED });
    const unbounded = incrementalSteps(replaysHistory, 8_000);
    expect(unbounded.worst).toBeGreaterThan(perMergeBudget * 2);
    expect(unbounded.total).toBeGreaterThan(8_000 * perMergeBudget);
  });
});
