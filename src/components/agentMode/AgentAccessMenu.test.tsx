// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentLaunchOptions } from "../../domain/agentLaunch";
import { AgentAccessMenu } from "./AgentAccessMenu";
import { defaultAgentComposerLaunch } from "./agentComposerLaunch";

describe("AgentAccessMenu", () => {
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

  function render(launch: AgentLaunchOptions, onChange = vi.fn()) {
    act(() =>
      root.render(
        <AgentAccessMenu disabled={false} launch={launch} onChange={onChange} target="local" />,
      ),
    );
    return onChange;
  }

  function trigger(): HTMLButtonElement {
    const element = host.querySelector<HTMLButtonElement>('[aria-label="Agent permission mode"]');
    expect(element).not.toBeNull();
    return element ?? document.createElement("button");
  }

  function rows(): HTMLButtonElement[] {
    return [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
  }

  function press(target: Element | null, key: string): void {
    act(() => {
      target?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }));
    });
  }

  it("lists access modes, then plan and CLI settings, and selects plan mode", () => {
    const launch = { ...defaultAgentComposerLaunch("claudeCode"), mode: "bypassPermissions" };
    const onChange = render(launch as AgentLaunchOptions);
    expect(trigger().id).toBe("agent-launch-mode");
    expect(trigger().getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger().textContent).toContain("Full access");
    act(() => trigger().click());
    const labels = rows().map(
      (node) => node.querySelector(".cv-menu__text")?.firstChild?.textContent,
    );
    expect(labels).toEqual([
      "Supervised",
      "Auto-accept edits",
      "Auto",
      "Full access",
      "Plan mode",
      "Use Claude CLI settings",
    ]);
    expect(rows()[3]?.getAttribute("aria-checked")).toBe("true");
    expect(document.querySelectorAll('[role="menu"] [role="separator"]').length).toBe(1);
    expect(document.querySelector('[role="menu"] .cv-menu__label')?.textContent).toBe("Access");
    act(() => rows()[4]?.click());
    expect(onChange).toHaveBeenCalledWith("plan");
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("tones the trigger for plan mode and shows the CLI settings summary label", () => {
    const plan = { ...defaultAgentComposerLaunch("claudeCode"), mode: "plan" };
    render(plan as AgentLaunchOptions);
    expect(trigger().classList.contains("agent-picker__trigger--plan")).toBe(true);
    const cli = { ...defaultAgentComposerLaunch("claudeCode"), mode: "default" };
    render(cli as AgentLaunchOptions);
    expect(trigger().textContent).toBe("Claude CLI settings");
  });

  it("lists the Codex modes with its CLI settings row", () => {
    render({ provider: "codex", model: "default", mode: "workspaceWrite" });
    act(() => trigger().click());
    expect(
      rows().map((node) => node.querySelector(".cv-menu__text")?.firstChild?.textContent),
    ).toEqual(["Read-only", "Workspace write", "Auto", "Full access", "Use Codex CLI settings"]);
  });

  it("selects with Enter and Space and returns focus to the trigger on Escape", () => {
    const onChange = render({ provider: "codex", model: "default", mode: "workspaceWrite" });
    trigger().focus();
    act(() => trigger().click());
    press(document.querySelector('[role="menu"]'), "Home");
    press(document.activeElement, "Enter");
    expect(onChange).toHaveBeenLastCalledWith("readOnly");
    expect(document.activeElement).toBe(trigger());
    act(() => trigger().click());
    press(document.querySelector('[role="menu"]'), "End");
    press(document.activeElement, " ");
    expect(onChange).toHaveBeenLastCalledWith("default");
    act(() => trigger().click());
    press(document.activeElement, "Escape");
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger());
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("opens from an open request", () => {
    const request = {};
    const onHandled = vi.fn();
    act(() =>
      root.render(
        <AgentAccessMenu
          disabled={false}
          launch={{ provider: "codex", model: "default", mode: "auto" }}
          onChange={vi.fn()}
          onOpenRequestHandled={onHandled}
          openRequest={request}
          target="local"
        />,
      ),
    );
    expect(document.querySelector('[role="menu"][aria-label="Access"]')).not.toBeNull();
    expect(onHandled).toHaveBeenCalledOnce();
  });
});
