import { describe, expect, it, vi } from "vitest";
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
  it("waits for persisted webview zoom before revealing the startup shell", async () => {
    const port = recordingPort();
    let finishZoom: () => void = () => undefined;
    const pendingZoom = new Promise<void>((resolve) => {
      finishZoom = resolve;
    });
    const setScale = vi.fn(() => pendingZoom);
    const ready = revealStartupWindow(
      port,
      { palette: "ink-mint", colorScheme: "light" },
      {
        gateway: { setScale },
        level: 2,
      },
    );
    expect(setScale).toHaveBeenCalledWith(1.2 ** 2);
    expect(port.calls).toEqual([]);
    finishZoom();
    await ready;
    expect(port.calls).toEqual(["background:#E9EEF6", "show"]);
  });

  it("applies startup zoom in browser previews before handing off to React", async () => {
    const setScale = vi.fn(async () => undefined);
    await revealStartupWindow(
      null,
      { palette: "graphite-teal", colorScheme: "dark" },
      {
        gateway: { setScale },
        level: -2,
      },
    );
    expect(setScale).toHaveBeenCalledWith(1.2 ** -2);
  });

  it("keeps startup usable when native zoom cannot be applied", async () => {
    const port = recordingPort();
    const setScale = vi.fn().mockRejectedValue(new Error("zoom unavailable"));
    await expect(
      revealStartupWindow(
        port,
        { palette: "graphite-teal", colorScheme: "dark" },
        {
          gateway: { setScale },
          level: 2,
        },
      ),
    ).resolves.toBeUndefined();
    expect(port.calls).toEqual(["background:#151616", "show"]);
  });

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
