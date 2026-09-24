import { describe, expect, it } from "vitest";
import { withBoundedEntry } from "./boundedKeyedMap";

describe("withBoundedEntry", () => {
  it("refreshes a key to the newest position and evicts the oldest beyond the limit", () => {
    let map: ReadonlyMap<string, number> = new Map();
    map = withBoundedEntry(map, "a", 1, 2);
    map = withBoundedEntry(map, "b", 2, 2);
    map = withBoundedEntry(map, "a", 3, 2);
    map = withBoundedEntry(map, "c", 4, 2);

    expect([...map.entries()]).toEqual([
      ["a", 3],
      ["c", 4],
    ]);
  });

  it("removes a key for a null value without touching the original map", () => {
    const original = new Map([["a", 1]]);
    expect(withBoundedEntry(original, "a", null, 4).size).toBe(0);
    expect(original.get("a")).toBe(1);
  });
});
