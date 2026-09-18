import { describe, expect, it } from "vitest";
import { createAgentOutputParserState, feedAgentOutput } from "./agentOutputParser";
import { retainAgentSubagentLifecycle } from "../agentSubagentLifecycle";
const line = (fields: Record<string, unknown>) =>
  `${JSON.stringify({ type: "system", ...fields })}\n`;
describe("Claude subagent task classification", () => {
  it("does not create a ghost agent for untyped shell terminal across chunks", () => {
    const started = feedAgentOutput(
      createAgentOutputParserState("claudeCode"),
      "stdout",
      line({ subtype: "task_started", task_id: "shell", task_type: "local_bash" }),
    );
    const done = feedAgentOutput(
      started.state,
      "stdout",
      line({ subtype: "task_notification", task_id: "shell", status: "completed" }),
    );
    expect(done.events.some((event) => event.kind === "subagent")).toBe(false);
    expect(done.events).toContainEqual({
      kind: "backgroundTask",
      taskId: "shell",
      status: "completed",
      taskType: "other",
    });
    expect(
      retainAgentSubagentLifecycle(undefined, [...started.events, ...done.events]),
    ).toBeUndefined();
  });
  it("preserves explicit agent-only terminals and untyped known-agent completion", () => {
    const started = feedAgentOutput(
      createAgentOutputParserState("claudeCode"),
      "stdout",
      line({ subtype: "task_started", task_id: "agent", task_type: "local_agent" }),
    );
    const done = feedAgentOutput(
      started.state,
      "stdout",
      line({ subtype: "task_notification", task_id: "agent", status: "completed" }),
    );
    expect(done.events.some((event) => event.kind === "subagent")).toBe(true);
    const explicit = feedAgentOutput(
      done.state,
      "stdout",
      line({
        subtype: "task_notification",
        task_id: "standalone",
        task_type: "local_agent",
        status: "completed",
      }),
    );
    expect(explicit.events.some((event) => event.kind === "subagent")).toBe(true);
  });
  it("bounds exclusions and fails closed on untyped overflow while keeping explicit agents", () => {
    let state = createAgentOutputParserState("claudeCode");
    for (let i = 0; i < 513; i++)
      state = feedAgentOutput(
        state,
        "stdout",
        line({ subtype: "task_started", task_id: `shell${i}`, task_type: "local_bash" }),
      ).state;
    expect(state.claudeSubagentClassification?.nonAgentTaskIds.size).toBe(512);
    const unknown = feedAgentOutput(
      state,
      "stdout",
      line({ subtype: "task_notification", task_id: "shell512", status: "completed" }),
    );
    expect(unknown.events.some((event) => event.kind === "subagent")).toBe(false);
    const explicit = feedAgentOutput(
      state,
      "stdout",
      line({
        subtype: "task_notification",
        task_id: "agent",
        task_type: "local_agent",
        status: "completed",
      }),
    );
    expect(explicit.events.some((event) => event.kind === "subagent")).toBe(true);
  });
});
