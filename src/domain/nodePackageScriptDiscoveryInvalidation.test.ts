import { describe, expect, it } from "vitest";
import type { WorkspaceFileChangeEvent } from "./workspaceFileChange";
import { workspaceFileChangeInvalidatesNodePackageScriptDiscovery } from "./nodePackageScriptDiscoveryInvalidation";

describe("Node package script discovery invalidation", () => {
  it.each([
    ["created", "package.json", null],
    ["modified", "apps/web/package.json", null],
    ["deleted", "pnpm-lock.yaml", null],
    ["modified", "pnpm-workspace.yaml", null],
    ["modified", "yarn.lock", null],
    ["modified", "bun.lockb", null],
    ["renamed", "README.md", "packages/api/package.json"],
  ] as const)("invalidates %s metadata changes", (kind, relativePath, previousRelativePath) => {
    expect(
      workspaceFileChangeInvalidatesNodePackageScriptDiscovery(
        event({ kind, previousRelativePath, relativePath }),
      ),
    ).toBe(true);
  });

  it.each(["created", "deleted", "renamed"] as const)(
    "invalidates %s directory structure changes",
    (kind) => {
      expect(
        workspaceFileChangeInvalidatesNodePackageScriptDiscovery(
          event({ fileKind: "directory", kind, relativePath: "packages/new" }),
        ),
      ).toBe(true);
    },
  );

  it("invalidates rescans and ignores unrelated files and directory modifications", () => {
    expect(
      workspaceFileChangeInvalidatesNodePackageScriptDiscovery(
        event({ kind: "rescanRequired", relativePath: "" }),
      ),
    ).toBe(true);
    expect(workspaceFileChangeInvalidatesNodePackageScriptDiscovery(event())).toBe(false);
    expect(
      workspaceFileChangeInvalidatesNodePackageScriptDiscovery(
        event({ fileKind: "directory", relativePath: "packages" }),
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
