import { describe, expect, it } from "vitest";
import type { JsTestBatchResponse } from "../domain/jsTestBatch";
import type { JsTestTaskOutput } from "../domain/jsTestTask";
import type { TestRunOk } from "../domain/testResults";
import {
  aggregateJsTestRunResults,
  jsTestFailedRunPlanForBatch,
  runJsTestExplorerBatch,
} from "./jsTestExplorerBatchRun";

describe("aggregateJsTestRunResults", () => {
  it("aggregates bounded package totals in stable package order", () => {
    const aggregate = aggregateJsTestRunResults([response("a", 1), response("b", 2)]);

    expect(aggregate).toEqual({
      status: "ok",
      suites: [expect.objectContaining({ name: "a" }), expect.objectContaining({ name: "b" })],
      totals: {
        errors: 0,
        failures: 0,
        skipped: 0,
        tests: 3,
        time: 3,
      },
    });
    expect(Object.isFrozen(aggregate)).toBe(true);
    expect(Object.isFrozen(aggregate?.suites)).toBe(true);
    expect(Object.isFrozen(aggregate?.totals)).toBe(true);
  });

  it("fails before retaining a package projection beyond the global suite limit", () => {
    const overLimit = response("overflow", 0);
    overLimit.suites = Array.from({ length: 5_001 }, (_, index) => ({
      cases: [],
      errors: 0,
      failures: 0,
      name: `suite-${index}`,
      skipped: 0,
      tests: 0,
      time: 0,
    }));

    expect(aggregateJsTestRunResults([overLimit])).toBeNull();
  });

  it.each([
    [
      "cancelled",
      batchResponse({
        authorities: [],
        output: output("cancelled"),
        status: "cancelled",
      }),
      { message: "JavaScript test run was cancelled.", status: "error" },
      "cancelled",
    ],
    [
      "error",
      batchResponse({
        authorities: [],
        message: "failed",
        output: output("failed"),
        status: "error",
      }),
      { message: "failed", status: "error" },
      "failed",
    ],
    [
      "unavailable",
      batchResponse({
        authorities: [],
        message: "unavailable",
        status: "unavailable",
      }),
      { message: "unavailable", status: "unavailable" },
      null,
    ],
  ] as const)(
    "maps the %s response through its exhaustive branch",
    async (_label, response, expectedResponse, expectedOutput) => {
      const outcome = await runJsTestExplorerBatch({
        activation: 1,
        createRunId: () => "run",
        gateway: {
          runBatch: async () => response,
          stopBatch: async () => true,
        },
        isCurrent: () => true,
        onCoordinator: () => undefined,
        packages: [{ packageRootRelativePath: "packages/a" }],
        workspaceId: "workspace",
      });

      expect(outcome.status).toBe("settled");
      if (outcome.status !== "settled") return;
      expect(outcome.response).toEqual(expectedResponse);
      expect(outcome.output?.stdout.text ?? null).toBe(expectedOutput);
      expect(outcome.packages).toBeNull();
    },
  );

  it("indexes discoveries once for all eight failed package projections", () => {
    let targetReads = 0;
    const target = {
      filter: "works",
      kind: "method" as const,
      label: "Run works",
      match: "description" as const,
      position: { column: 1, lineNumber: 1 },
    };
    const failed = response("suite", 1);
    failed.suites[0]!.cases = [
      {
        classname: null,
        file: "a.test.ts",
        line: 1,
        message: "failed",
        name: "suite works",
        status: "failed",
        time: 0,
      },
    ];
    const plan = jsTestFailedRunPlanForBatch({
      discoveries: [
        {
          filePath: "a.test.ts",
          suitePath: ["suite"],
          get target() {
            targetReads += 1;
            if (targetReads > 6) throw new Error("discovery index rebuilt");
            return target;
          },
        },
      ],
      discoveryTruncated: false,
      packages: Array.from({ length: 8 }, (_, index) => ({
        authority: { packageRootRelativePath: `packages/${index}`, runner: "jest" as const },
        output: output(""),
        response: failed,
      })),
      rootPath: "/workspace",
    });

    expect(plan.status).toBe("available");
    expect(plan.scopes).toHaveLength(8);
    expect(targetReads).toBeGreaterThan(0);
    expect(targetReads).toBeLessThanOrEqual(6);
  });
});

function batchResponse(response: OwnerlessBatchResponse): JsTestBatchResponse {
  return {
    ...response,
    owner: { runId: "run", workspaceId: "workspace" },
  } as JsTestBatchResponse;
}

type OwnerlessBatchResponse =
  Exclude<JsTestBatchResponse, { status: "ok" }> extends infer Response
    ? Response extends { readonly owner: unknown }
      ? Omit<Response, "owner">
      : never
    : never;

function output(text: string): JsTestTaskOutput {
  return {
    stderr: { text: "", truncated: false },
    stdout: { text, truncated: false },
  };
}

function response(name: string, tests: number): TestRunOk {
  return {
    status: "ok",
    suites: [
      {
        cases: [],
        errors: 0,
        failures: 0,
        name,
        skipped: 0,
        tests,
        time: tests,
      },
    ],
    totals: {
      errors: 0,
      failures: 0,
      skipped: 0,
      tests,
      time: tests,
    },
  };
}
