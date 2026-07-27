import { describe, expect, it } from "vitest";
import { expressRouteScanRoots, MAX_ROOTS } from "./expressRouteScanRoots";

describe("expressRouteScanRoots", () => {
  it("labels each discovered file with its owning package from nearest package.json", () => {
    expect(
      expressRouteScanRoots({
        relativeFilePaths: ["src/root.ts", "apps/api/src/server.ts", "apps/web/src/server.ts"],
        packageJsonDirs: [
          { packageName: "workspace", relativeDirPath: "" },
          { packageName: "@acme/api", relativeDirPath: "apps/api" },
          { packageName: "@acme/web", relativeDirPath: "apps/web" },
        ],
      }).files,
    ).toEqual([
      { relativeFilePath: "src/root.ts", packageLabel: "workspace" },
      { relativeFilePath: "apps/api/src/server.ts", packageLabel: "@acme/api" },
      { relativeFilePath: "apps/web/src/server.ts", packageLabel: "@acme/web" },
    ]);
  });

  it("uses the nearest nested package ancestor by complete path segments", () => {
    expect(
      expressRouteScanRoots({
        relativeFilePaths: [
          "packages/api/src/root.ts",
          "packages/api/plugins/auth/src/routes.ts",
          "packages/api-v2/src/routes.ts",
        ],
        packageJsonDirs: [
          { packageName: "api", relativeDirPath: "packages/api" },
          { packageName: "auth", relativeDirPath: "packages/api/plugins/auth" },
        ],
      }).files,
    ).toEqual([
      { relativeFilePath: "packages/api/src/root.ts", packageLabel: "api" },
      {
        relativeFilePath: "packages/api/plugins/auth/src/routes.ts",
        packageLabel: "auth",
      },
      { relativeFilePath: "packages/api-v2/src/routes.ts", packageLabel: undefined },
    ]);
  });

  it("reports deterministic truncation when package roots exceed MAX_ROOTS", () => {
    const packageJsonDirs = Array.from({ length: MAX_ROOTS + 2 }, (_, index) => ({
      packageName: `package-${index}`,
      relativeDirPath: `packages/${String(index).padStart(3, "0")}`,
    })).reverse();

    const result = expressRouteScanRoots({
      relativeFilePaths: [
        "packages/000/index.ts",
        `packages/${String(MAX_ROOTS + 1).padStart(3, "0")}/index.ts`,
      ],
      packageJsonDirs,
    });

    expect(result.truncated).toBe(true);
    expect(result.files).toEqual([
      { relativeFilePath: "packages/000/index.ts", packageLabel: "package-0" },
      {
        relativeFilePath: `packages/${String(MAX_ROOTS + 1).padStart(3, "0")}/index.ts`,
        packageLabel: undefined,
      },
    ]);
  });

  it("does not count the root manifest toward MAX_ROOTS", () => {
    const nonRootPackages = Array.from({ length: MAX_ROOTS }, (_, index) => ({
      packageName: `package-${index}`,
      relativeDirPath: `packages/${String(index).padStart(3, "0")}`,
    }));

    const result = expressRouteScanRoots({
      relativeFilePaths: nonRootPackages.map(
        ({ relativeDirPath }) => `${relativeDirPath}/index.ts`,
      ),
      packageJsonDirs: [{ packageName: "workspace", relativeDirPath: "" }, ...nonRootPackages],
    });

    expect(result.truncated).toBe(false);
    expect(result.files).toEqual(
      nonRootPackages.map(({ packageName, relativeDirPath }) => ({
        relativeFilePath: `${relativeDirPath}/index.ts`,
        packageLabel: packageName,
      })),
    );
  });

  it("uses the root package name as a fallback without overriding nearest nested packages", () => {
    expect(
      expressRouteScanRoots({
        relativeFilePaths: [
          "server.ts",
          "src/routes.ts",
          "packages/api/src/routes.ts",
          "packages/api-tools/src/routes.ts",
        ],
        packageJsonDirs: [
          { packageName: "workspace-api", relativeDirPath: "" },
          { packageName: "@acme/api", relativeDirPath: "packages/api" },
        ],
      }).files,
    ).toEqual([
      { relativeFilePath: "server.ts", packageLabel: "workspace-api" },
      { relativeFilePath: "src/routes.ts", packageLabel: "workspace-api" },
      { relativeFilePath: "packages/api/src/routes.ts", packageLabel: "@acme/api" },
      { relativeFilePath: "packages/api-tools/src/routes.ts", packageLabel: "workspace-api" },
    ]);
  });

  it("skips malformed package names without failing file resolution", () => {
    expect(
      expressRouteScanRoots({
        relativeFilePaths: [
          "apps/empty/src/routes.ts",
          "apps/invalid/src/routes.ts",
          "apps/non-string/src/routes.ts",
          "apps/valid/src/routes.ts",
        ],
        packageJsonDirs: [
          { packageName: " ", relativeDirPath: "apps/empty" },
          { packageName: "invalid name", relativeDirPath: "apps/invalid" },
          { packageName: 42, relativeDirPath: "apps/non-string" },
          { packageName: "valid", relativeDirPath: "apps/valid" },
        ],
      }).files,
    ).toEqual([
      { relativeFilePath: "apps/empty/src/routes.ts", packageLabel: undefined },
      { relativeFilePath: "apps/invalid/src/routes.ts", packageLabel: undefined },
      { relativeFilePath: "apps/non-string/src/routes.ts", packageLabel: undefined },
      { relativeFilePath: "apps/valid/src/routes.ts", packageLabel: "valid" },
    ]);
  });
});
