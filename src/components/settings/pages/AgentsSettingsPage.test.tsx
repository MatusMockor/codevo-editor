// @vitest-environment jsdom

import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProviderManagementSurface } from "../../../application/useAgentProviderManagement";
import type { AgentProviderSignInSurface } from "../../../application/useAgentProviderSignIn";
import { defaultAgentProviderPreferences } from "../../../domain/agentProviderSettings";
import { defaultAgentCliDiscoveryResult } from "../../../domain/agentSettings";
import {
  defaultAppSettings,
  defaultWorkspaceSettings,
  normalizeAppSettings,
  type AppSettings,
  type WorkspaceSettings,
} from "../../../domain/settings";
import type {
  SettingsDraft,
  SettingsDraftActions,
  SettingsEnvironment,
} from "../settingsPageProps";
import { settingsRowsForSection } from "../settingsRegistry";
import { AgentsSettingsPage } from "./AgentsSettingsPage";

interface HarnessOptions {
  readonly appSettings?: AppSettings;
  readonly hasWorkspace?: boolean;
  readonly management?: AgentProviderManagementSurface | null;
  readonly signIn?: AgentProviderSignInSurface | null;
  readonly workspaceSettings?: WorkspaceSettings;
  onCopyInstallCommand?(command: string): void;
  onPublishAppSettings?(settings: AppSettings): void;
  onUpdateAppSettings?(settings: AppSettings): void;
  onUpdateWorkspaceSettings?(settings: WorkspaceSettings): void;
}

describe("AgentsSettingsPage", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it("renders exactly the agents registry rows in their registry order", () => {
    render();

    const rendered = [...host.querySelectorAll("[data-settings-row]")].map((element) =>
      element.getAttribute("data-settings-row"),
    );

    expect(rendered).toEqual(settingsRowsForSection("agents").map((row) => row.id));
    expect(host.querySelector("h2")?.textContent).toBe("Agents");
  });

  it("states that update checks are automatic instead of offering a dead toggle", () => {
    render();

    const row = host.querySelector('[data-settings-row="agents.checkCliUpdates"]');

    expect(row?.textContent).toContain("Update checks run automatically for enabled providers");
    expect(row?.querySelector('[role="switch"]')).toBeNull();
  });

  it("applies the health check interval to both providers and notes a divergence", () => {
    const onPublishAppSettings = vi.fn();
    const onUpdateAppSettings = vi.fn();
    const preferences = defaultAgentProviderPreferences();

    render({
      appSettings: {
        ...defaultAppSettings(),
        agentProviderPreferences: {
          ...preferences,
          codex: { ...preferences.codex, healthCheckIntervalSeconds: 60 },
        },
      },
      onPublishAppSettings,
      onUpdateAppSettings,
    });

    expect(host.textContent).toContain("Codex still uses 60 seconds until the next change.");
    expect(intervalInput().value).toBe("300");

    setNumber(intervalInput(), "999999");

    const settings = lastCall(onPublishAppSettings);

    expect(settings.agentProviderPreferences?.claudeCode.healthCheckIntervalSeconds).toBe(86_400);
    expect(settings.agentProviderPreferences?.codex.healthCheckIntervalSeconds).toBe(86_400);
    expect(onUpdateAppSettings).not.toHaveBeenCalled();
  });

  it("reports the oldest provider check and refreshes both providers", () => {
    const management = providerManagement();

    render({ management });

    expect(host.textContent).toContain("Checked");

    act(() => byLabel("Refresh provider status").click());

    expect(management.refresh).toHaveBeenCalledWith("claudeCode");
    expect(management.refresh).toHaveBeenCalledWith("codex");
  });

  it("ages the relative timestamp on a bounded clock and cleans up the timer", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T12:00:00Z"));

    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");

    render({ management: providerManagement({ checkedAtEpochMs: Date.now() }) });

    expect(host.textContent).toContain("Checked just now");

    act(() => vi.advanceTimersByTime(60_000));

    expect(host.textContent).toContain("Checked 1m ago");

    act(() => root.unmount());

    expect(clearIntervalSpy).toHaveBeenCalled();

    root = createRoot(host);
  });

  it("clears favorites with the next persisted revision", () => {
    const onUpdateAppSettings = vi.fn();

    render({
      appSettings: {
        ...defaultAppSettings(),
        agentModelFavoriteKeys: ["claudeCode/opus"],
        agentModelFavoritesRevision: 7,
      },
      onUpdateAppSettings,
    });

    expect(host.textContent).toContain("1 pinned");

    act(() => byText("Clear favorites").click());

    expect(onUpdateAppSettings).toHaveBeenCalledWith(
      expect.objectContaining({ agentModelFavoriteKeys: [], agentModelFavoritesRevision: 8 }),
    );
  });

  it("does not reuse an exhausted persisted revision", () => {
    const onUpdateAppSettings = vi.fn();

    render({
      appSettings: {
        ...defaultAppSettings(),
        agentModelFavoriteKeys: ["claudeCode/opus"],
        agentModelFavoritesRevision: Number.MAX_SAFE_INTEGER,
      },
      onUpdateAppSettings,
    });

    act(() => byText("Clear favorites").click());

    expect(onUpdateAppSettings).not.toHaveBeenCalled();
  });

  it("can clear a favorite after a corrupt stored snapshot recovers", () => {
    const onUpdateAppSettings = vi.fn();
    const recovered = normalizeAppSettings({
      agentModelFavoriteKeys: ["claudeCode/unknown"],
      agentModelFavoritesRevision: Number.MAX_SAFE_INTEGER,
    });

    render({
      appSettings: {
        ...recovered,
        agentModelFavoriteKeys: ["claudeCode/opus"],
        agentModelFavoritesRevision: 1,
      },
      onUpdateAppSettings,
    });

    act(() => byText("Clear favorites").click());

    expect(onUpdateAppSettings).toHaveBeenCalledWith(
      expect.objectContaining({ agentModelFavoriteKeys: [], agentModelFavoritesRevision: 2 }),
    );
  });

  it("disables a favorites reset that has nothing to clear", () => {
    render();

    expect(byText("Clear favorites").disabled).toBe(true);
  });

  it("atomically falls back when disabling the selected provider", () => {
    const onPublishAppSettings = vi.fn();
    const onUpdateAppSettings = vi.fn();
    const appSettings = {
      ...defaultAppSettings(),
      agentCliKind: "codex" as const,
      agentCliPaths: { claudeCode: "/bin/claude", codex: "/bin/codex" },
    };

    render({
      appSettings,
      management: providerManagement({ readyProvider: "claudeCode" }),
      onPublishAppSettings,
      onUpdateAppSettings,
    });

    act(() => byLabel("Enable Codex").click());

    expect(onUpdateAppSettings).not.toHaveBeenCalled();
    expect(onPublishAppSettings).toHaveBeenCalledTimes(1);
    expect(onPublishAppSettings).toHaveBeenCalledWith({
      ...appSettings,
      agentCliKind: "claudeCode",
      agentProviderPreferences: {
        ...appSettings.agentProviderPreferences,
        codex: { ...appSettings.agentProviderPreferences?.codex, enabled: false },
      },
    });
  });

  it("does not fall back to an enabled provider while it is updating", () => {
    const onPublishAppSettings = vi.fn();
    const onUpdateAppSettings = vi.fn();
    const appSettings = {
      ...defaultAppSettings(),
      agentCliKind: "codex" as const,
      agentCliPaths: { claudeCode: "/bin/claude", codex: "/bin/codex" },
    };

    render({
      appSettings,
      management: providerManagement({ updatingProvider: "claudeCode" }),
      onPublishAppSettings,
      onUpdateAppSettings,
    });

    act(() => byLabel("Enable Codex").click());

    expect(onUpdateAppSettings).not.toHaveBeenCalled();
    expect(onPublishAppSettings).toHaveBeenCalledTimes(1);
    expect(onPublishAppSettings).toHaveBeenCalledWith({
      ...appSettings,
      agentProviderPreferences: {
        ...appSettings.agentProviderPreferences,
        codex: { ...appSettings.agentProviderPreferences?.codex, enabled: false },
      },
    });
  });

  it("keeps interior and trailing spaces while typing and trims only on blur", () => {
    const onPublishAppSettings = vi.fn();
    const onUpdateAppSettings = vi.fn();

    render({ onPublishAppSettings, onUpdateAppSettings });
    expand("Claude Code");

    setValue(pathInput("claude"), "/Applications/My ");
    expect(onPublishAppSettings).not.toHaveBeenCalled();

    setValue(pathInput("claude"), "/Applications/My Tools/claude ");
    blur(pathInput("claude"));

    expect(lastCall(onPublishAppSettings).agentCliPaths.claudeCode).toBe(
      "/Applications/My Tools/claude",
    );
    expect(onUpdateAppSettings).not.toHaveBeenCalled();
  });

  it("clears the setting when the input is emptied", () => {
    const onPublishAppSettings = vi.fn();
    const onUpdateAppSettings = vi.fn();

    render({
      appSettings: {
        ...defaultAppSettings(),
        agentCliPaths: { claudeCode: "/usr/local/bin/claude", codex: null },
      },
      onPublishAppSettings,
      onUpdateAppSettings,
    });
    expand("Claude Code");

    setValue(pathInput("claude"), "");
    expect(onPublishAppSettings).not.toHaveBeenCalled();

    blur(pathInput("claude"));

    expect(lastCall(onPublishAppSettings).agentCliPaths.claudeCode).toBeNull();
    expect(onUpdateAppSettings).not.toHaveBeenCalled();
  });

  it("keeps an invalid relative path local without clearing the persisted path on blur", () => {
    const onPublishAppSettings = vi.fn();
    const onUpdateAppSettings = vi.fn();

    render({
      appSettings: {
        ...defaultAppSettings(),
        agentCliPaths: { claudeCode: "/usr/local/bin/claude", codex: null },
      },
      onPublishAppSettings,
      onUpdateAppSettings,
    });
    expand("Claude Code");

    setValue(pathInput("claude"), "bin/claude");
    expect(onPublishAppSettings).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Enter an absolute executable path");

    blur(pathInput("claude"));

    expect(onPublishAppSettings).not.toHaveBeenCalled();
    expect(onUpdateAppSettings).not.toHaveBeenCalled();
  });

  it("renders independent automatic discovery results and routes fixed install command copy", () => {
    const onCopyInstallCommand = vi.fn();

    render({
      management: providerManagement({
        claudeExecutable: {
          kind: "detected",
          path: "/Users/test/.local/bin/claude",
          version: "2.1.247",
        },
        codexExecutable: { kind: "notFound", installCommand: "npm i -g @openai/codex" },
      }),
      onCopyInstallCommand,
    });
    expand("Claude Code");
    expand("Codex");

    expect(host.textContent).toContain("Detected at /Users/test/.local/bin/claude (v2.1.247)");
    expect(host.textContent).toContain("npm i -g @openai/codex");

    act(() => byLabel("Copy Codex install command").click());

    expect(onCopyInstallCommand).toHaveBeenCalledWith("npm i -g @openai/codex");
  });

  it("shows independent provider health for both cards", () => {
    render({ management: providerManagement() });
    expand("Claude Code");
    expand("Codex");

    expect(host.textContent).toContain("Version 2.1.245");
    expect(host.textContent).toContain("Version 0.149.1");
  });

  it("excludes disabled providers from the default provider picker", () => {
    const preferences = defaultAgentProviderPreferences();

    render({
      appSettings: {
        ...defaultAppSettings(),
        agentProviderPreferences: {
          ...preferences,
          codex: { ...preferences.codex, enabled: false },
        },
      },
    });

    const picker = defaultProviderPicker();

    expect([...picker.options].map((option) => option.value)).toEqual(["claudeCode"]);
    expect(picker.value).toBe("claudeCode");
  });

  it("rejects a disabled provider value even when injected into the picker", () => {
    const onPublishAppSettings = vi.fn();
    const onUpdateAppSettings = vi.fn();
    const preferences = defaultAgentProviderPreferences();

    render({
      appSettings: {
        ...defaultAppSettings(),
        agentProviderPreferences: {
          ...preferences,
          codex: { ...preferences.codex, enabled: false },
        },
      },
      onPublishAppSettings,
      onUpdateAppSettings,
    });

    const picker = defaultProviderPicker();

    picker.append(new Option("Codex", "codex"));
    setSelect(picker, "codex");

    expect(onPublishAppSettings).not.toHaveBeenCalled();
    expect(onUpdateAppSettings).not.toHaveBeenCalled();
  });

  it("does not present another provider as selected while the persisted selection is disabled", () => {
    const preferences = defaultAgentProviderPreferences();

    render({
      appSettings: {
        ...defaultAppSettings(),
        agentCliKind: "codex",
        agentProviderPreferences: {
          ...preferences,
          codex: { ...preferences.codex, enabled: false },
        },
      },
    });

    const picker = defaultProviderPicker();

    expect(picker.value).toBe("");
    expect([...picker.options].map((option) => option.value)).toEqual(["", "claudeCode"]);
    expect(picker.options[0]?.textContent).toBe("Selected provider is disabled");
  });

  it("shows a disabled truthful placeholder when no provider is enabled", () => {
    const preferences = defaultAgentProviderPreferences();

    render({
      appSettings: {
        ...defaultAppSettings(),
        agentCliKind: "codex",
        agentProviderPreferences: {
          claudeCode: { ...preferences.claudeCode, enabled: false },
          codex: { ...preferences.codex, enabled: false },
        },
      },
    });

    const picker = defaultProviderPicker();

    expect(picker.disabled).toBe(true);
    expect([...picker.options].map((option) => option.value)).toEqual([""]);
    expect(picker.textContent).toBe("No enabled providers");
  });

  it("selects an enabled provider as the new thread default", () => {
    const onPublishAppSettings = vi.fn();
    const onUpdateAppSettings = vi.fn();

    render({ onPublishAppSettings, onUpdateAppSettings });
    setSelect(defaultProviderPicker(), "codex");

    expect(lastCall(onPublishAppSettings).agentCliKind).toBe("codex");
    expect(onUpdateAppSettings).not.toHaveBeenCalled();
  });

  it("explains shared parallel threads without an editable limit and persists workspace isolation", () => {
    const onUpdateAppSettings = vi.fn();
    const onUpdateWorkspaceSettings = vi.fn();
    const management = providerManagement();

    render({ management, onUpdateAppSettings, onUpdateWorkspaceSettings });

    expect(host.textContent).toContain("Parallel threads");
    expect(host.textContent).toContain("Up to 64");
    expect(host.textContent).toContain("Shared across all projects");
    expect(host.textContent).toContain("Each provider manages its own subagents and limits");
    expect(host.querySelector('[data-settings-row="agents.maxConcurrentTasks"] input')).toBeNull();
    expect(onUpdateAppSettings).not.toHaveBeenCalled();
    expect(management.saveWithOutcome).not.toHaveBeenCalled();

    setSelect(isolationPicker(), "worktree");
    expect(onUpdateWorkspaceSettings).toHaveBeenCalledWith(
      expect.objectContaining({ agentIsolationPolicy: "worktree" }),
    );
  });

  it("routes each provider card to its exact sign-in authority", () => {
    const request = vi.fn(() => true);
    const signIn: AgentProviderSignInSurface = {
      states: { claudeCode: { kind: "idle" }, codex: { kind: "idle" } },
      terminalIntents: { claudeCode: null, codex: null },
      blockedReason: () => null,
      isActive: () => false,
      request,
      cancelStart: () => undefined,
      start: vi.fn(async () => null),
      settle: vi.fn(async () => undefined),
    };

    render({ management: providerManagement({ signedOut: true }), signIn });

    const buttons = [...host.querySelectorAll("button")].filter(
      (button) => button.textContent?.trim() === "Sign in",
    );

    expect(buttons).toHaveLength(2);
    act(() => buttons[0]?.click());
    act(() => buttons[1]?.click());

    expect(request.mock.calls).toEqual([["claudeCode"], ["codex"]]);
  });

  it("routes a provider toggle through the serialized management intent", async () => {
    const management = providerManagement({ persisted: true, ready: true });
    const onUpdateAppSettings = vi.fn();

    render({ management, onUpdateAppSettings });

    await act(async () => {
      byLabel("Enable Claude Code").click();
      await Promise.resolve();
    });

    expect(management.saveWithOutcome).toHaveBeenCalledWith({
      provider: "claudeCode",
      selectedProvider: "codex",
      preference: {
        enabled: false,
        healthCheckIntervalSeconds: 300,
        checkForUpdates: true,
        dismissedUpdateVersion: null,
      },
    });
    expect(management.saveWithOutcome).toHaveBeenCalledTimes(1);
    expect(onUpdateAppSettings).not.toHaveBeenCalled();
  });

  it("rolls back only the still-current provider draft after persistence refusal", async () => {
    const management = providerManagement({ persisted: false, ready: true });
    const onUpdateAppSettings = vi.fn();

    render({ management, onUpdateAppSettings });

    await act(async () => {
      byLabel("Enable Claude Code").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(byLabel("Enable Claude Code").getAttribute("aria-checked")).toBe("true");
    expect(onUpdateAppSettings).not.toHaveBeenCalled();
  });

  it("retains the persisted draft when runtime policy registration fails", async () => {
    const management = providerManagement({
      persisted: true,
      policyRegistered: false,
      ready: true,
    });

    render({ management });

    await act(async () => {
      byLabel("Enable Claude Code").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(byLabel("Enable Claude Code").getAttribute("aria-checked")).toBe("false");
  });

  it("keeps the provider rows truthful when provider management is unavailable", () => {
    render({ management: null });

    expect(host.querySelector('[data-settings-row="agents.providerClaudeCode"]')).not.toBeNull();
    expect(host.textContent).toContain("Not found - CLI not detected on PATH.");
    expect([...host.querySelectorAll("button")].some((b) => b.textContent === "Sign in")).toBe(
      false,
    );
  });

  function render(options: HarnessOptions = {}): void {
    function Harness() {
      const [appSettings, setAppSettings] = useState(
        () => options.appSettings ?? defaultAppSettings(),
      );
      const [workspaceSettings, setWorkspaceSettings] = useState(
        () => options.workspaceSettings ?? defaultWorkspaceSettings(),
      );
      const appSettingsRef = useRef(appSettings);

      appSettingsRef.current = appSettings;

      const draft: SettingsDraft = {
        appSettings,
        ignorePatternsText: "",
        trusted: false,
        workspaceSettings,
      };
      const actions: SettingsDraftActions = {
        publishAppSettings: (settings) => {
          options.onPublishAppSettings?.(settings);
          setAppSettings(settings);
        },
        save: () => undefined,
        updateAppSettings: (settings) => {
          options.onUpdateAppSettings?.(settings);
          setAppSettings(settings);
        },
        updateIgnorePatternsText: () => undefined,
        updateTrusted: () => undefined,
        updateWorkspaceSettings: (settings) => {
          options.onUpdateWorkspaceSettings?.(settings);
          setWorkspaceSettings(settings);
        },
      };
      const env: SettingsEnvironment = {
        appUpdater: null,
        gitDetectedRepositoryMappings: [],
        hasWorkspace: options.hasWorkspace ?? true,
        phpTools: null,
        providerManagement:
          options.management === undefined ? providerManagement() : options.management,
        providerSignIn: options.signIn ?? null,
        systemFontGateway: { listMonospaceFontFamilies: async () => [] },
        workspaceDescriptor: null,
        workspaceRoot: "/tmp/project",
        onCopyInstallCommand: (command) => options.onCopyInstallCommand?.(command),
        onOpenJavaScriptTypeScriptServiceLog: async () => undefined,
        onOpenNodeLaunchConfigurations: () => undefined,
        onRestartJavaScriptTypeScriptService: async () => undefined,
      };

      return <AgentsSettingsPage actions={actions} draft={draft} env={env} />;
    }

    act(() => root.render(<Harness />));
  }

  function expand(label: string): void {
    const chevron = host.querySelector<HTMLButtonElement>(`[aria-label="Show ${label} details"]`);

    expect(chevron).not.toBeNull();
    act(() => chevron?.click());
  }

  function pathInput(executable: string): HTMLInputElement {
    const element = host.querySelector<HTMLInputElement>(
      `input[placeholder="/usr/local/bin/${executable}"]`,
    );

    expect(element).not.toBeNull();

    return element ?? document.createElement("input");
  }

  function intervalInput(): HTMLInputElement {
    return numberInput("86400");
  }

  function numberInput(max: string): HTMLInputElement {
    const element = host.querySelector<HTMLInputElement>(`input[type="number"][max="${max}"]`);

    expect(element).not.toBeNull();

    return element ?? document.createElement("input");
  }

  function defaultProviderPicker(): HTMLSelectElement {
    return selectAt(0);
  }

  function isolationPicker(): HTMLSelectElement {
    return selectAt(1);
  }

  function selectAt(index: number): HTMLSelectElement {
    const element = [...host.querySelectorAll("select")][index];

    expect(element).toBeDefined();

    return element ?? document.createElement("select");
  }

  function byLabel(label: string): HTMLButtonElement {
    const element = host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);

    expect(element).not.toBeNull();

    return element ?? document.createElement("button");
  }

  function byText(label: string): HTMLButtonElement {
    const element = [...host.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.trim() === label,
    );

    expect(element).toBeDefined();

    return element ?? document.createElement("button");
  }

  function setValue(element: HTMLInputElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

    act(() => {
      setter?.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  function setSelect(element: HTMLSelectElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;

    act(() => {
      setter?.call(element, value);
      element.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  function setNumber(element: HTMLInputElement, value: string): void {
    setValue(element, value);
    blur(element);
  }

  function blur(element: HTMLInputElement): void {
    act(() => element.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
  }

  function lastCall(spy: ReturnType<typeof vi.fn>): AppSettings {
    const calls = spy.mock.calls;
    const last = calls[calls.length - 1];

    expect(last).toBeDefined();

    return (last?.[0] ?? defaultAppSettings()) as AppSettings;
  }
});

interface ManagementOptions {
  readonly checkedAtEpochMs?: number;
  readonly claudeExecutable?: AgentProviderManagementSurface["providers"]["claudeCode"]["executable"];
  readonly codexExecutable?: AgentProviderManagementSurface["providers"]["codex"]["executable"];
  readonly persisted?: boolean;
  readonly policyRegistered?: boolean;
  readonly ready?: boolean;
  readonly readyProvider?: "claudeCode" | "codex";
  readonly signedOut?: boolean;
  readonly updatingProvider?: "claudeCode" | "codex";
}

function providerManagement(options: ManagementOptions = {}): AgentProviderManagementSurface {
  const checkedAtEpochMs = options.checkedAtEpochMs ?? 1;
  const auth = options.signedOut === true ? ({ kind: "signedOut" } as const) : undefined;

  return {
    cliDiscovery: defaultAgentCliDiscoveryResult(),
    providers: {
      claudeCode: {
        executable:
          options.claudeExecutable ??
          ({ kind: "detected", path: "/bin/claude", version: "2.1.245" } as const),
        health: {
          kind: "ready",
          installedVersion: "2.1.245",
          auth: auth ?? { kind: "signedIn", label: null },
          update: { kind: "current", installedVersion: "2.1.245" },
          checkedAtEpochMs,
        },
        policy: { kind: "registered", settingsRevision: 1, providerGeneration: 1 },
        updateState: { kind: "idle" },
        liveTurnCount: 0,
      },
      codex: {
        executable:
          options.codexExecutable ??
          ({ kind: "detected", path: "/bin/codex", version: "0.149.1" } as const),
        health: {
          kind: "ready",
          installedVersion: "0.149.1",
          auth: auth ?? { kind: "unknown" },
          update: { kind: "current", installedVersion: "0.149.1" },
          checkedAtEpochMs,
        },
        policy: { kind: "registered", settingsRevision: 1, providerGeneration: 1 },
        updateState: { kind: "idle" },
        liveTurnCount: 0,
      },
    },
    selectedProviderAuthority: { settingsRevision: 1, provider: "claudeCode" },
    toast: null,
    admissionAuthority: (provider) => {
      if (options.updatingProvider === provider) {
        return {
          provider,
          revision: 2,
          disposition: { kind: "updating" },
          cliPath: "/bin/claude",
          providerGeneration: 1,
        };
      }
      if (options.ready === true || options.readyProvider === provider) {
        return {
          provider,
          revision: 2,
          disposition: { kind: "ready" },
          cliPath: provider === "claudeCode" ? "/bin/claude" : "/bin/codex",
          providerGeneration: 1,
        };
      }

      return { provider, revision: 2, disposition: { kind: "disabled" } };
    },
    authority: (provider) => ({
      settingsRevision: 1,
      provider,
      preference: defaultAgentProviderPreferences()[provider],
      cliPath: provider === "claudeCode" ? "/bin/claude" : "/bin/codex",
    }),
    dismissToast: vi.fn(),
    dismissUpdate: vi.fn(async () => true),
    refresh: vi.fn(async () => undefined),
    retryRegistration: vi.fn(async () => undefined),
    save: vi.fn(async () => options.persisted !== false),
    saveWithOutcome: vi.fn(async () =>
      options.persisted === false
        ? ({ kind: "rejected", reason: "persistenceFailed" } as const)
        : ({ kind: "persisted", policyRegistered: options.policyRegistered ?? true } as const),
    ),
    update: vi.fn(async () => null),
  };
}
