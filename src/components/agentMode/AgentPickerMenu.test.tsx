// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentPickerMenu, type AgentPickerMenuProps } from "./AgentPickerMenu";
import { agentPickerOption } from "./agentPickerOption";

const OPTIONS = [
  agentPickerOption("default", "Default", "Uses the configured default."),
  agentPickerOption("plan", "Plan only", "Plans without changing files.", "plan"),
  agentPickerOption("bypass", "Bypass", "Skips every check.", "danger"),
];

describe("AgentPickerMenu", () => {
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

  it("shows the current value on a closed trigger and no listbox", () => {
    render({});

    expect(trigger().textContent).toBe("Default");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(trigger().dataset.value).toBe("default");
    expect(host.querySelector('[role="listbox"]')).toBeNull();
  });

  it("opens an anchored listbox with the selected option checked and focused", () => {
    render({ value: "plan" });

    click(trigger());

    const list = host.querySelector<HTMLElement>('[role="listbox"]');
    expect(list?.id).toBe("picker-list");
    expect(trigger().getAttribute("aria-controls")).toBe("picker-list");
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(options().map((option) => option.getAttribute("aria-selected"))).toEqual([
      "false",
      "true",
      "false",
    ]);
    expect(document.activeElement?.getAttribute("data-value")).toBe("plan");
    expect(options()[1]?.querySelector(".agent-picker__description")?.textContent).toBe(
      "Plans without changing files.",
    );
  });

  it("reports a picked option, closes and returns focus to the trigger", () => {
    const onChange = vi.fn();
    render({ onChange });

    click(trigger());
    click(options()[2]);

    expect(onChange).toHaveBeenCalledWith("bypass");
    expect(host.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("does not report the option that is already selected", () => {
    const onChange = vi.fn();
    render({ onChange, value: "plan" });

    click(trigger());
    click(options()[1]);

    expect(onChange).not.toHaveBeenCalled();
    expect(host.querySelector('[role="listbox"]')).toBeNull();
  });

  it("moves with the arrow keys, wraps, jumps with Home and End and picks with Enter", () => {
    const onChange = vi.fn();
    render({ onChange });

    key(trigger(), "ArrowDown");
    expect(document.activeElement?.getAttribute("data-value")).toBe("default");

    key(listbox(), "ArrowDown");
    expect(document.activeElement?.getAttribute("data-value")).toBe("plan");

    key(listbox(), "ArrowUp");
    key(listbox(), "ArrowUp");
    expect(document.activeElement?.getAttribute("data-value")).toBe("bypass");

    key(listbox(), "Home");
    expect(document.activeElement?.getAttribute("data-value")).toBe("default");

    key(listbox(), "End");
    key(listbox(), "Enter");

    expect(onChange).toHaveBeenCalledWith("bypass");
    expect(host.querySelector('[role="listbox"]')).toBeNull();
  });

  it("picks with Space and closes with Escape without reporting", () => {
    const onChange = vi.fn();
    render({ onChange });

    click(trigger());
    key(listbox(), "ArrowDown");
    key(listbox(), " ");
    expect(onChange).toHaveBeenCalledWith("plan");

    click(trigger());
    key(listbox(), "Escape");

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("closes on a click outside", () => {
    render({});
    click(trigger());

    act(() => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    expect(host.querySelector('[role="listbox"]')).toBeNull();
  });

  it("keeps only one picker open at a time", () => {
    act(() =>
      root.render(
        <>
          <AgentPickerMenu {...defaultProps()} id="first" label="First" />
          <AgentPickerMenu {...defaultProps()} id="second" label="Second" />
        </>,
      ),
    );

    click(host.querySelector<HTMLButtonElement>("button#first"));
    expect(host.querySelectorAll('[role="listbox"]')).toHaveLength(1);

    const second = host.querySelector<HTMLButtonElement>("button#second");
    act(() => {
      second?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      second?.click();
    });

    const lists = [...host.querySelectorAll('[role="listbox"]')];
    expect(lists.map((list) => list.id)).toEqual(["second-list"]);
  });

  it("tones the trigger and marks dangerous options with a warning glyph", () => {
    render({ tone: "danger", value: "bypass" });

    expect(trigger().classList.contains("agent-picker__trigger--danger")).toBe(true);

    click(trigger());

    const danger = options()[2];
    expect(danger?.classList.contains("agent-picker__option--danger")).toBe(true);
    expect(danger?.querySelector(".agent-picker__warn")).not.toBeNull();
    expect(options()[1]?.classList.contains("agent-picker__option--plan")).toBe(true);
    expect(options()[0]?.querySelector(".agent-picker__warn")).toBeNull();
  });

  it("shows a prefix and a per-option detail", () => {
    render({
      options: [agentPickerOption("all", "All", null, null, 4)],
      prefix: "Status",
      value: "all",
    });

    expect(trigger().textContent).toBe("Status:All");

    click(trigger());

    expect(options()[0]?.querySelector(".agent-picker__detail")?.textContent).toBe("4");
  });

  it("stays closed while disabled", () => {
    render({ disabled: true });

    click(trigger());
    key(trigger(), "ArrowDown");

    expect(host.querySelector('[role="listbox"]')).toBeNull();
  });

  it("opens upward when the trigger sits near the bottom of the window", () => {
    render({});
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue(domRect(window.innerHeight - 20));
    const height = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(200);

    click(trigger());

    expect(host.querySelector(".agent-picker")?.getAttribute("data-placement")).toBe("up");
    expect(listbox().style.bottom).toBe(`${20 + 4}px`);

    rect.mockRestore();
    height.mockRestore();
  });

  it("keeps the menu inside the viewport and bounded in width and height", () => {
    render({ align: "end", value: "plan" });
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue(domRect(40, window.innerWidth - 20, 500));
    const width = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(300);

    click(trigger());

    expect(listbox().style.right).toBe("8px");
    expect(listbox().style.minWidth).toBe("320px");
    expect(Number.parseInt(listbox().style.maxHeight, 10)).toBeLessThanOrEqual(320);
    expect(Number.parseInt(listbox().style.maxHeight, 10)).toBeGreaterThan(0);

    rect.mockRestore();
    width.mockRestore();
  });

  it("clamps a start aligned menu that would overflow the right edge", () => {
    render({});
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue(domRect(40, window.innerWidth - 10, 100));
    const width = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(300);

    click(trigger());

    expect(listbox().style.left).toBe(`${window.innerWidth - 8 - 300}px`);

    rect.mockRestore();
    width.mockRestore();
  });

  it("re-places the open menu when the window resizes", () => {
    render({});
    let left = 40;
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(() => domRect(40, left, 100));

    click(trigger());
    expect(listbox().style.left).toBe("40px");

    left = 120;
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(listbox().style.left).toBe("120px");

    rect.mockRestore();
  });

  it("keeps Escape and the picker keys away from window listeners", () => {
    const onWindowKeyDown = vi.fn();
    window.addEventListener("keydown", onWindowKeyDown);
    render({});

    click(trigger());
    key(listbox(), "ArrowDown");
    key(listbox(), "Escape");

    expect(onWindowKeyDown).not.toHaveBeenCalled();
    expect(host.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(trigger());

    window.removeEventListener("keydown", onWindowKeyDown);
  });

  it("closes on Tab and lets the browser move focus onward", () => {
    render({});
    click(trigger());

    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Tab" });
    act(() => {
      listbox().dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(false);
    expect(host.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("shows a neutral label for a value that is not among the options", () => {
    render({ value: "retired" });

    expect(trigger().textContent).toBe("Select…");
    expect(trigger().dataset.value).toBe("retired");

    click(trigger());

    expect(options().map((option) => option.getAttribute("aria-selected"))).toEqual([
      "false",
      "false",
      "false",
    ]);
    expect(host.querySelector(".agent-picker__mark svg")).toBeNull();
  });

  it("describes the trigger with the given element", () => {
    render({ describedBy: "picker-hint" });

    expect(trigger().getAttribute("aria-describedby")).toBe("picker-hint");
  });

  it("closes when it is disabled while the menu is open", () => {
    const onChange = vi.fn();
    render({ onChange });
    click(trigger());
    expect(host.querySelector('[role="listbox"]')).not.toBeNull();

    render({ disabled: true, onChange });

    expect(host.querySelector('[role="listbox"]')).toBeNull();

    click(trigger());
    key(trigger(), "ArrowDown");

    expect(host.querySelector('[role="listbox"]')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  function render(overrides: Partial<AgentPickerMenuProps>): void {
    act(() => root.render(<AgentPickerMenu {...defaultProps()} {...overrides} />));
  }

  function trigger(): HTMLButtonElement {
    const element = host.querySelector<HTMLButtonElement>("button#picker");
    expect(element).not.toBeNull();
    return element ?? document.createElement("button");
  }

  function listbox(): HTMLElement {
    const element = host.querySelector<HTMLElement>('[role="listbox"]');
    expect(element).not.toBeNull();
    return element ?? document.createElement("div");
  }

  function options(): ReadonlyArray<HTMLElement> {
    return [...host.querySelectorAll<HTMLElement>('[role="option"]')];
  }

  function click(element: HTMLElement | null | undefined): void {
    expect(element).not.toBeNull();
    act(() => element?.click());
  }

  function key(element: HTMLElement, key: string): void {
    act(() => {
      element.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key }));
    });
  }
});

function defaultProps(): AgentPickerMenuProps {
  return {
    align: "start",
    describedBy: null,
    disabled: false,
    id: "picker",
    label: "Picker",
    onChange: () => undefined,
    options: OPTIONS,
    prefix: null,
    tone: null,
    value: "default",
  };
}

function domRect(top: number, left = 0, width = 100): DOMRect {
  return {
    bottom: top + 28,
    height: 28,
    left,
    right: left + width,
    top,
    width,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
}
