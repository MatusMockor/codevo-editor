// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProviderManagementSurface } from "../../application/useAgentProviderManagement";
import type { AgentProviderHealthState } from "../../domain/agentProviderHealth";
import { defaultAgentProviderPreferences } from "../../domain/agentProviderSettings";
import { defaultAgentCliDiscoveryResult } from "../../domain/agentSettings";
import { AgentProviderCard, type AgentProviderCardProps } from "./AgentProviderCard";

const NOW = Date.parse("2026-09-05T12:00:00Z");

describe("AgentProviderCard", () => {
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
    expand();

    expect(host.querySelector(".settings-provider__version")?.textContent).toBe("v2.1.245");
    expect(host.textContent).toContain("Authenticated as Pro plan");
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
          checkedAtEpochMs: NOW,
          auth: { kind: "signedIn", label: null },
          update: {
            kind: "manualUpdateAvailable",
            installedVersion: "1.0.0",
            availableVersion: "2.0.0",
          },
        },
      });
      const surface: AgentProviderManagementSurface = {
        ...original,
        providers: { ...original.providers, [provider]: original.providers.claudeCode },
      };

      render(surface, { provider, rowId: rowIdFor(provider) });
      expand(provider);

      expect(host.textContent).toContain("Version 2.0.0 is available (installed: 1.0.0)");
      expect(host.textContent).toContain("Update this CLI with its original installer");
      expect(updateArrow(provider)).toBeUndefined();
      expect(surface.update).not.toHaveBeenCalled();
    },
  );

  it("shows automatic detection without turning it into a persisted override", () => {
    const onChangePath = vi.fn();

    render(
      management({
        executable: { kind: "detected", path: "/Users/test/.local/bin/claude", version: "2.1.247" },
      }),
      { onChangePath, path: null },
    );
    expand();

    expect(host.textContent).toContain("Detected at /Users/test/.local/bin/claude (v2.1.247)");
    expect(pathInput().value).toBe("");
    expect(onChangePath).not.toHaveBeenCalled();
  });

  it("does not contradict a detected executable before its first health result", () => {
    render(
      management({
        executable: { kind: "detected", path: "/Users/test/.local/bin/claude", version: null },
        health: { kind: "notConfigured" },
      }),
      { path: null },
    );
    expand();

    expect(host.textContent).toContain("Detected at /Users/test/.local/bin/claude");
    expect(host.textContent).toContain("Provider health not checked yet");
    expect(host.textContent).not.toContain("CLI not found");
  });

  it("shows the fixed install command and copies it when automatic discovery finds nothing", () => {
    const onCopyInstallCommand = vi.fn();

    render(
      management({
        executable: { kind: "notFound", installCommand: "npm i -g @anthropic-ai/claude-code" },
        health: { kind: "notConfigured" },
      }),
      { onCopyInstallCommand, path: null },
    );

    expect(host.textContent).toContain("Not found - CLI not detected on PATH.");

    expand();

    expect(host.textContent).toContain("Not found: install with");
    expect(host.textContent).toContain("npm i -g @anthropic-ai/claude-code");

    act(() => byLabel("Copy Claude Code install command").click());

    expect(onCopyInstallCommand).toHaveBeenCalledWith("npm i -g @anthropic-ai/claude-code");
  });

  it("renders bounded relative check ages", () => {
    render(
      management({
        health: readyHealth({
          checkedAtEpochMs: NOW - 5 * 60_000,
          update: { kind: "current", installedVersion: "2.1.245" },
        }),
      }),
    );
    expand();
    expect(host.textContent).toContain("Checked 5m ago");

    render(
      management({
        health: {
          kind: "failed",
          reason: "probeFailed",
          checkedAtEpochMs: NOW - 3 * 24 * 60 * 60_000,
        },
      }),
    );
    expand();
    expect(host.textContent).toContain("Check failed over 24h ago");
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
    expand();
    expect(host.textContent).toContain("Policy not registered");
    act(() => byText("Register").click());
    expect(unregistered.retryRegistration).toHaveBeenCalledWith("claudeCode");

    render(management({ policy: { kind: "registering", settingsRevision: 2 } }));
    expand();
    expect(host.textContent).toContain("Registering policy");

    const failed = management({
      policy: { kind: "failed", settingsRevision: 2, reason: "revisionConflict" },
    });

    render(failed);
    expand();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Policy settings changed during registration",
    );
    act(() => byText("Retry registration").click());
    expect(failed.retryRegistration).toHaveBeenCalledWith("claudeCode");
  });

  it("keeps CLI path edits local until blur and persists provider enablement", () => {
    const onChangePath = vi.fn();
    const onChangeEnabled = vi.fn();

    render(management(), { onChangeEnabled, onChangePath });
    expand();

    setValue(pathInput(), "/Applications/My Tools/claude ");
    expect(onChangePath).not.toHaveBeenCalled();

    blur(pathInput());
    expect(onChangePath).toHaveBeenCalledWith("/Applications/My Tools/claude");

    act(() => byLabel("Enable Claude Code").click());
    expect(onChangeEnabled).toHaveBeenCalledWith(false);

    expect(host.querySelector('[aria-label="Check CLI updates"]')).toBeNull();
  });

  it("retains an invalid non-empty CLI path on blur without clearing the saved path", () => {
    const onChangePath = vi.fn();

    render(management(), { onChangePath });
    expand();

    setValue(pathInput(), "relative/bin/claude");
    blur(pathInput());

    expect(pathInput().value).toBe("relative/bin/claude");
    expect(pathInput().getAttribute("aria-invalid")).toBe("true");
    expect(host.textContent).toContain("Enter an absolute executable path.");
    expect(onChangePath).not.toHaveBeenCalled();
  });

  it("clears the saved CLI path when the input is explicitly emptied", () => {
    const onChangePath = vi.fn();

    render(management(), { onChangePath });
    expand();

    setValue(pathInput(), "   ");
    blur(pathInput());

    expect(onChangePath).toHaveBeenCalledWith(null);
  });

  it("refuses an update while that provider has a live turn", () => {
    const surface = management({ liveTurnCount: 1 });

    render(surface);
    openUpdate();

    const update = byText("Update now");

    expect(update.disabled).toBe(true);
    expect(update.title).toContain("Stop running Claude Code turns first");

    act(() => update.click());

    expect(surface.update).not.toHaveBeenCalled();
  });

  it("starts provider sign-in through the injected semantic control", () => {
    const onSignIn = vi.fn();

    render(management({ health: signedOutHealth() }), {
      signIn: { blockedReason: null, onSignIn, state: { kind: "idle" } },
    });

    expect(host.textContent).toContain("Not authenticated - Sign in via the CLI");

    const signIn = byText("Sign in");

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
    render(management({ health: signedOutHealth() }), {
      signIn: { blockedReason, onSignIn: vi.fn(), state: { kind: "idle" } },
    });

    const signIn = byText("Sign in");

    expect(signIn.disabled).toBe(true);
    expect(signIn.title).toBe(blockedReason);
    expect(signIn.getAttribute("aria-describedby")).toBe("claudeCode-sign-in-status");
    expect(host.querySelector("#claudeCode-sign-in-status")?.textContent).toBe(blockedReason);
  });

  it("shows the active sign-in lifecycle without claiming authentication", () => {
    render(management({ health: signedOutHealth(AVAILABLE_UPDATE) }), {
      signIn: {
        blockedReason: "Claude Code sign-in is already running.",
        onSignIn: vi.fn(),
        state: { kind: "running", provider: "claudeCode", providerGeneration: 1, sessionId: 9 },
      },
    });

    const signIn = byText("Signing in…");

    expect(signIn.disabled).toBe(true);
    expect(signIn.getAttribute("aria-busy")).toBe("true");
    expect(host.textContent).toContain("Complete sign-in in the terminal.");
    expect(host.textContent).not.toContain("Sign-in complete");

    openUpdate();
    expect(byText("Update now").disabled).toBe(true);
    expect(byText("Update now").title).toContain("sign-in");
  });

  it("renders failed and settled sign-in outcomes without claiming authentication", () => {
    render(management({ health: signedOutHealth() }), {
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

    render(management({ health: signedOutHealth() }), {
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

    render(management({ health: signedOutHealth() }), { signIn: base });
    expect(host.querySelector("#claudeCode-sign-in-status")?.textContent).toContain(
      "Refreshing authentication status",
    );
    expect(host.textContent).not.toContain("Authentication status refreshed");

    render(management({ health: signedOutHealth() }), {
      signIn: { ...base, state: { ...base.state, healthRefresh: "complete" } },
    });
    expect(host.textContent).toContain("Authentication status refreshed");
  });

  it("blocks Update while this provider sign-in is active", () => {
    const update = vi.fn(async () => null);

    render({ ...management({ signInActive: true }), update });
    openUpdate();

    const updateNow = byText("Update now");

    expect(updateNow.title).toContain("sign-in");
    expect(updateNow.disabled).toBe(true);

    act(() => updateNow.click());

    expect(update).not.toHaveBeenCalled();
  });

  it("submits the exact currently displayed update version after an offer changes", () => {
    const update = vi.fn(async () => null);

    render({ ...management(), update });
    render({ ...management({ health: readyHealth({ availableVersion: "2.3.0" }) }), update });

    openUpdate();
    act(() => byText("Update now").click());

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
          checkedAtEpochMs: NOW,
        },
      }),
    );
    expand();

    expect(host.textContent).toContain(label);
    expect(updateArrow()).toBeUndefined();
  });

  it("renders a current update check as up to date", () => {
    render(
      management({
        health: readyHealth({ update: { kind: "current", installedVersion: "2.1.245" } }),
      }),
    );
    expand();

    expect(host.textContent).toContain("Up to date.");
    expect(updateArrow()).toBeUndefined();
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

    expect(host.textContent).toContain("Installing update");
    expect(host.querySelector("pre")?.textContent).toBe(
      "Installer stdout activity: 4096 bytes.\nInstaller stderr activity: 128 bytes.\n",
    );
    expect(host.textContent).toContain("Output was truncated");

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

  it("explains a self-update that left the installed version unchanged", () => {
    render(
      management({
        health: readyHealth({ installer: { kind: "selfUpdate", command: "claudeUpdate" } }),
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
        health: readyHealth({ update: { kind: "current", installedVersion: "2.1.245" } }),
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

  it("offers a reset only while provider settings differ from the defaults", () => {
    const onResetProvider = vi.fn();

    render(management(), { path: null, preference: defaultAgentProviderPreferences().claudeCode });
    expect(
      host.querySelector('[aria-label="Reset Claude Code provider settings to default"]'),
    ).toBeNull();

    render(management(), { onResetProvider, path: "/usr/local/bin/claude" });
    act(() => byLabel("Reset Claude Code provider settings to default").click());

    expect(onResetProvider).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["success", readyHealth(), true],
    ["warning", signedOutHealth(), true],
    ["danger", { kind: "notConfigured" } as AgentProviderHealthState, true],
    ["checking", { kind: "checking", generation: 1 } as AgentProviderHealthState, true],
    ["dimmed", readyHealth(), false],
  ] as const)("marks the status dot as %s", (tone, health, enabled) => {
    render(management({ health }), {
      preference: { ...defaultAgentProviderPreferences().claudeCode, enabled },
    });

    expect(host.querySelector(".settings-provider__glyph")?.getAttribute("data-tone")).toBe(tone);
  });

  function render(
    surface: AgentProviderManagementSurface,
    overrides: Partial<AgentProviderCardProps> = {},
  ): void {
    act(() =>
      root.render(
        <AgentProviderCard
          management={surface}
          nowEpochMs={NOW}
          onChangeEnabled={() => undefined}
          onChangePath={() => undefined}
          onCopyInstallCommand={() => undefined}
          onResetProvider={() => undefined}
          path="/usr/local/bin/claude"
          preference={defaultAgentProviderPreferences().claudeCode}
          provider="claudeCode"
          rowId="agents.providerClaudeCode"
          signIn={null}
          {...overrides}
        />,
      ),
    );
  }

  function expand(provider: "claudeCode" | "codex" = "claudeCode"): void {
    const label = provider === "claudeCode" ? "Claude Code" : "Codex";
    const chevron = host.querySelector<HTMLButtonElement>(`[aria-label="Show ${label} details"]`);

    if (chevron === null) {
      expect(host.querySelector(`[aria-label="Hide ${label} details"]`)).not.toBeNull();
      return;
    }

    act(() => chevron.click());
  }

  function openUpdate(): void {
    const arrow = updateArrow();

    expect(arrow).toBeDefined();
    act(() => arrow?.click());
  }

  function updateArrow(
    provider: "claudeCode" | "codex" = "claudeCode",
  ): HTMLButtonElement | undefined {
    const label = provider === "claudeCode" ? "Claude Code" : "Codex";

    return (
      host.querySelector<HTMLButtonElement>(
        `[aria-label="${label} update available - view details"]`,
      ) ?? undefined
    );
  }

  function pathInput(): HTMLInputElement {
    const element = host.querySelector<HTMLInputElement>(
      'input[placeholder="/usr/local/bin/claude"]',
    );

    expect(element).not.toBeNull();

    return element ?? document.createElement("input");
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
    });
  }

  function blur(element: HTMLInputElement): void {
    act(() => element.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
  }
});

type ReadyUpdate = Extract<AgentProviderHealthState, { readonly kind: "ready" }>["update"];
type AvailableInstaller = Extract<ReadyUpdate, { readonly kind: "available" }>["installer"];

interface ReadyHealthOverrides {
  readonly availableVersion?: string;
  readonly checkedAtEpochMs?: number;
  readonly installer?: AvailableInstaller;
  readonly update?: ReadyUpdate;
}

function readyHealth(overrides: ReadyHealthOverrides = {}): AgentProviderHealthState {
  return {
    kind: "ready",
    installedVersion: "2.1.245",
    auth: { kind: "signedIn", label: "Pro plan" },
    update: overrides.update ?? {
      kind: "available",
      installedVersion: "2.1.245",
      availableVersion: overrides.availableVersion ?? "2.2.0",
      installer: overrides.installer ?? {
        kind: "npm",
        packageName: "@anthropic-ai/claude-code",
      },
    },
    checkedAtEpochMs: overrides.checkedAtEpochMs ?? NOW,
  };
}

function signedOutHealth(
  update: ReadyUpdate = { kind: "current", installedVersion: "2.1.245" },
): AgentProviderHealthState {
  return {
    kind: "ready",
    installedVersion: "2.1.245",
    auth: { kind: "signedOut" },
    update,
    checkedAtEpochMs: NOW,
  };
}

const AVAILABLE_UPDATE: ReadyUpdate = {
  kind: "available",
  installedVersion: "2.1.245",
  availableVersion: "2.2.0",
  installer: { kind: "npm", packageName: "@anthropic-ai/claude-code" },
};

function rowIdFor(provider: "claudeCode" | "codex") {
  return provider === "claudeCode"
    ? ("agents.providerClaudeCode" as const)
    : ("agents.providerCodex" as const);
}

function management(
  overrides: Partial<AgentProviderManagementSurface["providers"]["claudeCode"]> = {},
): AgentProviderManagementSurface {
  const claudeCode = {
    executable: { kind: "manual" as const, path: "/usr/local/bin/claude" },
    policy: { kind: "registered" as const, settingsRevision: 1, providerGeneration: 1 },
    health: readyHealth(),
    updateState: { kind: "idle" as const },
    liveTurnCount: 0,
    ...overrides,
  };

  return {
    cliDiscovery: defaultAgentCliDiscoveryResult(),
    providers: {
      claudeCode,
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
