// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentComposerCompactMenu } from "./AgentComposerCompactMenu";
import { useCompactComposerControls } from "./useCompactComposerControls";

describe("AgentComposerCompactMenu", () => {
  let host: HTMLDivElement;
  let root: Root;
  let listeners: Array<() => void>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    listeners = [];
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    Reflect.deleteProperty(window, "matchMedia");
  });

  it("stays wide when the window has no media query support", () => {
    render(<Probe />);

    expect(host.textContent).toBe("wide");
  });

  it("follows the compact media query in both directions", () => {
    let matches = false;
    stubMatchMedia(() => matches);
    render(<Probe />);

    expect(host.textContent).toBe("wide");

    matches = true;
    act(() => listeners.forEach((listener) => listener()));

    expect(host.textContent).toBe("compact");

    matches = false;
    act(() => listeners.forEach((listener) => listener()));

    expect(host.textContent).toBe("wide");
  });

  it("opens the hosted controls from one labelled trigger", () => {
    render(
      <AgentComposerCompactMenu disabled={false} summary="opus · plan only">
        <button type="button">Model</button>
      </AgentComposerCompactMenu>,
    );

    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(trigger().title).toBe("opus · plan only");
    expect(host.querySelector(".agent-composer__compact-panel")).toBeNull();

    act(() => trigger().click());

    const panel = host.querySelector(".agent-composer__compact-panel");
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(panel?.getAttribute("role")).toBe("group");
    expect(panel?.querySelector("button")?.textContent).toBe("Model");
  });

  it("moves focus into the panel, traps Tab and clamps the panel horizontally", () => {
    render(
      <AgentComposerCompactMenu disabled={false} summary="opus">
        <button type="button">Model</button>
        <button type="button">Effort</button>
      </AgentComposerCompactMenu>,
    );

    act(() => trigger().click());

    const panel = host.querySelector<HTMLElement>(".agent-composer__compact-panel");
    expect(panel).not.toBeNull();
    expect(document.activeElement?.textContent).toBe("Model");
    expect(panel?.style.left).toBe("8px");

    const buttons = [...(panel?.querySelectorAll("button") ?? [])];
    const last = buttons[buttons.length - 1];
    act(() => last?.focus());
    act(() => {
      last?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Tab" }),
      );
    });

    expect(document.activeElement?.textContent).toBe("Model");
  });

  it("closes on Escape, on an outside pointer press and while dispatching", () => {
    render(
      <AgentComposerCompactMenu disabled={false} summary="opus">
        <button type="button">Model</button>
      </AgentComposerCompactMenu>,
    );

    act(() => trigger().click());
    act(() => {
      trigger().dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }),
      );
    });

    expect(host.querySelector(".agent-composer__compact-panel")).toBeNull();

    act(() => trigger().click());
    act(() => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    expect(host.querySelector(".agent-composer__compact-panel")).toBeNull();

    act(() => trigger().click());
    render(
      <AgentComposerCompactMenu disabled={true} summary="opus">
        <button type="button">Model</button>
      </AgentComposerCompactMenu>,
    );

    expect(trigger().disabled).toBe(true);
    expect(host.querySelector(".agent-composer__compact-panel")).toBeNull();
  });

  function Probe() {
    const compact = useCompactComposerControls();
    return <span>{compact ? "compact" : "wide"}</span>;
  }

  function render(node: ReactNode): void {
    act(() => root.render(node));
  }

  function trigger(): HTMLButtonElement {
    const element = host.querySelector<HTMLButtonElement>(".agent-composer__compact-trigger");
    expect(element).not.toBeNull();
    return element ?? document.createElement("button");
  }

  function stubMatchMedia(matches: () => boolean): void {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        media: query,
        get matches() {
          return matches();
        },
        addEventListener: (_type: string, listener: () => void) => listeners.push(listener),
        removeEventListener: () => undefined,
      }),
    });
  }
});
