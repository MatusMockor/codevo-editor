// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThread, AgentTurnEvent } from "../../domain/agentThread";
import {
  MAX_THREAD_FIND_HITS,
  MAX_THREAD_SEARCH_SNIPPET_CHARS,
} from "../../domain/agentThreadSearch";
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

  it("finds older loaded events outside the default rendered window", () => {
    const events = Array.from({ length: MAX_RENDERED_EVENTS_PER_TURN + 3 }, (): AgentTurnEvent => ({
      kind: "assistantText",
      text: "token",
    }));
    render(threadWith(events));

    act(() => current().openBar());
    act(() => current().setQuery("token"));
    act(() => vi.advanceTimersByTime(AGENT_THREAD_FIND_DEBOUNCE_MS));

    expect(current().hits).toHaveLength(MAX_RENDERED_EVENTS_PER_TURN + 3);
    const first = current().hits[0];
    expect(first?.scope).toBe("turn");
    expect(first?.scope === "turn" ? first.eventIndex : null).toBe(0);
  });

  it("resolves a server search target beyond the global find hit cap", () => {
    const first = threadWith([
      { kind: "assistantText", text: "token ".repeat(MAX_THREAD_FIND_HITS) },
    ]);
    const target = {
      ...first.turns[0]!,
      turnId: "old-target",
      events: [{ kind: "assistantText" as const, text: "target token" }],
    };
    render({ ...first, turns: [...first.turns, target] });
    act(() =>
      current().requestReveal({
        query: "token",
        turnId: "old-target",
        eventIndex: null,
        start: 0,
        end: 0,
        resolveQuery: true,
      }),
    );
    act(() => vi.advanceTimersByTime(AGENT_THREAD_FIND_DEBOUNCE_MS));
    expect(current().hits).toHaveLength(MAX_THREAD_FIND_HITS);
    expect(current().hits[current().hitIndex]).toMatchObject({
      turnId: "old-target",
      eventIndex: 0,
    });
    act(() => vi.advanceTimersByTime(AGENT_THREAD_FIND_DEBOUNCE_MS));
    expect(current().hits[current().hitIndex]).toMatchObject({
      turnId: "old-target",
      eventIndex: 0,
    });
    act(() => current().setQuery("target"));
    act(() => vi.advanceTimersByTime(AGENT_THREAD_FIND_DEBOUNCE_MS));
    expect(current().hits).toHaveLength(1);
  });

  it("keeps an assistant search reveal pending while its placeholder turn awaits replay", () => {
    const placeholder = threadWith([]);
    render({ ...placeholder, turns: [{ ...placeholder.turns[0]!, prompt: "token prompt" }] });
    act(() =>
      current().requestReveal({
        query: "token",
        turnId: "agt-1-t1",
        eventIndex: null,
        start: 0,
        end: 0,
        resolveQuery: true,
        resolveSource: "assistant",
      }),
    );
    act(() => vi.advanceTimersByTime(AGENT_THREAD_FIND_DEBOUNCE_MS));
    expect(current().reveal?.resolveSource).toBe("assistant");
    render({
      ...placeholder,
      turns: [
        {
          ...placeholder.turns[0]!,
          prompt: "token prompt",
          events: [{ kind: "assistantText", text: "token answer" }],
        },
      ],
    });
    act(() => vi.advanceTimersByTime(AGENT_THREAD_FIND_DEBOUNCE_MS));
    expect(current().hits[current().hitIndex]).toMatchObject({ eventIndex: 0 });
    expect(current().reveal).toBeNull();
  });

  it("finds the assistant role after a same-turn prompt exhausts the global hit cap", () => {
    const thread = threadWith([{ kind: "assistantText", text: "token answer" }]);
    render({
      ...thread,
      turns: [{ ...thread.turns[0]!, prompt: "token ".repeat(MAX_THREAD_FIND_HITS + 10) }],
    });
    act(() =>
      current().requestReveal({
        query: "token",
        turnId: "agt-1-t1",
        eventIndex: null,
        start: 0,
        end: 0,
        resolveQuery: true,
        resolveSource: "assistant",
      }),
    );
    act(() => vi.advanceTimersByTime(AGENT_THREAD_FIND_DEBOUNCE_MS));
    expect(current().hits[current().hitIndex]).toMatchObject({ eventIndex: 0 });
  });

  it("cancels a pending server reveal when the user edits the query", () => {
    render(threadWith([]));
    act(() =>
      current().requestReveal({
        query: "token",
        turnId: "agt-1-t1",
        eventIndex: null,
        start: 0,
        end: 0,
        resolveQuery: true,
        resolveSource: "assistant",
      }),
    );
    act(() => current().setQuery("different"));
    act(() => vi.advanceTimersByTime(AGENT_THREAD_FIND_DEBOUNCE_MS));
    expect(current().reveal).toBeNull();
  });

  it("cancels pending reveals across owner A to B to A replacement", () => {
    const ownerA = threadWith([]);
    render(ownerA);
    act(() =>
      current().requestReveal({
        query: "token",
        turnId: "agt-1-t1",
        eventIndex: null,
        start: 0,
        end: 0,
        resolveQuery: true,
        resolveSource: "assistant",
      }),
    );
    render({ ...ownerA, owner: { ...ownerA.owner, ownerId: "replacement-owner" } });
    render(threadWith([{ kind: "assistantText", text: "token old owner" }]));
    act(() => vi.advanceTimersByTime(AGENT_THREAD_FIND_DEBOUNCE_MS));
    expect(current().open).toBe(true);
    expect(current().query).toBe("");
    expect(current().hits).toEqual([]);
    expect(current().reveal).toBeNull();
  });

  it("reports the result as truncated once the hit cap is reached", () => {
    render(threadWith([{ kind: "assistantText", text: "ab".repeat(MAX_THREAD_FIND_HITS + 100) }]));

    act(() => current().openBar());
    act(() => current().setQuery("ab"));
    act(() => vi.advanceTimersByTime(AGENT_THREAD_FIND_DEBOUNCE_MS));

    expect(current().hits).toHaveLength(MAX_THREAD_FIND_HITS);
    expect(current().truncated).toBe(true);
  });

  it("reports a complete result as not truncated", () => {
    render(threadWith([{ kind: "assistantText", text: "token one token two" }]));

    act(() => current().openBar());
    act(() => current().setQuery("token"));
    act(() => vi.advanceTimersByTime(AGENT_THREAD_FIND_DEBOUNCE_MS));

    expect(current().hits).toHaveLength(2);
    expect(current().truncated).toBe(false);
  });

  function current(): AgentThreadFindState {
    expect(state).not.toBeNull();
    return state as AgentThreadFindState;
  }

  function Probe({ thread }: { readonly thread: AgentThread }) {
    state = useAgentThreadFind(thread);
    return null;
  }

  function render(thread: AgentThread): void {
    act(() => root.render(<Probe thread={thread} />));
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
        cliVersion: null,
      },
    ],
    turnsTruncated: false,
    integration: null,
    viewedAtEpochMs: null,
    externalOrigin: null,
  };
}
