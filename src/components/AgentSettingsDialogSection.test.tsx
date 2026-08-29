// @vitest-environment jsdom

import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProviderManagementSurface } from "../application/useAgentProviderManagement";
import { defaultAgentCliDiscoveryResult } from "../domain/agentSettings";
import { defaultAppSettings, defaultWorkspaceSettings, type AppSettings } from "../domain/settings";
import { AgentSettingsDialogSection } from "./AgentSettingsDialogSection";

describe("AgentSettingsDialogSection provider persistence", () => {
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

  it("routes a provider toggle through the serialized management intent", async () => {
    const management = providerManagement(true);
    const persistAppSettings = vi.fn();
    render(management, persistAppSettings);

    await act(async () => {
      enabledToggle().click();
      await Promise.resolve();
    });

    expect(management.saveWithOutcome).toHaveBeenCalledWith({
      provider: "claudeCode",
      selectedProvider: "codex",
      preference: {
        enabled: false,
        healthCheckIntervalSeconds: 300,
        checkForUpdates: false,
        dismissedUpdateVersion: null,
      },
    });
    expect(management.saveWithOutcome).toHaveBeenCalledTimes(1);
    expect(persistAppSettings).not.toHaveBeenCalled();
  });

  it("rolls back only the still-current provider draft after persistence refusal", async () => {
    const management = providerManagement(false);
    render(management, vi.fn());

    await act(async () => {
      enabledToggle().click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(enabledToggle().checked).toBe(true);
  });

  it("retains the persisted draft when runtime policy registration fails", async () => {
    const management = providerManagement(true, false);
    render(management, vi.fn());

    await act(async () => {
      enabledToggle().click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(enabledToggle().checked).toBe(false);
  });

  function render(
    management: AgentProviderManagementSurface,
    onPersistAppSettings: (settings: AppSettings) => void,
  ): void {
    function Harness() {
      const [settings, setSettings] = useState(defaultAppSettings);
      const settingsRef = useRef(settings);
      settingsRef.current = settings;
      return (
        <AgentSettingsDialogSection
          appSettings={settings}
          appSettingsRef={settingsRef}
          hasWorkspace={true}
          onPersistAppSettings={onPersistAppSettings}
          onPublishAppSettings={setSettings}
          onUpdateWorkspaceSettings={() => undefined}
          providerManagement={management}
          workspaceSettings={defaultWorkspaceSettings()}
        />
      );
    }
    act(() => root.render(<Harness />));
  }

  function enabledToggle(): HTMLInputElement {
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Enable Claude Code"]');
    if (input === null) throw new Error("Claude Code enabled toggle is missing.");
    return input;
  }
});

function providerManagement(
  saveResult: boolean,
  policyRegistered = true,
): AgentProviderManagementSurface {
  const preference = defaultAppSettings().agentProviderPreferences?.claudeCode;
  if (preference === undefined) throw new Error("Default provider preference is missing.");
  return {
    cliDiscovery: defaultAgentCliDiscoveryResult(),
    providers: {
      claudeCode: {
        executable: {
          kind: "manual",
          path: "/usr/bin/claude",
        },
        health: { kind: "notConfigured" },
        policy: { kind: "registered", settingsRevision: 1, providerGeneration: 1 },
        updateState: { kind: "idle" },
        liveTurnCount: 0,
      },
      codex: {
        executable: {
          kind: "manual",
          path: "/usr/bin/codex",
        },
        health: { kind: "notConfigured" },
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
      disposition: { kind: "ready" },
      cliPath: provider === "claudeCode" ? "/usr/bin/claude" : "/usr/bin/codex",
      providerGeneration: 1,
    }),
    authority: (provider) => ({
      provider,
      settingsRevision: 1,
      preference,
      cliPath: provider === "claudeCode" ? "/usr/bin/claude" : "/usr/bin/codex",
    }),
    dismissToast: () => undefined,
    dismissUpdate: async () => true,
    refresh: async () => undefined,
    retryRegistration: async () => undefined,
    save: vi.fn(async () => saveResult),
    saveWithOutcome: vi.fn(async () =>
      saveResult
        ? ({ kind: "persisted", policyRegistered } as const)
        : ({ kind: "rejected", reason: "persistenceFailed" } as const),
    ),
    update: async () => null,
  };
}
