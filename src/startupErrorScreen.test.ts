// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  createStartupErrorScreen,
  STARTUP_ERROR_CLASS,
  STARTUP_ERROR_DETAILS_CLASS,
  STARTUP_ERROR_TITLE,
  STARTUP_ERROR_TITLE_CLASS,
  startupErrorMessage,
} from "./startupErrorScreen";

const HEX_LITERAL = /#[0-9a-f]{3,8}\b/i;

function render(error: unknown): HTMLElement {
  const screen = createStartupErrorScreen(error);
  document.body.replaceChildren(screen);
  return screen;
}

describe("startupErrorMessage", () => {
  it("prefers the stack, then the message, for errors", () => {
    const withStack = new Error("boom");
    withStack.stack = "Error: boom\n    at bootstrap";
    expect(startupErrorMessage(withStack)).toBe("Error: boom\n    at bootstrap");

    const withoutStack = new Error("no stack here");
    withoutStack.stack = "";
    expect(startupErrorMessage(withoutStack)).toBe("no stack here");
  });

  it("passes strings through and serializes other values", () => {
    expect(startupErrorMessage("plain failure")).toBe("plain failure");
    expect(startupErrorMessage({ code: 7 })).toBe('{\n  "code": 7\n}');
  });

  it("falls back to a string when serialization throws", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(startupErrorMessage(circular)).toBe("[object Object]");
  });
});

describe("createStartupErrorScreen", () => {
  it("still shows the title and the full stack text", () => {
    const error = new Error("bootstrap failed");
    error.stack = "Error: bootstrap failed\n    at bootstrap (main.tsx:1:1)";
    const screen = render(error);

    expect(screen.querySelector(`.${STARTUP_ERROR_TITLE_CLASS}`)?.textContent).toBe(
      STARTUP_ERROR_TITLE,
    );
    const details = screen.querySelector(`.${STARTUP_ERROR_DETAILS_CLASS}`);
    expect(details?.tagName).toBe("PRE");
    expect(details?.textContent).toBe("Error: bootstrap failed\n    at bootstrap (main.tsx:1:1)");
  });

  it("renders through the startup stylesheet instead of inline styles", () => {
    const screen = render(new Error("boom"));

    expect(screen.className).toBe(STARTUP_ERROR_CLASS);
    for (const element of [screen, ...screen.querySelectorAll("*")]) {
      expect(element.getAttribute("style"), element.tagName).toBeNull();
    }
    expect(HEX_LITERAL.test(screen.outerHTML)).toBe(false);
    expect(screen.outerHTML).not.toContain("border");
  });

  it("keeps the details region scrollable and wrapping through the stylesheet", () => {
    const screen = render("x".repeat(4000));
    const details = screen.querySelector(`.${STARTUP_ERROR_DETAILS_CLASS}`);

    expect(details?.className).toBe(STARTUP_ERROR_DETAILS_CLASS);
    expect(details?.textContent).toHaveLength(4000);
  });

  it("is a standalone screen that does not depend on the skeleton being present", () => {
    document.body.replaceChildren();
    const screen = createStartupErrorScreen("no root content");

    expect(screen.isConnected).toBe(false);
    expect(screen.textContent).toContain("no root content");
    expect(screen.tagName).toBe("MAIN");
  });
});
