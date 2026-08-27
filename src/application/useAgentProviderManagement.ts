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
  type AgentProviderUpdateState,
} from "../domain/agentProviderHealth";
import {
  defaultAgentProviderPreferences,
  type AgentProviderPreference,
  type PersistedAgentProviderSettingsAuthority,
} from "../domain/agentProviderSettings";
import { normalizeAgentCliPath } from "../domain/agentSettings";
import type { AgentCliKind } from "../domain/agentTask";
import type { AppSettings, SettingsGateway } from "../domain/settings";
import type { AgentProviderAdmissionAuthority } from "./agentProviderAdmissionAuthority";

const PROVIDERS: readonly AgentCliKind[] = ["claudeCode", "codex"];

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
  | "alreadyUpdating";

export type AgentProviderSettingsSaveOutcome =
  | { readonly kind: "persisted"; readonly policyRegistered: boolean }
  | {
      readonly kind: "rejected";
      readonly reason: "notHydrated" | "staleAuthority" | "persistenceFailed";
    };

export interface AgentProviderManagementView {
  readonly health: AgentProviderHealthState;
  readonly policy: AgentProviderPolicyRegistrationState;
  readonly updateState: AgentProviderUpdateState;
  readonly liveTurnCount: number;
}

export interface AgentProviderSettingsIntent {
  readonly provider: AgentCliKind;
  readonly preference?: AgentProviderPreference;
  readonly cliPath?: string | null;
  readonly selectedProvider?: AgentCliKind;
}

export interface AgentProviderManagementSurface {
  readonly providers: Readonly<Record<AgentCliKind, AgentProviderManagementView>>;
  readonly toast: AgentProviderManagementToast | null;
  admissionAuthority(provider: AgentCliKind): AgentProviderAdmissionAuthority;
  authority(provider: AgentCliKind): PersistedAgentProviderSettingsAuthority | null;
  dismissToast(): void;
  dismissUpdate(provider: AgentCliKind, version: string): Promise<boolean>;
  refresh(provider: AgentCliKind): Promise<void>;
  retryRegistration(provider: AgentCliKind): Promise<void>;
  save(intent: AgentProviderSettingsIntent): Promise<boolean>;
  saveWithOutcome(intent: AgentProviderSettingsIntent): Promise<AgentProviderSettingsSaveOutcome>;
  update(
    provider: AgentCliKind,
    offeredVersion: string,
  ): Promise<AgentProviderUpdateRefusal | null>;
}

export interface AgentProviderManagementDependencies {
  readonly appSettingsRef: MutableRefObject<AppSettings>;
  readonly applyAppSettings: (settings: AppSettings) => void;
  readonly settingsGateway: Pick<SettingsGateway, "saveAppSettings">;
  readonly policyGateway: AgentProviderPolicyGateway;
  readonly healthGateway: AgentProviderHealthGateway;
  readonly updateGateway: AgentProviderUpdateGateway;
  readonly liveTurnCount: (provider: AgentCliKind) => number;
  readonly reportError: (source: string, error: unknown) => void;
  readonly mintOperationId: (provider: AgentCliKind) => string;
  readonly settingsHydrated: boolean;
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
  readonly cliPath: string;
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
  readonly selectedChanged: boolean;
  readonly proposedSelected: AgentCliKind;
  readonly preservedUpdateOperationId: string | null;
}

interface PersistedProviderSlice {
  readonly fields: Readonly<Record<AgentCliKind, ProviderFields>>;
  readonly selectedProvider: AgentCliKind;
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
  const [runtime, setRuntime] = useState(initialRuntime);
  const [toast, setToast] = useState<AgentProviderManagementToast | null>(null);
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
  const fieldRevisionRef = useRef<Record<AgentCliKind, number>>({ claudeCode: 0, codex: 0 });
  const selectedRevisionRef = useRef(0);
  const updateOperationRef = useRef<Partial<Record<AgentCliKind, string>>>({});
  const persistedSliceRef = useRef<PersistedProviderSlice>({
    fields: {
      claudeCode: providerFields(dependencies.appSettingsRef.current, "claudeCode"),
      codex: providerFields(dependencies.appSettingsRef.current, "codex"),
    },
    selectedProvider: dependencies.appSettingsRef.current.agentCliKind,
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

  const currentOwner = useCallback((provider: AgentCliKind): ProviderOwner | null => {
    if (!mountedRef.current) return null;
    const providerRuntime = runtimeRef.current[provider];
    if (providerRuntime.policy.kind !== "registered") return null;
    const authority = authorityRef.current[provider];
    if (authority === undefined || !authority.preference.enabled || authority.cliPath === null) {
      return null;
    }
    return {
      provider,
      configurationRevision: providerRuntime.configurationRevision,
      settingsRevision: providerRuntime.policy.settingsRevision,
      providerGeneration: providerRuntime.policy.providerGeneration,
      cliPath: authority.cliPath,
      healthGateway: dependenciesRef.current.healthGateway,
      updateGateway: dependenciesRef.current.updateGateway,
    };
  }, []);

  const ownerIsCurrent = useCallback(
    (owner: ProviderOwner): boolean => {
      if (!mountedRef.current) return false;
      const current = currentOwner(owner.provider);
      if (current === null) return false;
      return (
        current.configurationRevision === owner.configurationRevision &&
        current.settingsRevision === owner.settingsRevision &&
        current.providerGeneration === owner.providerGeneration &&
        current.cliPath === owner.cliPath &&
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
          publish(provider, (current) => ({ ...current, health: { kind: "ready", ...result } }));
          if (!ownerIsCurrent(owner)) return null;
          if (result.update.kind !== "available") return result;
          const preference = authorityRef.current[provider]?.preference;
          if (preference === undefined) return null;
          if (preference.dismissedUpdateVersion === result.update.availableVersion) return result;
          setToast({ kind: "updateAvailable", provider, version: result.update.availableVersion });
          return result;
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
      const configurationRevision = owner.configurationRevision;
      timerRef.current[provider] = setTimeout(() => {
        const current = currentOwner(provider);
        if (current?.configurationRevision !== configurationRevision) return;
        void refreshHealth(provider).finally(() => {
          const after = currentOwner(provider);
          if (after?.configurationRevision !== configurationRevision) return;
          scheduleHealth(provider);
        });
      }, interval * 1_000);
    },
    [clearTimer, currentOwner, refreshHealth],
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
      authorityRef.current[provider] = undefined;
      publish(provider, (current) => ({
        ...current,
        configurationRevision,
        healthGeneration: current.healthGeneration + 1,
        policy: { kind: "registering", settingsRevision },
        updateState: preservesUpdate
          ? current.updateState
          : updateStateBeforeRegistration(current.updateState),
        health: healthBeforeRegistration(
          exactFields ?? providerFields(dependenciesRef.current.appSettingsRef.current, provider),
        ),
      }));
      const gateway = dependenciesRef.current.policyGateway;
      const fields =
        exactFields ?? providerFields(dependenciesRef.current.appSettingsRef.current, provider);
      let effectiveSettingsRevision = settingsRevision;
      let expectedProviderGeneration: number | null = null;
      try {
        const currentPolicy = await gateway.currentAgentProviderPolicy({ provider });
        if (!mountedRef.current) return false;
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
    [clearTimer, publish, refreshHealth, scheduleHealth],
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
        selectedChanged: proposedSelected !== settings.agentCliKind,
        proposedSelected,
        preservedUpdateOperationId,
      };
      fieldRevisionRef.current[intent.provider] = queued.revision;
      if (queued.selectedChanged) selectedRevisionRef.current = queued.revision;
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
            fieldRevisionRef,
            selectedRevisionRef,
          );
          resolveResult({ kind: "rejected", reason: "staleAuthority" });
          return;
        }
        const latest = dependenciesRef.current.appSettingsRef.current;
        const candidate = persistedCandidate(latest, persistedSliceRef.current, queued);
        const settingsGateway = dependenciesRef.current.settingsGateway;
        try {
          await settingsGateway.saveAppSettings(candidate);
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
              fieldRevisionRef,
              selectedRevisionRef,
            );
            resolveResult({ kind: "rejected", reason: "staleAuthority" });
            return;
          }
          if (dependenciesRef.current.settingsGateway !== settingsGateway) {
            resolveResult({ kind: "rejected", reason: "staleAuthority" });
            return;
          }
          persistedSliceRef.current = commitPersistedIntent(persistedSliceRef.current, queued);
          const registered = await register(
            queued.provider,
            queued.revision,
            queued.proposed,
            queued.preservedUpdateOperationId,
          );
          resolveResult({ kind: "persisted", policyRegistered: registered });
        } catch (error) {
          if (mountedRef.current && dependenciesRef.current.settingsGateway === settingsGateway) {
            rollbackIntent(
              queued,
              persistedSliceRef,
              dependenciesRef,
              fieldRevisionRef,
              selectedRevisionRef,
            );
            dependenciesRef.current.reportError("Agent provider settings", error);
          }
          resolveResult({ kind: "rejected", reason: "persistenceFailed" });
        }
      });
      return result;
    },
    [register],
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
        dependenciesRef.current.liveTurnCount(provider),
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
      try {
        const gateway = updateOwner.updateGateway;
        const result = await gateway.updateAgentProvider({
          provider,
          providerGeneration: updateOwner.providerGeneration,
          operationId,
        });
        if (dependenciesRef.current.updateGateway !== gateway) return null;
        if (!ownerIsCurrent(updateOwner)) return null;
        if (result.kind === "failed") {
          delete updateOperationRef.current[provider];
          publish(provider, (current) => ({
            ...current,
            configurationRevision: current.configurationRevision + 1,
            healthGeneration: current.healthGeneration + 1,
            updateState: result,
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
          delete updateOperationRef.current[provider];
          publishUpdateFailure(provider, "uncertain", publish);
          scheduleHealth(provider);
          setToast({ kind: "updateFailed", provider });
          return null;
        }
        if (health.installedVersion !== result.installedVersion) {
          delete updateOperationRef.current[provider];
          publishUpdateFailure(provider, "versionMismatch", publish);
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
        delete updateOperationRef.current[provider];
        publish(provider, (current) => ({
          ...current,
          configurationRevision: current.configurationRevision + 1,
          healthGeneration: current.healthGeneration + 1,
          updateState: {
            kind: "failed",
            reason: "uncertain",
            outputTail: "",
            outputTruncated: false,
          },
        }));
        scheduleHealth(provider);
        setToast({ kind: "updateFailed", provider });
        dependenciesRef.current.reportError("Agent provider update", error);
        return null;
      }
    },
    [
      clearTimer,
      currentOwner,
      ownerIsCurrent,
      publish,
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
    if (!dependencies.settingsHydrated) {
      if (hydrationSettledRef.current) hydrationGenerationRef.current += 1;
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
      hydrationGenerationRef.current += 1;
      hydrationSettledRef.current = true;
      persistedSliceRef.current = {
        fields: {
          claudeCode: providerFields(dependencies.appSettingsRef.current, "claudeCode"),
          codex: providerFields(dependencies.appSettingsRef.current, "codex"),
        },
        selectedProvider: dependencies.appSettingsRef.current.agentCliKind,
      };
    }
    hydrationReadyRef.current = true;
    for (const provider of PROVIDERS) {
      void register(
        provider,
        settingsRevisionRef.current,
        persistedSliceRef.current.fields[provider],
      );
    }
    return () => {
      mountedRef.current = false;
      hydrationReadyRef.current = false;
      for (const provider of PROVIDERS) clearTimer(provider);
      inFlightHealthRef.current = {};
      updateOperationRef.current = {};
    };
  }, [
    clearTimer,
    dependencies.appSettingsRef,
    dependencies.healthGateway,
    dependencies.policyGateway,
    dependencies.settingsHydrated,
    dependencies.updateGateway,
    register,
  ]);

  const claudeLiveTurnCount = dependencies.liveTurnCount("claudeCode");
  const codexLiveTurnCount = dependencies.liveTurnCount("codex");

  const providers = useMemo(
    (): Readonly<Record<AgentCliKind, AgentProviderManagementView>> => ({
      claudeCode: {
        health: runtime.claudeCode.health,
        policy: runtime.claudeCode.policy,
        updateState: runtime.claudeCode.updateState,
        liveTurnCount: claudeLiveTurnCount,
      },
      codex: {
        health: runtime.codex.health,
        policy: runtime.codex.policy,
        updateState: runtime.codex.updateState,
        liveTurnCount: codexLiveTurnCount,
      },
    }),
    [claudeLiveTurnCount, codexLiveTurnCount, runtime],
  );

  const admissionAuthority = useCallback(
    (provider: AgentCliKind) => admissionAuthorityFor(provider, authorityRef, runtimeRef),
    [],
  );
  const readAuthority = useCallback(
    (provider: AgentCliKind) => authorityFor(provider, authorityRef, runtimeRef),
    [],
  );
  const dismissToast = useCallback(() => setToast(null), []);
  const refresh = useCallback(
    async (provider: AgentCliKind): Promise<void> => {
      await refreshHealth(provider);
    },
    [refreshHealth],
  );

  return useMemo(
    () => ({
      providers,
      toast,
      admissionAuthority,
      authority: readAuthority,
      dismissToast,
      dismissUpdate,
      refresh,
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
      readAuthority,
      refresh,
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
    agentCliKind: intent.proposedSelected,
    agentCliPaths: { ...settings.agentCliPaths, [intent.provider]: intent.proposed.cliPath },
    agentProviderPreferences: {
      ...preferences(settings),
      [intent.provider]: intent.proposed.preference,
    },
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
  return {
    fields: { ...persisted.fields, [intent.provider]: intent.proposed },
    selectedProvider: intent.selectedChanged ? intent.proposedSelected : persisted.selectedProvider,
  };
}

function rollbackIntent(
  intent: QueuedIntent,
  persistedSliceRef: MutableRefObject<PersistedProviderSlice>,
  dependenciesRef: MutableRefObject<AgentProviderManagementDependencies>,
  fieldRevisionRef: MutableRefObject<Record<AgentCliKind, number>>,
  selectedRevisionRef: MutableRefObject<number>,
): void {
  const current = dependenciesRef.current.appSettingsRef.current;
  const rollbackProvider = fieldRevisionRef.current[intent.provider] === intent.revision;
  const rollbackSelected =
    intent.selectedChanged && selectedRevisionRef.current === intent.revision;
  if (!rollbackProvider && !rollbackSelected) return;
  const persisted = persistedSliceRef.current;
  dependenciesRef.current.applyAppSettings({
    ...current,
    agentCliKind: rollbackSelected ? persisted.selectedProvider : current.agentCliKind,
    agentCliPaths: rollbackProvider
      ? { ...current.agentCliPaths, [intent.provider]: persisted.fields[intent.provider].cliPath }
      : current.agentCliPaths,
    agentProviderPreferences: rollbackProvider
      ? {
          ...preferences(current),
          [intent.provider]: persisted.fields[intent.provider].preference,
        }
      : preferences(current),
  });
}

function healthBeforeRegistration(fields: ProviderFields): AgentProviderHealthState {
  if (!fields.preference.enabled) return { kind: "disabled" };
  if (fields.cliPath === null) return { kind: "notConfigured" };
  return { kind: "checking", generation: 0 };
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
  if (
    runtime.policy.kind !== "registered" ||
    persisted?.cliPath === null ||
    persisted === undefined
  ) {
    return {
      provider,
      revision: runtime.configurationRevision,
      disposition: { kind: "policyUnavailable", reason: "unregistered" },
    };
  }
  if (runtime.updateState.kind === "starting" || runtime.updateState.kind === "running") {
    return {
      provider,
      revision: runtime.configurationRevision,
      disposition: { kind: "updating" },
      cliPath: persisted.cliPath,
      providerGeneration: runtime.policy.providerGeneration,
    };
  }
  return {
    provider,
    revision: runtime.configurationRevision,
    disposition: { kind: "ready" },
    cliPath: persisted.cliPath,
    providerGeneration: runtime.policy.providerGeneration,
  };
}

function updateRefusal(
  provider: AgentCliKind,
  settings: AppSettings,
  runtime: ProviderRuntime,
  liveTurnCount: number,
): AgentProviderUpdateRefusal | null {
  if (!preferences(settings)[provider].enabled) return "disabled";
  if (settings.agentCliPaths[provider] === null) return "notConfigured";
  if (runtime.policy.kind !== "registered") return "policyUnavailable";
  if (runtime.updateState.kind === "starting" || runtime.updateState.kind === "running") {
    return "alreadyUpdating";
  }
  if (liveTurnCount > 0) return "turnActive";
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

function publishUpdateFailure(
  provider: AgentCliKind,
  reason: "uncertain" | "versionMismatch",
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
      outputTail: "",
      outputTruncated: false,
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
