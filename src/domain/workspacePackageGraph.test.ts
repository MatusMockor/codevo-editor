import { describe, expect, it } from "vitest";
import { resolveExpressRouteMountsBounded } from "./expressRouteMounts";
import {
  createWorkspacePackageGraph,
  MAX_WORKSPACE_PACKAGES,
} from "./workspacePackageGraph";

const PACKAGE_MANIFESTS = [
  {
    packageJson: {
      exports: {
        ".": {
          default: "./dist/index.js",
          source: "./src/index.ts",
        },
      },
      name: "@repo/orders",
    },
    relativeDirPath: "packages/orders",
  },
  {
    packageJson: {
      main: "./dist/index.js",
      name: "@repo/users",
    },
    relativeDirPath: "packages/users",
  },
] as const;

const SOURCE_FILES = ["packages/orders/src/index.ts", "packages/users/src/index.ts"] as const;

describe("createWorkspacePackageGraph", () => {
  it("builds the same graph from npm workspaces and pnpm workspace packages", () => {
    const npm = createWorkspacePackageGraph({
      packageManifests: PACKAGE_MANIFESTS,
      pnpmWorkspaceYaml: undefined,
      rootPackageJson: { workspaces: ["packages/*"] },
      sourceFilePaths: SOURCE_FILES,
    });
    const pnpm = createWorkspacePackageGraph({
      packageManifests: PACKAGE_MANIFESTS,
      pnpmWorkspaceYaml: "packages:\n  - 'packages/*'\n",
      rootPackageJson: {},
      sourceFilePaths: SOURCE_FILES,
    });

    expect(npm.packages).toEqual(pnpm.packages);
    expect(npm.resolve("@repo/orders")).toEqual(["packages/orders/src/index.ts"]);
    expect(npm.resolve("@repo/users")).toEqual(["packages/users/src/index.ts"]);
    expect(npm.truncated).toBe(false);
    expect(pnpm.truncated).toBe(false);
  });

  it.each([
    ["indentless sequence", "packages:\n- 'packages/*'\n"],
    ["flow sequence", 'packages: ["packages/*"]\n'],
    ["quoted packages key", "'packages':\n  - 'packages/*'\n"],
  ])("parses a pnpm workspace %s", (_shape, pnpmWorkspaceYaml) => {
    const graph = createWorkspacePackageGraph({
      packageManifests: PACKAGE_MANIFESTS,
      pnpmWorkspaceYaml,
      rootPackageJson: {},
      sourceFilePaths: SOURCE_FILES,
    });

    expect(graph.resolve("@repo/orders")).toEqual(["packages/orders/src/index.ts"]);
    expect(graph.truncated).toBe(false);
  });

  it.each([
    ["packages/*", "packages/orders", "packages/orders/src/index.ts"],
    ["apps/**", "apps/orders", "apps/orders/src/index.ts"],
    ["packages/*/src", "packages/orders/src", "packages/orders/src/index.ts"],
  ])("resolves the unquoted pnpm workspace glob %s", (pattern, relativeDirPath, sourceEntry) => {
    const graph = createWorkspacePackageGraph({
      packageManifests: [
        {
          packageJson: { name: "@repo/orders" },
          relativeDirPath,
        },
      ],
      pnpmWorkspaceYaml: `packages:\n  - ${pattern}\n`,
      rootPackageJson: {},
      sourceFilePaths: [sourceEntry],
    });

    expect(graph.resolve("@repo/orders")).toEqual([sourceEntry]);
    expect(graph.truncated).toBe(false);
  });

  it("expands an npm workspace brace pattern to every alternative", () => {
    const graph = createWorkspacePackageGraph({
      packageManifests: [
        {
          packageJson: { name: "@repo/web" },
          relativeDirPath: "apps/web",
        },
        {
          packageJson: { name: "@repo/api" },
          relativeDirPath: "apps/api",
        },
      ],
      pnpmWorkspaceYaml: undefined,
      rootPackageJson: { workspaces: ["apps/{web,api}"] },
      sourceFilePaths: ["apps/web/src/index.ts", "apps/api/src/index.ts"],
    });

    expect(graph.resolve("@repo/web")).toEqual(["apps/web/src/index.ts"]);
    expect(graph.resolve("@repo/api")).toEqual(["apps/api/src/index.ts"]);
    expect(graph.truncated).toBe(false);
  });

  it("expands a pnpm workspace brace pattern before a wildcard", () => {
    const graph = createWorkspacePackageGraph({
      packageManifests: [
        {
          packageJson: { name: "@repo/web" },
          relativeDirPath: "apps/web",
        },
        {
          packageJson: { name: "@repo/shared" },
          relativeDirPath: "packages/shared",
        },
      ],
      pnpmWorkspaceYaml: "packages:\n  - '{apps,packages}/*'\n",
      rootPackageJson: {},
      sourceFilePaths: ["apps/web/src/index.ts", "packages/shared/src/index.ts"],
    });

    expect(graph.resolve("@repo/web")).toEqual(["apps/web/src/index.ts"]);
    expect(graph.resolve("@repo/shared")).toEqual(["packages/shared/src/index.ts"]);
    expect(graph.truncated).toBe(false);
  });

  it("reports a nested workspace brace pattern as unsupported", () => {
    const graph = createWorkspacePackageGraph({
      packageManifests: PACKAGE_MANIFESTS,
      pnpmWorkspaceYaml: undefined,
      rootPackageJson: { workspaces: ["a/{b,{c,d}}"] },
      sourceFilePaths: SOURCE_FILES,
    });

    expect(graph.packages).toEqual([]);
    expect(graph.truncated).toBe(true);
  });

  it.each([
    ["document marker", "---\npackages:\n  - 'packages/*'\n"],
    ["comment and document marker", "# workspace\n---\npackages:\n  - 'packages/*'\n"],
    ["YAML directive and document marker", "%YAML 1.2\n---\npackages:\n  - 'packages/*'\n"],
  ])("resolves a pnpm workspace after a leading %s", (_shape, pnpmWorkspaceYaml) => {
    const graph = createWorkspacePackageGraph({
      packageManifests: PACKAGE_MANIFESTS,
      pnpmWorkspaceYaml,
      rootPackageJson: {},
      sourceFilePaths: SOURCE_FILES,
    });

    expect(graph.resolve("@repo/orders")).toEqual(["packages/orders/src/index.ts"]);
    expect(graph.truncated).toBe(false);
  });

  it("strips a trailing comment outside a quoted pnpm workspace pattern", () => {
    const graph = createWorkspacePackageGraph({
      packageManifests: PACKAGE_MANIFESTS,
      pnpmWorkspaceYaml: "packages:\n  - 'packages/*' # package workspaces\n",
      rootPackageJson: {},
      sourceFilePaths: SOURCE_FILES,
    });

    expect(graph.resolve("@repo/orders")).toEqual(["packages/orders/src/index.ts"]);
    expect(graph.truncated).toBe(false);
  });

  it("stops at the end of the first pnpm workspace document", () => {
    const graph = createWorkspacePackageGraph({
      packageManifests: [
        ...PACKAGE_MANIFESTS,
        {
          packageJson: { name: "@repo/evil" },
          relativeDirPath: "evil/package",
        },
      ],
      pnpmWorkspaceYaml: "packages:\n  - 'packages/*'\n---\npackages:\n  - 'evil/*'\n",
      rootPackageJson: {},
      sourceFilePaths: [...SOURCE_FILES, "evil/package/src/index.ts"],
    });

    expect(graph.resolve("@repo/orders")).toEqual(["packages/orders/src/index.ts"]);
    expect(graph.resolve("@repo/evil")).toEqual([]);
    expect(graph.truncated).toBe(false);
  });

  it.each([
    ["an anchor declaration", "packages:\n  - &a 'packages/*'\n"],
    ["an alias reference", "defaults: &d 'packages/*'\npackages:\n  - *d\n"],
    ["a tag-like marker", "packages:\n  - !include\n"],
    ["a flow mapping marker", "packages:\n  - {packages/*}\n"],
    ["a flow sequence marker", "packages:\n  - [packages/*]\n"],
    ["a mapping-like scalar", "packages:\n  - packages: /*\n"],
    ["a block-sequence indicator", "packages:\n  - - packages/*\n"],
    ["a mapping-key indicator", "packages:\n  - ? packages/*\n"],
    ["a malformed sequence scalar", "packages:\n  -packages/*\n"],
    ["duplicate packages keys", "packages:\n  - packages/*\npackages:\n  - evil/*\n"],
  ])("reports pnpm workspace %s as unsupported", (_shape, pnpmWorkspaceYaml) => {
    const graph = createWorkspacePackageGraph({
      packageManifests: PACKAGE_MANIFESTS,
      pnpmWorkspaceYaml,
      rootPackageJson: {},
      sourceFilePaths: SOURCE_FILES,
    });

    expect(graph.packages).toEqual([]);
    expect(graph.truncated).toBe(true);
  });

  it("reports an unsupported pnpm packages shape as truncated", () => {
    const graph = createWorkspacePackageGraph({
      packageManifests: PACKAGE_MANIFESTS,
      pnpmWorkspaceYaml: "packages:\n  nested: packages/*\n",
      rootPackageJson: {},
      sourceFilePaths: SOURCE_FILES,
    });

    expect(graph.packages).toEqual([]);
    expect(graph.truncated).toBe(true);
  });

  it("resolves a flat package entry", () => {
    const main = "index.js";
    const sourceEntry = "packages/orders/index.js";
    const graph = createWorkspacePackageGraph({
      packageManifests: [
        {
          packageJson: { main, name: "@repo/orders" },
          relativeDirPath: "packages/orders",
        },
      ],
      pnpmWorkspaceYaml: undefined,
      rootPackageJson: { workspaces: ["packages/*"] },
      sourceFilePaths: [sourceEntry],
    });

    expect(graph.resolve("@repo/orders")).toEqual([sourceEntry]);
    expect(graph.packages).toEqual([
      {
        name: "@repo/orders",
        relativeDirPath: "packages/orders",
        sourceEntry,
        status: "resolved",
      },
    ]);
    expect(graph.truncated).toBe(false);
  });

  it("keeps a dist-only workspace package visibly unresolved", () => {
    const graph = createWorkspacePackageGraph({
      packageManifests: [
        {
          packageJson: { main: "dist/index.js", name: "@repo/orders" },
          relativeDirPath: "packages/orders",
        },
      ],
      pnpmWorkspaceYaml: undefined,
      rootPackageJson: { workspaces: ["packages/*"] },
      sourceFilePaths: ["packages/orders/dist/index.js"],
    });

    expect(graph.resolve("@repo/orders")).toEqual([]);
    expect(graph.packages).toEqual([
      {
        name: "@repo/orders",
        relativeDirPath: "packages/orders",
        status: "unresolved",
      },
    ]);
    expect(graph.truncated).toBe(false);
  });

  it("resolves a workspace package subpath without node_modules", () => {
    const graph = createWorkspacePackageGraph({
      packageManifests: [
        {
          packageJson: { name: "@repo/tsconfig" },
          relativeDirPath: "packages/tsconfig",
        },
      ],
      pnpmWorkspaceYaml: undefined,
      rootPackageJson: { workspaces: ["packages/*"] },
      sourceFilePaths: [],
    });

    expect(graph.resolvePackagePath("@repo/tsconfig/base.json")).toEqual({
      relativePath: "packages/tsconfig/base.json",
      status: "resolved",
    });
  });

  it("exposes a tsconfig-only workspace package directory", () => {
    const graph = createWorkspacePackageGraph({
      packageManifests: [
        {
          packageJson: { name: "@repo/tsconfig" },
          relativeDirPath: "packages/tsconfig",
        },
      ],
      pnpmWorkspaceYaml: undefined,
      rootPackageJson: { workspaces: ["packages/*"] },
      sourceFilePaths: [],
    });

    expect(graph.resolvePackageDirectory("@repo/tsconfig")).toEqual({
      relativePath: "packages/tsconfig",
      status: "resolved",
    });
  });

  it("resolves an uppercase private workspace package name", () => {
    const graph = createWorkspacePackageGraph({
      packageManifests: [
        {
          packageJson: { name: "@Repo/Routes" },
          relativeDirPath: "packages/routes",
        },
      ],
      pnpmWorkspaceYaml: undefined,
      rootPackageJson: { workspaces: ["packages/*"] },
      sourceFilePaths: ["packages/routes/src/index.ts"],
    });

    expect(graph.resolve("@Repo/Routes")).toEqual(["packages/routes/src/index.ts"]);
    expect(graph.truncated).toBe(false);
  });

  it("prefers a TypeScript source entry over a compiled lib main", () => {
    const graph = createWorkspacePackageGraph({
      packageManifests: [
        {
          packageJson: { main: "lib/index.js", name: "@repo/routes" },
          relativeDirPath: "packages/routes",
        },
      ],
      pnpmWorkspaceYaml: undefined,
      rootPackageJson: { workspaces: ["packages/*"] },
      sourceFilePaths: ["packages/routes/lib/index.js", "packages/routes/src/index.ts"],
    });

    expect(graph.resolve("@repo/routes")).toEqual(["packages/routes/src/index.ts"]);
  });

  it.each(["lib", "out", "build"])(
    "falls back to a handwritten %s index when no source index exists",
    (directory) => {
      const sourceEntry = `packages/routes/${directory}/index.js`;
      const graph = createWorkspacePackageGraph({
        packageManifests: [
          {
            packageJson: { main: `${directory}/index.js`, name: "@repo/routes" },
            relativeDirPath: "packages/routes",
          },
        ],
        pnpmWorkspaceYaml: undefined,
        rootPackageJson: { workspaces: ["packages/*"] },
        sourceFilePaths: [sourceEntry],
      });

      expect(graph.resolve("@repo/routes")).toEqual([sourceEntry]);
      expect(graph.truncated).toBe(false);
    },
  );

  it("prefers an explicit non-build package entry over a source index", () => {
    const graph = createWorkspacePackageGraph({
      packageManifests: [
        {
          packageJson: { main: "src/server.ts", name: "@repo/routes" },
          relativeDirPath: "packages/routes",
        },
      ],
      pnpmWorkspaceYaml: undefined,
      rootPackageJson: { workspaces: ["packages/*"] },
      sourceFilePaths: ["packages/routes/src/index.ts", "packages/routes/src/server.ts"],
    });

    expect(graph.resolve("@repo/routes")).toEqual(["packages/routes/src/server.ts"]);
  });

  it("prefers an explicit module entry over main build output and a source index", () => {
    const graph = createWorkspacePackageGraph({
      packageManifests: [
        {
          packageJson: {
            main: "dist/index.js",
            module: "src/server.mjs",
            name: "@repo/routes",
          },
          relativeDirPath: "packages/routes",
        },
      ],
      pnpmWorkspaceYaml: undefined,
      rootPackageJson: { workspaces: ["packages/*"] },
      sourceFilePaths: ["packages/routes/src/index.ts", "packages/routes/src/server.ts"],
    });

    expect(graph.resolve("@repo/routes")).toEqual(["packages/routes/src/server.ts"]);
  });

  it("normalizes a compiled main before excluding build output", () => {
    const graph = createWorkspacePackageGraph({
      packageManifests: [
        {
          packageJson: { main: "./lib/../dist/index.js", name: "@repo/routes" },
          relativeDirPath: "packages/routes",
        },
      ],
      pnpmWorkspaceYaml: undefined,
      rootPackageJson: { workspaces: ["packages/*"] },
      sourceFilePaths: ["packages/routes/dist/index.js", "packages/routes/src/index.ts"],
    });

    expect(graph.resolve("@repo/routes")).toEqual(["packages/routes/src/index.ts"]);
  });

  it("uses a workspace package source entry for a CommonJS Express mount", () => {
    const graph = createWorkspacePackageGraph({
      packageManifests: PACKAGE_MANIFESTS,
      pnpmWorkspaceYaml: undefined,
      rootPackageJson: { workspaces: ["packages/*"] },
      sourceFilePaths: ["apps/api/src/app.ts", "packages/orders/src/index.ts"],
    });
    const result = resolveExpressRouteMountsBounded(
      [
        {
          packageLabel: "@repo/api",
          relativeFilePath: "apps/api/src/app.ts",
          source: [
            "const express = require('express');",
            "const app = express();",
            "const orders = require('@repo/orders');",
            "app.use('/x', orders);",
          ].join("\n"),
        },
        {
          packageLabel: "@repo/orders",
          relativeFilePath: "packages/orders/src/index.ts",
          source: [
            "const express = require('express');",
            "const router = express.Router();",
            "router.get('/orders', handler);",
            "module.exports = router;",
          ].join("\n"),
        },
      ],
      100,
      graph.resolve,
    );

    expect(result.routes).toContainEqual(
      expect.objectContaining({
        path: "/x/orders",
        relativeFilePath: "packages/orders/src/index.ts",
      }),
    );
  });

  it("resolves an ESM package mount to a source-conditioned export", () => {
    const graph = createWorkspacePackageGraph({
      packageManifests: PACKAGE_MANIFESTS,
      pnpmWorkspaceYaml: undefined,
      rootPackageJson: { workspaces: ["packages/*"] },
      sourceFilePaths: SOURCE_FILES,
    });
    const result = resolveExpressRouteMountsBounded(
      [
        {
          relativeFilePath: "apps/api/src/app.ts",
          source: [
            "import express from 'express';",
            "import orders from '@repo/orders';",
            "const app = express();",
            "app.use('/x', orders);",
          ].join("\n"),
        },
        {
          relativeFilePath: "packages/orders/src/index.ts",
          source: [
            "import express from 'express';",
            "const router = express.Router();",
            "router.get('/orders', handler);",
            "export default router;",
          ].join("\n"),
        },
      ],
      100,
      graph.resolve,
    );

    expect(result.routes).toContainEqual(expect.objectContaining({ path: "/x/orders" }));
  });

  it("resolves duplicate package names to nothing", () => {
    const graph = createWorkspacePackageGraph({
      packageManifests: [
        ...PACKAGE_MANIFESTS,
        {
          packageJson: { name: "@repo/orders" },
          relativeDirPath: "legacy/orders",
        },
      ],
      pnpmWorkspaceYaml: undefined,
      rootPackageJson: { workspaces: ["packages/*", "legacy/*"] },
      sourceFilePaths: [...SOURCE_FILES, "legacy/orders/src/index.ts"],
    });

    expect(graph.resolve("@repo/orders")).toEqual([]);
    expect(graph.resolve("@repo/missing")).toEqual([]);
  });

  it("fails the graph closed when glob expansion exceeds its cap", () => {
    const expandingPattern = `${"{a,b}/".repeat(9)}*`;
    const graph = createWorkspacePackageGraph({
      packageManifests: PACKAGE_MANIFESTS,
      pnpmWorkspaceYaml: undefined,
      rootPackageJson: { workspaces: [expandingPattern] },
      sourceFilePaths: SOURCE_FILES,
    });

    expect(graph.packages).toEqual([]);
    expect(graph.resolve("@repo/orders")).toEqual([]);
    expect(graph.truncated).toBe(true);
  });

  it("fails the graph closed when the package cap is exceeded", () => {
    const packageManifests = Array.from({ length: MAX_WORKSPACE_PACKAGES + 1 }, (_, index) => ({
      packageJson: { name: `package-${index}` },
      relativeDirPath: `packages/package-${index}`,
    }));
    const graph = createWorkspacePackageGraph({
      packageManifests,
      pnpmWorkspaceYaml: undefined,
      rootPackageJson: { workspaces: ["packages/*"] },
      sourceFilePaths: packageManifests.map(
        ({ relativeDirPath }) => `${relativeDirPath}/src/index.ts`,
      ),
    });

    expect(graph.packages).toEqual([]);
    expect(graph.resolve("package-0")).toEqual([]);
    expect(graph.truncated).toBe(true);
  });

  it("charges wildcard backtracking against the glob operation budget", () => {
    const packageManifests = Array.from({ length: MAX_WORKSPACE_PACKAGES }, (_, index) => ({
      packageJson: { name: `package-${index}` },
      relativeDirPath: `packages/${"a".repeat(220)}-${index}`,
    }));
    const patterns = Array.from(
      { length: 16 },
      (_, index) => `packages/${"*a".repeat(200)}b-${index}`,
    );
    const graph = createWorkspacePackageGraph({
      packageManifests,
      pnpmWorkspaceYaml: undefined,
      rootPackageJson: { workspaces: patterns },
      sourceFilePaths: packageManifests.map(({ relativeDirPath }) => `${relativeDirPath}/index.ts`),
    });

    expect(graph.packages).toEqual([]);
    expect(graph.truncated).toBe(true);
  });
});
