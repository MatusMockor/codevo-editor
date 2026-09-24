import { describe, expect, it } from "vitest";
import {
  wireAbsolutePath,
  wireBoolean,
  wireCount,
  wireEnum,
  wireExactRecord,
  wireNullableString,
  wireObjectId,
  wireRelativePath,
  wireString,
  wireStringArray,
} from "./wireValue";

describe("wire values", () => {
  it("accepts exact records and rejects unknown or missing keys", () => {
    expect(wireExactRecord({ a: 1 }, ["a"], "value")).toEqual({ a: 1 });
    expect(() => wireExactRecord({ a: 1, b: 2 }, ["a"], "value")).toThrow("Invalid value");
    expect(() => wireExactRecord({}, ["a"], "value")).toThrow("Invalid value");
    expect(() => wireExactRecord([], ["a"], "value")).toThrow("Invalid value");
  });

  it("bounds strings by UTF-8 bytes and rejects non-strings", () => {
    expect(wireString("é", "s", 2)).toBe("é");
    expect(() => wireString("é", "s", 1)).toThrow("Invalid s");
    expect(() => wireString(1, "s", 10)).toThrow("Invalid s");
    expect(wireNullableString(null, "s", 1)).toBeNull();
  });

  it("bounds counts and arrays", () => {
    expect(wireCount(3, "n", 3)).toBe(3);
    expect(() => wireCount(-1, "n", 3)).toThrow();
    expect(() => wireCount(1.5, "n", 3)).toThrow();
    expect(wireStringArray(["a"], "list", 1, 10)).toEqual(["a"]);
    expect(() => wireStringArray(["a", "b"], "list", 1, 10)).toThrow();
    expect(wireBoolean(false, "flag")).toBe(false);
  });

  it("accepts only closed enums, object ids and safe paths", () => {
    expect(wireEnum("a", "kind", ["a", "b"] as const)).toBe("a");
    expect(() => wireEnum("c", "kind", ["a", "b"] as const)).toThrow();
    expect(wireObjectId("a".repeat(40), "sha")).toBe("a".repeat(40));
    expect(() => wireObjectId("HEAD", "sha")).toThrow();
    expect(wireAbsolutePath("/repo", "root")).toBe("/repo");
    expect(() => wireAbsolutePath("repo", "root")).toThrow();
    expect(wireRelativePath("src/a.ts", "path")).toBe("src/a.ts");
    for (const bad of ["", "/abs", "../x", "a//b", "a/./b", "a\u0001b"]) {
      expect(() => wireRelativePath(bad, "path"), bad).toThrow();
    }
  });
});
