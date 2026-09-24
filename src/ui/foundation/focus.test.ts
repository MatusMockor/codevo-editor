// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { focusableWithin, trapTabKey } from "./focus";

function container(markup: string): HTMLElement {
  const element = document.createElement("div");
  element.tabIndex = -1;
  element.innerHTML = markup;
  document.body.append(element);
  return element;
}

function tab(shiftKey = false) {
  return { key: "Tab", shiftKey, preventDefault: vi.fn() };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("focus trap", () => {
  it("lists enabled focusable descendants in document order", () => {
    const root = container(
      '<button id="a">A</button><button disabled>B</button><input id="c" /><span tabindex="-1">D</span><a href="#x" id="e">E</a>',
    );

    expect(focusableWithin(root).map((element) => element.id)).toEqual(["a", "c", "e"]);
  });

  it("wraps Tab from the last element to the first", () => {
    const root = container('<button id="first">1</button><button id="last">2</button>');
    root.querySelector<HTMLElement>("#last")?.focus();
    const event = tab();

    trapTabKey(event, root);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(document.activeElement?.id).toBe("first");
  });

  it("wraps Shift+Tab from the first element to the last", () => {
    const root = container('<button id="first">1</button><button id="last">2</button>');
    root.querySelector<HTMLElement>("#first")?.focus();

    trapTabKey(tab(true), root);

    expect(document.activeElement?.id).toBe("last");
  });

  it("keeps focus on the container when nothing inside can take it", () => {
    const root = container("<p>Nothing to focus</p>");
    const event = tab();

    trapTabKey(event, root);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(document.activeElement).toBe(root);
  });

  it("lets Tab move naturally between middle elements", () => {
    const root = container('<button id="a">1</button><button id="b">2</button><button>3</button>');
    root.querySelector<HTMLElement>("#a")?.focus();
    const event = tab();

    trapTabKey(event, root);

    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
