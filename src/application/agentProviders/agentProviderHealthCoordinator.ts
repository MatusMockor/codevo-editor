import type { AgentProviderHealthProbeResult } from "../../domain/agentProviderHealth";
import type { AgentCliKind } from "../../domain/agentTask";
import {
  agentProviderHealthForAutomaticDiscovery,
  agentProviderHealthWithPersistedUpdateAuthority,
} from "../agentProviderDiscoveryAdmission";
import { createAgentProviderUpdateChecks } from "../agentProviderUpdateChecks";
import { updateOfferToast, withoutSatisfiedUpdateOffer } from "../agentProviderUpdateOffer";
import {
  clearProviderTimer,
  currentProviderOwner,
  providerOwnerIsCurrent,
  publishProvider,
  type AgentProviderManagementState,
} from "./agentProviderManagementState";
import { PROVIDERS } from "./agentProviderRuntime";

export type AgentProviderUpdateChecks = ReturnType<typeof createAgentProviderUpdateChecks>;

export interface AgentProviderHealthCoordinator {
  readonly updateChecks: AgentProviderUpdateChecks;
  refreshHealth(provider: AgentCliKind): Promise<AgentProviderHealthProbeResult | null>;
  scheduleHealth(provider: AgentCliKind): void;
  applyDiscoveryGeneration(status: "discovering" | "ready" | "failed", generation: number): void;
}

export function createAgentProviderHealthCoordinator(
  state: AgentProviderManagementState,
): AgentProviderHealthCoordinator {
  const refreshHealth = (
    provider: AgentCliKind,
  ): Promise<AgentProviderHealthProbeResult | null> => {
    const owner = currentProviderOwner(state, provider);
    if (owner === null) return Promise.resolve(null);
    const existing = state.inFlightHealth[provider];
    if (
      existing !== undefined &&
      existing.generation === state.runtime[provider].healthGeneration
    ) {
      return existing.promise;
    }
    const healthGeneration = state.runtime[provider].healthGeneration + 1;
    publishProvider(state, provider, (current) => ({
      ...current,
      healthGeneration,
      health: { kind: "checking", generation: healthGeneration },
    }));
    const gateway = state.dependenciesRef.current.healthGateway;
    const promise = (async (): Promise<AgentProviderHealthProbeResult | null> => {
      try {
        const result = await gateway.probeAgentProviderHealth({
          provider,
          providerGeneration: owner.providerGeneration,
        });
        if (!providerOwnerIsCurrent(state, owner)) return null;
        if (state.runtime[provider].healthGeneration !== healthGeneration) return null;
        const checked = agentProviderHealthWithPersistedUpdateAuthority(
          result,
          state.authorities[provider]?.preference,
        );
        publishProvider(state, provider, (current) => ({
          ...current,
          health: { kind: "ready", ...checked },
        }));
        state.sink.setToast((current) =>
          withoutSatisfiedUpdateOffer(current, provider, checked.installedVersion, (other) => {
            const health = state.runtime[other].health;
            if (health.kind !== "ready") return null;
            const dismissed = state.authorities[other]?.preference.dismissedUpdateVersion;
            return updateOfferToast(other, health.update, dismissed);
          }),
        );
        if (!providerOwnerIsCurrent(state, owner)) return null;
        const preference = state.authorities[provider]?.preference;
        const offer = updateOfferToast(
          provider,
          checked.update,
          preference?.dismissedUpdateVersion,
        );
        if (offer === null) return checked;
        if (preference === undefined) return null;
        state.sink.setToast(offer);
        return checked;
      } catch (error) {
        if (!providerOwnerIsCurrent(state, owner)) return null;
        if (state.runtime[provider].healthGeneration !== healthGeneration) return null;
        publishProvider(state, provider, (current) => ({
          ...current,
          health: { kind: "failed", reason: "probeFailed", checkedAtEpochMs: null },
        }));
        state.dependenciesRef.current.reportError("Agent provider health", error);
        return null;
      } finally {
        const inFlight = state.inFlightHealth[provider];
        if (inFlight?.generation === healthGeneration) delete state.inFlightHealth[provider];
      }
    })();
    state.inFlightHealth[provider] = { generation: healthGeneration, promise };
    return promise;
  };

  const updateChecks = createAgentProviderUpdateChecks({
    capture: (provider) => {
      const owner = currentProviderOwner(state, provider);
      const current = state.runtime[provider];
      if (
        owner === null ||
        current.health.kind !== "ready" ||
        current.health.installedVersion === null
      )
        return null;
      if (!state.authorities[provider]?.preference.checkForUpdates) return null;
      if (current.updateState.kind === "starting" || current.updateState.kind === "running")
        return null;
      const generation = current.healthGeneration;
      return {
        request: { provider, providerGeneration: owner.providerGeneration },
        installedVersion: current.health.installedVersion,
        gateway: owner.healthGateway,
        current: () =>
          providerOwnerIsCurrent(state, owner) &&
          state.runtime[provider].healthGeneration === generation,
        publish: (update) => {
          publishProvider(state, provider, (latest) => {
            if (latest.health.kind !== "ready") return latest;
            const health = agentProviderHealthWithPersistedUpdateAuthority(
              { ...latest.health, update },
              state.authorities[provider]?.preference,
            );
            return { ...latest, health: { kind: "ready", ...health } };
          });
          const checked = state.runtime[provider].health;
          if (checked.kind !== "ready") return;
          const offer = updateOfferToast(
            provider,
            checked.update,
            state.authorities[provider]?.preference.dismissedUpdateVersion,
          );
          if (offer !== null) state.sink.setToast(offer);
        },
        executableChanged: () => {
          void refreshHealth(provider);
        },
        reportError: (error) =>
          state.dependenciesRef.current.reportError("Agent provider update check", error),
      };
    },
  });

  const scheduleHealth = (provider: AgentCliKind): void => {
    clearProviderTimer(state, provider);
    const owner = currentProviderOwner(state, provider);
    if (owner === null) return;
    const interval = state.authorities[provider]?.preference.healthCheckIntervalSeconds ?? 0;
    if (interval === 0) return;
    state.timers[provider] = setTimeout(() => {
      if (!providerOwnerIsCurrent(state, owner)) return;
      void updateChecks.check(provider).finally(() => {
        if (!providerOwnerIsCurrent(state, owner)) return;
        scheduleHealth(provider);
      });
    }, interval * 1_000);
  };

  const applyDiscoveryGeneration = (
    status: "discovering" | "ready" | "failed",
    generation: number,
  ): void => {
    const applied = state.appliedDiscovery;
    if (applied?.generation === generation && applied.status === status) return;
    if (applied !== null && generation < applied.generation) return;
    state.appliedDiscovery = { generation, status };
    const discovery = state.discovery.read();
    for (const provider of PROVIDERS) {
      const fields =
        state.authorities[provider] ?? state.persistedSliceRef.current.fields[provider];
      if (fields.cliPath !== null) continue;
      clearProviderTimer(state, provider);
      publishProvider(state, provider, (current) => ({
        ...current,
        configurationRevision:
          current.policy.kind === "registered" || current.policy.kind === "failed"
            ? current.configurationRevision + 1
            : current.configurationRevision,
        healthGeneration: current.healthGeneration + 1,
        health: agentProviderHealthForAutomaticDiscovery(
          fields.preference,
          status,
          generation,
          discovery?.result[provider],
        ),
      }));
      if (status !== "ready" || discovery?.result[provider].kind !== "detected") continue;
      const owner = currentProviderOwner(state, provider);
      if (owner === null) continue;
      void refreshHealth(provider).finally(() => {
        if (!providerOwnerIsCurrent(state, owner)) return;
        scheduleHealth(provider);
      });
    }
  };

  return { updateChecks, refreshHealth, scheduleHealth, applyDiscoveryGeneration };
}
