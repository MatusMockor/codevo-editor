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
  appendAgentProviderUpdateOutputTail,
  MAX_AGENT_PROVIDER_UPDATE_OUTPUT_TAIL_BYTES,
  type AgentProviderHealthGateway,
  type AgentProviderHealthProbeResult,
  type AgentProviderHealthState,
  type AgentProviderPolicyGateway,
  type AgentProviderPolicyRegistrationState,
  type AgentProviderUpdateGateway,
  type AgentProviderUpdateProgressEvent,
  type AgentProviderUpdateState,
} from "../domain/agentProviderHealth";
import {
  defaultAgentProviderPreferences,
  type AgentProviderPreference,
  type PersistedAgentProviderSettingsAuthority,
} from "../domain/agentProviderSettings";
import {
  agentCliExecutablePresentation,
  normalizeAgentCliPath,
  type AgentCliDiscoveryGateway,
  type AgentCliDiscoveryResult,
  type AgentCliExecutablePresentation,
} from "../domain/agentSettings";
import type { AgentCliKind } from "../domain/agentTask";
import type { AppSettings, SettingsGateway } from "../domain/settings";
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
import { useAgentCliDiscovery, type AgentCliDiscoveryPublication } from "./useAgentCliDiscovery";

const PROVIDERS: readonly AgentCliKind[] = ["claudeCode", "codex"];
const AGENT_PROVIDER_UPDATE_PROGRESS_SUBSCRIBE_TIMEOUT_MS = 1_000;

export type AgentProviderManagementToast =
  | {
      readonly kind: "updateAvailable";
      readonly provider: AgentCliKind;
      readonly version: string;
    }
  | {
      readonly kind: "updateSucceeded";
      readonly provider: AgentCliKind;
      readonly version: string;
    }
  | { readonly kind: "updateFailed"; readonly provider: AgentCliKind };

export type AgentProviderUpdateRefusal =
  | "disabled"
  | "notConfigured"
  | "policyUnavailable"
  | "noUpdateAvailable"
  | "turnActive"
  | "signInActive"
  | "alreadyUpdating";

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

export interface AgentProviderSettingsIntent {
  readonly provider: AgentCliKind;
  readonly preference?: AgentProviderPreference;
  readonly cliPath?: string | null;
  readonly selectedProvider?: AgentCliKind;
}

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

interface ProviderFields {
  readonly preference: AgentProviderPreference;
  readonly cliPath: string | null;
}

interface QueuedIntent extends AgentProviderSettingsIntent {
  readonly hydrationGeneration: number;
  readonly revision: number;
  readonly proposed: ProviderFields;
  readonly cliPathOwned: boolean;
  readonly preferenceOwned: boolean;
  readonly selectedOwned: boolean;
  readonly proposedSelected: AgentCliKind;
  readonly preservedUpdateOperationId: string | null;
}

interface PersistedProviderSlice {
  readonly fields: Readonly<Record<AgentCliKind, ProviderFields>>;
  readonly selectedProvider: AgentCliKind;
  readonly selectedSettingsRevision: number;
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
          if (checked.update.kind !== "available") return checked;
          const preference = authorityRef.current[provider]?.preference;
          if (preference === undefined) return null;
          if (preference.dismissedUpdateVersion === checked.update.availableVersion) return checked;
          setToast({ kind: "updateAvailable", provider, version: checked.update.availableVersion });
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

  const scheduleHealth = useCallback(
    (provider: AgentCliKind): void => {
      clearTimer(provider);
      const owner = currentOwner(provider);
      if (owner === null) return;
      const interval = authorityRef.current[provider]?.preference.healthCheckIntervalSeconds ?? 0;
      if (interval === 0) return;
      timerRef.current[provider] = setTimeout(() => {
        if (!ownerIsCurrent(owner)) return;
        void refreshHealth(provider).finally(() => {
          if (!ownerIsCurrent(owner)) return;
          scheduleHealth(provider);
        });
      }, interval * 1_000);
    },
    [clearTimer, currentOwner, ownerIsCurrent, refreshHealth],
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

  const update = useCallback(
    async (
      provider: AgentCliKind,
      offeredVersion: string,
    ): Promise<AgentProviderUpdateRefusal | null> => {
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
          const combinedOutputBytes = new TextEncoder().encode(
            `${streamed.outputTail}${finalSummary}`,
          ).byteLength;
          delete updateOperationRef.current[provider];
          publish(provider, (current) => ({
            ...current,
            configurationRevision: current.configurationRevision + 1,
            healthGeneration: current.healthGeneration + 1,
            updateState: {
              ...result,
              outputTail: appendAgentProviderUpdateOutputTail(streamed.outputTail, finalSummary),
              outputTruncated:
                result.outputTruncated ||
                streamed.outputTruncated ||
                combinedOutputBytes > MAX_AGENT_PROVIDER_UPDATE_OUTPUT_TAIL_BYTES,
            },
          }));
          scheduleHealth(provider);
          setToast({ kind: "updateFailed", provider });
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
        if (health === null) {
          const streamed = currentUpdateOutput(
            runtimeRef.current[provider].updateState,
            operationId,
          );
          delete updateOperationRef.current[provider];
          publishUpdateFailure(provider, "uncertain", streamed, publish);
          scheduleHealth(provider);
          setToast({ kind: "updateFailed", provider });
          return null;
        }
        if (health.installedVersion !== result.installedVersion) {
          const streamed = currentUpdateOutput(
            runtimeRef.current[provider].updateState,
            operationId,
          );
          delete updateOperationRef.current[provider];
          publishUpdateFailure(provider, "versionMismatch", streamed, publish);
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
          updateState: {
            kind: "failed",
            reason: "uncertain",
            outputTail: streamed.outputTail,
            outputTruncated: streamed.outputTruncated,
          },
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
      saveWithOutcome,
      scheduleHealth,
    ],
  );

  const dismissUpdate = useCallback(
    async (provider: AgentCliKind, version: string): Promise<boolean> => {
      const health = runtimeRef.current[provider].health;
      if (health.kind !== "ready" || health.update.kind !== "available") return false;
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
  const refreshProvider = useCallback(
    async (provider: AgentCliKind): Promise<AgentProviderRefreshOutcome> => {
      const lifecycleGeneration = hydrationGenerationRef.current;
      const workspaceGeneration = dependenciesRef.current.workspaceGeneration;
      const discoveryGateway = dependenciesRef.current.discoveryGateway;
      const before = runtimeRef.current[provider].configurationRevision;
      const discoveryPromise = cliDiscovery.refresh();
      const discoveryGeneration = cliDiscovery.currentGeneration();
      applyDiscoveryGeneration("discovering", discoveryGeneration);
      const refreshRevision = runtimeRef.current[provider].configurationRevision;
      if (refreshRevision < before) return { kind: "stale" };
      const publication = await discoveryPromise;
      if (!mountedRef.current) return { kind: "stale" };
      if (hydrationGenerationRef.current !== lifecycleGeneration) return { kind: "stale" };
      if (dependenciesRef.current.workspaceGeneration !== workspaceGeneration) {
        return { kind: "stale" };
      }
      if (dependenciesRef.current.discoveryGateway !== discoveryGateway) return { kind: "stale" };
      if (runtimeRef.current[provider].configurationRevision !== refreshRevision) {
        return { kind: "stale" };
      }
      if (cliDiscovery.currentGeneration() !== discoveryGeneration) return { kind: "stale" };
      if (publication === null) {
        applyDiscoveryGeneration("failed", discoveryGeneration);
        return { kind: "failed" };
      }
      if (publication.generation !== discoveryGeneration) return { kind: "stale" };
      applyDiscoveryGeneration("ready", discoveryGeneration);
      const healthOwner = currentOwner(provider);
      if (healthOwner === null) return { kind: "failed" };
      const health = await refreshHealth(provider);
      if (!mountedRef.current) return { kind: "stale" };
      if (hydrationGenerationRef.current !== lifecycleGeneration) return { kind: "stale" };
      if (dependenciesRef.current.workspaceGeneration !== workspaceGeneration) {
        return { kind: "stale" };
      }
      if (dependenciesRef.current.discoveryGateway !== discoveryGateway) return { kind: "stale" };
      if (cliDiscovery.currentGeneration() !== discoveryGeneration) return { kind: "stale" };
      if (!ownerIsCurrent(healthOwner)) return { kind: "stale" };
      if (health === null) return { kind: "failed" };
      const refreshedAuthority = admissionAuthorityFor(
        provider,
        authorityRef,
        runtimeRef,
        readCliDiscovery(),
      );
      if (!isReadyAdmissionAuthority(refreshedAuthority)) return { kind: "failed" };
      return { kind: "complete", authority: refreshedAuthority };
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
      refreshWithOutcome,
      retryRegistration,
      save,
      saveWithOutcome,
      toast,
      update,
    ],
  );
}

function preferences(settings: AppSettings) {
  return settings.agentProviderPreferences ?? defaultAgentProviderPreferences();
}

function runningUpdateWith(
  state: AgentProviderUpdateState,
  operationId: string,
  addition: string,
  truncated: boolean,
): Extract<AgentProviderUpdateState, { readonly kind: "running" }> {
  const current = currentUpdateOutput(state, operationId);
  const exceededTail =
    new TextEncoder().encode(`${current.outputTail}${addition}`).byteLength >
    MAX_AGENT_PROVIDER_UPDATE_OUTPUT_TAIL_BYTES;
  return {
    kind: "running",
    operationId,
    outputTail: appendAgentProviderUpdateOutputTail(current.outputTail, addition),
    outputTruncated: current.outputTruncated || truncated || exceededTail,
  };
}

function currentUpdateOutput(
  state: AgentProviderUpdateState,
  operationId: string,
): { readonly outputTail: string; readonly outputTruncated: boolean } {
  if (state.kind !== "running" || state.operationId !== operationId) {
    return { outputTail: "", outputTruncated: false };
  }
  return { outputTail: state.outputTail, outputTruncated: state.outputTruncated };
}

function idempotentUnlisten(unlisten: () => void): () => void {
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    unlisten();
  };
}

function boundedProgressSubscription(
  subscription: Promise<() => void>,
): Promise<
  { readonly kind: "subscribed"; readonly unlisten: () => void } | { readonly kind: "timedOut" }
> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ kind: "timedOut" });
    }, AGENT_PROVIDER_UPDATE_PROGRESS_SUBSCRIBE_TIMEOUT_MS);
    subscription.then(
      (unlisten) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ kind: "subscribed", unlisten });
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
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

function providerFields(settings: AppSettings, provider: AgentCliKind): ProviderFields {
  return { preference: preferences(settings)[provider], cliPath: settings.agentCliPaths[provider] };
}

function proposedFields(
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

function applyIntent(settings: AppSettings, intent: QueuedIntent): AppSettings {
  return {
    ...settings,
    agentCliKind: intent.selectedOwned ? intent.proposedSelected : settings.agentCliKind,
    agentCliPaths: intent.cliPathOwned
      ? { ...settings.agentCliPaths, [intent.provider]: intent.proposed.cliPath }
      : settings.agentCliPaths,
    agentProviderPreferences: intent.preferenceOwned
      ? {
          ...preferences(settings),
          [intent.provider]: intent.proposed.preference,
        }
      : preferences(settings),
  };
}

function persistedCandidate(
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

function commitPersistedIntent(
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

function rollbackIntent(
  intent: QueuedIntent,
  persistedSliceRef: MutableRefObject<PersistedProviderSlice>,
  dependenciesRef: MutableRefObject<AgentProviderManagementDependencies>,
  cliPathRevisionRef: MutableRefObject<Record<AgentCliKind, number>>,
  preferenceRevisionRef: MutableRefObject<Record<AgentCliKind, number>>,
  selectedRevisionRef: MutableRefObject<number>,
): void {
  const current = dependenciesRef.current.appSettingsRef.current;
  const rollbackCliPath =
    intent.cliPathOwned && cliPathRevisionRef.current[intent.provider] === intent.revision;
  const rollbackPreference =
    intent.preferenceOwned && preferenceRevisionRef.current[intent.provider] === intent.revision;
  const rollbackSelected = intent.selectedOwned && selectedRevisionRef.current === intent.revision;
  if (!rollbackCliPath && !rollbackPreference && !rollbackSelected) return;
  const persisted = persistedSliceRef.current;
  dependenciesRef.current.applyAppSettings({
    ...current,
    agentCliKind: rollbackSelected ? persisted.selectedProvider : current.agentCliKind,
    agentCliPaths: rollbackCliPath
      ? { ...current.agentCliPaths, [intent.provider]: persisted.fields[intent.provider].cliPath }
      : current.agentCliPaths,
    agentProviderPreferences: rollbackPreference
      ? {
          ...preferences(current),
          [intent.provider]: persisted.fields[intent.provider].preference,
        }
      : preferences(current),
  });
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

function updateStateBeforeRegistration(state: AgentProviderUpdateState): AgentProviderUpdateState {
  switch (state.kind) {
    case "starting":
    case "running":
      return { kind: "idle" };
    case "idle":
    case "succeeded":
    case "failed":
      return state;
    default:
      return unsupportedUpdateState(state);
  }
}

function unsupportedDiscoveryStatus(status: never): never {
  throw new TypeError(`Unsupported agent CLI discovery status: ${String(status)}.`);
}

function publishUpdateFailure(
  provider: AgentCliKind,
  reason: "uncertain" | "versionMismatch",
  output: { readonly outputTail: string; readonly outputTruncated: boolean },
  publish: (
    provider: AgentCliKind,
    transform: (current: ProviderRuntime) => ProviderRuntime,
  ) => void,
): void {
  publish(provider, (current) => ({
    ...current,
    updateState: {
      kind: "failed",
      reason,
      outputTail: output.outputTail,
      outputTruncated: output.outputTruncated,
    },
  }));
}

function unsupportedUpdateState(state: never): never {
  throw new TypeError(`Unsupported provider update state: ${String(state)}.`);
}

function policyRegistrationFailureReason(
  error: unknown,
): "registrationFailed" | "revisionConflict" | "staleRevision" | "generationConflict" {
  if (error === "revisionConflict" || error === "staleRevision" || error === "generationConflict") {
    return error;
  }
  return "registrationFailed";
}
