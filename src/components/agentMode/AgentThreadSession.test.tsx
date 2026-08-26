// @vitest-environment jsdom

import { agentThreadAttention, agentThreadUnread } from "../../domain/agentThread";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTaskChangeSummary, AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentLaunchOptions } from "../../domain/agentLaunch";
import type {
  AgentThread,
  AgentTurn,
  AgentTurnEvent,
  AgentTurnStatus,
} from "../../domain/agentThread";
import type { AgentThreadFindHit } from "../../domain/agentThreadSearch";
import type { GitChangedFile } from "../../domain/git";
import type { AgentThreadRevealRequest } from "./agentSidebarPresentation";
import { AgentThreadSession, type AgentThreadSessionProps } from "./AgentThreadSession";
import { AgentClockProvider } from "./agentClock";
import { MAX_RENDERED_EVENTS_PER_TURN } from "./agentModePresentation";

const ROOT = "/workspace/app";
const WORKTREE = `${ROOT}/.worktrees/agt-1`;
const NOW = 1_700_000_600_000;

describe("AgentThreadSession", () => {
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

  it("invites a new thread when nothing is selected", () => {
    render({ thread: null });

    expect(host.textContent).toContain("Start a thread in app");
    expect(host.querySelector('section[aria-label="New agent thread"]')).not.toBeNull();
  });

  it("names the missing repository instead of inventing one", () => {
    render({ thread: null, composerRepositoryLabel: null });

    expect(host.textContent).toContain("No Git repository detected");
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

  it("records the model and mode of a turn in its prompt meta line", () => {
    render({
      thread: threadView({
        turns: [
          turn("agt-1-t1", "Refactor the parser", { kind: "exited", exitCode: 0 }, [], {
            provider: "claudeCode",
            model: "opus",
            mode: "acceptEdits",
            effort: "default",
          }),
        ],
      }),
    });

    const meta = host.querySelector(".agent-prompt__meta");

    expect(meta?.textContent).toContain("opus");
    expect(meta?.textContent).toContain("accept edits");
    expect(host.querySelector(".agent-prompt__launch--plan")).toBeNull();
    expect(host.querySelector(".agent-prompt__launch--danger")).toBeNull();
  });

  it("badges a plan turn and a turn that bypassed the permission checks", () => {
    render({
      thread: threadView({
        turns: [
          turn("agt-1-t1", "Plan it", { kind: "exited", exitCode: 0 }, [], {
            provider: "claudeCode",
            model: "opus",
            mode: "plan",
            effort: "default",
          }),
          turn("agt-1-t2", "Do it", { kind: "exited", exitCode: 0 }, [], {
            provider: "codex",
            model: "gpt-5.5",
            mode: "dangerFullAccess",
          }),
        ],
      }),
    });

    expect(host.querySelector(".agent-prompt__launch--plan")?.textContent).toBe("plan only");
    expect(host.querySelector(".agent-prompt__launch--danger")?.textContent).toBe("full access");
  });

  it("shows no launch meta for a turn recorded before launch options existed", () => {
    render({ thread: threadView({}) });

    expect(host.querySelector(".agent-prompt__launch")).toBeNull();
    expect(host.querySelector(".agent-prompt__cli")).toBeNull();
  });

  it("shows the CLI version a turn ran with and stays quiet when it is unknown", () => {
    render({
      thread: threadView({
        turns: [
          {
            ...turn("agt-1-t1", "Plan it", { kind: "exited", exitCode: 0 }, []),
            cliVersion: "2.1.245",
          },
          turn("agt-1-t2", "Do it", { kind: "exited", exitCode: 0 }, []),
        ],
      }),
    });

    const versions = Array.from(host.querySelectorAll(".agent-prompt__cli"));
    expect(versions.map((node) => node.textContent)).toEqual(["claude 2.1.245"]);
    expect(versions[0]?.closest("[data-agent-turn]")?.getAttribute("data-agent-turn")).toBe(
      "agt-1-t1",
    );
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

  it("replaces the inline change list with a single review cue that opens the Diff surface", () => {
    const onReviewInDiff = vi.fn();
    render({
      onReviewInDiff,
      thread: threadView({
        changeSummary: summary({ files: [changedFile("src/a.ts"), changedFile("src/b.ts")] }),
      }),
    });

    expect(host.querySelector(".agent-session__head")).toBeNull();
    expect(host.querySelector('section[aria-label="Ship agent agt-1"]')).toBeNull();
    expect(host.querySelector(".agent-changes")).toBeNull();
    expect(host.querySelector("[data-agent-changes-cue]")?.textContent).toContain(
      "2 files changed",
    );
    clickText("Review in Diff");

    expect(onReviewInDiff).toHaveBeenCalledWith("agt-1");
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
    render({ thread: view, turnRenderProbe: probe });

    expect(renders).toHaveLength(2);

    for (let tick = 1; tick <= 500; tick += 1) {
      act(() => {
        vi.setSystemTime(NOW + tick * 100);
        vi.advanceTimersByTime(1);
      });
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

  it("marks every find hit in the prompt and the assistant text", () => {
    render(withFind({ findHitIndex: 0 }));

    expect(
      [...host.querySelectorAll("mark.agent-find__hit")].map((node) => node.textContent),
    ).toEqual(["parser", "parser", "parser", "parser"]);
  });

  it("marks only the current hit as current", () => {
    render(withFind({ findHitIndex: 1 }));

    const current = host.querySelectorAll("mark.agent-find__hit--current");
    expect(current).toHaveLength(1);
    expect(current[0]?.getAttribute("data-hit-index")).toBe("1");
    expect(current[0]?.closest("[data-agent-turn]")?.getAttribute("data-agent-turn")).toBe(
      "agt-1-t1",
    );
  });

  it("moves the current mark into the assistant paragraph that owns the hit", () => {
    render(withFind({ findHitIndex: 2 }));

    const current = host.querySelector("mark.agent-find__hit--current");
    expect(current?.closest("[data-agent-event]")?.getAttribute("data-agent-event")).toBe("e0");
    expect(current?.getAttribute("data-hit-index")).toBe("0");
  });

  it("scrolls the current hit into view", () => {
    const scrolled = stubScrollIntoView();

    render(withFind({ findHitIndex: 3 }));

    expect(scrolled).toHaveLength(1);
    expect((scrolled[0] as HTMLElement).className).toContain("agent-find__hit--current");
  });

  it("never highlights a query below the searchable minimum", () => {
    render(withFind({ findQuery: "p", findHitIndex: 0 }));

    expect(host.querySelectorAll("mark.agent-find__hit")).toHaveLength(0);
    expect(host.querySelector(".agent-prompt__body")?.textContent).toBe("parser and parser");
  });

  it("reveals a turn whose events were dropped from the rendered projection", () => {
    const scrolled = stubScrollIntoView();
    const events: AgentTurnEvent[] = Array.from(
      { length: MAX_RENDERED_EVENTS_PER_TURN + 4 },
      (_unused, index) => ({ kind: "assistantText", text: `chunk ${index}` }),
    );

    render({
      thread: threadView({
        turnsTruncated: true,
        turns: [turn("agt-1-t9", "Refactor the parser", { kind: "exited", exitCode: 0 }, events)],
      }),
      reveal: reveal({ turnId: "agt-1-t9", eventIndex: 0 }),
    });

    expect(scrolled).toHaveLength(1);
    expect((scrolled[0] as HTMLElement).getAttribute("data-agent-turn")).toBe("agt-1-t9");
  });

  it("scrolls the exact event of a reveal when it is rendered", () => {
    const scrolled = stubScrollIntoView();

    render({
      thread: threadView({
        turns: [
          turn("agt-1-t1", "Refactor the parser", { kind: "exited", exitCode: 0 }, [
            { kind: "assistantText", text: "First." },
            { kind: "assistantText", text: "Second." },
          ]),
        ],
      }),
      reveal: reveal({ turnId: "agt-1-t1", eventIndex: 1 }),
    });

    expect(scrolled).toHaveLength(1);
    expect((scrolled[0] as HTMLElement).getAttribute("data-agent-event")).toBe("e1");
  });

  it("ignores a reveal for a turn that is no longer in the thread", () => {
    const scrolled = stubScrollIntoView();

    render({ reveal: reveal({ turnId: "agt-1-gone", eventIndex: null }) });

    expect(scrolled).toHaveLength(0);
  });

  it("re-renders only the turns whose highlight changed when the current hit moves", () => {
    const renders: string[] = [];
    const probe = (turnId: string): void => {
      renders.push(turnId);
    };
    const view = findThreadView();

    render({
      thread: view,
      turnRenderProbe: probe,
      findQuery: FIND_QUERY,
      findHits: FIND_HITS,
      findHitIndex: 0,
    });
    expect(renders).toHaveLength(2);
    renders.length = 0;

    render({
      thread: view,
      turnRenderProbe: probe,
      findQuery: FIND_QUERY,
      findHits: FIND_HITS,
      findHitIndex: 1,
    });
    expect(renders).toEqual(["agt-1-t1"]);
    renders.length = 0;

    render({
      thread: view,
      turnRenderProbe: probe,
      findQuery: FIND_QUERY,
      findHits: FIND_HITS,
      findHitIndex: 3,
    });
    expect(renders.slice().sort()).toEqual(["agt-1-t1", "agt-1-t2"]);
  });

  it("leaves every turn untouched while no query is active", () => {
    const renders: string[] = [];
    const probe = (turnId: string): void => {
      renders.push(turnId);
    };
    const view = findThreadView();

    render({ thread: view, turnRenderProbe: probe });
    renders.length = 0;

    render({ thread: view, turnRenderProbe: probe });

    expect(renders).toEqual([]);
  });

  function stubScrollIntoView(): Element[] {
    const scrolled: Element[] = [];
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: function scrollIntoView(this: Element): void {
        scrolled.push(this);
      },
      writable: true,
    });
    return scrolled;
  }

  function withFind(overrides: Partial<AgentThreadSessionProps>): Partial<AgentThreadSessionProps> {
    return {
      thread: findThreadView(),
      findQuery: FIND_QUERY,
      findHits: FIND_HITS,
      ...overrides,
    };
  }

  function render(overrides: Partial<AgentThreadSessionProps> = {}): void {
    act(() =>
      root.render(
        <AgentClockProvider nowTickMs={1}>
          <AgentThreadSession {...defaultProps()} {...overrides} />
        </AgentClockProvider>,
      ),
    );
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
    onReviewInDiff: () => undefined,
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
    viewedAtEpochMs: null,
    integration: null,
  };

  return {
    ship: { kind: "idle", status: null, loadingStatus: false },
    editorAvailability: { kind: "available" },
    attention: agentThreadAttention(thread),
    unread: agentThreadUnread(thread),
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
  launch: AgentLaunchOptions | null = null,
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
    launch,
    cliVersion: null,
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

const FIND_QUERY = "parser";

const FIND_HITS: ReadonlyArray<AgentThreadFindHit> = [
  { turnId: "agt-1-t1", eventIndex: null, start: 0, end: 6 },
  { turnId: "agt-1-t1", eventIndex: null, start: 11, end: 17 },
  { turnId: "agt-1-t1", eventIndex: 0, start: 4, end: 10 },
  { turnId: "agt-1-t2", eventIndex: null, start: 0, end: 6 },
];

const FIND_TURNS: ReadonlyArray<AgentTurn> = [
  turn("agt-1-t1", "parser and parser", { kind: "exited", exitCode: 0 }, [
    { kind: "assistantText", text: "the parser is ready.\n\nnothing else here." },
  ]),
  turn("agt-1-t2", "parser again", { kind: "exited", exitCode: 0 }, []),
];

let findThreadViewCache: AgentThreadView | null = null;

function findThreadView(): AgentThreadView {
  findThreadViewCache = findThreadViewCache ?? threadView({ turns: [...FIND_TURNS] });
  return findThreadViewCache;
}

function reveal(overrides: {
  readonly turnId: string;
  readonly eventIndex: number | null;
}): AgentThreadRevealRequest {
  return { query: FIND_QUERY, start: 0, end: 6, ...overrides };
}
