import { describe, expect, it } from "vitest";
import {
  MAX_JS_TEST_PROBLEM_CASES,
  MAX_JS_TEST_PROBLEM_ENTRIES,
  MAX_JS_TEST_PROBLEM_MESSAGE_BYTES,
  MAX_JS_TEST_PROBLEM_OWNER_BYTES,
  MAX_JS_TEST_PROBLEM_ROOT_KEY_BYTES,
  emptyJsTestProblemsSnapshot,
  jsTestProblemMatchesScope,
  mergeJsTestProblemsSnapshot,
  validatedJsTestProblemsOwner,
  type JsTestProblemsOwner,
  type JsTestProblemsSnapshot,
} from "./jsTestProblems";
import type { JsTestRunScope } from "./jsTestRunScope";
import type { TestCase, TestRunResponse } from "./testResults";

const owner: JsTestProblemsOwner = { rootKey: "/workspace", workspaceId: "workspace-id" };

function testCase(
  name: string | null,
  file: string | null,
  status: TestCase["status"] = "failed",
  message = "assertion failed",
  line: number | null = 4,
): TestCase {
  return { classname: null, file, line, message, name, status, time: 0 };
}

function response(cases: readonly TestCase[]): TestRunResponse {
  return {
    status: "ok",
    suites: [
      {
        cases: [...cases],
        errors: cases.filter(({ status }) => status === "error").length,
        failures: cases.filter(({ status }) => status === "failed").length,
        name: "suite",
        skipped: cases.filter(({ status }) => status === "skipped").length,
        tests: cases.length,
        time: 0,
      },
    ],
    totals: { errors: 0, failures: 0, skipped: 0, tests: cases.length, time: 0 },
  };
}

function merge(
  previous: JsTestProblemsSnapshot | null,
  generation: number,
  scope: JsTestRunScope,
  cases: readonly TestCase[],
  nextOwner = owner,
) {
  return mergeJsTestProblemsSnapshot(previous, {
    generation,
    owner: nextOwner,
    response: response(cases),
    scope,
  });
}

describe("JavaScript test problem ownership", () => {
  it("aligns the ledger with the native report and rendering budgets", () => {
    expect(MAX_JS_TEST_PROBLEM_CASES).toBe(5_000);
    expect(MAX_JS_TEST_PROBLEM_ENTRIES).toBe(5_000);
    expect(MAX_JS_TEST_PROBLEM_MESSAGE_BYTES).toBe(4_096);
    expect(MAX_JS_TEST_PROBLEM_OWNER_BYTES).toBe(1_024);
    expect(MAX_JS_TEST_PROBLEM_ROOT_KEY_BYTES).toBe(4_096);
  });

  it("canonicalizes a safe exact owner and creates an immutable empty snapshot", () => {
    const normalized = validatedJsTestProblemsOwner({
      rootKey: " /workspace/project/ ",
      workspaceId: "workspace-id",
    });
    expect(normalized).toEqual({ rootKey: "/workspace/project", workspaceId: "workspace-id" });
    const snapshot = emptyJsTestProblemsSnapshot(normalized);
    expect(snapshot).toEqual({
      entries: [],
      generation: 0,
      owner: normalized,
      total: 0,
      truncated: false,
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it.each([
    { rootKey: "relative", workspaceId: "workspace-id" },
    { rootKey: "/workspace/../other", workspaceId: "workspace-id" },
    { rootKey: "/workspace\nother", workspaceId: "workspace-id" },
    { rootKey: "/workspace", workspaceId: "" },
    { rootKey: "/workspace", workspaceId: "spoof\u202eid" },
  ])("rejects unsafe owner %#", (candidate) => {
    expect(() => validatedJsTestProblemsOwner(candidate)).toThrow();
  });

  it("accepts the exact rootKey UTF-8 boundary and rejects one byte more", () => {
    const boundary = `/${"a".repeat(MAX_JS_TEST_PROBLEM_ROOT_KEY_BYTES - 1)}`;
    expect(
      validatedJsTestProblemsOwner({ rootKey: boundary, workspaceId: "workspace-id" }),
    ).toEqual({ rootKey: boundary, workspaceId: "workspace-id" });
    expect(() =>
      validatedJsTestProblemsOwner({ rootKey: `${boundary}a`, workspaceId: "workspace-id" }),
    ).toThrow("rootKey is invalid");
  });

  it("keeps the workspaceId byte budget independent from the rootKey budget", () => {
    const boundary = "w".repeat(MAX_JS_TEST_PROBLEM_OWNER_BYTES);
    expect(validatedJsTestProblemsOwner({ rootKey: "/workspace", workspaceId: boundary })).toEqual({
      rootKey: "/workspace",
      workspaceId: boundary,
    });
    expect(() =>
      validatedJsTestProblemsOwner({ rootKey: "/workspace", workspaceId: `${boundary}w` }),
    ).toThrow("workspaceId is invalid");
  });

  it("resets a mismatched owner even when the new runner fails", () => {
    const previous = merge(null, 1, { kind: "all" }, [testCase("old", "old.test.ts")]);
    const nextOwner = { rootKey: "/next", workspaceId: "next-id" };
    const reset = mergeJsTestProblemsSnapshot(previous, {
      generation: 1,
      owner: nextOwner,
      response: { message: "runner unavailable", status: "unavailable" },
      scope: { kind: "all" },
    });
    expect(reset).toEqual({
      entries: [],
      generation: 0,
      owner: nextOwner,
      total: 0,
      truncated: false,
    });
  });
});

describe("JavaScript test problem merging", () => {
  it("all replaces and keeps only navigable failed/error cases including file errors", () => {
    const previous = merge(null, 1, { kind: "all" }, [testCase("old", "old.test.ts")]);
    const next = merge(previous, 2, { kind: "all" }, [
      testCase("passes", "src/a.test.ts", "passed"),
      testCase("fails", "/workspace/src/a.test.ts", "failed"),
      testCase(null, "src/setup.test.ts", "error", "setup exploded", null),
      testCase("outside", "/other/a.test.ts"),
      testCase("traversal", "../outside.test.ts"),
      testCase("control", "src/bad\n.test.ts"),
    ]);
    expect(next.entries).toEqual([
      {
        filePath: "src/a.test.ts",
        lineNumber: 4,
        message: "assertion failed",
        name: "fails",
        status: "failed",
      },
      {
        filePath: "src/setup.test.ts",
        lineNumber: 1,
        message: "setup exploded",
        name: null,
        status: "error",
      },
    ]);
    expect(next).toMatchObject({ generation: 2, total: 2, truncated: false });
  });

  it("confines and normalizes absolute Windows report paths", () => {
    const windowsOwner = { rootKey: "C:\\workspace", workspaceId: "windows-id" };
    const next = merge(
      null,
      1,
      { kind: "all" },
      [
        testCase("inside", "C:\\workspace\\src\\a.test.ts"),
        testCase("outside", "C:\\other\\a.test.ts"),
        testCase("traversal", "C:\\workspace\\..\\other.test.ts"),
      ],
      windowsOwner,
    );
    expect(next.entries.map(({ filePath }) => filePath)).toEqual(["src/a.test.ts"]);
    expect(next.owner).toEqual({ rootKey: "C:/workspace", workspaceId: "windows-id" });
  });

  it("a successful file run clears exactly that file and retains another file", () => {
    const previous = merge(null, 1, { kind: "all" }, [
      testCase("a old", "a.test.ts"),
      testCase("b old", "b.test.ts"),
    ]);
    const next = merge(previous, 2, { kind: "file", relativeFilePath: "a.test.ts" }, [
      testCase("a now passes", "a.test.ts", "passed"),
      testCase("out of scope", "b.test.ts"),
    ]);
    expect(next.entries.map(({ name }) => name)).toEqual(["b old"]);
  });

  it("suite scope uses exact name or a space-delimited descendant only", () => {
    const scope = {
      fullName: "payments card",
      kind: "suite",
      relativeFilePath: "a.test.ts",
    } as const;
    const next = merge(null, 1, scope, [
      testCase("payments card", "a.test.ts"),
      testCase("payments card declines", "a.test.ts"),
      testCase("payments cards", "a.test.ts"),
      testCase(null, "a.test.ts", "error"),
    ]);
    expect(next.entries.map(({ name }) => name)).toEqual([
      "payments card",
      "payments card declines",
    ]);
  });

  it("test scope is exact unless canonical parameter-prefix matching is requested", () => {
    const exact = merge(
      null,
      1,
      { fullName: "math adds", kind: "test", relativeFilePath: "a.test.ts" },
      [testCase("math adds", "a.test.ts"), testCase("math adds [1, 2]", "a.test.ts")],
    );
    expect(exact.entries.map(({ name }) => name)).toEqual(["math adds"]);
    const parameterized = merge(
      exact,
      2,
      {
        fullName: "math adds",
        kind: "test",
        nameMatch: "prefix",
        relativeFilePath: "a.test.ts",
      },
      [testCase("math adds [1, 2]", "a.test.ts"), testCase("math additive", "a.test.ts")],
    );
    expect(parameterized.entries.map(({ name }) => name)).toEqual(["math adds [1, 2]"]);
  });

  it("matches and retains a name at the shared exact 4 KiB scope boundary", () => {
    const fullName = "ž".repeat(2_048);
    const next = merge(null, 1, { fullName, kind: "test", relativeFilePath: "a.test.ts" }, [
      testCase(fullName, "a.test.ts"),
    ]);
    expect(next.entries[0]?.name).toBe(fullName);
    expect(new TextEncoder().encode(next.entries[0]!.name!).byteLength).toBe(4_096);
  });

  it("rejects an over-limit scoped identity instead of matching lossy presentation text", () => {
    const fullName = `${"ž".repeat(2_048)}a`;
    expect(() =>
      merge(null, 1, { fullName, kind: "test", relativeFilePath: "a.test.ts" }, [
        testCase(fullName, "a.test.ts"),
      ]),
    ).toThrow("4096 UTF-8 bytes");
  });

  it("does not mutate for stale, error, or unavailable results", () => {
    const previous = merge(null, 2, { kind: "all" }, [testCase("old", "a.test.ts")]);
    for (const update of [
      { generation: 2, response: response([]) },
      { generation: 3, response: { message: "boom", status: "error" as const } },
      { generation: 4, response: { message: "missing", status: "unavailable" as const } },
    ]) {
      expect(
        mergeJsTestProblemsSnapshot(previous, {
          ...update,
          owner,
          scope: { kind: "all" },
        }),
      ).toBe(previous);
    }
  });

  it("keeps the first duplicate deterministically", () => {
    const next = merge(null, 1, { kind: "all" }, [
      testCase("same", "a.test.ts", "failed", "first"),
      testCase("same", "a.test.ts", "error", "second"),
    ]);
    expect(next.entries).toHaveLength(1);
    expect(next.entries[0]).toMatchObject({ message: "first", status: "failed" });
  });

  it("matches file-level errors only at all/file scope", () => {
    const entry = merge(null, 1, { kind: "all" }, [testCase(null, "a.test.ts", "error")])
      .entries[0]!;
    expect(jsTestProblemMatchesScope(entry, { kind: "file", relativeFilePath: "a.test.ts" })).toBe(
      true,
    );
    expect(
      jsTestProblemMatchesScope(entry, {
        fullName: "suite",
        kind: "suite",
        relativeFilePath: "a.test.ts",
      }),
    ).toBe(false);
  });
});

describe("JavaScript test problem bounds and hostile text", () => {
  it("sanitizes controls, bidi controls, and Unicode line separators then truncates by UTF-8", () => {
    const next = mergeJsTestProblemsSnapshot(
      null,
      {
        generation: 1,
        owner,
        response: response([
          testCase("na\nme\u202e", "a.test.ts", "failed", "bad\0message\u2066x\u2028y"),
        ]),
        scope: { kind: "all" },
      },
      { maxMessageBytes: 12, maxNameBytes: 8 },
    );
    expect(next.entries[0]?.name).toBe("na�…");
    expect(next.entries[0]?.message).toBe("bad�mes…");
    expect(next.entries[0]?.name).not.toMatch(/[\p{Cc}\u2028\u2029\u202a-\u202e\u2066-\u2069]/u);
    expect(next.entries[0]?.message).not.toMatch(/[\p{Cc}\u2028\u2029\u202a-\u202e\u2066-\u2069]/u);
  });

  it("caps retained entries with an exact visible/total overflow count", () => {
    const next = mergeJsTestProblemsSnapshot(
      null,
      {
        generation: 1,
        owner,
        response: response([
          testCase("one", "a.test.ts"),
          testCase("two", "b.test.ts"),
          testCase("three", "c.test.ts"),
        ]),
        scope: { kind: "all" },
      },
      { maxEntries: 2 },
    );
    expect(next.entries.map(({ name }) => name)).toEqual(["one", "two"]);
    expect(next).toMatchObject({ total: 3, truncated: true });
  });

  it("caps aggregate text and case processing truthfully as incomplete", () => {
    const textCapped = mergeJsTestProblemsSnapshot(
      null,
      {
        generation: 1,
        owner,
        response: response([testCase("one", "a.test.ts", "failed", "long message")]),
        scope: { kind: "all" },
      },
      { maxTextBytes: 5 },
    );
    expect(textCapped).toMatchObject({ entries: [], total: 1, truncated: true });

    const caseCapped = mergeJsTestProblemsSnapshot(
      null,
      {
        generation: 1,
        owner,
        response: response([testCase("one", "a.test.ts"), testCase("two", "b.test.ts")]),
        scope: { kind: "all" },
      },
      { maxCases: 1 },
    );
    expect(caseCapped.entries.map(({ name }) => name)).toEqual(["one"]);
    expect(caseCapped.truncated).toBe(true);
  });

  it("resets an incomplete ledger to a successful scoped result", () => {
    const incomplete = mergeJsTestProblemsSnapshot(
      null,
      {
        generation: 1,
        owner,
        response: response([testCase("old a", "a.test.ts"), testCase("old b", "b.test.ts")]),
        scope: { kind: "all" },
      },
      { maxEntries: 1 },
    );
    const next = merge(incomplete, 2, { kind: "file", relativeFilePath: "b.test.ts" }, [
      testCase("new b", "b.test.ts"),
    ]);
    expect(next.entries.map(({ name }) => name)).toEqual(["new b"]);
    expect(next).toMatchObject({ total: 1, truncated: true });
  });

  it("drops possibly stale failures when a scoped rerun passes against an incomplete ledger", () => {
    const incomplete = mergeJsTestProblemsSnapshot(
      null,
      {
        generation: 1,
        owner,
        response: response([testCase("old a", "a.test.ts"), testCase("old b", "b.test.ts")]),
        scope: { kind: "all" },
      },
      { maxEntries: 1 },
    );
    const next = merge(incomplete, 2, { kind: "file", relativeFilePath: "b.test.ts" }, [
      testCase("now passes", "b.test.ts", "passed"),
    ]);
    expect(next).toMatchObject({ entries: [], total: 0, truncated: true });
  });
});
