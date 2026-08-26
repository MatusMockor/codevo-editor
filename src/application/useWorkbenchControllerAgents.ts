import {
  useCallback,
  useMemo,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { AgentRootLeaseGateway } from "../domain/agentProject";
import type { GitChangedFile, GitGateway } from "../domain/git";
import type { GitRepositoryMapping, GitRepositoryStatus } from "../domain/gitRepositoryMapping";
import type {
  AppSettings,
  SettingsGateway,
  SettingsSection,
  WorkspaceSettings,
} from "../domain/settings";
import type { WorkspaceTrustGateway, WorkspaceTrustState } from "../domain/trust";
import type { EditorDocument, FileEntry } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
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
import type { WorkspaceTrustIntentCoordinator } from "./workspaceTrustIntentCoordinator";
import type { WorkspaceIdentityDescriptor } from "./workspaceIdentityGatewayPort";
import { createWorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";

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
  readonly setWorkspaceTrust: Dispatch<SetStateAction<WorkspaceTrustState | null>>;
  readonly settingsGateway: Pick<SettingsGateway, "loadWorkspaceSettings">;
  readonly workspaceIdentityByRootRef: {
    readonly current: Readonly<Record<string, WorkspaceIdentityDescriptor>>;
  };
  readonly workspaceIdentityDescriptor: { readonly workspaceId: string } | null;
  readonly workspaceRoot: string | null;
  readonly workspaceSettingsRef: { readonly current: WorkspaceSettings };
  readonly workspaceTrust: WorkspaceTrustState | null;
  readonly workspaceTrustGateway: WorkspaceTrustGateway;
  readonly workspaceTrustIntentCoordinatorRef: {
    readonly current: WorkspaceTrustIntentCoordinator;
  };
  readonly workspaceTrustRevisionByOwnerRef: MutableRefObject<Record<string, number>>;
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
  const activeWorkspaceRoot = options.workspaceRoot;
  const activeWorkspaceId = options.workspaceIdentityDescriptor?.workspaceId ?? null;
  const setWorkspaceTrust = options.setWorkspaceTrust;
  const workspaceTrustIntentCoordinatorRef = options.workspaceTrustIntentCoordinatorRef;
  const workspaceTrustRevisionByOwnerRef = options.workspaceTrustRevisionByOwnerRef;

  const handleActiveWorkspaceTrustChanged = useCallback(
    (rootPath: string, ownerId: string, trusted: boolean): void => {
      if (activeWorkspaceRoot === null) return;
      if (!workspaceRootKeysEqual(activeWorkspaceRoot, rootPath)) return;
      if (activeWorkspaceId !== ownerId) return;
      const trustIntent = workspaceTrustIntentCoordinatorRef.current.request(
        createWorkspaceRuntimeOwner(ownerId, rootPath),
        rootPath,
        trusted,
      );
      workspaceTrustRevisionByOwnerRef.current[ownerId] = trustIntent.revision;
      setWorkspaceTrust((current) => {
        if (
          current !== null &&
          current.trusted === trusted &&
          workspaceRootKeysEqual(current.rootPath, rootPath)
        ) {
          return current;
        }
        return { rootPath, trusted };
      });
    },
    [
      activeWorkspaceId,
      activeWorkspaceRoot,
      setWorkspaceTrust,
      workspaceTrustIntentCoordinatorRef,
      workspaceTrustRevisionByOwnerRef,
    ],
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
    onActiveWorkspaceTrustChanged: handleActiveWorkspaceTrustChanged,
    prompter: options.prompter,
    reportError: options.reportError,
    setSettingsInitialSection: options.setSettingsInitialSection,
    setSettingsOpen: options.setSettingsOpen,
    workspaceId: options.workspaceIdentityDescriptor?.workspaceId ?? null,
    workspaceRoot: options.workspaceRoot,
    workspaceTrust: options.workspaceTrust,
  });

  return useMemo(
    () => ({ ...agents, agentModeActive, agentWorkbench }),
    [agentModeActive, agentWorkbench, agents],
  );
}

interface WorkspaceTrustOwnerLoadOptions {
  readonly gateway: WorkspaceTrustGateway;
  readonly isCurrent: () => boolean;
  readonly ownerId: string;
  readonly publish: (trust: WorkspaceTrustState) => void;
  readonly reportError: (error: unknown) => void;
  readonly revisionByOwnerRef: { readonly current: Readonly<Record<string, number>> };
  readonly rootPath: string;
}

export async function loadWorkspaceTrustForOwner(
  options: WorkspaceTrustOwnerLoadOptions,
): Promise<void> {
  const revision = options.revisionByOwnerRef.current[options.ownerId] ?? 0;
  try {
    const trust = await options.gateway.getTrust(options.rootPath);
    if (!workspaceTrustOwnerLoadIsCurrent(options, revision)) return;
    options.publish(trust);
  } catch (error) {
    if (!workspaceTrustOwnerLoadIsCurrent(options, revision)) return;
    options.reportError(error);
  }
}

function workspaceTrustOwnerLoadIsCurrent(
  options: WorkspaceTrustOwnerLoadOptions,
  revision: number,
): boolean {
  if (!options.isCurrent()) return false;
  return (options.revisionByOwnerRef.current[options.ownerId] ?? 0) === revision;
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
