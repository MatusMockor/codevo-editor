import { describe, expect, it } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentPendingInteraction } from "../../domain/agentPendingInteraction";
import type { AgentRailWorkingSection } from "../../domain/agentRailWorkingSection";
import type { AgentThread, AgentTurn, AgentTurnStatus } from "../../domain/agentThread";
import { agentRailOwnedViews, agentRailOwnerIndex } from "./agentRailProjectLayout";
import { agentRailProjectSignals } from "./agentRailProjectSignal";
import { agentRailStatusLookup, agentRailWorkingSections } from "./agentRailWorkingSection";
import { agentRailSections, type AgentRailScopeEntry } from "./agentSidebarPresentation";
import { surfaceThreadView } from "./agentSurfaceTestFixtures";
import { agentRowStatusTone, type AgentRowStatusTone } from "./agentThreadRowStatus";

const APP = "/workspace/app";
const API = "/workspace/api";
const DOCS = "/workspace/docs";
const REMOTE_API = "remote:srv:/srv/api";
const NOW = 1_700_000_600_000;
const NO_PENDING: ReadonlyMap<string, AgentPendingInteraction> = new Map();
const ENTRIES = [entry(APP), entry(API, [API, REMOTE_API]), entry(DOCS)];

function entry(projectRootKey: string, members?: string[]): AgentRailScopeEntry {
  return {
    memberProjectRootKeys: members,
    value: projectRootKey,
    label: projectRootKey,
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

function idle(
  threadId: string,
  rootKey: string,
  metadata: Partial<AgentThread> = {},
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

function busy(
  threadId: string,
  rootKey: string,
  metadata: Partial<AgentThread> = {},
): AgentThreadView {
  const view = idle(threadId, rootKey, {
    turns: [turn({ kind: "running" }, NOW - 5_000)],
    ...metadata,
  });
  return { ...view, lifecycle: "running" };
}

function unseen(
  threadId: string,
  rootKey: string,
  metadata: Partial<AgentThread> = {},
  status: AgentTurnStatus = { kind: "exited", exitCode: 0 },
): AgentThreadView {
  return idle(threadId, rootKey, {
    turns: [turn(status, NOW - 60_000)],
    viewedAtEpochMs: null,
    ...metadata,
  });
}

function withSessionAgent(view: AgentThreadView): AgentThreadView {
  return {
    ...view,
    sessionBackground: {
      ownerId: view.thread.owner.ownerId,
      total: 1,
      agents: 1,
      tasks: [],
      sinceEpochMs: NOW - 5_000,
      taskSinceEpochMs: new Map(),
      reply: { kind: "none" },
    },
  };
}

function pendingFor(
  ...threadIds: ReadonlyArray<string>
): ReadonlyMap<string, AgentPendingInteraction> {
  return new Map(threadIds.map((threadId) => [threadId, "approval"]));
}

function signals(
  views: ReadonlyArray<AgentThreadView>,
  pending: ReadonlyMap<string, AgentPendingInteraction> = NO_PENDING,
  entries: ReadonlyArray<AgentRailScopeEntry> = ENTRIES,
): ReadonlyArray<readonly [string, string, string]> {
  return [...agentRailProjectSignals(views, entries, pending, NOW)].map(
    ([projectRootKey, signal]) => [projectRootKey, signal.tone, signal.label] as const,
  );
}

function railRowCounts(
  views: ReadonlyArray<AgentThreadView>,
  pending: ReadonlyMap<string, AgentPendingInteraction>,
  workingSection: AgentRailWorkingSection,
  tone: AgentRowStatusTone,
): ReadonlyArray<readonly [string, number]> {
  const statusOf = agentRailStatusLookup(pending);
  const sections = agentRailWorkingSections(
    agentRailSections(agentRailOwnedViews(views, ENTRIES), NOW),
    statusOf,
    workingSection,
  );
  const rows = [
    ...sections.pinned,
    ...sections.active,
    ...sections.working,
    ...(sections.snoozed ?? []),
    ...(sections.settled ?? []),
  ];
  const owners = agentRailOwnerIndex(ENTRIES);
  const counts = new Map<string, number>();
  for (const view of rows) {
    if (agentRowStatusTone(statusOf(view)) !== tone) continue;
    const key = owners.get(view.thread.owner.rootKey)?.projectRootKey ?? "";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].sort(([left], [right]) => left.localeCompare(right));
}

describe("agent rail project signals", () => {
  it("ranks waiting for you above working above unread, per project", () => {
    const views = [
      busy("app-asks", APP),
      busy("app-busy-1", APP),
      busy("app-busy-2", APP),
      unseen("app-done", APP),
      busy("api-busy", API),
      unseen("api-done-1", API),
      unseen("api-done-2", API),
      unseen("docs-done", DOCS),
    ];

    expect(signals(views, pendingFor("app-asks"))).toEqual([
      [APP, "attention", "1 thread waiting for you"],
      [API, "working", "1 thread working"],
      [DOCS, "unread", "1 thread unread"],
    ]);
  });

  it("counts every thread of the winning tone and pluralizes the label", () => {
    const views = [
      busy("app-asks-1", APP),
      busy("app-asks-2", APP),
      busy("api-busy-1", API),
      busy("api-busy-2", API),
      busy("api-busy-3", API),
      unseen("docs-done-1", DOCS),
      unseen("docs-done-2", DOCS),
    ];

    expect(signals(views, pendingFor("app-asks-1", "app-asks-2"))).toEqual([
      [APP, "attention", "2 threads waiting for you"],
      [API, "working", "3 threads working"],
      [DOCS, "unread", "2 threads unread"],
    ]);
  });

  it("groups member project roots under the entry that owns them", () => {
    const views = [busy("api-busy", API), busy("remote-busy", REMOTE_API)];

    expect(signals(views)).toEqual([[API, "working", "2 threads working"]]);
  });

  it("leaves out projects with nothing to report and threads no entry owns", () => {
    const views = [
      idle("app-idle", APP),
      unseen("app-seen", APP, { viewedAtEpochMs: NOW }),
      busy("stray-busy", "/workspace/removed"),
      unseen("docs-done", DOCS),
    ];

    const result = agentRailProjectSignals(views, ENTRIES, NO_PENDING, NOW);

    expect([...result.keys()]).toEqual([DOCS]);
    expect(agentRailProjectSignals([], ENTRIES, NO_PENDING, NOW).size).toBe(0);
    expect(agentRailProjectSignals(views, [], NO_PENDING, NOW).size).toBe(0);
  });

  it("never counts archived threads", () => {
    const archivedBusy = busy("app-archived-busy", APP, { archived: true });
    const views: ReadonlyArray<AgentThreadView> = [
      { ...archivedBusy, lifecycle: "archived" },
      { ...busy("app-archived-asks", APP, { archived: true }), lifecycle: "archived" },
      { ...unseen("app-archived-done", APP, { archived: true }), unread: true },
      withSessionAgent(idle("app-archived-session", APP, { archived: true })),
    ];

    expect(signals(views, pendingFor("app-archived-asks"))).toEqual([]);
  });

  it("counts pinned threads in every tone", () => {
    expect(signals([busy("app-pin", APP, { pinned: true })])).toEqual([
      [APP, "working", "1 thread working"],
    ]);
    expect(signals([busy("app-pin", APP, { pinned: true })], pendingFor("app-pin"))).toEqual([
      [APP, "attention", "1 thread waiting for you"],
    ]);
    expect(signals([unseen("app-pin", APP, { pinned: true })])).toEqual([
      [APP, "unread", "1 thread unread"],
    ]);
  });

  it("drops unread for snoozed and settled threads but keeps an expired snooze", () => {
    const views = [
      unseen("app-snoozed", APP, { snoozedUntil: NOW + 60_000 }),
      unseen("app-settled", APP, { settledAt: NOW - 1_000 }),
      unseen("api-woke", API, { snoozedUntil: NOW }),
    ];

    expect(signals(views)).toEqual([[API, "unread", "1 thread unread"]]);
  });

  it("keeps waiting and working for snoozed and settled threads", () => {
    const views = [
      busy("app-snoozed-asks", APP, { snoozedUntil: NOW + 60_000 }),
      busy("api-snoozed-busy", API, { snoozedUntil: NOW + 60_000 }),
      withSessionAgent(idle("docs-settled-session", DOCS, { settledAt: NOW - 1_000 })),
    ];

    expect(signals(views, pendingFor("app-snoozed-asks"))).toEqual([
      [APP, "attention", "1 thread waiting for you"],
      [API, "working", "1 thread working"],
      [DOCS, "working", "1 thread working"],
    ]);
  });

  it("counts session background work without a running turn, and a thread only once", () => {
    const views = [
      withSessionAgent(idle("app-session", APP)),
      withSessionAgent(busy("app-busy-session", APP)),
      withSessionAgent(unseen("app-session-done", APP)),
    ];

    expect(views.map((view) => view.lifecycle)).toEqual(["settled", "running", "settled"]);
    expect(signals(views)).toEqual([[APP, "working", "3 threads working"]]);
  });

  it("counts a thread as waiting only while its row shows it waiting", () => {
    const views = [unseen("app-done", APP), idle("api-idle", API)];

    expect(signals(views, pendingFor("app-done", "api-idle"))).toEqual([
      [APP, "unread", "1 thread unread"],
    ]);
  });

  it("counts an unseen failed or stopped run as unread", () => {
    const views = [
      unseen("app-failed", APP, {}, { kind: "failed", message: "boom" }),
      unseen("app-stopped", APP, {}, { kind: "stopped" }),
    ];

    expect(signals(views)).toEqual([[APP, "unread", "2 threads unread"]]);
  });

  it("matches the rows the rail shows as working or waiting with the Working section on and off", () => {
    const views = [
      busy("app-pin", APP, { pinned: true }),
      busy("app-busy", APP),
      withSessionAgent(idle("app-session", APP)),
      unseen("app-done", APP),
      busy("api-asks", API),
      busy("api-busy", API),
      busy("remote-asks", REMOTE_API),
      withSessionAgent(idle("docs-snoozed-session", DOCS, { snoozedUntil: NOW + 60_000 })),
      busy("docs-archived", DOCS, { archived: true }),
    ];
    const pending = pendingFor("api-asks", "remote-asks");

    const result = signals(views, pending);

    expect(result).toEqual([
      [APP, "working", "3 threads working"],
      [API, "attention", "2 threads waiting for you"],
      [DOCS, "working", "1 thread working"],
    ]);
    for (const workingSection of ["off", "on"] as const) {
      expect(railRowCounts(views, pending, workingSection, "warn"), workingSection).toEqual([
        [API, 2],
      ]);
      expect(railRowCounts(views, pending, workingSection, "work"), workingSection).toEqual([
        [API, 1],
        [APP, 3],
        [DOCS, 1],
      ]);
    }
  });
});
