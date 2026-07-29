import { describe, expect, it } from "vitest";
import {
  createWorkspacePackagePathLookup,
  type WorkspacePackagePathAnswer,
} from "./workspacePackageForPath";

const PACKAGE_MANIFESTS = [
  {
    packageJson: { name: "@repo/api" },
    relativeDirPath: "packages/api",
  },
  {
    packageJson: { name: "@repo/api-client" },
    relativeDirPath: "packages/api-client",
  },
] as const;

describe("createWorkspacePackagePathLookup", () => {
  it("returns the nearest package without confusing prefix siblings", () => {
    const lookup = createWorkspacePackagePathLookup({
      authority: "complete",
      incompleteDirectories: [],
      packageManifests: [
        ...PACKAGE_MANIFESTS,
        {
          packageJson: { name: "@repo/api-admin" },
          relativeDirPath: "packages/api/admin",
        },
      ],
      unscopedAuthorityUncertain: false,
      workspaceRoot: "/workspace",
    });

    expect(lookup.packageForPath("/workspace/packages/api/src/index.ts")).toEqual({
      kind: "package",
      name: "@repo/api",
      relativeDirPath: "packages/api",
    });
    expect(lookup.packageForPath("/workspace/packages/api-client/src/index.ts")).toEqual({
      kind: "package",
      name: "@repo/api-client",
      relativeDirPath: "packages/api-client",
    });
    expect(lookup.packageForPath("/workspace/packages/api/admin/src/index.ts")).toEqual({
      kind: "package",
      name: "@repo/api-admin",
      relativeDirPath: "packages/api/admin",
    });
  });

  it("returns no package for a file outside every declared package", () => {
    const lookup = completeLookup(PACKAGE_MANIFESTS);

    expect(lookup.packageForPath("/workspace/tools/release.ts")).toEqual({
      kind: "no-package",
    });
  });

  it("returns no package rather than guessing when declared names are duplicated", () => {
    const lookup = completeLookup([
      {
        packageJson: { name: "@repo/duplicate" },
        relativeDirPath: "packages/first",
      },
      {
        packageJson: { name: "@repo/duplicate" },
        relativeDirPath: "packages/second",
      },
    ]);

    expect(lookup.packageForPath("/workspace/packages/first/src/index.ts")).toEqual({
      kind: "no-package",
    });
    expect(lookup.packageForPath("/workspace/packages/second/src/index.ts")).toEqual({
      kind: "no-package",
    });
  });

  it("excludes package names reserved by shared package attribution", () => {
    const reservedNames = [":no-package", ":package-loading", ":package-unknown"];
    const lookup = completeLookup(
      reservedNames.map((name, index) => ({
        packageJson: { name },
        relativeDirPath: `packages/reserved-${index}`,
      })),
    );

    reservedNames.forEach((_name, index) => {
      expect(lookup.packageForPath(`/workspace/packages/reserved-${index}/src/index.ts`)).toEqual({
        kind: "no-package",
      });
    });
    expect(lookup.packages).toEqual([]);
  });

  it("distinguishes loading and bounded authority from no package", () => {
    const loading = lookupWithAuthority("loading");
    const bounded = createWorkspacePackagePathLookup({
      authority: "bounded",
      incompleteDirectories: ["packages/bad"],
      packageManifests: PACKAGE_MANIFESTS,
      unscopedAuthorityUncertain: false,
      workspaceRoot: "/workspace",
    });
    const unscopedBounded = createWorkspacePackagePathLookup({
      authority: "bounded",
      incompleteDirectories: [],
      packageManifests: [],
      unscopedAuthorityUncertain: true,
      workspaceRoot: "/workspace",
    });

    expect(loading.packageForPath("/workspace/tools/release.ts")).toEqual({
      kind: "loading",
    });
    expect(bounded.packageForPath("/workspace/packages/bad/src/index.ts")).toEqual({
      kind: "unknown",
    });
    expect(bounded.packageForPath("/workspace/tools/release.ts")).toEqual({
      kind: "no-package",
    });
    expect(unscopedBounded.packageForPath("/workspace/tools/release.ts")).toEqual({
      kind: "unknown",
    });
  });
});

function completeLookup(
  packageManifests: Parameters<typeof createWorkspacePackagePathLookup>[0]["packageManifests"],
) {
  return createWorkspacePackagePathLookup({
    authority: "complete",
    incompleteDirectories: [],
    packageManifests,
    unscopedAuthorityUncertain: false,
    workspaceRoot: "/workspace",
  });
}

function lookupWithAuthority(authority: "loading" | "bounded" | "complete"): {
  packageForPath(path: string): WorkspacePackagePathAnswer;
} {
  return createWorkspacePackagePathLookup({
    authority,
    incompleteDirectories: [],
    packageManifests: [],
    unscopedAuthorityUncertain: false,
    workspaceRoot: "/workspace",
  });
}
