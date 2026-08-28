// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThread, AgentTurn } from "../domain/agentThread";
import * as agentThreadSearch from "../domain/agentThreadSearch";
import type { AgentThreadSearchSurface, AgentThreadView } from "./agentThreadPorts";
import {
  AGENT_THREAD_SEARCH_DEBOUNCE_MS,
  MAX_AGENT_THREAD_SEARCH_INDEX_BYTES,
  MAX_AGENT_THREAD_SEARCH_INDEX_DOCUMENTS,
  useAgentThreadSearch,
  type AgentThreadSearchOptions,
} from "./useAgentThreadSearch";

const ROOT = "/workspace/app";
const SECOND_ROOT = "/workspace/other";

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
    cliVersion: null,
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

function renderSearch(
  initialViews: ReadonlyArray<AgentThreadView>,
  initialOptions: AgentThreadSearchOptions = {},
) {
  let views = initialViews;
  let options = initialOptions;
  let current: AgentThreadSearchSurface | null = null;
  function Harness() {
    current = useAgentThreadSearch(views, options);
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
    setOptions(next: AgentThreadSearchOptions): void {
      options = next;
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

  it("retains only the newest bounded document set with deterministic thread-id ties", () => {
    const oldest = view(thread("agt-old", "Needle oldest", { updatedAtEpochMs: 1 }));
    const tied = Array.from({ length: MAX_AGENT_THREAD_SEARCH_INDEX_DOCUMENTS + 1 }, (_, index) =>
      view(
        thread(`agt-${String(index).padStart(3, "0")}`, `Needle ${index}`, {
          updatedAtEpochMs: 10,
        }),
      ),
    );
    const harness = renderSearch([oldest, ...tied].reverse());

    harness.type("needle");
    harness.fire();

    expect(buildSpy).toHaveBeenCalledTimes(MAX_AGENT_THREAD_SEARCH_INDEX_DOCUMENTS);
    expect(buildSpy).not.toHaveBeenCalledWith(oldest.thread);
    expect(buildSpy).not.toHaveBeenCalledWith(tied[tied.length - 1]?.thread);
    expect(harness.hook().result?.documentsTruncated).toBe(true);
    harness.unmount();
  });

  it("caps retained UTF-8 document bytes and releases evicted document references", () => {
    const payload = "字".repeat(20 * 1_024);
    const entries = Array.from({ length: 100 }, (_, index) =>
      view(
        thread(
          `agt-byte-${String(index).padStart(3, "0")}`,
          index === 0 ? "Oldest marker" : `Needle ${index}`,
          {
            updatedAtEpochMs: index,
            turns: [turn(`turn-${index}`, payload, "done")],
          },
        ),
      ),
    );
    const harness = renderSearch(entries);

    const builtDocuments = buildSpy.mock.results.map((call) => call.value);
    const retainedDocuments = builtDocuments.slice(0, -1);
    const retainedBytes = retainedDocuments.reduce((total, document) => {
      return total + (document?.byteLength ?? 0);
    }, 0);
    const attemptedBytes = builtDocuments.reduce((total, document) => {
      return total + (document?.byteLength ?? 0);
    }, 0);
    expect(retainedBytes).toBeLessThanOrEqual(MAX_AGENT_THREAD_SEARCH_INDEX_BYTES);
    expect(attemptedBytes).toBeGreaterThan(MAX_AGENT_THREAD_SEARCH_INDEX_BYTES);
    expect(buildSpy.mock.calls.length).toBeLessThan(entries.length);

    harness.type("oldest marker");
    harness.fire();
    expect(harness.hook().result?.matches).toEqual([]);
    expect(harness.hook().result?.documentsTruncated).toBe(true);

    const previouslyRetained = entries[entries.length - 1];
    buildSpy.mockClear();
    harness.setViews([view(thread("agt-replacement", "Needle replacement"))]);
    expect(buildSpy).toHaveBeenCalledTimes(1);
    if (previouslyRetained === undefined) throw new Error("Missing retained fixture.");
    harness.setViews([previouslyRetained]);
    expect(buildSpy).toHaveBeenCalledTimes(2);

    harness.type("needle");
    harness.fire();
    expect(harness.hook().result?.matches.map((match) => match.threadId)).toEqual([
      previouslyRetained.thread.threadId,
    ]);
    expect(harness.hook().result?.documentsTruncated).toBe(false);
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

  it("publishes within one debounce while one of 128 indexed threads streams", () => {
    const firstRoot = Array.from({ length: 64 }, (_, index) =>
      view(thread(`agt-a-${index}`, `First root ${index}`)),
    );
    const secondRoot = Array.from({ length: 64 }, (_, index) =>
      view(
        thread(`agt-b-${index}`, index === 0 ? "Needle stream" : `Second root ${index}`, {
          owner: {
            rootKey: SECOND_ROOT,
            ownerId: "workspace-b",
            repositoryRoot: SECOND_ROOT,
          },
          target: {
            isolation: "worktree",
            worktreePath: `${SECOND_ROOT}/.worktrees/agt-b-${index}`,
          },
        }),
      ),
    );
    const harness = renderSearch([...firstRoot, ...secondRoot]);
    const searchSpy = vi.spyOn(agentThreadSearch, "searchAgentThreadDocuments");
    expect(buildSpy).toHaveBeenCalledTimes(128);
    buildSpy.mockClear();

    harness.type("needle");
    let publishedAtMs: number | null = null;
    for (let elapsedMs = 10; elapsedMs <= AGENT_THREAD_SEARCH_DEBOUNCE_MS; elapsedMs += 10) {
      act(() => {
        vi.advanceTimersByTime(10);
      });
      if (harness.hook().result !== null && publishedAtMs === null) publishedAtMs = elapsedMs;
      const current = secondRoot[0]?.thread;
      if (current === undefined) throw new Error("Missing streaming thread.");
      const streaming = {
        ...current,
        updatedAtEpochMs: 2_000 + elapsedMs,
        turns: [turn("agt-b-0-t1", "Needle prompt", `Needle output ${elapsedMs}`)],
      };
      secondRoot[0] = view(streaming);
      harness.setViews([...firstRoot, ...secondRoot]);
    }

    expect(publishedAtMs).toBe(AGENT_THREAD_SEARCH_DEBOUNCE_MS);
    expect(harness.hook().result?.matches[0]?.threadId).toBe("agt-b-0");
    expect(searchSpy).toHaveBeenCalledTimes(1);
    expect(buildSpy).toHaveBeenCalledTimes(12);
    expect(buildSpy.mock.calls.every(([candidate]) => candidate.threadId === "agt-b-0")).toBe(true);
    searchSpy.mockRestore();
    harness.unmount();
  });

  it("restarts a pending query with the latest debounce and result limit", () => {
    const harness = renderSearch(
      [
        view(thread("agt-a", "Needle alpha")),
        view(thread("agt-b", "Needle beta")),
        view(thread("agt-c", "Needle gamma")),
      ],
      { debounceMs: AGENT_THREAD_SEARCH_DEBOUNCE_MS, limit: 3 },
    );
    harness.type("needle");
    act(() => {
      vi.advanceTimersByTime(50);
    });

    harness.setOptions({ debounceMs: 20, limit: 1 });
    act(() => {
      vi.advanceTimersByTime(19);
    });
    expect(harness.hook()).toMatchObject({ pending: true, result: null });

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(harness.hook().pending).toBe(false);
    expect(harness.hook().result).toMatchObject({ query: "needle", truncated: true });
    expect(harness.hook().result?.matches).toHaveLength(1);
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
