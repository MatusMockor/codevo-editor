import { describe, expect, it } from "vitest";
import type { WorkspaceFileReader } from "./jsTestRunnerDetection";
import { createJsTestExecutionRootResolver } from "./jsTestExecutionRootResolver";

const ROOT = "/workspace";

describe("createJsTestExecutionRootResolver", () => {
  it("selects the nearest nested runner root for a selected test", async () => {
    const resolver = createJsTestExecutionRootResolver(
      ROOT,
      reader({
        [`${ROOT}/package.json`]: JSON.stringify({ devDependencies: { jest: "1" } }),
        [`${ROOT}/node_modules/.bin/jest`]: "binary",
        [`${ROOT}/packages/web/package.json`]: JSON.stringify({
          devDependencies: { vitest: "1" },
        }),
        [`${ROOT}/packages/web/node_modules/.bin/vitest`]: "binary",
      }),
    );

    await expect(
      resolver({
        kind: "test",
        relativeFilePath: "packages/web/src/app.test.ts",
        fullName: "app works",
      }),
    ).resolves.toEqual({ packageRootRelativePath: "packages/web" });
  });

  it("uses workspace scope for all-tests and fails closed to it when no runner is detected", async () => {
    const resolver = createJsTestExecutionRootResolver(ROOT, reader({}));
    await expect(resolver({ kind: "all" })).resolves.toEqual({
      packageRootRelativePath: "",
    });
  });
});

function reader(files: Record<string, string>): WorkspaceFileReader {
  return async (path) => files[path] ?? null;
}
