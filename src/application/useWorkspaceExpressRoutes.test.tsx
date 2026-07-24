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
    expect(gateway.readSourceTextBounded).toHaveBeenCalledWith(ROOT_A, "src/a.ts", 2_097_152);
    expect(harness.hook().loading).toBe(false);
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
    expect(harness.hook().routes[0]?.path).toBe(ROOT_A);
    expect(gateway.enumerateJavaScriptSourceFiles).toHaveBeenCalledTimes(4);

    harness.set({ rootPath: "/workspace/e", workspaceId: "workspace-e" });
    await waitForReact(() => expect(harness.hook().routes[0]?.path).toBe("/workspace/e"));
    expect(gateway.enumerateJavaScriptSourceFiles).toHaveBeenCalledTimes(5);

    harness.set({ rootPath: ROOT_A, workspaceId: "workspace-a" });
    expect(harness.hook().routes[0]?.path).toBe(ROOT_A);
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

  it("updates all dirty overlays instantly without mutating cached disk routes or rediscovering", async () => {
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

    expect(harness.hook().routes.map((route) => route.path)).toEqual(["/dirty-a", "/dirty-b"]);
    expect(diskRoutes.map((route) => route.path)).toEqual(["/a"]);
    expect(gateway.enumerateJavaScriptSourceFiles).toHaveBeenCalledTimes(1);

    harness.set({ dirtySnapshots: [] });
    expect(harness.hook().routes).toEqual(diskRoutes);
    harness.unmount();
  });

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

    expect(harness.hook().routes.map(({ packageLabel, path }) => ({ packageLabel, path }))).toEqual(
      [
        { packageLabel: "api-a", path: "/a" },
        { packageLabel: "api-b", path: "/b" },
      ],
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

    expect(harness.hook().routes.some((route) => route.path === "/api/old")).toBe(false);
    expect(harness.hook().routes).toEqual(
      expect.arrayContaining([expect.objectContaining({ method: "POST", path: "/api/new" })]),
    );
    expect(gateway.enumerateJavaScriptSourceFiles).toHaveBeenCalledTimes(1);
    harness.unmount();
  });

  it("removes stale disk routes when a dirty replacement exceeds the source bound", async () => {
    const gateway = discovery();
    const harness = renderRoutes({ gateway, isOpen: true });
    await waitForReact(() => expect(harness.hook().routes[0]?.path).toBe("/a"));

    harness.set({
      dirtySnapshots: [{ relativeFilePath: "src/a.ts", source: "x".repeat(2_097_153) }],
    });

    expect(harness.hook().routes).toEqual([]);
    expect(harness.hook().truncated).toBe(true);
    expect(gateway.enumerateJavaScriptSourceFiles).toHaveBeenCalledTimes(1);
    harness.unmount();
  });

  it("caps routes, rejects oversized wire content, and limits read concurrency to eight", async () => {
    const routeHeavy = "app.get('',x);\n".repeat(100_000);
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
        if (path === "routes.ts") return { status: "ok", content: routeHeavy };
        activeReads += 1;
        peakReads = Math.max(peakReads, activeReads);
        await release.promise;
        activeReads -= 1;
        return { status: "ok", content: ROUTE_A };
      }),
    });
    const harness = renderRoutes({ gateway, isOpen: true });
    await waitForReact(() => expect(harness.hook().loading).toBe(false));
    expect(harness.hook().routes).toHaveLength(20_000);
    expect(harness.hook().routes[19_999]?.occurrence).toBe(20_000);
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
  });

  it("stops parsing at the aggregate 32 MiB source budget", async () => {
    const fullBudgetSource = "😀".repeat((2 * 1024 * 1024) / 4);
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
    expect(harness.hook().routes.map((route) => route.path)).toEqual(["/first"]);
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
    enumerateJavaScriptSourceFiles: vi.fn(enumerate),
    readSourceTextBounded: vi.fn(read),
  };
}

interface MockWorkspaceSourceDiscoveryGateway extends WorkspaceSourceDiscoveryGateway {
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
