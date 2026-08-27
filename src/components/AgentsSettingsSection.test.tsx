// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProviderManagementSurface } from "../application/useAgentProviderManagement";
import { defaultAgentProviderPreferences } from "../domain/agentProviderSettings";
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
    providers: {
      claudeCode: {
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
