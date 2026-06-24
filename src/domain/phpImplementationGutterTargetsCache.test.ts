import { describe, expect, it } from "vitest";
import { PhpImplementationGutterTargetsCache } from "./phpImplementationGutterTargetsCache";

const INTERFACE_SOURCE = `<?php

interface SearchRepository
{
    public function search(): void;
}
`;

const CHANGED_SOURCE = `<?php

interface SearchRepository
{
    public function search(): void;

    public function findOne(): object;
}
`;

describe("PhpImplementationGutterTargetsCache", () => {
  it("reuses the same targets for an unchanged path and content", () => {
    const cache = new PhpImplementationGutterTargetsCache();

    const first = cache.resolve("/workspace/Repo.php", INTERFACE_SOURCE);
    const second = cache.resolve("/workspace/Repo.php", INTERFACE_SOURCE);

    expect(second).toBe(first);
    expect(first).toEqual([
      {
        methodName: "search",
        position: { column: 21, lineNumber: 5 },
      },
    ]);
  });

  it("re-parses and replaces targets when the content changes", () => {
    const cache = new PhpImplementationGutterTargetsCache();

    const first = cache.resolve("/workspace/Repo.php", INTERFACE_SOURCE);
    const reparsed = cache.resolve("/workspace/Repo.php", CHANGED_SOURCE);

    expect(reparsed).not.toBe(first);
    expect(reparsed.map((target) => target.methodName)).toEqual([
      "search",
      "findOne",
    ]);
  });

  it("keeps separate entries per path", () => {
    const cache = new PhpImplementationGutterTargetsCache();

    const repo = cache.resolve("/workspace/Repo.php", INTERFACE_SOURCE);
    const otherRepo = cache.resolve("/workspace/Other.php", INTERFACE_SOURCE);

    expect(otherRepo).not.toBe(repo);
    expect(cache.resolve("/workspace/Repo.php", INTERFACE_SOURCE)).toBe(repo);
  });

  it("re-parses after a path is invalidated", () => {
    const cache = new PhpImplementationGutterTargetsCache();

    const first = cache.resolve("/workspace/Repo.php", INTERFACE_SOURCE);
    cache.invalidate("/workspace/Repo.php");
    const afterInvalidate = cache.resolve(
      "/workspace/Repo.php",
      INTERFACE_SOURCE,
    );

    expect(afterInvalidate).not.toBe(first);
    expect(afterInvalidate).toEqual(first);
  });

  it("evicts the least recently used path beyond the capacity", () => {
    const cache = new PhpImplementationGutterTargetsCache(1);

    const first = cache.resolve("/workspace/Repo.php", INTERFACE_SOURCE);
    cache.resolve("/workspace/Other.php", INTERFACE_SOURCE);
    const afterEviction = cache.resolve(
      "/workspace/Repo.php",
      INTERFACE_SOURCE,
    );

    expect(afterEviction).not.toBe(first);
  });
});
