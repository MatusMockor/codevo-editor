import { describe, expect, it } from "vitest";
import type { AgentThread, AgentTurn, AgentTurnEvent } from "./agentThread";
import {
  MAX_THREAD_FIND_HITS,
  MAX_THREAD_SEARCH_DOC_BYTES,
  MAX_THREAD_SEARCH_QUERY_CHARS,
  MAX_THREAD_SEARCH_RESULTS,
  MAX_THREAD_SEARCH_SEGMENTS,
  MAX_THREAD_SEARCH_SNIPPET_CHARS,
  buildAgentThreadSearchDocument,
  findInThread,
  normalizeThreadSearchQuery,
  searchAgentThreadDocuments,
  threadSearchSnippet,
  type AgentThreadSearchDocument,
  type AgentThreadSearchSegment,
} from "./agentThreadSearch";
import { insertRankedSearchResult, type RankedSearchEntry } from "./agentThreadSearchRanking";

const OWNER = { rootKey: "/workspace", ownerId: "ws-1", repositoryRoot: "/repo" } as const;
const NUL = "\u0000";
const BUILD_BUDGET_MS = 200;
const REBUILD_BUDGET_MS = 8;
const SEARCH_BUDGET_MS = 32;

function turn(overrides: Partial<AgentTurn> = {}): AgentTurn {
  return {
    turnId: "agt-1-0001",
    prompt: "do the thing",
    status: { kind: "exited", exitCode: 0 },
    startedAtEpochMs: 1_000,
    endedAtEpochMs: 2_000,
    events: [],
    eventsTruncated: false,
    lastStatusSequence: 0,
    lastOutputSequence: 0,
    launch: null,
    cliVersion: null,
    ...overrides,
  };
}

function thread(overrides: Partial<AgentThread> = {}): AgentThread {
  return {
    threadId: "agt-t1-0001",
    owner: OWNER,
    target: { isolation: "in-place", worktreePath: null },
    provider: { kind: "claudeCode", sessionId: null },
    title: "Fix the router",
    pinned: false,
    archived: false,
    createdAtEpochMs: 1_000,
    updatedAtEpochMs: 1_000,
    turns: [turn()],
    turnsTruncated: false,
    integration: null,
    viewedAtEpochMs: null,
    externalOrigin: null,
    ...overrides,
  };
}

function documentOf(overrides: Partial<AgentThread> = {}): AgentThreadSearchDocument {
  return buildAgentThreadSearchDocument(thread(overrides));
}

function textSegment(text: string): AgentThreadSearchSegment {
  return {
    source: "assistant",
    turnId: "agt-1-0001",
    eventIndex: 0,
    text,
    lower: text.toLowerCase(),
  };
}

function hasLoneSurrogate(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0xd800 || code > 0xdfff) continue;
    if (code >= 0xdc00) return true;
    const next = text.charCodeAt(index + 1);
    if (Number.isNaN(next) || next < 0xdc00 || next > 0xdfff) return true;
    index += 1;
  }
  return false;
}

function medianMs(samples: ReadonlyArray<number>): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.POSITIVE_INFINITY;
}

describe("normalizeThreadSearchQuery", () => {
  it("trims, lowercases and keeps queries of at least two characters", () => {
    expect(normalizeThreadSearchQuery("  RoUTer  ")).toBe("router");
    expect(normalizeThreadSearchQuery("ab")).toBe("ab");
  });

  it("rejects queries shorter than two characters after trimming", () => {
    expect(normalizeThreadSearchQuery("a")).toBeNull();
    expect(normalizeThreadSearchQuery("   x   ")).toBeNull();
    expect(normalizeThreadSearchQuery("")).toBeNull();
    expect(normalizeThreadSearchQuery("     ")).toBeNull();
  });

  it("clips the query to the maximum length", () => {
    const normalized = normalizeThreadSearchQuery("Z".repeat(500));
    expect(normalized).toHaveLength(MAX_THREAD_SEARCH_QUERY_CHARS);
    expect(normalized).toBe("z".repeat(MAX_THREAD_SEARCH_QUERY_CHARS));
  });

  it("strips NUL and other control characters before measuring the query", () => {
    expect(normalizeThreadSearchQuery(`ro${NUL}uter`)).toBe("router");
    expect(normalizeThreadSearchQuery("a\u0007b\u001fc\u007f")).toBe("abc");
    expect(normalizeThreadSearchQuery(`${NUL}a\u0001`)).toBeNull();
    expect(normalizeThreadSearchQuery("\u000a")).toBeNull();
  });

  it("clips before lowercasing so a control-only tail cannot extend the query", () => {
    const raw = `${"A".repeat(MAX_THREAD_SEARCH_QUERY_CHARS)}${NUL}${"B".repeat(50)}`;
    expect(normalizeThreadSearchQuery(raw)).toBe("a".repeat(MAX_THREAD_SEARCH_QUERY_CHARS));
  });
});

describe("buildAgentThreadSearchDocument", () => {
  it("indexes the title, prompts and assistant text or result events only", () => {
    const events: ReadonlyArray<AgentTurnEvent> = [
      { kind: "reasoning", text: "hidden reasoning" },
      { kind: "assistantText", text: "visible answer" },
      { kind: "toolCall", toolId: "t1", name: "Read", inputSummary: "hidden tool input" },
      { kind: "toolResult", toolId: "t1", outputSummary: "hidden tool output", isError: false },
      { kind: "unknownLine", stream: "stdout", raw: "hidden raw", clipped: false },
      { kind: "error", message: "hidden error" },
      { kind: "result", text: "visible result", isError: false, usage: null },
    ];
    const doc = documentOf({ turns: [turn({ prompt: "visible prompt", events })] });

    expect(doc.segments.map((segment) => segment.text)).toEqual([
      "Fix the router",
      "visible prompt",
      "visible answer",
      "visible result",
    ]);
    expect(doc.segments.map((segment) => segment.source)).toEqual([
      "title",
      "user",
      "assistant",
      "assistant",
    ]);
    expect(doc.segments[2]?.eventIndex).toBe(1);
    expect(doc.segments[3]?.eventIndex).toBe(6);
    expect(doc.truncated).toBe(false);
    expect(doc.titleLower).toBe("fix the router");
  });

  it("orders turns newest first after the title", () => {
    const doc = documentOf({
      turns: [
        turn({ turnId: "agt-1-0001", prompt: "oldest" }),
        turn({ turnId: "agt-1-0002", prompt: "middle" }),
        turn({ turnId: "agt-1-0003", prompt: "newest" }),
      ],
    });

    expect(doc.segments.map((segment) => segment.text)).toEqual([
      "Fix the router",
      "newest",
      "middle",
      "oldest",
    ]);
  });

  it("drops the oldest turns once the byte budget is exhausted", () => {
    const chunk = "x".repeat(10 * 1_024);
    const turns = Array.from({ length: 12 }, (_, index) =>
      turn({
        turnId: `agt-1-${index}`,
        prompt: `p${index}`,
        events: [{ kind: "assistantText", text: `${chunk}${index}` }],
      }),
    );
    const doc = documentOf({ turns });
    const bytes = doc.segments.reduce(
      (total, segment) => total + new TextEncoder().encode(segment.text).byteLength,
      0,
    );

    expect(doc.truncated).toBe(true);
    expect(bytes).toBeLessThanOrEqual(MAX_THREAD_SEARCH_DOC_BYTES);
    expect(doc.segments.some((segment) => segment.turnId === "agt-1-11")).toBe(true);
    expect(doc.segments.some((segment) => segment.turnId === "agt-1-0")).toBe(false);
  });

  it("counts UTF-8 bytes rather than code units for the byte budget", () => {
    const wide = "字".repeat(30 * 1_024);
    const doc = documentOf({
      turns: [turn({ prompt: "p", events: [{ kind: "assistantText", text: wide }] })],
    });

    expect(wide.length).toBeLessThan(MAX_THREAD_SEARCH_DOC_BYTES);
    expect(doc.truncated).toBe(true);
    expect(doc.segments.some((segment) => segment.text === wide)).toBe(false);
  });

  it("caps the segment count including the title", () => {
    const turns = Array.from({ length: 600 }, (_, index) =>
      turn({ turnId: `agt-1-${index}`, prompt: "hi" }),
    );
    const doc = documentOf({ turns });

    expect(doc.segments).toHaveLength(MAX_THREAD_SEARCH_SEGMENTS);
    expect(doc.truncated).toBe(true);
  });

  it("reports truncation carried by the thread and by its turns", () => {
    expect(documentOf({ turnsTruncated: true }).truncated).toBe(true);
    expect(documentOf({ turns: [turn({ eventsTruncated: true })] }).truncated).toBe(true);
  });

  it("builds an empty document body for a thread without turns", () => {
    const doc = documentOf({ turns: [] });

    expect(doc.segments).toHaveLength(1);
    expect(doc.truncated).toBe(false);
  });

  it("records the retained UTF-8 bytes for global index accounting", () => {
    const doc = documentOf({
      title: "Router 字",
      turns: [turn({ prompt: "emoji 😀", events: [{ kind: "assistantText", text: "done" }] })],
    });

    expect(doc.byteLength).toBe(
      doc.segments.reduce(
        (total, entry) => total + new TextEncoder().encode(entry.text).byteLength,
        0,
      ),
    );
  });
});

describe("searchAgentThreadDocuments", () => {
  it("returns an inactive result for queries below the minimum length", () => {
    const result = searchAgentThreadDocuments([documentOf()], "f");

    expect(result).toEqual({
      query: "",
      matches: [],
      truncated: false,
      documentsTruncated: false,
    });
  });

  it("ranks title exact before prefix, includes and content matches", () => {
    const docs = [
      documentOf({ threadId: "content", title: "unrelated", turns: [turn({ prompt: "router" })] }),
      documentOf({ threadId: "includes", title: "the router fix" }),
      documentOf({ threadId: "prefix", title: "router rewrite" }),
      documentOf({ threadId: "exact", title: "router" }),
    ];
    const result = searchAgentThreadDocuments(docs, "router");

    expect(result.matches.map((match) => match.threadId)).toEqual([
      "exact",
      "prefix",
      "includes",
      "content",
    ]);
    expect(result.matches.map((match) => match.score)).toEqual([0, 100 + 14, 200 + 2 * 4, 400]);
    expect(result.matches.map((match) => match.source)).toEqual([
      "title",
      "title",
      "title",
      "user",
    ]);
    expect(result.truncated).toBe(false);
  });

  it("prefers the shorter title for prefix matches and the earlier index for includes", () => {
    const prefixes = searchAgentThreadDocuments(
      [
        documentOf({ threadId: "long", title: "abcdef" }),
        documentOf({ threadId: "short", title: "abc" }),
      ],
      "ab",
    );
    const includes = searchAgentThreadDocuments(
      [
        documentOf({ threadId: "late", title: "xxxab" }),
        documentOf({ threadId: "early", title: "xab" }),
      ],
      "ab",
    );

    expect(prefixes.matches.map((match) => match.threadId)).toEqual(["short", "long"]);
    expect(includes.matches.map((match) => match.threadId)).toEqual(["early", "late"]);
  });

  it("breaks equal scores by recency and then by thread id", () => {
    const docs = [
      documentOf({
        threadId: "b",
        title: "z",
        updatedAtEpochMs: 10,
        turns: [turn({ prompt: "router" })],
      }),
      documentOf({
        threadId: "a",
        title: "z",
        updatedAtEpochMs: 10,
        turns: [turn({ prompt: "router" })],
      }),
      documentOf({
        threadId: "c",
        title: "z",
        updatedAtEpochMs: 99,
        turns: [turn({ prompt: "router" })],
      }),
    ];
    const result = searchAgentThreadDocuments(docs, "router");

    expect(result.matches.map((match) => match.threadId)).toEqual(["c", "a", "b"]);
  });

  it("returns one best match per thread and prefers the newest matching turn", () => {
    const doc = documentOf({
      title: "unrelated",
      turns: [
        turn({ turnId: "agt-1-old", prompt: "router old" }),
        turn({ turnId: "agt-1-new", prompt: "router new" }),
      ],
    });
    const result = searchAgentThreadDocuments([doc], "router");

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.turnId).toBe("agt-1-new");
    expect(result.matches[0]?.snippet).toBe("router new");
  });

  it("caps the result list and reports truncation", () => {
    const docs = Array.from({ length: MAX_THREAD_SEARCH_RESULTS + 7 }, (_, index) =>
      documentOf({
        threadId: `agt-t${String(index).padStart(3, "0")}`,
        title: `router ${index}`,
        updatedAtEpochMs: index,
      }),
    );
    const result = searchAgentThreadDocuments(docs, "router");

    expect(result.matches).toHaveLength(MAX_THREAD_SEARCH_RESULTS);
    expect(result.truncated).toBe(true);
    expect(new Set(result.matches.map((match) => match.threadId)).size).toBe(
      MAX_THREAD_SEARCH_RESULTS,
    );
  });

  it("honours a caller limit and clamps invalid or oversized limits", () => {
    const docs = Array.from({ length: 60 }, (_, index) =>
      documentOf({ threadId: `agt-t${index}`, title: `router ${index}` }),
    );

    expect(searchAgentThreadDocuments(docs, "router", 3).matches).toHaveLength(3);
    expect(searchAgentThreadDocuments(docs, "router", 3).truncated).toBe(true);
    expect(searchAgentThreadDocuments(docs, "router", 0).matches).toHaveLength(
      MAX_THREAD_SEARCH_RESULTS,
    );
    expect(searchAgentThreadDocuments(docs, "router", 5_000).matches).toHaveLength(
      MAX_THREAD_SEARCH_RESULTS,
    );
    expect(searchAgentThreadDocuments(docs, "router", Number.NaN).matches).toHaveLength(
      MAX_THREAD_SEARCH_RESULTS,
    );
  });

  it("treats the query as literal text rather than a pattern", () => {
    const docs = [documentOf({ title: "abc (router) [x]" })];

    expect(searchAgentThreadDocuments(docs, "a.c").matches).toHaveLength(0);
    expect(searchAgentThreadDocuments(docs, ".*").matches).toHaveLength(0);
    expect(searchAgentThreadDocuments(docs, "(router)").matches).toHaveLength(1);
    expect(searchAgentThreadDocuments(docs, "[x]").matches).toHaveLength(1);
  });

  it("reports the raw segment offset for hits deep inside a clipped snippet", () => {
    const filler = "x".repeat(2 * MAX_THREAD_SEARCH_SNIPPET_CHARS);
    const text = `${filler}router tail`;
    const docs = [
      documentOf({
        title: "unrelated",
        turns: [turn({ events: [{ kind: "assistantText", text }] })],
      }),
    ];

    const match = searchAgentThreadDocuments(docs, "router").matches[0];
    const range = match?.ranges[0];

    expect(match?.segmentStart).toBe(text.indexOf("router"));
    expect(match?.segmentEnd).toBe(text.indexOf("router") + 6);
    expect(match?.snippet.slice(range?.start ?? 0, range?.end ?? 0)).toBe("router");
    expect(range?.start).not.toBe(match?.segmentStart);
  });

  it("flags when any searched document was truncated, even without a retained match", () => {
    const complete = documentOf({ title: "router one" });
    const clipped = { ...documentOf({ title: "router two" }), truncated: true };

    expect(searchAgentThreadDocuments([complete], "router").documentsTruncated).toBe(false);
    expect(searchAgentThreadDocuments([complete, clipped], "router").documentsTruncated).toBe(true);
    expect(
      searchAgentThreadDocuments([{ ...clipped, titleLower: "other" }], "router")
        .documentsTruncated,
    ).toBe(true);
  });

  it("marks the matched range inside the returned snippet", () => {
    const result = searchAgentThreadDocuments(
      [documentOf({ title: "Fix the ROUTER now" })],
      "router",
    );
    const match = result.matches[0];
    const range = match?.ranges[0];

    expect(match?.snippet).toBe("Fix the ROUTER now");
    expect(match?.snippet.slice(range?.start ?? 0, range?.end ?? 0)).toBe("ROUTER");
  });
});

describe("threadSearchSnippet", () => {
  it("returns short text unchanged with the hit range", () => {
    const snippet = threadSearchSnippet(textSegment("hello router"), 6, 6);

    expect(snippet.snippet).toBe("hello router");
    expect(snippet.ranges).toEqual([{ start: 6, end: 12 }]);
  });

  it("centres a long text on the hit and adds both ellipses", () => {
    const text = `${"a".repeat(1_000)}router${"b".repeat(1_000)}`;
    const snippet = threadSearchSnippet(textSegment(text), 1_000, 6);
    const range = snippet.ranges[0];

    expect(snippet.snippet.startsWith("…")).toBe(true);
    expect(snippet.snippet.endsWith("…")).toBe(true);
    expect(snippet.snippet.length).toBeLessThanOrEqual(MAX_THREAD_SEARCH_SNIPPET_CHARS + 3);
    expect(snippet.snippet.slice(range?.start ?? 0, range?.end ?? 0)).toBe("router");
  });

  it("omits the leading ellipsis at the start and the trailing one at the end", () => {
    const head = `router${"b".repeat(1_000)}`;
    const tail = `${"a".repeat(1_000)}router`;
    const atHead = threadSearchSnippet(textSegment(head), 0, 6);
    const atTail = threadSearchSnippet(textSegment(tail), 1_000, 6);

    expect(atHead.snippet.startsWith("router")).toBe(true);
    expect(atHead.snippet.endsWith("…")).toBe(true);
    expect(atTail.snippet.startsWith("…")).toBe(true);
    expect(atTail.snippet.endsWith("router")).toBe(true);
    expect(atTail.snippet.slice(atTail.ranges[0]?.start ?? 0, atTail.ranges[0]?.end ?? 0)).toBe(
      "router",
    );
  });

  it("never splits a surrogate pair at either snippet boundary", () => {
    const filler = "😀".repeat(400);
    for (let shift = 0; shift < 8; shift += 1) {
      const text = `${"a".repeat(shift)}${filler}router${filler}`;
      const index = text.indexOf("router");
      const snippet = threadSearchSnippet(textSegment(text), index, 6);
      const range = snippet.ranges[0];

      expect(hasLoneSurrogate(snippet.snippet)).toBe(false);
      expect(snippet.snippet.slice(range?.start ?? 0, range?.end ?? 0)).toBe("router");
    }
  });

  it("clamps a hit range that falls outside the segment text", () => {
    const snippet = threadSearchSnippet(textSegment("short"), 99, 6);

    expect(snippet.ranges).toEqual([{ start: 5, end: 5 }]);
  });
});

describe("findInThread", () => {
  it("finds hits in prompts and assistant events in stable order", () => {
    const hits = findInThread(
      thread({
        turns: [
          turn({
            turnId: "t1",
            prompt: "router and router",
            events: [
              { kind: "reasoning", text: "router hidden" },
              { kind: "assistantText", text: "the Router answer" },
              { kind: "result", text: "router result", isError: false, usage: null },
            ],
          }),
          turn({ turnId: "t2", prompt: "second router" }),
        ],
      }),
      "router",
    );

    expect(hits).toEqual([
      { turnId: "t1", eventIndex: null, start: 0, end: 6 },
      { turnId: "t1", eventIndex: null, start: 11, end: 17 },
      { turnId: "t1", eventIndex: 1, start: 4, end: 10 },
      { turnId: "t1", eventIndex: 2, start: 0, end: 6 },
      { turnId: "t2", eventIndex: null, start: 7, end: 13 },
    ]);
  });

  it("skips events that fall outside the rendered tail when a cap is given", () => {
    const events = Array.from({ length: 5 }, (_, index) => ({
      kind: "assistantText" as const,
      text: `router ${index}`,
    }));
    const subject = thread({ turns: [turn({ turnId: "t1", prompt: "none", events })] });

    expect(findInThread(subject, "router", { maxEventsPerTurn: 2 })).toEqual([
      { turnId: "t1", eventIndex: 3, start: 0, end: 6 },
      { turnId: "t1", eventIndex: 4, start: 0, end: 6 },
    ]);
    expect(findInThread(subject, "router", { maxEventsPerTurn: 0 })).toEqual([]);
    expect(findInThread(subject, "router", { maxEventsPerTurn: -1 })).toHaveLength(5);
    expect(findInThread(subject, "router")).toHaveLength(5);
  });

  it("returns no hits for a query below the minimum length", () => {
    expect(findInThread(thread({ turns: [turn({ prompt: "aaaa" })] }), "a")).toEqual([]);
  });

  it("caps the hit count", () => {
    const hits = findInThread(
      thread({
        turns: Array.from({ length: 4 }, (_, index) =>
          turn({ turnId: `t${index}`, prompt: "ab".repeat(400) }),
        ),
      }),
      "ab",
    );

    expect(hits).toHaveLength(MAX_THREAD_FIND_HITS);
    expect(hits[0]).toEqual({ turnId: "t0", eventIndex: null, start: 0, end: 2 });
  });

  it("does not report overlapping hits for repeating queries", () => {
    const hits = findInThread(thread({ turns: [turn({ turnId: "t1", prompt: "aaaa" })] }), "aa");

    expect(hits).toEqual([
      { turnId: "t1", eventIndex: null, start: 0, end: 2 },
      { turnId: "t1", eventIndex: null, start: 2, end: 4 },
    ]);
  });
});

describe("insertRankedSearchResult", () => {
  it("keeps the array sorted and bounded by the limit", () => {
    const ranked: RankedSearchEntry[] = [];
    for (const score of [5, 1, 9, 3, 7]) {
      insertRankedSearchResult(ranked, { score, recencyEpochMs: 0, tieBreakKey: `k${score}` }, 3);
    }

    expect(ranked.map((entry) => entry.score)).toEqual([1, 3, 5]);
  });

  it("rejects a candidate that cannot beat the worst kept entry", () => {
    const ranked: RankedSearchEntry[] = [];
    insertRankedSearchResult(ranked, { score: 1, recencyEpochMs: 0, tieBreakKey: "a" }, 1);
    const inserted = insertRankedSearchResult(
      ranked,
      { score: 2, recencyEpochMs: 0, tieBreakKey: "b" },
      1,
    );

    expect(inserted).toBe(false);
    expect(ranked.map((entry) => entry.tieBreakKey)).toEqual(["a"]);
  });

  it("keeps nothing when the limit is not a positive integer", () => {
    const ranked: RankedSearchEntry[] = [];

    expect(
      insertRankedSearchResult(ranked, { score: 1, recencyEpochMs: 0, tieBreakKey: "a" }, 0),
    ).toBe(false);
    expect(ranked).toHaveLength(0);
  });
});

describe("agent thread search performance", () => {
  const assistantText = `${"Lorem Ipsum Dolor Sit Amet ".repeat(620)}ZQ marker`;
  const promptText = "Plan The Change";
  const perfThreads = Array.from({ length: 64 }, (_, threadIndex) =>
    thread({
      threadId: `agt-p${String(threadIndex).padStart(3, "0")}`,
      title: `perf thread ${threadIndex}`,
      updatedAtEpochMs: 1_000 + threadIndex,
      turns: Array.from({ length: 64 }, (_, turnIndex) =>
        turn({
          turnId: `agt-p${threadIndex}-${turnIndex}`,
          prompt: promptText,
          events: [{ kind: "assistantText", text: assistantText }],
        }),
      ),
    }),
  );

  it("builds, rebuilds and searches bounded documents within budget", () => {
    expect(new TextEncoder().encode(assistantText).byteLength).toBeGreaterThan(16 * 1_024);

    const buildStart = performance.now();
    const docs = perfThreads.map((entry) => buildAgentThreadSearchDocument(entry));
    const buildMs = performance.now() - buildStart;

    const rebuildSamples = Array.from({ length: 5 }, () => {
      const start = performance.now();
      buildAgentThreadSearchDocument(perfThreads[0] ?? thread());
      return performance.now() - start;
    });

    const searchSamples = Array.from({ length: 5 }, () => {
      const start = performance.now();
      searchAgentThreadDocuments(docs, "qj");
      return performance.now() - start;
    });

    expect(docs.every((doc) => doc.truncated)).toBe(true);
    expect(searchAgentThreadDocuments(docs, "qj").matches).toHaveLength(0);
    expect(searchAgentThreadDocuments(docs, "zq").matches).toHaveLength(MAX_THREAD_SEARCH_RESULTS);
    expect(buildMs).toBeLessThan(BUILD_BUDGET_MS);
    expect(medianMs(rebuildSamples)).toBeLessThan(REBUILD_BUDGET_MS);
    expect(medianMs(searchSamples)).toBeLessThan(SEARCH_BUDGET_MS);
  });
});
