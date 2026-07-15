import { describe, expect, it } from "vitest";
import { phpObjectTypeCandidates } from "./phpObjectTypeCandidates";

describe("phpObjectTypeCandidates", () => {
  it.each([
    ["GeneratedActiveRow|null", ["GeneratedActiveRow"]],
    ["GeneratedActiveRow|false|null", ["GeneratedActiveRow"]],
    [
      " null | App\\Database\\GeneratedActiveRow | false ",
      ["App\\Database\\GeneratedActiveRow"],
    ],
    ["?App\\Models\\Post", ["App\\Models\\Post"]],
  ])("selects object types from %s", (typeName, expected) => {
    expect(phpObjectTypeCandidates(typeName)).toEqual(expected);
  });

  it("ignores scalar, sentinel, and PHPDoc collection types", () => {
    expect(
      phpObjectTypeCandidates(
        "null|false|true|int|string|array|list|iterable|object|mixed",
      ),
    ).toEqual([]);
  });

  it("keeps multiple object candidates visible to callers", () => {
    expect(phpObjectTypeCandidates("App\\Models\\Post|App\\Models\\Video|null"))
      .toEqual(["App\\Models\\Post", "App\\Models\\Video"]);
  });

  it("deduplicates equivalent object candidates", () => {
    expect(
      phpObjectTypeCandidates("App\\Models\\Post|\\app\\models\\post|null"),
    ).toEqual(["App\\Models\\Post"]);
  });

  it.each([
    "Collection<Post>|Fallback|null",
    "array{post: Post}|Fallback|null",
    "callable(Post|Video): Result|Fallback|null",
    "callable(): (Post|Video)|Fallback|null",
  ])(
    "abstains when %s contains an unsupported object-bearing member",
    (typeName) => {
      expect(phpObjectTypeCandidates(typeName)).toEqual([]);
    },
  );

  it.each([
    null,
    "",
    "Foo&Bar",
    "(Foo&Bar)|Baz",
    "Collection<Post>",
    "array{post: Post}",
    "Collection<Post|Video",
    "callable(Post|Video",
  ])("rejects unsupported type syntax in %s", (typeName) => {
    expect(phpObjectTypeCandidates(typeName)).toEqual([]);
  });
});
