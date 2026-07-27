import {
  validatedJsTestExecutionAuthority,
  type JsTestExecutionAuthority,
} from "./jsTestExecutionAuthority";
import type { JsTestTaskOutput, JsTestTaskOwner } from "./jsTestTask";
import { validatedJsTestTaskRunId, validatedJsTestTaskWorkspaceId } from "./jsTestTask";
import type { TestRunOk, TestTotals } from "./testResults";

export const MAX_JS_TEST_BATCH_PACKAGES = 8;

export type JsTestBatchRunner = "jest" | "vitest";

export type JsTestBatchPackagePlan = JsTestExecutionAuthority;

export interface JsTestBatchRequest extends JsTestTaskOwner {
  readonly packages: readonly JsTestBatchPackagePlan[];
}

export interface JsTestBatchPackageAuthority extends JsTestExecutionAuthority {
  readonly runner: JsTestBatchRunner;
}

export interface JsTestBatchPackageResult {
  readonly authority: JsTestBatchPackageAuthority;
  readonly output: JsTestTaskOutput;
  readonly response: TestRunOk;
}

export type JsTestBatchResponse =
  | {
      readonly owner: JsTestTaskOwner;
      readonly packages: readonly JsTestBatchPackageResult[];
      readonly status: "ok";
      readonly totals: TestTotals;
    }
  | {
      readonly authorities: readonly JsTestBatchPackageAuthority[];
      readonly owner: JsTestTaskOwner;
      readonly output: JsTestTaskOutput;
      readonly status: "cancelled";
    }
  | {
      readonly authorities: readonly JsTestBatchPackageAuthority[];
      readonly message: string;
      readonly owner: JsTestTaskOwner;
      readonly output: JsTestTaskOutput;
      readonly status: "error";
    }
  | {
      readonly authorities: readonly JsTestBatchPackageAuthority[];
      readonly message: string;
      readonly owner: JsTestTaskOwner;
      readonly status: "unavailable";
    };

export interface JsTestBatchGateway {
  runBatch(request: JsTestBatchRequest): Promise<JsTestBatchResponse>;
  stopBatch(owner: JsTestTaskOwner): Promise<boolean>;
}

export function immutableJsTestBatchPackages(
  candidates: readonly JsTestBatchPackagePlan[],
): readonly JsTestBatchPackagePlan[] {
  if (
    !Array.isArray(candidates) ||
    candidates.length === 0 ||
    candidates.length > MAX_JS_TEST_BATCH_PACKAGES
  ) {
    throw new TypeError(
      `JavaScript test batches require 1-${MAX_JS_TEST_BATCH_PACKAGES} package roots.`,
    );
  }
  const paths = new Set<string>();
  const packages = candidates.map((candidate) => {
    const authority = validatedJsTestExecutionAuthority(candidate);
    const path = authority.packageRootRelativePath;
    if (paths.has(path)) {
      throw new TypeError("JavaScript test batch package roots must be unique.");
    }
    for (const previous of paths) {
      if (containsPackageRoot(previous, path) || containsPackageRoot(path, previous)) {
        throw new TypeError(
          "JavaScript test batch package roots must be non-overlapping siblings.",
        );
      }
    }
    paths.add(path);
    return authority;
  });
  return Object.freeze(packages);
}

export function immutableJsTestBatchRequest(request: JsTestBatchRequest): JsTestBatchRequest {
  const runId = validatedJsTestTaskRunId(request.runId);
  const workspaceId = validatedJsTestTaskWorkspaceId(request.workspaceId);
  const packages = immutableJsTestBatchPackages(request.packages);
  return Object.freeze({
    packages,
    runId,
    workspaceId,
  });
}

function containsPackageRoot(parent: string, child: string): boolean {
  return parent === "" ? child !== "" : child.startsWith(`${parent}/`);
}
