import { describe, expect, it } from "vitest";
import {
  aggregateGitChanges,
  fanOutGitRepositoryStatuses,
  gitDirectoryMappingPaths,
  gitMappingCandidatesFromDirectoryListing,
  groupGitChangesByRepository,
  mergeGitRepositoryStatuses,
  normalizeGitDirectoryMappings,
  primaryGitStatus,
  repositoryRootForMapping,
  resolveEffectiveGitRepositoryMappings,
  resolveGitRepositoryForPath,
  WORKSPACE_ROOT_MAPPING,
  type GitRepositoryMapping,
  type GitRepositoryStatus,
} from "./gitRepositoryMapping";
import { emptyGitStatus, type GitChangedFile, type GitStatus } from "./git";

function mapping(rootRelativePath: string): GitRepositoryMapping {
  return { rootRelativePath };
}

const ROOT = "/workspace";

function changedFile(
  absolutePath: string,
  relativePath: string,
): GitChangedFile {
  return {
    isStaged: false,
    isUnversioned: false,
    oldPath: null,
    oldRelativePath: null,
    path: absolutePath,
    relativePath,
    status: "modified",
  };
}

function statusWith(
  rootPath: string,
  changes: GitChangedFile[] = [],
): GitStatus {
  return { branch: "main", changes, isRepository: true, rootPath };
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

describe("resolveEffectiveGitRepositoryMappings", () => {
  it("merges auto-detected repositories with the manual settings mappings", () => {
    expect(
      resolveEffectiveGitRepositoryMappings({
        manualMappings: ["workbench/lcsk/manual"],
        detectedDirectories: ["", "workbench/lcsk/attendance"],
        auto: true,
      }),
    ).toEqual([
      mapping(""),
      mapping("workbench/lcsk/attendance"),
      mapping("workbench/lcsk/manual"),
    ]);
  });

  it("keeps manual mappings but ignores detection when auto is off", () => {
    expect(
      resolveEffectiveGitRepositoryMappings({
        manualMappings: ["workbench/lcsk/manual"],
        detectedDirectories: ["workbench/lcsk/attendance"],
        auto: false,
      }),
    ).toEqual([mapping(""), mapping("workbench/lcsk/manual")]);
  });

  it("always includes the workspace root and falls back to it alone", () => {
    expect(
      resolveEffectiveGitRepositoryMappings({
        manualMappings: [],
        detectedDirectories: null,
        auto: true,
      }),
    ).toEqual([mapping("")]);
  });

  it("strips a stray .git segment from detected directories", () => {
    expect(
      resolveEffectiveGitRepositoryMappings({
        manualMappings: [],
        detectedDirectories: ["workbench/lcsk/x/.git"],
        auto: true,
      }),
    ).toEqual([mapping(""), mapping("workbench/lcsk/x")]);
  });
});

describe("repositoryRootForMapping", () => {
  it("returns the workspace root for the empty (primary) mapping", () => {
    expect(repositoryRootForMapping(WORKSPACE_ROOT_MAPPING, ROOT)).toBe(ROOT);
  });

  it("joins a nested mapping onto the workspace root", () => {
    expect(repositoryRootForMapping(mapping("workbench/lcsk/x"), ROOT)).toBe(
      `${ROOT}/workbench/lcsk/x`,
    );
  });
});

describe("fanOutGitRepositoryStatuses", () => {
  it("collects a status per repository, isolating a single failure", async () => {
    const primary = statusWith(ROOT, [changedFile(`${ROOT}/app.php`, "app.php")]);
    const nestedRoot = `${ROOT}/workbench/lcsk/x`;

    const statuses = await fanOutGitRepositoryStatuses(
      [WORKSPACE_ROOT_MAPPING, mapping("workbench/lcsk/x")],
      ROOT,
      async (root) => {
        if (root === nestedRoot) {
          throw new Error("not a repository");
        }
        return primary;
      },
    );

    expect(statuses).toEqual([
      { mapping: mapping(""), root: ROOT, status: primary, failed: false },
      {
        mapping: mapping("workbench/lcsk/x"),
        root: nestedRoot,
        status: emptyGitStatus(nestedRoot),
        failed: true,
      },
    ]);
  });
});

describe("primaryGitStatus", () => {
  it("returns the workspace-root repository status", () => {
    const primary = statusWith(ROOT);
    const statuses: GitRepositoryStatus[] = [
      { mapping: mapping(""), root: ROOT, status: primary, failed: false },
      {
        mapping: mapping("workbench/lcsk/x"),
        root: `${ROOT}/workbench/lcsk/x`,
        status: statusWith(`${ROOT}/workbench/lcsk/x`),
        failed: false,
      },
    ];

    expect(primaryGitStatus(statuses, ROOT)).toBe(primary);
  });

  it("falls back to an empty status when no primary repository exists", () => {
    expect(primaryGitStatus([], ROOT)).toEqual(emptyGitStatus(ROOT));
  });
});

describe("aggregateGitChanges", () => {
  it("flattens the changes across every repository", () => {
    const a = changedFile(`${ROOT}/app.php`, "app.php");
    const b = changedFile(`${ROOT}/workbench/lcsk/x/lib.php`, "lib.php");

    expect(
      aggregateGitChanges([
        { mapping: mapping(""), root: ROOT, status: statusWith(ROOT, [a]), failed: false },
        {
          mapping: mapping("workbench/lcsk/x"),
          root: `${ROOT}/workbench/lcsk/x`,
          status: statusWith(`${ROOT}/workbench/lcsk/x`, [b]),
          failed: false,
        },
      ]),
    ).toEqual([a, b]);
  });
});

describe("groupGitChangesByRepository", () => {
  it("routes each file into its owning repository, deepest match wins", () => {
    const primaryChange = changedFile(`${ROOT}/app.php`, "app.php");
    const nestedChange = changedFile(
      `${ROOT}/workbench/lcsk/attendance/src/Foo.php`,
      "src/Foo.php",
    );

    const { groups, unresolved } = groupGitChangesByRepository(
      [WORKSPACE_ROOT_MAPPING, mapping("workbench/lcsk/attendance")],
      ROOT,
      [primaryChange, nestedChange],
    );

    expect(unresolved).toEqual([]);
    expect(groups).toEqual([
      {
        mapping: mapping(""),
        repositoryRoot: ROOT,
        changes: [primaryChange],
      },
      {
        mapping: mapping("workbench/lcsk/attendance"),
        repositoryRoot: `${ROOT}/workbench/lcsk/attendance`,
        changes: [nestedChange],
      },
    ]);
  });

  it("rebases a workspace-root-relative path to the owning repository's relative path", () => {
    // Fail-safe: a change handed in with a workspace-root-relative path must be
    // corrected to the nested repo's own relative path once routed, so git never
    // runs against the wrong root. The absolute path is preserved.
    const workspaceRelative = changedFile(
      `${ROOT}/workbench/lcsk/x/src/Lib.php`,
      "workbench/lcsk/x/src/Lib.php",
    );

    const { groups, unresolved } = groupGitChangesByRepository(
      [WORKSPACE_ROOT_MAPPING, mapping("workbench/lcsk/x")],
      ROOT,
      [workspaceRelative],
    );

    expect(unresolved).toEqual([]);
    expect(groups).toHaveLength(1);
    expect(groups[0].repositoryRoot).toBe(`${ROOT}/workbench/lcsk/x`);
    expect(groups[0].changes[0].relativePath).toBe("src/Lib.php");
    expect(groups[0].changes[0].path).toBe(workspaceRelative.path);
  });

  it("collects changes that resolve to no repository as unresolved (fail-safe)", () => {
    const outside = changedFile("/elsewhere/app.php", "app.php");

    const { groups, unresolved } = groupGitChangesByRepository(
      [mapping("workbench/lcsk/x")],
      ROOT,
      [outside],
    );

    expect(groups).toEqual([]);
    expect(unresolved).toEqual([outside]);
  });
});

describe("mergeGitRepositoryStatuses", () => {
  it("replaces touched repositories while preserving the others and their order", () => {
    const nestedRoot = `${ROOT}/workbench/lcsk/x`;
    const current: GitRepositoryStatus[] = [
      { mapping: mapping(""), root: ROOT, status: statusWith(ROOT), failed: false },
      {
        mapping: mapping("workbench/lcsk/x"),
        root: nestedRoot,
        status: statusWith(nestedRoot),
        failed: false,
      },
    ];
    const updatedNested = statusWith(nestedRoot, [
      changedFile(`${nestedRoot}/lib.php`, "lib.php"),
    ]);

    expect(
      mergeGitRepositoryStatuses(current, [
        {
          mapping: mapping("workbench/lcsk/x"),
          root: nestedRoot,
          status: updatedNested,
          failed: false,
        },
      ]),
    ).toEqual([
      current[0],
      {
        mapping: mapping("workbench/lcsk/x"),
        root: nestedRoot,
        status: updatedNested,
        failed: false,
      },
    ]);
  });
});
