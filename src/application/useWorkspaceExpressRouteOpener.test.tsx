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

const ROOT_A = "/workspace/a";
const SOURCE = "\n  router.post('/users', handler);";

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
});

function route(source: string): WorkspaceExpressRoute {
  const candidate = workspaceExpressRoutesFromSnapshots([
    { relativeFilePath: "src/routes.ts", source },
  ])[0];
  if (!candidate) throw new Error("test route source did not parse");
  return candidate;
}

function renderOpener(overrides: Partial<UseWorkspaceExpressRouteOpenerOptions> = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const gateway = overrides.gateway ?? discovery(async () => ({ status: "ok", content: SOURCE }));
  const onOpenLocation = overrides.onOpenLocation ?? vi.fn(async () => true);
  const onStale = overrides.onStale ?? vi.fn();
  let options: UseWorkspaceExpressRouteOpenerOptions = {
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
