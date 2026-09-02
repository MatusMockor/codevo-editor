import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import type { AgentCliDiscoveryGateway } from "../domain/agentSettings";
import type { AgentRootLeaseGateway } from "../domain/agentProject";
import type { AgentTaskGateway } from "../domain/agentTask";
import type { AgentProviderSignInGateway } from "../domain/agentProviderSignIn";
import type { TerminalGateway } from "../domain/terminal";
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
  ExternalSessionsSurface,
} from "./agentThreadPorts";
import type { AgentEditorBridgePort } from "./useAgentEditorBridge";
import type { ExternalUrlOpenerPort } from "./useAgentShipFlow";
import { useAgentThreads, type AgentThreadsGitGateway } from "./useAgentThreads";
import type { WorkspaceIdentityDescriptor } from "./workspaceIdentityGatewayPort";
import {
  useAgentProviderManagement,
  type AgentProviderManagementSurface,
} from "./useAgentProviderManagement";
import { useAgentProviderSignIn, type AgentProviderSignInSurface } from "./useAgentProviderSignIn";
import type { AgentProviderSignInRefreshOutcome } from "./useAgentProviderSignIn";
import type { ReadyAgentProviderAdmissionAuthority } from "./agentProviderAdmissionAuthority";
import type { WorkbenchPrompter } from "./workbenchPrompter";
import {
  defaultAgentTaskGateway,
  defaultAgentThreadStoreGateway,
  defaultCompareUrlOpener,
  defaultExternalSessionGateway,
  defaultGitIntegrationGateway,
  defaultGitWorktreeGateway,
} from "./workbenchDefaultGateways";

export interface WorkbenchAgentProjectGateways {
  readonly settingsGateway: Pick<SettingsGateway, "loadWorkspaceSettings">;
  readonly trustGateway: WorkspaceTrustGateway;
  readonly repositoryDiscoveryGateway: AgentRepositoryDiscoveryGateway;
  readonly agentRootLeaseGateway: AgentRootLeaseGateway;
  readonly descriptorForRoot: (rootPath: string) => WorkspaceIdentityDescriptor | null;
  readonly activateWorkspaceRoot?: (rootPath: string) => Promise<void>;
}

export interface WorkbenchAgentsOptions {
  readonly agentTaskGateway?: AgentTaskGateway;
  readonly agentProviderGateway: AgentProviderPolicyGateway &
    AgentProviderHealthGateway &
    AgentProviderUpdateGateway;
  readonly agentCliDiscoveryGateway: AgentCliDiscoveryGateway;
  readonly agentProviderSignInGateway?: AgentProviderSignInGateway;
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
  readonly revealTerminal: () => void;
  readonly setSettingsInitialSection: (section: SettingsSection) => void;
  readonly setSettingsOpen: (open: boolean) => void;
  readonly workspaceId: string | null;
  readonly workspaceRoot: string | null;
  readonly workspaceTrust: WorkspaceTrustState | null;
  readonly terminalGateway: Pick<TerminalGateway, "stop">;
}

export interface WorkbenchAgentsSurface extends AgentThreadsSurface {
  readonly externalSessions: ExternalSessionsSurface;
  readonly agentProjects: AgentProjectsSurface;
  readonly providerManagement: AgentProviderManagementSurface;
  readonly providerSignIn: AgentProviderSignInSurface;
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

const unwiredAgentProviderSignInGateway: AgentProviderSignInGateway = {
  startAgentProviderSignIn: () => Promise.reject(unwiredGatewayError()),
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

    return gitRepositoryMappings
      .map((mapping) => ({
        mapping,
        repositoryRoot: repositoryRootForMapping(mapping, workspaceRoot),
        repositoryRelativePath: "",
      }))
      .filter((repository) => {
        const status = gitRepositoryStatuses.find(
          (candidate) => candidate.root === repository.repositoryRoot,
        );
        return status === undefined || status.failed || status.status.isRepository;
      });
  }, [gitRepositoryMappings, gitRepositoryStatuses, workspaceRoot]);

  const getRepositoryStatus = useCallback(
    (repositoryRoot: string): AgentRepositoryStatusSnapshot => {
      const entry = gitRepositoryStatuses.find((candidate) => candidate.root === repositoryRoot);

      if (!entry || entry.failed || !entry.status.isRepository) {
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
  const providerManagementRef = useRef<AgentProviderManagementSurface | null>(null);
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
    activateWorkspaceRoot: projectGateways?.activateWorkspaceRoot,
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

  const readProviderAuthority = useCallback((provider: "claudeCode" | "codex") => {
    const management = providerManagementRef.current;
    if (management === null) {
      return unavailableProviderSignInAuthority(provider);
    }
    return management.admissionAuthority(provider);
  }, []);
  const refreshProvider = useCallback(
    async (
      provider: "claudeCode" | "codex",
      authority: ReadyAgentProviderAdmissionAuthority,
    ): Promise<AgentProviderSignInRefreshOutcome> => {
      const management = providerManagementRef.current;
      if (management === null || !providerAuthorityMatches(management, authority)) {
        return { kind: "stale" };
      }
      const preSignInProbeWasPending = management.providers[provider].health.kind === "checking";
      const refresh = management.refreshWithOutcome;
      if (refresh === undefined) return { kind: "failed" };
      const refreshed = await refresh(provider);
      if (refreshed.kind !== "complete") return refreshed;
      const current = providerManagementRef.current;
      if (current === null) return { kind: "stale" };
      if (!providerAuthorityMatches(current, refreshed.authority)) return { kind: "stale" };
      if (refreshed.authority.providerGeneration !== authority.providerGeneration) {
        return { kind: "stale" };
      }
      if (preSignInProbeWasPending) {
        const freshRefresh = current.refreshWithOutcome;
        if (freshRefresh === undefined) return { kind: "failed" };
        const fresh = await freshRefresh(provider);
        if (fresh.kind !== "complete") return fresh;
        const final = providerManagementRef.current;
        if (final === null) return { kind: "stale" };
        if (!providerAuthorityMatches(final, fresh.authority)) return { kind: "stale" };
        if (fresh.authority.providerGeneration !== authority.providerGeneration) {
          return { kind: "stale" };
        }
        return fresh;
      }
      return refreshed;
    },
    [],
  );
  const providerSignIn = useAgentProviderSignIn({
    gateway: options.agentProviderSignInGateway ?? unwiredAgentProviderSignInGateway,
    readAuthority: readProviderAuthority,
    liveTurnCount,
    terminalUnavailableReason: () => null,
    revealTerminal: options.revealTerminal,
    stopSession: (sessionId) => options.terminalGateway.stop(sessionId).then(() => undefined),
    refresh: refreshProvider,
  });

  const providerManagement = useAgentProviderManagement({
    appSettingsRef: options.appSettingsRef,
    applyAppSettings: options.applyAppSettings,
    settingsGateway: options.settingsPersistenceGateway,
    settingsHydrated: options.settingsHydrated,
    policyGateway: options.agentProviderGateway,
    healthGateway: options.agentProviderGateway,
    updateGateway: options.agentProviderGateway,
    discoveryGateway: options.agentCliDiscoveryGateway,
    liveTurnCount,
    signInActive: providerSignIn.isActive,
    reportError: options.reportError,
    mintOperationId: mintProviderOperationId,
    workspaceGeneration: providerWorkspaceOwnerRef.current.generation,
  });

  const threads = useAgentThreads({
    agentTaskGateway: options.agentTaskGateway ?? defaultAgentTaskGateway,
    agentThreadStoreGateway: options.agentThreadStoreGateway ?? defaultAgentThreadStoreGateway,
    externalSessionGateway: defaultExternalSessionGateway,
    gitWorktreeGateway: options.gitWorktreeGateway ?? defaultGitWorktreeGateway,
    gitGateway: options.gitGateway,
    gitIntegrationGateway: options.gitIntegrationGateway ?? defaultGitIntegrationGateway,
    externalUrlOpener:
      options.externalUrlOpener === undefined ? defaultCompareUrlOpener : options.externalUrlOpener,
    editorBridge: options.editorBridge ?? null,
    prompter: options.prompter,
    projects: agentProjects.projects,
    agentModeActive: options.agentModeActive,
    getAgentCliKind: () => options.appSettingsRef.current.agentCliKind,
    currentCliVersion: (provider) => providerCliVersion(providerManagement, provider),
    getAgentProviderAdmissionAuthority: providerManagement.admissionAuthority,
    getMaxConcurrentAgentTasks: () => options.appSettingsRef.current.maxConcurrentAgentTasks,
    getRepositoryStatus,
    getDirtyEditorDocumentCount,
    onProjectDispatchTrustRejected: agentProjects.noteDispatchTrustRejected,
    ensureProjectLease: agentProjects.ensureProjectLease,
    ensureProjectLaunchIdentity: agentProjects.ensureProjectLaunchIdentity,
    launchIdentityForProject: agentProjects.launchIdentityForProject,
    reportError: options.reportError,
    openAgentSettings,
  });

  const refreshIsolationStatus = threads.refreshIsolationStatus;
  const startThread = threads.startThread;
  const launchIdentityForProject = agentProjects.launchIdentityForProject;
  const isCurrentRepositoryOwner = agentProjects.isCurrentRepositoryOwner;
  const startThreadAfterRepositoryProbe = useCallback(
    async (request: Parameters<AgentThreadsSurface["startThread"]>[0]) => {
      const project = agentProjects.projects.find(
        (candidate) => candidate.rootKey === request.projectRootKey,
      );
      if (project === undefined || project.trust !== "trusted") return null;
      const authority = {
        rootKey: project.rootKey,
        ownerId: project.ownerId,
        generation: project.generation,
      };
      if (!isCurrentRepositoryOwner(authority, request.repositoryRoot)) return null;
      const launchIdentity = launchIdentityForProject(request.projectRootKey);
      if (launchIdentity === null) return null;
      const outcome = await refreshIsolationStatus(request.repositoryRoot);
      if (outcome?.kind !== "ready") return null;
      if (
        outcome.authority.rootKey !== authority.rootKey ||
        outcome.authority.ownerId !== authority.ownerId ||
        outcome.authority.generation !== authority.generation ||
        !isCurrentRepositoryOwner(authority, request.repositoryRoot)
      ) {
        return null;
      }
      const currentLaunchIdentity = launchIdentityForProject(request.projectRootKey);
      if (
        currentLaunchIdentity === null ||
        currentLaunchIdentity.workspaceId !== launchIdentity.workspaceId ||
        currentLaunchIdentity.generation !== launchIdentity.generation
      ) {
        return null;
      }
      return startThread(request);
    },
    [
      agentProjects.projects,
      isCurrentRepositoryOwner,
      launchIdentityForProject,
      refreshIsolationStatus,
      startThread,
    ],
  );

  const threadsWithRepositoryPreflight = useMemo(
    () => ({ ...threads, startThread: startThreadAfterRepositoryProbe }),
    [startThreadAfterRepositoryProbe, threads],
  );

  useLayoutEffect(() => {
    threadsSurfaceRef.current = threadsWithRepositoryPreflight;
    providerManagementRef.current = providerManagement;
  });

  return useMemo(
    () => ({
      ...threadsWithRepositoryPreflight,
      agentProjects,
      providerManagement,
      providerSignIn,
    }),
    [agentProjects, providerManagement, providerSignIn, threadsWithRepositoryPreflight],
  );
}

function providerCliVersion(
  management: AgentProviderManagementSurface,
  provider: "claudeCode" | "codex",
): string | null {
  const view = management.providers[provider];
  if (view.health.kind === "ready" && view.health.installedVersion !== null) {
    return view.health.installedVersion;
  }
  if (view.executable.kind === "detected") return view.executable.version;
  return null;
}

function unavailableProviderSignInAuthority(provider: "claudeCode" | "codex") {
  return {
    provider,
    revision: 0,
    disposition: { kind: "policyUnavailable", reason: "unregistered" },
  } as const;
}

function providerAuthorityMatches(
  management: AgentProviderManagementSurface,
  captured: ReadyAgentProviderAdmissionAuthority,
): boolean {
  const current = management.admissionAuthority(captured.provider);
  return (
    current.disposition.kind === "ready" &&
    "providerGeneration" in current &&
    current.revision === captured.revision &&
    current.providerGeneration === captured.providerGeneration
  );
}

export function agentProviderUpdateOperationId(
  provider: "claudeCode" | "codex",
  sequence: number,
): string {
  return `${provider}-update-${sequence}`;
}
