import { describe, expect, it } from "vitest";
import type { WorkspaceFileChangeEvent } from "./workspaceFileChange";
import { workspaceFileChangeInvalidatesJsTestDiscovery } from "./jsTestDiscoveryInvalidation";

describe("JavaScript test discovery invalidation", () => {
  it.each([
    ["created", "src/new.test.ts", null],
    ["modified", "src/live.spec.ts", null],
    ["renamed", "src/renamed.ts", "src/old.test.js"],
    ["deleted", "src/gone.test.tsx", null],
  ] as const)(
    "invalidates for a %s test-file event",
    (kind, relativePath, previousRelativePath) => {
      expect(
        workspaceFileChangeInvalidatesJsTestDiscovery(
          event({ kind, previousRelativePath, relativePath }),
        ),
      ).toBe(true);
    },
  );

  it("invalidates unknown rescans", () => {
    expect(
      workspaceFileChangeInvalidatesJsTestDiscovery(
        event({ kind: "rescanRequired", relativePath: "" }),
      ),
    ).toBe(true);
  });

  it.each(["created", "renamed", "deleted"] as const)(
    "invalidates a %s directory subtree",
    (kind) => {
      expect(
        workspaceFileChangeInvalidatesJsTestDiscovery(
          event({ fileKind: "directory", kind, relativePath: "src/tests" }),
        ),
      ).toBe(true);
    },
  );

  it("ignores non-test files and directory metadata modifications", () => {
    expect(workspaceFileChangeInvalidatesJsTestDiscovery(event())).toBe(false);
    expect(
      workspaceFileChangeInvalidatesJsTestDiscovery(
        event({ fileKind: "directory", relativePath: "src/tests" }),
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
