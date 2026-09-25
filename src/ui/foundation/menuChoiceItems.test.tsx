// @vitest-environment jsdom
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { click, mountUi, press } from "./foundationTestSupport";
import { Menu } from "./Menu";
import { MenuLabel, MenuSeparator } from "./MenuItem";
import { MenuRadioItem } from "./MenuRadioItem";
import { MenuSwitchItem } from "./MenuSwitchItem";

function Harness({
  onPick,
  onToggle,
}: {
  onPick(value: string): void;
  onToggle(next: boolean): void;
}) {
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(true);
  return (
    <>
      <button ref={anchorRef} type="button">
        Effort
      </button>
      <Menu anchorRef={anchorRef} label="Effort" onClose={() => setOpen(false)} open={open}>
        <MenuLabel>Effort</MenuLabel>
        <MenuRadioItem checked={false} onSelect={() => onPick("low")}>
          Low
        </MenuRadioItem>
        <MenuRadioItem checked description="Reasons longer." onSelect={() => onPick("high")}>
          High
        </MenuRadioItem>
        <MenuRadioItem checked={false} disabled onSelect={() => onPick("max")}>
          Max
        </MenuRadioItem>
        <MenuSeparator />
        <MenuSwitchItem checked={false} onToggle={onToggle}>
          Fast mode
        </MenuSwitchItem>
      </Menu>
    </>
  );
}

function menu(): Element | null {
  return document.querySelector('[role="menu"]');
}

function radios(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
}

describe("menu choice items", () => {
  const ui = mountUi();
  afterEach(() => ui.render(null));

  it("renders radio rows with a check and a description, and closes after a pick", () => {
    const onPick = vi.fn();
    ui.render(<Harness onPick={onPick} onToggle={vi.fn()} />);
    expect(radios().map((node) => node.getAttribute("aria-checked"))).toEqual([
      "false",
      "true",
      "false",
    ]);
    expect(radios()[1]?.textContent).toContain("Reasons longer.");
    expect(radios()[1]?.querySelector(".cv-menu__check")).not.toBeNull();
    expect(radios()[1]?.className).toContain("cv-menu__item--tall");
    click(radios()[0] as Element);
    expect(onPick).toHaveBeenCalledWith("low");
    expect(menu()).toBeNull();
  });

  it("ignores a disabled radio row and skips it while roving", () => {
    const onPick = vi.fn();
    ui.render(<Harness onPick={onPick} onToggle={vi.fn()} />);
    const max = radios()[2] as HTMLElement;
    expect(max.getAttribute("aria-disabled")).toBe("true");
    click(max);
    expect(onPick).not.toHaveBeenCalled();
    expect(menu()).not.toBeNull();
    press(menu() as Element, "Home");
    press(menu() as Element, "ArrowDown");
    press(menu() as Element, "ArrowDown");
    expect(document.activeElement?.getAttribute("role")).toBe("menuitemcheckbox");
  });

  it("toggles a switch row without closing the menu and supports keyboard focus", () => {
    const onToggle = vi.fn();
    ui.render(<Harness onPick={vi.fn()} onToggle={onToggle} />);
    const toggle = document.querySelector('[role="menuitemcheckbox"]') as HTMLElement;
    click(toggle);
    expect(onToggle).toHaveBeenCalledWith(true);
    expect(menu()).not.toBeNull();
    press(menu() as Element, "End");
    expect(document.activeElement).toBe(toggle);
    expect(toggle.querySelector(".cv-switch")?.getAttribute("aria-checked")).toBe("false");
  });

  it("selects a radio row with Enter and Space and toggles a switch with Space", () => {
    const onPick = vi.fn();
    const onToggle = vi.fn();
    ui.render(<Harness onPick={onPick} onToggle={onToggle} />);
    press(menu() as Element, "End");
    press(document.activeElement as Element, " ");
    expect(onToggle).toHaveBeenCalledWith(true);
    expect(menu()).not.toBeNull();
    press(menu() as Element, "Home");
    press(document.activeElement as Element, "Enter");
    expect(onPick).toHaveBeenLastCalledWith("low");
    expect(menu()).toBeNull();
    ui.render(null);
    ui.render(<Harness onPick={onPick} onToggle={onToggle} />);
    press(menu() as Element, "Home");
    press(menu() as Element, "ArrowDown");
    press(document.activeElement as Element, " ");
    expect(onPick).toHaveBeenLastCalledWith("high");
    expect(menu()).toBeNull();
  });

  it("closes on Escape and returns focus to the trigger", () => {
    ui.render(<Harness onPick={vi.fn()} onToggle={vi.fn()} />);
    const trigger = ui.host.querySelector("button") as HTMLElement;
    press(document.activeElement as Element, "Escape");
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
