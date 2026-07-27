import { describe, expect, it, vi } from "vitest";
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

  it("shares exact file receipts only within one explicit planning generation", async () => {
    const readFile = vi.fn(
      reader({
        [`${ROOT}/package.json`]: JSON.stringify({ devDependencies: { vitest: "1" } }),
        [`${ROOT}/node_modules/.bin/vitest`]: "binary",
      }),
    );
    const resolver = createJsTestExecutionRootResolver(ROOT, readFile);
    const generation = resolver.forGeneration?.();
    expect(generation).toBeTypeOf("function");

    await generation?.({ kind: "file", relativeFilePath: "src/a/a.test.ts" });
    await generation?.({ kind: "file", relativeFilePath: "src/b/b.test.ts" });

    expect(readFile.mock.calls.filter(([path]) => path === `${ROOT}/package.json`)).toHaveLength(1);
    await resolver({ kind: "file", relativeFilePath: "src/c/c.test.ts" });
    expect(readFile.mock.calls.filter(([path]) => path === `${ROOT}/package.json`)).toHaveLength(3);
  });
});

function reader(files: Record<string, string>): WorkspaceFileReader {
  return async (path) => files[path] ?? null;
}
