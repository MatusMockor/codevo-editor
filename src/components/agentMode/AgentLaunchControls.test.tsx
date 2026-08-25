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

  it("lists the Claude models and permission modes with hints on every option", () => {
    renderControls({ provider: "claudeCode", model: "opus", mode: "acceptEdits" });

    const models = select("#agent-launch-model");
    const modes = select("#agent-launch-mode");

    expect([...models.options].map((option) => option.value)).toEqual([
      "default",
      "fable",
      "opus",
      "sonnet",
    ]);
    expect([...modes.options].map((option) => option.textContent)).toEqual([
      "Default permissions",
      "Plan only",
      "Accept edits",
      "Bypass permissions",
    ]);
    expect(models.value).toBe("opus");
    expect(modes.value).toBe("acceptEdits");
    expect([...modes.options].every((option) => option.title.length > 0)).toBe(true);
  });

  it("lists the Codex models and execution modes", () => {
    renderControls({ provider: "codex", model: "gpt-5.5", mode: "workspaceWrite" });

    expect([...select("#agent-launch-model").options].map((option) => option.textContent)).toEqual([
      "Default model",
      "GPT-5.6 Sol",
      "GPT-5.5",
      "GPT-5.4",
    ]);
    expect([...select("#agent-launch-mode").options].map((option) => option.value)).toEqual([
      "default",
      "readOnly",
      "workspaceWrite",
      "dangerFullAccess",
    ]);
  });

  it("labels and describes both selects for assistive technology", () => {
    renderControls({ provider: "claudeCode", model: "default", mode: "plan" });

    const modes = select("#agent-launch-mode");
    const describedBy = modes.getAttribute("aria-describedby") ?? "";

    expect(host.querySelector("label[for='agent-launch-model']")?.textContent).toBe("Agent model");
    expect(host.querySelector("label[for='agent-launch-mode']")?.textContent).toBe(
      "Agent permission mode",
    );
    expect(host.querySelector(`#${describedBy}`)?.textContent).toContain("plans the work");
  });

  it("reports the picked model and mode as a whole launch value", () => {
    const onLaunchChange = vi.fn();
    renderControls({ provider: "claudeCode", model: "default", mode: "default" }, onLaunchChange);

    change("#agent-launch-model", "sonnet");
    change("#agent-launch-mode", "bypassPermissions");

    expect(onLaunchChange.mock.calls.map(([value]) => value)).toEqual([
      { provider: "claudeCode", model: "sonnet", mode: "default" },
      { provider: "claudeCode", model: "default", mode: "bypassPermissions" },
    ]);
  });

  it("ignores a value that is not a choice of the current provider", () => {
    const onLaunchChange = vi.fn();
    renderControls({ provider: "codex", model: "default", mode: "default" }, onLaunchChange);

    change("#agent-launch-model", "opus");

    expect(onLaunchChange).toHaveBeenCalledWith({
      provider: "codex",
      model: "default",
      mode: "default",
    });
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
  ): void {
    act(() =>
      root.render(
        <AgentLaunchControls disabled={false} launch={launch} onLaunchChange={onLaunchChange} />,
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

  function select(selector: string): HTMLSelectElement {
    const element = host.querySelector<HTMLSelectElement>(selector);
    expect(element).not.toBeNull();
    return element ?? document.createElement("select");
  }

  function change(selector: string, value: string): void {
    const element = select(selector);
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(
        element,
        value,
      );
      element.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
});
