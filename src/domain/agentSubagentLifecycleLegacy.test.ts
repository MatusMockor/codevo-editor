import { describe, expect, it } from "vitest";
import wire from "../../contracts/agent-subagent-lifecycle-wire.json";
import {
  parseAgentSubagentLifecycle,
  retainAgentSubagentLifecycle,
  type AgentSubagentLifecycle,
} from "./agentSubagentLifecycle";
import {
  LEGACY_SUBAGENT_LIFECYCLE_ENTRY_KEYS,
  agentSubagentLifecycleHasRetainedDetail,
  isLegacyAgentSubagentLifecycleShape,
  legacyAgentSubagentLifecycle,
  persistedAgentSubagentLifecycle,
  sameLegacyAgentSubagentLifecycle,
} from "./agentSubagentLifecycleLegacy";
import { nestedSpawnAgentTurnStream } from "../test/agentTurnEventStreams";

const RETAINED = parseAgentSubagentLifecycle(wire.valid.retained) as AgentSubagentLifecycle;
const LEGACY = parseAgentSubagentLifecycle(wire.valid.legacy) as AgentSubagentLifecycle;

describe("legacy subagent lifecycle projection", () => {
  it("strips the retained fields, drops nested entries and reports the drop as truncation", () => {
    const projected = legacyAgentSubagentLifecycle(RETAINED);

    expect(projected).toEqual({
      entries: [
        {
          description: "Running npx vitest run",
          durationMs: 76_099,
          id: "tool:toolu_parent",
          lastToolName: "Bash",
          name: "general-purpose",
          state: "running",
          steps: 31,
          taskId: "task-parent",
          telemetryState: "running",
          toolId: "toolu_parent",
          totalTokens: 87_253,
        },
      ],
      truncated: true,
    });
    expect(Object.keys(projected).sort()).toEqual(["entries", "truncated"]);
  });

  it("leaves a legacy snapshot unchanged and keeps an existing truncation", () => {
    expect(legacyAgentSubagentLifecycle(LEGACY)).toEqual(LEGACY);
    expect(legacyAgentSubagentLifecycle({ ...LEGACY, truncated: true }).truncated).toBe(true);
    expect(
      legacyAgentSubagentLifecycle({
        entries: LEGACY.entries,
        truncated: false,
        openBatchKey: "spawn:toolu_legacy_a",
        countedNestedToolIds: ["toolu_overflow"],
      }),
    ).toEqual(LEGACY);
  });

  it("derives the state exactly as the shipped validator demands", () => {
    const entry = { id: "tool:t", toolId: "t", name: "Agent", description: "" } as const;
    const projected = legacyAgentSubagentLifecycle({
      entries: [
        { ...entry, state: "completed" },
        { ...entry, id: "tool:u", toolId: "u", state: "running", resultState: "completed" },
        {
          ...entry,
          id: "tool:v",
          toolId: "v",
          state: "completed",
          telemetryState: "interrupted",
          resultState: "failed",
        },
        { ...entry, id: "tool:w", toolId: "w", state: "running", telemetryState: "interrupted" },
      ],
      truncated: false,
    });

    expect(projected.entries.map((item) => item.state)).toEqual([
      "running",
      "completed",
      "failed",
      "interrupted",
    ]);
  });

  it("omits a snapshot that would still be invalid after the projection", () => {
    const duplicated: AgentSubagentLifecycle = {
      entries: [RETAINED.entries[0]!, RETAINED.entries[0]!],
      truncated: false,
    };

    expect(persistedAgentSubagentLifecycle(duplicated)).toBeUndefined();
    expect(persistedAgentSubagentLifecycle(undefined)).toBeUndefined();
  });

  it("only ever persists the shipped key sets for generated nested spawn streams", () => {
    let retaining = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      const retained = retainAgentSubagentLifecycle(
        undefined,
        nestedSpawnAgentTurnStream(seed, 160),
      );
      if (retained === undefined) continue;
      if (agentSubagentLifecycleHasRetainedDetail(retained)) retaining += 1;
      const persisted = persistedAgentSubagentLifecycle(retained);

      expect(persisted).toBeDefined();
      expect(isLegacyAgentSubagentLifecycleShape(persisted)).toBe(true);
      expect(agentSubagentLifecycleHasRetainedDetail(persisted!)).toBe(false);
      for (const entry of persisted!.entries) {
        expect(
          Object.keys(entry).filter((key) => !LEGACY_SUBAGENT_LIFECYCLE_ENTRY_KEYS.includes(key)),
        ).toEqual([]);
      }
      const nested = retained.entries.filter((entry) => entry.parentToolId !== undefined).length;
      expect(persisted!.entries).toHaveLength(retained.entries.length - nested);
      expect(persisted!.truncated).toBe(retained.truncated || nested > 0);
    }
    expect(retaining).toBeGreaterThan(30);
  });

  it("recognises the retained detail and the legacy shape", () => {
    expect(agentSubagentLifecycleHasRetainedDetail(RETAINED)).toBe(true);
    expect(agentSubagentLifecycleHasRetainedDetail(LEGACY)).toBe(false);
    expect(agentSubagentLifecycleHasRetainedDetail({ ...LEGACY, openBatchKey: "spawn:t" })).toBe(
      true,
    );
    expect(isLegacyAgentSubagentLifecycleShape(wire.valid.legacy)).toBe(true);
    expect(isLegacyAgentSubagentLifecycleShape(wire.valid.retained)).toBe(false);
    expect(isLegacyAgentSubagentLifecycleShape(null)).toBe(false);
    expect(isLegacyAgentSubagentLifecycleShape({ entries: "x", truncated: false })).toBe(false);
  });

  it("compares snapshots by what a shipped build would see", () => {
    expect(sameLegacyAgentSubagentLifecycle(RETAINED, legacyAgentSubagentLifecycle(RETAINED))).toBe(
      true,
    );
    expect(sameLegacyAgentSubagentLifecycle(RETAINED, LEGACY)).toBe(false);
  });
});
