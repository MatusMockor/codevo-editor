import { parseCodexTransportSettings } from "../../domain/agentProviderSettings";
import type { AgentCliKind } from "../../domain/agentTask";
import { agentProviderHealthBeforeRegistration } from "../agentProviderDiscoveryAdmission";
import { providerFields, type ProviderFields } from "../agentProviderSettingsIntent";
import {
  AGENT_PROVIDER_UPDATE_HEALTH_SETTLE_TIMEOUT_MS,
  AGENT_PROVIDER_UPDATE_REGISTRATION_TIMEOUT_MS,
  boundedSettlement,
  updateStateBeforeRegistration,
} from "../agentProviderUpdateRun";
import type { AgentProviderHealthCoordinator } from "./agentProviderHealthCoordinator";
import type { AgentProviderUpdateRegistrationOutcome } from "./agentProviderManagementContract";
import {
  clearProviderTimer,
  clearProviderToast,
  publishProvider,
  type AgentProviderManagementState,
} from "./agentProviderManagementState";
import {
  authority,
  authorityFor,
  policyMatches,
  policyRegistrationFailureReason,
  registeredRuntime,
  registrationIsCurrent,
} from "./agentProviderRuntime";

export interface AgentProviderRegistration {
  register(
    provider: AgentCliKind,
    settingsRevision: number,
    exactFields?: ProviderFields,
    preservedUpdateOperationId?: string | null,
  ): Promise<boolean>;
  publishSelectedProviderAuthority(
    provider: AgentCliKind,
    settingsRevision: number,
    lifecycleGeneration: number,
  ): boolean;
  establishSelectedProviderAuthority(
    provider: AgentCliKind,
    settingsRevision: number,
    lifecycleGeneration: number,
  ): Promise<boolean>;
  retryRegistration(provider: AgentCliKind): Promise<void>;
  registerBeforeUpdate(provider: AgentCliKind): Promise<AgentProviderUpdateRegistrationOutcome>;
}

export function createAgentProviderRegistration(
  state: AgentProviderManagementState,
  health: AgentProviderHealthCoordinator,
): AgentProviderRegistration {
  const settleRegistered = (
    provider: AgentCliKind,
    configurationRevision: number,
    receipt: { readonly settingsRevision: number; readonly providerGeneration: number },
    fields: ProviderFields,
  ): true => {
    state.authorities[provider] = authority(provider, receipt.settingsRevision, fields);
    publishProvider(state, provider, (current) =>
      registeredRuntime(current, configurationRevision, receipt),
    );
    health.scheduleHealth(provider);
    void health.refreshHealth(provider);
    return true;
  };

  const register = async (
    provider: AgentCliKind,
    settingsRevision: number,
    exactFields?: ProviderFields,
    preservedUpdateOperationId: string | null = null,
  ): Promise<boolean> => {
    clearProviderTimer(state, provider);
    clearProviderToast(state, provider);
    const preservesUpdate =
      preservedUpdateOperationId !== null &&
      state.updateOperations[provider] === preservedUpdateOperationId;
    if (!preservesUpdate) delete state.updateOperations[provider];
    const configurationRevision = state.runtime[provider].configurationRevision + 1;
    const fields =
      exactFields ?? providerFields(state.dependenciesRef.current.appSettingsRef.current, provider);
    state.authorities[provider] = undefined;
    publishProvider(state, provider, (current) => ({
      ...current,
      configurationRevision,
      healthGeneration: current.healthGeneration + 1,
      policy: { kind: "registering", settingsRevision },
      updateState: preservesUpdate
        ? current.updateState
        : updateStateBeforeRegistration(current.updateState),
      health: agentProviderHealthBeforeRegistration(
        fields.preference,
        fields.cliPath,
        state.discovery.read()?.result[provider],
      ),
    }));
    const gateway = state.dependenciesRef.current.policyGateway;
    const lifecycleGeneration = state.hydrationGeneration;
    let effectiveSettingsRevision = settingsRevision;
    let expectedProviderGeneration: number | null = null;
    const stillRegistering = (revision: number): boolean =>
      state.mounted &&
      state.hydrationGeneration === lifecycleGeneration &&
      state.dependenciesRef.current.policyGateway === gateway &&
      registrationIsCurrent(state.runtime[provider], configurationRevision, revision);
    try {
      const currentPolicy = await gateway.currentAgentProviderPolicy({ provider });
      if (!stillRegistering(settingsRevision)) return false;
      if (currentPolicy.kind === "registered") {
        if (currentPolicy.receipt.provider !== provider) {
          throw new Error("Provider policy lookup returned a foreign receipt.");
        }
        state.settingsRevision = Math.max(
          state.settingsRevision,
          currentPolicy.receipt.settingsRevision,
        );
        expectedProviderGeneration = currentPolicy.receipt.providerGeneration;
        if (policyMatches(currentPolicy, fields)) {
          return settleRegistered(provider, configurationRevision, currentPolicy.receipt, fields);
        }
        effectiveSettingsRevision = Math.max(
          effectiveSettingsRevision,
          currentPolicy.receipt.settingsRevision + 1,
        );
        state.settingsRevision = Math.max(state.settingsRevision, effectiveSettingsRevision);
        publishProvider(state, provider, (current) => ({
          ...current,
          policy: { kind: "registering", settingsRevision: effectiveSettingsRevision },
        }));
      }
      const receipt = await gateway.registerAgentProviderPolicy({
        provider,
        settingsRevision: effectiveSettingsRevision,
        expectedProviderGeneration,
        enabled: fields.preference.enabled,
        cliPath: fields.cliPath,
        checkForUpdates: fields.preference.checkForUpdates,
        ...(provider === "codex" ? parseCodexTransportSettings(fields.preference) : {}),
      });
      if (!stillRegistering(effectiveSettingsRevision)) return false;
      if (receipt.provider !== provider) {
        throw new Error("Provider policy registration returned a foreign receipt.");
      }
      state.settingsRevision = Math.max(state.settingsRevision, receipt.settingsRevision);
      return settleRegistered(provider, configurationRevision, receipt, fields);
    } catch (error) {
      if (!stillRegistering(effectiveSettingsRevision)) return false;
      publishProvider(state, provider, (current) => ({
        ...current,
        policy: {
          kind: "failed",
          settingsRevision: effectiveSettingsRevision,
          reason: policyRegistrationFailureReason(error),
        },
        health: {
          kind: "failed",
          reason: "policyRegistrationFailed",
          checkedAtEpochMs: null,
        },
      }));
      state.dependenciesRef.current.reportError("Agent provider registration", error);
      return false;
    }
  };

  const publishSelectedProviderAuthority = (
    provider: AgentCliKind,
    settingsRevision: number,
    lifecycleGeneration: number,
  ): boolean => {
    if (!state.mounted) return false;
    if (!state.hydrationReady) return false;
    if (state.hydrationGeneration !== lifecycleGeneration) return false;
    if (state.persistedSliceRef.current.selectedProvider !== provider) return false;
    if (authorityFor(provider, state.authorities, state.runtime) === null) return false;
    state.sink.setSelectedProviderAuthorityPublication({
      provider,
      settingsRevision,
      policyGateway: state.dependenciesRef.current.policyGateway,
      healthGateway: state.dependenciesRef.current.healthGateway,
      updateGateway: state.dependenciesRef.current.updateGateway,
    });
    return true;
  };

  const establishSelectedProviderAuthority = async (
    provider: AgentCliKind,
    settingsRevision: number,
    lifecycleGeneration: number,
  ): Promise<boolean> => {
    if (state.hydrationGeneration !== lifecycleGeneration) return false;
    if (state.persistedSliceRef.current.selectedProvider !== provider) return false;
    if (authorityFor(provider, state.authorities, state.runtime) === null) {
      const registered = await register(
        provider,
        settingsRevision,
        state.persistedSliceRef.current.fields[provider],
      );
      if (!registered) return false;
      if (state.hydrationGeneration !== lifecycleGeneration) return false;
      if (state.persistedSliceRef.current.selectedProvider !== provider) return false;
    }
    return publishSelectedProviderAuthority(provider, settingsRevision, lifecycleGeneration);
  };

  const retryRegistration = async (provider: AgentCliKind): Promise<void> => {
    if (!state.hydrationReady || !state.dependenciesRef.current.settingsHydrated) return;
    state.settingsRevision += 1;
    await register(provider, state.settingsRevision);
  };

  const registerBeforeUpdate = async (
    provider: AgentCliKind,
  ): Promise<AgentProviderUpdateRegistrationOutcome> => {
    const lifecycleGeneration = state.hydrationGeneration;
    const dependencies = state.dependenciesRef.current;
    const gateways = {
      policyGateway: dependencies.policyGateway,
      healthGateway: dependencies.healthGateway,
      updateGateway: dependencies.updateGateway,
    };
    const stillOwned = (): boolean =>
      state.mounted &&
      state.hydrationReady &&
      state.hydrationGeneration === lifecycleGeneration &&
      state.dependenciesRef.current.policyGateway === gateways.policyGateway &&
      state.dependenciesRef.current.healthGateway === gateways.healthGateway &&
      state.dependenciesRef.current.updateGateway === gateways.updateGateway;
    const registration = await boundedSettlement(
      retryRegistration(provider),
      AGENT_PROVIDER_UPDATE_REGISTRATION_TIMEOUT_MS,
    );
    if (registration.kind === "timedOut") return "policyUnavailable";
    if (!stillOwned()) return "policyUnavailable";
    if (state.runtime[provider].policy.kind !== "registered") return "policyUnavailable";
    const pendingHealth = state.inFlightHealth[provider]?.promise;
    if (pendingHealth === undefined) return "statusUnknown";
    const settledHealth = await boundedSettlement(
      pendingHealth,
      AGENT_PROVIDER_UPDATE_HEALTH_SETTLE_TIMEOUT_MS,
    );
    if (settledHealth.kind === "timedOut") return "policyUnavailable";
    if (!stillOwned()) return "policyUnavailable";
    if (state.runtime[provider].policy.kind !== "registered") return "policyUnavailable";
    return "registered";
  };

  return {
    register,
    publishSelectedProviderAuthority,
    establishSelectedProviderAuthority,
    retryRegistration,
    registerBeforeUpdate,
  };
}
