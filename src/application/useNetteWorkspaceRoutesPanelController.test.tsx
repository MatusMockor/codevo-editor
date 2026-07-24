// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NetteWorkspaceRoutesGateway } from "../domain/netteWorkspaceRoutesGateway";
import { useNetteWorkspaceRoutesPanelController } from "./useNetteWorkspaceRoutesPanelController";

describe("useNetteWorkspaceRoutesPanelController", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: ReturnType<typeof useNetteWorkspaceRoutesPanelController>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    vi.useRealTimers();
    act(() => root.unmount());
    host.remove();
  });

  it("loads overlays and filters mask, methods, target and source", async () => {
    const gateway = createGateway();
    await render({ gateway });
    expect(gateway.inspectNetteWorkspaceRoutes).toHaveBeenCalledWith("/workspace-1", [
      expect.objectContaining({ source: "<?php // routes" }),
    ]);
    for (const query of ["api/<id>", "post", "product:detail", "routerfactory.php"]) {
      act(() => latest.onQueryChange(query));
      expect(latest.filteredRoutes.map((route) => route.mask)).toEqual(["api/<id>"]);
    }
  });

  it("preserves its snapshot when refresh throws", async () => {
    const gateway = createGateway();
    await render({ gateway });
    vi.mocked(gateway.inspectNetteWorkspaceRoutes).mockRejectedValueOnce(new Error("closed"));
    await act(async () => void (await latest.onRefresh()));
    expect(latest.error).toBe("Could not inspect the Nette routes.");
    expect(latest.filteredRoutes).toHaveLength(2);
  });

  it("drops stale owner results and resets the query", async () => {
    let resolveOld!: (result: ReturnType<typeof routesResult>) => void;
    const gateway = createGateway();
    vi.mocked(gateway.inspectNetteWorkspaceRoutes).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
    );
    let switchOwner!: () => void;
    await act(async () =>
      root.render(
        <Harness
          gateway={gateway}
          onReady={(model, changeOwner) => {
            latest = model;
            switchOwner = changeOwner;
          }}
        />,
      ),
    );
    act(() => latest.onQueryChange("old"));
    await act(async () => switchOwner());
    await act(async () =>
      resolveOld({ ...routesResult(), routes: [{ ...routesResult().routes[0]!, mask: "stale" }] }),
    );
    expect(latest.query).toBe("");
    expect(latest.filteredRoutes[0]?.mask).toBe("api/<id>");
  });

  it("defers invalidations while disabled", async () => {
    const gateway = createGateway();
    let setEnabled!: (enabled: boolean) => void;
    let invalidate!: () => void;
    await act(async () =>
      root.render(
        <Harness
          gateway={gateway}
          onReady={(model, _owner, enabled, discovery) => {
            latest = model;
            setEnabled = enabled;
            invalidate = discovery;
          }}
        />,
      ),
    );
    await act(async () => setEnabled(false));
    await act(async () => invalidate());
    expect(gateway.inspectNetteWorkspaceRoutes).toHaveBeenCalledOnce();
    await act(async () => setEnabled(true));
    expect(gateway.inspectNetteWorkspaceRoutes).toHaveBeenCalledTimes(2);
  });

  it("debounces an overlay burst to its latest revision", async () => {
    vi.useFakeTimers();
    const gateway = createGateway();
    let setOverlay!: (source: string) => void;
    await act(async () =>
      root.render(
        <Harness
          gateway={gateway}
          onReady={(model, _owner, _enabled, _discovery, overlay) => {
            latest = model;
            setOverlay = overlay;
          }}
        />,
      ),
    );
    act(() => setOverlay("a"));
    act(() => setOverlay("ab"));
    act(() => setOverlay("latest"));
    expect(gateway.inspectNetteWorkspaceRoutes).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(200));
    expect(gateway.inspectNetteWorkspaceRoutes).toHaveBeenCalledTimes(2);
    expect(gateway.inspectNetteWorkspaceRoutes).toHaveBeenLastCalledWith("/workspace-1", [
      expect.objectContaining({ source: "latest" }),
    ]);
  });

  it("coalesces refreshes behind one active inspection", async () => {
    vi.useFakeTimers();
    let release!: (result: ReturnType<typeof routesResult>) => void;
    const gateway = createGateway();
    vi.mocked(gateway.inspectNetteWorkspaceRoutes)
      .mockImplementationOnce(async () => routesResult())
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      )
      .mockImplementation(async () => routesResult());
    let setOverlay!: (source: string) => void;
    await act(async () =>
      root.render(
        <Harness
          gateway={gateway}
          onReady={(model, _owner, _enabled, _discovery, overlay) => {
            latest = model;
            setOverlay = overlay;
          }}
        />,
      ),
    );
    act(() => setOverlay("first"));
    await act(async () => vi.advanceTimersByTimeAsync(200));
    act(() => setOverlay("latest"));
    await act(async () => vi.advanceTimersByTimeAsync(200));
    expect(gateway.inspectNetteWorkspaceRoutes).toHaveBeenCalledTimes(2);
    await act(async () => release(routesResult()));
    expect(gateway.inspectNetteWorkspaceRoutes).toHaveBeenCalledTimes(3);
    expect(gateway.inspectNetteWorkspaceRoutes).toHaveBeenLastCalledWith("/workspace-1", [
      expect.objectContaining({ source: "latest" }),
    ]);
  });

  it("guards definition and target navigation and rejects a dynamic target", async () => {
    let guard!: () => boolean;
    const capture = vi.fn(async (_value, shouldCommit: () => boolean) => {
      guard = shouldCommit;
      return true;
    });
    let switchOwner!: () => void;
    await act(async () =>
      root.render(
        <Harness
          gateway={createGateway()}
          onOpenDefinition={capture}
          onOpenTarget={capture}
          onReady={(model, owner) => {
            latest = model;
            switchOwner = owner;
          }}
        />,
      ),
    );
    await act(async () => {
      await latest.onOpenDefinition(latest.filteredRoutes[0]!);
      await latest.onOpenTarget(latest.filteredRoutes[0]!);
    });
    expect(capture).toHaveBeenCalledTimes(2);
    expect(await latest.onOpenTarget(latest.filteredRoutes[1]!)).toBe(false);
    expect(guard()).toBe(true);
    await act(async () => switchOwner());
    expect(guard()).toBe(false);
  });

  async function render(options: Partial<Parameters<typeof Harness>[0]> = {}) {
    const gateway = options.gateway ?? createGateway();
    await act(async () =>
      root.render(
        <Harness
          {...options}
          gateway={gateway}
          onReady={(model) => {
            latest = model;
          }}
        />,
      ),
    );
  }
});

function Harness({
  gateway,
  onOpenDefinition = vi.fn(async () => true),
  onOpenTarget = vi.fn(async () => true),
  onReady,
}: {
  gateway: NetteWorkspaceRoutesGateway;
  onOpenDefinition?: Parameters<
    typeof useNetteWorkspaceRoutesPanelController
  >[0]["onOpenDefinition"];
  onOpenTarget?: Parameters<typeof useNetteWorkspaceRoutesPanelController>[0]["onOpenTarget"];
  onReady: (
    model: ReturnType<typeof useNetteWorkspaceRoutesPanelController>,
    switchOwner: () => void,
    setEnabled: (enabled: boolean) => void,
    invalidate: () => void,
    setOverlay: (source: string) => void,
  ) => void;
}) {
  const [owner, setOwner] = useState(1);
  const [enabled, setEnabled] = useState(true);
  const [version, setVersion] = useState(0);
  const [overlay, setOverlay] = useState("<?php // routes");
  const model = useNetteWorkspaceRoutesPanelController({
    discoveryVersion: version,
    enabled,
    gateway,
    onOpenDefinition,
    onOpenTarget,
    overlays: [{ path: `/workspace-${owner}/app/Router/RouterFactory.php`, source: overlay }],
    rootPath: `/workspace-${owner}`,
  });
  onReady(
    model,
    () => setOwner((value) => value + 1),
    setEnabled,
    () => setVersion((value) => value + 1),
    setOverlay,
  );
  return null;
}

function createGateway(): NetteWorkspaceRoutesGateway {
  return { inspectNetteWorkspaceRoutes: vi.fn(async () => routesResult()) };
}

function routesResult() {
  return {
    status: "ok" as const,
    routes: [
      {
        key: "api",
        mask: "api/<id>",
        methods: ["GET", "POST"],
        target: { raw: "Product:detail", presenter: "Product", action: "detail" },
        source: { path: "/workspace-1/app/Router/RouterFactory.php", lineNumber: 8, column: 19 },
      },
      {
        key: "dynamic",
        mask: "dynamic",
        methods: [],
        target: null,
        source: { path: "/workspace-1/app/Router/DynamicFactory.php", lineNumber: 9, column: 19 },
      },
    ],
    total: 2,
    truncated: false,
  };
}
