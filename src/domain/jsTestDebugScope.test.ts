import { describe, expect, it } from "vitest";
import type {
  JsTestExplorerFileNode,
  JsTestExplorerSuiteNode,
  JsTestExplorerTestNode,
} from "./jsTestExplorerTree";
import {
  createJsTestDebugTarget,
  jsTestDebugNamePattern,
  jsTestDebugScopeForExplorerNode,
  MAX_JS_TEST_DEBUG_FULL_NAME_BYTES,
  MAX_JS_TEST_DEBUG_PATH_BYTES,
  validatedJsTestDebugFullName,
  validatedJsTestDebugScope,
} from "./jsTestDebugScope";
import {
  createWorkspaceRuntimeOwner,
  transferWorkspaceRuntimeOwner,
} from "./workspaceRuntimeOwner";

const fileNode: JsTestExplorerFileNode = {
  children: [],
  filePath: "/workspace/src/math.test.ts",
  id: "file",
  kind: "file",
  label: "math.test.ts",
  status: "idle",
};

const suiteNode: JsTestExplorerSuiteNode = {
  children: [],
  filePath: fileNode.filePath,
  id: "suite",
  kind: "suite",
  label: "fast (math)",
  status: "idle",
  suitePath: ["math", "fast (math)"],
};

const testNode: JsTestExplorerTestNode = {
  filePath: fileNode.filePath,
  id: "test",
  kind: "test",
  label: "adds [one] + two?",
  parameterized: false,
  status: "idle",
  suitePath: ["math", "fast (math)"],
  target: {
    filter: "adds [one] + two?",
    kind: "method",
    label: "adds [one] + two?",
    match: "description",
    position: { column: 1, lineNumber: 1 },
  },
};

describe("jsTestDebugScopeForExplorerNode", () => {
  it("maps file, suite, and exact test nodes onto the shared run-scope contract", () => {
    expect(jsTestDebugScopeForExplorerNode("/workspace", fileNode)).toEqual({
      kind: "file",
      relativeFilePath: "src/math.test.ts",
    });
    expect(jsTestDebugScopeForExplorerNode("/workspace", suiteNode)).toEqual({
      fullName: "math fast (math)",
      kind: "suite",
      relativeFilePath: "src/math.test.ts",
    });
    expect(jsTestDebugScopeForExplorerNode("/workspace", testNode)).toEqual({
      fullName: "math fast (math) adds [one] + two?",
      kind: "test",
      relativeFilePath: "src/math.test.ts",
    });
  });

  it("maps parameterized tests to prefix matching", () => {
    expect(
      jsTestDebugScopeForExplorerNode("/workspace", { ...testNode, parameterized: true }),
    ).toMatchObject({ kind: "test", nameMatch: "prefix" });
  });

  it("maps the synthetic root suite to the file selection", () => {
    expect(
      jsTestDebugScopeForExplorerNode("/workspace", {
        ...suiteNode,
        id: "root-suite",
        label: "(root)",
        suitePath: [],
      }),
    ).toEqual({ kind: "file", relativeFilePath: "src/math.test.ts" });
  });
});

describe("validatedJsTestDebugScope", () => {
  it("shares runner-visible full-name admission with cursor selection", () => {
    expect(validatedJsTestDebugFullName("suite test")).toBe("suite test");
    expect(() => validatedJsTestDebugFullName("suite\ntest")).toThrow("single-line");
    expect(() => validatedJsTestDebugFullName("suite\u202etest")).toThrow("single-line");
  });

  it("normalizes the shared run-scope path policy", () => {
    expect(
      validatedJsTestDebugScope({ kind: "file", relativeFilePath: "src\\math.test.ts" }),
    ).toEqual({ kind: "file", relativeFilePath: "src/math.test.ts" });
  });

  it.each([
    { kind: "file" as const, relativeFilePath: `${"a".repeat(MAX_JS_TEST_DEBUG_PATH_BYTES)}.ts` },
    {
      fullName: "ž".repeat(MAX_JS_TEST_DEBUG_FULL_NAME_BYTES / 2 + 1),
      kind: "test" as const,
      relativeFilePath: "a.test.ts",
    },
  ])("rejects over-limit path and full-name payloads", (scope) => {
    expect(() => validatedJsTestDebugScope(scope)).toThrow("UTF-8 bytes");
  });

  it.each([
    { kind: "file" as const, relativeFilePath: "src/bad\u0085name.test.ts" },
    {
      fullName: "math\u0085adds",
      kind: "test" as const,
      relativeFilePath: "src/math.test.ts",
    },
  ])("rejects Unicode control characters", (scope) => {
    expect(() => validatedJsTestDebugScope(scope)).toThrow();
  });

  it.each(["\ud800", "\udc00"])("rejects an unpaired surrogate %j", (surrogate) => {
    expect(() =>
      validatedJsTestDebugScope({
        kind: "file",
        relativeFilePath: `src/${surrogate}.test.ts`,
      }),
    ).toThrow("valid Unicode");
    expect(() =>
      validatedJsTestDebugScope({
        fullName: `math ${surrogate}`,
        kind: "test",
        relativeFilePath: "src/math.test.ts",
      }),
    ).toThrow("valid Unicode");
  });

  it("accepts valid surrogate pairs", () => {
    expect(
      validatedJsTestDebugScope({
        fullName: "math \ud83e\uddea",
        kind: "test",
        relativeFilePath: "src/\ud83e\uddea.test.ts",
      }),
    ).toEqual({
      fullName: "math \ud83e\uddea",
      kind: "test",
      relativeFilePath: "src/\ud83e\uddea.test.ts",
    });
  });

  it("keeps the existing traversal and control-character validation", () => {
    expect(() =>
      validatedJsTestDebugScope({ kind: "file", relativeFilePath: "../outside.test.ts" }),
    ).toThrow("inside the workspace");
    expect(() =>
      validatedJsTestDebugScope({
        fullName: "suite\ntest",
        kind: "test",
        relativeFilePath: "a.test.ts",
      }),
    ).toThrow("single-line");
  });
});

describe("jsTestDebugNamePattern", () => {
  it.each(["jest", "vitest"] as const)(
    "escapes and exactly anchors ordinary test names for %s",
    (runner) => {
      expect(
        jsTestDebugNamePattern(jsTestDebugScopeForExplorerNode("/workspace", testNode), runner),
      ).toEqual({
        match: "exact",
        runner,
        source: String.raw`^math fast \(math\) adds \[one\] \+ two\?$`,
      });
    },
  );

  it("uses a token-boundary prefix for suites and parameterized tests", () => {
    expect(
      jsTestDebugNamePattern(jsTestDebugScopeForExplorerNode("/workspace", suiteNode), "jest"),
    ).toMatchObject({ match: "prefix", source: String.raw`^math fast \(math\)(?: |$)` });
    expect(
      jsTestDebugNamePattern(
        jsTestDebugScopeForExplorerNode("/workspace", { ...testNode, parameterized: true }),
        "vitest",
      ),
    ).toMatchObject({
      match: "prefix",
      source: String.raw`^math fast \(math\) adds \[one\] \+ two\?(?: |$)`,
    });
  });

  it("does not create a name filter for file scopes", () => {
    expect(
      jsTestDebugNamePattern({ kind: "file", relativeFilePath: "a.test.ts" }, "jest"),
    ).toBeNull();
  });
});

describe("createJsTestDebugTarget", () => {
  it("retains stable admitted owner identity when the execution root changes", () => {
    const original = createWorkspaceRuntimeOwner("workspace-id", "/workspace-v1");
    const transferred = transferWorkspaceRuntimeOwner(original, "/workspace-v2");
    const target = createJsTestDebugTarget(transferred, "vitest", {
      kind: "file",
      relativeFilePath: "src/math.test.ts",
    });

    expect(target).toMatchObject({
      executionRoot: "/workspace-v2",
      ownerKey: original.ownerKey,
      runner: "vitest",
    });
    expect(target.ownerKey).toBe(transferred.ownerKey);
  });
});
