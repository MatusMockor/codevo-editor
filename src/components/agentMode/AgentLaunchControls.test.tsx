// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentModelFavorites } from "../../application/useAgentModelFavorites";
import type { AgentProviderManagementSurface } from "../../application/useAgentProviderManagement";
import { defaultAgentProviderPreferences } from "../../domain/agentProviderSettings";
import { defaultAgentCliDiscoveryResult } from "../../domain/agentSettings";
import type { AgentExecutionTarget, AgentLaunchOptions } from "../../domain/agentLaunch";
import { AgentLaunchControls } from "./AgentLaunchControls";

const NO_FAVORITES: AgentModelFavorites = {
  keys: new Set(),
  isFavorite: () => false,
  toggle: () => undefined,
};

describe("AgentLaunchControls", () => {
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

  it("lists the Claude models and permission modes with a description on every option", () => {
    renderControls({
      provider: "claudeCode",
      model: "claude-opus-5",
      mode: "acceptEdits",
      effort: "default",
    });

    expect(trigger("agent-launch-model").textContent).toBe("Claude Opus 5");
    expect(trigger("agent-launch-mode").textContent).toContain("Auto-accept edits");

    open("agent-launch-model");
    expect(optionValues("agent-launch-model")).toEqual([
      "claude-fable-5-1",
      "claude-opus-5-5",
      "claude-opus-5",
      "claude-sonnet-5",
    ]);
    expect(selectedOption("agent-launch-model")?.dataset.value).toBe("claude-opus-5");

    open("agent-launch-mode");
    expect(menuRadioLabels()).toEqual([
      "Supervised",
      "Auto-accept edits",
      "Auto",
      "Full access",
      "Plan mode",
      "Use Claude CLI settings",
    ]);
    expect(
      menuRadios().map(
        (row) => row.querySelector(".cv-menu__description")?.textContent !== undefined,
      ),
    ).toEqual([true, true, true, true, true, false]);
    expect(menuRadio("Auto-accept edits")?.getAttribute("aria-checked")).toBe("true");
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
  });

  it("offers the reasoning effort of the selected model and reports the picked level", () => {
    const onLaunchChange = vi.fn();
    renderControls(
      {
        provider: "claudeCode",
        model: "opus",
        mode: "default",
        effort: "high",
        context: "200k",
      },
      onLaunchChange,
    );

    expect(trigger("agent-launch-effort").textContent).toBe("High · 200k");
    expect(trigger("agent-launch-effort").getAttribute("aria-label")).toBe("Model capabilities");
    act(() => trigger("agent-launch-effort").click());
    const max = menuRadio("Max");
    expect(max).not.toBeUndefined();
    act(() => max?.click());

    expect(onLaunchChange).toHaveBeenCalledWith({
      provider: "claudeCode",
      model: "opus",
      mode: "bypassPermissions",
      effort: "max",
      context: "200k",
    });

    renderControls({ provider: "codex", model: "gpt-5.5", mode: "readOnly" }, onLaunchChange);

    expect(trigger("agent-launch-effort").textContent).toBe("Default");
    act(() => trigger("agent-launch-effort").click());
    expect(menuRadioLabels()).toEqual(["Default", "Low", "Medium", "High", "Extra high"]);
    act(() => menuRadio("High")?.click());
    expect(onLaunchChange).toHaveBeenLastCalledWith({
      provider: "codex",
      model: "gpt-5.5",
      mode: "readOnly",
      effort: "high",
    });
  });

  it("shows the 1M default and applies the Claude model suffix selection", () => {
    const onLaunchChange = vi.fn();
    renderControls(
      {
        provider: "claudeCode",
        model: "fable",
        mode: "bypassPermissions",
        effort: "high",
        context: "1m",
      },
      onLaunchChange,
    );
    expect(trigger("agent-launch-effort").textContent).toBe("High · 1M");
    act(() => trigger("agent-launch-effort").click());
    const standard = menuRadio("200k");
    act(() => standard?.click());
    expect(onLaunchChange).toHaveBeenCalledWith({
      provider: "claudeCode",
      model: "fable",
      mode: "bypassPermissions",
      effort: "high",
      context: "200k",
    });
  });

  it("marks the model trigger with the provider glyph without repeating it to readers", () => {
    renderControls({ provider: "claudeCode", model: "opus", mode: "default", effort: "default" });

    const glyph = trigger("agent-launch-model").querySelector(".agent-picker__icon");
    expect(glyph?.getAttribute("aria-hidden")).toBe("true");
    expect(glyph?.querySelector(".agent-row__provider--claude")).not.toBeNull();

    renderControls({ provider: "codex", model: "default", mode: "default" });

    expect(
      trigger("agent-launch-model").querySelector(
        ".agent-picker__icon .agent-row__provider--codex",
      ),
    ).not.toBeNull();
  });

  it("renders plain-text ghost triggers separated by hairlines, without an effort prefix", () => {
    renderControls({
      provider: "claudeCode",
      model: "default",
      mode: "default",
      effort: "default",
    });

    for (const id of ["agent-launch-model", "agent-launch-effort", "agent-launch-mode"]) {
      expect(trigger(id).classList.contains("agent-picker__trigger--ghost")).toBe(true);
      expect(trigger(id).querySelector(".agent-picker__prefix")).toBeNull();
    }
    expect(trigger("agent-launch-model").textContent).toBe("Claude Sonnet 5");
    expect(trigger("agent-launch-effort").textContent).toBe("High · 1M");
    expect(trigger("agent-launch-mode").textContent).toBe("Full access");
    const dividers = host.querySelectorAll(".agent-composer__divider");
    expect(dividers).toHaveLength(2);
    expect(dividers[0]?.getAttribute("aria-hidden")).toBe("true");

    renderControls({ provider: "codex", model: "gpt-5.6-sol", mode: "workspaceWrite" });

    expect(trigger("agent-launch-model").textContent).toBe("GPT-5.6-Sol");
    expect(trigger("agent-launch-effort").textContent).toBe("Default");
    expect(trigger("agent-launch-mode").textContent).toBe("Workspace write");
    expect(host.querySelectorAll(".agent-composer__divider")).toHaveLength(2);
  });

  it("shows an open lock only for a mode that removes the safety checks", () => {
    renderControls({
      provider: "claudeCode",
      model: "default",
      mode: "supervised",
      effort: "default",
    });
    expect(trigger("agent-launch-mode").querySelector(".lucide-lock")).not.toBeNull();
    expect(trigger("agent-launch-mode").querySelector(".lucide-lock-open")).toBeNull();

    renderControls({ provider: "codex", model: "default", mode: "dangerFullAccess" });
    expect(trigger("agent-launch-mode").textContent).toBe("Full access");
    expect(trigger("agent-launch-mode").querySelector(".lucide-lock-open")).not.toBeNull();
  });

  it("lists the Codex models and execution modes", () => {
    renderControls({ provider: "codex", model: "gpt-5.5", mode: "workspaceWrite" });

    open("agent-launch-model");
    expect(options("agent-launch-model").map((option) => optionLabel(option))).toEqual([
      "GPT-6.1-SolNEW",
      "GPT-6-Astra",
      "GPT-6-Sol",
      "GPT-6-Luna",
      "GPT-5.6-Sol",
      "GPT-5.6-Terra",
      "GPT-5.6-Luna",
      "GPT-5.5",
    ]);

    open("agent-launch-mode");
    expect(menuRadioLabels()).toEqual([
      "Read-only",
      "Workspace write",
      "Auto",
      "Full access",
      "Use Codex CLI settings",
    ]);
  });

  it("selects GPT-6 Astra with its executable ID and preserves the permission mode", () => {
    const onLaunchChange = vi.fn();
    renderControls(
      { provider: "codex", model: "gpt-5.6-sol", mode: "workspaceWrite" },
      onLaunchChange,
    );
    pick("agent-launch-model", "gpt-6-astra");
    expect(onLaunchChange).toHaveBeenCalledExactlyOnceWith({
      provider: "codex",
      model: "gpt-6-astra",
      mode: "workspaceWrite",
    });
  });

  it("labels both pickers and describes the current choice for assistive technology", () => {
    renderControls({
      provider: "claudeCode",
      model: "default",
      mode: "supervised",
      effort: "default",
    });

    expect(trigger("agent-launch-model").getAttribute("aria-label")).toBe("Agent model");
    expect(trigger("agent-launch-mode").getAttribute("aria-label")).toBe("Agent permission mode");
    expect(trigger("agent-launch-mode").getAttribute("aria-haspopup")).toBe("menu");

    const modelHint = trigger("agent-launch-model").getAttribute("aria-describedby") ?? "";
    const modeHint = trigger("agent-launch-mode").getAttribute("aria-describedby") ?? "";
    expect(host.querySelector(`#${modelHint}`)?.textContent).toContain("Claude model catalog");
    expect(host.querySelector(`#${modeHint}`)?.textContent).toContain("Asks before commands");
    expect(host.querySelector(`#${modeHint}`)?.className).toBe("agent-visually-hidden");
  });

  it("reports the picked model and mode as a whole launch value", () => {
    const onLaunchChange = vi.fn();
    renderControls(
      { provider: "claudeCode", model: "default", mode: "default", effort: "default" },
      onLaunchChange,
    );

    pick("agent-launch-model", "claude-opus-5");
    open("agent-launch-mode");
    act(() => menuRadio("Full access")?.click());

    expect(onLaunchChange.mock.calls.map(([value]) => value)).toEqual([
      {
        provider: "claudeCode",
        model: "claude-opus-5",
        mode: "bypassPermissions",
        effort: "high",
        context: "1m",
        fastMode: false,
        thinkingMode: false,
      },
    ]);
  });

  it("renders the exact Opus capability sections from the model manifest", () => {
    renderControls({
      provider: "claudeCode",
      model: "opus",
      mode: "bypassPermissions",
      effort: "high",
      context: "1m",
      fastMode: false,
    });

    open("agent-launch-effort");
    expect(menuLabels()).toEqual(["Effort", "Context window"]);
    expect(menuRadioLabels()).toEqual([
      "Low",
      "Medium",
      "High",
      "Extra high",
      "Max",
      "Ultracode",
      "Ultrathink",
      "200k",
      "1M",
    ]);
    expect(document.body.textContent).not.toContain("CLI default");
    expect(menuRadio("High")?.textContent).toBe("HighDefault");
    expect(menuRadio("Ultracode")?.textContent).toContain(
      "Extra high plus multi-agent orchestration.",
    );
    expect(menuRadio("1M")?.textContent).toBe("1MDefault");
    expect(menuSwitches().map((node) => node.textContent)).toEqual([
      "Fast mode",
      "Chrome browser tools",
    ]);
    expect(menuSwitches().map((node) => node.getAttribute("aria-checked"))).toEqual([
      "false",
      "true",
    ]);
  });

  it("keeps browser integration on by default and reports turning it off", () => {
    const onLaunchChange = vi.fn();
    const launch: AgentLaunchOptions = {
      provider: "claudeCode",
      model: "opus",
      mode: "bypassPermissions",
      effort: "high",
      context: "1m",
      fastMode: false,
    };
    renderControls(launch, onLaunchChange);

    const browser = () =>
      menuSwitches().find((node) => node.textContent === "Chrome browser tools");

    expect(trigger("agent-launch-effort").textContent).not.toContain("Chrome");
    open("agent-launch-effort");
    expect(browser()?.getAttribute("aria-checked")).toBe("true");
    act(() => browser()?.click());
    expect(onLaunchChange).toHaveBeenNthCalledWith(1, { ...launch, chrome: false });

    renderControls({ ...launch, chrome: false }, onLaunchChange);
    expect(trigger("agent-launch-effort").textContent).toContain("Chrome Off");
    expect(browser()?.getAttribute("aria-checked")).toBe("false");
    act(() => browser()?.click());
    expect(onLaunchChange).toHaveBeenNthCalledWith(2, { ...launch, chrome: true });
  });

  it("hides browser integration for a thread running on a remote execution server", () => {
    const launch: AgentLaunchOptions = {
      provider: "claudeCode",
      model: "opus",
      mode: "bypassPermissions",
      effort: "high",
      context: "1m",
      fastMode: false,
      chrome: false,
    };
    renderControls(launch, () => undefined, false, null, "server");

    expect(trigger("agent-launch-effort").textContent).not.toContain("Chrome Off");
    open("agent-launch-effort");
    expect(menuLabels()).toEqual(["Effort", "Context window"]);
    expect(menuSwitches().map((node) => node.textContent)).toEqual(["Fast mode"]);
    expect(document.body.textContent).not.toContain("Chrome browser tools");
  });

  it("persists Ultracode and Fast Mode as executable launch options", () => {
    const onLaunchChange = vi.fn();
    const launch: AgentLaunchOptions = {
      provider: "claudeCode",
      model: "opus",
      mode: "bypassPermissions",
      effort: "high",
      context: "1m",
      fastMode: false,
    };
    renderControls(launch, onLaunchChange);
    open("agent-launch-effort");
    act(() =>
      menuSwitches()
        .find((node) => node.textContent === "Fast mode")
        ?.click(),
    );
    act(() => menuRadio("Ultracode")?.click());

    expect(onLaunchChange).toHaveBeenNthCalledWith(1, { ...launch, fastMode: true });
    expect(onLaunchChange).toHaveBeenNthCalledWith(2, { ...launch, effort: "ultracode" });
  });

  it("uses model-specific capabilities instead of showing unsupported controls", () => {
    renderControls({
      provider: "claudeCode",
      model: "fable",
      mode: "bypassPermissions",
      effort: "high",
      context: "1m",
    });
    open("agent-launch-effort");
    expect(menuRadioLabels()).toContain("Ultracode");
    expect(document.body.textContent).not.toContain("Fast mode");

    renderControls({
      provider: "claudeCode",
      model: "sonnet",
      mode: "bypassPermissions",
      effort: "high",
      context: "200k",
    });
    expect(menuRadioLabels()).not.toContain("Ultracode");
    expect(menuRadio("200k")?.textContent).toBe("200kDefault");
  });

  it("tones plan mode but presents full access as a normal access choice", () => {
    renderControls({ provider: "claudeCode", model: "default", mode: "plan", effort: "default" });
    expect(trigger("agent-launch-mode").classList.contains("agent-picker__trigger--plan")).toBe(
      true,
    );

    renderControls({ provider: "codex", model: "default", mode: "dangerFullAccess" });
    expect(trigger("agent-launch-mode").classList.contains("agent-picker__trigger--danger")).toBe(
      false,
    );

    open("agent-launch-mode");
    expect(menuRadios()).toHaveLength(5);
    expect(document.querySelectorAll('[role="menu"] .cv-menu__item--danger')).toHaveLength(0);
  });

  it("disables both pickers while a turn is dispatching", () => {
    renderControls(
      { provider: "claudeCode", model: "default", mode: "default", effort: "default" },
      () => undefined,
      true,
    );

    expect(trigger("agent-launch-model").disabled).toBe(true);
    expect(trigger("agent-launch-effort").disabled).toBe(true);
    expect(trigger("agent-launch-mode").disabled).toBe(true);
    open("agent-launch-model");
    expect(host.querySelector('[role="listbox"]')).toBeNull();
  });

  it("disables the model picker when the selected provider is disabled", () => {
    renderControls(
      { provider: "claudeCode", model: "default", mode: "default", effort: "default" },
      () => undefined,
      false,
      disabledClaudeManagement(),
    );

    expect(trigger("agent-launch-model").disabled).toBe(true);
    expect(trigger("agent-launch-mode").disabled).toBe(false);
  });

  it("uses the access choice itself without a second confirmation", () => {
    renderControls(
      { provider: "claudeCode", model: "opus", mode: "acceptEdits", effort: "default" },
      undefined,
      false,
      null,
    );

    open("agent-launch-mode");
    expect(host.querySelector("input#agent-launch-danger-confirm")).toBeNull();
    open("agent-launch-mode");

    renderControls(
      { provider: "claudeCode", model: "opus", mode: "bypassPermissions", effort: "default" },
      undefined,
      false,
      null,
    );

    open("agent-launch-mode");
    expect(host.querySelector("input#agent-launch-danger-confirm")).toBeNull();
  });

  function renderControls(
    launch: AgentLaunchOptions,
    onLaunchChange: (next: AgentLaunchOptions) => void = () => undefined,
    disabled = false,
    providerManagement: AgentProviderManagementSurface | null = null,
    executionTarget: AgentExecutionTarget = "local",
  ): void {
    act(() =>
      root.render(
        <AgentLaunchControls
          disabled={disabled}
          executionTarget={executionTarget}
          favorites={NO_FAVORITES}
          launch={launch}
          onLaunchChange={onLaunchChange}
          providerEnabled={{ claudeCode: true, codex: true }}
          providerManagement={providerManagement}
        />,
      ),
    );
  }

  function trigger(id: string): HTMLButtonElement {
    const element = host.querySelector<HTMLButtonElement>(`button#${id}`);
    expect(element).not.toBeNull();
    return element ?? document.createElement("button");
  }

  function open(id: string): void {
    act(() => trigger(id).click());
  }

  function menuRadios(): ReadonlyArray<HTMLButtonElement> {
    return [
      ...document.querySelectorAll<HTMLButtonElement>('[role="menu"] [role="menuitemradio"]'),
    ];
  }

  function menuRadioLabels(): ReadonlyArray<string> {
    return menuRadios().map(
      (node) => node.querySelector(".cv-menu__text")?.firstChild?.textContent ?? "",
    );
  }

  function menuRadio(label: string): HTMLButtonElement | undefined {
    return menuRadios().find(
      (node) => node.querySelector(".cv-menu__text")?.firstChild?.textContent === label,
    );
  }

  function menuSwitches(): ReadonlyArray<HTMLButtonElement> {
    return [
      ...document.querySelectorAll<HTMLButtonElement>('[role="menu"] [role="menuitemcheckbox"]'),
    ];
  }

  function menuLabels(): ReadonlyArray<string> {
    return [...document.querySelectorAll('[role="menu"] .cv-menu__label')].map(
      (node) => node.textContent ?? "",
    );
  }

  function options(id: string): ReadonlyArray<HTMLElement> {
    return [...host.querySelectorAll<HTMLElement>(`#${id}-list [role="option"]`)];
  }

  function optionValues(id: string): ReadonlyArray<string> {
    return options(id).map((option) => option.dataset.value ?? "");
  }

  function optionLabel(option: HTMLElement): string {
    return (
      option.querySelector(".agent-picker__label, .agent-model-picker__label")?.textContent ?? ""
    );
  }

  function selectedOption(id: string): HTMLElement | null {
    return host.querySelector<HTMLElement>(`#${id}-list [role="option"][aria-selected="true"]`);
  }

  function pick(id: string, value: string): void {
    open(id);
    const option = host.querySelector<HTMLElement>(
      `#${id}-list [role="option"][data-value="${value}"]`,
    );
    expect(option).not.toBeNull();
    act(() => option?.click());
  }
});

function disabledClaudeManagement(): AgentProviderManagementSurface {
  const preferences = defaultAgentProviderPreferences();
  return {
    cliDiscovery: defaultAgentCliDiscoveryResult(),
    providers: {
      claudeCode: {
        executable: {
          kind: "notFound",
          installCommand: "npm i -g @anthropic-ai/claude-code",
        },
        health: { kind: "disabled" },
        policy: { kind: "unregistered" },
        updateState: { kind: "idle" },
        liveTurnCount: 0,
      },
      codex: {
        executable: { kind: "notFound", installCommand: "npm i -g @openai/codex" },
        health: { kind: "notConfigured" },
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
      preference: {
        ...preferences[provider],
        enabled: provider !== "claudeCode",
      },
      cliPath: `/bin/${provider}`,
    }),
    dismissToast: vi.fn(),
    dismissUpdate: vi.fn(async () => true),
    refresh: vi.fn(async () => undefined),
    refreshAll: vi.fn(async () => undefined),
    retryRegistration: vi.fn(async () => undefined),
    save: vi.fn(async () => true),
    saveWithOutcome: vi.fn(async () => ({ kind: "persisted" as const, policyRegistered: true })),
    update: vi.fn(async () => null),
  };
}
