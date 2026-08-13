// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTaskView, OrphanedWorktreeView } from "../../application/useAgentTasks";
import type { AgentTaskStatus } from "../../domain/agentTask";
import { AgentThreadsSidebar, type AgentThreadsSidebarProps } from "./AgentThreadsSidebar";
import type { AgentRepositoryGroup } from "./agentModePresentation";

const ROOT = "/workspace/app";
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

  it("lists repository groups with their threads, status and relative time", () => {
    render();

    expect(host.textContent).toContain("app");
    expect(host.textContent).toContain("Fix the parser");
    expect(host.textContent).toContain("Running");
    expect(host.textContent).toContain("10 minutes ago");
    expect(host.querySelector(".agent-dot--running")).not.toBeNull();
  });

  it("reports how many agents run against the concurrency cap", () => {
    render({ liveTaskCount: 2, maxConcurrentAgentTasks: 4 });

    expect(host.textContent).toContain("2/4 running");
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

  it("collapses a repository group and hides its threads", () => {
    const onToggleGroup = vi.fn();
    render({ onToggleGroup });

    click('[aria-expanded="true"]');

    expect(onToggleGroup).toHaveBeenCalledWith(ROOT);

    render({ collapsedRepositoryRoots: new Set([ROOT]) });

    expect(host.textContent).not.toContain("Fix the parser");
  });

  it("starts a new thread for the repository of the group", () => {
    const onNewThread = vi.fn();
    render({ onNewThread });

    clickText("+ New thread");

    expect(onNewThread).toHaveBeenCalledWith(ROOT);
  });

  it("fails closed when a detached repository group is no longer resolved", () => {
    const onNewThread = vi.fn();
    render({
      groups: [
        group({}),
        group({
          repositoryRoot: "/detached/repository",
          label: "detached/repository",
          repositoryResolved: false,
        }),
      ],
      onNewThread,
    });

    const detachedGroup = host.querySelector<HTMLElement>(
      '[aria-label="Repository detached/repository"]',
    );
    expect(detachedGroup).not.toBeNull();
    expect(detachedGroup?.querySelector(".agent-group__new")).toBeNull();
    expect(detachedGroup?.textContent).toContain(
      "This repository is no longer available in the current workspace.",
    );

    clickText("+ New thread");
    expect(onNewThread).toHaveBeenCalledWith(ROOT);
    expect(onNewThread).not.toHaveBeenCalledWith("/detached/repository");
    onNewThread.mockClear();

    detachedGroup?.querySelector<HTMLElement>(".agent-rail__empty")?.click();
    expect(onNewThread).not.toHaveBeenCalled();
  });

  it("removes an orphaned worktree listed under its repository", () => {
    const onRemoveOrphan = vi.fn();
    render({ groups: [group({ orphans: [orphan(false)] })], onRemoveOrphan });

    expect(host.textContent).toContain("Orphaned worktrees");
    click(`[aria-label="Remove orphaned worktree ${ROOT}/.worktrees/agt-9"]`);

    expect(onRemoveOrphan).toHaveBeenCalledWith(`${ROOT}/.worktrees/agt-9`);
  });

  it("prunes stale worktrees when the orphan is prunable", () => {
    const onPruneOrphans = vi.fn();
    render({ groups: [group({ orphans: [orphan(true)] })], onPruneOrphans });

    click(`[aria-label="Prune stale worktrees for ${ROOT}"]`);

    expect(onPruneOrphans).toHaveBeenCalledWith(ROOT);
  });

  it("explains an empty workspace without repositories", () => {
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
    groups: [group({})],
    collapsedRepositoryRoots: new Set(),
    selectedTaskId: null,
    liveTaskCount: 1,
    maxConcurrentAgentTasks: 4,
    now: NOW,
    onToggleGroup: () => undefined,
    onSelectThread: () => undefined,
    onNewThread: () => undefined,
    onRemoveOrphan: () => undefined,
    onPruneOrphans: () => undefined,
  };
}

function group(overrides: Partial<AgentRepositoryGroup>): AgentRepositoryGroup {
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
