import { describe, expect, it } from "vitest";
import type { AgentTaskChangeSummary, AgentThreadView } from "../../application/agentThreadPorts";
import { agentThreadAttention, agentThreadUnread } from "../../domain/agentThread";
import type { AgentThread, AgentTurnEvent, AgentTurnStatus } from "../../domain/agentThread";
import {
  projectAgentBackgroundState,
  resolveAgentBackgroundActivity,
} from "../../domain/agentBackgroundActivity";
import { NO_AGENT_TURN_LOG_EVIDENCE } from "../../domain/agentTurnContentLoss";
import type { AgentProjectGroup } from "./agentModePresentation";
import {
  agentCompactTimeLabel,
  agentJumpSlots,
  agentRailEmptyState,
  agentProjectTerminalSessionsTarget,
  agentRailNewThreadTarget,
  agentRailProjectLabels,
  agentRowProjectLabel,
  agentThreadRowModel,
  agentExternalOriginNote,
  agentExternalSessionRowTitle,
  agentExternalSessionsStatusNote,
  agentRailDefaultScopeEntry,
  agentRailDetachedThreadCount,
  agentRailNeighbourScopeEntry,
  agentRailScopeEntries,
  agentRailScopeEntryFor,
  agentRailScopeFromEntry,
  agentRailScopeLabel,
  agentRailScopeOrder,
  agentRailSections,
  agentRailViews,
  agentRowClassName,
  agentRowRecedes,
  agentSessionTurnCountLabel,
  agentThreadImportedBadgeLabel,
  agentViewCanMarkUnread,
  agentWorkingDurationLabel,
  sameAgentRailScopeOrder,
} from "./agentSidebarPresentation";
import { agentRowStatus, agentRowStatusLabel } from "./agentThreadRowStatus";
import {
  agentProjectClosable,
  agentProjectMenuEntries,
  agentProjectRepositoryCountLabel,
  agentRailScopeState,
} from "./agentProjectMenuPresentation";

const ROOT = "/workspace/app";
const OTHER = "/workspace/api";
const NOW = 1_700_000_600_000;
const ROOT_SCOPE = { projectRootKey: ROOT, repositoryRoot: ROOT } as const;

describe("agent row status", () => {
  it("uses the quiescence verdict the row hands it instead of re-deciding inferred idle", () => {
    const spawn: AgentTurnEvent = {
      kind: "backgroundTask",
      taskId: "agent-1",
      taskType: "agent",
      status: "starting",
    };
    const answer: AgentTurnEvent = {
      kind: "assistantText",
      text: "A reviewer runs in the background.",
    };
    const running = view({ events: [spawn, answer] });
    const state = projectAgentBackgroundState([spawn, answer], true);

    expect(agentRowStatusLabel(agentRowStatus(running))).toBe("Working");
    expect(
      agentRowStatusLabel(
        agentRowStatus(
          running,
          NO_AGENT_TURN_LOG_EVIDENCE,
          resolveAgentBackgroundActivity(state, "pending"),
        ),
      ),
    ).toBe("Working");
    expect(
      agentRowStatusLabel(
        agentRowStatus(
          running,
          NO_AGENT_TURN_LOG_EVIDENCE,
          resolveAgentBackgroundActivity(state, "settled"),
        ),
      ),
    ).toBe("1 agent running");
    expect(agentRowStatusLabel(agentRowStatus(running, NO_AGENT_TURN_LOG_EVIDENCE, null))).toBe(
      "Working",
    );
  });

  it("maps a running turn to working with its start time", () => {
    expect(agentRowStatus(view({ status: { kind: "running" } }))).toEqual({
      kind: "working",
      startedAtEpochMs: NOW - 10 * 60_000,
    });
  });

  it("stops forcing a window truncated running turn into background work", () => {
    const result: AgentTurnEvent = {
      kind: "result",
      text: "Watching pipeline",
      isError: false,
      usage: null,
    };
    const base = view({ events: [result] });
    const truncated: AgentThreadView = {
      ...base,
      thread: {
        ...base.thread,
        turns: base.thread.turns.map((entry) => ({ ...entry, eventsTruncated: true })),
      },
    };

    expect(agentRowStatus(truncated)).toMatchObject({ kind: "working", activity: "background" });
    expect(
      agentRowStatus(truncated, () => ({
        loss: { kind: "none" },
        sealed: false,
        live: true,
        hydration: "notAttempted",
      })),
    ).toEqual({ kind: "working", startedAtEpochMs: NOW - 10 * 60_000 });
    expect(
      agentRowStatus(truncated, () => ({
        loss: { kind: "supervisorGap" },
        sealed: false,
        live: true,
        hydration: "notAttempted",
      })),
    ).toMatchObject({ kind: "working", activity: "background" });
  });

  it("shows provider-reported background work only after the foreground result", () => {
    const start: AgentTurnEvent = {
      kind: "backgroundTask",
      taskId: "task-1",
      taskType: "monitor",
      status: "starting",
    };
    const result: AgentTurnEvent = {
      kind: "result",
      text: "Watching pipeline",
      isError: false,
      usage: null,
    };
    expect(agentRowStatusLabel(agentRowStatus(view({ events: [start] })))).toBe("Working");
    const monitoring = agentRowStatus(view({ events: [start, result] }));
    expect(monitoring).toMatchObject({ kind: "working", activity: "monitoring" });
    expect(agentRowStatusLabel(monitoring)).toBe("Monitoring");
    expect(
      agentRowStatusLabel(
        agentRowStatus(view({ events: [{ ...start, taskType: "agent" }, result] })),
      ),
    ).toBe("1 agent running");
    expect(agentRowStatusLabel(agentRowStatus(view({ events: [result] })))).toBe("Working");
    expect(
      agentRowStatusLabel(
        agentRowStatus(view({ events: [start, result, { ...start, status: "completed" }] })),
      ),
    ).toBe("Working");
    expect(agentRowStatus(view({ events: [start, result], status: { kind: "stopped" } }))).toEqual({
      kind: "stopped",
    });
    const codex = view({ events: [start, result] });
    expect(
      agentRowStatusLabel(
        agentRowStatus({
          ...codex,
          thread: { ...codex.thread, provider: { kind: "codex", sessionId: null } },
        }),
      ),
    ).toBe("Working");
  });

  it("maps failed and non-zero exits to failed, stops to stopped", () => {
    expect(agentRowStatus(view({ status: { kind: "failed", message: "boom" } })).kind).toBe(
      "failed",
    );
    expect(agentRowStatus(view({ status: { kind: "exited", exitCode: 2 } })).kind).toBe("failed");
    expect(agentRowStatus(view({ status: { kind: "stopped" } })).kind).toBe("stopped");
    expect(agentRowStatus(view({ status: { kind: "interrupted" } })).kind).toBe("stopped");
  });

  it("shows done only for an unread settled thread and nothing once read", () => {
    const unread = view({ status: { kind: "exited", exitCode: 0 }, endedAtEpochMs: NOW });
    const read = view({
      status: { kind: "exited", exitCode: 0 },
      endedAtEpochMs: NOW - 1,
      viewedAtEpochMs: NOW,
    });

    expect(agentRowStatus(unread).kind).toBe("done");
    expect(agentRowStatus(read).kind).toBe("none");
    expect(agentRowStatusLabel({ kind: "done" })).toBe("Done");
    expect(agentRowStatusLabel({ kind: "none" })).toBeNull();
  });

  it("recedes read idle and working rows but never the active or unread ones", () => {
    const idle = view({
      status: { kind: "exited", exitCode: 0 },
      endedAtEpochMs: NOW - 1,
      viewedAtEpochMs: NOW,
    });
    const working = view({ status: { kind: "running" } });
    const unread = view({ status: { kind: "exited", exitCode: 0 }, endedAtEpochMs: NOW });

    expect(agentRowRecedes(idle, false)).toBe(true);
    expect(agentRowRecedes(working, false)).toBe(true);
    expect(agentRowRecedes(idle, true)).toBe(false);
    expect(agentRowRecedes(unread, false)).toBe(false);
  });

  it.each<AgentTurnStatus>([
    { kind: "failed", message: "boom" },
    { kind: "exited", exitCode: 2 },
    { kind: "stopped" },
    { kind: "interrupted" },
  ])("recedes a read $kind thread while retaining its status", (status) => {
    const unread = view({ status, endedAtEpochMs: NOW - 1 });
    const read = view({ status, endedAtEpochMs: NOW - 1, viewedAtEpochMs: NOW });
    const statusBeforeReading = agentThreadRowModel(unread, false).status;

    expect(agentThreadRowModel(unread, false).recede).toBe(false);
    expect(agentThreadRowModel(read, true).recede).toBe(false);
    expect(agentThreadRowModel(read, false).recede).toBe(true);
    expect(agentThreadRowModel(read, false).status).toEqual(statusBeforeReading);
    expect(agentRowStatusLabel(statusBeforeReading)).toBe(
      status.kind === "failed" || status.kind === "exited" ? "Failed" : "Stopped",
    );
  });

  it("builds the row class list from the row states", () => {
    expect(
      agentRowClassName({
        on: true,
        marked: false,
        recede: false,
        status: { kind: "working", startedAtEpochMs: 0 },
        unread: true,
      }),
    ).toBe("cv-card-row is-current is-live is-unread");
    expect(
      agentRowClassName({
        on: false,
        marked: false,
        recede: false,
        status: { kind: "approval" },
        unread: false,
      }),
    ).toBe("cv-card-row is-live");
  });

  it("fades and recedes a working row only while it is neither open nor marked", () => {
    const working = { kind: "working", startedAtEpochMs: 0 } as const;
    const agents = { kind: "agents", count: 2, lead: "working", startedAtEpochMs: 0 } as const;
    const base = { on: false, marked: false, recede: false, unread: true } as const;

    expect(agentRowClassName({ ...base, status: working })).toBe(
      "cv-card-row is-recede is-fade is-live is-unread",
    );
    expect(agentRowClassName({ ...base, status: agents })).toBe(
      "cv-card-row is-recede is-fade is-live is-unread",
    );
    expect(agentRowClassName({ ...base, on: true, status: working })).toBe(
      "cv-card-row is-current is-live is-unread",
    );
    expect(agentRowClassName({ ...base, marked: true, status: working })).toBe(
      "cv-card-row is-marked is-live is-unread",
    );
    for (const status of [
      { kind: "approval" },
      { kind: "input" },
      { kind: "failed" },
      { kind: "done" },
      { kind: "none" },
    ] as const)
      expect(agentRowClassName({ ...base, status }), status.kind).not.toContain("is-fade");
  });

  it("emphasises an unseen completion until the thread is opened", () => {
    expect(
      agentRowClassName({
        on: false,
        marked: false,
        recede: false,
        status: { kind: "done" },
        unread: true,
      }),
    ).toBe("cv-card-row is-unread is-unread-done");
    expect(
      agentRowClassName({
        on: false,
        marked: false,
        recede: true,
        status: { kind: "none" },
        unread: false,
      }),
    ).toBe("cv-card-row is-recede");
  });

  it("keeps the open row marked when it is part of the selection", () => {
    expect(
      agentRowClassName({
        on: true,
        marked: true,
        recede: false,
        status: { kind: "none" },
        unread: false,
      }),
    ).toBe("cv-card-row is-current is-marked");
  });

  it("marks a multi-selected row after the open state", () => {
    expect(
      agentRowClassName({
        on: false,
        marked: true,
        recede: false,
        status: { kind: "none" },
        unread: false,
      }),
    ).toBe("cv-card-row is-marked");
  });
});

describe("mark unread availability", () => {
  const remote = (base: AgentThreadView): AgentThreadView => ({
    ...base,
    execution: {
      kind: "remote",
      pendingMessages: false,
      taskSteering: false,
      interactiveQuestions: false,
      serverId: "server",
      runnerId: "runner",
      projectId: "project",
      conversationId: base.thread.threadId,
      latestTaskId: base.thread.threadId,
      resume: null,
    },
  });

  it("follows the local unread finish time and the remote terminal turn", () => {
    const finished = view({ status: { kind: "exited", exitCode: 0 }, endedAtEpochMs: NOW });
    const noEnd = view({ status: { kind: "exited", exitCode: 0 } });
    expect(agentViewCanMarkUnread(finished)).toBe(true);
    expect(agentViewCanMarkUnread(noEnd)).toBe(false);
    expect(agentViewCanMarkUnread(remote(noEnd))).toBe(true);
    expect(agentViewCanMarkUnread(remote(view({ status: { kind: "running" } })))).toBe(false);
    expect(
      agentViewCanMarkUnread(remote(view({ archived: true, status: { kind: "stopped" } }))),
    ).toBe(false);
  });
});

describe("agent rail sections", () => {
  it("keeps archived precedence, wakes snoozed threads at the deadline and retains manual order", () => {
    const decorate = (id: string, metadata: Partial<AgentThread>) => {
      const original = view({ threadId: id });
      return { ...original, thread: { ...original.thread, ...metadata } };
    };
    const views = [
      decorate("snoozed", { pinned: true, snoozedUntil: NOW + 1000 }),
      decorate("settled", { pinned: true, settledAt: NOW, snoozedUntil: NOW + 1000 }),
      decorate("archived", { archived: true, settledAt: NOW }),
      decorate("first", { sortOrder: 1, updatedAtEpochMs: NOW - 10000 }),
      decorate("second", { sortOrder: 2, updatedAtEpochMs: NOW }),
    ];
    const sections = agentRailSections(views, NOW);
    expect(ids(sections.snoozed ?? [])).toEqual(["snoozed"]);
    expect(ids(sections.settled ?? [])).toEqual(["settled"]);
    expect(ids(sections.active)).toEqual(["first", "second"]);
    expect(sections.pinned).toEqual([]);
    expect(ids(agentRailSections(views, NOW + 1000).pinned)).toEqual(["snoozed"]);
  });

  it("orders pinned and active by recency and leaves archived threads out of every section", () => {
    const views = [
      view({ threadId: "old", updatedAtEpochMs: NOW - 5000 }),
      view({ threadId: "pin", pinned: true, updatedAtEpochMs: NOW - 9000 }),
      view({ threadId: "new", updatedAtEpochMs: NOW - 1000 }),
      ...Array.from({ length: 23 }, (_, index) =>
        view({ threadId: `arc-${index}`, archived: true, updatedAtEpochMs: NOW - index }),
      ),
    ];

    const sections = agentRailSections(views);
    expect(ids(sections.pinned)).toEqual(["pin"]);
    expect(ids(sections.active)).toEqual(["new", "old"]);
    expect(sections.snoozed).toEqual([]);
    expect(sections.settled).toEqual([]);
  });

  it("assigns jump slots to the first nine visible cards only when more than one exists", () => {
    const many = Array.from({ length: 12 }, (_, index) => `t-${index}`);
    const slots = agentJumpSlots(many);

    expect(slots.size).toBe(9);
    expect(slots.get("t-0")).toBe(1);
    expect(slots.get("t-8")).toBe(9);
    expect(agentJumpSlots(["only"]).size).toBe(0);
  });

  it("flattens groups and labels projects only when several exist", () => {
    const groups = [group(ROOT, "app", [view({ threadId: "a" })]), group(OTHER, "api", [])];

    expect(ids(agentRailViews(groups))).toEqual(["a"]);
    expect(agentRailProjectLabels(groups).get(ROOT)).toBe("app");
    const multi = { ...groups[0], singleRepo: false } as AgentProjectGroup;
    expect(agentRailProjectLabels([multi]).get(ROOT)).toBe("app / app");
  });

  it("always resolves a row project label, falling back to the repository label", () => {
    const groups = [group(ROOT, "app", []), group(OTHER, "api", [])];
    const labels = agentRailProjectLabels(groups);

    expect(agentRowProjectLabel(labels, view({}))).toBe("app");
    expect(agentRowProjectLabel(new Map(), view({}))).toBe("app");
    const multi = { ...group(ROOT, "app", []), singleRepo: false };
    expect(agentRowProjectLabel(agentRailProjectLabels([multi]), view({}))).toBe("app / app");
  });

  it("builds the same card row model for an archived thread, with no slim variant", () => {
    const model = agentThreadRowModel(view({ threadId: "arc-1", archived: true }), false);

    expect(Object.keys(model)).not.toContain("variant");
    expect(model.title).toBe("Thread arc-1");
  });

  it("builds a row model with the project line and file count", () => {
    const model = agentThreadRowModel(view({ threadId: "agt-1" }), false);

    expect(model.project).toBe("app");
    expect(agentThreadRowModel(view({}), false, "app / api").project).toBe("app / api");
    expect(model.title).toBe("Thread agt-1");
    expect(model.filesLabel).toBeNull();
    expect(model.provider).toBe("claudeCode");
    expect(model.status.kind).toBe("working");
    expect(model.recede).toBe(true);
    expect(agentThreadRowModel(view({ threadId: "agt-1" }), true).recede).toBe(false);
  });

  it("labels the changed file count once the summary has settled", () => {
    const base = view({});
    const one: AgentThreadView = { ...base, changeSummary: summary(false, ["a.ts"]) };
    const many: AgentThreadView = { ...base, changeSummary: summary(false, ["a.ts", "b.ts"]) };
    const pending: AgentThreadView = { ...base, changeSummary: summary(true, []) };

    expect(agentThreadRowModel(one, false).filesLabel).toBe("1 file");
    expect(agentThreadRowModel(many, false).filesLabel).toBe("2 files");
    expect(agentThreadRowModel(pending, false).filesLabel).toBeNull();
  });

  it("describes the empty states truthfully", () => {
    const groups = [group(ROOT, "app", [])];
    const entries = agentRailScopeEntries(groups);
    const sections = agentRailSections([]);

    expect(sections.active).toEqual([]);
    expect(agentRailEmptyState([])).toEqual({ kind: "noProjects" });
    expect(agentRailEmptyState(entries)).toBeNull();
  });
});

describe("agent rail scope", () => {
  it("lists one entry per open project and labels the scope from it", () => {
    const entries = agentRailScopeEntries([group(ROOT, "app", []), group(OTHER, "api", [])]);

    expect(entries.map((entry) => entry.label)).toEqual(["app", "api"]);
    expect(entries[0]?.value).toBe(ROOT);
    expect(agentRailScopeLabel(ROOT_SCOPE, entries)).toBe("app");
    expect(agentRailScopeLabel(null, entries)).toBe("No project");
    expect(agentRailScopeLabel({ projectRootKey: "/gone", repositoryRoot: "/gone" }, entries)).toBe(
      "No project",
    );
  });

  it("resolves the default scope from the selected thread, then the first project", () => {
    const entries = agentRailScopeEntries([group(ROOT, "app", []), group(OTHER, "api", [])]);

    expect(agentRailDefaultScopeEntry(entries, OTHER)?.projectRootKey).toBe(OTHER);
    expect(agentRailDefaultScopeEntry(entries, "/gone")?.projectRootKey).toBe(ROOT);
    expect(agentRailDefaultScopeEntry(entries, null)?.projectRootKey).toBe(ROOT);
    expect(agentRailDefaultScopeEntry([], null)).toBeNull();
    expect(agentRailScopeEntryFor(entries, "/gone")).toBeNull();
    expect(agentRailScopeFromEntry(entries[0]!)).toEqual(ROOT_SCOPE);
  });

  it("replaces a closed scope with the next project, falling back to the previous one", () => {
    const third = "/workspace/web";
    const previous = agentRailScopeOrder(
      agentRailScopeEntries([
        group(ROOT, "app", []),
        group(OTHER, "api", []),
        group(third, "web", []),
      ]),
    );
    const withoutMiddle = agentRailScopeEntries([group(ROOT, "app", []), group(third, "web", [])]);
    const onlyFirst = agentRailScopeEntries([group(ROOT, "app", [])]);

    expect(previous).toEqual([ROOT, OTHER, third]);
    expect(agentRailNeighbourScopeEntry(previous, withoutMiddle, OTHER)?.projectRootKey).toBe(
      third,
    );
    expect(agentRailNeighbourScopeEntry(previous, onlyFirst, third)?.projectRootKey).toBe(ROOT);
    expect(agentRailNeighbourScopeEntry(previous, [], ROOT)).toBeNull();
    expect(agentRailNeighbourScopeEntry(previous, withoutMiddle, "/gone")).toBeNull();
    expect(sameAgentRailScopeOrder(previous, [ROOT, OTHER, third])).toBe(true);
    expect(sameAgentRailScopeOrder(previous, [ROOT, third, OTHER])).toBe(false);
    expect(sameAgentRailScopeOrder(previous, [ROOT])).toBe(false);
  });

  it("lists each open editor project once instead of expanding its repositories", () => {
    const open = group(ROOT, "Developer", []);
    const entries = agentRailScopeEntries([
      {
        ...open,
        singleRepo: false,
        repos: [
          ...open.repos,
          {
            ...open.repos[0]!,
            repositoryRoot: `${ROOT}/packages/api`,
            label: "api",
          },
        ],
      },
      group(OTHER, "Closed", [], { origin: "closed-tab-live-tasks" }),
    ]);

    expect(entries.map((entry) => entry.label)).toEqual(["Developer", "Closed"]);
    expect(entries[0]?.repositoryRoot).toBe(ROOT);
    expect(entries[0]?.repositoryCount).toBe(2);
  });

  it("scopes a folder of nested repositories to the folder itself, even without a root repository", () => {
    const folder = group(ROOT, "playablemaker", []);
    const entries = agentRailScopeEntries([
      {
        ...folder,
        singleRepo: false,
        repos: [
          { ...folder.repos[0]!, repositoryRoot: `${ROOT}/pa-ai-be`, label: "pa-ai-be" },
          { ...folder.repos[0]!, repositoryRoot: `${ROOT}/pa-build-be`, label: "pa-build-be" },
        ],
      },
      { ...group(OTHER, "empty", []), repos: [] },
    ]);

    expect(entries.map((entry) => entry.repositoryRoot)).toEqual([ROOT, OTHER]);
    expect(agentRailNewThreadTarget(ROOT_SCOPE, entries)).toEqual(ROOT_SCOPE);
    expect(agentProjectTerminalSessionsTarget(ROOT_SCOPE, entries)).toEqual(ROOT_SCOPE);
    expect(
      agentProjectTerminalSessionsTarget(
        { projectRootKey: ROOT, repositoryRoot: `${ROOT}/pa-ai-be` },
        entries,
      ),
    ).toEqual({ projectRootKey: ROOT, repositoryRoot: `${ROOT}/pa-ai-be` });
    expect(agentProjectRepositoryCountLabel(entries[0]!)).toBe("2 repos");
  });

  it("keeps a draining project in the rail and hides detached threads behind a count", () => {
    const draining = group(OTHER, "api", [view({ threadId: "live" })], {
      origin: "closed-tab-live-tasks",
    });
    const detached: AgentProjectGroup = {
      ...group(ROOT, "Removed projects", [view({})]),
      kind: "detached",
    };
    const entries = agentRailScopeEntries([group(ROOT, "app", []), draining, detached]);
    const drainingEntry = entries[1];

    expect(entries.map((entry) => entry.label)).toEqual(["app", "api"]);
    expect(drainingEntry === undefined ? null : agentRailScopeState(drainingEntry)).toEqual({
      label: "Tab closed",
      action: "release",
    });
    expect(drainingEntry === undefined ? null : agentProjectClosable(drainingEntry)).toBe(false);
    expect(
      drainingEntry === undefined
        ? []
        : agentProjectMenuEntries(drainingEntry).map((item) => item.command),
    ).toEqual(["release", "terminalSessions", "reveal", "copyPath"]);
    expect(agentRailNewThreadTarget({ projectRootKey: OTHER, repositoryRoot: OTHER }, entries)) //
      .toBeNull();
    expect(agentRailDetachedThreadCount([group(ROOT, "app", []), draining, detached])).toBe(1);
    expect(agentRailDetachedThreadCount([group(ROOT, "app", [])])).toBe(0);
  });

  it("targets the scoped repository for a new thread and fails closed otherwise", () => {
    const entries = agentRailScopeEntries([
      group(ROOT, "app", [], { trust: "untrusted" }),
      group(OTHER, "api", []),
    ]);

    expect(agentRailNewThreadTarget({ projectRootKey: OTHER, repositoryRoot: OTHER }, entries)) //
      .toEqual({ projectRootKey: OTHER, repositoryRoot: OTHER });
    expect(agentRailNewThreadTarget(ROOT_SCOPE, entries)).toBeNull();
    expect(agentRailNewThreadTarget(null, entries)).toBeNull();
  });
});

describe("agent rail labels", () => {
  it("formats compact relative times and working durations", () => {
    expect(agentCompactTimeLabel(NOW - 30_000, NOW)).toBe("now");
    expect(agentCompactTimeLabel(NOW - 8 * 60_000, NOW)).toBe("8m");
    expect(agentCompactTimeLabel(NOW - 3 * 3_600_000, NOW)).toBe("3h");
    expect(agentCompactTimeLabel(NOW - 4 * 86_400_000, NOW)).toBe("4d");
    expect(agentCompactTimeLabel(NOW - 15 * 86_400_000, NOW)).toBe("2w");
    expect(agentWorkingDurationLabel(NOW - 12_000, NOW)).toBe("12s");
    expect(agentWorkingDurationLabel(NOW - 3 * 60_000, NOW)).toBe("3m");
    expect(agentWorkingDurationLabel(NOW - 62 * 60_000, NOW)).toBe("1h 2m");
  });
});

function ids(views: ReadonlyArray<AgentThreadView>): ReadonlyArray<string> {
  return views.map((entry) => entry.thread.threadId);
}

function group(
  repositoryRoot: string,
  label: string,
  threads: ReadonlyArray<AgentThreadView>,
  overrides: Partial<Pick<AgentProjectGroup, "origin" | "rootPath" | "trust">> = {},
): AgentProjectGroup {
  return {
    projectRootKey: repositoryRoot,
    kind: "project",
    label,
    rootPath: repositoryRoot,
    trust: "trusted",
    origin: "active-tab",
    singleRepo: true,
    repos: [
      {
        repositoryRoot,
        label,
        repositoryResolved: true,
        threads: threads.filter((entry) => !entry.thread.archived),
        archived: threads.filter((entry) => entry.thread.archived),
        orphans: [],
        liveCount: 0,
      },
    ],
    liveCount: 0,
    ...overrides,
  };
}

interface ViewOptions {
  readonly threadId?: string;
  readonly events?: ReadonlyArray<AgentTurnEvent>;
  readonly status?: AgentTurnStatus;
  readonly pinned?: boolean;
  readonly archived?: boolean;
  readonly updatedAtEpochMs?: number;
  readonly endedAtEpochMs?: number | null;
  readonly viewedAtEpochMs?: number | null;
  readonly repositoryRoot?: string;
}

function view({
  archived = false,
  events = [],
  endedAtEpochMs = null,
  pinned = false,
  repositoryRoot = ROOT,
  status = { kind: "running" },
  threadId = "agt-1",
  updatedAtEpochMs = NOW - 10 * 60_000,
  viewedAtEpochMs = null,
}: ViewOptions): AgentThreadView {
  const thread: AgentThread = {
    threadId,
    owner: { rootKey: repositoryRoot, ownerId: `agent-root:${repositoryRoot}`, repositoryRoot },
    target: { isolation: "worktree", worktreePath: `${repositoryRoot}/.worktrees/${threadId}` },
    provider: { kind: "claudeCode", sessionId: null },
    title: `Thread ${threadId}`,
    pinned,
    archived,
    createdAtEpochMs: NOW - 10 * 60_000,
    updatedAtEpochMs,
    turns: [
      {
        turnId: `${threadId}-t1`,
        prompt: "Do it",
        status,
        startedAtEpochMs: NOW - 10 * 60_000,
        endedAtEpochMs,
        events,
        eventsTruncated: false,
        lastStatusSequence: 0,
        lastOutputSequence: 0,
        launch: null,
        cliVersion: null,
      },
    ],
    turnsTruncated: false,
    viewedAtEpochMs,
    externalOrigin: null,
    integration: null,
  };
  const running = status.kind === "pending" || status.kind === "running";

  return {
    ship: { kind: "idle", status: null, loadingStatus: false },
    editorAvailability: { kind: "available" },
    attention: agentThreadAttention(thread),
    unread: agentThreadUnread(thread),
    thread,
    lifecycle: archived ? "archived" : running ? "running" : "settled",
    repositoryLabel: "app",
    projectOrigin: "active-tab",
    worktreeRemoved: false,
    worktreeMissing: false,
    changeSummary: null,
  };
}

function summary(loading: boolean, paths: ReadonlyArray<string>): AgentTaskChangeSummary {
  return {
    loading,
    error: null,
    files: paths.map((relativePath) => ({
      isStaged: false,
      isUnversioned: false,
      oldPath: null,
      oldRelativePath: null,
      path: `/workspace/app/${relativePath}`,
      relativePath,
      status: "modified" as const,
    })),
    truncated: false,
    removing: false,
    diff: null,
  };
}

describe("terminal session presentation", () => {
  it("labels imported provenance from the persisted external origin", () => {
    expect(agentThreadImportedBadgeLabel(null)).toBeNull();
    expect(agentExternalOriginNote(null)).toBeNull();

    const origin = {
      provider: "codex",
      sessionId: "01a038a1-c2ee-7642-98e4-c94d7a479e0c",
      importedAtEpochMs: NOW,
    } as const;

    expect(agentThreadImportedBadgeLabel(origin)).toBe("Imported");
    expect(agentExternalOriginNote(origin)).toBe(
      "Imported from terminal session 01a038a1-c2ee-7642-98e4-c94d7a479e0c",
    );
  });

  it("marks an inexact turn count with a plus", () => {
    expect(agentSessionTurnCountLabel(1, true)).toBe("1 turn");
    expect(agentSessionTurnCountLabel(6, true)).toBe("6 turns");
    expect(agentSessionTurnCountLabel(6, false)).toBe("6+ turns");
    expect(agentSessionTurnCountLabel(1, false)).toBe("1+ turns");
  });

  it("falls back from title to first prompt line to session id", () => {
    const id = "34fbe185-0000-4000-8000-000000000000";

    expect(
      agentExternalSessionRowTitle({ title: "Fix parser", firstPrompt: "hello", sessionId: id }),
    ).toBe("Fix parser");
    expect(
      agentExternalSessionRowTitle({
        title: "",
        firstPrompt: "  first line \nsecond line",
        sessionId: id,
      }),
    ).toBe("first line");
    expect(agentExternalSessionRowTitle({ title: "", firstPrompt: "", sessionId: id })).toBe(id);
  });

  it("reports skipped and truncated counts truthfully", () => {
    expect(agentExternalSessionsStatusNote(0, false, 10)).toBeNull();
    expect(agentExternalSessionsStatusNote(1, false, 10)).toBe(
      "1 automated or unreadable session hidden",
    );
    expect(agentExternalSessionsStatusNote(12, false, 10)).toBe(
      "12 automated or unreadable sessions hidden",
    );
    expect(agentExternalSessionsStatusNote(12, true, 200)).toBe(
      "12 automated or unreadable sessions hidden · showing the newest 200",
    );
    expect(agentExternalSessionsStatusNote(0, true, 200)).toBe("showing the newest 200");
    expect(agentExternalSessionsStatusNote(0, true, 0)).toBe("session scan limited");
  });
});
