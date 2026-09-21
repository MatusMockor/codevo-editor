// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { useTerminalPanelFocusReturn } from "./useTerminalPanelFocusReturn";

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

function setup() {
  const frame = document.body.appendChild(document.createElement("section"));
  frame.innerHTML =
    '<textarea id="agent-prompt"></textarea><div data-slot="bottom"><button>Hide</button></div><button data-other>Other</button>';
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const prompt = frame.querySelector<HTMLTextAreaElement>("textarea")!;
  const hide = frame.querySelector<HTMLButtonElement>('[data-slot="bottom"] button')!;
  function Harness({ owner, visible }: { owner: HTMLElement | null; visible: boolean }) {
    useTerminalPanelFocusReturn(owner, visible);
    return null;
  }
  cleanups.push(() => {
    act(() => root.unmount());
    host.remove();
    frame.remove();
  });
  return {
    frame,
    prompt,
    hide,
    render(visible: boolean, owner: HTMLElement | null = frame) {
      act(() => root.render(<Harness owner={owner} visible={visible} />));
    },
  };
}

describe("terminal panel focus return", () => {
  it("returns to the same composer on close without modifying its selection", () => {
    const h = setup();
    h.prompt.value = "draft";
    h.prompt.setSelectionRange(2, 2);
    h.render(true);
    h.hide.focus();
    h.render(false);
    expect(document.activeElement).toBe(h.prompt);
    expect(h.prompt.selectionStart).toBe(2);
  });
  it("does not steal focus on startup or from another control", () => {
    const h = setup();
    h.hide.focus();
    h.render(false);
    expect(document.activeElement).toBe(h.hide);
    h.render(true);
    const other = h.frame.querySelector<HTMLButtonElement>("[data-other]")!;
    other.focus();
    h.render(false);
    expect(document.activeElement).toBe(other);
  });
  it("does not focus a replacement workspace composer or hidden settings surface", () => {
    const h = setup();
    h.render(true);
    h.hide.focus();
    h.prompt.replaceWith(document.createElement("textarea"));
    h.render(false);
    expect(document.activeElement).toBe(h.hide);
    h.render(true);
    h.render(false, null);
    expect(document.activeElement).toBe(h.hide);
  });
});
