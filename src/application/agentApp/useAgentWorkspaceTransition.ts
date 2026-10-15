import { useCallback, useState, type MutableRefObject } from "react";
import {
  defaultWorkspaceSettings,
  type AppSettings,
  type SettingsGateway,
  type WorkspaceSettings,
} from "../../domain/settings";
import type { WorkspaceTrustGateway, WorkspaceTrustState } from "../../domain/trust";
import type { WorkspaceHomeReference } from "../../domain/workspaceRootEligibility";
import { workspaceRootKeysEqual } from "../../domain/workspaceRootKey";
import { loadWorkspaceTrustForOwner } from "../useWorkbenchControllerAgents";
import { removeWorkspaceIdentityMappings } from "../workspace/workspaceIdentityPolicy";
import type {
  WorkspaceIdentityDescriptor,
  WorkspaceIdentityGateway,
} from "../workspaceIdentityGatewayPort";
import type { WorkspaceSettingsByRootSnapshot } from "../workspaceSettingsForRoot";
import type { WorkspaceSettingsSaveCoordinator } from "../workspaceSettingsSaveCoordinator";
import type { BoundedPendingWorkspaceSettingsLoads } from "../workbenchController/boundedPendingWorkspaceSettingsLoads";
import { useInitialAppSettingsHydration } from "../workbenchController/useInitialAppSettingsHydration";
import { useWorkspaceOpenRequestLifecycle } from "../workbenchController/useWorkspaceOpenRequestLifecycle";
import {
  backgroundRuntimeOwnersForPolicy,
  workspaceRuntimeOwnerFor,
} from "../workbenchController/workspaceRuntimePolicy";
import {
  detectAgentScriptsWorkspace,
  stopAgentWorkspaceRuntimes,
  type AgentScriptsWorkspace,
  type AgentScriptsWorkspaceReader,
  type AgentWorkspaceRuntimeGateways,
} from "./agentWorkspaceRuntimes";
import { loadAgentWorkspaceSettings } from "./agentWorkspaceSettingsLoad";
import {
  appSettingsWithOpenedWorkspace,
  workspaceIdentityAliasPaths,
  workspaceOwnerKeyFor,
} from "./agentWorkspaceTransitionPolicy";
import type { AgentWorkspaceAuthority } from "./useAgentWorkspaceAuthority";

export interface AgentActiveWorkspace {
  readonly identity: WorkspaceIdentityDescriptor | null;
  readonly ownerKey: string;
  readonly rootPath: string;
}

export interface AgentWorkspaceSettingsPort {
  readonly appSettingsRef: MutableRefObject<AppSettings>;
  readonly applyAppSettings: (settings: AppSettings) => void;
  readonly applyWorkspaceSettings: (settings: WorkspaceSettings) => void;
  readonly persistAppSettings: (settings: AppSettings) => Promise<void>;
  readonly settingsGateway: Pick<SettingsGateway, "loadAppSettings" | "loadWorkspaceSettings">;
  readonly workspaceSettingsByRoot: WorkspaceSettingsByRootSnapshot;
  readonly workspaceSettingsLoadByRootRef: MutableRefObject<BoundedPendingWorkspaceSettingsLoads>;
  readonly workspaceSettingsRef: MutableRefObject<WorkspaceSettings>;
  readonly workspaceSettingsSaveCoordinator: WorkspaceSettingsSaveCoordinator;
}

export interface AgentWorkspaceGitDiscoveryPort {
  readonly isDemanded: () => boolean;
  readonly reset: (rootPath: string | null) => void;
  readonly runDiscovery: (rootPath: string, settings: WorkspaceSettings) => Promise<void>;
}

export interface AgentWorkspaceStartupPort {
  readonly hasRestoredRef: MutableRefObject<boolean>;
  readonly onAppSettingsHydrated: (hydrated: true) => void;
  readonly resolveWorkspaceHome?: () => Promise<WorkspaceHomeReference>;
}

export interface AgentWorkspaceTransitionOptions {
  readonly authority: AgentWorkspaceAuthority;
  readonly git: AgentWorkspaceGitDiscoveryPort;
  readonly identityGateway: WorkspaceIdentityGateway;
  readonly reportError: (source: string, error: unknown) => void;
  readonly runtimeGateways: AgentWorkspaceRuntimeGateways;
  readonly scriptsWorkspaceReader: AgentScriptsWorkspaceReader;
  readonly settings: AgentWorkspaceSettingsPort;
  readonly startup: AgentWorkspaceStartupPort;
  readonly trustGateway: WorkspaceTrustGateway;
}

export interface ClearAgentWorkspaceOptions {
  readonly ownership?: { readonly isCurrent: () => boolean };
  readonly runtimeAlreadyStopped?: boolean;
}

interface OpenWorkspacePathOptions {
  readonly cachePreviousWorkspace?: boolean;
  readonly isOpenIntentCurrent?: () => boolean;
}

export function useAgentWorkspaceTransition({
  authority,
  git,
  identityGateway,
  reportError,
  runtimeGateways,
  scriptsWorkspaceReader,
  settings,
  startup,
  trustGateway,
}: AgentWorkspaceTransitionOptions) {
  const [activeWorkspace, setActiveWorkspace] = useState<AgentActiveWorkspace | null>(null);
  const [workspaceTrust, setWorkspaceTrust] = useState<WorkspaceTrustState | null>(null);
  const [scriptsWorkspace, setScriptsWorkspace] = useState<AgentScriptsWorkspace | null>(null);
  const {
    currentWorkspaceRootRef,
    managedIdentity,
    mountedRef,
    openWorkspaceRequestInFlightTokenRef,
    openWorkspaceRequestPathRef,
    openWorkspaceRequestTokenRef,
    ownedWorkspaceIdentityGenerationByIdRef,
    pendingWorkspaceIdentityRequestTokensRef,
    retireWorkspaceRuntimeOwnerClaim,
    workspaceCloseGenerationByRootRef,
    workspaceCloseOwnershipByKeyRef,
    workspaceCloseOwnershipGenerationRef,
    workspaceIdentityByRootRef,
    workspaceIdentityDescriptorRef,
    workspaceOwnerKeyRef,
    workspaceRuntimeOwnerByTabRef,
    workspaceRuntimeOwnerClaimsRef,
    workspaceRuntimeOwnerRef,
    workspaceRuntimeRootByTabRef,
    workspaceTrustRevisionByOwnerRef,
  } = authority;
  const {
    appSettingsRef,
    applyAppSettings,
    applyWorkspaceSettings,
    persistAppSettings,
    settingsGateway,
    workspaceSettingsByRoot,
    workspaceSettingsLoadByRootRef,
    workspaceSettingsRef,
    workspaceSettingsSaveCoordinator,
  } = settings;

  const reportErrorForRoot = useCallback(
    (rootPath: string, source: string, error: unknown) => {
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) return;
      reportError(source, error);
    },
    [currentWorkspaceRootRef, reportError],
  );

  const stopBackgroundRuntimes = useCallback(
    async (path: string, previousRootPath: string | null, isRequestCurrent: () => boolean) => {
      const runtimePolicy = appSettingsRef.current.runtimePolicy;
      if (runtimePolicy === "keepAlive") return [];
      const owners = backgroundRuntimeOwnersForPolicy(
        runtimePolicy,
        path,
        previousRootPath,
        appSettingsRef.current.workspaceTabs,
        workspaceRuntimeOwnerByTabRef.current,
      );
      const claims = owners.map((owner) => ({
        generation: workspaceRuntimeOwnerClaimsRef.current.generationFor(owner.ownerKey),
        owner,
      }));
      await Promise.all(
        claims.map(({ generation, owner }) =>
          stopAgentWorkspaceRuntimes(runtimeGateways, {
            isCurrent: () =>
              isRequestCurrent() &&
              workspaceRuntimeOwnerByTabRef.current[owner.executionRoot] === owner &&
              workspaceRuntimeOwnerClaimsRef.current.generationFor(owner.ownerKey) === generation,
            reportError: ignoreBackgroundError,
            rootPath: owner.executionRoot,
          }),
        ),
      );
      return claims;
    },
    [
      appSettingsRef,
      runtimeGateways,
      workspaceRuntimeOwnerByTabRef,
      workspaceRuntimeOwnerClaimsRef,
    ],
  );

  const loadWorkspaceSettingsForOpen = useCallback(
    (path: string, identity: WorkspaceIdentityDescriptor | null, isCurrent: () => boolean) =>
      loadAgentWorkspaceSettings(
        {
          reportError,
          settingsGateway,
          workspaceSettingsByRoot,
          workspaceSettingsLoadByRootRef,
          workspaceSettingsSaveCoordinator,
        },
        path,
        identity,
        isCurrent,
      ),
    [
      reportError,
      settingsGateway,
      workspaceSettingsByRoot,
      workspaceSettingsLoadByRootRef,
      workspaceSettingsSaveCoordinator,
    ],
  );

  const performOpenWorkspacePath = useCallback(
    async (
      path: string,
      identity: WorkspaceIdentityDescriptor | null,
      adoptIdentity: (() => Promise<number | null>) | null,
      requestToken: number,
      commitOpenWorkspaceRequest: (path: string, admissionGeneration: number | null) => void,
      options: OpenWorkspacePathOptions = {},
    ) => {
      if (openWorkspaceRequestTokenRef.current !== requestToken) return;
      openWorkspaceRequestPathRef.current = path;
      const isCurrentRequest = () =>
        mountedRef.current &&
        openWorkspaceRequestTokenRef.current === requestToken &&
        workspaceRootKeysEqual(openWorkspaceRequestPathRef.current, path) &&
        (!options.isOpenIntentCurrent || options.isOpenIntentCurrent());
      const previousRootPath = currentWorkspaceRootRef.current;

      const workspaceSettings = await loadWorkspaceSettingsForOpen(
        path,
        identity,
        isCurrentRequest,
      );
      if (!workspaceSettings || !isCurrentRequest()) return;

      const disposedClaims = await stopBackgroundRuntimes(path, previousRootPath, isCurrentRequest);
      if (!isCurrentRequest()) return;
      for (const { generation, owner } of disposedClaims) {
        if (generation === undefined || identity?.workspaceId === owner.ownerKey) continue;
        retireWorkspaceRuntimeOwnerClaim(owner.ownerKey, generation);
      }

      const adoptedGeneration = adoptIdentity ? await adoptIdentity() : null;
      if (adoptIdentity && adoptedGeneration === null) return;
      if (!isCurrentRequest()) return;

      const identityAliasPaths = identity
        ? workspaceIdentityAliasPaths(workspaceIdentityByRootRef.current, identity)
        : [];
      if (identity) {
        const previousIdentity = workspaceIdentityByRootRef.current[path] ?? null;
        if (previousIdentity && previousIdentity.workspaceId !== identity.workspaceId) {
          retireWorkspaceRuntimeOwnerClaim(
            previousIdentity.workspaceId,
            workspaceRuntimeOwnerClaimsRef.current.generationFor(previousIdentity.workspaceId),
          );
          for (const aliasPath of [previousIdentity.selectedPath, previousIdentity.canonicalRoot]) {
            delete workspaceRuntimeRootByTabRef.current[aliasPath];
            delete workspaceRuntimeOwnerByTabRef.current[aliasPath];
          }
          removeWorkspaceIdentityMappings(workspaceIdentityByRootRef.current, previousIdentity);
          void managedIdentity
            .releaseOwned(previousIdentity.workspaceId, "retryLater")
            .catch((error) => reportError("Workspace", error));
        }
        removeWorkspaceIdentityMappings(workspaceIdentityByRootRef.current, identity);
        for (const aliasPath of identityAliasPaths) {
          delete workspaceRuntimeRootByTabRef.current[aliasPath];
          delete workspaceRuntimeOwnerByTabRef.current[aliasPath];
        }
      }

      const ownerKey = workspaceOwnerKeyFor(path, identity);
      const runtimeOwner = workspaceRuntimeOwnerFor(path, identity);
      const admittedGeneration = identity
        ? (adoptedGeneration ??
          (adoptIdentity
            ? null
            : (ownedWorkspaceIdentityGenerationByIdRef.current[identity.workspaceId] ?? null)))
        : null;
      workspaceIdentityDescriptorRef.current = identity;
      workspaceRuntimeOwnerRef.current = runtimeOwner;
      workspaceRuntimeOwnerByTabRef.current[path] = runtimeOwner;
      if (identity) {
        workspaceRuntimeOwnerClaimsRef.current.register(
          runtimeOwner,
          identityAliasPaths,
          admittedGeneration,
        );
        for (const aliasPath of [path, identity.canonicalRoot]) {
          workspaceIdentityByRootRef.current[aliasPath] = identity;
          workspaceRuntimeRootByTabRef.current[aliasPath] = path;
          workspaceRuntimeOwnerByTabRef.current[aliasPath] = runtimeOwner;
        }
      }
      currentWorkspaceRootRef.current = path;
      workspaceOwnerKeyRef.current = ownerKey;
      commitOpenWorkspaceRequest(path, admittedGeneration);
      setActiveWorkspace({ identity, ownerKey, rootPath: path });
      setWorkspaceTrust(null);
      setScriptsWorkspace(null);
      applyWorkspaceSettings(workspaceSettings);
      git.reset(path);

      const isCurrentOwnerRequest = () =>
        isCurrentRequest() &&
        admittedGeneration !== null &&
        workspaceRuntimeOwnerByTabRef.current[path] === runtimeOwner &&
        workspaceRuntimeOwnerClaimsRef.current.generationFor(runtimeOwner.ownerKey) ===
          admittedGeneration &&
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, path);

      try {
        await persistAppSettings(
          appSettingsWithOpenedWorkspace(
            appSettingsRef.current,
            path,
            identityAliasPaths,
            Date.now(),
          ),
        );
      } catch (error) {
        if (!isCurrentRequest()) return;
        reportError("Settings", error);
      }
      if (!isCurrentRequest()) return;

      const loadTrust = () =>
        loadWorkspaceTrustForOwner({
          gateway: trustGateway,
          isCurrent: isCurrentOwnerRequest,
          ownerId: runtimeOwner.ownerKey,
          publish: setWorkspaceTrust,
          reportError: (error) => reportErrorForRoot(path, "Workspace Trust", error),
          revisionByOwnerRef: workspaceTrustRevisionByOwnerRef,
          rootPath: path,
        });
      const detectScriptsWorkspace = async () => {
        try {
          const detected = await detectAgentScriptsWorkspace(scriptsWorkspaceReader, path);
          if (!isCurrentOwnerRequest()) return;
          setScriptsWorkspace(detected);
        } catch (error) {
          if (!isCurrentOwnerRequest()) return;
          setScriptsWorkspace("unknown");
          reportErrorForRoot(path, "Workspace Detection", error);
        }
      };
      const discoverGitRepositories = async () => {
        if (!git.isDemanded()) return;
        await git.runDiscovery(path, workspaceSettings);
      };
      await Promise.all([loadTrust(), detectScriptsWorkspace(), discoverGitRepositories()]);
    },
    [
      appSettingsRef,
      applyWorkspaceSettings,
      currentWorkspaceRootRef,
      git,
      loadWorkspaceSettingsForOpen,
      managedIdentity,
      mountedRef,
      openWorkspaceRequestPathRef,
      openWorkspaceRequestTokenRef,
      ownedWorkspaceIdentityGenerationByIdRef,
      persistAppSettings,
      reportError,
      reportErrorForRoot,
      retireWorkspaceRuntimeOwnerClaim,
      scriptsWorkspaceReader,
      stopBackgroundRuntimes,
      trustGateway,
      workspaceIdentityByRootRef,
      workspaceIdentityDescriptorRef,
      workspaceOwnerKeyRef,
      workspaceRuntimeOwnerByTabRef,
      workspaceRuntimeOwnerClaimsRef,
      workspaceRuntimeOwnerRef,
      workspaceRuntimeRootByTabRef,
      workspaceTrustRevisionByOwnerRef,
    ],
  );

  const resolveCachedWorkspaceState = useCallback(() => null, []);
  const openRequests = useWorkspaceOpenRequestLifecycle({
    completeDeferredIdentityCleanup: managedIdentity.flushDeferredCleanup,
    currentWorkspaceRootRef,
    openWorkspaceRequestInFlightTokenRef,
    openWorkspaceRequestPathRef,
    openWorkspaceRequestTokenRef,
    ownedWorkspaceIdentityGenerationByIdRef,
    pendingWorkspaceIdentityRequestTokensRef,
    performOpenWorkspacePath,
    reportError,
    resolveCachedWorkspaceState,
    withManagedWorkspaceIdentityLease: managedIdentity.withManagedLease,
    workbenchMountedRef: mountedRef,
    workspaceCloseGenerationByRootRef,
    workspaceCloseOwnershipByKeyRef,
    workspaceCloseOwnershipGenerationRef,
    workspaceIdentityByRootRef,
    workspaceIdentityGateway: identityGateway,
    workspaceRoot: activeWorkspace?.rootPath ?? null,
  });

  const clearActiveWorkspace = useCallback(
    async (options: ClearAgentWorkspaceOptions = {}) => {
      const { ownership, runtimeAlreadyStopped = false } = options;
      if (ownership && !ownership.isCurrent()) return;
      const currentRootPath = currentWorkspaceRootRef.current;
      if (currentRootPath && !runtimeAlreadyStopped) {
        const runtimeRootPath =
          workspaceRuntimeRootByTabRef.current[currentRootPath] ?? currentRootPath;
        const ownerKey = workspaceOwnerKeyRef.current;
        await stopAgentWorkspaceRuntimes(runtimeGateways, {
          isCurrent: () =>
            (!ownership || ownership.isCurrent()) &&
            workspaceRootKeysEqual(currentWorkspaceRootRef.current, currentRootPath) &&
            workspaceOwnerKeyRef.current === ownerKey,
          reportError: (error) => reportErrorForRoot(currentRootPath, "Workspace Runtime", error),
          rootPath: runtimeRootPath,
        });
        if (ownership && !ownership.isCurrent()) return;
        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, currentRootPath)) return;
      }

      currentWorkspaceRootRef.current = null;
      workspaceOwnerKeyRef.current = null;
      workspaceIdentityDescriptorRef.current = null;
      workspaceRuntimeOwnerRef.current = null;
      workspaceIdentityByRootRef.current = {};
      workspaceRuntimeRootByTabRef.current = {};
      workspaceRuntimeOwnerByTabRef.current = {};
      workspaceRuntimeOwnerClaimsRef.current.clear();
      openWorkspaceRequestTokenRef.current += 1;
      openWorkspaceRequestPathRef.current = null;
      setActiveWorkspace(null);
      setWorkspaceTrust(null);
      setScriptsWorkspace(null);
      applyWorkspaceSettings(defaultWorkspaceSettings());
      git.reset(null);
    },
    [
      applyWorkspaceSettings,
      currentWorkspaceRootRef,
      git,
      openWorkspaceRequestPathRef,
      openWorkspaceRequestTokenRef,
      reportErrorForRoot,
      runtimeGateways,
      workspaceIdentityByRootRef,
      workspaceIdentityDescriptorRef,
      workspaceOwnerKeyRef,
      workspaceRuntimeOwnerByTabRef,
      workspaceRuntimeOwnerClaimsRef,
      workspaceRuntimeOwnerRef,
      workspaceRuntimeRootByTabRef,
    ],
  );

  const discoverGitRepositories = useCallback(async () => {
    const rootPath = currentWorkspaceRootRef.current;
    if (!rootPath) return;
    await git.runDiscovery(rootPath, workspaceSettingsRef.current);
  }, [currentWorkspaceRootRef, git, workspaceSettingsRef]);

  useInitialAppSettingsHydration({
    applyAppSettings,
    beginStartupRestore: openRequests.beginStartupRestore,
    hasRestoredRef: startup.hasRestoredRef,
    onAppSettingsHydrated: startup.onAppSettingsHydrated,
    reportError,
    resolveWorkspaceHome: startup.resolveWorkspaceHome,
    settingsGateway,
  });

  return {
    activateWorkspaceTab: openRequests.activateWorkspaceTab,
    activeWorkspace,
    beginWorkspaceClose: openRequests.beginWorkspaceClose,
    clearActiveWorkspace,
    discoverGitRepositories,
    openWorkspace: openRequests.openWorkspace,
    openWorkspacePath: openRequests.openWorkspacePath,
    openWorkspaceRoot: openRequests.openWorkspaceRoot,
    openWorkspaceRootWithReceipt: openRequests.openWorkspaceRootWithReceipt,
    scriptsWorkspace,
    workspaceIdentityDescriptor: activeWorkspace?.identity ?? null,
    workspaceOwnerKey: activeWorkspace?.ownerKey ?? null,
    workspaceRoot: activeWorkspace?.rootPath ?? null,
    workspaceTrust,
  };
}

export type AgentWorkspaceTransition = ReturnType<typeof useAgentWorkspaceTransition>;

function ignoreBackgroundError(): void {}
