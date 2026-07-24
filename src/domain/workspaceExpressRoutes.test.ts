import { describe, expect, it } from "vitest";
import {
  filterWorkspaceExpressRoutes,
  normalizeWorkspaceExpressRouteFilePath,
  overlayDirtyWorkspaceExpressRoutes,
  workspaceExpressRoutesFromSnapshots,
  workspaceExpressRoutesFromSnapshotsBounded,
} from "./workspaceExpressRoutes";

describe("workspace Express routes", () => {
  it("normalizes nested files and sorts by file then source position", () => {
    const routes = workspaceExpressRoutesFromSnapshots([
      {
        relativeFilePath: "src\\z\\routes.ts",
        source: "app.post('/later', handler);\napp.get('/last', handler);",
      },
      {
        packageLabel: "api",
        relativeFilePath: "packages/api/src/routes.ts",
        source: "router.get('/first', handler);",
      },
    ]);

    expect(
      routes.map(({ line, method, packageLabel, relativeFilePath }) => ({
        line,
        method,
        packageLabel,
        relativeFilePath,
      })),
    ).toEqual([
      {
        line: 1,
        method: "GET",
        packageLabel: "api",
        relativeFilePath: "packages/api/src/routes.ts",
      },
      {
        line: 1,
        method: "POST",
        packageLabel: undefined,
        relativeFilePath: "src/z/routes.ts",
      },
      {
        line: 2,
        method: "GET",
        packageLabel: undefined,
        relativeFilePath: "src/z/routes.ts",
      },
    ]);
  });

  it("gives identical routes stable percent-encoded IDs and distinct occurrences", () => {
    const snapshots = [
      {
        relativeFilePath: "src/routes & users.ts",
        source: "app.get('/users/:id', first); app.get('/users/:id', second);",
      },
    ];

    const first = workspaceExpressRoutesFromSnapshots(snapshots);
    const second = workspaceExpressRoutesFromSnapshots(snapshots);

    expect(first.map(({ id }) => id)).toEqual(second.map(({ id }) => id));
    expect(new Set(first.map(({ id }) => id)).size).toBe(2);
    expect(first.map(({ occurrence }) => occurrence)).toEqual([1, 2]);
    expect(first.map(({ line }) => line)).toEqual([1, 1]);
    expect(first[0]?.column).not.toBe(first[1]?.column);
    expect(first[0]?.id).toContain("src%2Froutes%20%26%20users.ts");
    expect(first[0]?.id).toContain("%2Fusers%2F%3Aid");
  });

  it("replaces all disk routes for exactly one dirty file, including removal and addition", () => {
    const disk = workspaceExpressRoutesFromSnapshots([
      { relativeFilePath: "src/a.ts", source: "app.get('/old', handler);" },
      { relativeFilePath: "src/b.ts", source: "app.get('/stable', handler);" },
    ]);

    const replaced = overlayDirtyWorkspaceExpressRoutes(disk, {
      relativeFilePath: "src\\a.ts",
      source: "app.post('/new', handler);",
    });
    expect(
      replaced.map(({ method, path, relativeFilePath }) => ({
        method,
        path,
        relativeFilePath,
      })),
    ).toEqual([
      { method: "POST", path: "/new", relativeFilePath: "src/a.ts" },
      { method: "GET", path: "/stable", relativeFilePath: "src/b.ts" },
    ]);

    const removed = overlayDirtyWorkspaceExpressRoutes(replaced, {
      relativeFilePath: "src/a.ts",
      source: "export {};",
    });
    expect(removed.map(({ relativeFilePath }) => relativeFilePath)).toEqual(["src/b.ts"]);
  });

  it("filters across method, path, receiver, file, line, and optional package label", () => {
    const routes = workspaceExpressRoutesFromSnapshots([
      {
        packageLabel: "billing api",
        relativeFilePath: "packages/billing/routes.ts",
        source: "\nrouter.patch('/invoices/:id', handler);",
      },
      { relativeFilePath: "src/health.ts", source: "app.get('/health', handler);" },
    ]);

    expect(filterWorkspaceExpressRoutes(routes, "PATCH invoices router")).toHaveLength(1);
    expect(filterWorkspaceExpressRoutes(routes, "billing routes.ts :2")).toHaveLength(1);
    expect(filterWorkspaceExpressRoutes(routes, "health app 1")).toHaveLength(1);
    expect(filterWorkspaceExpressRoutes(routes, "missing")).toEqual([]);
    expect(filterWorkspaceExpressRoutes(routes, "   ")).toEqual(routes);
  });

  it("rejects absolute and traversal paths without disturbing other files", () => {
    for (const path of [
      "",
      "/src/routes.ts",
      "C:\\src\\routes.ts",
      "../routes.ts",
      "src/./routes.ts",
    ]) {
      expect(normalizeWorkspaceExpressRouteFilePath(path)).toBeNull();
    }

    const disk = workspaceExpressRoutesFromSnapshots([
      { relativeFilePath: "src/routes.ts", source: "app.get('/safe', handler);" },
      { relativeFilePath: "../outside.ts", source: "app.get('/outside', handler);" },
    ]);
    expect(disk.map(({ path }) => path)).toEqual(["/safe"]);
    expect(
      overlayDirtyWorkspaceExpressRoutes(disk, {
        relativeFilePath: "/src/routes.ts",
        source: "app.get('/unsafe', handler);",
      }),
    ).toEqual(disk);
  });

  it("keeps dirty overlays and route identities isolated by package", () => {
    const disk = workspaceExpressRoutesFromSnapshots([
      {
        packageLabel: "api-a",
        relativeFilePath: "src/routes.ts",
        source: "app.get('/a-old', handler);",
      },
      {
        packageLabel: "api-b",
        relativeFilePath: "src/routes.ts",
        source: "app.get('/b-stable', handler);",
      },
    ]);

    const overlaid = overlayDirtyWorkspaceExpressRoutes(disk, {
      packageLabel: "api-a",
      relativeFilePath: "src/routes.ts",
      source: "app.post('/a-new', handler);",
    });

    expect(
      overlaid.map(({ id, occurrence, packageLabel, path }) => ({
        id,
        occurrence,
        packageLabel,
        path,
      })),
    ).toEqual([
      {
        id: expect.stringContaining("api-a"),
        occurrence: 1,
        packageLabel: "api-a",
        path: "/a-new",
      },
      {
        id: expect.stringContaining("api-b"),
        occurrence: 1,
        packageLabel: "api-b",
        path: "/b-stable",
      },
    ]);
    expect(new Set(overlaid.map((route) => route.id)).size).toBe(2);
  });

  it("canonicalizes empty and absent package labels to one dirty-overlay identity", () => {
    const disk = workspaceExpressRoutesFromSnapshots([
      {
        relativeFilePath: "src/routes.ts",
        source: "app.get('/old', handler);",
      },
    ]);
    const overlaid = overlayDirtyWorkspaceExpressRoutes(disk, {
      packageLabel: "",
      relativeFilePath: "src/routes.ts",
      source: "app.post('/new', handler);",
    });

    expect(overlaid).toHaveLength(1);
    expect(overlaid[0]).toMatchObject({
      method: "POST",
      path: "/new",
    });
    expect(overlaid[0]?.packageLabel).toBeUndefined();
    expect(new Set(overlaid.map((route) => route.id)).size).toBe(1);
  });

  it("propagates a per-file Express binding-budget truncation to the workspace result", () => {
    const irrelevantReExports = Array.from(
      { length: 20_000 },
      (_, index) => `export { missing as unused${index} } from './missing-${index}';`,
    ).join("\n");
    const result = workspaceExpressRoutesFromSnapshotsBounded(
      [
        {
          relativeFilePath: "src/app.ts",
          source: [
            "import express from 'express';",
            "import { users } from './barrel';",
            "const app = express();",
            "app.use('/api', users);",
          ].join("\n"),
        },
        {
          relativeFilePath: "src/barrel.ts",
          source: `${irrelevantReExports}\nexport { users } from './users';`,
        },
        {
          relativeFilePath: "src/users.ts",
          source: [
            "import express from 'express';",
            "const users = express.Router();",
            "users.get('/users', handler);",
            "export { users };",
          ].join("\n"),
        },
      ],
      100,
    );

    expect(result.routes.some((route) => route.path === "/api/users")).toBe(false);
    expect(result.truncated).toBe(true);
  });
});
