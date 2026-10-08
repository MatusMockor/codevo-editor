// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultAgentLaunchOptions } from "../domain/agentLaunch";
import type { AgentThread, AgentThreadOwner, AgentTurn } from "../domain/agentThread";
import type {
  AgentSessionEndedEvent,
  AgentSessionInspection,
  AgentBackgroundTaskStopOutcome,
  AgentTaskInterruptOutcome,
  AgentThreadSessionGateway,
} from "../domain/agentThreadSession";
import { surfaceThreadView } from "../components/agentMode/agentSurfaceTestFixtures";
import { waitForReact } from "../test/reactTestLifecycle";
import type { AgentSessionBackgroundInspection, AgentSessionEndResult } from "./agentThreadPorts";
import {
  useAgentThreadSessionLifecycle,
  type AgentThreadSessionLifecycle,
} from "./useAgentThreadSessionLifecycle";

const THREAD_ID = "agt-1-0a1c";
const OWNER_ID = "ws-1";

const running: AgentTurn = {
  turnId: "agt-1-t2",
  prompt: "continue",
  status: { kind: "running" },
  startedAtEpochMs: 1,
  endedAtEpochMs: null,
  events: [],
  eventsTruncated: false,
  lastStatusSequence: 1,
  lastOutputSequence: 0,
  launch: defaultAgentLaunchOptions("claudeCode"),
  cliVersion: null,
};

function thread(overrides: Partial<AgentThread> = {}): AgentThread {
  const base = surfaceThreadView().thread;
  return {
    ...base,
    threadId: THREAD_ID,
    owner: { ...base.owner, ownerId: OWNER_ID },
    provider: { kind: "claudeCode", sessionId: "sess-fixture-0001" },
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function gateway(overrides: Partial<AgentThreadSessionGateway> = {}) {
  let ended: ((event: AgentSessionEndedEvent) => void) | null = null;
  const unsubscribe = vi.fn();
  const unsubscribeBackground = vi.fn();
  const fake = {
    interruptAgentTask: vi.fn(async (): Promise<AgentTaskInterruptOutcome> => ({
      kind: "interrupting",
    })),
    inspectAgentThreadSession: vi.fn(async (): Promise<AgentSessionInspection> => ({
      kind: "none",
    })),
    endAgentThreadSession: vi.fn(async () => true),
    stopAgentBackgroundTask: vi.fn(async (): Promise<AgentBackgroundTaskStopOutcome> => ({
      kind: "stopping",
    })),
    subscribeAgentSessionEnded: vi.fn(async (handler: (event: AgentSessionEndedEvent) => void) => {
      ended = handler;
      return unsubscribe;
    }),
    subscribeAgentSessionBackgroundTurn: vi.fn(async () => unsubscribeBackground),
    subscribeAgentSessionBackgroundTasks: vi.fn(async () => () => undefined),
    ...overrides,
  } satisfies AgentThreadSessionGateway;
  return {
    fake,
    unsubscribe,
    emit: (event: AgentSessionEndedEvent) => {
      expect(ended).not.toBeNull();
      ended?.(event);
    },
  };
}

interface Scenario {
  current: AgentThread | undefined;
  currentOwners: ReadonlyArray<string>;
  resumeSessionId: (thread: AgentThread) => string | null;
}

const cleanups: Array<() => void> = [];

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
});

function render(current: AgentThread | undefined, fake: AgentThreadSessionGateway | undefined) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const scenario: Scenario = {
    current,
    currentOwners: [OWNER_ID],
    resumeSessionId: (candidate) => candidate.provider.sessionId,
  };
  const setNotice = vi.fn();
  const reportError = vi.fn();
  const recordHaltRequest = vi.fn();
  let latest: AgentThreadSessionLifecycle | null = null;

  function Harness() {
    latest = useAgentThreadSessionLifecycle({
      gateway: fake,
      readThread: (threadId) =>
        scenario.current?.threadId === threadId ? scenario.current : undefined,
      recordHaltRequest,
      ownsOwner: (owner: AgentThreadOwner) => scenario.currentOwners.includes(owner.ownerId),
      resumeSessionId: (candidate) => scenario.resumeSessionId(candidate),
      setNotice,
      reportError,
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
  return {
    scenario,
    setNotice,
    reportError,
    recordHaltRequest,
    unmount,
    rerender: () => act(() => root.render(createElement(Harness))),
    hook(): AgentThreadSessionLifecycle {
      expect(latest).not.toBeNull();
      return latest as unknown as AgentThreadSessionLifecycle;
    },
  };
}

describe("useAgentThreadSessionLifecycle interrupt", () => {
  it("interrupts only the running local Claude turn with its exact owner", async () => {
    const { fake } = gateway();
    const harness = render(thread({ turns: [running] }), fake);

    await act(async () => {
      await expect(harness.hook().interrupt(THREAD_ID)).resolves.toBe(true);
    });

    expect(fake.interruptAgentTask).toHaveBeenCalledWith({
      taskId: "agt-1-t2",
      workspaceId: OWNER_ID,
      threadId: THREAD_ID,
    });
    expect(harness.recordHaltRequest).toHaveBeenCalledWith({
      threadId: THREAD_ID,
      ownerId: OWNER_ID,
      turnId: "agt-1-t2",
    });
  });

  it("does not accept an interrupt the backend turned into a hard stop", async () => {
    const { fake } = gateway({
      interruptAgentTask: vi.fn(async (): Promise<AgentTaskInterruptOutcome> => ({
        kind: "stopping",
      })),
    });
    const harness = render(thread({ turns: [running] }), fake);

    await act(async () => {
      await expect(harness.hook().interrupt(THREAD_ID)).resolves.toBe(false);
    });
  });

  it("falls back when the runtime cannot interrupt", async () => {
    const { fake } = gateway({
      interruptAgentTask: vi.fn(async (): Promise<AgentTaskInterruptOutcome> => ({
        kind: "unsupported",
      })),
    });
    const harness = render(thread({ turns: [running] }), fake);

    await act(async () => {
      await expect(harness.hook().interrupt(THREAD_ID)).resolves.toBe(false);
    });
  });

  it("never sends Codex, remote, idle, unknown or unwired threads to the session runtime", async () => {
    const cases: ReadonlyArray<AgentThread | undefined> = [
      thread({ turns: [running], provider: { kind: "codex", sessionId: null } }),
      thread({ turns: [running], threadId: "remote-thread:server-1:runner-1:conv-1" }),
      thread(),
      undefined,
    ];
    for (const current of cases) {
      const { fake } = gateway();
      const harness = render(current, fake);
      const threadId = current?.threadId ?? THREAD_ID;
      await act(async () => {
        await expect(harness.hook().interrupt(threadId)).resolves.toBe(false);
      });
      expect(fake.interruptAgentTask).not.toHaveBeenCalled();
      expect(harness.recordHaltRequest).not.toHaveBeenCalled();
    }
    const unwired = render(thread({ turns: [running] }), undefined);
    await act(async () => {
      await expect(unwired.hook().interrupt(THREAD_ID)).resolves.toBe(false);
    });
  });

  it("reports a failed interrupt and falls back", async () => {
    const failure = new Error("ipc");
    const { fake } = gateway({ interruptAgentTask: vi.fn(async () => Promise.reject(failure)) });
    const harness = render(thread({ turns: [running] }), fake);

    await act(async () => {
      await expect(harness.hook().interrupt(THREAD_ID)).resolves.toBe(false);
    });

    expect(harness.reportError).toHaveBeenCalledWith("Agents", failure);
  });

  it("drops a late interrupt result after the thread changed owner", async () => {
    const pending = deferred<AgentTaskInterruptOutcome>();
    const { fake } = gateway({ interruptAgentTask: vi.fn(() => pending.promise) });
    const harness = render(thread({ turns: [running] }), fake);
    let outcome!: Promise<boolean>;
    act(() => {
      outcome = harness.hook().interrupt(THREAD_ID);
    });

    harness.scenario.current = thread({
      turns: [running],
      owner: { ...thread().owner, ownerId: "ws-2" },
    });
    harness.rerender();
    await act(async () => {
      pending.reject(new Error("late"));
      await expect(outcome).resolves.toBe(false);
    });

    expect(harness.reportError).not.toHaveBeenCalled();
  });

  it("ignores a late interrupt reply once a different turn is running", async () => {
    const pending = deferred<AgentTaskInterruptOutcome>();
    const { fake } = gateway({ interruptAgentTask: vi.fn(() => pending.promise) });
    const harness = render(thread({ turns: [running] }), fake);
    let outcome!: Promise<boolean>;
    act(() => {
      outcome = harness.hook().interrupt(THREAD_ID);
    });

    harness.scenario.current = thread({
      turns: [
        { ...running, status: { kind: "exited", exitCode: 0 }, endedAtEpochMs: 2 },
        { ...running, turnId: "agt-1-t3", startedAtEpochMs: 3 },
      ],
    });
    harness.rerender();
    await act(async () => {
      pending.resolve({ kind: "interrupting" });
      await expect(outcome).resolves.toBe(false);
    });

    expect(harness.reportError).not.toHaveBeenCalled();
  });

  it("drops an interrupt result that settles after unmount", async () => {
    const pending = deferred<AgentTaskInterruptOutcome>();
    const { fake } = gateway({ interruptAgentTask: vi.fn(() => pending.promise) });
    const harness = render(thread({ turns: [running] }), fake);
    let outcome!: Promise<boolean>;
    act(() => {
      outcome = harness.hook().interrupt(THREAD_ID);
    });

    harness.unmount();
    pending.resolve({ kind: "interrupting" });

    await expect(outcome).resolves.toBe(false);
  });
});

describe("useAgentThreadSessionLifecycle inspectRestart", () => {
  it("asks before a restart only when background tasks would end", async () => {
    const restart = gateway({
      inspectAgentThreadSession: vi.fn(async (): Promise<AgentSessionInspection> => ({
        kind: "restart",
        backgroundTasks: true,
      })),
    });
    const launch = defaultAgentLaunchOptions("claudeCode");
    const harness = render(thread(), restart.fake);

    await act(async () => {
      await expect(harness.hook().inspectRestart(THREAD_ID, launch)).resolves.toBe("confirm");
    });
    expect(restart.fake.inspectAgentThreadSession).toHaveBeenCalledWith({
      workspaceId: OWNER_ID,
      threadId: THREAD_ID,
      resumeSessionId: "sess-fixture-0001",
      launch,
    });

    for (const inspection of [
      { kind: "restart", backgroundTasks: false },
      { kind: "reuse", backgroundTasks: true },
      { kind: "none" },
    ] satisfies ReadonlyArray<AgentSessionInspection>) {
      const quiet = render(
        thread(),
        gateway({ inspectAgentThreadSession: vi.fn(async () => inspection) }).fake,
      );
      await act(async () => {
        await expect(quiet.hook().inspectRestart(THREAD_ID, launch)).resolves.toBe("proceed");
      });
    }
  });

  it("inspects the session the next start would actually resume", async () => {
    const { fake } = gateway();
    const launch = defaultAgentLaunchOptions("claudeCode");
    const harness = render(thread(), fake);
    harness.scenario.resumeSessionId = () => null;

    await act(async () => {
      await harness.hook().inspectRestart(THREAD_ID, launch);
    });
    harness.scenario.resumeSessionId = () => "sess-adopted-0002";
    await act(async () => {
      await harness.hook().inspectRestart(THREAD_ID, launch);
    });

    expect(
      vi.mocked(fake.inspectAgentThreadSession).mock.calls.map(([request]) => request),
    ).toEqual([
      { workspaceId: OWNER_ID, threadId: THREAD_ID, resumeSessionId: null, launch },
      { workspaceId: OWNER_ID, threadId: THREAD_ID, resumeSessionId: "sess-adopted-0002", launch },
    ]);
  });

  it("proceeds when inspection fails instead of blocking the message", async () => {
    const failure = new Error("ipc");
    const broken = gateway({
      inspectAgentThreadSession: vi.fn(async () => Promise.reject(failure)),
    });
    const harness = render(thread(), broken.fake);

    await act(async () => {
      await expect(
        harness.hook().inspectRestart(THREAD_ID, defaultAgentLaunchOptions("claudeCode")),
      ).resolves.toBe("proceed");
    });

    expect(harness.reportError).toHaveBeenCalledWith("Agents", failure);
  });

  it("never inspects Codex or remote threads", async () => {
    for (const current of [
      thread({ provider: { kind: "codex", sessionId: null } }),
      thread({ threadId: "remote:server-1:runner-1:task-1" }),
    ]) {
      const { fake } = gateway();
      const harness = render(current, fake);
      await act(async () => {
        await expect(
          harness.hook().inspectRestart(current.threadId, defaultAgentLaunchOptions("codex")),
        ).resolves.toBe("proceed");
      });
      expect(fake.inspectAgentThreadSession).not.toHaveBeenCalled();
    }
  });

  it("drops a late inspection after the thread changed owner", async () => {
    const pending = deferred<AgentSessionInspection>();
    const { fake } = gateway({ inspectAgentThreadSession: vi.fn(() => pending.promise) });
    const harness = render(thread(), fake);
    let verdict!: Promise<"proceed" | "confirm">;
    act(() => {
      verdict = harness.hook().inspectRestart(THREAD_ID, defaultAgentLaunchOptions("claudeCode"));
    });

    harness.scenario.current = thread({ owner: { ...thread().owner, ownerId: "ws-2" } });
    harness.rerender();
    await act(async () => {
      pending.reject(new Error("late"));
      await expect(verdict).resolves.toBe("proceed");
    });

    expect(harness.reportError).not.toHaveBeenCalled();
  });
});

describe("useAgentThreadSessionLifecycle endSession", () => {
  it("ends the exact owner's session and says whether one was running", async () => {
    const endAgentThreadSession = vi.fn<AgentThreadSessionGateway["endAgentThreadSession"]>(
      async () => true,
    );
    const { fake } = gateway({ endAgentThreadSession });
    const harness = render(undefined, fake);

    await act(async () => {
      await expect(harness.hook().endSession(thread())).resolves.toBe("ended");
    });
    endAgentThreadSession.mockResolvedValueOnce(false);
    await act(async () => {
      await expect(harness.hook().endSession(thread())).resolves.toBe("none");
    });

    expect(fake.endAgentThreadSession).toHaveBeenCalledWith({
      workspaceId: OWNER_ID,
      threadId: THREAD_ID,
    });
  });

  it("never ends a session for Codex or remote threads or without a gateway", async () => {
    const { fake } = gateway();
    const harness = render(undefined, fake);
    const withoutGateway = render(undefined, undefined);

    await act(async () => {
      await expect(
        harness.hook().endSession(thread({ provider: { kind: "codex", sessionId: null } })),
      ).resolves.toBe("none");
      await expect(
        harness.hook().endSession(thread({ threadId: "remote-thread:server-1:runner-1:c" })),
      ).resolves.toBe("none");
      await expect(withoutGateway.hook().endSession(thread())).resolves.toBe("none");
    });

    expect(fake.endAgentThreadSession).not.toHaveBeenCalled();
  });

  it("returns failed and reports a failed end only while the owner is still current", async () => {
    const failure = new Error("ipc");
    const endAgentThreadSession = vi.fn<AgentThreadSessionGateway["endAgentThreadSession"]>(
      async () => Promise.reject(failure),
    );
    const { fake } = gateway({ endAgentThreadSession });
    const harness = render(undefined, fake);

    await act(async () => {
      await expect(harness.hook().endSession(thread())).resolves.toBe("failed");
    });
    expect(harness.reportError).toHaveBeenCalledWith("Agents", failure);

    harness.reportError.mockClear();
    const pending = deferred<boolean>();
    endAgentThreadSession.mockImplementationOnce(() => pending.promise);
    let ending!: Promise<AgentSessionEndResult>;
    act(() => {
      ending = harness.hook().endSession(thread());
    });
    harness.scenario.currentOwners = ["ws-2"];
    await act(async () => {
      pending.reject(failure);
      await expect(ending).resolves.toBe("failed");
    });

    expect(harness.reportError).not.toHaveBeenCalled();
  });
});

describe("useAgentThreadSessionLifecycle inspectBackground", () => {
  const launch = defaultAgentLaunchOptions("claudeCode");
  const prompted: AgentTurn = {
    ...running,
    turnId: "agt-1-t1",
    status: { kind: "exited", exitCode: 0 },
    endedAtEpochMs: 2,
    launch,
  };
  const background: AgentTurn = {
    ...prompted,
    turnId: "agt-bg-1",
    launch: null,
    origin: "background",
  };

  it("reports live native background tasks of the exact owner's session", async () => {
    const inspectAgentThreadSession = vi.fn<AgentThreadSessionGateway["inspectAgentThreadSession"]>(
      async () => ({ kind: "reuse", backgroundTasks: true }),
    );
    const { fake } = gateway({ inspectAgentThreadSession });
    const harness = render(thread({ turns: [prompted, background] }), fake);

    await act(async () => {
      await expect(harness.hook().inspectBackground(THREAD_ID)).resolves.toBe("live");
    });
    expect(inspectAgentThreadSession).toHaveBeenCalledWith({
      workspaceId: OWNER_ID,
      threadId: THREAD_ID,
      resumeSessionId: "sess-fixture-0001",
      launch,
    });

    const quiet: ReadonlyArray<AgentSessionInspection> = [
      { kind: "restart", backgroundTasks: false },
      { kind: "reuse", backgroundTasks: false },
      { kind: "none" },
    ];
    for (const inspection of quiet) {
      inspectAgentThreadSession.mockResolvedValueOnce(inspection);
      await act(async () => {
        await expect(harness.hook().inspectBackground(THREAD_ID)).resolves.toBe("none");
      });
    }
    inspectAgentThreadSession.mockResolvedValueOnce({ kind: "restart", backgroundTasks: true });
    await act(async () => {
      await expect(harness.hook().inspectBackground(THREAD_ID)).resolves.toBe("live");
    });
  });

  it("answers none without asking for Codex, remote, unknown or never-launched threads", async () => {
    const cases: ReadonlyArray<AgentThread | undefined> = [
      thread({ provider: { kind: "codex", sessionId: null }, turns: [prompted] }),
      thread({ threadId: "remote-thread:server-1:runner-1:c", turns: [prompted] }),
      undefined,
      thread({ turns: [background] }),
    ];
    for (const current of cases) {
      const { fake } = gateway();
      const harness = render(current, fake);
      await act(async () => {
        await expect(
          harness.hook().inspectBackground(current?.threadId ?? THREAD_ID),
        ).resolves.toBe("none");
      });
      expect(fake.inspectAgentThreadSession).not.toHaveBeenCalled();
      harness.unmount();
    }
  });

  it("answers unknown when inspection fails or the owner changed meanwhile", async () => {
    const pending = deferred<AgentSessionInspection>();
    const inspectAgentThreadSession = vi.fn<AgentThreadSessionGateway["inspectAgentThreadSession"]>(
      async () => Promise.reject(new Error("ipc")),
    );
    const { fake } = gateway({ inspectAgentThreadSession });
    const harness = render(thread({ turns: [prompted] }), fake);

    await act(async () => {
      await expect(harness.hook().inspectBackground(THREAD_ID)).resolves.toBe("unknown");
    });

    inspectAgentThreadSession.mockImplementationOnce(() => pending.promise);
    let inspecting!: Promise<AgentSessionBackgroundInspection>;
    act(() => {
      inspecting = harness.hook().inspectBackground(THREAD_ID);
    });
    harness.scenario.current = thread({
      owner: { ...thread().owner, ownerId: "ws-2" },
      turns: [prompted],
    });
    await act(async () => {
      pending.resolve({ kind: "reuse", backgroundTasks: true });
      await expect(inspecting).resolves.toBe("unknown");
    });
    expect(harness.reportError).not.toHaveBeenCalled();
  });
});

describe("useAgentThreadSessionLifecycle ended notices", () => {
  it("notifies only for this owner's unrequested background loss and unsubscribes on unmount", async () => {
    const { fake, emit, unsubscribe } = gateway();
    const harness = render(thread(), fake);
    await waitForReact(() => expect(fake.subscribeAgentSessionEnded).toHaveBeenCalledTimes(1));

    act(() =>
      emit({
        workspaceId: "ws-other",
        threadId: THREAD_ID,
        reason: "idleTimeout",
        backgroundTasksLive: true,
      }),
    );
    act(() =>
      emit({
        workspaceId: OWNER_ID,
        threadId: THREAD_ID,
        reason: "threadEnded",
        backgroundTasksLive: true,
      }),
    );
    act(() =>
      emit({
        workspaceId: OWNER_ID,
        threadId: THREAD_ID,
        reason: "idleTimeout",
        backgroundTasksLive: false,
      }),
    );
    act(() =>
      emit({
        workspaceId: OWNER_ID,
        threadId: "agt-9-ffff",
        reason: "idleTimeout",
        backgroundTasksLive: true,
      }),
    );
    expect(harness.setNotice).not.toHaveBeenCalled();

    act(() =>
      emit({
        workspaceId: OWNER_ID,
        threadId: THREAD_ID,
        reason: "idleTimeout",
        backgroundTasksLive: true,
      }),
    );
    expect(harness.setNotice).toHaveBeenCalledWith({
      kind: "warning",
      message:
        "The Claude session was idle too long while background tasks were still running in this thread; Claude can no longer report on them.",
      action: null,
    });

    harness.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("explains that revoked project trust ended a session with live background tasks", async () => {
    const { fake, emit } = gateway();
    const harness = render(thread(), fake);
    await waitForReact(() => expect(fake.subscribeAgentSessionEnded).toHaveBeenCalledTimes(1));

    act(() =>
      emit({
        workspaceId: "ws-other",
        threadId: THREAD_ID,
        reason: "trustRevoked",
        backgroundTasksLive: true,
      }),
    );
    expect(harness.setNotice).not.toHaveBeenCalled();

    act(() =>
      emit({
        workspaceId: OWNER_ID,
        threadId: THREAD_ID,
        reason: "trustRevoked",
        backgroundTasksLive: true,
      }),
    );
    expect(harness.setNotice).toHaveBeenCalledWith({
      kind: "warning",
      message:
        "Trust in this project was revoked while background tasks were still running in this thread; Claude can no longer report on them.",
      action: null,
    });
  });

  it("ignores ended events for a Codex thread with the same identity", async () => {
    const { fake, emit } = gateway();
    const harness = render(thread({ provider: { kind: "codex", sessionId: null } }), fake);
    await waitForReact(() => expect(fake.subscribeAgentSessionEnded).toHaveBeenCalledTimes(1));

    act(() =>
      emit({
        workspaceId: OWNER_ID,
        threadId: THREAD_ID,
        reason: "crashed",
        backgroundTasksLive: true,
      }),
    );

    expect(harness.setNotice).not.toHaveBeenCalled();
  });

  it("releases a subscription that resolves after unmount", async () => {
    const pending = deferred<() => void>();
    const late = vi.fn();
    const { fake } = gateway({ subscribeAgentSessionEnded: vi.fn(() => pending.promise) });
    const harness = render(thread(), fake);

    harness.unmount();
    await act(async () => {
      pending.resolve(late);
      await pending.promise;
    });

    expect(late).toHaveBeenCalledTimes(1);
  });

  it("reports a failed subscription while mounted", async () => {
    const failure = new Error("listen");
    const { fake } = gateway({
      subscribeAgentSessionEnded: vi.fn(async () => Promise.reject(failure)),
    });
    const harness = render(thread(), fake);

    await waitForReact(() => expect(harness.reportError).toHaveBeenCalledWith("Agents", failure));
  });
});

describe("useAgentThreadSessionLifecycle stopBackgroundTask", () => {
  const exited: AgentTurn = {
    ...running,
    status: { kind: "exited", exitCode: 130 },
    endedAtEpochMs: 2,
  };

  it("asks the exact owner's idle local Claude session to stop one task", async () => {
    const stopAgentBackgroundTask = vi.fn<AgentThreadSessionGateway["stopAgentBackgroundTask"]>(
      async () => ({ kind: "stopping" }),
    );
    const { fake } = gateway({ stopAgentBackgroundTask });
    const harness = render(thread({ turns: [exited] }), fake);

    await act(async () => {
      await expect(harness.hook().stopBackgroundTask(THREAD_ID, "b8kzpiexm")).resolves.toEqual({
        kind: "stopping",
      });
    });

    expect(stopAgentBackgroundTask).toHaveBeenCalledTimes(1);
    expect(stopAgentBackgroundTask).toHaveBeenCalledWith({
      workspaceId: OWNER_ID,
      threadId: THREAD_ID,
      taskId: "b8kzpiexm",
    });
  });

  it("never sends a stop for Codex, remote or unknown threads or without a gateway", async () => {
    const { fake } = gateway();
    const codex = render(thread({ provider: { kind: "codex", sessionId: null } }), fake);
    const remote = render(thread({ threadId: "remote-thread:server-1:runner-1:c" }), fake);
    const unknown = render(undefined, fake);
    const withoutGateway = render(thread(), undefined);

    await act(async () => {
      await expect(codex.hook().stopBackgroundTask(THREAD_ID, "b8kzpiexm")).resolves.toEqual({
        kind: "noSession",
      });
      await expect(
        remote.hook().stopBackgroundTask("remote-thread:server-1:runner-1:c", "b8kzpiexm"),
      ).resolves.toEqual({ kind: "noSession" });
      await expect(unknown.hook().stopBackgroundTask(THREAD_ID, "b8kzpiexm")).resolves.toEqual({
        kind: "noSession",
      });
      await expect(
        withoutGateway.hook().stopBackgroundTask(THREAD_ID, "b8kzpiexm"),
      ).resolves.toEqual({ kind: "noSession" });
    });

    expect(fake.stopAgentBackgroundTask).not.toHaveBeenCalled();
  });

  it("neutralises a late outcome once the thread's owner changed during the stop", async () => {
    const pending = deferred<AgentBackgroundTaskStopOutcome>();
    const stopAgentBackgroundTask = vi.fn<AgentThreadSessionGateway["stopAgentBackgroundTask"]>(
      () => pending.promise,
    );
    const { fake } = gateway({ stopAgentBackgroundTask });
    const harness = render(thread(), fake);

    let stopping!: Promise<unknown>;
    act(() => {
      stopping = harness.hook().stopBackgroundTask(THREAD_ID, "b8kzpiexm");
    });
    harness.scenario.current = thread({ owner: { ...thread().owner, ownerId: "ws-2" } });
    await act(async () => {
      pending.resolve({ kind: "refused", reason: "No task found with ID: b8kzpiexm" });
      await expect(stopping).resolves.toEqual({ kind: "stale" });
    });

    expect(harness.setNotice).not.toHaveBeenCalled();
    expect(harness.reportError).not.toHaveBeenCalled();
  });

  it("reports an undeliverable stop as unavailable while the owner is current", async () => {
    const failure = new Error("ipc");
    const stopAgentBackgroundTask = vi.fn<AgentThreadSessionGateway["stopAgentBackgroundTask"]>(
      async () => Promise.reject(failure),
    );
    const { fake } = gateway({ stopAgentBackgroundTask });
    const harness = render(thread(), fake);

    await act(async () => {
      await expect(harness.hook().stopBackgroundTask(THREAD_ID, "b8kzpiexm")).resolves.toEqual({
        kind: "unavailable",
      });
    });

    expect(harness.reportError).toHaveBeenCalledExactlyOnceWith("Agents", failure);
  });

  it("never reports a failed stop once the thread moved to another owner", async () => {
    const pending = deferred<AgentBackgroundTaskStopOutcome>();
    const stopAgentBackgroundTask = vi.fn<AgentThreadSessionGateway["stopAgentBackgroundTask"]>(
      () => pending.promise,
    );
    const { fake } = gateway({ stopAgentBackgroundTask });
    const harness = render(thread(), fake);

    let stopping!: Promise<unknown>;
    act(() => {
      stopping = harness.hook().stopBackgroundTask(THREAD_ID, "b8kzpiexm");
    });
    harness.scenario.current = thread({ owner: { ...thread().owner, ownerId: "ws-2" } });
    await act(async () => {
      pending.reject(new Error("ipc"));
      await expect(stopping).resolves.toEqual({ kind: "stale" });
    });

    expect(harness.reportError).not.toHaveBeenCalled();
  });
});
