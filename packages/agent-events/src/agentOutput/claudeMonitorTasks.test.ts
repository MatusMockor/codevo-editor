import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createAgentOutputParserState, feedAgentOutput } from "./agentOutputParser.js";
import type { AgentTurnEvent } from "../agentTurnEvent.js";

type BackgroundEvent = Extract<AgentTurnEvent, { kind: "backgroundTask" }>;

const CAPTURES = "src-tauri/tests/fixtures/claude_session";

function capture(name: string): string {
  return readFileSync(`${CAPTURES}/${name}.jsonl`, "utf8");
}

function frame(fields: Record<string, unknown>): string {
  return `${JSON.stringify(fields)}\n`;
}

function toolCall(name: string, id: string, parent: unknown = null): string {
  return frame({
    type: "assistant",
    ...(parent === undefined ? {} : { parent_tool_use_id: parent }),
    message: { role: "assistant", content: [{ type: "tool_use", id, name, input: {} }] },
  });
}

function started(taskId: string, toolUseId?: string): string {
  return frame({
    type: "system",
    subtype: "task_started",
    task_id: taskId,
    task_type: "local_bash",
    is_backgrounded: true,
    ...(toolUseId === undefined ? {} : { tool_use_id: toolUseId }),
  });
}

function tasksOf(...chunks: ReadonlyArray<string>): ReadonlyArray<BackgroundEvent> {
  let state = createAgentOutputParserState("claudeCode");
  const events: AgentTurnEvent[] = [];
  for (const chunk of chunks) {
    const fed = feedAgentOutput(state, "stdout", chunk);
    state = fed.state;
    events.push(...fed.events);
  }
  return events.filter((event): event is BackgroundEvent => event.kind === "backgroundTask");
}

describe("Claude Monitor tasks", () => {
  it("reports the captured Monitor as a monitor although the CLI calls it local_bash", () => {
    const captured = capture("monitor-events-and-end");
    expect(captured).toContain('"name":"Monitor"');
    expect(captured).toContain('"task_type":"local_bash"');
    expect(captured).not.toContain('"task_type":"monitor');

    expect(
      tasksOf(captured)
        .slice(0, 2)
        .map((task) => [task.taskId, task.status, task.taskType]),
    ).toEqual([
      ["captured-task-0001", "starting", "monitor"],
      ["captured-task-0001", "completed", "monitor"],
    ]);
  });

  it("reports the captured stopped Monitor as a monitor and the captured shell as a shell", () => {
    expect(
      tasksOf(capture("stop-monitor"))
        .slice(0, 2)
        .map((task) => [task.status, task.taskType]),
    ).toEqual([
      ["starting", "monitor"],
      ["stopped", "monitor"],
    ]);
    expect(tasksOf(capture("stop-background-shell"))[0]).toMatchObject({
      status: "starting",
      taskType: "shell",
    });
  });

  it("counts only a root tool call named exactly Monitor whose id started the task", () => {
    const calls = [
      toolCall("Monitor", "toolu-watch"),
      toolCall("Bash", "toolu-bash"),
      toolCall("monitor", "toolu-lowercase"),
      toolCall("MonitorTool", "toolu-longer"),
      toolCall("Monitor", "toolu-nested", "toolu-agent"),
    ].join("");
    const starts = [
      started("watch", "toolu-watch"),
      started("bash", "toolu-bash"),
      started("lowercase", "toolu-lowercase"),
      started("longer", "toolu-longer"),
      started("nested", "toolu-nested"),
      started("unseen", "toolu-unseen"),
      started("untied"),
    ].join("");

    expect(tasksOf(calls, starts).map((task) => [task.taskId, task.taskType])).toEqual([
      ["watch", "monitor"],
      ["bash", "shell"],
      ["lowercase", "shell"],
      ["longer", "shell"],
      ["nested", "shell"],
      ["unseen", "shell"],
      ["untied", "shell"],
    ]);
  });

  it("remembers a Monitor call only from a frame whose parent is absent or null", () => {
    const parents: ReadonlyArray<readonly [string, unknown, "monitor" | "shell"]> = [
      ["absent", undefined, "monitor"],
      ["null", null, "monitor"],
      ["nested", "toolu-agent", "shell"],
      ["empty", "", "shell"],
      ["numeric", 7, "shell"],
      ["zero", 0, "shell"],
      ["false", false, "shell"],
      ["object", { id: "toolu-agent" }, "shell"],
      ["array", ["toolu-agent"], "shell"],
      ["oversized", "t".repeat(4_096), "shell"],
    ];
    const calls = parents.map(([name, parent]) => toolCall("Monitor", `toolu-${name}`, parent));
    const starts = parents.map(([name]) => started(name, `toolu-${name}`));

    expect(
      tasksOf(calls.join(""), starts.join("")).map((task) => [task.taskId, task.taskType]),
    ).toEqual(parents.map(([name, , taskType]) => [name, taskType]));
  });

  it("never ties a Monitor call to a task whose start frame has a malformed parent", () => {
    const nested = (taskId: string, parent: unknown) =>
      frame({
        type: "system",
        subtype: "task_started",
        task_id: taskId,
        task_type: "local_bash",
        is_backgrounded: true,
        tool_use_id: "toolu-watch",
        parent_tool_use_id: parent,
      });

    const tasks = tasksOf(
      toolCall("Monitor", "toolu-watch"),
      nested("empty", ""),
      nested("numeric", 7),
      started("watch", "toolu-watch"),
    );

    expect(tasks.filter((task) => task.taskId === "watch").map((task) => task.taskType)).toEqual([
      "monitor",
    ]);
    expect(tasks.filter((task) => task.taskType === "monitor")).toHaveLength(1);
  });

  it("keeps a monitor a monitor through later frames and forgets it when it ends", () => {
    const later = [
      frame({
        type: "system",
        subtype: "task_progress",
        task_id: "watch",
        task_type: "local_bash",
      }),
      frame({
        type: "system",
        subtype: "task_updated",
        task_id: "watch",
        patch: { status: "running" },
      }),
      frame({
        type: "system",
        subtype: "task_updated",
        task_id: "watch",
        patch: { status: "completed" },
      }),
    ];

    const tasks = tasksOf(
      toolCall("Monitor", "toolu-watch"),
      started("watch", "toolu-watch"),
      ...later,
      started("watch", "toolu-watch"),
    );

    expect(tasks.map((task) => [task.status, task.taskType])).toEqual([
      ["starting", "monitor"],
      ["running", "monitor"],
      ["running", "monitor"],
      ["completed", "monitor"],
      ["starting", "shell"],
    ]);
  });

  it("forgets the oldest remembered Monitor call first and never guesses", () => {
    const calls = Array.from({ length: 65 }, (_, index) => toolCall("Monitor", `toolu-${index}`));

    const tasks = tasksOf(
      calls.join(""),
      started("oldest", "toolu-0"),
      started("second", "toolu-1"),
      started("newest", "toolu-64"),
    );

    expect(tasks.map((task) => [task.taskId, task.taskType])).toEqual([
      ["oldest", "shell"],
      ["second", "monitor"],
      ["newest", "monitor"],
    ]);
  });

  it("leaves a stream without Monitor calls and other providers untouched", () => {
    const state = createAgentOutputParserState("claudeCode");
    const shell = feedAgentOutput(state, "stdout", started("build", "toolu-bash"));
    expect(shell.events).toEqual([
      { kind: "backgroundTask", taskId: "build", status: "starting", taskType: "shell" },
    ]);
    expect(shell.state.claudeMonitorTasks?.tasks.size ?? 0).toBe(0);

    const codex = feedAgentOutput(
      createAgentOutputParserState("codex"),
      "stdout",
      toolCall("Monitor", "toolu-watch"),
    );
    expect(codex.state.claudeMonitorTasks).toBeUndefined();
  });
});
