import { describe, expect, it, vi } from "vitest";
import type { TerminalGateway, TerminalOutputEvent } from "../domain/terminal";
import { createTerminalSession } from "./terminalSession";

describe("createTerminalSession", () => {
  it("starts a terminal with the fitted size and writes matching output", async () => {
    const harness = terminalHarness();

    createTerminalSession(harness.options);
    await harness.flushAsync();
    harness.flushFrames();
    await harness.flushAsync();
    harness.emitOutput({ data: "ready\r\n", sessionId: 1 });

    expect(harness.terminal.loadAddon).toHaveBeenCalledWith(harness.fitAddon);
    expect(harness.terminal.open).toHaveBeenCalledWith(harness.host);
    expect(harness.gateway.start).toHaveBeenCalledWith("/workspace", {
      cols: 80,
      rows: 24,
    });
    expect(harness.terminal.write).toHaveBeenCalledWith("ready\r\n");
  });

  it("buffers input and resize until the backend session starts", async () => {
    const harness = terminalHarness();

    createTerminalSession(harness.options);
    harness.emitInput("pwd\r");
    harness.emitResize({ cols: 100, rows: 30 });
    await harness.flushAsync();
    harness.flushFrames();
    await harness.flushAsync();

    expect(harness.gateway.writeInput).toHaveBeenCalledWith(1, "pwd\r");
    expect(harness.gateway.resize).toHaveBeenCalledWith(1, {
      cols: 100,
      rows: 30,
    });
  });

  it("disconnects observers, disposes listeners, and stops the session", async () => {
    const harness = terminalHarness();
    const session = createTerminalSession(harness.options);

    await harness.flushAsync();
    harness.flushFrames();
    await harness.flushAsync();
    session.fit();
    session.dispose();

    expect(harness.cancelFrame).toHaveBeenCalledWith(1);
    expect(harness.resizeObserver.disconnect).toHaveBeenCalled();
    expect(harness.unsubscribeOutput).toHaveBeenCalled();
    expect(harness.dataDisposable.dispose).toHaveBeenCalled();
    expect(harness.resizeDisposable.dispose).toHaveBeenCalled();
    expect(harness.terminal.dispose).toHaveBeenCalled();
    expect(harness.gateway.stop).toHaveBeenCalledWith(1);
  });

  it("shows a workspace prompt without starting outside a workspace", async () => {
    const harness = terminalHarness({ rootPath: null });

    createTerminalSession(harness.options);
    await harness.flushAsync();

    expect(harness.gateway.subscribeOutput).not.toHaveBeenCalled();
    expect(harness.gateway.start).not.toHaveBeenCalled();
    expect(harness.terminal.write).toHaveBeenCalledWith(
      "Open a trusted workspace to start a terminal.\r\n",
    );
  });
});

function terminalHarness(overrides: Partial<{ rootPath: string | null }> = {}) {
  let resizeCallback: ResizeObserverCallback | null = null;
  let outputListener: ((event: TerminalOutputEvent) => void) | null = null;
  let dataListener: ((data: string) => void) | null = null;
  let resizeListener: ((size: { cols: number; rows: number }) => void) | null =
    null;
  const frameCallbacks: FrameRequestCallback[] = [];
  const fitAddon = {
    fit: vi.fn(),
  };
  const host = {} as HTMLElement;
  const cancelFrame = vi.fn();
  const dataDisposable = { dispose: vi.fn() };
  const resizeDisposable = { dispose: vi.fn() };
  const resizeObserver = {
    disconnect: vi.fn(),
    observe: vi.fn(),
  };
  const unsubscribeOutput = vi.fn();
  const terminal = {
    cols: 80,
    dispose: vi.fn(),
    loadAddon: vi.fn(),
    onData: vi.fn((listener: (data: string) => void) => {
      dataListener = listener;
      return dataDisposable;
    }),
    onResize: vi.fn((listener: (size: { cols: number; rows: number }) => void) => {
      resizeListener = listener;
      return resizeDisposable;
    }),
    open: vi.fn(),
    rows: 24,
    write: vi.fn(),
  };
  const gateway: TerminalGateway = {
    resize: vi.fn(async () => undefined),
    start: vi.fn(async () => ({
      cols: 80,
      cwd: "/workspace",
      kind: "running" as const,
      rows: 24,
      sessionId: 1,
    })),
    stop: vi.fn(async (sessionId) => ({
      kind: "stopped" as const,
      sessionId,
    })),
    subscribeOutput: vi.fn(async (listener) => {
      outputListener = listener;
      return unsubscribeOutput;
    }),
    writeInput: vi.fn(async () => undefined),
  };

  return {
    cancelFrame,
    dataDisposable,
    emitInput: (data: string) => dataListener?.(data),
    emitOutput: (event: TerminalOutputEvent) => outputListener?.(event),
    emitResize: (size: { cols: number; rows: number }) => {
      terminal.cols = size.cols;
      terminal.rows = size.rows;
      resizeListener?.(size);
    },
    fitAddon,
    flushAsync: () => new Promise((resolve) => setTimeout(resolve, 0)),
    flushFrames: () => {
      for (const callback of frameCallbacks.splice(0)) {
        callback(0);
      }
    },
    gateway,
    host,
    options: {
      cancelFrame,
      createResizeObserver: (callback: ResizeObserverCallback) => {
        resizeCallback = callback;
        return resizeObserver;
      },
      fitAddon,
      gateway,
      host,
      rootPath: "rootPath" in overrides
        ? overrides.rootPath ?? null
        : "/workspace",
      scheduleFrame: (callback: FrameRequestCallback) => {
        frameCallbacks.push(callback);
        return frameCallbacks.length;
      },
      terminal,
    },
    resize: () => {
      resizeCallback?.([], resizeObserver as unknown as ResizeObserver);
    },
    resizeDisposable,
    resizeObserver,
    terminal,
    unsubscribeOutput,
  };
}
