import { describe, expect, it } from "vitest";
import { createReplacePreview } from "./replacePreview";

describe("createReplacePreview", () => {
  it("matches a plain-text query literally", () => {
    expect(preview("a.b", "a.b", "value", { pattern: "a.b" })).toBe(
      "value",
    );
  });

  it("keeps capture-like replacement text verbatim in plain-text mode", () => {
    expect(preview("a.b", "a.b", "value$1", { pattern: "a.b" })).toBe(
      "value$1",
    );
  });

  it("keeps PHP variable replacement text verbatim in plain-text mode", () => {
    expect(preview("x", "x", "$user = 5", { pattern: "x" })).toBe(
      "$user = 5",
    );
  });

  it("does not unescape double dollars in plain-text mode", () => {
    expect(preview("x", "x", "$$", { pattern: "x" })).toBe("$$");
  });

  it("expands an unbraced numbered capture", () => {
    expect(
      preview("name=Alice", "name=Alice", "user:$1", {
        pattern: "name=(\\w+)",
        isRegex: true,
      }),
    ).toBe("user:Alice");
  });

  it("expands a braced numbered capture", () => {
    expect(
      preview("42", "42", "${1}nd", {
        pattern: "(\\d+)",
        isRegex: true,
      }),
    ).toBe("42nd");
  });

  it("expands braced and unbraced named captures", () => {
    expect(
      preview("name=Alice", "name=Alice", "$name/${name}", {
        pattern: "name=(?P<name>\\w+)",
        isRegex: true,
      }),
    ).toBe("Alice/Alice");
  });

  it("expands a double dollar to one literal dollar", () => {
    expect(
      preview("42", "42", "$$$1", {
        pattern: "(\\d+)",
        isRegex: true,
      }),
    ).toBe("$42");
  });

  it("expands an unmatched optional group to an empty string", () => {
    expect(
      preview("b", "b", "<$1>", {
        pattern: "(a)?b",
        isRegex: true,
      }),
    ).toBe("<>");
  });

  it("keeps backslash-number replacement text literal", () => {
    expect(
      preview("42", "42", "\\1", {
        pattern: "(\\d+)",
        isRegex: true,
      }),
    ).toBe("\\1");
  });

  it("expands an unknown capture to an empty string", () => {
    expect(
      preview("42", "42", "$missing", {
        pattern: "(\\d+)",
        isRegex: true,
      }),
    ).toBe("");
  });

  it("respects case-insensitive matching", () => {
    expect(
      preview("FOO", "FOO", "<$1>", {
        pattern: "(foo)",
        isRegex: true,
        caseSensitive: false,
      }),
    ).toBe("<FOO>");
  });

  it.each([
    ["upper", "FOO", "foo", "next", false, "NEXT"],
    ["title", "Foo", "foo", "next value", false, "Next value"],
    ["lower", "foo", "foo", "NextValue", false, "NextValue"],
    ["mixed", "fOO", "foo", "NextValue", false, "NextValue"],
    [
      "mixed-separated-whole-match",
      "FOO-bar",
      "foo-bar",
      "next-value",
      false,
      "next-value",
    ],
    [
      "regex-expanded-first",
      "FOO-FOO",
      "(foo)-(foo)",
      "${1}bar",
      true,
      "FOOBAR",
    ],
    ["literal-dollar", "FOO", "foo", "$text", false, "$TEXT"],
  ])(
    "preserves whole-match case for %s",
    (_name, matchText, pattern, replacement, isRegex, expected) => {
      expect(
        preview(matchText, matchText, replacement, {
          pattern,
          isRegex,
          caseSensitive: false,
          preserveCase: true,
        }),
      ).toBe(expected);
    },
  );

  it("leaves an exact case-sensitive match replacement as typed", () => {
    expect(
      preview("foo", "foo", "NextValue", {
        pattern: "foo",
        caseSensitive: true,
        preserveCase: true,
      }),
    ).toBe("NextValue");
  });

  it("applies preserve case unconditionally to an upper case-sensitive match", () => {
    expect(
      preview("FOO", "FOO", "NextValue", {
        pattern: "FOO",
        caseSensitive: true,
        preserveCase: true,
      }),
    ).toBe("NEXTVALUE");
  });

  it("respects whole-word matching", () => {
    const compute = createReplacePreview({
      pattern: "cat",
      isRegex: false,
      caseSensitive: true,
      wholeWord: true,
      preserveCase: false,
    });

    expect(compute("cat", "cat scatter", "dog", 0)).toBe("dog");
    expect(compute("cat", "scatter", "dog", 1)).toBeNull();
  });

  it("returns null for an invalid regex", () => {
    expect(
      preview("value", "value", "next", {
        pattern: "(",
        isRegex: true,
      }),
    ).toBeNull();
  });

  it("returns null for a Rust Unicode class that JS cannot emulate exactly", () => {
    expect(
      preview("α", "α", "letter", {
        pattern: "\\p{Greek}+",
        isRegex: true,
      }),
    ).toBeNull();
  });
});

function preview(
  matchText: string,
  lineText: string,
  replacement: string,
  query: {
    pattern: string;
    isRegex?: boolean;
    caseSensitive?: boolean;
    wholeWord?: boolean;
    preserveCase?: boolean;
  },
): string | null {
  return createReplacePreview({
    isRegex: false,
    caseSensitive: true,
    wholeWord: false,
    preserveCase: false,
    ...query,
  })(matchText, lineText, replacement, lineText.indexOf(matchText));
}
