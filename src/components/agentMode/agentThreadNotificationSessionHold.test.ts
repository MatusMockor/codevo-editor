import { describe, expect, it } from "vitest";
import type { AgentTaskChangeSummary, AgentThreadView } from "../../application/agentThreadPorts";
import { agentThreadViews } from "../../application/agentThreadViewProjection";
import type { AgentEditorBridgeSurface } from "../../application/useAgentEditorBridge";
import type { AgentBackgroundTask } from "../../domain/agentBackgroundActivity";
import {
  agentThreadNotificationState,
  detectAgentThreadNotifications,
  type AgentThreadNotificationBaseline,
} from "../../domain/agentNotification";
import type { AgentPendingInteractionIdentity } from "../../domain/agentPendingInteraction";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import {
  AGENT_SESSION_REPLY_EXPECTED_CAP_MS,
  NO_AGENT_SESSION_BACKGROUNDS,
  agentSessionBackgroundActivity,
  agentSessionBackgroundIsLive,
  applyAgentSessionBackgroundLevel,
  endAgentSessionBackground,
  expireAgentSessionBackgroundReplies,
  type AgentSessionBackground,
  type AgentSessionBackgrounds,
  type AgentSessionReply,
} from "../../domain/agentSessionBackground";
import type { AgentShipState } from "../../domain/agentShip";
import type { AgentThread, AgentTurn, AgentTurnStatus } from "../../domain/agentThread";
import type { AgentSessionBackgroundTasksEvent } from "../../domain/agentThreadSession";
import { surfaceThreadView } from "./agentSurfaceTestFixtures";
import { agentThreadNotificationSubjects } from "./agentThreadNotificationSubjects";
import { agentRowIsLive, agentRowStatus, agentRowStatusLabel } from "./agentThreadRowStatus";
import { projectFixture } from "./agentThreadsSurfaceTestFixtures";

type Interaction = AgentPendingInteractionIdentity | null;

const BASE = surfaceThreadView().thread;
const THREAD_ID = BASE.threadId;
const OWNER_ID = BASE.owner.ownerId;
const START = 1_700_000_000_000;
const EXITED: AgentTurnStatus = { kind: "exited", exitCode: 0 };
const RUNNING: AgentTurnStatus = { kind: "running" };
const NO_SUMMARIES: ReadonlyMap<string, AgentTaskChangeSummary> = new Map();
const NO_THREAD_IDS: ReadonlySet<string> = new Set();
const NO_SHIP_STATES: ReadonlyMap<string, AgentShipState> = new Map();
const EDITOR: AgentEditorBridgeSurface = {
  canOpenInEditor: () => ({ kind: "available" }),
  openChangedFile: async () => undefined,
  openChangedFileDiff: async () => undefined,
};

const SHELL_TASK: AgentBackgroundTask = { taskId: "b7sh0uutx", taskType: "shell" };
const MONITOR_TASK: AgentBackgroundTask = { taskId: "mon-1", taskType: "monitor" };
const SECOND_MONITOR_TASK: AgentBackgroundTask = { taskId: "mon-2", taskType: "monitor" };
const OTHER_TASK: AgentBackgroundTask = { taskId: "wf-1", taskType: "other" };
const AGENT_TASK: AgentBackgroundTask = { taskId: "a4b355dcf6056a875", taskType: "agent" };

function level(
  tasks: ReadonlyArray<AgentBackgroundTask>,
  reply: AgentSessionBackgroundTasksEvent["reply"] = "none",
): AgentSessionBackgroundTasksEvent {
  return {
    workspaceId: OWNER_ID,
    threadId: THREAD_ID,
    total: tasks.length,
    agents: tasks.filter((task) => task.taskType === "agent").length,
    tasks,
    reply,
  };
}

const SHELL = level([SHELL_TASK]);
const MONITOR = level([MONITOR_TASK]);
const DRAINED = level([]);
const REPLYING = level([], "inProgress");
const EXPECTING = level([], "expected");

function turn(turnId: string, status: AgentTurnStatus, origin?: "background"): AgentTurn {
  const live = status.kind === "running" || status.kind === "pending";
  return {
    ...(origin === undefined ? {} : { origin }),
    turnId,
    prompt: "Run the gates",
    status,
    startedAtEpochMs: START,
    endedAtEpochMs: live ? null : START + 1_000,
    events: [],
    eventsTruncated: false,
    lastStatusSequence: 1,
    lastOutputSequence: 0,
    launch: null,
    cliVersion: null,
  };
}

function scenario(
  initial: AgentThread = { ...BASE, turns: [turn("u1", RUNNING)], viewedAtEpochMs: START + 5_000 },
) {
  const cache: Parameters<typeof agentThreadNotificationSubjects>[3] = new WeakMap();
  const fired: string[] = [];
  let thread = initial;
  let levels: AgentSessionBackgrounds = NO_AGENT_SESSION_BACKGROUNDS;
  let projects: ReadonlyArray<AgentProjectDescriptor> = [projectFixture({ generation: 1 })];
  let interactions: ReadonlyMap<string, Interaction> = new Map();
  let views: ReadonlyMap<string, AgentThreadView> = new Map();
  let baseline: AgentThreadNotificationBaseline = new Map();
  let now = START;

  function observe(): void {
    const projected = agentThreadViews(
      views,
      new Map([[thread.threadId, thread]]),
      NO_SUMMARIES,
      NO_THREAD_IDS,
      NO_THREAD_IDS,
      NO_SHIP_STATES,
      EDITOR,
      projects,
      levels,
    );
    views = new Map(projected.map((view) => [view.thread.threadId, view]));
    const subjects = agentThreadNotificationSubjects(projected, interactions, projects, cache);
    const detection = detectAgentThreadNotifications(baseline, subjects);
    baseline = detection.baseline;
    fired.push(...detection.events.map((event) => event.signalKey));
  }

  observe();
  return {
    fired: (): ReadonlyArray<string> => fired,
    view: (): AgentThreadView | undefined => views.get(thread.threadId),
    row(): string | null {
      const view = views.get(thread.threadId);
      return view === undefined ? null : agentRowStatusLabel(agentRowStatus(view));
    },
    later(elapsedMs: number): void {
      now += elapsedMs;
    },
    turns(...next: ReadonlyArray<AgentTurn>): void {
      thread = { ...thread, turns: next };
      observe();
    },
    owner(ownerId: string): void {
      thread = { ...thread, owner: { ...thread.owner, ownerId } };
      observe();
    },
    reload(generation: number, ownerId: string = OWNER_ID): void {
      projects = [projectFixture({ generation, ownerId })];
      observe();
    },
    asks(interaction: Interaction): void {
      interactions = new Map([[thread.threadId, interaction]]);
      observe();
    },
    level(event: AgentSessionBackgroundTasksEvent): void {
      levels = applyAgentSessionBackgroundLevel(levels, event, now);
      observe();
    },
    lapse(): void {
      now += AGENT_SESSION_REPLY_EXPECTED_CAP_MS;
      levels = expireAgentSessionBackgroundReplies(levels, now);
      observe();
    },
    sessionEnds(workspaceId: string = thread.owner.ownerId): void {
      levels = endAgentSessionBackground(levels, {
        workspaceId,
        threadId: thread.threadId,
        reason: "idleTimeout",
        backgroundTasksLive: true,
      });
      observe();
    },
    observe,
  };
}

describe("completion notification while the thread's session still works in the background", () => {
  it("holds a finished turn back while a background shell runs and reports it once when the expected reply never comes", () => {
    const thread = scenario();
    thread.level(SHELL);
    thread.turns(turn("u1", EXITED));

    expect(thread.row()).toBe("Working in background");
    expect(thread.fired()).toEqual([]);

    thread.later(4 * 60_000);
    thread.observe();
    expect(thread.fired()).toEqual([]);

    thread.level(EXPECTING);
    expect(thread.row()).toBe("Replying");
    expect(thread.fired()).toEqual([]);

    thread.later(AGENT_SESSION_REPLY_EXPECTED_CAP_MS - 1);
    thread.level(EXPECTING);
    expect(thread.fired()).toEqual([]);

    thread.lapse();
    expect(thread.row()).toBeNull();
    expect(thread.fired()).toEqual(["u1:completed"]);

    thread.observe();
    thread.level(DRAINED);
    expect(thread.fired()).toEqual(["u1:completed"]);
  });

  it.each([
    ["shell", SHELL],
    ["agent", level([AGENT_TASK])],
  ] as const)(
    "releases the finished turn at once when the user stops its last %s and no reply is expected",
    (_work, live) => {
      const thread = scenario();
      thread.level(live);
      thread.turns(turn("u1", EXITED));
      expect(thread.fired()).toEqual([]);

      thread.level(DRAINED);

      expect(thread.row()).toBeNull();
      expect(thread.fired()).toEqual(["u1:completed"]);
      thread.lapse();
      expect(thread.fired()).toEqual(["u1:completed"]);
    },
  );

  it.each([1_200, 12_000, AGENT_SESSION_REPLY_EXPECTED_CAP_MS - 1])(
    "reports once, for the follow-up reply, when the reply starts %i ms after the shell finished",
    (wait) => {
      const thread = scenario();
      thread.level(SHELL);
      thread.turns(turn("u1", EXITED));
      thread.level(EXPECTING);
      thread.later(wait);
      thread.observe();
      expect(thread.fired()).toEqual([]);
      thread.level(REPLYING);
      expect(thread.row()).toBe("Replying");

      thread.later(30_000);
      thread.turns(turn("u1", EXITED), turn("u2", EXITED, "background"));
      expect(thread.fired()).toEqual([]);

      thread.level(DRAINED);
      expect(thread.row()).toBeNull();
      expect(thread.fired()).toEqual(["u2:completed"]);

      thread.lapse();
      thread.observe();
      expect(thread.fired()).toEqual(["u2:completed"]);
    },
  );

  it.each(["status", "level"] as const)(
    "reports once when a turn that waited for its own shell settles with the %s arriving first",
    (first) => {
      const thread = scenario();
      thread.level(SHELL);
      expect(thread.fired()).toEqual([]);

      const arrivals = {
        status: () => thread.turns(turn("u1", EXITED)),
        level: () => thread.level(EXPECTING),
      };
      arrivals[first]();
      arrivals[first === "status" ? "level" : "status"]();
      expect(thread.row()).toBe("Replying");
      expect(thread.fired()).toEqual([]);

      thread.level(REPLYING);
      thread.turns(turn("u1", EXITED), turn("u2", EXITED, "background"));
      thread.level(DRAINED);
      expect(thread.fired()).toEqual(["u2:completed"]);
    },
  );

  it("stays silent while unprompted replies keep starting background work and reports the last reply once", () => {
    const next = { ...SHELL_TASK, taskId: "bnext0001" };
    const thread = scenario();
    thread.level(SHELL);
    thread.turns(turn("u1", EXITED));
    thread.level(EXPECTING);
    thread.level(REPLYING);
    thread.level(level([next], "inProgress"));
    thread.turns(turn("u1", EXITED), turn("u2", EXITED, "background"));
    thread.level(level([next]));

    expect(thread.row()).toBe("Working in background");
    expect(thread.fired()).toEqual([]);

    thread.later(4 * 60_000);
    thread.observe();
    expect(thread.row()).toBe("Working in background");
    expect(thread.fired()).toEqual([]);

    thread.level(EXPECTING);
    thread.level(REPLYING);
    thread.turns(
      turn("u1", EXITED),
      turn("u2", EXITED, "background"),
      turn("u3", EXITED, "background"),
    );
    thread.level(DRAINED);
    expect(thread.row()).toBeNull();
    expect(thread.fired()).toEqual(["u3:completed"]);
  });

  it("notifies at once, and once, when a turn ends after its background task already finished inside it", () => {
    const thread = scenario();
    thread.level(SHELL);
    thread.later(4_000);
    thread.level(DRAINED);
    expect(thread.fired()).toEqual([]);

    thread.later(12_000);
    thread.turns(turn("u1", EXITED));
    expect(thread.row()).toBeNull();
    expect(thread.fired()).toEqual(["u1:completed"]);

    thread.lapse();
    thread.observe();
    expect(thread.fired()).toEqual(["u1:completed"]);
  });

  it("reports once, for the late reply, when the task finished during the turn's final answer", () => {
    const thread = scenario();
    thread.level(SHELL);
    thread.later(9_000);
    thread.level(DRAINED);
    expect(thread.fired()).toEqual([]);

    thread.later(10_000);
    thread.level(EXPECTING);
    thread.turns(turn("u1", EXITED));
    expect(thread.row()).toBe("Replying");
    expect(thread.fired()).toEqual([]);

    thread.level(REPLYING);
    thread.turns(turn("u1", EXITED), turn("u2", EXITED, "background"));
    expect(thread.fired()).toEqual([]);
    thread.level(DRAINED);
    expect(thread.row()).toBeNull();
    expect(thread.fired()).toEqual(["u2:completed"]);
  });

  it("delivers the held completion once when the session dies while the follow-up reply is written", () => {
    const thread = scenario();
    thread.level(SHELL);
    thread.turns(turn("u1", EXITED));
    thread.level(EXPECTING);
    thread.level(REPLYING);
    thread.turns(turn("u1", EXITED), turn("u2", { kind: "interrupted" }, "background"));
    expect(thread.row()).toBe("Replying");
    expect(thread.fired()).toEqual([]);

    thread.sessionEnds();
    expect(thread.fired()).toEqual(["u1:completed"]);

    thread.observe();
    thread.lapse();
    expect(thread.fired()).toEqual(["u1:completed"]);
  });

  it("stays quiet when the user ended the session while the follow-up reply was written", () => {
    const thread = scenario();
    thread.level(SHELL);
    thread.turns(turn("u1", EXITED));
    thread.level(EXPECTING);
    thread.level(REPLYING);
    thread.turns(turn("u1", EXITED), turn("u2", { kind: "stopped" }, "background"));
    thread.sessionEnds();

    expect(thread.row()).toBe("Stopped");
    expect(thread.fired()).toEqual([]);
  });

  it("reports a failed follow-up reply as failed and never the completion it replaced", () => {
    const thread = scenario();
    thread.level(SHELL);
    thread.turns(turn("u1", EXITED));
    thread.level(EXPECTING);
    thread.level(REPLYING);
    thread.turns(turn("u1", EXITED), turn("u2", { kind: "exited", exitCode: 1 }, "background"));
    thread.level(DRAINED);
    thread.turns(
      turn("u1", EXITED),
      turn("u2", { kind: "exited", exitCode: 1 }, "background"),
      turn("u3", { kind: "interrupted" }, "background"),
    );

    expect(thread.fired()).toEqual(["u2:failed"]);
  });

  it("stays silent for a reply read in one chunk whose live level is published before its turn lands", () => {
    const thread = scenario();
    thread.turns(turn("u1", EXITED));
    expect(thread.fired()).toEqual(["u1:completed"]);

    thread.level(SHELL);
    thread.turns(turn("u1", EXITED), turn("u2", EXITED, "background"));
    expect(thread.row()).toBe("Working in background");
    expect(thread.fired()).toEqual(["u1:completed"]);

    thread.level(DRAINED);
    thread.lapse();
    expect(thread.fired()).toEqual(["u1:completed", "u2:completed"]);
  });

  it("holds a settling turn whose live level is published before its exit status", () => {
    const thread = scenario();
    thread.level(level([SHELL_TASK], "inProgress"));
    thread.turns(turn("u1", EXITED));
    expect(thread.row()).toBe("Replying");
    expect(thread.fired()).toEqual([]);

    thread.turns(turn("u1", EXITED), turn("u2", EXITED, "background"));
    thread.level(SHELL);
    expect(thread.row()).toBe("Working in background");
    expect(thread.fired()).toEqual([]);
  });

  it("holds a turn the user sent while an earlier shell still runs", () => {
    const thread = scenario({ ...BASE, turns: [turn("u1", EXITED)], viewedAtEpochMs: START });
    thread.level(SHELL);
    thread.turns(turn("u1", EXITED), turn("u2", RUNNING));
    thread.turns(turn("u1", EXITED), turn("u2", EXITED));

    expect(thread.row()).toBe("Working in background");
    expect(thread.fired()).toEqual([]);
  });

  it("notifies when the turn that started a watch loop ends, although the row stays Monitoring", () => {
    const thread = scenario();
    thread.level(MONITOR);
    expect(thread.fired()).toEqual([]);

    thread.turns(turn("u1", EXITED));

    expect(thread.row()).toBe("Monitoring");
    expect(thread.fired()).toEqual(["u1:completed"]);
    thread.later(3 * 60 * 60_000);
    thread.observe();
    expect(thread.fired()).toEqual(["u1:completed"]);
  });

  it("notifies once for every reply a watch loop event produces and holds only while that reply is written", () => {
    const thread = scenario();
    thread.level(MONITOR);
    thread.turns(turn("u1", EXITED));
    expect(thread.fired()).toEqual(["u1:completed"]);

    thread.level(level([MONITOR_TASK], "inProgress"));
    expect(thread.row()).toBe("Replying");
    thread.turns(turn("u1", EXITED), turn("u2", EXITED, "background"));
    expect(thread.fired()).toEqual(["u1:completed"]);
    thread.level(MONITOR);
    expect(thread.row()).toBe("Monitoring");
    expect(thread.fired()).toEqual(["u1:completed", "u2:completed"]);

    thread.level(level([MONITOR_TASK], "inProgress"));
    thread.turns(
      turn("u1", EXITED),
      turn("u2", EXITED, "background"),
      turn("u3", EXITED, "background"),
    );
    thread.level(MONITOR);
    expect(thread.fired()).toEqual(["u1:completed", "u2:completed", "u3:completed"]);

    thread.sessionEnds();
    thread.observe();
    expect(thread.row()).toBeNull();
    expect(thread.fired()).toEqual(["u1:completed", "u2:completed", "u3:completed"]);
  });

  it("follows the captured Monitor: its turn, each event reply and the reply after its end notify once each", () => {
    const thread = scenario();
    thread.level(MONITOR);
    thread.turns(turn("u1", EXITED));
    expect(thread.row()).toBe("Monitoring");
    expect(thread.fired()).toEqual(["u1:completed"]);

    thread.level(level([MONITOR_TASK], "inProgress"));
    expect(thread.row()).toBe("Replying");
    thread.turns(turn("u1", EXITED), turn("u2", EXITED, "background"));
    expect(thread.fired()).toEqual(["u1:completed"]);
    thread.level(MONITOR);
    expect(thread.row()).toBe("Monitoring");
    expect(thread.fired()).toEqual(["u1:completed", "u2:completed"]);

    thread.level(EXPECTING);
    expect(thread.row()).toBe("Replying");
    thread.level(REPLYING);
    thread.turns(
      turn("u1", EXITED),
      turn("u2", EXITED, "background"),
      turn("u3", EXITED, "background"),
    );
    expect(thread.fired()).toEqual(["u1:completed", "u2:completed"]);
    thread.level(DRAINED);
    expect(thread.row()).toBeNull();
    expect(thread.fired()).toEqual(["u1:completed", "u2:completed", "u3:completed"]);

    thread.lapse();
    thread.observe();
    expect(thread.fired()).toHaveLength(3);
  });

  it("holds through the reply expected after a watch loop ended on its own", () => {
    const thread = scenario();
    thread.level(MONITOR);
    thread.turns(turn("u1", EXITED));
    thread.level(EXPECTING);
    thread.level(REPLYING);
    thread.turns(turn("u1", EXITED), turn("u2", EXITED, "background"));
    expect(thread.fired()).toEqual(["u1:completed"]);

    thread.level(DRAINED);
    expect(thread.fired()).toEqual(["u1:completed", "u2:completed"]);
  });

  it("holds for a watch loop that runs beside a shell or whose list is cut short", () => {
    const beside = scenario();
    beside.level(level([MONITOR_TASK, SHELL_TASK]));
    beside.turns(turn("u1", EXITED));
    expect(beside.row()).toBe("Working in background");
    expect(beside.fired()).toEqual([]);

    const cutShort = scenario();
    cutShort.level({ ...MONITOR, total: 40 });
    cutShort.turns(turn("u1", EXITED));
    expect(cutShort.row()).toBe("Working in background");
    expect(cutShort.fired()).toEqual([]);
  });

  it("reports a failure at once while background work runs and says nothing more when the work ends", () => {
    const thread = scenario();
    thread.level(SHELL);
    thread.turns(turn("u1", { kind: "exited", exitCode: 2 }));

    expect(thread.fired()).toEqual(["u1:failed"]);
    expect(thread.row()).toBe("Working in background");

    thread.level(DRAINED);
    thread.lapse();
    expect(thread.fired()).toEqual(["u1:failed"]);
  });

  it("reports a failed follow-up reply at once while a watch loop keeps running", () => {
    const thread = scenario();
    thread.level(MONITOR);
    thread.turns(turn("u1", EXITED));
    thread.turns(
      turn("u1", EXITED),
      turn("u2", { kind: "failed", message: "Reply failed" }, "background"),
    );

    expect(thread.fired()).toEqual(["u1:completed", "u2:failed"]);
  });

  it.each(["approval", "input"] as const)(
    "asks for %s at once while background work runs",
    (kind) => {
      const thread = scenario();
      thread.level(SHELL);
      thread.asks(null);
      thread.asks({ kind, id: "req-1" });

      expect(thread.fired()).toEqual([`${kind}:req-1`]);
    },
  );

  it("reports once under the same owner when its project reloads while the completion is held", () => {
    const thread = scenario();
    thread.level(SHELL);
    thread.turns(turn("u1", EXITED));
    thread.reload(2);
    expect(thread.row()).toBe("Working in background");
    expect(thread.fired()).toEqual([]);

    thread.level(DRAINED);
    thread.lapse();
    expect(thread.fired()).toEqual(["u1:completed"]);
  });

  it("stays silent when another owner takes the thread over while its completion is held", () => {
    const thread = scenario();
    thread.level(SHELL);
    thread.turns(turn("u1", EXITED));
    expect(thread.fired()).toEqual([]);

    thread.reload(2, "agent-root:other");
    thread.owner("agent-root:other");
    expect(thread.row()).toBeNull();
    expect(thread.fired()).toEqual([]);

    thread.level(DRAINED);
    thread.lapse();
    thread.reload(3, OWNER_ID);
    thread.owner(OWNER_ID);
    expect(thread.fired()).toEqual([]);
  });

  it("keeps holding while another owner reports, drains and ends work under the same thread id", () => {
    const other = "agent-root:other";
    const thread = scenario();
    thread.level(SHELL);
    thread.turns(turn("u1", EXITED));

    thread.level({ ...level([AGENT_TASK]), workspaceId: other });
    expect(thread.row()).toBe("Working in background");
    expect(thread.view()?.sessionBackground).toMatchObject({ ownerId: OWNER_ID, agents: 0 });
    expect(thread.fired()).toEqual([]);

    thread.level({ ...DRAINED, workspaceId: other });
    thread.lapse();
    thread.level({ ...SHELL, workspaceId: other });
    thread.sessionEnds(other);
    expect(thread.row()).toBe("Working in background");
    expect(thread.fired()).toEqual([]);

    thread.level(DRAINED);
    thread.lapse();
    expect(thread.row()).toBeNull();
    expect(thread.fired()).toEqual(["u1:completed"]);
  });

  it("never holds for a level reported under another owner of the same thread", () => {
    const thread = scenario();
    thread.level({ ...SHELL, workspaceId: "agent-root:other" });
    thread.turns(turn("u1", EXITED));

    expect(thread.row()).toBeNull();
    expect(thread.fired()).toEqual(["u1:completed"]);
  });

  it("reports a provider without session background work as soon as its turn finishes", () => {
    const thread = scenario({
      ...BASE,
      provider: { kind: "codex", sessionId: null },
      turns: [turn("u1", RUNNING)],
      viewedAtEpochMs: START + 5_000,
    });
    thread.level(SHELL);
    thread.turns(turn("u1", EXITED));

    expect(thread.view()?.sessionBackground).toBeUndefined();
    expect(thread.row()).toBeNull();
    expect(thread.fired()).toEqual(["u1:completed"]);
  });

  it("gives every level change a new view so a cached subject never outlives its level", () => {
    const thread = scenario();
    thread.level(SHELL);
    thread.turns(turn("u1", EXITED));
    const held = thread.view();

    thread.observe();
    expect(thread.view()).toBe(held);

    thread.level(SHELL);
    expect(thread.view()).not.toBe(held);
    expect(thread.view()?.thread).toBe(held?.thread);
  });
});

describe("row status and completion notification for every session background shape", () => {
  const replies: ReadonlyArray<AgentSessionReply> = [
    { kind: "none" },
    { kind: "expected", sinceEpochMs: START, untilEpochMs: START + 5_000 },
    { kind: "inProgress", sinceEpochMs: START },
  ];
  const taskLists: ReadonlyArray<ReadonlyArray<AgentBackgroundTask>> = [
    [],
    [SHELL_TASK],
    [MONITOR_TASK],
    [OTHER_TASK],
    [AGENT_TASK],
    [SHELL_TASK, MONITOR_TASK],
    [AGENT_TASK, SHELL_TASK],
    [MONITOR_TASK, SECOND_MONITOR_TASK],
  ];
  const shapes: ReadonlyArray<AgentSessionBackground | undefined> = [
    undefined,
    ...replies.flatMap((reply) =>
      taskLists.flatMap((tasks) =>
        [0, 1, 2, 40].flatMap((total) =>
          [0, 1, 2].map((agents) => ({
            ownerId: OWNER_ID,
            total,
            agents,
            tasks,
            sinceEpochMs: START,
            taskSinceEpochMs: new Map<string, number>(),
            reply,
          })),
        ),
      ),
    ),
  ];
  const projects = [projectFixture({ generation: 1 })];

  function viewOf(
    status: AgentTurnStatus,
    sessionBackground: AgentSessionBackground | undefined,
  ): AgentThreadView {
    return surfaceThreadView({
      thread: { ...BASE, turns: [turn("u1", status)], viewedAtEpochMs: START + 5_000 },
      ...(sessionBackground === undefined ? {} : { sessionBackground }),
    });
  }

  function stateOf(view: AgentThreadView) {
    return agentThreadNotificationSubjects([view], new Map(), projects)[0]?.state;
  }

  it("holds a completion exactly while the session works and shows the row live unless it is idle", () => {
    expect(shapes).toHaveLength(289);
    const activities = shapes.map((shape) => {
      const view = viewOf(EXITED, shape);
      const activity = agentSessionBackgroundActivity(shape);
      expect(agentRowIsLive(agentRowStatus(view))).toBe(activity !== "idle");
      expect(agentSessionBackgroundIsLive(shape)).toBe(activity !== "idle");
      expect(stateOf(view)).toEqual({
        kind: activity === "working" ? "held" : "signal",
        signal: { kind: "completed", key: "u1:completed" },
      });
      return activity;
    });

    expect(activities.filter((activity) => activity === "idle")).toHaveLength(9);
    expect(activities.filter((activity) => activity === "monitoring")).toHaveLength(2);
    expect(activities.filter((activity) => activity === "working")).toHaveLength(278);
  });

  it("calls only a complete list of nothing but watch loops monitoring", () => {
    const monitoring = shapes.filter(
      (shape) => agentSessionBackgroundActivity(shape) === "monitoring",
    );

    expect(
      monitoring.map((shape) => [shape?.total, shape?.agents, shape?.reply.kind, shape?.tasks]),
    ).toEqual([
      [1, 0, "none", [MONITOR_TASK]],
      [2, 0, "none", [MONITOR_TASK, SECOND_MONITOR_TASK]],
    ]);
    for (const shape of monitoring) {
      expect(agentRowStatusLabel(agentRowStatus(viewOf(EXITED, shape)))).toBe("Monitoring");
    }
  });

  it("never holds a failure, whatever the session still runs", () => {
    for (const shape of shapes) {
      for (const status of [
        { kind: "exited", exitCode: 2 },
        { kind: "failed", message: "boom" },
      ] satisfies AgentTurnStatus[]) {
        expect(stateOf(viewOf(status, shape))).toEqual({
          kind: "signal",
          signal: { kind: "failed", key: "u1:failed" },
        });
      }
    }
  });

  it("leaves a running turn's pending request alone, whatever the session still runs", () => {
    for (const shape of shapes) {
      const view = viewOf(RUNNING, shape);
      const interactions = new Map([[THREAD_ID, { kind: "approval", id: "req-1" } as const]]);
      expect(agentThreadNotificationSubjects([view], interactions, projects)[0]?.state).toEqual(
        agentThreadNotificationState(view.thread, { kind: "approval", id: "req-1" }, "idle"),
      );
    }
  });
});

describe("remote thread notification subject", () => {
  it("keeps its identity, missing policy and completion regardless of local session levels", () => {
    const remoteKey = "remote:build:runner:orders";
    const remote = surfaceThreadView({
      execution: {
        kind: "remote",
        serverId: "build",
        runnerId: "runner",
        projectId: "orders",
        conversationId: "c-1",
        latestTaskId: "task-1",
        resume: null,
      },
      thread: {
        ...BASE,
        threadId: "remote-thread:1",
        owner: { rootKey: remoteKey, ownerId: remoteKey, repositoryRoot: remoteKey },
        turns: [turn("remote-turn", EXITED)],
      },
    });
    const projects = [projectFixture({ rootKey: remoteKey, label: "orders", generation: 7 })];

    expect(agentThreadNotificationSubjects([remote], new Map(), projects)).toEqual([
      {
        threadId: "remote-thread:1",
        ownerKey: JSON.stringify([remote.thread.owner, "build", null]),
        whenMissing: "retain",
        title: remote.thread.title,
        projectLabel: "orders",
        state: { kind: "signal", signal: { kind: "completed", key: "remote-turn:completed" } },
      },
    ]);
  });
});
