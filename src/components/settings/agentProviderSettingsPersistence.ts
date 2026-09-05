import type { MutableRefObject } from "react";
import type { AgentProviderManagementSurface } from "../../application/useAgentProviderManagement";
import {
  defaultAgentProviderPreferences,
  normalizeAgentProviderHealthCheckIntervalSeconds,
  type AgentProviderPreference,
} from "../../domain/agentProviderSettings";
import { nextAgentModelFavoritesRevision, type AgentCliKind } from "../../domain/agentSettings";
import type { AppSettings } from "../../domain/settings";

export const AGENT_PROVIDERS: ReadonlyArray<AgentCliKind> = ["claudeCode", "codex"];

export interface AgentProviderDraftWriterPorts {
  readonly draftRef: MutableRefObject<AppSettings>;
  readonly management: AgentProviderManagementSurface | null;
  persistDraft(settings: AppSettings): void;
  publishDraft(settings: AppSettings): void;
}

export function agentProviderDraftWriter(
  ports: AgentProviderDraftWriterPorts,
): (next: AppSettings) => void {
  return (next) => {
    const previous = ports.draftRef.current;
    const management = ports.management;

    if (management === null) {
      ports.persistDraft(next);
      return;
    }

    const changed = changedAgentProviders(previous, next);

    if (changed.length === 0 && previous.agentCliKind === next.agentCliKind) {
      ports.persistDraft(next);
      return;
    }

    ports.publishDraft(next);

    const intents = changed.length === 0 ? [next.agentCliKind] : changed;

    for (const provider of intents) {
      persistProviderIntent(
        provider,
        previous,
        next,
        ports.draftRef,
        ports.publishDraft,
        management,
      );
    }
  };
}

export function persistProviderIntent(
  provider: AgentCliKind,
  previous: AppSettings,
  proposed: AppSettings,
  draftRef: MutableRefObject<AppSettings>,
  publish: (settings: AppSettings) => void,
  management: AgentProviderManagementSurface,
): void {
  const previousPreferences = providerPreferences(previous);
  const proposedPreferences = providerPreferences(proposed);
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

export function changedAgentProviders(
  previous: AppSettings,
  next: AppSettings,
): ReadonlyArray<AgentCliKind> {
  const previousPreferences = providerPreferences(previous);
  const nextPreferences = providerPreferences(next);

  return AGENT_PROVIDERS.filter(
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
  const currentPreferences = providerPreferences(current);
  const proposedPreferences = providerPreferences(proposed);

  if (current.agentCliPaths[provider] !== proposed.agentCliPaths[provider]) return;
  if (currentPreferences[provider] !== proposedPreferences[provider]) return;

  const previousPreferences = providerPreferences(previous);
  const next: AppSettings = {
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

export function withProviderPreference(
  settings: AppSettings,
  provider: AgentCliKind,
  change: (preference: AgentProviderPreference) => AgentProviderPreference,
): AppSettings {
  const preferences = providerPreferences(settings);

  return {
    ...settings,
    agentProviderPreferences: { ...preferences, [provider]: change(preferences[provider]) },
  };
}

export function withProviderPath(
  settings: AppSettings,
  provider: AgentCliKind,
  path: string | null,
): AppSettings {
  return { ...settings, agentCliPaths: { ...settings.agentCliPaths, [provider]: path } };
}

export function withProviderReset(settings: AppSettings, provider: AgentCliKind): AppSettings {
  const defaults = defaultAgentProviderPreferences()[provider];

  return withProviderPath(
    withProviderPreference(settings, provider, () => defaults),
    provider,
    null,
  );
}

export function withHealthCheckIntervalSeconds(
  settings: AppSettings,
  seconds: number,
): AppSettings {
  const healthCheckIntervalSeconds = normalizeAgentProviderHealthCheckIntervalSeconds(seconds);

  return AGENT_PROVIDERS.reduce(
    (current, provider) =>
      withProviderPreference(current, provider, (preference) => ({
        ...preference,
        healthCheckIntervalSeconds,
      })),
    settings,
  );
}

export function withProviderEnabled(
  settings: AppSettings,
  provider: AgentCliKind,
  enabled: boolean,
  configured: (candidate: AgentCliKind) => boolean,
): AppSettings {
  const next = withProviderPreference(settings, provider, (preference) => ({
    ...preference,
    enabled,
  }));

  if (enabled || settings.agentCliKind !== provider) return next;

  const fallback = otherProvider(provider);

  if (!providerPreferences(next)[fallback].enabled) return next;
  if (!configured(fallback)) return next;

  return { ...next, agentCliKind: fallback };
}

export function withClearedModelFavorites(settings: AppSettings): AppSettings | null {
  const revision = nextAgentModelFavoritesRevision(settings.agentModelFavoritesRevision);

  if (revision === null) return null;

  return { ...settings, agentModelFavoriteKeys: [], agentModelFavoritesRevision: revision };
}

function otherProvider(provider: AgentCliKind): AgentCliKind {
  switch (provider) {
    case "claudeCode":
      return "codex";
    case "codex":
      return "claudeCode";
    default:
      return provider satisfies never;
  }
}

function providerPreferences(settings: AppSettings) {
  return settings.agentProviderPreferences ?? defaultAgentProviderPreferences();
}
