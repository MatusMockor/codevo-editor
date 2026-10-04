import { describe, expect, it } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentSessionBackground } from "../../domain/agentSessionBackground";
import type { AgentThread, AgentTurn, AgentTurnStatus } from "../../domain/agentThread";
import { NO_AGENT_TURN_LOG_EVIDENCE } from "../../domain/agentTurnContentLoss";
import { surfaceThreadView } from "./agentSurfaceTestFixtures";
import { agentRailOwnerIndex } from "./agentRailProjectLayout";
import {
  DEFAULT_AGENT_RAIL_WORKING_DISCLOSURE,
  NO_AGENT_RAIL_WORKING_SHELF,
  NO_AGENT_RAIL_WORKING_SPLIT,
  agentRailProjectEmptyLabel,
  agentRailRowStatus,
  agentRailStatusLookup,
  agentRailToggledWorkingDisclosure,
  agentRailWorkingCountByProject,
  agentRailWorkingSections,
  agentRailWorkingShelf,
  agentRailWorkingThreads,
  agentRailWorkingVisibleRows,
  type AgentRailStatusLookup,
} from "./agentRailWorkingSection";
import {
  agentRailSections,
  type AgentRailScopeEntry,
  type AgentRailSections,
} from "./agentSidebarPresentation";
import {
  NO_ROW_SIGNALS,
  agentRowBelongsInWorkingSection,
  agentRowStatus,
  agentRowWorkingAgents,
  type AgentRowSignals,
} from "./agentThreadRowStatus";
import type { AgentBackgroundActivity } from "../../domain/agentBackgroundActivity";
import type { AgentPendingInteraction } from "../../domain/agentPendingInteraction";

const APP = "/workspace/app";
const API = "/workspace/api";
const REMOTE_API = "remote:srv:/srv/api";
const NOW = 1_700_000_600_000;

function entry(projectRootKey: string, label: string, members?: string[]): AgentRailScopeEntry {
  return {
    memberProjectRootKeys: members,
    value: projectRootKey,
    label,
    projectRootKey,
    repositoryRoot: projectRootKey,
    trust: "trusted",
    origin: "active-tab",
    rootPath: projectRootKey,
    repositoryCount: 1,
    serverPresence: { local: true, remoteServerIds: [] },
  };
}

function turn(status: AgentTurnStatus, startedAtEpochMs: number): AgentTurn {
  const live = status.kind === "running" || status.kind === "pending";
  return {
    turnId: `turn-${startedAtEpochMs}`,
    prompt: "Continue",
    status,
    startedAtEpochMs,
    endedAtEpochMs: live ? null : startedAtEpochMs + 1,
    events: [],
    eventsTruncated: false,
    lastStatusSequence: 0,
    lastOutputSequence: 0,
    launch: null,
    cliVersion: null,
  };
}

function thread(
  threadId: string,
  metadata: Partial<AgentThread> = {},
  rootKey: string = APP,
): AgentThreadView {
  const base = surfaceThreadView().thread;
  return surfaceThreadView({
    thread: {
      ...base,
      threadId,
      owner: { rootKey, ownerId: `agent-root:${rootKey}`, repositoryRoot: rootKey },
      updatedAtEpochMs: NOW,
      ...metadata,
    },
  });
}

function running(
  threadId: string,
  startedAtEpochMs: number,
  metadata: Partial<AgentThread> = {},
  rootKey: string = APP,
): AgentThreadView {
  return thread(
    threadId,
    { turns: [turn({ kind: "running" }, startedAtEpochMs)], ...metadata },
    rootKey,
  );
}

function finished(threadId: string, status: AgentTurnStatus): AgentThreadView {
  return thread(threadId, { turns: [turn(status, NOW - 60_000)] });
}

function withSession(
  view: AgentThreadView,
  tasks: AgentSessionBackground["tasks"],
  sinceEpochMs: number,
): AgentThreadView {
  return {
    ...view,
    sessionBackground: {
      ownerId: view.thread.owner.ownerId,
      total: tasks.length,
      agents: tasks.filter((task) => task.taskType === "agent").length,
      tasks,
      sinceEpochMs,
      taskSinceEpochMs: new Map(),
    },
  };
}

function statusLookup(signals: Readonly<Record<string, AgentRowSignals>> = {}): {
  readonly statusOf: AgentRailStatusLookup;
  readonly asked: string[];
} {
  const asked: string[] = [];
  return {
    asked,
    statusOf: (view) => {
      asked.push(view.thread.threadId);
      return agentRowStatus(
        view,
        NO_AGENT_TURN_LOG_EVIDENCE,
        undefined,
        signals[view.thread.threadId] ?? NO_ROW_SIGNALS,
      );
    },
  };
}

function ids(views: ReadonlyArray<AgentThreadView> | undefined): ReadonlyArray<string> {
  return (views ?? []).map((view) => view.thread.threadId);
}

function statusKinds(
  views: ReadonlyArray<AgentThreadView>,
  statusOf: AgentRailStatusLookup,
): ReadonlyArray<string> {
  return views.map((view) => statusOf(view).kind);
}

describe("agentRailWorkingSections with the preference off", () => {
  it("returns today's sections untouched with an empty working list", () => {
    const sections = agentRailSections(
      [
        running("busy", 5_000),
        thread("idle"),
        running("pin", 4_000, { pinned: true }),
        running("snoozed", 3_000, { snoozedUntil: NOW + 60_000 }),
        running("settled", 2_000, { settledAt: NOW }),
      ],
      NOW,
    );
    const lookup = statusLookup();

    const result = agentRailWorkingSections(sections, lookup.statusOf, "off");

    expect(result.working).toEqual([]);
    expect(result.active).toBe(sections.active);
    expect(result.pinned).toBe(sections.pinned);
    expect(result.snoozed).toBe(sections.snoozed);
    expect(result.settled).toBe(sections.settled);
    expect(ids(result.active)).toEqual(ids(sections.active));
    expect(ids(result.active)).toContain("busy");
    expect(lookup.asked).toEqual([]);
  });
});

describe("agentRailWorkingSections with the preference on", () => {
  it("moves working, background, monitoring and agent threads out of the active list", () => {
    const views = [
      running("working", 9_000),
      running("agents-working-lead", 8_000),
      withSession(
        finished("agents-waiting-lead", { kind: "exited", exitCode: 0 }),
        [{ taskId: "agent-1", taskType: "agent" }],
        7_000,
      ),
      withSession(
        finished("background", { kind: "exited", exitCode: 0 }),
        [{ taskId: "shell-1", taskType: "shell" }],
        6_000,
      ),
      withSession(
        finished("monitoring", { kind: "exited", exitCode: 0 }),
        [{ taskId: "monitor-1", taskType: "monitor" }],
        5_000,
      ),
      thread("idle"),
    ];
    const lookup = statusLookup({
      "agents-working-lead": { pending: null, workingAgents: 2 },
    });
    const sections = agentRailSections(views, NOW);

    const result = agentRailWorkingSections(sections, lookup.statusOf, "on");

    expect(ids(result.working)).toEqual([
      "agents-waiting-lead",
      "agents-working-lead",
      "background",
      "monitoring",
      "working",
    ]);
    expect(statusKinds(result.working, lookup.statusOf)).toEqual([
      "agents",
      "agents",
      "working",
      "working",
      "working",
    ]);
    expect(ids(result.active)).toEqual(["idle"]);
  });

  it("keeps threads that need the user or have stopped working in the active list", () => {
    const views = [
      running("approval", 9_000, { sortOrder: 1 }),
      running("input", 8_000, { sortOrder: 2 }),
      thread("failed", {
        sortOrder: 3,
        turns: [turn({ kind: "failed", message: "boom" }, NOW - 60_000)],
      }),
      thread("crashed", {
        sortOrder: 4,
        turns: [turn({ kind: "exited", exitCode: 2 }, NOW - 60_000)],
      }),
      thread("stopped", { sortOrder: 5, turns: [turn({ kind: "stopped" }, NOW - 60_000)] }),
      thread("interrupted", {
        sortOrder: 6,
        turns: [turn({ kind: "interrupted" }, NOW - 60_000)],
      }),
      thread("done", {
        sortOrder: 7,
        turns: [turn({ kind: "exited", exitCode: 0 }, NOW - 60_000)],
      }),
      thread("none", { sortOrder: 8 }),
    ];
    const lookup = statusLookup({
      approval: { pending: "approval", workingAgents: 2 },
      input: { pending: "input", workingAgents: 0 },
    });
    const sections = agentRailSections(views, NOW);

    const result = agentRailWorkingSections(sections, lookup.statusOf, "on");

    expect(statusKinds(sections.active, lookup.statusOf)).toEqual([
      "approval",
      "input",
      "failed",
      "failed",
      "stopped",
      "stopped",
      "done",
      "none",
    ]);
    expect(result.working).toEqual([]);
    expect(result.active).toBe(sections.active);
  });

  it("returns a thread to the active list when it finishes or asks for the user", () => {
    const busy = running("busy", 9_000);
    const idle = thread("idle", { sortOrder: 1 });

    const working = agentRailWorkingSections(
      agentRailSections([busy, idle], NOW),
      statusLookup().statusOf,
      "on",
    );
    expect(ids(working.working)).toEqual(["busy"]);
    expect(ids(working.active)).toEqual(["idle"]);

    const waiting = agentRailWorkingSections(
      agentRailSections([busy, idle], NOW),
      statusLookup({ busy: { pending: "approval", workingAgents: 0 } }).statusOf,
      "on",
    );
    expect(waiting.working).toEqual([]);
    expect(ids(waiting.active)).toEqual(["busy", "idle"]);

    const settled = thread("busy", { turns: [turn({ kind: "exited", exitCode: 0 }, 9_000)] });
    const finishedRun = agentRailWorkingSections(
      agentRailSections([settled, idle], NOW),
      statusLookup().statusOf,
      "on",
    );
    expect(finishedRun.working).toEqual([]);
    expect(ids(finishedRun.active)).toEqual(["busy", "idle"]);
  });

  it("never moves pinned, snoozed or settled threads even while they work", () => {
    const views = [
      running("pin", 9_000, { pinned: true }),
      running("snoozed", 8_000, { snoozedUntil: NOW + 60_000 }),
      running("settled", 7_000, { settledAt: NOW }),
      running("busy", 6_000),
    ];
    const sections = agentRailSections(views, NOW);
    const lookup = statusLookup();

    const result = agentRailWorkingSections(sections, lookup.statusOf, "on");

    expect(ids(result.working)).toEqual(["busy"]);
    expect(result.active).toEqual([]);
    expect(result.pinned).toBe(sections.pinned);
    expect(result.snoozed).toBe(sections.snoozed);
    expect(result.settled).toBe(sections.settled);
    expect(ids(result.pinned)).toEqual(["pin"]);
    expect(ids(result.snoozed)).toEqual(["snoozed"]);
    expect(ids(result.settled)).toEqual(["settled"]);
    expect(lookup.asked).toEqual(["busy"]);
  });

  it("leaves a pinned thread alone even when it is handed in as active", () => {
    const pin = running("pin", 9_000, { pinned: true });
    const sections: AgentRailSections = { pinned: [], active: [pin] };
    const lookup = statusLookup();

    const result = agentRailWorkingSections(sections, lookup.statusOf, "on");

    expect(result.working).toEqual([]);
    expect(result.active).toBe(sections.active);
    expect(lookup.asked).toEqual([]);
  });

  it("keeps working threads in the manual thread order, not by turn start", () => {
    const views = [
      running("oldest", 1_000, { sortOrder: 1 }),
      running("newest", 3_000, { sortOrder: 2 }),
      running("middle", 2_000, { sortOrder: 3 }),
      thread("idle-a", { sortOrder: 4 }),
      thread("idle-b", { sortOrder: 5 }),
    ];
    const sections = agentRailSections(views, NOW);

    const result = agentRailWorkingSections(sections, statusLookup().statusOf, "on");

    expect(ids(sections.active)).toEqual(["oldest", "newest", "middle", "idle-a", "idle-b"]);
    expect(ids(result.working)).toEqual(["oldest", "newest", "middle"]);
    expect(ids(result.active)).toEqual(["idle-a", "idle-b"]);
  });

  it("does not reshuffle the shelf when a working thread starts a new turn", () => {
    const before = agentRailWorkingSections(
      agentRailSections(
        [running("a", 1_000, { sortOrder: 1 }), running("b", 2_000, { sortOrder: 2 })],
        NOW,
      ),
      statusLookup().statusOf,
      "on",
    );
    const after = agentRailWorkingSections(
      agentRailSections(
        [running("a", 9_000, { sortOrder: 1 }), running("b", 2_000, { sortOrder: 2 })],
        NOW,
      ),
      statusLookup().statusOf,
      "on",
    );

    expect(ids(before.working)).toEqual(["a", "b"]);
    expect(ids(after.working)).toEqual(ids(before.working));
  });

  it("orders the shelf deterministically, whatever order the threads arrive in", () => {
    const first = running("b-first", 5_000, { sortOrder: 1 });
    const second = running("a-second", 5_000, { sortOrder: 2 });
    const unordered = running("z-unordered", 5_000);
    const twin = running("y-unordered", 5_000);
    const expected = ["y-unordered", "z-unordered", "b-first", "a-second"];

    for (const active of [
      [first, second, unordered, twin],
      [twin, unordered, second, first],
      [second, twin, first, unordered],
    ]) {
      const result = agentRailWorkingSections(
        { pinned: [], active },
        statusLookup().statusOf,
        "on",
      );
      expect(ids(result.working)).toEqual(expected);
    }
  });

  it("asks for each active thread's status exactly once", () => {
    const sections = agentRailSections(
      [running("a", 1_000), running("b", 2_000), running("c", 3_000), thread("idle")],
      NOW,
    );
    const lookup = statusLookup();

    agentRailWorkingSections(sections, lookup.statusOf, "on");

    expect([...lookup.asked].sort()).toEqual(["a", "b", "c", "idle"]);
  });

  it("does not mutate the sections it was given", () => {
    const sections = agentRailSections([running("a", 1_000), running("b", 2_000)], NOW);
    const before = ids(sections.active);

    const result = agentRailWorkingSections(sections, statusLookup().statusOf, "on");

    expect(ids(sections.active)).toEqual(before);
    expect(result.active).not.toBe(sections.active);
    expect(ids(result.working)).toEqual(["a", "b"]);
  });
});

describe("agentRailWorkingCountByProject", () => {
  const entries = [entry(APP, "app"), entry(API, "api", [API, REMOTE_API])];

  it("counts working threads under the project that owns them, including linked members", () => {
    const views = [
      running("app-1", 4_000, {}, APP),
      running("app-2", 3_000, {}, APP),
      running("api-1", 2_000, {}, API),
      running("remote-1", 1_000, {}, REMOTE_API),
      running("detached", 500, {}, "/workspace/gone"),
      thread("app-idle", {}, APP),
    ];
    const result = agentRailWorkingSections(
      agentRailSections(views, NOW),
      statusLookup().statusOf,
      "on",
    );

    const counts = agentRailWorkingCountByProject(result.working, agentRailOwnerIndex(entries));

    expect(Object.fromEntries(counts)).toEqual({ [APP]: 2, [API]: 2 });
  });

  it("reports nothing while the preference is off or nothing is working", () => {
    const sections = agentRailSections([running("app-1", 4_000), thread("app-idle")], NOW);
    const owners = agentRailOwnerIndex(entries);
    const off = agentRailWorkingSections(sections, statusLookup().statusOf, "off");
    const idle = agentRailWorkingSections(
      agentRailSections([thread("app-idle")], NOW),
      statusLookup().statusOf,
      "on",
    );

    expect(agentRailWorkingCountByProject(off.working, owners).size).toBe(0);
    expect(agentRailWorkingCountByProject(idle.working, owners).size).toBe(0);
    expect(agentRailWorkingCountByProject(off.working, owners).get(APP) ?? 0).toBe(0);
  });
});

describe("agentRailWorkingVisibleRows", () => {
  const working = [running("a", 3_000), running("b", 2_000), running("c", 1_000)];

  it("starts collapsed", () => {
    expect(DEFAULT_AGENT_RAIL_WORKING_DISCLOSURE).toBe("collapsed");
  });

  it("shows every working thread when expanded", () => {
    expect(agentRailWorkingVisibleRows(working, "expanded", null)).toBe(working);
    expect(agentRailWorkingVisibleRows(working, "expanded", "b")).toBe(working);
  });

  it("hides a collapsed section's rows except the selected thread", () => {
    expect(agentRailWorkingVisibleRows(working, "collapsed", null)).toEqual([]);
    expect(ids(agentRailWorkingVisibleRows(working, "collapsed", "b"))).toEqual(["b"]);
  });

  it("shows nothing when the selected thread is not working", () => {
    expect(agentRailWorkingVisibleRows(working, "collapsed", "elsewhere")).toEqual([]);
    expect(agentRailWorkingVisibleRows([], "collapsed", "a")).toEqual([]);
  });
});

describe("agentRailStatusLookup", () => {
  const NO_PENDING: ReadonlyMap<string, AgentPendingInteraction> = new Map();

  it("files a running thread under Working only while nothing waits for the user", () => {
    const busy = running("busy", 9_000);

    expect(agentRailRowStatus(busy, NO_PENDING)).toEqual({
      kind: "working",
      startedAtEpochMs: 9_000,
    });
    expect(agentRailRowStatus(busy, new Map([["busy", "approval"]]))).toEqual({
      kind: "approval",
    });
    expect(agentRailRowStatus(busy, new Map([["busy", "input"]]))).toEqual({ kind: "input" });
    expect(agentRailRowStatus(busy, new Map([["other", "approval"]]))).toMatchObject({
      kind: "working",
    });
  });

  it("ignores a stale pending interaction once the thread stopped running", () => {
    const done = finished("done", { kind: "exited", exitCode: 0 });

    expect(agentRailRowStatus(done, new Map([["done", "approval"]]))).toEqual({ kind: "done" });
  });

  it("splits the rail by the pending interactions it was given", () => {
    const sections = agentRailSections(
      [running("asks", 9_000, { sortOrder: 1 }), running("busy", 8_000, { sortOrder: 2 })],
      NOW,
    );

    const result = agentRailWorkingSections(
      sections,
      agentRailStatusLookup(new Map([["asks", "input"]])),
      "on",
    );

    expect(ids(result.active)).toEqual(["asks"]);
    expect(ids(result.working)).toEqual(["busy"]);
  });

  it("agrees with the row's own status on membership whatever the background", () => {
    const settledForeground: AgentBackgroundActivity = {
      phase: "working",
      foregroundSettled: true,
      tasks: [{ taskId: "agent-1", taskType: "agent", description: "Review the parser" }],
      truncated: false,
    };
    const monitoring: AgentBackgroundActivity = {
      phase: "monitoring",
      foregroundSettled: true,
      tasks: [{ taskId: "monitor-1", taskType: "monitor", description: "Watch the build" }],
      truncated: false,
    };
    const views = [
      running("claude", 9_000),
      running("codex", 8_000, { provider: { kind: "codex", sessionId: null } }),
      withSession(
        finished("session", { kind: "exited", exitCode: 0 }),
        [{ taskId: "shell-1", taskType: "shell" }],
        7_000,
      ),
      finished("done", { kind: "exited", exitCode: 0 }),
      thread("idle"),
    ];
    const pendings: ReadonlyArray<AgentPendingInteraction | null> = [null, "approval", "input"];

    for (const view of views) {
      for (const pending of pendings) {
        const rail = agentRailRowStatus(
          view,
          pending === null ? NO_PENDING : new Map([[view.thread.threadId, pending]]),
        );
        for (const background of [undefined, null, settledForeground, monitoring]) {
          const row = agentRowStatus(view, NO_AGENT_TURN_LOG_EVIDENCE, background, {
            pending,
            workingAgents: agentRowWorkingAgents(view),
          });
          expect(agentRowBelongsInWorkingSection(row)).toBe(agentRowBelongsInWorkingSection(rail));
        }
      }
    }
  });
});

describe("agentRailWorkingShelf", () => {
  const working = [running("a", 3_000), running("b", 2_000)];

  it("is absent while nothing is working", () => {
    expect(agentRailWorkingShelf([], "expanded", "a")).toBe(NO_AGENT_RAIL_WORKING_SHELF);
    expect(NO_AGENT_RAIL_WORKING_SHELF.threads).toEqual([]);
    expect(NO_AGENT_RAIL_WORKING_SHELF.rows).toEqual([]);
  });

  it("counts every working thread but shows only the selected one while collapsed", () => {
    const shelf = agentRailWorkingShelf(working, "collapsed", "b");

    expect(shelf.threads).toBe(working);
    expect(ids(shelf.rows)).toEqual(["b"]);
    expect(shelf.disclosure).toBe("collapsed");
    expect(agentRailWorkingShelf(working, "collapsed", null).rows).toEqual([]);
  });

  it("shows every working thread once expanded", () => {
    const shelf = agentRailWorkingShelf(working, "expanded", null);

    expect(shelf.rows).toBe(working);
    expect(shelf.disclosure).toBe("expanded");
  });

  it("toggles between collapsed and expanded", () => {
    expect(agentRailToggledWorkingDisclosure("collapsed")).toBe("expanded");
    expect(agentRailToggledWorkingDisclosure("expanded")).toBe("collapsed");
  });
});

describe("working section defaults and labels", () => {
  it("leaves the rail unsplit by default", () => {
    const sections = agentRailSections([running("busy", 9_000)], NOW);

    const result = agentRailWorkingSections(
      sections,
      NO_AGENT_RAIL_WORKING_SPLIT.statusOf,
      NO_AGENT_RAIL_WORKING_SPLIT.workingSection,
    );

    expect(NO_AGENT_RAIL_WORKING_SPLIT.workingSection).toBe("off");
    expect(NO_AGENT_RAIL_WORKING_SPLIT.disclosure).toBe("collapsed");
    expect(NO_AGENT_RAIL_WORKING_SPLIT.statusOf(running("busy", 9_000))).toEqual({ kind: "none" });
    expect(Math.abs(NO_AGENT_RAIL_WORKING_SPLIT.now() - Date.now())).toBeLessThan(5_000);
    expect(result.active).toBe(sections.active);
    expect(result.working).toEqual([]);
  });

  it("reads the working list from split sections and none from plain sections", () => {
    const sections = agentRailSections([running("busy", 9_000), thread("idle")], NOW);
    const split = agentRailWorkingSections(sections, statusLookup().statusOf, "on");

    expect(agentRailWorkingThreads(sections)).toEqual([]);
    expect(agentRailWorkingThreads(split)).toBe(split.working);
    expect(ids(agentRailWorkingThreads(split))).toEqual(["busy"]);
  });

  it("says where a project's threads went instead of calling it empty", () => {
    expect(agentRailProjectEmptyLabel(0, 0)).toBe("No threads yet");
    expect(agentRailProjectEmptyLabel(0, 3)).toBe("No active threads");
    expect(agentRailProjectEmptyLabel(1, 0)).toBe("1 thread in Working");
    expect(agentRailProjectEmptyLabel(4, 2)).toBe("4 threads in Working");
  });
});
