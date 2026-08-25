// @vitest-environment jsdom

import { agentThreadAttention, agentThreadUnread } from "../../domain/agentThread";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadView, OrphanedWorktreeView } from "../../application/agentThreadPorts";
import type { AgentLaunchOptions } from "../../domain/agentLaunch";
import { orderAgentThreadRows } from "./agentModePresentation";
import type { AgentThread, AgentTurnStatus } from "../../domain/agentThread";
import { AgentClockProvider } from "./agentClock";
import { AgentThreadsSidebar, type AgentThreadsSidebarProps } from "./AgentThreadsSidebar";
import {
  DETACHED_AGENT_PROJECT_LABEL,
  DETACHED_AGENT_PROJECT_ROOT_KEY,
  type AgentProjectGroup,
  type AgentRepositoryGroup,
} from "./agentModePresentation";

const ROOT = "/workspace/app";
const NESTED = "/workspace/app/packages/api";
const NOW = 1_700_000_600_000;
const NOW_TICK_MS = 1_000;

describe("AgentThreadsSidebar", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(NOW);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it("lists a single-repository project as one flat thread list", () => {
    render();

    expect(host.querySelector('section[aria-label="Project app"]')).not.toBeNull();
    expect(host.querySelector('section[aria-label="Repository app"]')).toBeNull();
    expect(host.textContent).toContain("Fix the parser");
    expect(host.textContent).toContain("Running");
    expect(host.textContent).toContain("10 minutes ago");
    expect(host.querySelector(".agent-dot--running")).not.toBeNull();
  });

  it("nests repository subsections under a multi-repository project", () => {
    render({ groups: [multiRepoProject()] });

    expect(host.querySelector('section[aria-label="Project monorepo"]')).not.toBeNull();
    expect(host.querySelector('section[aria-label="Repository app"]')).not.toBeNull();
    expect(host.querySelector('section[aria-label="Repository packages/api"]')).not.toBeNull();
  });

  it("reports how many agents run against the concurrency cap", () => {
    render({ liveTaskCount: 2, maxConcurrentAgentTasks: 4 });

    expect(host.textContent).toContain("2/4 running");
  });

  it("rolls the live thread count up to the project header", () => {
    render({ groups: [project({ liveCount: 3 })] });

    expect(host.querySelector(".agent-project__live")?.textContent).toBe("3 live");
  });

  it("keeps the project header quiet when nothing is live", () => {
    render({ groups: [project({ liveCount: 0, repos: [repositoryGroup({ liveCount: 0 })] })] });

    expect(host.querySelector(".agent-project__live")).toBeNull();
  });

  it("badges a project whose editor tab is closed while its lease is held", () => {
    render({ groups: [project({ origin: "closed-tab-live-tasks" })] });

    expect(host.querySelector(".agent-project__badge")?.textContent).toBe("Tab closed");
  });

  it("badges a background project and keeps the active project unbadged", () => {
    render({ groups: [project({ origin: "background-tab" })] });

    expect(host.querySelector(".agent-project__badge")?.textContent).toBe("Background");

    render();

    expect(host.querySelector(".agent-project__badge")).toBeNull();
  });

  it("releases a closed-tab project once its last thread ended", () => {
    const onReleaseProject = vi.fn();
    render({
      groups: [
        project({
          origin: "closed-tab-live-tasks",
          liveCount: 0,
          repos: [repositoryGroup({ liveCount: 0 })],
        }),
      ],
      onReleaseProject,
    });

    click('[aria-label="Release project app"]');

    expect(onReleaseProject).toHaveBeenCalledWith(ROOT);
  });

  it("keeps a closed-tab project with live threads unreleasable", () => {
    render({ groups: [project({ origin: "closed-tab-live-tasks", liveCount: 1 })] });

    expect(host.querySelector('[aria-label="Release project app"]')).toBeNull();
  });

  it("disables an untrusted project and offers the trust action", () => {
    const onTrustProject = vi.fn();
    const onNewThread = vi.fn();
    render({ groups: [project({ trust: "untrusted" })], onNewThread, onTrustProject });

    expect(host.textContent).toContain("This project is not trusted, so agents cannot start here.");
    expect(host.querySelector(".agent-group__new")).toBeNull();
    expect(host.textContent).toContain("Fix the parser");

    click('[aria-label="Trust project app"]');

    expect(onTrustProject).toHaveBeenCalledWith(ROOT);
    expect(onNewThread).not.toHaveBeenCalled();
  });

  it("treats an unreadable trust state as untrusted", () => {
    render({ groups: [project({ trust: "unknown" })] });

    expect(host.textContent).toContain("could not be read");
    expect(host.querySelector(".agent-group__new")).toBeNull();
  });

  it("selects a thread when its row is clicked", () => {
    const onSelectThread = vi.fn();
    render({ onSelectThread });

    clickText("Fix the parser");

    expect(onSelectThread).toHaveBeenCalledWith("agt-1");
  });

  it("marks the selected thread for assistive technology", () => {
    render({ selectedThreadId: "agt-1" });

    const selected = host.querySelector('[aria-current="true"]');

    expect(selected?.textContent).toContain("Fix the parser");
  });

  it("collapses a project and hides its threads", () => {
    const onToggleProject = vi.fn();
    render({ onToggleProject });

    click('.agent-project__head[aria-expanded="true"]');

    expect(onToggleProject).toHaveBeenCalledWith(ROOT);

    render({ collapsedProjectRootKeys: new Set([ROOT]) });

    expect(host.textContent).not.toContain("Fix the parser");
  });

  it("collapses a repository subsection without collapsing its project", () => {
    const onToggleGroup = vi.fn();
    render({ groups: [multiRepoProject()], onToggleGroup });

    click('.agent-group__head[aria-expanded="true"]');

    expect(onToggleGroup).toHaveBeenCalledWith(ROOT);

    render({ collapsedRepositoryRoots: new Set([ROOT]), groups: [multiRepoProject()] });

    expect(host.textContent).not.toContain("Fix the parser");
    expect(host.querySelector('section[aria-label="Repository packages/api"]')).not.toBeNull();
  });

  it("starts a new thread for the project and repository of the group", () => {
    const onNewThread = vi.fn();
    render({ onNewThread });

    clickText("+ New thread");

    expect(onNewThread).toHaveBeenCalledWith(ROOT, ROOT);
  });

  it("fails closed when a detached group is no longer resolved", () => {
    const onNewThread = vi.fn();
    render({ groups: [project({}), detachedProject()], onNewThread });

    const detached = host.querySelector<HTMLElement>(
      `section[aria-label="${DETACHED_AGENT_PROJECT_LABEL}"]`,
    );
    expect(detached).not.toBeNull();
    expect(detached?.querySelector(".agent-group__new")).toBeNull();
    expect(detached?.textContent).toContain(
      "This repository is no longer available in the current workspace.",
    );
    expect(detached?.querySelector(".agent-trust")).toBeNull();

    clickText("+ New thread");
    expect(onNewThread).toHaveBeenCalledWith(ROOT, ROOT);
    expect(onNewThread).toHaveBeenCalledTimes(1);
  });

  it("reports the projects beyond the root limit instead of dropping them silently", () => {
    render({ overflowRootPaths: ["/workspace/nine", "/workspace/ten"] });

    const overflow = host.querySelector(".agent-rail__overflow");

    expect(overflow?.textContent).toBe("2 more projects are not shown (limit 8)");
    expect(overflow?.getAttribute("title")).toBe("/workspace/nine\n/workspace/ten");
  });

  it("keeps the overflow row singular for a single hidden project", () => {
    render({ overflowRootPaths: ["/workspace/nine"] });

    expect(host.querySelector(".agent-rail__overflow")?.textContent).toBe(
      "1 more project is not shown (limit 8)",
    );
  });

  it("hides the overflow row while every project fits", () => {
    render();

    expect(host.querySelector(".agent-rail__overflow")).toBeNull();
  });

  it("removes an orphaned worktree listed under its repository", () => {
    const onRemoveOrphan = vi.fn();
    render({
      groups: [project({ repos: [repositoryGroup({ orphans: [orphan(false)] })] })],
      onRemoveOrphan,
    });

    expect(host.textContent).toContain("Orphaned worktrees");
    click(`[aria-label="Remove orphaned worktree ${ROOT}/.worktrees/agt-9"]`);

    expect(onRemoveOrphan).toHaveBeenCalledWith(`${ROOT}/.worktrees/agt-9`);
  });

  it("prunes stale worktrees when the orphan is prunable", () => {
    const onPruneOrphans = vi.fn();
    render({
      groups: [project({ repos: [repositoryGroup({ orphans: [orphan(true)] })] })],
      onPruneOrphans,
    });

    click(`[aria-label="Prune stale worktrees for ${ROOT}"]`);

    expect(onPruneOrphans).toHaveBeenCalledWith(ROOT);
  });

  it("pins and unpins a thread from its row", () => {
    const onTogglePin = vi.fn();
    render({ onTogglePin });

    click('[aria-label="Pin thread agt-1"]');

    expect(onTogglePin).toHaveBeenCalledWith("agt-1");
    expect(
      host.querySelector('[aria-label="Pin thread agt-1"]')?.getAttribute("aria-pressed"),
    ).toBe("false");

    render({
      onTogglePin,
      groups: [project({ repos: [repositoryGroup({ threads: [threadView({ pinned: true })] })] })],
    });

    const pinned = host.querySelector('[aria-label="Unpin thread agt-1"]');
    expect(pinned?.getAttribute("aria-pressed")).toBe("true");
    expect(pinned?.className).toContain("agent-thread__pin--on");

    click('[aria-label="Unpin thread agt-1"]');
    expect(onTogglePin).toHaveBeenCalledTimes(2);
  });

  it("keeps selecting a thread separate from pinning it", () => {
    const onSelectThread = vi.fn();
    const onTogglePin = vi.fn();
    render({ onSelectThread, onTogglePin });

    click('[aria-label="Pin thread agt-1"]');

    expect(onSelectThread).not.toHaveBeenCalled();
    expect(onTogglePin).toHaveBeenCalledWith("agt-1");
  });

  it("offers no pin action for orphaned worktrees", () => {
    render({
      groups: [project({ repos: [repositoryGroup({ threads: [], orphans: [orphan(false)] })] })],
    });

    expect(host.textContent).toContain("Orphaned worktrees");
    expect(host.querySelector(".agent-thread__pin")).toBeNull();
  });

  it("keeps archived threads behind a collapsed group per repository", () => {
    const onToggleArchived = vi.fn();
    render({
      groups: [
        project({
          repos: [
            repositoryGroup({
              archived: [threadView({ threadId: "agt-old", title: "Old work", archived: true })],
            }),
          ],
        }),
      ],
      onToggleArchived,
    });

    expect(host.querySelector('section[aria-label="Archived threads in app"]')).not.toBeNull();
    expect(host.textContent).not.toContain("Old work");

    click('.agent-archived__head[aria-expanded="false"]');

    expect(onToggleArchived).toHaveBeenCalledWith(ROOT);

    render({
      expandedArchivedRoots: new Set([ROOT]),
      groups: [
        project({
          repos: [
            repositoryGroup({
              archived: [threadView({ threadId: "agt-old", title: "Old work", archived: true })],
            }),
          ],
        }),
      ],
    });

    expect(host.textContent).toContain("Old work");
    expect(host.textContent).toContain("Archived");
  });

  it("hides the archived group when no thread is archived", () => {
    render();

    expect(host.querySelector(".agent-archived")).toBeNull();
  });

  it("explains a project without a Git repository", () => {
    render({ groups: [project({ repos: [], singleRepo: false, liveCount: 0 })] });

    expect(host.textContent).toContain("No Git repository was detected in this project.");
  });

  it("explains an empty workspace without projects", () => {
    render({ groups: [] });

    expect(host.textContent).toContain("No Git repository was detected in this workspace.");
  });

  it("orders rows into running, attention and settled bands", () => {
    render({ groups: [busyProject()] });

    const bands = [...host.querySelectorAll(".agent-band__label")].map((band) => band.textContent);
    expect(bands).toEqual(["Running", "Needs attention", "Idle"]);
    expect(threadOrder()).toEqual(["agt-1", "agt-2", "agt-3"]);
  });

  it("floats a pinned settled thread above its unpinned band peers only", () => {
    render({
      groups: [
        project({
          repos: [
            repositoryGroup({
              threads: orderAgentThreadRows([
                settled("agt-3", "Polish the docs"),
                settled("agt-4", "Pinned cleanup", { pinned: true }),
                running("agt-1", "Fix the parser"),
              ]),
            }),
          ],
        }),
      ],
    });

    expect(threadOrder()).toEqual(["agt-1", "agt-4", "agt-3"]);
  });

  it("filters threads by a bounded case-insensitive title match", () => {
    render({ groups: [busyProject()] });

    typeFilter("RENAME");

    expect(threadOrder()).toEqual(["agt-2"]);
    expect(host.querySelector(".agent-rail__filter")?.getAttribute("maxlength")).toBe("128");
  });

  it("clips filter text beyond the bounded length", () => {
    render({ groups: [busyProject()] });

    typeFilter("x".repeat(200));

    expect(host.querySelector<HTMLInputElement>(".agent-rail__filter")?.value).toHaveLength(128);
  });

  it("filters threads by attention status", () => {
    render({ groups: [busyProject()] });

    pickStatus("attention");

    expect(threadOrder()).toEqual(["agt-2"]);
  });

  it("offers every status with its thread count in a single picker", () => {
    render({ groups: [busyProject()] });

    const trigger = host.querySelector<HTMLButtonElement>("button#agent-rail-status");
    expect(trigger?.getAttribute("aria-haspopup")).toBe("listbox");
    expect(trigger?.textContent).toContain("All");

    act(() => trigger?.click());

    const options = [...host.querySelectorAll<HTMLElement>('[role="option"]')].map(
      (option) => option.textContent,
    );
    expect(options).toEqual(["All3", "Running1", "Needs attention1", "Idle1", "Archived0"]);
    expect(host.querySelectorAll(".agent-rail__status-option")).toHaveLength(0);
  });

  it("names the picked status on the closed trigger", () => {
    render({ groups: [busyProject()] });

    expect(host.querySelector("button#agent-rail-status")?.textContent).toBe("Status:All");

    pickStatus("running");

    expect(host.querySelector("button#agent-rail-status")?.textContent).toBe("Status:Running");
  });

  it("counts only the threads the text filter still matches", () => {
    render({ groups: [busyProject()] });

    typeFilter("Fix the parser");
    act(() => host.querySelector<HTMLButtonElement>("button#agent-rail-status")?.click());

    const options = [...host.querySelectorAll<HTMLElement>('[role="option"]')].map(
      (option) => option.textContent,
    );
    expect(options).toEqual(["All1", "Running1", "Needs attention0", "Idle0", "Archived0"]);
  });

  it("keeps archived threads out of every status filter but all and archived", () => {
    render({ groups: [archivedProject()] });

    pickStatus("running");
    expect(host.querySelector('section[aria-label="Archived threads in app"]')).toBeNull();

    pickStatus("archived");
    expect(host.querySelector('section[aria-label="Archived threads in app"]')).not.toBeNull();
  });

  it("offers a way out when the filters match no thread", () => {
    const onSelectThread = vi.fn();
    render({ groups: [busyProject()], onSelectThread });

    typeFilter("nothing matches this");

    expect(host.textContent).toContain("No threads match");

    clickText("Clear filters");

    expect(threadOrder()).toEqual(["agt-1", "agt-2", "agt-3"]);
    expect(onSelectThread).not.toHaveBeenCalled();
  });

  it("marks an unread result and hides the marker while its thread is selected", () => {
    render({ groups: [busyProject()] });

    const unread = host.querySelector('[aria-label="Unread result"]');
    expect(unread).not.toBeNull();
    expect(unread?.closest(".agent-thread-slot")?.textContent).toContain("Rename the port");

    render({ groups: [busyProject()], selectedThreadId: "agt-2" });

    expect(host.querySelector('[aria-label="Unread result"]')).toBeNull();
  });

  it("shows the recorded model of the last turn in the row meta", () => {
    render({
      groups: [
        project({
          repos: [
            repositoryGroup({
              threads: [
                settled("agt-3", "Polish the docs", {
                  launch: { provider: "claudeCode", model: "opus", mode: "acceptEdits" },
                }),
              ],
            }),
          ],
        }),
      ],
    });

    expect(host.querySelector(".agent-thread__meta")?.textContent).toContain("opus");
  });

  it("moves a roving focus through the visible rows with the arrow keys", () => {
    render({ groups: [busyProject()] });

    expect(rowFor("agt-1")?.tabIndex).toBe(0);
    expect(rowFor("agt-2")?.tabIndex).toBe(-1);

    press("ArrowDown", rowFor("agt-1"));

    expect(document.activeElement).toBe(rowFor("agt-2"));
    expect(rowFor("agt-2")?.tabIndex).toBe(0);

    press("End", rowFor("agt-2"));
    expect(document.activeElement).toBe(rowFor("agt-3"));

    press("ArrowDown", rowFor("agt-3"));
    expect(document.activeElement).toBe(rowFor("agt-3"));

    press("ArrowUp", rowFor("agt-3"));
    expect(document.activeElement).toBe(rowFor("agt-2"));

    press("Home", rowFor("agt-2"));
    expect(document.activeElement).toBe(rowFor("agt-1"));
  });

  it("selects with Enter and pins with p without leaving the focused row", () => {
    const onSelectThread = vi.fn();
    const onTogglePin = vi.fn();
    render({ groups: [busyProject()], onSelectThread, onTogglePin });

    press("ArrowDown", rowFor("agt-1"));
    press("Enter", rowFor("agt-2"));

    expect(onSelectThread).toHaveBeenCalledWith("agt-2");

    press("p", rowFor("agt-2"));

    expect(onTogglePin).toHaveBeenCalledWith("agt-2");
    expect(onSelectThread).toHaveBeenCalledTimes(1);
  });

  it("moves focus from a row to the filter input on Escape without clearing the filters", () => {
    render({ groups: [busyProject()] });

    typeFilter("rename");
    expect(threadOrder()).toEqual(["agt-2"]);

    press("Escape", rowFor("agt-2"));

    expect(host.querySelector<HTMLInputElement>(".agent-rail__filter")?.value).toBe("rename");
    expect(document.activeElement).toBe(host.querySelector(".agent-rail__filter"));
    expect(threadOrder()).toEqual(["agt-2"]);
  });

  it("clears the filters on Escape inside the filter input", () => {
    render({ groups: [busyProject()] });

    typeFilter("rename");
    expect(threadOrder()).toEqual(["agt-2"]);

    press("Escape", host.querySelector<HTMLElement>(".agent-rail__filter"));

    expect(host.querySelector<HTMLInputElement>(".agent-rail__filter")?.value).toBe("");
    expect(threadOrder()).toEqual(["agt-1", "agt-2", "agt-3"]);
  });

  it("exposes the thread rail as a list of thread items", () => {
    render({ groups: [busyProject()] });

    const list = host.querySelector('[role="list"]');
    expect(list?.classList.contains("agent-rail__groups")).toBe(true);
    expect(list?.querySelectorAll('[role="listitem"] [data-thread-id]').length).toBe(3);
  });

  it("falls the roving target back to the first visible row when the focused row is filtered out", () => {
    render({ groups: [busyProject()] });

    press("End", rowFor("agt-1"));
    expect(rowFor("agt-3")?.tabIndex).toBe(0);

    typeFilter("rename");

    expect(rowFor("agt-2")?.tabIndex).toBe(0);
  });

  it("keeps other rows out of a burst of updates to one thread", () => {
    const idle = { count: 0 };
    const idleView = settled("agt-3", "Polish the docs", { countRenders: idle });
    const build = (title: string): ReadonlyArray<AgentProjectGroup> => [
      project({
        repos: [
          repositoryGroup({
            threads: orderAgentThreadRows([running("agt-1", title), idleView]),
          }),
        ],
      }),
    ];

    render({ groups: build("Fix the parser") });

    const before = idle.count;
    expect(before).toBeGreaterThan(0);

    for (let index = 0; index < 20; index += 1) {
      render({ groups: build(`Fix the parser ${index}`) });
    }

    expect(host.textContent).toContain("Fix the parser 19");
    expect(idle.count).toBe(before);
  });

  it("keeps rows out of a clock tick", () => {
    const idle = { count: 0 };
    const idleView = settled("agt-3", "Polish the docs", { countRenders: idle });
    render({
      groups: [project({ repos: [repositoryGroup({ threads: [idleView] })] })],
    });

    const before = idle.count;
    act(() => {
      vi.setSystemTime(NOW + 2 * 60 * 60_000);
      vi.advanceTimersByTime(NOW_TICK_MS);
    });

    expect(host.textContent).toContain("2 hours ago");
    expect(idle.count).toBe(before);
  });

  function threadOrder(): ReadonlyArray<string> {
    return [...host.querySelectorAll<HTMLElement>("[data-thread-id]")].map(
      (row) => row.dataset.threadId ?? "",
    );
  }

  function rowFor(threadId: string): HTMLElement | null {
    return host.querySelector<HTMLElement>(`[data-thread-id="${threadId}"]`);
  }

  function press(key: string, element: HTMLElement | null): void {
    expect(element).not.toBeNull();
    act(() => {
      element?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }),
      );
    });
  }

  function typeFilter(value: string): void {
    const input = host.querySelector<HTMLInputElement>(".agent-rail__filter");
    expect(input).not.toBeNull();
    act(() => {
      if (input === null) return;
      nativeInputValue(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function render(overrides: Partial<AgentThreadsSidebarProps> = {}): void {
    act(() =>
      root.render(
        <AgentClockProvider nowTickMs={NOW_TICK_MS}>
          <AgentThreadsSidebar {...defaultProps()} {...overrides} />
        </AgentClockProvider>,
      ),
    );
  }

  function click(selector: string): void {
    const element = host.querySelector<HTMLElement>(selector);
    expect(element).not.toBeNull();
    act(() => element?.click());
  }

  function pickStatus(value: string): void {
    click("button#agent-rail-status");
    click(`#agent-rail-status-list [role="option"][data-value="${value}"]`);
  }

  function clickText(text: string): void {
    act(() => buttonWithText(text).click());
  }

  function buttonWithText(text: string): HTMLButtonElement {
    const element = [...host.querySelectorAll("button")].find((candidate) =>
      (candidate.textContent ?? "").includes(text),
    );
    expect(element).toBeDefined();
    return element as HTMLButtonElement;
  }
});

function defaultProps(): AgentThreadsSidebarProps {
  return {
    groups: [project({})],
    collapsedProjectRootKeys: new Set(),
    collapsedRepositoryRoots: new Set(),
    expandedArchivedRoots: new Set(),
    overflowRootPaths: [],
    selectedThreadId: null,
    liveTaskCount: 1,
    maxConcurrentAgentTasks: 4,
    onToggleProject: () => undefined,
    onToggleGroup: () => undefined,
    onToggleArchived: () => undefined,
    onSelectThread: () => undefined,
    onTogglePin: () => undefined,
    onNewThread: () => undefined,
    onTrustProject: () => undefined,
    onReleaseProject: () => undefined,
    onRemoveOrphan: () => undefined,
    onPruneOrphans: () => undefined,
  };
}

function project(overrides: Partial<AgentProjectGroup>): AgentProjectGroup {
  return {
    projectRootKey: ROOT,
    kind: "project",
    label: "app",
    trust: "trusted",
    origin: "active-tab",
    singleRepo: true,
    repos: [repositoryGroup({})],
    liveCount: 1,
    ...overrides,
  };
}

function multiRepoProject(): AgentProjectGroup {
  return project({
    label: "monorepo",
    singleRepo: false,
    repos: [
      repositoryGroup({}),
      repositoryGroup({
        repositoryRoot: NESTED,
        label: "packages/api",
        threads: [],
        archived: [],
        liveCount: 0,
      }),
    ],
  });
}

function detachedProject(): AgentProjectGroup {
  return {
    projectRootKey: DETACHED_AGENT_PROJECT_ROOT_KEY,
    kind: "detached",
    label: DETACHED_AGENT_PROJECT_LABEL,
    trust: "unknown",
    origin: "closed-tab-live-tasks",
    singleRepo: false,
    repos: [
      repositoryGroup({
        repositoryRoot: "/detached/repository",
        label: "/detached/repository",
        repositoryResolved: false,
        threads: [],
        liveCount: 0,
      }),
    ],
    liveCount: 0,
  };
}

function repositoryGroup(overrides: Partial<AgentRepositoryGroup>): AgentRepositoryGroup {
  return {
    repositoryRoot: ROOT,
    label: "app",
    repositoryResolved: true,
    threads: [threadView({ status: { kind: "running" } })],
    archived: [],
    orphans: [],
    liveCount: 1,
    ...overrides,
  };
}

interface ThreadViewOptions {
  readonly threadId?: string;
  readonly title?: string;
  readonly status?: AgentTurnStatus;
  readonly pinned?: boolean;
  readonly archived?: boolean;
  readonly updatedAtEpochMs?: number;
  readonly endedAtEpochMs?: number | null;
  readonly viewedAtEpochMs?: number | null;
  readonly launch?: AgentLaunchOptions | null;
  readonly countRenders?: { count: number };
}

function threadView({
  archived = false,
  countRenders,
  endedAtEpochMs = null,
  launch = null,
  pinned = false,
  status = { kind: "running" },
  threadId = "agt-1",
  title = "Fix the parser",
  updatedAtEpochMs = NOW - 10 * 60_000,
  viewedAtEpochMs = null,
}: ThreadViewOptions): AgentThreadView {
  const running = status.kind === "pending" || status.kind === "running";
  const thread: AgentThread = {
    threadId,
    owner: { rootKey: ROOT, ownerId: "agent-root:app", repositoryRoot: ROOT },
    target: { isolation: "worktree", worktreePath: `${ROOT}/.worktrees/${threadId}` },
    provider: { kind: "claudeCode", sessionId: "session-abcdefgh" },
    title,
    pinned,
    archived,
    createdAtEpochMs: NOW - 10 * 60_000,
    updatedAtEpochMs,
    turns: [
      {
        turnId: `${threadId}-t1`,
        prompt: title,
        status,
        startedAtEpochMs: NOW - 10 * 60_000,
        endedAtEpochMs,
        events: [],
        eventsTruncated: false,
        lastStatusSequence: 0,
        lastOutputSequence: 0,
        launch,
      },
    ],
    turnsTruncated: false,
    viewedAtEpochMs,
    integration: null,
  };

  if (countRenders !== undefined) {
    countTitleReads(thread, title, countRenders);
  }

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

function running(threadId: string, title: string): AgentThreadView {
  return threadView({ status: { kind: "running" }, threadId, title });
}

function attention(threadId: string, title: string): AgentThreadView {
  return threadView({
    endedAtEpochMs: NOW - 60_000,
    status: { kind: "failed", message: "boom" },
    threadId,
    title,
  });
}

function settled(
  threadId: string,
  title: string,
  options: ThreadViewOptions = {},
): AgentThreadView {
  return threadView({
    endedAtEpochMs: NOW - 2 * 60_000,
    status: { kind: "exited", exitCode: 0 },
    threadId,
    title,
    viewedAtEpochMs: NOW,
    ...options,
  });
}

function busyProject(): AgentProjectGroup {
  return project({
    repos: [
      repositoryGroup({
        threads: orderAgentThreadRows([
          settled("agt-3", "Polish the docs"),
          running("agt-1", "Fix the parser"),
          attention("agt-2", "Rename the port"),
        ]),
      }),
    ],
  });
}

function archivedProject(): AgentProjectGroup {
  return project({
    repos: [
      repositoryGroup({
        threads: [running("agt-1", "Fix the parser")],
        archived: [threadView({ archived: true, threadId: "agt-old", title: "Old work" })],
      }),
    ],
  });
}

function nativeInputValue(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  expect(descriptor?.set).toBeTypeOf("function");
  descriptor?.set?.call(input, value);
}

function countTitleReads(thread: AgentThread, title: string, counter: { count: number }): void {
  Object.defineProperty(thread, "title", {
    configurable: true,
    enumerable: true,
    get: () => {
      counter.count += 1;
      return title;
    },
  });
}

function orphan(prunable: boolean): OrphanedWorktreeView {
  return {
    repositoryRoot: ROOT,
    worktreePath: `${ROOT}/.worktrees/agt-9`,
    branch: "agent/agt-9",
    prunable,
    removing: false,
  };
}
