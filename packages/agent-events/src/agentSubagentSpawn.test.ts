import { describe, expect, it } from "vitest";
import {
  MAX_AGENT_SUBAGENT_SPAWN_THREADS,
  parseAgentSubagentSpawnFields,
} from "./agentSubagentSpawn.js";

const valid = {
  kind: "subagentSpawn",
  callId: "call_spawn_0001",
  status: "completed",
  taskTitle: "Review idempotency middleware",
  model: "gpt-5.6-luna",
  reasoningEffort: "medium",
  agentThreadIds: ["agt-sub-0001"],
};

describe("parseAgentSubagentSpawnFields", () => {
  it("accepts a complete spawn and a minimal in-progress spawn", () => {
    expect(parseAgentSubagentSpawnFields(valid)).toEqual(valid);
    expect(
      parseAgentSubagentSpawnFields({
        ...valid,
        status: "inProgress",
        taskTitle: null,
        model: null,
        reasoningEffort: null,
        agentThreadIds: [],
      }),
    ).toMatchObject({ status: "inProgress", taskTitle: null, agentThreadIds: [] });
  });

  it.each([
    ["an unknown status", { status: "exploded" }],
    ["an unknown effort", { reasoningEffort: "ludicrous" }],
    ["an empty call id", { callId: "" }],
    ["a control character in the title", { taskTitle: "a\u0007b" }],
    ["an empty title", { taskTitle: "" }],
    ["an oversize title", { taskTitle: "é".repeat(241) }],
    ["an oversize model", { model: "m".repeat(65) }],
    ["duplicate receivers", { agentThreadIds: ["a-thread", "a-thread"] }],
    [
      "too many receivers",
      {
        agentThreadIds: Array.from(
          { length: MAX_AGENT_SUBAGENT_SPAWN_THREADS + 1 },
          (_, index) => `thread-${index}`,
        ),
      },
    ],
    ["a non-array receiver list", { agentThreadIds: "agt-sub-0001" }],
  ])("rejects %s", (_label, patch) => {
    expect(() => parseAgentSubagentSpawnFields({ ...valid, ...patch })).toThrow(TypeError);
  });
});
