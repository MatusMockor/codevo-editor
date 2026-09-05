// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProviderManagementSurface } from "../application/useAgentProviderManagement";
import { defaultAgentCliDiscoveryResult } from "../domain/agentSettings";
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

    expect(host.textContent).toContain("Manual override: /usr/local/bin/claude");
    expect(host.textContent).toContain("Version 2.1.245");
    expect(host.textContent).toContain("Signed in · Pro plan");
    expect(host.textContent).toContain("Checked just now");
  });

  it.each(["claudeCode", "codex"] as const)(
    "reports a newer native %s version without an unsafe automatic update button",
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
      render(surface, { provider });
      expect(host.textContent).toContain("Version 2.0.0 is available (installed: 1.0.0)");
      expect(host.textContent).toContain("Update this CLI with its original installer");
      expect(
        [...host.querySelectorAll("button")].some((button) =>
          button.textContent?.startsWith("Update to"),
        ),
      ).toBe(false);
      expect(surface.update).not.toHaveBeenCalled();
    },
  );

  it("shows automatic detection without turning it into a persisted override", () => {
    const onChangePath = vi.fn();
    render(management(), {
      onChangePath,
      path: null,
      presentation: {
        kind: "detected",
        path: "/Users/test/.local/bin/claude",
        version: "2.1.247",
      },
    });

    expect(host.textContent).toContain("Detected at /Users/test/.local/bin/claude (v2.1.247)");
    expect(input('input[placeholder="/usr/local/bin/claude"]').value).toBe("");
    expect(onChangePath).not.toHaveBeenCalled();
  });

  it("does not contradict a detected executable before its first health result", () => {
    render(management({ health: { kind: "notConfigured" } }), {
      path: null,
      presentation: {
        kind: "detected",
        path: "/Users/test/.local/bin/claude",
        version: null,
      },
    });

    expect(host.textContent).toContain("Detected at /Users/test/.local/bin/claude");
    expect(host.textContent).toContain("Provider health not checked yet");
    expect(host.textContent).not.toContain("CLI not found");
  });

  it("shows the fixed install command and copies it when automatic discovery finds nothing", () => {
    const onCopyInstallCommand = vi.fn();
    render(management({ health: { kind: "notConfigured" } }), {
      onCopyInstallCommand,
      path: null,
      presentation: {
        kind: "notFound",
        installCommand: "npm i -g @anthropic-ai/claude-code",
      },
    });

    expect(host.textContent).toContain(
      "Not found: install with npm i -g @anthropic-ai/claude-code",
    );
    expect(host.textContent).toContain("CLI not found");
    click("button", "Copy");
    expect(onCopyInstallCommand).toHaveBeenCalledWith("npm i -g @anthropic-ai/claude-code");
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
    render(management(), {
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

    expect(host.querySelector(".agent-provider-card__updates-toggle input")).toBeNull();
    expect(host.textContent).toContain("CLI updates are checked automatically");
  });

  it("retains an invalid non-empty CLI path on blur without clearing the saved path", () => {
    const onChangePath = vi.fn();
    render(management(), { onChangePath });

    setInput('input[placeholder="/usr/local/bin/claude"]', "relative/bin/claude");
    blur('input[placeholder="/usr/local/bin/claude"]');

    expect(input('input[placeholder="/usr/local/bin/claude"]').value).toBe("relative/bin/claude");
    expect(input('input[placeholder="/usr/local/bin/claude"]').getAttribute("aria-invalid")).toBe(
      "true",
    );
    expect(host.textContent).toContain("Enter an absolute executable path.");
    expect(onChangePath).not.toHaveBeenCalled();
  });

  it("clears the saved CLI path when the input is explicitly emptied", () => {
    const onChangePath = vi.fn();
    render(management(), { onChangePath });

    setInput('input[placeholder="/usr/local/bin/claude"]', "   ");
    blur('input[placeholder="/usr/local/bin/claude"]');

    expect(onChangePath).toHaveBeenCalledWith(null);
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

  it("starts provider sign-in through the injected semantic control", () => {
    const onSignIn = vi.fn();
    render(management(), {
      signIn: {
        blockedReason: null,
        onSignIn,
        state: { kind: "idle" },
      },
    });

    const signIn = button("Sign in");
    expect(signIn.disabled).toBe(false);
    act(() => signIn.click());
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it.each([
    "Configure a valid Claude Code CLI path before signing in.",
    "Register Claude Code provider settings before signing in.",
    "Stop running Claude Code turns before signing in.",
    "Wait for the Claude Code update to finish before signing in.",
    "Claude Code sign-in is already running.",
  ])("disables sign-in with its exact reason: %s", (blockedReason) => {
    render(management(), {
      signIn: {
        blockedReason,
        onSignIn: vi.fn(),
        state: { kind: "idle" },
      },
    });

    const signIn = button("Sign in");
    expect(signIn.disabled).toBe(true);
    expect(signIn.title).toBe(blockedReason);
    expect(signIn.getAttribute("aria-describedby")).toBe("claudeCode-sign-in-status");
    expect(host.querySelector("#claudeCode-sign-in-status")?.textContent).toBe(blockedReason);
  });

  it("shows the active sign-in lifecycle without claiming authentication", () => {
    render(management(), {
      signIn: {
        blockedReason: "Claude Code sign-in is already running.",
        onSignIn: vi.fn(),
        state: {
          kind: "running",
          provider: "claudeCode",
          providerGeneration: 1,
          sessionId: 9,
        },
      },
    });

    const signIn = button("Signing in…");
    expect(signIn.disabled).toBe(true);
    expect(signIn.getAttribute("aria-busy")).toBe("true");
    expect(host.textContent).not.toContain("Sign-in complete");
    expect(button("Update to 2.2.0").disabled).toBe(true);
    expect(button("Update to 2.2.0").title).toContain("sign-in");
  });

  it("renders failed and settled sign-in outcomes without claiming authentication", () => {
    render(management(), {
      signIn: {
        blockedReason: null,
        onSignIn: vi.fn(),
        state: {
          kind: "failed",
          provider: "claudeCode",
          providerGeneration: 1,
          reason: "uncertain",
        },
      },
    });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "sign-in result is uncertain",
    );

    render(management(), {
      signIn: {
        blockedReason: null,
        onSignIn: vi.fn(),
        state: {
          kind: "settled",
          provider: "claudeCode",
          providerGeneration: 1,
          sessionId: 9,
          exitCode: 7,
          healthRefresh: "complete",
        },
      },
    });
    expect(host.querySelector("#claudeCode-sign-in-status")?.textContent).toContain(
      "exited with code 7",
    );
    expect(host.textContent).not.toContain("Signed in successfully");
  });

  it("announces refreshing until the post-sign-in health probe completes", () => {
    const base = {
      blockedReason: null,
      onSignIn: vi.fn(),
      state: {
        kind: "settled" as const,
        provider: "claudeCode" as const,
        providerGeneration: 1,
        sessionId: 9,
        exitCode: 0,
        healthRefresh: "refreshing" as const,
      },
    };
    render(management(), { signIn: base });
    expect(host.querySelector("#claudeCode-sign-in-status")?.textContent).toContain(
      "Refreshing authentication status",
    );
    expect(host.textContent).not.toContain("Authentication status refreshed");

    render(management(), {
      signIn: { ...base, state: { ...base.state, healthRefresh: "complete" } },
    });
    expect(host.textContent).toContain("Authentication status refreshed");
  });

  it("blocks Update while this provider sign-in is active", () => {
    const update = vi.fn(async () => null);
    render({ ...management({ signInActive: true }), update });

    const updateButton = button("Update to 2.2.0");
    expect(updateButton.title).toContain("sign-in");
    expect(updateButton.disabled).toBe(true);
    act(() => updateButton.click());
    expect(update).not.toHaveBeenCalled();
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

  it.each([
    ["unknownInstaller", "Update check unavailable: installer could not be identified."],
    ["unsupportedProbe", "Update check unavailable: provider does not support update checks."],
    ["invalidVersion", "Update check unavailable: provider returned an invalid version."],
    ["probeFailed", "Update check unavailable: update probe failed."],
  ] as const)("renders the %s update check failure without an Update action", (reason, label) => {
    render(
      management({
        health: {
          kind: "ready",
          installedVersion: "2.1.245",
          auth: { kind: "signedIn", label: null },
          update: { kind: "unavailable", reason },
          checkedAtEpochMs: Date.now(),
        },
      }),
    );

    expect(host.textContent).toContain(label);
    expect(
      [...host.querySelectorAll("button")].some((candidate) =>
        /Update/.test(candidate.textContent ?? ""),
      ),
    ).toBe(false);
  });

  it("renders a current update check as up to date", () => {
    render(
      management({
        health: {
          kind: "ready",
          installedVersion: "2.1.245",
          auth: { kind: "signedIn", label: null },
          update: { kind: "current", installedVersion: "2.1.245" },
          checkedAtEpochMs: Date.now(),
        },
      }),
    );

    expect(host.textContent).toContain("Up to date.");
    expect(
      [...host.querySelectorAll("button")].some((candidate) =>
        /Update/.test(candidate.textContent ?? ""),
      ),
    ).toBe(false);
  });

  it("renders a truthful running indicator and bounded final failure output", () => {
    render(
      management({
        updateState: {
          kind: "running",
          operationId: "provider-update-1",
          outputTail:
            "Installer stdout activity: 4096 bytes.\nInstaller stderr activity: 128 bytes.\n",
          outputTruncated: true,
        },
      }),
    );
    expect(host.textContent).toContain("Updating Claude Code");
    expect(host.textContent).toContain("Installing update");
    expect(host.querySelector("pre")?.textContent).toBe(
      "Installer stdout activity: 4096 bytes.\nInstaller stderr activity: 128 bytes.\n",
    );
    expect(host.textContent).toContain("Output was truncated");
    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();

    render(
      management({
        updateState: {
          kind: "failed",
          reason: "timedOut",
          outputTail: "Installer output withheld (stdout: 0 bytes, stderr: 15 bytes).",
          outputTruncated: false,
        },
      }),
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("The update timed out.");
    expect(host.querySelector("pre")?.textContent).toBe(
      "Installer output withheld (stdout: 0 bytes, stderr: 15 bytes).",
    );
  });

  it("offers the built-in updater for a native self-update installation", () => {
    const update = vi.fn(async () => null);
    render({ ...management({ health: selfUpdateHealth() }), update });

    expect(host.textContent).toContain(
      "Version 2.2.0 is available (installed: 2.1.245). Codevo can install it with the built-in updater (claude update).",
    );
    expect(host.textContent).not.toContain("Update this CLI with its original installer");

    click("button", "Update to 2.2.0");
    expect(update).toHaveBeenCalledWith("claudeCode", "2.2.0");
  });

  it("explains a self-update that left the installed version unchanged", () => {
    render(
      management({
        health: selfUpdateHealth(),
        updateState: {
          kind: "failed",
          reason: "versionNotAdvanced",
          outputTail: "Installer output withheld (stdout: 24 bytes, stderr: 0 bytes).",
          outputTruncated: false,
        },
      }),
    );

    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "The updater finished but the installed version did not change. Try again or update manually with claude update.",
    );
  });

  it("keeps the original-installer hint when a version stall has no self-update authority", () => {
    render(
      management({
        health: {
          kind: "ready",
          installedVersion: "2.1.245",
          auth: { kind: "signedIn", label: null },
          update: { kind: "current", installedVersion: "2.1.245" },
          checkedAtEpochMs: Date.now(),
        },
        updateState: {
          kind: "failed",
          reason: "versionNotAdvanced",
          outputTail: "Installer output withheld (stdout: 24 bytes, stderr: 0 bytes).",
          outputTruncated: false,
        },
      }),
    );

    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "The updater finished but the installed version did not change. Try again or update this CLI with its original installer.",
    );
  });

  function render(
    managementSurface: AgentProviderManagementSurface,
    overrides: Partial<Parameters<typeof AgentProviderSettingsCard>[0]> = {},
  ): void {
    act(() =>
      root.render(
        <AgentProviderSettingsCard
          management={managementSurface}
          onChangeEnabled={() => undefined}
          onChangeHealthCheckIntervalSeconds={() => undefined}
          onChangePath={() => undefined}
          onCopyInstallCommand={() => undefined}
          path="/usr/local/bin/claude"
          preference={defaultAgentProviderPreferences().claudeCode}
          presentation={{ kind: "manual", path: "/usr/local/bin/claude" }}
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
    executable: { kind: "manual" as const, path: "/usr/local/bin/claude" },
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
    cliDiscovery: defaultAgentCliDiscoveryResult(),
    providers: {
      claudeCode: ready,
      codex: {
        executable: { kind: "notFound", installCommand: "npm i -g @openai/codex" },
        health: { kind: "notConfigured" },
        policy: { kind: "unregistered" },
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

function selfUpdateHealth() {
  return {
    kind: "ready" as const,
    installedVersion: "2.1.245",
    auth: { kind: "signedIn" as const, label: null },
    update: {
      kind: "available" as const,
      installedVersion: "2.1.245",
      availableVersion: "2.2.0",
      installer: { kind: "selfUpdate" as const, command: "claudeUpdate" as const },
    },
    checkedAtEpochMs: Date.now(),
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
