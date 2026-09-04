import { describe, expect, it } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import { agentThreadAttention, agentThreadUnread } from "../../domain/agentThread";
import type { AgentThread, AgentTurnStatus } from "../../domain/agentThread";
import type { AgentProjectGroup } from "./agentModePresentation";
import {
  ARCHIVED_PAGE_COUNT,
  agentCompactTimeLabel,
  agentJumpSlots,
  agentRailEmptyState,
  agentRailNewThreadTarget,
  agentRailProjectLabels,
  agentRailRowProjectScope,
  agentRowProjectLabel,
  agentExternalOriginNote,
  agentExternalSessionRowTitle,
  agentExternalSessionsStatusNote,
  agentProjectClosable,
  agentProjectCloseLabel,
  agentProjectMenuEntries,
  agentProjectMenuTarget,
  agentProjectRepositoryCountLabel,
  agentRailDefaultScopeEntry,
  agentRailDetachedThreadCount,
  agentRailNeighbourScopeEntry,
  agentRailScopeEntries,
  agentRailScopeEntryFor,
  agentRailScopeFromEntry,
  agentRailScopeLabel,
  agentRailScopeOrder,
  agentRailScopeState,
  agentRailSections,
  agentRailViews,
  agentRowClassName,
  agentRowRecedes,
  agentRowStatus,
  agentRowStatusLabel,
  agentSessionTurnCountLabel,
  agentThreadImportedBadgeLabel,
  agentThreadMenuEntries,
  agentWorkingDurationLabel,
  sameAgentRailScopeOrder,
  type AgentRailScopeEntry,
} from "./agentSidebarPresentation";

const ROOT = "/workspace/app";
const OTHER = "/workspace/api";
const NOW = 1_700_000_600_000;
const ROOT_SCOPE = { projectRootKey: ROOT, repositoryRoot: ROOT } as const;

describe("agent row status", () => {
  it("maps a running turn to working with its start time", () => {
    expect(agentRowStatus(view({ status: { kind: "running" } }))).toEqual({
      kind: "working",
      startedAtEpochMs: NOW - 10 * 60_000,
    });
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

    expect(agentRowRecedes(idle, agentRowStatus(idle), false)).toBe(true);
    expect(agentRowRecedes(working, agentRowStatus(working), false)).toBe(true);
    expect(agentRowRecedes(idle, agentRowStatus(idle), true)).toBe(false);
    expect(agentRowRecedes(unread, agentRowStatus(unread), false)).toBe(false);
    expect(agentRowRecedes(idle, { kind: "failed" }, false)).toBe(false);
  });

  it("builds the row class list from the variant and states", () => {
    expect(
      agentRowClassName("card", true, false, { kind: "working", startedAtEpochMs: 0 }, true),
    ).toBe("agent-row agent-row--card agent-row--on agent-row--inflight agent-row--unread");
    expect(agentRowClassName("slim", false, true, { kind: "none" }, false)).toBe(
      "agent-row agent-row--slim agent-row--recede",
    );
  });
});

describe("agent rail sections", () => {
  it("orders pinned, active and archived by recency and pages the archive", () => {
    const views = [
      view({ threadId: "old", updatedAtEpochMs: NOW - 5000 }),
      view({ threadId: "pin", pinned: true, updatedAtEpochMs: NOW - 9000 }),
      view({ threadId: "new", updatedAtEpochMs: NOW - 1000 }),
      ...Array.from({ length: ARCHIVED_PAGE_COUNT + 3 }, (_, index) =>
        view({ threadId: `arc-${index}`, archived: true, updatedAtEpochMs: NOW - index }),
      ),
    ];

    const collapsed = agentRailSections(views, ROOT_SCOPE, false, ARCHIVED_PAGE_COUNT);
    expect(ids(collapsed.pinned)).toEqual(["pin"]);
    expect(ids(collapsed.active)).toEqual(["new", "old"]);
    expect(collapsed.archived).toEqual([]);
    expect(collapsed.hiddenArchivedCount).toBe(ARCHIVED_PAGE_COUNT + 3);

    const expanded = agentRailSections(views, ROOT_SCOPE, true, ARCHIVED_PAGE_COUNT);
    expect(expanded.archived).toHaveLength(ARCHIVED_PAGE_COUNT);
    expect(expanded.archived[0]?.thread.threadId).toBe("arc-0");
    expect(expanded.hiddenArchivedCount).toBe(3);
  });

  it("scopes the sections to one repository", () => {
    const views = [view({ threadId: "a" }), view({ threadId: "b", repositoryRoot: OTHER })];
    const scoped = agentRailSections(
      views,
      { projectRootKey: OTHER, repositoryRoot: OTHER },
      false,
      0,
    );

    expect(ids(scoped.active)).toEqual(["b"]);
  });

  it("assigns jump slots to the first nine visible cards only when more than one exists", () => {
    const many = Array.from({ length: 12 }, (_, index) => view({ threadId: `t-${index}` }));
    const slots = agentJumpSlots(agentRailSections(many, ROOT_SCOPE, false, 0));

    expect(slots.size).toBe(9);
    expect(slots.get("t-0")).toBe(1);
    expect(agentJumpSlots(agentRailSections([view({})], ROOT_SCOPE, false, 0)).size).toBe(0);
  });

  it("flattens groups and labels projects only when several exist", () => {
    const groups = [group(ROOT, "app", [view({ threadId: "a" })]), group(OTHER, "api", [])];

    expect(ids(agentRailViews(groups))).toEqual(["a"]);
    expect(agentRailProjectLabels(groups).get(ROOT)).toBe("app");
    const multi = { ...groups[0], singleRepo: false } as AgentProjectGroup;
    expect(agentRailProjectLabels([multi]).get(ROOT)).toBe("app / app");
  });

  it("hides the row project label only for the single repository of the scoped project", () => {
    const groups = [group(ROOT, "app", []), group(OTHER, "api", [])];
    const scope = agentRailRowProjectScope(groups, ROOT_SCOPE);

    expect(scope).toEqual({ repositoryRoot: ROOT, singleRepo: true });
    expect(agentRowProjectLabel("app", ROOT, scope)).toBeNull();
    expect(agentRowProjectLabel("app / api", `${ROOT}/packages/api`, scope)).toBe("app / api");
  });

  it("keeps the row project label for a nested-checkout project and an unknown scope", () => {
    const multi = { ...group(ROOT, "app", []), singleRepo: false };
    const multiScope = agentRailRowProjectScope([multi], ROOT_SCOPE);

    expect(multiScope).toEqual({ repositoryRoot: ROOT, singleRepo: false });
    expect(agentRowProjectLabel("app / app", ROOT, multiScope)).toBe("app / app");
    expect(agentRailRowProjectScope([], ROOT_SCOPE)).toBeNull();
    expect(agentRailRowProjectScope([multi], null)).toBeNull();
    expect(agentRowProjectLabel("app", ROOT, null)).toBe("app");
  });

  it("describes the empty states truthfully", () => {
    const groups = [group(ROOT, "app", [])];
    const entries = agentRailScopeEntries(groups);
    const sections = agentRailSections([], ROOT_SCOPE, false, 0);

    expect(agentRailEmptyState([], sections, null, entries)).toEqual({
      kind: "noProjects",
    });
    expect(agentRailEmptyState(groups, sections, null, entries)).toEqual({ kind: "noScope" });
    expect(agentRailEmptyState(groups, sections, ROOT_SCOPE, entries)).toEqual({
      kind: "noThreads",
      scopeLabel: "app",
    });
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

  it("surfaces trust and origin state with the matching action", () => {
    const untrusted = projectEntry(
      agentRailScopeEntries([group(ROOT, "app", [], { trust: "untrusted" })]),
    );
    const closed = {
      ...projectEntry(agentRailScopeEntries([group(ROOT, "app", [])])),
      origin: "closed-tab-live-tasks" as const,
    };
    const background = projectEntry(
      agentRailScopeEntries([group(ROOT, "app", [], { origin: "background-tab" })]),
    );

    expect(agentRailScopeState(untrusted)).toEqual({ label: "Untrusted", action: "trust" });
    expect(agentRailScopeState(closed)).toEqual({ label: "Tab closed", action: "release" });
    expect(agentRailScopeState(background)).toEqual({ label: "Background", action: null });
    expect(agentRailScopeState(null)).toBeNull();
  });

  it("offers the project actions that match the project state without a filter entry", () => {
    const trusted = projectEntry(agentRailScopeEntries([group(ROOT, "app", [])]));
    const untrusted = projectEntry(
      agentRailScopeEntries([group(ROOT, "app", [], { trust: "untrusted" })]),
    );
    const closed = { ...trusted, origin: "closed-tab-live-tasks" as const };
    const detached = projectEntry(
      agentRailScopeEntries([group(ROOT, "app", [], { rootPath: null })]),
    );

    expect(agentProjectMenuEntries(trusted).map((entry) => entry.label)).toEqual([
      "Close project",
      "Terminal sessions…",
      "Reveal in Finder",
      "Copy path",
    ]);
    expect(agentProjectMenuEntries(untrusted)[0]).toEqual({
      id: "trust",
      label: "Trust project",
      command: "trust",
      disabled: false,
    });
    expect(agentProjectMenuEntries(closed)[0]?.command).toBe("release");
    expect(agentProjectMenuEntries(detached).map((entry) => entry.command)).toEqual([
      "terminalSessions",
    ]);
    for (const entry of [trusted, untrusted, closed, detached]) {
      expect(agentProjectMenuEntries(entry).map((item) => item.label)).not.toContain(
        "Filter to this project",
      );
    }
  });

  it("marks a project closable only while it owns a live root path", () => {
    const trusted = projectEntry(agentRailScopeEntries([group(ROOT, "app", [])]));
    const closed = { ...trusted, origin: "closed-tab-live-tasks" as const };
    const detached = projectEntry(
      agentRailScopeEntries([group(ROOT, "app", [], { rootPath: null })]),
    );

    expect(agentProjectClosable(trusted)).toBe(true);
    expect(agentProjectClosable(closed)).toBe(false);
    expect(agentProjectClosable(detached)).toBe(false);
    expect(agentProjectCloseLabel(trusted)).toBe("Close project app");
  });

  it("offers terminal sessions only for a trusted project with a live owner", () => {
    const trusted = projectEntry(agentRailScopeEntries([group(ROOT, "app", [])]));
    const untrusted = projectEntry(
      agentRailScopeEntries([group(ROOT, "app", [], { trust: "untrusted" })]),
    );
    const closed = { ...trusted, origin: "closed-tab-live-tasks" as const };

    const command = (entry: AgentRailScopeEntry) =>
      agentProjectMenuEntries(entry).find((candidate) => candidate.command === "terminalSessions");

    expect(command(trusted)).toEqual({
      id: "terminal-sessions",
      label: "Terminal sessions…",
      command: "terminalSessions",
      disabled: false,
    });
    expect(command(untrusted)?.disabled).toBe(true);
    expect(command(closed)?.disabled).toBe(true);
    expect(agentProjectMenuTarget(trusted)).toEqual({
      projectRootKey: ROOT,
      repositoryRoot: ROOT,
      rootPath: ROOT,
    });
  });

  it("reports the repository count only for a multi-repository project", () => {
    const single = projectEntry(agentRailScopeEntries([group(ROOT, "app", [])]));

    expect(agentProjectRepositoryCountLabel(single)).toBeNull();
    expect(agentProjectRepositoryCountLabel({ ...single, repositoryCount: 3 })).toBe("3 repos");
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

  it("lists the context menu in the T3 order and disables archive while running", () => {
    const entries = agentThreadMenuEntries({
      branch: "main",
      pinned: false,
      archived: false,
      running: true,
    });
    const labels = entries.map((entry) => (entry.kind === "item" ? entry.label : "-"));

    expect(labels).toEqual([
      "New thread on main",
      "Pin",
      "-",
      "Rename",
      "Mark unread",
      "-",
      "Copy path",
      "Copy branch",
      "Copy thread ID",
      "-",
      "Stop",
      "Archive",
      "Delete",
    ]);
    const archive = entries.find((entry) => entry.kind === "item" && entry.label === "Archive");
    expect(archive?.kind === "item" && archive.disabled).toBe(true);
    expect(
      agentThreadMenuEntries({ branch: null, pinned: true, archived: true, running: false }).map(
        (entry) => (entry.kind === "item" ? entry.label : "-"),
      ),
    ).not.toContain("Archive");
    expect(
      agentThreadMenuEntries({ branch: null, pinned: false, archived: false, running: false }).map(
        (entry) => (entry.kind === "item" ? entry.label : "-"),
      ),
    ).not.toContain("Stop");
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
        events: [],
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

function projectEntry(entries: ReadonlyArray<AgentRailScopeEntry>): AgentRailScopeEntry {
  const entry = entries[0];
  expect(entry).toBeDefined();
  return entry as AgentRailScopeEntry;
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
