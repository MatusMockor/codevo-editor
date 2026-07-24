import { describe, expect, it } from "vitest";
import {
  jsTestDebugSelectionAtCursor,
  MAX_JS_TEST_DEBUG_AT_CURSOR_DECLARATIONS,
  MAX_JS_TEST_DEBUG_AT_CURSOR_SOURCE_BYTES,
  MAX_JS_TEST_DEBUG_AT_CURSOR_SOURCE_LINES,
} from "./jsTestDebugAtCursor";

describe("jsTestDebugSelectionAtCursor", () => {
  it("selects the deepest complete declaration containing the cursor", () => {
    const source = `describe("outer", () => {
  describe("inner", () => {
    it("works", () => {
      expect(true).toBe(true);
    });
  });
});`;

    expect(jsTestDebugSelectionAtCursor(source, { column: 12, lineNumber: 4 })).toEqual({
      fullName: "outer inner works",
      kind: "test",
      match: "containing",
      nameMatch: "exact",
      parameterized: false,
      position: { column: 5, lineNumber: 3 },
      suitePath: ["outer", "inner"],
      title: "works",
    });
    expect(jsTestDebugSelectionAtCursor(source, { column: 3, lineNumber: 6 })).toMatchObject({
      fullName: "outer inner",
      kind: "suite",
      match: "containing",
      nameMatch: "prefix",
    });
  });

  it("falls back to the declaration whose start is closest before the cursor", () => {
    const source = `it("first", () => {});

const between = true;

it("second", () => {});`;

    expect(jsTestDebugSelectionAtCursor(source, { column: 8, lineNumber: 3 })).toMatchObject({
      fullName: "first",
      match: "preceding",
    });
    expect(jsTestDebugSelectionAtCursor(source, { column: 1, lineNumber: 1 })).toMatchObject({
      fullName: "first",
      match: "containing",
    });
  });

  it("returns null before every declaration and for invalid one-based positions", () => {
    const source = '\n\nit("later", () => {});';
    expect(jsTestDebugSelectionAtCursor(source, { column: 1, lineNumber: 1 })).toBeNull();
    for (const position of [
      { column: 0, lineNumber: 1 },
      { column: 1, lineNumber: 0 },
      { column: 99, lineNumber: 1 },
      { column: 1, lineNumber: 99 },
      { column: 1.5, lineNumber: 1 },
    ]) {
      expect(jsTestDebugSelectionAtCursor(source, position)).toBeNull();
    }
  });

  it("preserves static suite ancestry and uses prefix matching for parameterized tests", () => {
    const source = `describe.each([[1]])("group %i", () => {
  test.each([[2]])("case %i", () => {});
});`;

    expect(jsTestDebugSelectionAtCursor(source, { column: 28, lineNumber: 2 })).toEqual({
      fullName: "group case",
      kind: "test",
      match: "containing",
      nameMatch: "prefix",
      parameterized: true,
      position: { column: 3, lineNumber: 2 },
      suitePath: ["group"],
      title: "case",
    });
  });

  it("ignores dynamic ancestry and incomplete calls conservatively", () => {
    expect(
      jsTestDebugSelectionAtCursor(
        `describe(name, () => {
  it("hidden", () => {});
});`,
        { column: 10, lineNumber: 2 },
      ),
    ).toBeNull();
    expect(
      jsTestDebugSelectionAtCursor('it("unfinished", () => {', {
        column: 10,
        lineNumber: 1,
      }),
    ).toBeNull();
  });

  it.each([
    'it("line\\nbreak", () => {});',
    'it("tab\\tbreak", () => {});',
    `it("bidi\u202ebreak", () => {});`,
  ])("rejects runner-invalid debug names from %j", (source) => {
    expect(jsTestDebugSelectionAtCursor(source, { column: 5, lineNumber: 1 })).toBeNull();
  });

  it("rejects duplicate exact test names", () => {
    const source = `it("duplicate", () => {});
it("duplicate", () => {});`;
    expect(jsTestDebugSelectionAtCursor(source, { column: 8, lineNumber: 2 })).toBeNull();
  });

  it("rejects parameterized filters that prefix-match another declaration", () => {
    const source = `test.each([[1]])("case %i", () => {});
test("case detail", () => {});`;
    expect(jsTestDebugSelectionAtCursor(source, { column: 25, lineNumber: 1 })).toBeNull();
  });

  it("allows suite descendants but rejects prefix collisions outside that suite", () => {
    const safe = `describe("group", () => {
  it("inside", () => {});
});`;
    expect(jsTestDebugSelectionAtCursor(safe, { column: 2, lineNumber: 3 })).toMatchObject({
      fullName: "group",
      kind: "suite",
    });

    const ambiguous = `${safe}
describe("group other", () => {
  it("outside", () => {});
});`;
    expect(jsTestDebugSelectionAtCursor(ambiguous, { column: 2, lineNumber: 3 })).toBeNull();
  });

  it("returns deeply frozen selections", () => {
    const result = jsTestDebugSelectionAtCursor('it("works", () => {});', {
      column: 10,
      lineNumber: 1,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result?.position)).toBe(true);
    expect(Object.isFrozen(result?.suitePath)).toBe(true);
  });

  it("fails closed beyond source byte, line, declaration, and Unicode budgets", () => {
    const declaration = 'it("works", () => {});';
    const exactBytes = declaration.padEnd(MAX_JS_TEST_DEBUG_AT_CURSOR_SOURCE_BYTES, " ");
    expect(jsTestDebugSelectionAtCursor(exactBytes, { column: 5, lineNumber: 1 })).not.toBeNull();
    expect(jsTestDebugSelectionAtCursor(`${exactBytes}x`, { column: 5, lineNumber: 1 })).toBeNull();

    const exactLines = `${declaration}\n${"\n".repeat(
      MAX_JS_TEST_DEBUG_AT_CURSOR_SOURCE_LINES - 2,
    )}`;
    expect(jsTestDebugSelectionAtCursor(exactLines, { column: 5, lineNumber: 1 })).not.toBeNull();
    expect(
      jsTestDebugSelectionAtCursor(`${exactLines}\n`, { column: 5, lineNumber: 1 }),
    ).toBeNull();

    const tooMany = Array.from(
      { length: MAX_JS_TEST_DEBUG_AT_CURSOR_DECLARATIONS + 1 },
      (_, index) => `it("case ${index}", () => {});`,
    ).join("\n");
    expect(jsTestDebugSelectionAtCursor(tooMany, { column: 5, lineNumber: 1 })).toBeNull();
    expect(
      jsTestDebugSelectionAtCursor('it("bad", () => {});\ud800', {
        column: 5,
        lineNumber: 1,
      }),
    ).toBeNull();
  });
});
