// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTaskChangeSummary, AgentTaskView } from "../../application/useAgentTasks";
import type { AgentTaskRecord } from "../../domain/agentTask";
import type { GitChangedFile } from "../../domain/git";
import { AgentThreadSession, type AgentThreadSessionProps } from "./AgentThreadSession";

const ROOT = "/workspace/app";
const WORKTREE = `${ROOT}/.worktrees/agt-1`;
const NOW = 1_700_000_600_000;

describe("AgentThreadSession", () => {
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

  it("invites a new thread when nothing is selected", () => {
    render({ thread: null });

    expect(host.textContent).toContain("Start a thread in app");
    expect(host.querySelector('section[aria-label="New agent thread"]')).not.toBeNull();
  });

  it("names the missing repository instead of inventing one", () => {
    render({ thread: null, composerRepositoryLabel: null });

    expect(host.textContent).toContain("No Git repository detected");
  });

  it("shows the prompt, the live output stream and a caret while running", () => {
    render({ thread: threadView({ status: { kind: "running" }, outputTail: "compiling…" }) });

    expect(host.textContent).toContain("Refactor the parser");
    expect(host.textContent).toContain("compiling…");
    expect(host.querySelector(".agent-session__status--running")?.textContent).toContain("Running");
    expect(host.querySelector(".agent-well__caret")).not.toBeNull();
  });

  it("drops the caret and reports truncation once the run is terminal", () => {
    render({
      thread: threadView({
        status: { kind: "exited", exitCode: 0 },
        outputTail: "done",
        outputTruncated: true,
        terminal: true,
      }),
    });

    expect(host.querySelector(".agent-well__caret")).toBeNull();
    expect(host.textContent).toContain("Earlier output was dropped to bound memory.");
  });

  it("waits for output without pretending the stream is empty", () => {
    render({ thread: threadView({ status: { kind: "pending" } }) });

    expect(host.textContent).toContain("Waiting for output…");
  });

  it("renders the failure message of a failed run", () => {
    render({
      thread: threadView({
        status: { kind: "failed", message: "Agent CLI exited with code 1." },
        terminal: true,
      }),
    });

    expect(host.textContent).toContain("Agent CLI exited with code 1.");
  });

  it("tells the user when the worktree was removed", () => {
    render({
      thread: threadView({
        status: { kind: "exited", exitCode: 0 },
        terminal: true,
        worktreeRemoved: true,
      }),
    });

    expect(host.textContent).toContain("The worktree was removed. Its branch was kept.");
  });

  it("lists changed files and opens a file diff", () => {
    const onShowFileDiff = vi.fn();
    render({
      onShowFileDiff,
      thread: threadView({
        status: { kind: "exited", exitCode: 0 },
        terminal: true,
        changeSummary: summary({ files: [changedFile("src/app.ts")] }),
      }),
    });

    expect(host.textContent).toContain("src/app.ts");
    clickText("src/app.ts");

    expect(onShowFileDiff).toHaveBeenCalledTimes(1);
    expect(onShowFileDiff.mock.calls[0]?.[0]).toBe("agt-1");
  });

  it("reports an empty, truncated or failing change summary truthfully", () => {
    render({
      thread: threadView({
        status: { kind: "exited", exitCode: 0 },
        terminal: true,
        changeSummary: summary({ files: [] }),
      }),
    });

    expect(host.textContent).toContain("The agent left no uncommitted changes.");

    render({
      thread: threadView({
        status: { kind: "exited", exitCode: 0 },
        terminal: true,
        changeSummary: summary({ files: [changedFile("a.ts")], truncated: true }),
      }),
    });

    expect(host.textContent).toContain("Only the first 500 changed files are listed.");

    render({
      thread: threadView({
        status: { kind: "exited", exitCode: 0 },
        terminal: true,
        changeSummary: summary({ error: "Reading the worktree failed." }),
      }),
    });

    expect(host.textContent).toContain("Reading the worktree failed.");
  });

  it("hides and refreshes the change summary", () => {
    const onHideChanges = vi.fn();
    const onRefreshChanges = vi.fn();
    render({
      onHideChanges,
      onRefreshChanges,
      thread: threadView({
        status: { kind: "exited", exitCode: 0 },
        terminal: true,
        changeSummary: summary({ files: [changedFile("a.ts")] }),
      }),
    });

    click('[aria-label="Refresh changes for agent agt-1"]');
    click('[aria-label="Hide changes for agent agt-1"]');

    expect(onRefreshChanges).toHaveBeenCalledWith("agt-1");
    expect(onHideChanges).toHaveBeenCalledWith("agt-1");
  });

  it("renders both diff sides with their bounded-state notices", () => {
    render({
      thread: threadView({
        status: { kind: "exited", exitCode: 0 },
        terminal: true,
        changeSummary: summary({
          files: [changedFile("a.ts")],
          diff: {
            relativePath: "a.ts",
            loading: false,
            error: null,
            original: { text: "before", truncated: false },
            modified: { text: "after", truncated: true },
            unavailableReason: null,
          },
        }),
      }),
    });

    expect(host.textContent).toContain("before");
    expect(host.textContent).toContain("after");
    expect(host.textContent).toContain("This side was truncated to stay bounded.");
  });

  it("explains a diff that cannot be previewed", () => {
    render({
      thread: threadView({
        status: { kind: "exited", exitCode: 0 },
        terminal: true,
        changeSummary: summary({
          files: [changedFile("a.bin")],
          diff: {
            relativePath: "a.bin",
            loading: false,
            error: null,
            original: { text: "", truncated: false },
            modified: { text: "", truncated: false },
            unavailableReason: "binary",
          },
        }),
      }),
    });

    expect(host.textContent).toContain("This file is binary, so no text diff is shown.");
  });

  function render(overrides: Partial<AgentThreadSessionProps> = {}): void {
    act(() => root.render(<AgentThreadSession {...defaultProps()} {...overrides} />));
  }

  function click(selector: string): void {
    const element = host.querySelector<HTMLElement>(selector);
    expect(element).not.toBeNull();
    act(() => element?.click());
  }

  function clickText(text: string): void {
    const element = [...host.querySelectorAll("button")].find((candidate) =>
      (candidate.textContent ?? "").includes(text),
    );
    expect(element).toBeDefined();
    act(() => element?.click());
  }
});

function defaultProps(): AgentThreadSessionProps {
  return {
    thread: threadView({}),
    composerRepositoryLabel: "app",
    now: NOW,
    onHideChanges: () => undefined,
    onHideFileDiff: () => undefined,
    onRefreshChanges: () => undefined,
    onShowFileDiff: () => undefined,
  };
}

function threadView(overrides: {
  readonly status?: AgentTaskRecord["status"];
  readonly outputTail?: string;
  readonly outputTruncated?: boolean;
  readonly terminal?: boolean;
  readonly worktreeRemoved?: boolean;
  readonly changeSummary?: AgentTaskChangeSummary | null;
}): AgentTaskView {
  return {
    record: {
      owner: { taskId: "agt-1", workspaceId: "workspace-a", repositoryRoot: ROOT },
      isolation: "worktree",
      worktreePath: WORKTREE,
      prompt: "Refactor the parser",
      status: overrides.status ?? { kind: "running" },
      outputTail: overrides.outputTail ?? "",
      outputTruncated: overrides.outputTruncated ?? false,
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

function changedFile(relativePath: string): GitChangedFile {
  return {
    isStaged: false,
    isUnversioned: false,
    oldPath: null,
    oldRelativePath: null,
    path: `${WORKTREE}/${relativePath}`,
    relativePath,
    status: "modified",
  };
}
