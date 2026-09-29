// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultAgentLaunchOptions } from "../domain/agentLaunch";
import {
  agentThreadsReducer,
  type AgentThread,
  type AgentThreadsAction,
  type AgentTurn,
} from "../domain/agentThread";
import type {
  AgentSessionBackgroundTurnEvent,
  AgentSessionInspection,
  AgentTaskInterruptOutcome,
  AgentThreadSessionGateway,
} from "../domain/agentThreadSession";
import { AGENT_BACKGROUND_TURN_LABEL } from "../domain/agentTurnOrigin";
import { surfaceThreadView } from "../components/agentMode/agentSurfaceTestFixtures";
import { waitForReact } from "../test/reactTestLifecycle";
import { useAgentThreadSessionLifecycle } from "./useAgentThreadSessionLifecycle";

const THREAD_ID = "agt-1-0a1c";
const RELEASED_NOTICE =
  'Claude replied in "Nightly build" after background work finished, but Codevo stopped tracking the thread before the reply could be added: "background-finished"';
const OWNER_ID = "ws-1";
const NOW = 1_800_000_000_000;

function settledTurn(overrides: Partial<AgentTurn> = {}): AgentTurn {
  return {
    turnId: "agt-1-t1",
    prompt: "start the build in the background",
    status: { kind: "exited", exitCode: 0 },
    startedAtEpochMs: 1,
    endedAtEpochMs: 2,
    events: [],
    eventsTruncated: false,
    lastStatusSequence: 1,
    lastOutputSequence: 1,
    launch: defaultAgentLaunchOptions("claudeCode"),
    cliVersion: null,
    ...overrides,
  };
}

function thread(overrides: Partial<AgentThread> = {}): AgentThread {
  const base = surfaceThreadView().thread;
  return {
    ...base,
    threadId: THREAD_ID,
    title: "Nightly build",
    archived: false,
    owner: { ...base.owner, ownerId: OWNER_ID },
    provider: { kind: "claudeCode", sessionId: "sess-fixture-0001" },
    turns: [settledTurn()],
    ...overrides,
  };
}

function output(text: string, origin: unknown = { kind: "task-notification" }): string {
  return [
    { type: "system", subtype: "init", session_id: "sess-fixture-0001" },
    {
      type: "assistant",
      parent_tool_use_id: null,
      message: { content: [{ type: "text", text }] },
    },
    {
      type: "result",
      subtype: "success",
      is_error: false,
      result: text,
      total_cost_usd: 0.01,
      usage: { input_tokens: 3, output_tokens: 2 },
      ...(origin === null ? {} : { origin }),
    },
  ]
    .map((line) => `${JSON.stringify(line)}\n`)
    .join("");
}

function event(overrides: Partial<AgentSessionBackgroundTurnEvent> = {}) {
  return {
    workspaceId: OWNER_ID,
    threadId: THREAD_ID,
    output: output("background-finished"),
    truncated: false,
    complete: true,
    ...overrides,
  } satisfies AgentSessionBackgroundTurnEvent;
}

function gateway() {
  let background: ((event: AgentSessionBackgroundTurnEvent) => void) | null = null;
  const unsubscribeBackground = vi.fn();
  const fake = {
    interruptAgentTask: vi.fn(async (): Promise<AgentTaskInterruptOutcome> => ({
      kind: "interrupting",
    })),
    inspectAgentThreadSession: vi.fn(async (): Promise<AgentSessionInspection> => ({
      kind: "none",
    })),
    endAgentThreadSession: vi.fn(async () => true),
    subscribeAgentSessionEnded: vi.fn(async () => () => undefined),
    subscribeAgentSessionBackgroundTurn: vi.fn(
      async (handler: (event: AgentSessionBackgroundTurnEvent) => void) => {
        background = handler;
        return unsubscribeBackground;
      },
    ),
    subscribeAgentSessionBackgroundTasks: vi.fn(async () => () => undefined),
  } satisfies AgentThreadSessionGateway;
  return {
    fake,
    unsubscribeBackground,
    emit(value: AgentSessionBackgroundTurnEvent) {
      expect(background).not.toBeNull();
      act(() => background?.(value));
    },
  };
}

const cleanups: Array<() => void> = [];

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
});

function render(initial: AgentThread | undefined, fake: AgentThreadSessionGateway) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const scenario: {
    current: AgentThread | undefined;
    mintedIds: Array<string | null>;
    revision: object;
  } = {
    current: initial,
    mintedIds: ["agt-bg-0001"],
    revision: {},
  };
  const setNotice = vi.fn();
  const reportError = vi.fn();
  const dispatched: AgentThreadsAction[] = [];
  const dispatch = vi.fn((action: AgentThreadsAction) => {
    dispatched.push(action);
    if (scenario.current === undefined) return;
    const state = { threads: new Map([[scenario.current.threadId, scenario.current]]) };
    scenario.current = agentThreadsReducer(state, action).threads.get(scenario.current.threadId);
  });

  function Harness() {
    useAgentThreadSessionLifecycle({
      gateway: fake,
      readThread: (threadId) =>
        scenario.current?.threadId === threadId ? scenario.current : undefined,
      recordHaltRequest: () => undefined,
      ownsOwner: (owner) => owner.ownerId === OWNER_ID,
      resumeSessionId: (candidate) => candidate.provider.sessionId,
      setNotice,
      reportError,
      stateRevision: scenario.revision,
      backgroundTurns: {
        mintTurnId: () => scenario.mintedIds.shift() ?? null,
        dispatch,
        now: () => NOW,
      },
    });
    return null;
  }

  const host = document.createElement("div");
  const root = createRoot(host);
  let mounted = true;
  act(() => root.render(createElement(Harness)));
  const unmount = () => {
    if (!mounted) return;
    mounted = false;
    act(() => root.unmount());
  };
  cleanups.push(unmount);
  const update = (next: AgentThread | undefined) => {
    scenario.current = next;
    scenario.revision = {};
    act(() => root.render(createElement(Harness)));
  };
  return { scenario, setNotice, reportError, dispatch, dispatched, unmount, update };
}

function runningTurn(turnId: string, prompt = "start the build in the background"): AgentTurn {
  return settledTurn({ turnId, prompt, status: { kind: "running" }, endedAtEpochMs: null });
}

function noticeMessages(setNotice: ReturnType<typeof vi.fn>): ReadonlyArray<string> {
  return setNotice.mock.calls.map(([notice]) => (notice as { message: string }).message);
}

async function subscribed(fake: AgentThreadSessionGateway): Promise<void> {
  await waitForReact(() =>
    expect(fake.subscribeAgentSessionBackgroundTurn).toHaveBeenCalledTimes(1),
  );
}

describe("useAgentThreadSessionLifecycle background turns", () => {
  it("records an unprompted Claude turn as a terminal background turn of the exact owner", async () => {
    const { fake, emit } = gateway();
    const harness = render(thread(), fake);
    await subscribed(fake);

    emit(event());

    expect(harness.dispatched).toHaveLength(1);
    expect(harness.dispatched[0]).toMatchObject({
      kind: "backgroundTurnRecorded",
      threadId: THREAD_ID,
      workspaceId: OWNER_ID,
    });
    const recorded = harness.scenario.current?.turns[1];
    expect(recorded).toMatchObject({
      turnId: "agt-bg-0001",
      origin: "background",
      prompt: AGENT_BACKGROUND_TURN_LABEL,
      status: { kind: "exited", exitCode: 0 },
      eventsTruncated: false,
      startedAtEpochMs: NOW,
      launch: null,
    });
    expect(recorded?.events).toContainEqual({
      kind: "assistantText",
      text: "background-finished",
    });
    expect(harness.setNotice).not.toHaveBeenCalled();
  });

  it("ignores foreign owners, Codex, remote and unknown threads", async () => {
    const cases: ReadonlyArray<
      readonly [AgentThread | undefined, AgentSessionBackgroundTurnEvent]
    > = [
      [thread(), event({ workspaceId: "ws-other" })],
      [thread({ provider: { kind: "codex", sessionId: null } }), event()],
      [
        thread({ threadId: "remote-thread:server-1:runner-1:conv-1" }),
        event({ threadId: "remote-thread:server-1:runner-1:conv-1" }),
      ],
      [undefined, event()],
    ];
    for (const [current, value] of cases) {
      const { fake, emit } = gateway();
      const harness = render(current, fake);
      await subscribed(fake);
      emit(value);
      expect(harness.dispatch).not.toHaveBeenCalled();
      expect(harness.setNotice).not.toHaveBeenCalled();
      harness.unmount();
    }
  });

  it("records a reply that arrives before the previous turn settles after that turn", async () => {
    const { fake, emit } = gateway();
    const harness = render(thread({ turns: [runningTurn("agt-1-t1")] }), fake);
    await subscribed(fake);

    emit(event());

    expect(harness.dispatch).not.toHaveBeenCalled();
    expect(harness.setNotice).not.toHaveBeenCalled();

    harness.update(thread({ turns: [settledTurn()] }));

    expect(harness.dispatch).toHaveBeenCalledTimes(1);
    expect(harness.scenario.current?.turns.map((turn) => [turn.turnId, turn.origin])).toEqual([
      ["agt-1-t1", undefined],
      ["agt-bg-0001", "background"],
    ]);
    expect(harness.scenario.current?.turns[1]?.events).toContainEqual({
      kind: "assistantText",
      text: "background-finished",
    });
    expect(harness.setNotice).not.toHaveBeenCalled();

    harness.update(harness.scenario.current);
    expect(harness.dispatch).toHaveBeenCalledTimes(1);
  });

  it("keeps waiting while the exact previous turn is still running", async () => {
    const { fake, emit } = gateway();
    const harness = render(thread({ turns: [runningTurn("agt-1-t1")] }), fake);
    await subscribed(fake);

    emit(event());
    harness.update(thread({ title: "Renamed", turns: [runningTurn("agt-1-t1")] }));

    expect(harness.dispatch).not.toHaveBeenCalled();
    expect(harness.setNotice).not.toHaveBeenCalled();
  });

  it("shows a bounded preview only when a newer message is already running", async () => {
    const { fake, emit } = gateway();
    const harness = render(thread({ turns: [runningTurn("agt-1-t1")] }), fake);
    await subscribed(fake);

    emit(event({ output: output(`All tests passed.\n${"x".repeat(1_000)}`) }));
    harness.update(thread({ turns: [settledTurn(), runningTurn("agt-1-t2", "next message")] }));

    expect(harness.dispatch).not.toHaveBeenCalled();
    expect(harness.scenario.current?.turns.map((turn) => turn.turnId)).toEqual([
      "agt-1-t1",
      "agt-1-t2",
    ]);
    expect(harness.setNotice).toHaveBeenCalledTimes(1);
    const notice = harness.setNotice.mock.calls[0]?.[0] as { kind: string; message: string };
    expect(notice.kind).toBe("info");
    expect(notice.message).toContain('"Nightly build" after background work finished');
    expect(notice.message).toContain("was not added to the thread");
    expect(notice.message).toContain("All tests passed. xxx");
    expect(notice.message.length).toBeLessThan(600);
  });

  it("names an unprompted reply without claiming background work finished", async () => {
    const { fake, emit } = gateway();
    const harness = render(thread({ turns: [runningTurn("agt-1-t1")] }), fake);
    await subscribed(fake);

    emit(event({ output: output("side reply", null) }));
    harness.update(thread({ turns: [settledTurn(), runningTurn("agt-1-t2", "next message")] }));

    expect(noticeMessages(harness.setNotice)).toEqual([
      'Claude replied in "Nightly build" without a new message, but the reply was not added to the thread because your next message is running: "side reply"',
    ]);
  });

  it("tells the user with a preview when the owner changes or the thread is removed while a reply is held", async () => {
    for (const next of [
      thread({ owner: { ...thread().owner, ownerId: "ws-2" }, turns: [settledTurn()] }),
      undefined,
    ]) {
      const { fake, emit } = gateway();
      const harness = render(thread({ turns: [runningTurn("agt-1-t1")] }), fake);
      await subscribed(fake);
      emit(event());
      harness.update(next);
      harness.update(thread({ turns: [settledTurn()] }));
      expect(harness.dispatch).not.toHaveBeenCalled();
      expect(noticeMessages(harness.setNotice)).toEqual([RELEASED_NOTICE]);
      harness.unmount();
      expect(harness.setNotice).toHaveBeenCalledTimes(1);
    }
  });

  it("records a held reply at once on unmount when its owner is still valid and its turn settled", async () => {
    const { fake, emit } = gateway();
    const harness = render(thread({ turns: [runningTurn("agt-1-t1")] }), fake);
    await subscribed(fake);
    emit(event());
    harness.scenario.current = thread({ turns: [settledTurn()] });

    harness.unmount();

    expect(harness.dispatch).toHaveBeenCalledTimes(1);
    expect(harness.scenario.current?.turns.map((turn) => [turn.turnId, turn.origin])).toEqual([
      ["agt-1-t1", undefined],
      ["agt-bg-0001", "background"],
    ]);
    expect(harness.setNotice).not.toHaveBeenCalled();
  });

  it("shows a preview on unmount when the held reply cannot be recorded yet", async () => {
    const { fake, emit } = gateway();
    const harness = render(thread({ turns: [runningTurn("agt-1-t1")] }), fake);
    await subscribed(fake);
    emit(event());

    harness.unmount();

    expect(harness.dispatch).not.toHaveBeenCalled();
    expect(noticeMessages(harness.setNotice)).toEqual([RELEASED_NOTICE]);
  });

  it("shows a preview on unmount when the owner changed before the held reply settled", async () => {
    for (const next of [
      thread({ owner: { ...thread().owner, ownerId: "ws-2" }, turns: [settledTurn()] }),
      undefined,
    ]) {
      const { fake, emit } = gateway();
      const harness = render(thread({ turns: [runningTurn("agt-1-t1")] }), fake);
      await subscribed(fake);
      emit(event());
      harness.scenario.current = next;

      harness.unmount();

      expect(harness.dispatch).not.toHaveBeenCalled();
      expect(noticeMessages(harness.setNotice)).toEqual([RELEASED_NOTICE]);
    }
  });

  it("holds at most two replies per thread and surfaces the oldest instead of dropping it", async () => {
    const { fake, emit } = gateway();
    const harness = render(thread({ turns: [runningTurn("agt-1-t1")] }), fake);
    harness.scenario.mintedIds.push("agt-bg-0002");
    await subscribed(fake);

    emit(event({ output: output("first") }));
    emit(event({ output: output("second") }));
    emit(event({ output: output("third") }));

    expect(noticeMessages(harness.setNotice)).toEqual([
      'Claude replied in "Nightly build" after background work finished, but newer replies arrived before it could be added to the thread: "first"',
    ]);

    harness.update(thread({ turns: [settledTurn()] }));

    const recorded = harness.scenario.current?.turns.slice(1) ?? [];
    expect(recorded.map((turn) => turn.turnId)).toEqual(["agt-bg-0001", "agt-bg-0002"]);
    expect(recorded.map((turn) => turn.events.find((item) => item.kind === "result"))).toEqual([
      expect.objectContaining({ text: "second" }),
      expect.objectContaining({ text: "third" }),
    ]);
    expect(harness.setNotice).toHaveBeenCalledTimes(1);
  });

  it("records truncated or incomplete output with the truncation marker", async () => {
    const { fake, emit } = gateway();
    const harness = render(thread(), fake);
    harness.scenario.mintedIds.push("agt-bg-0002");
    await subscribed(fake);

    emit(event({ truncated: true }));
    emit(event({ complete: false }));

    const [truncated, incomplete] = harness.scenario.current?.turns.slice(1) ?? [];
    expect(truncated?.eventsTruncated).toBe(true);
    expect(truncated?.streamMetrics?.complete).toBe(false);
    expect(incomplete?.eventsTruncated).toBe(true);
    expect(incomplete?.status).toEqual({ kind: "interrupted" });
  });

  it("tells the user when the reply cannot be added to the thread", async () => {
    const { fake, emit } = gateway();
    const harness = render(thread({ archived: true }), fake);
    await subscribed(fake);

    emit(event());

    expect(harness.scenario.current?.turns).toHaveLength(1);
    expect(harness.setNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "info",
        message: expect.stringContaining("background-finished"),
      }),
    );
  });

  it("does not record anything when no turn id can be minted or the output is empty", async () => {
    const { fake, emit } = gateway();
    const harness = render(thread(), fake);
    harness.scenario.mintedIds.splice(0);
    await subscribed(fake);

    emit(event());
    emit(event({ output: "" }));

    expect(harness.dispatch).not.toHaveBeenCalled();
    expect(harness.setNotice).toHaveBeenCalledTimes(1);
    expect(harness.scenario.current?.turns).toHaveLength(1);
  });

  it("tells the user when the reply was unreadable instead of dropping it silently", async () => {
    const { fake, emit } = gateway();
    const harness = render(thread(), fake);
    await subscribed(fake);

    emit(event({ output: `${JSON.stringify({ type: "system", subtype: "status" })}\n` }));
    emit(event({ output: "", truncated: true }));
    emit(event({ output: "", complete: false }));

    expect(harness.dispatch).not.toHaveBeenCalled();
    expect(harness.scenario.current?.turns).toHaveLength(1);
    expect(harness.setNotice).toHaveBeenCalledTimes(3);
    for (const [notice] of harness.setNotice.mock.calls) {
      expect(notice).toEqual({
        kind: "info",
        message:
          'Claude replied in "Nightly build" without a new message, but Codevo could not read the reply.',
        action: null,
      });
    }
  });

  it("tells the user when the reducer rejects a reused turn id", async () => {
    const { fake, emit } = gateway();
    const harness = render(thread(), fake);
    harness.scenario.mintedIds.splice(0, 1, "agt-1-t1");
    await subscribed(fake);

    emit(event());

    expect(harness.dispatch).toHaveBeenCalledTimes(1);
    expect(harness.scenario.current?.turns.map((turn) => turn.origin)).toEqual([undefined]);
    expect(harness.setNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "info",
        message: expect.stringContaining("the reply could not be added to the thread"),
      }),
    );
  });

  it("stops recording after unmount and releases the subscription", async () => {
    const { fake, emit, unsubscribeBackground } = gateway();
    const harness = render(thread(), fake);
    await subscribed(fake);

    harness.unmount();
    emit(event());

    expect(unsubscribeBackground).toHaveBeenCalledTimes(1);
    expect(harness.dispatch).not.toHaveBeenCalled();
  });
});
