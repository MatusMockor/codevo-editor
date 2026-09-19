// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentTurn, AgentTurnEvent } from "../../domain/agentThread";
import { AgentThreadSession } from "./AgentThreadSession";
import { AGENT_SUBAGENT_ANNOUNCE_DELAY_MS } from "./AgentSubagentAnnouncer";

const spawn = (toolId: string, description: string): AgentTurnEvent => ({
  kind: "toolCall",
  toolId,
  name: "Agent",
  inputSummary: description,
  description,
});
const starting = (toolId: string): AgentTurnEvent => ({
  kind: "subagent",
  status: "starting",
  toolId,
  taskId: `task-${toolId}`,
});
const completed = (toolId: string): AgentTurnEvent => ({
  kind: "subagent",
  status: "completed",
  toolId,
  taskId: `task-${toolId}`,
});

const LIVE = [spawn("a", "Stream A"), spawn("b", "Stream B"), starting("a"), starting("b")];

function view(threadId: string, events: ReadonlyArray<AgentTurnEvent>): AgentThreadView {
  const turn: AgentTurn = {
    turnId: `${threadId}-t1`,
    prompt: "Delegate",
    status: { kind: "running" },
    events,
    startedAtEpochMs: 0,
    endedAtEpochMs: null,
    eventsTruncated: false,
    lastStatusSequence: 0,
    lastOutputSequence: 0,
    launch: null,
    cliVersion: null,
  };
  return {
    thread: {
      threadId,
      owner: { rootKey: "/app", repositoryRoot: "/app", ownerId: "owner" },
      target: { isolation: "in-place", worktreePath: null },
      provider: { kind: "claudeCode", sessionId: "session" },
      title: "Delegate",
      pinned: false,
      archived: false,
      createdAtEpochMs: 0,
      updatedAtEpochMs: 0,
      turns: [turn],
      turnsTruncated: false,
      integration: null,
      viewedAtEpochMs: null,
      externalOrigin: null,
    },
    ship: { kind: "idle", status: null, loadingStatus: false },
    editorAvailability: { kind: "available" },
    attention: "running",
    unread: false,
    lifecycle: "running",
    repositoryLabel: "app",
    projectOrigin: "active-tab",
    worktreeRemoved: false,
    worktreeMissing: false,
    changeSummary: null,
  };
}

describe("thread Agents panel", () => {
  let host: HTMLDivElement;
  let root: Root;
  const innerWidth = window.innerWidth;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: innerWidth });
  });

  function render(thread: AgentThreadView) {
    act(() =>
      root.render(
        <AgentThreadSession
          composerRepositoryLabel="app"
          onReviewInDiff={() => undefined}
          thread={thread}
        />,
      ),
    );
  }
  const indicator = () => host.querySelector<HTMLButtonElement>(".agent-background-row__action");
  const panel = () => host.querySelector<HTMLElement>(".agents-panel");

  it("resets on thread change and never reopens or steals focus on A, B, A", () => {
    render(view("thread-a", LIVE));
    act(() => indicator()?.click());
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Close Agents panel");

    render(view("thread-b", LIVE));
    expect(panel()).toBeNull();
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    render(view("thread-a", LIVE));

    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it("docks the panel as a column next to the thread instead of covering it", () => {
    render(view("thread-a", LIVE));
    const dock = host.querySelector<HTMLElement>(".agents-dock");
    expect(dock?.getAttribute("data-agents")).toBe("closed");
    act(() => indicator()?.click());

    expect(dock?.getAttribute("data-agents")).toBe("docked");
    expect(panel()?.parentElement).toBe(dock);
    expect(panel()?.getAttribute("role")).toBeNull();
    const main = host.querySelector<HTMLElement>(".agents-dock__main");
    expect(main?.contains(host.querySelector(".agent-session"))).toBe(true);
    expect(main?.contains(panel())).toBe(false);
    expect(main?.hasAttribute("inert")).toBe(false);
  });

  it("falls back to a modal overlay with an inert thread when the column is narrow", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 520 });
    render(view("thread-a", LIVE));
    act(() => indicator()?.click());

    expect(host.querySelector(".agents-dock")?.getAttribute("data-agents")).toBe("overlay");
    expect(panel()?.getAttribute("role")).toBe("dialog");
    expect(host.querySelector(".agents-dock__main")?.hasAttribute("inert")).toBe(true);
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Close Agents panel"]')?.click());
    expect(host.querySelector(".agents-dock__main")?.hasAttribute("inert")).toBe(false);
  });

  it("announces subagent state through exactly one debounced polite region", () => {
    vi.useFakeTimers();
    render(view("thread-a", LIVE));
    act(() => host.querySelector<HTMLButtonElement>(".agent-spawn__row")?.click());
    act(() => indicator()?.click());
    const regions = () =>
      [...host.querySelectorAll('[role="status"], [aria-live]')].filter(
        (region) => !region.classList.contains("agent-tool-row-live"),
      );

    expect(regions()).toHaveLength(1);
    expect(
      host.querySelectorAll(
        ':is(.agent-spawn-list, .agents-panel, .agent-background-row) :is([role="status"], [aria-live])',
      ),
    ).toHaveLength(0);
    expect(regions()[0]?.getAttribute("aria-live")).toBe("polite");
    expect(regions()[0]?.textContent).toBe("");
    act(() => vi.advanceTimersByTime(AGENT_SUBAGENT_ANNOUNCE_DELAY_MS));
    expect(regions()[0]?.textContent).toBe("2 agents working");

    render(view("thread-a", [...LIVE, completed("a")]));
    render(view("thread-a", [...LIVE, completed("a"), completed("b")]));
    expect(regions()[0]?.textContent).toBe("2 agents working");
    act(() => vi.advanceTimersByTime(AGENT_SUBAGENT_ANNOUNCE_DELAY_MS));
    expect(regions()[0]?.textContent).toBe("All agents finished");
    expect(regions()).toHaveLength(1);
  });
});
