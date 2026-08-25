import { vi } from "vitest";
import type { TerminalGateway, TerminalRuntimeStatus } from "../../domain/terminal";

export function xtermMockModule() {
  return {
    Terminal: vi.fn(function TerminalMock(options: Record<string, unknown>) {
      return {
        cols: 80,
        rows: 24,
        buffer: { active: { getLine: vi.fn(), type: "normal", viewportY: 0 } },
        attachCustomKeyEventHandler: vi.fn(),
        dispose: vi.fn(),
        loadAddon: vi.fn(),
        onData: vi.fn(() => ({ dispose: vi.fn() })),
        onResize: vi.fn(() => ({ dispose: vi.fn() })),
        open: vi.fn(),
        registerLinkProvider: vi.fn(() => ({ dispose: vi.fn() })),
        registerMarker: vi.fn(() => ({ dispose: vi.fn(), isDisposed: false, line: 0 })),
        registerDecoration: vi.fn(() => ({ dispose: vi.fn(), onRender: vi.fn() })),
        options: { ...options },
        scrollToLine: vi.fn(),
        write: vi.fn(),
      };
    }),
  };
}

export function fitAddonMockModule() {
  return {
    FitAddon: vi.fn(function FitAddonMock() {
      return { fit: vi.fn() };
    }),
  };
}

export function installResizeObserver(): void {
  if (typeof globalThis.ResizeObserver === "function") return;
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  Object.assign(globalThis, { ResizeObserver: ResizeObserverStub });
}

export interface FakeTerminalGateway extends TerminalGateway {
  readonly start: ReturnType<typeof vi.fn<TerminalGateway["start"]>>;
  readonly stop: ReturnType<typeof vi.fn<TerminalGateway["stop"]>>;
}

export function fakeTerminalGateway(): FakeTerminalGateway {
  let nextSessionId = 1;
  const running = (rootPath: string, cols: number, rows: number): TerminalRuntimeStatus => ({
    kind: "running",
    sessionId: nextSessionId++,
    cols,
    rows,
    cwd: rootPath,
  });
  return {
    acknowledgeStart: vi.fn(async () => undefined),
    listProfiles: vi.fn(async () => []),
    resize: vi.fn(async () => undefined),
    start: vi.fn<TerminalGateway["start"]>(async (rootPath, size) =>
      running(rootPath, size.cols, size.rows),
    ),
    stop: vi.fn<TerminalGateway["stop"]>(async (sessionId) => ({ kind: "stopped", sessionId })),
    stopRoot: vi.fn(async () => undefined),
    stopAll: vi.fn(async () => undefined),
    subscribeOutput: vi.fn(async () => () => undefined),
    subscribeStatus: vi.fn(async () => () => undefined),
    writeInput: vi.fn(async () => undefined),
  };
}
