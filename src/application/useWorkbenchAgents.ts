import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import type { AgentCliVersionGateway } from "../domain/agentCliVersion";
import { activeAgentCliPath } from "../domain/agentSettings";
import type { AgentRootLeaseGateway } from "../domain/agentProject";
import type { AgentTaskGateway } from "../domain/agentTask";
import type {
  AgentProviderHealthGateway,
  AgentProviderPolicyGateway,
  AgentProviderUpdateGateway,
} from "../domain/agentProviderHealth";
import type { GitIntegrationGateway } from "../domain/gitIntegration";
import {
  repositoryRootForMapping,
  resolveGitRepositoryForPath,
  type GitRepositoryMapping,
  type GitRepositoryStatus,
  type ResolvedGitRepository,
} from "../domain/gitRepositoryMapping";
import type { GitWorktreeGateway } from "../domain/gitWorktree";
import type {
  AppSettings,
  SettingsGateway,
  SettingsSection,
  WorkspaceSettings,
} from "../domain/settings";
import type { WorkspaceTrustGateway, WorkspaceTrustState } from "../domain/trust";
import { isDirty, type EditorDocument } from "../domain/workspace";
import { runningTurn } from "../domain/agentThread";
import {
  useAgentProjects,
  type AgentProjectsSurface,
  type AgentRepositoryDiscoveryGateway,
} from "./useAgentProjects";
import type {
  AgentRepositoryStatusSnapshot,
  AgentThreadStoreGateway,
  AgentThreadsSurface,
} from "./agentThreadPorts";
import type { AgentEditorBridgePort } from "./useAgentEditorBridge";
import type { ExternalUrlOpenerPort } from "./useAgentShipFlow";
import { useAgentThreads, type AgentThreadsGitGateway } from "./useAgentThreads";
import type { WorkspaceIdentityDescriptor } from "./workspaceIdentityGatewayPort";
import {
  useAgentProviderManagement,
  type AgentProviderManagementSurface,
} from "./useAgentProviderManagement";
import type { WorkbenchPrompter } from "./workbenchPrompter";
import {
  defaultAgentTaskGateway,
  defaultAgentThreadStoreGateway,
  defaultCompareUrlOpener,
  defaultGitIntegrationGateway,
  defaultGitWorktreeGateway,
} from "./workbenchDefaultGateways";

export interface WorkbenchAgentProjectGateways {
  readonly settingsGateway: Pick<SettingsGateway, "loadWorkspaceSettings">;
  readonly trustGateway: WorkspaceTrustGateway;
  readonly repositoryDiscoveryGateway: AgentRepositoryDiscoveryGateway;
  readonly agentRootLeaseGateway: AgentRootLeaseGateway;
  readonly descriptorForRoot: (rootPath: string) => WorkspaceIdentityDescriptor | null;
}

export interface WorkbenchAgentsOptions {
  readonly agentTaskGateway?: AgentTaskGateway;
  readonly agentProviderGateway: AgentProviderPolicyGateway &
    AgentProviderHealthGateway &
    AgentProviderUpdateGateway;
  readonly agentCliVersionGateway?: AgentCliVersionGateway;
  readonly agentThreadStoreGateway?: AgentThreadStoreGateway;
  readonly gitWorktreeGateway?: GitWorktreeGateway;
  readonly gitIntegrationGateway?: GitIntegrationGateway;
  readonly externalUrlOpener?: ExternalUrlOpenerPort | null;
  readonly editorBridge?: AgentEditorBridgePort | null;
  readonly agentProjectGateways?: WorkbenchAgentProjectGateways;
  readonly agentModeActive: boolean;
  readonly appSettingsRef: { readonly current: AppSettings };
  readonly applyAppSettings: (settings: AppSettings) => void;
  readonly settingsHydrated: boolean;
  readonly settingsPersistenceGateway: Pick<SettingsGateway, "saveAppSettings">;
  readonly workspaceSettingsRef: { readonly current: WorkspaceSettings };
  readonly gitGateway: AgentThreadsGitGateway;
  readonly gitRepositoryMappings: ReadonlyArray<GitRepositoryMapping>;
  readonly gitRepositoryStatuses: ReadonlyArray<GitRepositoryStatus>;
  readonly openDocuments: ReadonlyArray<EditorDocument>;
  readonly onActiveWorkspaceTrustChanged: (
    rootPath: string,
    ownerId: string,
    trusted: boolean,
  ) => void;
  readonly prompter: WorkbenchPrompter;
  readonly reportError: (source: string, error: unknown) => void;
  readonly setSettingsInitialSection: (section: SettingsSection) => void;
  readonly setSettingsOpen: (open: boolean) => void;
  readonly workspaceId: string | null;
  readonly workspaceRoot: string | null;
  readonly workspaceTrust: WorkspaceTrustState | null;
}

export interface WorkbenchAgentsSurface extends AgentThreadsSurface {
  readonly agentProjects: AgentProjectsSurface;
  readonly providerManagement: AgentProviderManagementSurface;
}

const unwiredGatewayError = (): Error =>
  new Error("Agent project gateways are not wired for this workbench.");

const unwiredSettingsGateway: Pick<SettingsGateway, "loadWorkspaceSettings"> = {
  loadWorkspaceSettings: () => Promise.reject(unwiredGatewayError()),
};

const unwiredTrustGateway: WorkspaceTrustGateway = {
  getTrust: () => Promise.reject(unwiredGatewayError()),
  setTrust: () => Promise.reject(unwiredGatewayError()),
};

const unwiredDiscoveryGateway: AgentRepositoryDiscoveryGateway = {
  detectRepositories: () => Promise.reject(unwiredGatewayError()),
};

const unwiredLeaseGateway: AgentRootLeaseGateway = {
  acquireAgentRootLease: () => Promise.reject(unwiredGatewayError()),
  releaseAgentRootLease: () => Promise.reject(unwiredGatewayError()),
};

export function useWorkbenchAgents(options: WorkbenchAgentsOptions): WorkbenchAgentsSurface {
  const {
    gitRepositoryMappings,
    gitRepositoryStatuses,
    openDocuments,
    setSettingsInitialSection,
    setSettingsOpen,
    workspaceId,
    workspaceRoot,
  } = options;

  const resolvedRepositories = useMemo<ReadonlyArray<ResolvedGitRepository>>(() => {
    if (!workspaceRoot) {
      return [];
    }

    return gitRepositoryMappings.map((mapping) => ({
      mapping,
      repositoryRoot: repositoryRootForMapping(mapping, workspaceRoot),
      repositoryRelativePath: "",
    }));
  }, [gitRepositoryMappings, workspaceRoot]);

  const getRepositoryStatus = useCallback(
    (repositoryRoot: string): AgentRepositoryStatusSnapshot => {
      const entry = gitRepositoryStatuses.find((candidate) => candidate.root === repositoryRoot);

      if (!entry || entry.failed) {
        return { known: false, dirty: false };
      }

      return { known: true, dirty: entry.status.changes.length > 0 };
    },
    [gitRepositoryStatuses],
  );

  const getDirtyEditorDocumentCount = useCallback(
    (repositoryRoot: string): number => {
      if (!workspaceRoot) {
        return 0;
      }

      return openDocuments.filter((document) => {
        if (!isDirty(document)) {
          return false;
        }

        const resolved = resolveGitRepositoryForPath(
          [...gitRepositoryMappings],
          workspaceRoot,
          document.path,
        );

        return resolved?.repositoryRoot === repositoryRoot;
      }).length;
    },
    [gitRepositoryMappings, openDocuments, workspaceRoot],
  );

  const openAgentSettings = useCallback(() => {
    setSettingsInitialSection("agents");
    setSettingsOpen(true);
  }, [setSettingsInitialSection, setSettingsOpen]);

  const threadsSurfaceRef = useRef<AgentThreadsSurface | null>(null);
  const providerOperationSequenceRef = useRef(0);
  const providerWorkspaceOwnerRef = useRef({
    generation: 0,
    workspaceId,
    workspaceRoot,
  });
  if (
    providerWorkspaceOwnerRef.current.workspaceId !== workspaceId ||
    providerWorkspaceOwnerRef.current.workspaceRoot !== workspaceRoot
  ) {
    providerWorkspaceOwnerRef.current = {
      generation: providerWorkspaceOwnerRef.current.generation + 1,
      workspaceId,
      workspaceRoot,
    };
  }
  const projectGateways = options.agentProjectGateways;

  const hasLiveTasksForOwner = useCallback(
    (ownerId: string): boolean => threadsSurfaceRef.current?.hasLiveTasksForOwner(ownerId) ?? false,
    [],
  );
  const stopProjectTasks = useCallback(
    (ownerId: string, repositoryRoots: ReadonlyArray<string>): Promise<void> =>
      threadsSurfaceRef.current?.stopProjectTasks(ownerId, repositoryRoots) ?? Promise.resolve(),
    [],
  );
  const releaseProjectTasks = useCallback((ownerId: string): void => {
    threadsSurfaceRef.current?.releaseProjectTasks(ownerId);
  }, []);
  const liveTurnCount = useCallback((provider: "claudeCode" | "codex"): number => {
    const surface = threadsSurfaceRef.current;
    const threads = surface?.threads ?? [];
    const published = threads.reduce((count, view) => {
      if (view.thread.provider.kind !== provider) return count;
      return runningTurn(view.thread) === null ? count : count + 1;
    }, 0);
    return published + (surface?.pendingTurnCount(provider) ?? 0);
  }, []);
  const mintProviderOperationId = useCallback((provider: "claudeCode" | "codex"): string => {
    providerOperationSequenceRef.current += 1;
    return agentProviderUpdateOperationId(provider, providerOperationSequenceRef.current);
  }, []);
  const descriptorForRoot = useCallback(
    (rootPath: string): WorkspaceIdentityDescriptor | null =>
      projectGateways?.descriptorForRoot(rootPath) ?? null,
    [projectGateways],
  );

  const agentProjects = useAgentProjects({
    enabled: projectGateways !== undefined,
    appSettingsRef: options.appSettingsRef,
    activeWorkspaceId: workspaceId,
    activeWorkspaceRoot: workspaceRoot,
    activeWorkspaceTrust: options.workspaceTrust,
    activeWorkspaceRepositories: resolvedRepositories,
    activeIsolationPolicy: options.workspaceSettingsRef.current.agentIsolationPolicy,
    descriptorForRoot,
    settingsGateway: projectGateways?.settingsGateway ?? unwiredSettingsGateway,
    trustGateway: projectGateways?.trustGateway ?? unwiredTrustGateway,
    repositoryDiscoveryGateway:
      projectGateways?.repositoryDiscoveryGateway ?? unwiredDiscoveryGateway,
    agentRootLeaseGateway: projectGateways?.agentRootLeaseGateway ?? unwiredLeaseGateway,
    hasLiveTasksForOwner,
    stopProjectTasks,
    releaseProjectTasks,
    onActiveWorkspaceTrustChanged: options.onActiveWorkspaceTrustChanged,
    prompter: options.prompter,
    reportError: options.reportError,
  });

  const providerManagement = useAgentProviderManagement({
    appSettingsRef: options.appSettingsRef,
    applyAppSettings: options.applyAppSettings,
    settingsGateway: options.settingsPersistenceGateway,
    settingsHydrated: options.settingsHydrated,
    policyGateway: options.agentProviderGateway,
    healthGateway: options.agentProviderGateway,
    updateGateway: options.agentProviderGateway,
    liveTurnCount,
    reportError: options.reportError,
    mintOperationId: mintProviderOperationId,
    workspaceGeneration: providerWorkspaceOwnerRef.current.generation,
  });

  const threads = useAgentThreads({
    agentTaskGateway: options.agentTaskGateway ?? defaultAgentTaskGateway,
    agentCliVersionGateway: options.agentCliVersionGateway,
    agentThreadStoreGateway: options.agentThreadStoreGateway ?? defaultAgentThreadStoreGateway,
    gitWorktreeGateway: options.gitWorktreeGateway ?? defaultGitWorktreeGateway,
    gitGateway: options.gitGateway,
    gitIntegrationGateway: options.gitIntegrationGateway ?? defaultGitIntegrationGateway,
    externalUrlOpener:
      options.externalUrlOpener === undefined ? defaultCompareUrlOpener : options.externalUrlOpener,
    editorBridge: options.editorBridge ?? null,
    prompter: options.prompter,
    projects: agentProjects.projects,
    agentModeActive: options.agentModeActive,
    getAgentCliPath: () =>
      activeAgentCliPath(
        options.appSettingsRef.current.agentCliPaths,
        options.appSettingsRef.current.agentCliKind,
      ),
    getAgentCliKind: () => options.appSettingsRef.current.agentCliKind,
    getAgentProviderAdmissionAuthority: providerManagement.admissionAuthority,
    getMaxConcurrentAgentTasks: () => options.appSettingsRef.current.maxConcurrentAgentTasks,
    getRepositoryStatus,
    getDirtyEditorDocumentCount,
    onProjectDispatchTrustRejected: agentProjects.noteDispatchTrustRejected,
    ensureProjectLease: agentProjects.ensureProjectLease,
    launchIdentityForProject: agentProjects.launchIdentityForProject,
    reportError: options.reportError,
    openAgentSettings,
  });

  useLayoutEffect(() => {
    threadsSurfaceRef.current = threads;
  });

  return useMemo(
    () => ({ ...threads, agentProjects, providerManagement }),
    [agentProjects, providerManagement, threads],
  );
}

export function agentProviderUpdateOperationId(
  provider: "claudeCode" | "codex",
  sequence: number,
): string {
  return `${provider}-update-${sequence}`;
}
