import type {
  NetteWorkspacePresenter,
  NetteWorkspacePresenterAction,
  NetteWorkspacePresenterMethod,
  NetteWorkspacePresenterSignal,
  NetteWorkspacePresenterSource,
  NetteWorkspacePresentersResult,
  NetteWorkspaceTemplateSource,
} from "../domain/netteWorkspacePresenters";

export interface NetteWorkspacePresenterMatch {
  readonly presenter: NetteWorkspacePresenter;
  readonly actions: readonly NetteWorkspacePresenterAction[];
  readonly signals: readonly NetteWorkspacePresenterSignal[];
}

export interface NetteWorkspacePresentersPanelModel {
  readonly busy: boolean;
  readonly error: string | null;
  readonly filteredPresenters: readonly NetteWorkspacePresenterMatch[];
  readonly onOpenMethod: (method: NetteWorkspacePresenterMethod) => Promise<boolean>;
  readonly onOpenPresenter: (presenter: NetteWorkspacePresenter) => Promise<boolean>;
  readonly onOpenTemplate: (template: NetteWorkspaceTemplateSource) => Promise<boolean>;
  readonly onQueryChange: (query: string) => void;
  readonly onRefresh: () => Promise<boolean>;
  readonly presenters: NetteWorkspacePresentersResult;
  readonly query: string;
}

export type NettePresenterNavigation = (
  presenter: NetteWorkspacePresenter,
  shouldCommit: () => boolean,
) => Promise<boolean> | boolean;

export type NettePresenterMethodNavigation = (
  method: NetteWorkspacePresenterMethod,
  shouldCommit: () => boolean,
) => Promise<boolean> | boolean;

export type NettePresenterTemplateNavigation = (
  template: NetteWorkspaceTemplateSource,
  shouldCommit: () => boolean,
) => Promise<boolean> | boolean;

export type NettePresenterPanelSource =
  NetteWorkspacePresenterSource | NetteWorkspaceTemplateSource;
