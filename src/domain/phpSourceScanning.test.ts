import { describe, expect, it } from "vitest";
import {
  editorPositionAtOffset,
  enclosingBracketStart,
  identifierAtOffset,
  isTopLevelBetween,
  isTopLevelWhitespaceBetween,
  matchingBracketOffset,
  offsetAtPosition,
  scanTopLevel,
  stringLiteralAtOffset,
  stringLiteralCompletionAtOffset,
  topLevelArgumentIndexAtOffset,
  topLevelCallArgumentIndexAt,
  topLevelCallArgumentNameAtOffset,
} from "./phpSourceScanning";

describe("offsetAtPosition", () => {
  it("maps a single-line position onto its offset", () => {
    expect(offsetAtPosition("hello", { column: 3, lineNumber: 1 })).toBe(2);
  });

  it("maps multiline positions across newlines", () => {
    expect(offsetAtPosition("ab\ncd\nef", { column: 2, lineNumber: 2 })).toBe(4);
    expect(offsetAtPosition("ab\ncd\nef", { column: 1, lineNumber: 3 })).toBe(6);
  });

  it("returns the source length for an empty source", () => {
    expect(offsetAtPosition("", { column: 1, lineNumber: 1 })).toBe(0);
  });

  it("clamps positions beyond the end to the source length", () => {
    expect(offsetAtPosition("ab", { column: 9, lineNumber: 4 })).toBe(2);
  });
});

describe("editorPositionAtOffset", () => {
  it("maps an offset on the first line", () => {
    expect(editorPositionAtOffset("hello", 2)).toEqual({
      column: 3,
      lineNumber: 1,
    });
  });

  it("maps offsets after newlines onto later lines", () => {
    expect(editorPositionAtOffset("ab\ncd\nef", 4)).toEqual({
      column: 2,
      lineNumber: 2,
    });
    expect(editorPositionAtOffset("ab\ncd\nef", 6)).toEqual({
      column: 1,
      lineNumber: 3,
    });
  });

  it("maps offset zero of an empty source to line one column one", () => {
    expect(editorPositionAtOffset("", 0)).toEqual({ column: 1, lineNumber: 1 });
  });

  it("round-trips with offsetAtPosition on multiline sources", () => {
    const source = "first\nsecond line\nthird";
    const offset = source.indexOf("line");

    expect(offsetAtPosition(source, editorPositionAtOffset(source, offset))).toBe(
      offset,
    );
  });
});

describe("identifierAtOffset", () => {
  it("finds the identifier spanning the offset", () => {
    expect(identifierAtOffset("$this->total()", 8)).toEqual({
      end: 12,
      name: "total",
      start: 7,
    });
  });

  it("includes both identifier boundaries", () => {
    expect(identifierAtOffset("foo", 0)?.name).toBe("foo");
    expect(identifierAtOffset("foo", 3)?.name).toBe("foo");
  });

  it("returns null for an empty source", () => {
    expect(identifierAtOffset("", 0)).toBeNull();
  });

  it("returns null when the offset touches no identifier", () => {
    expect(identifierAtOffset("a + b", 2)?.name).not.toBe("b");
    expect(identifierAtOffset("  ", 1)).toBeNull();
  });
});

describe("stringLiteralAtOffset", () => {
  it("returns the literal range around an inner offset", () => {
    expect(stringLiteralAtOffset("echo 'name';", 7)).toEqual({
      quoteEnd: 10,
      quoteStart: 5,
      value: "name",
    });
  });

  it("keeps escaped quotes inside the literal value", () => {
    expect(stringLiteralAtOffset("'ab\\'cd'", 5)).toEqual({
      quoteEnd: 7,
      quoteStart: 0,
      value: "ab\\'cd",
    });
  });

  it("returns null on the quotes themselves and outside literals", () => {
    expect(stringLiteralAtOffset("echo 'name';", 5)).toBeNull();
    expect(stringLiteralAtOffset("echo 'name';", 10)).toBeNull();
    expect(stringLiteralAtOffset("echo 'name';", 2)).toBeNull();
  });

  it("returns null for an empty source", () => {
    expect(stringLiteralAtOffset("", 0)).toBeNull();
  });
});

describe("stringLiteralCompletionAtOffset", () => {
  it("captures the prefix of a closed literal", () => {
    const source = "with('com')";

    expect(stringLiteralCompletionAtOffset(source, 9)).toEqual({
      prefix: "com",
      quoteEnd: 9,
      quoteStart: 5,
    });
  });

  it("captures the prefix of an unterminated literal", () => {
    const source = "with('com";

    expect(stringLiteralCompletionAtOffset(source, 9)).toEqual({
      prefix: "com",
      quoteEnd: 9,
      quoteStart: 5,
    });
  });

  it("skips escaped quotes while tracking the open literal", () => {
    const source = "with('a\\'b";

    expect(stringLiteralCompletionAtOffset(source, 10)).toEqual({
      prefix: "a\\'b",
      quoteEnd: 10,
      quoteStart: 5,
    });
  });

  it("returns null outside any literal", () => {
    expect(stringLiteralCompletionAtOffset("with()", 5)).toBeNull();
    expect(stringLiteralCompletionAtOffset("", 0)).toBeNull();
  });
});

describe("matchingBracketOffset", () => {
  it("matches nested brackets of the same kind", () => {
    expect(matchingBracketOffset("(a(b)c)", 0, "(", ")")).toBe(6);
    expect(matchingBracketOffset("(a(b)c)", 2, "(", ")")).toBe(4);
  });

  it("ignores brackets inside string literals", () => {
    expect(matchingBracketOffset("(')')", 0, "(", ")")).toBe(4);
  });

  it("returns null for unbalanced brackets", () => {
    expect(matchingBracketOffset("((a)", 0, "(", ")")).toBeNull();
    expect(matchingBracketOffset("", 0, "(", ")")).toBeNull();
  });
});

describe("topLevelArgumentIndexAtOffset", () => {
  it("counts only top-level commas before the target", () => {
    const source = "f(a, [b, c], d)";

    expect(topLevelArgumentIndexAtOffset(source, 1, source.indexOf("d"))).toBe(2);
    expect(topLevelArgumentIndexAtOffset(source, 1, source.indexOf("a"))).toBe(0);
  });

  it("ignores commas inside string literals", () => {
    const source = "f('a,b', c)";

    expect(topLevelArgumentIndexAtOffset(source, 1, source.indexOf("c"))).toBe(1);
  });
});

describe("enclosingBracketStart", () => {
  it("returns the innermost open bracket before the target", () => {
    expect(enclosingBracketStart("[a, [b]]", 5, "[", "]")).toBe(4);
  });

  it("returns null when earlier brackets are already balanced", () => {
    expect(enclosingBracketStart("[] a", 3, "[", "]")).toBeNull();
  });

  it("ignores brackets inside string literals", () => {
    expect(enclosingBracketStart("'[' a", 4, "[", "]")).toBeNull();
  });
});

describe("scanTopLevel", () => {
  it("visits only depth-zero characters", () => {
    const visited: string[] = [];

    scanTopLevel("a(b)c", 0, 5, (_index, character) => {
      visited.push(character);
    });

    expect(visited).toEqual(["a", "c"]);
  });

  it("skips characters inside string literals", () => {
    const visited: string[] = [];

    scanTopLevel("a'('b", 0, 5, (_index, character) => {
      visited.push(character);
    });

    expect(visited).toEqual(["a", "b"]);
  });

  it("reports depth transitions", () => {
    const depths: number[] = [];

    scanTopLevel("([])", 0, 4, () => undefined, (depth) => {
      depths.push(depth);
    });

    expect(depths).toEqual([1, 2, 1, 0]);
  });

  it("does nothing on an empty source", () => {
    const visited: number[] = [];

    scanTopLevel("", 0, 5, (index) => {
      visited.push(index);
    });

    expect(visited).toEqual([]);
  });
});

describe("isTopLevelBetween", () => {
  it("accepts spans without bracket nesting", () => {
    expect(isTopLevelBetween("abc", 0, 3)).toBe(true);
  });

  it("rejects spans crossing into nested brackets", () => {
    expect(isTopLevelBetween("f(g(x), y)", 2, 8)).toBe(false);
  });
});

describe("isTopLevelWhitespaceBetween", () => {
  it("accepts whitespace-only top-level spans", () => {
    expect(isTopLevelWhitespaceBetween("f(  'x')", 2, 4)).toBe(true);
  });

  it("rejects spans containing non-whitespace characters", () => {
    expect(isTopLevelWhitespaceBetween("f(a, 'x')", 2, 5)).toBe(false);
  });
});

describe("topLevelCallArgumentIndexAt", () => {
  it("returns the argument index at the target offset", () => {
    const source = "f(a, b, c)";

    expect(topLevelCallArgumentIndexAt(source, 1, 9, source.indexOf("b"))).toBe(1);
    expect(topLevelCallArgumentIndexAt(source, 1, 9, source.indexOf("c"))).toBe(2);
  });

  it("ignores commas nested inside inner calls", () => {
    const source = "f(g(a, b), c)";

    expect(topLevelCallArgumentIndexAt(source, 1, 12, source.indexOf("c"))).toBe(
      1,
    );
  });
});

describe("topLevelCallArgumentNameAtOffset", () => {
  it("returns the named-argument label before the target", () => {
    const source = "f(name: 'x')";

    expect(topLevelCallArgumentNameAtOffset(source, 1, 11, 8)).toBe("name");
  });

  it("resolves names of later arguments", () => {
    const source = "f(a, key: 'v')";

    expect(topLevelCallArgumentNameAtOffset(source, 1, 13, 10)).toBe("key");
  });

  it("returns null for positional arguments", () => {
    const source = "f('v')";

    expect(topLevelCallArgumentNameAtOffset(source, 1, 5, 2)).toBeNull();
  });

  it("supports unterminated calls without a closing parenthesis", () => {
    const source = "f(relation: '";

    expect(topLevelCallArgumentNameAtOffset(source, 1, null, 12)).toBe(
      "relation",
    );
  });
});
