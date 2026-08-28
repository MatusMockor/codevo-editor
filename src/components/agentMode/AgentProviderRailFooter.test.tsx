// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProviderManagementSurface } from "../../application/useAgentProviderManagement";
import { defaultAgentProviderPreferences } from "../../domain/agentProviderSettings";
import { AgentProviderRailFooter } from "./AgentProviderRailFooter";

describe("AgentProviderRailFooter", () => {
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

  it("hides disabled providers and opens provider settings", () => {
    const openSettings = vi.fn();
    render(management({ codexEnabled: false }), openSettings);

    expect(host.querySelector('[data-provider="claudeCode"]')).not.toBeNull();
    expect(host.querySelector('[data-provider="codex"]')).toBeNull();
    act(() => button("Open provider settings").click());
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it("exposes real source control and usage actions", () => {
    const openSourceControl = vi.fn();
    const openUsage = vi.fn();
    render(management(), vi.fn(), openSourceControl, openUsage);

    act(() => button("Open Source Control").click());
    act(() => button("Open Usage").click());

    expect(openSourceControl).toHaveBeenCalledTimes(1);
    expect(openUsage).toHaveBeenCalledTimes(1);
  });

  it("offers an available update and blocks it while a provider turn is live", () => {
    const surface = management();
    render(surface);
    act(() => button("Update Claude Code to 2.2.0").click());
    expect(surface.update).toHaveBeenCalledWith("claudeCode", "2.2.0");

    render(management({ liveTurnCount: 1 }));
    expect(button("Update Claude Code to 2.2.0").disabled).toBe(true);
  });

  it("shows updater progress and supports retrying a failed health check", () => {
    const surface = management({
      health: { kind: "failed", reason: "probeFailed", checkedAtEpochMs: null },
      updateState: {
        kind: "running",
        operationId: "provider-update-1",
        outputTail: "Installing",
        outputTruncated: false,
      },
    });
    render(surface);
    expect(host.textContent).toContain("Updating Claude Code");
    act(() => button("Refresh Claude Code status").click());
    expect(surface.refresh).toHaveBeenCalledWith("claudeCode");
  });

  it("keeps an enabled provider visible while policy registration is unavailable", () => {
    const surface = management({
      authorityMissing: true,
      policy: { kind: "failed", settingsRevision: 2, reason: "registrationFailed" },
    });
    render(surface);

    const label = host.querySelector<HTMLElement>(
      '[data-provider="claudeCode"] .agent-provider-footer__label',
    );
    expect(label?.textContent).toBe("Registration failed");
    expect(label?.title).toContain("registration failed");
    act(() => button("Retry Claude Code policy registration").click());
    expect(surface.retryRegistration).toHaveBeenCalledWith("claudeCode");
  });

  it("keeps every recovery action reachable for two failed providers", () => {
    const failed = management({
      health: { kind: "failed", reason: "probeFailed", checkedAtEpochMs: null },
      policy: { kind: "failed", settingsRevision: 2, reason: "registrationFailed" },
    });
    const surface: AgentProviderManagementSurface = {
      ...failed,
      providers: {
        claudeCode: failed.providers.claudeCode,
        codex: {
          health: { kind: "failed", reason: "probeFailed", checkedAtEpochMs: null },
          policy: { kind: "failed", settingsRevision: 2, reason: "registrationFailed" },
          updateState: { kind: "idle" },
          liveTurnCount: 0,
        },
      },
    };
    render(surface);

    expect(button("Retry Claude Code policy registration")).not.toBeNull();
    expect(button("Refresh Claude Code status")).not.toBeNull();
    expect(button("Retry Codex policy registration")).not.toBeNull();
    expect(button("Refresh Codex status")).not.toBeNull();
  });

  function render(
    surface: AgentProviderManagementSurface,
    onOpenSettings = vi.fn(),
    onOpenSourceControl = vi.fn(),
    onOpenUsage = vi.fn(),
  ): void {
    act(() =>
      root.render(
        <AgentProviderRailFooter
          management={surface}
          onOpenSourceControl={onOpenSourceControl}
          onOpenSettings={onOpenSettings}
          onOpenUsage={onOpenUsage}
          providerEnabled={{
            claudeCode: true,
            codex: surface.authority("codex")?.preference.enabled ?? false,
          }}
          usageOpen={false}
        />,
      ),
    );
  }

  function button(label: string): HTMLButtonElement {
    const element = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    expect(element).not.toBeNull();
    return element ?? document.createElement("button");
  }
});

function management(
  overrides: {
    readonly authorityMissing?: boolean;
    readonly codexEnabled?: boolean;
    readonly health?: AgentProviderManagementSurface["providers"]["claudeCode"]["health"];
    readonly liveTurnCount?: number;
    readonly policy?: AgentProviderManagementSurface["providers"]["claudeCode"]["policy"];
    readonly updateState?: AgentProviderManagementSurface["providers"]["claudeCode"]["updateState"];
  } = {},
): AgentProviderManagementSurface {
  const preferences = defaultAgentProviderPreferences();
  return {
    providers: {
      claudeCode: {
        health: overrides.health ?? {
          kind: "ready",
          installedVersion: "2.1.245",
          auth: { kind: "signedIn", label: null },
          update: {
            kind: "available",
            installedVersion: "2.1.245",
            availableVersion: "2.2.0",
            installer: { kind: "npm", packageName: "@anthropic-ai/claude-code" },
          },
          checkedAtEpochMs: 1,
        },
        policy: overrides.policy ?? {
          kind: "registered",
          settingsRevision: 1,
          providerGeneration: 1,
        },
        updateState: overrides.updateState ?? { kind: "idle" },
        liveTurnCount: overrides.liveTurnCount ?? 0,
      },
      codex: {
        health: overrides.codexEnabled === false ? { kind: "disabled" } : { kind: "notConfigured" },
        policy: { kind: "unregistered" },
        updateState: { kind: "idle" },
        liveTurnCount: 0,
      },
    },
    selectedProviderAuthority:
      overrides.authorityMissing === true ? null : { settingsRevision: 1, provider: "claudeCode" },
    toast: null,
    admissionAuthority: (provider) => ({
      provider,
      revision: 1,
      disposition: { kind: "disabled" },
    }),
    authority: (provider) => {
      if (provider === "claudeCode" && overrides.authorityMissing === true) return null;
      return {
        settingsRevision: 1,
        provider,
        preference:
          provider === "codex" && overrides.codexEnabled === false
            ? { ...preferences.codex, enabled: false }
            : preferences[provider],
        cliPath: `/bin/${provider}`,
      };
    },
    dismissToast: vi.fn(),
    dismissUpdate: vi.fn(async () => true),
    refresh: vi.fn(async () => undefined),
    retryRegistration: vi.fn(async () => undefined),
    save: vi.fn(async () => true),
    saveWithOutcome: vi.fn(async () => ({ kind: "persisted" as const, policyRegistered: true })),
    update: vi.fn(async () => null),
  };
}
