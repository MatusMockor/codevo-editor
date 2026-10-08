// @vitest-environment jsdom
import { act, useMemo, useReducer, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentSessionTaskStopResult,
  AgentTaskChangeSummary,
  AgentThreadsSurface,
  AgentThreadView,
} from "../../application/agentThreadPorts";
import {
  createAgentThreadNotificationCenter,
  type AgentAppFocusPort,
  type AgentSystemAttentionPort,
  type AgentSystemNotification,
} from "../../application/agentThreadNotificationCenter";
import { agentThreadViews } from "../../application/agentThreadViewProjection";
import {
  useAgentEditorBridge,
  type AgentEditorBridgePort,
} from "../../application/useAgentEditorBridge";
import { useAgentSessionBackgrounds } from "../../application/useAgentSessionBackgrounds";
import type { AgentRailWorkingSectionPreferencePort } from "../../application/agentRailWorkingSectionPreferencePort";
import { agentBackgroundTurn, parseAgentBackgroundTurn } from "../../domain/agentBackgroundTurn";
import { AGENT_SESSION_REPLY_EXPECTED_CAP_MS } from "../../domain/agentSessionBackground";
import type { AgentShipState } from "../../domain/agentShip";
import type { AgentThread, AgentTurn } from "../../domain/agentThread";
import type {
  AgentSessionBackgroundTasksEvent,
  AgentSessionEndedEvent,
  AgentThreadSessionGateway,
} from "../../domain/agentThreadSession";
import {
  agentWorkbenchLayoutReducer,
  initialAgentWorkbenchLayout,
} from "../../domain/agentWorkbenchLayout";
import {
  AGENT_RAIL_WORKING_SECTION_STORAGE_KEY,
  BrowserAgentRailWorkingSectionPreference,
} from "../../infrastructure/browserAgentRailWorkingSectionPreference";
import type { KeyValueStorage } from "../../infrastructure/browserSettingsGateway";
import { unconfiguredAgentProviderManagement } from "../../test/agentProviderManagementFixture";
import { waitForReact } from "../../test/reactTestLifecycle";
import { AgentModeView } from "./AgentModeView";
import { surfaceThreadView, SURFACE_FIXTURE_ROOT } from "./agentSurfaceTestFixtures";
import { projectFixture, threadsSurfaceFixture } from "./agentThreadsSurfaceTestFixtures";
import { chromeFixture } from "./agentWorkbenchChromeTestFixtures";
import { NO_SCOPE_STATE, type AgentNavigationSession } from "./useAgentThreadNavigation";

const THREAD_ID = "agt-1";
const OTHER_THREAD_ID = "agt-2";
const OWNER_ID = "agent-root:app";
const OTHER_OWNER_ID = "agent-root:other";
const SESSION_ID = "eb42be9c-63b5-43f8-8506-d20779e32f3d";
const GATES_TASK_ID = "b7sh0uutx";
const GATES_DESCRIPTION = "Run the complete editor gate suite";
const STARTED_AT = 1_700_000_000_000;
const MINUTE = 60_000;

const askedTurn: AgentTurn = {
  turnId: "turn-asked",
  prompt: "Commit and push once the gates pass",
  status: { kind: "exited", exitCode: 0 },
  startedAtEpochMs: STARTED_AT,
  endedAtEpochMs: STARTED_AT + 1_000,
  events: [
    { kind: "assistantText", text: "I will run the gates first." },
    { kind: "result", text: "I will run the gates first.", isError: false, usage: null },
  ],
  eventsTruncated: false,
  lastStatusSequence: 1,
  lastOutputSequence: 2,
  streamMetrics: null,
  launch: null,
  cliVersion: null,
};

function frames(lines: ReadonlyArray<Record<string, unknown>>): string {
  return lines.map((line) => `${JSON.stringify(line)}\n`).join("");
}

const REPLY_STARTING_THE_GATES = frames([
  { type: "system", subtype: "init", session_id: SESSION_ID },
  {
    type: "assistant",
    parent_tool_use_id: null,
    session_id: SESSION_ID,
    message: {
      content: [
        {
          type: "tool_use",
          id: "toolu_gates",
          name: "Bash",
          input: {
            command: "npm run gates",
            run_in_background: true,
            description: GATES_DESCRIPTION,
          },
        },
      ],
    },
  },
  {
    type: "system",
    subtype: "task_started",
    task_id: GATES_TASK_ID,
    tool_use_id: "toolu_gates",
    description: GATES_DESCRIPTION,
    is_backgrounded: true,
    task_type: "local_bash",
    session_id: SESSION_ID,
  },
  {
    type: "user",
    parent_tool_use_id: null,
    session_id: SESSION_ID,
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_gates",
          content: `Command running in background with ID: ${GATES_TASK_ID}.`,
        },
      ],
    },
  },
  {
    type: "assistant",
    parent_tool_use_id: null,
    session_id: SESSION_ID,
    message: { content: [{ type: "text", text: "The gates run in the background." }] },
  },
  {
    type: "result",
    subtype: "success",
    is_error: false,
    result: "The gates run in the background.",
    num_turns: 1,
    session_id: SESSION_ID,
    origin: { kind: "task-notification" },
  },
]);

const REPLY_AFTER_THE_GATES = frames([
  { type: "system", subtype: "init", session_id: SESSION_ID },
  {
    type: "assistant",
    parent_tool_use_id: null,
    session_id: SESSION_ID,
    message: { content: [{ type: "text", text: "The gates passed, committed and pushed." }] },
  },
  {
    type: "result",
    subtype: "success",
    is_error: false,
    result: "The gates passed, committed and pushed.",
    num_turns: 1,
    session_id: SESSION_ID,
    origin: { kind: "task-notification" },
  },
]);

function threadFixture(threadId: string, title: string): AgentThread {
  return {
    ...surfaceThreadView().thread,
    threadId,
    title,
    turns: [askedTurn],
    viewedAtEpochMs: STARTED_AT + 2_000,
  };
}

function withRecordedReply(thread: AgentThread, turnId: string, output: string): AgentThread {
  const content = parseAgentBackgroundTurn({ output, truncated: false, complete: true });
  const turn = agentBackgroundTurn(turnId, content, Date.now());
  return { ...thread, turns: [...thread.turns, turn], updatedAtEpochMs: Date.now() };
}

function gatesStatuses(thread: AgentThread | undefined): ReadonlyArray<string> {
  return (thread?.turns ?? []).flatMap((turn) =>
    turn.events.flatMap((event) =>
      event.kind === "backgroundTask" && event.taskId === GATES_TASK_ID ? [event.status] : [],
    ),
  );
}

const GATES: AgentSessionBackgroundTasksEvent = {
  workspaceId: OWNER_ID,
  threadId: THREAD_ID,
  total: 1,
  agents: 0,
  tasks: [{ taskId: GATES_TASK_ID, taskType: "shell", description: GATES_DESCRIPTION }],
  reply: "none",
};
const REVIEW = {
  taskId: "btuh01leq",
  taskType: "shell",
  description: "Run a short review",
} as const;
const GATES_AND_REVIEW: AgentSessionBackgroundTasksEvent = {
  ...GATES,
  total: 2,
  tasks: [...GATES.tasks, REVIEW],
};
const REVIEW_ONLY: AgentSessionBackgroundTasksEvent = { ...GATES, tasks: [REVIEW] };
const DRAINED: AgentSessionBackgroundTasksEvent = { ...GATES, total: 0, tasks: [] };
const REPLYING: AgentSessionBackgroundTasksEvent = { ...DRAINED, reply: "inProgress" };
const FINISHED: AgentSessionBackgroundTasksEvent = { ...DRAINED, reply: "expected" };
const GATES_WHILE_REPLYING: AgentSessionBackgroundTasksEvent = { ...GATES, reply: "inProgress" };

function sessionGateway() {
  let levels: ((event: AgentSessionBackgroundTasksEvent) => void) | null = null;
  let ended: ((event: AgentSessionEndedEvent) => void) | null = null;
  const fake = {
    listAgentSessionBackgrounds: vi.fn<AgentThreadSessionGateway["listAgentSessionBackgrounds"]>(
      async () => [],
    ),
    interruptAgentTask: vi.fn(async () => ({ kind: "unsupported" }) as const),
    inspectAgentThreadSession: vi.fn(async () => ({ kind: "none" }) as const),
    endAgentThreadSession: vi.fn(async () => false),
    stopAgentBackgroundTask: vi.fn(async () => ({ kind: "noSession" }) as const),
    subscribeAgentSessionEnded: vi.fn(async (handler: (event: AgentSessionEndedEvent) => void) => {
      ended = handler;
      return () => undefined;
    }),
    subscribeAgentSessionBackgroundTurn: vi.fn(async () => () => undefined),
    subscribeAgentSessionBackgroundTasks: vi.fn(
      async (handler: (event: AgentSessionBackgroundTasksEvent) => void) => {
        levels = handler;
        return () => undefined;
      },
    ),
  } satisfies AgentThreadSessionGateway;
  return {
    fake,
    subscribed: () => levels !== null && ended !== null,
    level(event: AgentSessionBackgroundTasksEvent) {
      expect(levels).not.toBeNull();
      act(() => levels?.(event));
    },
    end(event: AgentSessionEndedEvent) {
      expect(ended).not.toBeNull();
      act(() => ended?.(event));
    },
  };
}

const EDITOR_PORT: AgentEditorBridgePort = {
  openFile: async () => true,
  openGitChange: async () => undefined,
  openSurface: () => undefined,
};
const PROJECTS = [projectFixture()];
const NO_SUMMARIES: ReadonlyMap<string, AgentTaskChangeSummary> = new Map();
const NO_THREAD_IDS: ReadonlySet<string> = new Set();
const NO_SHIP_STATES: ReadonlyMap<string, AgentShipState> = new Map();
const reportError = (): void => undefined;
const WINDOW_IN_BACKGROUND: AgentAppFocusPort = {
  isFocused: () => false,
  subscribe: () => () => undefined,
};

function recordingSystem() {
  const notifications: AgentSystemNotification[] = [];
  const port: AgentSystemAttentionPort = {
    notify: async (notification) => {
      notifications.push(notification);
      return "delivered";
    },
    setBadgeCount: async () => undefined,
    recheckPermission: () => undefined,
  };
  return { port, notifications };
}

function workingSectionOn(): AgentRailWorkingSectionPreferencePort {
  const values = new Map([[AGENT_RAIL_WORKING_SECTION_STORAGE_KEY, "on"]]);
  const storage: KeyValueStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
  return new BrowserAgentRailWorkingSectionPreference(storage);
}

describe("sidebar row status of a thread whose background work is tracked by its Claude session", () => {
  let host: HTMLDivElement;
  let root: Root;
  const originalScrollIntoView = Element.prototype.scrollIntoView;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(STARTED_AT + 2_000);
    Element.prototype.scrollIntoView = () => undefined;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    Element.prototype.scrollIntoView = originalScrollIntoView;
    vi.useRealTimers();
  });

  function later(elapsedMs: number): void {
    vi.setSystemTime(Date.now() + elapsedMs);
  }

  async function lapseFollowUpGrace(): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENT_SESSION_REPLY_EXPECTED_CAP_MS);
    });
  }

  async function mount(
    options: {
      open?: boolean;
      workingSection?: boolean;
      recovery?: Promise<ReadonlyArray<AgentSessionBackgroundTasksEvent>>;
    } = {},
  ) {
    const preference = options.workingSection === true ? workingSectionOn() : null;
    const system = recordingSystem();
    const center = createAgentThreadNotificationCenter({
      focus: WINDOW_IN_BACKGROUND,
      system: system.port,
      now: Date.now,
    });
    const gateway = sessionGateway();
    if (options.recovery !== undefined) {
      gateway.fake.listAgentSessionBackgrounds.mockReturnValueOnce(options.recovery);
    }
    const reportFailure = vi.fn();
    const stopSessionBackgroundTask = vi.fn(async (): Promise<AgentSessionTaskStopResult> => ({
      kind: "stopping",
    }));
    const initial: ReadonlyMap<string, AgentThread> = new Map([
      [THREAD_ID, threadFixture(THREAD_ID, "Run the gates")],
      [OTHER_THREAD_ID, threadFixture(OTHER_THREAD_ID, "Write the changelog")],
    ]);
    const session: AgentNavigationSession = {
      current: {
        selectedThreadId: OTHER_THREAD_ID,
        selectedThreadOwnerKey: OWNER_ID,
        scopeState: NO_SCOPE_STATE,
      },
    };
    const rendered = {
      threads: initial,
      update: null as
        | ((
            next: (current: ReadonlyMap<string, AgentThread>) => ReadonlyMap<string, AgentThread>,
          ) => void)
        | null,
    };

    function Harness() {
      const [threads, setThreads] = useState(initial);
      rendered.threads = threads;
      rendered.update = setThreads;
      const { backgrounds, recovered } = useAgentSessionBackgrounds(
        gateway.fake,
        Date.now,
        reportFailure,
      );
      const editor = useAgentEditorBridge({
        projects: PROJECTS,
        threads,
        editor: EDITOR_PORT,
        reportError,
      });
      const cache = useRef<ReadonlyMap<string, AgentThreadView>>(new Map());
      const views = useMemo(() => {
        const next = agentThreadViews(
          cache.current,
          threads,
          NO_SUMMARIES,
          NO_THREAD_IDS,
          NO_THREAD_IDS,
          NO_SHIP_STATES,
          editor,
          PROJECTS,
          backgrounds,
        );
        cache.current = new Map(next.map((view) => [view.thread.threadId, view]));
        return next;
      }, [backgrounds, editor, threads]);
      const [layout, dispatch] = useReducer(
        agentWorkbenchLayoutReducer,
        initialAgentWorkbenchLayout,
      );
      const agents: AgentThreadsSurface = threadsSurfaceFixture({
        threads: views,
        stopSessionBackgroundTask,
        sessionBackgroundsRecovered: recovered,
      });
      return (
        <AgentModeView
          agents={{ ...agents, providerManagement: unconfiguredAgentProviderManagement() }}
          chrome={chromeFixture({
            layout: {
              layout,
              effectiveLayout: "agent",
              persistedBottomPanel: false,
              dispatch,
            },
          })}
          navigationSession={session}
          onOpenEnvironmentSettings={() => undefined}
          onReleaseProject={() => undefined}
          onTrustProject={() => undefined}
          overflowRootPaths={[]}
          projects={PROJECTS}
          providerEnabled={{ claudeCode: true, codex: true }}
          threadNotifications={center}
          workingSectionPreference={preference}
          workspaceRoot={SURFACE_FIXTURE_ROOT}
        />
      );
    }

    await act(async () => root.render(<Harness />));
    await waitForReact(() => expect(gateway.subscribed()).toBe(true));
    await waitForReact(() => expect(rows(THREAD_ID).length).toBeGreaterThan(0));
    if (options.open === true) {
      await act(async () => rows(THREAD_ID)[0]?.click());
      await waitForReact(() => expect(transcript()).not.toBeNull());
    }
    return {
      gateway,
      reportFailure,
      systemNotifications: (): ReadonlyArray<AgentSystemNotification> => system.notifications,
      recordedGatesStatuses: () => gatesStatuses(rendered.threads.get(THREAD_ID)),
      viewThread() {
        expect(rendered.update).not.toBeNull();
        act(() =>
          rendered.update?.((current) => {
            const thread = current.get(THREAD_ID);
            if (thread === undefined) return current;
            return new Map(current).set(THREAD_ID, { ...thread, viewedAtEpochMs: Date.now() });
          }),
        );
      },
      recordReply(turnId: string, output: string) {
        expect(rendered.update).not.toBeNull();
        act(() =>
          rendered.update?.((current) => {
            const thread = current.get(THREAD_ID);
            if (thread === undefined) return current;
            return new Map(current).set(THREAD_ID, withRecordedReply(thread, turnId, output));
          }),
        );
      },
    };
  }

  function rows(threadId: string): ReadonlyArray<HTMLElement> {
    return [...host.querySelectorAll<HTMLElement>(`[data-thread-id="${threadId}"]`)];
  }

  function rowStatuses(threadId: string): ReadonlyArray<string | null> {
    return rows(threadId).map(
      (row) => row.querySelector(".cv-card-row__status-label")?.textContent ?? null,
    );
  }

  function transcript(): HTMLElement | null {
    return host.querySelector<HTMLElement>(".agent-session__scroll");
  }

  function pressEscapeInTranscript(): void {
    const target = transcript();
    expect(target).not.toBeNull();
    act(() => {
      target?.focus();
      target?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
  }

  function stopTasksButtons(): ReadonlyArray<HTMLButtonElement> {
    return [...host.querySelectorAll<HTMLButtonElement>("button")].filter(
      (button) => button.textContent === "Stop tasks",
    );
  }

  function workingShelf(): HTMLElement | null {
    return host.querySelector<HTMLElement>('.cv-sb-shelf[data-shelf="working"]');
  }

  function rowElapsed(threadId: string): ReadonlyArray<string | null> {
    return rows(threadId).map(
      (row) => row.querySelector(".cv-card-row__tick")?.textContent ?? null,
    );
  }

  it("stops showing Working in background once the task its unprompted reply started finishes between turns", async () => {
    const { gateway, recordReply, recordedGatesStatuses, reportFailure, viewThread } =
      await mount();
    expect(rowStatuses(THREAD_ID)).toEqual([null]);

    gateway.level(REPLYING);
    gateway.level(GATES_WHILE_REPLYING);
    recordReply("turn-reply-gates", REPLY_STARTING_THE_GATES);
    gateway.level(GATES);
    later(MINUTE);
    viewThread();
    expect(recordedGatesStatuses()).toEqual(["starting"]);
    expect(rowStatuses(THREAD_ID)).toEqual(["Working in background"]);

    later(4 * MINUTE);
    gateway.level(FINISHED);
    expect(rowStatuses(THREAD_ID)).toEqual(["Replying"]);
    expect(host.textContent).not.toContain("Working in background");

    gateway.level(REPLYING);
    expect(rowStatuses(THREAD_ID)).toEqual(["Replying"]);

    later(3 * MINUTE);
    recordReply("turn-reply-pushed", REPLY_AFTER_THE_GATES);
    gateway.level(DRAINED);

    expect(recordedGatesStatuses()).toEqual(["starting"]);
    expect(rowStatuses(THREAD_ID)).toEqual(["Done"]);
    expect(rowStatuses(OTHER_THREAD_ID)).toEqual([null]);
    expect(host.textContent).not.toContain("Working in background");
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("shows and clears the level when nothing else about the thread changes", async () => {
    const { gateway } = await mount();

    gateway.level(GATES);
    expect(rowStatuses(THREAD_ID)).toEqual(["Working in background"]);
    expect(rowElapsed(THREAD_ID)).toEqual(["0s"]);

    later(9 * MINUTE);
    gateway.level(DRAINED);

    expect(rowStatuses(THREAD_ID)).toEqual([null]);
    expect(rowStatuses(OTHER_THREAD_ID)).toEqual([null]);
  });

  it("shows Replying while a finished task's reply is expected and clears when the reply never comes", async () => {
    const { gateway } = await mount();
    gateway.level(GATES);
    later(9 * MINUTE);

    gateway.level(FINISHED);
    expect(rowStatuses(THREAD_ID)).toEqual(["Replying"]);

    await lapseFollowUpGrace();
    expect(rowStatuses(THREAD_ID)).toEqual([null]);
    expect(rowStatuses(OTHER_THREAD_ID)).toEqual([null]);
  });

  it("keeps showing a task that is still running after another one finished", async () => {
    const { gateway } = await mount();
    gateway.level(GATES_AND_REVIEW);
    expect(rowStatuses(THREAD_ID)).toEqual(["Working in background"]);

    later(5 * MINUTE);
    gateway.level(REVIEW_ONLY);

    expect(rowStatuses(THREAD_ID)).toEqual(["Working in background"]);
    expect(rowStatuses(OTHER_THREAD_ID)).toEqual([null]);
  });

  it("ignores a repeated drained level and restarts the clock for later work", async () => {
    const { gateway } = await mount();
    gateway.level(GATES);
    gateway.level(DRAINED);
    gateway.level(DRAINED);
    expect(rowStatuses(THREAD_ID)).toEqual([null]);

    later(30 * MINUTE);
    gateway.level(GATES);
    expect(rowStatuses(THREAD_ID)).toEqual(["Working in background"]);
    expect(rowElapsed(THREAD_ID)).toEqual(["0s"]);

    gateway.level(DRAINED);
    expect(rowStatuses(THREAD_ID)).toEqual([null]);
  });

  it("keeps this owner's level when another owner reports, drains and ends work for the same thread", async () => {
    const { gateway } = await mount();
    gateway.level(GATES);
    expect(rowStatuses(THREAD_ID)).toEqual(["Working in background"]);

    later(2 * MINUTE);
    gateway.level({ ...GATES, workspaceId: OTHER_OWNER_ID });
    expect(rowStatuses(THREAD_ID)).toEqual(["Working in background"]);

    gateway.level({ ...DRAINED, workspaceId: OTHER_OWNER_ID });
    gateway.end({
      workspaceId: OTHER_OWNER_ID,
      threadId: THREAD_ID,
      reason: "stopped",
      backgroundTasksLive: false,
    });
    expect(rowStatuses(THREAD_ID)).toEqual(["Working in background"]);

    later(2 * MINUTE);
    gateway.level(GATES);
    expect(rowStatuses(THREAD_ID)).toEqual(["Working in background"]);
    expect(rowStatuses(OTHER_THREAD_ID)).toEqual([null]);
  });

  it("clears the row when the session ends with the task still live", async () => {
    const { gateway } = await mount();
    gateway.level(GATES);
    expect(rowStatuses(THREAD_ID)).toEqual(["Working in background"]);

    gateway.end({
      workspaceId: OWNER_ID,
      threadId: THREAD_ID,
      reason: "idleTimeout",
      backgroundTasksLive: true,
    });

    expect(rowStatuses(THREAD_ID)).toEqual([null]);
  });

  it("moves the thread into the Working shelf only while the session lists live work", async () => {
    const { gateway } = await mount({ workingSection: true });
    expect(workingShelf()).toBeNull();

    gateway.level(GATES);
    expect(workingShelf()?.textContent).toContain("Working (1)");

    later(4 * MINUTE);
    gateway.level(DRAINED);
    expect(workingShelf()).toBeNull();
  });

  it("offers to stop the idle session's task on Esc while the session lists it", async () => {
    const { gateway } = await mount({ open: true });
    gateway.level(GATES);

    pressEscapeInTranscript();

    expect(host.textContent).toContain(
      "1 background task is still running in Claude's session. Press Stop tasks or Esc again to stop it.",
    );
    expect(stopTasksButtons()).toHaveLength(1);
  });

  it("offers nothing to stop on Esc after the session reported the task finished", async () => {
    const { gateway, viewThread } = await mount({ open: true });
    gateway.level(GATES);
    viewThread();
    later(4 * MINUTE);
    gateway.level(DRAINED);

    pressEscapeInTranscript();

    expect(host.textContent).not.toContain("still running in Claude's session");
    expect(stopTasksButtons()).toHaveLength(0);
  });

  it("sends no finished notification while the task an unprompted reply started still runs, and one when the last reply lands", async () => {
    const { gateway, recordReply, systemNotifications } = await mount();
    gateway.level(REPLYING);
    gateway.level(GATES_WHILE_REPLYING);
    recordReply("turn-reply-gates", REPLY_STARTING_THE_GATES);
    gateway.level(GATES);
    later(4 * MINUTE);

    expect(rowStatuses(THREAD_ID)).toEqual(["Working in background"]);
    expect(systemNotifications()).toEqual([]);

    gateway.level(FINISHED);
    expect(rowStatuses(THREAD_ID)).toEqual(["Replying"]);
    expect(systemNotifications()).toEqual([]);
    later(12_000);
    expect(systemNotifications()).toEqual([]);

    gateway.level(REPLYING);
    recordReply("turn-reply-pushed", REPLY_AFTER_THE_GATES);
    expect(systemNotifications()).toEqual([]);

    gateway.level(DRAINED);
    expect(systemNotifications()).toEqual([
      { title: "Thread finished", body: "Run the gates · app" },
    ]);

    await lapseFollowUpGrace();
    expect(rowStatuses(THREAD_ID)).toEqual(["Done"]);
    expect(systemNotifications()).toHaveLength(1);
  });

  it("sends the held finished notification once when the finished task's expected reply never comes", async () => {
    const { gateway, recordReply, systemNotifications } = await mount();
    gateway.level(GATES_WHILE_REPLYING);
    recordReply("turn-reply-gates", REPLY_STARTING_THE_GATES);
    gateway.level(GATES);
    later(4 * MINUTE);
    gateway.level(FINISHED);
    expect(systemNotifications()).toEqual([]);

    await lapseFollowUpGrace();
    expect(rowStatuses(THREAD_ID)).toEqual(["Done"]);
    expect(systemNotifications()).toEqual([
      { title: "Thread finished", body: "Run the gates · app" },
    ]);

    gateway.level(DRAINED);
    await lapseFollowUpGrace();
    expect(systemNotifications()).toHaveLength(1);
  });

  it("sends the held finished notification at once when the user stops the last task", async () => {
    const { gateway, recordReply, systemNotifications } = await mount();
    gateway.level(GATES_WHILE_REPLYING);
    recordReply("turn-reply-gates", REPLY_STARTING_THE_GATES);
    gateway.level(GATES);
    later(4 * MINUTE);
    expect(systemNotifications()).toEqual([]);

    gateway.level(DRAINED);

    expect(rowStatuses(THREAD_ID)).toEqual(["Done"]);
    expect(systemNotifications()).toEqual([
      { title: "Thread finished", body: "Run the gates · app" },
    ]);
  });

  it("sends the held finished notification once when the session ends with the task still live", async () => {
    const { gateway, recordReply, systemNotifications } = await mount();
    gateway.level(GATES_WHILE_REPLYING);
    recordReply("turn-reply-gates", REPLY_STARTING_THE_GATES);
    gateway.level(GATES);
    expect(systemNotifications()).toEqual([]);

    gateway.end({
      workspaceId: OWNER_ID,
      threadId: THREAD_ID,
      reason: "idleTimeout",
      backgroundTasksLive: true,
    });
    expect(systemNotifications()).toEqual([
      { title: "Thread finished", body: "Run the gates · app" },
    ]);
  });

  it("sends nothing for another owner's level and nothing again for a completion already reported", async () => {
    const { gateway, systemNotifications } = await mount();
    gateway.level({ ...GATES, workspaceId: OTHER_OWNER_ID });
    gateway.level(GATES);
    gateway.level(DRAINED);
    await lapseFollowUpGrace();

    expect(rowStatuses(THREAD_ID)).toEqual([null]);
    expect(systemNotifications()).toEqual([]);
  });

  describe("after the frontend reloaded", () => {
    type Levels = ReadonlyArray<AgentSessionBackgroundTasksEvent>;

    function pendingRecovery() {
      let resolve!: (levels: Levels) => void;
      let reject!: (reason: Error) => void;
      const answer = new Promise<Levels>((settle, fail) => {
        resolve = settle;
        reject = fail;
      });
      return { answer, resolve, reject };
    }

    async function answered(work: () => void): Promise<void> {
      await act(async () => {
        work();
        await Promise.resolve();
      });
    }

    it("shows a thread that is still working and notifies once when that work ends", async () => {
      const recovery = pendingRecovery();
      const { gateway, systemNotifications } = await mount({ recovery: recovery.answer });
      expect(rowStatuses(THREAD_ID)).toEqual([null]);
      expect(systemNotifications()).toEqual([]);

      await answered(() => recovery.resolve([GATES]));
      expect(rowStatuses(THREAD_ID)).toEqual(["Working in background"]);
      expect(systemNotifications()).toEqual([]);

      later(4 * MINUTE);
      gateway.level(DRAINED);
      expect(rowStatuses(THREAD_ID)).toEqual([null]);
      expect(systemNotifications()).toEqual([
        { title: "Thread finished", body: "Run the gates · app" },
      ]);

      gateway.level(DRAINED);
      expect(systemNotifications()).toHaveLength(1);
    });

    it("adopts a thread that had simply finished without any notification", async () => {
      const recovery = pendingRecovery();
      const { gateway, systemNotifications } = await mount({ recovery: recovery.answer });

      await answered(() => recovery.resolve([]));
      gateway.level({ ...GATES, threadId: OTHER_THREAD_ID });
      gateway.level({ ...DRAINED, threadId: OTHER_THREAD_ID });

      expect(rowStatuses(THREAD_ID)).toEqual([null]);
      expect(systemNotifications()).toEqual([]);
    });

    it("keeps what a session reported before the recovery answered", async () => {
      const recovery = pendingRecovery();
      const { gateway, systemNotifications } = await mount({ recovery: recovery.answer });
      gateway.level(GATES);
      gateway.level(DRAINED);

      await answered(() => recovery.resolve([GATES]));

      expect(rowStatuses(THREAD_ID)).toEqual([null]);
      expect(systemNotifications()).toEqual([]);
    });

    it("reports a failed recovery and still notifies about later work", async () => {
      const recovery = pendingRecovery();
      const { gateway, recordReply, reportFailure, systemNotifications } = await mount({
        recovery: recovery.answer,
      });
      const failure = new Error("ipc unavailable");

      await answered(() => recovery.reject(failure));
      expect(reportFailure).toHaveBeenCalledExactlyOnceWith(failure);
      expect(systemNotifications()).toEqual([]);

      gateway.level(GATES_WHILE_REPLYING);
      recordReply("turn-reply-gates", REPLY_STARTING_THE_GATES);
      gateway.level(GATES);
      gateway.level(DRAINED);
      expect(systemNotifications()).toEqual([
        { title: "Thread finished", body: "Run the gates · app" },
      ]);
    });
  });

  it("never shows a task as running from a reopened thread whose log lost the terminal status", async () => {
    const { recordReply, recordedGatesStatuses } = await mount();

    recordReply("turn-reply-gates", REPLY_STARTING_THE_GATES);

    expect(recordedGatesStatuses()).toEqual(["starting"]);
    expect(rowStatuses(THREAD_ID)).toEqual(["Done"]);
    expect(host.textContent).not.toContain("Working in background");
    expect(host.textContent).not.toContain("background task running");
  });
});
