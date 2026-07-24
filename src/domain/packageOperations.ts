export const PACKAGE_OPERATIONS = ["install", "update", "remove", "outdated"] as const;

export type PackageOperation = (typeof PACKAGE_OPERATIONS)[number];

export interface PackageOperationRequest {
  readonly workspaceId: string;
  readonly operation: PackageOperation;
  readonly packageName?: string;
  readonly development?: boolean;
}

export interface PackageOperationPreview {
  readonly manager: NodePackageManager;
  readonly arguments: readonly string[];
  readonly description: string;
  readonly mutatesManifest: boolean;
}

export type PackageOperationRunResult =
  | {
      readonly status: "ok";
      readonly message: string;
      readonly manifestChanged: boolean;
    }
  | { readonly status: "unavailable"; readonly message: string }
  | { readonly status: "error"; readonly message: string };

/** Boundary consumed by application workflows; transport details stay in infrastructure. */
export interface PackageOperationsGateway {
  previewPackageOperation(request: PackageOperationRequest): Promise<PackageOperationPreview>;
  runPackageOperation(request: PackageOperationRequest): Promise<PackageOperationRunResult>;
}
import type { NodePackageManager } from "./packageManagerDetection";
