import { describe, expect, it, vi } from "vitest";
import type {
  AgentProviderCurrentPolicyResult,
  AgentProviderHealthGateway,
  AgentProviderHealthProbeResult,
  AgentProviderPolicyGateway,
  AgentProviderPolicyRegistrationReceipt,
  AgentProviderUpdateGateway,
} from "../../domain/agentProviderHealth";
import { defaultAgentProviderPreferences } from "../../domain/agentProviderSettings";
import type { AgentCliKind } from "../../domain/agentTask";
import { defaultAppSettings, type AppSettings } from "../../domain/settings";
import type { AgentCliDiscoveryPublication } from "../useAgentCliDiscovery";
import type {
  AgentProviderManagementDependencies,
  AgentProviderManagementToast,
  SelectedAgentProviderAuthorityPublication,
} from "./agentProviderManagementContract";
import { createAgentProviderManagementCoordinator } from "./agentProviderManagementCoordinator";
import type { ToastUpdate } from "./agentProviderManagementState";
import {
  admissionAuthorityFor,
  currentSelectedProviderAuthority,
  initialRuntime,
  policyRegistrationFailureReason,
  registeredRuntime,
  stillOffers,
  updateRefusal,
  updateSettlementDisagreement,
  type ProviderRuntime,
  type ProviderRuntimeRecord,
} from "./agentProviderRuntime";

const PREFERENCES = defaultAgentProviderPreferences();
const NPM = { kind: "npm", packageName: "@anthropic-ai/claude-code" } as const;

function settings(): AppSettings {
  return {
    ...defaultAppSettings(),
    agentCliPaths: { claudeCode: "/bin/claude", codex: "/bin/codex" },
    agentProviderPreferences: PREFERENCES,
  };
}

function registered(patch: Partial<ProviderRuntime> = {}): ProviderRuntime {
  return {
    configurationRevision: 3,
    healthGeneration: 1,
    policy: { kind: "registered", settingsRevision: 2, providerGeneration: 7 },
    health: {
      kind: "ready",
      installedVersion: "1.0.0",
      auth: { kind: "unknown" },
      update: {
        kind: "available",
        installedVersion: "1.0.0",
        availableVersion: "1.1.0",
        installer: NPM,
      },
      checkedAtEpochMs: 1,
    },
    updateState: { kind: "idle" },
    ...patch,
  };
}

function probe(version: string | null, available?: string): AgentProviderHealthProbeResult {
  return {
    installedVersion: version,
    auth: { kind: "unknown" },
    update:
      available === undefined
        ? { kind: "current", installedVersion: version ?? "" }
        : {
            kind: "available",
            installedVersion: version ?? "",
            availableVersion: available,
            installer: NPM,
          },
    checkedAtEpochMs: 1,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

describe("agent provider runtime policies", () => {
  it("projects admission dispositions in fail-closed order", () => {
    const authorities = {
      claudeCode: {
        provider: "claudeCode" as const,
        settingsRevision: 2,
        preference: PREFERENCES.claudeCode,
        cliPath: "/bin/claude",
      },
    };
    const runtime = (provider: ProviderRuntime): ProviderRuntimeRecord => ({
      ...initialRuntime(),
      claudeCode: provider,
    });
    const disposition = (provider: ProviderRuntime, withAuthority = true) =>
      admissionAuthorityFor("claudeCode", withAuthority ? authorities : {}, runtime(provider), null)
        .disposition.kind;

    expect(disposition(registered({ health: { kind: "disabled" } }))).toBe("disabled");
    expect(disposition(registered(), false)).toBe("policyUnavailable");
    expect(disposition(registered({ health: { kind: "checking", generation: 2 } }))).toBe(
      "initializing",
    );
    expect(disposition(registered({ updateState: { kind: "starting", operationId: "op" } }))).toBe(
      "updating",
    );
    expect(disposition(registered())).toBe("ready");
  });

  it("orders update refusals and settlement disagreements deterministically", () => {
    const current = settings();
    expect(updateRefusal("claudeCode", current, registered(), false, 0, false)).toBe(
      "notConfigured",
    );
    expect(updateRefusal("claudeCode", current, registered(), true, 1, true)).toBe("turnActive");
    expect(updateRefusal("claudeCode", current, registered(), true, 0, true)).toBe("signInActive");
    expect(updateRefusal("claudeCode", current, registered(), true, 0, false)).toBeNull();
    expect(updateSettlementDisagreement(null, "1.1.0")).toBe("uncertain");
    expect(updateSettlementDisagreement(probe("1.0.0"), "1.1.0")).toBe("versionMismatch");
    expect(updateSettlementDisagreement(probe("1.1.0"), "1.1.0")).toBeNull();
    expect(stillOffers(probe("1.0.0", "1.1.0"), "1.1.0")).toBe(true);
    expect(stillOffers(probe("1.0.0", "1.2.0"), "1.1.0")).toBe(false);
    expect(policyRegistrationFailureReason("staleRevision")).toBe("staleRevision");
    expect(policyRegistrationFailureReason(new Error("x"))).toBe("registrationFailed");
  });

  it("ignores a registration receipt for a superseded configuration revision", () => {
    const current = registered({ policy: { kind: "registering", settingsRevision: 4 } });
    const receipt = { settingsRevision: 4, providerGeneration: 9 };
    expect(registeredRuntime(current, 2, receipt)).toBe(current);
    expect(registeredRuntime(current, 3, receipt).policy).toEqual({
      kind: "registered",
      settingsRevision: 4,
      providerGeneration: 9,
    });
  });

  it("withholds a selected-provider publication minted for other gateways", () => {
    const policyGateway = {} as AgentProviderPolicyGateway;
    const healthGateway = {} as AgentProviderHealthGateway;
    const updateGateway = {} as AgentProviderUpdateGateway;
    const publication: SelectedAgentProviderAuthorityPublication = {
      provider: "codex",
      settingsRevision: 5,
      policyGateway,
      healthGateway,
      updateGateway,
    };
    expect(
      currentSelectedProviderAuthority(
        publication,
        true,
        policyGateway,
        healthGateway,
        updateGateway,
      ),
    ).toEqual({ provider: "codex", settingsRevision: 5 });
    expect(
      currentSelectedProviderAuthority(
        publication,
        true,
        {} as AgentProviderPolicyGateway,
        healthGateway,
        updateGateway,
      ),
    ).toBeNull();
    expect(
      currentSelectedProviderAuthority(
        publication,
        false,
        policyGateway,
        healthGateway,
        updateGateway,
      ),
    ).toBeNull();
  });
});

interface CoordinatorHarness {
  readonly coordinator: ReturnType<typeof createAgentProviderManagementCoordinator>;
  readonly runtime: () => ProviderRuntimeRecord;
  readonly selected: () => SelectedAgentProviderAuthorityPublication | null;
  readonly toast: () => AgentProviderManagementToast | null;
  readonly registrations: Array<{
    readonly provider: AgentCliKind;
    readonly settle: (receipt: AgentProviderPolicyRegistrationReceipt) => void;
  }>;
}

function coordinatorHarness(): CoordinatorHarness {
  let runtime = initialRuntime();
  let selected: SelectedAgentProviderAuthorityPublication | null = null;
  let toast: AgentProviderManagementToast | null = null;
  const registrations: CoordinatorHarness["registrations"] = [];
  const appSettingsRef = { current: settings() };
  const dependencies: AgentProviderManagementDependencies = {
    appSettingsRef,
    applyAppSettings: (next) => {
      appSettingsRef.current = next;
    },
    settingsGateway: { saveAppSettings: vi.fn(async () => undefined) },
    policyGateway: {
      currentAgentProviderPolicy: vi.fn(async (): Promise<AgentProviderCurrentPolicyResult> => ({
        kind: "unregistered",
      })),
      registerAgentProviderPolicy: vi.fn((request) => {
        const receipt = deferred<AgentProviderPolicyRegistrationReceipt>();
        registrations.push({ provider: request.provider, settle: receipt.resolve });
        return receipt.promise;
      }),
    },
    healthGateway: {
      checkAgentProviderUpdates: vi.fn(),
      probeAgentProviderHealth: vi.fn(() => new Promise<AgentProviderHealthProbeResult>(() => {})),
    },
    updateGateway: { updateAgentProvider: vi.fn() },
    discoveryGateway: { discoverAgentClis: vi.fn() },
    liveTurnCount: () => 0,
    signInActive: () => false,
    reportError: vi.fn(),
    mintOperationId: (provider) => `${provider}-op`,
    settingsHydrated: true,
  };
  const discovery = {
    read: (): AgentCliDiscoveryPublication | null => null,
    refresh: async (): Promise<AgentCliDiscoveryPublication | null> => null,
    currentGeneration: () => 0,
  };
  const coordinator = createAgentProviderManagementCoordinator(dependencies, discovery, {
    setRuntime: (next) => {
      runtime = next;
    },
    setToast: (update: ToastUpdate) => {
      toast = typeof update === "function" ? update(toast) : update;
    },
    setSelectedProviderAuthorityPublication: (next) => {
      selected = next;
    },
  });
  return {
    coordinator,
    runtime: () => runtime,
    selected: () => selected,
    toast: () => toast,
    registrations,
  };
}

describe("agent provider management coordinator", () => {
  it("registers both providers on activation and publishes the selected authority", async () => {
    const harness = coordinatorHarness();
    harness.coordinator.activate(true, { current: settings() });
    await settle();
    expect(harness.registrations.map((registration) => registration.provider)).toEqual([
      "claudeCode",
      "codex",
    ]);
    expect(harness.runtime().claudeCode.policy.kind).toBe("registering");

    for (const registration of harness.registrations) {
      registration.settle({
        provider: registration.provider,
        settingsRevision: 1,
        providerGeneration: 1,
      });
    }
    await settle();

    expect(harness.runtime().claudeCode.policy).toEqual({
      kind: "registered",
      settingsRevision: 1,
      providerGeneration: 1,
    });
    expect(harness.selected()?.provider).toBe(settings().agentCliKind);
    expect(harness.coordinator.authority("claudeCode")?.cliPath).toBe("/bin/claude");
  });

  it("drops a registration that settles after the activation was torn down", async () => {
    const harness = coordinatorHarness();
    const deactivate = harness.coordinator.activate(true, { current: settings() });
    await settle();
    deactivate();
    for (const registration of harness.registrations) {
      registration.settle({
        provider: registration.provider,
        settingsRevision: 1,
        providerGeneration: 1,
      });
    }
    await settle();

    expect(harness.runtime().claudeCode.policy.kind).toBe("registering");
    expect(harness.selected()).toBeNull();
    expect(harness.coordinator.authority("claudeCode")).toBeNull();
  });

  it("rejects settings saves before hydration", async () => {
    const harness = coordinatorHarness();
    await expect(
      harness.coordinator.saveWithOutcome({ provider: "codex", cliPath: "/bin/other" }),
    ).resolves.toEqual({ kind: "rejected", reason: "notHydrated" });
    harness.coordinator.dismissToast();
    expect(harness.toast()).toBeNull();
  });
});
