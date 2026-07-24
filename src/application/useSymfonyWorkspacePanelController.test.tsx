// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SymfonyWorkspaceIntelligenceGateway } from "../domain/symfonyWorkspaceIntelligenceGateway";
import { useSymfonyWorkspacePanelController } from "./useSymfonyWorkspacePanelController";

describe("useSymfonyWorkspacePanelController", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: ReturnType<typeof useSymfonyWorkspacePanelController>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("loads the three bounded views concurrently and filters the active data", async () => {
    const gateway = createGateway();
    await render({ gateway });

    expect(gateway.listSymfonyConsoleCommands).toHaveBeenCalledWith("workspace-1");
    expect(gateway.listSymfonyRoutes).toHaveBeenCalledWith("workspace-1");
    expect(gateway.listSymfonyServices).toHaveBeenCalledWith("workspace-1");
    expect(latest.filteredCommands.map((command) => command.name)).toEqual([
      "cache:clear",
      "debug:router",
    ]);

    act(() => latest.onQueryChange("router"));
    expect(latest.filteredCommands.map((command) => command.name)).toEqual(["debug:router"]);
    act(() => latest.onQueryChange("home"));
    act(() => latest.onTabChange("routes"));
    expect(latest.activeTab).toBe("routes");
    expect(latest.filteredRoutes).toHaveLength(1);
  });

  it("exposes refresh failures without discarding the last complete snapshot", async () => {
    const gateway = createGateway();
    await render({ gateway });
    vi.mocked(gateway.listSymfonyRoutes).mockRejectedValueOnce(new Error("closed"));

    await act(async () => void (await latest.onRefresh()));

    expect(latest.error).toBe("Could not inspect the Symfony workspace.");
    expect(latest.filteredCommands).toHaveLength(2);
    expect(latest.busy).toBe(false);
  });

  it("drops old results and resets panel state after an owner switch", async () => {
    let resolveCommands!: (value: ReturnType<typeof commandResult>) => void;
    const gateway = createGateway();
    vi.mocked(gateway.listSymfonyConsoleCommands).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCommands = resolve;
      }),
    );
    let switchOwner!: () => void;
    await act(async () => {
      root.render(
        <Harness
          gateway={gateway}
          onReady={(model, changeOwner) => {
            latest = model;
            switchOwner = changeOwner;
          }}
        />,
      );
    });
    act(() => latest.onQueryChange("old"));
    await act(async () => switchOwner());
    await act(async () => resolveCommands(commandResult()));

    expect(latest.query).toBe("");
    expect(latest.error).toBeNull();
    expect(latest.commands.status).toBe("ok");
    expect(gateway.listSymfonyConsoleCommands).toHaveBeenLastCalledWith("workspace-2");
  });

  it("passes captured-owner guards through controller and service navigation", async () => {
    let controllerGuard!: () => boolean;
    const onOpenController = vi.fn(async (_route, guard: () => boolean) => {
      controllerGuard = guard;
      return true;
    });
    const onOpenService = vi.fn(async () => true);
    let switchOwner!: () => void;
    await act(async () => {
      root.render(
        <Harness
          gateway={createGateway()}
          onOpenController={onOpenController}
          onOpenService={onOpenService}
          onReady={(model, changeOwner) => {
            latest = model;
            switchOwner = changeOwner;
          }}
        />,
      );
    });

    await act(async () => {
      await latest.onOpenRouteController(routeResult().routes[0]!);
      await latest.onOpenService(serviceResult().services[0]!);
    });
    expect(controllerGuard()).toBe(true);
    await act(async () => switchOwner());
    expect(controllerGuard()).toBe(false);
    expect(onOpenService).toHaveBeenCalledOnce();
  });

  it("refreshes an open panel when Symfony discovery changes", async () => {
    const gateway = createGateway();
    let invalidate!: () => void;
    await act(async () => {
      root.render(
        <Harness
          gateway={gateway}
          onReady={(model, _switchOwner, _setOpen, invalidateDiscovery) => {
            latest = model;
            invalidate = invalidateDiscovery;
          }}
        />,
      );
    });

    expect(gateway.listSymfonyRoutes).toHaveBeenCalledOnce();
    await act(async () => invalidate());
    expect(gateway.listSymfonyRoutes).toHaveBeenCalledTimes(2);
  });

  it("defers discovery refreshes while closed and loads once when reopened", async () => {
    const gateway = createGateway();
    let setOpen!: (open: boolean) => void;
    let invalidate!: () => void;
    await act(async () => {
      root.render(
        <Harness
          gateway={gateway}
          onReady={(model, _switchOwner, changeOpen, invalidateDiscovery) => {
            latest = model;
            setOpen = changeOpen;
            invalidate = invalidateDiscovery;
          }}
        />,
      );
    });

    expect(gateway.listSymfonyServices).toHaveBeenCalledOnce();
    await act(async () => setOpen(false));
    await act(async () => invalidate());
    await act(async () => invalidate());
    expect(gateway.listSymfonyServices).toHaveBeenCalledOnce();

    await act(async () => setOpen(true));
    expect(gateway.listSymfonyServices).toHaveBeenCalledTimes(2);
  });

  it("drops an older discovery refresh that settles after the latest snapshot", async () => {
    const gateway = createGateway();
    let resolveOld!: (value: ReturnType<typeof commandResult>) => void;
    let invalidate!: () => void;
    await render({ gateway });
    vi.mocked(gateway.listSymfonyConsoleCommands).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
    );
    await act(async () => {
      root.render(
        <Harness
          gateway={gateway}
          onReady={(model, _switchOwner, _setOpen, invalidateDiscovery) => {
            latest = model;
            invalidate = invalidateDiscovery;
          }}
        />,
      );
    });

    await act(async () => invalidate());
    await act(async () => invalidate());
    await act(async () =>
      resolveOld({
        ...commandResult(),
        commands: [
          {
            aliases: [],
            description: "Stale command",
            key: "command-stale",
            name: "stale:command",
          },
        ],
      }),
    );

    expect(latest.filteredCommands.map((command) => command.name)).toEqual([
      "cache:clear",
      "debug:router",
    ]);
  });

  async function render(options: Partial<Parameters<typeof Harness>[0]> = {}): Promise<void> {
    await act(async () => {
      root.render(
        <Harness
          {...options}
          onReady={(model) => {
            latest = model;
          }}
        />,
      );
    });
  }
});

function Harness({
  gateway = createGateway(),
  onOpenController = vi.fn(async () => true),
  onOpenService = vi.fn(async () => true),
  onReady,
}: {
  gateway?: SymfonyWorkspaceIntelligenceGateway;
  onOpenController?: Parameters<typeof useSymfonyWorkspacePanelController>[0]["onOpenController"];
  onOpenService?: Parameters<typeof useSymfonyWorkspacePanelController>[0]["onOpenService"];
  onReady: (
    model: ReturnType<typeof useSymfonyWorkspacePanelController>,
    switchOwner: () => void,
    setOpen: (open: boolean) => void,
    invalidateDiscovery: () => void,
  ) => void;
}) {
  const [owner, setOwner] = useState(1);
  const [enabled, setEnabled] = useState(true);
  const [discoveryVersion, setDiscoveryVersion] = useState(0);
  const model = useSymfonyWorkspacePanelController({
    discoveryVersion,
    enabled,
    gateway,
    onOpenController,
    onOpenService,
    rootPath: `/workspace-${owner}`,
    workspaceId: `workspace-${owner}`,
  });
  onReady(
    model,
    () => setOwner((current) => current + 1),
    setEnabled,
    () => setDiscoveryVersion((current) => current + 1),
  );
  return null;
}

function createGateway(): SymfonyWorkspaceIntelligenceGateway {
  return {
    listSymfonyConsoleCommands: vi.fn(async () => commandResult()),
    listSymfonyRoutes: vi.fn(async () => routeResult()),
    listSymfonyServices: vi.fn(async () => serviceResult()),
  };
}

function commandResult() {
  return {
    status: "ok" as const,
    commands: [
      {
        key: "command-cache-clear",
        name: "cache:clear",
        description: "Clear cache",
        aliases: [],
      },
      {
        key: "command-debug-router",
        name: "debug:router",
        description: "Show routes",
        aliases: [],
      },
    ],
    total: 2,
    truncated: false,
  };
}

function routeResult() {
  return {
    status: "ok" as const,
    routes: [
      {
        key: "route-home",
        name: "app_home",
        path: "/",
        methods: ["GET"],
        controller: "App\\Controller\\HomeController::index",
      },
    ],
    total: 1,
    truncated: false,
  };
}

function serviceResult() {
  return {
    status: "ok" as const,
    services: [
      {
        key: "service-clock",
        id: "App\\Clock",
        className: "App\\Clock",
        alias: null,
        public: false,
      },
    ],
    total: 1,
    truncated: false,
  };
}
