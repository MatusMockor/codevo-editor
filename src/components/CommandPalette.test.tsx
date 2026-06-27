// @vitest-environment jsdom

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
});
