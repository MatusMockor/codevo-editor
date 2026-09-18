import { describe, it, expect } from "vitest";
import { parseClaudeStreamJsonLine } from "./claudeStreamJson";
const parse = (value: Record<string, unknown>) => {
  const result = parseClaudeStreamJsonLine(
    JSON.stringify({ type: "system", task_id: "task-1", ...value }),
  );
  return result.kind === "events"
    ? result.events.filter((event) => event.kind === "backgroundTask")
    : [];
};
describe("Claude native background task parsing", () => {
  it.each([
    ["monitor", "monitor"],
    ["monitor_mcp", "monitor"],
    ["local_bash", "shell"],
    ["shell", "shell"],
    ["local_agent", "agent"],
    ["unknown_new_type", "other"],
  ])("classifies %s factually", (native, normalized) => {
    expect(parse({ subtype: "task_started", task_type: native })).toEqual([
      { kind: "backgroundTask", taskId: "task-1", status: "starting", taskType: normalized },
    ]);
  });
  it.each(["completed", "failed", "stopped", "killed", "cancelled", "interrupted"])(
    "keeps terminal %s without task type",
    (status) => {
      expect(parse({ subtype: "task_notification", status })[0]?.status).toBe(
        status === "completed" || status === "failed" ? status : "stopped",
      );
    },
  );
  it("parses terminal patches and bounded descriptions", () => {
    expect(
      parse({
        subtype: "task_updated",
        patch: { status: "killed", description: "x".repeat(1000) },
      })[0],
    ).toMatchObject({ status: "stopped", description: "x".repeat(512) });
  });
  it.each([
    { task_type: "plan" },
    { task_type: "dream" },
    { parent_tool_use_id: "nested" },
    { task_id: "" },
    { task_id: "bad\u0000id" },
    { task_id: "x".repeat(257) },
  ])("rejects inert/nested/malformed task %j", (override) => {
    expect(parse({ subtype: "task_started", ...override })).toEqual([]);
  });
  it("rejects unknown status and status-free patches", () => {
    expect(parse({ subtype: "task_notification", status: "surprise" })).toEqual([]);
    expect(parse({ subtype: "task_updated", patch: { description: "hello" } })).toEqual([]);
  });
});
