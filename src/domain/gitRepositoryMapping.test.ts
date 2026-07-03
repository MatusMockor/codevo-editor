import { describe, expect, it } from "vitest";
import {
  gitDirectoryMappingPaths,
  gitMappingCandidatesFromDirectoryListing,
  normalizeGitDirectoryMappings,
  resolveGitRepositoryForPath,
  type GitRepositoryMapping,
} from "./gitRepositoryMapping";

function mapping(rootRelativePath: string): GitRepositoryMapping {
  return { rootRelativePath };
}

describe("normalizeGitDirectoryMappings", () => {
  it("dedupes and sorts shallow-first, then lexicographically", () => {
    expect(
      normalizeGitDirectoryMappings([
        "workbench/lcsk/x",
        "",
        "workbench/lcsk/x",
        "workbench/lcsk/attendance",
      ]),
    ).toEqual([
      mapping(""),
      mapping("workbench/lcsk/attendance"),
      mapping("workbench/lcsk/x"),
    ]);
  });

  it("normalizes Windows separators", () => {
    expect(
      normalizeGitDirectoryMappings(["workbench\\lcsk\\attendance"]),
    ).toEqual([mapping("workbench/lcsk/attendance")]);
  });

  it("strips ./ prefixes, trailing slashes, empty segments and whitespace", () => {
    expect(
      normalizeGitDirectoryMappings([
        "./workbench/lcsk/",
        "  workbench//x  ",
      ]),
    ).toEqual([mapping("workbench/lcsk"), mapping("workbench/x")]);
  });

  it("allows the empty root mapping (main repository)", () => {
    expect(normalizeGitDirectoryMappings([""])).toEqual([mapping("")]);
  });

  it("rejects absolute paths", () => {
    expect(
      normalizeGitDirectoryMappings(["/etc/passwd", "C:\\Windows"]),
    ).toEqual([]);
  });

  it("rejects parent-directory escapes", () => {
    expect(
      normalizeGitDirectoryMappings(["../outside", "a/../../b", ".."]),
    ).toEqual([]);
  });

  it("accepts the object form and normalizes it", () => {
    expect(
      normalizeGitDirectoryMappings([{ rootRelativePath: "workbench\\x" }]),
    ).toEqual([mapping("workbench/x")]);
  });

  it("ignores non-string junk entries", () => {
    expect(
      normalizeGitDirectoryMappings([123, null, {}, "workbench/x"]),
    ).toEqual([mapping("workbench/x")]);
  });

  it("returns an empty list for non-array input", () => {
    expect(normalizeGitDirectoryMappings(undefined)).toEqual([]);
    expect(normalizeGitDirectoryMappings(null)).toEqual([]);
    expect(normalizeGitDirectoryMappings("nope")).toEqual([]);
  });

  it("dedupes case-variant duplicates case-insensitively, keeping the first occurrence's casing", () => {
    expect(
      normalizeGitDirectoryMappings(["Workbench/x", "workbench/x"]),
    ).toEqual([mapping("Workbench/x")]);

    expect(
      normalizeGitDirectoryMappings(["workbench/x", "Workbench/X"]),
    ).toEqual([mapping("workbench/x")]);
  });
});

describe("gitDirectoryMappingPaths", () => {
  it("extracts the relative-path strings", () => {
    expect(
      gitDirectoryMappingPaths([mapping(""), mapping("workbench/x")]),
    ).toEqual(["", "workbench/x"]);
  });
});

describe("resolveGitRepositoryForPath", () => {
  const workspaceRoot = "/Users/x/attendancer";
  const mappings = normalizeGitDirectoryMappings([
    "",
    "workbench/lcsk/attendance",
    "workbench/lcsk/billing",
  ]);

  it("routes a nested file to the deepest owning repository", () => {
    expect(
      resolveGitRepositoryForPath(
        mappings,
        workspaceRoot,
        "/Users/x/attendancer/workbench/lcsk/attendance/src/Service.php",
      ),
    ).toEqual({
      mapping: mapping("workbench/lcsk/attendance"),
      repositoryRoot: "/Users/x/attendancer/workbench/lcsk/attendance",
      repositoryRelativePath: "src/Service.php",
    });
  });

  it("routes a main-repo file to the root mapping", () => {
    expect(
      resolveGitRepositoryForPath(
        mappings,
        workspaceRoot,
        "/Users/x/attendancer/app/Models/User.php",
      ),
    ).toEqual({
      mapping: mapping(""),
      repositoryRoot: "/Users/x/attendancer",
      repositoryRelativePath: "app/Models/User.php",
    });
  });

  it("routes a file sitting directly in a nested repo root", () => {
    expect(
      resolveGitRepositoryForPath(
        mappings,
        workspaceRoot,
        "/Users/x/attendancer/workbench/lcsk/billing/composer.json",
      ),
    ).toEqual({
      mapping: mapping("workbench/lcsk/billing"),
      repositoryRoot: "/Users/x/attendancer/workbench/lcsk/billing",
      repositoryRelativePath: "composer.json",
    });
  });

  it("matches only on segment boundaries (no false prefix match)", () => {
    const siblings = normalizeGitDirectoryMappings(["pkg", "pkg-extra"]);

    expect(
      resolveGitRepositoryForPath(
        siblings,
        "/root",
        "/root/pkg-extra/a.php",
      ),
    ).toEqual({
      mapping: mapping("pkg-extra"),
      repositoryRoot: "/root/pkg-extra",
      repositoryRelativePath: "a.php",
    });
  });

  it("returns null for a file outside the workspace", () => {
    expect(
      resolveGitRepositoryForPath(
        mappings,
        workspaceRoot,
        "/Users/x/other/file.php",
      ),
    ).toBeNull();
  });

  it("returns null when no mapping (and no root mapping) owns the file", () => {
    const nestedOnly = normalizeGitDirectoryMappings([
      "workbench/lcsk/attendance",
    ]);

    expect(
      resolveGitRepositoryForPath(
        nestedOnly,
        workspaceRoot,
        "/Users/x/attendancer/app/Models/User.php",
      ),
    ).toBeNull();
  });

  it("normalizes Windows separators and trailing slashes in inputs", () => {
    expect(
      resolveGitRepositoryForPath(
        normalizeGitDirectoryMappings(["", "pkg"]),
        "C:\\repo\\",
        "C:\\repo\\pkg\\src\\A.php",
      ),
    ).toEqual({
      mapping: mapping("pkg"),
      repositoryRoot: "C:/repo/pkg",
      repositoryRelativePath: "src/A.php",
    });
  });

  it("honours the realpath contract for composer path symlinks", () => {
    // Composer `path` repositories with symlink:true point
    // vendor/lcsk/attendance -> workbench/lcsk/attendance. The pure resolver
    // cannot realpath; the integration MUST resolve the symlink first and feed
    // the canonical workbench path. Given that canonical path, the file belongs
    // to the workbench repo, not the main repo.
    expect(
      resolveGitRepositoryForPath(
        mappings,
        workspaceRoot,
        "/Users/x/attendancer/workbench/lcsk/attendance/src/Symlinked.php",
      ),
    ).toEqual({
      mapping: mapping("workbench/lcsk/attendance"),
      repositoryRoot: "/Users/x/attendancer/workbench/lcsk/attendance",
      repositoryRelativePath: "src/Symlinked.php",
    });
  });

  it("collapses doubled slashes in the file path before matching", () => {
    expect(
      resolveGitRepositoryForPath(
        mappings,
        workspaceRoot,
        "/Users/x/attendancer//workbench/lcsk/attendance/src/Service.php",
      ),
    ).toEqual({
      mapping: mapping("workbench/lcsk/attendance"),
      repositoryRoot: "/Users/x/attendancer/workbench/lcsk/attendance",
      repositoryRelativePath: "src/Service.php",
    });
  });

  it("returns null (not a wrong repository) when a .. climbs above the workspace root", () => {
    expect(
      resolveGitRepositoryForPath(
        mappings,
        workspaceRoot,
        "/Users/x/attendancer/../../../etc/passwd",
      ),
    ).toBeNull();
  });

  it("collapses a mid-path .. that stays inside the workspace and resolves normally", () => {
    expect(
      resolveGitRepositoryForPath(
        mappings,
        workspaceRoot,
        "/Users/x/attendancer/workbench/lcsk/attendance/sub/../src/Service.php",
      ),
    ).toEqual({
      mapping: mapping("workbench/lcsk/attendance"),
      repositoryRoot: "/Users/x/attendancer/workbench/lcsk/attendance",
      repositoryRelativePath: "src/Service.php",
    });
  });

  it("collapses a .. traversal that escapes a nested repo back into the main repo, rather than mis-routing to the nested repo", () => {
    expect(
      resolveGitRepositoryForPath(
        mappings,
        workspaceRoot,
        "/Users/x/attendancer/workbench/lcsk/attendance/../../../app/User.php",
      ),
    ).toEqual({
      mapping: mapping(""),
      repositoryRoot: workspaceRoot,
      repositoryRelativePath: "app/User.php",
    });
  });

  it("returns null (not a silent root fallback) when the file's case differs from the mapping's recorded case", () => {
    // On a case-insensitive-preserving filesystem (macOS APFS default,
    // Windows) a file can be opened through a path whose case differs from
    // the mapping's recorded case. Case-sensitive matching alone would
    // silently fall through to the shallower root mapping here, committing
    // an attendance-repo file into the main repo. Fail safe instead: null.
    expect(
      resolveGitRepositoryForPath(
        mappings,
        workspaceRoot,
        "/Users/x/attendancer/workbench/lcsk/Attendance/src/Service.php",
      ),
    ).toBeNull();
  });
});

describe("gitMappingCandidatesFromDirectoryListing", () => {
  it("builds sorted mappings from directories that contain .git", () => {
    expect(
      gitMappingCandidatesFromDirectoryListing([
        "workbench/lcsk/x",
        "",
        "workbench/lcsk/attendance",
      ]),
    ).toEqual([
      mapping(""),
      mapping("workbench/lcsk/attendance"),
      mapping("workbench/lcsk/x"),
    ]);
  });

  it("accepts entries that point at the .git directory itself", () => {
    expect(
      gitMappingCandidatesFromDirectoryListing([
        ".git",
        "workbench/lcsk/x/.git",
      ]),
    ).toEqual([mapping(""), mapping("workbench/lcsk/x")]);
  });

  it("rejects scanned entries that escape the workspace", () => {
    expect(
      gitMappingCandidatesFromDirectoryListing(["../evil/.git"]),
    ).toEqual([]);
  });
});
