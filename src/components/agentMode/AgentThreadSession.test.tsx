// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTaskChangeSummary, AgentThreadView } from "../../application/agentThreadPorts";
import type {
  AgentThread,
  AgentTurn,
  AgentTurnEvent,
  AgentTurnStatus,
} from "../../domain/agentThread";
import type { GitChangedFile } from "../../domain/git";
import { AgentThreadSession, type AgentThreadSessionProps } from "./AgentThreadSession";
import { MAX_RENDERED_EVENTS_PER_TURN } from "./agentModePresentation";

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

  it("heads the session with the repository, the title and the lifecycle", () => {
    render({ thread: threadView({ status: { kind: "running" } }) });

    expect(host.querySelector(".agent-session__repo")?.textContent).toBe("app");
    expect(host.querySelector(".agent-session__title")?.textContent).toBe("Refactor the parser");
    expect(host.querySelector(".agent-session__status--running")?.textContent).toContain("Running");
  });

  it("renders one turn per prompt with its assistant paragraphs", () => {
    render({
      thread: threadView({
        turns: [
          turn("agt-1-t1", "Refactor the parser", { kind: "exited", exitCode: 0 }, [
            { kind: "assistantText", text: "First paragraph.\n\nSecond paragraph." },
          ]),
          turn("agt-1-t2", "Also update the tests", { kind: "running" }, [
            { kind: "assistantText", text: "Working on it." },
          ]),
        ],
      }),
    });

    expect(host.querySelectorAll("article.agent-turn")).toHaveLength(2);
    expect(host.querySelectorAll(".agent-prompt__body")[1]?.textContent).toBe(
      "Also update the tests",
    );
    expect(
      [...host.querySelectorAll(".agent-text__paragraph")].map((element) => element.textContent),
    ).toEqual(["First paragraph.", "Second paragraph.", "Working on it."]);
  });

  it("pairs a tool call with the result of the same tool id", () => {
    render({
      thread: threadView({
        turns: [
          turn("agt-1-t1", "Refactor the parser", { kind: "running" }, [
            { kind: "toolCall", toolId: "t-1", name: "Read", inputSummary: "src/parser.ts" },
            { kind: "toolCall", toolId: "t-2", name: "Bash", inputSummary: "npm test" },
            { kind: "toolResult", toolId: "t-1", outputSummary: "42 lines", isError: false },
            { kind: "toolResult", toolId: "t-2", outputSummary: "exit 1", isError: true },
          ]),
        ],
      }),
    });

    const rows = [...host.querySelectorAll(".agent-tool")];

    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain("Read");
    expect(rows[0]?.textContent).toContain("src/parser.ts");
    expect(rows[0]?.querySelector(".agent-tool__status--ok")).not.toBeNull();
    expect(rows[1]?.querySelector(".agent-tool__status--bad")).not.toBeNull();
  });

  it("keeps a tool call without a result visible as running", () => {
    render({
      thread: threadView({
        turns: [
          turn("agt-1-t1", "Refactor the parser", { kind: "running" }, [
            { kind: "toolCall", toolId: "t-1", name: "Bash", inputSummary: "npm test" },
          ]),
        ],
      }),
    });

    expect(host.querySelector(".agent-tool__status")?.textContent).toBe("running");
    expect(host.querySelector(".agent-tool__status--ok")).toBeNull();
  });

  it("collapses reasoning and raw output instead of dumping them", () => {
    render({
      thread: threadView({
        turns: [
          turn("agt-1-t1", "Refactor the parser", { kind: "running" }, [
            { kind: "reasoning", text: "Considering the grammar." },
            { kind: "unknownLine", stream: "stderr", raw: "npm warn deprecated", clipped: false },
          ]),
        ],
      }),
    });

    const reasoning = host.querySelector("details.agent-reasoning");
    const raw = host.querySelector("details.agent-raw");

    expect(reasoning?.querySelector("summary")?.textContent).toBe("reasoning");
    expect((reasoning as HTMLDetailsElement | null)?.open).toBe(false);
    expect(raw?.querySelector("summary")?.textContent).toBe("raw output");
    expect(raw?.textContent).toContain("npm warn deprecated");
  });

  it("renders the result as a finale and an error as a bad finale", () => {
    render({
      thread: threadView({
        turns: [
          turn("agt-1-t1", "Refactor the parser", { kind: "exited", exitCode: 0 }, [
            { kind: "error", message: "The MCP server refused the token." },
            { kind: "result", text: "Done in 4 files.", isError: false, usage: null },
          ]),
        ],
      }),
    });

    expect(host.textContent).toContain("Done in 4 files.");
    expect(host.textContent).toContain("The MCP server refused the token.");
    expect(host.querySelectorAll(".agent-finale--bad")).toHaveLength(1);
  });

  it("renders only the last rendered-events window and counts the hidden ones", () => {
    const events: AgentTurnEvent[] = Array.from(
      { length: MAX_RENDERED_EVENTS_PER_TURN + 7 },
      (_unused, index) => ({ kind: "assistantText", text: `line ${index}` }),
    );
    render({
      thread: threadView({
        turns: [turn("agt-1-t1", "Refactor the parser", { kind: "running" }, events)],
      }),
    });

    expect(host.querySelectorAll(".agent-text")).toHaveLength(MAX_RENDERED_EVENTS_PER_TURN);
    expect(host.textContent).toContain("7 earlier events hidden");
    expect(host.querySelector(".agent-text__paragraph")?.textContent).toBe("line 7");
  });

  it("reports a bounded turn instead of pretending the output is complete", () => {
    render({
      thread: threadView({
        turns: [
          {
            ...turn("agt-1-t1", "Refactor the parser", { kind: "exited", exitCode: 0 }, []),
            eventsTruncated: true,
          },
        ],
      }),
    });

    expect(host.textContent).toContain("Later output was dropped to bound memory.");
  });

  it("says when a turn was interrupted by an app restart", () => {
    render({
      thread: threadView({
        turns: [turn("agt-1-t1", "Refactor the parser", { kind: "interrupted" }, [])],
      }),
    });

    expect(host.textContent).toContain("Interrupted by app restart");
  });

  it("waits for output without pretending the stream is empty", () => {
    render({ thread: threadView({ status: { kind: "pending" } }) });

    expect(host.textContent).toContain("Waiting for output…");
  });

  it("renders the failure message of a failed turn", () => {
    render({
      thread: threadView({ status: { kind: "failed", message: "Agent CLI exited with code 1." } }),
    });

    expect(host.textContent).toContain("Agent CLI exited with code 1.");
  });

  it("tells the user when the worktree was removed or disappeared", () => {
    render({ thread: threadView({ worktreeRemoved: true }) });

    expect(host.textContent).toContain("The worktree was removed. Its branch was kept.");

    render({ thread: threadView({ worktreeMissing: true }) });

    expect(host.textContent).toContain("The worktree for this thread no longer exists.");
  });

  it("reports dropped turns instead of hiding them", () => {
    render({ thread: threadView({ turnsTruncated: true }) });

    expect(host.textContent).toContain("Earlier turns were dropped to bound memory.");
  });

  it("lists changed files and opens a file diff", () => {
    const onShowFileDiff = vi.fn();
    render({
      onShowFileDiff,
      thread: threadView({ changeSummary: summary({ files: [changedFile("src/app.ts")] }) }),
    });

    expect(host.textContent).toContain("src/app.ts");
    clickText("src/app.ts");

    expect(onShowFileDiff).toHaveBeenCalledTimes(1);
    expect(onShowFileDiff.mock.calls[0]?.[0]).toBe("agt-1");
  });

  it("reports an empty, truncated or failing change summary truthfully", () => {
    render({ thread: threadView({ changeSummary: summary({ files: [] }) }) });

    expect(host.textContent).toContain("The agent left no uncommitted changes.");

    render({
      thread: threadView({
        changeSummary: summary({ files: [changedFile("a.ts")], truncated: true }),
      }),
    });

    expect(host.textContent).toContain("More changed files exist than are listed here.");

    render({
      thread: threadView({ changeSummary: summary({ error: "Reading the worktree failed." }) }),
    });

    expect(host.textContent).toContain("Reading the worktree failed.");
  });

  it("hides and refreshes the change summary", () => {
    const onHideChanges = vi.fn();
    const onRefreshChanges = vi.fn();
    render({
      onHideChanges,
      onRefreshChanges,
      thread: threadView({ changeSummary: summary({ files: [changedFile("a.ts")] }) }),
    });

    click('[aria-label="Refresh changes for agent agt-1"]');
    click('[aria-label="Hide changes for agent agt-1"]');

    expect(onRefreshChanges).toHaveBeenCalledWith("agt-1");
    expect(onHideChanges).toHaveBeenCalledWith("agt-1");
  });

  it("renders both diff sides with their bounded-state notices", () => {
    render({
      thread: threadView({
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

  it("re-renders no turn body when only the clock ticks", () => {
    const renders: string[] = [];
    const probe = (turnId: string): void => {
      renders.push(turnId);
    };
    const view = threadView({
      turns: [
        turn("agt-1-t1", "Refactor the parser", { kind: "exited", exitCode: 0 }, []),
        turn("agt-1-t2", "Also update the tests", { kind: "running" }, []),
      ],
    });
    render({ now: NOW, thread: view, turnRenderProbe: probe });

    expect(renders).toHaveLength(2);

    for (let tick = 1; tick <= 500; tick += 1) {
      render({ now: NOW + tick * 100, thread: view, turnRenderProbe: probe });
    }

    expect(renders).toHaveLength(2);
  });

  it("re-renders only the turn whose output changed while chunks stream in", () => {
    const renders: string[] = [];
    const probe = (turnId: string): void => {
      renders.push(turnId);
    };
    const settled = Array.from({ length: 5 }, (_unused, index) =>
      turn(`agt-1-s${index}`, "Settled", { kind: "exited", exitCode: 0 }, []),
    );
    const events: AgentTurnEvent[] = [];
    const running = (): AgentTurn => ({
      ...turn("agt-1-run", "Refactor the parser", { kind: "running" }, [...events]),
    });
    render({ thread: threadView({ turns: [...settled, running()] }), turnRenderProbe: probe });

    expect(renders).toHaveLength(6);
    renders.length = 0;

    for (let chunk = 0; chunk < 200; chunk += 1) {
      events.push({ kind: "assistantText", text: `chunk ${chunk}` });
      render({ thread: threadView({ turns: [...settled, running()] }), turnRenderProbe: probe });
    }

    expect(renders.filter((turnId) => turnId !== "agt-1-run")).toEqual([]);
    expect(renders).toHaveLength(200);
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

interface ThreadViewOptions {
  readonly status?: AgentTurnStatus;
  readonly turns?: ReadonlyArray<AgentTurn>;
  readonly turnsTruncated?: boolean;
  readonly worktreeRemoved?: boolean;
  readonly worktreeMissing?: boolean;
  readonly changeSummary?: AgentTaskChangeSummary | null;
}

function threadView(overrides: ThreadViewOptions): AgentThreadView {
  const status = overrides.status ?? { kind: "exited", exitCode: 0 };
  const turns = overrides.turns ?? [turn("agt-1-t1", "Refactor the parser", status, [])];
  const last = turns[turns.length - 1];
  const running = last?.status.kind === "pending" || last?.status.kind === "running";
  const thread: AgentThread = {
    threadId: "agt-1",
    owner: { rootKey: ROOT, ownerId: "agent-root:app", repositoryRoot: ROOT },
    target: { isolation: "worktree", worktreePath: WORKTREE },
    provider: { kind: "claudeCode", sessionId: "session-abcdefgh" },
    title: "Refactor the parser",
    pinned: false,
    archived: false,
    createdAtEpochMs: NOW - 5 * 60_000,
    updatedAtEpochMs: NOW - 5 * 60_000,
    turns,
    turnsTruncated: overrides.turnsTruncated ?? false,
  };

  return {
    thread,
    lifecycle: running ? "running" : "settled",
    repositoryLabel: "app",
    projectOrigin: "active-tab",
    worktreeRemoved: overrides.worktreeRemoved ?? false,
    worktreeMissing: overrides.worktreeMissing ?? false,
    changeSummary: overrides.changeSummary ?? null,
  };
}

function turn(
  turnId: string,
  prompt: string,
  status: AgentTurnStatus,
  events: ReadonlyArray<AgentTurnEvent>,
): AgentTurn {
  return {
    turnId,
    prompt,
    status,
    startedAtEpochMs: NOW - 5 * 60_000,
    endedAtEpochMs: null,
    events,
    eventsTruncated: false,
    lastStatusSequence: 0,
    lastOutputSequence: 0,
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
