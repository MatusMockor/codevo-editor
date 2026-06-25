import { describe, expect, it } from "vitest";
import { PhpTestGutterTargetsCache } from "./phpTestGutterTargetsCache";

const TEST_SOURCE = `<?php

class SampleTest extends TestCase
{
    public function testItWorks(): void
    {
    }
}
`;

const CHANGED_SOURCE = `<?php

class SampleTest extends TestCase
{
    public function testItWorks(): void
    {
    }

    public function testItAlsoWorks(): void
    {
    }
}
`;

describe("PhpTestGutterTargetsCache", () => {
  it("reuses the same targets for an unchanged path and content", () => {
    const cache = new PhpTestGutterTargetsCache();

    const first = cache.resolve("/workspace/SampleTest.php", TEST_SOURCE);
    const second = cache.resolve("/workspace/SampleTest.php", TEST_SOURCE);

    expect(second).toBe(first);
    expect(first.map((target) => target.filter)).toEqual([
      "SampleTest",
      "testItWorks",
    ]);
  });

  it("re-parses and replaces targets when the content changes", () => {
    const cache = new PhpTestGutterTargetsCache();

    const first = cache.resolve("/workspace/SampleTest.php", TEST_SOURCE);
    const reparsed = cache.resolve("/workspace/SampleTest.php", CHANGED_SOURCE);

    expect(reparsed).not.toBe(first);
    expect(reparsed.map((target) => target.filter)).toEqual([
      "SampleTest",
      "testItWorks",
      "testItAlsoWorks",
    ]);
  });

  it("keeps separate entries per path", () => {
    const cache = new PhpTestGutterTargetsCache();

    const a = cache.resolve("/workspace/ATest.php", TEST_SOURCE);
    const b = cache.resolve("/workspace/BTest.php", TEST_SOURCE);

    expect(b).not.toBe(a);
    expect(cache.resolve("/workspace/ATest.php", TEST_SOURCE)).toBe(a);
  });

  it("evicts the least recently used path beyond the capacity", () => {
    const cache = new PhpTestGutterTargetsCache(1);

    const first = cache.resolve("/workspace/ATest.php", TEST_SOURCE);
    cache.resolve("/workspace/BTest.php", TEST_SOURCE);
    const afterEviction = cache.resolve("/workspace/ATest.php", TEST_SOURCE);

    expect(afterEviction).not.toBe(first);
    expect(afterEviction).toEqual(first);
  });
});
