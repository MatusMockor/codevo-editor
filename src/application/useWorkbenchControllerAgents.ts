import { useCallback, useMemo } from "react";
import type { AgentRootLeaseGateway } from "../domain/agentProject";
import type { GitChangedFile, GitGateway } from "../domain/git";
import type { GitRepositoryMapping, GitRepositoryStatus } from "../domain/gitRepositoryMapping";
import type {
  AppSettings,
  SettingsGateway,
  SettingsSection,
  WorkspaceSettings,
} from "../domain/settings";
import type { WorkspaceTrustGateway } from "../domain/trust";
import type { EditorDocument, FileEntry } from "../domain/workspace";
import type { AgentThreadStoreGateway } from "./agentThreadPorts";
import type { AgentEditorBridgePort } from "./useAgentEditorBridge";
import {
  useAgentWorkbenchLayout,
  type AgentWorkbenchLayoutHydration,
  type AgentWorkbenchLayoutPersistencePort,
  type AgentWorkbenchLayoutState,
  type AgentWorkbenchLayoutSurface,
} from "./useAgentWorkbenchLayout";
import {
  useWorkbenchAgents,
  type WorkbenchAgentProjectGateways,
  type WorkbenchAgentsSurface,
} from "./useWorkbenchAgents";
import type { WorkbenchControllerOptions } from "./workbenchControllerContracts";
import type { WorkbenchPrompter } from "./workbenchPrompter";
import type { WorkspaceIdentityDescriptor } from "./workspaceIdentityGatewayPort";

export function useAgentProjectGateways(
  agentRootLeaseGateway: AgentRootLeaseGateway | undefined,
  identityByRootRef: { readonly current: Readonly<Record<string, WorkspaceIdentityDescriptor>> },
  gitGateway: Pick<GitGateway, "detectRepositories">,
  settingsGateway: Pick<SettingsGateway, "loadWorkspaceSettings">,
  trustGateway: WorkspaceTrustGateway,
): WorkbenchAgentProjectGateways | undefined {
  const descriptorForRoot = useCallback(
    (rootPath: string): WorkspaceIdentityDescriptor | null =>
      identityByRootRef.current[rootPath] ?? null,
    [identityByRootRef],
  );

  return useMemo(
    () =>
      agentRootLeaseGateway === undefined
        ? undefined
        : {
            settingsGateway,
            trustGateway,
            repositoryDiscoveryGateway: {
              detectRepositories: (rootPath: string, maxDepth?: number) =>
                gitGateway.detectRepositories?.(rootPath, maxDepth) ?? Promise.resolve([]),
            },
            agentRootLeaseGateway,
            descriptorForRoot,
          },
    [agentRootLeaseGateway, descriptorForRoot, gitGateway, settingsGateway, trustGateway],
  );
}

export type WorkbenchControllerOpenFileRef = {
  readonly current: (
    entry: FileEntry,
    options?: { pin?: boolean; readOnly?: boolean; recordNavigation?: boolean },
  ) => Promise<boolean>;
};

export type WorkbenchControllerOpenGitChange = (
  change: GitChangedFile,
  repositoryRoot?: string,
) => Promise<void>;

export type WorkbenchControllerPersistWorkspaceSettings = (
  rootPath: string,
  nextSettings: WorkspaceSettings,
) => Promise<void>;

export interface WorkbenchControllerAgentsOptions {
  readonly agentLayoutAvailable?: boolean;
  readonly agentThreadStoreGateway?: AgentThreadStoreGateway;
  readonly appSettingsRef: { readonly current: AppSettings };
  readonly bottomPanelVisible: boolean;
  readonly editorSessionOwnerKey: string | null;
  readonly options: Pick<
    WorkbenchControllerOptions,
    "agentCliVersionGateway" | "agentRootLeaseGateway" | "agentTaskGateway" | "gitWorktreeGateway"
  >;
  readonly openFileRef: WorkbenchControllerOpenFileRef;
  readonly openGitChange: WorkbenchControllerOpenGitChange;
  readonly gitGateway: Pick<
    GitGateway,
    "getStatus" | "getDiff" | "detectRepositories" | "stageFiles" | "commit" | "deleteBranch"
  >;
  readonly gitRepositoryMappings: ReadonlyArray<GitRepositoryMapping>;
  readonly gitRepositoryStatuses: ReadonlyArray<GitRepositoryStatus>;
  readonly openDocuments: ReadonlyArray<EditorDocument>;
  readonly persistedAgentWorkbenchLayout?: AgentWorkbenchLayoutHydration | null;
  readonly persistWorkspaceSettings?: WorkbenchControllerPersistWorkspaceSettings;
  readonly prompter: WorkbenchPrompter;
  readonly reportError: (source: string, error: unknown) => void;
  readonly setSettingsInitialSection: (section: SettingsSection) => void;
  readonly setSettingsOpen: (open: boolean) => void;
  readonly settingsGateway: Pick<SettingsGateway, "loadWorkspaceSettings">;
  readonly workspaceIdentityByRootRef: {
    readonly current: Readonly<Record<string, WorkspaceIdentityDescriptor>>;
  };
  readonly workspaceIdentityDescriptor: { readonly workspaceId: string } | null;
  readonly workspaceRoot: string | null;
  readonly workspaceSettingsRef: { readonly current: WorkspaceSettings };
  readonly workspaceTrustGateway: WorkspaceTrustGateway;
}

export interface WorkbenchControllerAgentsSurface
  extends WorkbenchAgentsSurface, AgentWorkbenchLayoutSurface {}

export function useWorkbenchControllerAgents(
  options: WorkbenchControllerAgentsOptions,
): WorkbenchControllerAgentsSurface {
  const layoutPersistence = useAgentWorkbenchLayoutPersistence(
    options.workspaceRoot,
    options.persistWorkspaceSettings,
    options.workspaceSettingsRef,
  );

  const agentLayout = useAgentWorkbenchLayout({
    workspaceOwnerKey: options.editorSessionOwnerKey,
    hasWorkspace: options.workspaceRoot !== null,
    agentLayoutAvailable:
      options.agentLayoutAvailable ?? options.options.agentRootLeaseGateway !== undefined,
    bottomPanelVisible: options.bottomPanelVisible,
    hydration:
      options.persistedAgentWorkbenchLayout ??
      agentWorkbenchHydration(options.editorSessionOwnerKey, options.workspaceSettingsRef.current),
    persistence: layoutPersistence,
    reportError: options.reportError,
  });
  const { agentModeActive, agentWorkbench } = agentLayout;

  const agentProjectGateways = useAgentProjectGateways(
    options.options.agentRootLeaseGateway,
    options.workspaceIdentityByRootRef,
    options.gitGateway,
    options.settingsGateway,
    options.workspaceTrustGateway,
  );

  const editorBridge = useAgentEditorBridgePort(
    options.openFileRef,
    options.openGitChange,
    agentWorkbench.dispatch,
  );

  const agents = useWorkbenchAgents({
    agentCliVersionGateway: options.options.agentCliVersionGateway,
    agentTaskGateway: options.options.agentTaskGateway,
    agentThreadStoreGateway: options.agentThreadStoreGateway,
    gitWorktreeGateway: options.options.gitWorktreeGateway,
    editorBridge,
    agentProjectGateways,
    agentModeActive,
    appSettingsRef: options.appSettingsRef,
    workspaceSettingsRef: options.workspaceSettingsRef,
    gitGateway: options.gitGateway,
    gitRepositoryMappings: options.gitRepositoryMappings,
    gitRepositoryStatuses: options.gitRepositoryStatuses,
    openDocuments: options.openDocuments,
    prompter: options.prompter,
    reportError: options.reportError,
    setSettingsInitialSection: options.setSettingsInitialSection,
    setSettingsOpen: options.setSettingsOpen,
    workspaceId: options.workspaceIdentityDescriptor?.workspaceId ?? null,
    workspaceRoot: options.workspaceRoot,
  });

  return useMemo(
    () => ({ ...agents, agentModeActive, agentWorkbench }),
    [agentModeActive, agentWorkbench, agents],
  );
}

function useAgentWorkbenchLayoutPersistence(
  workspaceRoot: string | null,
  persistWorkspaceSettings: WorkbenchControllerPersistWorkspaceSettings | undefined,
  workspaceSettingsRef: { readonly current: WorkspaceSettings },
): AgentWorkbenchLayoutPersistencePort | null {
  return useMemo(() => {
    if (workspaceRoot === null || persistWorkspaceSettings === undefined) {
      return null;
    }

    return {
      write: async (_ownerKey, agentWorkbench) => {
        const settings = workspaceSettingsRef.current;
        await persistWorkspaceSettings(workspaceRoot, {
          ...settings,
          session: { ...settings.session, agentWorkbench },
        });
      },
    };
  }, [persistWorkspaceSettings, workspaceRoot, workspaceSettingsRef]);
}

function useAgentEditorBridgePort(
  openFileRef: WorkbenchControllerOpenFileRef,
  openGitChange: WorkbenchControllerOpenGitChange,
  dispatchAgentLayout: AgentWorkbenchLayoutState["dispatch"],
): AgentEditorBridgePort {
  return useMemo(
    () => ({
      openFile: (entry, options) => openFileRef.current(entry, options),
      openGitChange: (change, repositoryRoot) => openGitChange(change, repositoryRoot),
      openSurface: (surface) => dispatchAgentLayout({ kind: "openSurface", surface }),
    }),
    [dispatchAgentLayout, openFileRef, openGitChange],
  );
}

export function agentWorkbenchHydration(
  ownerKey: string | null,
  settings: WorkspaceSettings,
): AgentWorkbenchLayoutHydration | null {
  if (ownerKey === null) return null;
  return { ownerKey, layout: settings.session.agentWorkbench };
}
