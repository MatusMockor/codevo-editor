import type { MutableRefObject } from "react";
import type { AgentProviderManagementSurface } from "../application/useAgentProviderManagement";
import { defaultAgentProviderPreferences } from "../domain/agentProviderSettings";
import type { AgentCliKind } from "../domain/agentTask";
import type { AppSettings, WorkspaceSettings } from "../domain/settings";
import { AgentsSettingsPanel } from "./AgentsSettingsPanel";

interface AgentSettingsDialogSectionProps {
  readonly appSettings: AppSettings;
  readonly appSettingsRef: MutableRefObject<AppSettings>;
  readonly hasWorkspace: boolean;
  readonly providerManagement: AgentProviderManagementSurface | null;
  readonly workspaceSettings: WorkspaceSettings;
  onPersistAppSettings(settings: AppSettings): void;
  onPublishAppSettings(settings: AppSettings): void;
  onUpdateWorkspaceSettings(settings: WorkspaceSettings): void;
}

export function AgentSettingsDialogSection({
  appSettings,
  appSettingsRef,
  hasWorkspace,
  onPersistAppSettings,
  onPublishAppSettings,
  onUpdateWorkspaceSettings,
  providerManagement,
  workspaceSettings,
}: AgentSettingsDialogSectionProps) {
  const updateAgentAppSettings = (nextSettings: AppSettings): void => {
    const previousSettings = appSettingsRef.current;
    onPublishAppSettings(nextSettings);
    if (providerManagement === null) {
      onPersistAppSettings(nextSettings);
      return;
    }
    const changedProviders = changedAgentProviders(previousSettings, nextSettings);
    if (
      changedProviders.length === 0 &&
      previousSettings.agentCliKind === nextSettings.agentCliKind
    ) {
      onPersistAppSettings(nextSettings);
      return;
    }
    const intentProviders =
      changedProviders.length === 0 ? [nextSettings.agentCliKind] : changedProviders;
    for (const provider of intentProviders) {
      persistProviderIntent(
        provider,
        previousSettings,
        nextSettings,
        appSettingsRef,
        onPublishAppSettings,
        providerManagement,
      );
    }
  };

  return (
    <AgentsSettingsPanel
      appSettings={appSettings}
      hasWorkspace={hasWorkspace}
      providerManagement={providerManagement ?? unavailableProviderManagement}
      updateAppSettings={updateAgentAppSettings}
      updateWorkspaceSettings={onUpdateWorkspaceSettings}
      workspaceSettings={workspaceSettings}
    />
  );
}

function persistProviderIntent(
  provider: AgentCliKind,
  previous: AppSettings,
  proposed: AppSettings,
  draftRef: MutableRefObject<AppSettings>,
  publish: (settings: AppSettings) => void,
  management: AgentProviderManagementSurface,
): void {
  const previousPreferences =
    previous.agentProviderPreferences ?? defaultAgentProviderPreferences();
  const proposedPreferences =
    proposed.agentProviderPreferences ?? defaultAgentProviderPreferences();
  const preferenceChanged = previousPreferences[provider] !== proposedPreferences[provider];
  const cliPathChanged = previous.agentCliPaths[provider] !== proposed.agentCliPaths[provider];
  const selectedProvider =
    previous.agentCliKind === proposed.agentCliKind
      ? {}
      : { selectedProvider: proposed.agentCliKind };
  void management
    .saveWithOutcome({
      provider,
      ...selectedProvider,
      ...(preferenceChanged ? { preference: proposedPreferences[provider] } : {}),
      ...(cliPathChanged ? { cliPath: proposed.agentCliPaths[provider] } : {}),
    })
    .then((outcome) => {
      switch (outcome.kind) {
        case "persisted":
          return;
        case "rejected":
          rollbackProviderDraft(provider, previous, proposed, draftRef, publish);
          return;
        default:
          outcome satisfies never;
      }
    });
}

function changedAgentProviders(
  previous: AppSettings,
  next: AppSettings,
): ReadonlyArray<AgentCliKind> {
  const previousPreferences =
    previous.agentProviderPreferences ?? defaultAgentProviderPreferences();
  const nextPreferences = next.agentProviderPreferences ?? defaultAgentProviderPreferences();
  return (["claudeCode", "codex"] as const).filter(
    (provider) =>
      previous.agentCliPaths[provider] !== next.agentCliPaths[provider] ||
      previousPreferences[provider] !== nextPreferences[provider],
  );
}

function rollbackProviderDraft(
  provider: AgentCliKind,
  previous: AppSettings,
  proposed: AppSettings,
  draftRef: MutableRefObject<AppSettings>,
  publish: (settings: AppSettings) => void,
): void {
  const current = draftRef.current;
  const currentPreferences = current.agentProviderPreferences ?? defaultAgentProviderPreferences();
  const proposedPreferences =
    proposed.agentProviderPreferences ?? defaultAgentProviderPreferences();
  if (current.agentCliPaths[provider] !== proposed.agentCliPaths[provider]) return;
  if (currentPreferences[provider] !== proposedPreferences[provider]) return;
  const previousPreferences =
    previous.agentProviderPreferences ?? defaultAgentProviderPreferences();
  const next = {
    ...current,
    agentCliKind:
      current.agentCliKind === proposed.agentCliKind ? previous.agentCliKind : current.agentCliKind,
    agentCliPaths: { ...current.agentCliPaths, [provider]: previous.agentCliPaths[provider] },
    agentProviderPreferences: {
      ...currentPreferences,
      [provider]: previousPreferences[provider],
    },
  };
  draftRef.current = next;
  publish(next);
}

const unavailableProviderManagement: AgentProviderManagementSurface = {
  providers: {
    claudeCode: {
      health: { kind: "notConfigured" },
      policy: { kind: "unregistered" },
      updateState: { kind: "idle" },
      liveTurnCount: 0,
    },
    codex: {
      health: { kind: "notConfigured" },
      policy: { kind: "unregistered" },
      updateState: { kind: "idle" },
      liveTurnCount: 0,
    },
  },
  toast: null,
  admissionAuthority: (provider) => ({
    provider,
    revision: 0,
    disposition: { kind: "policyUnavailable", reason: "unregistered" },
  }),
  authority: () => null,
  dismissToast: () => undefined,
  dismissUpdate: async () => false,
  refresh: async () => undefined,
  retryRegistration: async () => undefined,
  save: async () => false,
  saveWithOutcome: async () => ({ kind: "rejected", reason: "notHydrated" }),
  update: async () => "policyUnavailable",
};
