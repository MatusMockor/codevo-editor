import { describe, expect, it } from "vitest";
import type { JsTestExplorerTestDiscovery } from "./jsTestExplorerTree";
import {
  jsTestScopeForDiscovery,
  markJsTestExplorerScopeRunning,
  mergeJsTestExplorerRunResponse,
} from "./jsTestExplorerResults";
import type { TestCase, TestRunResponse } from "./testResults";

function discovery(
  filePath: string,
  suitePath: readonly string[],
  filter: string,
  lineNumber: number,
  status: JsTestExplorerTestDiscovery["status"] = "idle",
  parameterized = false,
): JsTestExplorerTestDiscovery {
  return {
    filePath,
    parameterized,
    status,
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

function response(cases: TestCase[]): TestRunResponse {
  return {
    status: "ok",
    suites: [
      { cases, errors: 0, failures: 0, name: "file", skipped: 0, tests: cases.length, time: 0 },
    ],
    totals: { errors: 0, failures: 0, skipped: 0, tests: cases.length, time: 0 },
  };
}

function testCase(name: string, file: string, line: number, status: TestCase["status"]): TestCase {
  return { classname: null, file, line, message: null, name, status, time: 0 };
}

describe("JavaScript Test Explorer result merging", () => {
  const tests = [
    discovery("a.test.ts", ["payments"], "charges", 4, "passed"),
    discovery("b.test.ts", ["payments"], "charges", 7, "failed"),
  ];

  it("marks only the selected file subtree as running", () => {
    expect(
      markJsTestExplorerScopeRunning(tests, { kind: "file", relativeFilePath: "a.test.ts" }),
    ).toEqual([{ ...tests[0], status: "running" }, tests[1]]);
  });

  it("merges a uniquely identified runtime case without changing another file", () => {
    const running = markJsTestExplorerScopeRunning(tests, {
      fullName: "payments charges",
      kind: "test",
      relativeFilePath: "a.test.ts",
    });
    const merged = mergeJsTestExplorerRunResponse(
      running,
      { fullName: "payments charges", kind: "test", relativeFilePath: "a.test.ts" },
      response([testCase("payments charges", "/workspace/a.test.ts", 4, "failed")]),
      "/workspace",
    );

    expect(merged.map(({ status }) => status)).toEqual(["failed", "failed"]);
  });

  it("does not guess when duplicate runtime cases are ambiguous", () => {
    const running = markJsTestExplorerScopeRunning(tests, { kind: "all" });
    const duplicate = testCase("payments charges", "a.test.ts", 4, "passed");
    const merged = mergeJsTestExplorerRunResponse(
      running,
      { kind: "all" },
      response([duplicate, { ...duplicate }]),
    );

    expect(merged[0]?.status).toBe("idle");
    expect(merged[1]?.status).toBe("idle");
  });

  it("aggregates generated .each runtime cases under their stable discovery prefix", () => {
    const parameterized = discovery("a.test.ts", ["payments"], "charges", 4, "running", true);
    const merged = mergeJsTestExplorerRunResponse(
      [parameterized],
      { fullName: "payments charges", kind: "test", relativeFilePath: "a.test.ts" },
      response([
        testCase("payments charges card", "/workspace/a.test.ts", 4, "passed"),
        testCase("payments charges cash", "/workspace/a.test.ts", 4, "failed"),
      ]),
      "/workspace",
    );

    expect(merged[0]?.status).toBe("failed");
  });

  it("aggregates duplicate exact runtime names only for an explicit .each declaration", () => {
    const parameterized = discovery("a.test.ts", ["payments"], "charges", 4, "running", true);
    const exact = testCase("payments charges", "/workspace/a.test.ts", 4, "passed");
    const merged = mergeJsTestExplorerRunResponse(
      [parameterized],
      { kind: "all" },
      response([exact, { ...exact, status: "failed" }]),
      "/workspace",
    );

    expect(merged[0]?.status).toBe("failed");
  });

  it("does not map a generated case from another file or source line", () => {
    const parameterized = discovery("a.test.ts", ["payments"], "charges", 4, "running", true);
    const merged = mergeJsTestExplorerRunResponse(
      [parameterized],
      { kind: "all" },
      response([
        testCase("payments charges card", "/workspace/b.test.ts", 4, "passed"),
        testCase("payments charges cash", "/workspace/a.test.ts", 9, "passed"),
      ]),
      "/workspace",
    );

    expect(merged[0]?.status).toBe("idle");
  });

  it("does not prefix-map an ordinary test declaration", () => {
    const ordinary = discovery("a.test.ts", ["payments"], "charges", 4, "running");
    const merged = mergeJsTestExplorerRunResponse(
      [ordinary],
      { kind: "all" },
      response([testCase("payments charges card", "/workspace/a.test.ts", 4, "passed")]),
      "/workspace",
    );

    expect(merged[0]?.status).toBe("idle");
  });

  it("requests prefix matching only for an explicitly parameterized declaration", () => {
    const ordinary = discovery("a.test.ts", ["payments"], "charges", 4);
    const parameterized = discovery("a.test.ts", ["payments"], "charges", 4, "idle", true);

    expect(jsTestScopeForDiscovery(ordinary)).toEqual({
      fullName: "payments charges",
      kind: "test",
      relativeFilePath: "a.test.ts",
    });
    expect(jsTestScopeForDiscovery(parameterized)).toEqual({
      fullName: "payments charges",
      kind: "test",
      nameMatch: "prefix",
      relativeFilePath: "a.test.ts",
    });
  });

  it("does not suffix-match a report file outside the known workspace root", () => {
    const ordinary = discovery("src/a.test.ts", [], "works", 4, "running");
    const merged = mergeJsTestExplorerRunResponse(
      [ordinary],
      { kind: "all" },
      response([testCase("works", "/other/src/a.test.ts", 4, "passed")]),
      "/workspace",
    );

    expect(merged[0]?.status).toBe("idle");
  });

  it("returns an affected running scope to idle when the runner fails", () => {
    const running = markJsTestExplorerScopeRunning(tests, { kind: "all" });
    const merged = mergeJsTestExplorerRunResponse(
      running,
      { kind: "all" },
      {
        message: "runner failed",
        status: "error",
      },
    );

    expect(merged.map(({ status }) => status)).toEqual(["idle", "idle"]);
  });
});
