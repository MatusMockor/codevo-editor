// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTaskChangeSummary, AgentTaskView } from "../../application/useAgentTasks";
import type { AgentTaskIsolation, AgentTaskRecord } from "../../domain/agentTask";
import { AgentThreadInfoColumn, type AgentThreadInfoColumnProps } from "./AgentThreadInfoColumn";

const ROOT = "/workspace/app";
const WORKTREE = `${ROOT}/.worktrees/agt-1`;
const NOW = 1_700_000_600_000;

describe("AgentThreadInfoColumn", () => {
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

  it("previews the composer repository, its isolation reason and the free slots", () => {
    render({
      thread: null,
      composerIsolationReason: "The working tree has uncommitted changes.",
      liveTaskCount: 1,
      maxConcurrentAgentTasks: 4,
    });

    expect(host.textContent).toContain("app");
    expect(host.textContent).toContain(ROOT);
    expect(host.textContent).toContain("The working tree has uncommitted changes.");
    expect(host.textContent).toContain("1 of 4 running");
  });

  it("shows status, isolation, worktree path and changed file count of a thread", () => {
    render({
      thread: threadView({
        status: { kind: "exited", exitCode: 0 },
        terminal: true,
        changeSummary: summary({ files: [changedFile("a.ts"), changedFile("b.ts")] }),
      }),
    });

    expect(host.textContent).toContain("Finished");
    expect(host.textContent).toContain("Worktree");
    expect(host.textContent).toContain(WORKTREE);
    expect(host.textContent).toContain("5 minutes ago");
    expect(host.querySelector(".agent-info__word--done")).not.toBeNull();
  });

  it("stops a live thread", () => {
    const onStop = vi.fn();
    render({ onStop, thread: threadView({ status: { kind: "running" } }) });

    click('[aria-label="Stop agent agt-1"]');

    expect(onStop).toHaveBeenCalledWith("agt-1");
    expect(host.querySelector('[aria-label="Dismiss agent agt-1"]')).toBeNull();
  });

  it("offers show changes and remove worktree for a reviewable thread", () => {
    const onShowChanges = vi.fn();
    const onRemoveWorktree = vi.fn();
    render({
      onRemoveWorktree,
      onShowChanges,
      thread: threadView({ status: { kind: "exited", exitCode: 0 }, terminal: true }),
    });

    click('[aria-label="Show changes for agent agt-1"]');
    click('[aria-label="Remove worktree for agent agt-1"]');

    expect(onShowChanges).toHaveBeenCalledWith("agt-1");
    expect(onRemoveWorktree).toHaveBeenCalledWith("agt-1");
  });

  it("keeps remove worktree disabled while a removal is in flight", () => {
    render({
      thread: threadView({
        status: { kind: "exited", exitCode: 0 },
        terminal: true,
        changeSummary: summary({ removing: true }),
      }),
    });

    const button = host.querySelector<HTMLButtonElement>(
      '[aria-label="Remove worktree for agent agt-1"]',
    );

    expect(button?.disabled).toBe(true);
    expect(host.textContent).toContain("Removing…");
  });

  it("hides worktree review actions for an in-place thread", () => {
    render({
      thread: threadView({
        status: { kind: "exited", exitCode: 0 },
        terminal: true,
        isolation: "in-place",
      }),
    });

    expect(host.querySelector('[aria-label="Remove worktree for agent agt-1"]')).toBeNull();
    expect(host.textContent).toContain("In place");
  });

  it("hides review actions once the worktree was removed", () => {
    render({
      thread: threadView({
        status: { kind: "exited", exitCode: 0 },
        terminal: true,
        worktreeRemoved: true,
      }),
    });

    expect(host.querySelector('[aria-label="Remove worktree for agent agt-1"]')).toBeNull();
  });

  it("dismisses a terminal thread", () => {
    const onDismiss = vi.fn();
    render({
      onDismiss,
      thread: threadView({ status: { kind: "failed", message: "boom" }, terminal: true }),
    });

    click('[aria-label="Dismiss agent agt-1"]');

    expect(onDismiss).toHaveBeenCalledWith("agt-1");
  });

  it("pins a running thread and unpins a pinned terminal thread", () => {
    const onTogglePin = vi.fn();
    render({ onTogglePin, thread: threadView({ status: { kind: "running" } }) });

    click('[aria-label="Pin agent agt-1"]');

    expect(onTogglePin).toHaveBeenCalledWith("agt-1");
    expect(host.textContent).toContain("Pin thread");

    render({
      onTogglePin,
      pinned: true,
      thread: threadView({ status: { kind: "stopped" }, terminal: true }),
    });

    const unpin = host.querySelector('[aria-label="Unpin agent agt-1"]');
    expect(unpin?.getAttribute("aria-pressed")).toBe("true");
    click('[aria-label="Unpin agent agt-1"]');

    expect(onTogglePin).toHaveBeenCalledTimes(2);
  });

  it("offers no pin action while no thread is selected", () => {
    render({ thread: null });

    expect(host.querySelector('[aria-label^="Pin agent"]')).toBeNull();
  });

  function render(overrides: Partial<AgentThreadInfoColumnProps> = {}): void {
    act(() => root.render(<AgentThreadInfoColumn {...defaultProps()} {...overrides} />));
  }

  function click(selector: string): void {
    const element = host.querySelector<HTMLElement>(selector);
    expect(element).not.toBeNull();
    act(() => element?.click());
  }
});

function defaultProps(): AgentThreadInfoColumnProps {
  return {
    thread: threadView({}),
    pinned: false,
    now: NOW,
    liveTaskCount: 0,
    maxConcurrentAgentTasks: 4,
    composerRepositoryLabel: "app",
    composerRepositoryRoot: ROOT,
    composerIsolationReason: null,
    onStop: () => undefined,
    onDismiss: () => undefined,
    onShowChanges: () => undefined,
    onRemoveWorktree: () => undefined,
    onTogglePin: () => undefined,
  };
}

function threadView(overrides: {
  readonly status?: AgentTaskRecord["status"];
  readonly terminal?: boolean;
  readonly isolation?: AgentTaskIsolation;
  readonly worktreeRemoved?: boolean;
  readonly changeSummary?: AgentTaskChangeSummary | null;
}): AgentTaskView {
  const isolation = overrides.isolation ?? "worktree";
  return {
    record: {
      owner: { taskId: "agt-1", workspaceId: "workspace-a", repositoryRoot: ROOT },
      isolation,
      worktreePath: isolation === "worktree" ? WORKTREE : null,
      prompt: "Refactor the parser",
      status: overrides.status ?? { kind: "running" },
      outputTail: "",
      outputTruncated: false,
      lastStatusSequence: 0,
      lastOutputSequence: 0,
      startedAtEpochMs: NOW - 5 * 60_000,
    },
    repositoryLabel: "app",
    terminal: overrides.terminal ?? false,
    worktreeRemoved: overrides.worktreeRemoved ?? false,
    changeSummary: overrides.changeSummary ?? null,
  };
}

function summary(overrides: Partial<AgentTaskChangeSummary>): AgentTaskChangeSummary {
  return {
    loading: false,
    error: null,
    files: [],
    truncated: false,
    removing: false,
    diff: null,
    ...overrides,
  };
}

function changedFile(relativePath: string) {
  return {
    isStaged: false,
    isUnversioned: false,
    oldPath: null,
    oldRelativePath: null,
    path: `${WORKTREE}/${relativePath}`,
    relativePath,
    status: "modified" as const,
  };
}
