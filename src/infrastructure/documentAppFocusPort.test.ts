// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDocumentAppFocusPort } from "./documentAppFocusPort";

describe("createDocumentAppFocusPort", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reports focus changes once per transition and stops after unsubscribe", () => {
    let focused = true;
    vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
    const port = createDocumentAppFocusPort(window);
    const seen: boolean[] = [];
    const unsubscribe = port.subscribe((value) => seen.push(value));

    focused = false;
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("blur"));
    focused = true;
    window.dispatchEvent(new Event("focus"));
    unsubscribe();
    focused = false;
    window.dispatchEvent(new Event("blur"));

    expect(seen).toEqual([false, true]);
    expect(port.isFocused()).toBe(false);
  });
});
