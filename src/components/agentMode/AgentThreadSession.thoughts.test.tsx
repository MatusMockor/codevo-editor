// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  agentThreadAttention,
  agentThreadsReducer,
  agentThreadUnread,
  type AgentThread,
  type AgentThreadsState,
  type AgentTurn,
  type AgentTurnEvent,
  type AgentTurnStatus,
} from "../../domain/agentThread";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import { AgentThreadSession } from "./AgentThreadSession";
import { AgentClockProvider } from "./agentClock";
import { loadAgentMarkdownRenderer } from "../../infrastructure/markdown/agentMarkdownRendererAdapter";

const ROOT = "/workspace/app";
const WORKTREE = `${ROOT}/.worktrees/agt-1`;
const NOW = 1_700_000_600_000;
const THREAD_ID = "agt-1";
const TURN_ID = "agt-1-t1";
const SETTLED: AgentTurnStatus = { kind: "exited", exitCode: 0 };
const RUNNING: AgentTurnStatus = { kind: "running" };

const MARKDOWN_THOUGHT = "## Plan\n\n- inspect **parser** state\n- run `npm test`";

function command(toolId: string, input: string): ReadonlyArray<AgentTurnEvent> {
  return [
    { kind: "toolCall", toolId, name: "Bash", inputSummary: input },
    { kind: "toolResult", toolId, outputSummary: "ok", isError: false },
  ];
}

const TOOL_THOUGHT_TOOL: ReadonlyArray<AgentTurnEvent> = [
  ...command("t-1", "npm run lint"),
  { kind: "reasoning", text: MARKDOWN_THOUGHT },
  ...command("t-2", "npm test"),
];

describe("AgentThreadSession reasoning", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeAll(async () => {
    await loadAgentMarkdownRenderer();
  });

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

  it("joins reasoning into the surrounding tool group and lists it chronologically", () => {
    render(
      viewOf(turnOf(SETTLED, [...TOOL_THOUGHT_TOOL, { kind: "assistantText", text: "Done" }])),
    );

    const groups = host.querySelectorAll(".agent-activity-group");
    expect(groups).toHaveLength(1);
    expect(groupLabel()).toBe("Ran 2 commands");
    expect(host.querySelector(".agent-thought")).toBeNull();

    toggleGroup();

    const rows = [
      ...host.querySelectorAll<HTMLElement>(
        ".agent-activity-group__items > .agent-tool-row, .agent-activity-group__items > .agent-thought",
      ),
    ];
    expect(rows.map((row) => row.className.split(" ")[0])).toEqual([
      "agent-tool-row",
      "agent-thought",
      "agent-tool-row",
    ]);
  });

  it("shows a collapsed thought row with a plain single-line preview and no body", () => {
    render(viewOf(turnOf(SETTLED, TOOL_THOUGHT_TOOL)));
    toggleGroup();

    const toggle = thoughtToggle();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.querySelector(".agent-thought__label")?.textContent).toBe("Thought");
    expect(toggle.querySelector(".agent-thought__preview")?.textContent).toBe(
      "Plan inspect parser state run npm test",
    );
    expect(host.querySelector(".agent-thought__body")).toBeNull();
    expect(host.querySelector("details.agent-reasoning")).toBeNull();
  });

  it("renders the expanded thought through the agent markdown pipeline", () => {
    render(viewOf(turnOf(SETTLED, TOOL_THOUGHT_TOOL)));
    toggleGroup();

    act(() => thoughtToggle().click());

    const body = host.querySelector<HTMLElement>(".agent-thought__body");
    expect(thoughtToggle().getAttribute("aria-expanded")).toBe("true");
    expect(thoughtToggle().querySelector(".agent-thought__preview")).toBeNull();
    expect(body?.getAttribute("data-agent-markdown")).toBe("rendered");
    expect(body?.querySelector("h2")?.textContent).toBe("Plan");
    expect(body?.querySelector("strong")?.textContent).toBe("parser");
    expect(body?.querySelectorAll(".agent-md__item")).toHaveLength(2);
    expect(body?.textContent).not.toContain("**");
  });

  it("labels reasoning-only groups as thoughts without a duplicate row header", () => {
    render(
      viewOf(
        turnOf(SETTLED, [
          { kind: "assistantText", text: "Looking" },
          { kind: "reasoning", text: "First idea" },
          { kind: "reasoning", text: "Second idea" },
        ]),
      ),
    );

    expect(groupLabel()).toBe("Thought (×2)");
    toggleGroup();
    expect(host.querySelectorAll(".agent-thought__toggle")).toHaveLength(0);
    expect(
      [...host.querySelectorAll(".agent-thought__body")].map((body) => body.textContent),
    ).toEqual(["First idea", "Second idea"]);
  });

  it("hides whitespace-only reasoning", () => {
    render(
      viewOf(
        turnOf(SETTLED, [
          { kind: "reasoning", text: " \n\t " },
          { kind: "assistantText", text: "Answer" },
        ]),
      ),
    );

    expect(host.querySelector(".agent-activity-group")).toBeNull();
    expect(host.querySelector(".agent-thought")).toBeNull();
    expect(host.textContent).not.toContain("Thought");
  });

  it("says Thinking while the live turn's latest item is reasoning", () => {
    render(
      viewOf(
        turnOf(RUNNING, [...command("t-1", "npm run lint"), { kind: "reasoning", text: "Hmm" }]),
      ),
    );

    const label = host.querySelector(".agent-activity-group__label");
    expect(label?.textContent).toBe("Thinking");
    expect(label?.classList.contains("agent-activity-group__label--live")).toBe(true);
    expect(host.querySelector(".agent-activity-group__status")?.textContent).toBe("1 completed");

    toggleGroup();
    expect(thoughtToggle().querySelector(".agent-thought__label")?.textContent).toBe("Thinking");
    expect(host.querySelector(".agent-thought--live")).not.toBeNull();

    render(
      viewOf(
        turnOf(RUNNING, [
          ...command("t-1", "npm run lint"),
          { kind: "reasoning", text: "Hmm" },
          ...command("t-2", "npm test"),
        ]),
      ),
    );
    expect(groupLabel()).toBe("Ran 2 commands");
    expect(thoughtToggle().querySelector(".agent-thought__label")?.textContent).toBe("Thought");
    expect(host.querySelector(".agent-thought--live")).toBeNull();
  });

  it("keeps an open thought row open when older events are prepended", () => {
    const tail: ReadonlyArray<AgentTurnEvent> = [
      ...TOOL_THOUGHT_TOOL,
      { kind: "assistantText", text: "Done" },
    ];
    render(viewOf(turnOf(SETTLED, tail)));
    toggleGroup();
    act(() => thoughtToggle().click());
    const before = host.querySelector(".agent-thought");

    render(viewOf(hydrated(tail, [{ kind: "assistantText", text: "Older answer." }])));

    expect(host.querySelector(".agent-thought")).toBe(before);
    expect(thoughtToggle().getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector(".agent-thought__body h2")?.textContent).toBe("Plan");
  });

  function render(thread: AgentThreadView): void {
    act(() =>
      root.render(
        <AgentClockProvider nowTickMs={1}>
          <AgentThreadSession
            composerRepositoryLabel="app"
            onReviewInDiff={() => undefined}
            thread={thread}
          />
        </AgentClockProvider>,
      ),
    );
  }

  function groupToggle(): HTMLButtonElement {
    const toggle = host.querySelector<HTMLButtonElement>(".agent-activity-group__toggle");
    expect(toggle).not.toBeNull();
    return toggle as HTMLButtonElement;
  }

  function groupLabel(): string | null {
    return groupToggle().querySelector(".agent-activity-group__label")?.textContent ?? null;
  }

  function toggleGroup(): void {
    act(() => groupToggle().click());
  }

  function thoughtToggle(): HTMLButtonElement {
    const toggle = host.querySelector<HTMLButtonElement>(".agent-thought__toggle");
    expect(toggle).not.toBeNull();
    return toggle as HTMLButtonElement;
  }
});

function turnOf(status: AgentTurnStatus, events: ReadonlyArray<AgentTurnEvent>): AgentTurn {
  return {
    turnId: TURN_ID,
    prompt: "Refactor the parser",
    status,
    startedAtEpochMs: NOW - 60_000,
    endedAtEpochMs: status.kind === "running" ? null : NOW - 30_000,
    events,
    eventsTruncated: true,
    lastStatusSequence: 1,
    lastOutputSequence: 2,
    launch: null,
    cliVersion: null,
  };
}

function hydrated(
  tail: ReadonlyArray<AgentTurnEvent>,
  older: ReadonlyArray<AgentTurnEvent>,
): AgentTurn {
  const start: AgentThreadsState = {
    threads: new Map([[THREAD_ID, threadOf(turnOf(SETTLED, tail))]]),
  };
  const next = agentThreadsReducer(start, {
    kind: "turnHydrated",
    threadId: THREAD_ID,
    turnId: TURN_ID,
    events: [...older, ...tail],
    hasEarlier: false,
  });
  const turn = next.threads.get(THREAD_ID)?.turns[0];
  expect(turn).toBeDefined();
  return turn as AgentTurn;
}

function threadOf(turn: AgentTurn): AgentThread {
  return {
    threadId: THREAD_ID,
    owner: { rootKey: ROOT, ownerId: "agent-root:app", repositoryRoot: ROOT },
    target: { isolation: "worktree", worktreePath: WORKTREE },
    provider: { kind: "claudeCode", sessionId: "session-abcdefgh" },
    title: "Refactor the parser",
    pinned: false,
    archived: false,
    createdAtEpochMs: NOW - 5 * 60_000,
    updatedAtEpochMs: NOW - 60_000,
    turns: [turn],
    turnsTruncated: false,
    viewedAtEpochMs: null,
    externalOrigin: null,
    integration: null,
  };
}

function viewOf(turn: AgentTurn): AgentThreadView {
  const thread = threadOf(turn);
  return {
    ship: { kind: "idle", status: null, loadingStatus: false },
    editorAvailability: { kind: "available" },
    attention: agentThreadAttention(thread),
    unread: agentThreadUnread(thread),
    thread,
    lifecycle: turn.status.kind === "running" ? "running" : "settled",
    repositoryLabel: "app",
    projectOrigin: "active-tab",
    worktreeRemoved: false,
    worktreeMissing: false,
    changeSummary: null,
  };
}
