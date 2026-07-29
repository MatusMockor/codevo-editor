// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandContext } from "../application/commandRegistry";
import { QuickInputCoordinator } from "../application/quickInputCoordinator";
import { BrowserWorkbenchPrompter } from "../infrastructure/browserWorkbenchPrompter";
import { CommandPalette } from "./CommandPalette";
import { QuickInputDialogHost } from "./QuickInputDialogHost";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const CONTEXT: CommandContext = {
  activeDocumentDirty: false,
  hasActiveDocument: false,
  hasWorkspace: true,
};

describe("CommandPalette app-owned quick input integration", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("opens New File input from Enter and returns the chosen path to the command", async () => {
    const coordinator = new QuickInputCoordinator();
    const prompter = new BrowserWorkbenchPrompter(coordinator);
    const chosenPaths: string[] = [];

    function Harness() {
      const [isOpen, setIsOpen] = useState(true);
      return (
        <>
          <CommandPalette
            commands={[
              {
                category: "File",
                id: "file.new",
                isEnabled: () => true,
                run: async () => {
                  const path = await prompter.prompt("New file path");
                  if (path) chosenPaths.push(path);
                },
                title: "New File",
              },
            ]}
            context={CONTEXT}
            initialQuery=""
            isOpen={isOpen}
            onClose={() => setIsOpen(false)}
            onCommandError={vi.fn()}
          />
          <QuickInputDialogHost coordinator={coordinator} workspaceScope="/workspace" />
        </>
      );
    }

    await act(async () => root.render(<Harness />));
    const paletteInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="Run command"]',
    )!;
    act(() => {
      paletteInput.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
        }),
      );
    });
    await settle();

    const quickInput = container.querySelector<HTMLInputElement>(".quick-input-dialog input")!;
    expect(quickInput).not.toBeNull();
    setInput(quickInput, ".vscode/tasks.json");
    act(() => {
      quickInput.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
        }),
      );
    });
    await settle();

    expect(chosenPaths).toEqual([".vscode/tasks.json"]);
    expect(container.querySelector('[aria-label="Command palette"]')).toBeNull();
    expect(container.querySelector(".quick-input-dialog")).toBeNull();
  });

  async function settle() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  function setInput(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
});
