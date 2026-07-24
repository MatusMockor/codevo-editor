import { describe, expect, it } from "vitest";
import { MAX_JS_TEST_SCOPE_FULL_NAME_BYTES } from "./jsTestRunScope";
import { MAX_JS_TEST_AT_CURSOR_SOURCE_BYTES } from "./jsTestSelectionAtCursor";
import { jsTestRunScopeAtCursor, jsTestRunScopeForFile } from "./jsTestRunSelection";

describe("jsTestRunScopeAtCursor", () => {
  it("maps the deepest containing declaration in nested suites", () => {
    const source = `describe("outer", () => {
  describe("inner", () => {
    it("works", () => {
      expect(true).toBe(true);
    });
  });
});`;

    expect(jsTestRunScopeAtCursor(source, { column: 12, lineNumber: 4 }, "src/a.test.ts")).toEqual({
      fullName: "outer inner works",
      kind: "test",
      relativeFilePath: "src/a.test.ts",
    });
  });

  it("falls back to the nearest complete declaration preceding the cursor", () => {
    const source = `it("first", () => {});

const between = true;

it("second", () => {});`;

    expect(jsTestRunScopeAtCursor(source, { column: 8, lineNumber: 3 }, "a.test.ts")).toMatchObject(
      { fullName: "first", kind: "test" },
    );
  });

  it("maps ordinary tests exactly and parameterized tests by prefix", () => {
    expect(
      jsTestRunScopeAtCursor('it("plain", () => {});', { column: 5, lineNumber: 1 }, "a.test.ts"),
    ).toEqual({ fullName: "plain", kind: "test", relativeFilePath: "a.test.ts" });

    expect(
      jsTestRunScopeAtCursor(
        'test.each([[1]])("case %i", () => {});',
        { column: 25, lineNumber: 1 },
        "a.test.ts",
      ),
    ).toEqual({
      fullName: "case",
      kind: "test",
      nameMatch: "prefix",
      relativeFilePath: "a.test.ts",
    });
  });

  it("maps a containing suite to a prefix-compatible suite scope", () => {
    const source = `describe("group", () => {
  it("inside", () => {});
});`;
    expect(jsTestRunScopeAtCursor(source, { column: 2, lineNumber: 3 }, "a.test.ts")).toEqual({
      fullName: "group",
      kind: "suite",
      relativeFilePath: "a.test.ts",
    });
  });

  it("fails closed for duplicate and prefix-ambiguous selections", () => {
    const duplicate = `it("same", () => {});
it("same", () => {});`;
    expect(jsTestRunScopeAtCursor(duplicate, { column: 5, lineNumber: 2 }, "a.test.ts")).toBeNull();

    const prefixCollision = `test.each([[1]])("case %i", () => {});
test("case detail", () => {});`;
    expect(
      jsTestRunScopeAtCursor(prefixCollision, { column: 20, lineNumber: 1 }, "a.test.ts"),
    ).toBeNull();
  });

  it("fails closed for invalid positions, source bounds, and unsafe file paths", () => {
    const declaration = 'it("works", () => {});';
    expect(
      jsTestRunScopeAtCursor(declaration, { column: 0, lineNumber: 1 }, "a.test.ts"),
    ).toBeNull();
    expect(
      jsTestRunScopeAtCursor(
        `${declaration.padEnd(MAX_JS_TEST_AT_CURSOR_SOURCE_BYTES, " ")}x`,
        { column: 5, lineNumber: 1 },
        "a.test.ts",
      ),
    ).toBeNull();
    expect(
      jsTestRunScopeAtCursor(declaration, { column: 5, lineNumber: 1 }, "../outside.test.ts"),
    ).toBeNull();
  });

  it("accepts the full-name field boundary and rejects one byte beyond it", () => {
    const boundary = "a".repeat(MAX_JS_TEST_SCOPE_FULL_NAME_BYTES);
    expect(
      jsTestRunScopeAtCursor(
        `it("${boundary}", () => {});`,
        { column: 5, lineNumber: 1 },
        "a.test.ts",
      ),
    ).toMatchObject({ fullName: boundary, kind: "test" });
    expect(
      jsTestRunScopeAtCursor(
        `it("${boundary}a", () => {});`,
        { column: 5, lineNumber: 1 },
        "a.test.ts",
      ),
    ).toBeNull();
  });
});

describe("jsTestRunScopeForFile", () => {
  it("normalizes a strict workspace-relative path", () => {
    expect(jsTestRunScopeForFile("src\\math.test.ts")).toEqual({
      kind: "file",
      relativeFilePath: "src/math.test.ts",
    });
  });

  it.each(["", "/outside.test.ts", "../outside.test.ts", "src//a.test.ts"])(
    "fails closed for unsafe file scope %j",
    (relativeFilePath) => {
      expect(jsTestRunScopeForFile(relativeFilePath)).toBeNull();
    },
  );
});
