// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppFrameworkBottomPanels } from "./useAppFrameworkBottomPanels";
import { useAppPackageDependenciesPanel } from "./useAppPackageDependenciesPanel";
import { useNetteWorkspacePanelController } from "./useNetteWorkspacePanelController";
import { useNetteWorkspacePresentersPanelController } from "./useNetteWorkspacePresentersPanelController";
import { useNetteWorkspaceRoutesPanelController } from "./useNetteWorkspaceRoutesPanelController";
import { useSymfonyWorkspacePanelController } from "./useSymfonyWorkspacePanelController";

vi.mock("./useAppPackageDependenciesPanel", () => ({
  useAppPackageDependenciesPanel: vi.fn(() => ({ kind: "packages" })),
}));

vi.mock("./useSymfonyWorkspacePanelController", () => ({
  useSymfonyWorkspacePanelController: vi.fn(() => ({ kind: "symfony" })),
}));

vi.mock("./useNetteWorkspacePanelController", () => ({
  useNetteWorkspacePanelController: vi.fn(() => ({ kind: "services" })),
}));

vi.mock("./useNetteWorkspacePresentersPanelController", () => ({
  useNetteWorkspacePresentersPanelController: vi.fn(() => ({ kind: "presenters" })),
}));

vi.mock("./useNetteWorkspaceRoutesPanelController", () => ({
  useNetteWorkspaceRoutesPanelController: vi.fn(() => ({ kind: "routes" })),
}));

describe("useAppFrameworkBottomPanels", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: ReturnType<typeof useAppFrameworkBottomPanels>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.clearAllMocks();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("enables Symfony inspection only for its visible active panel and forwards navigation", async () => {
    const workbench = createWorkbench({
      bottomPanelView: "symfony",
      bottomPanelVisible: true,
      hasSymfonyFramework: true,
    });

    await render(workbench);

    expect(useSymfonyWorkspacePanelController).toHaveBeenCalledWith({
      discoveryVersion: 0,
      enabled: true,
      gateway: symfonyGateway,
      onOpenController: workbench.openSymfonyRouteController,
      onOpenService: workbench.openSymfonyService,
      rootPath: "/workspace",
      workspaceId: "workspace-1",
    });
    expect(latest.hasSymfony).toBe(true);
    expect(latest.symfonyWorkspacePanel).toEqual({ kind: "symfony" });
  });

  it("enables Nette services only for an active full Nette application", async () => {
    const workbench = createWorkbench({
      bottomPanelView: "nette",
      bottomPanelVisible: true,
      hasNetteApplicationFramework: true,
    });

    await render(workbench);

    expect(useNetteWorkspacePanelController).toHaveBeenCalledWith(
      expect.objectContaining({
        discoveryVersion: 0,
        enabled: true,
        gateway: netteGateway,
        onOpenClass: expect.any(Function),
        overlays: [],
        rootPath: "/workspace",
      }),
    );
    expect(latest.hasNette).toBe(true);
    expect(useNetteWorkspacePresentersPanelController).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false, gateway: nettePresentersGateway }),
    );
    expect(useNetteWorkspaceRoutesPanelController).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false, gateway: netteRoutesGateway }),
    );
    expect(latest.netteWorkspacePanel).toEqual(
      expect.objectContaining({
        activeSection: "services",
        presenters: { kind: "presenters" },
        routes: { kind: "routes" },
        services: { kind: "services" },
      }),
    );

    act(() => latest.netteWorkspacePanel.onSectionChange("presenters"));
    expect(useNetteWorkspacePanelController).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false }),
    );
    expect(useNetteWorkspacePresentersPanelController).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: true }),
    );
    act(() => latest.netteWorkspacePanel.onSectionChange("routes"));
    expect(useNetteWorkspacePresentersPanelController).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: true }),
    );
    expect(useNetteWorkspaceRoutesPanelController).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: true }),
    );
  });

  it.each([
    { bottomPanelView: "problems", bottomPanelVisible: true, hasSymfonyFramework: true },
    { bottomPanelView: "symfony", bottomPanelVisible: false, hasSymfonyFramework: true },
    { bottomPanelView: "symfony", bottomPanelVisible: true, hasSymfonyFramework: false },
  ])("keeps Symfony inspection disabled outside its eligible active state", async (state) => {
    await render(createWorkbench(state));

    expect(useSymfonyWorkspacePanelController).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false }),
    );
  });

  it("forwards the package panel workspace context alongside Symfony composition", async () => {
    const workbench = createWorkbench();

    await render(workbench);

    expect(useAppPackageDependenciesPanel).toHaveBeenCalledWith({
      descriptor: workbench.workspaceDescriptor,
      documents: workbench.openDocuments,
      gateway: sourceGateway,
      onOpenLocation: workbench.openDebugLocation,
      onRefresh: workbench.refreshWorkspace,
      operationsGateway: operationsGateway,
      rootPath: "/workspace",
      trusted: true,
      workspaceId: "workspace-1",
    });
    expect(latest.packageDependenciesPanel).toEqual({ kind: "packages" });
  });

  async function render(workbench = createWorkbench()): Promise<void> {
    await act(async () => {
      root.render(
        <Harness
          onReady={(value) => {
            latest = value;
          }}
          workbench={workbench}
        />,
      );
    });
  }
});

const operationsGateway = {} as Parameters<
  typeof useAppFrameworkBottomPanels
>[0]["packageOperationsGateway"];
const netteGateway = {} as Parameters<
  typeof useAppFrameworkBottomPanels
>[0]["netteWorkspaceServicesGateway"];
const nettePresentersGateway = {} as Parameters<
  typeof useAppFrameworkBottomPanels
>[0]["netteWorkspacePresentersGateway"];
const netteRoutesGateway = {} as Parameters<
  typeof useAppFrameworkBottomPanels
>[0]["netteWorkspaceRoutesGateway"];
const sourceGateway = {} as Parameters<
  typeof useAppFrameworkBottomPanels
>[0]["workspaceSourceDiscoveryGateway"];
const symfonyGateway = {} as Parameters<
  typeof useAppFrameworkBottomPanels
>[0]["symfonyWorkspaceIntelligenceGateway"];

function Harness({
  onReady,
  workbench,
}: {
  onReady(value: ReturnType<typeof useAppFrameworkBottomPanels>): void;
  workbench: Parameters<typeof useAppFrameworkBottomPanels>[0]["workbench"];
}) {
  const value = useAppFrameworkBottomPanels({
    netteWorkspacePresentersGateway: nettePresentersGateway,
    netteWorkspaceRoutesGateway: netteRoutesGateway,
    netteWorkspaceServicesGateway: netteGateway,
    packageOperationsGateway: operationsGateway,
    symfonyWorkspaceIntelligenceGateway: symfonyGateway,
    workbench,
    workspaceSourceDiscoveryGateway: sourceGateway,
    workspaceTrusted: true,
  });
  onReady(value);
  return null;
}

function createWorkbench(
  overrides: Record<string, unknown> = {},
): Parameters<typeof useAppFrameworkBottomPanels>[0]["workbench"] {
  return {
    bottomPanelView: "problems",
    bottomPanelVisible: false,
    hasSymfonyFramework: false,
    hasNetteApplicationFramework: false,
    netteDiscoveryVersion: 0,
    openDebugLocation: vi.fn(),
    openDocuments: [],
    openPhpClassTarget: vi.fn(),
    openSymfonyRouteController: vi.fn(),
    openSymfonyService: vi.fn(),
    symfonyDiscoveryVersion: 0,
    refreshWorkspace: vi.fn(),
    workspaceDescriptor: null,
    workspaceIdentityDescriptor: { workspaceId: "workspace-1" },
    workspaceRoot: "/workspace",
    ...overrides,
  } as unknown as Parameters<typeof useAppFrameworkBottomPanels>[0]["workbench"];
}
