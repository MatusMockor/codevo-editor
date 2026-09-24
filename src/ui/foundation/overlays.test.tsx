// @vitest-environment jsdom

import { act, useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "./Dialog";
import { click, mountUi, pointer, press, type MountedUi } from "./foundationTestSupport";
import { Menu } from "./Menu";
import { MenuItem, MenuLabel, MenuSeparator } from "./MenuItem";
import { Popover } from "./Popover";
import { Submenu } from "./Submenu";

let ui: MountedUi | null = null;

afterEach(() => {
  ui?.unmount();
  ui = null;
  document.body.replaceChildren();
});

interface MenuHarnessProps {
  onPin(): void;
  onDelete(): void;
  onMove(target: string): void;
}

function MenuHarness({ onDelete, onMove, onPin }: MenuHarnessProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button onClick={() => setOpen(true)} ref={triggerRef} type="button">
        Actions
      </button>
      <Menu
        anchorRef={triggerRef}
        label="Thread actions"
        onClose={() => setOpen(false)}
        open={open}
      >
        <MenuLabel>Thread</MenuLabel>
        <MenuItem onSelect={onPin} shortcut="⌘P">
          Pin
        </MenuItem>
        <MenuItem disabled onSelect={() => undefined}>
          Rename
        </MenuItem>
        <MenuSeparator />
        <Submenu label="Move to">
          <MenuItem onSelect={() => onMove("alpha")}>Alpha</MenuItem>
          <MenuItem checked onSelect={() => onMove("beta")}>
            Beta
          </MenuItem>
        </Submenu>
        <MenuItem onSelect={onDelete} tone="danger">
          Delete
        </MenuItem>
      </Menu>
    </>
  );
}

function openMenu(): { trigger: HTMLButtonElement; spies: MenuHarnessProps } {
  const spies = { onDelete: vi.fn(), onMove: vi.fn(), onPin: vi.fn() };
  ui = mountUi();
  ui.render(<MenuHarness {...spies} />);
  const trigger = ui.host.querySelector("button") as HTMLButtonElement;
  trigger.focus();
  click(trigger);
  return { trigger, spies };
}

function active(): string {
  return document.activeElement?.textContent ?? "";
}

function menus(): HTMLElement[] {
  return [...document.body.querySelectorAll<HTMLElement>('[role="menu"]')];
}

describe("Menu", () => {
  it("opens as a labelled menu and focuses the first enabled item", () => {
    openMenu();

    expect(menus()).toHaveLength(1);
    expect(menus()[0]?.getAttribute("aria-label")).toBe("Thread actions");
    expect(active()).toBe("Pin⌘P");
  });

  it("moves with the arrow keys, skips disabled items and wraps", () => {
    openMenu();

    press(document.activeElement as Element, "ArrowDown");
    expect(active()).toBe("Move to");
    press(document.activeElement as Element, "ArrowDown");
    expect(active()).toBe("Delete");
    press(document.activeElement as Element, "ArrowDown");
    expect(active()).toBe("Pin⌘P");
    press(document.activeElement as Element, "ArrowUp");
    expect(active()).toBe("Delete");
    press(document.activeElement as Element, "Home");
    expect(active()).toBe("Pin⌘P");
    press(document.activeElement as Element, "End");
    expect(active()).toBe("Delete");
  });

  it("selects an item, closes and returns focus to the trigger", () => {
    const { spies, trigger } = openMenu();

    click(document.activeElement as Element);

    expect(spies.onPin).toHaveBeenCalledTimes(1);
    expect(menus()).toHaveLength(0);
    expect(document.activeElement).toBe(trigger);
  });

  it("does not select disabled items and marks danger items", () => {
    const { spies } = openMenu();
    const rename = [...document.body.querySelectorAll('[role="menuitem"]')].find(
      (item) => item.textContent === "Rename",
    );
    const remove = [...document.body.querySelectorAll('[role="menuitem"]')].find(
      (item) => item.textContent === "Delete",
    );

    expect(rename?.getAttribute("aria-disabled")).toBe("true");
    click(rename as Element);
    expect(menus()).toHaveLength(1);
    expect(spies.onPin).not.toHaveBeenCalled();
    expect(remove?.className).toContain("cv-menu__item--danger");
  });

  it("closes on Escape, Tab and an outside pointer", () => {
    const { trigger } = openMenu();
    press(document.activeElement as Element, "Escape");
    expect(menus()).toHaveLength(0);
    expect(document.activeElement).toBe(trigger);

    click(trigger);
    press(document.activeElement as Element, "Tab");
    expect(menus()).toHaveLength(0);

    click(trigger);
    pointer(document.body, "pointerdown");
    expect(menus()).toHaveLength(0);
  });

  it("opens a submenu with ArrowRight and closes only the submenu with ArrowLeft or Escape", () => {
    openMenu();
    press(document.activeElement as Element, "ArrowDown");
    const trigger = document.activeElement as HTMLElement;

    press(trigger, "ArrowRight");
    expect(menus()).toHaveLength(2);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(active()).toBe("Alpha");

    press(document.activeElement as Element, "ArrowLeft");
    expect(menus()).toHaveLength(1);
    expect(document.activeElement).toBe(trigger);

    press(trigger, "ArrowRight");
    press(document.activeElement as Element, "Escape");
    expect(menus()).toHaveLength(1);
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps focus inside the menu when a hover-opened submenu closes", () => {
    openMenu();
    const item = (text: string) =>
      [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
        (element) => element.textContent === text,
      ) as HTMLElement;
    const moveTo = item("Move to");

    pointer(moveTo, "pointerover");
    expect(menus()).toHaveLength(2);
    pointer(document.activeElement as Element, "pointerout", { relatedTarget: item("Delete") });
    expect(menus()).toHaveLength(1);
    expect(active()).toBe("Delete");
    press(document.activeElement as Element, "ArrowUp");
    expect(active()).toBe("Move to");

    pointer(moveTo, "pointerover");
    pointer(document.activeElement as Element, "pointerout", { relatedTarget: item("Rename") });
    expect(menus()).toHaveLength(1);
    expect(document.activeElement).toBe(moveTo);
    press(document.activeElement as Element, "ArrowDown");
    expect(active()).toBe("Delete");
  });

  it("returns focus to its anchor when nothing was focused at open", () => {
    const { trigger } = openMenu();
    press(document.activeElement as Element, "Escape");
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).toBe(document.body);

    click(trigger);
    press(document.activeElement as Element, "Escape");

    expect(menus()).toHaveLength(0);
    expect(document.activeElement).toBe(trigger);
  });

  it("selects inside a submenu and closes every menu", () => {
    const { spies, trigger } = openMenu();
    const move = [...document.body.querySelectorAll('[role="menuitem"]')].find(
      (item) => item.textContent === "Move to",
    );
    click(move as Element);
    const beta = document.body.querySelector('[role="menuitemcheckbox"]');

    expect(beta?.getAttribute("aria-checked")).toBe("true");
    click(beta as Element);

    expect(spies.onMove).toHaveBeenCalledWith("beta");
    expect(menus()).toHaveLength(0);
    expect(document.activeElement).toBe(trigger);
  });
});

function PopoverHarness() {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button onClick={() => setOpen((current) => !current)} ref={anchorRef} type="button">
        Branch
      </button>
      <Popover anchorRef={anchorRef} label="Branches" onClose={() => setOpen(false)} open={open}>
        <input aria-label="Filter branches" />
      </Popover>
    </>
  );
}

describe("Popover", () => {
  it("portals a labelled dialog, keeps it open for inside and anchor pointers, restores focus", () => {
    ui = mountUi();
    ui.render(<PopoverHarness />);
    const anchor = ui.host.querySelector("button") as HTMLButtonElement;
    anchor.focus();
    click(anchor);
    const popover = document.body.querySelector('[role="dialog"]');

    expect(popover?.getAttribute("aria-label")).toBe("Branches");
    expect(ui.host.contains(popover)).toBe(false);
    pointer(popover?.querySelector("input") as Element, "pointerdown");
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();

    press(popover?.querySelector("input") as Element, "Escape");
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(anchor);
  });
});

function DialogWithOverlays() {
  const [dialogOpen, setDialogOpen] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverTriggerRef = useRef<HTMLButtonElement | null>(null);
  return (
    <Dialog onClose={() => setDialogOpen(false)} open={dialogOpen} title="Settings">
      <button onClick={() => setMenuOpen(true)} ref={menuTriggerRef} type="button">
        More
      </button>
      <button onClick={() => setPopoverOpen(true)} ref={popoverTriggerRef} type="button">
        Branch
      </button>
      <Menu
        anchorRef={menuTriggerRef}
        label="More actions"
        onClose={() => setMenuOpen(false)}
        open={menuOpen}
      >
        <MenuItem onSelect={() => undefined}>Copy</MenuItem>
      </Menu>
      <Popover
        anchorRef={popoverTriggerRef}
        label="Branches"
        onClose={() => setPopoverOpen(false)}
        open={popoverOpen}
      >
        <input aria-label="Filter branches" />
      </Popover>
    </Dialog>
  );
}

describe("overlays inside a Dialog", () => {
  function mountDialog() {
    ui = mountUi();
    ui.render(<DialogWithOverlays />);
    const button = (text: string) =>
      [...document.body.querySelectorAll("button")].find(
        (element) => element.textContent === text,
      ) as HTMLButtonElement;
    const dialogs = () => document.body.querySelectorAll('[aria-modal="true"]');
    return { button, dialogs };
  }

  it("closes only the menu on Escape, then the dialog on the next Escape", () => {
    const { button, dialogs } = mountDialog();
    const trigger = button("More");
    trigger.focus();
    click(trigger);
    expect(menus()).toHaveLength(1);

    press(document.activeElement as Element, "Escape");
    expect(menus()).toHaveLength(0);
    expect(dialogs()).toHaveLength(1);
    expect(document.activeElement).toBe(trigger);

    press(document.activeElement as Element, "Escape");
    expect(dialogs()).toHaveLength(0);
  });

  it("closes only the popover on Escape", () => {
    const { button, dialogs } = mountDialog();
    const trigger = button("Branch");
    trigger.focus();
    click(trigger);
    const filter = document.body.querySelector('[aria-label="Filter branches"]') as HTMLElement;
    filter.focus();

    press(filter, "Escape");
    expect(document.body.querySelector('[aria-label="Branches"]')).toBeNull();
    expect(dialogs()).toHaveLength(1);
    expect(document.activeElement).toBe(trigger);
  });
});

interface DialogHarnessProps {
  readonly dismissOnBackdrop?: boolean;
  readonly withInitialFocus?: boolean;
  onClose(): void;
}

function DialogHarness({
  dismissOnBackdrop,
  onClose,
  withInitialFocus = false,
}: DialogHarnessProps) {
  const [open, setOpen] = useState(false);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const close = (): void => {
    onClose();
    setOpen(false);
  };
  return (
    <>
      <button onClick={() => setOpen(true)} type="button">
        Trust
      </button>
      <Dialog
        description="Codevo will run project tools."
        dismissOnBackdrop={dismissOnBackdrop}
        footer={
          <>
            <button onClick={close} type="button">
              Cancel
            </button>
            <button onClick={close} ref={confirmRef} type="button">
              Trust folder
            </button>
          </>
        }
        initialFocusRef={withInitialFocus ? confirmRef : undefined}
        onClose={close}
        open={open}
        title="Trust this folder?"
      >
        <input aria-label="Reason" />
      </Dialog>
    </>
  );
}

function openDialog(props: Omit<DialogHarnessProps, "onClose"> = {}) {
  const onClose = vi.fn();
  ui = mountUi();
  ui.render(<DialogHarness {...props} onClose={onClose} />);
  const trigger = ui.host.querySelector("button") as HTMLButtonElement;
  trigger.focus();
  click(trigger);
  return { onClose, trigger, dialog: () => document.body.querySelector('[role="dialog"]') };
}

describe("Dialog", () => {
  it("is a labelled, described modal that focuses its first control", () => {
    const { dialog } = openDialog();
    const surface = dialog();
    const title = document.getElementById(surface?.getAttribute("aria-labelledby") ?? "");
    const description = document.getElementById(surface?.getAttribute("aria-describedby") ?? "");

    expect(surface?.getAttribute("aria-modal")).toBe("true");
    expect(title?.textContent).toBe("Trust this folder?");
    expect(description?.textContent).toBe("Codevo will run project tools.");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Reason");
  });

  it("honours an explicit initial focus target", () => {
    openDialog({ withInitialFocus: true });

    expect(document.activeElement?.textContent).toBe("Trust folder");
  });

  it("traps Tab and Shift+Tab inside the dialog", () => {
    openDialog();

    press(document.activeElement as Element, "Tab", { shiftKey: true });
    expect(document.activeElement?.textContent).toBe("Trust folder");
    press(document.activeElement as Element, "Tab");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Reason");
  });

  it("closes on Escape and returns focus to the trigger", () => {
    const { dialog, onClose, trigger } = openDialog();

    press(document.activeElement as Element, "Escape");

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on a backdrop pointer but not on a pointer inside the dialog", () => {
    const { dialog, onClose } = openDialog();

    pointer(dialog()?.querySelector("input") as Element, "pointerdown");
    expect(onClose).not.toHaveBeenCalled();
    pointer(document.body.querySelector(".cv-overlay") as Element, "pointerdown");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("can require an explicit choice instead of backdrop dismissal", () => {
    const { dialog, onClose } = openDialog({ dismissOnBackdrop: false });

    pointer(document.body.querySelector(".cv-overlay") as Element, "pointerdown");

    expect(onClose).not.toHaveBeenCalled();
    expect(dialog()).not.toBeNull();
  });

  it("keeps focus inside when a non-dismissing backdrop is pressed", async () => {
    const { dialog, onClose } = openDialog({ dismissOnBackdrop: false });
    const backdrop = document.body.querySelector(".cv-overlay") as Element;
    const mouseDown = new MouseEvent("mousedown", { bubbles: true, cancelable: true });

    act(() => {
      backdrop.dispatchEvent(mouseDown);
    });
    expect(mouseDown.defaultPrevented).toBe(true);
    await act(async () => {
      (document.activeElement as HTMLElement).blur();
    });

    expect(dialog()?.contains(document.activeElement)).toBe(true);
    press(document.activeElement as Element, "Tab", { shiftKey: true });
    expect(document.activeElement?.textContent).toBe("Trust folder");
    press(document.activeElement as Element, "Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
