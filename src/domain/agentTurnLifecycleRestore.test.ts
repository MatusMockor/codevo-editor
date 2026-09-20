import { describe, expect, it } from "vitest";
import { compactPersistedAgentSubagentLifecycle } from "./agentLifecyclePersistence";
import wire from "../../contracts/agent-subagent-lifecycle-wire.json";
import { parseAgentSubagentLifecycle, type AgentSubagentLifecycle } from "./agentSubagentLifecycle";
import { legacyAgentSubagentLifecycle } from "./agentSubagentLifecycleLegacy";
import {
  agentThreadNeedsLoggedLifecycles,
  planAgentTurnLifecycleRestore,
  restorableAgentTurnLifecycle,
} from "./agentTurnLifecycleRestore";

const RETAINED = parseAgentSubagentLifecycle(wire.valid.retained) as AgentSubagentLifecycle;
const PERSISTED = legacyAgentSubagentLifecycle(RETAINED);
const OTHER = parseAgentSubagentLifecycle(wire.valid.legacy) as AgentSubagentLifecycle;

describe("agent turn lifecycle restore", () => {
  it("restores the logged snapshot only over the v1 projection of the same snapshot", () => {
    expect(restorableAgentTurnLifecycle(PERSISTED, RETAINED)).toEqual(RETAINED);
    expect(restorableAgentTurnLifecycle(undefined, RETAINED)).toBeNull();
    expect(restorableAgentTurnLifecycle(OTHER, RETAINED)).toBeNull();
    expect(restorableAgentTurnLifecycle(RETAINED, RETAINED)).toBeNull();
    expect(restorableAgentTurnLifecycle(PERSISTED, PERSISTED)).toBeNull();
    expect(
      restorableAgentTurnLifecycle(PERSISTED, { ...RETAINED, unknown: true } as never),
    ).toBeNull();
  });

  it("restores a compact legacy lifecycle only when its retained entry matches", () => {
    const full = {
      entries: [
        OTHER.entries[0]!,
        { ...OTHER.entries[0]!, id: "tool:second", toolId: "second", taskId: "second-task" },
      ],
      truncated: false,
    };
    const compact = compactPersistedAgentSubagentLifecycle(full)!;
    expect(restorableAgentTurnLifecycle(compact, full)).toEqual(full);
    expect(
      restorableAgentTurnLifecycle(
        { ...compact, entries: [{ ...compact.entries[0]!, description: "changed" }] },
        full,
      ),
    ).toBeNull();
    expect(restorableAgentTurnLifecycle(compact, compact)).toBeNull();
    expect(restorableAgentTurnLifecycle(undefined, full)).toBeNull();
  });

  it("plans a restore for logged detail and a migration for detail only the JSON carried", () => {
    const plan = planAgentTurnLifecycleRestore(
      [
        { turnId: "turn-restored", settled: true, subagentLifecycle: PERSISTED },
        { turnId: "turn-migrated", settled: true, subagentLifecycle: RETAINED },
        { turnId: "turn-running", settled: false, subagentLifecycle: RETAINED },
        { turnId: "turn-omitted", settled: true, subagentLifecycle: RETAINED },
        { turnId: "turn-stale", settled: true, subagentLifecycle: OTHER },
        { turnId: "turn-legacy", settled: true, subagentLifecycle: OTHER },
        { turnId: "turn-plain", settled: true },
      ],
      [
        { turnId: "turn-restored", lifecycle: RETAINED, lifecycleOmitted: false, sealed: true },
        { turnId: "turn-running", lifecycle: null, lifecycleOmitted: false, sealed: true },
        { turnId: "turn-omitted", lifecycle: null, lifecycleOmitted: true, sealed: true },
        { turnId: "turn-stale", lifecycle: RETAINED, lifecycleOmitted: false, sealed: true },
      ],
    );

    expect(plan.restore).toEqual([{ turnId: "turn-restored", lifecycle: RETAINED }]);
    expect(plan.migrate).toEqual([{ turnId: "turn-migrated", lifecycle: RETAINED }]);
  });

  it("migrates legacy history but never steals the lease of an unsealed turn", () => {
    const lifecycle = {
      entries: [
        OTHER.entries[0]!,
        { ...OTHER.entries[0]!, id: "tool:second", toolId: "second", taskId: "second-task" },
      ],
      truncated: false,
    };
    const turns = [{ turnId: "old", settled: true, subagentLifecycle: lifecycle }];
    expect(planAgentTurnLifecycleRestore(turns, []).migrate).toEqual([
      { turnId: "old", lifecycle },
    ]);
    expect(
      planAgentTurnLifecycleRestore(turns, [
        { turnId: "old", lifecycle: null, lifecycleOmitted: false, sealed: false },
      ]).migrate,
    ).toEqual([]);
    expect(
      planAgentTurnLifecycleRestore(turns, [
        { turnId: "old", lifecycle: null, lifecycleOmitted: false, sealed: true },
      ]).migrate,
    ).toEqual([{ turnId: "old", lifecycle }]);
  });

  it("asks the log only when a settled turn carries a lifecycle", () => {
    expect(agentThreadNeedsLoggedLifecycles([{ turnId: "a", settled: true }])).toBe(false);
    expect(
      agentThreadNeedsLoggedLifecycles([
        { turnId: "a", settled: false, subagentLifecycle: RETAINED },
      ]),
    ).toBe(false);
    expect(
      agentThreadNeedsLoggedLifecycles([
        { turnId: "a", settled: true, subagentLifecycle: PERSISTED },
      ]),
    ).toBe(true);
  });
});
