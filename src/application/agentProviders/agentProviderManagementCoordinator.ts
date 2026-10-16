import type { PersistedAgentProviderSettingsAuthority } from "../../domain/agentProviderSettings";
import type { AgentCliKind } from "../../domain/agentTask";
import type { AgentProviderAdmissionAuthority } from "../agentProviderAdmissionAuthority";
import { refreshAgentProviderBatch } from "../agentProviderRefresh";
import { providerFields, type AgentProviderSettingsIntent } from "../agentProviderSettingsIntent";
import type { AgentCliDiscoveryStatus } from "../useAgentCliDiscovery";
import { createAgentProviderHealthCoordinator } from "./agentProviderHealthCoordinator";
import type {
  AgentProviderManagementDependencies,
  AgentProviderManagementToast,
  AgentProviderRefreshOutcome,
  AgentProviderUpdateRefusal,
} from "./agentProviderManagementContract";
import {
  clearProviderTimer,
  createAgentProviderManagementState,
  currentProviderOwner,
  providerOwnerIsCurrent,
  replaceRuntime,
  type AgentCliDiscoveryPort,
  type AgentProviderManagementViewSink,
} from "./agentProviderManagementState";
import { createAgentProviderRegistration } from "./agentProviderRegistration";
import {
  PROVIDERS,
  admissionAuthorityFor,
  authorityFor,
  initialRuntime,
  isReadyAdmissionAuthority,
  unsupportedDiscoveryStatus,
  type ProviderRuntimeRecord,
} from "./agentProviderRuntime";
import {
  createAgentProviderSettingsSave,
  type AgentProviderSettingsSave,
} from "./agentProviderSettingsSave";
import { createAgentProviderUpdateFlow } from "./agentProviderUpdateFlow";

export interface AgentProviderManagementCoordinator {
  syncRendered(
    dependencies: AgentProviderManagementDependencies,
    runtime: ProviderRuntimeRecord,
    toast: AgentProviderManagementToast | null,
    discovery: AgentCliDiscoveryPort,
  ): void;
  activate(
    settingsHydrated: boolean,
    appSettingsRef: AgentProviderManagementDependencies["appSettingsRef"],
  ): () => void;
  applyDiscoveryStatus(status: AgentCliDiscoveryStatus): void;
  persistedCliPath(provider: AgentCliKind): string | null;
  admissionAuthority(provider: AgentCliKind): AgentProviderAdmissionAuthority;
  authority(provider: AgentCliKind): PersistedAgentProviderSettingsAuthority | null;
  dismissToast(): void;
  dismissUpdate(provider: AgentCliKind, version: string): Promise<boolean>;
  refresh(provider: AgentCliKind): Promise<void>;
  refreshAll(): Promise<void>;
  refreshWithOutcome(provider: AgentCliKind): Promise<AgentProviderRefreshOutcome>;
  retryRegistration(provider: AgentCliKind): Promise<void>;
  save(intent: AgentProviderSettingsIntent): Promise<boolean>;
  saveWithOutcome: AgentProviderSettingsSave;
  update(
    provider: AgentCliKind,
    offeredVersion: string,
  ): Promise<AgentProviderUpdateRefusal | null>;
}

export function createAgentProviderManagementCoordinator(
  dependencies: AgentProviderManagementDependencies,
  discovery: AgentCliDiscoveryPort,
  sink: AgentProviderManagementViewSink,
): AgentProviderManagementCoordinator {
  const state = createAgentProviderManagementState(dependencies, discovery, sink);
  const health = createAgentProviderHealthCoordinator(state);
  const registration = createAgentProviderRegistration(state, health);
  const saveWithOutcome = createAgentProviderSettingsSave(state, registration);
  const updateFlow = createAgentProviderUpdateFlow(state, health, registration, saveWithOutcome);

  const activate = (
    settingsHydrated: boolean,
    appSettingsRef: AgentProviderManagementDependencies["appSettingsRef"],
  ): (() => void) => {
    state.mounted = true;
    state.hydrationReady = false;
    state.hydrationGeneration += 1;
    sink.setSelectedProviderAuthorityPublication(null);
    if (!settingsHydrated) {
      state.hydrationSettled = false;
      state.authorities = {};
      replaceRuntime(state, initialRuntime());
      return () => {
        state.mounted = false;
      };
    }
    if (!state.hydrationSettled) {
      state.hydrationSettled = true;
      state.persistedSliceRef.current = {
        fields: {
          claudeCode: providerFields(appSettingsRef.current, "claudeCode"),
          codex: providerFields(appSettingsRef.current, "codex"),
        },
        selectedProvider: appSettingsRef.current.agentCliKind,
        selectedSettingsRevision: state.settingsRevision,
      };
    }
    state.hydrationReady = true;
    const lifecycleGeneration = state.hydrationGeneration;
    const selectedProvider = state.persistedSliceRef.current.selectedProvider;
    const selectedSettingsRevision = state.persistedSliceRef.current.selectedSettingsRevision;
    for (const provider of PROVIDERS) {
      const registered = registration.register(
        provider,
        selectedSettingsRevision,
        state.persistedSliceRef.current.fields[provider],
      );
      if (provider !== selectedProvider) {
        void registered;
        continue;
      }
      void registered.then((succeeded) => {
        if (!succeeded) return;
        registration.publishSelectedProviderAuthority(
          selectedProvider,
          selectedSettingsRevision,
          lifecycleGeneration,
        );
      });
    }
    return () => {
      state.mounted = false;
      state.hydrationReady = false;
      for (const provider of PROVIDERS) clearProviderTimer(state, provider);
      state.inFlightHealth = {};
      state.updateOperations = {};
      state.updateInFlight = {};
      for (const subscription of Object.values(state.updateProgressUnlisten)) {
        try {
          subscription?.unlisten();
        } catch (error) {
          state.dependenciesRef.current.reportError(
            "Agent provider update progress cleanup",
            error,
          );
        }
      }
      state.updateProgressUnlisten = {};
    };
  };

  const applyDiscoveryStatus = (status: AgentCliDiscoveryStatus): void => {
    switch (status.kind) {
      case "inactive":
        return;
      case "discovering":
      case "ready":
      case "failed":
        health.applyDiscoveryGeneration(status.kind, status.generation);
        return;
      default:
        return unsupportedDiscoveryStatus(status);
    }
  };

  const refreshProviders = async (
    requested: ReadonlyArray<AgentCliKind>,
  ): Promise<ReadonlyArray<AgentProviderRefreshOutcome>> => {
    const lifecycleGeneration = state.hydrationGeneration;
    const discoveryGateway = state.dependenciesRef.current.discoveryGateway;
    const port = state.discovery;
    const isCurrent = (generation: number): boolean =>
      state.mounted &&
      state.hydrationGeneration === lifecycleGeneration &&
      state.dependenciesRef.current.discoveryGateway === discoveryGateway &&
      port.currentGeneration() === generation;
    return refreshAgentProviderBatch({
      providers: requested,
      refreshDiscovery: port.refresh,
      discoveryGeneration: port.currentGeneration,
      configurationRevision: (candidate) => state.runtime[candidate].configurationRevision,
      applyDiscovery: health.applyDiscoveryGeneration,
      isCurrent,
      refreshHealth: async (candidate, generation) => {
        const owner = currentProviderOwner(state, candidate);
        if (owner === null) return { kind: "failed" };
        const settled = await health.refreshHealth(candidate);
        if (!isCurrent(generation) || !providerOwnerIsCurrent(state, owner)) {
          return { kind: "stale" };
        }
        if (settled === null) return { kind: "failed" };
        const authority = admissionAuthorityFor(
          candidate,
          state.authorities,
          state.runtime,
          state.discovery.read(),
        );
        if (!isReadyAdmissionAuthority(authority)) return { kind: "failed" };
        return { kind: "complete", authority };
      },
    });
  };

  const refreshWithOutcome = async (
    provider: AgentCliKind,
  ): Promise<AgentProviderRefreshOutcome> => {
    const results = await refreshProviders([provider]);
    return results[0] ?? { kind: "failed" };
  };

  return {
    syncRendered: (current, runtime, toast, currentDiscovery) => {
      state.dependenciesRef.current = current;
      state.runtime = runtime;
      state.renderedToast = toast;
      state.discovery = currentDiscovery;
    },
    activate,
    applyDiscoveryStatus,
    persistedCliPath: (provider) => state.persistedSliceRef.current.fields[provider].cliPath,
    admissionAuthority: (provider) =>
      admissionAuthorityFor(provider, state.authorities, state.runtime, state.discovery.read()),
    authority: (provider) => authorityFor(provider, state.authorities, state.runtime),
    dismissToast: () => sink.setToast(null),
    dismissUpdate: updateFlow.dismissUpdate,
    refresh: async (provider) => {
      await refreshWithOutcome(provider);
    },
    refreshAll: () => health.updateChecks.checkAll(PROVIDERS),
    refreshWithOutcome,
    retryRegistration: registration.retryRegistration,
    save: async (intent) => (await saveWithOutcome(intent)).kind === "persisted",
    saveWithOutcome,
    update: updateFlow.update,
  };
}
