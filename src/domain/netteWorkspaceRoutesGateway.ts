import type {
  NetteWorkspaceRouteOverlay,
  NetteWorkspaceRoutesResult,
} from "./netteWorkspaceRoutes";

export type { NetteWorkspaceRouteOverlay } from "./netteWorkspaceRoutes";

export interface NetteWorkspaceRoutesGateway {
  inspectNetteWorkspaceRoutes(
    rootPath: string,
    overlays: readonly NetteWorkspaceRouteOverlay[],
  ): Promise<NetteWorkspaceRoutesResult>;
}
