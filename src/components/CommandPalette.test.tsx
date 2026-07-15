// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Command, CommandContext } from "../application/commandRegistry";
import { CommandPalette } from "./CommandPalette";

const context: CommandContext = {
  hasWorkspace: true,
  hasActiveDocument: true,
  activeDocumentDirty: false,
};

function command(
  id: string,
  title: string,
  overrides: Partial<Command> = {},
): Command {
  return {
    id,
    title,
    category: "Editor",
    isEnabled: () => true,
    run: vi.fn(),
    ...overrides,
  };
}

describe("CommandPalette", () => {
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
    props: Partial<Parameters<typeof CommandPalette>[0]> = {},
  ) {
    const onClose = vi.fn();
    const onCommandError = vi.fn();

    act(() => {
      root.render(
        <CommandPalette
          commands={[
            command("editor.save", "Save File", { shortcut: "Cmd+S" }),
            command("editor.format", "Format Document"),
          ]}
          context={context}
          isOpen
          onClose={onClose}
          onCommandError={onCommandError}
          {...props}
        />,
      );
    });

    return { onClose, onCommandError };
  }

  it("renders one row per command", () => {
    render();
    const rows = host.querySelectorAll(".palette-command");
    expect(rows).toHaveLength(2);
  });

  it("renders a footer hint row", () => {
    render();
    expect(host.querySelector(".palette-footer")).not.toBeNull();
  });

  it("runs a command on click", async () => {
    const run = vi.fn();
    const { onClose } = render({
      commands: [command("editor.save", "Save File", { run })],
    });
    const rows = host.querySelectorAll<HTMLButtonElement>(".palette-command");

    await act(async () => {
      rows[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("remains open while a command is pending and invokes it exactly once", async () => {
    let resolveRun: (() => void) | undefined;
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRun = resolve;
        }),
    );
    const { onClose } = render({
      commands: [command("editor.save", "Save File", { run })],
    });
    const row = host.querySelector<HTMLButtonElement>(".palette-command");

    act(() => {
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      resolveRun?.();
      await Promise.resolve();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("allows a new command after close and reopen without stale success closing it", async () => {
    let resolveOld: (() => void) | undefined;
    let resolveNew: (() => void) | undefined;
    const oldRun = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveOld = resolve;
        }),
    );
    const newRun = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveNew = resolve;
        }),
    );
    const onClose = vi.fn();
    const onCommandError = vi.fn();
    const sharedProps = { onClose, onCommandError };

    render({
      ...sharedProps,
      commands: [command("editor.old", "Old Command", { run: oldRun })],
    });
    act(() => {
      host
        .querySelector<HTMLButtonElement>(".palette-command")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    render({ ...sharedProps, isOpen: false });
    render({
      ...sharedProps,
      commands: [command("editor.new", "New Command", { run: newRun })],
    });
    act(() => {
      host
        .querySelector<HTMLButtonElement>(".palette-command")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(oldRun).toHaveBeenCalledTimes(1);
    expect(newRun).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveOld?.();
      await Promise.resolve();
    });

    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      resolveNew?.();
      await Promise.resolve();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCommandError).not.toHaveBeenCalled();
  });

  it("ignores stale rejection without clearing the reopened surface guard", async () => {
    let rejectOld: ((error: unknown) => void) | undefined;
    let resolveNew: (() => void) | undefined;
    const oldRun = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectOld = reject;
        }),
    );
    const newRun = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveNew = resolve;
        }),
    );
    const onClose = vi.fn();
    const onCommandError = vi.fn();
    const sharedProps = { onClose, onCommandError };

    render({
      ...sharedProps,
      commands: [command("editor.old", "Old Command", { run: oldRun })],
    });
    act(() => {
      host
        .querySelector<HTMLButtonElement>(".palette-command")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    render({ ...sharedProps, isOpen: false });
    render({
      ...sharedProps,
      commands: [command("editor.new", "New Command", { run: newRun })],
    });
    const newRow = host.querySelector<HTMLButtonElement>(".palette-command");
    act(() => {
      newRow?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await act(async () => {
      rejectOld?.(new Error("Old command failed"));
      await Promise.resolve();
    });
    act(() => {
      newRow?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(newRun).toHaveBeenCalledTimes(1);
    expect(onCommandError).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      resolveNew?.();
      await Promise.resolve();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not run or close for a disabled command", async () => {
    const run = vi.fn();
    const { onClose } = render({
      commands: [
        command("editor.save", "Save File", {
          isEnabled: () => false,
          run,
        }),
      ],
    });
    const row = host.querySelector<HTMLButtonElement>(".palette-command");

    await act(async () => {
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(run).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("reports a rejected command and remains open", async () => {
    const error = new Error("Save failed");
    const run = vi.fn().mockRejectedValue(error);
    const { onClose, onCommandError } = render({
      commands: [command("editor.save", "Save File", { run })],
    });
    const row = host.querySelector<HTMLButtonElement>(".palette-command");

    await act(async () => {
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(onCommandError).toHaveBeenCalledWith(error);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("filters commands by query", () => {
    const { onClose } = render();
    const field = host.querySelector<HTMLInputElement>(".palette-search input");

    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;

    if (field && setter) {
      act(() => {
        setter.call(field, "format");
        field.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }

    const rows = host.querySelectorAll(".palette-command");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain("Format Document");
    expect(onClose).not.toHaveBeenCalled();
  });

  function setQuery(value: string) {
    const field = input();
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;

    if (field && setter) {
      act(() => {
        setter.call(field, value);
        field.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
  }

  function input() {
    return host.querySelector<HTMLInputElement>(".palette-search input");
  }

  it("marks the first command active by default", () => {
    render();
    const rows = host.querySelectorAll(".palette-command");
    expect(rows[0]?.className).toContain("active");
    expect(rows[1]?.className).not.toContain("active");
  });

  it("moves the active row with ArrowDown and back with ArrowUp", () => {
    render();
    const field = input();

    act(() => {
      field?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
      );
    });
    let rows = host.querySelectorAll(".palette-command");
    expect(rows[1]?.className).toContain("active");

    act(() => {
      field?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" }),
      );
    });
    rows = host.querySelectorAll(".palette-command");
    expect(rows[0]?.className).toContain("active");
  });

  it("wraps the command palette active row at both ends", () => {
    render();
    const field = input();

    // ArrowUp from the first row wraps to the last.
    act(() => {
      field?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" }),
      );
    });
    let rows = host.querySelectorAll(".palette-command");
    expect(rows[1]?.className).toContain("active");

    // ArrowDown from the last row wraps back to the first.
    act(() => {
      field?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
      );
    });
    rows = host.querySelectorAll(".palette-command");
    expect(rows[0]?.className).toContain("active");
  });

  it("runs the highlighted command palette command on Enter", async () => {
    const save = vi.fn();
    const format = vi.fn();
    const { onClose } = render({
      commands: [
        command("editor.save", "Save File", { run: save }),
        command("editor.format", "Format Document", { run: format }),
      ],
    });
    const field = input();

    act(() => {
      field?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
      );
    });
    await act(async () => {
      field?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
      );
    });

    expect(format).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes the command palette on Escape", () => {
    const { onClose } = render();
    const field = input();

    act(() => {
      field?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
      );
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows No matching commands when no command matches", () => {
    render();
    setQuery("nonexistent command xyz");

    expect(host.querySelectorAll(".palette-command")).toHaveLength(0);
    expect(host.textContent).toContain("No matching commands");
  });

  it("resets the active row when the query changes", () => {
    render();
    const field = input();

    act(() => {
      field?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
      );
    });
    expect(host.querySelectorAll(".palette-command")[1]?.className).toContain(
      "active",
    );

    setQuery("s");
    const rows = host.querySelectorAll(".palette-command");
    expect(rows[0]?.className).toContain("active");
  });
});

/**
 * The palette search row (`.palette-search input`, shared by every command
 * palette: Cmd+Shift+P, Cmd+P, Cmd+R, ...) autofocuses on open. Autofocused
 * text inputs always earn a real `:focus-visible` match in Chromium, so the
 * generic `:focus-visible { box-shadow: var(--focus-ring); }` rule (App.css)
 * paints a sharp-cornered ring around the input the instant the palette
 * opens. The palette shell clips its content with `overflow: hidden` and a
 * large `border-radius`, so that sharp ring reads as a stray corner artifact
 * jammed against the shell's rounded top edge. Suppress it here since the
 * open palette itself is already the focus affordance.
 */
describe("Command palette search focus ring", () => {
  const appCss = readFileSync("src/App.css", "utf8");

  it("does not paint the generic focus-visible ring on the search input", () => {
    const selector = ".palette-search input:focus-visible";
    const index = appCss.indexOf(selector);
    expect(index, "missing .palette-search input:focus-visible override").toBeGreaterThan(-1);

    const body = appCss.slice(appCss.indexOf("{", index), appCss.indexOf("}", index));
    expect(body).toContain("box-shadow: none");
  });
});
