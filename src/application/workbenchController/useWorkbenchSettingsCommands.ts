import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import {
  shouldIndexWorkspace,
  shouldStartLanguageServer,
  type SmartModeGateway,
} from "../../domain/intelligence";
import type { AppSettings, WorkspaceSettings } from "../../domain/settings";
import type { WorkspaceTrustGateway, WorkspaceTrustState } from "../../domain/trust";
import type { WorkspaceRuntimeOwner } from "../../domain/workspaceRuntimeOwner";
import type { IntelligenceMode, WorkspaceDescriptor } from "../../domain/workspace";
import { normalizedWorkspaceRootKey, workspaceRootKeysEqual } from "../../domain/workspaceRootKey";
import type { WorkspaceTrustIntentCoordinator } from "../workspaceTrustIntentCoordinator";
import {
  beginWorkbenchSmartModeIntent,
  type WorkbenchSmartModeIntentState,
} from "./useWorkbenchLanguageRuntimeCoordinator";

interface TrustAutostart {
  readonly owner: WorkspaceRuntimeOwner;
  readonly promise: Promise<void>;
  readonly revision: number;
  readonly trustRevision: number;
  readonly typeScriptVersionPreference: WorkspaceSettings["javaScriptTypeScriptVersion"];
}

interface JavaScriptTypeScriptSettingsChangeInput {
  readonly nextSettings: WorkspaceSettings;
  readonly previousSettings: WorkspaceSettings;
  readonly requestIsCurrent: () => boolean;
  readonly rootPath: string;
}

interface WorkspaceSettingsIdentity {
  readonly admissionToken?: number;
  readonly canonicalRoot: string;
  readonly workspaceId: string;
}

type AppSettingsFailurePolicy = "report" | "reportAndReject";

interface WorkbenchSettingsCommandsInput {
  readonly applyJavaScriptTypeScriptSettingsChange: (
    input: JavaScriptTypeScriptSettingsChangeInput,
  ) => Promise<void>;
  readonly appSettingsRef: MutableRefObject<AppSettings>;
  readonly autoStartedLanguageServerRootRef: MutableRefObject<string | null>;
  readonly clearWorkspaceIndex: (
    rootPath: string,
    message: string | undefined,
    requestIsCurrent: () => boolean,
  ) => Promise<void>;
  readonly currentWorkspaceRootRef: MutableRefObject<string | null>;
  readonly intelligenceMode: IntelligenceMode;
  readonly intelligenceModeRef: MutableRefObject<IntelligenceMode>;
  readonly javaScriptTypeScriptTrustAutostartRef: MutableRefObject<TrustAutostart | null>;
  readonly openWorkspaceRequestTokenRef: MutableRefObject<number>;
  readonly persistAppSettings: (settings: AppSettings) => Promise<void>;
  readonly persistWorkspaceSettings: (
    rootPath: string,
    settings: WorkspaceSettings,
  ) => Promise<void>;
  readonly phpLanguageServerAutostartAttemptsByRootRef: MutableRefObject<Record<string, number>>;
  readonly refreshJavaScriptTypeScriptPlanAfterTrustGrant: (
    owner: WorkspaceRuntimeOwner,
    requestRevision: number,
    trustRevision: number,
    typeScriptVersionPreference: WorkspaceSettings["javaScriptTypeScriptVersion"],
  ) => Promise<void>;
  readonly refreshLanguageServerPlan: (
    rootPath: string,
    owner: WorkspaceRuntimeOwner,
  ) => Promise<unknown>;
  readonly reportErrorForActiveWorkspaceRoot: (
    rootPath: string | null,
    source: string,
    error: unknown,
  ) => void;
  readonly resolveCurrentWorkspaceRuntimeOwner: () => WorkspaceRuntimeOwner | null;
  readonly runGitRepositoryDiscovery: (
    rootPath: string,
    settings: WorkspaceSettings,
  ) => Promise<void>;
  readonly runPhpWorkspaceProbe: (rootPath: string, owner?: WorkspaceRuntimeOwner) => Promise<void>;
  readonly setIntelligenceMode: Dispatch<SetStateAction<IntelligenceMode>>;
  readonly setMessage: Dispatch<SetStateAction<string | null>>;
  readonly setSmartMode: (mode: IntelligenceMode) => Promise<void>;
  readonly setWorkspaceTrust: Dispatch<SetStateAction<WorkspaceTrustState | null>>;
  readonly smartModeGateway: SmartModeGateway;
  readonly smartModeRequestGenerationRef: MutableRefObject<number>;
  readonly smartModeRequestIntentRef: MutableRefObject<WorkbenchSmartModeIntentState | null>;
  readonly startInitialIndexScan: (
    rootPath: string,
    requestIsCurrent: () => boolean,
  ) => Promise<void>;
  readonly stopBackgroundProjectRuntimes: (
    policy: AppSettings["runtimePolicy"],
    rootPath: string,
    previousRootPath: string | null,
  ) => Promise<void>;
  readonly stopLanguageServerRuntime: (
    rootPath: string,
    owner: WorkspaceRuntimeOwner,
  ) => Promise<unknown>;
  readonly stopProjectLanguageServersAfterTrustRevocation: (
    owner: WorkspaceRuntimeOwner,
  ) => Promise<void>;
  readonly workspaceCloseGenerationByRootRef: MutableRefObject<Record<string, number>>;
  readonly workspaceDescriptor: WorkspaceDescriptor | null;
  readonly workspaceIdentityDescriptor: WorkspaceSettingsIdentity | null;
  readonly workspaceRoot: string | null;
  readonly workspaceRuntimeOwnerClaimsRef: {
    readonly current: { generationFor(ownerKey: string): number | null | undefined };
  };
  readonly workspaceRuntimeOwnerRef: { readonly current: WorkspaceRuntimeOwner | null };
  readonly workspaceSettingsRef: MutableRefObject<WorkspaceSettings>;
  readonly workspaceTrust: WorkspaceTrustState | null;
  readonly workspaceTrustGateway: WorkspaceTrustGateway;
  readonly workspaceTrustIntentCoordinatorRef: MutableRefObject<WorkspaceTrustIntentCoordinator>;
  readonly workspaceTrustRevisionByOwnerRef: MutableRefObject<Record<string, number>>;
}

export function useWorkbenchSettingsCommands({
  applyJavaScriptTypeScriptSettingsChange,
  appSettingsRef,
  autoStartedLanguageServerRootRef,
  clearWorkspaceIndex,
  currentWorkspaceRootRef,
  intelligenceMode,
  intelligenceModeRef,
  javaScriptTypeScriptTrustAutostartRef,
  openWorkspaceRequestTokenRef,
  persistAppSettings,
  persistWorkspaceSettings,
  phpLanguageServerAutostartAttemptsByRootRef,
  refreshJavaScriptTypeScriptPlanAfterTrustGrant,
  refreshLanguageServerPlan,
  reportErrorForActiveWorkspaceRoot,
  resolveCurrentWorkspaceRuntimeOwner,
  runGitRepositoryDiscovery,
  runPhpWorkspaceProbe,
  setIntelligenceMode,
  setMessage,
  setSmartMode,
  setWorkspaceTrust,
  smartModeGateway,
  smartModeRequestGenerationRef,
  smartModeRequestIntentRef,
  startInitialIndexScan,
  stopBackgroundProjectRuntimes,
  stopLanguageServerRuntime,
  stopProjectLanguageServersAfterTrustRevocation,
  workspaceCloseGenerationByRootRef,
  workspaceDescriptor,
  workspaceIdentityDescriptor,
  workspaceRoot,
  workspaceRuntimeOwnerClaimsRef,
  workspaceRuntimeOwnerRef,
  workspaceSettingsRef,
  workspaceTrust,
  workspaceTrustGateway,
  workspaceTrustIntentCoordinatorRef,
  workspaceTrustRevisionByOwnerRef,
}: WorkbenchSettingsCommandsInput) {
  const toggleSmartMode = useCallback(async () => {
    const nextMode = shouldStartLanguageServer(intelligenceMode) ? "basic" : "fullSmart";
    await setSmartMode(nextMode);
  }, [intelligenceMode, setSmartMode]);

  const toggleWorkspaceTrust = useCallback(async () => {
    if (!workspaceRoot) return;

    const requestedRoot = workspaceRoot;
    const requestedOwner = resolveCurrentWorkspaceRuntimeOwner();
    if (!requestedOwner) return;

    const trustIntentCoordinator = workspaceTrustIntentCoordinatorRef.current;
    const desiredTrust = trustIntentCoordinator.desiredTrust(requestedOwner, requestedRoot);
    const trusted = !(desiredTrust ?? workspaceTrust?.trusted ?? false);
    const trustIntent = trustIntentCoordinator.request(requestedOwner, requestedRoot, trusted);
    const requestedRevision = openWorkspaceRequestTokenRef.current;
    workspaceTrustRevisionByOwnerRef.current[requestedOwner.ownerKey] = trustIntent.revision;
    if (!trusted) {
      javaScriptTypeScriptTrustAutostartRef.current = null;
    }
    const requestedTrustRevision = trustIntent.revision;
    const requestIsCurrent = () => {
      const currentOwner = resolveCurrentWorkspaceRuntimeOwner();
      if (openWorkspaceRequestTokenRef.current !== requestedRevision || !currentOwner) {
        return false;
      }

      if (currentOwner.ownerKey !== requestedOwner.ownerKey) {
        return false;
      }

      return (
        workspaceRootKeysEqual(currentOwner.executionRoot, requestedOwner.executionRoot) &&
        (workspaceTrustRevisionByOwnerRef.current[requestedOwner.ownerKey] ?? 0) ===
          requestedTrustRevision
      );
    };

    try {
      const result = await trustIntentCoordinator.persist(
        requestedOwner.ownerKey,
        workspaceTrustGateway,
      );
      if (!requestIsCurrent()) return;

      const trust = result.trust;
      setWorkspaceTrust(trust);
      setMessage(trust.trusted ? "Workspace trusted." : "Workspace trust revoked.");

      if (!trust.trusted) {
        await stopProjectLanguageServersAfterTrustRevocation(requestedOwner);
        if (!requestIsCurrent()) return;
      }

      if (trust.trusted && workspaceSettingsRef.current.javaScriptTypeScriptService === "auto") {
        await refreshJavaScriptTypeScriptPlanAfterTrustGrant(
          requestedOwner,
          requestedRevision,
          requestedTrustRevision,
          workspaceSettingsRef.current.javaScriptTypeScriptVersion,
        );
        if (!requestIsCurrent()) return;
      }

      if (!workspaceDescriptor?.php) return;

      await refreshLanguageServerPlan(requestedRoot, requestedOwner);
      if (!requestIsCurrent()) return;
    } catch (error) {
      if (!requestIsCurrent()) return;
      reportErrorForActiveWorkspaceRoot(requestedRoot, "Workspace Trust", error);
    }
  }, [
    javaScriptTypeScriptTrustAutostartRef,
    openWorkspaceRequestTokenRef,
    refreshJavaScriptTypeScriptPlanAfterTrustGrant,
    refreshLanguageServerPlan,
    reportErrorForActiveWorkspaceRoot,
    resolveCurrentWorkspaceRuntimeOwner,
    setMessage,
    setWorkspaceTrust,
    stopProjectLanguageServersAfterTrustRevocation,
    workspaceDescriptor,
    workspaceRoot,
    workspaceSettingsRef,
    workspaceTrust,
    workspaceTrustGateway,
    workspaceTrustIntentCoordinatorRef,
    workspaceTrustRevisionByOwnerRef,
  ]);

  const saveWorkbenchSettings = useCallback(
    async (
      nextAppSettings: AppSettings,
      nextWorkspaceSettings: WorkspaceSettings,
      nextTrusted: boolean | null,
      appSettingsFailurePolicy: AppSettingsFailurePolicy = "report",
    ) => {
      const requestedRoot = workspaceRoot;
      const requestedOwner = resolveCurrentWorkspaceRuntimeOwner();
      const requestedOwnerGeneration = requestedOwner
        ? workspaceRuntimeOwnerClaimsRef.current.generationFor(requestedOwner.ownerKey)
        : null;
      const smartModeIntent = beginWorkbenchSmartModeIntent({
        currentWorkspaceRootRef,
        identity: workspaceIdentityDescriptor,
        intentGenerationRef: smartModeRequestGenerationRef,
        intentStateRef: smartModeRequestIntentRef,
        mode: nextWorkspaceSettings.intelligenceMode,
        owner: requestedOwner,
        rootPath: requestedRoot,
        workspaceRuntimeOwnerClaimsRef,
        workspaceRuntimeOwnerRef,
      });
      const requestedRevision = openWorkspaceRequestTokenRef.current;
      const trustIntentCoordinator = workspaceTrustIntentCoordinatorRef.current;
      const desiredTrust =
        requestedOwner && requestedRoot
          ? trustIntentCoordinator.desiredTrust(requestedOwner, requestedRoot)
          : null;
      const pendingTrustAutostart =
        requestedOwner !== null &&
        javaScriptTypeScriptTrustAutostartRef.current?.owner.ownerKey === requestedOwner.ownerKey;
      const requestsTrustChange =
        requestedOwner !== null &&
        requestedRoot !== null &&
        nextTrusted !== null &&
        (nextTrusted !== (desiredTrust ?? workspaceTrust?.trusted) ||
          (nextTrusted && pendingTrustAutostart));
      const trustIntent =
        requestedOwner && requestedRoot && requestsTrustChange
          ? trustIntentCoordinator.request(requestedOwner, requestedRoot, nextTrusted as boolean)
          : null;
      if (requestedOwner && trustIntent) {
        workspaceTrustRevisionByOwnerRef.current[requestedOwner.ownerKey] = trustIntent.revision;
        if (!nextTrusted) {
          javaScriptTypeScriptTrustAutostartRef.current = null;
        }
      }
      const requestedTrustRevision = trustIntent?.revision ?? 0;
      const requestedRootGeneration = requestedRoot
        ? (workspaceCloseGenerationByRootRef.current[normalizedWorkspaceRootKey(requestedRoot)] ??
          0)
        : null;
      const requestIsCurrent = () => {
        if (!requestedRoot || !requestedOwner) return false;
        if (requestedOwnerGeneration === null || requestedOwnerGeneration === undefined) {
          return false;
        }
        if (openWorkspaceRequestTokenRef.current !== requestedRevision) return false;

        const currentOwner = resolveCurrentWorkspaceRuntimeOwner();
        if (
          currentOwner !== requestedOwner ||
          workspaceRuntimeOwnerRef.current !== requestedOwner
        ) {
          return false;
        }
        if (
          workspaceRuntimeOwnerClaimsRef.current.generationFor(requestedOwner.ownerKey) !==
          requestedOwnerGeneration
        )
          return false;
        const currentRootGeneration =
          workspaceCloseGenerationByRootRef.current[normalizedWorkspaceRootKey(requestedRoot)] ?? 0;
        return (
          currentRootGeneration === requestedRootGeneration &&
          workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot) &&
          (!requestsTrustChange ||
            (workspaceTrustRevisionByOwnerRef.current[requestedOwner.ownerKey] ?? 0) ===
              requestedTrustRevision)
        );
      };

      let appSettingsPersisted = false;
      try {
        const previousAppSettings = appSettingsRef.current;
        const previousWorkspaceSettings = workspaceSettingsRef.current;
        await persistAppSettings(nextAppSettings);
        appSettingsPersisted = true;

        if (!requestedRoot) {
          if (!currentWorkspaceRootRef.current) {
            setMessage("Settings saved.");
          }
          return;
        }
        if (!requestedOwner || !requestIsCurrent()) return;

        if (previousAppSettings.runtimePolicy !== nextAppSettings.runtimePolicy) {
          await stopBackgroundProjectRuntimes(nextAppSettings.runtimePolicy, requestedRoot, null);
          if (!requestIsCurrent()) return;
        }

        const previousMode = intelligenceModeRef.current;
        let nextMode = nextWorkspaceSettings.intelligenceMode;
        let ownsModeMutation = true;
        if (nextWorkspaceSettings.intelligenceMode !== previousMode) {
          if (!smartModeIntent) return;
          const smartMode = await smartModeIntent.setMode(smartModeGateway);
          if (!requestIsCurrent()) return;
          ownsModeMutation = smartModeIntent.isCurrent() && smartModeIntent.claimEffects();
          nextMode = ownsModeMutation ? smartMode.mode : intelligenceModeRef.current;
        }

        const resolvedWorkspaceSettings = {
          ...nextWorkspaceSettings,
          intelligenceMode: nextMode,
        };
        const shouldRefreshPhpLanguageServerPlan =
          previousWorkspaceSettings.phpBackend !== resolvedWorkspaceSettings.phpBackend ||
          previousWorkspaceSettings.phpactorPath !== resolvedWorkspaceSettings.phpactorPath ||
          previousWorkspaceSettings.intelephensePath !== resolvedWorkspaceSettings.intelephensePath;
        const previousGitDirectoryMappings = previousWorkspaceSettings.gitDirectoryMappings;
        const nextGitDirectoryMappings = resolvedWorkspaceSettings.gitDirectoryMappings;
        const shouldRediscoverGitRepositories =
          previousWorkspaceSettings.gitDirectoryMappingsAuto !==
            resolvedWorkspaceSettings.gitDirectoryMappingsAuto ||
          previousGitDirectoryMappings.length !== nextGitDirectoryMappings.length ||
          previousGitDirectoryMappings.some(
            (mapping, index) => mapping !== nextGitDirectoryMappings[index],
          );

        if (
          ownsModeMutation &&
          shouldStartLanguageServer(previousMode) &&
          !shouldStartLanguageServer(nextMode)
        ) {
          intelligenceModeRef.current = nextMode;
          setIntelligenceMode(nextMode);
          autoStartedLanguageServerRootRef.current = requestedOwner.ownerKey;
          await stopLanguageServerRuntime(requestedRoot, requestedOwner);
          if (!requestIsCurrent()) return;
        }

        if (
          ownsModeMutation &&
          !shouldStartLanguageServer(previousMode) &&
          shouldStartLanguageServer(nextMode)
        ) {
          autoStartedLanguageServerRootRef.current = null;
          delete phpLanguageServerAutostartAttemptsByRootRef.current[requestedOwner.ownerKey];
        }

        if (ownsModeMutation) {
          intelligenceModeRef.current = nextMode;
        }
        await persistWorkspaceSettings(requestedRoot, resolvedWorkspaceSettings);
        if (!requestIsCurrent()) return;
        if (ownsModeMutation) {
          setIntelligenceMode(nextMode);
        }

        await applyJavaScriptTypeScriptSettingsChange({
          previousSettings: previousWorkspaceSettings,
          nextSettings: resolvedWorkspaceSettings,
          rootPath: requestedRoot,
          requestIsCurrent,
        });
        if (!requestIsCurrent()) return;

        let refreshedPhpLanguageServerPlan = false;
        if (
          ownsModeMutation &&
          !shouldStartLanguageServer(previousMode) &&
          shouldStartLanguageServer(nextMode) &&
          workspaceDescriptor?.php
        ) {
          await runPhpWorkspaceProbe(requestedRoot, requestedOwner);
          refreshedPhpLanguageServerPlan = true;
          if (!requestIsCurrent()) return;
        }

        if (trustIntent) {
          const result = await trustIntentCoordinator.persist(
            requestedOwner.ownerKey,
            workspaceTrustGateway,
          );
          if (!requestIsCurrent()) return;

          const trust = result.trust;
          setWorkspaceTrust(trust);
          if (!trust.trusted) {
            await stopProjectLanguageServersAfterTrustRevocation(requestedOwner);
            if (!requestIsCurrent()) return;
          }

          if (trust.trusted && resolvedWorkspaceSettings.javaScriptTypeScriptService === "auto") {
            await refreshJavaScriptTypeScriptPlanAfterTrustGrant(
              requestedOwner,
              requestedRevision,
              requestedTrustRevision,
              resolvedWorkspaceSettings.javaScriptTypeScriptVersion,
            );
            if (!requestIsCurrent()) return;
          }

          if (workspaceDescriptor?.php) {
            await refreshLanguageServerPlan(requestedRoot, requestedOwner);
            refreshedPhpLanguageServerPlan = true;
            if (!requestIsCurrent()) return;
          }
        }

        if (
          shouldRefreshPhpLanguageServerPlan &&
          workspaceDescriptor?.php &&
          !refreshedPhpLanguageServerPlan
        ) {
          autoStartedLanguageServerRootRef.current = null;
          delete phpLanguageServerAutostartAttemptsByRootRef.current[requestedOwner.ownerKey];
          await refreshLanguageServerPlan(requestedRoot, requestedOwner);
          if (!requestIsCurrent()) return;
        }

        if (
          ownsModeMutation &&
          !shouldIndexWorkspace(previousMode) &&
          shouldIndexWorkspace(nextMode)
        ) {
          await startInitialIndexScan(requestedRoot, requestIsCurrent);
          if (!requestIsCurrent()) return;
        }
        if (
          ownsModeMutation &&
          shouldIndexWorkspace(previousMode) &&
          !shouldIndexWorkspace(nextMode)
        ) {
          await clearWorkspaceIndex(requestedRoot, undefined, requestIsCurrent);
          if (!requestIsCurrent()) return;
        }
        if (shouldRediscoverGitRepositories) {
          await runGitRepositoryDiscovery(requestedRoot, resolvedWorkspaceSettings);
          if (!requestIsCurrent()) return;
        }
        if (!requestIsCurrent()) return;
        setMessage("Settings saved.");
      } catch (error) {
        const rejectAppSettingsFailure =
          !appSettingsPersisted && appSettingsFailurePolicy === "reportAndReject";
        if (requestedRoot && !requestIsCurrent()) {
          if (rejectAppSettingsFailure) throw error;
          return;
        }
        reportErrorForActiveWorkspaceRoot(requestedRoot, "Settings", error);
        if (rejectAppSettingsFailure) throw error;
      }
    },
    [
      applyJavaScriptTypeScriptSettingsChange,
      appSettingsRef,
      autoStartedLanguageServerRootRef,
      clearWorkspaceIndex,
      currentWorkspaceRootRef,
      intelligenceModeRef,
      javaScriptTypeScriptTrustAutostartRef,
      openWorkspaceRequestTokenRef,
      persistAppSettings,
      persistWorkspaceSettings,
      phpLanguageServerAutostartAttemptsByRootRef,
      refreshJavaScriptTypeScriptPlanAfterTrustGrant,
      refreshLanguageServerPlan,
      reportErrorForActiveWorkspaceRoot,
      resolveCurrentWorkspaceRuntimeOwner,
      runGitRepositoryDiscovery,
      runPhpWorkspaceProbe,
      setIntelligenceMode,
      setMessage,
      setWorkspaceTrust,
      smartModeGateway,
      smartModeRequestGenerationRef,
      smartModeRequestIntentRef,
      startInitialIndexScan,
      stopBackgroundProjectRuntimes,
      stopLanguageServerRuntime,
      stopProjectLanguageServersAfterTrustRevocation,
      workspaceCloseGenerationByRootRef,
      workspaceDescriptor,
      workspaceIdentityDescriptor,
      workspaceRoot,
      workspaceRuntimeOwnerClaimsRef,
      workspaceRuntimeOwnerRef,
      workspaceSettingsRef,
      workspaceTrust,
      workspaceTrustGateway,
      workspaceTrustIntentCoordinatorRef,
      workspaceTrustRevisionByOwnerRef,
    ],
  );

  return { saveWorkbenchSettings, toggleSmartMode, toggleWorkspaceTrust } as const;
}
