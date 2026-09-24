// @vitest-environment jsdom

import { act, useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CommandEmpty,
  CommandFooter,
  CommandFooterHint,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandSurface,
} from "./CommandList";
import { commandItemId } from "./commandItemId";
import { click, mountUi, pointer, press, type MountedUi } from "./foundationTestSupport";
import { useCommandListNavigation } from "./useCommandListNavigation";

let ui: MountedUi | null = null;

afterEach(() => {
  ui?.unmount();
  ui = null;
  document.body.replaceChildren();
});

interface HarnessProps {
  readonly rows: readonly string[];
  onExecute(row: string): void;
  onClose(): void;
}

function Harness({ onClose, onExecute, rows }: HarnessProps) {
  const [query, setQuery] = useState("");
  const visible = rows.filter((row) => row.includes(query));
  const nav = useCommandListNavigation({
    keys: visible,
    resetKey: query,
    homeEndEnabled: query === "",
    onExecute: (index) => {
      const row = visible[index];
      if (row === undefined) return;
      onExecute(row);
    },
  });
  return (
    <CommandSurface label="Command palette" onClose={onClose}>
      <CommandInput
        activeDescendantId={nav.activeIndex < 0 ? null : commandItemId("h", nav.activeIndex)}
        expanded={visible.length > 0}
        label="Search"
        listboxId="h"
        onChange={setQuery}
        onKeyDown={(event) => {
          nav.handleKeyDown(event);
        }}
        placeholder="Search…"
        value={query}
      />
      <CommandPanel>
        {visible.length === 0 ? (
          <CommandEmpty>No matches.</CommandEmpty>
        ) : (
          <CommandList id="h" label="Results">
            <CommandGroup label="Actions">
              {visible.map((row, index) => (
                <CommandItem
                  active={index === nav.activeIndex}
                  id={commandItemId("h", index)}
                  key={row}
                  onHover={() => nav.setActiveIndex(index)}
                  onSelect={() => onExecute(row)}
                  shortcut="⌘N"
                  submenu={row === "Switch project"}
                  title={row}
                />
              ))}
            </CommandGroup>
          </CommandList>
        )}
      </CommandPanel>
      <CommandFooter>
        <CommandFooterHint keys={["↑", "↓"]} label="Navigate" />
        <CommandFooterHint keys={["Esc"]} label="Close" />
      </CommandFooter>
    </CommandSurface>
  );
}

const ROWS = ["New thread", "Switch project", "Open settings"] as const;

function input(): HTMLInputElement {
  const element = document.querySelector<HTMLInputElement>(".cv-command-field input");
  expect(element).not.toBeNull();
  return element as HTMLInputElement;
}

function selected(): string | null {
  return document.querySelector('[role="option"][aria-selected="true"]')?.textContent ?? null;
}

describe("command list primitives", () => {
  it("renders a modal dialog with a combobox wired to the listbox", () => {
    ui = mountUi();
    ui.render(<Harness onClose={vi.fn()} onExecute={vi.fn()} rows={ROWS} />);

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(dialog?.getAttribute("aria-label")).toBe("Command palette");
    expect(input().getAttribute("role")).toBe("combobox");
    expect(input().getAttribute("aria-controls")).toBe("h");
    expect(input().getAttribute("aria-activedescendant")).toBe(commandItemId("h", 0));
    expect(document.activeElement).toBe(input());
  });

  it("moves the active row with arrows and Ctrl+N/P and wraps at both ends", () => {
    ui = mountUi();
    ui.render(<Harness onClose={vi.fn()} onExecute={vi.fn()} rows={ROWS} />);

    press(input(), "ArrowUp");
    expect(selected()).toContain("Open settings");
    press(input(), "ArrowDown");
    expect(selected()).toContain("New thread");
    press(input(), "n", { ctrlKey: true });
    expect(selected()).toContain("Switch project");
    press(input(), "p", { ctrlKey: true });
    expect(selected()).toContain("New thread");
  });

  it("executes the active row on Enter and a clicked row without stealing input focus", () => {
    const onExecute = vi.fn();
    ui = mountUi();
    ui.render(<Harness onClose={vi.fn()} onExecute={onExecute} rows={ROWS} />);

    press(input(), "ArrowDown");
    press(input(), "Enter");
    const third = document.querySelectorAll('[role="option"]')[2];
    expect(third).toBeDefined();
    click(third as Element);

    expect(onExecute.mock.calls).toEqual([["Switch project"], ["Open settings"]]);
    expect(document.activeElement).toBe(input());
  });

  it("closes on Escape and on a backdrop pointer, not on a pointer inside the dialog", () => {
    const onClose = vi.fn();
    ui = mountUi();
    ui.render(<Harness onClose={onClose} onExecute={vi.fn()} rows={ROWS} />);

    pointer(document.querySelector('[role="dialog"]') as Element, "pointerdown");
    expect(onClose).not.toHaveBeenCalled();
    pointer(document.querySelector(".cv-command-viewport") as Element, "pointerdown");
    press(input(), "Escape");

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("renders the empty state, shortcut, submenu chevron and footer hints", () => {
    ui = mountUi();
    ui.render(<Harness onClose={vi.fn()} onExecute={vi.fn()} rows={ROWS} />);

    expect(document.querySelector(".cv-command-item__shortcut")?.textContent).toBe("⌘N");
    expect(document.querySelectorAll(".cv-command-item__chevron")).toHaveLength(1);
    expect(document.querySelector(".cv-command-footer")?.textContent).toContain("Navigate");

    ui.render(<Harness onClose={vi.fn()} onExecute={vi.fn()} rows={[]} />);
    expect(document.querySelector(".cv-command-empty")?.textContent).toBe("No matches.");
    expect(input().hasAttribute("aria-activedescendant")).toBe(false);
  });

  it("resets the active row when the reset key changes", () => {
    ui = mountUi();
    ui.render(<Harness onClose={vi.fn()} onExecute={vi.fn()} rows={ROWS} />);

    press(input(), "ArrowDown");
    press(input(), "ArrowDown");
    expect(selected()).toContain("Open settings");
    ui.render(<Harness onClose={vi.fn()} onExecute={vi.fn()} rows={[...ROWS, "Open file"]} />);
    expect(selected()).toContain("Open settings");
  });

  it("keeps the highlighted row on the same item when rows reorder", () => {
    ui = mountUi();
    ui.render(<Harness onClose={vi.fn()} onExecute={vi.fn()} rows={ROWS} />);

    press(input(), "ArrowDown");
    expect(selected()).toContain("Switch project");
    ui.render(
      <Harness
        onClose={vi.fn()}
        onExecute={vi.fn()}
        rows={["Open file", "Open settings", "New thread", "Switch project"]}
      />,
    );
    expect(selected()).toContain("Switch project");

    ui.render(
      <Harness onClose={vi.fn()} onExecute={vi.fn()} rows={["Open settings", "Open file"]} />,
    );
    expect(selected()).toContain("Open settings");
  });

  it("ignores navigation, Enter and Escape while an IME composition is active", () => {
    const onExecute = vi.fn();
    const onClose = vi.fn();
    ui = mountUi();
    ui.render(<Harness onClose={onClose} onExecute={onExecute} rows={ROWS} />);

    press(input(), "ArrowDown", { isComposing: true });
    press(input(), "Enter", { isComposing: true });
    press(input(), "Escape", { isComposing: true });

    expect(selected()).toContain("New thread");
    expect(onExecute).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("only references the listbox while it is rendered", () => {
    ui = mountUi();
    ui.render(<Harness onClose={vi.fn()} onExecute={vi.fn()} rows={ROWS} />);
    expect(input().getAttribute("aria-expanded")).toBe("true");

    ui.render(<Harness onClose={vi.fn()} onExecute={vi.fn()} rows={[]} />);
    expect(input().getAttribute("aria-expanded")).toBe("false");
    expect(input().hasAttribute("aria-controls")).toBe(false);
  });

  it("restores focus on close unless focus already moved outside the dialog", () => {
    const trigger = document.createElement("button");
    const editor = document.createElement("textarea");
    document.body.append(trigger, editor);
    trigger.focus();
    ui = mountUi();
    ui.render(<Harness onClose={vi.fn()} onExecute={vi.fn()} rows={ROWS} />);
    expect(document.activeElement).toBe(input());
    ui.render(null);
    expect(document.activeElement).toBe(trigger);

    ui.render(<Harness onClose={vi.fn()} onExecute={vi.fn()} rows={ROWS} />);
    act(() => editor.focus());
    ui.render(null);
    expect(document.activeElement).toBe(editor);
  });

  it("shows a back button lead that calls onBack", () => {
    const onBack = vi.fn();
    function BackHarness() {
      const ref = useRef<HTMLInputElement | null>(null);
      return (
        <CommandSurface label="Command palette" onClose={vi.fn()}>
          <CommandInput
            activeDescendantId={null}
            expanded={false}
            inputRef={ref}
            label="Search"
            lead="back"
            listboxId="b"
            onBack={onBack}
            onChange={vi.fn()}
            placeholder="Search…"
            trailing={<span className="probe-trailing">This computer</span>}
            value=""
          />
        </CommandSurface>
      );
    }
    ui = mountUi();
    ui.render(<BackHarness />);

    const back = document.querySelector<HTMLButtonElement>('button[aria-label="Back"]');
    expect(back).not.toBeNull();
    click(back as Element);
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".cv-command-field__trailing .probe-trailing")).not.toBeNull();
  });
});
