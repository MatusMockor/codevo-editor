import { MAX_AGENT_TOOL_ID_BYTES } from "@codevo/agent-events";
import { describe, expect, it } from "vitest";
import wire from "../../contracts/agent-runtime-request-wire.json";
import { MAX_AGENT_APPROVAL_FACTS, MAX_AGENT_APPROVAL_TITLE_BYTES } from "./agentApproval";
import { MAX_AGENT_QUESTIONS, MAX_AGENT_QUESTION_OPTIONS } from "./agentQuestion";
import {
  AGENT_RUNTIME_REQUEST_BODY_KINDS,
  AGENT_RUNTIME_REQUEST_CLOSE_REASONS,
  AGENT_RUNTIME_REQUEST_PROVIDERS,
  AGENT_RUNTIME_REQUEST_STATUSES,
  AGENT_RUNTIME_REQUEST_TRANSITIONS,
  AGENT_THREAD_REQUESTS_JOURNALS,
  MAX_AGENT_THREAD_REQUESTS_PER_MESSAGE,
  MAX_AGENT_THREAD_REQUESTS_RETAINED,
  MAX_AGENT_THREAD_REQUEST_FENCES,
  isAgentRuntimeRequestTransitionAllowed,
  mergeAgentThreadRequests,
  parseAgentRuntimeRequest,
  parseAgentThreadRequests,
  pendingAgentRuntimeRequests,
  type AgentRuntimeRequest,
  type AgentRuntimeRequestStatus,
  type AgentThreadRequests,
  type AgentThreadRequestsMerge,
  type AgentThreadRequestsState,
} from "./agentRuntimeRequest";

type WireValue = Readonly<Record<string, unknown>>;

interface ValidCase {
  readonly name: string;
  readonly description: string;
  readonly value: WireValue;
}

interface InvalidCase {
  readonly name: string;
  readonly description: string;
  readonly base: string;
  readonly patch: WireValue;
  readonly omit?: readonly string[];
}

const VALID_REQUESTS: readonly ValidCase[] = wire.requests.valid;
const INVALID_REQUESTS: readonly InvalidCase[] = wire.requests.invalid;
const VALID_THREAD_REQUESTS: readonly ValidCase[] = wire.threadRequests.valid;
const INVALID_THREAD_REQUESTS: readonly InvalidCase[] = wire.threadRequests.invalid;
const TERMINAL_STATUSES: readonly AgentRuntimeRequestStatus[] = [
  "resolved",
  "cancelled",
  "expired",
  "timedOut",
];

const SERIES_EPOCH_MS = 1_000;
const NO_RETENTION = { fences: [], forgottenThroughEpochMs: null };

function validValue(cases: readonly ValidCase[], name: string): WireValue {
  const found = cases.find((candidate) => candidate.name === name);
  expect(found, `valid case ${name}`).toBeDefined();
  return found?.value ?? {};
}

function patchedValue(cases: readonly ValidCase[], invalid: InvalidCase): WireValue {
  const omitted = invalid.omit ?? [];
  const patched = { ...validValue(cases, invalid.base), ...invalid.patch };
  return Object.fromEntries(Object.entries(patched).filter(([key]) => !omitted.includes(key)));
}

function invalidRequest(name: string): WireValue {
  const found = INVALID_REQUESTS.find((candidate) => candidate.name === name);
  expect(found, `invalid case ${name}`).toBeDefined();
  if (found === undefined) return {};
  return patchedValue(VALID_REQUESTS, found);
}

function field(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object") return undefined;
  return (value as WireValue)[key];
}

function request(overrides: WireValue = {}): AgentRuntimeRequest {
  return parseAgentRuntimeRequest({
    ...validValue(VALID_REQUESTS, "pendingApproval"),
    ...overrides,
  });
}

function closedRequest(overrides: WireValue = {}): AgentRuntimeRequest {
  return parseAgentRuntimeRequest({
    ...validValue(VALID_REQUESTS, "timedOutApproval"),
    ...overrides,
  });
}

type Incoming = AgentThreadRequests & Pick<AgentThreadRequestsMerge, "source">;

function message(
  requests: readonly AgentRuntimeRequest[],
  overrides: Partial<Incoming> = {},
): Incoming {
  return {
    workspaceId: "workspace-alpha",
    threadId: "agt-thread-0001",
    epoch: "boot-0001",
    journal: "saved",
    requests,
    truncated: false,
    unreadable: 0,
    reset: false,
    source: "push",
    ...overrides,
  };
}

function pulled(requests: readonly AgentRuntimeRequest[]): Incoming {
  return message(requests, { source: "pull" });
}

function deliver(
  state: AgentThreadRequestsState | null,
  requests: readonly AgentRuntimeRequest[],
): AgentThreadRequestsState {
  let next = mergeAgentThreadRequests(state, message([]));
  for (let start = 0; start < requests.length; start += MAX_AGENT_THREAD_REQUESTS_PER_MESSAGE) {
    const page = requests.slice(start, start + MAX_AGENT_THREAD_REQUESTS_PER_MESSAGE);
    next = mergeAgentThreadRequests(next, message(page));
  }
  return next;
}

function ids(state: AgentThreadRequestsState): readonly string[] {
  return state.requests.map((retained) => `${retained.turnId}/${retained.id}`);
}

function series(
  count: number,
  build: (overrides: WireValue) => AgentRuntimeRequest,
  prefix: string,
  firstOrder: number,
): readonly AgentRuntimeRequest[] {
  return Array.from({ length: count }, (_unused, index) =>
    build({
      id: `${prefix}-${String(index).padStart(4, "0")}`,
      turnId: "agt-turn-cap",
      order: firstOrder + index,
      createdAtEpochMs: SERIES_EPOCH_MS + firstOrder + index,
    }),
  );
}

describe("agent runtime request wire contract", () => {
  it("pins the closed variants and limits shared with the Rust backend", () => {
    expect(wire.schemaVersion).toBe(1);
    expect(AGENT_RUNTIME_REQUEST_STATUSES).toEqual(wire.statuses);
    expect(AGENT_RUNTIME_REQUEST_CLOSE_REASONS).toEqual(wire.closeReasons);
    expect(AGENT_RUNTIME_REQUEST_PROVIDERS).toEqual(wire.providers);
    expect(AGENT_RUNTIME_REQUEST_BODY_KINDS).toEqual(wire.bodyKinds);
    expect(AGENT_THREAD_REQUESTS_JOURNALS).toEqual(wire.journals);
    expect(AGENT_RUNTIME_REQUEST_TRANSITIONS).toEqual(wire.transitions);
    expect(wire.limits).toEqual({
      idBytes: 128,
      anchorToolIdBytes: MAX_AGENT_TOOL_ID_BYTES,
      questions: MAX_AGENT_QUESTIONS,
      questionOptions: MAX_AGENT_QUESTION_OPTIONS,
      approvalFacts: MAX_AGENT_APPROVAL_FACTS,
      approvalTitleBytes: MAX_AGENT_APPROVAL_TITLE_BYTES,
      requestsPerMessage: MAX_AGENT_THREAD_REQUESTS_PER_MESSAGE,
      retainedRequestsPerThread: MAX_AGENT_THREAD_REQUESTS_RETAINED,
      retainedFencesPerThread: MAX_AGENT_THREAD_REQUEST_FENCES,
    });
  });

  it("names and describes every case exactly once per section", () => {
    for (const cases of [
      VALID_REQUESTS,
      INVALID_REQUESTS,
      VALID_THREAD_REQUESTS,
      INVALID_THREAD_REQUESTS,
    ]) {
      const names = cases.map((candidate) => candidate.name);

      expect(new Set(names).size).toBe(names.length);
      expect(cases.every((candidate) => candidate.description.trim().length > 0)).toBe(true);
    }
  });

  it.each(VALID_REQUESTS)("parses the valid request $name unchanged", ({ value }) => {
    expect(parseAgentRuntimeRequest(value)).toEqual(value);
  });

  it.each(INVALID_REQUESTS)("rejects the invalid request $name", (invalid) => {
    const base = validValue(VALID_REQUESTS, invalid.base);

    expect(parseAgentRuntimeRequest(base)).toEqual(base);
    expect(() => parseAgentRuntimeRequest(patchedValue(VALID_REQUESTS, invalid))).toThrow();
  });

  it("covers every status, capability, close reason, body and resolution kind", () => {
    const values = VALID_REQUESTS.map((candidate) => candidate.value);
    const pairs = values.map(
      (value) => `${String(value.status)}:${String(field(value.responseCapability, "kind"))}`,
    );
    const reasons = values.map((value) => field(value.responseCapability, "reason"));
    const bodies = values.map((value) => field(value.body, "kind"));
    const resolutions = values.map((value) => field(value.resolution, "kind"));
    const anchors = values.map((value) => value.anchorToolId === null);

    expect([...new Set(pairs)].sort()).toEqual(
      [
        "pending:live",
        "submitting:notResumable",
        "resolved:notResumable",
        "cancelled:notResumable",
        "expired:notResumable",
        "timedOut:notResumable",
      ].sort(),
    );
    expect(reasons).toEqual(expect.arrayContaining([...AGENT_RUNTIME_REQUEST_CLOSE_REASONS]));
    expect(bodies).toEqual(expect.arrayContaining([...AGENT_RUNTIME_REQUEST_BODY_KINDS]));
    expect(resolutions).toEqual(expect.arrayContaining(["answers", "decision", undefined]));
    expect(anchors).toEqual(expect.arrayContaining([true, false]));
  });

  it("rejects values that are not plain records", () => {
    for (const value of [
      null,
      undefined,
      "pending",
      1,
      [],
      [validValue(VALID_REQUESTS, "pendingQuestion")],
    ]) {
      expect(() => parseAgentRuntimeRequest(value)).toThrow();
      expect(() => parseAgentThreadRequests(value)).toThrow();
    }
  });

  it("accepts ids up to the id limit and rejects longer ones", () => {
    const longest = `r${"0".repeat(wire.limits.idBytes - 1)}`;

    expect(request({ id: longest }).id).toBe(longest);
    expect(() => request({ id: `${longest}0` })).toThrow();
  });

  it("accepts anchor tool ids up to the byte limit and rejects longer ones", () => {
    const longest = "t".repeat(wire.limits.anchorToolIdBytes);
    const multibyte = "é".repeat(wire.limits.anchorToolIdBytes / 2);

    expect(request({ anchorToolId: longest }).anchorToolId).toBe(longest);
    expect(request({ anchorToolId: multibyte }).anchorToolId).toBe(multibyte);
    expect(() => request({ anchorToolId: `${longest}t` })).toThrow();
    expect(() => request({ anchorToolId: `${multibyte}é` })).toThrow();
  });

  it("keeps the oversize fixture strings above their limits", () => {
    expect(String(invalidRequest("oversizeId").id).length).toBeGreaterThan(wire.limits.idBytes);
    expect(String(invalidRequest("oversizeAnchorToolId").anchorToolId).length).toBeGreaterThan(
      wire.limits.anchorToolIdBytes,
    );
    expect(
      String(field(invalidRequest("oversizeApprovalTitle").body, "title")).length,
    ).toBeGreaterThan(wire.limits.approvalTitleBytes);
  });

  it.each(VALID_THREAD_REQUESTS)("parses the valid thread message $name unchanged", ({ value }) => {
    expect(parseAgentThreadRequests(value)).toEqual(value);
  });

  it.each(INVALID_THREAD_REQUESTS)("rejects the invalid thread message $name", (invalid) => {
    const base = validValue(VALID_THREAD_REQUESTS, invalid.base);

    expect(parseAgentThreadRequests(base)).toEqual(base);
    expect(() => parseAgentThreadRequests(patchedValue(VALID_THREAD_REQUESTS, invalid))).toThrow();
  });

  it("rejects the client-side merge source on the wire", () => {
    const base = validValue(VALID_THREAD_REQUESTS, "emptySaved");

    expect(Object.keys(parseAgentThreadRequests(base))).not.toContain("source");
    expect(() => parseAgentThreadRequests({ ...base, source: "pull" })).toThrow();
  });

  it("accepts a full message and rejects one request more", () => {
    const base = validValue(VALID_THREAD_REQUESTS, "emptySaved");
    const pending = validValue(VALID_REQUESTS, "pendingApproval");
    const requests = Array.from(
      { length: wire.limits.requestsPerMessage + 1 },
      (_unused, index) => ({
        ...pending,
        id: `req-${index}`,
        order: index,
      }),
    );

    expect(
      parseAgentThreadRequests({ ...base, requests: requests.slice(1) }).requests,
    ).toHaveLength(wire.limits.requestsPerMessage);
    expect(() => parseAgentThreadRequests({ ...base, requests })).toThrow();
  });
});

describe("agent thread requests merge", () => {
  it("builds the first state from a message", () => {
    const first = request({ id: "req-a", order: 0 });
    const state = mergeAgentThreadRequests(
      null,
      message([first], { journal: "degraded", truncated: true, unreadable: 2 }),
    );

    expect(state).toEqual({
      threadId: "agt-thread-0001",
      epoch: "boot-0001",
      journal: "degraded",
      requests: [first],
      truncated: true,
      unreadable: 2,
      retention: NO_RETENTION,
    });
  });

  it("replaces a record only with a higher version", () => {
    const first = request({ id: "req-a", version: 2 });
    const state = mergeAgentThreadRequests(null, message([first]));
    const newer = closedRequest({ id: "req-a", turnId: first.turnId, version: 3 });

    const next = mergeAgentThreadRequests(state, message([newer]));

    expect(next).not.toBe(state);
    expect(next.requests).toEqual([newer]);
    expect(next.requests[0]).toBe(newer);
  });

  it("returns the same state for stale, equal and duplicate messages", () => {
    const first = request({ id: "req-a", version: 2 });
    const second = request({ id: "req-b", order: 5, version: 1 });
    const incoming = message([first, second]);
    const state = mergeAgentThreadRequests(null, incoming);
    const stale = closedRequest({ id: "req-a", turnId: first.turnId, version: 1 });
    const equal = closedRequest({ id: "req-a", turnId: first.turnId, version: 2 });

    expect(mergeAgentThreadRequests(state, incoming)).toBe(state);
    expect(mergeAgentThreadRequests(state, message([stale]))).toBe(state);
    expect(mergeAgentThreadRequests(state, message([equal]))).toBe(state);
    expect(mergeAgentThreadRequests(state, message([request({ id: "req-a", version: 2 })]))).toBe(
      state,
    );
    expect(mergeAgentThreadRequests(state, message([]))).toBe(state);
    expect(state.requests[0]).toBe(first);
  });

  it("applies the version rule to pulls and pushes alike", () => {
    const resolved = closedRequest({ id: "req-a", version: 2 });
    const stale = request({ id: "req-a", turnId: resolved.turnId, version: 1 });
    const newer = closedRequest({ id: "req-a", version: 3 });
    const state = mergeAgentThreadRequests(null, message([resolved]));

    expect(mergeAgentThreadRequests(state, pulled([stale]))).toBe(state);
    expect(mergeAgentThreadRequests(state, pulled([resolved]))).toBe(state);
    expect(mergeAgentThreadRequests(state, pulled([]))).toBe(state);
    expect(mergeAgentThreadRequests(state, message([]))).toBe(state);
    expect(mergeAgentThreadRequests(state, pulled([newer])).requests).toEqual([newer]);
    expect(mergeAgentThreadRequests(null, pulled([resolved]))).toEqual(state);
  });

  it("keeps an id reused by another turn as a separate record", () => {
    const first = request({ id: "req-a", turnId: "agt-turn-0001", version: 5 });
    const other = request({ id: "req-a", turnId: "agt-turn-0002", version: 1 });

    const state = deliver(null, [first, other]);

    expect(ids(state)).toEqual(["agt-turn-0001/req-a", "agt-turn-0002/req-a"]);
  });

  it("publishes thread-level changes without replacing unchanged records", () => {
    const state = mergeAgentThreadRequests(null, message([request({ id: "req-a" })]));

    const degraded = mergeAgentThreadRequests(
      state,
      message([], { journal: "degraded", unreadable: 4 }),
    );

    expect(degraded).not.toBe(state);
    expect(degraded.requests).toBe(state.requests);
    expect(degraded.journal).toBe("degraded");
    expect(degraded.unreadable).toBe(4);
    expect(
      mergeAgentThreadRequests(degraded, message([], { journal: "degraded", unreadable: 4 })),
    ).toBe(degraded);
  });

  it("keeps the truncated flag within an epoch until the state is replaced", () => {
    const first = request({ id: "req-a" });
    const state = mergeAgentThreadRequests(null, message([first], { truncated: true }));

    const merged = mergeAgentThreadRequests(state, message([request({ id: "req-b", order: 9 })]));
    const reset = mergeAgentThreadRequests(merged, message([first], { reset: true }));

    expect(merged.truncated).toBe(true);
    expect(reset.truncated).toBe(false);
  });

  it("replaces the whole state when the epoch changes", () => {
    const state = deliver(null, [
      request({ id: "req-a", version: 7 }),
      request({ id: "req-b", order: 3 }),
    ]);
    const restarted = closedRequest({ id: "req-a", turnId: "agt-turn-0001", version: 1 });

    const next = mergeAgentThreadRequests(
      state,
      message([restarted], { epoch: "boot-0002", journal: "degraded", unreadable: 1 }),
    );
    const returned = mergeAgentThreadRequests(next, message([request({ id: "req-c" })]));

    expect(next.epoch).toBe("boot-0002");
    expect(next.requests).toEqual([restarted]);
    expect(next.journal).toBe("degraded");
    expect(next.unreadable).toBe(1);
    expect(returned.epoch).toBe("boot-0001");
    expect(ids(returned)).toEqual(["agt-turn-0001/req-c"]);
  });

  it("replaces the whole state on reset, including lower versions", () => {
    const state = deliver(null, [
      request({ id: "req-a", version: 7 }),
      request({ id: "req-b", order: 3 }),
    ]);
    const older = request({ id: "req-a", version: 2 });

    const next = mergeAgentThreadRequests(state, message([older], { reset: true }));

    expect(next.requests).toEqual([older]);
    expect(next.requests[0]).toBe(older);
    expect(mergeAgentThreadRequests(next, message([], { reset: true })).requests).toEqual([]);
  });

  it("ignores messages of another thread", () => {
    const state = mergeAgentThreadRequests(null, message([request({ id: "req-a" })]));
    const foreign = [request({ id: "req-z", version: 9 })];

    expect(mergeAgentThreadRequests(state, message(foreign, { threadId: "agt-thread-0002" }))).toBe(
      state,
    );
    expect(
      mergeAgentThreadRequests(
        state,
        message(foreign, { threadId: "agt-thread-0002", reset: true }),
      ),
    ).toBe(state);
    expect(
      mergeAgentThreadRequests(
        state,
        message(foreign, { threadId: "agt-thread-0002", epoch: "boot-0002" }),
      ),
    ).toBe(state);
  });

  it.each([
    { name: "none then a stamp", first: null, second: "workspace-alpha" },
    { name: "a stamp then none", first: "workspace-alpha", second: null },
    { name: "two different stamps", first: "workspace-alpha", second: "workspace-beta" },
  ])("merges messages whose workspace ids are $name", ({ first, second }) => {
    const known = request({ id: "req-a", version: 1 });
    const added = request({ id: "req-b", order: 5 });
    const newer = closedRequest({ id: "req-a", turnId: known.turnId, version: 2 });
    const state = mergeAgentThreadRequests(null, message([known], { workspaceId: first }));

    const next = mergeAgentThreadRequests(state, message([added, newer], { workspaceId: second }));

    expect(next.requests).toEqual([newer, added]);
    expect(next.epoch).toBe(state.epoch);
    expect(mergeAgentThreadRequests(next, message([known], { workspaceId: first }))).toBe(next);
    expect(mergeAgentThreadRequests(state, message([known], { workspaceId: second }))).toBe(state);
  });

  it("keeps no workspace id in the state", () => {
    const stamped = mergeAgentThreadRequests(null, message([], { workspaceId: "workspace-alpha" }));
    const bare = mergeAgentThreadRequests(null, message([], { workspaceId: null }));

    expect(Object.keys(stamped)).not.toContain("workspaceId");
    expect(stamped).toEqual(bare);
  });

  it("orders records by turn start, turn id, order and id", () => {
    const state = deliver(null, [
      request({ id: "req-late", turnId: "agt-turn-b", createdAtEpochMs: 300, order: 1 }),
      request({ id: "req-z", turnId: "agt-turn-a", createdAtEpochMs: 500, order: 2 }),
      request({ id: "req-y", turnId: "agt-turn-c", createdAtEpochMs: 200, order: 0 }),
      request({ id: "req-b", turnId: "agt-turn-a", createdAtEpochMs: 400, order: 1 }),
      request({ id: "req-a", turnId: "agt-turn-a", createdAtEpochMs: 100, order: 1 }),
      request({ id: "req-first", turnId: "agt-turn-b", createdAtEpochMs: 200, order: 0 }),
    ]);

    expect(ids(state)).toEqual([
      "agt-turn-a/req-a",
      "agt-turn-a/req-b",
      "agt-turn-a/req-z",
      "agt-turn-b/req-first",
      "agt-turn-b/req-late",
      "agt-turn-c/req-y",
    ]);
  });

  it("produces the same order for every delivery order", () => {
    const records = [
      request({ id: "req-c", turnId: "agt-turn-b", createdAtEpochMs: 300, order: 0 }),
      request({ id: "req-a", turnId: "agt-turn-a", createdAtEpochMs: 100, order: 0 }),
      request({ id: "req-b", turnId: "agt-turn-a", createdAtEpochMs: 200, order: 1 }),
    ];

    const forward = records.reduce<AgentThreadRequestsState | null>(
      (state, record) => mergeAgentThreadRequests(state, message([record])),
      null,
    );
    const backward = [...records]
      .reverse()
      .reduce<AgentThreadRequestsState | null>(
        (state, record) => mergeAgentThreadRequests(state, message([record])),
        null,
      );

    expect(forward).toEqual(backward);
  });

  it("drops the oldest closed records beyond the cap and reports truncation", () => {
    const closed = series(MAX_AGENT_THREAD_REQUESTS_RETAINED, closedRequest, "closed", 0);
    const full = deliver(null, closed);
    const open = series(2, request, "open", MAX_AGENT_THREAD_REQUESTS_RETAINED);

    const next = deliver(full, open);

    expect(full.requests).toHaveLength(MAX_AGENT_THREAD_REQUESTS_RETAINED);
    expect(full.truncated).toBe(false);
    expect(next.requests).toHaveLength(MAX_AGENT_THREAD_REQUESTS_RETAINED);
    expect(next.truncated).toBe(true);
    expect(ids(next).slice(0, 1)).toEqual(["agt-turn-cap/closed-0002"]);
    expect(ids(next).slice(-2)).toEqual(["agt-turn-cap/open-0000", "agt-turn-cap/open-0001"]);
  });

  it("keeps open records ahead of newer closed records at the cap", () => {
    const open = series(3, request, "open", 0);
    const closed = series(MAX_AGENT_THREAD_REQUESTS_RETAINED, closedRequest, "closed", 3);

    const state = deliver(null, [...open, ...closed]);

    expect(state.requests).toHaveLength(MAX_AGENT_THREAD_REQUESTS_RETAINED);
    expect(state.truncated).toBe(true);
    expect(pendingAgentRuntimeRequests(state).map((pending) => pending.id)).toEqual([
      "open-0000",
      "open-0001",
      "open-0002",
    ]);
    expect(ids(state)[3]).toBe("agt-turn-cap/closed-0003");
  });

  it("drops the oldest open records only when open records alone exceed the cap", () => {
    const open = series(MAX_AGENT_THREAD_REQUESTS_RETAINED + 2, request, "open", 0);

    const state = deliver(null, open);

    expect(state.requests).toHaveLength(MAX_AGENT_THREAD_REQUESTS_RETAINED);
    expect(state.truncated).toBe(true);
    expect(ids(state)[0]).toBe("agt-turn-cap/open-0002");
  });

  it("stays identical when an evicted record is delivered again", () => {
    const closed = series(MAX_AGENT_THREAD_REQUESTS_RETAINED + 1, closedRequest, "closed", 0);
    const state = deliver(null, closed);

    const next = mergeAgentThreadRequests(state, message(closed.slice(0, 1)));

    expect(state.truncated).toBe(true);
    expect(ids(state)[0]).toBe("agt-turn-cap/closed-0001");
    expect(next).toBe(state);
  });

  it("reports truncation when a full state rejects an older closed record", () => {
    const closed = series(MAX_AGENT_THREAD_REQUESTS_RETAINED, closedRequest, "closed", 1);
    const state = deliver(null, closed);
    const older = closedRequest({ id: "closed-older", turnId: "agt-turn-cap", order: 0 });

    const next = mergeAgentThreadRequests(state, message([older]));

    expect(state.truncated).toBe(false);
    expect(next.truncated).toBe(true);
    expect(next.requests).toBe(state.requests);
  });

  it("keeps the order of a capped state when an empty message follows", () => {
    const early = closedRequest({ id: "req-early", turnId: "agt-turn-a", order: 0 });
    const late = closedRequest({
      id: "req-late",
      turnId: "agt-turn-a",
      order: 1,
      createdAtEpochMs: 1_000,
    });
    const other = Array.from({ length: MAX_AGENT_THREAD_REQUESTS_RETAINED - 1 }, (_unused, index) =>
      closedRequest({
        id: `req-${String(index).padStart(4, "0")}`,
        turnId: "agt-turn-b",
        order: index,
        createdAtEpochMs: 100,
      }),
    );

    const state = deliver(null, [early, late, ...other]);

    expect(state.requests).toHaveLength(MAX_AGENT_THREAD_REQUESTS_RETAINED);
    expect(ids(state)).not.toContain("agt-turn-a/req-early");
    expect(ids(state)[0]).toBe("agt-turn-b/req-0000");
    expect(ids(state).slice(-1)).toEqual(["agt-turn-a/req-late"]);
    expect(mergeAgentThreadRequests(state, message([]))).toBe(state);
  });

  it("returns the identical state for an empty message after every eviction", () => {
    const closed = series(MAX_AGENT_THREAD_REQUESTS_RETAINED, closedRequest, "closed", 0);
    const open = series(MAX_AGENT_THREAD_REQUESTS_RETAINED + 2, request, "open", 1_000);

    const afterClosed = deliver(deliver(null, closed), open.slice(0, 5));
    const afterOpen = deliver(afterClosed, open);

    expect(mergeAgentThreadRequests(afterClosed, message([]))).toBe(afterClosed);
    expect(mergeAgentThreadRequests(afterOpen, message([]))).toBe(afterOpen);
  });
});

describe("agent thread requests version fences", () => {
  const overCap = series(MAX_AGENT_THREAD_REQUESTS_RETAINED + 1, closedRequest, "closed", 0);
  const stalePending = request({
    id: "closed-0000",
    turnId: "agt-turn-cap",
    order: 0,
    version: 1,
    createdAtEpochMs: SERIES_EPOCH_MS,
  });

  it("never revives an evicted closed record from a stale pending version", () => {
    const state = deliver(null, overCap);

    const next = mergeAgentThreadRequests(state, message([stalePending]));

    expect(ids(state)).not.toContain("agt-turn-cap/closed-0000");
    expect(state.retention.fences).toEqual([
      { turnId: "agt-turn-cap", id: "closed-0000", version: 2, createdAtEpochMs: SERIES_EPOCH_MS },
    ]);
    expect(next).toBe(state);
    expect(pendingAgentRuntimeRequests(next)).toEqual([]);
    expect(mergeAgentThreadRequests(state, pulled([stalePending]))).toBe(state);
  });

  it("raises the fence when a newer version of an evicted record arrives", () => {
    const state = deliver(null, overCap);
    const newer = closedRequest({
      id: "closed-0000",
      turnId: "agt-turn-cap",
      order: 0,
      version: 4,
      createdAtEpochMs: SERIES_EPOCH_MS,
    });
    const between = request({
      id: "closed-0000",
      turnId: "agt-turn-cap",
      order: 0,
      version: 3,
      createdAtEpochMs: SERIES_EPOCH_MS,
    });

    const next = mergeAgentThreadRequests(state, message([newer]));

    expect(next.requests).toBe(state.requests);
    expect(next.retention.fences.map((fence) => fence.version)).toEqual([4]);
    expect(mergeAgentThreadRequests(next, message([between]))).toBe(next);
    expect(mergeAgentThreadRequests(next, message([newer]))).toBe(next);
  });

  it("drops the fence of a record that returns with a newer open version", () => {
    const state = deliver(null, overCap);
    const reopened = request({
      id: "closed-0000",
      turnId: "agt-turn-cap",
      order: 0,
      version: 3,
      createdAtEpochMs: SERIES_EPOCH_MS,
    });

    const next = mergeAgentThreadRequests(state, message([reopened]));

    expect(next.requests[0]).toBe(reopened);
    expect(next.retention.fences.map((fence) => fence.id)).toEqual(["closed-0001"]);
  });

  it("fences a record that is evicted on arrival", () => {
    const state = deliver(
      null,
      series(MAX_AGENT_THREAD_REQUESTS_RETAINED, closedRequest, "closed", 1),
    );
    const older = closedRequest({ id: "closed-older", turnId: "agt-turn-cap", order: 0 });
    const stale = request({ id: "closed-older", turnId: "agt-turn-cap", order: 0, version: 1 });

    const next = mergeAgentThreadRequests(state, message([older]));

    expect(next.requests).toBe(state.requests);
    expect(next.retention.fences.map((fence) => fence.id)).toEqual(["closed-older"]);
    expect(mergeAgentThreadRequests(next, message([stale]))).toBe(next);
    expect(mergeAgentThreadRequests(next, message([older]))).toBe(next);
  });

  it("admits a never-seen record of an older turn with a lower version", () => {
    const state = deliver(null, [
      request({ id: "req-new", turnId: "agt-turn-new", version: 9, createdAtEpochMs: 5_000 }),
    ]);
    const older = closedRequest({
      id: "req-old",
      turnId: "agt-turn-old",
      version: 1,
      createdAtEpochMs: 10,
    });

    const next = mergeAgentThreadRequests(state, message([older]));

    expect(ids(next)).toEqual(["agt-turn-old/req-old", "agt-turn-new/req-new"]);
  });

  it("admits a never-seen pending record with a low version while other keys are fenced", () => {
    const state = deliver(null, overCap);
    const unseen = request({
      id: "req-unseen",
      turnId: "agt-turn-old",
      version: 1,
      createdAtEpochMs: 10,
    });

    const next = mergeAgentThreadRequests(state, message([unseen]));

    expect(pendingAgentRuntimeRequests(next)).toEqual([unseen]);
    expect(next.retention.fences.map((fence) => fence.id)).toEqual(["closed-0000", "closed-0001"]);
  });

  it("clears the fences on reset and on an epoch change", () => {
    const state = deliver(null, overCap);

    const reset = mergeAgentThreadRequests(state, message([stalePending], { reset: true }));
    const restarted = mergeAgentThreadRequests(
      state,
      message([stalePending], { epoch: "boot-0002" }),
    );

    expect(reset.requests).toEqual([stalePending]);
    expect(reset.retention).toEqual(NO_RETENTION);
    expect(restarted.requests).toEqual([stalePending]);
    expect(restarted.retention).toEqual(NO_RETENTION);
  });

  describe("beyond the fence cap", () => {
    const forgotten = 2;
    const total = MAX_AGENT_THREAD_REQUESTS_RETAINED + MAX_AGENT_THREAD_REQUEST_FENCES + forgotten;
    const horizon = SERIES_EPOCH_MS + forgotten - 1;
    const full = deliver(null, series(total, closedRequest, "closed", 0));
    const unknown = (overrides: WireValue): WireValue => ({
      id: "req-unknown",
      turnId: "agt-turn-cap",
      order: total,
      version: 1,
      ...overrides,
    });

    it("forgets the fences of the oldest records and remembers how far", () => {
      expect(full.requests).toHaveLength(MAX_AGENT_THREAD_REQUESTS_RETAINED);
      expect(full.truncated).toBe(true);
      expect(full.retention.fences).toHaveLength(MAX_AGENT_THREAD_REQUEST_FENCES);
      expect(full.retention.fences[0]?.id).toBe("closed-0002");
      expect(full.retention.forgottenThroughEpochMs).toBe(horizon);
      expect(mergeAgentThreadRequests(full, message([]))).toBe(full);
    });

    it("still rejects stale versions of keys whose fence is kept", () => {
      const stale = request({
        id: "closed-0002",
        turnId: "agt-turn-cap",
        order: 2,
        version: 1,
        createdAtEpochMs: SERIES_EPOCH_MS + 2,
      });

      expect(mergeAgentThreadRequests(full, message([stale]))).toBe(full);
    });

    it("rejects open records that cannot be proven newer than a forgotten fence", () => {
      const revived = request({
        id: "closed-0000",
        turnId: "agt-turn-cap",
        order: 0,
        version: 1,
        createdAtEpochMs: SERIES_EPOCH_MS,
      });
      const atHorizon = request(unknown({ createdAtEpochMs: horizon }));
      const submitting = parseAgentRuntimeRequest({
        ...validValue(VALID_REQUESTS, "submittingApprovalWithoutResolution"),
        ...unknown({ createdAtEpochMs: horizon }),
      });

      expect(mergeAgentThreadRequests(full, message([revived]))).toBe(full);
      expect(mergeAgentThreadRequests(full, message([atHorizon]))).toBe(full);
      expect(mergeAgentThreadRequests(full, message([submitting]))).toBe(full);
    });

    it("admits a pending record of an older turn from a pull but not from a push", () => {
      const older = request({
        id: "req-older",
        turnId: "agt-turn-older",
        order: 0,
        version: 1,
        createdAtEpochMs: 10,
      });

      const pushed = mergeAgentThreadRequests(full, message([older]));
      const next = mergeAgentThreadRequests(full, pulled([older]));

      expect(pushed).toBe(full);
      expect(next.requests[0]).toBe(older);
      expect(pendingAgentRuntimeRequests(next)).toEqual([older]);
      expect(next.requests).toHaveLength(MAX_AGENT_THREAD_REQUESTS_RETAINED);
      expect(mergeAgentThreadRequests(next, pulled([older]))).toBe(next);
      expect(mergeAgentThreadRequests(next, message([older]))).toBe(next);
      expect(mergeAgentThreadRequests(next, pulled([]))).toBe(next);
    });

    it("admits a submitting record at the forgotten range from a pull", () => {
      const submitting = parseAgentRuntimeRequest({
        ...validValue(VALID_REQUESTS, "submittingApprovalWithoutResolution"),
        ...unknown({ createdAtEpochMs: horizon }),
      });

      const next = mergeAgentThreadRequests(full, pulled([submitting]));

      expect(next.requests[next.requests.length - 1]).toBe(submitting);
    });

    it("keeps the fences and the forgotten range after a pull", () => {
      const older = request({
        id: "req-older",
        turnId: "agt-turn-older",
        order: 0,
        version: 1,
        createdAtEpochMs: 10,
      });
      const another = request({
        id: "req-another",
        turnId: "agt-turn-older",
        order: 1,
        version: 1,
        createdAtEpochMs: 11,
      });
      const staleFenced = request({
        id: "closed-0003",
        turnId: "agt-turn-cap",
        order: 3,
        version: 1,
        createdAtEpochMs: SERIES_EPOCH_MS + 3,
      });

      const next = mergeAgentThreadRequests(full, pulled([older]));

      expect(next.retention.fences).toHaveLength(MAX_AGENT_THREAD_REQUEST_FENCES);
      expect(next.retention.forgottenThroughEpochMs).toBe(horizon + 1);
      expect(mergeAgentThreadRequests(next, message([another]))).toBe(next);
      expect(mergeAgentThreadRequests(next, pulled([staleFenced]))).toBe(next);
      expect(mergeAgentThreadRequests(next, message([staleFenced]))).toBe(next);
    });

    it("rejects a stale pull record of a key whose fence is kept", () => {
      const stale = request({
        id: "closed-0002",
        turnId: "agt-turn-cap",
        order: 2,
        version: 1,
        createdAtEpochMs: SERIES_EPOCH_MS + 2,
      });
      const equal = closedRequest({
        id: "closed-0002",
        turnId: "agt-turn-cap",
        order: 2,
        createdAtEpochMs: SERIES_EPOCH_MS + 2,
      });

      expect(mergeAgentThreadRequests(full, pulled([stale]))).toBe(full);
      expect(mergeAgentThreadRequests(full, pulled([equal]))).toBe(full);
    });

    it("admits open records created after the forgotten fences", () => {
      const fresh = request(unknown({ createdAtEpochMs: horizon + 1 }));

      const next = mergeAgentThreadRequests(full, message([fresh]));

      expect(pendingAgentRuntimeRequests(next)).toEqual([fresh]);
      expect(next.truncated).toBe(true);
      expect(next.retention.fences).toHaveLength(MAX_AGENT_THREAD_REQUEST_FENCES);
      expect(next.retention.forgottenThroughEpochMs).toBe(horizon + 1);
    });

    it("admits closed records of unknown keys at any age", () => {
      const closed = closedRequest(unknown({ createdAtEpochMs: horizon }));

      const next = mergeAgentThreadRequests(full, message([closed]));

      expect(next.requests[next.requests.length - 1]).toBe(closed);
      expect(pendingAgentRuntimeRequests(next)).toEqual([]);
    });

    it("keeps the state identical when an old closed record cannot be kept or fenced", () => {
      const ancient = closedRequest({
        id: "req-ancient",
        turnId: "agt-turn-cap",
        order: 0,
        createdAtEpochMs: SERIES_EPOCH_MS,
      });

      expect(mergeAgentThreadRequests(full, message([ancient]))).toBe(full);
    });
  });
});

describe("pending agent runtime requests", () => {
  it("returns nothing without a state", () => {
    expect(pendingAgentRuntimeRequests(null)).toEqual([]);
  });

  it("returns only the live pending requests in state order", () => {
    const submitting = parseAgentRuntimeRequest({
      ...validValue(VALID_REQUESTS, "submittingQuestionWithAnswers"),
      turnId: "agt-turn-0001",
      order: 1,
    });
    const state = deliver(null, [
      request({ id: "req-second", order: 4 }),
      closedRequest({ id: "req-closed", turnId: "agt-turn-0001", order: 2 }),
      submitting,
      request({ id: "req-first", order: 0 }),
    ]);

    const pending = pendingAgentRuntimeRequests(state);
    const capabilities: readonly "live"[] = pending.map(
      (candidate) => candidate.responseCapability.kind,
    );

    expect(pending.map((candidate) => candidate.id)).toEqual(["req-first", "req-second"]);
    expect(capabilities).toEqual(["live", "live"]);
  });
});

describe("agent runtime request transitions", () => {
  it("matches the shared transition table for every pair of statuses", () => {
    const table: Readonly<Record<string, readonly string[]>> = wire.transitions;

    for (const from of AGENT_RUNTIME_REQUEST_STATUSES) {
      for (const to of AGENT_RUNTIME_REQUEST_STATUSES) {
        expect(isAgentRuntimeRequestTransitionAllowed(from, to), `${from} -> ${to}`).toBe(
          (table[from] ?? []).includes(to),
        );
      }
    }
  });

  it("allows exactly the documented transitions", () => {
    const allowed = AGENT_RUNTIME_REQUEST_STATUSES.flatMap((from) =>
      AGENT_RUNTIME_REQUEST_STATUSES.filter((to) =>
        isAgentRuntimeRequestTransitionAllowed(from, to),
      ).map((to) => `${from}->${to}`),
    );

    expect(allowed).toEqual([
      "pending->submitting",
      "pending->cancelled",
      "pending->expired",
      "pending->timedOut",
      "submitting->pending",
      "submitting->resolved",
      "submitting->expired",
    ]);
  });

  it("never leaves a terminal status and never stays in place", () => {
    for (const from of TERMINAL_STATUSES) {
      for (const to of AGENT_RUNTIME_REQUEST_STATUSES) {
        expect(isAgentRuntimeRequestTransitionAllowed(from, to), `${from} -> ${to}`).toBe(false);
      }
    }
    for (const status of AGENT_RUNTIME_REQUEST_STATUSES) {
      expect(isAgentRuntimeRequestTransitionAllowed(status, status)).toBe(false);
    }
  });
});
