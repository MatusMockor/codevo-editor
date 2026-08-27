// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProviderManagementSurface } from "../application/useAgentProviderManagement";
import { defaultAgentProviderPreferences } from "../domain/agentProviderSettings";
import {
  defaultAppSettings,
  defaultWorkspaceSettings,
  normalizeAppSettings,
} from "../domain/settings";
import { AgentsSettingsPanel } from "./AgentsSettingsPanel";

describe("AgentsSettingsPanel", () => {
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

  it("clears favorites with the next persisted revision", () => {
    const updateAppSettings = vi.fn();
    act(() =>
      root.render(
        createElement(AgentsSettingsPanel, {
          providerManagement: management(),
          appSettings: {
            ...defaultAppSettings(),
            agentModelFavoriteKeys: ["claudeCode/opus"],
            agentModelFavoritesRevision: 7,
          },
          hasWorkspace: false,
          updateAppSettings,
          updateWorkspaceSettings: vi.fn(),
          workspaceSettings: defaultWorkspaceSettings(),
        }),
      ),
    );

    const clear = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Clear 1 favorites"),
    );
    act(() => clear?.click());

    expect(updateAppSettings).toHaveBeenCalledWith(
      expect.objectContaining({ agentModelFavoriteKeys: [], agentModelFavoritesRevision: 8 }),
    );
  });

  it("does not reuse an exhausted persisted revision", () => {
    const updateAppSettings = vi.fn();
    act(() =>
      root.render(
        createElement(AgentsSettingsPanel, {
          providerManagement: management(),
          appSettings: {
            ...defaultAppSettings(),
            agentModelFavoriteKeys: ["claudeCode/opus"],
            agentModelFavoritesRevision: Number.MAX_SAFE_INTEGER,
          },
          hasWorkspace: false,
          updateAppSettings,
          updateWorkspaceSettings: vi.fn(),
          workspaceSettings: defaultWorkspaceSettings(),
        }),
      ),
    );

    const clear = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Clear 1 favorites"),
    );
    act(() => clear?.click());

    expect(updateAppSettings).not.toHaveBeenCalled();
  });

  it("can clear a favorite after a corrupt stored snapshot recovers", () => {
    const recovered = normalizeAppSettings({
      agentModelFavoriteKeys: ["claudeCode/unknown"],
      agentModelFavoritesRevision: Number.MAX_SAFE_INTEGER,
    });
    const updateAppSettings = vi.fn();
    act(() =>
      root.render(
        createElement(AgentsSettingsPanel, {
          providerManagement: management(),
          appSettings: {
            ...recovered,
            agentModelFavoriteKeys: ["claudeCode/opus"],
            agentModelFavoritesRevision: 1,
          },
          hasWorkspace: false,
          updateAppSettings,
          updateWorkspaceSettings: vi.fn(),
          workspaceSettings: defaultWorkspaceSettings(),
        }),
      ),
    );

    const clear = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Clear 1 favorites"),
    );
    act(() => clear?.click());

    expect(updateAppSettings).toHaveBeenCalledWith(
      expect.objectContaining({ agentModelFavoriteKeys: [], agentModelFavoritesRevision: 2 }),
    );
  });

  it("updates only the selected provider preference and clears its dismissed version", () => {
    const updateAppSettings = vi.fn();
    const appSettings = {
      ...defaultAppSettings(),
      agentProviderPreferences: {
        claudeCode: {
          enabled: true,
          healthCheckIntervalSeconds: 300,
          checkForUpdates: false,
          dismissedUpdateVersion: "2.2.0",
        },
        codex: {
          enabled: false,
          healthCheckIntervalSeconds: 60,
          checkForUpdates: false,
          dismissedUpdateVersion: null,
        },
      },
    };
    act(() =>
      root.render(
        <AgentsSettingsPanel
          appSettings={appSettings}
          hasWorkspace={false}
          providerManagement={management()}
          updateAppSettings={updateAppSettings}
          updateWorkspaceSettings={vi.fn()}
          workspaceSettings={defaultWorkspaceSettings()}
        />,
      ),
    );

    const card = host.querySelector('[aria-label="Claude Code provider"]');
    const checkbox = card?.querySelector<HTMLInputElement>(
      ".agent-provider-card__updates-toggle input",
    );
    act(() => {
      checkbox?.click();
    });

    expect(updateAppSettings).toHaveBeenCalledWith({
      ...appSettings,
      agentProviderPreferences: {
        ...appSettings.agentProviderPreferences,
        claudeCode: {
          ...appSettings.agentProviderPreferences.claudeCode,
          checkForUpdates: true,
          dismissedUpdateVersion: null,
        },
      },
    });
  });
});

function management(): AgentProviderManagementSurface {
  return {
    providers: {
      claudeCode: {
        health: { kind: "notConfigured" },
        policy: { kind: "unregistered" },
        updateState: { kind: "idle" },
        liveTurnCount: 0,
      },
      codex: {
        health: { kind: "disabled" },
        policy: { kind: "unregistered" },
        updateState: { kind: "idle" },
        liveTurnCount: 0,
      },
    },
    selectedProviderAuthority: null,
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
      cliPath: null,
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
