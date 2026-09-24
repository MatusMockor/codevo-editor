// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Checkbox } from "./Checkbox";
import { click, mountUi, press, type MountedUi } from "./foundationTestSupport";
import { Kbd, ShortcutKeys } from "./Kbd";
import { SegmentedControl } from "./SegmentedControl";
import { Stepper } from "./Stepper";
import { Switch } from "./Switch";

let ui: MountedUi | null = null;

afterEach(() => {
  ui?.unmount();
  ui = null;
});

function mount(node: Parameters<MountedUi["render"]>[0]): MountedUi {
  ui = mountUi();
  ui.render(node);
  return ui;
}

describe("Kbd", () => {
  it("renders keyboard keys and a labelled shortcut group", () => {
    const { host, render } = mount(<Kbd>⌘</Kbd>);
    expect(host.querySelector("kbd.cv-kbd")?.textContent).toBe("⌘");

    render(<ShortcutKeys keys={["⌘", "K"]} label="Command K" />);
    const group = host.querySelector(".cv-kbd-group");
    expect(group?.getAttribute("aria-label")).toBe("Command K");
    expect([...(group?.querySelectorAll("kbd") ?? [])].map((key) => key.textContent)).toEqual([
      "⌘",
      "K",
    ]);
  });
});

describe("Switch", () => {
  it("reports its state and flips on click", () => {
    const onChange = vi.fn();
    const { host } = mount(<Switch checked label="Minimap" onChange={onChange} />);
    const control = host.querySelector('[role="switch"]');

    expect(control?.getAttribute("aria-checked")).toBe("true");
    expect(control?.getAttribute("aria-label")).toBe("Minimap");
    click(control as Element);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("ignores clicks while disabled", () => {
    const onChange = vi.fn();
    const { host } = mount(<Switch checked={false} disabled label="Wrap" onChange={onChange} />);

    click(host.querySelector('[role="switch"]') as Element);

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("Checkbox", () => {
  it("cycles false to true, true to false and mixed to true", () => {
    const onChange = vi.fn();
    const { host, render } = mount(
      <Checkbox checked={false} label="Include file" onChange={onChange} />,
    );
    const box = () => host.querySelector('[role="checkbox"]') as Element;

    click(box());
    render(<Checkbox checked label="Include file" onChange={onChange} />);
    click(box());
    render(<Checkbox checked="mixed" label="Include file" onChange={onChange} />);
    expect(box().getAttribute("aria-checked")).toBe("mixed");
    click(box());

    expect(onChange.mock.calls.map((call) => call[0])).toEqual([true, false, true]);
  });
});

describe("SegmentedControl", () => {
  const OPTIONS = [
    { value: "unified", label: "Unified" },
    { value: "split", label: "Split" },
    { value: "wrap", label: "Wrap" },
  ] as const;

  it("is a labelled radiogroup with one tab stop", () => {
    const { host } = mount(
      <SegmentedControl
        label="Diff layout"
        onChange={() => undefined}
        options={OPTIONS}
        value="split"
      />,
    );
    const radios = [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')];

    expect(host.querySelector('[role="radiogroup"]')?.getAttribute("aria-label")).toBe(
      "Diff layout",
    );
    expect(radios.map((radio) => radio.getAttribute("aria-checked"))).toEqual([
      "false",
      "true",
      "false",
    ]);
    expect(radios.map((radio) => radio.tabIndex)).toEqual([-1, 0, -1]);
  });

  it("selects by click and by wrapping arrow keys, moving focus", () => {
    const onChange = vi.fn();
    const { host } = mount(
      <SegmentedControl label="Diff layout" onChange={onChange} options={OPTIONS} value="wrap" />,
    );
    const radios = [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')];

    click(radios[0] as Element);
    press(radios[2] as Element, "ArrowRight");

    expect(onChange.mock.calls.map((call) => call[0])).toEqual(["unified", "unified"]);
    expect(document.activeElement).toBe(radios[0]);
  });

  it("names icon-only options from their labels", () => {
    const { host } = mount(
      <SegmentedControl
        iconOnly
        label="View"
        onChange={() => undefined}
        options={[{ value: "list", label: "List", icon: <svg /> }]}
        value="list"
      />,
    );
    const radio = host.querySelector('[role="radio"]');

    expect(radio?.getAttribute("aria-label")).toBe("List");
    expect(radio?.textContent).toBe("");
  });
});

describe("Stepper", () => {
  it("exposes a spinbutton with its value, bounds and unit", () => {
    const { host } = mount(
      <Stepper
        label="Editor font size"
        max={40}
        min={8}
        onChange={() => undefined}
        unit="px"
        value={13}
      />,
    );
    const spin = host.querySelector('[role="spinbutton"]');

    expect(spin?.getAttribute("aria-label")).toBe("Editor font size");
    expect(spin?.getAttribute("aria-valuenow")).toBe("13");
    expect(spin?.getAttribute("aria-valuemin")).toBe("8");
    expect(spin?.getAttribute("aria-valuemax")).toBe("40");
    expect(spin?.getAttribute("aria-valuetext")).toBe("13px");
    expect(spin?.textContent).toBe("13px");
  });

  it("steps with keys and buttons and clamps at the bounds", () => {
    const onChange = vi.fn();
    const { host, render } = mount(
      <Stepper label="Size" max={20} min={12} onChange={onChange} value={19} />,
    );
    const spin = () => host.querySelector('[role="spinbutton"]') as Element;

    press(spin(), "ArrowUp");
    press(spin(), "PageUp");
    press(spin(), "Home");
    press(spin(), "ArrowDown");
    render(<Stepper label="Size" max={20} min={12} onChange={onChange} value={20} />);
    press(spin(), "ArrowUp");
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Increase Size"]')?.disabled).toBe(
      true,
    );
    click(host.querySelector('[aria-label="Decrease Size"]') as Element);

    expect(onChange.mock.calls.map((call) => call[0])).toEqual([20, 20, 12, 18, 19]);
  });

  it("commits the clamped value when it starts outside the bounds", () => {
    const onChange = vi.fn();
    const { host, render } = mount(
      <Stepper label="Size" max={20} min={12} onChange={onChange} value={25} />,
    );
    const spin = () => host.querySelector('[role="spinbutton"]') as HTMLElement;

    press(spin(), "ArrowUp");
    expect(onChange.mock.calls.map((call) => call[0])).toEqual([20]);

    render(<Stepper label="Size" max={20} min={12} onChange={onChange} value={3} />);
    spin().focus();
    act(() => {
      spin().blur();
    });
    expect(onChange.mock.calls.map((call) => call[0])).toEqual([20, 12]);

    render(<Stepper label="Size" max={20} min={12} onChange={onChange} value={15} />);
    spin().focus();
    act(() => {
      spin().blur();
    });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("recovers from a non-finite value by starting at the minimum", () => {
    const onChange = vi.fn();
    const { host } = mount(
      <Stepper label="Size" max={20} min={12} onChange={onChange} value={Number.NaN} />,
    );

    expect(host.querySelector('[role="spinbutton"]')?.getAttribute("aria-valuenow")).toBe("12");
    press(host.querySelector('[role="spinbutton"]') as Element, "ArrowUp");
    expect(onChange).toHaveBeenCalledWith(13);
  });
});
