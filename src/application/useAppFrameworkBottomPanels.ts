import type { useWorkbenchController } from "./useWorkbenchController";
import { useMemo, useState } from "react";
import type { NetteWorkspaceServicesGateway } from "../domain/netteWorkspaceServicesGateway";
import type { NetteWorkspacePresentersGateway } from "../domain/netteWorkspacePresentersGateway";
import type { NetteWorkspaceRoutesGateway } from "../domain/netteWorkspaceRoutesGateway";
import type { NetteOperationalSection } from "./netteOperationalPanelModel";
import { dirtyNetteWorkspacePresenterOverlays } from "./netteWorkspacePresenterOverlays";
import { dirtyNetteWorkspaceRouteOverlays } from "./netteWorkspaceRouteOverlays";
import { dirtyNetteWorkspaceServiceOverlays } from "./netteWorkspaceServiceOverlays";
import { useNetteWorkspacePresentersPanelController } from "./useNetteWorkspacePresentersPanelController";
import { useNetteWorkspaceRoutesPanelController } from "./useNetteWorkspaceRoutesPanelController";
import { netteRouteTargetNavigationSource } from "./netteRouteTargetNavigation";
import { useNetteWorkspacePanelController } from "./useNetteWorkspacePanelController";
import { useAppPackageDependenciesPanel } from "./useAppPackageDependenciesPanel";
import { useSymfonyWorkspacePanelController } from "./useSymfonyWorkspacePanelController";

type Workbench = ReturnType<typeof useWorkbenchController>;
type PackagePanelOptions = Parameters<typeof useAppPackageDependenciesPanel>[0];
type SymfonyPanelOptions = Parameters<typeof useSymfonyWorkspacePanelController>[0];

interface AppFrameworkBottomPanelsOptions {
  readonly packageOperationsGateway: PackagePanelOptions["operationsGateway"];
  readonly netteWorkspacePresentersGateway: NetteWorkspacePresentersGateway;
  readonly netteWorkspaceRoutesGateway: NetteWorkspaceRoutesGateway;
  readonly netteWorkspaceServicesGateway: NetteWorkspaceServicesGateway;
  readonly symfonyWorkspaceIntelligenceGateway: SymfonyPanelOptions["gateway"];
  readonly workbench: Workbench;
  readonly workspaceSourceDiscoveryGateway: PackagePanelOptions["gateway"];
  readonly workspaceTrusted: boolean;
}

export function useAppFrameworkBottomPanels({
  packageOperationsGateway,
  netteWorkspacePresentersGateway,
  netteWorkspaceRoutesGateway,
  netteWorkspaceServicesGateway,
  symfonyWorkspaceIntelligenceGateway,
  workbench,
  workspaceSourceDiscoveryGateway,
  workspaceTrusted,
}: AppFrameworkBottomPanelsOptions) {
  const workspaceId = workbench.workspaceIdentityDescriptor?.workspaceId ?? null;
  const packageDependenciesPanel = useAppPackageDependenciesPanel({
    descriptor: workbench.workspaceDescriptor,
    documents: workbench.openDocuments,
    gateway: workspaceSourceDiscoveryGateway,
    onOpenLocation: workbench.openDebugLocation,
    onRefresh: workbench.refreshWorkspace,
    operationsGateway: packageOperationsGateway,
    rootPath: workbench.workspaceRoot,
    trusted: workspaceTrusted,
    workspaceId,
  });
  const hasSymfony = workbench.hasSymfonyFramework;
  const hasNette = workbench.hasNetteApplicationFramework;
  const [netteSection, setNetteSection] = useState<NetteOperationalSection>("services");
  const nettePanelActive =
    hasNette && workbench.bottomPanelVisible && workbench.bottomPanelView === "nette";
  const netteOverlays = useMemo(
    () => dirtyNetteWorkspaceServiceOverlays(workbench.openDocuments, workbench.workspaceRoot),
    [workbench.openDocuments, workbench.workspaceRoot],
  );
  const nettePresenterOverlays = useMemo(
    () => dirtyNetteWorkspacePresenterOverlays(workbench.openDocuments, workbench.workspaceRoot),
    [workbench.openDocuments, workbench.workspaceRoot],
  );
  const netteRouteOverlays = useMemo(
    () => dirtyNetteWorkspaceRouteOverlays(workbench.openDocuments, workbench.workspaceRoot),
    [workbench.openDocuments, workbench.workspaceRoot],
  );
  const netteServicesPanel = useNetteWorkspacePanelController({
    discoveryVersion: workbench.netteDiscoveryVersion,
    enabled: nettePanelActive && netteSection === "services",
    gateway: netteWorkspaceServicesGateway,
    onOpenClass: (service, shouldCommit) =>
      service.className
        ? workbench.openPhpClassTarget(service.className, service.className, {
            canNavigate: shouldCommit,
          })
        : Promise.resolve(false),
    onOpenSource: (source, shouldCommit) =>
      workbench.openDebugLocation(source.path, source.lineNumber, source.column, shouldCommit),
    overlays: netteOverlays,
    rootPath: workbench.workspaceRoot,
  });
  const nettePresentersPanel = useNetteWorkspacePresentersPanelController({
    discoveryVersion: workbench.netteDiscoveryVersion,
    enabled: nettePanelActive && (netteSection === "presenters" || netteSection === "routes"),
    gateway: netteWorkspacePresentersGateway,
    onOpenMethod: (method, shouldCommit) =>
      workbench.openDebugLocation(
        method.source.path,
        method.source.lineNumber,
        method.source.column,
        shouldCommit,
      ),
    onOpenPresenter: (presenter, shouldCommit) =>
      workbench.openDebugLocation(
        presenter.source.path,
        presenter.source.lineNumber,
        presenter.source.column,
        shouldCommit,
      ),
    onOpenTemplate: (template, shouldCommit) =>
      workbench.openDebugLocation(
        template.path,
        template.lineNumber,
        template.column,
        shouldCommit,
      ),
    overlays: nettePresenterOverlays,
    rootPath: workbench.workspaceRoot,
  });
  const netteRoutesPanel = useNetteWorkspaceRoutesPanelController({
    discoveryVersion: workbench.netteDiscoveryVersion,
    enabled: nettePanelActive && netteSection === "routes",
    gateway: netteWorkspaceRoutesGateway,
    onOpenDefinition: (source, shouldCommit) =>
      workbench.openDebugLocation(source.path, source.lineNumber, source.column, shouldCommit),
    onOpenTarget: (target, shouldCommit) => {
      const source = netteRouteTargetNavigationSource(target, nettePresentersPanel.presenters);
      return source
        ? workbench.openDebugLocation(source.path, source.lineNumber, source.column, shouldCommit)
        : Promise.resolve(false);
    },
    overlays: netteRouteOverlays,
    rootPath: workbench.workspaceRoot,
  });
  const netteWorkspacePanel = {
    activeSection: netteSection,
    onSectionChange: setNetteSection,
    presenters: nettePresentersPanel,
    routes: netteRoutesPanel,
    services: netteServicesPanel,
  };
  const symfonyWorkspacePanel = useSymfonyWorkspacePanelController({
    discoveryVersion: workbench.symfonyDiscoveryVersion,
    enabled: hasSymfony && workbench.bottomPanelVisible && workbench.bottomPanelView === "symfony",
    gateway: symfonyWorkspaceIntelligenceGateway,
    onOpenController: workbench.openSymfonyRouteController,
    onOpenService: workbench.openSymfonyService,
    rootPath: workbench.workspaceRoot,
    workspaceId,
  });

  return {
    hasNette,
    hasSymfony,
    netteWorkspacePanel,
    packageDependenciesPanel,
    symfonyWorkspacePanel,
  };
}
