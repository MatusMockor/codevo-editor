// @vitest-environment jsdom

import { agentThreadAttention, agentThreadUnread } from "../../domain/agentThread";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTaskChangeSummary, AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentLaunchOptions } from "../../domain/agentLaunch";
import type { AgentShipState } from "../../domain/agentShip";
import type { AgentTaskIsolation } from "../../domain/agentTask";
import type { AgentThread, AgentTurnStatus } from "../../domain/agentThread";
import { AgentThreadInfoColumn, type AgentThreadInfoColumnProps } from "./AgentThreadInfoColumn";

const ROOT = "/workspace/app";
const WORKTREE = `${ROOT}/.worktrees/agt-1`;
const NOW = 1_700_000_600_000;

describe("AgentThreadInfoColumn", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers({ toFake: ["Date"] });
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

  it("shows lifecycle, last turn status, isolation, worktree path and changed files", () => {
    render({
      thread: threadView({
        status: { kind: "exited", exitCode: 0 },
        changeSummary: summary({ files: [changedFile("a.ts"), changedFile("b.ts")] }),
      }),
    });

    expect(host.textContent).toContain("Idle");
    expect(host.textContent).toContain("Last turn: Finished.");
    expect(host.textContent).toContain("Worktree");
    expect(host.textContent).toContain(WORKTREE);
    expect(host.textContent).toContain("5 minutes ago");
    expect(host.querySelector(".agent-info__word--done")).not.toBeNull();
  });

  it("counts the turns of the thread and how many run", () => {
    render({ thread: threadView({ status: { kind: "running" }, turnCount: 3 }) });

    expect(host.textContent).toContain("3 · 1 running");
  });

  it("stops a live thread and offers no archive or remove while it runs", () => {
    const onStop = vi.fn();
    render({ onStop, thread: threadView({ status: { kind: "running" } }) });

    click('[aria-label="Stop agent agt-1"]');

    expect(onStop).toHaveBeenCalledWith("agt-1");
    expect(host.querySelector('[aria-label="Archive thread agt-1"]')).toBeNull();
    expect(host.querySelector('[aria-label="Remove thread agt-1"]')).toBeNull();
  });

  it("offers show changes and a truthful discard for a thread that was not integrated", () => {
    const onShowChanges = vi.fn();
    const onRemoveWorktree = vi.fn();
    render({
      onRemoveWorktree,
      onShowChanges,
      thread: threadView({ status: { kind: "exited", exitCode: 0 } }),
    });

    click('[aria-label="Show changes for agent agt-1"]');
    click('[aria-label="Discard worktree for agent agt-1"]');

    expect(onShowChanges).toHaveBeenCalledWith("agt-1");
    expect(onRemoveWorktree).toHaveBeenCalledWith("agt-1");
    expect(
      host.querySelector('[aria-label="Discard worktree for agent agt-1"]')?.getAttribute("title"),
    ).toBe("The branch is kept; only the worktree directory is discarded.");
  });

  it("calls the worktree a removal once the branch was integrated", () => {
    render({
      thread: threadView({
        status: { kind: "exited", exitCode: 0 },
        ship: {
          kind: "integrated",
          status: null,
          mergeSha: "a".repeat(40),
          intoBranch: "main",
        },
      }),
    });

    expect(host.querySelector('[aria-label="Remove worktree for agent agt-1"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Discard worktree for agent agt-1"]')).toBeNull();
  });

  it("keeps the worktree action disabled while a removal is in flight", () => {
    render({
      thread: threadView({
        status: { kind: "exited", exitCode: 0 },
        changeSummary: summary({ removing: true }),
      }),
    });

    const button = host.querySelector<HTMLButtonElement>(
      '[aria-label="Discard worktree for agent agt-1"]',
    );

    expect(button?.disabled).toBe(true);
    expect(host.textContent).toContain("Removing…");
  });

  it("hides worktree review actions for an in-place thread", () => {
    render({
      thread: threadView({ status: { kind: "exited", exitCode: 0 }, isolation: "in-place" }),
    });

    expect(host.querySelector('[aria-label="Discard worktree for agent agt-1"]')).toBeNull();
    expect(host.textContent).toContain("In place");
  });

  it("hides review actions once the worktree was removed", () => {
    render({
      thread: threadView({ status: { kind: "exited", exitCode: 0 }, worktreeRemoved: true }),
    });

    expect(host.querySelector('[aria-label="Discard worktree for agent agt-1"]')).toBeNull();
  });

  it("warns when the worktree of the thread disappeared", () => {
    render({
      thread: threadView({ status: { kind: "exited", exitCode: 0 }, worktreeMissing: true }),
    });

    expect(host.textContent).toContain("The worktree for this thread no longer exists.");
  });

  it("archives and removes a settled thread", () => {
    const onArchive = vi.fn();
    const onRemove = vi.fn();
    render({
      onArchive,
      onRemove,
      thread: threadView({ status: { kind: "failed", message: "boom" } }),
    });

    click('[aria-label="Archive thread agt-1"]');
    click('[aria-label="Remove thread agt-1"]');

    expect(onArchive).toHaveBeenCalledWith("agt-1");
    expect(onRemove).toHaveBeenCalledWith("agt-1");
  });

  it("offers no second archive for an already archived thread", () => {
    render({ thread: threadView({ status: { kind: "stopped" }, archived: true }) });

    expect(host.textContent).toContain("Archived");
    expect(host.querySelector('[aria-label="Archive thread agt-1"]')).toBeNull();
    expect(host.querySelector('[aria-label="Remove thread agt-1"]')).not.toBeNull();
  });

  it("pins a running thread and unpins a pinned settled thread", () => {
    const onTogglePin = vi.fn();
    render({ onTogglePin, thread: threadView({ status: { kind: "running" } }) });

    click('[aria-label="Pin thread agt-1"]');

    expect(onTogglePin).toHaveBeenCalledWith("agt-1");
    expect(host.textContent).toContain("Pin thread");

    render({
      onTogglePin,
      thread: threadView({ status: { kind: "stopped" }, pinned: true }),
    });

    const unpin = host.querySelector('[aria-label="Unpin thread agt-1"]');
    expect(unpin?.getAttribute("aria-pressed")).toBe("true");
    click('[aria-label="Unpin thread agt-1"]');

    expect(onTogglePin).toHaveBeenCalledTimes(2);
  });

  it("offers no pin action while no thread is selected", () => {
    render({ thread: null });

    expect(host.querySelector('[aria-label^="Pin thread"]')).toBeNull();
  });

  it("names the model and mode of the latest turn of the selected thread", () => {
    render({
      thread: threadView({
        launch: { provider: "claudeCode", model: "sonnet", mode: "acceptEdits" },
        status: { kind: "exited", exitCode: 0 },
      }),
    });

    expect(host.textContent).toContain("launch");
    expect(host.textContent).toContain("Sonnet");
    expect(host.textContent).toContain("Accept edits");
    expect(host.querySelector(".agent-note--warning")).toBeNull();
  });

  it("warns in the info column when the latest turn bypassed the safety checks", () => {
    render({
      thread: threadView({
        launch: { provider: "codex", model: "gpt-5.5", mode: "dangerFullAccess" },
        status: { kind: "exited", exitCode: 0 },
      }),
    });

    expect(host.textContent).toContain("Full access");
    expect(host.querySelector(".agent-note--warning")?.textContent).toContain(
      "Bypasses permission checks",
    );
  });

  it("hides the launch section for a thread recorded before launch options existed", () => {
    render({ thread: threadView({ status: { kind: "exited", exitCode: 0 } }) });

    expect(host.textContent).not.toContain("launch");
  });

  it("previews the last used launch of the composer while no thread is selected", () => {
    render({
      thread: null,
      composerLaunch: { provider: "claudeCode", model: "opus", mode: "plan" },
    });

    expect(host.textContent).toContain("Opus");
    expect(host.textContent).toContain("Plan only");
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
    liveTaskCount: 0,
    maxConcurrentAgentTasks: 4,
    composerRepositoryLabel: "app",
    composerRepositoryRoot: ROOT,
    composerIsolationReason: null,
    composerLaunch: null,
    onStop: () => undefined,
    onArchive: () => undefined,
    onRemove: () => undefined,
    onShowChanges: () => undefined,
    onRemoveWorktree: () => undefined,
    onTogglePin: () => undefined,
  };
}

interface ThreadViewOptions {
  readonly status?: AgentTurnStatus;
  readonly isolation?: AgentTaskIsolation;
  readonly worktreeRemoved?: boolean;
  readonly worktreeMissing?: boolean;
  readonly changeSummary?: AgentTaskChangeSummary | null;
  readonly pinned?: boolean;
  readonly archived?: boolean;
  readonly turnCount?: number;
  readonly ship?: AgentShipState;
  readonly launch?: AgentLaunchOptions | null;
}

function threadView(overrides: ThreadViewOptions): AgentThreadView {
  const isolation = overrides.isolation ?? "worktree";
  const status = overrides.status ?? { kind: "running" };
  const archived = overrides.archived ?? false;
  const running = status.kind === "pending" || status.kind === "running";
  const turnCount = overrides.turnCount ?? 1;
  const thread: AgentThread = {
    threadId: "agt-1",
    owner: { rootKey: ROOT, ownerId: "agent-root:app", repositoryRoot: ROOT },
    target: { isolation, worktreePath: isolation === "worktree" ? WORKTREE : null },
    provider: { kind: "claudeCode", sessionId: "session-abcdefgh" },
    title: "Refactor the parser",
    pinned: overrides.pinned ?? false,
    archived,
    createdAtEpochMs: NOW - 5 * 60_000,
    updatedAtEpochMs: NOW - 5 * 60_000,
    turns: Array.from({ length: turnCount }, (_unused, index) => ({
      turnId: `agt-1-t${index}`,
      prompt: "Refactor the parser",
      status: index === turnCount - 1 ? status : ({ kind: "exited", exitCode: 0 } as const),
      startedAtEpochMs: NOW - 5 * 60_000,
      endedAtEpochMs: null,
      events: [],
      eventsTruncated: false,
      lastStatusSequence: 0,
      lastOutputSequence: 0,
      launch: overrides.launch ?? null,
    })),
    turnsTruncated: false,
    viewedAtEpochMs: null,
    integration: null,
  };

  return {
    ship: overrides.ship ?? { kind: "idle", status: null, loadingStatus: false },
    editorAvailability: { kind: "available" },
    attention: agentThreadAttention(thread),
    unread: agentThreadUnread(thread),
    thread,
    lifecycle: archived ? "archived" : running ? "running" : "settled",
    repositoryLabel: "app",
    projectOrigin: "active-tab",
    worktreeRemoved: overrides.worktreeRemoved ?? false,
    worktreeMissing: overrides.worktreeMissing ?? false,
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
