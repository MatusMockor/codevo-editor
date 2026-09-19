import { describe, expect, it } from "vitest";
import {
  agentTurnEventIndexFromKey,
  agentTurnHydrationScrollTop,
  agentTurnItemKey,
  normalizeAgentTurnEventOffset,
} from "./agentTurnItemKeys";

describe("agentTurnItemKey", () => {
  it("round-trips a positive, a zero and a negative key index", () => {
    for (const [index, offset, key] of [
      [0, 0, "e0"],
      [7, 0, "e7"],
      [0, -5, "e-5"],
      [5, -5, "e0"],
      [12, -5, "e7"],
      [3, -512, "e-509"],
    ] as const) {
      expect(agentTurnItemKey(index, offset)).toBe(key);
      expect(agentTurnEventIndexFromKey(key, offset)).toBe(index);
    }
  });

  it("keeps a never-hydrated turn on plain positional keys", () => {
    expect(agentTurnItemKey(4)).toBe("e4");
    expect(agentTurnEventIndexFromKey("e4")).toBe(4);
  });

  it("rejects a key that is not an agent turn event key", () => {
    for (const key of ["", "e", "x0", "e1.5", "e 1", "eNaN", "e--1", "e1e3", "x12"]) {
      expect(agentTurnEventIndexFromKey(key)).toBeNull();
    }
  });

  it("rejects a key that would resolve below the first retained event", () => {
    expect(agentTurnEventIndexFromKey("e-6", -5)).toBeNull();
    expect(agentTurnEventIndexFromKey("e-1")).toBeNull();
  });

  it("fails closed on an offset that is missing, positive or not a safe integer", () => {
    for (const offset of [undefined, 3, Number.NaN, Number.POSITIVE_INFINITY, -1.5, -(2 ** 60)]) {
      expect(normalizeAgentTurnEventOffset(offset)).toBe(0);
      expect(agentTurnItemKey(2, offset)).toBe("e2");
      expect(agentTurnEventIndexFromKey("e2", offset)).toBe(2);
    }
    expect(normalizeAgentTurnEventOffset(-4)).toBe(-4);
  });

  it("clamps an index that is not a usable array position", () => {
    for (const index of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(agentTurnItemKey(index, -2)).toBe("e-2");
    }
  });
});

describe("agentTurnHydrationScrollTop", () => {
  const ROWS_BEFORE = [
    { key: "e0", height: 300 },
    { key: "e1", height: 400 },
    { key: "e2", height: 500 },
  ] as const;
  const PREPENDED = [
    { key: "e-2", height: 700 },
    { key: "e-1", height: 500 },
  ] as const;
  const HEADER = 100;
  const CLIENT_HEIGHT = 600;

  function layout(rows: ReadonlyArray<{ readonly key: string; readonly height: number }>) {
    let top = HEADER;
    const tops = new Map<string, number>();
    for (const row of rows) {
      tops.set(row.key, top);
      top += row.height;
    }
    return { tops, scrollHeight: top };
  }

  it("keeps the anchored row at the same viewport offset when rows land above it", () => {
    const before = layout(ROWS_BEFORE);
    const after = layout([...PREPENDED, ...ROWS_BEFORE]);
    const scrollTop = before.tops.get("e2")! - 120;

    const anchored = agentTurnHydrationScrollTop({
      clientHeight: CLIENT_HEIGHT,
      insertionTops: [HEADER],
      previousScrollHeight: before.scrollHeight,
      scrollHeight: after.scrollHeight,
      scrollTop,
    });

    expect(anchored).not.toBeNull();
    expect(after.tops.get("e2")! - anchored!).toBe(before.tops.get("e2")! - scrollTop);
  });

  it("leaves the viewport alone when the insertion point is still visible", () => {
    const before = layout(ROWS_BEFORE);
    const after = layout([...PREPENDED, ...ROWS_BEFORE]);

    expect(
      agentTurnHydrationScrollTop({
        clientHeight: CLIENT_HEIGHT,
        insertionTops: [HEADER],
        previousScrollHeight: before.scrollHeight,
        scrollHeight: after.scrollHeight,
        scrollTop: 0,
      }),
    ).toBeNull();
  });

  it("only compensates when every insertion point sits above the viewport", () => {
    expect(
      agentTurnHydrationScrollTop({
        clientHeight: CLIENT_HEIGHT,
        insertionTops: [100, 900],
        previousScrollHeight: 2000,
        scrollHeight: 3000,
        scrollTop: 800,
      }),
    ).toBeNull();
  });

  it("refuses to move without growth, without an insertion point or on unusable numbers", () => {
    const base = {
      clientHeight: CLIENT_HEIGHT,
      insertionTops: [10],
      previousScrollHeight: 2000,
      scrollHeight: 3000,
      scrollTop: 800,
    };
    expect(agentTurnHydrationScrollTop({ ...base, insertionTops: [] })).toBeNull();
    expect(agentTurnHydrationScrollTop({ ...base, scrollHeight: 2000 })).toBeNull();
    expect(agentTurnHydrationScrollTop({ ...base, scrollHeight: 1000 })).toBeNull();
    expect(agentTurnHydrationScrollTop({ ...base, scrollTop: Number.NaN })).toBeNull();
    expect(agentTurnHydrationScrollTop({ ...base, previousScrollHeight: Number.NaN })).toBeNull();
    expect(agentTurnHydrationScrollTop({ ...base, clientHeight: Number.NaN })).toBeNull();
    expect(
      agentTurnHydrationScrollTop({ ...base, insertionTops: [Number.NEGATIVE_INFINITY] }),
    ).toBeNull();
  });

  it("never scrolls past the end of the grown transcript", () => {
    expect(
      agentTurnHydrationScrollTop({
        clientHeight: CLIENT_HEIGHT,
        insertionTops: [0],
        previousScrollHeight: 2000,
        scrollHeight: 2400,
        scrollTop: 1900,
      }),
    ).toBe(1800);
  });
});
