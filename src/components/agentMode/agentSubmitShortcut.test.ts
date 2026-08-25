// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { agentSubmitShortcut } from "./agentSubmitShortcut";

describe("agentSubmitShortcut", () => {
  it("reads the reported platform instead of a value frozen at import time", () => {
    expect(withPlatform("macOS", agentSubmitShortcut)).toEqual({
      glyphs: "⌘↩",
      keys: "Meta+Enter",
    });
    expect(withPlatform("Windows", agentSubmitShortcut)).toEqual({
      glyphs: "Ctrl↩",
      keys: "Control+Enter",
    });
    expect(withPlatform("Linux", agentSubmitShortcut).keys).toBe("Control+Enter");
  });

  it("falls back to the user agent string when the platform is not reported", () => {
    expect(
      withUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", agentSubmitShortcut),
    ).toEqual({ glyphs: "⌘↩", keys: "Meta+Enter" });
    expect(withUserAgent("Mozilla/5.0 (X11; Linux x86_64)", agentSubmitShortcut).keys).toBe(
      "Control+Enter",
    );
  });
});

function withPlatform<Value>(platform: string, run: () => Value): Value {
  return withNavigator({ userAgentData: { platform } }, run);
}

function withUserAgent<Value>(userAgent: string, run: () => Value): Value {
  return withNavigator({ userAgent }, run);
}

function withNavigator<Value>(patch: Record<string, unknown>, run: () => Value): Value {
  const saved = Object.keys(patch).map((key) => ({
    key,
    descriptor: Object.getOwnPropertyDescriptor(navigator, key),
  }));
  for (const [key, value] of Object.entries(patch)) {
    Object.defineProperty(navigator, key, { configurable: true, value });
  }
  try {
    return run();
  } finally {
    for (const { key, descriptor } of saved) {
      Reflect.deleteProperty(navigator, key);
      if (descriptor !== undefined) Object.defineProperty(navigator, key, descriptor);
    }
  }
}
