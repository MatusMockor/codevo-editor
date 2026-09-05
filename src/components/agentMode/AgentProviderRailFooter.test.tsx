// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentProviderManagementSurface,
  AgentProviderManagementView,
} from "../../application/useAgentProviderManagement";
import { defaultAgentProviderPreferences } from "../../domain/agentProviderSettings";
import { defaultAgentCliDiscoveryResult } from "../../domain/agentSettings";
import { AGENT_PROVIDER_UPDATED_PILL_MS, AgentProviderRailFooter } from "./AgentProviderRailFooter";
import { providerFooterPillModels } from "./agentSidebarPresentation";

const FAILED_UPDATE: AgentProviderManagementView["updateState"] = {
  kind: "failed",
  reason: "uncertain",
  outputTail: "npm ERR",
  outputTruncated: false,
};

const RUNNING_UPDATE: AgentProviderManagementView["updateState"] = {
  kind: "running",
  operationId: "provider-update-1",
  outputTail: "Installing",
  outputTruncated: false,
};

const SUCCEEDED_UPDATE: AgentProviderManagementView["updateState"] = {
  kind: "succeeded",
  previousVersion: "2.1.245",
  installedVersion: "2.2.0",
};

function readyHealth(
  availableVersion: string,
): AgentProviderManagementSurface["providers"]["claudeCode"]["health"] {
  return {
    kind: "ready",
    installedVersion: "2.1.245",
    auth: { kind: "signedIn", label: null },
    update: {
      kind: "available",
      installedVersion: "2.1.245",
      availableVersion,
      installer: { kind: "npm", packageName: "@anthropic-ai/claude-code" },
    },
    checkedAtEpochMs: 1,
  };
}

const CURRENT_HEALTH: AgentProviderManagementSurface["providers"]["claudeCode"]["health"] = {
  kind: "ready",
  installedVersion: "2.2.0",
  auth: { kind: "signedIn", label: null },
  update: { kind: "current", installedVersion: "2.2.0" },
  checkedAtEpochMs: 1,
};

const MANUAL_HEALTH: AgentProviderManagementSurface["providers"]["claudeCode"]["health"] = {
  kind: "ready",
  installedVersion: "1.0.0",
  checkedAtEpochMs: 1,
  auth: { kind: "signedIn", label: null },
  update: { kind: "manualUpdateAvailable", installedVersion: "1.0.0", availableVersion: "2.0.0" },
};

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

  it("shows updater progress as a busy status pill and refreshes every enabled provider", () => {
    const surface = management({
      health: { kind: "failed", reason: "probeFailed", checkedAtEpochMs: null },
      updateState: RUNNING_UPDATE,
    });
    render(surface);

    const updating = pill("claudeCode", "busy");
    expect(updating.tagName).toBe("SPAN");
    expect(updating.getAttribute("role")).toBe("status");
    expect(updating.getAttribute("aria-busy")).toBe("true");
    expect(updating.hasAttribute("title")).toBe(false);
    expect(updating.querySelector("button")).toBeNull();
    expect(pillLabel(updating)).toBe("Updating Claude Code");
    expect(host.querySelector('button[aria-label="Update Claude Code to 2.2.0"]')).toBeNull();
    expect(host.textContent).not.toContain("Installing");
    expect(host.textContent).not.toContain("Check failed");

    act(() => button("Refresh provider status").click());
    expect(surface.refresh).toHaveBeenCalledWith("claudeCode");
    expect(surface.refresh).toHaveBeenCalledWith("codex");
  });

  it("renders every recovery state as a full-width pill with a glyph and a readable label", () => {
    render(management());
    const update = pill("claudeCode", "update");
    expect(update.tagName).toBe("BUTTON");
    expect(update.classList.contains("agent-provider-footer__pill--primary")).toBe(true);
    expect(pillLabel(update)).toBe("Update Claude Code");
    expect(update.title).toBe("Update to 2.2.0");
    expect(pillLabel(pill("codex", "register"))).toBe("Register Codex policy");
    expect(pill("codex", "register").getAttribute("aria-label")).toBe(
      "Register Codex policy — retry registration",
    );

    render(management({ health: MANUAL_HEALTH }));
    const manual = pill("claudeCode", "manual");
    expect(pillLabel(manual)).toBe("Update Claude Code manually");
    expect(manual.getAttribute("aria-label")).toBe(
      "Update Claude Code manually — view update instructions",
    );

    render(management({ policy: { kind: "registering", settingsRevision: 1 } }));
    const registering = pill("claudeCode", "busy");
    expect(registering.getAttribute("role")).toBe("status");
    expect(pillLabel(registering)).toBe("Registering Claude Code");

    for (const element of host.querySelectorAll(".agent-provider-footer__pill")) {
      expect(element.querySelector("svg.agent-provider-footer__pill-glyph")).not.toBeNull();
      expect(element.querySelector(".agent-provider-footer__pill-label")).not.toBeNull();
    }
  });

  it("names every action pill as a superset of its visible label", () => {
    render(management({ updateState: FAILED_UPDATE }));
    render(management({ health: MANUAL_HEALTH }));

    for (const element of host.querySelectorAll<HTMLButtonElement>(
      "button.agent-provider-footer__pill",
    )) {
      expect(element.getAttribute("aria-label")?.startsWith(pillLabel(element))).toBe(true);
    }
  });

  it("offers a danger retry pill after a failed update and reuses the update path", () => {
    const surface = management({ updateState: FAILED_UPDATE });
    render(surface);

    const retry = pill("claudeCode", "failed");
    expect(retry.tagName).toBe("BUTTON");
    expect(retry.classList.contains("agent-provider-footer__pill--danger")).toBe(true);
    expect(pillLabel(retry)).toBe("Claude Code update failed · Retry");
    expect(retry.getAttribute("aria-label")).toBe(
      "Claude Code update failed · Retry — retry the Claude Code update",
    );
    expect(host.querySelector('button[aria-label="Update Claude Code to 2.2.0"]')).toBeNull();
    expect(host.textContent).not.toContain("npm ERR");

    act(() => retry.click());
    expect(surface.update).toHaveBeenCalledWith("claudeCode", "2.2.0");
  });

  it("opens settings from the retry pill when no update version is known any more", () => {
    const onOpenSettings = vi.fn();
    const surface = management({
      health: { kind: "failed", reason: "probeFailed", checkedAtEpochMs: null },
      updateState: FAILED_UPDATE,
    });
    render(surface, onOpenSettings);

    act(() => pill("claudeCode", "failed").click());
    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(surface.update).not.toHaveBeenCalled();
  });

  it("routes retry to settings while the policy is not registered", () => {
    const onOpenSettings = vi.fn();
    const surface = management({
      liveTurnCount: 1,
      policy: { kind: "unregistered" },
      updateState: FAILED_UPDATE,
    });
    render(surface, onOpenSettings);

    const retry = pill("claudeCode", "failed");
    expect((retry as HTMLButtonElement).disabled).toBe(false);
    expect(retry.title).not.toContain("Stop running");
    expect(pill("claudeCode", "register")).not.toBeNull();

    act(() => retry.click());
    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(surface.update).not.toHaveBeenCalled();
  });

  it("replaces a stale failed pill with the newer update offer", () => {
    render(management({ updateState: RUNNING_UPDATE }));
    render(management({ updateState: FAILED_UPDATE }));
    expect(pill("claudeCode", "failed")).not.toBeNull();
    expect(host.querySelector('[data-pill="update"]')).toBeNull();

    const surface = management({ health: readyHealth("2.3.0"), updateState: FAILED_UPDATE });
    render(surface);
    expect(host.querySelector('[data-pill="failed"]')).toBeNull();
    act(() => button("Update Claude Code to 2.3.0").click());
    expect(surface.update).toHaveBeenCalledWith("claudeCode", "2.3.0");
  });

  it("drops the failed pill once health proves the update landed", () => {
    render(management({ health: CURRENT_HEALTH, updateState: FAILED_UPDATE }));

    expect(host.querySelector('[data-provider="claudeCode"]')).toBeNull();
  });

  it("shows a success pill only after observing the success and for a bounded time", () => {
    vi.useFakeTimers();
    try {
      render(management({ health: CURRENT_HEALTH, updateState: SUCCEEDED_UPDATE }));
      expect(host.querySelector('[data-pill="updated"]')).toBeNull();

      render(management({ updateState: RUNNING_UPDATE }));
      render(management({ health: CURRENT_HEALTH, updateState: SUCCEEDED_UPDATE }));
      const updated = pill("claudeCode", "updated");
      expect(updated.tagName).toBe("SPAN");
      expect(updated.getAttribute("role")).toBe("status");
      expect(updated.getAttribute("aria-busy")).toBe("false");
      expect(updated.classList.contains("agent-provider-footer__pill--success")).toBe(true);
      expect(pillLabel(updated)).toBe("Claude Code updated");
      expect(updated.title).toBe("Updated from 2.1.245 to 2.2.0.");

      act(() => {
        vi.advanceTimersByTime(AGENT_PROVIDER_UPDATED_PILL_MS - 1);
      });
      expect(host.querySelector('[data-pill="updated"]')).not.toBeNull();
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(host.querySelector('[data-pill="updated"]')).toBeNull();

      render(management({ updateState: RUNNING_UPDATE }));
      render(management({ health: CURRENT_HEALTH, updateState: SUCCEEDED_UPDATE }));
      expect(host.querySelector('[data-pill="updated"]')).not.toBeNull();

      act(() => root.unmount());
      act(() => {
        vi.advanceTimersByTime(AGENT_PROVIDER_UPDATED_PILL_MS);
      });
      root = createRoot(host);
      render(management({ health: CURRENT_HEALTH, updateState: SUCCEEDED_UPDATE }));
      expect(host.querySelector('[data-pill="updated"]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
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

    expect(host.querySelector(".agent-provider-footer__pill")).toBeNull();
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
      act(() => button(`Update ${name} manually — view update instructions`).click());
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

    expect(host.querySelector('[data-pill="manual"]')).toBeNull();
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

    const register = button("Register Claude Code policy — retry registration");
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

    expect(button("Register Claude Code policy — retry registration")).not.toBeNull();
    expect(button("Register Codex policy — retry registration")).not.toBeNull();

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

  function pill(provider: "claudeCode" | "codex", id: string): HTMLElement {
    const element = host.querySelector<HTMLElement>(
      `.agent-provider-footer__pill[data-provider="${provider}"][data-pill="${id}"]`,
    );
    expect(element).not.toBeNull();
    return element ?? document.createElement("span");
  }

  function pillLabel(element: HTMLElement): string {
    return element.querySelector(".agent-provider-footer__pill-label")?.textContent ?? "";
  }
});

describe("providerFooterPillModels", () => {
  it("offers the update with an update intent and pins the version in the name", () => {
    const [update] = models(view());
    expect(update?.id).toBe("update");
    expect(update?.intent).toEqual({ kind: "update", version: "2.2.0" });
    expect(update?.name).toBe("Update Claude Code to 2.2.0");
    expect(update?.title).toBe("Update to 2.2.0");
    expect(update?.disabled).toBe(false);
    expect(models(view()).map((pill) => pill.id)).toEqual(["update"]);
  });

  it("blocks the update while turns are live and explains why", () => {
    const [update] = models(view({ liveTurnCount: 1 }));
    expect(update?.disabled).toBe(true);
    expect(update?.title).toBe("Stop running Claude Code turns first.");
  });

  it("reports busy states as non-interactive status pills without a title", () => {
    const [busy] = models(view({ updateState: RUNNING_UPDATE }));
    expect(busy).toMatchObject({
      id: "busy",
      busy: true,
      title: null,
      intent: { kind: "none" },
      label: "Updating Claude Code",
    });
    expect(models(view({ updateState: RUNNING_UPDATE })).map((pill) => pill.id)).toEqual(["busy"]);

    const registering = models(view({ policy: { kind: "registering", settingsRevision: 1 } }));
    expect(registering.map((pill) => pill.id)).toEqual(["busy"]);
    expect(registering[0]?.label).toBe("Registering Claude Code");
  });

  it("retries a failed update through the update path only with a registered policy", () => {
    const [failed] = models(view({ updateState: FAILED_UPDATE }));
    expect(failed).toMatchObject({
      id: "failed",
      tone: "danger",
      glyph: "retry",
      disabled: false,
      intent: { kind: "update", version: "2.2.0" },
      label: "Claude Code update failed · Retry",
      name: "Claude Code update failed · Retry — retry the Claude Code update",
    });
    expect(failed?.title).toContain("uncertain");
    expect(models(view({ updateState: FAILED_UPDATE })).map((pill) => pill.id)).toEqual(["failed"]);

    const unregistered = models(
      view({ liveTurnCount: 1, policy: { kind: "unregistered" }, updateState: FAILED_UPDATE }),
    );
    expect(unregistered.map((pill) => pill.id)).toEqual(["failed", "register"]);
    expect(unregistered[0]?.intent).toEqual({ kind: "openSettings" });
    expect(unregistered[0]?.disabled).toBe(false);
    expect(unregistered[0]?.title).not.toContain("Stop running");

    const blocked = models(view({ liveTurnCount: 1, updateState: FAILED_UPDATE }));
    expect(blocked[0]?.disabled).toBe(true);
    expect(blocked[0]?.title).toBe("Stop running Claude Code turns first.");
  });

  it("drops a stale failed pill for a newer offer, a manual update or a landed update", () => {
    const newer = models(
      view({ health: readyHealth("2.3.0"), updateState: FAILED_UPDATE }),
      "2.2.0",
    );
    expect(newer.map((pill) => pill.id)).toEqual(["update"]);
    expect(newer[0]?.intent).toEqual({ kind: "update", version: "2.3.0" });

    const same = models(view({ updateState: FAILED_UPDATE }), "2.2.0");
    expect(same.map((pill) => pill.id)).toEqual(["failed"]);

    const manual = models(view({ health: MANUAL_HEALTH, updateState: FAILED_UPDATE }));
    expect(manual.map((pill) => pill.id)).toEqual(["manual"]);
    expect(manual[0]?.intent).toEqual({ kind: "openSettings" });
    expect(manual[0]?.name).toBe("Update Claude Code manually — view update instructions");

    expect(models(view({ health: CURRENT_HEALTH, updateState: FAILED_UPDATE }))).toEqual([]);
  });

  it("shows the success pill only while the caller marks it visible", () => {
    const hidden = models(view({ health: CURRENT_HEALTH, updateState: SUCCEEDED_UPDATE }));
    expect(hidden).toEqual([]);

    const [updated] = models(
      view({ health: CURRENT_HEALTH, updateState: SUCCEEDED_UPDATE }),
      null,
      true,
    );
    expect(updated).toMatchObject({
      id: "updated",
      tone: "success",
      glyph: "check",
      busy: false,
      intent: { kind: "none" },
      label: "Claude Code updated",
      title: "Updated from 2.1.245 to 2.2.0.",
    });
  });

  it("asks for registration with a register intent", () => {
    const [register] = models(
      view({
        policy: { kind: "failed", settingsRevision: 2, reason: "registrationFailed" },
        health: CURRENT_HEALTH,
      }),
    );
    expect(register).toMatchObject({
      id: "register",
      intent: { kind: "register" },
      label: "Register Claude Code policy",
      name: "Register Claude Code policy — retry registration",
    });
    expect(register?.title).toContain("registration failed");
  });

  function models(
    current: AgentProviderManagementView,
    failedVersion: string | null = null,
    updatedVisible = false,
  ) {
    return providerFooterPillModels({
      provider: "claudeCode",
      view: current,
      updatedVisible,
      failedVersion,
    });
  }

  function view(overrides: Parameters<typeof management>[0] = {}): AgentProviderManagementView {
    return management(overrides).providers.claudeCode;
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
