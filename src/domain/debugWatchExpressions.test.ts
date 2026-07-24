import { describe, expect, it } from "vitest";
import { MAX_DEBUG_EVALUATION_EXPRESSION_BYTES } from "./debugEvaluationPolicy";
import {
  MAX_DEBUG_WATCH_EXPRESSIONS,
  createDebugWatchState,
  isDebugWatchDefinition,
  reduceDebugWatchState,
} from "./debugWatchExpressions";
import { fitsDebugWatchV1PayloadBudget } from "./debugWatchPayload";
import {
  deserializeDebugWatchDefinitions,
  serializeDebugWatchDefinitions,
} from "./debugWatchPersistence";

describe("debug watch expressions", () => {
  it("creates stable ids and monotonically revises only changed definitions", () => {
    const initial = createDebugWatchState();
    const added = reduceDebugWatchState(initial, { type: "add", expression: "count" });
    const second = reduceDebugWatchState(added, {
      type: "add",
      expression: "user.name",
      enabled: false,
    });
    expect(second.definitions).toEqual([
      { id: "watch-1", expression: "count", enabled: true, revision: 1 },
      { id: "watch-2", expression: "user.name", enabled: false, revision: 2 },
    ]);

    const toggled = reduceDebugWatchState(second, {
      type: "set-enabled",
      id: "watch-1",
      enabled: false,
    });
    expect(toggled.definitions[0]).toMatchObject({ id: "watch-1", enabled: false, revision: 3 });
    expect(toggled.definitions[1]).toBe(second.definitions[1]);
    expect(
      reduceDebugWatchState(toggled, {
        type: "set-enabled",
        id: "watch-1",
        enabled: false,
      }),
    ).toBe(toggled);
  });

  it("deduplicates exact expressions while preserving distinct spelling", () => {
    const first = reduceDebugWatchState(createDebugWatchState(), {
      type: "add",
      expression: "count",
    });
    expect(reduceDebugWatchState(first, { type: "add", expression: "count" })).toBe(first);
    const spaced = reduceDebugWatchState(first, { type: "add", expression: " count " });
    expect(spaced.definitions).toHaveLength(2);
    expect(
      reduceDebugWatchState(spaced, {
        type: "update",
        id: "watch-2",
        expression: "count",
      }),
    ).toBe(spaced);
  });

  it("enforces count and Unicode byte caps", () => {
    let state = createDebugWatchState();
    for (let index = 0; index < MAX_DEBUG_WATCH_EXPRESSIONS + 1; index += 1) {
      state = reduceDebugWatchState(state, { type: "add", expression: `value${index}` });
    }
    expect(state.definitions).toHaveLength(MAX_DEBUG_WATCH_EXPRESSIONS);
    expect(reduceDebugWatchState(state, { type: "add", expression: "overflow" })).toBe(state);

    const unicode = "ž".repeat(MAX_DEBUG_EVALUATION_EXPRESSION_BYTES / 2);
    const exact = reduceDebugWatchState(createDebugWatchState(), {
      type: "add",
      expression: unicode,
    });
    expect(exact.definitions).toHaveLength(1);
    expect(
      reduceDebugWatchState(exact, {
        type: "update",
        id: "watch-1",
        expression: `${unicode}ž`,
      }),
    ).toBe(exact);

    let totalBounded = createDebugWatchState();
    for (let index = 0; index < 17; index += 1) {
      totalBounded = reduceDebugWatchState(totalBounded, {
        type: "add",
        expression: `${index}:${"x".repeat(4_080)}`,
      });
    }
    expect(totalBounded.definitions).toHaveLength(15);
  });

  it("budgets the exact escaped V1 payload including metadata for 100 ids", () => {
    let state = createDebugWatchState();
    for (let index = 0; index < MAX_DEBUG_WATCH_EXPRESSIONS; index += 1) {
      state = reduceDebugWatchState(state, {
        type: "add",
        expression: `${index}:${'\\\\"'.repeat(98)}`,
        enabled: index % 2 === 0,
      });
    }

    expect(state.definitions).toHaveLength(100);
    expect(fitsDebugWatchV1PayloadBudget(state.definitions)).toBe(true);
    const rejected = reduceDebugWatchState(state, {
      type: "update",
      id: "watch-100",
      expression: `99:${'\\\\"'.repeat(120)}`,
    });
    expect(rejected).toBe(state);
  });

  it("removes definitions without reusing ids and validates exact definition objects", () => {
    let state = reduceDebugWatchState(createDebugWatchState(), { type: "add", expression: "a" });
    state = reduceDebugWatchState(state, { type: "remove", id: "watch-1" });
    state = reduceDebugWatchState(state, { type: "add", expression: "b" });
    expect(state.definitions[0]?.id).toBe("watch-2");
    expect(isDebugWatchDefinition(state.definitions[0])).toBe(true);
    expect(isDebugWatchDefinition({ ...state.definitions[0], extra: true })).toBe(false);
    expect(isDebugWatchDefinition({ ...state.definitions[0], revision: -1 })).toBe(false);
  });

  it("sanitizes replacement definitions by identity, expression and bounds", () => {
    const state = createDebugWatchState([
      { id: "watch-8", expression: "a", enabled: true, revision: 8 },
      { id: "watch-8", expression: "b", enabled: true, revision: 9 },
      { id: "watch-9", expression: "a", enabled: false, revision: 9 },
      { id: "watch-10", expression: "c", enabled: false, revision: 10 },
    ]);
    expect(state.definitions.map(({ id }) => id)).toEqual(["watch-8", "watch-10"]);
    expect(state.revision).toBe(10);
  });

  it("fails closed before revision or next-id safe-integer overflow", () => {
    const maximumRevision = createDebugWatchState([
      {
        id: "watch-1",
        expression: "count",
        enabled: true,
        revision: Number.MAX_SAFE_INTEGER,
      },
    ]);
    const serialized = serializeDebugWatchDefinitions(maximumRevision.definitions);
    expect(serialized).not.toBeNull();
    expect(deserializeDebugWatchDefinitions(serialized!)).toEqual(maximumRevision.definitions);

    for (const action of [
      { type: "add", expression: "next" },
      { type: "update", id: "watch-1", expression: "count + 1" },
      { type: "set-enabled", id: "watch-1", enabled: false },
      { type: "remove", id: "watch-1" },
      { type: "clear" },
    ] as const) {
      expect(reduceDebugWatchState(maximumRevision, action)).toBe(maximumRevision);
    }

    const maximumNextId = {
      definitions: [],
      nextId: Number.MAX_SAFE_INTEGER,
      revision: 0,
    };
    expect(reduceDebugWatchState(maximumNextId, { type: "add", expression: "count" })).toBe(
      maximumNextId,
    );
    expect(
      reduceDebugWatchState(
        { ...maximumNextId, nextId: Number.MAX_SAFE_INTEGER + 1 },
        { type: "add", expression: "count" },
      ).definitions,
    ).toEqual([]);
  });
});
