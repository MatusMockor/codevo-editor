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

  it("toggles dictation only for a bound view whose composer reports it available", () => {
    const bridge = createAgentViewCommandBridge();
    const state = { available: true };
    const toggle = vi.fn();
    const unbindDictation = bridge.bindDictation({ available: () => state.available, toggle });

    expect(bridge.dictationAvailable()).toBe(false);
    bridge.run("agent.toggleDictation");
    expect(toggle).not.toHaveBeenCalled();

    const view = boundHandlers();
    bridge.bind(view);
    expect(bridge.dictationAvailable()).toBe(true);
    bridge.run("agent.toggleDictation");
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(view.newThread).not.toHaveBeenCalled();

    state.available = false;
    expect(bridge.dictationAvailable()).toBe(false);
    bridge.run("agent.toggleDictation");
    expect(toggle).toHaveBeenCalledTimes(1);

    state.available = true;
    unbindDictation();
    expect(bridge.dictationAvailable()).toBe(false);
    bridge.run("agent.toggleDictation");
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("keeps a newer dictation binding when a stale composer unbinds", () => {
    const bridge = createAgentViewCommandBridge();
    bridge.bind(boundHandlers());
    const stale = vi.fn();
    const current = vi.fn();
    const unbindStale = bridge.bindDictation({ available: () => true, toggle: stale });
    bridge.bindDictation({ available: () => true, toggle: current });

    unbindStale();
    bridge.run("agent.toggleDictation");

    expect(stale).not.toHaveBeenCalled();
    expect(current).toHaveBeenCalledTimes(1);
  });

  it("reports project.add unavailable for a view without the handler", () => {
    const bridge = createAgentViewCommandBridge();
    bridge.bind(boundHandlers());
    expect(bridge.addProjectAvailable()).toBe(false);
    expect(() => bridge.run("project.add")).not.toThrow();
  });
});
