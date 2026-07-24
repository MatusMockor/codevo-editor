import type {
  NetteWorkspacePresenterOverlay,
  NetteWorkspacePresentersResult,
} from "./netteWorkspacePresenters";

export type { NetteWorkspacePresenterOverlay } from "./netteWorkspacePresenters";

export interface NetteWorkspacePresentersGateway {
  inspectNetteWorkspacePresenters(
    rootPath: string,
    overlays: readonly NetteWorkspacePresenterOverlay[],
  ): Promise<NetteWorkspacePresentersResult>;
}
