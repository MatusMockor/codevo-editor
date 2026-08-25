// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentLaunchOptions } from "../../domain/agentLaunch";
import { AgentLaunchControls, AgentLaunchWarning } from "./AgentLaunchControls";

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
    renderControls({ provider: "claudeCode", model: "opus", mode: "acceptEdits" });

    expect(trigger("agent-launch-model").textContent).toContain("Opus");
    expect(trigger("agent-launch-mode").textContent).toContain("Accept edits");

    open("agent-launch-model");
    expect(optionValues("agent-launch-model")).toEqual(["default", "fable", "opus", "sonnet"]);
    expect(selectedOption("agent-launch-model")?.dataset.value).toBe("opus");

    open("agent-launch-mode");
    expect(options("agent-launch-mode").map((option) => optionLabel(option))).toEqual([
      "Default permissions",
      "Plan only",
      "Accept edits",
      "Bypass permissions",
    ]);
    expect(
      options("agent-launch-mode").every(
        (option) => (option.querySelector(".agent-picker__description")?.textContent ?? "") !== "",
      ),
    ).toBe(true);
    expect(host.querySelectorAll('[role="listbox"]')).toHaveLength(1);
  });

  it("lists the Codex models and execution modes", () => {
    renderControls({ provider: "codex", model: "gpt-5.5", mode: "workspaceWrite" });

    open("agent-launch-model");
    expect(options("agent-launch-model").map((option) => optionLabel(option))).toEqual([
      "Default model",
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
    renderControls({ provider: "claudeCode", model: "default", mode: "plan" });

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
    renderControls({ provider: "claudeCode", model: "default", mode: "default" }, onLaunchChange);

    pick("agent-launch-model", "sonnet");
    pick("agent-launch-mode", "bypassPermissions");

    expect(onLaunchChange.mock.calls.map(([value]) => value)).toEqual([
      { provider: "claudeCode", model: "sonnet", mode: "default" },
      { provider: "claudeCode", model: "default", mode: "bypassPermissions" },
    ]);
  });

  it("tones the mode trigger and flags dangerous options in the list", () => {
    renderControls({ provider: "claudeCode", model: "default", mode: "plan" });
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
      { provider: "claudeCode", model: "default", mode: "default" },
      () => undefined,
      true,
    );

    expect(trigger("agent-launch-model").disabled).toBe(true);
    open("agent-launch-model");
    expect(host.querySelector('[role="listbox"]')).toBeNull();
  });

  it("stays silent for a safe mode and warns for a dangerous one", () => {
    const onConfirmedChange = vi.fn();
    renderWarning(
      { provider: "claudeCode", model: "opus", mode: "acceptEdits" },
      false,
      onConfirmedChange,
    );

    expect(host.querySelector(".agent-composer__danger")).toBeNull();

    renderWarning(
      { provider: "claudeCode", model: "opus", mode: "bypassPermissions" },
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
        <AgentLaunchControls disabled={disabled} launch={launch} onLaunchChange={onLaunchChange} />,
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
    return option.querySelector(".agent-picker__label")?.textContent ?? "";
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
