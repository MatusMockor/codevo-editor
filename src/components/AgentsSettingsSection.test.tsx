// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProviderManagementSurface } from "../application/useAgentProviderManagement";
import type { AgentProviderSignInSurface } from "../application/useAgentProviderSignIn";
import { defaultAgentProviderPreferences } from "../domain/agentProviderSettings";
import { defaultAgentCliDiscoveryResult } from "../domain/agentSettings";
import { defaultAppSettings, defaultWorkspaceSettings } from "../domain/settings";
import { AgentsSettingsSection, type AgentsSettingsSectionProps } from "./AgentsSettingsSection";

describe("AgentsSettingsSection agent CLI path input", () => {
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
  });

  it("keeps interior and trailing spaces while typing and trims only on blur", () => {
    let storedPath: string | null = null;
    const onChangeAgentCliPath = vi.fn((kind: "claudeCode" | "codex", value: string | null) => {
      expect(kind).toBe("claudeCode");
      storedPath = value;
      render({ onChangeAgentCliPath }, storedPath);
    });
    render({ onChangeAgentCliPath }, storedPath);

    setValue(cliPathInput(), "/Applications/My ");

    expect(onChangeAgentCliPath).not.toHaveBeenCalled();

    setValue(cliPathInput(), "/Applications/My Tools/claude ");
    act(() => {
      cliPathInput().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });

    expect(onChangeAgentCliPath).toHaveBeenLastCalledWith(
      "claudeCode",
      "/Applications/My Tools/claude",
    );
  });

  it("clears the setting when the input is emptied", () => {
    const onChangeAgentCliPath = vi.fn();
    render({ onChangeAgentCliPath }, "/usr/local/bin/claude");

    setValue(cliPathInput(), "");

    expect(onChangeAgentCliPath).not.toHaveBeenCalled();
    act(() => {
      cliPathInput().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(onChangeAgentCliPath).toHaveBeenLastCalledWith("claudeCode", null);
  });

  it("renders independent automatic discovery results and routes fixed install command copy", () => {
    const onCopyInstallCommand = vi.fn();
    const management = providerManagement();
    render({
      providerManagement: {
        ...management,
        providers: {
          claudeCode: {
            ...management.providers.claudeCode,
            executable: {
              kind: "detected",
              path: "/Users/test/.local/bin/claude",
              version: "2.1.247",
            },
          },
          codex: {
            ...management.providers.codex,
            executable: {
              kind: "notFound",
              installCommand: "npm i -g @openai/codex",
            },
          },
        },
      },
      onCopyInstallCommand,
    });

    expect(host.textContent).toContain("Detected at /Users/test/.local/bin/claude (v2.1.247)");
    expect(host.textContent).toContain("npm i -g @openai/codex");
    const copyCodex = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Copy Codex install command"]',
    );
    act(() => copyCodex?.click());
    expect(onCopyInstallCommand).toHaveBeenCalledWith("npm i -g @openai/codex");
  });

  it("keeps an invalid relative path local without clearing the persisted path on blur", () => {
    const onChangeAgentCliPath = vi.fn();
    render({ onChangeAgentCliPath }, "/usr/local/bin/claude");
    setValue(cliPathInput(), "bin/claude");
    expect(onChangeAgentCliPath).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Enter an absolute executable path");
    act(() => cliPathInput().dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(onChangeAgentCliPath).not.toHaveBeenCalled();
  });

  it("shows independent provider health and persists appearance and favorite clearing", () => {
    const onChangeAgentAppearanceVariant = vi.fn();
    const onClearAgentModelFavorites = vi.fn();
    render({
      appSettings: {
        ...defaultAppSettings(),
        agentCliPaths: { claudeCode: "/bin/claude", codex: "/bin/codex" },
        agentModelFavoriteKeys: ["claudeCode/opus"],
      },
      onChangeAgentAppearanceVariant,
      onClearAgentModelFavorites,
    });

    expect(host.textContent).toContain("Version 2.1.245");
    expect(host.textContent).toContain("Version 0.149.1");
    setValue(cliPathInput(), "/opt/bin/claude");
    const appearance = [...host.querySelectorAll("select")].find(
      (select) => select.parentElement?.textContent?.includes("Agent appearance") === true,
    );
    expect(appearance).toBeDefined();
    setSelect(appearance as HTMLSelectElement, "paper");
    expect(onChangeAgentAppearanceVariant).toHaveBeenCalledWith("paper");

    const clear = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Clear 1 favorites"),
    );
    act(() => clear?.click());
    expect(onClearAgentModelFavorites).toHaveBeenCalledTimes(1);
  });

  it("excludes disabled providers from the Agent CLI picker", () => {
    const onChangeAgentCliKind = vi.fn();
    const preferences = defaultAgentProviderPreferences();
    render({
      appSettings: {
        ...defaultAppSettings(),
        agentProviderPreferences: {
          ...preferences,
          codex: { ...preferences.codex, enabled: false },
        },
      },
      onChangeAgentCliKind,
    });

    const picker = agentCliPicker();
    expect([...picker.options].map((option) => option.value)).toEqual(["claudeCode"]);
    expect(picker.value).toBe("claudeCode");
  });

  it("rejects a disabled provider value even when injected into the picker", () => {
    const onChangeAgentCliKind = vi.fn();
    const preferences = defaultAgentProviderPreferences();
    render({
      appSettings: {
        ...defaultAppSettings(),
        agentProviderPreferences: {
          ...preferences,
          codex: { ...preferences.codex, enabled: false },
        },
      },
      onChangeAgentCliKind,
    });

    const picker = agentCliPicker();
    picker.append(new Option("Codex", "codex"));
    setSelect(picker, "codex");

    expect(onChangeAgentCliKind).not.toHaveBeenCalled();
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

    const picker = agentCliPicker();
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

    const picker = agentCliPicker();
    expect(picker.disabled).toBe(true);
    expect([...picker.options].map((option) => option.value)).toEqual([""]);
    expect(picker.textContent).toBe("No enabled providers");
  });

  it("routes each provider card to its exact sign-in authority", () => {
    const request = vi.fn(() => true);
    const providerSignIn = {
      states: { claudeCode: { kind: "idle" }, codex: { kind: "idle" } },
      terminalIntents: { claudeCode: null, codex: null },
      blockedReason: () => null,
      isActive: () => false,
      request,
      cancelStart: () => undefined,
      start: vi.fn(async () => null),
      settle: vi.fn(async () => undefined),
    } satisfies AgentProviderSignInSurface;
    render({ providerSignIn });

    const cards = host.querySelectorAll<HTMLElement>(".agent-provider-card");
    const claudeSignIn = [...(cards[0]?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.trim() === "Sign in",
    );
    const codexSignIn = [...(cards[1]?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.trim() === "Sign in",
    );
    act(() => claudeSignIn?.click());
    act(() => codexSignIn?.click());

    expect(request.mock.calls).toEqual([["claudeCode"], ["codex"]]);
  });

  function render(
    overrides: Partial<AgentsSettingsSectionProps>,
    agentCliPath: string | null = null,
  ): void {
    const props: AgentsSettingsSectionProps = {
      appSettings: {
        ...defaultAppSettings(),
        agentCliPaths: { claudeCode: agentCliPath, codex: null },
      },
      hasWorkspace: true,
      workspaceSettings: defaultWorkspaceSettings(),
      onChangeAgentCliPath: () => undefined,
      onChangeAgentProviderCheckForUpdates: () => undefined,
      onChangeAgentProviderEnabled: () => undefined,
      onChangeAgentProviderHealthCheckInterval: () => undefined,
      onChangeAgentCliKind: () => undefined,
      onChangeAgentAppearanceVariant: () => undefined,
      onClearAgentModelFavorites: () => undefined,
      onChangeMaxConcurrentAgentTasks: () => undefined,
      onChangeAgentIsolationPolicy: () => undefined,
      providerManagement: providerManagement(),
      ...overrides,
    };
    act(() => root.render(createElement(AgentsSettingsSection, props)));
  }

  function cliPathInput(): HTMLInputElement {
    const input = host.querySelector<HTMLInputElement>(
      'input[placeholder="/usr/local/bin/claude"]',
    );
    expect(input).not.toBeNull();
    return input as HTMLInputElement;
  }

  function agentCliPicker(): HTMLSelectElement {
    const picker = [...host.querySelectorAll("select")].find(
      (select) => select.parentElement?.textContent?.includes("Agent CLI") === true,
    );
    expect(picker).toBeDefined();
    return picker as HTMLSelectElement;
  }

  function setValue(input: HTMLInputElement, value: string): void {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    act(() => {
      descriptor?.set?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function setSelect(select: HTMLSelectElement, value: string): void {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
    act(() => {
      descriptor?.set?.call(select, value);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
});

function providerManagement(): AgentProviderManagementSurface {
  return {
    cliDiscovery: defaultAgentCliDiscoveryResult(),
    providers: {
      claudeCode: {
        executable: { kind: "detected", path: "/bin/claude", version: "2.1.245" },
        health: {
          kind: "ready",
          installedVersion: "2.1.245",
          auth: { kind: "signedIn", label: null },
          update: { kind: "checksDisabled" },
          checkedAtEpochMs: 1,
        },
        policy: { kind: "registered", settingsRevision: 1, providerGeneration: 1 },
        updateState: { kind: "idle" },
        liveTurnCount: 0,
      },
      codex: {
        executable: { kind: "detected", path: "/bin/codex", version: "0.149.1" },
        health: {
          kind: "ready",
          installedVersion: "0.149.1",
          auth: { kind: "unknown" },
          update: { kind: "checksDisabled" },
          checkedAtEpochMs: 1,
        },
        policy: { kind: "registered", settingsRevision: 1, providerGeneration: 1 },
        updateState: { kind: "idle" },
        liveTurnCount: 0,
      },
    },
    selectedProviderAuthority: { settingsRevision: 1, provider: "claudeCode" },
    toast: null,
    admissionAuthority: (provider) => ({
      provider,
      revision: 1,
      disposition: { kind: "disabled" },
    }),
    authority: (provider) => ({
      settingsRevision: 1,
      provider,
      preference: defaultAgentProviderPreferences()[provider],
      cliPath: provider === "claudeCode" ? "/bin/claude" : "/bin/codex",
    }),
    dismissToast: () => undefined,
    dismissUpdate: async () => true,
    refresh: async () => undefined,
    retryRegistration: async () => undefined,
    save: async () => true,
    saveWithOutcome: async () => ({ kind: "persisted", policyRegistered: true }),
    update: async () => null,
  };
}
