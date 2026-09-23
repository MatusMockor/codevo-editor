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
} from "../../domain/agentThread";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import { AgentThreadSession, type AgentThreadSessionProps } from "./AgentThreadSession";
import { AgentClockProvider } from "./agentClock";
import { loadAgentMarkdownRenderer } from "../../infrastructure/markdown/agentMarkdownRendererAdapter";

const ROOT = "/workspace/app";
const WORKTREE = `${ROOT}/.worktrees/agt-1`;
const NOW = 1_700_000_600_000;
const THREAD_ID = "agt-1";
const TURN_ID = "agt-1-t1";

const TAIL: ReadonlyArray<AgentTurnEvent> = [
  { kind: "assistantText", text: "Final answer." },
  { kind: "reasoning", text: "Thinking hard." },
];

const OLDER: ReadonlyArray<AgentTurnEvent> = [
  { kind: "assistantText", text: "Older answer." },
  { kind: "reasoning", text: "Older thought." },
];

describe("AgentThreadSession log hydration", () => {
  let host: HTMLDivElement;
  let root: Root;
  let restoreRects: (() => void) | null = null;

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
    restoreRects?.();
    restoreRects = null;
  });

  it("keeps an expanded thought group mounted when older events are prepended", () => {
    render(viewOf(settledTurn(TAIL)));
    const toggle = host.querySelector<HTMLButtonElement>(".agent-activity-group__toggle");
    expect(toggle?.textContent).toContain("Thought");
    act(() => toggle?.click());
    const before = thoughtGroup("Thinking hard.");

    render(viewOf(hydratedTurn()));

    const after = thoughtGroup("Thinking hard.");
    expect(after).toBe(before);
    expect(after.querySelector("button")?.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelectorAll(".agent-thought__body")).toHaveLength(1);
  });

  it("reveals the exact event of a hydrated turn", () => {
    const scrolled = stubScrollIntoView();
    render(viewOf(hydratedTurn()));
    scrolled.length = 0;

    render(viewOf(hydratedTurn()), {
      reveal: { query: "Final", start: 0, end: 5, turnId: TURN_ID, eventIndex: 2 },
    });

    expect(scrolled).toHaveLength(1);
    expect(scrolled[0]?.getAttribute("data-agent-event")).toBe("e0");
    expect(scrolled[0]?.textContent).toContain("Final answer.");
  });

  it("holds the viewport still when hydration prepends events above it", () => {
    restoreRects = stubRects();
    render(viewOf(settledTurn(TAIL)));
    const scroll = scrollContainer({ clientHeight: 600, scrollHeight: 2000, scrollTop: 1000 });
    act(() => scroll.dispatchEvent(new Event("scroll")));
    render(viewOf(settledTurn(TAIL)));

    resize(scroll, 3200);
    render(viewOf(hydratedTurn()));

    expect(scroll.scrollTop).toBe(2200);
  });

  it("leaves the viewport alone when the prepended events are below it", () => {
    restoreRects = stubRects(900);
    render(viewOf(settledTurn(TAIL)));
    const scroll = scrollContainer({ clientHeight: 600, scrollHeight: 2000, scrollTop: 1000 });
    act(() => scroll.dispatchEvent(new Event("scroll")));
    render(viewOf(settledTurn(TAIL)));

    resize(scroll, 3200);
    render(viewOf(hydratedTurn()));

    expect(scroll.scrollTop).toBe(1000);
  });

  function render(thread: AgentThreadView, overrides: Partial<AgentThreadSessionProps> = {}): void {
    act(() =>
      root.render(
        <AgentClockProvider nowTickMs={1}>
          <AgentThreadSession
            composerRepositoryLabel="app"
            onReviewInDiff={() => undefined}
            thread={thread}
            {...overrides}
          />
        </AgentClockProvider>,
      ),
    );
  }

  function thoughtGroup(text: string): HTMLElement {
    const found = [...host.querySelectorAll<HTMLElement>(".agent-activity-group")].find(
      (candidate) => (candidate.textContent ?? "").includes(text),
    );
    expect(found).toBeDefined();
    return found as HTMLElement;
  }

  function scrollContainer(dimensions: {
    readonly clientHeight: number;
    readonly scrollHeight: number;
    readonly scrollTop: number;
  }): HTMLDivElement {
    const scroll = host.querySelector<HTMLDivElement>(".agent-session__scroll");
    expect(scroll).not.toBeNull();
    Object.defineProperties(scroll, {
      clientHeight: { configurable: true, value: dimensions.clientHeight },
      scrollHeight: { configurable: true, value: dimensions.scrollHeight, writable: true },
      scrollTop: { configurable: true, value: dimensions.scrollTop, writable: true },
    });
    return scroll as HTMLDivElement;
  }

  function resize(scroll: HTMLDivElement, scrollHeight: number): void {
    Object.defineProperty(scroll, "scrollHeight", {
      configurable: true,
      value: scrollHeight,
      writable: true,
    });
  }

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
});

function stubRects(eventsTop = -500): () => void {
  const original = Object.getOwnPropertyDescriptor(
    Element.prototype,
    "getBoundingClientRect",
  ) as PropertyDescriptor;
  Object.defineProperty(Element.prototype, "getBoundingClientRect", {
    configurable: true,
    value: function getBoundingClientRect(this: Element): DOMRect {
      const top = this.classList.contains("agent-turn__events") ? eventsTop : 0;
      return new DOMRect(0, top, 0, 0);
    },
    writable: true,
  });
  return () => Object.defineProperty(Element.prototype, "getBoundingClientRect", original);
}

function settledTurn(events: ReadonlyArray<AgentTurnEvent>): AgentTurn {
  return {
    turnId: TURN_ID,
    prompt: "Refactor the parser",
    status: { kind: "exited", exitCode: 0 },
    startedAtEpochMs: NOW - 60_000,
    endedAtEpochMs: NOW - 30_000,
    events,
    eventsTruncated: true,
    lastStatusSequence: 1,
    lastOutputSequence: 2,
    launch: null,
    cliVersion: null,
  };
}

function hydratedTurn(): AgentTurn {
  const start: AgentThreadsState = {
    threads: new Map([[THREAD_ID, threadOf(settledTurn(TAIL))]]),
  };
  const next = agentThreadsReducer(start, {
    kind: "turnHydrated",
    threadId: THREAD_ID,
    turnId: TURN_ID,
    events: [...OLDER, ...TAIL],
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
    lifecycle: "settled",
    repositoryLabel: "app",
    projectOrigin: "active-tab",
    worktreeRemoved: false,
    worktreeMissing: false,
    changeSummary: null,
  };
}
