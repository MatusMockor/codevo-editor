// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProviderManagementSurface } from "../application/useAgentProviderManagement";
import { defaultAgentProviderPreferences } from "../domain/agentProviderSettings";
import { AgentProviderSettingsCard } from "./AgentProviderSettingsCard";

describe("AgentProviderSettingsCard", () => {
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

  it("shows the resolved version, auth label and fresh health timestamp", () => {
    render(management());

    expect(host.textContent).toContain("Version 2.1.245");
    expect(host.textContent).toContain("Signed in · Pro plan");
    expect(host.textContent).toContain("Checked just now");
  });

  it("renders bounded relative check ages", () => {
    render(
      management({
        health: {
          kind: "ready",
          installedVersion: "2.1.245",
          auth: { kind: "signedIn", label: null },
          update: { kind: "checksDisabled" },
          checkedAtEpochMs: Date.now() - 5 * 60_000,
        },
      }),
    );
    expect(host.textContent).toContain("Checked 5m ago");

    render(
      management({
        health: {
          kind: "failed",
          reason: "probeFailed",
          checkedAtEpochMs: Date.now() - 3 * 24 * 60 * 60_000,
        },
      }),
    );
    expect(host.textContent).toContain("Check failed over 24h ago");
  });

  it("ages the relative timestamp on a bounded clock and cleans up the timer", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-27T12:00:00Z"));
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    render(
      management({
        health: {
          kind: "ready",
          installedVersion: "2.1.245",
          auth: { kind: "signedIn", label: null },
          update: { kind: "checksDisabled" },
          checkedAtEpochMs: Date.now(),
        },
      }),
    );
    expect(host.textContent).toContain("Checked just now");

    act(() => vi.advanceTimersByTime(60_000));
    expect(host.textContent).toContain("Checked 1m ago");

    act(() => root.unmount());
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    root = createRoot(host);
  });

  it("does not contradict configured providers while policy registration is pending", () => {
    render(
      management({
        health: { kind: "notConfigured" },
        policy: { kind: "registering", settingsRevision: 2 },
      }),
    );

    expect(host.textContent).toContain("Health check waiting for policy registration");
    expect(host.textContent).not.toContain("CLI not configured");
  });

  it("shows registration state and retries unregistered or failed policies", () => {
    const unregistered = management({ policy: { kind: "unregistered" } });
    render(unregistered);
    expect(host.textContent).toContain("Policy not registered");
    click("button", "Register");
    expect(unregistered.retryRegistration).toHaveBeenCalledWith("claudeCode");

    render(
      management({
        policy: { kind: "registering", settingsRevision: 2 },
      }),
    );
    expect(host.textContent).toContain("Registering policy");

    const failed = management({
      policy: { kind: "failed", settingsRevision: 2, reason: "revisionConflict" },
    });
    render(failed);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Policy settings changed during registration",
    );
    click("button", "Retry registration");
    expect(failed.retryRegistration).toHaveBeenCalledWith("claudeCode");
  });

  it("keeps CLI path edits local until blur and persists provider preferences", () => {
    const onChangePath = vi.fn();
    const onChangeEnabled = vi.fn();
    const onChangeHealthCheckIntervalSeconds = vi.fn();
    const onChangeCheckForUpdates = vi.fn();
    render(management(), {
      onChangeCheckForUpdates,
      onChangeEnabled,
      onChangeHealthCheckIntervalSeconds,
      onChangePath,
    });

    setInput('input[placeholder="/usr/local/bin/claude"]', "/Applications/My Tools/claude ");
    expect(onChangePath).not.toHaveBeenCalled();
    blur('input[placeholder="/usr/local/bin/claude"]');
    expect(onChangePath).toHaveBeenCalledWith("/Applications/My Tools/claude");

    toggle('input[aria-label="Enable Claude Code"]', false);
    expect(onChangeEnabled).toHaveBeenCalledWith(false);

    setInput('input[aria-label="Claude Code health check interval in seconds"]', "999999");
    expect(onChangeHealthCheckIntervalSeconds).toHaveBeenCalledWith(86_400);

    toggle(".agent-provider-card__updates-toggle input", true);
    expect(onChangeCheckForUpdates).toHaveBeenCalledWith(true);
  });

  it("refreshes manually and refuses an update while that provider has a live turn", () => {
    const surface = management({ liveTurnCount: 1 });
    render(surface);

    click("button", "Refresh");
    expect(surface.refresh).toHaveBeenCalledWith("claudeCode");

    const update = button("Update to 2.2.0");
    expect(update.disabled).toBe(true);
    expect(update.title).toContain("Stop running Claude Code turns first");
    act(() => update.click());
    expect(surface.update).not.toHaveBeenCalled();
  });

  it("submits the exact currently displayed update version after an offer changes", () => {
    const update = vi.fn(async () => null);
    render({ ...management(), update });
    render({
      ...management({
        health: availableHealth("2.3.0"),
      }),
      update,
    });

    click("button", "Update to 2.3.0");

    expect(update).toHaveBeenCalledWith("claudeCode", "2.3.0");
    expect(update).not.toHaveBeenCalledWith("claudeCode", "2.2.0");
  });

  it("renders bounded updater progress and failure output truthfully", () => {
    render(
      management({
        updateState: {
          kind: "running",
          operationId: "provider-update-1",
          outputTail: "Installing package",
          outputTruncated: false,
        },
      }),
    );
    expect(host.textContent).toContain("Updating Claude Code");
    expect(host.textContent).toContain("Installing update");
    expect(host.querySelector("pre")?.textContent).toBe("Installing package");
    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();

    render(
      management({
        updateState: {
          kind: "failed",
          reason: "timedOut",
          outputTail: "network timeout",
          outputTruncated: true,
        },
      }),
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("The update timed out.");
    expect(host.querySelector("pre")?.textContent).toBe("network timeout");
    expect(host.textContent).toContain("Output was truncated");
  });

  function render(
    managementSurface: AgentProviderManagementSurface,
    overrides: Partial<Parameters<typeof AgentProviderSettingsCard>[0]> = {},
  ): void {
    act(() =>
      root.render(
        <AgentProviderSettingsCard
          management={managementSurface}
          onChangeCheckForUpdates={() => undefined}
          onChangeEnabled={() => undefined}
          onChangeHealthCheckIntervalSeconds={() => undefined}
          onChangePath={() => undefined}
          path="/usr/local/bin/claude"
          preference={defaultAgentProviderPreferences().claudeCode}
          provider="claudeCode"
          {...overrides}
        />,
      ),
    );
  }

  function input(selector: string): HTMLInputElement {
    const element = host.querySelector<HTMLInputElement>(selector);
    expect(element).not.toBeNull();
    return element ?? document.createElement("input");
  }

  function setInput(selector: string, value: string): void {
    const element = input(selector);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setter?.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  function blur(selector: string): void {
    act(() => input(selector).dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
  }

  function toggle(selector: string, checked: boolean): void {
    const element = input(selector);
    act(() => {
      if (element.checked === checked) return;
      element.click();
    });
  }

  function button(label: string): HTMLButtonElement {
    const element = [...host.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    expect(element).toBeDefined();
    return element ?? document.createElement("button");
  }

  function click(selector: string, label: string): void {
    const element = [...host.querySelectorAll<HTMLButtonElement>(selector)].find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    expect(element).toBeDefined();
    act(() => element?.click());
  }
});

function management(
  overrides: Partial<AgentProviderManagementSurface["providers"]["claudeCode"]> = {},
): AgentProviderManagementSurface {
  const ready = {
    policy: { kind: "registered" as const, settingsRevision: 1, providerGeneration: 1 },
    health: {
      kind: "ready" as const,
      installedVersion: "2.1.245",
      auth: { kind: "signedIn" as const, label: "Pro plan" },
      update: {
        kind: "available" as const,
        installedVersion: "2.1.245",
        availableVersion: "2.2.0",
        installer: { kind: "npm" as const, packageName: "@anthropic-ai/claude-code" as const },
      },
      checkedAtEpochMs: Date.now(),
    },
    updateState: { kind: "idle" as const },
    liveTurnCount: 0,
    ...overrides,
  };
  return {
    providers: {
      claudeCode: ready,
      codex: {
        health: { kind: "notConfigured" },
        policy: { kind: "unregistered" },
        updateState: { kind: "idle" },
        liveTurnCount: 0,
      },
    },
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
      cliPath: provider === "claudeCode" ? "/usr/local/bin/claude" : "/usr/local/bin/codex",
    }),
    dismissToast: vi.fn(),
    dismissUpdate: vi.fn(async () => true),
    refresh: vi.fn(async () => undefined),
    retryRegistration: vi.fn(async () => undefined),
    save: vi.fn(async () => true),
    saveWithOutcome: vi.fn(async () => ({ kind: "persisted" as const, policyRegistered: true })),
    update: vi.fn(async () => null),
  };
}

function availableHealth(availableVersion: string) {
  return {
    kind: "ready" as const,
    installedVersion: "2.1.245",
    auth: { kind: "signedIn" as const, label: null },
    update: {
      kind: "available" as const,
      installedVersion: "2.1.245",
      availableVersion,
      installer: { kind: "npm" as const, packageName: "@anthropic-ai/claude-code" as const },
    },
    checkedAtEpochMs: Date.now(),
  };
}
