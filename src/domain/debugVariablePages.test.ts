import { describe, expect, it } from "vitest";
import {
  MAX_DEBUG_VARIABLE_CACHE_BYTES,
  MAX_DEBUG_VARIABLE_CACHE_REFERENCES,
  MAX_DEBUG_VARIABLE_CACHE_VARIABLES,
  MAX_DEBUG_VARIABLE_CONCURRENT_REQUESTS,
  MAX_DEBUG_VARIABLE_EXPANSION_DEPTH,
  MAX_DEBUG_VARIABLE_PAGE_SIZE,
  createDebugVariablePagesState,
  debugInspectionOwnersEqual,
  isDebugInspectionOwner,
  reduceDebugVariablePages,
  selectDebugVariableExpansion,
  type DebugInspectionOwner,
  type DebugVariablePagesState,
} from "./debugVariablePages";

const owner: DebugInspectionOwner = {
  rootKey: "/workspace",
  sessionId: 7,
  pauseGeneration: 2,
  frameId: 11,
};

const variable = (name: string, variablesReference = 0, value = name, evaluateName?: string) => ({
  name,
  value,
  type: "string",
  ...(evaluateName === undefined ? {} : { evaluateName }),
  variablesReference,
});

function request(
  state: DebugVariablePagesState,
  variablesReference: number,
  start: number,
  requestId = `request-${variablesReference}-${start}`,
) {
  return reduceDebugVariablePages(state, {
    type: "request",
    owner,
    variablesReference,
    start,
    requestId,
  });
}

function resolve(
  state: DebugVariablePagesState,
  variablesReference: number,
  start: number,
  variables: ReturnType<typeof variable>[],
  nextStart: number | null,
  requestId = `request-${variablesReference}-${start}`,
) {
  return reduceDebugVariablePages(state, {
    type: "resolve",
    owner,
    variablesReference,
    start,
    requestId,
    result: { variablesReference, start, variables, nextStart },
  });
}

describe("debugVariablePages", () => {
  it("validates and compares the exact root/session/pause/frame owner", () => {
    expect(isDebugInspectionOwner(owner)).toBe(true);
    expect(isDebugInspectionOwner({ ...owner, extra: true })).toBe(false);
    expect(isDebugInspectionOwner({ ...owner, sessionId: 0 })).toBe(false);
    expect(isDebugInspectionOwner({ ...owner, pauseGeneration: 0 })).toBe(false);
    expect(debugInspectionOwnersEqual(owner, { ...owner })).toBe(true);
    expect(debugInspectionOwnersEqual(owner, { ...owner, pauseGeneration: 3 })).toBe(false);
  });

  it("owns one exact pause and clears all pages on any owner change", () => {
    let state = request(createDebugVariablePagesState(owner), 20, 0);
    state = resolve(state, 20, 0, [variable("a")], null);
    for (const changed of [
      { ...owner, rootKey: "/other" },
      { ...owner, sessionId: 8 },
      { ...owner, pauseGeneration: 3 },
      { ...owner, frameId: 12 },
    ]) {
      const next = reduceDebugVariablePages(state, { type: "own", owner: changed });
      expect(next.references).toEqual({});
      expect(next.owner).toEqual(changed);
    }
  });

  it("deduplicates requests and accepts only exact request and owner replies", () => {
    const initial = createDebugVariablePagesState(owner);
    const pending = request(initial, 20, 0, "one");
    expect(request(pending, 20, 0, "two")).toBe(pending);
    expect(
      reduceDebugVariablePages(pending, {
        type: "resolve",
        owner,
        variablesReference: 20,
        start: 0,
        requestId: "wrong",
        result: { variablesReference: 20, start: 0, variables: [], nextStart: null },
      }),
    ).toBe(pending);
    expect(
      reduceDebugVariablePages(pending, {
        type: "resolve",
        owner: { ...owner, frameId: 12 },
        variablesReference: 20,
        start: 0,
        requestId: "one",
        result: { variablesReference: 20, start: 0, variables: [], nextStart: null },
      }),
    ).toBe(pending);
  });

  it("requires ordered cursor pages and rejects overlap or non-progressive results", () => {
    let state = request(createDebugVariablePagesState(owner), 20, 0);
    state = resolve(state, 20, 0, [variable("a"), variable("b")], 2);
    expect(request(state, 20, 1)).toBe(state);
    state = request(state, 20, 2);
    const malformed = reduceDebugVariablePages(state, {
      type: "resolve",
      owner,
      variablesReference: 20,
      start: 2,
      requestId: "request-20-2",
      result: { variablesReference: 20, start: 2, variables: [variable("c")], nextStart: 2 },
    });
    expect(malformed).toBe(state);
    state = resolve(state, 20, 2, [variable("c")], null);
    expect(selectDebugVariableExpansion(state, owner, 20)).toMatchObject({
      kind: "ready",
      variables: [variable("a"), variable("b"), variable("c")],
      nextStart: null,
    });
  });

  it("rejects malformed, oversized, extra-key and mismatched page results", () => {
    const pending = request(createDebugVariablePagesState(owner), 20, 0, "page");
    const malformed: unknown[] = [
      null,
      { variablesReference: 20, start: 0, variables: [], nextStart: null, extra: true },
      { variablesReference: 21, start: 0, variables: [], nextStart: null },
      {
        variablesReference: 20,
        start: 0,
        variables: Array.from({ length: MAX_DEBUG_VARIABLE_PAGE_SIZE + 1 }, (_, index) =>
          variable(`${index}`),
        ),
        nextStart: null,
      },
      {
        variablesReference: 20,
        start: 0,
        variables: [{ ...variable("a"), extra: true }],
        nextStart: null,
      },
      {
        variablesReference: 20,
        start: 0,
        variables: [variable("a", 0, "x".repeat(64 * 1_024 + 1))],
        nextStart: null,
      },
      {
        variablesReference: 20,
        start: 0,
        variables: [variable("a", 0, "a", "")],
        nextStart: null,
      },
      {
        variablesReference: 20,
        start: 0,
        variables: [variable("a", 0, "a", "   ")],
        nextStart: null,
      },
      {
        variablesReference: 20,
        start: 0,
        variables: [variable("a", 0, "a", "bad\rpath")],
        nextStart: null,
      },
      {
        variablesReference: 20,
        start: 0,
        variables: [variable("a", 0, "a", "x".repeat(4 * 1_024 + 1))],
        nextStart: null,
      },
    ];
    for (const result of malformed) {
      const next = reduceDebugVariablePages(pending, {
        type: "resolve",
        owner,
        variablesReference: 20,
        start: 0,
        requestId: "page",
        result,
      });
      expect(next).toBe(pending);
    }
  });

  it("immutably preserves evaluate names and charges their UTF-8 bytes to the cache", () => {
    const source = variable("user", 9, "User", 'root["user"]');
    let state = request(createDebugVariablePagesState(owner), 20, 0, "evaluate-name");
    state = resolve(state, 20, 0, [source], null, "evaluate-name");

    const expansion = selectDebugVariableExpansion(state, owner, 20);
    expect(expansion).toMatchObject({ kind: "ready", variables: [source] });
    expect(state.totalBytes).toBe(
      new TextEncoder().encode(source.name + source.value + source.type + source.evaluateName)
        .byteLength,
    );
    expect(state.references[20]?.pages[0]?.variables[0]).toStrictEqual(source);
    expect(source).toStrictEqual({
      name: "user",
      value: "User",
      type: "string",
      evaluateName: 'root["user"]',
      variablesReference: 9,
    });
  });

  it("accepts an exact 4 KiB evaluate name and enforces the aggregate cache budget", () => {
    const exact = "x".repeat(4 * 1_024);
    let accepted = request(createDebugVariablePagesState(owner), 20, 0, "exact");
    accepted = resolve(accepted, 20, 0, [variable("a", 0, "a", exact)], null, "exact");
    expect(accepted.references[20]?.pages[0]?.variables[0]?.evaluateName).toBe(exact);

    let capped = request(createDebugVariablePagesState(owner), 21, 0, "capped");
    capped = { ...capped, totalBytes: MAX_DEBUG_VARIABLE_CACHE_BYTES - exact.length };
    capped = resolve(capped, 21, 0, [variable("a", 0, "a", exact)], null, "capped");
    expect(capped.references[21]?.limit).toBe("bytes");
    expect(capped.references[21]?.pages).toEqual({});
  });

  it("preserves an exact bounded multiline property expression and rejects lone CR", () => {
    const evaluateName = "(\n  root\n).nested.b";
    let state = request(createDebugVariablePagesState(owner), 20, 0, "multiline");
    state = resolve(state, 20, 0, [variable("b", 0, "1", evaluateName)], null, "multiline");
    expect(state.references[20]?.pages[0]?.variables[0]?.evaluateName).toBe(evaluateName);

    let invalid = request(createDebugVariablePagesState(owner), 21, 0, "invalid");
    invalid = resolve(invalid, 21, 0, [variable("b", 0, "1", "root\r.b")], null, "invalid");
    expect(invalid.references[21]?.pages).toEqual({});
  });

  it("accepts exactly 100 variables and exposes the next load-more cursor", () => {
    let state = request(createDebugVariablePagesState(owner), 20, 0, "full-page");
    const variables = Array.from({ length: MAX_DEBUG_VARIABLE_PAGE_SIZE }, (_, index) =>
      variable(`value-${index}`),
    );
    state = resolve(state, 20, 0, variables, MAX_DEBUG_VARIABLE_PAGE_SIZE, "full-page");
    expect(selectDebugVariableExpansion(state, owner, 20)).toMatchObject({
      kind: "ready",
      variables,
      nextStart: MAX_DEBUG_VARIABLE_PAGE_SIZE,
    });
  });

  it("rejects, retries and cancels only the exact page request", () => {
    let state = request(createDebugVariablePagesState(owner), 20, 0, "page");
    state = reduceDebugVariablePages(state, {
      type: "reject",
      owner,
      variablesReference: 20,
      start: 0,
      requestId: "page",
      message: "adapter failed",
    });
    expect(selectDebugVariableExpansion(state, owner, 20)).toMatchObject({
      kind: "error",
      message: "adapter failed",
    });
    state = request(state, 20, 0, "retry");
    expect(selectDebugVariableExpansion(state, owner, 20).kind).toBe("loading");
    const staleCancel = reduceDebugVariablePages(state, {
      type: "cancel",
      owner,
      variablesReference: 20,
      start: 0,
      requestId: "page",
    });
    expect(staleCancel).toBe(state);
    state = reduceDebugVariablePages(state, {
      type: "cancel",
      owner,
      variablesReference: 20,
      start: 0,
      requestId: "retry",
    });
    expect(selectDebugVariableExpansion(state, owner, 20)).toEqual({ kind: "idle", nextStart: 0 });
  });

  it("always releases an exact failed request with a bounded retry message", () => {
    for (const message of ["", "x".repeat(4 * 1_024 + 1)]) {
      let state = request(createDebugVariablePagesState(owner), 20, 0, "page");
      state = reduceDebugVariablePages(state, {
        type: "reject",
        owner,
        variablesReference: 20,
        start: 0,
        requestId: "page",
        message,
      });
      const expansion = selectDebugVariableExpansion(state, owner, 20);
      expect(expansion.kind).toBe("error");
      if (expansion.kind === "error") {
        expect(expansion.message.length).toBeGreaterThan(0);
        expect(new TextEncoder().encode(expansion.message).byteLength).toBeLessThanOrEqual(
          4 * 1_024,
        );
      }
      expect(state.pendingCount).toBe(0);
      expect(request(state, 20, 0, "retry").pendingCount).toBe(1);
    }
  });

  it("reports leaf, stale, circular and depth limit selector states", () => {
    const state = createDebugVariablePagesState(owner);
    expect(selectDebugVariableExpansion(state, owner, 0)).toEqual({ kind: "leaf" });
    expect(selectDebugVariableExpansion(state, { ...owner, frameId: 12 }, 20)).toEqual({
      kind: "stale",
    });
    expect(selectDebugVariableExpansion(state, owner, 20, [10, 20])).toEqual({ kind: "circular" });
    expect(
      selectDebugVariableExpansion(state, owner, 20, [], MAX_DEBUG_VARIABLE_EXPANSION_DEPTH),
    ).toEqual({ kind: "limit", reason: "depth" });
  });

  it("enforces the 16-request concurrency cap without eviction", () => {
    let state = createDebugVariablePagesState(owner);
    for (let index = 1; index <= MAX_DEBUG_VARIABLE_CONCURRENT_REQUESTS; index += 1) {
      state = request(state, index, 0);
    }
    const capped = request(state, 100, 0);
    expect(capped).toBe(state);
    expect(selectDebugVariableExpansion(state, owner, 100)).toEqual({
      kind: "limit",
      reason: "concurrency",
    });
    expect(state.pendingCount).toBe(MAX_DEBUG_VARIABLE_CONCURRENT_REQUESTS);
  });

  it("enforces reference, variable and byte caps with explicit states and no eviction", () => {
    const references = Object.fromEntries(
      Array.from({ length: MAX_DEBUG_VARIABLE_CACHE_REFERENCES }, (_, index) => [
        index + 1,
        {
          pages: {},
          pending: {},
          errors: {},
          limit: null,
        },
      ]),
    );
    const referenceCapped: DebugVariablePagesState = {
      ...createDebugVariablePagesState(owner),
      references,
    };
    expect(selectDebugVariableExpansion(referenceCapped, owner, 2_000)).toEqual({
      kind: "limit",
      reason: "references",
    });

    const byteCapped: DebugVariablePagesState = {
      ...createDebugVariablePagesState(owner),
      totalBytes: MAX_DEBUG_VARIABLE_CACHE_BYTES,
    };
    expect(selectDebugVariableExpansion(byteCapped, owner, 20)).toEqual({
      kind: "limit",
      reason: "bytes",
    });

    const variableCapped: DebugVariablePagesState = {
      ...createDebugVariablePagesState(owner),
      totalVariables: MAX_DEBUG_VARIABLE_CACHE_VARIABLES,
    };
    expect(selectDebugVariableExpansion(variableCapped, owner, 20)).toEqual({
      kind: "limit",
      reason: "variables",
    });

    let state = request(createDebugVariablePagesState(owner), 20, 0, "large");
    state = {
      ...state,
      totalBytes: MAX_DEBUG_VARIABLE_CACHE_BYTES - 1,
    };
    const limited = resolve(state, 20, 0, [variable("a")], null, "large");
    expect(limited.references[20]?.limit).toBe("bytes");
    expect(limited.references[20]?.pages).toEqual({});
    expect(limited.totalBytes).toBe(MAX_DEBUG_VARIABLE_CACHE_BYTES - 1);
  });

  it("clears only for the exact owner", () => {
    const state = request(createDebugVariablePagesState(owner), 20, 0);
    expect(
      reduceDebugVariablePages(state, { type: "clear", owner: { ...owner, sessionId: 8 } }),
    ).toBe(state);
    expect(reduceDebugVariablePages(state, { type: "clear", owner })).toEqual(
      createDebugVariablePagesState(owner),
    );
  });
});
