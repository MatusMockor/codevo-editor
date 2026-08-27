// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AgentProviderCurrentPolicyResult,
  AgentProviderHealthProbeResult,
  AgentProviderPolicyRegistrationRequest,
  AgentProviderUpdateResult,
} from "../domain/agentProviderHealth";
import { defaultAgentProviderPreferences } from "../domain/agentProviderSettings";
import type { AgentCliKind } from "../domain/agentTask";
import { defaultAppSettings, type AppSettings } from "../domain/settings";
import { waitForReact } from "../test/reactTestLifecycle";
import {
  useAgentProviderManagement,
  type AgentProviderManagementDependencies,
  type AgentProviderManagementSurface,
} from "./useAgentProviderManagement";

const PATH_A = "/usr/local/bin/claude";
const PATH_B = "/opt/homebrew/bin/claude";

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
}

interface Harness {
  readonly settings: () => AppSettings;
  readonly hook: () => AgentProviderManagementSurface;
  readonly dependencies: AgentProviderManagementDependencies;
  readonly healthCalls: Array<Deferred<AgentProviderHealthProbeResult>>;
  readonly errors: Array<{ readonly source: string; readonly error: unknown }>;
  replaceDependencies(
    replacement: Partial<AgentProviderManagementDependencies>,
  ): AgentProviderManagementDependencies;
  unmount(): void;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("useAgentProviderManagement", () => {
  it("keeps the management surface stable across unrelated dependency rerenders", async () => {
    const harness = renderManagement();
    await waitForReact(() => expect(harness.healthCalls).toHaveLength(2));
    const before = harness.hook();

    harness.replaceDependencies({
      liveTurnCount: () => 0,
      reportError: vi.fn(),
    });

    expect(harness.hook()).toBe(before);
    expect(harness.hook().providers).toBe(before.providers);
    harness.unmount();
  });

  it("does not publish or register policy before settings hydration settles", async () => {
    const harness = renderManagement(undefined, undefined, false);
    await act(async () => undefined);

    expect(harness.dependencies.policyGateway.currentAgentProviderPolicy).not.toHaveBeenCalled();
    expect(harness.dependencies.policyGateway.registerAgentProviderPolicy).not.toHaveBeenCalled();
    expect(harness.healthCalls).toHaveLength(0);
    expect(harness.hook().authority("claudeCode")).toBeNull();
    await expect(harness.hook().save({ provider: "claudeCode", cliPath: PATH_B })).resolves.toBe(
      false,
    );
    await act(async () => harness.hook().retryRegistration("claudeCode"));
    expect(harness.dependencies.settingsGateway.saveAppSettings).not.toHaveBeenCalled();
    expect(harness.dependencies.policyGateway.currentAgentProviderPolicy).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("drops a save when its hydration generation is replaced", async () => {
    const persisted = deferred<void>();
    const harness = renderManagement();
    await waitForReact(() => expect(harness.healthCalls).toHaveLength(2));
    vi.mocked(harness.dependencies.settingsGateway.saveAppSettings).mockReturnValueOnce(
      persisted.promise,
    );
    const registrations = vi.mocked(harness.dependencies.policyGateway.registerAgentProviderPolicy)
      .mock.calls.length;

    let save!: Promise<boolean>;
    act(() => {
      save = harness.hook().save({ provider: "claudeCode", cliPath: PATH_B });
    });
    await act(async () => undefined);
    harness.replaceDependencies({ settingsHydrated: false });
    await act(async () => persisted.resolve());
    await expect(save).resolves.toBe(false);

    expect(harness.settings().agentCliPaths.claudeCode).toBe(PATH_A);
    expect(
      vi.mocked(harness.dependencies.policyGateway.registerAgentProviderPolicy).mock.calls.length,
    ).toBe(registrations);
    harness.unmount();
  });

  it("drops a policy lookup that settles after unmount", async () => {
    const lookup = deferred<AgentProviderCurrentPolicyResult>();
    const harness = renderManagement(undefined, undefined, true, () => lookup.promise);
    await act(async () => undefined);
    harness.unmount();
    await act(async () => lookup.resolve({ kind: "unregistered" }));

    expect(harness.dependencies.policyGateway.registerAgentProviderPolicy).not.toHaveBeenCalled();
    expect(harness.healthCalls).toHaveLength(0);
    expect(harness.errors).toHaveLength(0);
  });

  it("registers persisted startup policy and probes each configured provider", async () => {
    const harness = renderManagement();

    await waitForReact(() =>
      expect(harness.dependencies.policyGateway.registerAgentProviderPolicy).toHaveBeenCalledTimes(
        2,
      ),
    );
    expect(harness.dependencies.policyGateway.registerAgentProviderPolicy).toHaveBeenCalledWith({
      provider: "claudeCode",
      settingsRevision: 1,
      expectedProviderGeneration: null,
      enabled: true,
      cliPath: PATH_A,
      checkForUpdates: false,
    });
    expect(harness.healthCalls).toHaveLength(2);

    await settleHealth(harness, 0, availableHealth("1.0.0", "1.1.0"));
    expect(harness.hook().providers.claudeCode.health.kind).toBe("ready");
    expect(harness.hook().toast).toEqual({
      kind: "updateAvailable",
      provider: "claudeCode",
      version: "1.1.0",
    });
    expect(harness.hook().authority("claudeCode")).toMatchObject({
      provider: "claudeCode",
      settingsRevision: 1,
      cliPath: PATH_A,
    });
    harness.unmount();
  });

  it("reacquires a newer identical backend policy without replacing it", async () => {
    const harness = renderManagement(undefined, undefined, true, (provider) => ({
      kind: "registered",
      receipt: { provider, settingsRevision: 7, providerGeneration: 4 },
      enabled: true,
      cliPath: provider === "claudeCode" ? PATH_A : "/usr/local/bin/codex",
      checkForUpdates: false,
    }));
    await waitForReact(() => expect(harness.healthCalls).toHaveLength(2));

    expect(harness.dependencies.policyGateway.registerAgentProviderPolicy).not.toHaveBeenCalled();
    expect(harness.hook().authority("claudeCode")?.settingsRevision).toBe(7);
    expect(harness.hook().admissionAuthority("claudeCode")).toMatchObject({
      providerGeneration: 4,
      disposition: { kind: "ready" },
    });
    harness.unmount();
  });

  it("CAS replaces a differing newer backend policy", async () => {
    const harness = renderManagement(undefined, undefined, true, (provider) => ({
      kind: "registered",
      receipt: { provider, settingsRevision: 7, providerGeneration: 4 },
      enabled: true,
      cliPath: provider === "claudeCode" ? "/old/claude" : "/old/codex",
      checkForUpdates: false,
    }));
    await waitForReact(() =>
      expect(harness.dependencies.policyGateway.registerAgentProviderPolicy).toHaveBeenCalledTimes(
        2,
      ),
    );

    expect(harness.dependencies.policyGateway.registerAgentProviderPolicy).toHaveBeenCalledWith({
      provider: "claudeCode",
      settingsRevision: 8,
      expectedProviderGeneration: 4,
      enabled: true,
      cliPath: PATH_A,
      checkForUpdates: false,
    });
    harness.unmount();
  });

  it("serializes saves and rolls back only failed owned fields", async () => {
    const firstSave = deferred<void>();
    const secondSave = deferred<void>();
    const harness = renderManagement();
    await waitForReact(() => expect(harness.healthCalls).toHaveLength(2));
    vi.mocked(harness.dependencies.settingsGateway.saveAppSettings)
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => secondSave.promise);
    const initialTheme = harness.settings().theme;
    const firstPreference = {
      ...defaultAgentProviderPreferences().claudeCode,
      healthCheckIntervalSeconds: 0,
    };
    const secondPreference = {
      ...defaultAgentProviderPreferences().codex,
      enabled: false,
    };

    let firstResult!: Promise<boolean>;
    let secondResult!: Promise<boolean>;
    act(() => {
      firstResult = harness.hook().save({
        provider: "claudeCode",
        preference: firstPreference,
        cliPath: PATH_B,
      });
      harness.dependencies.applyAppSettings({ ...harness.settings(), theme: "light" });
      secondResult = harness.hook().save({ provider: "codex", preference: secondPreference });
    });

    expect(harness.dependencies.settingsGateway.saveAppSettings).toHaveBeenCalledTimes(0);
    await act(async () => undefined);
    expect(harness.dependencies.settingsGateway.saveAppSettings).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(harness.dependencies.settingsGateway.saveAppSettings).mock.calls[0]?.[0]
        .agentProviderPreferences?.codex.enabled,
    ).toBe(true);
    expect(harness.settings().theme).toBe("light");

    await act(async () => firstSave.reject(new Error("disk full")));
    await expect(firstResult).resolves.toBe(false);
    await waitForReact(() =>
      expect(harness.dependencies.settingsGateway.saveAppSettings).toHaveBeenCalledTimes(2),
    );
    expect(harness.settings().agentCliPaths.claudeCode).toBe(PATH_A);
    expect(harness.settings().agentProviderPreferences?.codex.enabled).toBe(false);
    expect(harness.settings().theme).toBe("light");

    await act(async () => secondSave.resolve());
    await expect(secondResult).resolves.toBe(true);
    expect(harness.settings().theme).not.toBe(initialTheme);
    expect(harness.errors[0]?.source).toBe("Agent provider settings");
    harness.unmount();
  });

  it("rolls back queued same-provider failures to the persisted receipt", async () => {
    const firstSave = deferred<void>();
    const secondSave = deferred<void>();
    const harness = renderManagement();
    await waitForReact(() => expect(harness.healthCalls).toHaveLength(2));
    vi.mocked(harness.dependencies.settingsGateway.saveAppSettings)
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => secondSave.promise);

    let firstResult!: Promise<boolean>;
    let secondResult!: Promise<boolean>;
    act(() => {
      firstResult = harness.hook().save({ provider: "claudeCode", cliPath: PATH_B });
      secondResult = harness.hook().save({
        provider: "claudeCode",
        preference: {
          ...defaultAgentProviderPreferences().claudeCode,
          healthCheckIntervalSeconds: 0,
        },
      });
    });
    await act(async () => undefined);
    await act(async () => firstSave.reject(new Error("first failed")));
    await expect(firstResult).resolves.toBe(false);
    await waitForReact(() =>
      expect(harness.dependencies.settingsGateway.saveAppSettings).toHaveBeenCalledTimes(2),
    );
    await act(async () => secondSave.reject(new Error("second failed")));
    await expect(secondResult).resolves.toBe(false);

    expect(harness.settings().agentCliPaths.claudeCode).toBe(PATH_A);
    expect(harness.settings().agentProviderPreferences?.claudeCode.healthCheckIntervalSeconds).toBe(
      300,
    );
    harness.unmount();
  });

  it("does not publish a save receipt from a replaced settings gateway", async () => {
    const staleSave = deferred<void>();
    const harness = renderManagement();
    await waitForReact(() => expect(harness.healthCalls).toHaveLength(2));
    vi.mocked(harness.dependencies.settingsGateway.saveAppSettings).mockReturnValueOnce(
      staleSave.promise,
    );
    const registrationCount = vi.mocked(
      harness.dependencies.policyGateway.registerAgentProviderPolicy,
    ).mock.calls.length;

    let save!: Promise<boolean>;
    act(() => {
      save = harness.hook().save({ provider: "claudeCode", cliPath: PATH_B });
    });
    await act(async () => undefined);
    harness.replaceDependencies({
      settingsGateway: { saveAppSettings: vi.fn(async () => undefined) },
    });
    await act(async () => staleSave.resolve());
    await expect(save).resolves.toBe(false);

    expect(harness.hook().authority("claudeCode")?.cliPath).toBe(PATH_A);
    expect(
      vi.mocked(harness.dependencies.policyGateway.registerAgentProviderPolicy).mock.calls.length,
    ).toBe(registrationCount);
    expect(harness.errors).toHaveLength(0);
    harness.unmount();
  });

  it("keeps the persisted receipt across runtime gateway replacement during a draft save", async () => {
    const persisted = deferred<void>();
    const harness = renderManagement();
    await waitForReact(() => expect(harness.healthCalls).toHaveLength(2));
    vi.mocked(harness.dependencies.settingsGateway.saveAppSettings).mockReturnValueOnce(
      persisted.promise,
    );
    let save!: Promise<boolean>;
    act(() => {
      save = harness.hook().save({ provider: "claudeCode", cliPath: PATH_B });
    });
    await act(async () => undefined);

    const registerAgentProviderPolicy = vi.fn(
      async (request: AgentProviderPolicyRegistrationRequest) => ({
        provider: request.provider,
        settingsRevision: request.settingsRevision,
        providerGeneration: 20,
      }),
    );
    harness.replaceDependencies({
      policyGateway: {
        currentAgentProviderPolicy: vi.fn(async () => ({ kind: "unregistered" as const })),
        registerAgentProviderPolicy,
      },
      healthGateway: {
        probeAgentProviderHealth: vi.fn(
          () => new Promise<AgentProviderHealthProbeResult>(() => undefined),
        ),
      },
      updateGateway: {
        updateAgentProvider: vi.fn(async () => ({
          kind: "failed" as const,
          reason: "uncertain" as const,
          outputTail: "",
          outputTruncated: false,
        })),
      },
    });
    await waitForReact(() => expect(registerAgentProviderPolicy).toHaveBeenCalledTimes(2));
    expect(registerAgentProviderPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "claudeCode", cliPath: PATH_A }),
    );
    expect(registerAgentProviderPolicy).not.toHaveBeenCalledWith(
      expect.objectContaining({ provider: "claudeCode", cliPath: PATH_B }),
    );

    await act(async () => persisted.reject(new Error("save failed")));
    await expect(save).resolves.toBe(false);
    expect(harness.settings().agentCliPaths.claudeCode).toBe(PATH_A);
    expect(registerAgentProviderPolicy).not.toHaveBeenCalledWith(
      expect.objectContaining({ provider: "claudeCode", cliPath: PATH_B }),
    );
    harness.unmount();
  });

  it("keeps interval zero manual, coalesces refresh, and clears timers on unmount", async () => {
    vi.useFakeTimers();
    const settings = configuredSettings();
    settings.agentProviderPreferences = {
      ...defaultAgentProviderPreferences(),
      claudeCode: {
        ...defaultAgentProviderPreferences().claudeCode,
        healthCheckIntervalSeconds: 0,
      },
      codex: {
        ...defaultAgentProviderPreferences().codex,
        healthCheckIntervalSeconds: 1,
      },
    };
    const harness = renderManagement(settings);
    await act(async () => undefined);
    await act(async () => undefined);
    expect(harness.healthCalls).toHaveLength(2);

    const first = harness.hook().refresh("claudeCode");
    const second = harness.hook().refresh("claudeCode");
    void first;
    void second;
    expect(harness.healthCalls).toHaveLength(2);

    await settleHealth(harness, 0, currentHealth("1.0.0"));
    await settleHealth(harness, 1, currentHealth("2.0.0"));
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(harness.healthCalls).toHaveLength(3);
    harness.unmount();
    await act(async () => vi.runOnlyPendingTimers());
    expect(harness.healthCalls).toHaveLength(3);
  });

  it("does not authorize a probe when persisted policy registration fails", async () => {
    const harness = renderManagement();
    await waitForReact(() => expect(harness.healthCalls).toHaveLength(2));
    vi.mocked(harness.dependencies.policyGateway.registerAgentProviderPolicy).mockRejectedValueOnce(
      "generationConflict",
    );
    const preference = {
      ...defaultAgentProviderPreferences().claudeCode,
      checkForUpdates: true,
    };

    let saved!: Promise<boolean>;
    act(() => {
      saved = harness.hook().save({ provider: "claudeCode", preference });
    });
    await act(async () => {
      await expect(saved).resolves.toBe(true);
    });

    expect(harness.healthCalls).toHaveLength(2);
    expect(harness.hook().authority("claudeCode")).toBeNull();
    expect(harness.hook().admissionAuthority("claudeCode").disposition).toEqual({
      kind: "policyUnavailable",
      reason: "registrationFailed",
    });
    expect(harness.hook().providers.claudeCode.health).toEqual({
      kind: "failed",
      reason: "policyRegistrationFailed",
      checkedAtEpochMs: null,
    });
    expect(harness.hook().providers.claudeCode.policy).toMatchObject({
      kind: "failed",
      reason: "generationConflict",
    });
    harness.unmount();
  });

  it("rejects late A results across A to B to A generations", async () => {
    const harness = renderManagement();
    await waitForReact(() => expect(harness.healthCalls).toHaveLength(2));
    const staleA = harness.healthCalls[0];

    let saveB!: Promise<boolean>;
    act(() => {
      saveB = harness.hook().save({ provider: "claudeCode", cliPath: PATH_B });
    });
    await waitForReact(() =>
      expect(harness.dependencies.policyGateway.registerAgentProviderPolicy).toHaveBeenCalledWith(
        expect.objectContaining({ provider: "claudeCode", cliPath: PATH_B }),
      ),
    );
    await expect(saveB).resolves.toBe(true);

    let saveA!: Promise<boolean>;
    act(() => {
      saveA = harness.hook().save({ provider: "claudeCode", cliPath: PATH_A });
    });
    await expect(saveA).resolves.toBe(true);
    await waitForReact(() => expect(harness.healthCalls.length).toBeGreaterThanOrEqual(4));
    const currentA = harness.healthCalls[harness.healthCalls.length - 1];
    if (currentA === undefined) throw new Error("Expected current A health probe.");
    await act(async () => staleA?.resolve(availableHealth("0.1.0", "9.0.0")));
    expect(harness.hook().toast).toBeNull();
    await act(async () => currentA.resolve(currentHealth("3.0.0")));
    await waitForReact(() =>
      expect(harness.hook().providers.claudeCode.health).toMatchObject({
        kind: "ready",
        installedVersion: "3.0.0",
      }),
    );
    harness.unmount();
  });

  it("refuses updates with live turns and publishes synchronous update settlement", async () => {
    let liveTurns = 1;
    const updateSettings = configuredSettings();
    updateSettings.agentProviderPreferences = {
      ...defaultAgentProviderPreferences(),
      claudeCode: {
        ...defaultAgentProviderPreferences().claudeCode,
        dismissedUpdateVersion: "0.9.0",
      },
    };
    const harness = renderManagement(updateSettings, () => liveTurns);
    await waitForReact(() => expect(harness.healthCalls).toHaveLength(2));
    await settleHealth(harness, 0, availableHealth("1.0.0", "1.1.0"));

    await expect(harness.hook().update("claudeCode", "1.0.1")).resolves.toBe("noUpdateAvailable");
    expect(harness.dependencies.updateGateway.updateAgentProvider).not.toHaveBeenCalled();
    await expect(harness.hook().update("claudeCode", "1.1.0")).resolves.toBe("turnActive");
    expect(harness.dependencies.updateGateway.updateAgentProvider).not.toHaveBeenCalled();
    liveTurns = 0;
    const updateResult = deferred<AgentProviderUpdateResult>();
    vi.mocked(harness.dependencies.updateGateway.updateAgentProvider).mockReturnValueOnce(
      updateResult.promise,
    );
    const revisionBeforeUpdate = harness.hook().admissionAuthority("claudeCode").revision;

    let updatePromise!: Promise<unknown>;
    act(() => {
      updatePromise = harness.hook().update("claudeCode", "1.1.0");
    });
    expect(harness.hook().providers.claudeCode.updateState.kind).toBe("starting");
    expect(harness.hook().admissionAuthority("claudeCode")).toMatchObject({
      revision: revisionBeforeUpdate + 1,
      disposition: { kind: "updating" },
    });
    await act(async () =>
      updateResult.resolve({
        kind: "succeeded",
        previousVersion: "1.0.0",
        installedVersion: "1.1.0",
      }),
    );
    expect(harness.hook().providers.claudeCode.updateState.kind).toBe("starting");
    expect(harness.healthCalls).toHaveLength(3);
    await settleHealth(harness, 2, currentHealth("1.1.0"));
    await expect(updatePromise).resolves.toBeNull();
    expect(harness.hook().providers.claudeCode.updateState).toEqual({
      kind: "succeeded",
      previousVersion: "1.0.0",
      installedVersion: "1.1.0",
    });
    expect(harness.hook().toast).toEqual({
      kind: "updateSucceeded",
      provider: "claudeCode",
      version: "1.1.0",
    });
    expect(harness.hook().admissionAuthority("claudeCode").revision).toBe(revisionBeforeUpdate + 3);
    expect(harness.hook().providers.claudeCode.health.kind).toBe("checking");
    expect(
      harness.settings().agentProviderPreferences?.claudeCode.dismissedUpdateVersion,
    ).toBeNull();
    expect(harness.healthCalls).toHaveLength(4);
    harness.unmount();
  });

  it("retires a pending update when provider configuration is registered again", async () => {
    const harness = renderManagement();
    await waitForReact(() => expect(harness.healthCalls).toHaveLength(2));
    await settleHealth(harness, 0, availableHealth("1.0.0", "1.1.0"));
    const result = deferred<AgentProviderUpdateResult>();
    vi.mocked(harness.dependencies.updateGateway.updateAgentProvider).mockReturnValueOnce(
      result.promise,
    );

    let update!: Promise<unknown>;
    act(() => {
      update = harness.hook().update("claudeCode", "1.1.0");
    });
    expect(harness.hook().providers.claudeCode.updateState.kind).toBe("starting");
    let save!: Promise<boolean>;
    act(() => {
      save = harness.hook().save({ provider: "claudeCode", cliPath: PATH_B });
    });
    await act(async () => {
      await expect(save).resolves.toBe(true);
    });
    expect(harness.hook().providers.claudeCode.updateState.kind).toBe("idle");

    await act(async () =>
      result.resolve({
        kind: "succeeded",
        previousVersion: "1.0.0",
        installedVersion: "1.1.0",
      }),
    );
    await expect(update).resolves.toBeNull();
    expect(harness.hook().providers.claudeCode.updateState.kind).toBe("idle");
    harness.unmount();
  });

  it("does not announce update success when dismissal persistence fails", async () => {
    const settings = configuredSettings();
    settings.agentProviderPreferences = {
      ...defaultAgentProviderPreferences(),
      claudeCode: {
        ...defaultAgentProviderPreferences().claudeCode,
        dismissedUpdateVersion: "0.9.0",
      },
    };
    const harness = renderManagement(settings);
    await waitForReact(() => expect(harness.healthCalls).toHaveLength(2));
    await settleHealth(harness, 0, availableHealth("1.0.0", "1.1.0"));
    vi.mocked(harness.dependencies.updateGateway.updateAgentProvider).mockResolvedValueOnce({
      kind: "succeeded",
      previousVersion: "1.0.0",
      installedVersion: "1.1.0",
    });
    vi.mocked(harness.dependencies.settingsGateway.saveAppSettings).mockRejectedValueOnce(
      new Error("dismissal save failed"),
    );

    let update!: Promise<unknown>;
    act(() => {
      update = harness.hook().update("claudeCode", "1.1.0");
    });
    await waitForReact(() => expect(harness.healthCalls).toHaveLength(3));
    await settleHealth(harness, 2, currentHealth("1.1.0"));
    await expect(update).resolves.toBeNull();

    expect(harness.hook().toast).not.toMatchObject({ kind: "updateSucceeded" });
    expect(harness.settings().agentProviderPreferences?.claudeCode.dismissedUpdateVersion).toBe(
      "0.9.0",
    );
    expect(harness.errors[0]?.source).toBe("Agent provider settings");
    harness.unmount();
  });

  it("persists an exact dismissal and suppresses only that offered version", async () => {
    const harness = renderManagement();
    await waitForReact(() => expect(harness.healthCalls).toHaveLength(2));
    await settleHealth(harness, 0, availableHealth("1.0.0", "1.1.0"));

    let dismissed!: Promise<boolean>;
    act(() => {
      dismissed = harness.hook().dismissUpdate("claudeCode", "1.1.0");
    });
    await act(async () => {
      await expect(dismissed).resolves.toBe(true);
    });
    expect(harness.settings().agentProviderPreferences?.claudeCode.dismissedUpdateVersion).toBe(
      "1.1.0",
    );
    await waitForReact(() => expect(harness.hook().toast).toBeNull());
    harness.unmount();
  });

  it("keeps a foreign update toast that arrives while dismissal persists", async () => {
    const save = deferred<void>();
    const harness = renderManagement();
    await waitForReact(() => expect(harness.healthCalls).toHaveLength(2));
    await settleHealth(harness, 0, availableHealth("1.0.0", "1.1.0"));
    vi.mocked(harness.dependencies.settingsGateway.saveAppSettings).mockReturnValueOnce(
      save.promise,
    );

    let dismissal!: Promise<boolean>;
    act(() => {
      dismissal = harness.hook().dismissUpdate("claudeCode", "1.1.0");
    });
    await act(async () => undefined);
    await settleHealth(harness, 1, codexAvailableHealth("2.0.0", "2.1.0"));
    expect(harness.hook().toast).toEqual({
      kind: "updateAvailable",
      provider: "codex",
      version: "2.1.0",
    });
    await act(async () => save.resolve());
    await expect(dismissal).resolves.toBe(true);
    expect(harness.hook().toast).toEqual({
      kind: "updateAvailable",
      provider: "codex",
      version: "2.1.0",
    });
    harness.unmount();
  });
});

function renderManagement(
  initialSettings: AppSettings = configuredSettings(),
  liveTurnCount: (provider: AgentCliKind) => number = () => 0,
  settingsHydrated = true,
  currentPolicy: (
    provider: AgentCliKind,
  ) => AgentProviderCurrentPolicyResult | Promise<AgentProviderCurrentPolicyResult> = () => ({
    kind: "unregistered",
  }),
): Harness {
  let settings = initialSettings;
  let hook: AgentProviderManagementSurface | null = null;
  const healthCalls: Array<Deferred<AgentProviderHealthProbeResult>> = [];
  const errors: Array<{ readonly source: string; readonly error: unknown }> = [];
  const generations: Record<AgentCliKind, number> = { claudeCode: 0, codex: 0 };
  const settingsRef = { current: settings };
  const dependencies: AgentProviderManagementDependencies = {
    appSettingsRef: settingsRef,
    applyAppSettings: (next) => {
      settings = next;
      settingsRef.current = next;
    },
    settingsGateway: { saveAppSettings: vi.fn(async () => undefined) },
    policyGateway: {
      currentAgentProviderPolicy: vi.fn(
        async ({ provider }): Promise<AgentProviderCurrentPolicyResult> => currentPolicy(provider),
      ),
      registerAgentProviderPolicy: vi.fn(
        async (request: AgentProviderPolicyRegistrationRequest) => {
          generations[request.provider] += 1;
          return {
            provider: request.provider,
            settingsRevision: request.settingsRevision,
            providerGeneration: generations[request.provider],
          };
        },
      ),
    },
    healthGateway: {
      probeAgentProviderHealth: vi.fn(() => {
        const call = deferred<AgentProviderHealthProbeResult>();
        healthCalls.push(call);
        return call.promise;
      }),
    },
    updateGateway: {
      updateAgentProvider: vi.fn(async () => ({
        kind: "failed" as const,
        reason: "uncertain" as const,
        outputTail: "",
        outputTruncated: false,
      })),
    },
    liveTurnCount,
    reportError: (source, error) => errors.push({ source, error }),
    mintOperationId: (provider) => `${provider}-update`,
    settingsHydrated,
  };
  let currentDependencies = dependencies;
  const container = document.createElement("div");
  const root = createRoot(container);

  function Hook(): null {
    hook = useAgentProviderManagement(currentDependencies);
    return null;
  }

  act(() => root.render(createElement(Hook)));
  return {
    settings: () => settings,
    hook: () => {
      if (hook === null) throw new Error("Hook did not render.");
      return hook;
    },
    dependencies,
    healthCalls,
    errors,
    replaceDependencies: (replacement) => {
      currentDependencies = { ...currentDependencies, ...replacement };
      act(() => root.render(createElement(Hook)));
      return currentDependencies;
    },
    unmount: () => act(() => root.unmount()),
  };
}

function configuredSettings(): AppSettings {
  return {
    ...defaultAppSettings(),
    agentCliPaths: { claudeCode: PATH_A, codex: "/usr/local/bin/codex" },
    agentProviderPreferences: defaultAgentProviderPreferences(),
  };
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function currentHealth(version: string): AgentProviderHealthProbeResult {
  return {
    installedVersion: version,
    auth: { kind: "signedIn", label: null },
    update: { kind: "current", installedVersion: version },
    checkedAtEpochMs: 1_700_000_000_000,
  };
}

function availableHealth(
  installedVersion: string,
  availableVersion: string,
): AgentProviderHealthProbeResult {
  return {
    installedVersion,
    auth: { kind: "signedIn", label: "Pro" },
    update: {
      kind: "available",
      installedVersion,
      availableVersion,
      installer: { kind: "npm", packageName: "@anthropic-ai/claude-code" },
    },
    checkedAtEpochMs: 1_700_000_000_000,
  };
}

function codexAvailableHealth(
  installedVersion: string,
  availableVersion: string,
): AgentProviderHealthProbeResult {
  return {
    installedVersion,
    auth: { kind: "signedOut" },
    update: {
      kind: "available",
      installedVersion,
      availableVersion,
      installer: { kind: "npm", packageName: "@openai/codex" },
    },
    checkedAtEpochMs: 1_700_000_000_000,
  };
}

async function settleHealth(
  harness: Harness,
  index: number,
  result: AgentProviderHealthProbeResult,
): Promise<void> {
  const call = harness.healthCalls[index];
  if (call === undefined) throw new Error(`Missing health call ${index}.`);
  await act(async () => call.resolve(result));
}
