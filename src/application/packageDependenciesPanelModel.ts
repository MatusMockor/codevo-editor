import type {
  PackageDependencyTreeGroup,
  PackageDependencyTreeItem,
} from "../domain/packageDependencyTree";
import type { PackageOperationPreview, PackageOperationRequest } from "../domain/packageOperations";

export interface PendingPackageOperation {
  readonly preview: PackageOperationPreview;
  readonly request: PackageOperationRequest;
}

export interface PackageDependenciesPanelModel {
  readonly busy: boolean;
  readonly error: string | null;
  readonly manager: string | null;
  readonly onCancelOperation: () => void;
  readonly onCheckOutdated: () => Promise<unknown> | unknown;
  readonly onConfirmOperation: () => Promise<unknown> | unknown;
  readonly onInstallPackage: (
    packageName: string,
    development: boolean,
  ) => Promise<unknown> | unknown;
  readonly onOpenDependency: (dependency: PackageDependencyTreeItem) => Promise<unknown> | unknown;
  readonly onQueryChange: (query: string) => void;
  readonly onRemoveDependency: (
    dependency: PackageDependencyTreeItem,
  ) => Promise<unknown> | unknown;
  readonly onUpdateDependency: (
    dependency: PackageDependencyTreeItem,
  ) => Promise<unknown> | unknown;
  readonly pendingOperation: PendingPackageOperation | null;
  readonly query: string;
  readonly status: string | null;
  readonly tree: readonly PackageDependencyTreeGroup[];
  readonly trusted: boolean;
}
