import { describe, expect, it } from "vitest";
import type { WorkspacePackageManifestInput } from "./workspacePackageGraph";
import {
  NO_PROBLEMS_PACKAGE,
  UNKNOWN_PROBLEMS_PACKAGE,
  createProblemsPackageAttribution,
} from "./problemsPackageAttribution";

const API_PACKAGE: WorkspacePackageManifestInput = {
  packageJson: { name: "@repo/api" },
  relativeDirPath: "packages/api",
};

describe("createProblemsPackageAttribution", () => {
  it("attributes a file in packages/api and leaves a file outside packages unowned", () => {
    const apiPath = "/workspace/packages/api/src/index.ts";
    const outsidePath = "/workspace/tools/release.ts";
    const attribution = createProblemsPackageAttribution({
      filePaths: [apiPath, outsidePath],
      packageManifests: [API_PACKAGE],
      workspaceRoot: "/workspace",
    });

    expect(attribution.packageForPath(apiPath)).toEqual({
      key: "@repo/api",
      kind: "package",
      label: "@repo/api",
      relativeDirPath: "packages/api",
    });
    expect(attribution.packageForPath(outsidePath)).toEqual(NO_PROBLEMS_PACKAGE);
  });

  it("fails closed when two workspace packages declare the same name", () => {
    const firstPath = "/workspace/packages/first/src/index.ts";
    const secondPath = "/workspace/packages/second/src/index.ts";
    const packageManifests: readonly WorkspacePackageManifestInput[] = [
      {
        packageJson: { name: "@repo/duplicate" },
        relativeDirPath: "packages/first",
      },
      {
        packageJson: { name: "@repo/duplicate" },
        relativeDirPath: "packages/second",
      },
    ];
    const attribution = createProblemsPackageAttribution({
      filePaths: [firstPath, secondPath],
      packageManifests,
      workspaceRoot: "/workspace",
    });

    expect(attribution.packageForPath(firstPath)).toEqual(NO_PROBLEMS_PACKAGE);
    expect(attribution.packageForPath(secondPath)).toEqual(NO_PROBLEMS_PACKAGE);
  });

  it("keeps prefix-sibling packages distinct", () => {
    const apiClient: WorkspacePackageManifestInput = {
      packageJson: { name: "@repo/api-client" },
      relativeDirPath: "packages/api-client",
    };
    const apiPath = "/workspace/packages/api/src/index.ts";
    const apiClientPath = "/workspace/packages/api-client/src/index.ts";
    const attribution = createProblemsPackageAttribution({
      filePaths: [apiPath, apiClientPath],
      packageManifests: [API_PACKAGE, apiClient],
      workspaceRoot: "/workspace",
    });

    expect(attribution.packageForPath(apiPath).key).toBe("@repo/api");
    expect(attribution.packageForPath(apiClientPath).key).toBe("@repo/api-client");
  });

  it("uses the nearest nested package", () => {
    const nested: WorkspacePackageManifestInput = {
      packageJson: { name: "@repo/api-admin" },
      relativeDirPath: "packages/api/admin",
    };
    const nestedPath = "/workspace/packages/api/admin/src/index.ts";
    const attribution = createProblemsPackageAttribution({
      filePaths: [nestedPath],
      packageManifests: [API_PACKAGE, nested],
      workspaceRoot: "/workspace",
    });

    expect(attribution.packageForPath(nestedPath).key).toBe("@repo/api-admin");
  });

  it("fails closed for a path outside the workspace root", () => {
    const outsidePath = "/other/packages/api/src/index.ts";
    const attribution = createProblemsPackageAttribution({
      filePaths: [outsidePath],
      packageManifests: [API_PACKAGE],
      workspaceRoot: "/workspace",
    });

    expect(attribution.packageForPath(outsidePath)).toEqual(NO_PROBLEMS_PACKAGE);
  });

  it("attributes Windows-separated package paths", () => {
    const windowsPath = "C:\\workspace\\packages\\api\\src\\index.ts";
    const attribution = createProblemsPackageAttribution({
      filePaths: [windowsPath],
      packageManifests: [API_PACKAGE],
      workspaceRoot: "C:\\workspace",
    });

    expect(attribution.packageForPath(windowsPath).key).toBe("@repo/api");
  });

  it("attributes successful manifests while limiting unknown fallback to incomplete directories", () => {
    const apiPath = "/workspace/packages/api/src/index.ts";
    const badPath = "/workspace/packages/bad/src/index.ts";
    const outsidePath = "/workspace/tools/release.ts";
    const attribution = createProblemsPackageAttribution({
      filePaths: [apiPath, badPath, outsidePath],
      incompleteDirectories: ["packages/bad"],
      packageManifests: [API_PACKAGE],
      workspaceRoot: "/workspace",
    });

    expect(attribution.packageForPath(apiPath).key).toBe("@repo/api");
    expect(attribution.packageForPath(badPath)).toEqual(UNKNOWN_PROBLEMS_PACKAGE);
    expect(attribution.packageForPath(outsidePath)).toEqual(NO_PROBLEMS_PACKAGE);
  });
});
