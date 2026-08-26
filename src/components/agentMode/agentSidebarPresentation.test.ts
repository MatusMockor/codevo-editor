import { describe, expect, it } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import { agentThreadAttention, agentThreadUnread } from "../../domain/agentThread";
import type { AgentThread, AgentTurnStatus } from "../../domain/agentThread";
import type { AgentProjectGroup } from "./agentModePresentation";
import {
  ALL_PROJECTS_SCOPE_VALUE,
  ARCHIVED_PAGE_COUNT,
  agentCompactTimeLabel,
  agentJumpSlots,
  agentRailEmptyState,
  agentRailNewThreadTarget,
  agentRailProjectLabels,
  agentProjectMenuEntries,
  agentProjectMenuTarget,
  agentProjectRepositoryCountLabel,
  agentRailScopeEntries,
  agentRailScopeLabel,
  agentRailScopeState,
  agentRailSections,
  agentRailViews,
  agentRowClassName,
  agentRowRecedes,
  agentRowStatus,
  agentRowStatusLabel,
  agentThreadMenuEntries,
  agentWorkingDurationLabel,
  type AgentRailProjectScopeEntry,
  type AgentRailScopeEntry,
} from "./agentSidebarPresentation";

const ROOT = "/workspace/app";
const OTHER = "/workspace/api";
const NOW = 1_700_000_600_000;

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

    const collapsed = agentRailSections(views, { kind: "all" }, false, ARCHIVED_PAGE_COUNT);
    expect(ids(collapsed.pinned)).toEqual(["pin"]);
    expect(ids(collapsed.active)).toEqual(["new", "old"]);
    expect(collapsed.archived).toEqual([]);
    expect(collapsed.hiddenArchivedCount).toBe(ARCHIVED_PAGE_COUNT + 3);

    const expanded = agentRailSections(views, { kind: "all" }, true, ARCHIVED_PAGE_COUNT);
    expect(expanded.archived).toHaveLength(ARCHIVED_PAGE_COUNT);
    expect(expanded.archived[0]?.thread.threadId).toBe("arc-0");
    expect(expanded.hiddenArchivedCount).toBe(3);
  });

  it("scopes the sections to one repository", () => {
    const views = [view({ threadId: "a" }), view({ threadId: "b", repositoryRoot: OTHER })];
    const scoped = agentRailSections(
      views,
      { kind: "repository", projectRootKey: OTHER, repositoryRoot: OTHER },
      false,
      0,
    );

    expect(ids(scoped.active)).toEqual(["b"]);
  });

  it("assigns jump slots to the first nine visible cards only when more than one exists", () => {
    const many = Array.from({ length: 12 }, (_, index) => view({ threadId: `t-${index}` }));
    const slots = agentJumpSlots(agentRailSections(many, { kind: "all" }, false, 0));

    expect(slots.size).toBe(9);
    expect(slots.get("t-0")).toBe(1);
    expect(agentJumpSlots(agentRailSections([view({})], { kind: "all" }, false, 0)).size).toBe(0);
  });

  it("flattens groups and labels projects only when several exist", () => {
    const groups = [group(ROOT, "app", [view({ threadId: "a" })]), group(OTHER, "api", [])];

    expect(ids(agentRailViews(groups))).toEqual(["a"]);
    expect(agentRailProjectLabels(groups).get(ROOT)).toBe("app");
    const multi = { ...groups[0], singleRepo: false } as AgentProjectGroup;
    expect(agentRailProjectLabels([multi]).get(ROOT)).toBe("app / app");
  });

  it("describes the empty states truthfully", () => {
    const groups = [group(ROOT, "app", [])];
    const entries = agentRailScopeEntries(groups);
    const sections = agentRailSections([], { kind: "all" }, false, 0);

    expect(agentRailEmptyState([], sections, { kind: "all" }, entries)).toEqual({
      kind: "noProjects",
    });
    expect(agentRailEmptyState(groups, sections, { kind: "all" }, entries)).toEqual({
      kind: "noThreads",
      scopeLabel: null,
    });
    expect(
      agentRailEmptyState(
        groups,
        sections,
        { kind: "repository", projectRootKey: ROOT, repositoryRoot: ROOT },
        entries,
      ),
    ).toEqual({ kind: "noThreads", scopeLabel: "app" });
  });
});

describe("agent rail scope", () => {
  it("lists all projects first and labels multi-repository projects", () => {
    const entries = agentRailScopeEntries([group(ROOT, "app", [])]);

    expect(entries[0]).toEqual({
      kind: "all",
      value: ALL_PROJECTS_SCOPE_VALUE,
      label: "All projects",
    });
    expect(agentRailScopeLabel({ kind: "all" }, entries)).toBe("All projects");
    expect(
      agentRailScopeLabel(
        { kind: "repository", projectRootKey: ROOT, repositoryRoot: ROOT },
        entries,
      ),
    ).toBe("app");
  });

  it("surfaces trust and origin state with the matching action", () => {
    const untrusted = agentRailScopeEntries([group(ROOT, "app", [], { trust: "untrusted" })])[1];
    const closed = agentRailScopeEntries([
      group(ROOT, "app", [], { origin: "closed-tab-live-tasks" }),
    ])[1];
    const background = agentRailScopeEntries([
      group(ROOT, "app", [], { origin: "background-tab" }),
    ])[1];

    expect(agentRailScopeState(untrusted ?? null)).toEqual({ label: "Untrusted", action: "trust" });
    expect(agentRailScopeState(closed ?? null)).toEqual({ label: "Tab closed", action: "release" });
    expect(agentRailScopeState(background ?? null)).toEqual({ label: "Background", action: null });
    expect(agentRailScopeState(null)).toBeNull();
  });

  it("offers the project actions that match the project state", () => {
    const trusted = projectEntry(agentRailScopeEntries([group(ROOT, "app", [])]));
    const untrusted = projectEntry(
      agentRailScopeEntries([group(ROOT, "app", [], { trust: "untrusted" })]),
    );
    const closed = projectEntry(
      agentRailScopeEntries([group(ROOT, "app", [], { origin: "closed-tab-live-tasks" })]),
    );
    const detached = projectEntry(
      agentRailScopeEntries([group(ROOT, "app", [], { rootPath: null })]),
    );

    expect(agentProjectMenuEntries(trusted, false).map((entry) => entry.label)).toEqual([
      "Filter to this project",
      "Reveal in Finder",
      "Copy path",
    ]);
    expect(agentProjectMenuEntries(untrusted, false)[0]).toEqual({
      id: "trust",
      label: "Trust project",
      command: "trust",
      disabled: false,
    });
    expect(agentProjectMenuEntries(closed, false)[0]?.command).toBe("release");
    expect(agentProjectMenuEntries(detached, false).map((entry) => entry.command)).toEqual([
      "filterToProject",
    ]);
  });

  it("disables the filter action for the project already in scope", () => {
    const entry = projectEntry(agentRailScopeEntries([group(ROOT, "app", [])]));
    const filter = agentProjectMenuEntries(entry, true).find(
      (candidate) => candidate.command === "filterToProject",
    );

    expect(filter?.disabled).toBe(true);
    expect(agentProjectMenuTarget(entry)).toEqual({
      projectRootKey: ROOT,
      repositoryRoot: ROOT,
      rootPath: ROOT,
    });
  });

  it("reports the repository count only for a multi-repository project", () => {
    const entries = agentRailScopeEntries([group(ROOT, "app", [])]);
    const single = projectEntry(entries);

    expect(agentProjectRepositoryCountLabel(entries[0] as AgentRailScopeEntry)).toBeNull();
    expect(agentProjectRepositoryCountLabel(single)).toBeNull();
    expect(agentProjectRepositoryCountLabel({ ...single, repositoryCount: 3 })).toBe("3 repos");
    expect(agentProjectMenuEntries({ ...single, repositoryCount: 3 }, false)[0]?.label).toBe(
      "Filter to this repository",
    );
  });

  it("targets the first dispatchable repository for a new thread", () => {
    const entries = agentRailScopeEntries([
      group(ROOT, "app", [], { trust: "untrusted" }),
      group(OTHER, "api", []),
    ]);

    expect(agentRailNewThreadTarget({ kind: "all" }, entries)).toEqual({
      projectRootKey: OTHER,
      repositoryRoot: OTHER,
    });
    expect(
      agentRailNewThreadTarget(
        { kind: "repository", projectRootKey: ROOT, repositoryRoot: ROOT },
        entries,
      ),
    ).toBeNull();
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

function projectEntry(entries: ReadonlyArray<AgentRailScopeEntry>): AgentRailProjectScopeEntry {
  const entry = entries[1];
  expect(entry?.kind).toBe("repository");
  return entry as AgentRailProjectScopeEntry;
}
