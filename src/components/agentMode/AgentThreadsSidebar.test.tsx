// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTaskView, OrphanedWorktreeView } from "../../application/useAgentTasks";
import type { AgentTaskStatus } from "../../domain/agentTask";
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

describe("AgentThreadsSidebar", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
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
    render({ selectedTaskId: "agt-1" });

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

    render({ onTogglePin, pinnedTaskIds: new Set(["agt-1"]) });

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

  it("explains a project without a Git repository", () => {
    render({ groups: [project({ repos: [], singleRepo: false, liveCount: 0 })] });

    expect(host.textContent).toContain("No Git repository was detected in this project.");
  });

  it("explains an empty workspace without projects", () => {
    render({ groups: [] });

    expect(host.textContent).toContain("No Git repository was detected in this workspace.");
  });

  function render(overrides: Partial<AgentThreadsSidebarProps> = {}): void {
    act(() => root.render(<AgentThreadsSidebar {...defaultProps()} {...overrides} />));
  }

  function click(selector: string): void {
    const element = host.querySelector<HTMLElement>(selector);
    expect(element).not.toBeNull();
    act(() => element?.click());
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
    overflowRootPaths: [],
    selectedTaskId: null,
    pinnedTaskIds: new Set(),
    liveTaskCount: 1,
    maxConcurrentAgentTasks: 4,
    now: NOW,
    onToggleProject: () => undefined,
    onToggleGroup: () => undefined,
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
    threads: [thread({ kind: "running" })],
    orphans: [],
    liveCount: 1,
    ...overrides,
  };
}

function thread(status: AgentTaskStatus): AgentTaskView {
  return {
    record: {
      owner: { taskId: "agt-1", workspaceId: "workspace-a", repositoryRoot: ROOT },
      isolation: "worktree",
      worktreePath: `${ROOT}/.worktrees/agt-1`,
      prompt: "Fix the parser",
      status,
      outputTail: "",
      outputTruncated: false,
      lastStatusSequence: 0,
      lastOutputSequence: 0,
      startedAtEpochMs: NOW - 10 * 60_000,
    },
    repositoryLabel: "app",
    terminal: false,
    worktreeRemoved: false,
    changeSummary: null,
  };
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
