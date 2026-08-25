import { defaultAgentLaunchOptions } from "../domain/agentLaunch";
import { describe, expect, it, vi } from "vitest";
import { AgentTaskStartRejectedError, type StartAgentTaskRequest } from "../domain/agentTask";
import {
  TauriAgentTaskGateway,
  type AgentTaskRuntimeDetector,
  type ListenToAgentTaskEvent,
} from "./tauriAgentTaskGateway";
import type { InvokeAgentTaskCommand } from "./tauriAgentTaskIpcContract";

const START_REQUEST: StartAgentTaskRequest = {
  taskId: "agt-1-0a1b",
  workspaceId: "ws-1",
  repositoryRoot: "/repo",
  cwd: "/repo",
  isolation: "in-place",
  prompt: "do the thing",
  agentCliPath: "/usr/local/bin/claude",
  agentCliKind: "claudeCode",
  resumeSessionId: null,
  launch: defaultAgentLaunchOptions("claudeCode"),
};

const available: AgentTaskRuntimeDetector = () => true;
const unavailable: AgentTaskRuntimeDetector = () => false;

describe("TauriAgentTaskGateway", () => {
  it("forwards only typed lifecycle requests", async () => {
    const invokeCommand = vi
      .fn<InvokeAgentTaskCommand>()
      .mockResolvedValueOnce({ taskId: "agt-1-0a1b" })
      .mockResolvedValue(null);
    const gateway = new TauriAgentTaskGateway(invokeCommand, vi.fn(), available);

    await gateway.startAgentTask(START_REQUEST);
    await gateway.acknowledgeAgentTaskStart({ taskId: "agt-1-0a1b", workspaceId: "ws-1" });
    await gateway.stopAgentTask({ taskId: "agt-1-0a1b", workspaceId: "ws-1" });
    await gateway.stopAgentTasksForRoot({ workspaceId: "ws-1", repositoryRoot: "/repo" });

    expect(invokeCommand.mock.calls.map(([command]) => command)).toEqual([
      "start_agent_task",
      "acknowledge_agent_task_start",
      "stop_agent_task",
      "stop_agent_tasks_for_root",
    ]);
  });

  it("classifies known backend admission and trust rejections as definite start failures", async () => {
    const invokeCommand = vi
      .fn<InvokeAgentTaskCommand>()
      .mockRejectedValueOnce("Too many agent tasks are starting or running.")
      .mockRejectedValueOnce("Agent tasks require a trusted repository.")
      .mockRejectedValueOnce("Failed to spawn the agent process.");
    const gateway = new TauriAgentTaskGateway(invokeCommand, vi.fn(), available);

    await expect(gateway.startAgentTask(START_REQUEST)).rejects.toBeInstanceOf(
      AgentTaskStartRejectedError,
    );
    await expect(gateway.startAgentTask(START_REQUEST)).rejects.toMatchObject({
      name: "AgentTaskStartRejectedError",
      message: "Agent tasks require a trusted repository.",
    });
    await expect(gateway.startAgentTask(START_REQUEST)).rejects.toSatisfy(
      (error: unknown) => !(error instanceof AgentTaskStartRejectedError),
    );
  });

  it("treats a missing native runtime as a definite start rejection", async () => {
    const gateway = new TauriAgentTaskGateway(vi.fn(), vi.fn(), unavailable);

    await expect(gateway.startAgentTask(START_REQUEST)).rejects.toBeInstanceOf(
      AgentTaskStartRejectedError,
    );
  });

  it("subscribes to the exact status channel and drops malformed payloads", async () => {
    let listener: ((event: { payload: unknown }) => void) | null = null;
    const unlisten = vi.fn();
    const listenToEvent = vi.fn<ListenToAgentTaskEvent>(async (name, handler) => {
      expect(name).toBe("agent-task://status");
      listener = handler;
      return unlisten;
    });
    const gateway = new TauriAgentTaskGateway(vi.fn(), listenToEvent, available);
    const handler = vi.fn();
    const unsubscribe = await gateway.subscribeAgentTaskStatus(handler);
    const deliver = listener as unknown as (event: { payload: unknown }) => void;

    expect(typeof deliver).toBe("function");
    deliver({ payload: { status: "running" } });
    deliver({ payload: null });
    deliver({
      payload: {
        taskId: "agt-1-0a1b",
        workspaceId: "ws-1",
        repositoryRoot: "/repo",
        isolation: "in-place",
        worktreePath: null,
        sequence: 1,
        status: "running",
      },
    });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({
      taskId: "agt-1-0a1b",
      workspaceId: "ws-1",
      repositoryRoot: "/repo",
      isolation: "in-place",
      worktreePath: null,
      sequence: 1,
      status: { kind: "running" },
    });
    unsubscribe();
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("subscribes to the exact output channel and drops malformed payloads", async () => {
    let listener: ((event: { payload: unknown }) => void) | null = null;
    const listenToEvent = vi.fn<ListenToAgentTaskEvent>(async (name, handler) => {
      expect(name).toBe("agent-task://output");
      listener = handler;
      return () => undefined;
    });
    const gateway = new TauriAgentTaskGateway(vi.fn(), listenToEvent, available);
    const handler = vi.fn();
    await gateway.subscribeAgentTaskOutput(handler);
    const deliver = listener as unknown as (event: { payload: unknown }) => void;

    deliver({ payload: { taskId: "agt-1-0a1b", sequence: 1, stream: "pipe" } });
    deliver({
      payload: {
        taskId: "agt-1-0a1b",
        sequence: 1,
        stream: "stdout",
        chunk: "hello",
        truncated: false,
      },
    });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({
      taskId: "agt-1-0a1b",
      sequence: 1,
      stream: "stdout",
      chunk: "hello",
      truncated: false,
    });
  });

  it("degrades to no-op defaults without the native runtime", async () => {
    const invokeCommand = vi.fn<InvokeAgentTaskCommand>();
    const listenToEvent = vi.fn<ListenToAgentTaskEvent>();
    const gateway = new TauriAgentTaskGateway(invokeCommand, listenToEvent, unavailable);

    await expect(gateway.startAgentTask(START_REQUEST)).rejects.toThrow(
      "Agent tasks require the native runtime.",
    );
    await gateway.acknowledgeAgentTaskStart({ taskId: "agt-1-0a1b", workspaceId: "ws-1" });
    await gateway.stopAgentTask({ taskId: "agt-1-0a1b", workspaceId: "ws-1" });
    await gateway.stopAgentTasksForRoot({ workspaceId: "ws-1", repositoryRoot: "/repo" });
    const unsubscribeStatus = await gateway.subscribeAgentTaskStatus(vi.fn());
    const unsubscribeOutput = await gateway.subscribeAgentTaskOutput(vi.fn());
    unsubscribeStatus();
    unsubscribeOutput();

    expect(invokeCommand).not.toHaveBeenCalled();
    expect(listenToEvent).not.toHaveBeenCalled();
  });

  it("rejects an invalid request before reaching the transport", async () => {
    const invokeCommand = vi.fn<InvokeAgentTaskCommand>();
    const gateway = new TauriAgentTaskGateway(invokeCommand, vi.fn(), available);

    await expect(gateway.startAgentTask({ ...START_REQUEST, agentCliPath: "" })).rejects.toThrow(
      TypeError,
    );
    expect(invokeCommand).not.toHaveBeenCalled();
  });
});
