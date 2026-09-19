import { describe, expect, it } from "vitest";
import {
  reconcileAgentRuntimeSubagents,
  summarizeAgentRuntimeSubagents,
} from "../../domain/agentRuntimeSubagent";
import {
  retainAgentSubagentLifecycle,
  type AgentSubagentLifecycle,
} from "../../domain/agentSubagentLifecycle";
import type { AgentTurn, AgentTurnEvent } from "../../domain/agentThread";
import {
  agentRuntimeSubagentActivityLine,
  agentRuntimeSubagentMetricsLabel,
  agentSpawnBatchOrigin,
  agentSpawnLeadLabel,
  agentSpawnStatusLabel,
  agentTurnRuntimeSubagents,
} from "./agentRuntimeSubagentPresentation";

const TASK_TITLES = [
  "Fix subagent view findings",
  "TS artifact slice review fixes",
  "Rust artifact locate and preview",
  "Audit repository lookup wire",
];

const spawn = (index: number, parentToolId?: string): AgentTurnEvent => ({
  kind: "toolCall",
  toolId: `toolu_${index}`,
  name: "Agent",
  inputSummary: TASK_TITLES[index] ?? `Task ${index}`,
  description: TASK_TITLES[index] ?? `Task ${index}`,
  ...(parentToolId === undefined ? {} : { parentToolId }),
});

const starting = (index: number): AgentTurnEvent => ({
  kind: "subagent",
  status: "starting",
  toolId: `toolu_${index}`,
  taskId: `task_${index}`,
  subagentType: "general-purpose",
  description: TASK_TITLES[index] ?? `Task ${index}`,
});

const launched = (index: number): AgentTurnEvent => ({
  kind: "toolResult",
  toolId: `toolu_${index}`,
  outputSummary: "Async agent launched successfully.",
  isError: false,
});

const progress = (index: number, description: string): AgentTurnEvent => ({
  kind: "subagent",
  status: "running",
  toolId: `toolu_${index}`,
  taskId: `task_${index}`,
  subagentType: "general-purpose",
  description,
  durationMs: 549_205,
  totalTokens: 177_003,
  toolUses: 63,
  lastToolName: "Bash",
});

function retain(chunks: ReadonlyArray<ReadonlyArray<AgentTurnEvent>>) {
  let lifecycle: AgentSubagentLifecycle | undefined;
  for (const chunk of chunks) lifecycle = retainAgentSubagentLifecycle(lifecycle, chunk);
  return lifecycle;
}

function legacyEntry(index: number, description: string) {
  return {
    description,
    durationMs: 654_474,
    id: `tool:toolu_${index}`,
    lastToolName: "Bash",
    name: "general-purpose",
    resultState: "completed",
    state: "completed",
    steps: 35,
    taskId: `task_${index}`,
    telemetryState: "completed",
    toolId: `toolu_${index}`,
    totalTokens: 136_996,
  } as const;
}

describe("subagent rows after the spawn call left the bounded event window", () => {
  const chunks: ReadonlyArray<ReadonlyArray<AgentTurnEvent>> = [
    [spawn(0), spawn(1)],
    [starting(0), starting(1), launched(0), launched(1)],
    [spawn(2), starting(2), launched(2)],
    [progress(0, "Running npx vitest run"), progress(1, "Reading src/domain/example.ts")],
    [progress(2, "Running git diff --check")],
  ];
  const lifecycle = retain(chunks);
  const evictedWindow = chunks.slice(3).flat();

  it("keeps every task title distinct instead of collapsing to the role name", () => {
    const result = agentTurnRuntimeSubagents({
      events: evictedWindow,
      status: { kind: "running" },
      subagentLifecycle: lifecycle,
    });

    expect(result.agents.map((agent) => [agent.title, agent.role, agent.titleKnown])).toEqual([
      [TASK_TITLES[0], "general-purpose", true],
      [TASK_TITLES[1], "general-purpose", true],
      [TASK_TITLES[2], "general-purpose", true],
    ]);
    expect(result.agents[0]?.activity).toBe("Running npx vitest run");
  });

  it("keeps batch membership identical before and after eviction", () => {
    const before = agentTurnRuntimeSubagents({
      events: chunks.flat(),
      status: { kind: "running" },
      subagentLifecycle: lifecycle,
    });
    const after = agentTurnRuntimeSubagents({
      events: evictedWindow,
      status: { kind: "running" },
      subagentLifecycle: lifecycle,
    });
    const shape = (result: typeof before) =>
      result.batches.map((batch) => [batch.id, batch.agents.map((agent) => agent.id)]);

    expect(shape(before)).toEqual([
      ["spawn:toolu_0", ["tool:toolu_0", "tool:toolu_1"]],
      ["spawn:toolu_2", ["tool:toolu_2"]],
    ]);
    expect(shape(after)).toEqual(shape(before));
  });
});

describe("legacy persisted lifecycles without a retained title or batch key", () => {
  const subagentLifecycle: AgentSubagentLifecycle = {
    entries: [
      legacyEntry(0, "Running grep -n export src/domain/example.ts"),
      legacyEntry(1, "Running Final file list"),
      { ...legacyEntry(2, ""), lastToolName: undefined },
    ],
    truncated: false,
  };
  const result = agentTurnRuntimeSubagents({
    events: [],
    status: { kind: "exited", exitCode: 0 },
    subagentLifecycle,
  });

  it("shows the role truthfully as a role and says the task is unknown only as a last resort", () => {
    expect(result.agents.map((agent) => [agent.title, agent.role, agent.titleKnown])).toEqual([
      ["general-purpose", "general-purpose", false],
      ["general-purpose", "general-purpose", false],
      ["general-purpose", "general-purpose", false],
    ]);
    expect(result.agents.map(agentRuntimeSubagentActivityLine)).toEqual([
      "Running grep -n export src/domain/example.ts",
      "Running Final file list",
      "task unknown",
    ]);
  });

  it("collects the keyless entries of a settled turn into one legacy batch", () => {
    expect(result.batches.map((batch) => batch.id)).toEqual(["legacy"]);
    expect(result.batches[0]?.agents.map((agent) => agent.id)).toEqual([
      "tool:toolu_0",
      "tool:toolu_1",
      "tool:toolu_2",
    ]);
  });
});

describe("keyless per-entry batches across the settle boundary", () => {
  const settled = { kind: "exited", exitCode: 0 } as const;
  const subagentLifecycle: AgentSubagentLifecycle = {
    entries: [legacyEntry(0, "Ran job 0"), legacyEntry(1, "Ran job 1")],
    truncated: false,
  };
  const project = (status: AgentTurn["status"]) =>
    agentTurnRuntimeSubagents({ events: [], status, subagentLifecycle });

  it("keeps the rows a running turn presented once that turn settles", () => {
    const running = project({ kind: "running" });
    expect(running.batches.map((batch) => batch.id)).toEqual([
      "entry:tool:toolu_0",
      "entry:tool:toolu_1",
    ]);

    const reconciled = reconcileAgentRuntimeSubagents(running, project(settled));

    expect(reconciled.batches.map((batch) => batch.id)).toEqual([
      "entry:tool:toolu_0",
      "entry:tool:toolu_1",
    ]);
    expect(reconciled.agents.map((agent) => agent.batchId)).toEqual([
      "entry:tool:toolu_0",
      "entry:tool:toolu_1",
    ]);
  });

  it("buckets a turn first seen settled into one legacy batch", () => {
    expect(
      reconcileAgentRuntimeSubagents(null, project(settled)).batches.map((batch) => batch.id),
    ).toEqual(["legacy"]);
  });
});

describe("legacy keyless batching", () => {
  const settled = { kind: "exited", exitCode: 0 } as const;
  const legacyLifecycle = (count: number): AgentSubagentLifecycle => ({
    entries: Array.from({ length: count }, (_, index) => legacyEntry(index, `Ran job ${index}`)),
    truncated: false,
  });

  it("buckets a 26 entry legacy turn into one stable batch in entry order", () => {
    const subagentLifecycle = legacyLifecycle(26);
    const project = () =>
      agentTurnRuntimeSubagents({ events: [], status: settled, subagentLifecycle });
    const first = project();
    const second = project();

    expect(first.batches).toHaveLength(1);
    expect(first.batches[0]?.id).toBe("legacy");
    expect(first.batches[0]?.agents.map((agent) => agent.id)).toEqual(
      Array.from({ length: 26 }, (_, index) => `tool:toolu_${index}`),
    );
    expect(second.batches.map((batch) => batch.id)).toEqual(first.batches.map((batch) => batch.id));
    expect(agentSpawnLeadLabel(summarizeAgentRuntimeSubagents(first.agents), "legacy")).toBe(
      "Ran 26 subagents",
    );
  });

  it("keeps retained batches untouched and adds a single legacy batch for a mixed turn", () => {
    const subagentLifecycle: AgentSubagentLifecycle = {
      entries: [
        { ...legacyEntry(0, "Keyed first"), batchKey: "spawn:toolu_0" },
        legacyEntry(1, "Keyless one"),
        { ...legacyEntry(2, "Keyed second"), batchKey: "spawn:toolu_0" },
        legacyEntry(3, "Keyless two"),
      ],
      truncated: false,
    };
    const result = agentTurnRuntimeSubagents({ events: [], status: settled, subagentLifecycle });

    expect(
      result.batches.map((batch) => [batch.id, batch.agents.map((agent) => agent.id)]),
    ).toEqual([
      ["spawn:toolu_0", ["tool:toolu_0", "tool:toolu_2"]],
      ["legacy", ["tool:toolu_1", "tool:toolu_3"]],
    ]);
  });

  it("keeps a running turn's keyless entry in its own batch so a late key cannot reshuffle it", () => {
    const events: ReadonlyArray<AgentTurnEvent> = [starting(0), starting(1)];
    const subagentLifecycle = retainAgentSubagentLifecycle(undefined, events);
    const running = agentTurnRuntimeSubagents({
      events,
      status: { kind: "running" },
      subagentLifecycle,
    });

    expect(subagentLifecycle?.entries.every((entry) => entry.batchKey === undefined)).toBe(true);
    expect(running.batches.map((batch) => batch.id)).toEqual([
      "entry:tool:toolu_0",
      "entry:tool:toolu_1",
    ]);
  });

  it("never claims a parallel launch for a legacy batch that still looks live", () => {
    const live = summarizeAgentRuntimeSubagents([{ status: "working" }, { status: "completed" }]);

    expect(agentSpawnLeadLabel(live, "legacy")).toBe("2 earlier subagents");
    expect(agentSpawnLeadLabel(live, "spawn")).toBe("Kicked off 2 subagents");
    expect(agentSpawnBatchOrigin("legacy")).toBe("legacy");
    expect(agentSpawnBatchOrigin("turn")).toBe("codexTurn");
    expect(agentSpawnBatchOrigin("spawn:toolu_0")).toBe("spawn");
  });
});

describe("nested agents and truncation", () => {
  it("keeps nested agents out of the list and counts them on the parent row", () => {
    const events = [spawn(0), starting(0), spawn(1, "toolu_0"), starting(1), spawn(3, "toolu_0")];
    const result = agentTurnRuntimeSubagents({
      events,
      status: { kind: "running" },
      subagentLifecycle: retainAgentSubagentLifecycle(undefined, events),
    });

    expect(result.agents.map((agent) => agent.id)).toEqual(["tool:toolu_0"]);
    expect(result.agents[0]?.nestedAgents).toBe(2);
    expect(result.truncated).toBe(false);
    expect(agentRuntimeSubagentMetricsLabel(result.agents[0]!)).toBe("— tok · +2 nested agents");
  });

  it("never lets truncation change a batch status or lead", () => {
    const events = Array.from({ length: 40 }, (_, index) => spawn(index));
    const running = agentTurnRuntimeSubagents({
      events,
      status: { kind: "running" },
      subagentLifecycle: retainAgentSubagentLifecycle(undefined, events),
    });
    const completed = running.agents.map(() => ({ status: "completed" as const }));

    expect(running.truncated).toBe(true);
    expect(agentSpawnLeadLabel(summarizeAgentRuntimeSubagents(completed), "spawn")).toBe(
      "Ran 32 subagents",
    );
    expect(agentSpawnStatusLabel(summarizeAgentRuntimeSubagents(completed))).toBe("✓ completed");
  });

  it("shows only the working count while a batch is live and the breakdown once settled", () => {
    const live = summarizeAgentRuntimeSubagents([
      { status: "working" },
      { status: "working" },
      { status: "completed" },
      { status: "failed" },
    ]);
    const settled = summarizeAgentRuntimeSubagents([{ status: "completed" }, { status: "failed" }]);

    expect(agentSpawnStatusLabel(live)).toBe("2 working");
    expect(agentSpawnStatusLabel(settled)).toBe("1 failed");
  });
});
