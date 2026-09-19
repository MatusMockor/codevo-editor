import { describe, expect, it } from "vitest";
import {
  MAX_RUNTIME_SUBAGENTS,
  MAX_RUNTIME_SUBAGENT_ACTIVITY_CHARACTERS,
  MAX_RUNTIME_SUBAGENT_TITLE_CHARACTERS,
  RUNTIME_SUBAGENT_ENTRY_BATCH_PREFIX,
  RUNTIME_SUBAGENT_LEGACY_BATCH_ID,
  agentRuntimeSubagentStatus,
  latestLiveAgentRuntimeSubagent,
  projectAgentRuntimeSubagents,
  reconcileAgentRuntimeSubagents,
  summarizeAgentRuntimeSubagents,
  type AgentRuntimeSubagentSource,
  type AgentRuntimeSubagentStatus,
} from "./agentRuntimeSubagent";

function source(overrides: Partial<AgentRuntimeSubagentSource> = {}): AgentRuntimeSubagentSource {
  return {
    id: "tool:a",
    batchId: "spawn:a",
    observedState: "running",
    resumable: false,
    activityOrder: 0,
    ...overrides,
  };
}

describe("agentRuntimeSubagentStatus", () => {
  it.each([
    ["running", false, "working"],
    ["running", true, "working"],
    ["completed", false, "completed"],
    ["completed", true, "idle"],
    ["failed", true, "failed"],
    ["interrupted", false, "stopped"],
    ["unknown", false, "unknown"],
  ] as const)("maps %s (resumable %s) to %s", (observed, resumable, expected) => {
    expect(agentRuntimeSubagentStatus(observed, resumable)).toBe(expected);
  });
});

describe("projectAgentRuntimeSubagents", () => {
  it("titles by task description and only keeps a role chip that differs from the title", () => {
    const [titled, same] = projectAgentRuntimeSubagents(
      [
        source({ id: "a", title: "Audit retention", role: "general-purpose" }),
        source({ id: "c", title: "Reviewer", role: "reviewer" }),
      ],
      false,
    ).agents;

    expect(titled).toMatchObject({
      title: "Audit retention",
      role: "general-purpose",
      titleKnown: true,
    });
    expect(same).toMatchObject({ title: "Reviewer", role: null, titleKnown: true });
  });

  it("never presents a role as the task title when the task is unknown", () => {
    const [untitled] = projectAgentRuntimeSubagents(
      [source({ id: "b", role: "general-purpose" })],
      false,
    ).agents;

    expect(untitled).toMatchObject({
      title: "general-purpose",
      role: "general-purpose",
      titleKnown: false,
    });
  });

  it("carries a bounded nested agent count", () => {
    const [plain, nested] = projectAgentRuntimeSubagents(
      [source({ id: "a" }), source({ id: "b", nestedCount: 3 })],
      false,
    ).agents;

    expect(plain?.nestedAgents).toBe(0);
    expect(nested?.nestedAgents).toBe(3);
  });

  it("falls back to a neutral title when nothing is known", () => {
    expect(projectAgentRuntimeSubagents([source()], false).agents[0]?.title).toBe("Subagent");
  });

  it("prefers progress while live and the outcome once settled", () => {
    const fields = { progress: "Reading a.ts", lastToolName: "Read", outcome: "All good" };
    const [live, settled, toolOnly, silent] = projectAgentRuntimeSubagents(
      [
        source({ id: "a", ...fields }),
        source({ id: "b", observedState: "completed", ...fields }),
        source({ id: "c", lastToolName: "Bash" }),
        source({ id: "d", progress: "   " }),
      ],
      false,
    ).agents;

    expect(live?.activity).toBe("Reading a.ts");
    expect(settled?.activity).toBe("All good");
    expect(toolOnly?.activity).toBe("▸ Bash");
    expect(silent?.activity).toBeNull();
  });

  it("models elapsed time as a closed union", () => {
    const [live, settled, unknown] = projectAgentRuntimeSubagents(
      [
        source({ id: "a", durationMs: 1_000 }),
        source({ id: "b", observedState: "failed", durationMs: 2_000 }),
        source({ id: "c" }),
      ],
      false,
    ).agents;

    expect(live?.elapsed).toEqual({ kind: "live", observedDurationMs: 1_000 });
    expect(settled?.elapsed).toEqual({ kind: "settled", durationMs: 2_000 });
    expect(unknown?.elapsed).toEqual({ kind: "unknown" });
  });

  it("bounds titles and activity with truthful truncation", () => {
    const agent = projectAgentRuntimeSubagents(
      [
        source({
          title: "t".repeat(MAX_RUNTIME_SUBAGENT_TITLE_CHARACTERS + 50),
          progress: "😀".repeat(MAX_RUNTIME_SUBAGENT_ACTIVITY_CHARACTERS + 5),
        }),
      ],
      false,
    ).agents[0];

    expect([...(agent?.title ?? "")]).toHaveLength(MAX_RUNTIME_SUBAGENT_TITLE_CHARACTERS);
    expect(agent?.title.endsWith("…")).toBe(true);
    expect([...(agent?.activity ?? "")]).toHaveLength(MAX_RUNTIME_SUBAGENT_ACTIVITY_CHARACTERS);
    expect(agent?.activityTruncated).toBe(true);
  });

  it("caps the number of agents, drops duplicate ids and keeps truncation off the batches", () => {
    const sources = Array.from({ length: MAX_RUNTIME_SUBAGENTS + 4 }, (_, index) =>
      source({ id: `agent-${index}`, batchId: index < 2 ? "spawn:first" : "spawn:second" }),
    );
    const result = projectAgentRuntimeSubagents([source({ id: "agent-0" }), ...sources], false);

    expect(result.agents).toHaveLength(MAX_RUNTIME_SUBAGENTS);
    expect(result.truncated).toBe(true);
    expect(result.batches.map((batch) => batch.id)).toEqual([
      "spawn:a",
      "spawn:first",
      "spawn:second",
    ]);
    for (const batch of result.batches) expect(batch).not.toHaveProperty("truncated");
  });

  it("keeps batches in spawn order", () => {
    const result = projectAgentRuntimeSubagents(
      [
        source({ id: "a", batchId: "one" }),
        source({ id: "b", batchId: "two" }),
        source({ id: "c", batchId: "one" }),
      ],
      false,
    );

    expect(result.batches.map((batch) => batch.agents.map((agent) => agent.id))).toEqual([
      ["a", "c"],
      ["b"],
    ]);
  });
});

describe("summarizeAgentRuntimeSubagents", () => {
  const agents = (...statuses: AgentRuntimeSubagentStatus[]) =>
    statuses.map((status) => ({ status }));

  it.each([
    [agents("working", "completed"), true, "working"],
    [agents("completed", "completed"), false, "completed"],
    [agents("completed", "failed"), false, "failed"],
    [agents("completed", "stopped"), false, "inactive"],
    [agents("completed", "unknown"), false, "inactive"],
    [agents("completed", "idle"), false, "inactive"],
    [agents(), false, "inactive"],
  ] as const)("summarizes %j", (members, live, tone) => {
    const summary = summarizeAgentRuntimeSubagents(members);
    expect(summary).not.toHaveProperty("truncated");
    expect(summary.live).toBe(live);
    expect(summary.tone).toBe(tone);
    expect(summary.count).toBe(members.length);
  });
});

describe("latestLiveAgentRuntimeSubagent", () => {
  it("picks the most recently active working agent and ignores settled ones", () => {
    const { agents } = projectAgentRuntimeSubagents(
      [
        source({ id: "a", activityOrder: 4 }),
        source({ id: "b", activityOrder: 9, observedState: "completed" }),
        source({ id: "c", activityOrder: 6 }),
      ],
      false,
    );

    expect(latestLiveAgentRuntimeSubagent(agents)?.id).toBe("c");
    expect(latestLiveAgentRuntimeSubagent(agents.slice(1, 2))).toBeNull();
  });
});

describe("reconcileAgentRuntimeSubagents", () => {
  const project = (progress: string) =>
    projectAgentRuntimeSubagents(
      [
        source({ id: "a", batchId: "one", progress: "steady" }),
        source({ id: "b", batchId: "two", progress }),
      ],
      false,
    );

  it("returns the previous model when nothing changed", () => {
    const previous = project("same");
    expect(reconcileAgentRuntimeSubagents(previous, project("same"))).toBe(previous);
  });

  it("reuses untouched agents and batches so only the ticking row changes identity", () => {
    const previous = project("before");
    const next = reconcileAgentRuntimeSubagents(previous, project("after"));

    expect(next).not.toBe(previous);
    expect(next.agents[0]).toBe(previous.agents[0]);
    expect(next.agents[1]).not.toBe(previous.agents[1]);
    expect(next.batches[0]).toBe(previous.batches[0]);
    expect(next.batches[1]).not.toBe(previous.batches[1]);
    expect(next.batches[1]?.agents[0]).toBe(next.agents[1]);
  });

  it("adopts the next model when there is no previous one", () => {
    const next = project("x");
    expect(reconcileAgentRuntimeSubagents(null, next)).toBe(next);
  });

  it("keeps a per-entry batch id a row already carried instead of the legacy bucket", () => {
    const perEntry = projectAgentRuntimeSubagents(
      [
        source({ id: "a", batchId: `${RUNTIME_SUBAGENT_ENTRY_BATCH_PREFIX}a` }),
        source({ id: "b", batchId: `${RUNTIME_SUBAGENT_ENTRY_BATCH_PREFIX}b` }),
      ],
      false,
    );
    const collapsed = projectAgentRuntimeSubagents(
      [
        source({ id: "a", batchId: RUNTIME_SUBAGENT_LEGACY_BATCH_ID }),
        source({ id: "b", batchId: RUNTIME_SUBAGENT_LEGACY_BATCH_ID }),
        source({ id: "c", batchId: RUNTIME_SUBAGENT_LEGACY_BATCH_ID }),
      ],
      false,
    );

    const next = reconcileAgentRuntimeSubagents(perEntry, collapsed);

    expect(next.agents.map((agent) => agent.batchId)).toEqual([
      `${RUNTIME_SUBAGENT_ENTRY_BATCH_PREFIX}a`,
      `${RUNTIME_SUBAGENT_ENTRY_BATCH_PREFIX}b`,
      RUNTIME_SUBAGENT_LEGACY_BATCH_ID,
    ]);
    expect(next.batches.map((batch) => batch.id)).toEqual([
      `${RUNTIME_SUBAGENT_ENTRY_BATCH_PREFIX}a`,
      `${RUNTIME_SUBAGENT_ENTRY_BATCH_PREFIX}b`,
      RUNTIME_SUBAGENT_LEGACY_BATCH_ID,
    ]);
  });

  it("never rewrites a spawn or codex turn batch id", () => {
    const previous = projectAgentRuntimeSubagents(
      [source({ id: "a", batchId: `${RUNTIME_SUBAGENT_ENTRY_BATCH_PREFIX}a` })],
      false,
    );
    const next = projectAgentRuntimeSubagents(
      [source({ id: "a", batchId: "spawn:a", progress: "moved" })],
      false,
    );

    expect(reconcileAgentRuntimeSubagents(previous, next).agents[0]?.batchId).toBe("spawn:a");
  });
});
