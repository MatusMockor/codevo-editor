import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import {
  type AgentProviderHealthGateway,
  type AgentProviderHealthProbeResult,
  type AgentProviderHealthState,
  type AgentProviderPolicyGateway,
  type AgentProviderPolicyRegistrationState,
  type AgentProviderUpdateGateway,
  type AgentProviderUpdateProgressEvent,
  type AgentProviderUpdateState,
} from "../domain/agentProviderHealth";
import type { PersistedAgentProviderSettingsAuthority } from "../domain/agentProviderSettings";
import {
  agentCliExecutablePresentation,
  type AgentCliDiscoveryGateway,
  type AgentCliDiscoveryResult,
  type AgentCliExecutablePresentation,
} from "../domain/agentSettings";
import type { AgentCliKind } from "../domain/agentTask";
import type { AppSettings, SettingsGateway } from "../domain/settings";
import {
  agentProviderPreferences as preferences,
  applyIntent,
  commitPersistedIntent,
  persistedCandidate,
  proposedFields,
  providerFields,
  rollbackIntent,
  type AgentProviderSettingsIntent,
  type PersistedProviderSlice,
  type ProviderFields,
  type QueuedIntent,
} from "./agentProviderSettingsIntent";
import { appSettingsSaveCoordinatorFor } from "./appSettingsSaveCoordinator";
import type {
  AgentProviderAdmissionAuthority,
  ReadyAgentProviderAdmissionAuthority,
} from "./agentProviderAdmissionAuthority";
import {
  agentProviderHealthBeforeRegistration,
  agentProviderHealthForAutomaticDiscovery,
  agentProviderHealthWithPersistedUpdateAuthority,
  effectiveAgentProviderCliPath,
} from "./agentProviderDiscoveryAdmission";
import {
  AGENT_PROVIDER_UPDATE_HEALTH_SETTLE_TIMEOUT_MS,
  AGENT_PROVIDER_UPDATE_REGISTRATION_TIMEOUT_MS,
  alreadyCurrentUpdateState,
  boundedProgressSubscription,
  boundedSettlement,
  currentUpdateOutput,
  failedUpdateState,
  idempotentUnlisten,
  mergedUpdateOutput,
  runningUpdateWith,
  updateStateBeforeRegistration,
} from "./agentProviderUpdateRun";
import { useAgentCliDiscovery, type AgentCliDiscoveryPublication } from "./useAgentCliDiscovery";

import { createAgentProviderUpdateChecks } from "./agentProviderUpdateChecks";
import { refreshAgentProviderBatch } from "./agentProviderRefresh";

const PROVIDERS: readonly AgentCliKind[] = ["claudeCode", "codex"];

export type AgentProviderManagementToast =
  | {
      readonly kind: "updateAvailable";
      readonly provider: AgentCliKind;
      readonly version: string;
      readonly manual?: true;
    }
  | {
      readonly kind: "updateSucceeded";
      readonly provider: AgentCliKind;
      readonly version: string;
    }
  | {
      readonly kind: "updateAlreadyCurrent";
      readonly provider: AgentCliKind;
      readonly version: string;
    }
  | { readonly kind: "updateFailed"; readonly provider: AgentCliKind };

export type AgentProviderUpdateRefusal =
  | "disabled"
  | "notConfigured"
  | "policyUnavailable"
  | "statusUnknown"
  | "noUpdateAvailable"
  | "turnActive"
  | "signInActive"
  | "alreadyUpdating";

type AgentProviderUpdateRegistrationOutcome = "registered" | "policyUnavailable" | "statusUnknown";

export type AgentProviderSettingsSaveOutcome =
  | { readonly kind: "persisted"; readonly policyRegistered: boolean }
  | {
      readonly kind: "rejected";
      readonly reason: "notHydrated" | "staleAuthority" | "persistenceFailed";
    };

export type AgentProviderRefreshOutcome =
  | { readonly kind: "complete"; readonly authority: ReadyAgentProviderAdmissionAuthority }
  | { readonly kind: "failed" }
  | { readonly kind: "stale" };

export interface AgentProviderManagementView {
  readonly executable: AgentCliExecutablePresentation;
  readonly health: AgentProviderHealthState;
  readonly policy: AgentProviderPolicyRegistrationState;
  readonly updateState: AgentProviderUpdateState;
  readonly liveTurnCount: number;
  readonly signInActive?: boolean;
}

export type { AgentProviderSettingsIntent } from "./agentProviderSettingsIntent";

export interface AgentProviderManagementSurface {
  readonly cliDiscovery: AgentCliDiscoveryResult;
  readonly providers: Readonly<Record<AgentCliKind, AgentProviderManagementView>>;
  readonly selectedProviderAuthority: SelectedAgentProviderAuthority | null;
  readonly toast: AgentProviderManagementToast | null;
  admissionAuthority(provider: AgentCliKind): AgentProviderAdmissionAuthority;
  authority(provider: AgentCliKind): PersistedAgentProviderSettingsAuthority | null;
  dismissToast(): void;
  dismissUpdate(provider: AgentCliKind, version: string): Promise<boolean>;
  refresh(provider: AgentCliKind): Promise<void>;
  refreshAll(): Promise<void>;
  refreshWithOutcome?(provider: AgentCliKind): Promise<AgentProviderRefreshOutcome>;
  retryRegistration(provider: AgentCliKind): Promise<void>;
  save(intent: AgentProviderSettingsIntent): Promise<boolean>;
  saveWithOutcome(intent: AgentProviderSettingsIntent): Promise<AgentProviderSettingsSaveOutcome>;
  update(
    provider: AgentCliKind,
    offeredVersion: string,
  ): Promise<AgentProviderUpdateRefusal | null>;
}

export interface SelectedAgentProviderAuthority {
  readonly settingsRevision: number;
  readonly provider: AgentCliKind;
}

interface SelectedAgentProviderAuthorityPublication extends SelectedAgentProviderAuthority {
  readonly workspaceGeneration: number;
  readonly policyGateway: AgentProviderPolicyGateway;
  readonly healthGateway: AgentProviderHealthGateway;
  readonly updateGateway: AgentProviderUpdateGateway;
}

export interface AgentProviderManagementDependencies {
  readonly appSettingsRef: MutableRefObject<AppSettings>;
  readonly applyAppSettings: (settings: AppSettings) => void;
  readonly settingsGateway: Pick<SettingsGateway, "saveAppSettings">;
  readonly policyGateway: AgentProviderPolicyGateway;
  readonly healthGateway: AgentProviderHealthGateway;
  readonly updateGateway: AgentProviderUpdateGateway;
  readonly discoveryGateway: AgentCliDiscoveryGateway;
  readonly liveTurnCount: (provider: AgentCliKind) => number;
  readonly signInActive: (provider: AgentCliKind) => boolean;
  readonly reportError: (source: string, error: unknown) => void;
  readonly mintOperationId: (provider: AgentCliKind) => string;
  readonly settingsHydrated: boolean;
  readonly workspaceGeneration: number;
}

interface ProviderRuntime {
  readonly configurationRevision: number;
  readonly healthGeneration: number;
  readonly policy: AgentProviderPolicyRegistrationState;
  readonly health: AgentProviderHealthState;
  readonly updateState: AgentProviderUpdateState;
}

interface ProviderOwner {
  readonly provider: AgentCliKind;
  readonly configurationRevision: number;
  readonly settingsRevision: number;
  readonly providerGeneration: number;
  readonly workspaceGeneration: number;
  readonly lifecycleGeneration: number;
  readonly cliPath: string;
  readonly discoveryGeneration: number | null;
  readonly healthGateway: AgentProviderHealthGateway;
  readonly updateGateway: AgentProviderUpdateGateway;
}

const initialRuntime = (): Record<AgentCliKind, ProviderRuntime> => ({
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

export function useAgentProviderManagement(
  dependencies: AgentProviderManagementDependencies,
): AgentProviderManagementSurface {
  const cliDiscovery = useAgentCliDiscovery({
    active: dependencies.settingsHydrated,
    autoDiscover:
      dependencies.appSettingsRef.current.agentCliPaths.claudeCode === null ||
      dependencies.appSettingsRef.current.agentCliPaths.codex === null,
    gateway: dependencies.discoveryGateway,
    reportError: dependencies.reportError,
  });
  const [runtime, setRuntime] = useState(initialRuntime);
  const [toast, setToast] = useState<AgentProviderManagementToast | null>(null);
  const [selectedProviderAuthorityPublication, setSelectedProviderAuthorityPublication] =
    useState<SelectedAgentProviderAuthorityPublication | null>(null);
  const dependenciesRef = useRef(dependencies);
  const runtimeRef = useRef(runtime);
  const toastRef = useRef(toast);
  const authorityRef = useRef<
    Partial<Record<AgentCliKind, PersistedAgentProviderSettingsAuthority>>
  >({});
  const mountedRef = useRef(true);
  const hydrationGenerationRef = useRef(0);
  const hydrationReadyRef = useRef(false);
  const hydrationSettledRef = useRef(false);
  const settingsRevisionRef = useRef(1);
  const cliPathRevisionRef = useRef<Record<AgentCliKind, number>>({ claudeCode: 0, codex: 0 });
  const preferenceRevisionRef = useRef<Record<AgentCliKind, number>>({
    claudeCode: 0,
    codex: 0,
  });
  const selectedRevisionRef = useRef(0);
  const updateOperationRef = useRef<Partial<Record<AgentCliKind, string>>>({});
  const updateInFlightRef = useRef<Partial<Record<AgentCliKind, true>>>({});
  const updateProgressUnlistenRef = useRef<
    Partial<Record<AgentCliKind, { readonly operationId: string; readonly unlisten: () => void }>>
  >({});
  const persistedSliceRef = useRef<PersistedProviderSlice>({
    fields: {
      claudeCode: providerFields(dependencies.appSettingsRef.current, "claudeCode"),
      codex: providerFields(dependencies.appSettingsRef.current, "codex"),
    },
    selectedProvider: dependencies.appSettingsRef.current.agentCliKind,
    selectedSettingsRevision: 1,
  });
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const inFlightHealthRef = useRef<
    Partial<
      Record<
        AgentCliKind,
        {
          readonly generation: number;
          readonly promise: Promise<AgentProviderHealthProbeResult | null>;
        }
      >
    >
  >({});
  const timerRef = useRef<Partial<Record<AgentCliKind, ReturnType<typeof setTimeout>>>>({});
  const appliedDiscoveryRef = useRef<{
    readonly generation: number;
    readonly status: "discovering" | "ready" | "failed";
  } | null>(null);
  const readCliDiscovery = cliDiscovery.read;

  useLayoutEffect(() => {
    dependenciesRef.current = dependencies;
    runtimeRef.current = runtime;
    toastRef.current = toast;
  });

  const publish = useCallback(
    (provider: AgentCliKind, transform: (current: ProviderRuntime) => ProviderRuntime): void => {
      if (!mountedRef.current) return;
      const current = runtimeRef.current;
      const nextProvider = transform(current[provider]);
      if (nextProvider === current[provider]) return;
      const next = { ...current, [provider]: nextProvider };
      runtimeRef.current = next;
      setRuntime(next);
    },
    [],
  );

  const clearTimer = useCallback((provider: AgentCliKind): void => {
    const timer = timerRef.current[provider];
    if (timer === undefined) return;
    clearTimeout(timer);
    delete timerRef.current[provider];
  }, []);

  const currentOwner = useCallback(
    (provider: AgentCliKind): ProviderOwner | null => {
      if (!mountedRef.current) return null;
      const providerRuntime = runtimeRef.current[provider];
      if (providerRuntime.policy.kind !== "registered") return null;
      const authority = authorityRef.current[provider];
      if (authority === undefined || !authority.preference.enabled) return null;
      const discovery = readCliDiscovery();
      const cliPath = effectiveAgentProviderCliPath(provider, authority.cliPath, discovery);
      if (cliPath === null) return null;
      return {
        provider,
        configurationRevision: providerRuntime.configurationRevision,
        settingsRevision: providerRuntime.policy.settingsRevision,
        providerGeneration: providerRuntime.policy.providerGeneration,
        workspaceGeneration: dependenciesRef.current.workspaceGeneration,
        lifecycleGeneration: hydrationGenerationRef.current,
        cliPath,
        discoveryGeneration: authority.cliPath === null ? (discovery?.generation ?? null) : null,
        healthGateway: dependenciesRef.current.healthGateway,
        updateGateway: dependenciesRef.current.updateGateway,
      };
    },
    [readCliDiscovery],
  );

  const ownerIsCurrent = useCallback(
    (owner: ProviderOwner): boolean => {
      if (!mountedRef.current) return false;
      const current = currentOwner(owner.provider);
      if (current === null) return false;
      return (
        current.configurationRevision === owner.configurationRevision &&
        current.settingsRevision === owner.settingsRevision &&
        current.providerGeneration === owner.providerGeneration &&
        current.workspaceGeneration === owner.workspaceGeneration &&
        current.lifecycleGeneration === owner.lifecycleGeneration &&
        current.cliPath === owner.cliPath &&
        current.discoveryGeneration === owner.discoveryGeneration &&
        current.healthGateway === owner.healthGateway &&
        current.updateGateway === owner.updateGateway
      );
    },
    [currentOwner],
  );

  const refreshHealth = useCallback(
    (provider: AgentCliKind): Promise<AgentProviderHealthProbeResult | null> => {
      const owner = currentOwner(provider);
      if (owner === null) return Promise.resolve(null);
      const existing = inFlightHealthRef.current[provider];
      if (
        existing !== undefined &&
        existing.generation === runtimeRef.current[provider].healthGeneration
      ) {
        return existing.promise;
      }
      const healthGeneration = runtimeRef.current[provider].healthGeneration + 1;
      publish(provider, (current) => ({
        ...current,
        healthGeneration,
        health: { kind: "checking", generation: healthGeneration },
      }));
      const gateway = dependenciesRef.current.healthGateway;
      const promise = (async (): Promise<AgentProviderHealthProbeResult | null> => {
        try {
          const result = await gateway.probeAgentProviderHealth({
            provider,
            providerGeneration: owner.providerGeneration,
          });
          if (!ownerIsCurrent(owner)) return null;
          if (runtimeRef.current[provider].healthGeneration !== healthGeneration) return null;
          const checked = agentProviderHealthWithPersistedUpdateAuthority(
            result,
            authorityRef.current[provider]?.preference,
          );
          publish(provider, (current) => ({ ...current, health: { kind: "ready", ...checked } }));
          if (!ownerIsCurrent(owner)) return null;
          if (
            checked.update.kind !== "available" &&
            checked.update.kind !== "manualUpdateAvailable"
          )
            return checked;
          const preference = authorityRef.current[provider]?.preference;
          if (preference === undefined) return null;
          if (preference.dismissedUpdateVersion === checked.update.availableVersion) return checked;
          setToast({
            kind: "updateAvailable",
            provider,
            version: checked.update.availableVersion,
            ...(checked.update.kind === "manualUpdateAvailable" ? { manual: true as const } : {}),
          });
          return checked;
        } catch (error) {
          if (!ownerIsCurrent(owner)) return null;
          if (runtimeRef.current[provider].healthGeneration !== healthGeneration) return null;
          publish(provider, (current) => ({
            ...current,
            health: { kind: "failed", reason: "probeFailed", checkedAtEpochMs: null },
          }));
          dependenciesRef.current.reportError("Agent provider health", error);
          return null;
        } finally {
          const inFlight = inFlightHealthRef.current[provider];
          if (inFlight?.generation === healthGeneration) delete inFlightHealthRef.current[provider];
        }
      })();
      inFlightHealthRef.current[provider] = { generation: healthGeneration, promise };
      return promise;
    },
    [currentOwner, ownerIsCurrent, publish],
  );

  const updateChecks = useMemo(
    () =>
      createAgentProviderUpdateChecks({
        capture: (provider) => {
          const owner = currentOwner(provider);
          const current = runtimeRef.current[provider];
          if (
            owner === null ||
            current.health.kind !== "ready" ||
            current.health.installedVersion === null
          )
            return null;
          if (!authorityRef.current[provider]?.preference.checkForUpdates) return null;
          if (current.updateState.kind === "starting" || current.updateState.kind === "running")
            return null;
          const generation = current.healthGeneration;
          return {
            request: { provider, providerGeneration: owner.providerGeneration },
            installedVersion: current.health.installedVersion,
            gateway: owner.healthGateway,
            current: () =>
              ownerIsCurrent(owner) && runtimeRef.current[provider].healthGeneration === generation,
            publish: (update) => {
              publish(provider, (latest) => {
                if (latest.health.kind !== "ready") return latest;
                const health = agentProviderHealthWithPersistedUpdateAuthority(
                  { ...latest.health, update },
                  authorityRef.current[provider]?.preference,
                );
                return { ...latest, health: { kind: "ready", ...health } };
              });
              const checked = runtimeRef.current[provider].health;
              if (checked.kind !== "ready") return;
              if (
                checked.update.kind !== "available" &&
                checked.update.kind !== "manualUpdateAvailable"
              )
                return;
              if (
                authorityRef.current[provider]?.preference.dismissedUpdateVersion ===
                checked.update.availableVersion
              )
                return;
              setToast({
                kind: "updateAvailable",
                provider,
                version: checked.update.availableVersion,
                ...(checked.update.kind === "manualUpdateAvailable"
                  ? { manual: true as const }
                  : {}),
              });
            },
            reportError: (error) =>
              dependenciesRef.current.reportError("Agent provider update check", error),
          };
        },
      }),
    [currentOwner, ownerIsCurrent, publish],
  );

  const scheduleHealth = useCallback(
    (provider: AgentCliKind): void => {
      clearTimer(provider);
      const owner = currentOwner(provider);
      if (owner === null) return;
      const interval = authorityRef.current[provider]?.preference.healthCheckIntervalSeconds ?? 0;
      if (interval === 0) return;
      timerRef.current[provider] = setTimeout(() => {
        if (!ownerIsCurrent(owner)) return;
        void updateChecks.check(provider).finally(() => {
          if (!ownerIsCurrent(owner)) return;
          scheduleHealth(provider);
        });
      }, interval * 1_000);
    },
    [clearTimer, currentOwner, ownerIsCurrent, updateChecks],
  );

  const applyDiscoveryGeneration = useCallback(
    (status: "discovering" | "ready" | "failed", generation: number): void => {
      const applied = appliedDiscoveryRef.current;
      if (applied?.generation === generation && applied.status === status) return;
      if (applied !== null && generation < applied.generation) return;
      appliedDiscoveryRef.current = { generation, status };
      const discovery = readCliDiscovery();
      for (const provider of PROVIDERS) {
        const fields = authorityRef.current[provider] ?? persistedSliceRef.current.fields[provider];
        if (fields.cliPath !== null) continue;
        clearTimer(provider);
        publish(provider, (current) => ({
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
        const owner = currentOwner(provider);
        if (owner === null) continue;
        void refreshHealth(provider).finally(() => {
          if (!ownerIsCurrent(owner)) return;
          scheduleHealth(provider);
        });
      }
    },
    [
      clearTimer,
      currentOwner,
      ownerIsCurrent,
      publish,
      readCliDiscovery,
      refreshHealth,
      scheduleHealth,
    ],
  );

  const register = useCallback(
    async (
      provider: AgentCliKind,
      settingsRevision: number,
      exactFields?: ProviderFields,
      preservedUpdateOperationId: string | null = null,
    ): Promise<boolean> => {
      clearTimer(provider);
      setToast((current) => (current?.provider === provider ? null : current));
      const preservesUpdate =
        preservedUpdateOperationId !== null &&
        updateOperationRef.current[provider] === preservedUpdateOperationId;
      if (!preservesUpdate) delete updateOperationRef.current[provider];
      const configurationRevision = runtimeRef.current[provider].configurationRevision + 1;
      const fields =
        exactFields ?? providerFields(dependenciesRef.current.appSettingsRef.current, provider);
      authorityRef.current[provider] = undefined;
      publish(provider, (current) => ({
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
          readCliDiscovery()?.result[provider],
        ),
      }));
      const gateway = dependenciesRef.current.policyGateway;
      const lifecycleGeneration = hydrationGenerationRef.current;
      let effectiveSettingsRevision = settingsRevision;
      let expectedProviderGeneration: number | null = null;
      try {
        const currentPolicy = await gateway.currentAgentProviderPolicy({ provider });
        if (!mountedRef.current) return false;
        if (hydrationGenerationRef.current !== lifecycleGeneration) return false;
        if (dependenciesRef.current.policyGateway !== gateway) return false;
        if (!registrationIsCurrent(provider, configurationRevision, settingsRevision, runtimeRef)) {
          return false;
        }
        if (currentPolicy.kind === "registered") {
          if (currentPolicy.receipt.provider !== provider) {
            throw new Error("Provider policy lookup returned a foreign receipt.");
          }
          settingsRevisionRef.current = Math.max(
            settingsRevisionRef.current,
            currentPolicy.receipt.settingsRevision,
          );
          expectedProviderGeneration = currentPolicy.receipt.providerGeneration;
          if (policyMatches(currentPolicy, fields)) {
            authorityRef.current[provider] = authority(
              provider,
              currentPolicy.receipt.settingsRevision,
              fields,
            );
            publishRegistered(provider, configurationRevision, currentPolicy.receipt, publish);
            scheduleHealth(provider);
            void refreshHealth(provider);
            return true;
          }
          effectiveSettingsRevision = Math.max(
            effectiveSettingsRevision,
            currentPolicy.receipt.settingsRevision + 1,
          );
          settingsRevisionRef.current = Math.max(
            settingsRevisionRef.current,
            effectiveSettingsRevision,
          );
          publish(provider, (current) => ({
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
        });
        if (!mountedRef.current) return false;
        if (hydrationGenerationRef.current !== lifecycleGeneration) return false;
        if (dependenciesRef.current.policyGateway !== gateway) return false;
        if (
          !registrationIsCurrent(
            provider,
            configurationRevision,
            effectiveSettingsRevision,
            runtimeRef,
          )
        ) {
          return false;
        }
        if (receipt.provider !== provider) {
          throw new Error("Provider policy registration returned a foreign receipt.");
        }
        settingsRevisionRef.current = Math.max(
          settingsRevisionRef.current,
          receipt.settingsRevision,
        );
        authorityRef.current[provider] = authority(provider, receipt.settingsRevision, fields);
        publishRegistered(provider, configurationRevision, receipt, publish);
        scheduleHealth(provider);
        void refreshHealth(provider);
        return true;
      } catch (error) {
        if (!mountedRef.current) return false;
        if (hydrationGenerationRef.current !== lifecycleGeneration) return false;
        if (dependenciesRef.current.policyGateway !== gateway) return false;
        if (
          !registrationIsCurrent(
            provider,
            configurationRevision,
            effectiveSettingsRevision,
            runtimeRef,
          )
        ) {
          return false;
        }
        publish(provider, (current) => ({
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
        dependenciesRef.current.reportError("Agent provider registration", error);
        return false;
      }
    },
    [clearTimer, publish, readCliDiscovery, refreshHealth, scheduleHealth],
  );

  const publishSelectedProviderAuthority = useCallback(
    (provider: AgentCliKind, settingsRevision: number, lifecycleGeneration: number): boolean => {
      if (!mountedRef.current) return false;
      if (!hydrationReadyRef.current) return false;
      if (hydrationGenerationRef.current !== lifecycleGeneration) return false;
      if (persistedSliceRef.current.selectedProvider !== provider) return false;
      if (authorityFor(provider, authorityRef, runtimeRef) === null) return false;
      setSelectedProviderAuthorityPublication({
        provider,
        settingsRevision,
        workspaceGeneration: dependenciesRef.current.workspaceGeneration,
        policyGateway: dependenciesRef.current.policyGateway,
        healthGateway: dependenciesRef.current.healthGateway,
        updateGateway: dependenciesRef.current.updateGateway,
      });
      return true;
    },
    [],
  );

  const establishSelectedProviderAuthority = useCallback(
    async (
      provider: AgentCliKind,
      settingsRevision: number,
      lifecycleGeneration: number,
    ): Promise<boolean> => {
      if (hydrationGenerationRef.current !== lifecycleGeneration) return false;
      if (persistedSliceRef.current.selectedProvider !== provider) return false;
      if (authorityFor(provider, authorityRef, runtimeRef) === null) {
        const registered = await register(
          provider,
          settingsRevision,
          persistedSliceRef.current.fields[provider],
        );
        if (!registered) return false;
        if (hydrationGenerationRef.current !== lifecycleGeneration) return false;
        if (persistedSliceRef.current.selectedProvider !== provider) return false;
      }
      return publishSelectedProviderAuthority(provider, settingsRevision, lifecycleGeneration);
    },
    [publishSelectedProviderAuthority, register],
  );

  const saveWithOutcome = useCallback(
    (
      intent: AgentProviderSettingsIntent,
      preservedUpdateOperationId: string | null = null,
    ): Promise<AgentProviderSettingsSaveOutcome> => {
      if (!hydrationReadyRef.current || !dependenciesRef.current.settingsHydrated) {
        return Promise.resolve({ kind: "rejected", reason: "notHydrated" });
      }
      const settings = dependenciesRef.current.appSettingsRef.current;
      const previous = providerFields(settings, intent.provider);
      const proposed = proposedFields(previous, intent);
      const proposedSelected = intent.selectedProvider ?? settings.agentCliKind;
      settingsRevisionRef.current += 1;
      const queued: QueuedIntent = {
        ...intent,
        hydrationGeneration: hydrationGenerationRef.current,
        revision: settingsRevisionRef.current,
        proposed,
        cliPathOwned: intent.cliPath !== undefined,
        preferenceOwned: intent.preference !== undefined,
        selectedOwned: intent.selectedProvider !== undefined,
        proposedSelected,
        preservedUpdateOperationId,
      };
      if (queued.cliPathOwned) cliPathRevisionRef.current[intent.provider] = queued.revision;
      if (queued.preferenceOwned) preferenceRevisionRef.current[intent.provider] = queued.revision;
      if (queued.selectedOwned) selectedRevisionRef.current = queued.revision;
      appSettingsSaveCoordinatorFor(
        dependenciesRef.current.settingsGateway,
      ).initializeCommittedSnapshot(settings);
      dependenciesRef.current.applyAppSettings(applyIntent(settings, queued));
      let resolveResult: (value: AgentProviderSettingsSaveOutcome) => void = () => undefined;
      const result = new Promise<AgentProviderSettingsSaveOutcome>((resolve) => {
        resolveResult = resolve;
      });
      queueRef.current = queueRef.current.then(async () => {
        if (
          !mountedRef.current ||
          !hydrationReadyRef.current ||
          hydrationGenerationRef.current !== queued.hydrationGeneration
        ) {
          rollbackIntent(
            queued,
            persistedSliceRef,
            dependenciesRef,
            cliPathRevisionRef,
            preferenceRevisionRef,
            selectedRevisionRef,
          );
          resolveResult({ kind: "rejected", reason: "staleAuthority" });
          return;
        }
        const settingsGateway = dependenciesRef.current.settingsGateway;
        try {
          await appSettingsSaveCoordinatorFor(settingsGateway).save(settings, (committed) =>
            persistedCandidate(committed, persistedSliceRef.current, queued),
          );
          if (!mountedRef.current) {
            resolveResult({ kind: "rejected", reason: "staleAuthority" });
            return;
          }
          if (
            !hydrationReadyRef.current ||
            hydrationGenerationRef.current !== queued.hydrationGeneration
          ) {
            rollbackIntent(
              queued,
              persistedSliceRef,
              dependenciesRef,
              cliPathRevisionRef,
              preferenceRevisionRef,
              selectedRevisionRef,
            );
            resolveResult({ kind: "rejected", reason: "staleAuthority" });
            return;
          }
          if (dependenciesRef.current.settingsGateway !== settingsGateway) {
            rollbackIntent(
              queued,
              persistedSliceRef,
              dependenciesRef,
              cliPathRevisionRef,
              preferenceRevisionRef,
              selectedRevisionRef,
            );
            resolveResult({ kind: "rejected", reason: "staleAuthority" });
            return;
          }
          persistedSliceRef.current = commitPersistedIntent(persistedSliceRef.current, queued);
          const persistedFields = persistedSliceRef.current.fields[queued.provider];
          const registered = await register(
            queued.provider,
            queued.revision,
            persistedFields,
            queued.preservedUpdateOperationId,
          );
          if (registered && queued.selectedOwned) {
            await establishSelectedProviderAuthority(
              persistedSliceRef.current.selectedProvider,
              persistedSliceRef.current.selectedSettingsRevision,
              queued.hydrationGeneration,
            );
          }
          resolveResult({ kind: "persisted", policyRegistered: registered });
        } catch (error) {
          if (mountedRef.current) {
            rollbackIntent(
              queued,
              persistedSliceRef,
              dependenciesRef,
              cliPathRevisionRef,
              preferenceRevisionRef,
              selectedRevisionRef,
            );
          }
          if (!mountedRef.current || dependenciesRef.current.settingsGateway !== settingsGateway) {
            resolveResult({ kind: "rejected", reason: "staleAuthority" });
            return;
          }
          dependenciesRef.current.reportError("Agent provider settings", error);
          resolveResult({ kind: "rejected", reason: "persistenceFailed" });
        }
      });
      return result;
    },
    [establishSelectedProviderAuthority, register],
  );

  const save = useCallback(
    async (intent: AgentProviderSettingsIntent): Promise<boolean> =>
      (await saveWithOutcome(intent)).kind === "persisted",
    [saveWithOutcome],
  );

  const retryRegistration = useCallback(
    async (provider: AgentCliKind): Promise<void> => {
      if (!hydrationReadyRef.current || !dependenciesRef.current.settingsHydrated) return;
      const hydrationGeneration = hydrationGenerationRef.current;
      settingsRevisionRef.current += 1;
      await register(provider, settingsRevisionRef.current);
      if (!mountedRef.current) return;
      if (!hydrationReadyRef.current) return;
      if (hydrationGenerationRef.current !== hydrationGeneration) return;
    },
    [register],
  );

  const registerBeforeUpdate = useCallback(
    async (provider: AgentCliKind): Promise<AgentProviderUpdateRegistrationOutcome> => {
      const lifecycleGeneration = hydrationGenerationRef.current;
      const gateways = {
        workspaceGeneration: dependenciesRef.current.workspaceGeneration,
        policyGateway: dependenciesRef.current.policyGateway,
        healthGateway: dependenciesRef.current.healthGateway,
        updateGateway: dependenciesRef.current.updateGateway,
      };
      const stillOwned = (): boolean =>
        mountedRef.current &&
        hydrationReadyRef.current &&
        hydrationGenerationRef.current === lifecycleGeneration &&
        dependenciesRef.current.workspaceGeneration === gateways.workspaceGeneration &&
        dependenciesRef.current.policyGateway === gateways.policyGateway &&
        dependenciesRef.current.healthGateway === gateways.healthGateway &&
        dependenciesRef.current.updateGateway === gateways.updateGateway;
      const registration = await boundedSettlement(
        retryRegistration(provider),
        AGENT_PROVIDER_UPDATE_REGISTRATION_TIMEOUT_MS,
      );
      if (registration.kind === "timedOut") return "policyUnavailable";
      if (!stillOwned()) return "policyUnavailable";
      if (runtimeRef.current[provider].policy.kind !== "registered") return "policyUnavailable";
      const pendingHealth = inFlightHealthRef.current[provider]?.promise;
      if (pendingHealth === undefined) return "statusUnknown";
      const settledHealth = await boundedSettlement(
        pendingHealth,
        AGENT_PROVIDER_UPDATE_HEALTH_SETTLE_TIMEOUT_MS,
      );
      if (settledHealth.kind === "timedOut") return "policyUnavailable";
      if (!stillOwned()) return "policyUnavailable";
      if (runtimeRef.current[provider].policy.kind !== "registered") return "policyUnavailable";
      return "registered";
    },
    [retryRegistration],
  );

  const runUpdate = useCallback(
    async (
      provider: AgentCliKind,
      offeredVersion: string,
    ): Promise<AgentProviderUpdateRefusal | null> => {
      if (runtimeRef.current[provider].policy.kind !== "registered") {
        const outcome = await registerBeforeUpdate(provider);
        if (outcome !== "registered") return outcome;
      }
      if (updateChecks.needsDiagnostics(provider)) {
        const refusal = updateRefusal(
          provider,
          dependenciesRef.current.appSettingsRef.current,
          runtimeRef.current[provider],
          currentOwner(provider) !== null,
          dependenciesRef.current.liveTurnCount(provider),
          dependenciesRef.current.signInActive(provider),
        );
        if (refusal !== null) return refusal;
        const checkOwner = currentOwner(provider);
        if (checkOwner === null) return "policyUnavailable";
        const confirmed = await refreshHealth(provider);
        if (!ownerIsCurrent(checkOwner)) return "statusUnknown";
        if (confirmed === null || !stillOffers(confirmed, offeredVersion))
          return "noUpdateAvailable";
        updateChecks.confirmDiagnostics(provider);
      }
      const offeredHealth = runtimeRef.current[provider].health;
      if (offeredHealth.kind !== "ready") return "noUpdateAvailable";
      if (offeredHealth.update.kind !== "available") return "noUpdateAvailable";
      if (offeredHealth.update.availableVersion !== offeredVersion) return "noUpdateAvailable";
      const refusal = updateRefusal(
        provider,
        dependenciesRef.current.appSettingsRef.current,
        runtimeRef.current[provider],
        effectiveAgentProviderCliPath(
          provider,
          authorityRef.current[provider]?.cliPath ?? null,
          readCliDiscovery(),
        ) !== null,
        dependenciesRef.current.liveTurnCount(provider),
        dependenciesRef.current.signInActive(provider),
      );
      if (refusal !== null) return refusal;
      const owner = currentOwner(provider);
      if (owner === null) return "policyUnavailable";
      const operationId = dependenciesRef.current.mintOperationId(provider);
      updateOperationRef.current[provider] = operationId;
      setToast((current) => (current?.provider === provider ? null : current));
      clearTimer(provider);
      publish(provider, (current) => ({
        ...current,
        configurationRevision: current.configurationRevision + 1,
        healthGeneration: current.healthGeneration + 1,
        updateState: { kind: "starting", operationId },
      }));
      const updateOwner = currentOwner(provider);
      if (updateOwner === null) return "policyUnavailable";
      let progressClosed = false;
      let nextProgressSequence = 1;
      let unlistenProgress: (() => void) | null = null;
      const operationIsCurrent = (): boolean =>
        updateOperationRef.current[provider] === operationId && ownerIsCurrent(updateOwner);
      const progressIsCurrent = (): boolean => !progressClosed && operationIsCurrent();
      const markProgressUncertain = (error: unknown): void => {
        if (!progressIsCurrent()) return;
        progressClosed = true;
        publish(provider, (current) => ({
          ...current,
          updateState: runningUpdateWith(current.updateState, operationId, "", true),
        }));
        dependenciesRef.current.reportError("Agent provider update progress", error);
      };
      const onProgress = (event: AgentProviderUpdateProgressEvent): void => {
        if (!progressIsCurrent()) return;
        if (
          event.provider !== provider ||
          event.providerGeneration !== updateOwner.providerGeneration ||
          event.operationId !== operationId
        ) {
          return;
        }
        if (event.sequence !== nextProgressSequence) {
          markProgressUncertain(
            new Error("Agent provider update progress was duplicated, reordered, or incomplete."),
          );
          return;
        }
        nextProgressSequence += 1;
        publish(provider, (current) => ({
          ...current,
          updateState: runningUpdateWith(
            current.updateState,
            operationId,
            `${event.data}\n`,
            event.truncated,
          ),
        }));
      };
      try {
        const gateway = updateOwner.updateGateway;
        if (gateway.subscribeAgentProviderUpdateProgress === undefined) {
          markProgressUncertain(new Error("Agent provider update progress is unavailable."));
        } else {
          try {
            const subscriptionPromise = gateway.subscribeAgentProviderUpdateProgress(
              onProgress,
              markProgressUncertain,
            );
            const subscription = await boundedProgressSubscription(subscriptionPromise);
            if (subscription.kind === "timedOut") {
              markProgressUncertain(
                new Error("Agent provider update progress listener timed out."),
              );
              void subscriptionPromise
                .then((lateUnlisten) => lateUnlisten())
                .catch(() => undefined);
            } else {
              unlistenProgress = idempotentUnlisten(subscription.unlisten);
            }
            if (unlistenProgress !== null) {
              if (!operationIsCurrent()) {
                unlistenProgress();
                unlistenProgress = null;
                return null;
              }
              updateProgressUnlistenRef.current[provider] = {
                operationId,
                unlisten: unlistenProgress,
              };
            }
          } catch (error) {
            markProgressUncertain(error);
          }
        }
        if (!ownerIsCurrent(updateOwner)) return null;
        publish(provider, (current) => ({
          ...current,
          updateState: runningUpdateWith(current.updateState, operationId, "", false),
        }));
        const updatePromise = gateway.updateAgentProvider({
          provider,
          providerGeneration: updateOwner.providerGeneration,
          operationId,
        });
        const result = await updatePromise;
        if (dependenciesRef.current.updateGateway !== gateway) return null;
        if (!ownerIsCurrent(updateOwner)) return null;
        if (result.kind === "failed") {
          const streamed = currentUpdateOutput(
            runtimeRef.current[provider].updateState,
            operationId,
          );
          const finalSummary = result.outputTail === "" ? "" : `${result.outputTail}\n`;
          const merged = mergedUpdateOutput(streamed, finalSummary, result.outputTruncated);
          delete updateOperationRef.current[provider];
          publish(provider, (current) => ({
            ...current,
            configurationRevision: current.configurationRevision + 1,
            healthGeneration: current.healthGeneration + 1,
            updateState: failedUpdateState(result.reason, offeredVersion, merged),
          }));
          scheduleHealth(provider);
          setToast({ kind: "updateFailed", provider });
          return null;
        }
        if (result.kind === "alreadyCurrent") {
          const streamed = currentUpdateOutput(
            runtimeRef.current[provider].updateState,
            operationId,
          );
          publish(provider, (current) => ({
            ...current,
            configurationRevision: current.configurationRevision + 1,
            healthGeneration: current.healthGeneration + 1,
            updateState: alreadyCurrentUpdateState(
              result.installedVersion,
              offeredVersion,
              streamed,
            ),
          }));
          const alreadyCurrentOwner = currentOwner(provider);
          if (alreadyCurrentOwner === null) return null;
          const settledHealth = await refreshHealth(provider);
          if (!ownerIsCurrent(alreadyCurrentOwner)) return null;
          const disagreement = updateSettlementDisagreement(settledHealth, result.installedVersion);
          if (disagreement !== null) {
            delete updateOperationRef.current[provider];
            publish(provider, (current) => ({
              ...current,
              updateState: failedUpdateState(disagreement, offeredVersion, streamed),
            }));
            scheduleHealth(provider);
            setToast({ kind: "updateFailed", provider });
            return null;
          }
          scheduleHealth(provider);
          const offeredPreference = authorityRef.current[provider]?.preference;
          if (!stillOffers(settledHealth, offeredVersion) || offeredPreference === undefined) {
            if (updateOperationRef.current[provider] === operationId) {
              delete updateOperationRef.current[provider];
            }
            return null;
          }
          if (offeredPreference.dismissedUpdateVersion !== offeredVersion) {
            const dismissal = await saveWithOutcome(
              {
                provider,
                preference: { ...offeredPreference, dismissedUpdateVersion: offeredVersion },
              },
              operationId,
            );
            if (dismissal.kind !== "persisted") {
              if (updateOperationRef.current[provider] === operationId) {
                delete updateOperationRef.current[provider];
              }
              return null;
            }
            if (!mountedRef.current) return null;
            if (runtimeRef.current[provider].updateState.kind !== "alreadyCurrent") return null;
          }
          if (updateOperationRef.current[provider] !== operationId) return null;
          delete updateOperationRef.current[provider];
          setToast({ kind: "updateAlreadyCurrent", provider, version: result.installedVersion });
          return null;
        }
        publish(provider, (current) => ({
          ...current,
          configurationRevision: current.configurationRevision + 1,
          healthGeneration: current.healthGeneration + 1,
        }));
        const settledOwner = currentOwner(provider);
        if (settledOwner === null) return null;
        const health = await refreshHealth(provider);
        if (!ownerIsCurrent(settledOwner)) return null;
        const mismatch = updateSettlementDisagreement(health, result.installedVersion);
        if (mismatch !== null) {
          const streamed = currentUpdateOutput(
            runtimeRef.current[provider].updateState,
            operationId,
          );
          delete updateOperationRef.current[provider];
          publish(provider, (current) => ({
            ...current,
            updateState: failedUpdateState(mismatch, offeredVersion, streamed),
          }));
          scheduleHealth(provider);
          setToast({ kind: "updateFailed", provider });
          return null;
        }
        publish(provider, (current) => ({ ...current, updateState: result }));
        scheduleHealth(provider);
        const preference = authorityRef.current[provider]?.preference;
        if (preference !== undefined && preference.dismissedUpdateVersion !== null) {
          const dismissalOutcome = await saveWithOutcome(
            {
              provider,
              preference: { ...preference, dismissedUpdateVersion: null },
            },
            operationId,
          );
          if (dismissalOutcome.kind !== "persisted") {
            if (updateOperationRef.current[provider] === operationId) {
              delete updateOperationRef.current[provider];
            }
            return null;
          }
          if (!mountedRef.current) return null;
          if (updateOperationRef.current[provider] !== operationId) return null;
          if (runtimeRef.current[provider].updateState.kind !== "succeeded") return null;
        }
        if (updateOperationRef.current[provider] !== operationId) return null;
        delete updateOperationRef.current[provider];
        setToast({ kind: "updateSucceeded", provider, version: result.installedVersion });
        return null;
      } catch (error) {
        if (!ownerIsCurrent(updateOwner)) return null;
        const streamed = currentUpdateOutput(runtimeRef.current[provider].updateState, operationId);
        delete updateOperationRef.current[provider];
        publish(provider, (current) => ({
          ...current,
          configurationRevision: current.configurationRevision + 1,
          healthGeneration: current.healthGeneration + 1,
          updateState: failedUpdateState("uncertain", offeredVersion, streamed),
        }));
        scheduleHealth(provider);
        setToast({ kind: "updateFailed", provider });
        dependenciesRef.current.reportError("Agent provider update", error);
        return null;
      } finally {
        progressClosed = true;
        const registeredUnlisten = updateProgressUnlistenRef.current[provider];
        if (registeredUnlisten?.operationId === operationId) {
          delete updateProgressUnlistenRef.current[provider];
        }
        if (unlistenProgress !== null) {
          try {
            unlistenProgress();
          } catch (error) {
            dependenciesRef.current.reportError("Agent provider update progress cleanup", error);
          }
        }
      }
    },
    [
      clearTimer,
      currentOwner,
      ownerIsCurrent,
      publish,
      readCliDiscovery,
      refreshHealth,
      registerBeforeUpdate,
      updateChecks,
      saveWithOutcome,
      scheduleHealth,
    ],
  );

  const update = useCallback(
    async (
      provider: AgentCliKind,
      offeredVersion: string,
    ): Promise<AgentProviderUpdateRefusal | null> => {
      if (updateInFlightRef.current[provider] === true) return "alreadyUpdating";
      updateInFlightRef.current[provider] = true;
      try {
        return await runUpdate(provider, offeredVersion);
      } finally {
        delete updateInFlightRef.current[provider];
      }
    },
    [runUpdate],
  );

  const dismissUpdate = useCallback(
    async (provider: AgentCliKind, version: string): Promise<boolean> => {
      const health = runtimeRef.current[provider].health;
      if (
        health.kind !== "ready" ||
        (health.update.kind !== "available" && health.update.kind !== "manualUpdateAvailable")
      )
        return false;
      if (health.update.availableVersion !== version) return false;
      const dismissedToast = toastRef.current;
      if (
        dismissedToast?.kind !== "updateAvailable" ||
        dismissedToast.provider !== provider ||
        dismissedToast.version !== version
      ) {
        return false;
      }
      const current = preferences(dependenciesRef.current.appSettingsRef.current)[provider];
      const succeeded = await save({
        provider,
        preference: { ...current, dismissedUpdateVersion: version },
      });
      if (succeeded) setToast((latest) => (latest === dismissedToast ? null : latest));
      return succeeded;
    },
    [save],
  );

  useEffect(() => {
    mountedRef.current = true;
    hydrationReadyRef.current = false;
    hydrationGenerationRef.current += 1;
    setSelectedProviderAuthorityPublication(null);
    if (!dependencies.settingsHydrated) {
      hydrationSettledRef.current = false;
      authorityRef.current = {};
      const next = initialRuntime();
      runtimeRef.current = next;
      setRuntime(next);
      return () => {
        mountedRef.current = false;
      };
    }
    if (!hydrationSettledRef.current) {
      hydrationSettledRef.current = true;
      persistedSliceRef.current = {
        fields: {
          claudeCode: providerFields(dependencies.appSettingsRef.current, "claudeCode"),
          codex: providerFields(dependencies.appSettingsRef.current, "codex"),
        },
        selectedProvider: dependencies.appSettingsRef.current.agentCliKind,
        selectedSettingsRevision: settingsRevisionRef.current,
      };
    }
    hydrationReadyRef.current = true;
    const lifecycleGeneration = hydrationGenerationRef.current;
    const selectedProvider = persistedSliceRef.current.selectedProvider;
    const selectedSettingsRevision = persistedSliceRef.current.selectedSettingsRevision;
    for (const provider of PROVIDERS) {
      const registration = register(
        provider,
        selectedSettingsRevision,
        persistedSliceRef.current.fields[provider],
      );
      if (provider !== selectedProvider) {
        void registration;
        continue;
      }
      void registration.then((registered) => {
        if (!registered) return;
        publishSelectedProviderAuthority(
          selectedProvider,
          selectedSettingsRevision,
          lifecycleGeneration,
        );
      });
    }
    return () => {
      mountedRef.current = false;
      hydrationReadyRef.current = false;
      for (const provider of PROVIDERS) clearTimer(provider);
      inFlightHealthRef.current = {};
      updateOperationRef.current = {};
      updateInFlightRef.current = {};
      for (const subscription of Object.values(updateProgressUnlistenRef.current)) {
        try {
          subscription?.unlisten();
        } catch (error) {
          dependenciesRef.current.reportError("Agent provider update progress cleanup", error);
        }
      }
      updateProgressUnlistenRef.current = {};
    };
  }, [
    clearTimer,
    dependencies.appSettingsRef,
    dependencies.healthGateway,
    dependencies.policyGateway,
    dependencies.settingsHydrated,
    dependencies.updateGateway,
    dependencies.workspaceGeneration,
    publishSelectedProviderAuthority,
    register,
  ]);

  useEffect(() => {
    switch (cliDiscovery.status.kind) {
      case "inactive":
        return;
      case "discovering":
      case "ready":
      case "failed":
        applyDiscoveryGeneration(cliDiscovery.status.kind, cliDiscovery.status.generation);
        return;
      default:
        return unsupportedDiscoveryStatus(cliDiscovery.status);
    }
  }, [applyDiscoveryGeneration, cliDiscovery.status]);

  const claudeLiveTurnCount = dependencies.liveTurnCount("claudeCode");
  const codexLiveTurnCount = dependencies.liveTurnCount("codex");
  const claudeSignInActive = dependencies.signInActive("claudeCode");
  const codexSignInActive = dependencies.signInActive("codex");
  const selectedProviderAuthority = useMemo(
    () =>
      currentSelectedProviderAuthority(
        selectedProviderAuthorityPublication,
        dependencies.settingsHydrated,
        dependencies.workspaceGeneration,
        dependencies.policyGateway,
        dependencies.healthGateway,
        dependencies.updateGateway,
      ),
    [
      dependencies.healthGateway,
      dependencies.policyGateway,
      dependencies.settingsHydrated,
      dependencies.updateGateway,
      dependencies.workspaceGeneration,
      selectedProviderAuthorityPublication,
    ],
  );

  const providers = useMemo(
    (): Readonly<Record<AgentCliKind, AgentProviderManagementView>> => ({
      claudeCode: {
        executable: agentCliExecutablePresentation(
          "claudeCode",
          persistedSliceRef.current.fields.claudeCode.cliPath,
          cliDiscovery.result.claudeCode,
        ),
        health: runtime.claudeCode.health,
        policy: runtime.claudeCode.policy,
        updateState: runtime.claudeCode.updateState,
        liveTurnCount: claudeLiveTurnCount,
        signInActive: claudeSignInActive,
      },
      codex: {
        executable: agentCliExecutablePresentation(
          "codex",
          persistedSliceRef.current.fields.codex.cliPath,
          cliDiscovery.result.codex,
        ),
        health: runtime.codex.health,
        policy: runtime.codex.policy,
        updateState: runtime.codex.updateState,
        liveTurnCount: codexLiveTurnCount,
        signInActive: codexSignInActive,
      },
    }),
    [
      claudeLiveTurnCount,
      claudeSignInActive,
      cliDiscovery.result,
      codexLiveTurnCount,
      codexSignInActive,
      runtime,
    ],
  );

  const admissionAuthority = useCallback(
    (provider: AgentCliKind) =>
      admissionAuthorityFor(provider, authorityRef, runtimeRef, readCliDiscovery()),
    [readCliDiscovery],
  );
  const readAuthority = useCallback(
    (provider: AgentCliKind) => authorityFor(provider, authorityRef, runtimeRef),
    [],
  );
  const dismissToast = useCallback(() => setToast(null), []);
  const refreshProviders = useCallback(
    async (
      requested: ReadonlyArray<AgentCliKind>,
    ): Promise<ReadonlyArray<AgentProviderRefreshOutcome>> => {
      const lifecycleGeneration = hydrationGenerationRef.current;
      const workspaceGeneration = dependenciesRef.current.workspaceGeneration;
      const discoveryGateway = dependenciesRef.current.discoveryGateway;
      const isCurrent = (generation: number): boolean =>
        mountedRef.current &&
        hydrationGenerationRef.current === lifecycleGeneration &&
        dependenciesRef.current.workspaceGeneration === workspaceGeneration &&
        dependenciesRef.current.discoveryGateway === discoveryGateway &&
        cliDiscovery.currentGeneration() === generation;
      return refreshAgentProviderBatch({
        providers: requested,
        refreshDiscovery: cliDiscovery.refresh,
        discoveryGeneration: cliDiscovery.currentGeneration,
        configurationRevision: (provider) => runtimeRef.current[provider].configurationRevision,
        applyDiscovery: applyDiscoveryGeneration,
        isCurrent,
        refreshHealth: async (provider, generation) => {
          const owner = currentOwner(provider);
          if (owner === null) return { kind: "failed" };
          const health = await refreshHealth(provider);
          if (!isCurrent(generation) || !ownerIsCurrent(owner)) return { kind: "stale" };
          if (health === null) return { kind: "failed" };
          const authority = admissionAuthorityFor(
            provider,
            authorityRef,
            runtimeRef,
            readCliDiscovery(),
          );
          if (!isReadyAdmissionAuthority(authority)) return { kind: "failed" };
          return { kind: "complete", authority };
        },
      });
    },
    [
      applyDiscoveryGeneration,
      cliDiscovery,
      currentOwner,
      ownerIsCurrent,
      readCliDiscovery,
      refreshHealth,
    ],
  );
  const refreshProvider = useCallback(
    async (provider: AgentCliKind): Promise<AgentProviderRefreshOutcome> => {
      const results = await refreshProviders([provider]);
      return results[0] ?? { kind: "failed" };
    },
    [refreshProviders],
  );
  const refreshAll = useCallback(
    (): Promise<void> => updateChecks.checkAll(PROVIDERS),
    [updateChecks],
  );
  const refresh = useCallback(
    async (provider: AgentCliKind): Promise<void> => {
      await refreshProvider(provider);
    },
    [refreshProvider],
  );
  const refreshWithOutcome = refreshProvider;

  return useMemo(
    () => ({
      providers,
      cliDiscovery: cliDiscovery.result,
      selectedProviderAuthority,
      toast,
      admissionAuthority,
      authority: readAuthority,
      dismissToast,
      dismissUpdate,
      refresh,
      refreshAll,
      refreshWithOutcome,
      retryRegistration,
      save,
      saveWithOutcome,
      update,
    }),
    [
      admissionAuthority,
      dismissToast,
      dismissUpdate,
      providers,
      cliDiscovery.result,
      selectedProviderAuthority,
      readAuthority,
      refresh,
      refreshAll,
      refreshWithOutcome,
      retryRegistration,
      save,
      saveWithOutcome,
      toast,
      update,
    ],
  );
}

function updateSettlementDisagreement(
  health: AgentProviderHealthProbeResult | null,
  installedVersion: string,
): "uncertain" | "versionMismatch" | null {
  if (health === null) return "uncertain";
  if (health.installedVersion !== installedVersion) return "versionMismatch";
  return null;
}

function stillOffers(
  health: AgentProviderHealthProbeResult | null,
  offeredVersion: string,
): boolean {
  if (health === null) return false;
  if (health.update.kind !== "available") return false;
  return health.update.availableVersion === offeredVersion;
}

function currentSelectedProviderAuthority(
  publication: SelectedAgentProviderAuthorityPublication | null,
  settingsHydrated: boolean,
  workspaceGeneration: number,
  policyGateway: AgentProviderPolicyGateway,
  healthGateway: AgentProviderHealthGateway,
  updateGateway: AgentProviderUpdateGateway,
): SelectedAgentProviderAuthority | null {
  if (publication === null) return null;
  if (!settingsHydrated) return null;
  if (publication.workspaceGeneration !== workspaceGeneration) return null;
  if (publication.policyGateway !== policyGateway) return null;
  if (publication.healthGateway !== healthGateway) return null;
  if (publication.updateGateway !== updateGateway) return null;
  return { provider: publication.provider, settingsRevision: publication.settingsRevision };
}

function registrationIsCurrent(
  provider: AgentCliKind,
  configurationRevision: number,
  settingsRevision: number,
  runtimeRef: MutableRefObject<Record<AgentCliKind, ProviderRuntime>>,
): boolean {
  const current = runtimeRef.current[provider];
  return (
    current.configurationRevision === configurationRevision &&
    current.policy.kind === "registering" &&
    current.policy.settingsRevision === settingsRevision
  );
}

function policyMatches(
  policy: {
    readonly enabled: boolean;
    readonly cliPath: string | null;
    readonly checkForUpdates: boolean;
  },
  fields: ProviderFields,
): boolean {
  return (
    policy.enabled === fields.preference.enabled &&
    policy.cliPath === fields.cliPath &&
    policy.checkForUpdates === fields.preference.checkForUpdates
  );
}

function publishRegistered(
  provider: AgentCliKind,
  configurationRevision: number,
  receipt: {
    readonly settingsRevision: number;
    readonly providerGeneration: number;
  },
  publish: (
    provider: AgentCliKind,
    transform: (current: ProviderRuntime) => ProviderRuntime,
  ) => void,
): void {
  publish(provider, (current) => {
    if (current.configurationRevision !== configurationRevision) return current;
    return {
      ...current,
      policy: {
        kind: "registered",
        settingsRevision: receipt.settingsRevision,
        providerGeneration: receipt.providerGeneration,
      },
    };
  });
}

function authorityFor(
  provider: AgentCliKind,
  authorityRef: MutableRefObject<
    Partial<Record<AgentCliKind, PersistedAgentProviderSettingsAuthority>>
  >,
  runtimeRef: MutableRefObject<Record<AgentCliKind, ProviderRuntime>>,
): PersistedAgentProviderSettingsAuthority | null {
  const policy = runtimeRef.current[provider].policy;
  if (policy.kind !== "registered") return null;
  const persisted = authorityRef.current[provider];
  if (persisted === undefined || persisted.settingsRevision !== policy.settingsRevision)
    return null;
  return persisted;
}

function authority(
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

function admissionAuthorityFor(
  provider: AgentCliKind,
  authorityRef: MutableRefObject<
    Partial<Record<AgentCliKind, PersistedAgentProviderSettingsAuthority>>
  >,
  runtimeRef: MutableRefObject<Record<AgentCliKind, ProviderRuntime>>,
  discovery: AgentCliDiscoveryPublication | null,
): AgentProviderAdmissionAuthority {
  const runtime = runtimeRef.current[provider];
  const persisted = authorityRef.current[provider];
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
  };
}

function isReadyAdmissionAuthority(
  authority: AgentProviderAdmissionAuthority,
): authority is ReadyAgentProviderAdmissionAuthority {
  if (authority.disposition.kind !== "ready") return false;
  return "providerGeneration" in authority;
}

function updateRefusal(
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

function unsupportedDiscoveryStatus(status: never): never {
  throw new TypeError(`Unsupported agent CLI discovery status: ${String(status)}.`);
}

function policyRegistrationFailureReason(
  error: unknown,
): "registrationFailed" | "revisionConflict" | "staleRevision" | "generationConflict" {
  if (error === "revisionConflict" || error === "staleRevision" || error === "generationConflict") {
    return error;
  }
  return "registrationFailed";
}
