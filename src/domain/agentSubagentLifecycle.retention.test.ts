import { describe, expect, it } from "vitest";
import wire from "../../contracts/agent-subagent-lifecycle-wire.json";
import {
  MAX_RETAINED_SUBAGENTS,
  MAX_SUBAGENT_BATCH_KEY_BYTES,
  MAX_SUBAGENT_COUNTED_NESTED_IDS,
  MAX_SUBAGENT_NESTED_COUNT,
  MAX_SUBAGENT_PARENT_TOOL_ID_BYTES,
  MAX_SUBAGENT_TASK_TITLE_BYTES,
  parseAgentSubagentLifecycle,
  retainAgentSubagentLifecycle,
  type AgentSubagentLifecycle,
} from "./agentSubagentLifecycle";
import type { AgentTurnEvent } from "./agentThread";
import { agentTurnStream, nestedSpawnAgentTurnStream } from "../test/agentTurnEventStreams";

const spawn = (toolId: string, description: string, parentToolId?: string): AgentTurnEvent => ({
  kind: "toolCall",
  toolId,
  name: "Agent",
  inputSummary: description,
  description,
  ...(parentToolId === undefined ? {} : { parentToolId }),
});

const progress = (toolId: string, description: string): AgentTurnEvent => ({
  kind: "subagent",
  status: "running",
  toolId,
  taskId: `task-${toolId}`,
  subagentType: "general-purpose",
  description,
  durationMs: 2_961,
  totalTokens: 35_566,
  toolUses: 2,
  lastToolName: "Read",
});

const launched = (toolId: string): AgentTurnEvent => ({
  kind: "toolResult",
  toolId,
  outputSummary: "Async agent launched successfully.",
  isError: false,
});

function retainInChunks(chunks: ReadonlyArray<ReadonlyArray<AgentTurnEvent>>) {
  let lifecycle: AgentSubagentLifecycle | undefined;
  for (const chunk of chunks) lifecycle = retainAgentSubagentLifecycle(lifecycle, chunk);
  return lifecycle;
}

describe("retained subagent task title", () => {
  it("keeps the spawn task title while progress keeps overwriting the description", () => {
    const lifecycle = retainInChunks([
      [spawn("a", "Fix subagent view findings")],
      [progress("a", "Reading src/domain/example.ts")],
      [progress("a", "Running npx vitest run")],
    ]);

    expect(lifecycle?.entries[0]).toMatchObject({
      taskTitle: "Fix subagent view findings",
      description: "Running npx vitest run",
      name: "general-purpose",
    });
  });

  it("takes the title from the first starting event when no spawn call was seen", () => {
    const fromSubagent = retainInChunks([
      [
        {
          kind: "subagent",
          status: "starting",
          toolId: "a",
          taskId: "task-a",
          description: "TS artifact slice review fixes",
        },
        progress("a", "Reading a file"),
        { kind: "subagent", status: "starting", toolId: "a", description: "Later restart text" },
      ],
    ]);
    expect(fromSubagent?.entries[0]?.taskTitle).toBe("TS artifact slice review fixes");

    const fromBackground = retainInChunks([
      [{ kind: "subagent", status: "running", toolId: "b", taskId: "task-b" }],
      [
        {
          kind: "backgroundTask",
          taskId: "task-b",
          status: "starting",
          taskType: "agent",
          description: "Background title",
        },
      ],
    ]);
    expect(fromBackground?.entries).toHaveLength(1);
    expect(fromBackground?.entries[0]).toMatchObject({
      taskTitle: "Background title",
      state: "running",
    });
  });

  it("never creates an agent from a starting background task alone", () => {
    expect(
      retainAgentSubagentLifecycle(undefined, [
        { kind: "backgroundTask", taskId: "solo", status: "starting", taskType: "agent" },
      ]),
    ).toBeUndefined();
  });

  it("bounds the retained title to the title limit on code point boundaries", () => {
    const lifecycle = retainAgentSubagentLifecycle(undefined, [spawn("a", "😀".repeat(400))]);
    const title = lifecycle?.entries[0]?.taskTitle ?? "";

    expect([...title]).toHaveLength(120);
    expect(new TextEncoder().encode(title).length).toBe(wire.limits.taskTitleBytes);
    expect(parseAgentSubagentLifecycle(JSON.parse(JSON.stringify(lifecycle)))).toEqual(lifecycle);
  });
});

describe("retained spawn batch key", () => {
  it("freezes one key for parallel spawns delivered across separate appends", () => {
    const lifecycle = retainInChunks([
      [spawn("a", "Stream A")],
      [spawn("b", "Stream B")],
      [launched("a"), launched("b")],
      [progress("a", "Reading"), progress("b", "Reading")],
    ]);

    expect(lifecycle?.entries.map((entry) => entry.batchKey)).toEqual(["spawn:a", "spawn:a"]);
    expect(lifecycle?.openBatchKey).toBeUndefined();
  });

  it("separates sequential spawns and never rewrites a retained key", () => {
    const lifecycle = retainInChunks([
      [spawn("a", "First"), launched("a")],
      [spawn("b", "Second")],
      [{ kind: "assistantText", text: "Waiting for both." }],
      [spawn("a", "First"), spawn("c", "Third")],
    ]);

    expect(lifecycle?.entries.map((entry) => entry.batchKey)).toEqual([
      "spawn:a",
      "spawn:b",
      "spawn:c",
    ]);
  });

  it("a re-observed spawn never reopens a batch and leaves the root key unchanged", () => {
    const opened = retainAgentSubagentLifecycle(undefined, [spawn("a", "First")]);
    expect(opened?.openBatchKey).toBe("spawn:a");

    const replayed = retainAgentSubagentLifecycle(opened, [spawn("a", "First")]);
    expect(replayed?.openBatchKey).toBe("spawn:a");
    expect(replayed?.entries[0]?.batchKey).toBe("spawn:a");

    const closed = retainAgentSubagentLifecycle(replayed, [
      { kind: "assistantText", text: "Waiting for the agent." },
    ]);
    expect(closed?.openBatchKey).toBeUndefined();

    const reopened = retainAgentSubagentLifecycle(closed, [spawn("a", "First"), launched("a")]);
    expect(reopened?.openBatchKey).toBeUndefined();
    expect(reopened?.entries[0]?.batchKey).toBe("spawn:a");
  });

  it("leaves entries that never saw their spawn call without a key", () => {
    const lifecycle = retainAgentSubagentLifecycle(undefined, [progress("a", "Reading")]);

    expect(lifecycle?.entries[0]?.batchKey).toBeUndefined();
  });
});

describe("retained nested agents", () => {
  it("counts nested spawns on the top-level ancestor and keeps them out of the top level", () => {
    const lifecycle = retainInChunks([
      [spawn("parent", "Lead work")],
      [spawn("child", "Child work", "parent"), progress("child", "Reading")],
      [spawn("grandchild", "Deep work", "child")],
      [spawn("child", "Child work", "parent")],
    ]);
    const entries = lifecycle?.entries ?? [];

    expect(entries.find((entry) => entry.id === "tool:parent")?.nestedCount).toBe(2);
    expect(entries.filter((entry) => entry.parentToolId === undefined)).toHaveLength(1);
    expect(entries.find((entry) => entry.id === "tool:child")).toMatchObject({
      parentToolId: "parent",
      taskTitle: "Child work",
      state: "running",
    });
    expect(lifecycle?.truncated).toBe(false);
    expect(parseAgentSubagentLifecycle(JSON.parse(JSON.stringify(lifecycle)))).toEqual(lifecycle);
  });

  it("reports truncation when a nested spawn has no retained ancestor or no free slot", () => {
    const orphan = retainAgentSubagentLifecycle(undefined, [spawn("child", "Child", "missing")]);
    expect(orphan).toEqual({ entries: [], truncated: true });

    const full = retainInChunks([
      Array.from({ length: MAX_RETAINED_SUBAGENTS }, (_, index) => spawn(`t${index}`, "Work")),
      [spawn("child", "Child", "t0")],
    ]);
    expect(full?.entries).toHaveLength(MAX_RETAINED_SUBAGENTS);
    expect(full?.entries[0]?.nestedCount).toBe(1);
    expect(full?.truncated).toBe(true);
  });

  it("counts a redelivered nested spawn once even with no free slot", () => {
    const roots = Array.from({ length: MAX_RETAINED_SUBAGENTS }, (_, index) =>
      spawn(`t${index}`, "Work"),
    );
    const lifecycle = retainInChunks([
      roots,
      ...Array.from({ length: 5 }, () => [spawn("child", "Child", "t0")]),
    ]);

    expect(lifecycle?.entries).toHaveLength(MAX_RETAINED_SUBAGENTS);
    expect(lifecycle?.entries[0]?.nestedCount).toBe(1);
    expect(lifecycle?.truncated).toBe(true);
    expect(parseAgentSubagentLifecycle(JSON.parse(JSON.stringify(lifecycle)))).toEqual(lifecycle);
  });

  it("bounds the remembered nested spawn identities", () => {
    const roots = Array.from({ length: MAX_RETAINED_SUBAGENTS }, (_, index) =>
      spawn(`t${index}`, "Work"),
    );
    const nested = Array.from({ length: MAX_SUBAGENT_COUNTED_NESTED_IDS + 4 }, (_, index) =>
      spawn(`child-${index}`, "Child", "t0"),
    );
    const lifecycle = retainInChunks([roots, nested]);

    expect(lifecycle?.countedNestedToolIds).toHaveLength(MAX_SUBAGENT_COUNTED_NESTED_IDS);
    expect(lifecycle?.entries[0]?.nestedCount).toBe(MAX_SUBAGENT_COUNTED_NESTED_IDS + 4);
    expect(parseAgentSubagentLifecycle(JSON.parse(JSON.stringify(lifecycle)))).toEqual(lifecycle);
  });

  it(`recounts a replayed nested spawn once its identity leaves the ${MAX_SUBAGENT_COUNTED_NESTED_IDS}-identity memory`, () => {
    const roots = Array.from({ length: MAX_RETAINED_SUBAGENTS }, (_, index) =>
      spawn(`t${index}`, "Work"),
    );
    const distinct = MAX_SUBAGENT_COUNTED_NESTED_IDS + 1;
    const nested = Array.from({ length: distinct }, (_, index) =>
      spawn(`child-${index}`, "Child", "t0"),
    );
    const filled = retainInChunks([roots, nested]);

    expect(filled?.countedNestedToolIds).toHaveLength(MAX_SUBAGENT_COUNTED_NESTED_IDS);
    expect(filled?.countedNestedToolIds).not.toContain("child-0");
    expect(filled?.entries[0]?.nestedCount).toBe(distinct);

    const remembered = retainAgentSubagentLifecycle(filled, [
      spawn(`child-${distinct - 1}`, "Child", "t0"),
    ]);
    expect(remembered?.entries[0]?.nestedCount).toBe(distinct);

    const forgotten = retainAgentSubagentLifecycle(remembered, [spawn("child-0", "Child", "t0")]);
    expect(forgotten?.entries[0]?.nestedCount).toBe(distinct + 1);
  });

  it("saturates the nested count", () => {
    const events = Array.from({ length: MAX_SUBAGENT_NESTED_COUNT + 5 }, (_, index) =>
      spawn(`child-${index}`, "Child", "parent"),
    );
    const lifecycle = retainInChunks([[spawn("parent", "Lead")], events]);

    expect(lifecycle?.entries[0]?.nestedCount).toBe(MAX_SUBAGENT_NESTED_COUNT);
  });
});

describe("producer stays inside the strict validator", () => {
  it("attaches a nested spawn to the entry that already owns its tool id", () => {
    const lifecycle = retainInChunks([
      [spawn("P", "Lead work")],
      [{ kind: "subagent", status: "starting", taskId: "T", description: "Task telemetry" }],
      [{ kind: "subagent", status: "running", taskId: "T", toolId: "X" }],
      [spawn("X", "Nested work", "P")],
    ]);
    const entries = lifecycle?.entries ?? [];

    expect(entries.filter((entry) => entry.toolId === "X")).toHaveLength(1);
    expect(entries.find((entry) => entry.toolId === "X")).toMatchObject({
      taskId: "T",
      parentToolId: "P",
    });
    expect(entries.find((entry) => entry.toolId === "P")?.nestedCount).toBe(1);
    expect(parseAgentSubagentLifecycle(JSON.parse(JSON.stringify(lifecycle)))).toEqual(lifecycle);
  });

  it("counts an adopted nested spawn once when the stream redelivers it", () => {
    const lifecycle = retainInChunks([
      [spawn("P", "Lead work")],
      [{ kind: "subagent", status: "running", taskId: "T", toolId: "X" }],
      [spawn("X", "Nested work", "P")],
      [spawn("X", "Nested work", "P")],
    ]);

    expect(lifecycle?.entries.find((entry) => entry.toolId === "P")?.nestedCount).toBe(1);
    expect(parseAgentSubagentLifecycle(JSON.parse(JSON.stringify(lifecycle)))).toEqual(lifecycle);
  });

  it("never nests an entry under itself or its own descendant", () => {
    const lifecycle = retainInChunks([
      [spawn("root", "Lead")],
      [spawn("child", "Child", "root")],
      [spawn("root", "Cycle", "child")],
      [spawn("root", "Self", "root")],
    ]);
    const entries = lifecycle?.entries ?? [];

    expect(entries.find((entry) => entry.toolId === "root")?.parentToolId).toBeUndefined();
    expect(entries.find((entry) => entry.toolId === "root")?.nestedCount).toBe(1);
    expect(parseAgentSubagentLifecycle(JSON.parse(JSON.stringify(lifecycle)))).toEqual(lifecycle);
  });

  it("keeps a merged alias nested only when both sides shared the same parent", () => {
    const nested = retainInChunks([
      [spawn("root", "Lead")],
      [{ kind: "subagent", status: "running", taskId: "solo" }],
      [{ kind: "subagent", status: "running", taskId: "solo", toolId: "n1" }],
      [spawn("n1", "Nested one", "root"), spawn("n2", "Nested two", "root")],
      [{ kind: "subagent", status: "running", taskId: "solo", toolId: "n2" }],
    ]);
    const survivor = nested?.entries.find((entry) => entry.taskId === "solo");

    expect(nested?.entries.filter((entry) => entry.toolId === "n2")).toHaveLength(1);
    expect(survivor?.parentToolId).toBe("root");

    const promoted = retainInChunks([
      [{ kind: "subagent", status: "running", taskId: "solo" }],
      [spawn("lead", "Lead")],
      [spawn("alias", "Nested", "lead")],
      [{ kind: "subagent", status: "running", taskId: "solo", toolId: "alias" }],
    ]);
    const merged = promoted?.entries.find((entry) => entry.taskId === "solo");

    expect(promoted?.entries.filter((entry) => entry.toolId === "alias")).toHaveLength(1);
    expect(merged?.parentToolId).toBeUndefined();
    expect(parseAgentSubagentLifecycle(JSON.parse(JSON.stringify(promoted)))).toEqual(promoted);
  });

  it("keeps every incremental snapshot strictly parseable across generated streams", () => {
    const roundTrip = (lifecycle: AgentSubagentLifecycle | undefined): unknown =>
      lifecycle === undefined ? undefined : JSON.parse(JSON.stringify(lifecycle));
    for (let seed = 0; seed < 24; seed += 1)
      for (const events of [nestedSpawnAgentTurnStream(seed, 80), agentTurnStream(seed, 80)]) {
        let lifecycle: AgentSubagentLifecycle | undefined;
        for (const [index, event] of events.entries()) {
          lifecycle = retainAgentSubagentLifecycle(lifecycle, [event]);
          const label = `seed ${seed} event ${index} ${event.kind}`;

          expect(parseAgentSubagentLifecycle(roundTrip(lifecycle)), label).toEqual(lifecycle);
          expect(new Set((lifecycle?.entries ?? []).map((entry) => entry.id)).size, label).toBe(
            lifecycle?.entries.length ?? 0,
          );
        }
      }
  });
});

describe("lifecycle wire contract", () => {
  it("round-trips legacy and retained snapshots unchanged", () => {
    for (const snapshot of [wire.valid.legacy, wire.valid.retained]) {
      const parsed = parseAgentSubagentLifecycle(snapshot);
      expect(JSON.parse(JSON.stringify(parsed))).toEqual(snapshot);
    }
  });

  it("keeps every declared limit aligned with the domain constants", () => {
    expect(wire.limits).toEqual({
      entries: MAX_RETAINED_SUBAGENTS,
      taskTitleBytes: MAX_SUBAGENT_TASK_TITLE_BYTES,
      batchKeyBytes: MAX_SUBAGENT_BATCH_KEY_BYTES,
      parentToolIdBytes: MAX_SUBAGENT_PARENT_TOOL_ID_BYTES,
      nestedCount: MAX_SUBAGENT_NESTED_COUNT,
      countedNestedToolIds: MAX_SUBAGENT_COUNTED_NESTED_IDS,
    });
  });

  it("rejects every invalid patch fail-closed", () => {
    const [entry, ...rest] = wire.valid.retained.entries;
    for (const patch of wire.invalidEntryPatches)
      expect(
        () =>
          parseAgentSubagentLifecycle({
            ...wire.valid.retained,
            entries: [{ ...entry, ...patch }, ...rest],
          }),
        JSON.stringify(patch),
      ).toThrow();
    for (const patch of wire.invalidRootPatches)
      expect(
        () => parseAgentSubagentLifecycle({ ...wire.valid.retained, ...patch }),
        JSON.stringify(patch),
      ).toThrow();
  });
});
