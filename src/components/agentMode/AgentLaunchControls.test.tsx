// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentModelFavorites } from "../../application/useAgentModelFavorites";
import type { AgentLaunchOptions } from "../../domain/agentLaunch";
import { AgentLaunchControls, AgentLaunchWarning } from "./AgentLaunchControls";

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
      model: "opus",
      mode: "acceptEdits",
      effort: "default",
    });

    expect(trigger("agent-launch-model").textContent).toBe("Claude Opus 5");
    expect(trigger("agent-launch-mode").textContent).toContain("Accept edits");

    open("agent-launch-model");
    expect(optionValues("agent-launch-model")).toEqual(["default", "fable", "opus", "sonnet"]);
    expect(selectedOption("agent-launch-model")?.dataset.value).toBe("opus");

    open("agent-launch-mode");
    expect(options("agent-launch-mode").map((option) => optionLabel(option))).toEqual([
      "Default permissions",
      "Plan mode",
      "Accept edits",
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
      { provider: "claudeCode", model: "opus", mode: "default", effort: "high" },
      onLaunchChange,
    );

    expect(trigger("agent-launch-effort").textContent).toBe("High");
    expect(trigger("agent-launch-effort").getAttribute("aria-label")).toBe(
      "Agent reasoning effort",
    );
    open("agent-launch-effort");
    expect(optionValues("agent-launch-effort")).toEqual([
      "default",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    open("agent-launch-effort");

    pick("agent-launch-effort", "max");

    expect(onLaunchChange).toHaveBeenCalledWith({
      provider: "claudeCode",
      model: "opus",
      mode: "default",
      effort: "max",
    });

    renderControls({ provider: "codex", model: "default", mode: "default" });

    expect(host.querySelector("#agent-launch-effort")).toBeNull();
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
    expect(trigger("agent-launch-model").textContent).toBe("Claude (default)");
    expect(trigger("agent-launch-effort").textContent).toBe("Default effort");
    expect(trigger("agent-launch-mode").textContent).toBe("Default permissions");
    const dividers = host.querySelectorAll(".agent-composer__divider");
    expect(dividers).toHaveLength(2);
    expect(dividers[0]?.getAttribute("aria-hidden")).toBe("true");

    renderControls({ provider: "codex", model: "gpt-5.6-sol", mode: "workspaceWrite" });

    expect(trigger("agent-launch-model").textContent).toBe("GPT-5.6 Sol");
    expect(trigger("agent-launch-mode").textContent).toBe("Workspace write");
    expect(host.querySelectorAll(".agent-composer__divider")).toHaveLength(1);
  });

  it("shows an open lock only for a mode that removes the safety checks", () => {
    renderControls({ provider: "claudeCode", model: "default", mode: "plan", effort: "default" });
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
      "Codex (default)",
      "GPT-5.6 Sol",
      "GPT-5.5",
      "GPT-5.4",
    ]);

    open("agent-launch-mode");
    expect(optionValues("agent-launch-mode")).toEqual([
      "default",
      "readOnly",
      "workspaceWrite",
      "dangerFullAccess",
    ]);
  });

  it("labels both pickers and describes the current choice for assistive technology", () => {
    renderControls({ provider: "claudeCode", model: "default", mode: "plan", effort: "default" });

    expect(trigger("agent-launch-model").getAttribute("aria-label")).toBe("Agent model");
    expect(trigger("agent-launch-mode").getAttribute("aria-label")).toBe("Agent permission mode");
    expect(trigger("agent-launch-mode").getAttribute("aria-haspopup")).toBe("listbox");
    expect(trigger("agent-launch-mode").title).toContain("plans the work");

    const modelHint = trigger("agent-launch-model").getAttribute("aria-describedby") ?? "";
    const modeHint = trigger("agent-launch-mode").getAttribute("aria-describedby") ?? "";
    expect(host.querySelector(`#${modelHint}`)?.textContent).toContain("Claude CLI");
    expect(host.querySelector(`#${modeHint}`)?.textContent).toContain("plans the work");
    expect(host.querySelector(`#${modeHint}`)?.className).toBe("agent-visually-hidden");
  });

  it("reports the picked model and mode as a whole launch value", () => {
    const onLaunchChange = vi.fn();
    renderControls(
      { provider: "claudeCode", model: "default", mode: "default", effort: "default" },
      onLaunchChange,
    );

    pick("agent-launch-model", "sonnet");
    pick("agent-launch-mode", "bypassPermissions");

    expect(onLaunchChange.mock.calls.map(([value]) => value)).toEqual([
      { provider: "claudeCode", model: "sonnet", mode: "default", effort: "default" },
      { provider: "claudeCode", model: "default", mode: "bypassPermissions", effort: "default" },
    ]);
  });

  it("tones the mode trigger and flags dangerous options in the list", () => {
    renderControls({ provider: "claudeCode", model: "default", mode: "plan", effort: "default" });
    expect(trigger("agent-launch-mode").classList.contains("agent-picker__trigger--plan")).toBe(
      true,
    );

    renderControls({ provider: "codex", model: "default", mode: "dangerFullAccess" });
    expect(trigger("agent-launch-mode").classList.contains("agent-picker__trigger--danger")).toBe(
      true,
    );

    open("agent-launch-mode");
    const danger = options("agent-launch-mode").filter((option) =>
      option.classList.contains("agent-picker__option--danger"),
    );
    expect(danger.map((option) => option.dataset.value)).toEqual(["dangerFullAccess"]);
    expect(danger[0]?.querySelector(".agent-picker__warn")).not.toBeNull();
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

  it("stays silent for a safe mode and warns for a dangerous one", () => {
    const onConfirmedChange = vi.fn();
    renderWarning(
      { provider: "claudeCode", model: "opus", mode: "acceptEdits", effort: "default" },
      false,
      onConfirmedChange,
    );

    expect(host.querySelector(".agent-composer__danger")).toBeNull();

    renderWarning(
      { provider: "claudeCode", model: "opus", mode: "bypassPermissions", effort: "default" },
      false,
      onConfirmedChange,
    );

    const warning = host.querySelector(".agent-composer__danger");
    expect(warning?.getAttribute("role")).toBe("alert");
    expect(warning?.textContent).toContain("Bypasses permission checks");
    expect(host.querySelector("input#agent-launch-danger-confirm")).not.toBeNull();
  });

  function renderControls(
    launch: AgentLaunchOptions,
    onLaunchChange: (next: AgentLaunchOptions) => void = () => undefined,
    disabled = false,
  ): void {
    act(() =>
      root.render(
        <AgentLaunchControls
          disabled={disabled}
          favorites={NO_FAVORITES}
          launch={launch}
          onLaunchChange={onLaunchChange}
        />,
      ),
    );
  }

  function renderWarning(
    launch: AgentLaunchOptions,
    confirmed: boolean,
    onConfirmedChange: (next: boolean) => void,
  ): void {
    act(() =>
      root.render(
        <AgentLaunchWarning
          confirmed={confirmed}
          launch={launch}
          onConfirmedChange={onConfirmedChange}
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
