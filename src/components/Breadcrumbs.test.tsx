// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LanguageServerDocumentSymbol } from "../domain/languageServerFeatures";
import { Breadcrumbs } from "./Breadcrumbs";

function symbol(
  name: string,
  children: LanguageServerDocumentSymbol[] = [],
): LanguageServerDocumentSymbol {
  const range = {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 0 },
  };

  return {
    children,
    containerName: null,
    detail: null,
    kind: 12,
    name,
    range,
    selectionRange: range,
  };
}

describe("Breadcrumbs", () => {
  let host: HTMLDivElement;
  let root: Root;
  let firstMethod: LanguageServerDocumentSymbol;
  let secondMethod: LanguageServerDocumentSymbol;
  let firstClass: LanguageServerDocumentSymbol;
  let secondClass: LanguageServerDocumentSymbol;
  let symbols: LanguageServerDocumentSymbol[];

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    firstMethod = symbol("firstMethod");
    secondMethod = symbol("secondMethod");
    firstClass = symbol("FirstClass", [firstMethod, secondMethod]);
    secondClass = symbol("SecondClass");
    symbols = [firstClass, secondClass];
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  function renderBreadcrumbs(onNavigate = vi.fn()) {
    act(() => {
      root.render(
        <Breadcrumbs
          fileName="App.tsx"
          onNavigate={onNavigate}
          path={[firstClass, secondMethod]}
          symbols={symbols}
        />,
      );
    });

    return onNavigate;
  }

  function trigger(name: string): HTMLButtonElement {
    const button = Array.from(
      host.querySelectorAll<HTMLButtonElement>(".breadcrumb-symbol"),
    ).find((candidate) => candidate.textContent === name);

    expect(button).toBeTruthy();
    return button as HTMLButtonElement;
  }

  function click(element: Element | null) {
    act(() => {
      element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  function keydown(key: string) {
    act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key }),
      );
    });
  }

  it("renders the file name as the first segment followed by the symbol path", () => {
    renderBreadcrumbs();

    const labels = Array.from(
      host.querySelectorAll<HTMLElement>(".breadcrumb-segment"),
    ).map((segment) => segment.textContent);

    expect(labels).toEqual(["App.tsx", "FirstClass", "secondMethod"]);
  });

  it("renders just the file name when there is no symbol path", () => {
    act(() => {
      root.render(
        <Breadcrumbs
          fileName="App.tsx"
          onNavigate={vi.fn()}
          path={[]}
          symbols={[]}
        />,
      );
    });

    const labels = Array.from(
      host.querySelectorAll<HTMLElement>(".breadcrumb-segment"),
    ).map((segment) => segment.textContent);

    expect(labels).toEqual(["App.tsx"]);
  });

  it("toggles a sibling menu without navigating directly", () => {
    const onNavigate = renderBreadcrumbs();
    const button = trigger("secondMethod");

    click(button);
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    expect(onNavigate).not.toHaveBeenCalled();

    click(button);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("lists siblings in document order and marks the current symbol active", () => {
    renderBreadcrumbs();
    click(trigger("secondMethod"));

    const items = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    );

    expect(items.map((item) => item.textContent)).toEqual([
      "firstMethod",
      "secondMethod",
    ]);
    expect(items[0]?.getAttribute("aria-current")).toBeNull();
    expect(items[1]?.getAttribute("aria-current")).toBe("true");
  });

  it("selects a sibling, closes the menu, and restores trigger focus", () => {
    const onNavigate = renderBreadcrumbs();
    const button = trigger("secondMethod");
    click(button);

    click(
      Array.from(document.querySelectorAll('[role="menuitem"]')).find(
        (item) => item.textContent === "firstMethod",
      ) ?? null,
    );

    expect(onNavigate).toHaveBeenCalledWith(firstMethod);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("closes on Escape and restores focus to the trigger", () => {
    renderBreadcrumbs();
    const button = trigger("secondMethod");
    click(button);

    expect(document.activeElement?.textContent).toBe("secondMethod");
    keydown("Escape");

    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("closes on an outside click", () => {
    renderBreadcrumbs();
    const button = trigger("secondMethod");
    click(button);

    click(document.body);

    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("moves focus with arrow keys and selects the focused item with Enter", () => {
    const onNavigate = renderBreadcrumbs();
    click(trigger("secondMethod"));

    expect(document.activeElement?.textContent).toBe("secondMethod");
    keydown("ArrowDown");
    expect(document.activeElement?.textContent).toBe("firstMethod");
    keydown("ArrowUp");
    expect(document.activeElement?.textContent).toBe("secondMethod");
    keydown("ArrowUp");
    expect(document.activeElement?.textContent).toBe("firstMethod");
    keydown("Enter");

    expect(onNavigate).toHaveBeenCalledWith(firstMethod);
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("keeps only one segment menu open", () => {
    renderBreadcrumbs();
    click(trigger("secondMethod"));
    expect(document.querySelector('[role="menu"]')?.textContent).toContain(
      "firstMethod",
    );

    click(trigger("FirstClass"));

    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
    expect(document.querySelector('[role="menu"]')?.textContent).toContain(
      "SecondClass",
    );
    expect(document.querySelector('[role="menu"]')?.textContent).not.toContain(
      "firstMethod",
    );
  });

  it("exposes menu semantics, expanded state, and focus movement", () => {
    renderBreadcrumbs();
    const button = trigger("secondMethod");

    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    click(button);

    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    expect(document.querySelectorAll('[role="menuitem"]')).toHaveLength(2);
    expect(document.activeElement?.getAttribute("role")).toBe("menuitem");

    keydown("Escape");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button);
  });

  it("positions the menu below its trigger and clamps it to the viewport", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 300 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 200 });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function getBoundingClientRect(this: HTMLElement) {
        if (this.getAttribute("role") === "menu") {
          return new DOMRect(0, 0, 180, 100);
        }

        if (this.textContent === "secondMethod") {
          return new DOMRect(280, 170, 60, 20);
        }

        return new DOMRect();
      },
    );
    renderBreadcrumbs();

    click(trigger("secondMethod"));

    const menu = document.querySelector<HTMLElement>('[role="menu"]');
    expect(menu?.style.left).toBe("112px");
    expect(menu?.style.top).toBe("92px");
  });

  it("does not navigate when the file-name segment is clicked", () => {
    const onNavigate = renderBreadcrumbs();
    click(
      Array.from(host.querySelectorAll<HTMLElement>(".breadcrumb-segment")).find(
        (segment) => segment.textContent === "App.tsx",
      ) ?? null,
    );

    expect(onNavigate).not.toHaveBeenCalled();
  });
});

describe("Breadcrumbs bar chrome", () => {
  const appCss = readFileSync("src/App.css", "utf8");

  it("does not draw its own divider border", () => {
    const index = appCss.indexOf(".breadcrumbs {");
    expect(index, "missing .breadcrumbs rule").toBeGreaterThan(-1);

    const body = appCss.slice(appCss.indexOf("{", index), appCss.indexOf("}", index));
    expect(body).not.toMatch(/border(-bottom|-top)?:/);
  });
});
