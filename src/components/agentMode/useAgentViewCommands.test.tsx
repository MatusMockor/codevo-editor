// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAgentViewCommandBridge,
  type AgentViewCommandBridge,
  type AgentViewCommandHandlers,
} from "../../application/agentViewCommandBridge";
import { useAgentViewCommands } from "./useAgentViewCommands";

describe("useAgentViewCommands", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("forwards every bridge command to the bound view handlers", () => {
    const bridge = createAgentViewCommandBridge();
    const handlers = spyHandlers();
    render(bridge, handlers);

    act(() => bridge.run("agent.newThread"));
    act(() => bridge.run("agent.previousThread"));
    act(() => bridge.run("agent.nextThread"));
    act(() => bridge.run("agent.jumpToThread.4"));
    act(() => bridge.run("agent.searchThreads"));
    act(() => bridge.run("agent.findInThread"));
    act(() => bridge.run("agent.runPreferredScript"));
    act(() => bridge.run("agent.openCommitMenu"));

    expect(handlers.newThread).toHaveBeenCalledTimes(1);
    expect(handlers.previousThread).toHaveBeenCalledTimes(1);
    expect(handlers.nextThread).toHaveBeenCalledTimes(1);
    expect(handlers.jumpToThread).toHaveBeenCalledWith(4);
    expect(handlers.searchThreads).toHaveBeenCalledTimes(1);
    expect(handlers.findInThread).toHaveBeenCalledTimes(1);
    expect(handlers.runPreferredScript).toHaveBeenCalledTimes(1);
    expect(handlers.openCommitMenu).toHaveBeenCalledTimes(1);
  });

  it("projects the thread selection and the blocked surfaces of the bound view", () => {
    const bridge = createAgentViewCommandBridge();
    const handlers = spyHandlers();
    handlers.threadSelected.mockReturnValue(false);
    handlers.surfaceBlocked.mockReturnValue(true);
    render(bridge, handlers);

    expect(bridge.bound()).toBe(true);
    expect(bridge.threadSelected()).toBe(false);
    expect(bridge.threadFindFocused()).toBe(true);
    expect(bridge.surfaceBlocked("diff")).toBe(true);
  });

  it("runs the latest handlers without rebinding the bridge", () => {
    const bridge = createAgentViewCommandBridge();
    const bind = vi.spyOn(bridge, "bind");
    const first = spyHandlers();
    render(bridge, first);
    const second = spyHandlers();
    render(bridge, second);

    act(() => bridge.run("agent.runPreferredScript"));
    act(() => bridge.run("agent.openCommitMenu"));

    expect(bind).toHaveBeenCalledTimes(1);
    expect(first.runPreferredScript).not.toHaveBeenCalled();
    expect(first.openCommitMenu).not.toHaveBeenCalled();
    expect(second.runPreferredScript).toHaveBeenCalledTimes(1);
    expect(second.openCommitMenu).toHaveBeenCalledTimes(1);
  });

  it("tolerates a view that omits the optional thread scoped handlers", () => {
    const bridge = createAgentViewCommandBridge();
    const handlers = spyHandlers();
    render(bridge, { ...handlers, runPreferredScript: undefined, openCommitMenu: undefined });

    expect(() => act(() => bridge.run("agent.runPreferredScript"))).not.toThrow();
    expect(() => act(() => bridge.run("agent.openCommitMenu"))).not.toThrow();
  });

  it("unbinds on unmount and drops later commands", () => {
    const bridge = createAgentViewCommandBridge();
    const handlers = spyHandlers();
    render(bridge, handlers);

    act(() => root.unmount());
    root = createRoot(host);

    expect(bridge.bound()).toBe(false);
    act(() => bridge.run("agent.openCommitMenu"));
    expect(handlers.openCommitMenu).not.toHaveBeenCalled();
  });

  function render(bridge: AgentViewCommandBridge | null, handlers: AgentViewCommandHandlers): void {
    act(() => root.render(<Host bridge={bridge} handlers={handlers} />));
  }
});

function Host({
  bridge,
  handlers,
}: {
  readonly bridge: AgentViewCommandBridge | null;
  readonly handlers: AgentViewCommandHandlers;
}) {
  useAgentViewCommands(bridge, handlers);
  return null;
}

function spyHandlers() {
  return {
    surfaceBlocked: vi.fn(() => false),
    newThread: vi.fn(),
    previousThread: vi.fn(),
    nextThread: vi.fn(),
    jumpToThread: vi.fn(),
    searchThreads: vi.fn(),
    findInThread: vi.fn(),
    threadFindFocused: vi.fn(() => true),
    runPreferredScript: vi.fn(),
    openCommitMenu: vi.fn(),
    threadSelected: vi.fn(() => true),
  } satisfies AgentViewCommandHandlers;
}
