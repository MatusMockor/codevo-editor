import type { AgentProviderHealthProbeResult } from "../../domain/agentProviderHealth";
import type { AgentCliKind } from "../../domain/agentTask";
import { effectiveAgentProviderCliPath } from "../agentProviderDiscoveryAdmission";
import { providerFields, type PersistedProviderSlice } from "../agentProviderSettingsIntent";
import type { AgentCliDiscoveryPublication } from "../useAgentCliDiscovery";
import type {
  AgentProviderManagementDependencies,
  AgentProviderManagementToast,
  SelectedAgentProviderAuthorityPublication,
} from "./agentProviderManagementContract";
import {
  initialRuntime,
  sameProviderOwner,
  type ProviderAuthorities,
  type ProviderOwner,
  type ProviderRuntime,
  type ProviderRuntimeRecord,
} from "./agentProviderRuntime";

export type ToastUpdate =
  | AgentProviderManagementToast
  | null
  | ((current: AgentProviderManagementToast | null) => AgentProviderManagementToast | null);

export interface AgentProviderManagementViewSink {
  setRuntime(next: ProviderRuntimeRecord): void;
  setToast(update: ToastUpdate): void;
  setSelectedProviderAuthorityPublication(
    publication: SelectedAgentProviderAuthorityPublication | null,
  ): void;
}

export interface AgentCliDiscoveryPort {
  read(): AgentCliDiscoveryPublication | null;
  refresh(): Promise<AgentCliDiscoveryPublication | null>;
  currentGeneration(): number;
}

export interface AppliedDiscovery {
  readonly generation: number;
  readonly status: "discovering" | "ready" | "failed";
}

export interface InFlightHealth {
  readonly generation: number;
  readonly promise: Promise<AgentProviderHealthProbeResult | null>;
}

export interface UpdateProgressRegistration {
  readonly operationId: string;
  readonly unlisten: () => void;
}

export interface AgentProviderManagementState {
  readonly sink: AgentProviderManagementViewSink;
  readonly dependenciesRef: { current: AgentProviderManagementDependencies };
  discovery: AgentCliDiscoveryPort;
  runtime: ProviderRuntimeRecord;
  renderedToast: AgentProviderManagementToast | null;
  authorities: ProviderAuthorities;
  mounted: boolean;
  hydrationGeneration: number;
  hydrationReady: boolean;
  hydrationSettled: boolean;
  settingsRevision: number;
  readonly persistedSliceRef: { current: PersistedProviderSlice };
  readonly cliPathRevisionRef: { current: Record<AgentCliKind, number> };
  readonly preferenceRevisionRef: { current: Record<AgentCliKind, number> };
  readonly selectedRevisionRef: { current: number };
  updateOperations: Partial<Record<AgentCliKind, string>>;
  updateInFlight: Partial<Record<AgentCliKind, true>>;
  updateProgressUnlisten: Partial<Record<AgentCliKind, UpdateProgressRegistration>>;
  queue: Promise<void>;
  inFlightHealth: Partial<Record<AgentCliKind, InFlightHealth>>;
  readonly timers: Partial<Record<AgentCliKind, ReturnType<typeof setTimeout>>>;
  appliedDiscovery: AppliedDiscovery | null;
}

export function createAgentProviderManagementState(
  dependencies: AgentProviderManagementDependencies,
  discovery: AgentCliDiscoveryPort,
  sink: AgentProviderManagementViewSink,
): AgentProviderManagementState {
  return {
    sink,
    dependenciesRef: { current: dependencies },
    discovery,
    runtime: initialRuntime(),
    renderedToast: null,
    authorities: {},
    mounted: true,
    hydrationGeneration: 0,
    hydrationReady: false,
    hydrationSettled: false,
    settingsRevision: 1,
    persistedSliceRef: {
      current: {
        fields: {
          claudeCode: providerFields(dependencies.appSettingsRef.current, "claudeCode"),
          codex: providerFields(dependencies.appSettingsRef.current, "codex"),
        },
        selectedProvider: dependencies.appSettingsRef.current.agentCliKind,
        selectedSettingsRevision: 1,
      },
    },
    cliPathRevisionRef: { current: { claudeCode: 0, codex: 0 } },
    preferenceRevisionRef: { current: { claudeCode: 0, codex: 0 } },
    selectedRevisionRef: { current: 0 },
    updateOperations: {},
    updateInFlight: {},
    updateProgressUnlisten: {},
    queue: Promise.resolve(),
    inFlightHealth: {},
    timers: {},
    appliedDiscovery: null,
  };
}

export function publishProvider(
  state: AgentProviderManagementState,
  provider: AgentCliKind,
  transform: (current: ProviderRuntime) => ProviderRuntime,
): void {
  if (!state.mounted) return;
  const current = state.runtime;
  const nextProvider = transform(current[provider]);
  if (nextProvider === current[provider]) return;
  const next = { ...current, [provider]: nextProvider };
  state.runtime = next;
  state.sink.setRuntime(next);
}

export function replaceRuntime(
  state: AgentProviderManagementState,
  next: ProviderRuntimeRecord,
): void {
  state.runtime = next;
  state.sink.setRuntime(next);
}

export function clearProviderTimer(
  state: AgentProviderManagementState,
  provider: AgentCliKind,
): void {
  const timer = state.timers[provider];
  if (timer === undefined) return;
  clearTimeout(timer);
  delete state.timers[provider];
}

export function clearProviderToast(
  state: AgentProviderManagementState,
  provider: AgentCliKind,
): void {
  state.sink.setToast((current) => (current?.provider === provider ? null : current));
}

export function currentProviderOwner(
  state: AgentProviderManagementState,
  provider: AgentCliKind,
): ProviderOwner | null {
  if (!state.mounted) return null;
  const providerRuntime = state.runtime[provider];
  if (providerRuntime.policy.kind !== "registered") return null;
  const authority = state.authorities[provider];
  if (authority === undefined || !authority.preference.enabled) return null;
  const discovery = state.discovery.read();
  const cliPath = effectiveAgentProviderCliPath(provider, authority.cliPath, discovery);
  if (cliPath === null) return null;
  return {
    provider,
    configurationRevision: providerRuntime.configurationRevision,
    settingsRevision: providerRuntime.policy.settingsRevision,
    providerGeneration: providerRuntime.policy.providerGeneration,
    lifecycleGeneration: state.hydrationGeneration,
    cliPath,
    discoveryGeneration: authority.cliPath === null ? (discovery?.generation ?? null) : null,
    healthGateway: state.dependenciesRef.current.healthGateway,
    updateGateway: state.dependenciesRef.current.updateGateway,
  };
}

export function providerOwnerIsCurrent(
  state: AgentProviderManagementState,
  owner: ProviderOwner,
): boolean {
  if (!state.mounted) return false;
  const current = currentProviderOwner(state, owner.provider);
  if (current === null) return false;
  return sameProviderOwner(current, owner);
}
