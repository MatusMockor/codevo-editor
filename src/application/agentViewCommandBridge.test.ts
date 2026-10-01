import { describe, expect, it, vi } from "vitest";
import {
  createAgentViewCommandBridge,
  type AgentViewCommandHandlers,
} from "./agentViewCommandBridge";

function boundHandlers(): AgentViewCommandHandlers {
  return {
    surfaceBlocked: () => false,
    newThread: vi.fn(),
    previousThread: vi.fn(),
    nextThread: vi.fn(),
    jumpToThread: vi.fn(),
    searchThreads: vi.fn(),
    findInThread: vi.fn(),
    threadSelected: () => false,
  };
}

describe("createAgentViewCommandBridge", () => {
  it("dispatches project.add to the bound handler and reports availability", () => {
    const bridge = createAgentViewCommandBridge();
    expect(bridge.addProjectAvailable()).toBe(false);
    const addProject = vi.fn();
    const unbind = bridge.bind({ ...boundHandlers(), addProject });
    expect(bridge.addProjectAvailable()).toBe(true);
    bridge.run("project.add");
    expect(addProject).toHaveBeenCalledTimes(1);
    unbind();
    expect(bridge.addProjectAvailable()).toBe(false);
    bridge.run("project.add");
    expect(addProject).toHaveBeenCalledTimes(1);
  });

  it("dispatches agent.newThreadIn to the bound picker handler", () => {
    const bridge = createAgentViewCommandBridge();
    const newThreadIn = vi.fn();
    const handlers = { ...boundHandlers(), newThreadIn };
    bridge.bind(handlers);
    bridge.run("agent.newThreadIn");
    expect(newThreadIn).toHaveBeenCalledTimes(1);
    expect(handlers.newThread).not.toHaveBeenCalled();
  });

  it("reports project.add unavailable for a view without the handler", () => {
    const bridge = createAgentViewCommandBridge();
    bridge.bind(boundHandlers());
    expect(bridge.addProjectAvailable()).toBe(false);
    expect(() => bridge.run("project.add")).not.toThrow();
  });
});
