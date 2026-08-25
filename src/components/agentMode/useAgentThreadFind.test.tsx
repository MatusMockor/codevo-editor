// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThread, AgentTurnEvent } from "../../domain/agentThread";
import { MAX_THREAD_SEARCH_SNIPPET_CHARS } from "../../domain/agentThreadSearch";
import { MAX_RENDERED_EVENTS_PER_TURN } from "./agentModePresentation";
import { AGENT_THREAD_FIND_DEBOUNCE_MS, useAgentThreadFind } from "./useAgentThreadFind";
import type { AgentThreadFindState } from "./useAgentThreadFind";

describe("useAgentThreadFind", () => {
  let host: HTMLDivElement;
  let root: Root;
  let state: AgentThreadFindState | null;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    state = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it("debounces the scan and publishes only the latest query", () => {
    render(threadWith([{ kind: "assistantText", text: "token one token two" }]));

    act(() => current().openBar());
    act(() => current().setQuery("tok"));
    act(() => current().setQuery("toke"));
    act(() => current().setQuery("token"));
    expect(current().hits).toHaveLength(0);

    act(() => vi.advanceTimersByTime(AGENT_THREAD_FIND_DEBOUNCE_MS - 1));
    expect(current().hits).toHaveLength(0);

    act(() => vi.advanceTimersByTime(1));
    expect(current().hits).toHaveLength(2);
    expect(current().hitIndex).toBe(0);
  });

  it("selects the revealed hit by its raw segment offset deep inside long text", () => {
    const filler = "token ".repeat(MAX_THREAD_SEARCH_SNIPPET_CHARS / 6);
    const text = `${filler}token`;
    const lastStart = text.lastIndexOf("token");
    render(threadWith([{ kind: "assistantText", text }]));

    act(() =>
      current().requestReveal({
        query: "token",
        turnId: "agt-1-t1",
        eventIndex: 0,
        start: lastStart,
        end: lastStart + 5,
      }),
    );
    act(() => vi.advanceTimersByTime(AGENT_THREAD_FIND_DEBOUNCE_MS));

    const total = current().hits.length;
    expect(total).toBeGreaterThan(MAX_THREAD_SEARCH_SNIPPET_CHARS / 12);
    expect(current().hitIndex).toBe(total - 1);
    expect(current().reveal).toBeNull();
  });

  it("only counts hits inside events the session can render", () => {
    const events = Array.from({ length: MAX_RENDERED_EVENTS_PER_TURN + 3 }, (): AgentTurnEvent => ({
      kind: "assistantText",
      text: "token",
    }));
    render(threadWith(events));

    act(() => current().openBar());
    act(() => current().setQuery("token"));
    act(() => vi.advanceTimersByTime(AGENT_THREAD_FIND_DEBOUNCE_MS));

    expect(current().hits).toHaveLength(MAX_RENDERED_EVENTS_PER_TURN);
    expect(current().hits[0]?.eventIndex).toBe(3);
  });

  function current(): AgentThreadFindState {
    expect(state).not.toBeNull();
    return state as AgentThreadFindState;
  }

  function render(thread: AgentThread): void {
    function Probe() {
      state = useAgentThreadFind(thread);
      return null;
    }
    act(() => root.render(<Probe />));
  }
});

function threadWith(events: ReadonlyArray<AgentTurnEvent>): AgentThread {
  return {
    threadId: "agt-1",
    owner: { rootKey: "/workspace", ownerId: "agent-root:app", repositoryRoot: "/workspace" },
    target: { isolation: "in-place", worktreePath: null },
    provider: { kind: "claudeCode", sessionId: null },
    title: "Find me",
    pinned: false,
    archived: false,
    createdAtEpochMs: 1_000,
    updatedAtEpochMs: 1_000,
    turns: [
      {
        turnId: "agt-1-t1",
        prompt: "prompt",
        status: { kind: "exited", exitCode: 0 },
        startedAtEpochMs: 1_000,
        endedAtEpochMs: 2_000,
        events,
        eventsTruncated: false,
        lastStatusSequence: 0,
        lastOutputSequence: 0,
        launch: null,
      },
    ],
    turnsTruncated: false,
    integration: null,
    viewedAtEpochMs: null,
  };
}
