// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentExecutionTarget, AgentLaunchOptions } from "../../domain/agentLaunch";
import { AgentComposerCompactMenu } from "./AgentComposerCompactMenu";
import { defaultAgentComposerLaunch } from "./agentComposerLaunch";
import { AgentTraitsPicker } from "./AgentTraitsPicker";

type ClaudeLaunch = AgentLaunchOptions & { readonly provider: "claudeCode" };

function claudeLaunch(overrides: Partial<ClaudeLaunch> = {}): ClaudeLaunch {
  const base = defaultAgentComposerLaunch("claudeCode");
  expect(base.provider).toBe("claudeCode");
  return { ...(base as ClaudeLaunch), model: "claude-opus-5-5", effort: "high", ...overrides };
}

describe("AgentTraitsPicker", () => {
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

  function render(
    options: {
      readonly launch?: ClaudeLaunch;
      readonly onChange?: (next: AgentLaunchOptions) => void;
      readonly target?: AgentExecutionTarget;
      readonly compact?: boolean;
    } = {},
  ) {
    const onChange = options.onChange ?? vi.fn();
    const picker = (
      <AgentTraitsPicker
        configuredModel={null}
        disabled={false}
        executionTarget={options.target ?? "local"}
        launch={options.launch ?? claudeLaunch()}
        onChange={onChange}
      />
    );
    act(() =>
      root.render(
        options.compact === true ? (
          <AgentComposerCompactMenu disabled={false}>{picker}</AgentComposerCompactMenu>
        ) : (
          picker
        ),
      ),
    );
    return onChange;
  }

  function trigger(): HTMLButtonElement {
    const element = host.querySelector<HTMLButtonElement>('[aria-label="Model capabilities"]');
    expect(element).not.toBeNull();
    return element ?? document.createElement("button");
  }

  function menu(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[role="menu"][aria-label="Effort and options"]');
  }

  function radio(label: string): HTMLButtonElement | undefined {
    return [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find(
      (node) => node.querySelector(".cv-menu__text")?.firstChild?.textContent === label,
    );
  }

  function press(target: Element | null, key: string): void {
    act(() => {
      target?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }));
    });
  }

  it("opens a menu with an effort radio group and the checked effort", () => {
    render();
    expect(trigger().getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger().textContent).toBe("High · 1M");
    act(() => trigger().click());
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    const labels = [...(menu()?.querySelectorAll(".cv-menu__label") ?? [])].map(
      (node) => node.textContent,
    );
    expect(labels).toEqual(["Effort", "Context window"]);
    const checked = [
      ...document.querySelectorAll('[role="menuitemradio"][aria-checked="true"]'),
    ].map((node) => node.querySelector(".cv-menu__text")?.firstChild?.textContent);
    expect(checked).toEqual(["High", "1M"]);
    expect(radio("Extra high")).toBeDefined();
    expect(radio("Ultracode")?.textContent).toContain("multi-agent");
    expect(radio("Medium")?.textContent).toContain("Default");
  });

  it("offers fast mode and browser tools as switches that keep the menu open", () => {
    const onChange = render();
    act(() => trigger().click());
    const switches = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]')];
    expect(switches.map((node) => node.textContent)).toEqual(["Fast mode", "Chrome browser tools"]);
    expect(switches.map((node) => node.getAttribute("aria-checked"))).toEqual(["false", "true"]);
    act(() => switches[0]?.click());
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ fastMode: true }));
    expect(menu()).not.toBeNull();
  });

  it("hides the browser tools switch for a remote target", () => {
    render({ target: "server" });
    act(() => trigger().click());
    expect(document.body.textContent).not.toContain("Chrome browser tools");
  });

  it("changes effort and closes; Escape returns focus to the trigger", () => {
    const onChange = render();
    act(() => trigger().click());
    act(() => radio("Low")?.click());
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ effort: "low" }));
    expect(menu()).toBeNull();
    act(() => trigger().click());
    press(document.activeElement, "Escape");
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("is fully keyboard operable: arrows rove, Enter and Space select radio rows", () => {
    const onChange = render();
    trigger().focus();
    act(() => trigger().click());
    expect(document.activeElement?.getAttribute("role")).toBe("menuitemradio");
    press(menu(), "Home");
    press(menu(), "ArrowDown");
    expect(document.activeElement).toBe(radio("Medium"));
    press(document.activeElement, "Enter");
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ effort: "medium" }));
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger());
    act(() => trigger().click());
    press(menu(), "Home");
    press(document.activeElement, " ");
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ effort: "low" }));
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("closes only the effort menu inside the compact panel on Escape and on a pick", () => {
    const onChange = render({ compact: true });
    act(() =>
      host.querySelector<HTMLButtonElement>('[aria-label="More composer controls"]')?.click(),
    );
    const panel = () => host.querySelector('[aria-label="Composer controls"]');
    expect(panel()).not.toBeNull();
    act(() => trigger().click());
    expect(menu()).not.toBeNull();
    press(document.activeElement, "Escape");
    expect(menu()).toBeNull();
    expect(panel()).not.toBeNull();
    expect(document.activeElement).toBe(trigger());
    act(() => trigger().click());
    const low = radio("Low");
    act(() => {
      low?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      low?.focus();
      low?.click();
    });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ effort: "low" }));
    expect(panel()).not.toBeNull();
  });
});
