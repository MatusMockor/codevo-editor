import { describe, expect, it, vi } from "vitest";
import type { StartAgentTaskRequest } from "../domain/agentTask";
import {
  ACKNOWLEDGE_AGENT_TASK_START_IPC_COMMAND,
  AGENT_TASK_OUTPUT_EVENT,
  AGENT_TASK_STATUS_EVENT,
  decodeAgentTaskOutputEvent,
  decodeAgentTaskStatusEvent,
  invokeAcknowledgeAgentTaskStartIpc,
  invokeStartAgentTaskIpc,
  invokeStopAgentTaskIpc,
  invokeStopAgentTasksForRootIpc,
  START_AGENT_TASK_IPC_COMMAND,
  STOP_AGENT_TASK_IPC_COMMAND,
  STOP_AGENT_TASKS_FOR_ROOT_IPC_COMMAND,
  type InvokeAgentTaskCommand,
} from "./tauriAgentTaskIpcContract";

const START_REQUEST: StartAgentTaskRequest = {
  taskId: "agt-1-0a1b",
  workspaceId: "ws-1",
  repositoryRoot: "/repo",
  cwd: "/repo/.worktrees/agt-1-0a1b",
  isolation: "worktree",
  prompt: "do the thing",
  agentCliPath: "/usr/local/bin/claude",
  agentCliKind: "claudeCode",
  resumeSessionId: null,
};

describe("agent task IPC command names", () => {
  it("pins the multi-word snake_case commands and the two event channels", () => {
    expect(START_AGENT_TASK_IPC_COMMAND).toBe("start_agent_task");
    expect(ACKNOWLEDGE_AGENT_TASK_START_IPC_COMMAND).toBe("acknowledge_agent_task_start");
    expect(STOP_AGENT_TASK_IPC_COMMAND).toBe("stop_agent_task");
    expect(STOP_AGENT_TASKS_FOR_ROOT_IPC_COMMAND).toBe("stop_agent_tasks_for_root");
    expect(AGENT_TASK_STATUS_EVENT).toBe("agent-task://status");
    expect(AGENT_TASK_OUTPUT_EVENT).toBe("agent-task://output");
  });
});

describe("invokeStartAgentTaskIpc", () => {
  it("sends the validated request and returns the echoed task id", async () => {
    const invokeCommand = vi
      .fn<InvokeAgentTaskCommand>()
      .mockResolvedValue({ taskId: "agt-1-0a1b" });

    await expect(invokeStartAgentTaskIpc(invokeCommand, START_REQUEST)).resolves.toEqual({
      taskId: "agt-1-0a1b",
    });
    expect(invokeCommand).toHaveBeenCalledWith("start_agent_task", { request: START_REQUEST });
  });

  it("rejects an out-of-bounds request before touching the transport", async () => {
    const invokeCommand = vi.fn<InvokeAgentTaskCommand>();

    await expect(
      invokeStartAgentTaskIpc(invokeCommand, { ...START_REQUEST, prompt: "" }),
    ).rejects.toThrow(TypeError);
    await expect(
      invokeStartAgentTaskIpc(invokeCommand, {
        ...START_REQUEST,
        isolation: "in-place",
        cwd: "/elsewhere",
      }),
    ).rejects.toThrow(TypeError);
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("rejects a mismatched task id echo", async () => {
    const invokeCommand = vi
      .fn<InvokeAgentTaskCommand>()
      .mockResolvedValue({ taskId: "agt-2-0a1b" });

    await expect(invokeStartAgentTaskIpc(invokeCommand, START_REQUEST)).rejects.toThrow(
      "expected the requested task id",
    );
  });

  it("rejects a malformed start result", async () => {
    const invokeCommand = vi.fn<InvokeAgentTaskCommand>().mockResolvedValue({});

    await expect(invokeStartAgentTaskIpc(invokeCommand, START_REQUEST)).rejects.toThrow(TypeError);
  });
});

describe("agent task unit commands", () => {
  it("sends validated acknowledge, stop, and stop-for-root payloads", async () => {
    const invokeCommand = vi.fn<InvokeAgentTaskCommand>().mockResolvedValue(null);
    const reference = { taskId: "agt-1-0a1b", workspaceId: "ws-1" };

    await invokeAcknowledgeAgentTaskStartIpc(invokeCommand, reference);
    await invokeStopAgentTaskIpc(invokeCommand, reference);
    await invokeStopAgentTasksForRootIpc(invokeCommand, {
      workspaceId: "ws-1",
      repositoryRoot: "/repo",
    });

    expect(invokeCommand.mock.calls.map(([command]) => command)).toEqual([
      "acknowledge_agent_task_start",
      "stop_agent_task",
      "stop_agent_tasks_for_root",
    ]);
  });

  it("rejects a non-null unit result", async () => {
    const invokeCommand = vi.fn<InvokeAgentTaskCommand>().mockResolvedValue({});

    await expect(
      invokeStopAgentTaskIpc(invokeCommand, { taskId: "agt-1-0a1b", workspaceId: "ws-1" }),
    ).rejects.toThrow("expected null");
  });

  it("rejects an unsafe task id before touching the transport", async () => {
    const invokeCommand = vi.fn<InvokeAgentTaskCommand>().mockResolvedValue(null);

    await expect(
      invokeStopAgentTaskIpc(invokeCommand, { taskId: "AGT-1", workspaceId: "ws-1" }),
    ).rejects.toThrow(TypeError);
    expect(invokeCommand).not.toHaveBeenCalled();
  });
});

describe("agent task event decoders", () => {
  it("decodes the pinned wire shapes", () => {
    expect(
      decodeAgentTaskStatusEvent({
        taskId: "agt-1-0a1b",
        workspaceId: "ws-1",
        repositoryRoot: "/repo",
        isolation: "in-place",
        worktreePath: null,
        sequence: 2,
        status: "exited",
        exitCode: 0,
      }),
    ).toEqual({
      taskId: "agt-1-0a1b",
      workspaceId: "ws-1",
      repositoryRoot: "/repo",
      isolation: "in-place",
      worktreePath: null,
      sequence: 2,
      status: { kind: "exited", exitCode: 0 },
    });

    expect(
      decodeAgentTaskOutputEvent({
        taskId: "agt-1-0a1b",
        sequence: 1,
        stream: "stdout",
        chunk: "hello",
        truncated: false,
      }),
    ).toEqual({
      taskId: "agt-1-0a1b",
      sequence: 1,
      stream: "stdout",
      chunk: "hello",
      truncated: false,
    });
  });

  it("rejects unknown wire fields", () => {
    expect(() => decodeAgentTaskStatusEvent({ status: "running" })).toThrow(TypeError);
    expect(() => decodeAgentTaskOutputEvent({ taskId: "agt-1-0a1b" })).toThrow(TypeError);
  });
});
