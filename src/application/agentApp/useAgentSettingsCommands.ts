import { useCallback, useState, type MutableRefObject, type SetStateAction } from "react";
import type {
  AppSettings,
  SettingsSection,
  StatusBarItemVisibility,
  WorkspaceSettings,
} from "../../domain/settings";
import type { WorkspaceTrustGateway, WorkspaceTrustState } from "../../domain/trust";
import type { WorkspaceRuntimeOwner } from "../../domain/workspaceRuntimeOwner";
import { normalizedWorkspaceRootKey, workspaceRootKeysEqual } from "../../domain/workspaceRootKey";
import { backgroundRuntimeOwnersForPolicy } from "../workbenchController/workspaceRuntimePolicy";
import { confirmWorkspaceTrustGrant } from "../workspaceTrustGrantConfirmation";
import { openedProjectRevocation } from "../workspaceTrustIntentCoordinator";
import type { WorkspaceIdentityDescriptor } from "../workspaceIdentityGatewayPort";
import {
  stopAgentWorkspaceRuntimes,
  type AgentWorkspaceRuntimeGateways,
} from "./agentWorkspaceRuntimes";
import type { AgentWorkspaceAuthority } from "./useAgentWorkspaceAuthority";

export type AgentSettingsFailurePolicy = "report" | "reportAndReject";

export interface AgentSettingsCommandsOptions {
  readonly appSettingsRef: MutableRefObject<AppSettings>;
  readonly authority: AgentWorkspaceAuthority;
  readonly persistAppSettings: (settings: AppSettings) => Promise<void>;
  readonly persistWorkspaceSettings: (
    rootPath: string,
    settings: WorkspaceSettings,
  ) => Promise<void>;
  readonly reportErrorForActiveWorkspaceRoot: (
    rootPath: string | null,
    source: string,
    error: unknown,
  ) => void;
  readonly runGitRepositoryDiscovery: (
    rootPath: string,
    settings: WorkspaceSettings,
  ) => Promise<void>;
  readonly runtimeGateways: AgentWorkspaceRuntimeGateways;
  readonly setWorkspaceTrust: (update: SetStateAction<WorkspaceTrustState | null>) => void;
  readonly trustGateway: WorkspaceTrustGateway;
  readonly workspaceIdentityDescriptor: WorkspaceIdentityDescriptor | null;
  readonly workspaceRoot: string | null;
  readonly workspaceSettingsRef: MutableRefObject<WorkspaceSettings>;
  readonly workspaceTrust: WorkspaceTrustState | null;
}

export function useAgentSettingsCommands({
  appSettingsRef,
  authority,
  persistAppSettings,
  persistWorkspaceSettings,
  reportErrorForActiveWorkspaceRoot,
  runGitRepositoryDiscovery,
  runtimeGateways,
  setWorkspaceTrust,
  trustGateway,
  workspaceIdentityDescriptor,
  workspaceRoot,
  workspaceSettingsRef,
  workspaceTrust,
}: AgentSettingsCommandsOptions) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialSection, setSettingsInitialSection] = useState<SettingsSection>("general");
  const {
    currentWorkspaceRootRef,
    openWorkspaceRequestTokenRef,
    resolveWorkspaceRuntimeOwner,
    workspaceCloseGenerationByRootRef,
    workspaceRuntimeOwnerByTabRef,
    workspaceRuntimeOwnerClaimsRef,
    workspaceRuntimeOwnerRef,
    workspaceTrustIntentCoordinatorRef,
    workspaceTrustRevisionByOwnerRef,
  } = authority;

  const openSettingsSection = useCallback((section: SettingsSection) => {
    setSettingsInitialSection(section);
    setSettingsOpen(true);
  }, []);

  const currentOwner = useCallback(
    () => (workspaceRoot === null ? null : resolveWorkspaceRuntimeOwner(workspaceRoot)),
    [resolveWorkspaceRuntimeOwner, workspaceRoot],
  );

  const ownerRequestIsCurrent = useCallback(
    (owner: WorkspaceRuntimeOwner, requestToken: number) => {
      if (openWorkspaceRequestTokenRef.current !== requestToken) return false;
      if (workspaceRuntimeOwnerRef.current !== owner) return false;
      return workspaceRootKeysEqual(currentWorkspaceRootRef.current, owner.executionRoot);
    },
    [currentWorkspaceRootRef, openWorkspaceRequestTokenRef, workspaceRuntimeOwnerRef],
  );

  const persistTrustIntent = useCallback(
    async (owner: WorkspaceRuntimeOwner, isCurrent: () => boolean) => {
      const result = await workspaceTrustIntentCoordinatorRef.current.persist(
        owner.ownerKey,
        trustGateway,
      );
      if (!isCurrent()) return;
      setWorkspaceTrust(result.trust);
    },
    [setWorkspaceTrust, trustGateway, workspaceTrustIntentCoordinatorRef],
  );

  const toggleWorkspaceTrust = useCallback(async () => {
    const requestedRoot = workspaceRoot;
    const owner = currentOwner();
    if (requestedRoot === null || owner === null) return;
    const coordinator = workspaceTrustIntentCoordinatorRef.current;
    const desired = coordinator.desiredTrust(owner, requestedRoot);
    const trusted = !(desired ?? workspaceTrust?.trusted ?? false);
    const requestToken = openWorkspaceRequestTokenRef.current;
    if (trusted) {
      const confirmed = await confirmWorkspaceTrustGrant(trustGateway, requestedRoot, () =>
        ownerRequestIsCurrent(owner, requestToken),
      );
      if (!confirmed) return;
    }
    const intent = coordinator.request(
      owner,
      requestedRoot,
      trusted,
      openedProjectRevocation(workspaceIdentityDescriptor, owner),
    );
    workspaceTrustRevisionByOwnerRef.current[owner.ownerKey] = intent.revision;
    const isCurrent = () =>
      ownerRequestIsCurrent(owner, requestToken) &&
      (workspaceTrustRevisionByOwnerRef.current[owner.ownerKey] ?? 0) === intent.revision;
    try {
      await persistTrustIntent(owner, isCurrent);
    } catch (error) {
      if (!isCurrent()) return;
      reportErrorForActiveWorkspaceRoot(requestedRoot, "Workspace Trust", error);
    }
  }, [
    currentOwner,
    openWorkspaceRequestTokenRef,
    ownerRequestIsCurrent,
    persistTrustIntent,
    reportErrorForActiveWorkspaceRoot,
    trustGateway,
    workspaceIdentityDescriptor,
    workspaceRoot,
    workspaceTrust,
    workspaceTrustIntentCoordinatorRef,
    workspaceTrustRevisionByOwnerRef,
  ]);

  const stopBackgroundRuntimes = useCallback(
    async (
      policy: AppSettings["runtimePolicy"],
      rootPath: string,
      isCurrent: () => boolean,
    ): Promise<void> => {
      const owners = backgroundRuntimeOwnersForPolicy(
        policy,
        rootPath,
        null,
        appSettingsRef.current.workspaceTabs,
        workspaceRuntimeOwnerByTabRef.current,
      );
      await Promise.all(
        owners.map((owner) =>
          stopAgentWorkspaceRuntimes(runtimeGateways, {
            isCurrent,
            reportError: (error) =>
              reportErrorForActiveWorkspaceRoot(rootPath, "Workspace Runtime", error),
            rootPath: owner.executionRoot,
          }),
        ),
      );
    },
    [
      appSettingsRef,
      reportErrorForActiveWorkspaceRoot,
      runtimeGateways,
      workspaceRuntimeOwnerByTabRef,
    ],
  );

  const saveWorkbenchSettings = useCallback(
    async (
      nextAppSettings: AppSettings,
      nextWorkspaceSettings: WorkspaceSettings,
      nextTrusted: boolean | null,
      failurePolicy: AgentSettingsFailurePolicy = "report",
    ) => {
      const requestedRoot = workspaceRoot;
      const owner = currentOwner();
      const ownerGeneration = owner
        ? workspaceRuntimeOwnerClaimsRef.current.generationFor(owner.ownerKey)
        : null;
      const requestToken = openWorkspaceRequestTokenRef.current;
      const coordinator = workspaceTrustIntentCoordinatorRef.current;
      const desiredTrust =
        owner && requestedRoot ? coordinator.desiredTrust(owner, requestedRoot) : null;
      const trustIntent =
        owner &&
        requestedRoot &&
        nextTrusted !== null &&
        nextTrusted !== (desiredTrust ?? workspaceTrust?.trusted)
          ? coordinator.request(
              owner,
              requestedRoot,
              nextTrusted,
              openedProjectRevocation(workspaceIdentityDescriptor, owner),
            )
          : null;
      if (owner && trustIntent) {
        workspaceTrustRevisionByOwnerRef.current[owner.ownerKey] = trustIntent.revision;
      }
      const rootGeneration = requestedRoot
        ? (workspaceCloseGenerationByRootRef.current[normalizedWorkspaceRootKey(requestedRoot)] ??
          0)
        : null;
      const isCurrent = () => {
        if (!requestedRoot || !owner || ownerGeneration === null || ownerGeneration === undefined) {
          return false;
        }
        if (!ownerRequestIsCurrent(owner, requestToken)) return false;
        if (
          workspaceRuntimeOwnerClaimsRef.current.generationFor(owner.ownerKey) !== ownerGeneration
        ) {
          return false;
        }
        const currentRootGeneration =
          workspaceCloseGenerationByRootRef.current[normalizedWorkspaceRootKey(requestedRoot)] ?? 0;
        if (currentRootGeneration !== rootGeneration) return false;
        if (!trustIntent) return true;
        return (
          (workspaceTrustRevisionByOwnerRef.current[owner.ownerKey] ?? 0) === trustIntent.revision
        );
      };

      let appSettingsPersisted = false;
      try {
        const previousAppSettings = appSettingsRef.current;
        const previousWorkspaceSettings = workspaceSettingsRef.current;
        await persistAppSettings(nextAppSettings);
        appSettingsPersisted = true;
        if (!requestedRoot || !owner || !isCurrent()) return;

        if (previousAppSettings.runtimePolicy !== nextAppSettings.runtimePolicy) {
          await stopBackgroundRuntimes(nextAppSettings.runtimePolicy, requestedRoot, isCurrent);
          if (!isCurrent()) return;
        }

        await persistWorkspaceSettings(requestedRoot, nextWorkspaceSettings);
        if (!isCurrent()) return;

        if (trustIntent) {
          await persistTrustIntent(owner, isCurrent);
          if (!isCurrent()) return;
        }

        if (gitMappingsChanged(previousWorkspaceSettings, nextWorkspaceSettings)) {
          await runGitRepositoryDiscovery(requestedRoot, nextWorkspaceSettings);
        }
      } catch (error) {
        const reject = !appSettingsPersisted && failurePolicy === "reportAndReject";
        if (requestedRoot && !isCurrent()) {
          if (reject) throw error;
          return;
        }
        reportErrorForActiveWorkspaceRoot(requestedRoot, "Settings", error);
        if (reject) throw error;
      }
    },
    [
      appSettingsRef,
      currentOwner,
      openWorkspaceRequestTokenRef,
      ownerRequestIsCurrent,
      persistAppSettings,
      persistTrustIntent,
      persistWorkspaceSettings,
      reportErrorForActiveWorkspaceRoot,
      runGitRepositoryDiscovery,
      stopBackgroundRuntimes,
      workspaceCloseGenerationByRootRef,
      workspaceIdentityDescriptor,
      workspaceRoot,
      workspaceRuntimeOwnerClaimsRef,
      workspaceSettingsRef,
      workspaceTrust,
      workspaceTrustIntentCoordinatorRef,
      workspaceTrustRevisionByOwnerRef,
    ],
  );

  const setStatusBarItemVisibility = useCallback(
    async (key: keyof StatusBarItemVisibility, visible: boolean) => {
      const requestedRoot = workspaceRoot;
      if (!requestedRoot) return;
      try {
        await persistWorkspaceSettings(requestedRoot, {
          ...workspaceSettingsRef.current,
          statusBar: { ...workspaceSettingsRef.current.statusBar, [key]: visible },
        });
      } catch (error) {
        reportErrorForActiveWorkspaceRoot(requestedRoot, "Status Bar", error);
      }
    },
    [
      persistWorkspaceSettings,
      reportErrorForActiveWorkspaceRoot,
      workspaceRoot,
      workspaceSettingsRef,
    ],
  );

  return {
    openSettingsSection,
    saveWorkbenchSettings,
    setSettingsInitialSection,
    setSettingsOpen,
    setStatusBarItemVisibility,
    settingsInitialSection,
    settingsOpen,
    toggleWorkspaceTrust,
  };
}

function gitMappingsChanged(previous: WorkspaceSettings, next: WorkspaceSettings): boolean {
  if (previous.gitDirectoryMappingsAuto !== next.gitDirectoryMappingsAuto) return true;
  if (previous.gitDirectoryMappings.length !== next.gitDirectoryMappings.length) return true;
  return previous.gitDirectoryMappings.some(
    (mapping, index) => mapping !== next.gitDirectoryMappings[index],
  );
}
