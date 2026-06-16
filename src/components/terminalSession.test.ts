import { describe, expect, it, vi } from "vitest";
import { createReadonlyTerminalSession } from "./terminalSession";

describe("createReadonlyTerminalSession", () => {
  it("opens a read-only terminal with the fit addon", () => {
    const harness = terminalHarness();

    createReadonlyTerminalSession(harness.options);

    expect(harness.terminal.loadAddon).toHaveBeenCalledWith(harness.fitAddon);
    expect(harness.terminal.open).toHaveBeenCalledWith(harness.host);
    expect(harness.terminal.write).toHaveBeenCalledWith("editor $ ");
    expect(harness.resizeObserver.observe).toHaveBeenCalledWith(harness.host);
  });

  it("fits after mount and when the host resizes", () => {
    const harness = terminalHarness();

    createReadonlyTerminalSession(harness.options);
    harness.flushFrames();
    harness.resize();

    expect(harness.fitAddon.fit).toHaveBeenCalledTimes(2);
  });

  it("disconnects observers and disposes the terminal", () => {
    const harness = terminalHarness();
    const session = createReadonlyTerminalSession(harness.options);

    session.dispose();

    expect(harness.cancelFrame).toHaveBeenCalledWith(1);
    expect(harness.resizeObserver.disconnect).toHaveBeenCalled();
    expect(harness.terminal.dispose).toHaveBeenCalled();
  });

  it("keeps the view-only contract for the first terminal slice", () => {
    const harness = terminalHarness();

    createReadonlyTerminalSession(harness.options);

    expect(harness.terminal.onData).not.toHaveBeenCalled();
  });
});

function terminalHarness() {
  let resizeCallback: ResizeObserverCallback | null = null;
  const frameCallbacks: FrameRequestCallback[] = [];
  const fitAddon = {
    fit: vi.fn(),
  };
  const host = {} as HTMLElement;
  const cancelFrame = vi.fn();
  const resizeObserver = {
    disconnect: vi.fn(),
    observe: vi.fn(),
  };
  const terminal = {
    dispose: vi.fn(),
    loadAddon: vi.fn(),
    onData: vi.fn(),
    open: vi.fn(),
    write: vi.fn(),
  };

  return {
    fitAddon,
    flushFrames: () => {
      for (const callback of frameCallbacks.splice(0)) {
        callback(0);
      }
    },
    host,
    options: {
      cancelFrame,
      createResizeObserver: (callback: ResizeObserverCallback) => {
        resizeCallback = callback;
        return resizeObserver;
      },
      fitAddon,
      host,
      scheduleFrame: (callback: FrameRequestCallback) => {
        frameCallbacks.push(callback);
        return frameCallbacks.length;
      },
      terminal,
    },
    cancelFrame,
    resize: () => {
      resizeCallback?.([], resizeObserver as unknown as ResizeObserver);
    },
    resizeObserver,
    terminal,
  };
}
