// @vitest-environment jsdom

import { act, useRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsButton } from "./SettingsButton";
import { SettingsChipGroup } from "./SettingsChipGroup";
import { SettingsNumberField } from "./SettingsNumberField";
import { SettingsPopover } from "./SettingsPopover";
import { SettingsRow } from "./SettingsRow";
import { SettingsSectionHeading } from "./SettingsSectionHeading";
import { SettingsSegmented } from "./SettingsSegmented";
import { SettingsSelect } from "./SettingsSelect";
import { SettingsSwitch } from "./SettingsSwitch";
import { SettingsTextField } from "./SettingsTextField";

describe("settings primitives", () => {
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

  it("renders the row title and description from the registry and labels its control", () => {
    render(
      <SettingsRow rowId="general.formatOnSave">
        <SettingsSwitch checked={false} onChange={() => undefined} />
      </SettingsRow>,
    );

    const row = host.querySelector('[data-settings-row="general.formatOnSave"]');
    const control = host.querySelector('[role="switch"]');
    const labelId = control?.getAttribute("aria-labelledby");
    const describedById = control?.getAttribute("aria-describedby");

    expect(row?.querySelector("h3")?.textContent).toBe("Format on save");
    expect(row?.querySelector(`#${labelId}`)?.textContent).toBe("Format on save");
    expect(row?.querySelector(`#${describedById}`)?.textContent).toBe(
      "Run the language formatter before the file is written.",
    );
  });

  it("exposes the switch as a role=switch button that reports and flips its state", () => {
    const onChange = vi.fn();
    render(<SettingsSwitch checked label="Format on save" onChange={onChange} />);

    const control = host.querySelector<HTMLButtonElement>('[role="switch"]');

    expect(control?.getAttribute("aria-checked")).toBe("true");
    expect(control?.getAttribute("aria-label")).toBe("Format on save");

    act(() => control?.click());

    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("labels a section heading and keeps its rows inside it", () => {
    render(
      <SettingsSectionHeading actions={<span>meta</span>} title="Editing">
        <SettingsRow rowId="general.autoSave">
          <span>value</span>
        </SettingsRow>
      </SettingsSectionHeading>,
    );

    const section = host.querySelector("section");

    expect(section?.querySelector("h2")?.textContent).toBe("Editing");
    expect(section?.getAttribute("aria-labelledby")).toBe(section?.querySelector("h2")?.id);
    expect(section?.querySelector('[data-settings-row="general.autoSave"]')).not.toBeNull();
  });

  it("clamps the number stepper at both bounds and commits typing on blur", () => {
    const onChange = vi.fn();
    render(<SettingsNumberField label="Tasks" max={8} min={1} onChange={onChange} value={8} />);

    const [decrease, increase] = [...host.querySelectorAll<HTMLButtonElement>("button")];

    expect(increase?.disabled).toBe(true);

    act(() => decrease?.click());

    expect(onChange).toHaveBeenLastCalledWith(7);

    const input = host.querySelector<HTMLInputElement>("input");

    setNumber(input, "900");

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(input?.getAttribute("aria-invalid")).toBe("true");

    blur(input);

    expect(onChange).toHaveBeenCalledTimes(1);

    setNumber(input, "0");
    blur(input);

    expect(onChange).toHaveBeenLastCalledWith(1);

    setNumber(input, "3.4");
    blur(input);

    expect(onChange).toHaveBeenLastCalledWith(3);
  });

  it("keeps an intermediate keystroke unclamped until the value is committed", () => {
    const onChange = vi.fn();
    render(
      <SettingsNumberField label="Font size" max={40} min={8} onChange={onChange} value={13} />,
    );

    const input = host.querySelector<HTMLInputElement>("input");

    setNumber(input, "1");

    expect(onChange).not.toHaveBeenCalled();
    expect(input?.value).toBe("1");

    setNumber(input, "12");

    expect(onChange).not.toHaveBeenCalled();

    act(() => {
      input?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    });

    expect(onChange).toHaveBeenCalledExactlyOnceWith(12);
  });

  it("only publishes select values that exist as options", () => {
    const onChange = vi.fn();
    render(
      <SettingsSelect
        label="Mode"
        onChange={onChange}
        options={[
          { label: "Auto", value: "auto" },
          { label: "Off", value: "off" },
        ]}
        value="auto"
      />,
    );

    const select = host.querySelector<HTMLSelectElement>("select");

    expect(select?.getAttribute("aria-label")).toBe("Mode");

    const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");

    act(() => {
      if (select === null) return;
      descriptor?.set?.call(select, "off");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith("off");
  });

  it("moves the segmented radio group with the arrow keys", () => {
    const onChange = vi.fn();
    render(
      <SettingsSegmented
        label="Appearance"
        onChange={onChange}
        options={[
          { label: "Current", value: "current" },
          { label: "Paper", value: "paper" },
        ]}
        value="current"
      />,
    );

    const group = host.querySelector<HTMLElement>('[role="radiogroup"]');
    const radios = [...host.querySelectorAll<HTMLElement>('[role="radio"]')];

    expect(group?.getAttribute("aria-label")).toBe("Appearance");
    expect(radios[0]?.getAttribute("aria-checked")).toBe("true");
    expect(radios[1]?.tabIndex).toBe(-1);

    act(() => {
      group?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
    });

    expect(onChange).toHaveBeenCalledWith("paper");
  });

  it("reports chip toggles with aria-pressed", () => {
    const onToggle = vi.fn();
    render(
      <SettingsChipGroup
        chips={[
          { label: "Git branch", value: "gitBranch" },
          { label: "Mode", value: "mode" },
        ]}
        label="Status bar"
        onToggle={onToggle}
        selected={["gitBranch"]}
      />,
    );

    const chips = [...host.querySelectorAll<HTMLButtonElement>('[role="group"] button')];

    expect(chips[0]?.getAttribute("aria-pressed")).toBe("true");
    expect(chips[1]?.getAttribute("aria-pressed")).toBe("false");

    act(() => chips[0]?.click());

    expect(onToggle).toHaveBeenCalledWith("gitBranch", false);
  });

  it("renders text fields read-only when no change handler is supplied", () => {
    render(<SettingsTextField label="Workspace" value="/tmp/project" />);

    const input = host.querySelector<HTMLInputElement>("input");

    expect(input?.readOnly).toBe(true);
    expect(input?.value).toBe("/tmp/project");
    expect(input?.getAttribute("aria-label")).toBe("Workspace");
  });

  it("stamps the button variant and size classes", () => {
    render(
      <SettingsButton
        label="Update now"
        onClick={() => undefined}
        size="micro"
        variant="primary"
      />,
    );

    const button = host.querySelector("button");

    expect(button?.className).toBe("settings-btn settings-btn--primary settings-btn--micro");
  });

  function blur(input: HTMLInputElement | null): void {
    act(() => {
      input?.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
  }

  function setNumber(input: HTMLInputElement | null, value: string): void {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");

    act(() => {
      if (input === null) return;
      descriptor?.set?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function render(node: ReactNode): void {
    act(() => root.render(node));
  }
});

describe("SettingsPopover", () => {
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

  it("focuses its first control, traps Tab and closes on Escape and outside clicks", () => {
    const onClose = vi.fn();
    act(() => root.render(<PopoverHarness onClose={onClose} open />));

    const popover = host.querySelector<HTMLElement>('[role="dialog"]');
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')];

    expect(popover?.getAttribute("aria-labelledby")).not.toBeNull();
    expect(document.activeElement).toBe(buttons[0]);

    act(() => {
      buttons[buttons.length - 1]?.focus();
      document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Tab" }));
    });

    expect(document.activeElement).toBe(buttons[0]);

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    });

    expect(onClose).toHaveBeenLastCalledWith(true);

    act(() => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    expect(onClose).toHaveBeenLastCalledWith(false);
  });

  it("renders nothing while closed", () => {
    act(() => root.render(<PopoverHarness onClose={() => undefined} open={false} />));

    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });
});

function PopoverHarness({
  onClose,
  open,
}: {
  readonly open: boolean;
  onClose(restoreFocus: boolean): void;
}) {
  const anchorRef = useRef<HTMLButtonElement | null>(null);

  return (
    <div>
      <button ref={anchorRef} type="button">
        anchor
      </button>
      <SettingsPopover anchorRef={anchorRef} label="Update available" onClose={onClose} open={open}>
        <button type="button">Update now</button>
        <button type="button">Skip this version</button>
      </SettingsPopover>
    </div>
  );
}
