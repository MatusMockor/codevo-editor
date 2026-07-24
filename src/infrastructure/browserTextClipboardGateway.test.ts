// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { BrowserTextClipboardGateway } from "./browserTextClipboardGateway";

describe("BrowserTextClipboardGateway", () => {
  it("reports capability and delegates one exact browser clipboard write", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const gateway = new BrowserTextClipboardGateway();
    expect(gateway.canWriteText()).toBe(true);
    await expect(gateway.writeText("stack")).resolves.toBeUndefined();
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith("stack");
  });

  it("fails explicitly when the browser capability is absent", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    const gateway = new BrowserTextClipboardGateway();
    expect(gateway.canWriteText()).toBe(false);
    await expect(gateway.writeText("stack")).rejects.toThrow("Clipboard is unavailable");
  });
});
