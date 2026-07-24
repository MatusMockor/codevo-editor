import type { PackageOperationsGateway } from "../domain/packageOperations";
import type { EditorDocument, WorkspaceDescriptor } from "../domain/workspace";
import type { WorkspaceSourceDiscoveryGateway } from "../domain/workspaceSourceDiscovery";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import { usePackageDependenciesPanelController } from "./usePackageDependenciesPanelController";

const EMPTY_PACKAGES = [] as const;

interface AppPackageDependenciesPanelOptions {
  readonly descriptor: WorkspaceDescriptor | null;
  readonly documents: readonly EditorDocument[];
  readonly gateway: WorkspaceSourceDiscoveryGateway;
  readonly onOpenLocation: Parameters<
    typeof usePackageDependenciesPanelController
  >[0]["onOpenLocation"];
  readonly onRefresh: () => Promise<unknown> | unknown;
  readonly operationsGateway: PackageOperationsGateway;
  readonly rootPath: string | null;
  readonly trusted: boolean;
  readonly workspaceId: string | null;
}

export function useAppPackageDependenciesPanel({
  descriptor,
  documents,
  gateway,
  onOpenLocation,
  onRefresh,
  operationsGateway,
  rootPath,
  trusted,
  workspaceId,
}: AppPackageDependenciesPanelOptions) {
  const workspace =
    rootPath && descriptor && workspaceRootKeysEqual(rootPath, descriptor.rootPath)
      ? descriptor.javaScriptTypeScript
      : null;

  return usePackageDependenciesPanelController({
    documents,
    gateway,
    onOpenLocation,
    onRefresh,
    operationsGateway,
    packageManager: workspace?.packageManager ?? null,
    packages: workspace?.packages ?? EMPTY_PACKAGES,
    rootPath,
    trusted,
    workspaceId,
  });
}
