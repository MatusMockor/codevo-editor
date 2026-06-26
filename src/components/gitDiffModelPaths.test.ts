import { describe, expect, it } from "vitest";
import type { GitFileDiff } from "../domain/git";
import {
  gitDiffModifiedModelPath,
  gitDiffOriginalModelPath,
} from "./gitDiffModelPaths";

function diff(overrides: Partial<GitFileDiff> = {}): GitFileDiff {
  return {
    change: {
      isStaged: false,
      isUnversioned: false,
      oldPath: null,
      oldRelativePath: null,
      path: "/workspace/README.md",
      relativePath: "README.md",
      status: "modified",
      ...overrides.change,
    },
    language: "markdown",
    modifiedContent: "# Project\n\nchanged\n",
    originalContent: "# Project\n",
    ...overrides,
  };
}

describe("gitDiffModelPaths", () => {
  it("derives distinct original and modified model paths so the two diff editors never share one Uri", () => {
    const current = diff();

    expect(gitDiffOriginalModelPath(current)).not.toEqual(
      gitDiffModifiedModelPath(current),
    );
  });

  it("produces stable, non-empty paths for a given change", () => {
    const current = diff();

    expect(gitDiffOriginalModelPath(current)).not.toBe("");
    expect(gitDiffModifiedModelPath(current)).not.toBe("");
    // Same change -> same paths (so re-renders reuse the same model).
    expect(gitDiffOriginalModelPath(current)).toBe(
      gitDiffOriginalModelPath(diff()),
    );
  });

  it("derives different paths for different files so switching files never reuses a stale model", () => {
    const readme = diff();
    const php = diff({
      change: {
        isStaged: false,
        isUnversioned: false,
        oldPath: null,
        oldRelativePath: null,
        path: "/workspace/app/User.php",
        relativePath: "app/User.php",
        status: "modified",
      },
      language: "php",
    });

    expect(gitDiffModifiedModelPath(readme)).not.toEqual(
      gitDiffModifiedModelPath(php),
    );
    expect(gitDiffOriginalModelPath(readme)).not.toEqual(
      gitDiffOriginalModelPath(php),
    );
  });

  it("distinguishes the staged and worktree sides of the same file", () => {
    const worktree = diff();
    const staged = diff({
      change: {
        isStaged: true,
        isUnversioned: false,
        oldPath: null,
        oldRelativePath: null,
        path: "/workspace/README.md",
        relativePath: "README.md",
        status: "modified",
      },
    });

    expect(gitDiffModifiedModelPath(worktree)).not.toEqual(
      gitDiffModifiedModelPath(staged),
    );
  });

  it("isolates the same relative path across different project tabs via the absolute path", () => {
    const projectA = diff({
      change: {
        isStaged: false,
        isUnversioned: false,
        oldPath: null,
        oldRelativePath: null,
        path: "/workspace/project-a/README.md",
        relativePath: "README.md",
        status: "modified",
      },
    });
    const projectB = diff({
      change: {
        isStaged: false,
        isUnversioned: false,
        oldPath: null,
        oldRelativePath: null,
        path: "/workspace/project-b/README.md",
        relativePath: "README.md",
        status: "modified",
      },
    });

    // Monaco's model registry is process-wide; the same relative path in two
    // open project tabs must not resolve to the same model Uri.
    expect(gitDiffModifiedModelPath(projectA)).not.toEqual(
      gitDiffModifiedModelPath(projectB),
    );
    expect(gitDiffOriginalModelPath(projectA)).not.toEqual(
      gitDiffOriginalModelPath(projectB),
    );
  });

  it("produces a path safe from Uri-reshaping special characters", () => {
    const nested = diff({
      change: {
        isStaged: false,
        isUnversioned: false,
        oldPath: null,
        oldRelativePath: null,
        path: "/workspace/docs/README v2.md",
        relativePath: "docs/README v2.md",
        status: "modified",
      },
    });

    // Encoded, so spaces and separators in the file path cannot reshape the Uri.
    expect(gitDiffModifiedModelPath(nested)).not.toContain(" ");
    expect(gitDiffModifiedModelPath(nested)).toContain("%");
  });
});
