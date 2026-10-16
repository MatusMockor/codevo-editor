import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import type { AgentAccountUsageRefreshOutcome } from "./agentAccountUsageRefresh";
import {
  defaultAgentCliDiscoveryResult,
  type AgentCliDiscoveryGateway,
} from "../domain/agentSettings";
import type {
  AgentAccountUsageGateway,
  AgentAccountUsageLoadState,
  AgentAccountUsageStoreGateway,
} from "../domain/agentAccountUsage";
import { useAgentAccountUsage } from "./useAgentAccountUsage";
import { useAgentAccountUsageFreshness } from "./useAgentAccountUsageFreshness";
import { useAgentAccountUsageSourceProjection } from "./useAgentAccountUsageSourceProjection";
import { useAgentAccountUsagePolling } from "./useAgentAccountUsagePolling";
import { useAgentAccountUsageSharedObservations } from "./useAgentAccountUsageSharedObservations";
import type { AgentAccountUsageSourcesPort } from "../domain/agentAccountUsageSources";
import type { AgentRootLeaseGateway } from "../domain/agentProject";
import type { AgentTaskGateway } from "../domain/agentTask";
import type { AgentThreadSessionGateway } from "../domain/agentThreadSession";
import type { AgentTurnChangesGateway } from "../domain/agentTurnChanges";
import type { AgentAttachmentGateway } from "./agentAttachmentPorts";
import type { AgentInlineImageGateway } from "./agentInlineImagePorts";
import type { AgentImageSurfacePort } from "../domain/agentImageShrink";
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
import type { AgentFileNavigationPort } from "./useAgentFileNavigation";
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
import type { AgentThreadRequestFeed } from "./agentThreadRequestPorts";
import { agentTurnLogEvidence } from "./agentTurnLogStatusStore";
import {
  defaultAgentAttachmentGateway,
  defaultAgentImageSurface,
  defaultAgentTaskGateway,
  createDefaultAgentThreadStoreGateway,
  defaultCompareUrlOpener,
  defaultExternalSessionGateway,
  defaultGitIntegrationGateway,
  defaultGitWorktreeGateway,
} from "./agentApp/agentDefaultGateways";

export interface AppAgentProjectGateways {
  readonly settingsGateway: Pick<SettingsGateway, "loadWorkspaceSettings">;
  readonly trustGateway: WorkspaceTrustGateway;
  readonly repositoryDiscoveryGateway: AgentRepositoryDiscoveryGateway;
  readonly agentRootLeaseGateway: AgentRootLeaseGateway;
  readonly descriptorForRoot: (rootPath: string) => WorkspaceIdentityDescriptor | null;
  readonly activateWorkspaceRoot?: (rootPath: string) => Promise<void>;
}

export type AppAgentProviderGateway = AgentProviderPolicyGateway &
  AgentProviderHealthGateway &
  AgentProviderUpdateGateway &
  Partial<AgentAccountUsageGateway> &
  Partial<AgentAccountUsageStoreGateway> & {
    readonly accountUsageSources?: AgentAccountUsageSourcesPort;
  };

export interface AppAgentGateways {
  readonly turnChangesGateway?: AgentTurnChangesGateway;
  readonly agentTaskGateway?: AgentTaskGateway;
  readonly agentThreadSessionGateway?: AgentThreadSessionGateway;
  readonly agentThreadRequestFeed?: AgentThreadRequestFeed;
  readonly agentAttachmentGateway?: AgentAttachmentGateway;
  readonly agentImageSurface?: AgentImageSurfacePort;
  readonly agentInlineImageGateway?: AgentInlineImageGateway;
  readonly agentProviderGateway?: AppAgentProviderGateway;
  readonly agentCliDiscoveryGateway?: AgentCliDiscoveryGateway;
  readonly agentProviderSignInGateway?: AgentProviderSignInGateway;
  readonly gitWorktreeGateway?: GitWorktreeGateway;
  readonly gitIntegrationGateway?: GitIntegrationGateway;
  readonly externalUrlOpener?: ExternalUrlOpenerPort | null;
}

export interface AppAgentsOptions {
  readonly gateways: AppAgentGateways;
  readonly agentThreadStoreGateway?: AgentThreadStoreGateway;
  readonly fileNavigationPort?: AgentFileNavigationPort | null;
  readonly agentProjectGateways?: AppAgentProjectGateways;
  readonly trustRevisionForOwner?: (ownerId: string) => number;
  readonly appSettingsRef: { readonly current: AppSettings };
  readonly applyAppSettings: (settings: AppSettings) => void;
  readonly settingsHydrated: boolean;
  readonly settingsPersistenceGateway: Pick<SettingsGateway, "saveAppSettings">;
  readonly workspaceSettingsRef: { readonly current: WorkspaceSettings };
  readonly gitGateway: AgentThreadsGitGateway;
  readonly gitRepositoryMappings: ReadonlyArray<GitRepositoryMapping>;
  readonly gitRepositoryStatuses: ReadonlyArray<GitRepositoryStatus>;
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

export interface AppAgentsSurface extends AgentThreadsSurface {
  readonly accountUsage: Readonly<Record<"claudeCode" | "codex", AgentAccountUsageLoadState>>;
  readonly externalSessions: ExternalSessionsSurface;
  readonly agentProjects: AgentProjectsSurface;
  readonly providerManagement: AgentProviderManagementSurface;
  readonly providerSignIn: AgentProviderSignInSurface;
  readonly refreshAccountUsage?: (
    provider: "claudeCode" | "codex",
  ) => Promise<AgentAccountUsageRefreshOutcome>;
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

const unavailableAgentProviderGateway: AppAgentProviderGateway = {
  currentAgentProviderPolicy: () => Promise.reject(new Error("Provider gateway is unavailable.")),
  registerAgentProviderPolicy: () => Promise.reject(new Error("Provider gateway is unavailable.")),
  checkAgentProviderUpdates: () => Promise.reject(new Error("Provider gateway is unavailable.")),
  probeAgentProviderHealth: () => Promise.reject(new Error("Provider gateway is unavailable.")),
  updateAgentProvider: () => Promise.reject(new Error("Provider gateway is unavailable.")),
};

const unavailableAgentCliDiscoveryGateway: AgentCliDiscoveryGateway = {
  discoverAgentClis: () => Promise.resolve(defaultAgentCliDiscoveryResult()),
};

export function useAppAgents(options: AppAgentsOptions): AppAgentsSurface {
  const { gateways } = options;
  const agentProviderGateway = gateways.agentProviderGateway ?? unavailableAgentProviderGateway;
  const usageAuthority = useRef({
    gateway: agentProviderGateway,
    active: false,
    generation: 0,
  });
  if (usageAuthority.current.gateway !== agentProviderGateway)
    usageAuthority.current = {
      gateway: agentProviderGateway,
      active: false,
      generation: 0,
    };
  const usageLease = usageAuthority.current;
  useLayoutEffect(() => {
    usageLease.active = true;
    usageLease.generation++;
    return () => {
      usageLease.active = false;
      usageLease.generation++;
    };
  }, [usageLease]);
  const {
    accountUsage: localAccountUsage,
    recordAccountUsage: recordLocalAccountUsage,
    captureUsage,
    publishRefresh,
    invalidateAccountUsage,
  } = useAgentAccountUsage(agentProviderGateway);
  const accountUsageSources = agentProviderGateway.accountUsageSources;
  const accountUsage = useAgentAccountUsageSourceProjection(localAccountUsage, accountUsageSources);
  const recordAccountUsage = useAgentAccountUsageSharedObservations(
    recordLocalAccountUsage,
    captureUsage,
    accountUsageSources,
  );
  const usageRequestSequenceRef = useRef({ claudeCode: 0, codex: 0 });
  const refreshAccountUsageRef = useRef<
    (provider: "claudeCode" | "codex") => Promise<AgentAccountUsageRefreshOutcome>
  >(() => Promise.resolve({ kind: "unavailable" }));
  const {
    gitRepositoryMappings,
    gitRepositoryStatuses,
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
    autoAdmitOpenedProjects: true,
    trustRevisionForOwner: options.trustRevisionForOwner,
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
    settingsHydrated: options.settingsHydrated,
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
      // Login can replace the CLI account without changing the executable generation.
      invalidateAccountUsage(provider);
      usageRequestSequenceRef.current[provider] += 1;
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
        void refreshAccountUsageRef.current(provider);
        return fresh;
      }
      void refreshAccountUsageRef.current(provider);
      return refreshed;
    },
    [invalidateAccountUsage],
  );
  const providerSignIn = useAgentProviderSignIn({
    gateway: gateways.agentProviderSignInGateway ?? unwiredAgentProviderSignInGateway,
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
    policyGateway: agentProviderGateway,
    healthGateway: agentProviderGateway,
    updateGateway: agentProviderGateway,
    discoveryGateway: gateways.agentCliDiscoveryGateway ?? unavailableAgentCliDiscoveryGateway,
    liveTurnCount,
    signInActive: providerSignIn.isActive,
    reportError: options.reportError,
    mintOperationId: mintProviderOperationId,
  });

  const refreshAccountUsage = useCallback(
    async (provider: "claudeCode" | "codex"): Promise<AgentAccountUsageRefreshOutcome> => {
      const readUsage = agentProviderGateway.readAgentProviderUsage;
      const management = providerManagementRef.current;
      if (readUsage === undefined || management === null) return { kind: "unavailable" };
      const authority = management.admissionAuthority(provider);
      if (authority.disposition.kind !== "ready" || !("providerGeneration" in authority)) {
        return { kind: "unavailable" };
      }
      const providerGeneration = authority.providerGeneration;
      const expectedUsage = captureUsage(provider);
      const usageGeneration = usageLease.generation;
      const queryRevision = accountUsageSources?.revision();
      const requestSequence = ++usageRequestSequenceRef.current[provider];
      const workspaceGeneration = providerWorkspaceOwnerRef.current.generation;
      const isCurrent = (): boolean => {
        if (
          !usageLease.active ||
          usageAuthority.current !== usageLease ||
          usageLease.generation !== usageGeneration
        )
          return false;
        if (usageRequestSequenceRef.current[provider] !== requestSequence) return false;
        if (providerWorkspaceOwnerRef.current.generation !== workspaceGeneration) return false;
        const current = providerManagementRef.current?.admissionAuthority(provider);
        return (
          current !== undefined &&
          current.disposition.kind === "ready" &&
          "providerGeneration" in current &&
          current.providerGeneration === providerGeneration
        );
      };
      const snapshot = await readUsage
        .call(agentProviderGateway, { provider, providerGeneration })
        .catch(() => null);
      if (!isCurrent()) return { kind: "superseded" };
      if (snapshot === null || snapshot.provider !== provider) return { kind: "failed" };
      if (captureUsage(provider) !== expectedUsage) return { kind: "superseded" };
      if (accountUsageSources && !accountUsageSources.observe("local", snapshot, queryRevision))
        return { kind: "superseded" };
      if (!publishRefresh(snapshot, expectedUsage)) return { kind: "superseded" };
      return { kind: "refreshed" };
    },
    [accountUsageSources, captureUsage, agentProviderGateway, publishRefresh, usageLease],
  );
  const claudeUsageReady = providerUsageReady(providerManagement, "claudeCode");
  const codexUsageReady = providerUsageReady(providerManagement, "codex");
  const usageReadiness = useMemo(
    () => ({ claudeCode: claudeUsageReady, codex: codexUsageReady }),
    [claudeUsageReady, codexUsageReady],
  );
  useAgentAccountUsageFreshness({
    accountUsage,
    readiness: usageReadiness,
    refresh: refreshAccountUsage,
  });
  useAgentAccountUsagePolling(usageReadiness, refreshAccountUsage);
  const refreshProviderUsageAfterTurn = useCallback(
    (provider: "claudeCode" | "codex"): void => {
      void refreshAccountUsage(provider);
    },
    [refreshAccountUsage],
  );

  const agentThreadStoreGateway = useMemo(
    () =>
      options.agentThreadStoreGateway ??
      createDefaultAgentThreadStoreGateway((turnId) =>
        agentTurnLogEvidence(threadsSurfaceRef.current?.turnLog?.factsOf(turnId) ?? null),
      ),
    [options.agentThreadStoreGateway],
  );

  const threads = useAgentThreads({
    turnChangesGateway: gateways.turnChangesGateway,
    agentTaskGateway: gateways.agentTaskGateway ?? defaultAgentTaskGateway,
    agentThreadSessionGateway: gateways.agentThreadSessionGateway,
    agentThreadRequestFeed: gateways.agentThreadRequestFeed,
    agentAttachmentGateway: gateways.agentAttachmentGateway ?? defaultAgentAttachmentGateway,
    agentImageSurface: gateways.agentImageSurface ?? defaultAgentImageSurface,
    agentInlineImageGateway: gateways.agentInlineImageGateway,
    agentThreadStoreGateway,
    externalSessionGateway: defaultExternalSessionGateway,
    gitWorktreeGateway: gateways.gitWorktreeGateway ?? defaultGitWorktreeGateway,
    gitGateway: options.gitGateway,
    gitIntegrationGateway: gateways.gitIntegrationGateway ?? defaultGitIntegrationGateway,
    externalUrlOpener:
      gateways.externalUrlOpener === undefined
        ? defaultCompareUrlOpener
        : gateways.externalUrlOpener,
    fileNavigationPort: options.fileNavigationPort ?? null,
    prompter: options.prompter,
    projects: agentProjects.projects,
    getAgentCliKind: () => options.appSettingsRef.current.agentCliKind,
    currentCliVersion: (provider) => providerCliVersion(providerManagement, provider),
    getAgentProviderAdmissionAuthority: providerManagement.admissionAuthority,
    getMaxConcurrentAgentTasks: () => options.appSettingsRef.current.maxConcurrentAgentTasks,
    getRepositoryStatus,
    onProjectDispatchTrustRejected: agentProjects.noteDispatchTrustRejected,
    onAccountUsageObserved: recordAccountUsage,
    onProviderTurnCompleted: refreshProviderUsageAfterTurn,
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
      const outcome = await refreshIsolationStatus(request.repositoryRoot, request.projectRootKey);
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

  const surface = useMemo(
    () => ({
      ...threads,
      startThread: startThreadAfterRepositoryProbe,
      accountUsage,
      accountUsageSources,
      agentProjects,
      providerManagement,
      providerSignIn,
      refreshAccountUsage,
    }),
    [
      accountUsage,
      accountUsageSources,
      agentProjects,
      providerManagement,
      providerSignIn,
      refreshAccountUsage,
      startThreadAfterRepositoryProbe,
      threads,
    ],
  );

  useLayoutEffect(() => {
    threadsSurfaceRef.current = surface;
    providerManagementRef.current = providerManagement;
    refreshAccountUsageRef.current = refreshAccountUsage;
  });

  return surface;
}

function providerUsageReady(
  management: AgentProviderManagementSurface,
  provider: "claudeCode" | "codex",
): boolean {
  if (management.providers[provider].health.kind === "checking") return false;
  const authority = management.admissionAuthority(provider);
  return authority.disposition.kind === "ready" && "providerGeneration" in authority;
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
