import { describe, expect, it } from "vitest";
import {
  canonicalPhpCoverageRelativePath,
  canonicalPhpCoverageRootPath,
  joinPhpCoveragePath,
  phpCoverageRelativePath,
  phpCoverageRelativePathsEqual,
} from "./phpCoveragePath";

describe("PHP coverage paths", () => {
  it("canonicalizes exact POSIX, filesystem-root, and Windows descendants", () => {
    expect(canonicalPhpCoverageRootPath("/workspace/")).toBe("/workspace");
    expect(canonicalPhpCoverageRootPath("C:\\workspace\\")).toBe("C:/workspace");
    expect(phpCoverageRelativePath("/", "/src/App.php")).toBe("src/App.php");
    expect(phpCoverageRelativePath("C:\\workspace", "C:\\workspace\\src\\App.php")).toBe(
      "src/App.php",
    );
    expect(joinPhpCoveragePath("/", "src/App.php")).toBe("/src/App.php");
  });

  it("uses conservative Windows and UNC case aliases without weakening POSIX identity", () => {
    expect(phpCoverageRelativePath("C:\\Workspace", "c:\\workspace\\SRC\\App.php")).toBe(
      "SRC/App.php",
    );
    expect(
      phpCoverageRelativePath(
        "\\\\SERVER\\Share\\Workspace",
        "\\\\server\\share\\workspace\\src\\App.php",
      ),
    ).toBe("src/App.php");
    expect(phpCoverageRelativePathsEqual("C:/Workspace", "src/App.php", "SRC/app.PHP")).toBe(true);
    expect(phpCoverageRelativePathsEqual("/Workspace", "src/App.php", "SRC/app.PHP")).toBe(false);
    expect(canonicalPhpCoverageRootPath("file:///workspace/")).toBe("/workspace");
  });

  it.each([
    ["relative root", "workspace", "/workspace/A.php"],
    ["root traversal", "/workspace/..", "/workspace/A.php"],
    ["same path", "/workspace", "/workspace"],
    ["prefix collision", "/workspace", "/workspace-other/A.php"],
    ["candidate traversal", "/workspace", "/workspace/src/../A.php"],
    ["candidate dot", "/workspace", "/workspace/./A.php"],
    ["candidate empty segment", "/workspace", "/workspace/src//A.php"],
    ["relative candidate", "/workspace", "src/A.php"],
    ["control", "/workspace", "/workspace/src/A\0.php"],
  ])("rejects %s", (_case, root, path) => {
    expect(phpCoverageRelativePath(root, path)).toBeNull();
  });

  it.each(["", "/absolute.php", "C:/absolute.php", "src/../A.php", "src//A.php", "./A.php"])(
    "rejects unsafe relative path %s",
    (path) => expect(canonicalPhpCoverageRelativePath(path)).toBeNull(),
  );

  it("rejects malformed Unicode in roots, absolute files, and relative reports", () => {
    expect(canonicalPhpCoverageRootPath("/workspace/\ud800")).toBeNull();
    expect(phpCoverageRelativePath("/workspace", "/workspace/\ud800.php")).toBeNull();
    expect(canonicalPhpCoverageRelativePath("src/\ud800.php")).toBeNull();
  });

  it.each([
    "file:///workspace/../secret",
    "file:///workspace/%2e%2e/secret",
    "file:///workspace//secret",
  ])("rejects ambiguous file URI %s", (path) => {
    expect(canonicalPhpCoverageRootPath(path)).toBeNull();
  });
});
