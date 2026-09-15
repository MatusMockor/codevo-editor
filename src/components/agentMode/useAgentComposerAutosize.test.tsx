// @vitest-environment jsdom

import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentComposerAutosize } from "./useAgentComposerAutosize";

describe("composer content sizing", () => {
  let host: HTMLDivElement;
  let root: Root;
  let contentHeight: number;
  let viewportCap: number;
  let width: number;
  let onResize: () => void;
  const disconnect = vi.fn();

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    host.className = "app-shell";
    document.body.append(host);
    root = createRoot(host);
    contentHeight = 64;
    viewportCap = 320;
    width = 700;
    onResize = () => undefined;
    disconnect.mockClear();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          onResize = callback;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(() => contentHeight);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return Math.max(64, Math.min(parseFloat(this.style.height) || 0, viewportCap));
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({
      width,
      height: 64,
      top: 0,
      bottom: 64,
      left: 0,
      right: width,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function Composer({ prompt }: { readonly prompt: string }) {
    const ref = useRef<HTMLTextAreaElement>(null);
    useAgentComposerAutosize(ref, prompt);
    return <textarea ref={ref} value={prompt} readOnly />;
  }
  function render(prompt: string) {
    act(() => root.render(<Composer prompt={prompt} />));
    return host.querySelector("textarea")!;
  }

  it("grows with a multiline draft before scrolling, and shrinks after clearing it", () => {
    const textarea = render("");
    contentHeight = 240;
    render("long\nmultiline\ndraft");
    expect(textarea.style.height).toBe("240px");
    expect(textarea.style.overflowY).toBe("hidden");
    contentHeight = 700;
    render("much longer draft");
    expect(textarea.clientHeight).toBe(320);
    expect(textarea.style.overflowY).toBe("auto");
    contentHeight = 64;
    render("");
    expect(textarea.style.height).toBe("64px");
    expect(textarea.style.overflowY).toBe("hidden");
  });

  it("remeasures wrapping after width changes and scroll limits after viewport changes", () => {
    const textarea = render("draft");
    width = 400;
    contentHeight = 220;
    act(() => onResize());
    expect(textarea.style.height).toBe("220px");
    viewportCap = 180;
    act(() => window.dispatchEvent(new Event("resize")));
    expect(textarea.style.overflowY).toBe("auto");
    textarea.scrollTop = 30;
    act(() => window.dispatchEvent(new Event("resize")));
    expect(textarea.scrollTop).toBe(30);
  });

  it("remeasures the same draft when inherited thread typography changes", async () => {
    const textarea = render("multiline draft");
    contentHeight = 220;
    await act(async () => {
      host.style.setProperty("--codevo-fs-scale", "1.5");
    });
    expect(textarea.style.height).toBe("220px");
    expect(textarea.style.overflowY).toBe("hidden");
  });

  it("does not remeasure its own height observer event and disconnects on unmount", () => {
    const textarea = render("draft");
    contentHeight = 250;
    act(() => onResize());
    expect(textarea.style.height).toBe("64px");
    act(() => root.render(null));
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
