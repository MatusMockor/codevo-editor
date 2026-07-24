import { describe, expect, it } from "vitest";
import { workspaceFileChangeInvalidatesExpressRouteDiscovery } from "./expressRouteDiscoveryInvalidation";
import { isJsSourceRelativePath, isJsTestRelativePath } from "./jsTestFilePatterns";
import type { WorkspaceFileChangeEvent } from "./workspaceFileChange";

describe("Express route discovery invalidation", () => {
  it.each(["js", "jsx", "ts", "tsx", "mjs", "cjs", "mts", "cts"])(
    "invalidates a created .%s source file",
    (extension) => {
      expect(
        workspaceFileChangeInvalidatesExpressRouteDiscovery(
          event({ kind: "created", relativePath: `src/routes.${extension}` }),
        ),
      ).toBe(true);
    },
  );

  it.each(["modified", "deleted"] as const)("invalidates a %s source file", (kind) => {
    expect(
      workspaceFileChangeInvalidatesExpressRouteDiscovery(
        event({ kind, relativePath: "src/routes.ts" }),
      ),
    ).toBe(true);
  });

  it("invalidates a rename when either the old or new path is JavaScript source", () => {
    expect(
      workspaceFileChangeInvalidatesExpressRouteDiscovery(
        event({
          kind: "renamed",
          previousRelativePath: "src/routes.ts",
          relativePath: "src/routes.json",
        }),
      ),
    ).toBe(true);
    expect(
      workspaceFileChangeInvalidatesExpressRouteDiscovery(
        event({
          kind: "renamed",
          previousRelativePath: "src/routes.json",
          relativePath: "src/routes.ts",
        }),
      ),
    ).toBe(true);
  });

  it.each(["created", "deleted", "renamed"] as const)(
    "invalidates a %s directory subtree",
    (kind) => {
      expect(
        workspaceFileChangeInvalidatesExpressRouteDiscovery(
          event({ fileKind: "directory", kind, relativePath: "src/routes" }),
        ),
      ).toBe(true);
    },
  );

  it("invalidates a rescan with no known changed path", () => {
    expect(
      workspaceFileChangeInvalidatesExpressRouteDiscovery(
        event({ kind: "rescanRequired", relativePath: "" }),
      ),
    ).toBe(true);
  });

  it("ignores unrelated files, declarations, and directory modifications", () => {
    for (const relativePath of [
      "routes/web.php",
      "package.json",
      "src/routes.d.ts",
      "src/routes.d.mts",
      "src/routes.d.cts",
    ]) {
      expect(workspaceFileChangeInvalidatesExpressRouteDiscovery(event({ relativePath }))).toBe(
        false,
      );
    }
    expect(
      workspaceFileChangeInvalidatesExpressRouteDiscovery(
        event({ fileKind: "directory", kind: "modified", relativePath: "src" }),
      ),
    ).toBe(false);
  });

  it("normalizes Windows separators without changing JS test semantics", () => {
    expect(
      workspaceFileChangeInvalidatesExpressRouteDiscovery(
        event({ relativePath: "src\\routes.tsx" }),
      ),
    ).toBe(true);
    expect(isJsSourceRelativePath("src\\types.d.ts")).toBe(false);
    expect(isJsTestRelativePath("src\\__tests__\\routes.ts")).toBe(true);
    expect(isJsTestRelativePath("src\\routes.ts")).toBe(false);
  });
});

function event(overrides: Partial<WorkspaceFileChangeEvent> = {}): WorkspaceFileChangeEvent {
  return {
    kind: "modified",
    path: "/workspace/src/app.php",
    relativePath: "src/app.php",
    rootPath: "/workspace",
    ...overrides,
  };
}
