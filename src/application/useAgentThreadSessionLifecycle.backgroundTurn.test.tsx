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
import type { AgentThreadRecovery } from "./agentEvictedThreadRecovery";
import { MAX_QUEUED_REPLIES_PER_RECOVERING_ROOT } from "./agentThreadRecoveryQueue";
import { useAgentThreadSessionLifecycle } from "./useAgentThreadSessionLifecycle";

const THREAD_ID = "agt-1-0a1c";
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
    stopAgentBackgroundTask: vi.fn(async () => ({ kind: "noSession" }) as const),
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

type RecoverThread = (threadId: string, workspaceId: string) => Promise<AgentThreadRecovery>;

function render(
  initial: AgentThread | undefined,
  fake: AgentThreadSessionGateway,
  recoverThread?: RecoverThread,
) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const scenario: {
    current: AgentThread | undefined;
    mintedIds: Array<string | null>;
  } = {
    current: initial,
    mintedIds: ["agt-bg-0001"],
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
      backgroundTurns: {
        mintTurnId: () => scenario.mintedIds.shift() ?? null,
        dispatch,
        now: () => NOW,
      },
      ...(recoverThread === undefined
        ? {}
        : {
            evictedThreads: {
              rootKeyOf: (workspaceId: string) =>
                workspaceId === OWNER_ID ? "/workspace/app" : null,
              recover: recoverThread,
            },
          }),
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
  return { scenario, setNotice, reportError, dispatch, dispatched, unmount };
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

  it("records a reply that arrives while a turn runs at once, before that running turn", async () => {
    const { fake, emit } = gateway();
    const harness = render(
      thread({ turns: [settledTurn(), runningTurn("agt-1-t2", "next")] }),
      fake,
    );
    await subscribed(fake);

    emit(event());

    expect(harness.dispatch).toHaveBeenCalledTimes(1);
    expect(harness.scenario.current?.turns.map((turn) => [turn.turnId, turn.origin])).toEqual([
      ["agt-1-t1", undefined],
      ["agt-bg-0001", "background"],
      ["agt-1-t2", undefined],
    ]);
    expect(harness.scenario.current?.turns[1]?.events).toContainEqual({
      kind: "assistantText",
      text: "background-finished",
    });
    expect(harness.setNotice).not.toHaveBeenCalled();
  });

  it("records 25 replies during one long running turn without any notice", async () => {
    const { fake, emit } = gateway();
    const harness = render(thread({ turns: [runningTurn("agt-1-t1")] }), fake);
    const replies = Array.from({ length: 25 }, (_, index) => `reply ${index}`);
    harness.scenario.mintedIds.push(
      ...replies.slice(1).map((_, index) => `agt-bg-${String(index + 2).padStart(4, "0")}`),
    );
    await subscribed(fake);

    replies.forEach((text, index) => {
      const flags = index === 7 ? { complete: false } : index === 13 ? { truncated: true } : {};
      emit(event({ output: output(text), ...flags }));
      expect(harness.scenario.current?.turns).toHaveLength(index + 2);
    });

    const turns = harness.scenario.current?.turns ?? [];
    expect(turns[turns.length - 1]?.turnId).toBe("agt-1-t1");
    expect(
      turns.slice(0, -1).map((turn) => turn.events.find((item) => item.kind === "result")),
    ).toEqual(replies.map((text) => expect.objectContaining({ text })));
    expect(turns[7]?.status).toEqual({ kind: "interrupted" });
    expect(turns[13]?.eventsTruncated).toBe(true);
    expect(harness.setNotice).not.toHaveBeenCalled();
  });

  it("names an unprompted reply without claiming background work finished", async () => {
    const { fake, emit } = gateway();
    const harness = render(thread({ archived: true }), fake);
    await subscribed(fake);

    emit(event({ output: output("side reply", null) }));

    expect(noticeMessages(harness.setNotice)).toEqual([
      'Claude replied in "Nightly build" without a new message, but the reply could not be added to the thread: "side reply"',
    ]);
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

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("useAgentThreadSessionLifecycle background turns for threads evicted from memory", () => {
  it("reopens the saved thread and records the reply into it", async () => {
    const { fake, emit } = gateway();
    const reopen = vi.fn<RecoverThread>(async () => {
      harness.scenario.current = thread();
      return { kind: "restored" };
    });
    const harness = render(undefined, fake, reopen);
    await subscribed(fake);

    emit(event());

    await waitForReact(() => expect(harness.scenario.current?.turns).toHaveLength(2));
    expect(reopen).toHaveBeenCalledWith(THREAD_ID, OWNER_ID);
    expect(harness.scenario.current?.turns[1]).toMatchObject({
      turnId: "agt-bg-0001",
      origin: "background",
    });
    expect(harness.setNotice).not.toHaveBeenCalled();
  });

  it("keeps replies for the same evicted thread in arrival order while it reopens", async () => {
    const { fake, emit } = gateway();
    const reopening = deferred<AgentThreadRecovery>();
    const reopen = vi.fn<RecoverThread>(() => reopening.promise);
    const harness = render(undefined, fake, reopen);
    harness.scenario.mintedIds.push("agt-bg-0002");
    await subscribed(fake);

    emit(event({ output: output("first") }));
    emit(event({ output: output("second") }));
    await waitForReact(() => expect(reopen).toHaveBeenCalledTimes(1));
    expect(harness.dispatch).not.toHaveBeenCalled();
    harness.scenario.current = thread();
    await act(async () => reopening.resolve({ kind: "restored" }));

    await waitForReact(() => expect(harness.scenario.current?.turns).toHaveLength(3));
    expect(reopen).toHaveBeenCalledTimes(1);
    expect(
      harness.scenario.current?.turns
        .slice(1)
        .map((turn) => turn.events.find((item) => item.kind === "result")),
    ).toEqual([
      expect.objectContaining({ text: "first" }),
      expect.objectContaining({ text: "second" }),
    ]);
    expect(harness.setNotice).not.toHaveBeenCalled();
  });

  it("names the saved thread when it cannot be reopened", async () => {
    const { fake, emit } = gateway();
    const harness = render(undefined, fake, async () => ({
      kind: "notRestored",
      title: "Nightly build",
    }));
    await subscribed(fake);

    emit(event());

    await waitForReact(() =>
      expect(noticeMessages(harness.setNotice)).toEqual([
        'Claude replied in "Nightly build" after background work finished, but the reply could not be added to the thread: "background-finished"',
      ]),
    );
    expect(harness.dispatch).not.toHaveBeenCalled();
  });

  it("says the thread is not open when the saved thread cannot be found", async () => {
    const { fake, emit } = gateway();
    const harness = render(undefined, fake, async () => ({ kind: "notRestored", title: null }));
    await subscribed(fake);

    emit(event({ output: output("side reply", null) }));

    await waitForReact(() =>
      expect(noticeMessages(harness.setNotice)).toEqual([
        'Claude replied in a thread that is not open without a new message, but the reply could not be added to the thread: "side reply"',
      ]),
    );
  });

  it("stays silent for foreign workspaces and never reopens remote threads", async () => {
    const { fake, emit } = gateway();
    const reopen = vi.fn<RecoverThread>(async () => ({ kind: "foreign" }));
    const harness = render(undefined, fake, reopen);
    await subscribed(fake);

    emit(event({ workspaceId: "ws-other" }));
    emit(event({ threadId: "remote-thread:server-1:runner-1:conv-1" }));
    emit(event());

    await waitForReact(() => expect(reopen).toHaveBeenCalledTimes(1));
    await act(async () => Promise.resolve());
    expect(reopen).toHaveBeenCalledWith(THREAD_ID, OWNER_ID);
    expect(harness.dispatch).not.toHaveBeenCalled();
    expect(harness.setNotice).not.toHaveBeenCalled();
  });

  it("reopens one evicted thread of a project root at a time", async () => {
    const { fake, emit } = gateway();
    const first = deferred<AgentThreadRecovery>();
    const reopen = vi.fn<RecoverThread>((threadId) =>
      threadId === THREAD_ID
        ? first.promise
        : Promise.resolve({ kind: "notRestored", title: "Other" }),
    );
    const harness = render(undefined, fake, reopen);
    await subscribed(fake);

    emit(event());
    emit(event({ threadId: "agt-2-0b2d", output: output("other reply") }));
    await waitForReact(() => expect(reopen).toHaveBeenCalledTimes(1));
    await act(async () => Promise.resolve());
    expect(reopen).toHaveBeenCalledTimes(1);

    await act(async () => first.resolve({ kind: "notRestored", title: "Nightly build" }));

    await waitForReact(() => expect(reopen).toHaveBeenCalledTimes(2));
    expect(reopen.mock.calls.map(([threadId]) => threadId)).toEqual([THREAD_ID, "agt-2-0b2d"]);
    await waitForReact(() => expect(harness.setNotice).toHaveBeenCalledTimes(2));
  });

  it("records into the thread when the user opened it while the reopening failed", async () => {
    const { fake, emit } = gateway();
    const harness = render(undefined, fake, async () => {
      harness.scenario.current = thread();
      return { kind: "notRestored", title: "Nightly build" };
    });
    await subscribed(fake);

    emit(event());

    await waitForReact(() => expect(harness.scenario.current?.turns).toHaveLength(2));
    expect(harness.scenario.current?.turns[1]?.origin).toBe("background");
    expect(harness.setNotice).not.toHaveBeenCalled();
  });

  it("tells the user at once when too many replies wait for one thread to reopen", async () => {
    const { fake, emit } = gateway();
    const reopening = deferred<AgentThreadRecovery>();
    const harness = render(undefined, fake, () => reopening.promise);
    await subscribed(fake);

    for (let index = 0; index <= MAX_QUEUED_REPLIES_PER_RECOVERING_ROOT; index += 1) {
      emit(event({ output: output(`reply ${index}`) }));
    }

    expect(noticeMessages(harness.setNotice)).toEqual([
      `Claude replied in a thread that is not open after background work finished, but the reply could not be added to the thread: "reply ${MAX_QUEUED_REPLIES_PER_RECOVERING_ROOT}"`,
    ]);
    await act(async () => reopening.resolve({ kind: "foreign" }));
    expect(harness.dispatch).not.toHaveBeenCalled();
  });

  it("drops a reopening that settles after unmount", async () => {
    const { fake, emit } = gateway();
    const reopening = deferred<AgentThreadRecovery>();
    const harness = render(undefined, fake, () => reopening.promise);
    await subscribed(fake);

    emit(event());
    await act(async () => Promise.resolve());
    harness.unmount();
    harness.scenario.current = thread();
    await act(async () => reopening.resolve({ kind: "notRestored", title: "Nightly build" }));

    expect(harness.dispatch).not.toHaveBeenCalled();
    expect(harness.setNotice).not.toHaveBeenCalled();
  });
});
