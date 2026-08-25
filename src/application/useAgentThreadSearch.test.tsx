// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThread, AgentTurn } from "../domain/agentThread";
import * as agentThreadSearch from "../domain/agentThreadSearch";
import type { AgentThreadSearchSurface, AgentThreadView } from "./agentThreadPorts";
import { AGENT_THREAD_SEARCH_DEBOUNCE_MS, useAgentThreadSearch } from "./useAgentThreadSearch";

const ROOT = "/workspace/app";

function turn(turnId: string, prompt: string, assistant: string): AgentTurn {
  return {
    turnId,
    prompt,
    status: { kind: "exited", exitCode: 0 },
    startedAtEpochMs: 1_000,
    endedAtEpochMs: 2_000,
    events: [{ kind: "assistantText", text: assistant }],
    eventsTruncated: false,
    lastStatusSequence: 1,
    lastOutputSequence: 1,
    launch: null,
  };
}

function thread(
  threadId: string,
  title: string,
  overrides: Partial<AgentThread> = {},
): AgentThread {
  return {
    threadId,
    owner: { rootKey: ROOT, ownerId: "workspace-a", repositoryRoot: ROOT },
    target: { isolation: "worktree", worktreePath: `${ROOT}/.worktrees/${threadId}` },
    provider: { kind: "claudeCode", sessionId: null },
    title,
    pinned: false,
    archived: false,
    createdAtEpochMs: 1_000,
    updatedAtEpochMs: 2_000,
    turns: [turn(`${threadId}-t1`, `${title} prompt`, `Assistant reply about ${title}`)],
    turnsTruncated: false,
    integration: null,
    viewedAtEpochMs: null,
    ...overrides,
  };
}

function view(entry: AgentThread): AgentThreadView {
  return {
    thread: entry,
    lifecycle: "settled",
    repositoryLabel: "app",
    projectOrigin: "active-tab",
    worktreeRemoved: false,
    worktreeMissing: false,
    changeSummary: null,
    ship: { kind: "idle", status: null, loadingStatus: false },
    editorAvailability: { kind: "available" },
    attention: "settled",
    unread: false,
  };
}

function renderSearch(initialViews: ReadonlyArray<AgentThreadView>) {
  let views = initialViews;
  let current: AgentThreadSearchSurface | null = null;
  function Harness() {
    current = useAgentThreadSearch(views);
    return null;
  }

  const host = document.createElement("div");
  const root = createRoot(host);
  const render = (): void => act(() => root.render(<Harness />));
  render();

  return {
    hook(): AgentThreadSearchSurface {
      expect(current).not.toBeNull();
      return current as AgentThreadSearchSurface;
    },
    setViews(next: ReadonlyArray<AgentThreadView>): void {
      views = next;
      render();
    },
    type(raw: string): void {
      act(() => this.hook().setQuery(raw));
    },
    fire(): void {
      act(() => {
        vi.advanceTimersByTime(AGENT_THREAD_SEARCH_DEBOUNCE_MS);
      });
    },
    unmount(): void {
      act(() => root.unmount());
    },
  };
}

describe("useAgentThreadSearch", () => {
  const buildSpy = vi.spyOn(agentThreadSearch, "buildAgentThreadSearchDocument");

  beforeEach(() => {
    vi.useFakeTimers();
    buildSpy.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is inactive below two chars and publishes a debounced result for a real query", () => {
    const alpha = thread("agt-a", "Alpha parser");
    const beta = thread("agt-b", "Beta router");
    const harness = renderSearch([view(alpha), view(beta)]);
    expect(buildSpy).toHaveBeenCalledTimes(2);

    harness.type("a");
    expect(harness.hook()).toMatchObject({
      query: "a",
      active: false,
      result: null,
      pending: false,
    });

    harness.type("alpha");
    expect(harness.hook()).toMatchObject({ query: "alpha", active: true, pending: true });
    expect(harness.hook().result).toBeNull();

    act(() => {
      vi.advanceTimersByTime(AGENT_THREAD_SEARCH_DEBOUNCE_MS - 1);
    });
    expect(harness.hook().pending).toBe(true);

    harness.fire();
    expect(harness.hook().pending).toBe(false);
    expect(harness.hook().result?.matches.map((match) => match.threadId)).toEqual(["agt-a"]);
    expect(harness.hook().result?.matches[0]?.source).toBe("title");

    act(() => harness.hook().clear());
    expect(harness.hook()).toMatchObject({
      query: "",
      active: false,
      result: null,
      pending: false,
    });
    harness.unmount();
  });

  it("rebuilds only changed threads and drops removed ones from the index", () => {
    const alpha = thread("agt-a", "Alpha parser");
    const beta = thread("agt-b", "Beta router");
    const gamma = thread("agt-c", "Gamma cache");
    const harness = renderSearch([view(alpha), view(beta), view(gamma)]);
    expect(buildSpy).toHaveBeenCalledTimes(3);

    harness.setViews([view(alpha), view(beta), view(gamma)]);
    expect(buildSpy).toHaveBeenCalledTimes(3);

    const betaRenamed = { ...beta, title: "Beta gateway", updatedAtEpochMs: 3_000 };
    harness.setViews([view(alpha), view(betaRenamed), view(gamma)]);
    expect(buildSpy).toHaveBeenCalledTimes(4);
    expect(buildSpy.mock.calls[3]?.[0]).toBe(betaRenamed);

    harness.setViews([view(alpha), view(betaRenamed)]);
    expect(buildSpy).toHaveBeenCalledTimes(4);

    harness.type("gamma");
    harness.fire();
    expect(harness.hook().result?.matches).toEqual([]);

    harness.type("gateway");
    harness.fire();
    expect(harness.hook().result?.matches.map((match) => match.threadId)).toEqual(["agt-b"]);
    harness.unmount();
  });

  it("never rebuilds documents while typing", () => {
    const views = Array.from({ length: 8 }, (_, index) =>
      view(thread(`agt-${index}`, `Thread number ${index}`)),
    );
    const harness = renderSearch(views);
    expect(buildSpy).toHaveBeenCalledTimes(8);
    buildSpy.mockClear();

    let query = "";
    for (let keystroke = 0; keystroke < 100; keystroke += 1) {
      query = `${query}${String.fromCharCode(97 + (keystroke % 26))}`;
      harness.type(query);
      act(() => {
        vi.advanceTimersByTime(10);
      });
    }

    expect(buildSpy).not.toHaveBeenCalled();
    expect(harness.hook().pending).toBe(true);
    expect(harness.hook().result).toBeNull();
    harness.fire();
    expect(harness.hook().pending).toBe(false);
    expect(harness.hook().result?.query).toBe(query.slice(0, 200).toLowerCase());
    harness.unmount();
  });

  it("drops a stale generation when the query changes before the timer fires", () => {
    const alpha = thread("agt-a", "Alpha parser");
    const beta = thread("agt-b", "Beta router");
    const harness = renderSearch([view(alpha), view(beta)]);
    const searchSpy = vi.spyOn(agentThreadSearch, "searchAgentThreadDocuments");

    harness.type("alpha");
    act(() => {
      vi.advanceTimersByTime(AGENT_THREAD_SEARCH_DEBOUNCE_MS - 1);
    });
    harness.type("beta");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(searchSpy).not.toHaveBeenCalled();
    expect(harness.hook()).toMatchObject({ pending: true, result: null });

    harness.fire();
    expect(searchSpy).toHaveBeenCalledTimes(1);
    expect(harness.hook().result?.matches.map((match) => match.threadId)).toEqual(["agt-b"]);
    searchSpy.mockRestore();
    harness.unmount();
  });

  it("fails closed for a thread removed between debounce and publish", () => {
    const alpha = thread("agt-a", "Alpha parser");
    const beta = thread("agt-b", "Alpha beta");
    const harness = renderSearch([view(alpha), view(beta)]);

    harness.type("alpha");
    harness.setViews([view(beta)]);
    harness.fire();
    expect(harness.hook().result?.matches.map((match) => match.threadId)).toEqual(["agt-b"]);

    harness.setViews([view(alpha), view(beta)]);
    harness.fire();
    expect(
      harness
        .hook()
        .result?.matches.map((match) => match.threadId)
        .sort(),
    ).toEqual(["agt-a", "agt-b"]);

    harness.setViews([view(alpha)]);
    expect(harness.hook().result?.matches.map((match) => match.threadId)).toEqual(["agt-a"]);
    harness.fire();
    expect(harness.hook().result?.matches.map((match) => match.threadId)).toEqual(["agt-a"]);
    harness.unmount();
  });

  it("finds content hits in prompts and assistant text with a snippet", () => {
    const alpha = thread("agt-a", "Alpha parser");
    const harness = renderSearch([view(alpha)]);

    harness.type("assistant reply");
    harness.fire();
    const match = harness.hook().result?.matches[0];
    expect(match).toMatchObject({ threadId: "agt-a", source: "assistant", turnId: "agt-a-t1" });
    expect(match?.snippet.toLowerCase()).toContain("assistant reply");
    expect(match?.ranges.length).toBeGreaterThan(0);
    harness.unmount();
  });

  it("clips the raw query at the bound and cancels the timer on unmount", () => {
    const alpha = thread("agt-a", "Alpha parser");
    const harness = renderSearch([view(alpha)]);
    const searchSpy = vi.spyOn(agentThreadSearch, "searchAgentThreadDocuments");

    harness.type("x".repeat(250));
    expect(harness.hook().query).toHaveLength(agentThreadSearch.MAX_THREAD_SEARCH_QUERY_CHARS);
    harness.unmount();
    vi.advanceTimersByTime(AGENT_THREAD_SEARCH_DEBOUNCE_MS * 2);
    expect(searchSpy).not.toHaveBeenCalled();
    searchSpy.mockRestore();
  });
});
