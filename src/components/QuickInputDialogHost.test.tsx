// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuickInputCoordinator } from "../application/quickInputCoordinator";
import { QuickInputDialogHost } from "./QuickInputDialogHost";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("QuickInputDialogHost", () => {
  let container: HTMLDivElement;
  let root: Root;
  let coordinator: QuickInputCoordinator;

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
    coordinator = new QuickInputCoordinator();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("focuses and selects the default value, validates blank input, and submits with Enter", async () => {
    await render("/workspace");
    const pending = coordinator.prompt("New file path", "server.js");
    await settle();

    const dialog = requireDialog();
    const input = requireInput();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(input.value).toBe("server.js");
    expect(document.activeElement).toBe(input);

    changeInput("   ");
    key(input, "Enter");
    await settle();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Enter a value.");
    expect(coordinator.getSnapshot()).not.toBeNull();

    changeInput("tasks.json");
    key(input, "Enter");
    await expect(pending).resolves.toBe("tasks.json");
    await settle();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("cancels with Escape and restores focus to the invoking element", async () => {
    const invoker = document.createElement("button");
    document.body.append(invoker);
    invoker.focus();
    await render("/workspace");

    const pending = coordinator.prompt("Name");
    await settle();
    key(requireInput(), "Escape");

    await expect(pending).resolves.toBeNull();
    await settle();
    expect(document.activeElement).toBe(invoker);
    invoker.remove();
  });

  it("cancels active input when the workspace scope changes", async () => {
    await render("/workspace-a");
    const pending = coordinator.prompt("New file path");
    await settle();

    await render("/workspace-b");

    await expect(pending).resolves.toBeNull();
    expect(coordinator.getSnapshot()).toBeNull();
  });

  it("traps focus in the open modal", async () => {
    await render("/workspace");
    const pending = coordinator.prompt("Name");
    await settle();
    const dialog = requireDialog();
    const buttons = dialog.querySelectorAll<HTMLButtonElement>("button");
    buttons[buttons.length - 1].focus();

    key(buttons[buttons.length - 1], "Tab");
    expect(document.activeElement).toBe(requireInput());

    coordinator.cancelAll();
    await pending;
  });

  it("does not submit the value when Enter is pressed on Cancel", async () => {
    await render("/workspace");
    const pending = coordinator.prompt("Name", "keep-me");
    await settle();
    const cancelButton = Array.from(
      requireDialog().querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "Cancel")!;

    key(cancelButton, "Enter");
    expect(coordinator.getSnapshot()).not.toBeNull();
    act(() => cancelButton.click());

    await expect(pending).resolves.toBeNull();
  });

  it("does not submit composing IME input until composition ends", async () => {
    await render("/workspace");
    const pending = coordinator.prompt("New file path");
    await settle();
    const input = requireInput();
    changeInput("作業");

    key(input, "Enter", { isComposing: true });
    expect(coordinator.getSnapshot()).not.toBeNull();

    key(input, "Enter");
    await expect(pending).resolves.toBe("作業");
  });

  async function render(workspaceScope: string | null) {
    await act(async () => {
      root.render(
        <QuickInputDialogHost coordinator={coordinator} workspaceScope={workspaceScope} />,
      );
    });
  }

  function requireDialog(): HTMLDialogElement {
    const dialog = container.querySelector<HTMLDialogElement>('[role="dialog"]');
    if (!dialog) throw new Error("dialog not found");
    return dialog;
  }

  function requireInput(): HTMLInputElement {
    const input = container.querySelector<HTMLInputElement>("input");
    if (!input) throw new Error("input not found");
    return input;
  }

  function changeInput(value: string) {
    const input = requireInput();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function key(
    element: HTMLElement,
    keyValue: string,
    options: { readonly isComposing?: boolean } = {},
  ) {
    act(() => {
      element.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          isComposing: options.isComposing,
          key: keyValue,
        }),
      );
    });
  }

  async function settle() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }
});
