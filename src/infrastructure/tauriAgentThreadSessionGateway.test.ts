import { describe, expect, it, vi } from "vitest";
import { defaultAgentLaunchOptions } from "../domain/agentLaunch";
import {
  AGENT_SESSION_BACKGROUND_TURN_EVENT,
  AGENT_SESSION_ENDED_EVENT,
} from "../domain/agentThreadSession";
import {
  END_AGENT_THREAD_SESSION_IPC_COMMAND,
  INSPECT_AGENT_THREAD_SESSION_IPC_COMMAND,
  INTERRUPT_AGENT_TASK_IPC_COMMAND,
  TauriAgentThreadSessionGateway,
} from "./tauriAgentThreadSessionGateway";

type Deliver = (event: { payload: unknown }) => void;

function capturingListen() {
  const handlers = new Map<string, Deliver>();
  const unsubscribe = vi.fn();
  const listen = vi.fn(async (event: string, handler: Deliver) => {
    handlers.set(event, handler);
    return unsubscribe;
  });
  return {
    listen,
    unsubscribe,
    deliver: (event: string, payload: unknown) => handlers.get(event)?.({ payload }),
  };
}

describe("TauriAgentThreadSessionGateway", () => {
  it("invokes closed commands and parses their results", async () => {
    const results = new Map<string, unknown>([
      [INTERRUPT_AGENT_TASK_IPC_COMMAND, { kind: "interrupting" }],
      [INSPECT_AGENT_THREAD_SESSION_IPC_COMMAND, { kind: "restart", backgroundTasks: true }],
      [END_AGENT_THREAD_SESSION_IPC_COMMAND, { ended: true }],
    ]);
    const invoke = vi.fn(async (command: string) => {
      expect(results.has(command)).toBe(true);
      return results.get(command);
    });
    const gateway = new TauriAgentThreadSessionGateway(invoke, vi.fn(), () => true);
    await expect(
      gateway.interruptAgentTask({
        taskId: "agt-1-0a1b",
        workspaceId: "ws-1",
        threadId: "agt-1-0a1c",
      }),
    ).resolves.toEqual({ kind: "interrupting" });
    await expect(
      gateway.inspectAgentThreadSession({
        workspaceId: "ws-1",
        threadId: "agt-1-0a1c",
        resumeSessionId: null,
        launch: defaultAgentLaunchOptions("claudeCode"),
      }),
    ).resolves.toEqual({ kind: "restart", backgroundTasks: true });
    await expect(
      gateway.endAgentThreadSession({ workspaceId: "ws-1", threadId: "agt-1-0a1c" }),
    ).resolves.toBe(true);
    expect(INTERRUPT_AGENT_TASK_IPC_COMMAND).toBe("interrupt_agent_task");
    expect(INSPECT_AGENT_THREAD_SESSION_IPC_COMMAND).toBe("inspect_agent_thread_session");
    expect(END_AGENT_THREAD_SESSION_IPC_COMMAND).toBe("end_agent_thread_session");
    expect(invoke).toHaveBeenCalledWith(INTERRUPT_AGENT_TASK_IPC_COMMAND, {
      request: { taskId: "agt-1-0a1b", workspaceId: "ws-1", threadId: "agt-1-0a1c" },
    });
    expect(invoke).toHaveBeenCalledWith(END_AGENT_THREAD_SESSION_IPC_COMMAND, {
      request: { workspaceId: "ws-1", threadId: "agt-1-0a1c" },
    });
  });

  it("rejects invalid requests before invoking and malformed results after", async () => {
    const invoke = vi.fn(async () => ({ kind: "maybe" }));
    const gateway = new TauriAgentThreadSessionGateway(invoke, vi.fn(), () => true);
    await expect(
      gateway.endAgentThreadSession({ workspaceId: "ws-1", threadId: "../escape" }),
    ).rejects.toThrow(TypeError);
    expect(invoke).not.toHaveBeenCalled();
    await expect(
      gateway.interruptAgentTask({
        taskId: "agt-1-0a1b",
        workspaceId: "ws-1",
        threadId: "agt-1-0a1c",
      }),
    ).rejects.toThrow(TypeError);
  });

  it("degrades truthfully without the native runtime", async () => {
    const invoke = vi.fn();
    const listen = vi.fn();
    const gateway = new TauriAgentThreadSessionGateway(invoke, listen, () => false);
    await expect(
      gateway.interruptAgentTask({
        taskId: "agt-1-0a1b",
        workspaceId: "ws-1",
        threadId: "agt-1-0a1c",
      }),
    ).resolves.toEqual({ kind: "unsupported" });
    await expect(
      gateway.inspectAgentThreadSession({
        workspaceId: "ws-1",
        threadId: "agt-1-0a1c",
        resumeSessionId: null,
        launch: defaultAgentLaunchOptions("claudeCode"),
      }),
    ).resolves.toEqual({ kind: "none" });
    await expect(
      gateway.endAgentThreadSession({ workspaceId: "ws-1", threadId: "agt-1-0a1c" }),
    ).resolves.toBe(false);
    const ended = await gateway.subscribeAgentSessionEnded(vi.fn());
    const background = await gateway.subscribeAgentSessionBackgroundTurn(vi.fn());
    expect(() => ended()).not.toThrow();
    expect(() => background()).not.toThrow();
    expect(invoke).not.toHaveBeenCalled();
    expect(listen).not.toHaveBeenCalled();
  });

  it("drops malformed ended events and forwards valid ones", async () => {
    const events = capturingListen();
    const gateway = new TauriAgentThreadSessionGateway(vi.fn(), events.listen, () => true);
    const handler = vi.fn();
    const unsubscribe = await gateway.subscribeAgentSessionEnded(handler);
    events.deliver(AGENT_SESSION_ENDED_EVENT, { nope: true });
    events.deliver(AGENT_SESSION_ENDED_EVENT, {
      workspaceId: "ws-1",
      threadId: "agt-1-0a1c",
      reason: "crashed",
      backgroundTasksLive: false,
    });
    expect(events.listen).toHaveBeenCalledWith("agent-session://ended", expect.any(Function));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      threadId: "agt-1-0a1c",
      reason: "crashed",
      backgroundTasksLive: false,
    });
    unsubscribe();
    expect(events.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("drops malformed background-turn events and forwards the pinned shape", async () => {
    const events = capturingListen();
    const gateway = new TauriAgentThreadSessionGateway(vi.fn(), events.listen, () => true);
    const handler = vi.fn();
    await gateway.subscribeAgentSessionBackgroundTurn(handler);
    const pinned = JSON.parse(
      '{"workspaceId":"ws-1","threadId":"agt-1-0a1c","output":"...","truncated":false,"complete":true}',
    ) as unknown;
    events.deliver(AGENT_SESSION_BACKGROUND_TURN_EVENT, { ...(pinned as object), extra: 1 });
    events.deliver(AGENT_SESSION_BACKGROUND_TURN_EVENT, {
      workspaceId: "ws-1",
      threadId: "agt-1-0a1c",
      output: "a".repeat(256 * 1_024 + 1),
      truncated: false,
      complete: true,
    });
    events.deliver(AGENT_SESSION_BACKGROUND_TURN_EVENT, pinned);
    expect(events.listen).toHaveBeenCalledWith(
      "agent-session://background-turn",
      expect.any(Function),
    );
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      threadId: "agt-1-0a1c",
      output: "...",
      truncated: false,
      complete: true,
    });
  });
});
