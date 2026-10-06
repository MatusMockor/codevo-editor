// @vitest-environment jsdom

import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resizeAgentComposer, useAgentComposerAutosize } from "./useAgentComposerAutosize";

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

  it("measures content once per resize while respecting the cap, scroll position and clearing", () => {
    const contentReads = vi.spyOn(HTMLElement.prototype, "scrollHeight", "get");
    const viewportReads = vi.spyOn(HTMLElement.prototype, "clientHeight", "get");
    const textarea = render("draft");
    textarea.scrollTop = 30;

    const resize = (prompt: string, height: number, overflow: string): void => {
      contentHeight = height;
      contentReads.mockClear();
      viewportReads.mockClear();
      render(prompt);
      expect(contentReads).toHaveBeenCalledTimes(1);
      expect(viewportReads).toHaveBeenCalledTimes(1);
      expect(textarea.style.height).toBe(`${height}px`);
      expect(textarea.style.overflowY).toBe(overflow);
      expect(textarea.scrollTop).toBe(30);
    };

    resize("long multiline draft", 700, "auto");
    resize("short draft", 100, "hidden");
    resize("", 64, "hidden");
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
      host.style.setProperty("--cv-type-scale", "1.5");
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

  describe("without disturbing the layout around the composer", () => {
    const BOX_HEIGHT = "64px";

    function BoxedComposer({ prompt }: { readonly prompt: string }) {
      const ref = useRef<HTMLTextAreaElement>(null);
      useAgentComposerAutosize(ref, prompt);
      return (
        <div className="agent-composer__box">
          <textarea ref={ref} value={prompt} readOnly />
        </div>
      );
    }

    function renderBoxed(prompt: string) {
      act(() => root.render(<BoxedComposer prompt={prompt} />));
      const textarea = host.querySelector("textarea");
      const box = host.querySelector<HTMLElement>(".agent-composer__box");
      expect(textarea).not.toBeNull();
      expect(box).not.toBeNull();
      return {
        textarea: textarea ?? document.createElement("textarea"),
        box: box ?? document.createElement("div"),
      };
    }

    function recordStyleWrites(textarea: HTMLTextAreaElement, box: HTMLElement) {
      const writes: string[] = [];
      const owner = (style: CSSStyleDeclaration): string | null => {
        if (style === textarea.style) return "textarea";
        if (style === box.style) return "box";
        return null;
      };
      const prototype: CSSStyleDeclaration = Object.getPrototypeOf(box.style);
      for (const property of ["height", "minHeight", "boxSizing"] as const) {
        const write = Object.getOwnPropertyDescriptor(prototype, property)?.set;
        expect(write).toBeDefined();
        vi.spyOn(prototype, property, "set").mockImplementation(function (
          this: CSSStyleDeclaration,
          value: string,
        ) {
          const name = owner(this);
          if (name !== null) writes.push(`${name}.${property}=${value}`);
          write?.call(this, value);
        });
      }
      return writes;
    }

    it("floors the box before the textarea collapses and lifts it after the height is back", () => {
      const { textarea, box } = renderBoxed("");
      const writes = recordStyleWrites(textarea, box);
      const duringCollapse: string[] = [];
      vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(() => {
        duringCollapse.push(
          `${textarea.style.height}|${box.style.minHeight}|${box.style.boxSizing}`,
        );
        return contentHeight;
      });
      contentHeight = 240;
      renderBoxed("long\nmultiline\ndraft");
      expect(writes).toEqual([
        "box.boxSizing=border-box",
        `box.minHeight=${BOX_HEIGHT}`,
        "textarea.height=0px",
        "textarea.height=240px",
        "box.boxSizing=",
        "box.minHeight=",
      ]);
      expect(duringCollapse).toEqual([`0px|${BOX_HEIGHT}|border-box`]);
      expect(box.style.minHeight).toBe("");
      expect(box.style.boxSizing).toBe("");
      expect(textarea.style.height).toBe("240px");
    });

    it("floors the box at its own measured height and reads it before any write", () => {
      const { textarea, box } = renderBoxed("draft");
      const order: string[] = [];
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
        this: HTMLElement,
      ) {
        order.push(
          `read ${this === box ? "box" : "other"} with textarea at ${textarea.style.height}`,
        );
        return new DOMRect(0, 0, width, this === box ? 131.5 : 64);
      });
      const writes = recordStyleWrites(textarea, box);
      textarea.style.height = "100px";
      writes.length = 0;
      resizeAgentComposer(textarea);
      expect(order).toEqual(["read box with textarea at 100px"]);
      expect(writes.slice(0, 3)).toEqual([
        "box.boxSizing=border-box",
        "box.minHeight=131.5px",
        "textarea.height=0px",
      ]);
    });

    it("still shrinks, caps and keeps the textarea's own scroll position", () => {
      const { textarea, box } = renderBoxed("");
      contentHeight = 700;
      renderBoxed("much longer draft");
      expect(textarea.style.height).toBe("700px");
      expect(textarea.style.overflowY).toBe("auto");
      textarea.scrollTop = 30;
      contentHeight = 100;
      renderBoxed("short draft");
      expect(textarea.style.height).toBe("100px");
      expect(textarea.style.overflowY).toBe("hidden");
      expect(textarea.scrollTop).toBe(30);
      contentHeight = 64;
      renderBoxed("");
      expect(textarea.style.height).toBe("64px");
      expect(box.style.minHeight).toBe("");
    });

    it("holds the box for width, viewport and typography remeasures too", async () => {
      const { textarea, box } = renderBoxed("draft");
      const floors: string[] = [];
      vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(() => {
        floors.push(box.style.minHeight);
        return contentHeight;
      });
      width = 400;
      contentHeight = 220;
      act(() => onResize());
      act(() => window.dispatchEvent(new Event("resize")));
      await act(async () => {
        host.style.setProperty("--cv-type-scale", "1.5");
      });
      expect(floors).toEqual([BOX_HEIGHT, BOX_HEIGHT, BOX_HEIGHT]);
      expect(textarea.style.height).toBe("220px");
      expect(box.style.minHeight).toBe("");
    });

    it("puts back the box's own inline style", () => {
      const { textarea, box } = renderBoxed("draft");
      box.style.minHeight = "12px";
      box.style.boxSizing = "content-box";
      box.style.color = "red";
      resizeAgentComposer(textarea);
      expect(box.style.minHeight).toBe("12px");
      expect(box.style.boxSizing).toBe("content-box");
      expect(box.style.color).toBe("red");
    });

    it("lifts the floor even when measuring fails", () => {
      const { textarea, box } = renderBoxed("draft");
      box.style.minHeight = "12px";
      vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(() =>
        JSON.parse("{"),
      );
      expect(() => resizeAgentComposer(textarea)).toThrow(SyntaxError);
      expect(box.style.minHeight).toBe("12px");
      expect(box.style.boxSizing).toBe("");
    });

    it("never writes to the typography shell it observes for changes", async () => {
      const textarea = render("draft");
      const contentReads = vi.spyOn(HTMLElement.prototype, "scrollHeight", "get");
      contentReads.mockClear();
      contentHeight = 220;
      await act(async () => {
        host.style.setProperty("--cv-type-scale", "1.5");
      });
      await act(async () => {});
      expect(textarea.parentElement).toBe(host);
      expect(host.style.minHeight).toBe("");
      expect(host.style.boxSizing).toBe("");
      expect(contentReads).toHaveBeenCalledTimes(1);
    });

    it("measures a textarea that has no parent to hold", () => {
      const detached = document.createElement("textarea");
      contentHeight = 180;
      resizeAgentComposer(detached);
      expect(detached.style.height).toBe("180px");
    });
  });
});
