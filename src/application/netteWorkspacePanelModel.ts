import type {
  NetteWorkspaceService,
  NetteWorkspaceServicesResult,
} from "../domain/netteWorkspaceServices";

export interface NetteWorkspacePanelModel {
  readonly busy: boolean;
  readonly error: string | null;
  readonly filteredServices: readonly NetteWorkspaceService[];
  readonly onOpenClass: (service: NetteWorkspaceService) => Promise<boolean>;
  readonly onOpenDefinition: (service: NetteWorkspaceService) => Promise<boolean>;
  readonly onQueryChange: (query: string) => void;
  readonly onRefresh: () => Promise<boolean>;
  readonly query: string;
  readonly services: NetteWorkspaceServicesResult;
}

export type NetteServiceDefinitionNavigation = (
  location: NetteWorkspaceService["source"],
  shouldCommit: () => boolean,
) => Promise<boolean> | boolean;

export type NetteServiceClassNavigation = (
  service: NetteWorkspaceService,
  shouldCommit: () => boolean,
) => Promise<boolean> | boolean;
