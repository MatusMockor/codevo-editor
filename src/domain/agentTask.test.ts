import { describe, expect, it } from "vitest";
import {
  agentTasksReducer,
  clipAgentTaskOutputTail,
  defaultAgentTaskIsolation,
  emptyAgentTasksState,
  inPlaceDispatchGuard,
  isTerminalAgentTaskStatus,
  mintAgentTaskId,
  parseAgentTaskOutputEvent,
  parseAgentTaskStatusEvent,
  parseStartAgentTaskResult,
  validateAgentTaskReferenceRequest,
  validateStartAgentTaskRequest,
  validateStopAgentTasksForRootRequest,
  MAX_AGENT_TASK_RETAINED_OUTPUT_BYTES,
  MAX_RETAINED_AGENT_TASKS,
  type AgentTaskIsolationContext,
  type AgentTaskRecord,
  type AgentTaskStatus,
  type AgentTaskStatusEvent,
  type AgentTasksAction,
  type AgentTasksState,
} from "./agentTask";

const ENCODER = new TextEncoder();

function taskRecord(overrides: Partial<AgentTaskRecord> = {}): AgentTaskRecord {
  return {
    owner: { taskId: "agt-1-0a1b", workspaceId: "ws-1", repositoryRoot: "/repo" },
    isolation: "in-place",
    worktreePath: null,
    prompt: "do the thing",
    status: { kind: "pending" },
    outputTail: "",
    outputTruncated: false,
    lastStatusSequence: 0,
    lastOutputSequence: 0,
    startedAtEpochMs: 1_000,
    ...overrides,
  };
}

function statusEvent(overrides: Partial<AgentTaskStatusEvent> = {}): AgentTaskStatusEvent {
  return {
    taskId: "agt-1-0a1b",
    workspaceId: "ws-1",
    repositoryRoot: "/repo",
    isolation: "in-place",
    worktreePath: null,
    sequence: 1,
    status: { kind: "running" },
    ...overrides,
  };
}

function stateWith(...records: readonly AgentTaskRecord[]): AgentTasksState {
  return records.reduce(
    (state, record) => agentTasksReducer(state, { kind: "started", record }),
    emptyAgentTasksState(),
  );
}

function isolationContext(
  overrides: Partial<AgentTaskIsolationContext> = {},
): AgentTaskIsolationContext {
  return {
    workspacePolicy: "auto",
    repositoryStatusKnown: true,
    repositoryDirty: false,
    dirtyEditorDocumentsInRepository: 0,
    liveAgentTasksInRepository: 0,
    plannedParallelDispatch: false,
    ...overrides,
  };
}

function wireStatusEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    taskId: "agt-1-0a1b",
    workspaceId: "ws-1",
    repositoryRoot: "/repo",
    isolation: "in-place",
    worktreePath: null,
    sequence: 3,
    status: "running",
    ...overrides,
  };
}

function startRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    taskId: "agt-1-0a1b",
    workspaceId: "ws-1",
    repositoryRoot: "/repo",
    cwd: "/repo",
    isolation: "in-place",
    prompt: "do the thing",
    agentCliPath: "/usr/local/bin/claude",
    agentCliKind: "claudeCode",
    ...overrides,
  };
}

describe("agentTasksReducer", () => {
  it("registers a started task and ignores a duplicate start", () => {
    const record = taskRecord();
    const started = agentTasksReducer(emptyAgentTasksState(), { kind: "started", record });
    expect(started.tasks.get("agt-1-0a1b")).toEqual(record);

    const duplicate = agentTasksReducer(started, {
      kind: "started",
      record: taskRecord({ prompt: "replaced" }),
    });
    expect(duplicate).toBe(started);
  });

  it("advances pending to running to exited and then freezes the terminal status", () => {
    const running = agentTasksReducer(stateWith(taskRecord()), {
      kind: "statusEvent",
      event: statusEvent({ sequence: 1, status: { kind: "running" } }),
    });
    expect(running.tasks.get("agt-1-0a1b")?.status).toEqual({ kind: "running" });

    const exited = agentTasksReducer(running, {
      kind: "statusEvent",
      event: statusEvent({ sequence: 2, status: { kind: "exited", exitCode: 0 } }),
    });
    expect(exited.tasks.get("agt-1-0a1b")?.status).toEqual({ kind: "exited", exitCode: 0 });

    const afterTerminal = agentTasksReducer(exited, {
      kind: "statusEvent",
      event: statusEvent({ sequence: 3, status: { kind: "running" } }),
    });
    expect(afterTerminal).toBe(exited);
  });

  it("drops stale, duplicate, unknown, and foreign status events", () => {
    const state = agentTasksReducer(stateWith(taskRecord()), {
      kind: "statusEvent",
      event: statusEvent({ sequence: 5, status: { kind: "running" } }),
    });

    const dropped: readonly AgentTaskStatusEvent[] = [
      statusEvent({ sequence: 4, status: { kind: "stopped" } }),
      statusEvent({ sequence: 5, status: { kind: "stopped" } }),
      statusEvent({ sequence: 6, taskId: "agt-9-9999" }),
      statusEvent({ sequence: 6, workspaceId: "ws-2" }),
      statusEvent({ sequence: 6, repositoryRoot: "/other" }),
      statusEvent({ sequence: 6, isolation: "worktree", worktreePath: "/repo/.worktrees/a" }),
    ];
    for (const event of dropped) {
      expect(agentTasksReducer(state, { kind: "statusEvent", event })).toBe(state);
    }
  });

  it("drops a worktree status event that reports a different worktree path", () => {
    const state = stateWith(
      taskRecord({ isolation: "worktree", worktreePath: "/repo/.worktrees/agt-1-0a1b" }),
    );
    const event = statusEvent({
      isolation: "worktree",
      worktreePath: "/repo/.worktrees/other",
      status: { kind: "running" },
    });
    expect(agentTasksReducer(state, { kind: "statusEvent", event })).toBe(state);
  });

  it("appends output in sequence order and drops stale, unknown, and post-terminal chunks", () => {
    const first = agentTasksReducer(stateWith(taskRecord()), {
      kind: "outputEvent",
      event: { taskId: "agt-1-0a1b", sequence: 1, stream: "stdout", chunk: "a", truncated: false },
    });
    const second = agentTasksReducer(first, {
      kind: "outputEvent",
      event: { taskId: "agt-1-0a1b", sequence: 2, stream: "stderr", chunk: "b", truncated: false },
    });
    expect(second.tasks.get("agt-1-0a1b")?.outputTail).toBe("ab");
    expect(second.tasks.get("agt-1-0a1b")?.outputTruncated).toBe(false);

    const stale = agentTasksReducer(second, {
      kind: "outputEvent",
      event: { taskId: "agt-1-0a1b", sequence: 2, stream: "stdout", chunk: "x", truncated: false },
    });
    expect(stale).toBe(second);

    const unknown = agentTasksReducer(second, {
      kind: "outputEvent",
      event: { taskId: "agt-9-9999", sequence: 9, stream: "stdout", chunk: "x", truncated: false },
    });
    expect(unknown).toBe(second);

    const stopped = agentTasksReducer(second, {
      kind: "statusEvent",
      event: statusEvent({ sequence: 1, status: { kind: "stopped" } }),
    });
    const afterTerminal = agentTasksReducer(stopped, {
      kind: "outputEvent",
      event: { taskId: "agt-1-0a1b", sequence: 3, stream: "stdout", chunk: "c", truncated: false },
    });
    expect(afterTerminal).toBe(stopped);
  });

  it("keeps the truncation marker sticky once the backend reports truncation", () => {
    const truncated = agentTasksReducer(stateWith(taskRecord()), {
      kind: "outputEvent",
      event: { taskId: "agt-1-0a1b", sequence: 1, stream: "stdout", chunk: "a", truncated: true },
    });
    const later = agentTasksReducer(truncated, {
      kind: "outputEvent",
      event: { taskId: "agt-1-0a1b", sequence: 2, stream: "stdout", chunk: "b", truncated: false },
    });
    expect(later.tasks.get("agt-1-0a1b")?.outputTruncated).toBe(true);
  });

  it("clips the retained output tail on a UTF-8 boundary", () => {
    const chunk = "☃".repeat(2_730);
    const state = Array.from({ length: 33 }).reduce<AgentTasksState>(
      (current, _value, index) =>
        agentTasksReducer(current, {
          kind: "outputEvent",
          event: {
            taskId: "agt-1-0a1b",
            sequence: index + 1,
            stream: "stdout",
            chunk,
            truncated: false,
          },
        }),
      stateWith(taskRecord()),
    );

    const task = state.tasks.get("agt-1-0a1b");
    expect(task?.outputTruncated).toBe(true);
    expect(ENCODER.encode(task?.outputTail ?? "").byteLength).toBeLessThanOrEqual(
      MAX_AGENT_TASK_RETAINED_OUTPUT_BYTES,
    );
    expect(task?.outputTail.includes("�")).toBe(false);
    expect(task?.outputTail.startsWith("☃")).toBe(true);
  });

  it("dismisses a known task and leaves the state untouched for an unknown one", () => {
    const state = stateWith(taskRecord());
    expect(agentTasksReducer(state, { kind: "dismissed", taskId: "agt-9-9999" })).toBe(state);
    expect(agentTasksReducer(state, { kind: "dismissed", taskId: "agt-1-0a1b" }).tasks.size).toBe(
      0,
    );
  });

  it("keeps live foreign tasks on workspace replacement and drops terminal foreign history", () => {
    const state = stateWith(
      taskRecord(),
      taskRecord({
        owner: { taskId: "agt-2-0a1b", workspaceId: "ws-2", repositoryRoot: "/repo" },
        status: { kind: "running" },
      }),
      taskRecord({
        owner: { taskId: "agt-3-0a1b", workspaceId: "ws-2", repositoryRoot: "/repo" },
        status: { kind: "exited", exitCode: 0 },
      }),
    );
    const replaced = agentTasksReducer(state, { kind: "workspaceReplaced", workspaceId: "ws-1" });
    expect([...replaced.tasks.keys()]).toEqual(["agt-1-0a1b", "agt-2-0a1b"]);
    expect(agentTasksReducer(replaced, { kind: "workspaceReplaced", workspaceId: "ws-1" })).toBe(
      replaced,
    );
  });

  it("drops terminal tasks owned by a released project", () => {
    const state = stateWith(
      taskRecord({ status: { kind: "exited", exitCode: 0 } }),
      taskRecord({
        owner: { taskId: "agt-2-0a1b", workspaceId: "ws-1", repositoryRoot: "/repo" },
        status: { kind: "failed", message: "boom" },
      }),
    );

    expect(agentTasksReducer(state, { kind: "projectReleased", ownerId: "ws-1" }).tasks.size).toBe(
      0,
    );
  });

  it("retains live tasks owned by a released project", () => {
    const state = stateWith(
      taskRecord({ status: { kind: "running" } }),
      taskRecord({
        owner: { taskId: "agt-2-0a1b", workspaceId: "ws-1", repositoryRoot: "/repo" },
        status: { kind: "stopped" },
      }),
    );
    const released = agentTasksReducer(state, { kind: "projectReleased", ownerId: "ws-1" });

    expect([...released.tasks.keys()]).toEqual(["agt-1-0a1b"]);
  });

  it("leaves tasks owned by other projects untouched on project release", () => {
    const state = stateWith(
      taskRecord({ status: { kind: "exited", exitCode: 0 } }),
      taskRecord({
        owner: { taskId: "agt-2-0a1b", workspaceId: "ws-2", repositoryRoot: "/repo" },
        status: { kind: "stopped" },
      }),
    );
    const released = agentTasksReducer(state, { kind: "projectReleased", ownerId: "ws-1" });

    expect([...released.tasks.keys()]).toEqual(["agt-2-0a1b"]);
    expect(released.tasks.get("agt-2-0a1b")).toBe(state.tasks.get("agt-2-0a1b"));
  });

  it("leaves the state untouched when a released project owns no tasks", () => {
    const state = stateWith(taskRecord());
    expect(agentTasksReducer(state, { kind: "projectReleased", ownerId: "ws-2" })).toBe(state);
  });

  it("evicts the oldest terminal task first and never a live one", () => {
    const terminal = (index: number, startedAtEpochMs: number): AgentTaskRecord =>
      taskRecord({
        owner: {
          taskId: `agt-t${index}-0a1b`,
          workspaceId: "ws-1",
          repositoryRoot: "/repo",
        },
        status: { kind: "exited", exitCode: 0 },
        startedAtEpochMs,
      });
    const live = (index: number): AgentTaskRecord =>
      taskRecord({
        owner: {
          taskId: `agt-l${index}-0a1b`,
          workspaceId: "ws-1",
          repositoryRoot: "/repo",
        },
        status: { kind: "running" },
        startedAtEpochMs: 1,
      });

    const records = [
      ...Array.from({ length: MAX_RETAINED_AGENT_TASKS - 1 }, (_value, index) => live(index)),
      terminal(0, 10),
      terminal(1, 20),
    ];
    const state = stateWith(...records);

    expect(state.tasks.size).toBe(MAX_RETAINED_AGENT_TASKS);
    expect(state.tasks.has("agt-t0-0a1b")).toBe(false);
    expect(state.tasks.has("agt-t1-0a1b")).toBe(true);
    expect(state.tasks.has("agt-l0-0a1b")).toBe(true);
  });

  it("keeps every live task even when the retention cap is exceeded", () => {
    const records = Array.from({ length: MAX_RETAINED_AGENT_TASKS + 2 }, (_value, index) =>
      taskRecord({
        owner: {
          taskId: `agt-l${index}-0a1b`,
          workspaceId: "ws-1",
          repositoryRoot: "/repo",
        },
        status: { kind: "running" },
      }),
    );
    expect(stateWith(...records).tasks.size).toBe(MAX_RETAINED_AGENT_TASKS + 2);
  });

  it("breaks eviction ties by task id", () => {
    const terminalAt = (taskId: string): AgentTaskRecord =>
      taskRecord({
        owner: { taskId, workspaceId: "ws-1", repositoryRoot: "/repo" },
        status: { kind: "stopped" },
        startedAtEpochMs: 5,
      });
    const records = [
      ...Array.from({ length: MAX_RETAINED_AGENT_TASKS - 1 }, (_value, index) =>
        taskRecord({
          owner: {
            taskId: `agt-l${index}-0a1b`,
            workspaceId: "ws-1",
            repositoryRoot: "/repo",
          },
          status: { kind: "running" },
        }),
      ),
      terminalAt("agt-zz-0a1b"),
      terminalAt("agt-aa-0a1b"),
    ];
    const state = stateWith(...records);
    expect(state.tasks.has("agt-aa-0a1b")).toBe(false);
    expect(state.tasks.has("agt-zz-0a1b")).toBe(true);
  });

  it("rejects an unsupported action kind fail closed", () => {
    const action = { kind: "unknown" } as unknown as AgentTasksAction;
    expect(() => agentTasksReducer(emptyAgentTasksState(), action)).toThrow(
      "Unsupported agent task action",
    );
  });
});

describe("isTerminalAgentTaskStatus", () => {
  it("classifies every status of the closed union", () => {
    const table: ReadonlyArray<readonly [AgentTaskStatus, boolean]> = [
      [{ kind: "pending" }, false],
      [{ kind: "running" }, false],
      [{ kind: "exited", exitCode: 1 }, true],
      [{ kind: "failed", message: "boom" }, true],
      [{ kind: "stopped" }, true],
    ];
    for (const [status, terminal] of table) {
      expect(isTerminalAgentTaskStatus(status)).toBe(terminal);
    }
  });
});

describe("clipAgentTaskOutputTail", () => {
  it("keeps short text untouched", () => {
    expect(clipAgentTaskOutputTail("hello")).toEqual({ text: "hello", clipped: false });
  });

  it("never splits a multi-byte character when clipping to the tail", () => {
    const text = "☃".repeat(87_382);
    const clip = clipAgentTaskOutputTail(text);
    expect(clip.clipped).toBe(true);
    expect(clip.text.includes("�")).toBe(false);
    expect(ENCODER.encode(clip.text).byteLength).toBe(MAX_AGENT_TASK_RETAINED_OUTPUT_BYTES - 1);
    expect([...clip.text].every((character) => character === "☃")).toBe(true);
  });
});

describe("mintAgentTaskId", () => {
  it("mints a safe agent task id", () => {
    expect(mintAgentTaskId(1_735_000_000_000, "0f3a")).toBe("agt-m51q7bwg-0f3a");
  });

  it("rejects invalid clocks and entropy", () => {
    expect(() => mintAgentTaskId(-1, "0f3a")).toThrow("Invalid agent task value");
    expect(() => mintAgentTaskId(1.5, "0f3a")).toThrow("Invalid agent task value");
    expect(() => mintAgentTaskId(1_000, "0F3A")).toThrow("Invalid agent task value");
    expect(() => mintAgentTaskId(1_000, "0f3")).toThrow("Invalid agent task value");
  });
});

describe("defaultAgentTaskIsolation", () => {
  it("resolves the pinned precedence order", () => {
    expect(defaultAgentTaskIsolation(isolationContext({ workspacePolicy: "worktree" }))).toEqual({
      kind: "worktree",
      reason: "policy",
    });
    expect(
      defaultAgentTaskIsolation(
        isolationContext({ workspacePolicy: "in-place", liveAgentTasksInRepository: 1 }),
      ),
    ).toEqual({ kind: "worktree", reason: "agent-active" });
    expect(
      defaultAgentTaskIsolation(
        isolationContext({ workspacePolicy: "in-place", plannedParallelDispatch: true }),
      ),
    ).toEqual({ kind: "worktree", reason: "parallel-dispatch" });
    expect(
      defaultAgentTaskIsolation(
        isolationContext({
          workspacePolicy: "in-place",
          repositoryStatusKnown: false,
          repositoryDirty: true,
          dirtyEditorDocumentsInRepository: 3,
        }),
      ),
    ).toEqual({ kind: "in-place" });
    expect(defaultAgentTaskIsolation(isolationContext({ repositoryStatusKnown: false }))).toEqual({
      kind: "worktree",
      reason: "status-unknown",
    });
    expect(defaultAgentTaskIsolation(isolationContext({ repositoryDirty: true }))).toEqual({
      kind: "worktree",
      reason: "dirty-tree",
    });
    expect(
      defaultAgentTaskIsolation(isolationContext({ dirtyEditorDocumentsInRepository: 1 })),
    ).toEqual({ kind: "worktree", reason: "dirty-editors" });
    expect(defaultAgentTaskIsolation(isolationContext())).toEqual({ kind: "in-place" });
  });
});

describe("inPlaceDispatchGuard", () => {
  it("reports a safe clean repository", () => {
    expect(inPlaceDispatchGuard(isolationContext())).toEqual({ kind: "safe" });
  });

  it("ignores a planned parallel dispatch, which is a preference and not a hazard", () => {
    expect(inPlaceDispatchGuard(isolationContext({ plannedParallelDispatch: true }))).toEqual({
      kind: "safe",
    });
  });

  it("collects every hazard in a deterministic order", () => {
    expect(
      inPlaceDispatchGuard(
        isolationContext({
          liveAgentTasksInRepository: 2,
          repositoryDirty: true,
          dirtyEditorDocumentsInRepository: 1,
        }),
      ),
    ).toEqual({ kind: "unsafe", reasons: ["agent-active", "dirty-tree", "dirty-editors"] });
  });

  it("reports an unknown repository status without claiming a dirty tree", () => {
    expect(
      inPlaceDispatchGuard(
        isolationContext({ repositoryStatusKnown: false, repositoryDirty: true }),
      ),
    ).toEqual({ kind: "unsafe", reasons: ["status-unknown"] });
  });
});

describe("parseAgentTaskStatusEvent", () => {
  it("parses every status variant of the wire union", () => {
    expect(parseAgentTaskStatusEvent(wireStatusEvent({ status: "pending" })).status).toEqual({
      kind: "pending",
    });
    expect(
      parseAgentTaskStatusEvent(wireStatusEvent({ status: "exited", exitCode: -1 })).status,
    ).toEqual({ kind: "exited", exitCode: -1 });
    expect(
      parseAgentTaskStatusEvent(wireStatusEvent({ status: "failed", message: "boom" })).status,
    ).toEqual({ kind: "failed", message: "boom" });
    expect(parseAgentTaskStatusEvent(wireStatusEvent({ status: "stopped" })).status).toEqual({
      kind: "stopped",
    });
  });

  it("parses a worktree event with its worktree path", () => {
    const event = parseAgentTaskStatusEvent(
      wireStatusEvent({ isolation: "worktree", worktreePath: "/repo/.worktrees/agt-1-0a1b" }),
    );
    expect(event.worktreePath).toBe("/repo/.worktrees/agt-1-0a1b");
  });

  it("rejects malformed events fail closed", () => {
    const rejected: readonly unknown[] = [
      null,
      [],
      wireStatusEvent({ extra: 1 }),
      wireStatusEvent({ status: "unknown" }),
      wireStatusEvent({ status: "exited" }),
      wireStatusEvent({ status: "exited", exitCode: 1.5 }),
      wireStatusEvent({ status: "failed" }),
      wireStatusEvent({ status: "failed", message: "" }),
      wireStatusEvent({ sequence: -1 }),
      wireStatusEvent({ taskId: "AGT-1" }),
      wireStatusEvent({ taskId: "-agt-1" }),
      wireStatusEvent({ workspaceId: "" }),
      wireStatusEvent({ repositoryRoot: "   " }),
      wireStatusEvent({ isolation: "inPlace" }),
      wireStatusEvent({ worktreePath: "/repo/.worktrees/agt-1-0a1b" }),
      wireStatusEvent({ isolation: "worktree", worktreePath: null }),
    ];
    for (const value of rejected) {
      expect(() => parseAgentTaskStatusEvent(value)).toThrow(TypeError);
    }
  });
});

describe("parseAgentTaskOutputEvent", () => {
  it("parses a bounded chunk including the empty truncation marker", () => {
    expect(
      parseAgentTaskOutputEvent({
        taskId: "agt-1-0a1b",
        sequence: 7,
        stream: "stderr",
        chunk: "",
        truncated: true,
      }),
    ).toEqual({
      taskId: "agt-1-0a1b",
      sequence: 7,
      stream: "stderr",
      chunk: "",
      truncated: true,
    });
  });

  it("rejects malformed chunks fail closed", () => {
    const base = {
      taskId: "agt-1-0a1b",
      sequence: 7,
      stream: "stdout",
      chunk: "ok",
      truncated: false,
    };
    const rejected: readonly unknown[] = [
      { ...base, stream: "both" },
      { ...base, truncated: "yes" },
      { ...base, chunk: "x".repeat(8 * 1_024 + 1) },
      { ...base, chunk: "nul\u0000" },
      { ...base, extra: true },
    ];
    for (const value of rejected) {
      expect(() => parseAgentTaskOutputEvent(value)).toThrow(TypeError);
    }
  });
});

describe("validateStartAgentTaskRequest", () => {
  it("accepts a bounded in-place request whose cwd is the repository root", () => {
    expect(validateStartAgentTaskRequest(startRequest())).toEqual(startRequest());
  });

  it("accepts a worktree request whose cwd differs from the repository root", () => {
    const request = startRequest({
      isolation: "worktree",
      cwd: "/repo/.worktrees/agt-1-0a1b",
      agentCliKind: "codex",
    });
    expect(validateStartAgentTaskRequest(request)).toEqual(request);
  });

  it("rejects out-of-bounds and inconsistent requests", () => {
    const rejected: readonly unknown[] = [
      startRequest({ cwd: "/repo/.worktrees/agt-1-0a1b" }),
      startRequest({ prompt: "" }),
      startRequest({ prompt: "x".repeat(32 * 1_024 + 1) }),
      startRequest({ agentCliPath: "" }),
      startRequest({ agentCliKind: "codexExec" }),
      startRequest({ taskId: "ag" }),
      startRequest({ workspaceId: "ws" }),
      startRequest({ extra: 1 }),
    ];
    for (const value of rejected) {
      expect(() => validateStartAgentTaskRequest(value)).toThrow(TypeError);
    }
  });
});

describe("agent task reference requests", () => {
  it("validates the acknowledge and stop payloads", () => {
    expect(
      validateAgentTaskReferenceRequest({ taskId: "agt-1-0a1b", workspaceId: "ws-1" }),
    ).toEqual({ taskId: "agt-1-0a1b", workspaceId: "ws-1" });
    expect(() =>
      validateAgentTaskReferenceRequest({ taskId: "agt-1-0a1b", workspaceId: "ws-1", extra: 1 }),
    ).toThrow(TypeError);
  });

  it("validates the stop-for-root payload", () => {
    expect(
      validateStopAgentTasksForRootRequest({ workspaceId: "ws-1", repositoryRoot: "/repo" }),
    ).toEqual({ workspaceId: "ws-1", repositoryRoot: "/repo" });
    expect(() =>
      validateStopAgentTasksForRootRequest({ workspaceId: "ws-1", repositoryRoot: "" }),
    ).toThrow(TypeError);
  });

  it("parses the echoed start result", () => {
    expect(parseStartAgentTaskResult({ taskId: "agt-1-0a1b" })).toEqual({ taskId: "agt-1-0a1b" });
    expect(() => parseStartAgentTaskResult({ taskId: "agt-1-0a1b", extra: 1 })).toThrow(TypeError);
  });
});
