// @vitest-environment jsdom

import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AgentProviderCurrentPolicyResult,
  AgentProviderGenerationRequest,
  AgentProviderHealthProbeResult,
  AgentProviderPolicyRegistrationRequest,
  AgentProviderUpdateProgressEvent,
  AgentProviderUpdateGateway,
  AgentProviderUpdateResult,
} from "../domain/agentProviderHealth";
import { defaultAgentProviderPreferences } from "../domain/agentProviderSettings";
import type { AgentCliDiscoveryGateway, AgentCliDiscoveryResult } from "../domain/agentSettings";
import type { AgentCliKind } from "../domain/agentTask";
import { defaultAppSettings, type AppSettings } from "../domain/settings";
import { waitForReact } from "../test/reactTestLifecycle";
import { AgentProviderSettingsCard } from "../components/AgentProviderSettingsCard";
import {
  TauriAgentProviderGateway,
  type ListenToAgentProviderUpdateProgress,
} from "../infrastructure/tauriAgentProviderGateway";
import {
  useAgentProviderManagement,
  type AgentProviderManagementDependencies,
  type AgentProviderRefreshOutcome,
  type AgentProviderManagementSurface,
} from "./useAgentProviderManagement";
import { isCurrentAgentProviderAdmissionAuthority } from "./agentProviderAdmissionAuthority";
import { appSettingsSaveCoordinatorFor } from "./appSettingsSaveCoordinator";

const PATH_A = "/usr/local/bin/claude";
const PATH_B = "/opt/homebrew/bin/claude";

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
}

interface Harness {
  readonly container: HTMLDivElement;
  readonly settings: () => AppSettings;
  readonly hook: () => AgentProviderManagementSurface;
  readonly dependencies: AgentProviderManagementDependencies;
  readonly healthCalls: Array<Deferred<AgentProviderHealthProbeResult>>;
  readonly healthRequests: AgentProviderGenerationRequest[];
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
  it("keeps a null persisted override while admitting the exact detected executable", async () => {
    const discovery = deferred<AgentCliDiscoveryResult>();
    const refreshDiscovery = deferred<AgentCliDiscoveryResult>();
    const discoveryGateway: AgentCliDiscoveryGateway = {
      discoverAgentClis: vi
        .fn<AgentCliDiscoveryGateway["discoverAgentClis"]>()
        .mockReturnValueOnce(discovery.promise)
        .mockReturnValueOnce(refreshDiscovery.promise),
    };
    const settings = configuredSettings();
    settings.agentCliPaths = { claudeCode: null, codex: "/usr/local/bin/codex" };
    const harness = renderManagement(
      settings,
      () => 0,
      true,
      () => ({ kind: "unregistered" }),
      {
        discoveryGateway,
      },
    );

    await waitForReact(() =>
      expect(harness.dependencies.policyGateway.registerAgentProviderPolicy).toHaveBeenCalledWith(
        expect.objectContaining({ provider: "claudeCode", cliPath: null }),
      ),
    );
    expect(harness.healthCalls).toHaveLength(1);
    await act(async () =>
      discovery.resolve({
        claudeCode: { kind: "detected", path: "/detected/claude", version: "1.2.3" },
        codex: { kind: "notFound" },
      }),
    );
    await waitForReact(() => expect(harness.healthCalls).toHaveLength(2));
    expect(harness.hook().providers.claudeCode.executable).toEqual({
      kind: "detected",
      path: "/detected/claude",
      version: "1.2.3",
    });
    expect(harness.hook().authority("claudeCode")?.cliPath).toBeNull();
    expect(harness.hook().admissionAuthority("claudeCode")).toMatchObject({
      disposition: { kind: "ready" },
      providerGeneration: 1,
    });
    expect(harness.hook().admissionAuthority("claudeCode")).not.toHaveProperty("cliPath");

    await settleHealth(harness, 0, currentHealth("2.0.0"));
    await settleHealth(harness, 1, currentHealth("1.2.3"));
    expect(harness.hook().admissionAuthority("claudeCode")).toMatchObject({
      disposition: { kind: "ready" },
      providerGeneration: 1,
    });
    let refreshed!: Promise<AgentProviderRefreshOutcome>;
    act(() => {
      refreshed = harness.hook().refreshWithOutcome!("claudeCode");
    });
    expect(harness.healthCalls).toHaveLength(2);
    await act(async () =>
      refreshDiscovery.resolve({
        claudeCode: { kind: "detected", path: "/detected/new-claude", version: "1.2.4" },
        codex: { kind: "notFound" },
      }),
    );
    await waitForReact(() => expect(harness.healthCalls).toHaveLength(3));
    expect(harness.hook().providers.claudeCode.executable).toMatchObject({
      kind: "detected",
      path: "/detected/new-claude",
    });
    await settleHealth(harness, 2, currentHealth("1.2.4"));
    const receipt = await refreshed;
    expect(receipt.kind).toBe("complete");
    if (receipt.kind !== "complete") throw new Error("Expected an exact refresh receipt.");
    const previousPreference = settings.agentProviderPreferences!.claudeCode;
    const currentPolicy = harness.hook().providers.claudeCode.policy;
    if (currentPolicy.kind !== "registered")
      throw new Error("Expected registered provider policy.");
    vi.mocked(harness.dependencies.policyGateway.currentAgentProviderPolicy).mockResolvedValueOnce({
      kind: "registered",
      receipt: {
        provider: "claudeCode",
        settingsRevision: currentPolicy.settingsRevision,
        providerGeneration: currentPolicy.providerGeneration,
      },
      enabled: previousPreference.enabled,
      cliPath: null,
      checkForUpdates: previousPreference.checkForUpdates,
    });
    let preferenceSave!: Promise<boolean>;
    act(() => {
      preferenceSave = harness.hook().save({
        provider: "claudeCode",
        preference: {
          ...previousPreference,
          healthCheckIntervalSeconds: previousPreference.healthCheckIntervalSeconds + 1,
        },
      });
    });
    await act(async () => {
      await expect(preferenceSave).resolves.toBe(true);
    });
    const replacement = harness.hook().admissionAuthority("claudeCode");
    expect(replacement).toMatchObject({
      disposition: { kind: "ready" },
      providerGeneration: receipt.authority.providerGeneration,
    });
    expect(replacement.revision).not.toBe(receipt.authority.revision);
    expect(
      isCurrentAgentProviderAdmissionAuthority(
        (provider) => harness.hook().admissionAuthority(provider),
        receipt.authority,
      ),
    ).toBe(false);
    harness.unmount();
  });

  it("restores the periodic health timer after delayed automatic discovery and refresh", async () => {
    vi.useFakeTimers();
    const initialDiscovery = deferred<AgentCliDiscoveryResult>();
    const refreshedDiscovery = deferred<AgentCliDiscoveryResult>();
    const discoveryGateway: AgentCliDiscoveryGateway = {
      discoverAgentClis: vi
        .fn<AgentCliDiscoveryGateway["discoverAgentClis"]>()
        .mockReturnValueOnce(initialDiscovery.promise)
        .mockReturnValueOnce(refreshedDiscovery.promise),
    };
    const settings = configuredSettings();
    settings.agentCliPaths = { claudeCode: null, codex: "/usr/local/bin/codex" };
    settings.agentProviderPreferences = {
      claudeCode: {
        ...defaultAgentProviderPreferences().claudeCode,
        healthCheckIntervalSeconds: 1,
      },
      codex: {
        ...defaultAgentProviderPreferences().codex,
        healthCheckIntervalSeconds: 0,
      },
    };
    const harness = renderManagement(
      settings,
      () => 0,
      true,
      () => ({ kind: "unregistered" }),
      {
        discoveryGateway,
      },
    );
    await waitForReact(() =>
      expect(harness.dependencies.policyGateway.registerAgentProviderPolicy).toHaveBeenCalledTimes(
        2,
      ),
    );
    await act(async () =>
      initialDiscovery.resolve({
        claudeCode: { kind: "detected", path: "/detected/claude", version: "1.2.3" },
        codex: { kind: "notFound" },
      }),
    );
    await waitForReact(() => expect(harness.healthCalls.length).toBeGreaterThanOrEqual(2));
    const initialHealthCount = harness.healthCalls.length;
    for (let index = 0; index < initialHealthCount; index += 1) {
      await settleHealth(harness, index, currentHealth(index === 0 ? "2.0.0" : "1.2.3"));
    }
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(harness.healthCalls).toHaveLength(initialHealthCount + 1);
    await settleHealth(harness, initialHealthCount, currentHealth("1.2.3"));

    let refresh!: Promise<void>;
    act(() => {
      refresh = harness.hook().refresh("claudeCode");
    });
    await act(async () =>
      refreshedDiscovery.resolve({
        claudeCode: { kind: "detected", path: "/detected/claude", version: "1.2.3" },
        codex: { kind: "notFound" },
      }),
    );
    await waitForReact(() => expect(harness.healthCalls).toHaveLength(initialHealthCount + 2));
    await settleHealth(harness, initialHealthCount + 1, currentHealth("1.2.3"));
    await act(async () => refresh);
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(harness.healthCalls).toHaveLength(initialHealthCount + 3);
    harness.unmount();
  });

  it("fails a refresh whose post-discovery health owner is replaced", async () => {
    const refreshedDiscovery = deferred<AgentCliDiscoveryResult>();
    const initialResult: AgentCliDiscoveryResult = {
      claudeCode: { kind: "detected", path: "/detected/claude", version: "1.2.3" },
      codex: { kind: "notFound" },
    };
    const discoveryGateway: AgentCliDiscoveryGateway = {
      discoverAgentClis: vi
        .fn<AgentCliDiscoveryGateway["discoverAgentClis"]>()
        .mockResolvedValueOnce(initialResult)
        .mockReturnValueOnce(refreshedDiscovery.promise),
    };
    const settings = configuredSettings();
    settings.agentCliPaths = { claudeCode: null, codex: "/usr/local/bin/codex" };
    const harness = renderManagement(
      settings,
      () => 0,
      true,
      () => ({ kind: "unregistered" }),
      {
        discoveryGateway,
      },
    );
    await waitForReact(() => expect(harness.healthCalls.length).toBeGreaterThanOrEqual(2));
    const initialHealthCount = harness.healthCalls.length;
    for (let index = 0; index < initialHealthCount; index += 1) {
      await settleHealth(harness, index, currentHealth(index === 0 ? "2.0.0" : "1.2.3"));
    }

    let refresh!: Promise<AgentProviderRefreshOutcome>;
    act(() => {
      refresh = harness.hook().refreshWithOutcome!("claudeCode");
    });
    await act(async () => refreshedDiscovery.resolve(initialResult));
    await waitForReact(() => expect(harness.healthCalls).toHaveLength(initialHealthCount + 1));
    const staleHealth = harness.healthCalls[initialHealthCount];

    let replacement!: Promise<boolean>;
    act(() => {
      replacement = harness.hook().save({ provider: "claudeCode", cliPath: PATH_B });
    });
    await act(async () => {
      await expect(replacement).resolves.toBe(true);
    });
    await act(async () => staleHealth?.resolve(currentHealth("1.2.3")));

    await expect(refresh).resolves.toEqual({ kind: "stale" });
    harness.unmount();
  });

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
    expect(harness.hook().selectedProviderAuthority).toBeNull();
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
    const selectedAuthority = harness.hook().selectedProviderAuthority;
    vi.mocked(harness.dependencies.settingsGateway.saveAppSettings).mockReturnValueOnce(
      persisted.promise,
    );
    const registrations = vi.mocked(harness.dependencies.policyGateway.registerAgentProviderPolicy)
      .mock.calls.length;

    let save!: Promise<boolean>;
    act(() => {
      save = harness.hook().save({
        provider: "claudeCode",
        cliPath: PATH_B,
        selectedProvider: "codex",
      });
    });
    expect(harness.hook().selectedProviderAuthority).toEqual(selectedAuthority);
    await act(async () => undefined);
    harness.replaceDependencies({ settingsHydrated: false });
    expect(harness.hook().selectedProviderAuthority).toBeNull();
    await act(async () => persisted.resolve());
    await expect(save).resolves.toBe(false);

    expect(harness.settings().agentCliPaths.claudeCode).toBe(PATH_A);
    expect(harness.settings().agentCliKind).toBe("claudeCode");
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
      checkForUpdates: true,
    });
    expect(harness.healthCalls).toHaveLength(2);
    expect(harness.healthRequests).toEqual([
      { provider: "claudeCode", providerGeneration: 1 },
      { provider: "codex", providerGeneration: 1 },
    ]);

    harness.replaceDependencies({});
    await act(async () => undefined);
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
    expect(harness.hook().selectedProviderAuthority).toEqual({
      provider: "claudeCode",
      settingsRevision: 1,
    });
    harness.unmount();
  });

  it("runs each persisted startup probe once through StrictMode effect replay", async () => {
    const harness = renderManagement(
      configuredSettings(),
      () => 0,
      true,
      () => ({ kind: "unregistered" }),
      { strict: true },
    );

    await waitForReact(() => expect(harness.healthCalls).toHaveLength(2));
    await act(async () => undefined);

    expect(harness.healthRequests).toEqual([
      { provider: "claudeCode", providerGeneration: 1 },
      { provider: "codex", providerGeneration: 1 },
    ]);
    harness.unmount();
  });

  it.each(["claudeCode", "codex"] as const)(
    "announces and dismisses a newer %s without an install candidate",
    async (provider) => {
      const harness = renderManagement();
      await waitForReact(() => expect(harness.healthCalls).toHaveLength(2));
      const index = harness.healthRequests.findIndex((request) => request.provider === provider);
      const health: AgentProviderHealthProbeResult = {
        ...currentHealth("1.0.0"),
        update: {
          kind: "manualUpdateAvailable",
          installedVersion: "1.0.0",
          availableVersion: "1.1.0",
        },
      };
      await settleHealth(harness, index, health);
      expect(harness.hook().toast).toEqual({
        kind: "updateAvailable",
        provider,
        version: "1.1.0",
        manual: true,
      });
      await act(async () => {
        await expect(harness.hook().update(provider, "1.1.0")).resolves.toBe("noUpdateAvailable");
        await expect(harness.hook().dismissUpdate(provider, "1.0.9")).resolves.toBe(false);
        await expect(harness.hook().dismissUpdate(provider, "1.1.0")).resolves.toBe(true);
      });
      expect(harness.dependencies.updateGateway.updateAgentProvider).not.toHaveBeenCalled();
      expect(harness.settings().agentProviderPreferences?.[provider].dismissedUpdateVersion).toBe(
        "1.1.0",
      );
      expect(harness.hook().toast).toBeNull();
      await waitForReact(() => expect(harness.healthCalls).toHaveLength(3));
      await settleHealth(harness, 2, health);
      expect(harness.hook().toast).toBeNull();
      harness.unmount();
    },
  );

  it.each(["claudeCode", "codex"] as const)(
    "offers an installable %s update for a native self-update installation",
    async (provider) => {
      const harness = renderManagement();
      await waitForReact(() => expect(harness.healthCalls).toHaveLength(2));
      const index = harness.healthRequests.findIndex((request) => request.provider === provider);
      const installer = {
        kind: "selfUpdate",
        command: provider === "codex" ? "codexUpdate" : "claudeUpdate",
      } as const;
      const health: AgentProviderHealthProbeResult = {
        ...currentHealth("1.0.0"),
        update: {
          kind: "available",
          installedVersion: "1.0.0",
          availableVersion: "1.1.0",
          installer,
        },
      };
      await settleHealth(harness, index, health);

      expect(harness.hook().toast).toEqual({
        kind: "updateAvailable",
        provider,
        version: "1.1.0",
      });
      expect(harness.hook().providers[provider].health).toMatchObject({
        kind: "ready",
        update: { kind: "available", installer },
      });
      harness.unmount();
    },
  );

  it("publishes only persisted queued selected-provider receipts", async () => {
    const settings = configuredSettings();
    settings.agentCliKind = "codex";
    const firstSave = deferred<void>();
    const secondSave = deferred<void>();
    const harness = renderManagement(settings);
    await waitForReact(() =>
      expect(harness.hook().selectedProviderAuthority).toEqual({
        provider: "codex",
        settingsRevision: 1,
      }),
    );
    vi.mocked(harness.dependencies.settingsGateway.saveAppSettings)
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => secondSave.promise);

    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    act(() => {
      first = harness.hook().save({ provider: "claudeCode", selectedProvider: "claudeCode" });
      second = harness.hook().save({ provider: "codex", selectedProvider: "codex" });
    });
    expect(harness.settings().agentCliKind).toBe("codex");
    expect(harness.hook().selectedProviderAuthority?.provider).toBe("codex");

    await act(async () => firstSave.resolve());
    await expect(first).resolves.toBe(true);
    await waitForReact(() =>
      expect(harness.dependencies.settingsGateway.saveAppSettings).toHaveBeenCalledTimes(2),
    );
    expect(harness.settings().agentCliKind).toBe("codex");
    expect(harness.hook().selectedProviderAuthority).toEqual({
      provider: "claudeCode",
      settingsRevision: 2,
    });

    await act(async () => secondSave.reject(new Error("second failed")));
    await expect(second).resolves.toBe(false);
    expect(harness.settings().agentCliKind).toBe("claudeCode");
    expect(harness.hook().selectedProviderAuthority).toEqual({
      provider: "claudeCode",
      settingsRevision: 2,
    });
    harness.unmount();
  });

  it("reports a registered pathless provider as not configured", async () => {
    const settings = configuredSettings();
    settings.agentCliPaths = { ...settings.agentCliPaths, claudeCode: null };
    const harness = renderManagement(settings);
    await waitForReact(() =>
      expect(harness.dependencies.policyGateway.registerAgentProviderPolicy).toHaveBeenCalledWith(
        expect.objectContaining({ provider: "claudeCode", cliPath: null }),
      ),
    );

    expect(harness.hook().admissionAuthority("claudeCode").disposition).toEqual({
      kind: "policyUnavailable",
      reason: "notConfigured",
    });
    harness.unmount();
  });

  it("coerces hostile update availability when persisted checks are disabled", async () => {
    const settings = configuredSettings();
    settings.agentProviderPreferences = {
      ...settings.agentProviderPreferences,
      claudeCode: {
        ...defaultAgentProviderPreferences().claudeCode,
        checkForUpdates: false,
      },
    };
    const harness = renderManagement(settings);
    await waitForReact(() => expect(harness.healthCalls).toHaveLength(2));
    expect(harness.dependencies.policyGateway.registerAgentProviderPolicy).toHaveBeenCalledWith({
      provider: "claudeCode",
      settingsRevision: 1,
      expectedProviderGeneration: null,
      enabled: true,
      cliPath: PATH_A,
      checkForUpdates: false,
    });
    expect(harness.healthRequests.filter(({ provider }) => provider === "claudeCode")).toEqual([
      { provider: "claudeCode", providerGeneration: 1 },
    ]);
    await settleHealth(harness, 0, availableHealth("1.0.0", "1.1.0"));

    expect(harness.hook().providers.claudeCode.health).toMatchObject({
      kind: "ready",
      update: { kind: "checksDisabled" },
    });
    expect(harness.hook().toast).toBeNull();
    await expect(harness.hook().update("claudeCode", "1.1.0")).resolves.toBe("noUpdateAvailable");
    expect(harness.dependencies.updateGateway.updateAgentProvider).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("retires a stale health owner without disturbing the replacement generation", async () => {
    const harness = renderManagement();
    await waitForReact(() => expect(harness.healthCalls).toHaveLength(2));
    const stale = harness.healthCalls[0];

    let saved!: Promise<boolean>;
    act(() => {
      saved = harness.hook().save({ provider: "claudeCode", cliPath: PATH_B });
    });
    await act(async () => {
      await expect(saved).resolves.toBe(true);
    });
    await waitForReact(() => expect(harness.healthCalls).toHaveLength(3));
    await act(async () => stale?.resolve(availableHealth("1.0.0", "9.0.0")));

    expect(harness.hook().providers.claudeCode.health.kind).toBe("checking");
    expect(harness.hook().toast).toBeNull();
    await settleHealth(harness, 2, currentHealth("2.0.0"));
    expect(harness.hook().providers.claudeCode.health).toMatchObject({
      kind: "ready",
      installedVersion: "2.0.0",
    });
    harness.unmount();
  });

  it("settles a periodic health probe while another provider is reconfigured", async () => {
    vi.useFakeTimers();
    const settings = configuredSettings();
    settings.agentProviderPreferences = {
      ...settings.agentProviderPreferences,
      claudeCode: {
        ...settings.agentProviderPreferences.claudeCode,
        healthCheckIntervalSeconds: 1,
      },
      codex: {
        ...settings.agentProviderPreferences.codex,
        healthCheckIntervalSeconds: 0,
      },
    };
    const harness = renderManagement(settings);
    await act(async () => undefined);
    await act(async () => undefined);
    await settleHealth(harness, 0, currentHealth("1.0.0"));
    await settleHealth(harness, 1, currentHealth("2.0.0"));
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(harness.healthCalls).toHaveLength(3);

    let saved!: Promise<boolean>;
    act(() => {
      saved = harness.hook().save({
        provider: "codex",
        preference: {
          ...settings.agentProviderPreferences.codex,
          checkForUpdates: false,
        },
      });
    });
    await act(async () => {
      await expect(saved).resolves.toBe(true);
    });
    await waitForReact(() => expect(harness.healthCalls).toHaveLength(4));
    await settleHealth(harness, 2, currentHealth("1.0.1"));
    expect(harness.hook().providers.claudeCode.health).toMatchObject({
      kind: "ready",
      installedVersion: "1.0.1",
    });
    await settleHealth(harness, 3, currentHealth("2.0.0"));
    harness.unmount();
  });

  it("reacquires a newer identical backend policy without replacing it", async () => {
    const harness = renderManagement(undefined, undefined, true, (provider) => ({
      kind: "registered",
      receipt: { provider, settingsRevision: 7, providerGeneration: 4 },
      enabled: true,
      cliPath: provider === "claudeCode" ? PATH_A : "/usr/local/bin/codex",
      checkForUpdates: true,
    }));
    await waitForReact(() => expect(harness.healthCalls).toHaveLength(2));

    expect(harness.dependencies.policyGateway.registerAgentProviderPolicy).not.toHaveBeenCalled();
    expect(harness.hook().authority("claudeCode")?.settingsRevision).toBe(7);
    expect(harness.hook().selectedProviderAuthority).toEqual({
      provider: "claudeCode",
      settingsRevision: 1,
    });
    expect(harness.hook().admissionAuthority("claudeCode")).toMatchObject({
      disposition: { kind: "initializing" },
    });
    await settleHealth(harness, 0, currentHealth("1.0.0"));
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
      checkForUpdates: true,
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
      checkForUpdates: true,
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

  it("does not resurrect rejected provider fields when a later updater skip persists", async () => {
    const providerFirst = renderManagement();
    await waitForReact(() => expect(providerFirst.healthCalls).toHaveLength(2));
    const heldProvider = deferred<void>();
    vi.mocked(providerFirst.dependencies.settingsGateway.saveAppSettings)
      .mockImplementationOnce(() => heldProvider.promise)
      .mockResolvedValueOnce(undefined);
    let providerSave!: Promise<boolean>;
    act(() => {
      providerSave = providerFirst.hook().save({ provider: "claudeCode", cliPath: PATH_B });
    });
    await act(async () => undefined);
    const providerCandidate = vi.mocked(providerFirst.dependencies.settingsGateway.saveAppSettings)
      .mock.calls[0]?.[0];
    expect(providerCandidate?.appUpdaterSkippedVersion).toBeNull();
    const skipped = {
      ...providerFirst.settings(),
      appUpdaterSkippedVersion: "0.2.0",
    };
    providerFirst.dependencies.applyAppSettings(skipped);
    const skipSave = appSettingsSaveCoordinatorFor(providerFirst.dependencies.settingsGateway).save(
      skipped,
      (committed) => ({
        ...committed,
        appUpdaterSkippedVersion: "0.2.0",
      }),
    );
    expect(providerFirst.dependencies.settingsGateway.saveAppSettings).toHaveBeenCalledOnce();
    await act(async () => heldProvider.reject(new Error("disk full")));
    await expect(providerSave).resolves.toBe(false);
    await expect(skipSave).resolves.toMatchObject({ appUpdaterSkippedVersion: "0.2.0" });
    expect(
      vi.mocked(providerFirst.dependencies.settingsGateway.saveAppSettings).mock.calls[1]?.[0],
    ).toMatchObject({
      agentCliPaths: { claudeCode: PATH_A, codex: "/usr/local/bin/codex" },
      appUpdaterSkippedVersion: "0.2.0",
    });
    expect(providerFirst.settings()).toMatchObject({
      agentCliPaths: { claudeCode: PATH_A, codex: "/usr/local/bin/codex" },
      appUpdaterSkippedVersion: "0.2.0",
    });
    providerFirst.unmount();
  });

  it("does not persist a rejected updater skip through a later provider save", async () => {
    const skipFirst = renderManagement();
    await waitForReact(() => expect(skipFirst.healthCalls).toHaveLength(2));
    const heldSkip = deferred<void>();
    vi.mocked(skipFirst.dependencies.settingsGateway.saveAppSettings)
      .mockImplementationOnce(() => heldSkip.promise)
      .mockResolvedValueOnce(undefined);
    const beforeSkip = skipFirst.settings();
    const firstSkipped = { ...beforeSkip, appUpdaterSkippedVersion: "0.3.0" };
    skipFirst.dependencies.applyAppSettings(firstSkipped);
    const coordinator = appSettingsSaveCoordinatorFor(skipFirst.dependencies.settingsGateway);
    const firstSkipSave = coordinator.save(beforeSkip, (committed) => ({
      ...committed,
      appUpdaterSkippedVersion: "0.3.0",
    }));
    let laterProviderSave!: Promise<boolean>;
    act(() => {
      laterProviderSave = skipFirst.hook().save({ provider: "claudeCode", cliPath: PATH_B });
    });
    await act(async () => undefined);
    expect(skipFirst.dependencies.settingsGateway.saveAppSettings).toHaveBeenCalledOnce();
    const skipRejection = expect(firstSkipSave).rejects.toThrow("disk full");
    await act(async () => heldSkip.reject(new Error("disk full")));
    await skipRejection;
    skipFirst.dependencies.applyAppSettings({
      ...skipFirst.settings(),
      appUpdaterSkippedVersion: coordinator.committedSnapshot()?.appUpdaterSkippedVersion ?? null,
    });
    await expect(laterProviderSave).resolves.toBe(true);
    expect(
      vi.mocked(skipFirst.dependencies.settingsGateway.saveAppSettings).mock.calls[1]?.[0],
    ).toMatchObject({
      agentCliPaths: { claudeCode: PATH_B, codex: "/usr/local/bin/codex" },
      appUpdaterSkippedVersion: null,
    });
    skipFirst.unmount();
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
    const selectedAuthority = harness.hook().selectedProviderAuthority;

    let save!: Promise<boolean>;
    act(() => {
      save = harness.hook().save({
        provider: "claudeCode",
        cliPath: PATH_B,
        selectedProvider: "codex",
      });
    });
    expect(harness.hook().selectedProviderAuthority).toEqual(selectedAuthority);
    await act(async () => undefined);
    harness.replaceDependencies({
      settingsGateway: { saveAppSettings: vi.fn(async () => undefined) },
    });
    await act(async () => staleSave.resolve());
    await expect(save).resolves.toBe(false);

    expect(harness.settings().agentCliPaths.claudeCode).toBe(PATH_A);
    expect(harness.settings().agentCliKind).toBe("claudeCode");
    expect(harness.hook().authority("claudeCode")?.cliPath).toBe(PATH_A);
    expect(harness.hook().selectedProviderAuthority).toEqual(selectedAuthority);
    expect(
      vi.mocked(harness.dependencies.policyGateway.registerAgentProviderPolicy).mock.calls.length,
    ).toBe(registrationCount);
    expect(harness.errors).toHaveLength(0);
    harness.unmount();
  });

  it("rolls back exact owned fields when a replaced settings gateway rejects", async () => {
    const staleSave = deferred<void>();
    const harness = renderManagement();
    await waitForReact(() => expect(harness.healthCalls).toHaveLength(2));
    vi.mocked(harness.dependencies.settingsGateway.saveAppSettings).mockReturnValueOnce(
      staleSave.promise,
    );
    let save!: Promise<boolean>;
    act(() => {
      save = harness.hook().save({
        provider: "claudeCode",
        cliPath: PATH_B,
        selectedProvider: "codex",
      });
    });
    await act(async () => undefined);
    harness.replaceDependencies({
      settingsGateway: { saveAppSettings: vi.fn(async () => undefined) },
    });
    harness.dependencies.applyAppSettings({ ...harness.settings(), theme: "light" });
    await act(async () => staleSave.reject(new Error("retired gateway")));
    await expect(save).resolves.toBe(false);

    expect(harness.settings().agentCliPaths.claudeCode).toBe(PATH_A);
    expect(harness.settings().agentCliKind).toBe("claudeCode");
    expect(harness.settings().theme).toBe("light");
    expect(harness.errors).toHaveLength(0);
    harness.unmount();
  });

  it("preserves a newer same-provider preference when a replaced path save rejects", async () => {
    const staleSave = deferred<void>();
    const harness = renderManagement();
    await waitForReact(() => expect(harness.healthCalls).toHaveLength(2));
    vi.mocked(harness.dependencies.settingsGateway.saveAppSettings).mockReturnValueOnce(
      staleSave.promise,
    );
    const preference = {
      ...harness.settings().agentProviderPreferences!.claudeCode,
      healthCheckIntervalSeconds: 0,
    };
    let pathSave!: Promise<boolean>;
    let preferenceSave!: Promise<boolean>;
    act(() => {
      pathSave = harness.hook().save({ provider: "claudeCode", cliPath: PATH_B });
      preferenceSave = harness.hook().save({ provider: "claudeCode", preference });
    });
    await act(async () => undefined);
    harness.replaceDependencies({
      settingsGateway: { saveAppSettings: vi.fn(async () => undefined) },
    });
    await act(async () => staleSave.reject(new Error("retired gateway")));
    await expect(pathSave).resolves.toBe(false);
    await expect(preferenceSave).resolves.toBe(true);

    expect(harness.settings().agentCliPaths.claudeCode).toBe(PATH_A);
    expect(harness.settings().agentProviderPreferences?.claudeCode).toEqual(preference);
    harness.unmount();
  });

  it("preserves a newer same-provider path when a replaced preference save rejects", async () => {
    const staleSave = deferred<void>();
    const harness = renderManagement();
    await waitForReact(() => expect(harness.healthCalls).toHaveLength(2));
    vi.mocked(harness.dependencies.settingsGateway.saveAppSettings).mockReturnValueOnce(
      staleSave.promise,
    );
    const preference = {
      ...harness.settings().agentProviderPreferences!.claudeCode,
      healthCheckIntervalSeconds: 0,
    };
    let preferenceSave!: Promise<boolean>;
    let pathSave!: Promise<boolean>;
    act(() => {
      preferenceSave = harness.hook().save({ provider: "claudeCode", preference });
      pathSave = harness.hook().save({ provider: "claudeCode", cliPath: PATH_B });
    });
    await act(async () => undefined);
    harness.replaceDependencies({
      settingsGateway: { saveAppSettings: vi.fn(async () => undefined) },
    });
    await act(async () => staleSave.reject(new Error("retired gateway")));
    await expect(preferenceSave).resolves.toBe(false);
    await expect(pathSave).resolves.toBe(true);

    expect(harness.settings().agentProviderPreferences?.claudeCode.healthCheckIntervalSeconds).toBe(
      300,
    );
    expect(harness.settings().agentCliPaths.claudeCode).toBe(PATH_B);
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
          outputTail: "Installer output withheld (stdout: 0 bytes, stderr: 0 bytes).",
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

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = harness.hook().refresh("claudeCode");
      second = harness.hook().refresh("claudeCode");
    });
    void first;
    void second;
    expect(harness.healthCalls).toHaveLength(2);

    await settleHealth(harness, 0, currentHealth("1.0.0"));
    await settleHealth(harness, 1, currentHealth("2.0.0"));
    await waitForReact(() => expect(harness.healthCalls).toHaveLength(3));
    await settleHealth(harness, 2, currentHealth("1.0.0"));
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(harness.healthCalls).toHaveLength(4);
    harness.unmount();
    await act(async () => vi.runOnlyPendingTimers());
    expect(harness.healthCalls).toHaveLength(4);
  });

  it("retires probes and timers across workspace A to B to A generations", async () => {
    vi.useFakeTimers();
    const settings = configuredSettings();
    settings.agentProviderPreferences = {
      ...settings.agentProviderPreferences,
      claudeCode: {
        ...settings.agentProviderPreferences.claudeCode,
        healthCheckIntervalSeconds: 1,
      },
    };
    const harness = renderManagement(settings);
    await act(async () => undefined);
    await act(async () => undefined);
    expect(harness.healthCalls).toHaveLength(2);
    const staleA = harness.healthCalls[0];

    harness.replaceDependencies({ workspaceGeneration: 1 });
    expect(harness.hook().selectedProviderAuthority).toBeNull();
    await act(async () => undefined);
    await act(async () => undefined);
    expect(harness.healthCalls).toHaveLength(4);
    const staleB = harness.healthCalls[2];

    harness.replaceDependencies({ workspaceGeneration: 2 });
    expect(harness.hook().selectedProviderAuthority).toBeNull();
    await act(async () => undefined);
    await act(async () => undefined);
    expect(harness.healthCalls).toHaveLength(6);
    const currentA = harness.healthCalls[4];
    if (staleA === undefined || staleB === undefined || currentA === undefined) {
      throw new Error("Expected health probes for each workspace generation.");
    }

    await act(async () => staleA.resolve(availableHealth("1.0.0", "9.0.0")));
    await act(async () => staleB.resolve(availableHealth("1.0.0", "8.0.0")));
    expect(harness.hook().toast).toBeNull();
    await act(async () => currentA.resolve(currentHealth("2.0.0")));
    expect(harness.hook().providers.claudeCode.health).toMatchObject({
      kind: "ready",
      installedVersion: "2.0.0",
    });
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(harness.healthCalls).toHaveLength(7);
    harness.unmount();
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

  it("preserves selected authority when the persisted selection cannot register", async () => {
    const harness = renderManagement();
    await waitForReact(() =>
      expect(harness.hook().selectedProviderAuthority).toEqual({
        provider: "claudeCode",
        settingsRevision: 1,
      }),
    );
    vi.mocked(harness.dependencies.policyGateway.registerAgentProviderPolicy).mockRejectedValueOnce(
      "generationConflict",
    );

    let saved!: Promise<boolean>;
    act(() => {
      saved = harness.hook().save({ provider: "codex", selectedProvider: "codex" });
    });
    await act(async () => {
      await expect(saved).resolves.toBe(true);
    });

    expect(harness.settings().agentCliKind).toBe("codex");
    expect(harness.hook().selectedProviderAuthority).toEqual({
      provider: "claudeCode",
      settingsRevision: 1,
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
    await act(async () => {
      await expect(saveB).resolves.toBe(true);
    });

    let saveA!: Promise<boolean>;
    act(() => {
      saveA = harness.hook().save({ provider: "claudeCode", cliPath: PATH_A });
    });
    await act(async () => {
      await expect(saveA).resolves.toBe(true);
    });
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
        checkForUpdates: true,
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
    expect(harness.hook().providers.claudeCode.updateState.kind).toBe("running");
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
    expect(harness.hook().providers.claudeCode.updateState.kind).toBe("running");
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

  it("refuses only the provider whose sign-in session is active", async () => {
    const settings = configuredSettings();
    settings.agentProviderPreferences = {
      claudeCode: {
        ...defaultAgentProviderPreferences().claudeCode,
        checkForUpdates: true,
      },
      codex: {
        ...defaultAgentProviderPreferences().codex,
        checkForUpdates: true,
      },
    };
    const harness = renderManagement(settings);
    harness.replaceDependencies({ signInActive: (provider) => provider === "claudeCode" });
    await waitForReact(() => expect(harness.healthCalls).toHaveLength(2));
    await settleHealth(harness, 0, availableHealth("1.0.0", "1.1.0"));
    await settleHealth(harness, 1, codexAvailableHealth("2.0.0", "2.1.0"));

    expect(harness.hook().providers.claudeCode.signInActive).toBe(true);
    expect(harness.hook().providers.codex.signInActive).toBe(false);
    await act(async () => {
      await expect(harness.hook().update("claudeCode", "1.1.0")).resolves.toBe("signInActive");
      await expect(harness.hook().update("codex", "2.1.0")).resolves.toBeNull();
    });
    expect(harness.dependencies.updateGateway.updateAgentProvider).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "codex" }),
    );
    harness.unmount();
  });

  it("does not let another provider's live turn block an available update", async () => {
    const harness = renderManagement(configuredSettings(), (provider) =>
      provider === "codex" ? 1 : 0,
    );
    await waitForReact(() => expect(harness.healthCalls).toHaveLength(2));
    await settleHealth(harness, 0, availableHealth("1.0.0", "1.1.0"));
    vi.mocked(harness.dependencies.updateGateway.updateAgentProvider).mockResolvedValueOnce({
      kind: "failed",
      reason: "admissionRefused",
      outputTail: "Installer output withheld (stdout: 0 bytes, stderr: 0 bytes).",
      outputTruncated: false,
    });

    let update!: Promise<unknown>;
    await act(async () => {
      update = harness.hook().update("claudeCode", "1.1.0");
      await expect(update).resolves.toBeNull();
    });

    expect(harness.dependencies.updateGateway.updateAgentProvider).toHaveBeenCalledTimes(1);
    harness.unmount();
  });

  it("publishes a bounded failed update tail without re-probing", async () => {
    const harness = renderManagement();
    await waitForReact(() => expect(harness.healthCalls).toHaveLength(2));
    await settleHealth(harness, 0, availableHealth("1.0.0", "1.1.0"));
    vi.mocked(harness.dependencies.updateGateway.updateAgentProvider).mockResolvedValueOnce({
      kind: "failed",
      reason: "exited",
      outputTail: "Installer output withheld (stdout: 42 bytes, stderr: 17 bytes).",
      outputTruncated: false,
    });

    let update!: Promise<unknown>;
    await act(async () => {
      update = harness.hook().update("claudeCode", "1.1.0");
      await expect(update).resolves.toBeNull();
    });

    expect(harness.hook().providers.claudeCode.updateState).toEqual({
      kind: "failed",
      reason: "exited",
      outputTail: "Installer output withheld (stdout: 42 bytes, stderr: 17 bytes).\n",
      outputTruncated: true,
    });
    expect(harness.hook().toast).toEqual({ kind: "updateFailed", provider: "claudeCode" });
    expect(harness.healthCalls).toHaveLength(2);
    harness.unmount();
  });

  it("subscribes before IPC, streams exact ordered progress, and retains the failure tail", async () => {
    const harness = renderManagement();
    await waitForReact(() => expect(harness.healthCalls).toHaveLength(2));
    await settleHealth(harness, 0, availableHealth("1.0.0", "1.1.0"));
    const calls: string[] = [];
    const result = deferred<AgentProviderUpdateResult>();
    const unlisten = vi.fn(() => calls.push("unlisten"));
    let listener: ((event: AgentProviderUpdateProgressEvent) => void) | null = null;
    vi.mocked(harness.dependencies.updateGateway.updateAgentProvider).mockImplementationOnce(
      async () => {
        calls.push("invoke");
        return result.promise;
      },
    );
    harness.dependencies.updateGateway.subscribeAgentProviderUpdateProgress = vi.fn(
      async (next) => {
        calls.push("listen");
        listener = next;
        return unlisten;
      },
    );

    let update!: Promise<unknown>;
    act(() => {
      update = harness.hook().update("claudeCode", "1.1.0");
    });
    await waitForReact(() => expect(calls).toEqual(["listen", "invoke"]));
    expect(harness.hook().providers.claudeCode.updateState.kind).toBe("running");

    act(() => {
      listener?.({
        provider: "codex",
        providerGeneration: 1,
        operationId: "claudeCode-update",
        sequence: 1,
        stream: "stdout",
        data: "Installer stdout activity: 17 bytes.",
        truncated: false,
        redacted: true,
      });
      listener?.({
        provider: "claudeCode",
        providerGeneration: 2,
        operationId: "claudeCode-update",
        sequence: 1,
        stream: "stdout",
        data: "Installer stdout activity: 19 bytes.",
        truncated: false,
        redacted: true,
      });
      listener?.({
        provider: "claudeCode",
        providerGeneration: 1,
        operationId: "different-operation",
        sequence: 1,
        stream: "stdout",
        data: "Installer stdout activity: 18 bytes.",
        truncated: false,
        redacted: true,
      });
      listener?.({
        provider: "claudeCode",
        providerGeneration: 1,
        operationId: "claudeCode-update",
        sequence: 1,
        stream: "stdout",
        data: "Installer stdout activity: 17 bytes.",
        truncated: false,
        redacted: true,
      });
    });
    expect(harness.hook().providers.claudeCode.updateState).toMatchObject({
      kind: "running",
      outputTail: "Installer stdout activity: 17 bytes.\n",
      outputTruncated: false,
    });

    act(() => {
      listener?.({
        provider: "claudeCode",
        providerGeneration: 1,
        operationId: "claudeCode-update",
        sequence: 3,
        stream: "stderr",
        data: "Installer stderr activity: 17 bytes.",
        truncated: false,
        redacted: true,
      });
    });
    expect(harness.hook().providers.claudeCode.updateState).toMatchObject({
      kind: "running",
      outputTail: "Installer stdout activity: 17 bytes.\n",
      outputTruncated: true,
    });

    await act(async () =>
      result.resolve({
        kind: "failed",
        reason: "exited",
        outputTail: "Installer output withheld (stdout: 0 bytes, stderr: 17 bytes).",
        outputTruncated: false,
      }),
    );
    await expect(update).resolves.toBeNull();
    expect(harness.hook().providers.claudeCode.updateState).toEqual({
      kind: "failed",
      reason: "exited",
      outputTail:
        "Installer stdout activity: 17 bytes.\nInstaller output withheld (stdout: 0 bytes, stderr: 17 bytes).\n",
      outputTruncated: true,
    });
    expect(unlisten).toHaveBeenCalledTimes(1);
    harness.unmount();
  });

  it("cleans the active progress listener when its gateway authority is replaced", async () => {
    const harness = renderManagement();
    await waitForReact(() => expect(harness.healthCalls).toHaveLength(2));
    await settleHealth(harness, 0, availableHealth("1.0.0", "1.1.0"));
    const result = deferred<AgentProviderUpdateResult>();
    const unlisten = vi.fn();
    harness.dependencies.updateGateway.subscribeAgentProviderUpdateProgress = vi.fn(
      async () => unlisten,
    );
    vi.mocked(harness.dependencies.updateGateway.updateAgentProvider).mockReturnValueOnce(
      result.promise,
    );

    let update!: Promise<unknown>;
    act(() => {
      update = harness.hook().update("claudeCode", "1.1.0");
    });
    await waitForReact(() =>
      expect(harness.dependencies.updateGateway.updateAgentProvider).toHaveBeenCalledTimes(1),
    );
    harness.replaceDependencies({
      updateGateway: {
        updateAgentProvider: vi.fn(async () => ({
          kind: "failed" as const,
          reason: "uncertain" as const,
          outputTail: "Installer output withheld (stdout: 0 bytes, stderr: 0 bytes).",
          outputTruncated: false,
        })),
      },
    });
    expect(unlisten).toHaveBeenCalledTimes(1);

    await act(async () =>
      result.resolve({
        kind: "succeeded",
        previousVersion: "1.0.0",
        installedVersion: "1.1.0",
      }),
    );
    await expect(update).resolves.toBeNull();
    expect(unlisten).toHaveBeenCalledTimes(1);
    harness.unmount();
  });

  it("unlistens a late subscription that resolves after unmount without invoking", async () => {
    const harness = renderManagement();
    await waitForReact(() => expect(harness.healthCalls).toHaveLength(2));
    await settleHealth(harness, 0, availableHealth("1.0.0", "1.1.0"));
    const subscription = deferred<() => void>();
    const unlisten = vi.fn();
    harness.dependencies.updateGateway.subscribeAgentProviderUpdateProgress = vi.fn(
      async () => subscription.promise,
    );

    let update!: Promise<unknown>;
    act(() => {
      update = harness.hook().update("claudeCode", "1.1.0");
    });
    await waitForReact(() =>
      expect(
        harness.dependencies.updateGateway.subscribeAgentProviderUpdateProgress,
      ).toHaveBeenCalledTimes(1),
    );
    harness.unmount();
    subscription.resolve(unlisten);
    await expect(update).resolves.toBeNull();
    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(harness.dependencies.updateGateway.updateAgentProvider).not.toHaveBeenCalled();
  });

  it("keeps backend settlement truthful when the progress listener cannot start", async () => {
    const harness = renderManagement();
    await waitForReact(() => expect(harness.healthCalls).toHaveLength(2));
    await settleHealth(harness, 0, availableHealth("1.0.0", "1.1.0"));
    harness.dependencies.updateGateway.subscribeAgentProviderUpdateProgress = vi.fn(async () => {
      throw new Error("listen failed");
    });
    vi.mocked(harness.dependencies.updateGateway.updateAgentProvider).mockResolvedValueOnce({
      kind: "succeeded",
      previousVersion: "1.0.0",
      installedVersion: "1.1.0",
    });

    let update!: Promise<unknown>;
    act(() => {
      update = harness.hook().update("claudeCode", "1.1.0");
    });
    await waitForReact(() => expect(harness.healthCalls).toHaveLength(3));
    await settleHealth(harness, 2, currentHealth("1.1.0"));
    await expect(update).resolves.toBeNull();
    expect(harness.hook().providers.claudeCode.updateState).toMatchObject({
      kind: "succeeded",
      installedVersion: "1.1.0",
    });
    expect(harness.errors).toEqual([
      { source: "Agent provider update progress", error: expect.any(Error) },
    ]);
    harness.unmount();
  });

  it("does not let a never-settling progress subscription block the update IPC", async () => {
    vi.useFakeTimers();
    const harness = renderManagement();
    await act(async () => undefined);
    expect(harness.healthCalls).toHaveLength(2);
    await settleHealth(harness, 0, availableHealth("1.0.0", "1.1.0"));
    harness.dependencies.updateGateway.subscribeAgentProviderUpdateProgress = vi.fn(
      () => new Promise<() => void>(() => undefined),
    );
    vi.mocked(harness.dependencies.updateGateway.updateAgentProvider).mockResolvedValueOnce({
      kind: "failed",
      reason: "timedOut",
      outputTail: "Installer output withheld (stdout: 0 bytes, stderr: 0 bytes).",
      outputTruncated: false,
    });

    let update!: Promise<unknown>;
    act(() => {
      update = harness.hook().update("claudeCode", "1.1.0");
    });
    expect(harness.dependencies.updateGateway.updateAgentProvider).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    await expect(update).resolves.toBeNull();
    expect(harness.dependencies.updateGateway.updateAgentProvider).toHaveBeenCalledTimes(1);
    expect(harness.hook().providers.claudeCode.updateState).toMatchObject({
      kind: "failed",
      reason: "timedOut",
      outputTruncated: true,
    });
    expect(harness.errors[0]?.source).toBe("Agent provider update progress");
    harness.unmount();
  });

  it("still invokes and re-probes when progress fails during listener establishment", async () => {
    const harness = renderManagement();
    await waitForReact(() => expect(harness.healthCalls).toHaveLength(2));
    await settleHealth(harness, 0, availableHealth("1.0.0", "1.1.0"));
    harness.dependencies.updateGateway.subscribeAgentProviderUpdateProgress = vi.fn(
      async (_listener, onError) => {
        onError(new TypeError("malformed first progress event"));
        return vi.fn();
      },
    );
    vi.mocked(harness.dependencies.updateGateway.updateAgentProvider).mockResolvedValueOnce({
      kind: "succeeded",
      previousVersion: "1.0.0",
      installedVersion: "1.1.0",
    });

    let update!: Promise<unknown>;
    act(() => {
      update = harness.hook().update("claudeCode", "1.1.0");
    });
    await waitForReact(() =>
      expect(harness.dependencies.updateGateway.updateAgentProvider).toHaveBeenCalledTimes(1),
    );
    await waitForReact(() => expect(harness.healthCalls).toHaveLength(3));
    await settleHealth(harness, 2, currentHealth("1.1.0"));
    await expect(update).resolves.toBeNull();
    expect(harness.hook().providers.claudeCode.updateState.kind).toBe("succeeded");
    expect(harness.errors[0]?.source).toBe("Agent provider update progress");
    harness.unmount();
  });

  it("retains streamed diagnostics when post-update version verification fails", async () => {
    const harness = renderManagement();
    await waitForReact(() => expect(harness.healthCalls).toHaveLength(2));
    await settleHealth(harness, 0, availableHealth("1.0.0", "1.1.0"));
    const result = deferred<AgentProviderUpdateResult>();
    let listener: ((event: AgentProviderUpdateProgressEvent) => void) | null = null;
    harness.dependencies.updateGateway.subscribeAgentProviderUpdateProgress = vi.fn(
      async (next) => {
        listener = next;
        return vi.fn();
      },
    );
    vi.mocked(harness.dependencies.updateGateway.updateAgentProvider).mockReturnValueOnce(
      result.promise,
    );

    let update!: Promise<unknown>;
    act(() => {
      update = harness.hook().update("claudeCode", "1.1.0");
    });
    await waitForReact(() => expect(listener).not.toBeNull());
    act(() => {
      listener?.({
        provider: "claudeCode",
        providerGeneration: 1,
        operationId: "claudeCode-update",
        sequence: 1,
        stream: "stderr",
        data: "Installer stderr activity: 27 bytes.",
        truncated: false,
        redacted: true,
      });
    });
    await act(async () =>
      result.resolve({
        kind: "succeeded",
        previousVersion: "1.0.0",
        installedVersion: "1.1.0",
      }),
    );
    await waitForReact(() => expect(harness.healthCalls).toHaveLength(3));
    await settleHealth(harness, 2, currentHealth("1.0.0"));
    await expect(update).resolves.toBeNull();
    expect(harness.hook().providers.claudeCode.updateState).toEqual({
      kind: "failed",
      reason: "versionMismatch",
      outputTail: "Installer stderr activity: 27 bytes.\n",
      outputTruncated: false,
    });
    harness.unmount();
  });

  it("runs a local fake transport through parsing, orchestration, and the visible progress tail", async () => {
    const result = deferred<unknown>();
    let rawListener: ((event: { readonly payload: unknown }) => void) | null = null;
    const listenToProgress: ListenToAgentProviderUpdateProgress = async (_event, listener) => {
      rawListener = listener;
      return () => undefined;
    };
    const invoke = vi.fn(async () => result.promise);
    const gateway = new TauriAgentProviderGateway(invoke, () => true, listenToProgress);
    const harness = renderManagement(configuredSettings(), () => 0, true, undefined, {
      updateGateway: gateway,
      renderCard: true,
    });
    await waitForReact(() => expect(harness.healthCalls).toHaveLength(2));
    await settleHealth(harness, 0, availableHealth("1.0.0", "1.1.0"));
    expect(harness.hook().toast).toEqual({
      kind: "updateAvailable",
      provider: "claudeCode",
      version: "1.1.0",
    });

    let update!: Promise<unknown>;
    act(() => {
      update = harness.hook().update("claudeCode", "1.1.0");
    });
    await waitForReact(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(rawListener).not.toBeNull();
    act(() => {
      rawListener?.({
        payload: {
          provider: "claudeCode",
          providerGeneration: 1,
          operationId: "claudeCode-update",
          sequence: 1,
          stream: "stdout",
          data: "Installer stdout activity: 32 bytes.",
          truncated: false,
          redacted: true,
        },
      });
    });
    expect(harness.container.textContent).toContain("Installer stdout activity: 32 bytes.");
    expect(harness.container.textContent).toContain("Installing update");
    act(() => {
      for (let sequence = 2; sequence <= 1_000; sequence += 1) {
        rawListener?.({
          payload: {
            provider: "claudeCode",
            providerGeneration: 1,
            operationId: "claudeCode-update",
            sequence,
            stream: "stdout",
            data: "Installer stdout activity: 4096 bytes.",
            truncated: false,
            redacted: true,
          },
        });
      }
    });
    const running = harness.hook().providers.claudeCode.updateState;
    expect(running.kind).toBe("running");
    if (running.kind !== "running") throw new Error("Expected running update progress.");
    expect(new TextEncoder().encode(running.outputTail).byteLength).toBeLessThanOrEqual(32 * 1024);
    expect(running.outputTail).not.toContain("�");
    expect(running.outputTruncated).toBe(true);

    await act(async () =>
      result.resolve({
        kind: "succeeded",
        previousVersion: "1.0.0",
        installedVersion: "1.1.0",
      }),
    );
    await waitForReact(() => expect(harness.healthCalls).toHaveLength(3));
    await settleHealth(harness, 2, currentHealth("1.1.0"));
    await expect(update).resolves.toBeNull();
    expect(harness.container.textContent).toContain("Updated from 1.0.0 to 1.1.0");
    harness.unmount();
  });

  it("retains only opaque streamed activity and the opaque failed-result summary end to end", async () => {
    const result = deferred<unknown>();
    let rawListener: ((event: { readonly payload: unknown }) => void) | null = null;
    const gateway = new TauriAgentProviderGateway(
      vi.fn(async () => result.promise),
      () => true,
      async (_event, listener) => {
        rawListener = listener;
        return () => undefined;
      },
    );
    const harness = renderManagement(configuredSettings(), () => 0, true, undefined, {
      updateGateway: gateway,
      renderCard: true,
    });
    await waitForReact(() => expect(harness.healthCalls).toHaveLength(2));
    await settleHealth(harness, 0, availableHealth("1.0.0", "1.1.0"));

    let update!: Promise<unknown>;
    act(() => {
      update = harness.hook().update("claudeCode", "1.1.0");
    });
    await waitForReact(() => expect(rawListener).not.toBeNull());
    act(() => {
      rawListener?.({
        payload: {
          provider: "claudeCode",
          providerGeneration: 1,
          operationId: "claudeCode-update",
          sequence: 1,
          stream: "stderr",
          data: "Installer stderr activity: 128 bytes.",
          truncated: false,
          redacted: true,
        },
      });
      for (let sequence = 2; sequence <= 839; sequence += 1) {
        rawListener?.({
          payload: {
            provider: "claudeCode",
            providerGeneration: 1,
            operationId: "claudeCode-update",
            sequence,
            stream: "stdout",
            data: "Installer stdout activity: 4096 bytes.",
            truncated: false,
            redacted: true,
          },
        });
      }
    });
    expect(harness.hook().providers.claudeCode.updateState).toMatchObject({
      kind: "running",
      outputTruncated: false,
    });
    await act(async () =>
      result.resolve({
        kind: "failed",
        reason: "exited",
        outputTail: "Installer output withheld (stdout: 0 bytes, stderr: 128 bytes).",
        outputTruncated: false,
      }),
    );
    await expect(update).resolves.toBeNull();
    const text = harness.container.textContent ?? "";
    expect(text).toContain("Installer stdout activity: 4096 bytes.");
    expect(text).toContain("Installer output withheld (stdout: 0 bytes, stderr: 128 bytes).");
    expect(harness.hook().providers.claudeCode.updateState).toMatchObject({
      outputTail: expect.stringMatching(/^Installer (?:stdout|stderr) activity:/),
    });
    expect(harness.hook().providers.claudeCode.updateState).toMatchObject({
      kind: "failed",
      outputTruncated: true,
    });
    expect(text).not.toMatch(/password|AWS_|Cookie:|pid=|argv=|HOME=|\/Users\//);
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
    expect(harness.hook().providers.claudeCode.updateState.kind).toBe("running");
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
        checkForUpdates: true,
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
    expect(harness.errors.some(({ source }) => source === "Agent provider settings")).toBe(true);
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
    await waitForReact(() => expect(harness.healthCalls).toHaveLength(3));
    await settleHealth(harness, 2, availableHealth("1.0.0", "1.1.0"));
    expect(harness.hook().toast).toBeNull();

    let refreshed!: Promise<void>;
    act(() => {
      refreshed = harness.hook().refresh("claudeCode");
    });
    await waitForReact(() => expect(harness.healthCalls).toHaveLength(4));
    await settleHealth(harness, 3, availableHealth("1.0.0", "1.2.0"));
    await expect(refreshed).resolves.toBeUndefined();
    expect(harness.hook().toast).toEqual({
      kind: "updateAvailable",
      provider: "claudeCode",
      version: "1.2.0",
    });
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
  options: {
    readonly discoveryGateway?: AgentCliDiscoveryGateway;
    readonly updateGateway?: AgentProviderUpdateGateway;
    readonly renderCard?: boolean;
    readonly strict?: boolean;
  } = {},
): Harness {
  let settings = initialSettings;
  let hook: AgentProviderManagementSurface | null = null;
  const healthCalls: Array<Deferred<AgentProviderHealthProbeResult>> = [];
  const healthRequests: AgentProviderGenerationRequest[] = [];
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
      probeAgentProviderHealth: vi.fn((request) => {
        healthRequests.push(request);
        const call = deferred<AgentProviderHealthProbeResult>();
        healthCalls.push(call);
        return call.promise;
      }),
    },
    updateGateway: options.updateGateway ?? {
      updateAgentProvider: vi.fn(async () => ({
        kind: "failed" as const,
        reason: "uncertain" as const,
        outputTail: "Installer output withheld (stdout: 0 bytes, stderr: 0 bytes).",
        outputTruncated: false,
      })),
    },
    discoveryGateway: options.discoveryGateway ?? {
      discoverAgentClis: vi.fn(async () => ({
        claudeCode: { kind: "notFound" as const },
        codex: { kind: "notFound" as const },
      })),
    },
    liveTurnCount,
    signInActive: () => false,
    reportError: (source, error) => errors.push({ source, error }),
    mintOperationId: (provider) => `${provider}-update`,
    settingsHydrated,
    workspaceGeneration: 0,
  };
  let currentDependencies = dependencies;
  const container = document.createElement("div");
  const root = createRoot(container);

  function Hook() {
    hook = useAgentProviderManagement(currentDependencies);
    if (!options.renderCard) return null;
    const preference = preferencesForTest(settings).claudeCode;
    return createElement(AgentProviderSettingsCard, {
      management: hook,
      path: settings.agentCliPaths.claudeCode,
      presentation: hook.providers.claudeCode.executable,
      preference,
      provider: "claudeCode",
      onChangeEnabled: () => undefined,
      onChangeHealthCheckIntervalSeconds: () => undefined,
      onChangePath: () => undefined,
      onCopyInstallCommand: () => undefined,
    });
  }

  const hookElement = createElement(Hook);
  act(() =>
    root.render(options.strict ? createElement(StrictMode, null, hookElement) : hookElement),
  );
  return {
    container,
    settings: () => settings,
    hook: () => {
      if (hook === null) throw new Error("Hook did not render.");
      return hook;
    },
    dependencies,
    healthCalls,
    healthRequests,
    errors,
    replaceDependencies: (replacement) => {
      currentDependencies = { ...currentDependencies, ...replacement };
      act(() => root.render(createElement(Hook)));
      return currentDependencies;
    },
    unmount: () => act(() => root.unmount()),
  };
}

function preferencesForTest(settings: AppSettings) {
  return settings.agentProviderPreferences ?? defaultAgentProviderPreferences();
}

function configuredSettings(): AppSettings {
  const defaults = defaultAgentProviderPreferences();
  return {
    ...defaultAppSettings(),
    agentCliPaths: { claudeCode: PATH_A, codex: "/usr/local/bin/codex" },
    agentProviderPreferences: {
      claudeCode: { ...defaults.claudeCode, checkForUpdates: true },
      codex: { ...defaults.codex, checkForUpdates: true },
    },
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
