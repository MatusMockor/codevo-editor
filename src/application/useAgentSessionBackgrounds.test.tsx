// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSessionBackgrounds } from "../domain/agentSessionBackground";
import type {
  AgentSessionBackgroundTasksEvent,
  AgentSessionEndedEvent,
  AgentThreadSessionGateway,
} from "../domain/agentThreadSession";
import { waitForReact } from "../test/reactTestLifecycle";
import { useAgentSessionBackgrounds } from "./useAgentSessionBackgrounds";

const THREAD = "agt-mue1wenj-7ede";
const RESUMED: AgentSessionBackgroundTasksEvent = {
  workspaceId: "ws-1",
  threadId: THREAD,
  total: 1,
  agents: 1,
  tasks: [
    {
      taskId: "a4b355dcf6056a875",
      taskType: "agent",
      description: "Live Codex model catalog like Claude",
    },
  ],
};

function gateway() {
  let levels: ((event: AgentSessionBackgroundTasksEvent) => void) | null = null;
  let ended: ((event: AgentSessionEndedEvent) => void) | null = null;
  const unsubscribeLevels = vi.fn();
  const unsubscribeEnded = vi.fn();
  const fake = {
    interruptAgentTask: vi.fn(async () => ({ kind: "unsupported" }) as const),
    inspectAgentThreadSession: vi.fn(async () => ({ kind: "none" }) as const),
    endAgentThreadSession: vi.fn(async () => false),
    subscribeAgentSessionEnded: vi.fn(async (handler: (event: AgentSessionEndedEvent) => void) => {
      ended = handler;
      return unsubscribeEnded;
    }),
    subscribeAgentSessionBackgroundTurn: vi.fn(async () => () => undefined),
    subscribeAgentSessionBackgroundTasks: vi.fn(
      async (handler: (event: AgentSessionBackgroundTasksEvent) => void) => {
        levels = handler;
        return unsubscribeLevels;
      },
    ),
  } satisfies AgentThreadSessionGateway;
  return {
    fake,
    unsubscribeLevels,
    unsubscribeEnded,
    level: (event: AgentSessionBackgroundTasksEvent) => {
      expect(levels).not.toBeNull();
      act(() => levels?.(event));
    },
    end: (event: AgentSessionEndedEvent) => {
      expect(ended).not.toBeNull();
      act(() => ended?.(event));
    },
  };
}

const cleanups: Array<() => void> = [];

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
});

function render(fake: AgentThreadSessionGateway, now: () => number) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const reportFailure = vi.fn();
  const observed: { current: AgentSessionBackgrounds | null } = { current: null };
  function Harness() {
    observed.current = useAgentSessionBackgrounds(fake, now, reportFailure);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Harness)));
  let mounted = true;
  const unmount = () => {
    if (!mounted) return;
    mounted = false;
    act(() => root.unmount());
  };
  cleanups.push(unmount);
  return { observed, unmount, reportFailure };
}

describe("useAgentSessionBackgrounds", () => {
  it("keeps a thread's live background level until its drain or session end", async () => {
    const { fake, level, end } = gateway();
    let now = 1_790_718_781_369;
    const harness = render(fake, () => now);
    await waitForReact(() => {
      expect(fake.subscribeAgentSessionBackgroundTasks).toHaveBeenCalledTimes(1);
      expect(fake.subscribeAgentSessionEnded).toHaveBeenCalledTimes(1);
    });
    level(RESUMED);
    expect(harness.observed.current?.get(THREAD)).toEqual({
      ownerId: "ws-1",
      total: 1,
      agents: 1,
      tasks: RESUMED.tasks,
      sinceEpochMs: 1_790_718_781_369,
    });
    level({ ...RESUMED, total: 0, agents: 0, tasks: [] });
    expect(harness.observed.current?.has(THREAD)).toBe(false);
    now = 1_790_718_900_000;
    level(RESUMED);
    expect(harness.observed.current?.get(THREAD)?.sinceEpochMs).toBe(1_790_718_900_000);
    end({ workspaceId: "ws-1", threadId: THREAD, reason: "stopped", backgroundTasksLive: true });
    expect(harness.observed.current?.has(THREAD)).toBe(false);
    expect(harness.reportFailure).not.toHaveBeenCalled();
  });

  it("unsubscribes both channels on unmount and ignores levels after it", async () => {
    const { fake, unsubscribeLevels, unsubscribeEnded } = gateway();
    const harness = render(fake, () => 1);
    await waitForReact(() =>
      expect(fake.subscribeAgentSessionBackgroundTasks).toHaveBeenCalledTimes(1),
    );
    harness.unmount();
    expect(unsubscribeLevels).toHaveBeenCalledTimes(1);
    expect(unsubscribeEnded).toHaveBeenCalledTimes(1);
  });
});
