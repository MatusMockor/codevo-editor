import {
  createJsTestFailedRunResolver,
  MAX_JS_TEST_FAILED_RUN_SCOPES,
  type JsTestFailedRunPlan,
} from "../domain/jsTestFailedRunScopes";
import type { JsTestExplorerTestDiscovery } from "../domain/jsTestExplorerTree";
import type {
  JsTestBatchGateway,
  JsTestBatchPackagePlan,
  JsTestBatchPackageResult,
} from "../domain/jsTestBatch";
import { aggregateJsTestTaskOutputs } from "../domain/jsTestOutput";
import type { JsTestTaskOutput } from "../domain/jsTestTask";
import type { TestRunOk, TestRunResponse } from "../domain/testResults";
import { createJsTestBatchCoordinator } from "./jsTestBatchCoordinator";
import type { JsTestExecutionRootResolver } from "./jsTestExecutionRootResolver";
import { jsTestMonorepoPlan } from "./jsTestMonorepoPlan";

export type JsTestExplorerBatchCoordinator = ReturnType<typeof createJsTestBatchCoordinator>;

export type JsTestExplorerBatchPlanOutcome =
  | { readonly packages: readonly JsTestBatchPackagePlan[]; readonly status: "available" }
  | { readonly message: string; readonly status: "error" }
  | { readonly status: "stale" };

export type JsTestExplorerBatchRunOutcome =
  | { readonly message: string; readonly status: "error" }
  | { readonly status: "stale" }
  | {
      readonly output: JsTestTaskOutput | null;
      readonly packages: readonly JsTestBatchPackageResult[] | null;
      readonly response: TestRunResponse;
      readonly status: "settled";
    };

export async function planJsTestExplorerBatch(options: {
  readonly discoveries: readonly JsTestExplorerTestDiscovery[];
  readonly discoveryTruncated: boolean;
  readonly filePaths: readonly string[];
  readonly isCurrent: () => boolean;
  readonly resolveExecutionRoot: JsTestExecutionRootResolver;
}): Promise<JsTestExplorerBatchPlanOutcome> {
  const plan = await jsTestMonorepoPlan(options);
  if (plan.status === "available") return plan;
  if (plan.reason === "stale") return Object.freeze({ status: "stale" as const });
  return Object.freeze({
    message:
      plan.reason === "package-overflow"
        ? "JavaScript test Run All supports at most 8 non-overlapping packages."
        : "JavaScript test Run All requires complete, stable package discovery.",
    status: "error" as const,
  });
}

/** Exact-owner application service for one already validated immutable Run All package plan. */
export async function runJsTestExplorerBatch(options: {
  readonly activation: number;
  readonly createRunId: () => string;
  readonly gateway: JsTestBatchGateway;
  readonly isCurrent: (activation: number, workspaceId: string) => boolean;
  readonly onCoordinator: (coordinator: JsTestExplorerBatchCoordinator | null) => void;
  readonly packages: readonly JsTestBatchPackagePlan[];
  readonly workspaceId: string;
}): Promise<JsTestExplorerBatchRunOutcome> {
  const coordinator = createJsTestBatchCoordinator({
    createRunId: options.createRunId,
    gateway: options.gateway,
    isCurrent: options.isCurrent,
  });
  options.onCoordinator(coordinator);
  try {
    const outcome = await coordinator.start({
      activation: options.activation,
      packages: options.packages,
      workspaceId: options.workspaceId,
    });
    if (outcome.status === "error") {
      return Object.freeze({ message: outcome.message, status: "error" as const });
    }
    if (outcome.status !== "settled") return Object.freeze({ status: "stale" as const });
    switch (outcome.response.status) {
      case "ok": {
        const packages = outcome.response.packages;
        const response = aggregateJsTestRunResults(
          packages.map(({ response: packageResponse }) => packageResponse),
        );
        return Object.freeze({
          output: aggregateJsTestTaskOutputs(packages.map(({ output }) => output)),
          packages: response ? packages : null,
          response:
            response ??
            Object.freeze({
              message: "JavaScript test batch results exceeded the safety limit.",
              status: "error" as const,
            }),
          status: "settled" as const,
        });
      }
      case "cancelled":
        return settledBatchFailure(
          "JavaScript test run was cancelled.",
          "error",
          outcome.response.output,
        );
      case "error":
        return settledBatchFailure(outcome.response.message, "error", outcome.response.output);
      case "unavailable":
        return settledBatchFailure(outcome.response.message, "unavailable", null);
      default:
        return assertNever(outcome.response);
    }
  } finally {
    options.onCoordinator(null);
  }
}

function settledBatchFailure(
  message: string,
  status: "error" | "unavailable",
  output: JsTestTaskOutput | null,
): JsTestExplorerBatchRunOutcome {
  return Object.freeze({
    output,
    packages: null,
    response: Object.freeze({ message, status }),
    status: "settled" as const,
  });
}

function assertNever(value: never): never {
  throw new Error(`Unhandled JavaScript test batch response: ${String(value)}`);
}

export function aggregateJsTestRunResults(responses: readonly TestRunOk[]): TestRunOk | null {
  const suites: TestRunOk["suites"] = [];
  let cases = 0;
  for (const response of responses) {
    if (suites.length + response.suites.length > 5_000) return null;
    for (const suite of response.suites) {
      cases += suite.cases.length;
      if (!Number.isSafeInteger(cases) || cases > 5_000) return null;
      suites.push(suite);
    }
  }
  const totals = responses.reduce(
    (sum, response) => ({
      errors: sum.errors + response.totals.errors,
      failures: sum.failures + response.totals.failures,
      skipped: sum.skipped + response.totals.skipped,
      tests: sum.tests + response.totals.tests,
      time:
        sum.time === null || response.totals.time === null ? null : sum.time + response.totals.time,
    }),
    { errors: 0, failures: 0, skipped: 0, tests: 0, time: 0 as number | null },
  );
  if (
    !Number.isSafeInteger(totals.errors) ||
    !Number.isSafeInteger(totals.failures) ||
    !Number.isSafeInteger(totals.skipped) ||
    !Number.isSafeInteger(totals.tests) ||
    (totals.time !== null && (!Number.isFinite(totals.time) || totals.time < 0))
  ) {
    return null;
  }
  return Object.freeze({
    status: "ok",
    suites: Object.freeze([...suites]) as TestRunOk["suites"],
    totals: Object.freeze(totals),
  });
}

export function jsTestFailedRunPlanForBatch(options: {
  readonly discoveries: readonly JsTestExplorerTestDiscovery[];
  readonly discoveryTruncated: boolean;
  readonly packages: readonly JsTestBatchPackageResult[];
  readonly rootPath: string;
}): JsTestFailedRunPlan {
  const indexed = createJsTestFailedRunResolver({
    discoveries: options.discoveries,
    discoveryTruncated: options.discoveryTruncated,
    rootPath: options.rootPath,
  });
  if (indexed.status !== "available") return indexed;
  const scopes: Extract<JsTestFailedRunPlan, { readonly status: "available" }>["scopes"][number][] =
    [];
  for (const packageResult of options.packages) {
    const plan = indexed.resolver.resolve(packageResult.response);
    if (plan.status !== "available") return plan;
    for (const scope of plan.scopes) {
      scopes.push(
        Object.freeze({
          ...scope,
          packageRootRelativePath: packageResult.authority.packageRootRelativePath,
        }),
      );
      if (scopes.length > MAX_JS_TEST_FAILED_RUN_SCOPES) {
        return Object.freeze({
          scopes: Object.freeze([] as const),
          status: "overflow" as const,
          unresolved: 0,
        });
      }
    }
  }
  return Object.freeze({
    scopes: Object.freeze(scopes),
    status: "available" as const,
    unresolved: 0 as const,
  });
}
