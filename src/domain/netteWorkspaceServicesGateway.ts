import type {
  NetteWorkspaceServiceOverlay,
  NetteWorkspaceServicesResult,
} from "./netteWorkspaceServices";

export type { NetteWorkspaceServiceOverlay } from "./netteWorkspaceServices";

/** Read-only port used by the Nette services panel. */
export interface NetteWorkspaceServicesGateway {
  inspectNetteWorkspaceServices(
    rootPath: string,
    overlays: readonly NetteWorkspaceServiceOverlay[],
  ): Promise<NetteWorkspaceServicesResult>;
}
