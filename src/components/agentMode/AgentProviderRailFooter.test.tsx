// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProviderManagementSurface } from "../../application/useAgentProviderManagement";
import { defaultAgentProviderPreferences } from "../../domain/agentProviderSettings";
import { defaultAgentCliDiscoveryResult } from "../../domain/agentSettings";
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

  it("shows updater progress without version text and refreshes every enabled provider", () => {
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

    expect(
      host.querySelector('[data-provider="claudeCode"] [aria-label="Updating Claude Code"]'),
    ).not.toBeNull();
    expect(host.textContent).not.toContain("Updating Claude Code");
    expect(host.textContent).not.toContain("Check failed");

    act(() => button("Refresh provider status").click());
    expect(surface.refresh).toHaveBeenCalledWith("claudeCode");
    expect(surface.refresh).toHaveBeenCalledWith("codex");
  });

  it("keeps the navigation icon-only and moves the versions into the settings tooltip", () => {
    render(management());

    expect(host.querySelector(".agent-provider-footer__label")).toBeNull();
    expect(host.querySelector(".agent-provider-footer__glyph")).toBeNull();
    expect(host.textContent).not.toContain("v2.2.0");
    expect(button("Open provider settings").title).toBe(
      "Settings > Agents \u00b7 Claude Code v2.2.0 \u00b7 Codex Not registered",
    );
    expect(button("Open Source Control")).not.toBeNull();
    expect(button("Open Usage")).not.toBeNull();
    expect(button("Refresh provider status")).not.toBeNull();
  });

  it("renders no provider row while both providers are healthy and registered", () => {
    const settled = management({
      health: {
        kind: "ready",
        installedVersion: "2.1.245",
        auth: { kind: "signedIn", label: null },
        update: { kind: "current", installedVersion: "2.1.245" },
        checkedAtEpochMs: 1,
      },
    });
    render({
      ...settled,
      providers: { ...settled.providers, codex: settled.providers.claudeCode },
    });

    expect(host.querySelector(".agent-provider-footer__provider")).toBeNull();
    expect(host.querySelector(".agent-provider-footer__providers")?.childElementCount).toBe(0);
    expect(button("Refresh provider status")).not.toBeNull();
  });

  it("guards refresh against a second click while the probes are in flight", async () => {
    let release: () => void = () => undefined;
    const pending = new Promise<undefined>((resolve) => {
      release = () => resolve(undefined);
    });
    const refresh = vi.fn(async () => pending);
    render({ ...management(), refresh });

    act(() => button("Refresh provider status").click());
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(button("Refresh provider status").disabled).toBe(true);
    expect(button("Refresh provider status").getAttribute("aria-busy")).toBe("true");

    act(() => button("Refresh provider status").click());
    expect(refresh).toHaveBeenCalledTimes(2);

    await act(async () => {
      release();
      await pending;
    });

    expect(button("Refresh provider status").disabled).toBe(false);
    expect(button("Refresh provider status").getAttribute("aria-busy")).toBe("false");
    act(() => button("Refresh provider status").click());
    expect(refresh).toHaveBeenCalledTimes(4);
  });

  it("orders the navigation settings, source control, usage, refresh", () => {
    render(management());
    const labels = [
      ...host.querySelectorAll<HTMLButtonElement>(
        'nav[aria-label="Agent navigation"] button[aria-label]',
      ),
    ].map((element) => element.getAttribute("aria-label"));

    expect(labels).toEqual([
      "Open provider settings",
      "Open Source Control",
      "Open Usage",
      "Refresh provider status",
    ]);
  });

  it.each(["claudeCode", "codex"] as const)(
    "opens instructions for a manual %s update without invoking installation",
    (provider) => {
      const original = management({
        health: {
          kind: "ready",
          installedVersion: "1.0.0",
          checkedAtEpochMs: Date.now(),
          auth: { kind: "signedIn", label: null },
          update: {
            kind: "manualUpdateAvailable",
            installedVersion: "1.0.0",
            availableVersion: "2.0.0",
          },
        },
      });
      const surface = {
        ...original,
        providers: { ...original.providers, [provider]: original.providers.claudeCode },
      };
      const onOpenSettings = vi.fn();
      render(surface, onOpenSettings);
      const name = provider === "codex" ? "Codex" : "Claude Code";
      act(() => button(`View ${name} update instructions`).click());
      expect(onOpenSettings).toHaveBeenCalledOnce();
      expect(surface.update).not.toHaveBeenCalled();
    },
  );

  it("installs a native self-update offer instead of manual instructions", () => {
    const onOpenSettings = vi.fn();
    const surface = management({
      health: {
        kind: "ready",
        installedVersion: "2.1.245",
        auth: { kind: "signedIn", label: null },
        update: {
          kind: "available",
          installedVersion: "2.1.245",
          availableVersion: "2.2.0",
          installer: { kind: "selfUpdate", command: "claudeUpdate" },
        },
        checkedAtEpochMs: 1,
      },
    });
    render(surface, onOpenSettings);

    expect(
      host.querySelector('button[aria-label="View Claude Code update instructions"]'),
    ).toBeNull();
    act(() => button("Update Claude Code to 2.2.0").click());
    expect(surface.update).toHaveBeenCalledWith("claudeCode", "2.2.0");
    expect(onOpenSettings).not.toHaveBeenCalled();
  });

  it("keeps an enabled provider visible while policy registration is unavailable", () => {
    const surface = management({
      authorityMissing: true,
      policy: { kind: "failed", settingsRevision: 2, reason: "registrationFailed" },
    });
    render(surface);

    const register = button("Retry Claude Code policy registration");
    expect(register.title).toContain("registration failed");
    act(() => register.click());
    expect(surface.retryRegistration).toHaveBeenCalledWith("claudeCode");
  });

  it("keeps every recovery action reachable for two failed providers", () => {
    const failed = management({
      health: { kind: "failed", reason: "probeFailed", checkedAtEpochMs: null },
      policy: { kind: "failed", settingsRevision: 2, reason: "registrationFailed" },
    });
    const surface: AgentProviderManagementSurface = {
      ...failed,
      cliDiscovery: {
        ...failed.cliDiscovery,
        codex: { kind: "detected", path: "/usr/local/bin/codex", version: null },
      },
      providers: {
        claudeCode: failed.providers.claudeCode,
        codex: {
          executable: { kind: "detected", path: "/usr/local/bin/codex", version: null },
          health: { kind: "failed", reason: "probeFailed", checkedAtEpochMs: null },
          policy: { kind: "failed", settingsRevision: 2, reason: "registrationFailed" },
          updateState: { kind: "idle" },
          liveTurnCount: 0,
        },
      },
    };
    render(surface);

    expect(button("Retry Claude Code policy registration")).not.toBeNull();
    expect(button("Retry Codex policy registration")).not.toBeNull();

    act(() => button("Refresh provider status").click());
    expect(surface.refresh).toHaveBeenCalledWith("claudeCode");
    expect(surface.refresh).toHaveBeenCalledWith("codex");
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
    cliDiscovery: {
      ...defaultAgentCliDiscoveryResult(),
      claudeCode: {
        kind: "detected",
        path: "/usr/local/bin/claude",
        version: "2.1.245",
      },
    },
    providers: {
      claudeCode: {
        executable: {
          kind: "detected",
          path: "/usr/local/bin/claude",
          version: "2.1.245",
        },
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
        executable: { kind: "notFound", installCommand: "npm i -g @openai/codex" },
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
