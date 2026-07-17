import { describe, expect, it } from "vitest";
import { JsTestGutterTargetsCache } from "./jsTestGutterTargetsCache";

const TEST_SOURCE = `describe("math", () => {
  it("adds", () => {});
});
`;

const CHANGED_SOURCE = `describe("math", () => {
  it("adds", () => {});
  it("subtracts", () => {});
});
`;

describe("JsTestGutterTargetsCache", () => {
  it("reuses the same targets for an unchanged path and content", () => {
    const cache = new JsTestGutterTargetsCache();

    const first = cache.resolve("/workspace/math.test.ts", TEST_SOURCE);
    const second = cache.resolve("/workspace/math.test.ts", TEST_SOURCE);

    expect(second).toBe(first);
    expect(first.map((target) => target.filter)).toEqual(["math", "adds"]);
  });

  it("re-parses and replaces targets when the content changes", () => {
    const cache = new JsTestGutterTargetsCache();

    const first = cache.resolve("/workspace/math.test.ts", TEST_SOURCE);
    const reparsed = cache.resolve("/workspace/math.test.ts", CHANGED_SOURCE);

    expect(reparsed).not.toBe(first);
    expect(reparsed.map((target) => target.filter)).toEqual([
      "math",
      "adds",
      "subtracts",
    ]);
  });

  it("keeps separate entries per path", () => {
    const cache = new JsTestGutterTargetsCache();

    const a = cache.resolve("/workspace/a.test.ts", TEST_SOURCE);
    const b = cache.resolve("/workspace/b.test.ts", TEST_SOURCE);

    expect(b).not.toBe(a);
    expect(cache.resolve("/workspace/a.test.ts", TEST_SOURCE)).toBe(a);
  });

  it("evicts the least recently used path beyond the capacity", () => {
    const cache = new JsTestGutterTargetsCache(1);

    const first = cache.resolve("/workspace/a.test.ts", TEST_SOURCE);
    cache.resolve("/workspace/b.test.ts", TEST_SOURCE);
    const afterEviction = cache.resolve("/workspace/a.test.ts", TEST_SOURCE);

    expect(afterEviction).not.toBe(first);
    expect(afterEviction).toEqual(first);
  });

  it("drops an invalidated path", () => {
    const cache = new JsTestGutterTargetsCache();

    const first = cache.resolve("/workspace/math.test.ts", TEST_SOURCE);
    cache.invalidate("/workspace/math.test.ts");
    const reparsed = cache.resolve("/workspace/math.test.ts", TEST_SOURCE);

    expect(reparsed).not.toBe(first);
    expect(reparsed).toEqual(first);
  });
});
