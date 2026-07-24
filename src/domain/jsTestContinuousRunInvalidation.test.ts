import { describe, expect, it } from "vitest";
import type { WorkspaceFileChangeEvent } from "./workspaceFileChange";
import { workspaceFileChangeTriggersJsTestContinuousRun } from "./jsTestContinuousRunInvalidation";

describe("workspaceFileChangeTriggersJsTestContinuousRun", () => {
  it.each([
    "src/account.ts",
    "src/account.test.tsx",
    "test/setup.mjs",
    "jest.config.ts",
    "vitest.config.mts",
    "vite.config.js",
    "tsconfig.json",
    "jsconfig.test.json",
    "package.json",
    "pnpm-lock.yaml",
    "README.md",
    "src/theme.css",
    "fixtures/account.json",
    "__snapshots__/account.snap",
  ])("accepts every non-ignored file input %s", (relativePath) => {
    expect(workspaceFileChangeTriggersJsTestContinuousRun(change({ relativePath }))).toBe(true);
  });

  it("checks both sides of a rename", () => {
    expect(
      workspaceFileChangeTriggersJsTestContinuousRun(
        change({
          kind: "renamed",
          previousRelativePath: "src/old.test.ts",
          relativePath: "notes.txt",
        }),
      ),
    ).toBe(true);
    expect(
      workspaceFileChangeTriggersJsTestContinuousRun(
        change({
          kind: "renamed",
          previousRelativePath: "notes.txt",
          relativePath: "src/new.test.ts",
        }),
      ),
    ).toBe(true);
  });

  it("accepts structural directory changes and a required rescan", () => {
    for (const kind of ["created", "deleted", "renamed"] as const) {
      expect(
        workspaceFileChangeTriggersJsTestContinuousRun(
          change({ fileKind: "directory", kind, relativePath: "src/features" }),
        ),
      ).toBe(true);
    }
    expect(
      workspaceFileChangeTriggersJsTestContinuousRun(
        change({ fileKind: "directory", kind: "modified", relativePath: "src/features" }),
      ),
    ).toBe(false);
    expect(
      workspaceFileChangeTriggersJsTestContinuousRun(
        change({ kind: "rescanRequired", relativePath: "" }),
      ),
    ).toBe(true);
  });

  it.each([
    "node_modules/pkg/index.js",
    "dist/index.test.js",
    "coverage/report.js",
    ".git/hooks/check.ts",
    "packages/web/.next/server.js",
  ])("rejects irrelevant or generated input %s", (relativePath) => {
    expect(workspaceFileChangeTriggersJsTestContinuousRun(change({ relativePath }))).toBe(false);
  });

  it("rejects structural changes confined to ignored directories", () => {
    expect(
      workspaceFileChangeTriggersJsTestContinuousRun(
        change({
          fileKind: "directory",
          kind: "renamed",
          previousRelativePath: "node_modules/old",
          relativePath: "node_modules/new",
        }),
      ),
    ).toBe(false);
  });
});

function change(overrides: Partial<WorkspaceFileChangeEvent> = {}): WorkspaceFileChangeEvent {
  const relativePath = overrides.relativePath ?? "src/example.ts";
  return {
    fileKind: "file",
    kind: "modified",
    path: `/workspace/${relativePath}`,
    relativePath,
    rootPath: "/workspace",
    ...overrides,
  };
}
