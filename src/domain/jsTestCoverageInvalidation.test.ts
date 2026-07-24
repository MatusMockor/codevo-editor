import { describe, expect, it } from "vitest";
import { workspaceFileChangeInvalidatesJsTestCoverage } from "./jsTestCoverageInvalidation";
import type { WorkspaceFileChangeEvent } from "./workspaceFileChange";

describe("JavaScript test coverage invalidation", () => {
  it.each(["js", "jsx", "ts", "tsx", "mjs", "cjs", "mts", "cts"])(
    "invalidates a changed .%s coverage source",
    (extension) => {
      expect(
        workspaceFileChangeInvalidatesJsTestCoverage(
          event({ relativePath: `src/module.${extension}` }),
        ),
      ).toBe(true);
    },
  );

  it.each(["created", "modified", "deleted"] as const)("invalidates a %s source file", (kind) => {
    expect(
      workspaceFileChangeInvalidatesJsTestCoverage(event({ kind, relativePath: "src/module.ts" })),
    ).toBe(true);
  });

  it.each([
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lock",
    "bun.lockb",
    "vitest.config.ts",
    "vite.config.mts",
    "jest.config.json",
    "tsconfig.json",
    "tsconfig.coverage.json",
    "jsconfig.json",
  ])("invalidates coverage input %s", (relativePath) => {
    expect(workspaceFileChangeInvalidatesJsTestCoverage(event({ relativePath }))).toBe(true);
  });

  it("invalidates when a relevant file is renamed to an unsupported path", () => {
    expect(
      workspaceFileChangeInvalidatesJsTestCoverage(
        event({
          kind: "renamed",
          previousRelativePath: "src/old.ts",
          relativePath: "archive/old.txt",
        }),
      ),
    ).toBe(true);
  });

  it("invalidates unknown rescans and structural directory changes", () => {
    expect(
      workspaceFileChangeInvalidatesJsTestCoverage(
        event({ kind: "rescanRequired", relativePath: "" }),
      ),
    ).toBe(true);

    for (const kind of ["created", "deleted", "renamed"] as const) {
      expect(
        workspaceFileChangeInvalidatesJsTestCoverage(
          event({ fileKind: "directory", kind, relativePath: "packages/app" }),
        ),
      ).toBe(true);
    }
  });

  it("ignores unrelated files and directory metadata modifications", () => {
    expect(workspaceFileChangeInvalidatesJsTestCoverage(event({ relativePath: "README.md" }))).toBe(
      false,
    );
    expect(
      workspaceFileChangeInvalidatesJsTestCoverage(
        event({ fileKind: "directory", relativePath: "src" }),
      ),
    ).toBe(false);
  });
});

function event(overrides: Partial<WorkspaceFileChangeEvent> = {}): WorkspaceFileChangeEvent {
  return {
    kind: "modified",
    path: "/workspace/src/app.ts",
    relativePath: "src/app.ts",
    rootPath: "/workspace",
    ...overrides,
  };
}
