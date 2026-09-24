import { describe, expect, it } from "vitest";
import type { NativeWindowPort } from "./application/nativeWindowPort";
import { revealStartupWindow } from "./startupWindowReveal";

interface RecordingPort extends NativeWindowPort {
  readonly calls: string[];
}

function recordingPort(
  options: { readonly failBackground?: boolean; readonly failShow?: boolean } = {},
): RecordingPort {
  const calls: string[] = [];
  return {
    calls,
    setBackgroundColor(color) {
      calls.push(`background:${color}`);
      return options.failBackground === true
        ? Promise.reject(new Error("no permission"))
        : Promise.resolve();
    },
    show() {
      calls.push("show");
      return options.failShow === true ? Promise.reject(new Error("gone")) : Promise.resolve();
    },
  };
}

describe("revealStartupWindow", () => {
  it("paints the native background before it shows the window", async () => {
    const port = recordingPort();

    await revealStartupWindow(port, { palette: "ink-mint", colorScheme: "light" });

    expect(port.calls).toEqual(["background:#E9EEF6", "show"]);
  });

  it("still shows the window when the background cannot be set", async () => {
    const port = recordingPort({ failBackground: true });

    await revealStartupWindow(port, { palette: "graphite-teal", colorScheme: "dark" });

    expect(port.calls).toEqual(["background:#151616", "show"]);
  });

  it("settles without an error when show fails", async () => {
    const port = recordingPort({ failShow: true });

    await expect(
      revealStartupWindow(port, { palette: "graphite-teal", colorScheme: "dark" }),
    ).resolves.toBeUndefined();
  });

  it("does nothing outside the desktop shell", async () => {
    await expect(
      revealStartupWindow(null, { palette: "graphite-teal", colorScheme: "dark" }),
    ).resolves.toBeUndefined();
  });
});
