// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type {
  BoundedWorkspaceSourceRead,
  WorkspaceSourceDiscoveryGateway,
} from "../domain/workspaceSourceDiscovery";
import { waitForReact } from "../test/reactTestLifecycle";
import {
  useWorkspaceExpressRoutes,
  type UseWorkspaceExpressRoutesOptions,
  type WorkspaceExpressRoutesState,
} from "./useWorkspaceExpressRoutes";
import { expressRouteNavigationReceipt } from "./expressRouteNavigationReceipt";

const ROOT_A = "/workspace/a";
const ROOT_B = "/workspace/b";
const ROUTE_A = "app.get('/a', handler);";

describe("useWorkspaceExpressRoutes", () => {
  it("does no discovery while closed, including explicit refresh", async () => {
    const gateway = discovery();
    const harness = renderRoutes({ gateway, isOpen: false });

    await act(async () => harness.hook().refresh());

    expect(gateway.enumerateJavaScriptSourceFiles).not.toHaveBeenCalled();
    expect(gateway.readSourceTextBounded).not.toHaveBeenCalled();
    expect(harness.hook().loading).toBe(false);
    harness.unmount();
  });

  it("discovers only on open with fixed limits and bounded reads", async () => {
    const gateway = discovery({
      enumerateJavaScriptSourceFiles: vi.fn(async () => ({
        files: ["src/a.ts", "src/b.ts"],
        truncated: false,
        visited: 4,
      })),
      readSourceTextBounded: vi.fn(async (_root, path): Promise<BoundedWorkspaceSourceRead> => ({
        status: "ok",
        content: path.endsWith("a.ts") ? ROUTE_A : "router.post('/b', handler);",
      })),
    });
    const harness = renderRoutes({ gateway, isOpen: false });

    harness.set({ isOpen: true });
    await waitForReact(() => expect(harness.hook().routes).toHaveLength(2));

    expect(gateway.enumerateJavaScriptSourceFiles).toHaveBeenCalledExactlyOnceWith(ROOT_A, {
      maxFiles: 2_000,
      maxVisited: 50_000,
    });
    expect(gateway.readSourceTextBounded).toHaveBeenCalledWith(ROOT_A, "src/a.ts", 262_144);
    expect(harness.hook().loading).toBe(false);
    expect(harness.hook().error).toBeNull();
    harness.unmount();
  });

  it("flows nearest package labels into disk routes and unlabeled dirty panel snapshots", async () => {
    const gateway = discovery({
      enumerateJavaScriptSourceFiles: vi.fn(async () => ({
        files: ["src/root.ts", "apps/api/src/server.ts"],
        truncated: false,
        visited: 5,
      })),
      enumeratePackageJsonFiles: vi.fn(async () => ({
        files: ["package.json", "apps/api/package.json"],
        truncated: false,
        visited: 5,
      })),
      readSourceTextBounded: vi.fn(async (_root, path) => {
        if (path === "package.json") {
          return { status: "ok" as const, content: '{"name":"workspace"}' };
        }
        if (path === "apps/api/package.json") {
          return { status: "ok" as const, content: '{"name":"@acme/api"}' };
        }
        return {
          status: "ok" as const,
          content:
            path === "src/root.ts" ? "app.get('/root', handler);" : "app.get('/api', handler);",
        };
      }),
    });
    const harness = renderRoutes({ gateway, isOpen: true });

    await waitForReact(() => expect(harness.hook().routes).toHaveLength(2));

    expect(gateway.enumeratePackageJsonFiles).toHaveBeenCalledExactlyOnceWith(ROOT_A, {
      maxFiles: 256,
      maxVisited: 50_000,
    });
    expect(harness.hook().routes.map(({ packageLabel, path }) => ({ packageLabel, path }))).toEqual(
      [
        { packageLabel: "@acme/api", path: "/api" },
        { packageLabel: "workspace", path: "/root" },
      ],
    );

    harness.set({
      dirtySnapshots: [
        {
          relativeFilePath: "apps/api/src/server.ts",
          source: "app.patch('/dirty-api', handler);",
        },
      ],
    });

    await waitForReact(() =>
      expect(
        harness.hook().routes.map(({ packageLabel, path }) => ({ packageLabel, path })),
      ).toEqual([
        { packageLabel: "@acme/api", path: "/dirty-api" },
        { packageLabel: "workspace", path: "/root" },
      ]),
    );
    harness.unmount();
  });

  it("publishes the bounded workspace package graph with its routes", async () => {
    const gateway = discovery({
      enumerateJavaScriptSourceFiles: vi.fn(async () => ({
        files: ["packages/api/src/x.ts"],
        truncated: false,
        visited: 4,
      })),
      enumeratePackageJsonFiles: vi.fn(async () => ({
        files: ["package.json", "packages/api/package.json"],
        truncated: false,
        visited: 4,
      })),
      readSourceTextBounded: vi.fn(async (_root, path) => {
        if (path === "package.json") {
          return {
            status: "ok" as const,
            content: '{"name":"workspace","workspaces":["packages/*"]}',
          };
        }
        if (path === "packages/api/package.json") {
          return { status: "ok" as const, content: '{"name":"@repo/api"}' };
        }
        return { status: "ok" as const, content: "app.get('/api', handler);" };
      }),
    });
    const harness = renderRoutes({ gateway, isOpen: true });

    await waitForReact(() => expect(harness.hook().workspacePackages).toHaveLength(1));

    expect(harness.hook().workspacePackages).toEqual([
      {
        name: "@repo/api",
        relativeDirPath: "packages/api",
        status: "unresolved",
      },
    ]);
    expect(harness.hook().routes).toHaveLength(1);
    expect(harness.hook().truncated).toBe(false);
    harness.unmount();
  });

  it("does not present malformed-source uncertainty as truncated route results", async () => {
    const gateway = discovery({
      enumerateJavaScriptSourceFiles: vi.fn(async () => ({
        files: ["express-app.js", "server.js"],
        truncated: false,
        visited: 3,
      })),
      enumeratePackageJsonFiles: vi.fn(async () => ({
        files: ["package.json"],
        truncated: false,
        visited: 3,
      })),
      readSourceTextBounded: vi.fn(async (_root, path): Promise<BoundedWorkspaceSourceRead> => {
        if (path === "package.json") {
          return { status: "ok", content: '{"name":"watch-qa"}' };
        }
        if (path === "tsconfig.json") return { status: "notFound" };
        if (path === "express-app.js") {
          return {
            status: "ok",
            content:
              'const express=require("express"); const app=express(); app.get("/health", handler);',
          };
        }
        return { status: "ok", content: 'const http = require("http");\n}' };
      }),
    });
    const harness = renderRoutes({ gateway, isOpen: true });

    await waitForReact(() => expect(harness.hook().loading).toBe(false));

    expect(harness.hook().routes).toEqual([
      expect.objectContaining({
        packageLabel: "watch-qa",
        path: "/health",
        relativeFilePath: "express-app.js",
      }),
    ]);
    expect(harness.hook().truncated).toBe(false);
    harness.unmount();
  });

  it("skips malformed package manifests without failing route discovery", async () => {
    const gateway = discovery({
      enumerateJavaScriptSourceFiles: vi.fn(async () => ({
        files: ["apps/api/src/server.ts"],
        truncated: false,
        visited: 3,
      })),
      enumeratePackageJsonFiles: vi.fn(async () => ({
        files: ["apps/api/package.json"],
        truncated: false,
        visited: 3,
      })),
      readSourceTextBounded: vi.fn(async (_root, path) => ({
        status: "ok" as const,
        content: path === "apps/api/package.json" ? "{ malformed" : "app.get('/api', handler);",
      })),
    });
    const harness = renderRoutes({ gateway, isOpen: true });

    await waitForReact(() => expect(harness.hook().routes).toHaveLength(1));

    expect(harness.hook().routes[0]).toMatchObject({ path: "/api" });
    expect(harness.hook().routes[0]?.packageLabel).toBeUndefined();
    expect(harness.hook().error).toBeNull();
    harness.unmount();
  });

  it("retries changed once and reports omitted changed and oversized sources as truncated", async () => {
    const attempts = new Map<string, number>();
    const gateway = discovery({
      enumerateJavaScriptSourceFiles: vi.fn(async () => ({
        files: ["changed-once.ts", "always-changing.ts", "large.ts"],
        truncated: false,
        visited: 4,
      })),
      readSourceTextBounded: vi.fn(async (_root, path): Promise<BoundedWorkspaceSourceRead> => {
        const attempt = (attempts.get(path) ?? 0) + 1;
        attempts.set(path, attempt);
        if (path === "changed-once.ts") {
          return attempt === 1 ? { status: "changed" } : { status: "ok", content: ROUTE_A };
        }
        return path === "large.ts" ? { status: "tooLarge" } : { status: "changed" };
      }),
    });
    const harness = renderRoutes({ gateway, isOpen: true });

    await waitForReact(() => expect(harness.hook().loading).toBe(false));

    expect(harness.hook().routes).toHaveLength(1);
    expect(harness.hook().truncated).toBe(true);
    expect(attempts.get("changed-once.ts")).toBe(2);
    expect(attempts.get("always-changing.ts")).toBe(2);
    expect(attempts.get("large.ts")).toBe(1);
    harness.unmount();
  });

  it("drops stale A reads after switching to B and keeps caches isolated", async () => {
    const pendingA = deferred<{ files: readonly string[]; truncated: boolean; visited: number }>();
    const gateway = discovery({
      enumerateJavaScriptSourceFiles: vi.fn(async (rootPath) =>
        rootPath === ROOT_A ? pendingA.promise : { files: ["b.ts"], truncated: false, visited: 2 },
      ),
      readSourceTextBounded: vi.fn(async (rootPath): Promise<BoundedWorkspaceSourceRead> => ({
        status: "ok",
        content: rootPath === ROOT_A ? ROUTE_A : "app.get('/b', handler);",
      })),
    });
    const harness = renderRoutes({ gateway, isOpen: true });
    await waitForReact(() => expect(gateway.enumerateJavaScriptSourceFiles).toHaveBeenCalled());

    harness.set({ rootPath: ROOT_B, workspaceId: "workspace-b" });
    await waitForReact(() => expect(harness.hook().routes[0]?.path).toBe("/b"));
    await act(async () => pendingA.resolve({ files: ["a.ts"], truncated: false, visited: 2 }));

    expect(gateway.readSourceTextBounded).not.toHaveBeenCalledWith(
      ROOT_A,
      "a.ts",
      expect.anything(),
    );
    expect(harness.hook().routes.map((route) => route.path)).toEqual(["/b"]);

    harness.set({ rootPath: ROOT_A, workspaceId: "workspace-a" });
    await waitForReact(() => expect(harness.hook().routes[0]?.path).toBe("/a"));
    expect(gateway.enumerateJavaScriptSourceFiles).toHaveBeenCalledTimes(3);
    harness.unmount();
  });

  it("fences workspace packages across an A to B to A ownership switch", async () => {
    const gateway = discovery({
      enumerateJavaScriptSourceFiles: vi.fn(async (rootPath) => ({
        files: [`packages/${rootPath === ROOT_A ? "a" : "b"}/src/x.ts`],
        truncated: false,
        visited: 4,
      })),
      enumeratePackageJsonFiles: vi.fn(async (rootPath) => ({
        files: ["package.json", `packages/${rootPath === ROOT_A ? "a" : "b"}/package.json`],
        truncated: false,
        visited: 4,
      })),
      readSourceTextBounded: vi.fn(async (rootPath, path) => {
        if (path === "package.json") {
          return {
            status: "ok" as const,
            content: '{"name":"workspace","workspaces":["packages/*"]}',
          };
        }
        if (path.endsWith("package.json")) {
          return {
            status: "ok" as const,
            content: `{"name":"@repo/${rootPath === ROOT_A ? "a" : "b"}"}`,
          };
        }
        return { status: "ok" as const, content: "app.get('/route', handler);" };
      }),
    });
    const harness = renderRoutes({ gateway, isOpen: true });

    await waitForReact(() => expect(harness.hook().workspacePackages[0]?.name).toBe("@repo/a"));

    harness.set({ rootPath: ROOT_B, workspaceId: "workspace-b" });
    expect(harness.hook().workspacePackages).toEqual([]);
    await waitForReact(() => expect(harness.hook().workspacePackages[0]?.name).toBe("@repo/b"));

    harness.set({ rootPath: ROOT_A, workspaceId: "workspace-a" });
    expect(harness.hook().workspacePackages).toEqual([]);
    await waitForReact(() => expect(harness.hook().workspacePackages[0]?.name).toBe("@repo/a"));
    harness.unmount();
  });

  it("evicts prior workspace owners and rejects stale work after returning beyond the cache bound", async () => {
    const staleFirstA = deferred<{
      files: readonly string[];
      truncated: boolean;
      visited: number;
    }>();
    let aEnumerations = 0;
    const gateway = discovery({
      enumerateJavaScriptSourceFiles: vi.fn(async (rootPath) => {
        if (rootPath === ROOT_A && aEnumerations++ === 0) return staleFirstA.promise;
        return {
          files: [rootPath === ROOT_A ? "fresh-a.ts" : "route.ts"],
          truncated: false,
          visited: 2,
        };
      }),
      readSourceTextBounded: vi.fn(async (rootPath, path): Promise<BoundedWorkspaceSourceRead> => ({
        status: "ok",
        content: `app.get('${path === "fresh-a.ts" ? "/fresh-a" : rootPath}', handler);`,
      })),
    });
    const harness = renderRoutes({ gateway, isOpen: true });
    await waitForReact(() =>
      expect(gateway.enumerateJavaScriptSourceFiles).toHaveBeenCalledTimes(1),
    );

    for (let index = 1; index <= 6; index += 1) {
      const rootPath = `/workspace/${index}`;
      harness.set({ rootPath, workspaceId: `workspace-${index}` });
      await waitForReact(() => expect(harness.hook().routes[0]?.path).toBe(rootPath));
    }
    harness.set({ rootPath: ROOT_A, workspaceId: "workspace-a" });
    await waitForReact(() => expect(harness.hook().routes[0]?.path).toBe("/fresh-a"));

    await act(async () =>
      staleFirstA.resolve({ files: ["stale-a.ts"], truncated: false, visited: 2 }),
    );

    expect(gateway.enumerateJavaScriptSourceFiles).toHaveBeenCalledTimes(8);
    expect(gateway.readSourceTextBounded).not.toHaveBeenCalledWith(
      ROOT_A,
      "stale-a.ts",
      expect.anything(),
    );
    expect(harness.hook().routes[0]?.path).toBe("/fresh-a");
    harness.unmount();
  });

  it("refreshes cache-hit recency before evicting the least recently used workspace", async () => {
    const gateway = discovery({
      readSourceTextBounded: vi.fn(async (rootPath): Promise<BoundedWorkspaceSourceRead> => ({
        status: "ok",
        content: `app.get('${rootPath}', handler);`,
      })),
    });
    const harness = renderRoutes({ gateway, isOpen: true });
    await waitForReact(() => expect(harness.hook().routes[0]?.path).toBe(ROOT_A));

    for (const rootPath of [ROOT_B, "/workspace/c", "/workspace/d"]) {
      harness.set({ rootPath, workspaceId: rootPath });
      await waitForReact(() => expect(harness.hook().routes[0]?.path).toBe(rootPath));
    }
    expect(gateway.enumerateJavaScriptSourceFiles).toHaveBeenCalledTimes(4);

    harness.set({ rootPath: ROOT_A, workspaceId: "workspace-a" });
    await waitForReact(() => expect(harness.hook().routes[0]?.path).toBe(ROOT_A));
    expect(gateway.enumerateJavaScriptSourceFiles).toHaveBeenCalledTimes(4);

    harness.set({ rootPath: "/workspace/e", workspaceId: "workspace-e" });
    await waitForReact(() => expect(harness.hook().routes[0]?.path).toBe("/workspace/e"));
    expect(gateway.enumerateJavaScriptSourceFiles).toHaveBeenCalledTimes(5);

    harness.set({ rootPath: ROOT_A, workspaceId: "workspace-a" });
    await waitForReact(() => expect(harness.hook().routes[0]?.path).toBe(ROOT_A));
    expect(gateway.enumerateJavaScriptSourceFiles).toHaveBeenCalledTimes(5);

    harness.set({ rootPath: ROOT_B, workspaceId: "workspace-b" });
    await waitForReact(() => expect(harness.hook().routes[0]?.path).toBe(ROOT_B));
    expect(gateway.enumerateJavaScriptSourceFiles).toHaveBeenCalledTimes(6);
    harness.unmount();
  });

  it("coalesces invalidation, fences stale work immediately, and refreshes after reopen", async () => {
    vi.useFakeTimers();
    try {
      const gateway = discovery();
      const harness = renderRoutes({ gateway, isOpen: true });
      await act(async () => vi.runAllTimersAsync());
      await waitForReact(() => expect(harness.hook().routes).toHaveLength(1));
      expect(gateway.enumerateJavaScriptSourceFiles).toHaveBeenCalledTimes(1);

      harness.set({ discoveryVersion: 1 });
      harness.set({ discoveryVersion: 2 });
      expect(gateway.enumerateJavaScriptSourceFiles).toHaveBeenCalledTimes(1);
      await act(async () => vi.advanceTimersByTimeAsync(74));
      expect(gateway.enumerateJavaScriptSourceFiles).toHaveBeenCalledTimes(1);
      await act(async () => vi.advanceTimersByTimeAsync(1));
      await waitForReact(() =>
        expect(gateway.enumerateJavaScriptSourceFiles).toHaveBeenCalledTimes(2),
      );

      harness.set({ isOpen: false });
      await act(async () => harness.hook().refresh());
      expect(gateway.enumerateJavaScriptSourceFiles).toHaveBeenCalledTimes(2);
      harness.set({ isOpen: true });
      await waitForReact(() =>
        expect(gateway.enumerateJavaScriptSourceFiles).toHaveBeenCalledTimes(3),
      );
      harness.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rotates exact navigation authority for route snapshots and discovery revisions", async () => {
    const harness = renderRoutes({ gateway: discovery(), isOpen: true });
    await waitForReact(() => expect(harness.hook().navigationGeneration).not.toBeNull());
    const initialGeneration = harness.hook().navigationGeneration;

    harness.set({ isOpen: true });
    expect(harness.hook().navigationGeneration).toBe(initialGeneration);

    await act(async () => harness.hook().refresh());
    await waitForReact(() => {
      expect(harness.hook().navigationGeneration).not.toBeNull();
      expect(harness.hook().navigationGeneration).not.toBe(initialGeneration);
    });
    const refreshedGeneration = harness.hook().navigationGeneration;

    harness.set({ discoveryVersion: 1 });
    expect(harness.hook().navigationGeneration).toBeNull();
    await waitForReact(() => {
      expect(harness.hook().navigationGeneration).not.toBeNull();
      expect(harness.hook().navigationGeneration).not.toBe(refreshedGeneration);
    });
    harness.unmount();
  });

  it("updates coalesced dirty overlays without mutating cached disk routes or rediscovering", async () => {
    const gateway = discovery();
    const harness = renderRoutes({ gateway, isOpen: true });
    await waitForReact(() => expect(harness.hook().routes[0]?.path).toBe("/a"));
    const diskRoutes = harness.hook().routes;

    harness.set({
      dirtySnapshots: [
        { relativeFilePath: "src/a.ts", source: "app.patch('/dirty-a', handler);" },
        { relativeFilePath: "src/inactive.ts", source: "app.put('/dirty-b', handler);" },
      ],
    });

    await waitForReact(() =>
      expect(harness.hook().routes.map((route) => route.path)).toEqual(["/dirty-a", "/dirty-b"]),
    );
    expect(diskRoutes.map((route) => route.path)).toEqual(["/a"]);
    expect(gateway.enumerateJavaScriptSourceFiles).toHaveBeenCalledTimes(1);

    harness.set({ dirtySnapshots: [] });
    await waitForReact(() => expect(harness.hook().routes).toEqual(diskRoutes));
    harness.unmount();
  });

  it("coalesces rapid max-source edits and preserves unchanged row identity", async () => {
    const sources: Record<string, string> = {
      "src/a.ts": "app.get('/a', handler);",
      "src/b.ts": "app.get('/b', handler);",
    };
    const gateway = discovery({
      enumerateJavaScriptSourceFiles: vi.fn(async () => ({
        files: Object.keys(sources),
        truncated: false,
        visited: 3,
      })),
      readSourceTextBounded: vi.fn(async (_root, path) => ({
        status: "ok" as const,
        content: sources[path] ?? "",
      })),
    });
    const harness = renderRoutes({ gateway, isOpen: true });
    await waitForReact(() => expect(harness.hook().routes).toHaveLength(2));
    const originalA = harness.hook().routes.find(({ path }) => path === "/a");
    const originalB = harness.hook().routes.find(({ path }) => path === "/b");
    expect(originalA).toBeDefined();
    expect(originalB).toBeDefined();
    await waitForReact(() => expect(harness.hook().navigationGeneration).not.toBeNull());

    vi.useFakeTimers();
    try {
      const sourcePrefix = "app.get('/final', handler);\n";
      const maxSource = sourcePrefix + "x".repeat(128 * 1024 - sourcePrefix.length);
      for (let edit = 0; edit < 32; edit += 1) {
        harness.set({
          dirtySnapshots: [
            {
              relativeFilePath: "src/a.ts",
              source: edit === 31 ? maxSource : `app.get('/edit-${String(edit)}', handler);`,
            },
          ],
        });
      }

      expect(vi.getTimerCount()).toBe(1);
      expect(harness.hook().routes.find(({ path }) => path === "/a")).toBe(originalA);
      await act(async () => vi.advanceTimersByTimeAsync(74));
      expect(harness.hook().routes.find(({ path }) => path === "/a")).toBe(originalA);
      await act(async () => vi.advanceTimersByTimeAsync(1));

      expect(harness.hook().routes.find(({ path }) => path === "/final")).toBeDefined();
      expect(harness.hook().routes.find(({ path }) => path === "/b")).toBe(originalB);
      expect(expressRouteNavigationReceipt(originalA!)).toBeNull();
      expect(gateway.enumerateJavaScriptSourceFiles).toHaveBeenCalledTimes(1);
    } finally {
      harness.unmount();
      expect(expressRouteNavigationReceipt(originalB!)).toBeNull();
      vi.useRealTimers();
    }
  }, 10_000);

  it("reuses equal dirty inputs without timer loops or projection postponement", async () => {
    const harness = renderRoutes({ gateway: discovery(), isOpen: true });
    await waitForReact(() => expect(harness.hook().routes[0]?.path).toBe("/a"));

    vi.useFakeTimers();
    try {
      for (let render = 0; render < 32; render += 1) {
        harness.set({ dirtySnapshots: [] });
      }
      expect(vi.getTimerCount()).toBe(0);

      for (let render = 0; render < 32; render += 1) {
        harness.set({
          dirtySnapshots: [
            {
              relativeFilePath: "src/a.ts",
              source: "app.get('/stable-dirty', handler);",
            },
          ],
        });
      }
      expect(vi.getTimerCount()).toBe(1);
      await act(async () => vi.advanceTimersByTimeAsync(75));
      expect(harness.hook().routes[0]?.path).toBe("/stable-dirty");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      harness.unmount();
      vi.useRealTimers();
    }
  });

  it("scans and reparses only the changed file among sixteen bounded dirty snapshots", async () => {
    const onProjectionWork = vi.fn();
    const gateway = discovery({
      enumerateJavaScriptSourceFiles: vi.fn(async () => ({
        files: [],
        truncated: false,
        visited: 1,
      })),
    });
    const harness = renderRoutes({ gateway, isOpen: true, onProjectionWork });
    await waitForReact(() => expect(harness.hook().navigationGeneration).not.toBeNull());
    const boundedSourceBytes = 16 * 1024;
    const sourceFor = (path: string) => {
      const prefix = [
        "import { Router } from 'express';",
        "const router = Router();",
        `router.get('${path}', handler);`,
        "",
      ].join("\n");
      return prefix + "x".repeat(boundedSourceBytes - prefix.length);
    };
    const dirtySnapshots = Array.from({ length: 16 }, (_, index) => ({
      relativeFilePath: `src/dirty-${String(index)}.ts`,
      source: sourceFor(`/initial-${String(index)}`),
    }));

    vi.useFakeTimers();
    try {
      harness.set({ dirtySnapshots });
      await act(async () => vi.advanceTimersByTimeAsync(75));
      expect(
        onProjectionWork.mock.calls.filter(([work]) => work.kind === "source-scan"),
      ).toHaveLength(16);
      expect(onProjectionWork.mock.calls.filter(([work]) => work.kind === "parse")).toHaveLength(
        16,
      );

      onProjectionWork.mockClear();
      harness.set({
        dirtySnapshots: dirtySnapshots.map((snapshot, index) =>
          index === 15 ? { ...snapshot, source: sourceFor("/changed") } : snapshot,
        ),
      });
      await act(async () => vi.advanceTimersByTimeAsync(75));

      expect(onProjectionWork.mock.calls).toEqual([
        [
          {
            inspectedCodeUnits: boundedSourceBytes,
            kind: "source-scan",
            relativeFilePath: "src/dirty-15.ts",
          },
        ],
        [{ kind: "parse", relativeFilePath: "src/dirty-15.ts" }],
      ]);
      expect(harness.hook().routes).toHaveLength(16);
      expect(harness.hook().routes.map(({ path }) => path)).toContain("/changed");
      expect(harness.hook().routes.map(({ path }) => path)).not.toContain("/initial-15");
    } finally {
      harness.unmount();
      vi.useRealTimers();
    }
  }, 10_000);

  it("does not collapse dirty snapshots from different packages at the same path", async () => {
    const gateway = discovery({
      enumerateJavaScriptSourceFiles: vi.fn(async () => ({
        files: [],
        truncated: false,
        visited: 1,
      })),
    });
    const harness = renderRoutes({ gateway, isOpen: true });
    await waitForReact(() => expect(harness.hook().loading).toBe(false));

    harness.set({
      dirtySnapshots: [
        {
          packageLabel: "api-a",
          relativeFilePath: "src/routes.ts",
          source: "app.get('/a', handler);",
        },
        {
          packageLabel: "api-b",
          relativeFilePath: "src/routes.ts",
          source: "app.get('/b', handler);",
        },
      ],
    });

    await waitForReact(() =>
      expect(
        harness.hook().routes.map(({ packageLabel, path }) => ({ packageLabel, path })),
      ).toEqual([
        { packageLabel: "api-a", path: "/a" },
        { packageLabel: "api-b", path: "/b" },
      ]),
    );
    harness.unmount();
  });

  it("re-resolves cross-file mount paths when a mounted router is dirty", async () => {
    const sources: Record<string, string> = {
      "src/server.ts": [
        "import express from 'express';",
        "import users from './users';",
        "const app = express();",
        "app.use('/api', users);",
      ].join("\n"),
      "src/users.ts": [
        "import express from 'express';",
        "const users = express.Router();",
        "users.get('/old', handler);",
        "export default users;",
      ].join("\n"),
    };
    const gateway = discovery({
      enumerateJavaScriptSourceFiles: vi.fn(async () => ({
        files: Object.keys(sources),
        truncated: false,
        visited: 3,
      })),
      readSourceTextBounded: vi.fn(async (_root, path) => ({
        status: "ok" as const,
        content: sources[path] ?? "",
      })),
    });
    const harness = renderRoutes({ gateway, isOpen: true });
    await waitForReact(() =>
      expect(harness.hook().routes.some((route) => route.path === "/api/old")).toBe(true),
    );

    harness.set({
      dirtySnapshots: [
        {
          relativeFilePath: "src/users.ts",
          source: [
            "import express from 'express';",
            "const users = express.Router();",
            "users.post('/new', handler);",
            "export default users;",
          ].join("\n"),
        },
      ],
    });

    await waitForReact(() =>
      expect(harness.hook().routes.some((route) => route.path === "/api/old")).toBe(false),
    );
    expect(harness.hook().routes).toEqual(
      expect.arrayContaining([expect.objectContaining({ method: "POST", path: "/api/new" })]),
    );
    expect(gateway.enumerateJavaScriptSourceFiles).toHaveBeenCalledTimes(1);
    harness.unmount();
  });

  it("fails closed from the incremental path when a local import precedes an Express import", async () => {
    const onProjectionWork = vi.fn();
    const sources: Record<string, string> = {
      "src/app.ts": [
        "import express from 'express';",
        "import router from './router';",
        "const app = express();",
        "app.use('/api', router);",
      ].join("\n"),
      "src/augment.ts": [
        "import router from './router';",
        "import express from 'express';",
        "router.get('/old', handler);",
      ].join("\n"),
      "src/router.ts": [
        "import express from 'express';",
        "const router = express.Router();",
        "export default router;",
      ].join("\n"),
    };
    const gateway = discovery({
      enumerateJavaScriptSourceFiles: vi.fn(async () => ({
        files: Object.keys(sources),
        truncated: false,
        visited: 4,
      })),
      readSourceTextBounded: vi.fn(async (_root, path) => ({
        status: "ok" as const,
        content: sources[path] ?? "",
      })),
    });
    const harness = renderRoutes({ gateway, isOpen: true, onProjectionWork });
    await waitForReact(() =>
      expect(harness.hook().routes.some(({ path }) => path === "/old")).toBe(true),
    );
    onProjectionWork.mockClear();

    harness.set({
      dirtySnapshots: [
        {
          relativeFilePath: "src/augment.ts",
          source: [
            "import router from './router';",
            "import express from 'express';",
            "router.get('/new', handler);",
          ].join("\n"),
        },
      ],
    });

    await waitForReact(() =>
      expect(harness.hook().routes.some(({ path }) => path === "/new")).toBe(true),
    );
    expect(onProjectionWork.mock.calls.some(([work]) => work.kind === "parse")).toBe(false);
    expect(onProjectionWork.mock.calls).toContainEqual([
      expect.objectContaining({
        kind: "workspace-parse",
        snapshotCount: 3,
      }),
    ]);
    harness.unmount();
  });

  it("stops dirty admission after the aggregate prefix across two thousand large files", async () => {
    const onProjectionWork = vi.fn();
    const gateway = discovery({
      enumerateJavaScriptSourceFiles: vi.fn(async () => ({
        files: [],
        truncated: false,
        visited: 1,
      })),
    });
    const harness = renderRoutes({ gateway, isOpen: true, onProjectionWork });
    await waitForReact(() => expect(harness.hook().navigationGeneration).not.toBeNull());
    const prefix = "app.get('/bounded', handler);\n";
    const source = prefix + "x".repeat(256 * 1024 - prefix.length);

    harness.set({
      dirtySnapshots: Array.from({ length: 2_000 }, (_, index) => ({
        relativeFilePath: `src/${String(index).padStart(4, "0")}.ts`,
        source,
      })),
    });

    await waitForReact(() => expect(harness.hook().truncated).toBe(true));
    expect(onProjectionWork.mock.calls).toContainEqual([
      {
        kind: "workspace-parse",
        snapshotCount: 1,
        sourceBytes: 256 * 1024,
      },
    ]);
    const scans = onProjectionWork.mock.calls
      .map(([work]) => work)
      .filter(({ kind }) => kind === "source-scan");
    expect(scans).toHaveLength(2);
    expect(
      scans.reduce(
        (total, work) => total + (work.kind === "source-scan" ? work.inspectedCodeUnits : 0),
        0,
      ),
    ).toBe(512 * 1024);
    expect(harness.hook().routes).toHaveLength(1);
    harness.unmount();
  });

  it("resolves aliased mount paths from a comment-laden root tsconfig for disk and dirty routes", async () => {
    const excludedPaths = Array.from({ length: 4_096 }, (_, index) => `generated/${index}`);
    const sources: Record<string, string> = {
      "src/server.ts": [
        "import express from 'express';",
        "import users from '@/routes/users';",
        "const app = express();",
        "app.use('/api', users);",
      ].join("\n"),
      "src/routes/users.ts": [
        "import express from 'express';",
        "const users = express.Router();",
        "users.get('/saved', handler);",
        "export default users;",
      ].join("\n"),
    };
    const gateway = discovery({
      enumerateJavaScriptSourceFiles: vi.fn(async () => ({
        files: Object.keys(sources),
        truncated: false,
        visited: 3,
      })),
      readSourceTextBounded: vi.fn(async (_root, path) => ({
        status: "ok" as const,
        content:
          path === "tsconfig.json"
            ? `{
                // Root aliases drive Express import resolution.
                "exclude": ${JSON.stringify(excludedPaths)},
                "compilerOptions": {
                  "baseUrl": ".",
                  "paths": { "@/routes/*": ["src/routes/*"], },
                },
              }`
            : (sources[path] ?? ""),
      })),
    });
    const harness = renderRoutes({ gateway, isOpen: true });

    await waitForReact(() => expect(harness.hook().routes[0]?.path).toBe("/api/saved"));

    expect(gateway.readSourceTextBounded).toHaveBeenCalledWith(ROOT_A, "tsconfig.json", 262_144);

    harness.set({
      dirtySnapshots: [
        {
          relativeFilePath: "src/routes/users.ts",
          source: [
            "import express from 'express';",
            "const users = express.Router();",
            "users.post('/dirty', handler);",
            "export default users;",
          ].join("\n"),
        },
      ],
    });

    await waitForReact(() =>
      expect(harness.hook().routes).toEqual(
        expect.arrayContaining([expect.objectContaining({ method: "POST", path: "/api/dirty" })]),
      ),
    );
    harness.unmount();
  });

  it("isolates identical aliases through each package tsconfig for disk and dirty routes", async () => {
    const sources: Record<string, string> = {
      "packages/api/src/app.ts": [
        "import express from 'express';",
        "import users from '@routes';",
        "const app = express();",
        "app.use('/api', users);",
      ].join("\n"),
      "packages/api/src/routes.ts": [
        "import express from 'express';",
        "const users = express.Router();",
        "users.get('/saved', handler);",
        "export default users;",
      ].join("\n"),
      "packages/admin/src/app.ts": [
        "import express from 'express';",
        "import users from '@routes';",
        "const app = express();",
        "app.use('/admin', users);",
      ].join("\n"),
      "packages/admin/src/routes.ts": [
        "import express from 'express';",
        "const users = express.Router();",
        "users.get('/saved', handler);",
        "export default users;",
      ].join("\n"),
    };
    const gateway = discovery({
      enumerateJavaScriptSourceFiles: vi.fn(async () => ({
        files: Object.keys(sources),
        truncated: false,
        visited: 5,
      })),
      enumeratePackageJsonFiles: vi.fn(async () => ({
        files: ["packages/api/package.json", "packages/admin/package.json"],
        truncated: false,
        visited: 5,
      })),
      readSourceTextBounded: vi.fn(async (_root, path) => {
        if (path === "packages/api/package.json") {
          return { status: "ok" as const, content: '{"name":"api"}' };
        }
        if (path === "packages/admin/package.json") {
          return { status: "ok" as const, content: '{"name":"admin"}' };
        }
        if (path === "tsconfig.json") {
          return {
            status: "ok" as const,
            content: '{"compilerOptions":{"paths":{"@root":["src/root"]}}}',
          };
        }
        if (path.endsWith("/tsconfig.json")) {
          return {
            status: "ok" as const,
            content: '{"compilerOptions":{"baseUrl":".","paths":{"@routes":["src/routes"]}}}',
          };
        }
        return { status: "ok" as const, content: sources[path] ?? "" };
      }),
    });
    const harness = renderRoutes({ gateway, isOpen: true });

    await waitForReact(() =>
      expect(
        harness
          .hook()
          .routes.filter(({ method }) => method === "GET")
          .map(({ packageLabel, path }) => ({ packageLabel, path })),
      ).toEqual([
        { packageLabel: "admin", path: "/admin/saved" },
        { packageLabel: "api", path: "/api/saved" },
      ]),
    );
    expect(gateway.readSourceTextBounded).toHaveBeenCalledWith(
      ROOT_A,
      "packages/api/tsconfig.json",
      262_144,
    );
    expect(gateway.readSourceTextBounded).toHaveBeenCalledWith(
      ROOT_A,
      "packages/admin/tsconfig.json",
      262_144,
    );

    harness.set({
      dirtySnapshots: [
        {
          relativeFilePath: "packages/api/src/routes.ts",
          source: [
            "import express from 'express';",
            "const users = express.Router();",
            "users.post('/dirty', handler);",
            "export default users;",
          ].join("\n"),
        },
      ],
    });

    await waitForReact(() =>
      expect(
        harness
          .hook()
          .routes.filter(({ method }) => method === "GET" || method === "POST")
          .map(({ packageLabel, method, path }) => ({
            packageLabel,
            method,
            path,
          })),
      ).toEqual([
        { packageLabel: "admin", method: "GET", path: "/admin/saved" },
        { packageLabel: "api", method: "POST", path: "/api/dirty" },
      ]),
    );
    expect(harness.hook().routes.some(({ path }) => path === "/admin/dirty")).toBe(false);
    harness.unmount();
  });

  it("resolves a bare workspace package mount to its TypeScript source entry", async () => {
    const sources: Record<string, string> = {
      "apps/api/src/app.ts": [
        "const express = require('express');",
        "const app = express();",
        "const orders = require('@repo/orders');",
        "app.use('/orders', orders);",
      ].join("\n"),
      "packages/orders/src/index.ts": [
        "const express = require('express');",
        "const router = express.Router();",
        "router.get('/active', handler);",
        "module.exports = router;",
      ].join("\n"),
    };
    const manifests: Record<string, string> = {
      "apps/api/package.json": '{"name":"@repo/api"}',
      "package.json": '{"private":true,"workspaces":["apps/*","packages/*"]}',
      "packages/orders/package.json":
        '{"name":"@repo/orders","exports":{".":{"source":"./src/index.ts","default":"./dist/index.js"}}}',
    };
    const gateway = discovery({
      enumerateJavaScriptSourceFiles: vi.fn(async () => ({
        files: Object.keys(sources),
        truncated: false,
        visited: 3,
      })),
      enumeratePackageJsonFiles: vi.fn(async () => ({
        files: Object.keys(manifests),
        truncated: false,
        visited: 4,
      })),
      readSourceTextBounded: vi.fn(async (_root, path) => {
        if (path in manifests) {
          return { status: "ok" as const, content: manifests[path] ?? "" };
        }
        if (path === "pnpm-workspace.yaml" || path.endsWith("tsconfig.json")) {
          return { status: "notFound" as const };
        }
        return { status: "ok" as const, content: sources[path] ?? "" };
      }),
    });
    const harness = renderRoutes({ gateway, isOpen: true });

    await waitForReact(() => expect(harness.hook().loading).toBe(false));

    expect(harness.hook().routes).toContainEqual(
      expect.objectContaining({
        method: "GET",
        path: "/orders/active",
        relativeFilePath: "packages/orders/src/index.ts",
      }),
    );
    expect(harness.hook().truncated).toBe(false);
    harness.unmount();
  });

  it("builds a pnpm package graph without a root package.json", async () => {
    const sources: Record<string, string> = {
      "apps/api/src/app.ts": [
        "const express = require('express');",
        "const app = express();",
        "const orders = require('@repo/orders');",
        "app.use('/orders', orders);",
      ].join("\n"),
      "packages/orders/index.js": [
        "const express = require('express');",
        "const router = express.Router();",
        "router.get('/active', handler);",
        "module.exports = router;",
      ].join("\n"),
    };
    const manifests: Record<string, string> = {
      "apps/api/package.json": '{"name":"@repo/api"}',
      "packages/orders/package.json": '{"name":"@repo/orders","main":"index.js"}',
    };
    const gateway = discovery({
      enumerateJavaScriptSourceFiles: vi.fn(async () => ({
        files: Object.keys(sources),
        truncated: false,
        visited: 2,
      })),
      enumeratePackageJsonFiles: vi.fn(async () => ({
        files: Object.keys(manifests),
        truncated: false,
        visited: 2,
      })),
      readSourceTextBounded: vi.fn(async (_root, path) => {
        if (path === "pnpm-workspace.yaml") {
          return { status: "ok" as const, content: "packages:\n- 'apps/*'\n- 'packages/*'\n" };
        }
        if (path in manifests) {
          return { status: "ok" as const, content: manifests[path] ?? "" };
        }
        if (path.endsWith("tsconfig.json")) return { status: "notFound" as const };
        return { status: "ok" as const, content: sources[path] ?? "" };
      }),
    });
    const harness = renderRoutes({ gateway, isOpen: true });

    await waitForReact(() => expect(harness.hook().loading).toBe(false));

    expect(harness.hook().routes).toContainEqual(
      expect.objectContaining({
        path: "/orders/active",
        relativeFilePath: "packages/orders/index.js",
      }),
    );
    expect(harness.hook().truncated).toBe(false);
    harness.unmount();
  });

  it("does not resolve package mounts from a truncated source enumeration", async () => {
    const sources: Record<string, string> = {
      "apps/api/src/app.ts": [
        "const express = require('express');",
        "const app = express();",
        "const orders = require('@repo/orders');",
        "app.use('/orders', orders);",
      ].join("\n"),
      "packages/orders/index.js": [
        "const express = require('express');",
        "const router = express.Router();",
        "router.get('/active', handler);",
        "module.exports = router;",
      ].join("\n"),
    };
    const manifests: Record<string, string> = {
      "package.json": '{"workspaces":["apps/*","packages/*"]}',
      "apps/api/package.json": '{"name":"@repo/api"}',
      "packages/orders/package.json": '{"name":"@repo/orders","main":"index.js"}',
    };
    const gateway = discovery({
      enumerateJavaScriptSourceFiles: vi.fn(async () => ({
        files: Object.keys(sources),
        truncated: true,
        visited: 50_000,
      })),
      enumeratePackageJsonFiles: vi.fn(async () => ({
        files: Object.keys(manifests),
        truncated: false,
        visited: 3,
      })),
      readSourceTextBounded: vi.fn(async (_root, path) => {
        if (path in manifests) {
          return { status: "ok" as const, content: manifests[path] ?? "" };
        }
        if (path === "pnpm-workspace.yaml" || path.endsWith("tsconfig.json")) {
          return { status: "notFound" as const };
        }
        return { status: "ok" as const, content: sources[path] ?? "" };
      }),
    });
    const harness = renderRoutes({ gateway, isOpen: true });

    await waitForReact(() => expect(harness.hook().loading).toBe(false));

    expect(harness.hook().routes).not.toContainEqual(
      expect.objectContaining({ path: "/orders/active" }),
    );
    expect(harness.hook().truncated).toBe(true);
    harness.unmount();
  });

  it("uses root aliases when a package config is confirmed missing", async () => {
    const sources: Record<string, string> = {
      "packages/api/src/app.ts": [
        "import express from 'express';",
        "import users from '@workspace-routes';",
        "const app = express();",
        "app.use('/api', users);",
      ].join("\n"),
      "packages/api/src/routes.ts": [
        "import express from 'express';",
        "const users = express.Router();",
        "users.get('/users', handler);",
        "export default users;",
      ].join("\n"),
    };
    const gateway = discovery({
      enumerateJavaScriptSourceFiles: vi.fn(async () => ({
        files: Object.keys(sources),
        truncated: false,
        visited: 3,
      })),
      enumeratePackageJsonFiles: vi.fn(async () => ({
        files: ["packages/api/package.json"],
        truncated: false,
        visited: 3,
      })),
      readSourceTextBounded: vi.fn(async (_root, path) => {
        if (path === "packages/api/package.json") {
          return { status: "ok" as const, content: '{"name":"api"}' };
        }
        if (path === "tsconfig.json") {
          return {
            status: "ok" as const,
            content:
              '{"compilerOptions":{"paths":{"@workspace-routes":["packages/api/src/routes"]}}}',
          };
        }
        if (path === "packages/api/tsconfig.json") {
          return { status: "notFound" as const };
        }
        return { status: "ok" as const, content: sources[path] ?? "" };
      }),
    });
    const harness = renderRoutes({ gateway, isOpen: true });

    await waitForReact(() => expect(harness.hook().loading).toBe(false));
    expect(
      harness.hook().routes.some(({ method, path }) => method === "GET" && path === "/api/users"),
    ).toBe(true);
    expect(
      harness.hook().routes.find(({ method, path }) => method === "GET" && path === "/api/users")
        ?.packageLabel,
    ).toBe("api");
    expect(harness.hook().truncated).toBe(false);
    expect(gateway.readSourceTextBounded).toHaveBeenCalledWith(
      ROOT_A,
      "packages/api/tsconfig.json",
      256 * 1024,
    );
    expect(
      gateway.readSourceTextBounded.mock.calls.filter(
        ([, relativePath]) => relativePath === "packages/api/tsconfig.json",
      ),
    ).toHaveLength(1);
    harness.unmount();
  });

  it("does not merge root aliases into an authoritative package config", async () => {
    const sources: Record<string, string> = {
      "packages/api/src/app.ts": [
        "import express from 'express';",
        "import users from '@workspace-routes';",
        "const app = express();",
        "app.use('/api', users);",
      ].join("\n"),
      "packages/api/src/routes.ts": [
        "import express from 'express';",
        "const users = express.Router();",
        "users.get('/users', handler);",
        "export default users;",
      ].join("\n"),
    };
    const gateway = discovery({
      enumerateJavaScriptSourceFiles: vi.fn(async () => ({
        files: Object.keys(sources),
        truncated: false,
        visited: 3,
      })),
      enumeratePackageJsonFiles: vi.fn(async () => ({
        files: ["packages/api/package.json"],
        truncated: false,
        visited: 3,
      })),
      readSourceTextBounded: vi.fn(async (_root, path) => {
        if (path === "packages/api/package.json") {
          return { status: "ok" as const, content: '{"name":"api"}' };
        }
        if (path === "tsconfig.json") {
          return {
            status: "ok" as const,
            content:
              '{"compilerOptions":{"paths":{"@workspace-routes":["packages/api/src/routes"]}}}',
          };
        }
        if (path === "packages/api/tsconfig.json") {
          return {
            status: "ok" as const,
            content: '{"compilerOptions":{"paths":{"@package-only":["src/other"]}}}',
          };
        }
        return { status: "ok" as const, content: sources[path] ?? "" };
      }),
    });
    const harness = renderRoutes({ gateway, isOpen: true });

    await waitForReact(() => expect(harness.hook().loading).toBe(false));

    expect(
      harness.hook().routes.some(({ method, path }) => method === "GET" && path === "/api/users"),
    ).toBe(false);
    expect(
      harness.hook().routes.some(({ method, path }) => method === "GET" && path === "/users"),
    ).toBe(true);
    harness.unmount();
  });

  it("inherits aliases only through an explicit relative extends chain with baseUrl provenance", async () => {
    const sources: Record<string, string> = {
      "packages/api/src/app.ts": [
        "import express from 'express';",
        "import users from '@routes';",
        "const app = express();",
        "app.use('/api', users);",
      ].join("\n"),
      "packages/api/src/routes.ts": [
        "import express from 'express';",
        "const users = express.Router();",
        "users.get('/users', handler);",
        "export default users;",
      ].join("\n"),
    };
    const gateway = discovery({
      enumerateJavaScriptSourceFiles: vi.fn(async () => ({
        files: Object.keys(sources),
        truncated: false,
        visited: 3,
      })),
      enumeratePackageJsonFiles: vi.fn(async () => ({
        files: ["packages/api/package.json"],
        truncated: false,
        visited: 3,
      })),
      readSourceTextBounded: vi.fn(async (_root, path) => {
        if (path === "packages/api/package.json") {
          return { status: "ok" as const, content: '{"name":"api"}' };
        }
        if (path === "tsconfig.json") {
          return {
            status: "ok" as const,
            content: '{"compilerOptions":{"baseUrl":"packages/api"}}',
          };
        }
        if (path === "packages/api/tsconfig.json") {
          return {
            status: "ok" as const,
            content:
              '{"extends":"../../tsconfig.json","compilerOptions":{"paths":{"@routes":["src/routes"]}}}',
          };
        }
        return { status: "ok" as const, content: sources[path] ?? "" };
      }),
    });
    const harness = renderRoutes({ gateway, isOpen: true });

    await waitForReact(() =>
      expect(
        harness.hook().routes.some(({ method, path }) => method === "GET" && path === "/api/users"),
      ).toBe(true),
    );
    expect(harness.hook().truncated).toBe(false);
    harness.unmount();
  });

  it("fails closed for a relative extends cycle instead of falling through to root aliases", async () => {
    const sources: Record<string, string> = {
      "packages/a/src/app.ts": [
        "import express from 'express';",
        "import users from '@routes';",
        "const app = express();",
        "app.use('/api', users);",
      ].join("\n"),
      "packages/a/src/routes.ts": [
        "import express from 'express';",
        "const users = express.Router();",
        "users.get('/users', handler);",
        "export default users;",
      ].join("\n"),
    };
    const gateway = discovery({
      enumerateJavaScriptSourceFiles: vi.fn(async () => ({
        files: Object.keys(sources),
        truncated: false,
        visited: 3,
      })),
      enumeratePackageJsonFiles: vi.fn(async () => ({
        files: ["packages/a/package.json", "packages/b/package.json"],
        truncated: false,
        visited: 4,
      })),
      readSourceTextBounded: vi.fn(async (_root, path) => {
        if (path.endsWith("/package.json")) {
          return {
            status: "ok" as const,
            content: JSON.stringify({ name: path.includes("/a/") ? "a" : "b" }),
          };
        }
        if (path === "tsconfig.json") {
          return {
            status: "ok" as const,
            content: '{"compilerOptions":{"paths":{"@routes":["packages/a/src/routes"]}}}',
          };
        }
        if (path === "packages/a/tsconfig.json") {
          return { status: "ok" as const, content: '{"extends":"../b/tsconfig.json"}' };
        }
        if (path === "packages/b/tsconfig.json") {
          return { status: "ok" as const, content: '{"extends":"../a/tsconfig.json"}' };
        }
        return { status: "ok" as const, content: sources[path] ?? "" };
      }),
    });
    const harness = renderRoutes({ gateway, isOpen: true });

    await waitForReact(() => expect(harness.hook().loading).toBe(false));

    expect(
      harness.hook().routes.some(({ method, path }) => method === "GET" && path === "/api/users"),
    ).toBe(false);
    expect(harness.hook().truncated).toBe(true);
    harness.unmount();
  });

  it("uses a nameless valid manifest directory as alias authority without inventing a label", async () => {
    const sources: Record<string, string> = {
      "packages/api/src/app.ts": [
        "import express from 'express';",
        "import users from '@routes';",
        "const app = express();",
        "app.use('/api', users);",
      ].join("\n"),
      "packages/api/src/routes.ts": [
        "import express from 'express';",
        "const users = express.Router();",
        "users.get('/users', handler);",
        "export default users;",
      ].join("\n"),
    };
    const gateway = discovery({
      enumerateJavaScriptSourceFiles: vi.fn(async () => ({
        files: Object.keys(sources),
        truncated: false,
        visited: 3,
      })),
      enumeratePackageJsonFiles: vi.fn(async () => ({
        files: ["packages/api/package.json"],
        truncated: false,
        visited: 3,
      })),
      readSourceTextBounded: vi.fn(async (_root, path) => {
        if (path === "packages/api/package.json") {
          return { status: "ok" as const, content: '{"private":true}' };
        }
        if (path === "tsconfig.json") return { status: "ok" as const, content: "{}" };
        if (path === "packages/api/tsconfig.json") {
          return {
            status: "ok" as const,
            content: '{"compilerOptions":{"baseUrl":".","paths":{"@routes":["src/routes"]}}}',
          };
        }
        return { status: "ok" as const, content: sources[path] ?? "" };
      }),
    });
    const harness = renderRoutes({ gateway, isOpen: true });

    await waitForReact(() =>
      expect(
        harness.hook().routes.some(({ method, path }) => method === "GET" && path === "/api/users"),
      ).toBe(true),
    );
    expect(
      harness.hook().routes.find(({ method }) => method === "GET")?.packageLabel,
    ).toBeUndefined();
    harness.unmount();
  });

  it.each([
    ["malformed", { status: "ok", content: "{ malformed" } as const],
    ["oversized", { status: "tooLarge" } as const],
    ["confirmed-missing", { status: "notFound" } as const],
    ["changed-twice", { status: "changed" } as const],
  ])(
    "tombstones %s manifest ownership so root aliases cannot leak",
    async (_label, manifestRead) => {
      const sources: Record<string, string> = {
        "packages/api/src/app.ts": [
          "import express from 'express';",
          "import users from '@routes';",
          "const app = express();",
          "app.use('/api', users);",
        ].join("\n"),
        "packages/api/src/routes.ts": [
          "import express from 'express';",
          "const users = express.Router();",
          "users.get('/users', handler);",
          "export default users;",
        ].join("\n"),
      };
      const gateway = discovery({
        enumerateJavaScriptSourceFiles: vi.fn(async () => ({
          files: Object.keys(sources),
          truncated: false,
          visited: 3,
        })),
        enumeratePackageJsonFiles: vi.fn(async () => ({
          files: ["packages/api/package.json"],
          truncated: false,
          visited: 3,
        })),
        readSourceTextBounded: vi.fn(async (_root, path) => {
          if (path === "packages/api/package.json") return manifestRead;
          if (path === "tsconfig.json") {
            return {
              status: "ok" as const,
              content: '{"compilerOptions":{"paths":{"@routes":["packages/api/src/routes"]}}}',
            };
          }
          return { status: "ok" as const, content: sources[path] ?? "" };
        }),
      });
      const harness = renderRoutes({ gateway, isOpen: true });

      await waitForReact(() => expect(harness.hook().loading).toBe(false));

      expect(
        harness.hook().routes.some(({ method, path }) => method === "GET" && path === "/api/users"),
      ).toBe(false);
      expect(harness.hook().truncated).toBe(true);
      harness.unmount();
    },
  );

  it("tombstones package authorities omitted by the aggregate manifest byte budget", async () => {
    const packageDirectories = Array.from({ length: 17 }, (_, index) => `packages/p${index}`);
    const manifests = new Map(
      packageDirectories.map((directory) => [
        `${directory}/package.json`,
        JSON.stringify({
          name: directory.slice("packages/".length),
          padding: "x".repeat(262_000),
        }),
      ]),
    );
    const sources: Record<string, string> = {
      "packages/p16/src/app.ts": [
        "import express from 'express';",
        "import users from '@routes';",
        "const app = express();",
        "app.use('/api', users);",
      ].join("\n"),
      "packages/p16/src/routes.ts": [
        "import express from 'express';",
        "const users = express.Router();",
        "users.get('/users', handler);",
        "export default users;",
      ].join("\n"),
    };
    const gateway = discovery({
      enumerateJavaScriptSourceFiles: vi.fn(async () => ({
        files: Object.keys(sources),
        truncated: false,
        visited: 3,
      })),
      enumeratePackageJsonFiles: vi.fn(async () => ({
        files: [...manifests.keys()],
        truncated: false,
        visited: manifests.size + 1,
      })),
      readSourceTextBounded: vi.fn(async (_root, path) => {
        const manifest = manifests.get(path);
        if (manifest !== undefined) return { status: "ok" as const, content: manifest };
        if (path === "tsconfig.json") {
          return {
            status: "ok" as const,
            content: '{"compilerOptions":{"paths":{"@routes":["packages/p16/src/routes"]}}}',
          };
        }
        if (path.endsWith("/tsconfig.json")) return { status: "ok" as const, content: "{}" };
        return { status: "ok" as const, content: sources[path] ?? "" };
      }),
    });
    const harness = renderRoutes({ gateway, isOpen: true });

    await waitForReact(() => expect(harness.hook().loading).toBe(false));

    expect(
      harness.hook().routes.some(({ method, path }) => method === "GET" && path === "/api/users"),
    ).toBe(false);
    expect(harness.hook().truncated).toBe(true);
    expect(gateway.readSourceTextBounded).not.toHaveBeenCalledWith(
      ROOT_A,
      "packages/p16/package.json",
      262_144,
    );
    expect(gateway.readSourceTextBounded).not.toHaveBeenCalledWith(
      ROOT_A,
      "packages/p16/tsconfig.json",
      262_144,
    );
    harness.unmount();
  });

  it.each([
    ["invalid path", ["packages/api/../api/package.json"], 0],
    [
      "adapter overflow",
      Array.from({ length: 257 }, (_, index) => `packages/other-${index}/package.json`),
      256,
    ],
  ])(
    "disables unscoped root aliases for uncertain %s enumeration",
    async (_label, files, expectedManifestReads) => {
      const sources: Record<string, string> = {
        "packages/api/src/app.ts": [
          "import express from 'express';",
          "import users from '@routes';",
          "const app = express();",
          "app.use('/api', users);",
        ].join("\n"),
        "packages/api/src/routes.ts": [
          "import express from 'express';",
          "const users = express.Router();",
          "users.get('/users', handler);",
          "export default users;",
        ].join("\n"),
      };
      const gateway = discovery({
        enumerateJavaScriptSourceFiles: vi.fn(async () => ({
          files: Object.keys(sources),
          truncated: false,
          visited: 3,
        })),
        enumeratePackageJsonFiles: vi.fn(async () => ({
          files,
          truncated: false,
          visited: files.length + 1,
        })),
        readSourceTextBounded: vi.fn(async (_root, path) => {
          if (path.endsWith("/package.json")) {
            return { status: "ok" as const, content: "{ malformed" };
          }
          if (path === "tsconfig.json") {
            return {
              status: "ok" as const,
              content: '{"compilerOptions":{"paths":{"@routes":["packages/api/src/routes"]}}}',
            };
          }
          if (path.endsWith("/tsconfig.json")) return { status: "ok" as const, content: "{}" };
          return { status: "ok" as const, content: sources[path] ?? "" };
        }),
      });
      const harness = renderRoutes({ gateway, isOpen: true });

      await waitForReact(() => expect(harness.hook().loading).toBe(false));

      expect(
        harness.hook().routes.some(({ method, path }) => method === "GET" && path === "/api/users"),
      ).toBe(false);
      expect(harness.hook().truncated).toBe(true);
      expect(
        gateway.readSourceTextBounded.mock.calls.filter(
          ([, path]) => typeof path === "string" && path.endsWith("/package.json"),
        ),
      ).toHaveLength(expectedManifestReads);
      harness.unmount();
    },
  );

  it("drops a stale manifest batch before config or source discovery can publish", async () => {
    const pendingManifest = deferred<BoundedWorkspaceSourceRead>();
    const packageFiles = Array.from({ length: 9 }, (_, index) => `packages/p${index}/package.json`);
    const gateway = discovery({
      enumerateJavaScriptSourceFiles: vi.fn(async (rootPath) => ({
        files: [rootPath === ROOT_A ? "a.ts" : "b.ts"],
        truncated: false,
        visited: 2,
      })),
      enumeratePackageJsonFiles: vi.fn(async (rootPath) => ({
        files: rootPath === ROOT_A ? packageFiles : [],
        truncated: false,
        visited: rootPath === ROOT_A ? 10 : 1,
      })),
      readSourceTextBounded: vi.fn(async (rootPath, path) => {
        if (rootPath === ROOT_A && path === "packages/p8/package.json") {
          return pendingManifest.promise;
        }
        if (path.endsWith("/package.json")) {
          return { status: "ok" as const, content: '{"name":"package"}' };
        }
        if (path.endsWith("tsconfig.json")) return { status: "ok" as const, content: "{}" };
        return {
          status: "ok" as const,
          content: path === "b.ts" ? "app.get('/b', handler);" : "app.get('/a', handler);",
        };
      }),
    });
    const harness = renderRoutes({ gateway, isOpen: true });

    await waitForReact(() =>
      expect(gateway.readSourceTextBounded).toHaveBeenCalledWith(
        ROOT_A,
        "packages/p8/package.json",
        262_144,
      ),
    );
    harness.set({ rootPath: ROOT_B, workspaceId: "workspace-b" });
    await act(async () => pendingManifest.resolve({ status: "ok", content: '{"name":"stale"}' }));
    await waitForReact(() => expect(harness.hook().routes.map(({ path }) => path)).toEqual(["/b"]));

    expect(gateway.readSourceTextBounded).not.toHaveBeenCalledWith(ROOT_A, "a.ts", 262_144);
    harness.unmount();
  });

  it("disables unscoped root aliases when package enumeration is truncated", async () => {
    const sources: Record<string, string> = {
      "packages/omitted/src/app.ts": [
        "import express from 'express';",
        "import users from '@routes';",
        "const app = express();",
        "app.use('/api', users);",
      ].join("\n"),
      "packages/omitted/src/routes.ts": [
        "import express from 'express';",
        "const users = express.Router();",
        "users.get('/users', handler);",
        "export default users;",
      ].join("\n"),
    };
    const gateway = discovery({
      enumerateJavaScriptSourceFiles: vi.fn(async () => ({
        files: Object.keys(sources),
        truncated: false,
        visited: 3,
      })),
      enumeratePackageJsonFiles: vi.fn(async () => ({
        files: [],
        truncated: true,
        visited: 50_000,
      })),
      readSourceTextBounded: vi.fn(async (_root, path) => ({
        status: "ok" as const,
        content:
          path === "tsconfig.json"
            ? '{"compilerOptions":{"paths":{"@routes":["packages/omitted/src/routes"]}}}'
            : (sources[path] ?? ""),
      })),
    });
    const harness = renderRoutes({ gateway, isOpen: true });

    await waitForReact(() => expect(harness.hook().loading).toBe(false));

    expect(
      harness.hook().routes.some(({ method, path }) => method === "GET" && path === "/api/users"),
    ).toBe(false);
    expect(harness.hook().truncated).toBe(true);
    harness.unmount();
  });

  it("fails closed for malformed and oversized package configs and reports incomplete reads", async () => {
    const sources: Record<string, string> = {
      "packages/api/src/app.ts": [
        "import express from 'express';",
        "import users from '@routes';",
        "const app = express();",
        "app.use('/api', users);",
      ].join("\n"),
      "packages/api/src/routes.ts": [
        "import express from 'express';",
        "const users = express.Router();",
        "users.get('/users', handler);",
        "export default users;",
      ].join("\n"),
      "packages/admin/src/app.ts": [
        "import express from 'express';",
        "import users from '@routes';",
        "const app = express();",
        "app.use('/admin', users);",
      ].join("\n"),
      "packages/admin/src/routes.ts": [
        "import express from 'express';",
        "const users = express.Router();",
        "users.get('/users', handler);",
        "export default users;",
      ].join("\n"),
    };
    const gateway = discovery({
      enumerateJavaScriptSourceFiles: vi.fn(async () => ({
        files: Object.keys(sources),
        truncated: false,
        visited: 5,
      })),
      enumeratePackageJsonFiles: vi.fn(async () => ({
        files: ["packages/api/package.json", "packages/admin/package.json"],
        truncated: false,
        visited: 5,
      })),
      readSourceTextBounded: vi.fn(async (_root, path): Promise<BoundedWorkspaceSourceRead> => {
        if (path.endsWith("package.json")) {
          return {
            status: "ok",
            content: JSON.stringify({ name: path.includes("/api/") ? "api" : "admin" }),
          };
        }
        if (path === "tsconfig.json") {
          return {
            status: "ok",
            content: '{"compilerOptions":{"paths":{"@routes":["packages/api/src/routes"]}}}',
          };
        }
        if (path === "packages/api/tsconfig.json") {
          return { status: "ok", content: "{ malformed" };
        }
        if (path === "packages/admin/tsconfig.json") return { status: "tooLarge" };
        return { status: "ok", content: sources[path] ?? "" };
      }),
    });
    const harness = renderRoutes({ gateway, isOpen: true });

    await waitForReact(() => expect(harness.hook().loading).toBe(false));

    expect(
      harness
        .hook()
        .routes.filter(({ method }) => method === "GET")
        .map(({ path }) => path),
    ).toEqual(["/users", "/users"]);
    expect(
      harness
        .hook()
        .routes.some(({ method, path }) => method === "GET" && path.startsWith("/api/")),
    ).toBe(false);
    expect(
      harness
        .hook()
        .routes.some(({ method, path }) => method === "GET" && path.startsWith("/admin/")),
    ).toBe(false);
    expect(harness.hook().error).toBeNull();
    expect(harness.hook().truncated).toBe(true);
    harness.unmount();
  });

  it("surfaces a truncated package alias configuration", async () => {
    const paths = Object.fromEntries(
      Array.from({ length: 257 }, (_, index) => [`@alias-${index}`, [`src/alias-${index}`]]),
    );
    const gateway = discovery({
      enumeratePackageJsonFiles: vi.fn(async () => ({
        files: ["packages/api/package.json"],
        truncated: false,
        visited: 2,
      })),
      readSourceTextBounded: vi.fn(async (_root, path) => {
        if (path === "packages/api/package.json") {
          return { status: "ok" as const, content: '{"name":"api"}' };
        }
        if (path === "packages/api/tsconfig.json") {
          return {
            status: "ok" as const,
            content: JSON.stringify({ compilerOptions: { paths } }),
          };
        }
        return {
          status: "ok" as const,
          content: path === "tsconfig.json" ? "{}" : ROUTE_A,
        };
      }),
    });
    const harness = renderRoutes({ gateway, isOpen: true });

    await waitForReact(() => expect(harness.hook().loading).toBe(false));

    expect(harness.hook().routes[0]?.path).toBe("/a");
    expect(harness.hook().truncated).toBe(true);
    harness.unmount();
  });

  it("fails closed for package scopes beyond the aggregate config budget", async () => {
    const packageDirectories = Array.from(
      { length: 17 },
      (_, index) => `packages/${String(index).padStart(2, "0")}`,
    );
    const lastPackage = packageDirectories[packageDirectories.length - 1] ?? "";
    const sources: Record<string, string> = {
      [`${lastPackage}/src/app.ts`]: [
        "import express from 'express';",
        "import users from '@routes';",
        "const app = express();",
        "app.use('/api', users);",
      ].join("\n"),
      [`${lastPackage}/src/routes.ts`]: [
        "import express from 'express';",
        "const users = express.Router();",
        "users.get('/users', handler);",
        "export default users;",
      ].join("\n"),
    };
    const largeConfig = JSON.stringify({
      compilerOptions: {},
      padding: "x".repeat(247_000),
    });
    const gateway = discovery({
      enumerateJavaScriptSourceFiles: vi.fn(async () => ({
        files: Object.keys(sources),
        truncated: false,
        visited: 3,
      })),
      enumeratePackageJsonFiles: vi.fn(async () => ({
        files: packageDirectories.map((directory) => `${directory}/package.json`),
        truncated: false,
        visited: packageDirectories.length + 1,
      })),
      readSourceTextBounded: vi.fn(async (_root, path) => {
        if (path.endsWith("/package.json")) {
          const directory = path.slice(0, -"/package.json".length);
          return {
            status: "ok" as const,
            content: JSON.stringify({ name: directory.replace("/", "-") }),
          };
        }
        if (path === "tsconfig.json") {
          return {
            status: "ok" as const,
            content: JSON.stringify({
              compilerOptions: {
                paths: { "@routes": [`${lastPackage}/src/routes`] },
              },
            }),
          };
        }
        if (path.endsWith("/tsconfig.json")) {
          return { status: "ok" as const, content: largeConfig };
        }
        return { status: "ok" as const, content: sources[path] ?? "" };
      }),
    });
    const harness = renderRoutes({ gateway, isOpen: true });

    await waitForReact(() => expect(harness.hook().loading).toBe(false));

    expect(harness.hook().truncated).toBe(true);
    expect(
      harness.hook().routes.some(({ method, path }) => method === "GET" && path === "/api/users"),
    ).toBe(false);
    expect(
      harness.hook().routes.some(({ method, path }) => method === "GET" && path === "/users"),
    ).toBe(true);
    harness.unmount();
  });

  it("drops a stale package tsconfig read before reading stale-owner sources", async () => {
    const pendingPackageConfig = deferred<BoundedWorkspaceSourceRead>();
    const gateway = discovery({
      enumeratePackageJsonFiles: vi.fn(async (rootPath) => ({
        files: rootPath === ROOT_A ? ["packages/api/package.json"] : [],
        truncated: false,
        visited: 2,
      })),
      readSourceTextBounded: vi.fn(async (rootPath, path): Promise<BoundedWorkspaceSourceRead> => {
        if (path === "packages/api/package.json") {
          return { status: "ok", content: '{"name":"api"}' };
        }
        if (rootPath === ROOT_A && path === "packages/api/tsconfig.json") {
          return pendingPackageConfig.promise;
        }
        if (path === "tsconfig.json") return { status: "ok", content: "{}" };
        return {
          status: "ok",
          content: rootPath === ROOT_A ? ROUTE_A : "app.get('/b', handler);",
        };
      }),
    });
    const harness = renderRoutes({ gateway, isOpen: true });
    await waitForReact(() =>
      expect(gateway.readSourceTextBounded).toHaveBeenCalledWith(
        ROOT_A,
        "packages/api/tsconfig.json",
        262_144,
      ),
    );

    harness.set({ rootPath: ROOT_B, workspaceId: "workspace-b" });
    await waitForReact(() => expect(harness.hook().routes[0]?.path).toBe("/b"));
    await act(async () => pendingPackageConfig.resolve({ status: "changed" }));

    expect(gateway.readSourceTextBounded).not.toHaveBeenCalledWith(
      ROOT_A,
      "src/a.ts",
      expect.anything(),
    );
    expect(harness.hook().routes.map(({ path }) => path)).toEqual(["/b"]);
    harness.unmount();
  });

  it("ignores malformed root tsconfig without failing discovery", async () => {
    const gateway = discovery({
      readSourceTextBounded: vi.fn(async (_root, path) => ({
        status: "ok" as const,
        content: path === "tsconfig.json" ? "{ malformed" : ROUTE_A,
      })),
    });
    const harness = renderRoutes({ gateway, isOpen: true });

    await waitForReact(() => expect(harness.hook().routes[0]?.path).toBe("/a"));

    expect(harness.hook().error).toBeNull();
    expect(harness.hook().truncated).toBe(false);
    harness.unmount();
  });

  it("surfaces truncated root alias configuration", async () => {
    const paths = Object.fromEntries(
      Array.from({ length: 257 }, (_, index) => [`@alias-${index}`, [`src/alias-${index}`]]),
    );
    const gateway = discovery({
      readSourceTextBounded: vi.fn(async (_root, path) => ({
        status: "ok" as const,
        content:
          path === "tsconfig.json" ? JSON.stringify({ compilerOptions: { paths } }) : ROUTE_A,
      })),
    });
    const harness = renderRoutes({ gateway, isOpen: true });

    await waitForReact(() => expect(harness.hook().loading).toBe(false));

    expect(harness.hook().routes[0]?.path).toBe("/a");
    expect(harness.hook().truncated).toBe(true);
    harness.unmount();
  });

  it("rescans root aliases after tsconfig invalidation", async () => {
    vi.useFakeTimers();
    try {
      let aliasTarget = "src/routes/users";
      const sources: Record<string, string> = {
        "src/server.ts": [
          "import express from 'express';",
          "import users from '@routes';",
          "const app = express();",
          "app.use('/api', users);",
        ].join("\n"),
        "src/routes/users.ts": [
          "import express from 'express';",
          "const users = express.Router();",
          "users.get('/users', handler);",
          "export default users;",
        ].join("\n"),
        "src/routes/admin.ts": [
          "import express from 'express';",
          "const admin = express.Router();",
          "admin.get('/admin', handler);",
          "export default admin;",
        ].join("\n"),
      };
      const gateway = discovery({
        enumerateJavaScriptSourceFiles: vi.fn(async () => ({
          files: Object.keys(sources),
          truncated: false,
          visited: 4,
        })),
        readSourceTextBounded: vi.fn(async (_root, path) => ({
          status: "ok" as const,
          content:
            path === "tsconfig.json"
              ? JSON.stringify({
                  compilerOptions: { paths: { "@routes": [aliasTarget] } },
                })
              : (sources[path] ?? ""),
        })),
      });
      const harness = renderRoutes({ gateway, isOpen: true });
      await act(async () => vi.runAllTimersAsync());
      await waitForReact(() =>
        expect(harness.hook().routes.some((route) => route.path === "/api/users")).toBe(true),
      );

      aliasTarget = "src/routes/admin";
      harness.set({ discoveryVersion: 1 });
      await act(async () => vi.advanceTimersByTimeAsync(75));
      await waitForReact(() =>
        expect(harness.hook().routes.some((route) => route.path === "/api/admin")).toBe(true),
      );

      expect(gateway.readSourceTextBounded).toHaveBeenCalledTimes(10);
      harness.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops a stale root tsconfig read before reading stale-owner sources", async () => {
    const pendingConfig = deferred<BoundedWorkspaceSourceRead>();
    const gateway = discovery({
      readSourceTextBounded: vi.fn(async (rootPath, path): Promise<BoundedWorkspaceSourceRead> => {
        if (rootPath === ROOT_A && path === "tsconfig.json") return pendingConfig.promise;
        if (path === "tsconfig.json") return { status: "tooLarge" };
        return {
          status: "ok",
          content: rootPath === ROOT_A ? ROUTE_A : "app.get('/b', handler);",
        };
      }),
    });
    const harness = renderRoutes({ gateway, isOpen: true });
    await waitForReact(() =>
      expect(gateway.readSourceTextBounded).toHaveBeenCalledWith(ROOT_A, "tsconfig.json", 262_144),
    );

    harness.set({ rootPath: ROOT_B, workspaceId: "workspace-b" });
    await waitForReact(() => expect(harness.hook().routes[0]?.path).toBe("/b"));
    await act(async () => pendingConfig.resolve({ status: "changed" }));

    expect(gateway.readSourceTextBounded).not.toHaveBeenCalledWith(
      ROOT_A,
      "src/a.ts",
      expect.anything(),
    );
    expect(harness.hook().routes.map((route) => route.path)).toEqual(["/b"]);
    harness.unmount();
  });

  it("degrades at exactly 256 KiB plus one without parsing the stale dirty route", async () => {
    const onProjectionWork = vi.fn();
    const gateway = discovery();
    const harness = renderRoutes({ gateway, isOpen: true, onProjectionWork });
    await waitForReact(() => expect(harness.hook().routes[0]?.path).toBe("/a"));
    onProjectionWork.mockClear();

    harness.set({
      dirtySnapshots: [{ relativeFilePath: "src/a.ts", source: "x".repeat(262_145) }],
    });

    await waitForReact(() => {
      expect(harness.hook().routes).toEqual([]);
      expect(harness.hook().truncated).toBe(true);
    });
    expect(harness.hook().truncated).toBe(true);
    expect(onProjectionWork).toHaveBeenCalledExactlyOnceWith({
      inspectedCodeUnits: 262_145,
      kind: "source-scan",
      relativeFilePath: "src/a.ts",
    });
    expect(gateway.enumerateJavaScriptSourceFiles).toHaveBeenCalledTimes(1);
    harness.unmount();
  });

  it("analyzes an exact 256 KiB dirty source at the interactive boundary", async () => {
    const gateway = discovery({
      enumerateJavaScriptSourceFiles: vi.fn(async () => ({
        files: [],
        truncated: false,
        visited: 1,
      })),
    });
    const harness = renderRoutes({ gateway, isOpen: true });
    await waitForReact(() => expect(harness.hook().navigationGeneration).not.toBeNull());
    const prefix = "app.get('/boundary', handler);\n";

    harness.set({
      dirtySnapshots: [
        {
          relativeFilePath: "src/boundary.ts",
          source: prefix + "x".repeat(256 * 1024 - prefix.length),
        },
      ],
    });

    await waitForReact(() => expect(harness.hook().routes[0]?.path).toBe("/boundary"));
    expect(harness.hook().truncated).toBe(false);
    harness.unmount();
  });

  it("keeps an oversized dirty route revoked across workspace A-B-A", async () => {
    const gateway = discovery({
      readSourceTextBounded: vi.fn(async (rootPath, path) => ({
        status: "ok" as const,
        content:
          path === "tsconfig.json"
            ? ""
            : `app.get('${rootPath === ROOT_A ? "/a" : "/b"}', handler);`,
      })),
    });
    const harness = renderRoutes({ gateway, isOpen: true });
    await waitForReact(() => expect(harness.hook().routes[0]?.path).toBe("/a"));
    const staleA = harness.hook().routes[0];

    harness.set({
      dirtySnapshots: [{ relativeFilePath: "src/a.ts", source: "x".repeat(262_145) }],
    });
    await waitForReact(() => {
      expect(harness.hook().routes).toEqual([]);
      expect(harness.hook().truncated).toBe(true);
    });
    expect(expressRouteNavigationReceipt(staleA!)).toBeNull();

    harness.set({ dirtySnapshots: [], rootPath: ROOT_B, workspaceId: "workspace-b" });
    await waitForReact(() => expect(harness.hook().routes[0]?.path).toBe("/b"));
    harness.set({
      dirtySnapshots: [{ relativeFilePath: "src/a.ts", source: "x".repeat(262_145) }],
      rootPath: ROOT_A,
      workspaceId: "workspace-a",
    });
    await waitForReact(() => {
      expect(harness.hook().routes).toEqual([]);
      expect(harness.hook().truncated).toBe(true);
    });
    expect(harness.hook().truncated).toBe(true);
    expect(expressRouteNavigationReceipt(staleA!)).toBeNull();
    harness.unmount();
  });

  it("caps presented routes, rejects oversized analysis, and limits read concurrency to eight", async () => {
    const routeHeavy = "app.get('',x);\n".repeat(3_000);
    let activeReads = 0;
    let peakReads = 0;
    const release = deferred<void>();
    const files = Array.from({ length: 16 }, (_, index) => `src/${index}.ts`);
    const gateway = discovery({
      enumerateJavaScriptSourceFiles: vi
        .fn()
        .mockResolvedValueOnce({ files: ["routes.ts"], truncated: false, visited: 2 })
        .mockResolvedValueOnce({ files, truncated: false, visited: 17 }),
      readSourceTextBounded: vi.fn(async (_root, path): Promise<BoundedWorkspaceSourceRead> => {
        if (path === "tsconfig.json") return { status: "tooLarge" };
        if (path === "pnpm-workspace.yaml") return { status: "notFound" };
        if (path === "routes.ts") return { status: "ok", content: routeHeavy };
        activeReads += 1;
        peakReads = Math.max(peakReads, activeReads);
        await release.promise;
        activeReads -= 1;
        return { status: "ok", content: ROUTE_A };
      }),
    });
    const harness = renderRoutes({ gateway, isOpen: true });
    await waitForReact(() =>
      expect(gateway.readSourceTextBounded).toHaveBeenCalledWith(ROOT_A, "routes.ts", 262_144),
    );
    await waitForReact(() => expect(harness.hook().navigationGeneration).not.toBeNull());
    expect(harness.hook().routes).toHaveLength(2_000);
    expect(harness.hook().routes[1_999]?.occurrence).toBe(2_000);
    expect(harness.hook().truncated).toBe(true);

    let refresh!: Promise<void>;
    act(() => {
      refresh = harness.hook().refresh();
    });
    await waitForReact(() => expect(peakReads).toBe(8));
    await act(async () => release.resolve());
    await refresh;
    expect(peakReads).toBe(8);
    harness.unmount();
  }, 15_000);

  it("stops parsing at the aggregate 256 KiB interactive source budget", async () => {
    const fullBudgetSource = "x".repeat(16 * 1024);
    const files = [
      ...Array.from({ length: 16 }, (_, index) => `src/large-${index}.ts`),
      "src/after-budget.ts",
    ];
    const gateway = discovery({
      enumerateJavaScriptSourceFiles: vi.fn(async () => ({
        files,
        truncated: false,
        visited: files.length + 1,
      })),
      readSourceTextBounded: vi.fn(async (_root, path): Promise<BoundedWorkspaceSourceRead> => ({
        status: "ok",
        content: path.endsWith("after-budget.ts") ? ROUTE_A : fullBudgetSource,
      })),
    });
    const harness = renderRoutes({ gateway, isOpen: true });

    await waitForReact(() => expect(harness.hook().loading).toBe(false));

    expect(harness.hook().routes).toEqual([]);
    expect(harness.hook().truncated).toBe(true);
    harness.unmount();
  }, 10_000);

  it("admits the deterministic enumeration prefix when reads finish out of order", async () => {
    const maxFileBytes = 2 * 1024 * 1024;
    const firstPrefix = "app.get('/first', handler);\n";
    const firstSource = firstPrefix + "x".repeat(maxFileBytes - firstPrefix.length);
    const fullSource = "x".repeat(maxFileBytes);
    const files = [
      ...Array.from({ length: 16 }, (_, index) => `src/${String(index).padStart(2, "0")}.ts`),
      "src/after-budget.ts",
    ];
    const completed: string[] = [];
    const firstRead = deferred<void>();
    const gateway = discovery({
      enumerateJavaScriptSourceFiles: vi.fn(async () => ({
        files,
        truncated: false,
        visited: files.length + 1,
      })),
      readSourceTextBounded: vi.fn(async (_root, path): Promise<BoundedWorkspaceSourceRead> => {
        if (path === files[0]) await firstRead.promise;
        completed.push(path);
        if (path === files[0]) return { status: "ok", content: firstSource };
        if (path === "src/after-budget.ts") {
          return { status: "ok", content: "app.get('/after', handler);" };
        }
        return { status: "ok", content: fullSource };
      }),
    });
    const harness = renderRoutes({ gateway, isOpen: true });

    await vi.waitFor(() => expect(completed.length).toBeGreaterThan(0));
    await act(async () => firstRead.resolve());
    await waitForReact(() => expect(harness.hook().loading).toBe(false));

    expect(completed[0]).not.toBe(files[0]);
    await waitForReact(() => expect(harness.hook().truncated).toBe(true));
    expect(harness.hook().routes).toEqual([]);
    expect(harness.hook().truncated).toBe(true);
    harness.unmount();
  }, 10_000);

  it("surfaces current discovery errors without committing stale failures", async () => {
    const gateway = discovery({
      enumerateJavaScriptSourceFiles: vi.fn(async () => {
        throw new Error("enumeration failed");
      }),
    });
    const harness = renderRoutes({ gateway, isOpen: true });

    await waitForReact(() => expect(harness.hook().error).toBe("enumeration failed"));

    expect(harness.hook().loading).toBe(false);
    harness.unmount();
  });
});

interface Harness {
  hook(): WorkspaceExpressRoutesState;
  set(options: Partial<UseWorkspaceExpressRoutesOptions>): void;
  unmount(): void;
}

function renderRoutes(overrides: Partial<UseWorkspaceExpressRoutesOptions> = {}): Harness {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { current: WorkspaceExpressRoutesState | null } = { current: null };
  let options: UseWorkspaceExpressRoutesOptions = {
    dirtySnapshots: [],
    discoveryVersion: 0,
    gateway: discovery(),
    isOpen: false,
    rootPath: ROOT_A,
    workspaceId: "workspace-a",
    ...overrides,
  };

  function Component() {
    captured.current = useWorkspaceExpressRoutes(options);
    return null;
  }

  const render = () => act(() => root.render(<Component />));
  render();
  return {
    hook: () => {
      if (!captured.current) throw new Error("hook not mounted");
      return captured.current;
    },
    set: (next) => {
      options = { ...options, ...next };
      render();
    },
    unmount: () => act(() => root.unmount()),
  };
}

function discovery(
  overrides: Partial<WorkspaceSourceDiscoveryGateway> = {},
): MockWorkspaceSourceDiscoveryGateway {
  const enumerate =
    overrides.enumerateJavaScriptSourceFiles ??
    (async () => ({ files: ["src/a.ts"], truncated: false, visited: 2 }));
  const read =
    overrides.readSourceTextBounded ??
    (async (): Promise<BoundedWorkspaceSourceRead> => ({ status: "ok", content: ROUTE_A }));
  return {
    ...(overrides.enumeratePackageJsonFiles
      ? { enumeratePackageJsonFiles: vi.fn(overrides.enumeratePackageJsonFiles) }
      : {}),
    enumerateJavaScriptSourceFiles: vi.fn(enumerate),
    readSourceTextBounded: vi.fn(read),
  };
}

interface MockWorkspaceSourceDiscoveryGateway extends WorkspaceSourceDiscoveryGateway {
  enumeratePackageJsonFiles?: ReturnType<
    typeof vi.fn<NonNullable<WorkspaceSourceDiscoveryGateway["enumeratePackageJsonFiles"]>>
  >;
  enumerateJavaScriptSourceFiles: ReturnType<
    typeof vi.fn<WorkspaceSourceDiscoveryGateway["enumerateJavaScriptSourceFiles"]>
  >;
  readSourceTextBounded: ReturnType<
    typeof vi.fn<WorkspaceSourceDiscoveryGateway["readSourceTextBounded"]>
  >;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}
