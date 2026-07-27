import { describe, expect, it } from "vitest";
import { MAX_JS_TEST_BATCH_PACKAGES } from "../domain/jsTestBatch";
import { immutableJsTestBatchRequest } from "../domain/jsTestBatch";
import contract from "../domain/jsTestBatch.contract.fixtures.json";
import { MAX_JS_TEST_PACKAGE_ROOT_BYTES } from "../domain/jsTestExecutionAuthority";
import { MAX_JS_TEST_OUTPUT_STREAM_BYTES, MAX_JS_TEST_TASK_ID_BYTES } from "../domain/jsTestTask";
import { JS_TEST_RESPONSE_LIMITS, TauriJsTestGateway } from "./tauriJsTestGateway";

describe("JavaScript test batch cross-language contract", () => {
  it("keeps shared limits and exact wire spellings frozen", () => {
    expect({
      commands: {
        run: "run_js_test_batch_json",
        stop: "stop_js_test_batch",
      },
      limits: {
        maxCases: JS_TEST_RESPONSE_LIMITS.maxCases,
        maxOutputStreamBytes: MAX_JS_TEST_OUTPUT_STREAM_BYTES,
        maxOwnerIdBytes: MAX_JS_TEST_TASK_ID_BYTES,
        maxPackageRootBytes: MAX_JS_TEST_PACKAGE_ROOT_BYTES,
        maxPackages: MAX_JS_TEST_BATCH_PACKAGES,
        maxReportBytes: JS_TEST_RESPONSE_LIMITS.maxTextBytes,
        maxSuites: JS_TEST_RESPONSE_LIMITS.maxSuites,
      },
      version: 1,
      wire: {
        authorityKeys: ["packageRootRelativePath", "runner"],
        outcomeKeys: {
          cancelled: ["authorities", "output", "owner", "status"],
          error: ["authorities", "message", "output", "owner", "status"],
          ok: ["owner", "packages", "status", "totals"],
          unavailable: ["authorities", "message", "owner", "status"],
        },
        outputKeys: ["stderr", "stdout"],
        outputStreamKeys: ["text", "truncated"],
        ownerKeys: ["runId", "workspaceId"],
        packagePlanKeys: ["packageRootRelativePath"],
        packageResultKeys: ["authority", "output", "response"],
        requestKeys: ["packages", "runId", "workspaceId"],
        stopRequestKeys: ["runId", "workspaceId"],
        stopResponseKeys: ["runId", "stopped"],
        runners: ["jest", "vitest"],
        statuses: ["cancelled", "error", "ok", "unavailable"],
      },
    }).toEqual(contract);
  });

  it("keeps the package-count boundary executable on the TypeScript side", () => {
    expect(() =>
      immutableJsTestBatchRequest({
        packages: Array.from({ length: contract.limits.maxPackages }, (_, index) => ({
          packageRootRelativePath: `packages/${index}`,
        })),
        runId: "run",
        workspaceId: "workspace",
      }),
    ).not.toThrow();
    expect(() =>
      immutableJsTestBatchRequest({
        packages: Array.from({ length: contract.limits.maxPackages + 1 }, (_, index) => ({
          packageRootRelativePath: `packages/${index}`,
        })),
        runId: "run",
        workspaceId: "workspace",
      }),
    ).toThrow();
  });

  it("keeps response envelopes closed to unknown wire fields", async () => {
    const gateway = new TauriJsTestGateway(async () => ({
      authorities: [],
      message: "unavailable",
      owner: { runId: "run", workspaceId: "workspace" },
      status: "unavailable",
      unknown: true,
    }));

    await expect(
      gateway.runBatch({
        packages: [{ packageRootRelativePath: "packages/a" }],
        runId: "run",
        workspaceId: "workspace",
      }),
    ).rejects.toThrow("Invalid JavaScript test response");
  });
});
