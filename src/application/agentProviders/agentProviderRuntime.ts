import type {
  AgentProviderHealthGateway,
  AgentProviderHealthProbeResult,
  AgentProviderHealthState,
  AgentProviderPolicyGateway,
  AgentProviderPolicyRegistrationState,
  AgentProviderUpdateGateway,
  AgentProviderUpdateState,
} from "../../domain/agentProviderHealth";
import {
  parseCodexTransportSettings,
  type CodexTransportSettings,
  type PersistedAgentProviderSettingsAuthority,
} from "../../domain/agentProviderSettings";
import type { AgentCliKind } from "../../domain/agentTask";
import type { AppSettings } from "../../domain/settings";
import type {
  AgentProviderAdmissionAuthority,
  ReadyAgentProviderAdmissionAuthority,
} from "../agentProviderAdmissionAuthority";
import { effectiveAgentProviderCliPath } from "../agentProviderDiscoveryAdmission";
import {
  agentProviderPreferences as preferences,
  type ProviderFields,
} from "../agentProviderSettingsIntent";
import type { AgentCliDiscoveryPublication } from "../useAgentCliDiscovery";
import type {
  AgentProviderUpdateRefusal,
  SelectedAgentProviderAuthority,
  SelectedAgentProviderAuthorityPublication,
} from "./agentProviderManagementContract";

export const PROVIDERS: readonly AgentCliKind[] = ["claudeCode", "codex"];

export interface ProviderRuntime {
  readonly configurationRevision: number;
  readonly healthGeneration: number;
  readonly policy: AgentProviderPolicyRegistrationState;
  readonly health: AgentProviderHealthState;
  readonly updateState: AgentProviderUpdateState;
}

export type ProviderRuntimeRecord = Record<AgentCliKind, ProviderRuntime>;

export type ProviderAuthorities = Partial<
  Record<AgentCliKind, PersistedAgentProviderSettingsAuthority>
>;

export interface ProviderOwner {
  readonly provider: AgentCliKind;
  readonly configurationRevision: number;
  readonly settingsRevision: number;
  readonly providerGeneration: number;
  readonly lifecycleGeneration: number;
  readonly cliPath: string;
  readonly discoveryGeneration: number | null;
  readonly healthGateway: AgentProviderHealthGateway;
  readonly updateGateway: AgentProviderUpdateGateway;
}

export const initialRuntime = (): ProviderRuntimeRecord => ({
  claudeCode: {
    configurationRevision: 0,
    healthGeneration: 0,
    policy: { kind: "unregistered" },
    health: { kind: "notConfigured" },
    updateState: { kind: "idle" },
  },
  codex: {
    configurationRevision: 0,
    healthGeneration: 0,
    policy: { kind: "unregistered" },
    health: { kind: "notConfigured" },
    updateState: { kind: "idle" },
  },
});

export function sameProviderOwner(current: ProviderOwner, owner: ProviderOwner): boolean {
  return (
    current.configurationRevision === owner.configurationRevision &&
    current.settingsRevision === owner.settingsRevision &&
    current.providerGeneration === owner.providerGeneration &&
    current.lifecycleGeneration === owner.lifecycleGeneration &&
    current.cliPath === owner.cliPath &&
    current.discoveryGeneration === owner.discoveryGeneration &&
    current.healthGateway === owner.healthGateway &&
    current.updateGateway === owner.updateGateway
  );
}

export function updateSettlementDisagreement(
  health: AgentProviderHealthProbeResult | null,
  installedVersion: string,
): "uncertain" | "versionMismatch" | null {
  if (health === null) return "uncertain";
  if (health.installedVersion !== installedVersion) return "versionMismatch";
  return null;
}

export function stillOffers(
  health: AgentProviderHealthProbeResult | null,
  offeredVersion: string,
): boolean {
  if (health === null) return false;
  if (health.update.kind !== "available") return false;
  return health.update.availableVersion === offeredVersion;
}

export function currentSelectedProviderAuthority(
  publication: SelectedAgentProviderAuthorityPublication | null,
  settingsHydrated: boolean,
  policyGateway: AgentProviderPolicyGateway,
  healthGateway: AgentProviderHealthGateway,
  updateGateway: AgentProviderUpdateGateway,
): SelectedAgentProviderAuthority | null {
  if (publication === null) return null;
  if (!settingsHydrated) return null;
  if (publication.policyGateway !== policyGateway) return null;
  if (publication.healthGateway !== healthGateway) return null;
  if (publication.updateGateway !== updateGateway) return null;
  return { provider: publication.provider, settingsRevision: publication.settingsRevision };
}

export function registrationIsCurrent(
  current: ProviderRuntime,
  configurationRevision: number,
  settingsRevision: number,
): boolean {
  return (
    current.configurationRevision === configurationRevision &&
    current.policy.kind === "registering" &&
    current.policy.settingsRevision === settingsRevision
  );
}

export function policyMatches(
  policy: {
    readonly enabled: boolean;
    readonly cliPath: string | null;
    readonly checkForUpdates: boolean;
  } & CodexTransportSettings,
  fields: ProviderFields,
): boolean {
  return (
    policy.enabled === fields.preference.enabled &&
    policy.cliPath === fields.cliPath &&
    policy.checkForUpdates === fields.preference.checkForUpdates &&
    JSON.stringify(parseCodexTransportSettings(policy)) ===
      JSON.stringify(parseCodexTransportSettings(fields.preference))
  );
}

export function registeredRuntime(
  current: ProviderRuntime,
  configurationRevision: number,
  receipt: { readonly settingsRevision: number; readonly providerGeneration: number },
): ProviderRuntime {
  if (current.configurationRevision !== configurationRevision) return current;
  return {
    ...current,
    policy: {
      kind: "registered",
      settingsRevision: receipt.settingsRevision,
      providerGeneration: receipt.providerGeneration,
    },
  };
}

export function authorityFor(
  provider: AgentCliKind,
  authorities: ProviderAuthorities,
  runtime: ProviderRuntimeRecord,
): PersistedAgentProviderSettingsAuthority | null {
  const policy = runtime[provider].policy;
  if (policy.kind !== "registered") return null;
  const persisted = authorities[provider];
  if (persisted === undefined || persisted.settingsRevision !== policy.settingsRevision)
    return null;
  return persisted;
}

export function authority(
  provider: AgentCliKind,
  settingsRevision: number,
  fields: ProviderFields,
): PersistedAgentProviderSettingsAuthority {
  return {
    provider,
    settingsRevision,
    preference: fields.preference,
    cliPath: fields.cliPath,
  };
}

export function admissionAuthorityFor(
  provider: AgentCliKind,
  authorities: ProviderAuthorities,
  runtimeRecord: ProviderRuntimeRecord,
  discovery: AgentCliDiscoveryPublication | null,
): AgentProviderAdmissionAuthority {
  const runtime = runtimeRecord[provider];
  const persisted = authorities[provider];
  if (runtime.health.kind === "disabled") {
    return { provider, revision: runtime.configurationRevision, disposition: { kind: "disabled" } };
  }
  if (runtime.policy.kind === "failed") {
    return {
      provider,
      revision: runtime.configurationRevision,
      disposition: { kind: "policyUnavailable", reason: "registrationFailed" },
    };
  }
  if (runtime.policy.kind !== "registered" || persisted === undefined) {
    return {
      provider,
      revision: runtime.configurationRevision,
      disposition: { kind: "policyUnavailable", reason: "unregistered" },
    };
  }
  if (effectiveAgentProviderCliPath(provider, persisted.cliPath, discovery) === null) {
    return {
      provider,
      revision: runtime.configurationRevision,
      disposition: { kind: "policyUnavailable", reason: "notConfigured" },
    };
  }
  const automaticExecutableIsFresh =
    persisted.cliPath === null && discovery?.result[provider]?.kind === "detected";
  if (runtime.health.kind === "checking" && !automaticExecutableIsFresh) {
    return {
      provider,
      revision: runtime.configurationRevision,
      disposition: { kind: "initializing" },
    };
  }
  if (runtime.updateState.kind === "starting" || runtime.updateState.kind === "running") {
    return {
      provider,
      revision: runtime.configurationRevision,
      disposition: { kind: "updating" },
      providerGeneration: runtime.policy.providerGeneration,
    };
  }
  return {
    provider,
    revision: runtime.configurationRevision,
    disposition: { kind: "ready" },
    providerGeneration: runtime.policy.providerGeneration,
    ...(provider === "codex"
      ? { codexTransport: parseCodexTransportSettings(persisted.preference).codexTransport }
      : {}),
  };
}

export function isReadyAdmissionAuthority(
  authority: AgentProviderAdmissionAuthority,
): authority is ReadyAgentProviderAdmissionAuthority {
  if (authority.disposition.kind !== "ready") return false;
  return "providerGeneration" in authority;
}

export function updateRefusal(
  provider: AgentCliKind,
  settings: AppSettings,
  runtime: ProviderRuntime,
  executableAvailable: boolean,
  liveTurnCount: number,
  signInActive: boolean,
): AgentProviderUpdateRefusal | null {
  if (!preferences(settings)[provider].enabled) return "disabled";
  if (!executableAvailable) return "notConfigured";
  if (runtime.policy.kind !== "registered") return "policyUnavailable";
  if (runtime.updateState.kind === "starting" || runtime.updateState.kind === "running") {
    return "alreadyUpdating";
  }
  if (liveTurnCount > 0) return "turnActive";
  if (signInActive) return "signInActive";
  if (runtime.health.kind !== "ready" || runtime.health.update.kind !== "available") {
    return "noUpdateAvailable";
  }
  return null;
}

export function unsupportedDiscoveryStatus(status: never): never {
  throw new TypeError(`Unsupported agent CLI discovery status: ${String(status)}.`);
}

export function policyRegistrationFailureReason(
  error: unknown,
): "registrationFailed" | "revisionConflict" | "staleRevision" | "generationConflict" {
  if (error === "revisionConflict" || error === "staleRevision" || error === "generationConflict") {
    return error;
  }
  return "registrationFailed";
}
