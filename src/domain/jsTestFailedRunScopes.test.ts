import { describe, expect, it } from "vitest";
import type { JsTestExplorerTestDiscovery } from "./jsTestExplorerTree";
import {
  jsTestFailedRunScopes,
  MAX_JS_TEST_FAILED_RUN_CASES,
  MAX_JS_TEST_FAILED_RUN_DISCOVERIES,
  MAX_JS_TEST_FAILED_RUN_SCOPES,
  type JsTestFailedRunSnapshot,
} from "./jsTestFailedRunScopes";
import { MAX_JS_TEST_SCOPE_FULL_NAME_BYTES } from "./jsTestRunScope";
import type { TestCase, TestRunOk } from "./testResults";

describe("jsTestFailedRunScopes", () => {
  it("selects only failed/error declarations, preserves prefix matching, and sorts deterministically", () => {
    const ordinary = discovery("src/z.test.ts", ["cart"], "charges", 8);
    const parameterized = discovery("src/a.test.ts", ["math"], "adds", 4, true);
    const input = snapshot(
      [ordinary, parameterized],
      [
        runtime("cart charges", "src/z.test.ts", 8, "error"),
        runtime("math adds 1 + 2", "/workspace/src/a.test.ts", 4, "failed"),
        runtime("ignored pass", null, null, "passed"),
        runtime("ignored skip", "../unsafe", -1, "skipped"),
      ],
    );

    const plan = jsTestFailedRunScopes(input);
    const reversed = jsTestFailedRunScopes(
      snapshot([...input.discoveries].reverse(), [...input.response.suites[0]!.cases].reverse()),
    );

    expect(plan).toEqual({
      scopes: [
        {
          fullName: "math adds",
          kind: "test",
          nameMatch: "prefix",
          relativeFilePath: "src/a.test.ts",
        },
        {
          fullName: "cart charges",
          kind: "test",
          relativeFilePath: "src/z.test.ts",
        },
      ],
      status: "available",
      unresolved: 0,
    });
    expect(reversed).toEqual(plan);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.scopes)).toBe(true);
    expect(plan.scopes.every(Object.isFrozen)).toBe(true);
    expect(plan.scopes[0]).not.toBe(input.discoveries[1]);
  });

  it("deduplicates repeated runtime cases and exact duplicate discovery identities", () => {
    const found = discovery("a.test.ts", [], "works", 3);
    const failed = runtime("works", "a.test.ts", 3, "failed");
    const plan = jsTestFailedRunScopes(snapshot([found, { ...found }], [failed, { ...failed }]));

    expect(plan).toMatchObject({ status: "available", unresolved: 0 });
    expect(plan.scopes).toEqual([
      { fullName: "works", kind: "test", relativeFilePath: "a.test.ts" },
    ]);
  });

  it.each([
    [
      "missing name",
      [discovery("a.test.ts", [], "works", 3)],
      [runtime(null, "a.test.ts", 3, "failed")],
    ],
    [
      "missing file",
      [discovery("a.test.ts", [], "works", 3)],
      [runtime("works", null, 3, "failed")],
    ],
    [
      "outside file",
      [discovery("a.test.ts", [], "works", 3)],
      [runtime("works", "/other/a.test.ts", 3, "failed")],
    ],
    [
      "wrong line",
      [discovery("a.test.ts", [], "works", 3)],
      [runtime("works", "a.test.ts", 4, "failed")],
    ],
    [
      "ambiguous null line",
      [discovery("a.test.ts", [], "works", 3), discovery("a.test.ts", [], "works", 7)],
      [runtime("works", "a.test.ts", null, "failed")],
    ],
  ])("fails the whole plan for an unresolved %s failure", (_label, discoveries, cases) => {
    const plan = jsTestFailedRunScopes(snapshot(discoveries, cases));
    expect(plan).toEqual({ scopes: [], status: "unavailable", unresolved: 1 });
  });

  it("accepts unique null-line and Windows absolute runtime paths", () => {
    const plan = jsTestFailedRunScopes(
      snapshot(
        [discovery("src\\a.test.ts", [], "works", 3)],
        [runtime("works", "C:\\workspace\\src\\a.test.ts", null, "failed")],
        { rootPath: "C:\\workspace" },
      ),
    );

    expect(plan).toEqual({
      scopes: [{ fullName: "works", kind: "test", relativeFilePath: "src/a.test.ts" }],
      status: "available",
      unresolved: 0,
    });
  });

  it("rejects duplicate exact scopes even when a runtime line identifies one declaration", () => {
    const plan = jsTestFailedRunScopes(
      snapshot(
        [discovery("a.test.ts", [], "same", 3), discovery("a.test.ts", [], "same", 7)],
        [runtime("same", "a.test.ts", 3, "failed")],
      ),
    );

    expect(plan).toEqual({ scopes: [], status: "unavailable", unresolved: 1 });
  });

  it("rejects a parameterized scope whose real prefix regex selects another declaration", () => {
    const plan = jsTestFailedRunScopes(
      snapshot(
        [
          discovery("a.test.ts", [], "case", 3, true),
          discovery("a.test.ts", [], "case expanded", 7),
        ],
        [runtime("case value", "a.test.ts", 3, "failed")],
      ),
    );

    expect(plan).toEqual({ scopes: [], status: "unavailable", unresolved: 1 });
  });

  it("accepts the 4096-byte scope-name boundary and rejects one byte more", () => {
    const boundary = "ž".repeat(MAX_JS_TEST_SCOPE_FULL_NAME_BYTES / 2);
    expect(
      jsTestFailedRunScopes(
        snapshot(
          [discovery("a.test.ts", [], boundary, 3)],
          [runtime(boundary, "a.test.ts", 3, "failed")],
        ),
      ).status,
    ).toBe("available");

    const over = `${boundary}a`;
    expect(
      jsTestFailedRunScopes(
        snapshot([discovery("a.test.ts", [], over, 3)], [runtime(over, "a.test.ts", 3, "failed")]),
      ).status,
    ).toBe("unavailable");
  });

  it("accepts 256 unique scopes and rejects the entire 257-scope plan", () => {
    const accepted = numberedSnapshot(MAX_JS_TEST_FAILED_RUN_SCOPES);
    const rejected = numberedSnapshot(MAX_JS_TEST_FAILED_RUN_SCOPES + 1);

    expect(jsTestFailedRunScopes(accepted)).toMatchObject({
      status: "available",
      unresolved: 0,
    });
    expect(jsTestFailedRunScopes(accepted).scopes).toHaveLength(MAX_JS_TEST_FAILED_RUN_SCOPES);
    expect(jsTestFailedRunScopes(rejected)).toEqual({
      scopes: [],
      status: "overflow",
      unresolved: 0,
    });
  });

  it("rejects case, discovery, cumulative text, and truncated-discovery overflow", () => {
    const found = discovery("a.test.ts", [], "works", 3);
    const tooManyCases = Array.from({ length: MAX_JS_TEST_FAILED_RUN_CASES + 1 }, () =>
      runtime("ignored", null, null, "passed"),
    );
    expect(jsTestFailedRunScopes(snapshot([found], tooManyCases)).status).toBe("overflow");

    const tooManyDiscoveries = Array.from(
      { length: MAX_JS_TEST_FAILED_RUN_DISCOVERIES + 1 },
      (_, index) => discovery(`${index}.test.ts`, [], `test ${index}`, 1),
    );
    expect(jsTestFailedRunScopes(snapshot(tooManyDiscoveries, [])).status).toBe("overflow");

    const longName = "x".repeat(MAX_JS_TEST_SCOPE_FULL_NAME_BYTES);
    const cumulative = snapshot(
      Array.from({ length: MAX_JS_TEST_FAILED_RUN_SCOPES }, (_, index) =>
        discovery(`${index}.test.ts`, [], `${longName.slice(0, -String(index).length)}${index}`, 1),
      ),
      Array.from({ length: MAX_JS_TEST_FAILED_RUN_SCOPES }, (_, index) =>
        runtime(
          `${longName.slice(0, -String(index).length)}${index}`,
          `${index}.test.ts`,
          1,
          "failed",
        ),
      ),
    );
    expect(jsTestFailedRunScopes(cumulative).status).toBe("overflow");

    expect(jsTestFailedRunScopes(snapshot([found], [], { discoveryTruncated: true })).status).toBe(
      "unavailable",
    );
  });

  it("rejects conflicting duplicate discovery semantics under one canonical ID", () => {
    const ordinary = discovery("a.test.ts", [], "works", 3);
    const parameterized = { ...ordinary, parameterized: true };
    const plan = jsTestFailedRunScopes(
      snapshot([ordinary, parameterized], [runtime("works", "a.test.ts", 3, "failed")]),
    );

    expect(plan.status).toBe("unavailable");
    expect(plan.scopes).toEqual([]);
  });
});

function numberedSnapshot(count: number): JsTestFailedRunSnapshot {
  return snapshot(
    Array.from({ length: count }, (_, index) =>
      discovery(`${index}.test.ts`, [], `test ${index}`, 1),
    ),
    Array.from({ length: count }, (_, index) =>
      runtime(`test ${index}`, `${index}.test.ts`, 1, "failed"),
    ),
  );
}

function discovery(
  filePath: string,
  suitePath: readonly string[],
  filter: string,
  lineNumber: number,
  parameterized = false,
): JsTestExplorerTestDiscovery {
  return {
    filePath,
    parameterized,
    suitePath,
    target: {
      filter,
      kind: "method",
      label: `Run ${filter}`,
      match: "description",
      position: { column: 1, lineNumber },
    },
  };
}

function runtime(
  name: string | null,
  file: string | null,
  line: number | null,
  status: TestCase["status"],
): TestCase {
  return { classname: null, file, line, message: null, name, status, time: 0 };
}

function snapshot(
  discoveries: readonly JsTestExplorerTestDiscovery[],
  cases: readonly TestCase[],
  overrides: Partial<Pick<JsTestFailedRunSnapshot, "discoveryTruncated" | "rootPath">> = {},
): JsTestFailedRunSnapshot {
  const response: TestRunOk = {
    status: "ok",
    suites: [
      {
        cases: [...cases],
        errors: cases.filter(({ status }) => status === "error").length,
        failures: cases.filter(({ status }) => status === "failed").length,
        name: "tests",
        skipped: cases.filter(({ status }) => status === "skipped").length,
        tests: cases.length,
        time: 0,
      },
    ],
    totals: {
      errors: cases.filter(({ status }) => status === "error").length,
      failures: cases.filter(({ status }) => status === "failed").length,
      skipped: cases.filter(({ status }) => status === "skipped").length,
      tests: cases.length,
      time: 0,
    },
  };
  return {
    discoveries,
    discoveryTruncated: false,
    response,
    rootPath: "/workspace",
    ...overrides,
  };
}
