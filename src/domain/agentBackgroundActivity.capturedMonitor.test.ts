import { readFileSync } from "node:fs";
import {
  createAgentOutputParserState,
  feedAgentOutput,
  type AgentTurnEvent,
} from "@codevo/agent-events";
import { describe, expect, it } from "vitest";
import { projectAgentBackgroundActivity } from "./agentBackgroundActivity";

const CAPTURES = "src-tauri/tests/fixtures/claude_session";
const CAPTURE = readFileSync(`${CAPTURES}/monitor-events-and-end.jsonl`, "utf8");
const SECOND_TURN_OUTPUT = readFileSync(
  `${CAPTURES}/monitor-inherited-second-turn-output.jsonl`,
  "utf8",
);
const UNCLAIMED_AGENT_TASK = readFileSync(
  `${CAPTURES}/synthetic-unclaimed-agent-task.jsonl`,
  "utf8",
);
const CAPTURED_TASK = "captured-task-0001";
const UNCLAIMED_TASK = "captured-task-0002";

function taskEventsOf(output: string): ReadonlyArray<AgentTurnEvent> {
  const fed = feedAgentOutput(createAgentOutputParserState("claudeCode"), "stdout", output);
  return fed.events.filter(
    (event) =>
      event.kind === "backgroundTask" ||
      event.kind === "subagent" ||
      event.kind === "subagentActivity" ||
      event.kind === "subagentEvent" ||
      event.kind === "subagentUsage" ||
      event.kind === "subagentTurnDone",
  );
}

describe("in-turn indicator for the captured Monitor", () => {
  it("lists the task as a monitor from its start until the turn's own result", () => {
    const lines = CAPTURE.split("\n");
    const ownResult = lines.findIndex((line) => line.includes('"result":"STARTED"'));
    expect(ownResult).toBeGreaterThan(0);
    const untilResult = `${lines.slice(0, ownResult + 1).join("\n")}\n`;

    const fed = feedAgentOutput(createAgentOutputParserState("claudeCode"), "stdout", untilResult);
    const activity = projectAgentBackgroundActivity(fed.events, true);

    expect(activity.tasks).toEqual([
      {
        taskId: "captured-task-0001",
        taskType: "monitor",
        description: "tick events from loop",
      },
    ]);
    expect(activity.foregroundSettled).toBe(true);
    expect(activity.phase).toBe("monitoring");
  });
});

describe("the turn that follows the one that started the captured Monitor", () => {
  it("is told nothing about that Monitor, so it shows no task or subagent of its own", () => {
    expect(SECOND_TURN_OUTPUT).toContain('"result":"SECOND"');
    expect(SECOND_TURN_OUTPUT).not.toContain(CAPTURED_TASK);

    const fed = feedAgentOutput(
      createAgentOutputParserState("claudeCode"),
      "stdout",
      SECOND_TURN_OUTPUT,
    );

    expect(taskEventsOf(SECOND_TURN_OUTPUT)).toEqual([]);
    expect(JSON.stringify(fed.events)).not.toContain(CAPTURED_TASK);
    expect(projectAgentBackgroundActivity(fed.events, true).tasks).toEqual([]);
    expect(fed.state.claudeMonitorTasks?.tasks.size ?? 0).toBe(0);
  });

  it("would have reported that Monitor as its own had the frames been routed to it", () => {
    const lines = CAPTURE.split("\n");
    const ownResult = lines.findIndex((line) => line.includes('"result":"STARTED"'));
    const unrouted = `${lines.slice(ownResult + 2).join("\n")}\n`;

    expect(
      taskEventsOf(unrouted).map((event) => [
        event.kind,
        "taskId" in event ? event.taskId : null,
        "status" in event ? event.status : null,
      ]),
    ).toEqual([
      ["subagent", CAPTURED_TASK, "completed"],
      ["backgroundTask", CAPTURED_TASK, "completed"],
      ["subagent", CAPTURED_TASK, "completed"],
      ["backgroundTask", CAPTURED_TASK, "completed"],
    ]);
  });

  it("is told nothing about a task that started before its command did", () => {
    expect(
      UNCLAIMED_AGENT_TASK.split("\n").filter((line) => line.includes(UNCLAIMED_TASK)),
    ).toHaveLength(4);
    expect(SECOND_TURN_OUTPUT).not.toContain(UNCLAIMED_TASK);
    expect(taskEventsOf(SECOND_TURN_OUTPUT)).toEqual([]);

    const startOnly = `${UNCLAIMED_AGENT_TASK.split("\n")[0] ?? ""}\n`;
    const stranded = feedAgentOutput(
      createAgentOutputParserState("claudeCode"),
      "stdout",
      startOnly,
    );

    expect(
      taskEventsOf(startOnly).map((event) => [
        event.kind,
        "taskId" in event ? event.taskId : null,
        "status" in event ? event.status : null,
      ]),
    ).toEqual([
      ["subagent", UNCLAIMED_TASK, "starting"],
      ["backgroundTask", UNCLAIMED_TASK, "starting"],
    ]);
    expect(
      projectAgentBackgroundActivity(stranded.events, true).tasks.map((task) => task.taskId),
    ).toEqual([UNCLAIMED_TASK]);
  });
});
