// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NetteWorkspacePresentersGateway } from "../domain/netteWorkspacePresentersGateway";
import { useNetteWorkspacePresentersPanelController } from "./useNetteWorkspacePresentersPanelController";

describe("useNetteWorkspacePresentersPanelController", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: ReturnType<typeof useNetteWorkspacePresentersPanelController>;

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

  it("loads dirty overlays and filters presenter, method, signal and template fields", async () => {
    const gateway = createGateway();
    await render({ gateway });
    expect(gateway.inspectNetteWorkspacePresenters).toHaveBeenCalledWith("/workspace-1", [
      expect.objectContaining({ path: "/workspace-1/app/UI/Home/HomePresenter.php" }),
    ]);

    act(() => latest.onQueryChange("renderdetail"));
    expect(latest.filteredPresenters[0]?.actions.map((action) => action.name)).toEqual(["detail"]);
    expect(latest.filteredPresenters[0]?.signals).toHaveLength(0);
    act(() => latest.onQueryChange("refresh"));
    expect(latest.filteredPresenters[0]?.signals.map((signal) => signal.name)).toEqual(["refresh"]);
    act(() => latest.onQueryChange("detail.latte"));
    expect(latest.filteredPresenters[0]?.actions.map((action) => action.name)).toEqual(["detail"]);
  });

  it("keeps the last complete snapshot when a refresh throws", async () => {
    const gateway = createGateway();
    await render({ gateway });
    vi.mocked(gateway.inspectNetteWorkspacePresenters).mockRejectedValueOnce(new Error("closed"));

    await act(async () => void (await latest.onRefresh()));

    expect(latest.error).toBe("Could not inspect the Nette presenters.");
    expect(latest.filteredPresenters).toHaveLength(1);
    expect(latest.busy).toBe(false);
  });

  it("resets state on an owner switch and drops the old result", async () => {
    let resolveOld!: (value: ReturnType<typeof presentersResult>) => void;
    const gateway = createGateway();
    vi.mocked(gateway.inspectNetteWorkspacePresenters).mockReturnValueOnce(
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
    await act(async () => resolveOld(staleResult()));

    expect(latest.query).toBe("");
    expect(latest.filteredPresenters[0]?.presenter.name).toBe("Home");
    expect(gateway.inspectNetteWorkspacePresenters).toHaveBeenLastCalledWith(
      "/workspace-2",
      expect.any(Array),
    );
  });

  it("defers discovery invalidations while disabled and refreshes once reopened", async () => {
    const gateway = createGateway();
    let setEnabled!: (enabled: boolean) => void;
    let invalidate!: () => void;
    await act(async () => {
      root.render(
        <Harness
          gateway={gateway}
          onReady={(model, _switchOwner, changeEnabled, invalidateDiscovery) => {
            latest = model;
            setEnabled = changeEnabled;
            invalidate = invalidateDiscovery;
          }}
        />,
      );
    });
    expect(gateway.inspectNetteWorkspacePresenters).toHaveBeenCalledOnce();
    await act(async () => setEnabled(false));
    await act(async () => invalidate());
    await act(async () => invalidate());
    expect(gateway.inspectNetteWorkspacePresenters).toHaveBeenCalledOnce();
    await act(async () => setEnabled(true));
    expect(gateway.inspectNetteWorkspacePresenters).toHaveBeenCalledTimes(2);
  });

  it("debounces unsaved presenter edits into one refresh with the latest overlay", async () => {
    vi.useFakeTimers();
    const gateway = createGateway();
    let changeOverlay!: (source: string) => void;
    await act(async () => {
      root.render(
        <Harness
          gateway={gateway}
          onReady={(model, _switchOwner, _setEnabled, _invalidate, setOverlay) => {
            latest = model;
            changeOverlay = setOverlay;
          }}
        />,
      );
    });

    act(() => changeOverlay("<?php class H"));
    act(() => changeOverlay("<?php class HomePresenter"));
    act(() => changeOverlay("<?php class HomePresenter {}"));
    expect(gateway.inspectNetteWorkspacePresenters).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(200));
    expect(gateway.inspectNetteWorkspacePresenters).toHaveBeenCalledTimes(2);
    expect(gateway.inspectNetteWorkspacePresenters).toHaveBeenLastCalledWith("/workspace-1", [
      expect.objectContaining({ source: "<?php class HomePresenter {}" }),
    ]);
  });

  it("coalesces overlay bursts behind an active inspection without concurrent scans", async () => {
    vi.useFakeTimers();
    let releaseInspection!: (result: ReturnType<typeof presentersResult>) => void;
    let activeInspections = 0;
    let peakInspections = 0;
    const gateway = createGateway();
    vi.mocked(gateway.inspectNetteWorkspacePresenters)
      .mockImplementationOnce(async () => presentersResult())
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            activeInspections += 1;
            peakInspections = Math.max(peakInspections, activeInspections);
            releaseInspection = (result) => {
              activeInspections -= 1;
              resolve(result);
            };
          }),
      )
      .mockImplementation(async () => {
        activeInspections += 1;
        peakInspections = Math.max(peakInspections, activeInspections);
        activeInspections -= 1;
        return presentersResult();
      });
    let changeOverlay!: (source: string) => void;
    await act(async () => {
      root.render(
        <Harness
          gateway={gateway}
          onReady={(model, _switchOwner, _setEnabled, _invalidate, setOverlay) => {
            latest = model;
            changeOverlay = setOverlay;
          }}
        />,
      );
    });

    act(() => changeOverlay("<?php class FirstPresenter {}"));
    await act(async () => vi.advanceTimersByTimeAsync(200));
    act(() => changeOverlay("<?php class LatestPresenter {}"));
    await act(async () => vi.advanceTimersByTimeAsync(200));
    expect(gateway.inspectNetteWorkspacePresenters).toHaveBeenCalledTimes(2);

    await act(async () => releaseInspection(presentersResult()));
    expect(gateway.inspectNetteWorkspacePresenters).toHaveBeenCalledTimes(3);
    expect(gateway.inspectNetteWorkspacePresenters).toHaveBeenLastCalledWith("/workspace-1", [
      expect.objectContaining({ source: "<?php class LatestPresenter {}" }),
    ]);
    expect(peakInspections).toBe(1);
  });

  it("passes owner guards to every navigation and invalidates them after a switch", async () => {
    const guards: (() => boolean)[] = [];
    const capture = vi.fn(async (_item, guard: () => boolean) => {
      guards.push(guard);
      return true;
    });
    let switchOwner!: () => void;
    await act(async () => {
      root.render(
        <Harness
          gateway={createGateway()}
          onOpenMethod={capture}
          onOpenPresenter={capture}
          onOpenTemplate={capture}
          onReady={(model, changeOwner) => {
            latest = model;
            switchOwner = changeOwner;
          }}
        />,
      );
    });
    const presenter = latest.filteredPresenters[0]!.presenter;
    await act(async () => {
      await latest.onOpenPresenter(presenter);
      await latest.onOpenMethod(presenter.actions[0]!.renderMethod!);
      await latest.onOpenTemplate(presenter.actions[0]!.templates[0]!);
    });
    expect(guards).toHaveLength(3);
    expect(guards.every((guard) => guard())).toBe(true);
    await act(async () => switchOwner());
    expect(guards.every((guard) => !guard())).toBe(true);
  });

  it("reports navigation failures without throwing", async () => {
    await render({
      onOpenPresenter: vi.fn(async () => {
        throw new Error("closed");
      }),
    });

    await act(
      async () => void (await latest.onOpenPresenter(latest.filteredPresenters[0]!.presenter)),
    );
    expect(latest.error).toBe("Could not open the Nette presenter declaration.");
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
  onOpenMethod = vi.fn(async () => true),
  onOpenPresenter = vi.fn(async () => true),
  onOpenTemplate = vi.fn(async () => true),
  onReady,
}: {
  gateway: NetteWorkspacePresentersGateway;
  onOpenMethod?: Parameters<typeof useNetteWorkspacePresentersPanelController>[0]["onOpenMethod"];
  onOpenPresenter?: Parameters<
    typeof useNetteWorkspacePresentersPanelController
  >[0]["onOpenPresenter"];
  onOpenTemplate?: Parameters<
    typeof useNetteWorkspacePresentersPanelController
  >[0]["onOpenTemplate"];
  onReady: (
    model: ReturnType<typeof useNetteWorkspacePresentersPanelController>,
    switchOwner: () => void,
    setEnabled: (enabled: boolean) => void,
    invalidateDiscovery: () => void,
    setOverlay: (source: string) => void,
  ) => void;
}) {
  const [owner, setOwner] = useState(1);
  const [enabled, setEnabled] = useState(true);
  const [discoveryVersion, setDiscoveryVersion] = useState(0);
  const [overlaySource, setOverlaySource] = useState("<?php // dirty");
  const model = useNetteWorkspacePresentersPanelController({
    discoveryVersion,
    enabled,
    gateway,
    onOpenMethod,
    onOpenPresenter,
    onOpenTemplate,
    overlays: [
      {
        path: `/workspace-${owner}/app/UI/Home/HomePresenter.php`,
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

function createGateway(): NetteWorkspacePresentersGateway {
  return { inspectNetteWorkspacePresenters: vi.fn(async () => presentersResult()) };
}

function presentersResult() {
  const presenterPath = "/workspace-1/app/UI/Home/HomePresenter.php";
  return {
    status: "ok" as const,
    presenters: [
      {
        actions: [
          {
            actionMethod: { methodName: "actionDetail", source: location(presenterPath, 8, 21) },
            key: "home-action-detail",
            name: "detail",
            renderMethod: { methodName: "renderDetail", source: location(presenterPath, 12, 21) },
            templates: [
              { path: "app/UI/Home/detail.latte", lineNumber: 1 as const, column: 1 as const },
            ],
            templatesTruncated: false,
          },
        ],
        actionsTruncated: false,
        className: "App\\UI\\Home\\HomePresenter",
        key: "home-presenter",
        name: "Home",
        signals: [
          {
            key: "home-signal-refresh",
            method: { methodName: "handleRefresh", source: location(presenterPath, 18, 21) },
            name: "refresh",
          },
        ],
        signalsTruncated: false,
        source: location(presenterPath, 4, 7),
      },
    ],
    total: 1,
    truncated: false,
  };
}

function staleResult() {
  const result = presentersResult();
  return {
    ...result,
    presenters: [{ ...result.presenters[0]!, name: "Stale" }],
  };
}

function location(path: string, lineNumber: number, column: number) {
  return { path, lineNumber, column };
}
