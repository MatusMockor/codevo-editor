// @vitest-environment jsdom

import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceSourceDiscoveryGateway } from "../domain/workspaceSourceDiscovery";
import { useExpressWorkspaceManifestSignal } from "./useExpressWorkspaceManifestSignal";
import { useWorkspaceExpressRoutes } from "./useWorkspaceExpressRoutes";

describe("useExpressWorkspaceManifestSignal", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it.each([
    ["dependencies", { dependencies: { express: "^5.1.0" } }],
    ["devDependencies", { devDependencies: { express: "^5.1.0" } }],
  ])("signals Express from %s", async (_, manifest) => {
    const gateway = sourceGateway(async () => ({
      content: JSON.stringify(manifest),
      status: "ok",
    }));
    const harness = await renderHook(root, { gateway });

    expect(harness.current).toBe(true);
    expect(gateway.readSourceTextBounded).toHaveBeenCalledOnce();
    expect(gateway.readSourceTextBounded).toHaveBeenCalledWith(
      "/workspace",
      "package.json",
      256 * 1024,
    );
  });

  it("does not signal when Express is absent", async () => {
    const harness = await renderHook(root, {
      gateway: sourceGateway(async () => ({
        content: JSON.stringify({ dependencies: { fastify: "^5.0.0" } }),
        status: "ok",
      })),
    });

    expect(harness.current).toBe(false);
  });

  it.each([
    ["malformed", async () => ({ content: "{", status: "ok" as const })],
    ["unreadable", async () => Promise.reject(new Error("unreadable"))],
  ])("does not signal for a %s package.json", async (_, read) => {
    const harness = await renderHook(root, { gateway: sourceGateway(read) });

    expect(harness.current).toBe(false);
  });

  it.each([
    ["undefined", () => undefined as never],
    [
      "synchronous throw",
      () => {
        throw new Error("unreadable");
      },
    ],
    ["rejection", async () => Promise.reject(new Error("unreadable"))],
    ["malformed result", async () => ({ status: "ok" }) as never],
  ])("settles false for a hostile %s gateway result", async (_, read) => {
    const gateway = sourceGateway(read);
    const harness = await renderHook(root, { gateway });

    expect(harness.current).toBe(false);
    expect(gateway.readSourceTextBounded).toHaveBeenCalledOnce();
  });

  it("attempts a triple once when the gateway identity changes", async () => {
    const firstGateway = sourceGateway(() => undefined as never);
    const secondGateway = sourceGateway(async () => ({
      content: JSON.stringify({ dependencies: { express: "^5.1.0" } }),
      status: "ok",
    }));
    const harness = await renderHook(root, { gateway: firstGateway });

    await harness.set({ gateway: secondGateway });
    await harness.set({ gateway: sourceGateway(async () => ({ content: "{}", status: "ok" })) });

    expect(harness.current).toBe(false);
    expect(firstGateway.readSourceTextBounded).toHaveBeenCalledOnce();
    expect(secondGateway.readSourceTextBounded).not.toHaveBeenCalled();
  });

  it("publishes one attempt through StrictMode effect replay", async () => {
    const gateway = sourceGateway(async () => ({
      content: JSON.stringify({ dependencies: { express: "^5.1.0" } }),
      status: "ok",
    }));
    const harness = await renderHook(root, { gateway }, true);

    expect(harness.current).toBe(true);
    expect(gateway.readSourceTextBounded).toHaveBeenCalledOnce();
  });

  it("does not read for an arbitrary Proxy-supplied discovery version", async () => {
    const gateway = sourceGateway(() => undefined as never);
    const harness = await renderHook(root, {
      discoveryVersion: vi.fn() as never,
      gateway,
    });

    await harness.set({ discoveryVersion: vi.fn() as never });

    expect(harness.current).toBe(false);
    expect(gateway.readSourceTextBounded).not.toHaveBeenCalled();
  });

  it("leaves a never-settling attempt false and stale after unmount", async () => {
    const pending = deferred<{
      readonly content: string;
      readonly status: "ok";
    }>();
    const gateway = sourceGateway(() => pending.promise);
    const harness = await renderHook(root, { gateway });

    expect(harness.current).toBe(false);
    expect(gateway.readSourceTextBounded).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
    pending.resolve({
      content: JSON.stringify({ dependencies: { express: "^5.1.0" } }),
      status: "ok",
    });
    await act(async () => {
      await pending.promise;
    });

    expect(gateway.readSourceTextBounded).toHaveBeenCalledOnce();
  });

  it("reacts to discovery version changes without remounting", async () => {
    let content = JSON.stringify({ dependencies: { fastify: "^5.0.0" } });
    const gateway = sourceGateway(async () => ({ content, status: "ok" }));
    const harness = await renderHook(root, { gateway });

    expect(harness.current).toBe(false);

    content = JSON.stringify({ dependencies: { express: "^5.1.0" } });
    await harness.set({ discoveryVersion: 1 });

    expect(harness.current).toBe(true);
    expect(gateway.readSourceTextBounded).toHaveBeenCalledTimes(2);
  });

  it("drops prior-version evidence while the reactive manifest read is pending", async () => {
    const nextManifest = deferred<{
      readonly content: string;
      readonly status: "ok";
    }>();
    let discoveryVersion = 0;
    const gateway = sourceGateway(async () => {
      if (discoveryVersion === 0) {
        return {
          content: JSON.stringify({ dependencies: { express: "^5.1.0" } }),
          status: "ok",
        };
      }
      return nextManifest.promise;
    });
    const harness = await renderHook(root, { gateway });

    expect(harness.current).toBe(true);

    discoveryVersion = 1;
    await harness.set({ discoveryVersion });

    expect(harness.current).toBe(false);

    nextManifest.resolve({
      content: JSON.stringify({ dependencies: { fastify: "^5.0.0" } }),
      status: "ok",
    });
    await act(async () => {
      await nextManifest.promise;
    });

    expect(harness.current).toBe(false);
  });

  it("drops a result captured before an A to B to A workspace replacement", async () => {
    const workspaceA = deferred<{
      readonly content: string;
      readonly status: "ok";
    }>();
    let workspaceAReads = 0;
    const gateway = sourceGateway(async (rootPath) => {
      if (rootPath === "/workspace-a" && workspaceAReads++ === 0) return workspaceA.promise;
      return {
        content: JSON.stringify({ dependencies: { fastify: "^5.0.0" } }),
        status: "ok",
      };
    });
    const harness = await renderHook(root, {
      gateway,
      rootPath: "/workspace-a",
    });

    await harness.set({ rootPath: "/workspace-b" });
    await harness.set({ rootPath: "/workspace-a" });
    workspaceA.resolve({
      content: JSON.stringify({ dependencies: { express: "^5.1.0" } }),
      status: "ok",
    });
    await act(async () => {
      await workspaceA.promise;
    });

    expect(harness.current).toBe(false);
  });

  it("drops a result captured before an A to no workspace to A replacement", async () => {
    const firstWorkspaceA = deferred<{
      readonly content: string;
      readonly status: "ok";
    }>();
    let workspaceAReads = 0;
    const gateway = sourceGateway(async () => {
      if (workspaceAReads++ === 0) return firstWorkspaceA.promise;
      return {
        content: JSON.stringify({ dependencies: { fastify: "^5.0.0" } }),
        status: "ok",
      };
    });
    const harness = await renderHook(root, { gateway });

    await harness.set({ rootPath: null });
    await harness.set({ rootPath: "/workspace" });
    firstWorkspaceA.resolve({
      content: JSON.stringify({ dependencies: { express: "^5.1.0" } }),
      status: "ok",
    });
    await act(async () => {
      await firstWorkspaceA.promise;
    });

    expect(harness.current).toBe(false);
    expect(gateway.readSourceTextBounded).toHaveBeenCalledTimes(2);
  });

  it("keeps route discovery lazy without manifest evidence until Express is opened", async () => {
    const gateway = sourceGateway(async () => ({
      content: JSON.stringify({ dependencies: { fastify: "^5.0.0" } }),
      status: "ok",
    }));
    const harness = await renderGateHook(root, { gateway });

    expect(gateway.enumerateJavaScriptSourceFiles).not.toHaveBeenCalled();

    await harness.set({ expressViewOpen: true });

    expect(gateway.enumerateJavaScriptSourceFiles).toHaveBeenCalledOnce();
  });

  it("pins App to the manual-view or manifest-signal discovery gate", () => {
    const appSource = readFileSync("src/App.tsx", "utf8");

    expect(appSource).toContain(
      'isOpen: workbench.bottomPanelVisible && workbench.bottomPanelView === "expressRoutes" || expressWorkspaceManifestSignal',
    );
  });

  it("starts route discovery eagerly with Express manifest evidence", async () => {
    const gateway = sourceGateway(async () => ({
      content: JSON.stringify({ dependencies: { express: "^5.1.0" } }),
      status: "ok",
    }));

    await renderGateHook(root, { gateway });

    expect(gateway.enumerateJavaScriptSourceFiles).toHaveBeenCalledOnce();
  });
});

interface HookHarness {
  readonly current: boolean;
  set(overrides: Partial<HookOptions>): Promise<void>;
}

interface HookOptions {
  readonly discoveryVersion: number;
  readonly gateway: WorkspaceSourceDiscoveryGateway;
  readonly rootPath: string | null;
  readonly workspaceId: string | null;
}

interface GateHookOptions extends HookOptions {
  readonly expressViewOpen: boolean;
}

async function renderHook(
  root: Root,
  overrides: Partial<HookOptions> = {},
  strictMode = false,
): Promise<HookHarness> {
  let options: HookOptions = {
    discoveryVersion: 0,
    gateway: sourceGateway(async () => ({ content: "{}", status: "ok" })),
    rootPath: "/workspace",
    workspaceId: "workspace",
    ...overrides,
  };
  let current = false;

  function Harness() {
    current = useExpressWorkspaceManifestSignal(
      options.gateway,
      options.rootPath,
      options.workspaceId,
      options.discoveryVersion,
    );
    return null;
  }

  const render = async () => {
    await act(async () => {
      root.render(
        strictMode ? (
          <StrictMode>
            <Harness />
          </StrictMode>
        ) : (
          <Harness />
        ),
      );
      await Promise.resolve();
    });
  };

  await render();
  return {
    get current() {
      return current;
    },
    async set(next) {
      options = { ...options, ...next };
      await render();
    },
  };
}

async function renderGateHook(
  root: Root,
  overrides: Partial<GateHookOptions> = {},
): Promise<{ set(overrides: Partial<GateHookOptions>): Promise<void> }> {
  let options: GateHookOptions = {
    discoveryVersion: 0,
    expressViewOpen: false,
    gateway: sourceGateway(async () => ({ content: "{}", status: "ok" })),
    rootPath: "/workspace",
    workspaceId: "workspace",
    ...overrides,
  };

  function Harness() {
    const manifestSignal = useExpressWorkspaceManifestSignal(
      options.gateway,
      options.rootPath,
      options.workspaceId,
      options.discoveryVersion,
    );
    useWorkspaceExpressRoutes({
      discoveryVersion: options.discoveryVersion,
      gateway: options.gateway,
      isOpen: options.expressViewOpen || manifestSignal,
      rootPath: options.rootPath,
      workspaceId: options.workspaceId,
    });
    return null;
  }

  const render = async () => {
    await act(async () => {
      root.render(<Harness />);
      for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
    });
  };

  await render();
  return {
    async set(next) {
      options = { ...options, ...next };
      await render();
    },
  };
}

function sourceGateway(
  readSourceTextBounded: WorkspaceSourceDiscoveryGateway["readSourceTextBounded"],
): WorkspaceSourceDiscoveryGateway {
  return {
    enumerateJavaScriptSourceFiles: vi.fn(async () => ({
      files: [],
      truncated: false,
      visited: 0,
    })),
    readSourceTextBounded: vi.fn(readSourceTextBounded),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
