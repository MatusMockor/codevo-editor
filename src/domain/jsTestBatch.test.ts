import { describe, expect, it } from "vitest";
import {
  immutableJsTestBatchPackages,
  immutableJsTestBatchRequest,
  MAX_JS_TEST_BATCH_PACKAGES,
} from "./jsTestBatch";

describe("immutableJsTestBatchRequest", () => {
  it("freezes a bounded sibling package plan", () => {
    const input = {
      packages: [
        { packageRootRelativePath: "packages/a" },
        { packageRootRelativePath: "packages/b" },
      ],
      runId: "run-1",
      workspaceId: "workspace-1",
    };

    const request = immutableJsTestBatchRequest(input);

    expect(request).toEqual(input);
    expect(request).not.toBe(input);
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.packages)).toBe(true);
    expect(request.packages.every(Object.isFrozen)).toBe(true);
  });

  it.each([
    [[]],
    [
      Array.from({ length: MAX_JS_TEST_BATCH_PACKAGES + 1 }, (_, index) => ({
        packageRootRelativePath: `packages/${index}`,
      })),
    ],
    [[{ packageRootRelativePath: "packages/a" }, { packageRootRelativePath: "packages/a" }]],
    [[{ packageRootRelativePath: "packages/a" }, { packageRootRelativePath: "packages/a/nested" }]],
    [[{ packageRootRelativePath: "" }, { packageRootRelativePath: "packages/a" }]],
  ])("rejects empty, excessive, duplicate, or overlapping roots", (packages) => {
    expect(() =>
      immutableJsTestBatchRequest({
        packages,
        runId: "run-1",
        workspaceId: "workspace-1",
      }),
    ).toThrow();
  });
});

describe("immutableJsTestBatchPackages", () => {
  it("validates and freezes package policy without fabricating an owner", () => {
    const packages = immutableJsTestBatchPackages([
      { packageRootRelativePath: "packages/a" },
      { packageRootRelativePath: "packages/b" },
    ]);

    expect(packages).toEqual([
      { packageRootRelativePath: "packages/a" },
      { packageRootRelativePath: "packages/b" },
    ]);
    expect(Object.isFrozen(packages)).toBe(true);
    expect(packages.every(Object.isFrozen)).toBe(true);
  });
});
