import {
  applyIntent,
  commitPersistedIntent,
  persistedCandidate,
  proposedFields,
  providerFields,
  rollbackIntent,
  type AgentProviderSettingsIntent,
  type QueuedIntent,
} from "../agentProviderSettingsIntent";
import { appSettingsSaveCoordinatorFor } from "../appSettingsSaveCoordinator";
import type { AgentProviderSettingsSaveOutcome } from "./agentProviderManagementContract";
import type { AgentProviderManagementState } from "./agentProviderManagementState";
import type { AgentProviderRegistration } from "./agentProviderRegistration";

export type AgentProviderSettingsSave = (
  intent: AgentProviderSettingsIntent,
  preservedUpdateOperationId?: string | null,
) => Promise<AgentProviderSettingsSaveOutcome>;

export function createAgentProviderSettingsSave(
  state: AgentProviderManagementState,
  registration: AgentProviderRegistration,
): AgentProviderSettingsSave {
  const rollback = (queued: QueuedIntent): void =>
    rollbackIntent(
      queued,
      state.persistedSliceRef,
      state.dependenciesRef,
      state.cliPathRevisionRef,
      state.preferenceRevisionRef,
      state.selectedRevisionRef,
    );

  return (intent, preservedUpdateOperationId = null) => {
    if (!state.hydrationReady || !state.dependenciesRef.current.settingsHydrated) {
      return Promise.resolve({ kind: "rejected", reason: "notHydrated" });
    }
    const settings = state.dependenciesRef.current.appSettingsRef.current;
    const previous = providerFields(settings, intent.provider);
    const proposed = proposedFields(previous, intent);
    const proposedSelected = intent.selectedProvider ?? settings.agentCliKind;
    state.settingsRevision += 1;
    const queued: QueuedIntent = {
      ...intent,
      hydrationGeneration: state.hydrationGeneration,
      revision: state.settingsRevision,
      proposed,
      cliPathOwned: intent.cliPath !== undefined,
      preferenceOwned: intent.preference !== undefined,
      selectedOwned: intent.selectedProvider !== undefined,
      proposedSelected,
      preservedUpdateOperationId,
    };
    if (queued.cliPathOwned) state.cliPathRevisionRef.current[intent.provider] = queued.revision;
    if (queued.preferenceOwned) {
      state.preferenceRevisionRef.current[intent.provider] = queued.revision;
    }
    if (queued.selectedOwned) state.selectedRevisionRef.current = queued.revision;
    appSettingsSaveCoordinatorFor(
      state.dependenciesRef.current.settingsGateway,
    ).initializeCommittedSnapshot(settings);
    state.dependenciesRef.current.applyAppSettings(applyIntent(settings, queued));
    let resolveResult: (value: AgentProviderSettingsSaveOutcome) => void = () => undefined;
    const result = new Promise<AgentProviderSettingsSaveOutcome>((resolve) => {
      resolveResult = resolve;
    });
    state.queue = state.queue.then(async () => {
      if (
        !state.mounted ||
        !state.hydrationReady ||
        state.hydrationGeneration !== queued.hydrationGeneration
      ) {
        rollback(queued);
        resolveResult({ kind: "rejected", reason: "staleAuthority" });
        return;
      }
      const settingsGateway = state.dependenciesRef.current.settingsGateway;
      try {
        await appSettingsSaveCoordinatorFor(settingsGateway).save(settings, (committed) =>
          persistedCandidate(committed, state.persistedSliceRef.current, queued),
        );
        if (!state.mounted) {
          resolveResult({ kind: "rejected", reason: "staleAuthority" });
          return;
        }
        if (
          !state.hydrationReady ||
          state.hydrationGeneration !== queued.hydrationGeneration ||
          state.dependenciesRef.current.settingsGateway !== settingsGateway
        ) {
          rollback(queued);
          resolveResult({ kind: "rejected", reason: "staleAuthority" });
          return;
        }
        state.persistedSliceRef.current = commitPersistedIntent(
          state.persistedSliceRef.current,
          queued,
        );
        const persistedFields = state.persistedSliceRef.current.fields[queued.provider];
        const registered = await registration.register(
          queued.provider,
          queued.revision,
          persistedFields,
          queued.preservedUpdateOperationId,
        );
        if (registered && queued.selectedOwned) {
          await registration.establishSelectedProviderAuthority(
            state.persistedSliceRef.current.selectedProvider,
            state.persistedSliceRef.current.selectedSettingsRevision,
            queued.hydrationGeneration,
          );
        }
        resolveResult({ kind: "persisted", policyRegistered: registered });
      } catch (error) {
        if (state.mounted) rollback(queued);
        if (!state.mounted || state.dependenciesRef.current.settingsGateway !== settingsGateway) {
          resolveResult({ kind: "rejected", reason: "staleAuthority" });
          return;
        }
        state.dependenciesRef.current.reportError("Agent provider settings", error);
        resolveResult({ kind: "rejected", reason: "persistenceFailed" });
      }
    });
    return result;
  };
}
