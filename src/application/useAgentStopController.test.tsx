// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTurn, AgentTurnEvent } from "../domain/agentThread";
import {
  AGENT_INTERRUPT_SETTLE_DEADLINE_MS,
  AGENT_STOP_CONFIRMATION_WINDOW_MS,
} from "../domain/agentStopPolicy";
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
    expect(hook.result.current.confirmation).toEqual({
      kind: "confirmBackground",
      threadId: "thread-1",
      turnId: "agt-1-t1",
      liveTaskCount: 1,
    });
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

describe("useAgentStopController with interrupt", () => {
  afterEach(() => {
    const mounted = root;
    root = null;
    if (mounted !== null) act(() => mounted.unmount());
  });

  const working = (turnId = "agt-1-t1") =>
    turn([{ kind: "assistantText", text: "Working" }], turnId);

  it("interrupts first, shows the interrupting state and hard-stops on the second press", async () => {
    const hardStop = vi.fn(async (_threadId: string) => undefined);
    const interrupt = vi.fn(async (_threadId: string) => true);
    const current = working();
    const hook = renderHook({
      readRunningTurn: () => current,
      hardStop,
      interrupt,
      now: () => 1_000,
    });
    await act(async () => hook.result.current.requestStop("thread-1"));
    expect(interrupt).toHaveBeenCalledWith("thread-1");
    expect(hardStop).not.toHaveBeenCalled();
    expect(hook.result.current.confirmation).toEqual({
      kind: "interrupting",
      threadId: "thread-1",
      turnId: "agt-1-t1",
    });
    await act(async () => hook.result.current.requestStop("thread-1"));
    expect(hardStop).toHaveBeenCalledWith("thread-1");
    expect(interrupt).toHaveBeenCalledTimes(1);
    expect(hook.result.current.confirmation).toBeNull();
  });

  it("hard-stops at once when the runtime cannot interrupt", async () => {
    const hardStop = vi.fn(async (_threadId: string) => undefined);
    const interrupt = vi.fn(async (_threadId: string) => false);
    const current = working();
    const hook = renderHook({
      readRunningTurn: () => current,
      hardStop,
      interrupt,
      now: () => 1_000,
    });
    await act(async () => hook.result.current.requestStop("thread-1"));
    expect(hardStop).toHaveBeenCalledWith("thread-1");
    expect(hook.result.current.confirmation).toBeNull();
  });

  it("hard-stops when the interrupt request fails", async () => {
    const hardStop = vi.fn(async (_threadId: string) => undefined);
    const interrupt = vi.fn((_threadId: string) => Promise.reject<boolean>(new Error("ipc down")));
    const current = working();
    const hook = renderHook({
      readRunningTurn: () => current,
      hardStop,
      interrupt,
      now: () => 1_000,
    });
    await act(async () => hook.result.current.requestStop("thread-1"));
    expect(hardStop).toHaveBeenCalledWith("thread-1");
    expect(hook.result.current.confirmation).toBeNull();
  });

  it("dismissing the interrupting banner keeps the memory of the interrupted turn", async () => {
    const hardStop = vi.fn(async (_threadId: string) => undefined);
    const interrupt = vi.fn(async (_threadId: string) => true);
    const current = working();
    const hook = renderHook({
      readRunningTurn: () => current,
      hardStop,
      interrupt,
      now: () => 1_000,
    });
    await act(async () => hook.result.current.requestStop("thread-1"));
    act(() => hook.result.current.cancelStop());
    expect(hook.result.current.confirmation).toBeNull();
    await act(async () => hook.result.current.requestStop("thread-1"));
    expect(interrupt).toHaveBeenCalledTimes(1);
    expect(hardStop).toHaveBeenCalledWith("thread-1");
  });

  it("a stale interrupt from a previous turn never hard-stops a new turn", async () => {
    const hardStop = vi.fn(async (_threadId: string) => undefined);
    const interrupt = vi.fn(async (_threadId: string) => true);
    let current = working("agt-1-t1");
    const hook = renderHook({
      readRunningTurn: () => current,
      hardStop,
      interrupt,
      now: () => 1_000,
    });
    await act(async () => hook.result.current.requestStop("thread-1"));
    act(() => hook.result.current.cancelStop());
    current = working("agt-1-t2");
    await act(async () => hook.result.current.requestStop("thread-1"));
    expect(hardStop).not.toHaveBeenCalled();
    expect(interrupt).toHaveBeenCalledTimes(2);
    expect(hook.result.current.confirmation).toEqual({
      kind: "interrupting",
      threadId: "thread-1",
      turnId: "agt-1-t2",
    });
  });

  it("an interrupt on another thread never hard-stops this thread", async () => {
    const hardStop = vi.fn(async (_threadId: string) => undefined);
    const interrupt = vi.fn(async (_threadId: string) => true);
    const current = working();
    const hook = renderHook({
      readRunningTurn: () => current,
      hardStop,
      interrupt,
      now: () => 1_000,
    });
    await act(async () => hook.result.current.requestStop("thread-1"));
    await act(async () => hook.result.current.requestStop("thread-2"));
    expect(hardStop).not.toHaveBeenCalled();
    expect(interrupt).toHaveBeenLastCalledWith("thread-2");
  });

  it("remembers the interrupted turn per thread across A B A", async () => {
    const hardStop = vi.fn(async (_threadId: string) => undefined);
    const interrupt = vi.fn(async (_threadId: string) => true);
    const current = working();
    const hook = renderHook({
      readRunningTurn: () => current,
      hardStop,
      interrupt,
      now: () => 1_000,
    });
    await act(async () => hook.result.current.requestStop("thread-1"));
    await act(async () => hook.result.current.requestStop("thread-2"));
    await act(async () => hook.result.current.requestStop("thread-1"));
    expect(interrupt).toHaveBeenCalledTimes(2);
    expect(hardStop).toHaveBeenCalledTimes(1);
    expect(hardStop).toHaveBeenCalledWith("thread-1");
  });

  it("a second press while the interrupt is pending hard-stops and a late acceptance stays hidden", async () => {
    const hardStop = vi.fn(async (_threadId: string) => undefined);
    let accept: (accepted: boolean) => void = () => undefined;
    const interrupt = vi.fn(
      (_threadId: string) =>
        new Promise<boolean>((resolve) => {
          accept = resolve;
        }),
    );
    const current = working();
    const hook = renderHook({
      readRunningTurn: () => current,
      hardStop,
      interrupt,
      now: () => 1_000,
    });
    act(() => hook.result.current.requestStop("thread-1"));
    act(() => hook.result.current.requestStop("thread-1"));
    expect(hardStop).toHaveBeenCalledTimes(1);
    await act(async () => accept(true));
    expect(hook.result.current.confirmation).toBeNull();
    expect(hardStop).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])(
    "a late interrupt reply (accepted: %s) for turn 1 does nothing once turn 2 runs",
    async (accepted) => {
      const hardStop = vi.fn(async (_threadId: string) => undefined);
      let reply: (accepted: boolean) => void = () => undefined;
      const interrupt = vi.fn(
        (_threadId: string) =>
          new Promise<boolean>((resolve) => {
            reply = resolve;
          }),
      );
      let current: AgentTurn | null = working("agt-1-t1");
      const hook = renderHook({
        readRunningTurn: () => current,
        hardStop,
        interrupt,
        now: () => 1_000,
      });
      act(() => hook.result.current.requestStop("thread-1"));
      current = working("agt-1-t2");
      await act(async () => reply(accepted));
      expect(hook.result.current.confirmation).toBeNull();
      expect(hardStop).not.toHaveBeenCalled();
      await act(async () => hook.result.current.requestStop("thread-1"));
      expect(hardStop).not.toHaveBeenCalled();
      expect(interrupt).toHaveBeenCalledTimes(2);
    },
  );

  it("a late refusal after a hard stop never stops twice", async () => {
    const hardStop = vi.fn(async (_threadId: string) => undefined);
    let accept: (accepted: boolean) => void = () => undefined;
    const interrupt = vi.fn(
      (_threadId: string) =>
        new Promise<boolean>((resolve) => {
          accept = resolve;
        }),
    );
    const current = working();
    const hook = renderHook({
      readRunningTurn: () => current,
      hardStop,
      interrupt,
      now: () => 1_000,
    });
    act(() => hook.result.current.requestStop("thread-1"));
    act(() => hook.result.current.stopNow("thread-1"));
    await act(async () => accept(false));
    expect(hardStop).toHaveBeenCalledTimes(1);
  });
});

describe("useAgentStopController interrupt deadline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    const mounted = root;
    root = null;
    if (mounted !== null) act(() => mounted.unmount());
    vi.useRealTimers();
  });

  function setupDelayedInterrupt(replyAfterMs: number) {
    const hardStop = vi.fn(async (_threadId: string) => undefined);
    const interrupt = vi.fn(
      (_threadId: string) =>
        new Promise<boolean>((resolve) => {
          setTimeout(() => resolve(true), replyAfterMs);
        }),
    );
    let now = 1_000;
    const current = turn([{ kind: "assistantText", text: "Working" }]);
    const hook = renderHook({
      readRunningTurn: () => current,
      hardStop,
      interrupt,
      now: () => now,
    });
    return {
      hook,
      hardStop,
      interrupt,
      async advance(ms: number) {
        now += ms;
        await act(async () => {
          await vi.advanceTimersByTimeAsync(ms);
        });
      },
    };
  }

  it("mirrors the backend interrupt deadlines", () => {
    expect(AGENT_INTERRUPT_SETTLE_DEADLINE_MS).toBe(10_000);
  });

  it("ends the interrupting state when the backend interrupt deadline passes, counted from the request", async () => {
    const { hook, advance } = setupDelayedInterrupt(1_500);
    act(() => hook.result.current.requestStop("thread-1"));
    expect(hook.result.current.confirmation).toBeNull();
    await advance(1_500);
    expect(hook.result.current.confirmation).toEqual({
      kind: "interrupting",
      threadId: "thread-1",
      turnId: "agt-1-t1",
    });
    await advance(AGENT_INTERRUPT_SETTLE_DEADLINE_MS - 1_500 - 1);
    expect(hook.result.current.confirmation?.kind).toBe("interrupting");
    await advance(1);
    expect(hook.result.current.confirmation).toBeNull();
  });

  it("never shows the interrupting state when the acceptance arrives after the backend gave up", async () => {
    const { hook, hardStop, interrupt, advance } = setupDelayedInterrupt(
      AGENT_INTERRUPT_SETTLE_DEADLINE_MS,
    );
    act(() => hook.result.current.requestStop("thread-1"));
    await advance(AGENT_INTERRUPT_SETTLE_DEADLINE_MS);
    expect(hook.result.current.confirmation).toBeNull();
    expect(hardStop).not.toHaveBeenCalled();
    act(() => hook.result.current.requestStop("thread-1"));
    expect(hardStop).toHaveBeenCalledWith("thread-1");
    expect(interrupt).toHaveBeenCalledTimes(1);
  });

  it("keeps the background confirmation window separate from the interrupt deadline", async () => {
    let now = 1_000;
    const hardStop = vi.fn(async (_threadId: string) => undefined);
    const current = turn(backgroundOnly);
    const hook = renderHook({ readRunningTurn: () => current, hardStop, now: () => now });
    act(() => hook.result.current.requestStop("thread-1"));
    now += AGENT_STOP_CONFIRMATION_WINDOW_MS - 1;
    act(() => {
      vi.advanceTimersByTime(AGENT_STOP_CONFIRMATION_WINDOW_MS - 1);
    });
    expect(hook.result.current.confirmation?.kind).toBe("confirmBackground");
    now += 1;
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(hook.result.current.confirmation).toBeNull();
  });
});
