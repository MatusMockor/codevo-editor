import { describe, expect, it } from "vitest";
import type { JsTestExplorerSuiteNode, JsTestExplorerTestNode } from "./jsTestExplorerTree";
import {
  jsTestRunScopeForExplorerNode,
  MAX_JS_TEST_SCOPE_FULL_NAME_BYTES,
  validatedJsTestRunScope,
  type JsTestRunScope,
} from "./jsTestRunScope";

describe("jsTestRunScopeForExplorerNode", () => {
  const rootSuite: JsTestExplorerSuiteNode = {
    children: [],
    filePath: "/workspace/src/math.test.ts",
    id: "root-suite",
    kind: "suite",
    label: "(root)",
    status: "idle",
    suitePath: [],
  };
  const topLevelTest: JsTestExplorerTestNode = {
    filePath: rootSuite.filePath,
    id: "top-level-test",
    kind: "test",
    label: "adds",
    parameterized: false,
    status: "idle",
    suitePath: [],
    target: {
      filter: "adds",
      kind: "method",
      label: "Run adds",
      match: "description",
      position: { column: 1, lineNumber: 1 },
    },
  };

  it("maps the synthetic root suite to its file", () => {
    expect(jsTestRunScopeForExplorerNode("/workspace", rootSuite)).toEqual({
      kind: "file",
      relativeFilePath: "src/math.test.ts",
    });
  });

  it("keeps a top-level test as an exact test selection", () => {
    expect(jsTestRunScopeForExplorerNode("/workspace", topLevelTest)).toEqual({
      fullName: "adds",
      kind: "test",
      relativeFilePath: "src/math.test.ts",
    });
  });
});

describe("validatedJsTestRunScope", () => {
  it.each<JsTestRunScope>([
    { kind: "all" },
    { kind: "file", relativeFilePath: "src/math.test.ts" },
    { kind: "suite", relativeFilePath: "src/math.test.ts", fullName: "math" },
    { kind: "test", relativeFilePath: "src/math.test.ts", fullName: "math adds" },
    {
      kind: "test",
      relativeFilePath: "src/math.test.ts",
      fullName: "math adds",
      nameMatch: "prefix",
    },
  ])("accepts a safe $kind scope", (scope) => {
    expect(validatedJsTestRunScope(scope)).toEqual(scope);
  });

  it("normalizes Windows separators before sending a scope", () => {
    expect(
      validatedJsTestRunScope({ kind: "file", relativeFilePath: "src\\math.test.ts" }),
    ).toEqual({ kind: "file", relativeFilePath: "src/math.test.ts" });
  });

  it("rebuilds an all-tests scope as an exact closed wire shape", () => {
    expect(validatedJsTestRunScope({ kind: "all", unexpected: true } as never)).toEqual({
      kind: "all",
    });
  });

  it.each([null, undefined, { kind: "unknown" }])(
    "rejects a malformed runtime scope %#",
    (scope) => {
      expect(() => validatedJsTestRunScope(scope as never)).toThrow(
        /scope (must be an object|kind is invalid)/,
      );
    },
  );

  it.each([
    "",
    "/outside.test.ts",
    "C:/outside.test.ts",
    "../outside.test.ts",
    "src//a.test.ts",
    "src/./a.test.ts",
    "src/a\n.test.ts",
    "src/spoof\u2066.test.ts",
    "src/split\u2029.test.ts",
  ])("rejects an unsafe test file path %j", (relativeFilePath) => {
    expect(() => validatedJsTestRunScope({ kind: "file", relativeFilePath })).toThrow(
      "stay inside the workspace",
    );
  });

  it.each(["", "suite\nother", "test\0other", "spoof\u202eother", "split\u2028other"])(
    "rejects an unsafe full name %j",
    (fullName) => {
      expect(() =>
        validatedJsTestRunScope({ kind: "test", relativeFilePath: "a.test.ts", fullName }),
      ).toThrow("non-empty and single-line");
    },
  );

  it("accepts the exact full-name UTF-8 boundary and rejects one byte more", () => {
    const boundary = "ž".repeat(MAX_JS_TEST_SCOPE_FULL_NAME_BYTES / 2);
    expect(
      validatedJsTestRunScope({
        fullName: boundary,
        kind: "test",
        relativeFilePath: "a.test.ts",
      }),
    ).toMatchObject({ fullName: boundary });
    expect(() =>
      validatedJsTestRunScope({
        fullName: `${boundary}a`,
        kind: "test",
        relativeFilePath: "a.test.ts",
      }),
    ).toThrow(`${MAX_JS_TEST_SCOPE_FULL_NAME_BYTES} UTF-8 bytes`);
  });
});
