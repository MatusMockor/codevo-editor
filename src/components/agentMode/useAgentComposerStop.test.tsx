// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import { AGENT_STOP_CONFIRMATION_WINDOW_MS } from "../../domain/agentStopPolicy";
import type { AgentSessionBackground } from "../../domain/agentSessionBackground";
import { surfaceThreadView } from "./agentSurfaceTestFixtures";
import {
  useAgentComposerStop,
  type AgentComposerSessionStopPort,
  type AgentComposerStopControls,
} from "./useAgentComposerStop";

const watch: AgentSessionBackground = {
  ownerId: "agent-root:app",
  total: 1,
  agents: 0,
  tasks: [
    { taskId: "b8kzpiexm", taskType: "shell", description: "Watch beta.75 release workflow" },
  ],
  sinceEpochMs: 1,
  taskSinceEpochMs: new Map(),
};

const cleanups: Array<() => void> = [];

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.useRealTimers();
});

function render(initial: AgentThreadView | null, port: AgentComposerSessionStopPort | undefined) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const agents = { stop: vi.fn(async () => undefined), interrupt: vi.fn(async () => true) };
  let selected = initial;
  let latest: AgentComposerStopControls | null = null;
  function Harness() {
    latest = useAgentComposerStop(selected, agents, port);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Harness)));
  cleanups.push(() => act(() => root.unmount()));
  return {
    agents,
    select(next: AgentThreadView | null) {
      selected = next;
      act(() => root.render(createElement(Harness)));
    },
    controls(): AgentComposerStopControls {
      expect(latest).not.toBeNull();
      return latest as unknown as AgentComposerStopControls;
    },
  };
}

function port() {
  return { stopTasks: vi.fn(), endSession: vi.fn() } satisfies AgentComposerSessionStopPort;
}

describe("useAgentComposerStop for an idle thread with live session tasks", () => {
  it("confirms first, then stops the session's tasks on the second Stop inside the window", () => {
    vi.useFakeTimers();
    const session = port();
    const harness = render(surfaceThreadView({ sessionBackground: watch }), session);

    expect(harness.controls().running).toBe(false);
    expect(harness.controls().sessionTasksStoppable).toBe(true);
    act(() => harness.controls().onStop());
    expect(harness.controls().stopConfirmation).toMatchObject({
      kind: "confirmSessionBackground",
      liveTaskCount: 1,
    });
    expect(session.stopTasks).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(AGENT_STOP_CONFIRMATION_WINDOW_MS - 1));
    act(() => harness.controls().onStop());
    expect(session.stopTasks).toHaveBeenCalledExactlyOnceWith("agt-1");
    expect(harness.agents.stop).not.toHaveBeenCalled();
    expect(harness.controls().stopConfirmation).toBeNull();
  });

  it("routes the banner's Stop tasks and End session to the exact thread", () => {
    const session = port();
    const harness = render(surfaceThreadView({ sessionBackground: watch }), session);
    act(() => harness.controls().onStop());
    const confirmation = harness.controls().stopConfirmation;
    expect(confirmation?.kind).toBe("confirmSessionBackground");
    act(() => {
      if (confirmation?.kind !== "confirmSessionBackground") return;
      confirmation.onEndSession?.();
    });
    expect(session.endSession).toHaveBeenCalledExactlyOnceWith("agt-1");
    expect(harness.controls().stopConfirmation).toBeNull();

    act(() => harness.controls().onStop());
    act(() => {
      const next = harness.controls().stopConfirmation;
      if (next?.kind !== "confirmSessionBackground") return;
      next.onStopTasks();
    });
    expect(session.stopTasks).toHaveBeenCalledExactlyOnceWith("agt-1");
  });

  it("drops the confirmation once the tasks leave or another owner's thread shows", () => {
    const session = port();
    const harness = render(surfaceThreadView({ sessionBackground: watch }), session);
    act(() => harness.controls().onStop());
    harness.select(surfaceThreadView());
    expect(harness.controls().stopConfirmation).toBeNull();
    expect(harness.controls().sessionTasksStoppable).toBe(false);

    harness.select(surfaceThreadView({ sessionBackground: watch }));
    act(() => harness.controls().onStop());
    const base = surfaceThreadView({ sessionBackground: watch });
    harness.select({
      ...base,
      thread: { ...base.thread, owner: { ...base.thread.owner, ownerId: "agent-root:other" } },
    });
    expect(harness.controls().stopConfirmation).toBeNull();
    act(() => harness.controls().onStop());
    expect(session.stopTasks).not.toHaveBeenCalled();
  });

  it("offers End session only when the port can end it and the thread is not archived", () => {
    const withoutEnd = render(surfaceThreadView({ sessionBackground: watch }), {
      stopTasks: vi.fn(),
    });
    act(() => withoutEnd.controls().onStop());
    const plain = withoutEnd.controls().stopConfirmation;
    expect(plain?.kind).toBe("confirmSessionBackground");
    expect(plain?.kind === "confirmSessionBackground" && plain.onEndSession).toBeUndefined();

    const base = surfaceThreadView({ sessionBackground: watch });
    const archived = render({ ...base, thread: { ...base.thread, archived: true } }, port());
    act(() => archived.controls().onStop());
    const confirmation = archived.controls().stopConfirmation;
    expect(confirmation?.kind).toBe("confirmSessionBackground");
    expect(confirmation?.kind === "confirmSessionBackground" && confirmation.onEndSession).toBe(
      undefined,
    );

    const endable = render(surfaceThreadView({ sessionBackground: watch }), port());
    act(() => endable.controls().onStop());
    const offered = endable.controls().stopConfirmation;
    expect(offered?.kind === "confirmSessionBackground" && typeof offered.onEndSession).toBe(
      "function",
    );
  });

  it("counts every live session task, not just the reported ones, and follows the level while open", () => {
    const session = port();
    const reported = Array.from({ length: 32 }, (_, index) => ({
      taskId: `task-${index}`,
      taskType: "shell" as const,
      description: `Command ${index}`,
    }));
    const many: AgentSessionBackground = { ...watch, total: 40, tasks: reported };
    const harness = render(surfaceThreadView({ sessionBackground: many }), session);
    act(() => harness.controls().onStop());
    expect(harness.controls().stopConfirmation).toMatchObject({
      kind: "confirmSessionBackground",
      liveTaskCount: 40,
    });

    harness.select(surfaceThreadView({ sessionBackground: { ...watch, total: 2 } }));
    expect(harness.controls().stopConfirmation).toMatchObject({ liveTaskCount: 2 });
    harness.select(surfaceThreadView({ sessionBackground: watch }));
    expect(harness.controls().stopConfirmation).toMatchObject({
      kind: "confirmSessionBackground",
      liveTaskCount: 1,
    });

    harness.select(surfaceThreadView());
    expect(harness.controls().stopConfirmation).toBeNull();
    harness.select(surfaceThreadView({ sessionBackground: watch }));
    expect(harness.controls().stopConfirmation).toBeNull();
    expect(session.stopTasks).not.toHaveBeenCalled();
  });

  it("stays inert without a session stop port or for remote threads", () => {
    const harness = render(surfaceThreadView({ sessionBackground: watch }), undefined);
    expect(harness.controls().sessionTasksStoppable).toBe(false);
    act(() => harness.controls().onStop());
    expect(harness.controls().stopConfirmation).toBeNull();

    const session = port();
    const remote = render(
      surfaceThreadView({
        sessionBackground: watch,
        execution: {
          kind: "remote",
          serverId: "s",
          runnerId: "r",
          projectId: "p",
          conversationId: "c",
          latestTaskId: "t",
          resume: null,
        },
      }),
      session,
    );
    expect(remote.controls().sessionTasksStoppable).toBe(false);
  });
});
