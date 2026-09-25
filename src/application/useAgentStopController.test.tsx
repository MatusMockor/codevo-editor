// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTurn, AgentTurnEvent } from "../domain/agentThread";
import { AGENT_STOP_CONFIRMATION_WINDOW_MS } from "../domain/agentStopPolicy";
import {
  useAgentStopController,
  type AgentStopController,
  type AgentStopControllerOptions,
} from "./useAgentStopController";

const backgroundOnly: ReadonlyArray<AgentTurnEvent> = [
  { kind: "backgroundTask", taskId: "watch", status: "starting", taskType: "shell" },
  { kind: "result", text: "Started", isError: false, usage: null },
];

function turn(events: ReadonlyArray<AgentTurnEvent>, turnId = "agt-1-t1"): AgentTurn {
  return {
    turnId,
    prompt: "Start the dev server",
    status: { kind: "running" },
    startedAtEpochMs: 1_000,
    endedAtEpochMs: null,
    events,
    eventsTruncated: false,
    lastStatusSequence: 1,
    lastOutputSequence: events.length,
    launch: null,
    cliVersion: null,
  };
}

let root: Root | null = null;

function renderHook(options: AgentStopControllerOptions): {
  readonly result: { readonly current: AgentStopController };
} {
  const result: { current: AgentStopController } = {
    current: undefined as unknown as AgentStopController,
  };
  function Probe() {
    result.current = useAgentStopController(options);
    return null;
  }
  const mounted = createRoot(document.createElement("div"));
  root = mounted;
  act(() => mounted.render(<Probe />));
  return { result };
}

describe("useAgentStopController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    const mounted = root;
    root = null;
    if (mounted !== null) act(() => mounted.unmount());
    vi.useRealTimers();
  });

  function setup(current: AgentTurn | null) {
    const hardStop = vi.fn(async (_threadId: string) => undefined);
    let now = 1_000;
    const hook = renderHook({
      readRunningTurn: () => current,
      hardStop,
      now: () => now,
    });
    return {
      hook,
      hardStop,
      advance(ms: number) {
        now += ms;
        act(() => {
          vi.advanceTimersByTime(ms);
        });
      },
    };
  }

  it("hard-stops immediately while the foreground runs", () => {
    const { hook, hardStop } = setup(turn([{ kind: "assistantText", text: "Working" }]));
    act(() => hook.result.current.requestStop("thread-1"));
    expect(hardStop).toHaveBeenCalledWith("thread-1");
    expect(hook.result.current.confirmation).toBeNull();
  });

  it("second press within the window hard-stops", () => {
    const { hook, hardStop } = setup(turn(backgroundOnly));
    act(() => hook.result.current.requestStop("thread-1"));
    expect(hardStop).not.toHaveBeenCalled();
    expect(hook.result.current.confirmation).toEqual({ threadId: "thread-1", liveTaskCount: 1 });
    act(() => hook.result.current.requestStop("thread-1"));
    expect(hardStop).toHaveBeenCalledTimes(1);
    expect(hook.result.current.confirmation).toBeNull();
  });

  it("disarms after the window so a late press asks again", () => {
    const { hook, hardStop, advance } = setup(turn(backgroundOnly));
    act(() => hook.result.current.requestStop("thread-1"));
    advance(AGENT_STOP_CONFIRMATION_WINDOW_MS);
    expect(hook.result.current.confirmation).toBeNull();
    act(() => hook.result.current.requestStop("thread-1"));
    expect(hardStop).not.toHaveBeenCalled();
    expect(hook.result.current.confirmation).not.toBeNull();
  });

  it("cancel keeps the work running", () => {
    const { hook, hardStop } = setup(turn(backgroundOnly));
    act(() => hook.result.current.requestStop("thread-1"));
    act(() => hook.result.current.cancelStop());
    expect(hook.result.current.confirmation).toBeNull();
    act(() => hook.result.current.requestStop("thread-1"));
    expect(hardStop).not.toHaveBeenCalled();
  });

  it("stopNow ends everything without asking", () => {
    const { hook, hardStop } = setup(turn(backgroundOnly));
    act(() => hook.result.current.requestStop("thread-1"));
    act(() => hook.result.current.stopNow("thread-1"));
    expect(hardStop).toHaveBeenCalledWith("thread-1");
    expect(hook.result.current.confirmation).toBeNull();
  });
});
