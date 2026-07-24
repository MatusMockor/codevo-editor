// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NetteWorkspaceServicesGateway } from "../domain/netteWorkspaceServicesGateway";
import { useNetteWorkspacePanelController } from "./useNetteWorkspacePanelController";

describe("useNetteWorkspacePanelController", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: ReturnType<typeof useNetteWorkspacePanelController>;

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

  it("loads services with dirty overlays and filters every useful service field", async () => {
    const gateway = createGateway();
    await render({ gateway });

    expect(gateway.inspectNetteWorkspaceServices).toHaveBeenCalledWith("/workspace-1", [
      { path: "/workspace-1/app/config/services.neon", source: "services:\n" },
    ]);
    expect(latest.filteredServices).toHaveLength(2);
    act(() => latest.onQueryChange("clock.neon"));
    expect(latest.filteredServices.map((service) => service.id)).toEqual(["clock"]);
    act(() => latest.onQueryChange("legacyclock"));
    expect(latest.filteredServices.map((service) => service.id)).toEqual(["clock"]);
  });

  it("preserves the last snapshot when refresh throws", async () => {
    const gateway = createGateway();
    await render({ gateway });
    vi.mocked(gateway.inspectNetteWorkspaceServices).mockRejectedValueOnce(new Error("closed"));

    await act(async () => void (await latest.onRefresh()));

    expect(latest.error).toBe("Could not inspect the Nette workspace.");
    expect(latest.filteredServices).toHaveLength(2);
    expect(latest.busy).toBe(false);
  });

  it("resets owner state and drops a stale workspace result", async () => {
    let resolveOld!: (value: ReturnType<typeof servicesResult>) => void;
    const gateway = createGateway();
    vi.mocked(gateway.inspectNetteWorkspaceServices).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve;
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
    await act(async () => resolveOld(staleServicesResult()));

    expect(latest.query).toBe("");
    expect(latest.filteredServices.map((service) => service.id)).toEqual(["clock", "mailer"]);
    expect(gateway.inspectNetteWorkspaceServices).toHaveBeenLastCalledWith(
      "/workspace-2",
      expect.any(Array),
    );
  });

  it("refreshes for discovery changes only while enabled", async () => {
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
    expect(gateway.inspectNetteWorkspaceServices).toHaveBeenCalledOnce();

    await act(async () => setOpen(false));
    await act(async () => invalidate());
    await act(async () => invalidate());
    expect(gateway.inspectNetteWorkspaceServices).toHaveBeenCalledOnce();

    await act(async () => setOpen(true));
    expect(gateway.inspectNetteWorkspaceServices).toHaveBeenCalledTimes(2);
  });

  it("debounces unsaved NEON edits into one refresh", async () => {
    vi.useFakeTimers();
    const gateway = createGateway();
    let changeOverlay!: (source: string) => void;
    await act(async () => {
      root.render(
        <Harness
          gateway={gateway}
          onReady={(model, _switchOwner, _setOpen, _invalidate, setOverlay) => {
            latest = model;
            changeOverlay = setOverlay;
          }}
        />,
      );
    });

    act(() => changeOverlay("i"));
    act(() => changeOverlay("includes:"));
    act(() => changeOverlay("includes:\n  - extra.neon"));

    expect(gateway.inspectNetteWorkspaceServices).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(200));
    expect(gateway.inspectNetteWorkspaceServices).toHaveBeenCalledTimes(2);
    expect(gateway.inspectNetteWorkspaceServices).toHaveBeenLastCalledWith("/workspace-1", [
      expect.objectContaining({ source: "includes:\n  - extra.neon" }),
    ]);
  });

  it("serializes a refresh queued behind an active inspection", async () => {
    vi.useFakeTimers();
    let releaseInspection!: (result: ReturnType<typeof servicesResult>) => void;
    const gateway = createGateway();
    vi.mocked(gateway.inspectNetteWorkspaceServices)
      .mockImplementationOnce(async () => servicesResult())
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseInspection = resolve;
          }),
      )
      .mockImplementation(async () => servicesResult());
    let changeOverlay!: (source: string) => void;
    await act(async () => {
      root.render(
        <Harness
          gateway={gateway}
          onReady={(model, _switchOwner, _setOpen, _invalidate, setOverlay) => {
            latest = model;
            changeOverlay = setOverlay;
          }}
        />,
      );
    });

    act(() => changeOverlay("services:\n  first: App\\First"));
    await act(async () => vi.advanceTimersByTimeAsync(200));
    act(() => changeOverlay("services:\n  latest: App\\Latest"));
    await act(async () => vi.advanceTimersByTimeAsync(200));
    expect(gateway.inspectNetteWorkspaceServices).toHaveBeenCalledTimes(2);

    await act(async () => releaseInspection(servicesResult()));
    expect(gateway.inspectNetteWorkspaceServices).toHaveBeenCalledTimes(3);
    expect(gateway.inspectNetteWorkspaceServices).toHaveBeenLastCalledWith("/workspace-1", [
      expect.objectContaining({ source: "services:\n  latest: App\\Latest" }),
    ]);
  });

  it("guards definition and class navigation against owner switches", async () => {
    let definitionGuard!: () => boolean;
    const onOpenSource = vi.fn(async (_source, guard: () => boolean) => {
      definitionGuard = guard;
      return true;
    });
    const onOpenClass = vi.fn(async () => true);
    let switchOwner!: () => void;
    await act(async () => {
      root.render(
        <Harness
          gateway={createGateway()}
          onOpenClass={onOpenClass}
          onOpenSource={onOpenSource}
          onReady={(model, changeOwner) => {
            latest = model;
            switchOwner = changeOwner;
          }}
        />,
      );
    });

    await act(async () => {
      await latest.onOpenDefinition(latest.filteredServices[0]!);
      await latest.onOpenClass(latest.filteredServices[0]!);
    });
    expect(onOpenSource).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/workspace-1/app/config/clock.neon" }),
      expect.any(Function),
    );
    expect(onOpenClass).toHaveBeenCalledOnce();
    expect(definitionGuard()).toBe(true);
    await act(async () => switchOwner());
    expect(definitionGuard()).toBe(false);
  });

  it("does not navigate an anonymous service class and reports navigation failures", async () => {
    const onOpenClass = vi.fn(async () => true);
    const onOpenSource = vi.fn(async () => {
      throw new Error("closed");
    });
    await render({ onOpenClass, onOpenSource });

    expect(await latest.onOpenClass(latest.filteredServices[1]!)).toBe(false);
    await act(async () => void (await latest.onOpenDefinition(latest.filteredServices[0]!)));
    expect(onOpenClass).not.toHaveBeenCalled();
    expect(latest.error).toBe("Could not open the Nette declaration.");
  });

  async function render(options: Partial<Parameters<typeof Harness>[0]> = {}): Promise<void> {
    const gateway = options.gateway ?? createGateway();
    await act(async () => {
      root.render(
        <Harness
          {...options}
          gateway={gateway}
          onReady={(model) => {
            latest = model;
          }}
        />,
      );
    });
  }
});

function Harness({
  gateway,
  onOpenClass = vi.fn(async () => true),
  onOpenSource = vi.fn(async () => true),
  onReady,
}: {
  gateway: NetteWorkspaceServicesGateway;
  onOpenClass?: Parameters<typeof useNetteWorkspacePanelController>[0]["onOpenClass"];
  onOpenSource?: Parameters<typeof useNetteWorkspacePanelController>[0]["onOpenSource"];
  onReady: (
    model: ReturnType<typeof useNetteWorkspacePanelController>,
    switchOwner: () => void,
    setOpen: (open: boolean) => void,
    invalidateDiscovery: () => void,
    setOverlay: (source: string) => void,
  ) => void;
}) {
  const [owner, setOwner] = useState(1);
  const [enabled, setEnabled] = useState(true);
  const [discoveryVersion, setDiscoveryVersion] = useState(0);
  const [overlaySource, setOverlaySource] = useState("services:\n");
  const model = useNetteWorkspacePanelController({
    discoveryVersion,
    enabled,
    gateway,
    onOpenClass,
    onOpenSource,
    overlays: [
      {
        path: `/workspace-${owner}/app/config/services.neon`,
        source: overlaySource,
      },
    ],
    rootPath: `/workspace-${owner}`,
  });
  onReady(
    model,
    () => setOwner((current) => current + 1),
    setEnabled,
    () => setDiscoveryVersion((current) => current + 1),
    setOverlaySource,
  );
  return null;
}

function createGateway(): NetteWorkspaceServicesGateway {
  return { inspectNetteWorkspaceServices: vi.fn(async () => servicesResult()) };
}

function servicesResult() {
  return {
    status: "ok" as const,
    services: [
      {
        alias: "LegacyClock",
        autowired: true,
        className: "App\\Clock",
        id: "clock",
        key: "clock-key",
        source: {
          column: 5,
          lineNumber: 3,
          path: "/workspace-1/app/config/clock.neon",
        },
      },
      {
        alias: null,
        autowired: false,
        className: null,
        id: "mailer",
        key: "mailer-key",
        source: {
          column: 5,
          lineNumber: 8,
          path: "/workspace-1/app/config/services.neon",
        },
      },
    ],
    total: 2,
    truncated: false,
  };
}

function staleServicesResult() {
  return {
    ...servicesResult(),
    services: [{ ...servicesResult().services[0]!, id: "stale" }],
    total: 1,
  };
}
