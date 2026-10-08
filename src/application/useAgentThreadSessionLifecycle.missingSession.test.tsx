// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agentSessionBackgroundOf } from "../domain/agentSessionBackground";
import type { AgentThread, AgentThreadOwner } from "../domain/agentThread";
import type {
  AgentBackgroundTaskStopOutcome,
  AgentSessionBackgroundTasksEvent,
  AgentSessionEndedEvent,
  AgentThreadSessionGateway,
} from "../domain/agentThreadSession";
import { surfaceThreadView } from "../components/agentMode/agentSurfaceTestFixtures";
import { waitForReact } from "../test/reactTestLifecycle";
import type { AgentSessionEndResult, AgentSessionTaskStopResult } from "./agentThreadPorts";
import {
  useAgentSessionBackgrounds,
  type AgentSessionBackgroundsState,
} from "./useAgentSessionBackgrounds";
import {
  useAgentThreadSessionLifecycle,
  type AgentThreadSessionLifecycle,
} from "./useAgentThreadSessionLifecycle";

const THREAD_ID = "agt-1-0a1c";
const OWNER_ID = "ws-1";
const OTHER_OWNER_ID = "ws-2";
const STRANDED_TASK = "b-stranded";
const REPLACEMENT_TASK = "b-replacement";

type Asked = "end" | "stop";
type PendingAnswer = Promise<AgentSessionEndResult | AgentSessionTaskStopResult>;

interface Scenario {
  current: AgentThread | undefined;
  currentOwners: ReadonlyArray<string>;
}

function thread(ownerId: string = OWNER_ID): AgentThread {
  const base = surfaceThreadView().thread;
  return {
    ...base,
    threadId: THREAD_ID,
    owner: { ...base.owner, ownerId },
    provider: { kind: "claudeCode", sessionId: "sess-fixture-0001" },
  };
}

function shell(taskId: string, workspaceId: string = OWNER_ID): AgentSessionBackgroundTasksEvent {
  return {
    workspaceId,
    threadId: THREAD_ID,
    total: 1,
    agents: 0,
    tasks: [{ taskId, taskType: "shell" }],
    reply: "none",
  };
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

const cleanups: Array<() => void> = [];

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
});

function sessionGateway() {
  const levels: Array<(event: AgentSessionBackgroundTasksEvent) => void> = [];
  const ended = deferred<boolean>();
  const stopped = deferred<AgentBackgroundTaskStopOutcome>();
  const fake = {
    listAgentSessionBackgrounds: vi.fn(async () => []),
    interruptAgentTask: vi.fn(async () => ({ kind: "unsupported" }) as const),
    inspectAgentThreadSession: vi.fn(async () => ({ kind: "none" }) as const),
    endAgentThreadSession: vi.fn(() => ended.promise),
    stopAgentBackgroundTask: vi.fn(() => stopped.promise),
    subscribeAgentSessionEnded: vi.fn(
      async (_handler: (event: AgentSessionEndedEvent) => void) => () => undefined,
    ),
    subscribeAgentSessionBackgroundTurn: vi.fn(async () => () => undefined),
    subscribeAgentSessionBackgroundTasks: vi.fn(
      async (handler: (event: AgentSessionBackgroundTasksEvent) => void) => {
        levels.push(handler);
        return () => undefined;
      },
    ),
  } satisfies AgentThreadSessionGateway;
  return { fake, levels, ended, stopped };
}

async function mount() {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const first = sessionGateway();
  const { ended, stopped } = first;
  const scenario: Scenario = { current: thread(), currentOwners: [OWNER_ID] };
  const wired: { gateway: ReturnType<typeof sessionGateway> } = { gateway: first };
  const reportError = vi.fn();
  const latest: {
    lifecycle: AgentThreadSessionLifecycle | null;
    backgrounds: AgentSessionBackgroundsState | null;
  } = { lifecycle: null, backgrounds: null };

  function Harness() {
    const backgrounds = useAgentSessionBackgrounds(
      wired.gateway.fake,
      () => 1_800_000_000_000,
      reportError,
    );
    latest.backgrounds = backgrounds;
    latest.lifecycle = useAgentThreadSessionLifecycle({
      gateway: wired.gateway.fake,
      readThread: (threadId) =>
        scenario.current?.threadId === threadId ? scenario.current : undefined,
      recordHaltRequest: () => undefined,
      ownsOwner: (owner: AgentThreadOwner) => scenario.currentOwners.includes(owner.ownerId),
      resumeSessionId: (candidate) => candidate.provider.sessionId,
      setNotice: () => undefined,
      reportError,
      watchSession: backgrounds.watchSession,
    });
    return null;
  }

  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Harness)));
  cleanups.push(() => act(() => root.unmount()));
  const listening = async (): Promise<void> => {
    await waitForReact(() => {
      expect(wired.gateway.levels).toHaveLength(1);
      expect(latest.backgrounds?.recovered).toBe(true);
    });
  };
  await listening();

  const publish = (event: AgentSessionBackgroundTasksEvent) =>
    act(() => wired.gateway.levels.forEach((handler) => handler(event)));
  const replaceGateway = async (): Promise<void> => {
    wired.gateway = sessionGateway();
    act(() => root.render(createElement(Harness)));
    await listening();
  };
  const retained = (ownerId: string = OWNER_ID) => {
    expect(latest.backgrounds).not.toBeNull();
    if (latest.backgrounds === null) return null;
    const entry = agentSessionBackgroundOf(latest.backgrounds.backgrounds, ownerId, THREAD_ID);
    return entry?.tasks.map((task) => task.taskId) ?? null;
  };
  const ask = (lifecycle: AgentThreadSessionLifecycle, asked: Asked): PendingAnswer => {
    if (asked === "end") return lifecycle.endSession(thread());
    return lifecycle.stopBackgroundTask(THREAD_ID, STRANDED_TASK);
  };
  const askWhileStranded = (asked: Asked): PendingAnswer => {
    const pending: { answer: PendingAnswer } = { answer: Promise.resolve("failed") };
    expect(latest.lifecycle).not.toBeNull();
    act(() => {
      if (latest.lifecycle !== null) pending.answer = ask(latest.lifecycle, asked);
    });
    return pending.answer;
  };
  const answerMissing = async (answer: PendingAnswer) => {
    const settled: { result: AgentSessionEndResult | AgentSessionTaskStopResult | null } = {
      result: null,
    };
    await act(async () => {
      ended.resolve(false);
      stopped.resolve({ kind: "noSession" });
      settled.result = await answer;
    });
    return settled.result;
  };

  publish(shell(STRANDED_TASK));
  return {
    scenario,
    reportError,
    publish,
    retained,
    askWhileStranded,
    answerMissing,
    replaceGateway,
  };
}

const BOTH = ["end", "stop"] as const;
const MISSING = { end: "none", stop: { kind: "noSession" } } as const;

describe("a late answer that the thread's session is missing", () => {
  it.each(BOTH)(
    "clears the stranded level after %s when no level arrived while the answer was in flight",
    async (asked) => {
      const session = await mount();
      session.publish(shell("b-foreign", OTHER_OWNER_ID));
      const answer = session.askWhileStranded(asked);
      session.publish(shell("b-foreign-next", OTHER_OWNER_ID));
      expect(session.retained()).toEqual([STRANDED_TASK]);

      expect(await session.answerMissing(answer)).toEqual(MISSING[asked]);

      expect(session.retained()).toBeNull();
      expect(session.retained(OTHER_OWNER_ID)).toEqual(["b-foreign-next"]);
      expect(session.reportError).not.toHaveBeenCalled();
    },
  );

  it.each(BOTH)(
    "keeps a replacement session's level published while the %s answer was in flight",
    async (asked) => {
      const session = await mount();
      const answer = session.askWhileStranded(asked);
      session.publish(shell(REPLACEMENT_TASK));

      expect(await session.answerMissing(answer)).toEqual(MISSING[asked]);

      expect(session.retained()).toEqual([REPLACEMENT_TASK]);
    },
  );

  it.each(BOTH)(
    "keeps a level republished unchanged while the %s answer was in flight",
    async (asked) => {
      const session = await mount();
      const answer = session.askWhileStranded(asked);
      session.publish(shell(STRANDED_TASK));

      await session.answerMissing(answer);

      expect(session.retained()).toEqual([STRANDED_TASK]);
    },
  );

  it.each(BOTH)(
    "keeps the new gateway's level when the replaced gateway answers the %s late",
    async (asked) => {
      const session = await mount();
      const answer = session.askWhileStranded(asked);
      await session.replaceGateway();
      expect(session.retained()).toBeNull();
      session.publish(shell(REPLACEMENT_TASK));

      const result = await session.answerMissing(answer);

      expect(result).toEqual(asked === "end" ? "none" : { kind: "stale" });
      expect(session.retained()).toEqual([REPLACEMENT_TASK]);
      expect(session.reportError).not.toHaveBeenCalled();
    },
  );

  const lostAuthority = [
    {
      how: "the thread moved to another owner",
      lose: (scenario: Scenario) => {
        scenario.current = thread(OTHER_OWNER_ID);
      },
    },
    {
      how: "its owner is no longer current",
      lose: (scenario: Scenario) => {
        scenario.currentOwners = [OTHER_OWNER_ID];
      },
    },
    {
      how: "the thread is gone",
      lose: (scenario: Scenario) => {
        scenario.current = undefined;
      },
    },
  ];

  it.each(lostAuthority.flatMap((lost) => BOTH.map((asked) => ({ ...lost, asked }))))(
    "keeps the level when $how while the $asked answer was in flight",
    async ({ asked, lose }) => {
      const session = await mount();
      const answer = session.askWhileStranded(asked);
      lose(session.scenario);

      const result = await session.answerMissing(answer);

      expect(result).toEqual(asked === "end" ? "none" : { kind: "stale" });
      expect(session.retained()).toEqual([STRANDED_TASK]);
      expect(session.reportError).not.toHaveBeenCalled();
    },
  );
});
