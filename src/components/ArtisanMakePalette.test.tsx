// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import { ArtisanMakePalette } from "./ArtisanMakePalette";

describe("ArtisanMakePalette", () => {
  let host: HTMLDivElement;
  let root: Root;
  let onClose: Mock<() => void>;
  let runInActiveTerminal: Mock<(command: string) => void>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    onClose = vi.fn();
    runInActiveTerminal = vi.fn();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(isOpen = true) {
    act(() => {
      root.render(
        <ArtisanMakePalette
          isOpen={isOpen}
          onClose={onClose}
          runInActiveTerminal={runInActiveTerminal}
        />,
      );
    });
  }

  function setInput(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;

    act(() => {
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function click(button: HTMLButtonElement) {
    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  it("filters generator types and enters the name step", () => {
    render();
    const input = host.querySelector<HTMLInputElement>("input")!;

    expect(input.placeholder).toBe("Filter generators");
    setInput(input, "cont");

    const buttons = host.querySelectorAll<HTMLButtonElement>(
      ".palette-command",
    );
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.textContent).toContain("Controller");

    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
      );
    });

    expect(host.querySelector<HTMLInputElement>("input")?.placeholder).toBe(
      "Name",
    );
  });

  it("validates the name live and gates submission", () => {
    render();
    click(
      Array.from(
        host.querySelectorAll<HTMLButtonElement>(".palette-command"),
      ).find((button) => button.textContent?.includes("Model"))!,
    );
    const input = host.querySelector<HTMLInputElement>("input")!;
    const submit = host.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    )!;

    expect(submit.disabled).toBe(true);
    expect(host.textContent).toContain("Enter a generator name");

    setInput(input, "User;whoami");
    expect(submit.disabled).toBe(true);
    expect(host.textContent).toContain("letters, numbers, underscores");

    setInput(input, "Admin/User");
    expect(submit.disabled).toBe(false);
    expect(host.textContent).not.toContain("letters, numbers, underscores");
  });

  it("stages the exact command and closes on submit", () => {
    render();
    click(
      Array.from(
        host.querySelectorAll<HTMLButtonElement>(".palette-command"),
      ).find((button) => button.textContent?.includes("Controller"))!,
    );
    setInput(
      host.querySelector<HTMLInputElement>("input")!,
      "Admin/UserController",
    );

    click(host.querySelector<HTMLButtonElement>('button[type="submit"]')!);

    expect(runInActiveTerminal).toHaveBeenCalledExactlyOnceWith(
      "php artisan make:controller 'Admin/UserController' --no-interaction",
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes with Escape from either step and resets on every open", () => {
    render();
    const section = host.querySelector<HTMLElement>("section")!;

    act(() => {
      section.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
      );
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    click(host.querySelector<HTMLButtonElement>(".palette-command")!);
    setInput(host.querySelector<HTMLInputElement>("input")!, "User");
    act(() => {
      section.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
      );
    });
    expect(onClose).toHaveBeenCalledTimes(2);

    render(false);
    render(true);
    expect(host.querySelector<HTMLInputElement>("input")?.placeholder).toBe(
      "Filter generators",
    );
    expect(host.querySelector<HTMLInputElement>("input")?.value).toBe("");
  });
});
