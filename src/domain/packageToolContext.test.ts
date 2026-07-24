import { describe, expect, it } from "vitest";
import { MAX_PACKAGE_TOOL_SEARCH_CONTEXTS, packageToolSearchContexts } from "./packageToolContext";

describe("packageToolSearchContexts", () => {
  it("walks a nested package toward the workspace root without visiting siblings", () => {
    expect(
      packageToolSearchContexts("/workspace", "/workspace/packages/a/nested/src/example.test.ts"),
    ).toEqual([
      { rootPath: "/workspace/packages/a/nested/src", targetRelativePath: "example.test.ts" },
      { rootPath: "/workspace/packages/a/nested", targetRelativePath: "src/example.test.ts" },
      { rootPath: "/workspace/packages/a", targetRelativePath: "nested/src/example.test.ts" },
      { rootPath: "/workspace/packages", targetRelativePath: "a/nested/src/example.test.ts" },
      { rootPath: "/workspace", targetRelativePath: "packages/a/nested/src/example.test.ts" },
    ]);
  });

  it("falls back to the current root for an escaped or stale target", () => {
    expect(packageToolSearchContexts("/workspace", "/old-root/src/test.ts")).toEqual([
      { rootPath: "/workspace", targetRelativePath: "" },
    ]);
    expect(packageToolSearchContexts("/workspace", "../outside/test.ts")).toEqual([
      { rootPath: "/workspace", targetRelativePath: "" },
    ]);
  });

  it("caps deep ancestor searches while always retaining the workspace root", () => {
    const target = `/workspace/${Array.from({ length: 1_000 }, (_, index) => `d${index}`).join("/")}/test.ts`;
    const contexts = packageToolSearchContexts("/workspace", target);
    expect(contexts).toHaveLength(MAX_PACKAGE_TOOL_SEARCH_CONTEXTS);
    expect(contexts[contexts.length - 1]).toEqual({
      rootPath: "/workspace",
      targetRelativePath: target.slice("/workspace/".length),
    });
  });
});
