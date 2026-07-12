import { describe, expect, it } from "vitest";
import {
  terminalDirectoryForEntry,
  workspaceRelativePath,
} from "./pathDerivation";

describe("workspaceRelativePath", () => {
  it.each([
    ["/workspace", "/workspace/src/User.php", "src/User.php"],
    ["/workspace", "/workspace/User.php", "User.php"],
    ["/", "/User.php", "User.php"],
    ["C:\\workspace", "C:\\workspace\\src\\User.php", "src/User.php"],
  ])("derives a POSIX path from %s and %s", (rootPath, path, expected) => {
    expect(workspaceRelativePath(rootPath, path)).toBe(expected);
  });

  it("rejects sibling-prefix and stale-root paths", () => {
    expect(workspaceRelativePath("/workspace", "/workspace-other/a.ts")).toBeNull();
    expect(workspaceRelativePath("/new-root", "/old-root/a.ts")).toBeNull();
    expect(workspaceRelativePath("/workspace", "/workspace/../secret.ts")).toBeNull();
  });
});

describe("terminalDirectoryForEntry", () => {
  it("uses a directory itself and a file's parent", () => {
    expect(
      terminalDirectoryForEntry("/workspace", {
        kind: "directory",
        name: "src",
        path: "/workspace/src",
      }),
    ).toBe("/workspace/src");
    expect(
      terminalDirectoryForEntry("/workspace", {
        kind: "file",
        name: "User.php",
        path: "/workspace/src/User.php",
      }),
    ).toBe("/workspace/src");
  });
});
