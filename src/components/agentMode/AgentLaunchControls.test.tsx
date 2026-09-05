// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentModelFavorites } from "../../application/useAgentModelFavorites";
import type { AgentProviderManagementSurface } from "../../application/useAgentProviderManagement";
import { defaultAgentProviderPreferences } from "../../domain/agentProviderSettings";
import { defaultAgentCliDiscoveryResult } from "../../domain/agentSettings";
import type { AgentLaunchOptions } from "../../domain/agentLaunch";
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
      "claude-opus-5",
      "claude-sonnet-5",
    ]);
    expect(selectedOption("agent-launch-model")?.dataset.value).toBe("claude-opus-5");

    open("agent-launch-mode");
    expect(options("agent-launch-mode").map((option) => optionLabel(option))).toEqual([
      "Supervised",
      "Auto-accept edits",
      "Auto",
      "Full access",
    ]);
    expect(
      options("agent-launch-mode").every(
        (option) => (option.querySelector(".agent-picker__description")?.textContent ?? "") !== "",
      ),
    ).toBe(true);
    expect(host.querySelectorAll('[role="listbox"]')).toHaveLength(1);
  });

  it("offers the reasoning effort for Claude only and reports the picked level", () => {
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
    const max = [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
      (option) => option.textContent === "Max",
    );
    expect(max).not.toBeUndefined();
    act(() => max?.click());

    expect(onLaunchChange).toHaveBeenCalledWith({
      provider: "claudeCode",
      model: "opus",
      mode: "bypassPermissions",
      effort: "max",
      context: "200k",
    });

    renderControls({ provider: "codex", model: "default", mode: "default" });

    expect(host.querySelector("#agent-launch-effort")).toBeNull();
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
    const standard = [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
      (option) => option.textContent === "200k",
    );
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

    expect(trigger("agent-launch-model").textContent).toBe("GPT-5.6 Sol");
    expect(trigger("agent-launch-mode").textContent).toBe("Workspace write");
    expect(host.querySelectorAll(".agent-composer__divider")).toHaveLength(1);
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
      "GPT-5.6 Sol",
      "GPT-6 Astra",
      "GPT-5.6 Terra",
      "GPT-5.6 Luna",
      "GPT-5.5",
      "GPT-5.4",
    ]);

    open("agent-launch-mode");
    expect(optionValues("agent-launch-mode")).toEqual([
      "readOnly",
      "workspaceWrite",
      "auto",
      "dangerFullAccess",
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
    expect(trigger("agent-launch-mode").getAttribute("aria-haspopup")).toBe("listbox");
    expect(trigger("agent-launch-mode").title).toContain("Asks before commands");

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
    pick("agent-launch-mode", "bypassPermissions");

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

  it("renders the exact Opus capability groups from the model manifest", () => {
    renderControls({
      provider: "claudeCode",
      model: "opus",
      mode: "bypassPermissions",
      effort: "high",
      context: "1m",
      fastMode: false,
    });

    open("agent-launch-effort");
    const groups = [...host.querySelectorAll<HTMLElement>('[role="group"]')];
    expect(groups.map((group) => group.getAttribute("aria-label"))).toEqual([
      "Reasoning",
      "Context Window",
      "Fast Mode",
    ]);
    expect(
      [...groups[0]!.querySelectorAll<HTMLElement>('[role="radio"]')].map((option) =>
        option.querySelector(".agent-picker__label")?.childNodes[0]?.textContent?.trim(),
      ),
    ).toEqual(["Low", "Medium", "High", "Extra High", "Max", "Ultracode", "Ultrathink"]);
    expect(groups[0]!.textContent).not.toContain("CLI default");
    expect(groups[0]!.textContent).toContain("HighDefault");
    expect(groups[0]!.textContent).toContain(
      "Ultracodexhigh effort plus multi-agent workflow orchestration",
    );
    expect(groups[1]!.textContent).toContain("1MDefault");
    expect(groups[2]!.textContent).toContain("OnOff");
    expect(groups[2]!.textContent).not.toContain("Default");
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
    const option = (label: string) =>
      [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
        (candidate) =>
          candidate.querySelector(".agent-picker__label")?.childNodes[0]?.textContent?.trim() ===
          label,
      );

    act(() => option("Ultracode")?.click());
    act(() => option("On")?.click());

    expect(onLaunchChange).toHaveBeenNthCalledWith(1, { ...launch, effort: "ultracode" });
    expect(onLaunchChange).toHaveBeenNthCalledWith(2, { ...launch, fastMode: true });
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
    expect(host.textContent).toContain("Ultracode");
    expect(host.textContent).not.toContain("Fast Mode");

    renderControls({
      provider: "claudeCode",
      model: "sonnet",
      mode: "bypassPermissions",
      effort: "high",
      context: "200k",
    });
    expect(host.textContent).not.toContain("Ultracode");
    expect(host.textContent).toContain("200kDefault");
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
    const danger = options("agent-launch-mode").filter((option) =>
      option.classList.contains("agent-picker__option--danger"),
    );
    expect(danger).toHaveLength(0);
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
  ): void {
    act(() =>
      root.render(
        <AgentLaunchControls
          disabled={disabled}
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
    retryRegistration: vi.fn(async () => undefined),
    save: vi.fn(async () => true),
    saveWithOutcome: vi.fn(async () => ({ kind: "persisted" as const, policyRegistered: true })),
    update: vi.fn(async () => null),
  };
}
