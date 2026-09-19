import { describe, expect, it } from "vitest";
import {
  parseAgentSubagentLifecycle,
  retainAgentSubagentLifecycle,
} from "./agentSubagentLifecycle";
import type { AgentTurnEvent } from "./agentThread";
const spawn = (toolId: string): AgentTurnEvent => ({
  kind: "toolCall",
  toolId,
  name: "Agent",
  inputSummary: "private full prompt",
  description: "Review code",
});
describe("retained subagent lifecycle", () => {
  it("settles cancelled Claude agents without counting stopped shell commands", () => {
    const started = retainAgentSubagentLifecycle(undefined, [
      spawn("tool"),
      { kind: "subagent", status: "starting", toolId: "tool", taskId: "agent-task" },
    ]);
    const stopped = retainAgentSubagentLifecycle(started, [
      { kind: "backgroundTask", taskId: "shell-task", taskType: "shell", status: "stopped" },
      { kind: "backgroundTask", taskId: "unknown-task", taskType: "other", status: "stopped" },
      { kind: "backgroundTask", taskId: "agent-task", taskType: "other", status: "stopped" },
    ]);
    expect(stopped?.entries).toHaveLength(1);
    expect(stopped?.entries[0].state).toBe("interrupted");
    expect(parseAgentSubagentLifecycle(JSON.parse(JSON.stringify(stopped)))).toEqual(stopped);
    expect(
      retainAgentSubagentLifecycle(stopped, [
        { kind: "subagent", taskId: "agent-task", status: "running" },
        { kind: "subagent", taskId: "agent-task", status: "starting" },
      ])?.entries[0].state,
    ).toBe("interrupted");
    expect(
      retainAgentSubagentLifecycle(started, [
        { kind: "backgroundTask", taskId: "agent-task", taskType: "shell", status: "stopped" },
      ])?.entries[0].state,
    ).toBe("running");
  });
  it("retains only bounded metadata and merges task/tool aliases after output eviction", () => {
    const started = retainAgentSubagentLifecycle(undefined, [
      spawn("tool"),
      { kind: "subagent", status: "starting", toolId: "tool", taskId: "task" },
      { kind: "toolResult", toolId: "tool", outputSummary: "background launched", isError: false },
    ]);
    expect(started?.entries).toHaveLength(1);
    expect(started?.entries[0]).toMatchObject({ state: "running", description: "Review code" });
    expect(JSON.stringify(started)).not.toContain("private full prompt");
    const restored = parseAgentSubagentLifecycle(JSON.parse(JSON.stringify(started)));
    const completed = retainAgentSubagentLifecycle(restored, [
      { kind: "subagent", status: "completed", taskId: "task" },
    ]);
    expect(completed?.entries[0].state).toBe("completed");
    expect(
      retainAgentSubagentLifecycle(completed, [
        { kind: "subagent", status: "running", taskId: "task" },
      ])?.entries[0].state,
    ).toBe("completed");
  });
  it("merges late tool/task aliases and remains reloadable", () => {
    const snapshot = retainAgentSubagentLifecycle(undefined, [
      spawn("t"),
      { kind: "subagent", taskId: "a", status: "completed" },
      { kind: "subagent", toolId: "t", taskId: "a", status: "running" },
    ]);
    expect(snapshot?.entries).toHaveLength(1);
    expect(snapshot?.entries[0]).toMatchObject({ toolId: "t", taskId: "a", state: "completed" });
    expect(parseAgentSubagentLifecycle(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
  });
  it("prefers Codex child identity over spawn acknowledgements without double counting", () => {
    const events: AgentTurnEvent[] = [
      { kind: "toolCall", toolId: "spawn", name: "spawn_agent", inputSummary: "prompt" },
      {
        kind: "subagentActivity",
        agentThreadId: "child",
        agentPath: "worker",
        activity: "started",
      },
      { kind: "toolResult", toolId: "spawn", outputSummary: "ok", isError: false },
      { kind: "subagentTurnDone", agentThreadId: "child", durationMs: 10, isError: false },
    ];
    const snapshot = retainAgentSubagentLifecycle(undefined, events);
    expect(snapshot?.entries).toHaveLength(1);
    expect(snapshot?.entries[0]).toMatchObject({ agentThreadId: "child", state: "completed" });
  });
  it("starts a new Codex child turn only on explicit interaction, not duplicate start", () => {
    const completed = retainAgentSubagentLifecycle(undefined, [
      { kind: "subagentTurnDone", agentThreadId: "child", durationMs: 10, isError: false },
    ]);
    const duplicate = retainAgentSubagentLifecycle(completed, [
      {
        kind: "subagentActivity",
        agentThreadId: "child",
        agentPath: "worker",
        activity: "started",
      },
    ]);
    expect(duplicate?.entries[0].state).toBe("completed");
    const resumed = retainAgentSubagentLifecycle(duplicate, [
      {
        kind: "subagentActivity",
        agentThreadId: "child",
        agentPath: "worker",
        activity: "interacted",
      },
    ]);
    expect(resumed?.entries[0].state).toBe("running");
  });
  it("retains interrupted child status distinctly and permits explicit resume", () => {
    const interrupted = retainAgentSubagentLifecycle(undefined, [
      {
        kind: "subagentActivity",
        agentThreadId: "child",
        agentPath: "worker",
        activity: "interrupted",
      },
    ]);
    expect(interrupted?.entries[0].state).toBe("interrupted");
    expect(parseAgentSubagentLifecycle(interrupted)).toEqual(interrupted);
    const resumed = retainAgentSubagentLifecycle(interrupted, [
      {
        kind: "subagentActivity",
        agentThreadId: "child",
        agentPath: "worker",
        activity: "interacted",
      },
    ]);
    expect(resumed?.entries[0].state).toBe("running");
  });
  it("caps identity tombstones at32 and reports incomplete counts", () => {
    const snapshot = retainAgentSubagentLifecycle(
      undefined,
      Array.from({ length: 40 }, (_, i) => spawn(`tool${i}`)),
    );
    expect(snapshot?.entries).toHaveLength(32);
    expect(snapshot?.truncated).toBe(true);
    const ended = retainAgentSubagentLifecycle(snapshot, [
      { kind: "toolResult", toolId: "tool0", isError: true, outputSummary: "failed" },
    ]);
    expect(ended?.entries[0].state).toBe("failed");
    expect(ended?.entries).toHaveLength(32);
  });
  it("clips Unicode labels at byte bounds and does not retain invalid identities", () => {
    const snapshot = retainAgentSubagentLifecycle(undefined, [
      {
        kind: "subagent",
        toolId: "t",
        status: "starting",
        subagentType: "😀".repeat(100),
        description: "😀".repeat(200),
        lastToolName: "😀".repeat(100),
      },
      spawn("x".repeat(257)),
    ]);
    expect(snapshot?.truncated).toBe(true);
    expect(snapshot?.entries).toHaveLength(1);
    expect(new TextEncoder().encode(snapshot?.entries[0].name)).toHaveLength(128);
    expect(new TextEncoder().encode(snapshot?.entries[0].description)).toHaveLength(512);
    expect(parseAgentSubagentLifecycle(snapshot)).toEqual(snapshot);
  });
  it("ignores unrelated tool output and child logs without changing metadata", () => {
    const open = retainAgentSubagentLifecycle(undefined, [spawn("t")]);
    const events: AgentTurnEvent[] = [
      { kind: "toolResult", toolId: "unrelated", isError: false, outputSummary: "raw" },
      { kind: "toolCall", parentToolId: "t", toolId: "read", name: "Read", inputSummary: "file" },
    ];
    const snapshot = retainAgentSubagentLifecycle(open, events);
    expect(snapshot?.entries).toEqual(open?.entries);
    expect(snapshot?.openBatchKey).toBeUndefined();
    expect(retainAgentSubagentLifecycle(snapshot, events)).toBe(snapshot);
  });
  it("accepts omitted old metadata and rejects malformed persistence", () => {
    expect(parseAgentSubagentLifecycle(undefined)).toBeUndefined();
    const snapshot = retainAgentSubagentLifecycle(undefined, [spawn("t")])!;
    for (const invalid of [
      null,
      { ...snapshot, unknown: true },
      { ...snapshot, truncated: 1 },
      { ...snapshot, entries: [snapshot.entries[0], snapshot.entries[0]] },
      { ...snapshot, entries: [{ ...snapshot.entries[0], state: "completed" }] },
      { ...snapshot, entries: [{ ...snapshot.entries[0], steps: -1 }] },
      { ...snapshot, entries: [{ ...snapshot.entries[0], description: "x".repeat(513) }] },
    ])
      expect(() => parseAgentSubagentLifecycle(invalid)).toThrow();
  });
});
