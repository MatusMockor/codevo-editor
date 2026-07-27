import { describe, expect, it } from "vitest";
import {
  buildDebugVariableRanges,
  debugIndexedRangeExtent,
  isDebugVariableCategorySummary,
} from "./debugVariableRanges";

describe("debug variable ranges", () => {
  it("keeps truncated indexed descriptors progressively addressable", () => {
    expect(
      debugIndexedRangeExtent([
        {
          start: 0,
          variables: Array.from({ length: 100 }),
          nextStart: 100,
          total: null,
          truncated: true,
        },
      ]),
    ).toBe(200);
    expect(
      debugIndexedRangeExtent([
        {
          start: 9_900,
          variables: Array.from({ length: 100 }),
          nextStart: null,
          total: null,
          truncated: true,
        },
      ]),
    ).toBe(10_000);
  });

  it("builds directly addressable 100-row windows through index 4999", () => {
    const ranges = buildDebugVariableRanges("indexed", {
      total: 5_000,
      retained: 5_000,
      truncated: false,
      limitReason: null,
    });

    expect(ranges).toHaveLength(50);
    expect(ranges[0]).toEqual({
      filter: "indexed",
      start: 0,
      count: 100,
      end: 99,
      label: "[0…99]",
    });
    expect(ranges[49]).toEqual({
      filter: "indexed",
      start: 4_900,
      count: 100,
      end: 4_999,
      label: "[4900…4999]",
    });
  });

  it("never advertises fake leaves beyond the retained cap", () => {
    const ranges = buildDebugVariableRanges("indexed", {
      total: 12_345,
      retained: 10_000,
      truncated: true,
      limitReason: "descriptors",
    });

    expect(ranges).toHaveLength(100);
    expect(ranges[ranges.length - 1]).toMatchObject({ start: 9_900, end: 9_999 });
  });

  it("uses an exact short final range", () => {
    const ranges = buildDebugVariableRanges("named", {
      total: 207,
      retained: 207,
      truncated: false,
      limitReason: null,
    });
    expect(ranges[ranges.length - 1]).toMatchObject({
      start: 200,
      count: 7,
      end: 206,
      label: "[200…206]",
    });
  });

  it("returns no ranges for an exact empty category", () => {
    expect(
      buildDebugVariableRanges("named", {
        total: 0,
        retained: 0,
        truncated: false,
        limitReason: null,
      }),
    ).toEqual([]);
  });

  it("rejects contradictory projection receipts", () => {
    expect(
      isDebugVariableCategorySummary({
        total: 5_000,
        retained: 4_000,
        truncated: false,
        limitReason: null,
      }),
    ).toBe(false);
    expect(
      isDebugVariableCategorySummary({
        total: 5_000,
        retained: 4_000,
        truncated: true,
        limitReason: null,
      }),
    ).toBe(false);
  });
});
