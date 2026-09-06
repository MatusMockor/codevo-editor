import {
  defaultAgentProviderPreferences,
  type AgentProviderPreference,
} from "../domain/agentProviderSettings";
import { normalizeAgentCliPath } from "../domain/agentSettings";
import type { AgentCliKind } from "../domain/agentTask";
import type { AppSettings } from "../domain/settings";

export interface AgentProviderSettingsIntent {
  readonly provider: AgentCliKind;
  readonly preference?: AgentProviderPreference;
  readonly cliPath?: string | null;
  readonly selectedProvider?: AgentCliKind;
}

export interface ProviderFields {
  readonly preference: AgentProviderPreference;
  readonly cliPath: string | null;
}

export interface QueuedIntent extends AgentProviderSettingsIntent {
  readonly hydrationGeneration: number;
  readonly revision: number;
  readonly proposed: ProviderFields;
  readonly cliPathOwned: boolean;
  readonly preferenceOwned: boolean;
  readonly selectedOwned: boolean;
  readonly proposedSelected: AgentCliKind;
  readonly preservedUpdateOperationId: string | null;
}

export interface PersistedProviderSlice {
  readonly fields: Readonly<Record<AgentCliKind, ProviderFields>>;
  readonly selectedProvider: AgentCliKind;
  readonly selectedSettingsRevision: number;
}

export interface SettingsCell<T> {
  readonly current: T;
}

export interface AgentProviderSettingsSink {
  readonly appSettingsRef: { readonly current: AppSettings };
  readonly applyAppSettings: (settings: AppSettings) => void;
}

export function agentProviderPreferences(
  settings: AppSettings,
): Readonly<Record<AgentCliKind, AgentProviderPreference>> {
  return settings.agentProviderPreferences ?? defaultAgentProviderPreferences();
}

export function providerFields(settings: AppSettings, provider: AgentCliKind): ProviderFields {
  return {
    preference: agentProviderPreferences(settings)[provider],
    cliPath: settings.agentCliPaths[provider],
  };
}

export function proposedFields(
  previous: ProviderFields,
  intent: AgentProviderSettingsIntent,
): ProviderFields {
  if (intent.cliPath === undefined) {
    return { preference: intent.preference ?? previous.preference, cliPath: previous.cliPath };
  }
  const cliPath = intent.cliPath === null ? null : normalizeAgentCliPath(intent.cliPath);
  if (intent.cliPath !== null && cliPath === null) throw new TypeError("Invalid agent CLI path.");
  return { preference: intent.preference ?? previous.preference, cliPath };
}

export function applyIntent(settings: AppSettings, intent: QueuedIntent): AppSettings {
  return {
    ...settings,
    agentCliKind: intent.selectedOwned ? intent.proposedSelected : settings.agentCliKind,
    agentCliPaths: intent.cliPathOwned
      ? { ...settings.agentCliPaths, [intent.provider]: intent.proposed.cliPath }
      : settings.agentCliPaths,
    agentProviderPreferences: intent.preferenceOwned
      ? {
          ...agentProviderPreferences(settings),
          [intent.provider]: intent.proposed.preference,
        }
      : agentProviderPreferences(settings),
  };
}

export function persistedCandidate(
  settings: AppSettings,
  persisted: PersistedProviderSlice,
  intent: QueuedIntent,
): AppSettings {
  const restored: AppSettings = {
    ...settings,
    agentCliKind: persisted.selectedProvider,
    agentCliPaths: {
      claudeCode: persisted.fields.claudeCode.cliPath,
      codex: persisted.fields.codex.cliPath,
    },
    agentProviderPreferences: {
      claudeCode: persisted.fields.claudeCode.preference,
      codex: persisted.fields.codex.preference,
    },
  };
  return applyIntent(restored, intent);
}

export function commitPersistedIntent(
  persisted: PersistedProviderSlice,
  intent: QueuedIntent,
): PersistedProviderSlice {
  const previous = persisted.fields[intent.provider];
  return {
    fields: {
      ...persisted.fields,
      [intent.provider]: {
        cliPath: intent.cliPathOwned ? intent.proposed.cliPath : previous.cliPath,
        preference: intent.preferenceOwned ? intent.proposed.preference : previous.preference,
      },
    },
    selectedProvider: intent.selectedOwned ? intent.proposedSelected : persisted.selectedProvider,
    selectedSettingsRevision: intent.selectedOwned
      ? intent.revision
      : persisted.selectedSettingsRevision,
  };
}

export function rollbackIntent(
  intent: QueuedIntent,
  persistedSliceRef: SettingsCell<PersistedProviderSlice>,
  sinkRef: SettingsCell<AgentProviderSettingsSink>,
  cliPathRevisionRef: SettingsCell<Record<AgentCliKind, number>>,
  preferenceRevisionRef: SettingsCell<Record<AgentCliKind, number>>,
  selectedRevisionRef: SettingsCell<number>,
): void {
  const current = sinkRef.current.appSettingsRef.current;
  const rollbackCliPath =
    intent.cliPathOwned && cliPathRevisionRef.current[intent.provider] === intent.revision;
  const rollbackPreference =
    intent.preferenceOwned && preferenceRevisionRef.current[intent.provider] === intent.revision;
  const rollbackSelected = intent.selectedOwned && selectedRevisionRef.current === intent.revision;
  if (!rollbackCliPath && !rollbackPreference && !rollbackSelected) return;
  const persisted = persistedSliceRef.current;
  sinkRef.current.applyAppSettings({
    ...current,
    agentCliKind: rollbackSelected ? persisted.selectedProvider : current.agentCliKind,
    agentCliPaths: rollbackCliPath
      ? { ...current.agentCliPaths, [intent.provider]: persisted.fields[intent.provider].cliPath }
      : current.agentCliPaths,
    agentProviderPreferences: rollbackPreference
      ? {
          ...agentProviderPreferences(current),
          [intent.provider]: persisted.fields[intent.provider].preference,
        }
      : agentProviderPreferences(current),
  });
}
