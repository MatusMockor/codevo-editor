// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceSourceDiscoveryGateway } from "../domain/workspaceSourceDiscovery";
import {
  workspaceExpressRoutesFromSnapshots,
  type WorkspaceExpressRoute,
} from "../domain/workspaceExpressRoutes";
import {
  useWorkspaceExpressRouteOpener,
  type UseWorkspaceExpressRouteOpenerOptions,
} from "./useWorkspaceExpressRouteOpener";
import {
  bindExpressRouteNavigationReceipts,
  createExpressRouteNavigationGeneration,
  type ExpressRouteNavigationGeneration,
} from "./expressRouteNavigationReceipt";

const ROOT_A = "/workspace/a";
const SOURCE = "\n  router.post('/users', handler);";
const GENERATION = createExpressRouteNavigationGeneration();

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useWorkspaceExpressRouteOpener", () => {
  it("revalidates and opens a cross-file route at its exact location", async () => {
    const harness = renderOpener();

    await expect(harness.open(route(SOURCE))).resolves.toBe(true);

    expect(harness.gateway.readSourceTextBounded).toHaveBeenCalledWith(
      ROOT_A,
      "src/routes.ts",
      2_097_152,
    );
    expect(harness.onOpenLocation).toHaveBeenCalledWith(
      "/workspace/a/src/routes.ts",
      2,
      3,
      expect.any(Function),
    );
    expect(harness.onStale).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("opens a mounted runtime row by revalidating its exact leaf declaration", async () => {
    const appSource = [
      "import express from 'express';",
      "import users from './users';",
      "const app = express();",
      "app.use('/api', users);",
    ].join("\n");
    const usersSource = [
      "import express from 'express';",
      "const users = express.Router();",
      "users.get('/users/:id', handler);",
      "export default users;",
    ].join("\n");
    const snapshots = [
      { relativeFilePath: "src/app.ts", source: appSource },
      { relativeFilePath: "src/users.ts", source: usersSource },
    ];
    const mounted = navigableRoutes(snapshots).find(({ path }) => path === "/api/users/:id");
    if (!mounted) throw new Error("mounted route did not resolve");
    const harness = renderOpener({
      gateway: discovery(async (_root, path) => ({
        status: "ok",
        content: path === "src/users.ts" ? usersSource : appSource,
      })),
    });

    await expect(harness.open(mounted)).resolves.toBe(true);

    expect(harness.onOpenLocation).toHaveBeenCalledWith(
      "/workspace/a/src/users.ts",
      3,
      1,
      expect.any(Function),
    );
    expect(harness.onStale).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("opens an aliased cross-package runtime row without trusting its derived runtime path", async () => {
    const leafSource = "router.get('/users', handler);";
    const local = workspaceExpressRoutesFromSnapshots([
      {
        packageLabel: "@acme/shared",
        relativeFilePath: "packages/shared/routes.ts",
        source: leafSource,
      },
    ])[0];
    if (!local) throw new Error("leaf route did not parse");
    const aliased = bindExpressRouteNavigationReceipts(
      [
        {
          ...local,
          id: `${local.id}:mounted-alias`,
          path: "/api/users",
        },
      ],
      [
        {
          packageLabel: "@acme/shared",
          relativeFilePath: "packages/shared/routes.ts",
          source: leafSource,
        },
      ],
      { generation: GENERATION, rootPath: ROOT_A, workspaceId: "workspace-a" },
    ).routes[0];
    if (!aliased) throw new Error("aliased route did not bind");
    const harness = renderOpener({
      gateway: discovery(async () => ({ status: "ok", content: leafSource })),
    });

    await expect(harness.open(aliased)).resolves.toBe(true);

    expect(harness.onOpenLocation).toHaveBeenCalledWith(
      "/workspace/a/packages/shared/routes.ts",
      1,
      1,
      expect.any(Function),
    );
    harness.unmount();
  });

  it("rejects traversal before reading or navigating", async () => {
    const harness = renderOpener();
    const unsafeRoute = { ...route(SOURCE), relativeFilePath: "../outside.ts" };

    await expect(harness.open(unsafeRoute)).resolves.toBe(false);

    expect(harness.gateway.readSourceTextBounded).not.toHaveBeenCalled();
    expect(harness.onOpenLocation).not.toHaveBeenCalled();
    expect(harness.onStale).toHaveBeenCalledWith(unsafeRoute);
    harness.unmount();
  });

  it.each([
    ["removed", "export {};"],
    ["moved", `\n${SOURCE}`],
  ])("does not navigate when the route was %s", async (_label, currentSource) => {
    const harness = renderOpener({
      gateway: discovery(async () => ({ status: "ok", content: currentSource })),
    });

    await expect(harness.open(route(SOURCE))).resolves.toBe(false);

    expect(harness.onOpenLocation).not.toHaveBeenCalled();
    expect(harness.onStale).toHaveBeenCalledOnce();
    harness.unmount();
  });

  it.each(["changed", "tooLarge"] as const)(
    "fails closed when the bounded read reports %s",
    async (status) => {
      const harness = renderOpener({ gateway: discovery(async () => ({ status })) });

      await expect(harness.open(route(SOURCE))).resolves.toBe(false);

      expect(harness.onOpenLocation).not.toHaveBeenCalled();
      expect(harness.onStale).toHaveBeenCalledOnce();
      harness.unmount();
    },
  );

  it("fails closed when reading throws", async () => {
    const harness = renderOpener({
      gateway: discovery(async () => {
        throw new Error("read failed");
      }),
    });

    await expect(harness.open(route(SOURCE))).resolves.toBe(false);

    expect(harness.onOpenLocation).not.toHaveBeenCalled();
    expect(harness.onStale).toHaveBeenCalledOnce();
    harness.unmount();
  });

  it("revalidates the matching inactive dirty snapshot instead of stale disk source", async () => {
    const dirtySource = "\n\napp.patch('/dirty', handler);";
    const harness = renderOpener({
      dirtySnapshots: [
        { relativeFilePath: "src/active.ts", source: "app.get('/active', handler);" },
        { relativeFilePath: "src/routes.ts", source: dirtySource },
      ],
    });

    await expect(harness.open(route(dirtySource))).resolves.toBe(true);

    expect(harness.gateway.readSourceTextBounded).not.toHaveBeenCalled();
    expect(harness.onOpenLocation).toHaveBeenCalledWith(
      "/workspace/a/src/routes.ts",
      3,
      1,
      expect.any(Function),
    );
    harness.unmount();
  });

  it("drops a retained A callback before reading after switching to B", async () => {
    const harness = renderOpener();
    const openFromA = harness.currentOpener();

    harness.set({ rootPath: "/workspace/b", workspaceId: "workspace-b" });

    await expect(openFromA(route(SOURCE))).resolves.toBe(false);
    expect(harness.gateway.readSourceTextBounded).not.toHaveBeenCalled();
    expect(harness.onOpenLocation).not.toHaveBeenCalled();
    expect(harness.onStale).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("does not refresh B for an invalid route passed to a retained A callback", async () => {
    const harness = renderOpener();
    const openFromA = harness.currentOpener();
    const invalidRoute = { ...route(SOURCE), relativeFilePath: "../outside.ts" };

    harness.set({ rootPath: "/workspace/b", workspaceId: "workspace-b" });

    await expect(openFromA(invalidRoute)).resolves.toBe(false);
    expect(harness.gateway.readSourceTextBounded).not.toHaveBeenCalled();
    expect(harness.onOpenLocation).not.toHaveBeenCalled();
    expect(harness.onStale).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("drops an A read that completes after switching to workspace B", async () => {
    const pending = deferred<{ readonly status: "ok"; readonly content: string }>();
    const harness = renderOpener({ gateway: discovery(async () => pending.promise) });
    const opening = harness.open(route(SOURCE));

    harness.set({ rootPath: "/workspace/b", workspaceId: "workspace-b" });
    await act(async () => pending.resolve({ status: "ok", content: SOURCE }));

    await expect(opening).resolves.toBe(false);
    expect(harness.onOpenLocation).not.toHaveBeenCalled();
    expect(harness.onStale).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("prevents an async navigation commit when the workspace changes", async () => {
    const releaseNavigation = deferred<void>();
    const commitGuard: { current: (() => boolean) | null } = { current: null };
    const onOpenLocation = vi.fn(
      async (_path: string, _line: number, _column: number, guard: () => boolean) => {
        commitGuard.current = guard;
        await releaseNavigation.promise;
        return guard();
      },
    );
    const harness = renderOpener({ onOpenLocation });
    const opening = harness.open(route(SOURCE));
    await vi.waitFor(() => expect(onOpenLocation).toHaveBeenCalledOnce());

    harness.set({ rootPath: "/workspace/b", workspaceId: "workspace-b" });
    expect(commitGuard.current).not.toBeNull();
    expect(commitGuard.current?.()).toBe(false);
    await act(async () => releaseNavigation.resolve());

    await expect(opening).resolves.toBe(false);
    expect(harness.onStale).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("rejects a replaced rendered row before reading its leaf", async () => {
    const nextGeneration = createExpressRouteNavigationGeneration();
    const harness = renderOpener({
      currentNavigationGeneration: () => nextGeneration,
    });

    await expect(harness.open(route(SOURCE))).resolves.toBe(false);

    expect(harness.gateway.readSourceTextBounded).not.toHaveBeenCalled();
    expect(harness.onOpenLocation).not.toHaveBeenCalled();
    expect(harness.onStale).toHaveBeenCalledOnce();
    harness.unmount();
  });

  it("rejects an old A row after A to B to A returns with a fresh projection generation", async () => {
    let currentGeneration: ExpressRouteNavigationGeneration = GENERATION;
    const harness = renderOpener({
      currentNavigationGeneration: () => currentGeneration,
    });
    const retained = route(SOURCE);

    currentGeneration = createExpressRouteNavigationGeneration();
    harness.set({ rootPath: "/workspace/b", workspaceId: "workspace-b" });
    harness.set({ rootPath: ROOT_A, workspaceId: "workspace-a" });

    await expect(harness.open(retained)).resolves.toBe(false);
    expect(harness.gateway.readSourceTextBounded).not.toHaveBeenCalled();
    expect(harness.onOpenLocation).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("uses the source location to disambiguate duplicate route declarations", async () => {
    const duplicateSource = ["router.get('/same', first);", "router.get('/same', second);"].join(
      "\n",
    );
    const selected = navigableRoutes([
      { relativeFilePath: "src/routes.ts", source: duplicateSource },
    ]).find(({ line }) => line === 2);
    if (!selected) throw new Error("second duplicate route did not bind");
    const harness = renderOpener({
      gateway: discovery(async () => ({ status: "ok", content: duplicateSource })),
    });

    await expect(harness.open(selected)).resolves.toBe(true);

    expect(harness.onOpenLocation).toHaveBeenCalledWith(
      "/workspace/a/src/routes.ts",
      2,
      1,
      expect.any(Function),
    );
    harness.unmount();
  });
});

function route(source: string): WorkspaceExpressRoute {
  const candidate = navigableRoutes([{ relativeFilePath: "src/routes.ts", source }])[0];
  if (!candidate) throw new Error("test route source did not parse");
  return candidate;
}

function navigableRoutes(
  snapshots: readonly {
    readonly packageLabel?: string;
    readonly relativeFilePath: string;
    readonly source: string;
  }[],
) {
  const routes = workspaceExpressRoutesFromSnapshots(snapshots);
  return bindExpressRouteNavigationReceipts(routes, snapshots, {
    generation: GENERATION,
    rootPath: ROOT_A,
    workspaceId: "workspace-a",
  }).routes;
}

function renderOpener(overrides: Partial<UseWorkspaceExpressRouteOpenerOptions> = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const gateway = overrides.gateway ?? discovery(async () => ({ status: "ok", content: SOURCE }));
  const onOpenLocation = overrides.onOpenLocation ?? vi.fn(async () => true);
  const onStale = overrides.onStale ?? vi.fn();
  let options: UseWorkspaceExpressRouteOpenerOptions = {
    currentNavigationGeneration: () => GENERATION,
    dirtySnapshots: [],
    gateway,
    onOpenLocation,
    onStale,
    rootPath: ROOT_A,
    workspaceId: "workspace-a",
    ...overrides,
  };
  let open: ReturnType<typeof useWorkspaceExpressRouteOpener> | null = null;

  function Harness() {
    open = useWorkspaceExpressRouteOpener(options);
    return null;
  }

  const render = () => act(() => root.render(<Harness />));
  render();
  return {
    currentOpener: () => {
      if (!open) throw new Error("hook did not render");
      return open;
    },
    gateway,
    onOpenLocation,
    onStale,
    open: (candidate: WorkspaceExpressRoute) => {
      if (!open) throw new Error("hook did not render");
      return open(candidate);
    },
    set: (next: Partial<UseWorkspaceExpressRouteOpenerOptions>) => {
      options = { ...options, ...next };
      render();
    },
    unmount: () => act(() => root.unmount()),
  };
}

function discovery(
  read: WorkspaceSourceDiscoveryGateway["readSourceTextBounded"],
): WorkspaceSourceDiscoveryGateway & {
  readSourceTextBounded: ReturnType<typeof vi.fn>;
} {
  return {
    enumerateJavaScriptSourceFiles: vi.fn(async () => ({
      files: [],
      truncated: false,
      visited: 0,
    })),
    readSourceTextBounded: vi.fn(read),
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
