import type { AgentProviderUpdateResult } from "../../domain/agentProviderHealth";
import type { AgentCliKind } from "../../domain/agentTask";
import { effectiveAgentProviderCliPath } from "../agentProviderDiscoveryAdmission";
import {
  agentProviderPreferences as preferences,
  type AgentProviderSettingsIntent,
} from "../agentProviderSettingsIntent";
import {
  boundedProgressSubscription,
  currentUpdateOutput,
  failedUpdateState,
  mergedUpdateOutput,
  runningUpdateWith,
} from "../agentProviderUpdateRun";
import type { AgentProviderHealthCoordinator } from "./agentProviderHealthCoordinator";
import type { AgentProviderUpdateRefusal } from "./agentProviderManagementContract";
import {
  clearProviderTimer,
  clearProviderToast,
  currentProviderOwner,
  providerOwnerIsCurrent,
  publishProvider,
  type AgentProviderManagementState,
} from "./agentProviderManagementState";
import type { AgentProviderRegistration } from "./agentProviderRegistration";
import { stillOffers, updateRefusal, type ProviderOwner } from "./agentProviderRuntime";
import type { AgentProviderSettingsSave } from "./agentProviderSettingsSave";
import { createAgentProviderUpdateProgressSession } from "./agentProviderUpdateProgress";
import { settleAgentProviderUpdate } from "./agentProviderUpdateSettlement";

export interface AgentProviderUpdateFlow {
  update(
    provider: AgentCliKind,
    offeredVersion: string,
  ): Promise<AgentProviderUpdateRefusal | null>;
  dismissUpdate(provider: AgentCliKind, version: string): Promise<boolean>;
}

export function createAgentProviderUpdateFlow(
  state: AgentProviderManagementState,
  health: AgentProviderHealthCoordinator,
  registration: AgentProviderRegistration,
  saveWithOutcome: AgentProviderSettingsSave,
): AgentProviderUpdateFlow {
  const save = async (intent: AgentProviderSettingsIntent): Promise<boolean> =>
    (await saveWithOutcome(intent)).kind === "persisted";

  const currentRefusal = (
    provider: AgentCliKind,
    executableAvailable: boolean,
  ): AgentProviderUpdateRefusal | null =>
    updateRefusal(
      provider,
      state.dependenciesRef.current.appSettingsRef.current,
      state.runtime[provider],
      executableAvailable,
      state.dependenciesRef.current.liveTurnCount(provider),
      state.dependenciesRef.current.signInActive(provider),
    );

  const offerRefusal = (
    provider: AgentCliKind,
    offeredVersion: string,
  ): AgentProviderUpdateRefusal | null => {
    const offeredHealth = state.runtime[provider].health;
    if (offeredHealth.kind !== "ready") return "noUpdateAvailable";
    if (offeredHealth.update.kind !== "available") return "noUpdateAvailable";
    if (offeredHealth.update.availableVersion !== offeredVersion) return "noUpdateAvailable";
    return currentRefusal(
      provider,
      effectiveAgentProviderCliPath(
        provider,
        state.authorities[provider]?.cliPath ?? null,
        state.discovery.read(),
      ) !== null,
    );
  };

  const failUncertain = (
    provider: AgentCliKind,
    operationId: string,
    offeredVersion: string,
    error: unknown,
  ): void => {
    const streamed = currentUpdateOutput(state.runtime[provider].updateState, operationId);
    delete state.updateOperations[provider];
    publishProvider(state, provider, (current) => ({
      ...current,
      configurationRevision: current.configurationRevision + 1,
      healthGeneration: current.healthGeneration + 1,
      updateState: failedUpdateState("uncertain", offeredVersion, streamed),
    }));
    health.scheduleHealth(provider);
    state.sink.setToast({ kind: "updateFailed", provider });
    state.dependenciesRef.current.reportError("Agent provider update", error);
  };

  const failReported = (
    provider: AgentCliKind,
    operationId: string,
    offeredVersion: string,
    result: Extract<AgentProviderUpdateResult, { readonly kind: "failed" }>,
  ): null => {
    const streamed = currentUpdateOutput(state.runtime[provider].updateState, operationId);
    const finalSummary = result.outputTail === "" ? "" : `${result.outputTail}\n`;
    const merged = mergedUpdateOutput(streamed, finalSummary, result.outputTruncated);
    delete state.updateOperations[provider];
    publishProvider(state, provider, (current) => ({
      ...current,
      configurationRevision: current.configurationRevision + 1,
      healthGeneration: current.healthGeneration + 1,
      updateState: failedUpdateState(result.reason, offeredVersion, merged),
    }));
    health.scheduleHealth(provider);
    state.sink.setToast({ kind: "updateFailed", provider });
    return null;
  };

  const execute = async (
    provider: AgentCliKind,
    offeredVersion: string,
    operationId: string,
    updateOwner: ProviderOwner,
  ): Promise<null> => {
    const operationIsCurrent = (): boolean =>
      state.updateOperations[provider] === operationId &&
      providerOwnerIsCurrent(state, updateOwner);
    const progress = createAgentProviderUpdateProgressSession(
      state,
      provider,
      operationId,
      updateOwner,
      operationIsCurrent,
    );
    try {
      const gateway = updateOwner.updateGateway;
      if (gateway.subscribeAgentProviderUpdateProgress === undefined) {
        progress.markUncertain(new Error("Agent provider update progress is unavailable."));
      } else {
        try {
          const subscriptionPromise = gateway.subscribeAgentProviderUpdateProgress(
            progress.onProgress,
            progress.markUncertain,
          );
          const subscription = await boundedProgressSubscription(subscriptionPromise);
          if (progress.accept(subscription, subscriptionPromise) === "abandoned") return null;
        } catch (error) {
          progress.markUncertain(error);
        }
      }
      if (!providerOwnerIsCurrent(state, updateOwner)) return null;
      publishProvider(state, provider, (current) => ({
        ...current,
        updateState: runningUpdateWith(current.updateState, operationId, "", false),
      }));
      const result = await gateway.updateAgentProvider({
        provider,
        providerGeneration: updateOwner.providerGeneration,
        operationId,
      });
      if (state.dependenciesRef.current.updateGateway !== gateway) return null;
      if (!providerOwnerIsCurrent(state, updateOwner)) return null;
      if (result.kind === "failed")
        return failReported(provider, operationId, offeredVersion, result);
      return await settleAgentProviderUpdate(
        { state, health, saveWithOutcome },
        provider,
        offeredVersion,
        operationId,
        result,
      );
    } catch (error) {
      if (!providerOwnerIsCurrent(state, updateOwner)) return null;
      failUncertain(provider, operationId, offeredVersion, error);
      return null;
    } finally {
      progress.close();
    }
  };

  const runUpdate = async (
    provider: AgentCliKind,
    offeredVersion: string,
  ): Promise<AgentProviderUpdateRefusal | null> => {
    if (state.runtime[provider].policy.kind !== "registered") {
      const outcome = await registration.registerBeforeUpdate(provider);
      if (outcome !== "registered") return outcome;
    }
    if (health.updateChecks.needsDiagnostics(provider)) {
      const diagnosticRefusal = currentRefusal(
        provider,
        currentProviderOwner(state, provider) !== null,
      );
      if (diagnosticRefusal !== null) return diagnosticRefusal;
      const checkOwner = currentProviderOwner(state, provider);
      if (checkOwner === null) return "policyUnavailable";
      const confirmed = await health.refreshHealth(provider);
      if (!providerOwnerIsCurrent(state, checkOwner)) return "statusUnknown";
      if (confirmed === null || !stillOffers(confirmed, offeredVersion)) return "noUpdateAvailable";
      health.updateChecks.confirmDiagnostics(provider);
    }
    const refusal = offerRefusal(provider, offeredVersion);
    if (refusal !== null) return refusal;
    const owner = currentProviderOwner(state, provider);
    if (owner === null) return "policyUnavailable";
    const operationId = state.dependenciesRef.current.mintOperationId(provider);
    state.updateOperations[provider] = operationId;
    clearProviderToast(state, provider);
    clearProviderTimer(state, provider);
    publishProvider(state, provider, (current) => ({
      ...current,
      configurationRevision: current.configurationRevision + 1,
      healthGeneration: current.healthGeneration + 1,
      updateState: { kind: "starting", operationId },
    }));
    const updateOwner = currentProviderOwner(state, provider);
    if (updateOwner === null) return "policyUnavailable";
    return execute(provider, offeredVersion, operationId, updateOwner);
  };

  const update = async (
    provider: AgentCliKind,
    offeredVersion: string,
  ): Promise<AgentProviderUpdateRefusal | null> => {
    if (state.updateInFlight[provider] === true) return "alreadyUpdating";
    state.updateInFlight[provider] = true;
    try {
      return await runUpdate(provider, offeredVersion);
    } finally {
      delete state.updateInFlight[provider];
    }
  };

  const dismissUpdate = async (provider: AgentCliKind, version: string): Promise<boolean> => {
    const providerHealth = state.runtime[provider].health;
    if (
      providerHealth.kind !== "ready" ||
      (providerHealth.update.kind !== "available" &&
        providerHealth.update.kind !== "manualUpdateAvailable")
    )
      return false;
    if (providerHealth.update.availableVersion !== version) return false;
    const dismissedToast = state.renderedToast;
    if (
      dismissedToast?.kind !== "updateAvailable" ||
      dismissedToast.provider !== provider ||
      dismissedToast.version !== version
    ) {
      return false;
    }
    const current = preferences(state.dependenciesRef.current.appSettingsRef.current)[provider];
    const succeeded = await save({
      provider,
      preference: { ...current, dismissedUpdateVersion: version },
    });
    if (succeeded) state.sink.setToast((latest) => (latest === dismissedToast ? null : latest));
    return succeeded;
  };

  return { update, dismissUpdate };
}
