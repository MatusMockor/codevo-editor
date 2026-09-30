import { describe, expect, it } from "vitest";
import type { AgentTurnEvent } from "../../domain/agentThread";
import { agentActivityEntries } from "./agentActivityGrouping";
import { agentTurnProjection } from "./agentTurnProjection";

const PARENT = "toolu_01W4PapkRaE4mckkTsVVQzfB";
const TASK = "ab42a94dd121717f9";
const NESTED_READ = "toolu_01TxLqtxNn94ba5dgtzPVMRi";

const launched: ReadonlyArray<AgentTurnEvent> = [
  {
    kind: "toolCall",
    toolId: PARENT,
    name: "Agent",
    inputSummary: "Workspace indicator design proposals",
    description: "Workspace indicator design proposals",
  },
  {
    kind: "toolResult",
    toolId: PARENT,
    outputSummary: "Async agent launched successfully.",
    isError: false,
  },
  { kind: "toolCall", toolId: "cmd-1", name: "Bash", inputSummary: "git status" },
  { kind: "toolResult", toolId: "cmd-1", outputSummary: "clean", isError: false },
  {
    kind: "toolCall",
    toolId: NESTED_READ,
    name: "Read",
    inputSummary: "/tmp/wsmock/c0.png",
    parentToolId: PARENT,
  },
  {
    kind: "subagent",
    status: "running",
    toolId: PARENT,
    taskId: TASK,
    subagentType: "general-purpose",
    description: "Reading /tmp/wsmock/c0.png",
  },
];

function nestedRead(events: ReadonlyArray<AgentTurnEvent>) {
  return agentTurnProjection(events, null, "/tmp", "running").items.find(
    (item) => item.kind === "tool" && item.toolId === NESTED_READ,
  );
}

describe("agentTurnProjection nested subagent tools", () => {
  it("keeps a nested tool running while its subagent still works", () => {
    expect(nestedRead(launched)).toMatchObject({ status: "running" });
  });

  it.each([
    [
      "completed by tool id",
      { kind: "subagent", status: "completed", toolId: PARENT, taskId: TASK },
      { status: "ok", label: "Read wsmock/c0.png" },
    ],
    [
      "failed by task id",
      { kind: "subagent", status: "failed", taskId: TASK },
      { status: "interrupted", label: "Interrupted wsmock/c0.png" },
    ],
    [
      "stopped as a background agent",
      { kind: "backgroundTask", taskId: TASK, status: "stopped", taskType: "agent" },
      { status: "stopped" },
    ],
  ] as const)(
    "stops showing an unanswered nested tool as live once its subagent %s",
    (_, settled, expected) => {
      const events: ReadonlyArray<AgentTurnEvent> = [...launched, settled];

      expect(nestedRead(events)).toMatchObject({ ...expected, outcome: null });
      const items = agentTurnProjection(events, null, "/tmp", "running").items;
      const running = agentActivityEntries(items, "live").filter((entry) =>
        entry.kind === "group"
          ? entry.running > 0
          : entry.item.kind === "tool" && entry.item.status === "running",
      );
      expect(running).toEqual([]);
    },
  );

  it("keeps a completed subagent's unanswered read inside the settled work group", () => {
    const events: ReadonlyArray<AgentTurnEvent> = [
      ...launched,
      { kind: "subagent", status: "completed", toolId: PARENT, taskId: TASK },
    ];
    const items = agentTurnProjection(events, null, "/tmp", "running").items;

    expect(
      agentActivityEntries(items, "live").find((entry) => entry.kind === "group"),
    ).toMatchObject({
      label: "1 command · 1 file read",
      running: 0,
    });
  });

  it("keeps a resumed subagent's nested tool live when a new tool id restarts the task", () => {
    const resumed = "toolu_resumed";
    const events: ReadonlyArray<AgentTurnEvent> = [
      ...launched.slice(0, 4),
      { kind: "subagent", status: "running", toolId: PARENT, taskId: TASK },
      { kind: "subagent", status: "completed", toolId: PARENT, taskId: TASK },
      { kind: "subagent", status: "running", toolId: resumed, taskId: TASK },
      {
        kind: "toolCall",
        toolId: NESTED_READ,
        name: "Read",
        inputSummary: "/tmp/wsmock/c0.png",
        parentToolId: resumed,
      },
    ];

    expect(nestedRead(events)).toMatchObject({ status: "running" });
  });

  it("keeps a nested tool live when its subagent runs again after a background completion", () => {
    const events: ReadonlyArray<AgentTurnEvent> = [
      ...launched,
      { kind: "backgroundTask", taskId: TASK, status: "completed", taskType: "other" },
      { kind: "subagent", status: "running", toolId: PARENT, taskId: TASK },
    ];

    expect(nestedRead(events)).toMatchObject({ status: "running" });
  });

  it("keeps the turn's own halt neutral for nested tools of a settled subagent", () => {
    const events: ReadonlyArray<AgentTurnEvent> = [
      ...launched,
      { kind: "subagent", status: "completed", toolId: PARENT, taskId: TASK },
    ];
    const item = agentTurnProjection(events, null, "/tmp", "stopped").items.find(
      (entry) => entry.kind === "tool" && entry.toolId === NESTED_READ,
    );

    expect(item).toMatchObject({ status: "stopped" });
  });
});
