import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import type { AgentRootLeaseGateway } from "../domain/agentProject";
import type { AgentTaskGateway } from "../domain/agentTask";
import type { GitGateway } from "../domain/git";
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
import type { WorkspaceTrustGateway } from "../domain/trust";
import { isDirty, type EditorDocument } from "../domain/workspace";
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
import { useAgentThreads } from "./useAgentThreads";
import type { WorkspaceIdentityDescriptor } from "./workspaceIdentityGatewayPort";
import type { WorkbenchPrompter } from "./workbenchPrompter";
import {
  defaultAgentTaskGateway,
  defaultAgentThreadStoreGateway,
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
  readonly agentThreadStoreGateway?: AgentThreadStoreGateway;
  readonly gitWorktreeGateway?: GitWorktreeGateway;
  readonly agentProjectGateways?: WorkbenchAgentProjectGateways;
  readonly agentModeActive: boolean;
  readonly appSettingsRef: { readonly current: AppSettings };
  readonly workspaceSettingsRef: { readonly current: WorkspaceSettings };
  readonly gitGateway: Pick<GitGateway, "getStatus" | "getDiff">;
  readonly gitRepositoryMappings: ReadonlyArray<GitRepositoryMapping>;
  readonly gitRepositoryStatuses: ReadonlyArray<GitRepositoryStatus>;
  readonly openDocuments: ReadonlyArray<EditorDocument>;
  readonly prompter: WorkbenchPrompter;
  readonly reportError: (source: string, error: unknown) => void;
  readonly setSettingsInitialSection: (section: SettingsSection) => void;
  readonly setSettingsOpen: (open: boolean) => void;
  readonly workspaceId: string | null;
  readonly workspaceRoot: string | null;
}

export interface WorkbenchAgentsSurface extends AgentThreadsSurface {
  readonly agentProjects: AgentProjectsSurface;
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
    prompter: options.prompter,
    reportError: options.reportError,
  });

  const threads = useAgentThreads({
    agentTaskGateway: options.agentTaskGateway ?? defaultAgentTaskGateway,
    agentThreadStoreGateway: options.agentThreadStoreGateway ?? defaultAgentThreadStoreGateway,
    gitWorktreeGateway: options.gitWorktreeGateway ?? defaultGitWorktreeGateway,
    gitGateway: options.gitGateway,
    prompter: options.prompter,
    projects: agentProjects.projects,
    agentModeActive: options.agentModeActive,
    getAgentCliPath: () => options.appSettingsRef.current.agentCliPath,
    getAgentCliKind: () => options.appSettingsRef.current.agentCliKind,
    getMaxConcurrentAgentTasks: () => options.appSettingsRef.current.maxConcurrentAgentTasks,
    getRepositoryStatus,
    getDirtyEditorDocumentCount,
    onProjectDispatchTrustRejected: agentProjects.noteDispatchTrustRejected,
    ensureProjectLease: agentProjects.ensureProjectLease,
    reportError: options.reportError,
    openAgentSettings,
  });

  useLayoutEffect(() => {
    threadsSurfaceRef.current = threads;
  });

  return useMemo(() => ({ ...threads, agentProjects }), [agentProjects, threads]);
}
