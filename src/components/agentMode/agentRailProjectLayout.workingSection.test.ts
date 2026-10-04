import { describe, expect, it } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentPendingInteraction } from "../../domain/agentPendingInteraction";
import type { AgentThread, AgentTurn, AgentTurnStatus } from "../../domain/agentThread";
import { surfaceThreadView } from "./agentSurfaceTestFixtures";
import {
  ALL_PROJECTS_EXPANDED,
  agentRailOwnedViews,
  agentRailProjectSections,
  agentRailThreadOrder,
  agentRailVisibleThreadOrder,
  type AgentRailProjectDisclosureState,
} from "./agentRailProjectLayout";
import { agentRailProjectSignal } from "./agentRailProjectSignal";
import {
  agentRailStatusLookup,
  agentRailWorkingSections,
  agentRailWorkingVisibleRows,
  type AgentRailWorkingDisclosure,
  type AgentRailWorkingSplit,
} from "./agentRailWorkingSection";
import {
  agentJumpSlots,
  agentRailSections,
  type AgentRailScopeEntry,
} from "./agentSidebarPresentation";

const APP = "/workspace/app";
const API = "/workspace/api";
const REMOTE_API = "remote:srv:/srv/api";
const NOW = 1_700_000_600_000;
const LATER = NOW + 120_000;
const NO_PENDING: ReadonlyMap<string, AgentPendingInteraction> = new Map();

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

function idle(threadId: string, rootKey: string, metadata: Partial<AgentThread> = {}) {
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

function busy(
  threadId: string,
  rootKey: string,
  startedAtEpochMs: number,
  metadata: Partial<AgentThread> = {},
): AgentThreadView {
  const view = idle(threadId, rootKey, {
    turns: [turn({ kind: "running" }, startedAtEpochMs)],
    ...metadata,
  });
  return { ...view, lifecycle: "running" };
}

function split(
  workingSection: AgentRailWorkingSplit["workingSection"],
  disclosure: AgentRailWorkingDisclosure = "collapsed",
  pending: ReadonlyMap<string, AgentPendingInteraction> = NO_PENDING,
  now: number = NOW,
): AgentRailWorkingSplit {
  return { workingSection, disclosure, statusOf: agentRailStatusLookup(pending), now: () => now };
}

function disclosure(collapsed: ReadonlyArray<string> = []): AgentRailProjectDisclosureState {
  return { collapsed: new Set(collapsed), showingAll: new Set() };
}

function ids(views: ReadonlyArray<AgentThreadView>): ReadonlyArray<string> {
  return views.map((view) => view.thread.threadId);
}

describe("agent rail project layout with the Working section", () => {
  const entries = [entry(APP, "app"), entry(API, "api", [API, REMOTE_API])];
  const views = [
    idle("pin", API, { pinned: true }),
    idle("app-idle", APP, { sortOrder: 1 }),
    busy("app-busy", APP, 2_000, { sortOrder: 2 }),
    idle("api-idle", API, { sortOrder: 1 }),
    busy("api-busy", API, 1_000, { sortOrder: 2 }),
    busy("remote-busy", REMOTE_API, 3_000, { sortOrder: 3 }),
  ];

  it("orders exactly as today while the preference is off, whatever the shelf disclosure", () => {
    const today = agentRailThreadOrder(views, entries, ALL_PROJECTS_EXPANDED, null, NOW);

    expect(today).toEqual(["pin", "app-idle", "app-busy", "api-idle", "api-busy", "remote-busy"]);
    for (const shelf of ["collapsed", "expanded"] as const) {
      expect(
        agentRailThreadOrder(views, entries, ALL_PROJECTS_EXPANDED, null, NOW, split("off", shelf)),
      ).toEqual(today);
      expect(
        agentRailThreadOrder(
          views,
          entries,
          ALL_PROJECTS_EXPANDED,
          "app-busy",
          NOW,
          split("off", shelf),
        ),
      ).toEqual(today);
    }
  });

  it("drops working rows from their projects and reports them as a per-project count", () => {
    const sections = agentRailWorkingSections(
      agentRailSections(agentRailOwnedViews(views, entries), NOW),
      agentRailStatusLookup(NO_PENDING),
      "on",
    );

    const projects = agentRailProjectSections(sections, entries, ALL_PROJECTS_EXPANDED, null);

    expect(projects.map((project) => [ids(project.rows), project.working])).toEqual([
      [["app-idle"], 1],
      [["api-idle"], 2],
    ]);
    expect(ids(sections.working)).toEqual(["api-busy", "app-busy", "remote-busy"]);
  });

  it("reports no working count for plain sections", () => {
    const sections = agentRailSections(agentRailOwnedViews(views, entries), NOW);

    const projects = agentRailProjectSections(sections, entries, ALL_PROJECTS_EXPANDED, null);

    expect(projects.map((project) => project.working)).toEqual([0, 0]);
    expect(projects.map((project) => project.threads.length)).toEqual([2, 3]);
  });

  it("keeps a project whose only threads are working from looking empty", () => {
    const onlyBusy = [busy("app-busy", APP, 2_000)];
    const sections = agentRailWorkingSections(
      agentRailSections(onlyBusy, NOW),
      agentRailStatusLookup(NO_PENDING),
      "on",
    );

    const [app] = agentRailProjectSections(sections, entries, disclosure([APP]), null);

    expect(app?.threads).toEqual([]);
    expect(app?.working).toBe(1);
    expect(agentRailProjectSignal(app?.threads ?? [], NO_PENDING, app?.working)).toEqual({
      tone: "working",
      label: "1 thread working",
    });
    expect(agentRailProjectSignal(app?.threads ?? [], NO_PENDING)).toBeNull();
  });

  it("keeps waiting for you ahead of working on a collapsed project header", () => {
    const asks = busy("asks", APP, 2_000);
    const pending = new Map<string, AgentPendingInteraction>([["asks", "approval"]]);

    expect(agentRailProjectSignal([asks], pending, 3)).toEqual({
      tone: "attention",
      label: "1 thread waiting for you",
    });
    expect(agentRailProjectSignal([busy("other", APP, 1_000)], NO_PENDING, 2)).toEqual({
      tone: "working",
      label: "3 threads working",
    });
  });

  it("puts no working rows in keyboard order while the shelf is collapsed", () => {
    expect(
      agentRailThreadOrder(views, entries, ALL_PROJECTS_EXPANDED, null, NOW, split("on")),
    ).toEqual(["pin", "app-idle", "api-idle"]);
  });

  it("keeps the selected working thread reachable in a collapsed shelf", () => {
    expect(
      agentRailThreadOrder(views, entries, ALL_PROJECTS_EXPANDED, "app-busy", NOW, split("on")),
    ).toEqual(["pin", "app-idle", "api-idle", "app-busy"]);
  });

  it("orders expanded working rows after the active list in their manual order", () => {
    const order = agentRailThreadOrder(
      views,
      entries,
      ALL_PROJECTS_EXPANDED,
      null,
      NOW,
      split("on", "expanded"),
    );

    expect(order).toEqual(["pin", "app-idle", "api-idle", "api-busy", "app-busy", "remote-busy"]);
    expect([...agentJumpSlots(order)]).toEqual([
      ["pin", 1],
      ["app-idle", 2],
      ["api-idle", 3],
      ["api-busy", 4],
      ["app-busy", 5],
      ["remote-busy", 6],
    ]);
  });

  it("keeps working rows in the shelf even when their project is collapsed", () => {
    expect(
      agentRailThreadOrder(views, entries, disclosure([APP]), null, NOW, split("on", "expanded")),
    ).toEqual(["pin", "api-idle", "api-busy", "app-busy", "remote-busy"]);
  });

  it("returns a thread to its project slot once it asks for the user", () => {
    const pending = new Map<string, AgentPendingInteraction>([["api-busy", "approval"]]);

    expect(
      agentRailThreadOrder(
        views,
        entries,
        ALL_PROJECTS_EXPANDED,
        null,
        NOW,
        split("on", "expanded", pending),
      ),
    ).toEqual(["pin", "app-idle", "api-idle", "api-busy", "app-busy", "remote-busy"]);
    expect(
      agentRailThreadOrder(
        views,
        entries,
        ALL_PROJECTS_EXPANDED,
        null,
        NOW,
        split("on", "collapsed", pending),
      ),
    ).toEqual(["pin", "app-idle", "api-idle", "api-busy"]);
  });

  it("keeps jump slots still when a working thread starts another turn", () => {
    const restarted = views.map((view) =>
      view.thread.threadId === "api-busy" ? busy("api-busy", API, 9_000, { sortOrder: 2 }) : view,
    );
    const order = (threads: ReadonlyArray<AgentThreadView>) =>
      agentRailThreadOrder(
        threads,
        entries,
        ALL_PROJECTS_EXPANDED,
        null,
        NOW,
        split("on", "expanded"),
      );

    expect(order(restarted)).toEqual(order(views));
    expect([...agentJumpSlots(order(restarted))]).toEqual([...agentJumpSlots(order(views))]);
  });

  it("splits snoozed threads by the clock it is given, so it can share the sidebar's", () => {
    const withSnoozed = [...views, idle("app-snoozed", APP, { snoozedUntil: NOW + 60_000 })];
    const order = (now: number) =>
      agentRailThreadOrder(
        withSnoozed,
        entries,
        ALL_PROJECTS_EXPANDED,
        null,
        split("on", "collapsed", NO_PENDING, now).now(),
        split("on", "collapsed", NO_PENDING, now),
      );

    expect(order(NOW)).toEqual(["pin", "app-idle", "api-idle"]);
    expect(order(LATER)).toContain("app-snoozed");
  });

  it("matches the visible order the sidebar derives from its own sections", () => {
    const sections = agentRailWorkingSections(
      agentRailSections(agentRailOwnedViews(views, entries), NOW),
      agentRailStatusLookup(NO_PENDING),
      "on",
    );
    const projects = agentRailProjectSections(sections, entries, ALL_PROJECTS_EXPANDED, "app-busy");
    const rows = agentRailWorkingVisibleRows(sections.working, "collapsed", "app-busy");

    expect(agentRailVisibleThreadOrder(sections.pinned, projects, rows)).toEqual(
      agentRailThreadOrder(views, entries, ALL_PROJECTS_EXPANDED, "app-busy", NOW, split("on")),
    );
    expect(agentRailVisibleThreadOrder(sections.pinned, projects)).toEqual([
      "pin",
      "app-idle",
      "api-idle",
    ]);
  });
});
