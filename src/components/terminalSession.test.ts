import { describe, expect, it, vi } from "vitest";
import type { TerminalGateway, TerminalOutputEvent } from "../domain/terminal";
import {
  createTerminalSession,
  terminalLinkRange,
  type TerminalBufferLine,
} from "./terminalSession";

describe("terminalLinkRange", () => {
  it("maps wide and astral characters inside a string range", () => {
    const bufferLine = line([
      ...wideCell("目"),
      ...wideCell("录"),
      ...wideCell("😀"),
      ...cells("/x.ts"),
    ]);

    expect(terminalLinkRange(bufferLine, 0, 9)).toEqual({
      end: 11,
      start: 1,
    });
  });
});

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
    expect(harness.gateway.start).toHaveBeenCalledWith(
      "/workspace",
      { cols: 80, rows: 24 },
      "default",
      false,
    );
    expect(harness.terminal.write).toHaveBeenCalledWith("ready\r\n");
  });

  it("tracks cwd from rendered output and clears it when the session exits", async () => {
    const onCwdChange = vi.fn();
    const harness = terminalHarness({ onCwdChange });
    const session = createTerminalSession(harness.options);

    await harness.flushAsync();
    harness.flushFrames();
    await harness.flushAsync();
    harness.emitOutput({
      data: "ready\u001b]7;file://host/workspace/src\u0007\r\n",
      sessionId: 1,
    });

    expect(harness.terminal.write).toHaveBeenCalledWith(
      "ready\u001b]7;file://host/workspace/src\u0007\r\n",
    );
    expect(onCwdChange).toHaveBeenCalledWith("/workspace/src");

    session.dispose();

    expect(onCwdChange).toHaveBeenLastCalledWith(null);
  });

  it("opts into backend shell injection only when enabled", async () => {
    const harness = terminalHarness({ shellIntegrationEnabled: true });

    createTerminalSession(harness.options);
    await harness.flushAsync();
    harness.flushFrames();
    await harness.flushAsync();

    expect(harness.gateway.start).toHaveBeenCalledWith(
      "/workspace",
      { cols: 80, rows: 24 },
      "default",
      true,
    );
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
    expect(harness.linkDisposable.dispose).toHaveBeenCalled();
    expect(harness.terminal.dispose).toHaveBeenCalled();
    expect(harness.gateway.stop).toHaveBeenCalledWith(1);
  });

  it("registers file links and activates them with parsed positions", () => {
    const onOpenLink = vi.fn();
    const harness = terminalHarness({ onOpenLink });

    createTerminalSession(harness.options);
    const links = harness.provideLinks(
      4,
      cells("FAIL ./tests/x.spec.ts:3:5;"),
    );

    expect(harness.terminal.registerLinkProvider).toHaveBeenCalledTimes(1);
    expect(links).toHaveLength(1);
    expect(links[0]?.range).toEqual({
      end: { x: 26, y: 4 },
      start: { x: 6, y: 4 },
    });
    expect(links[0]?.text).toBe("./tests/x.spec.ts:3:5");

    links[0]?.activate({} as MouseEvent, links[0].text);

    expect(onOpenLink).toHaveBeenCalledWith("./tests/x.spec.ts", 3, 5);
  });

  it("maps file links after wide CJK characters to buffer cells", () => {
    const harness = terminalHarness();

    createTerminalSession(harness.options);
    const links = harness.provideLinks(2, [
      ...cells("feat "),
      ...wideCell("用"),
      ...wideCell("户"),
      ...cells(": src/x.ts:1"),
    ]);

    expect(links[0]?.range).toEqual({
      end: { x: 21, y: 2 },
      start: { x: 12, y: 2 },
    });
  });

  it("maps file links after an emoji surrogate pair to buffer cells", () => {
    const harness = terminalHarness();

    createTerminalSession(harness.options);
    const links = harness.provideLinks(3, [
      ...wideCell("😀"),
      ...cells(" src/x.ts:1"),
    ]);

    expect(links[0]?.range).toEqual({
      end: { x: 13, y: 3 },
      start: { x: 4, y: 3 },
    });
  });

  it("maps file links after blank width-one cells", () => {
    const harness = terminalHarness();

    createTerminalSession(harness.options);
    const links = harness.provideLinks(5, [
      cell(""),
      cell(""),
      ...cells("src/x.ts:1"),
    ]);

    expect(links[0]?.range).toEqual({
      end: { x: 12, y: 5 },
      start: { x: 3, y: 5 },
    });
  });

  it.each([
    ["src/x.ts:1", 1, 10],
    ["FAIL src/x.ts:1", 6, 15],
  ])(
    "keeps ASCII file link ranges unchanged for %s",
    (text, start, end) => {
      const harness = terminalHarness();

      createTerminalSession(harness.options);
      const links = harness.provideLinks(1, cells(text));

      expect(links[0]?.range).toEqual({
        end: { x: end, y: 1 },
        start: { x: start, y: 1 },
      });
    },
  );

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

function terminalHarness(
  overrides: Partial<{
    onCwdChange: (cwd: string | null) => void;
    onOpenLink: (path: string, line?: number, column?: number) => void;
    rootPath: string | null;
    shellIntegrationEnabled: boolean;
  }> = {},
) {
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
  const linkDisposable = { dispose: vi.fn() };
  let linkProvider:
    | {
        provideLinks(
          lineNumber: number,
          callback: (links: Array<{
            activate(event: MouseEvent, text: string): void;
            range: {
              end: { x: number; y: number };
              start: { x: number; y: number };
            };
            text: string;
          }> | undefined) => void,
        ): void;
      }
    | undefined;
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
    buffer: {
      active: {
        getLine: vi.fn(),
      },
    },
    registerLinkProvider: vi.fn((provider) => {
      linkProvider = provider;
      return linkDisposable;
    }),
    rows: 24,
    write: vi.fn(),
  };
  const gateway: TerminalGateway = {
    listProfiles: vi.fn(async () => []),
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
    stopAll: vi.fn(async () => undefined),
    stopRoot: vi.fn(async () => undefined),
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
    linkDisposable,
    options: {
      cancelFrame,
      createResizeObserver: (callback: ResizeObserverCallback) => {
        resizeCallback = callback;
        return resizeObserver;
      },
      fitAddon,
      gateway,
      host,
      onCwdChange: overrides.onCwdChange,
      onOpenLink: overrides.onOpenLink,
      profileId: "default",
      rootPath: "rootPath" in overrides
        ? overrides.rootPath ?? null
        : "/workspace",
      shellIntegrationEnabled: overrides.shellIntegrationEnabled ?? false,
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
    provideLinks: (lineNumber: number, bufferCells: BufferCell[]) => {
      terminal.buffer.active.getLine.mockReturnValue(line(bufferCells));
      let provided: Array<{
        activate(event: MouseEvent, text: string): void;
        range: {
          end: { x: number; y: number };
          start: { x: number; y: number };
        };
        text: string;
      }> = [];
      linkProvider?.provideLinks(lineNumber, (links) => {
        provided = links ?? [];
      });
      return provided;
    },
    unsubscribeOutput,
  };
}

interface BufferCell {
  getChars(): string;
  getWidth(): number;
}

function cell(chars: string, width = 1): BufferCell {
  return {
    getChars: () => chars,
    getWidth: () => width,
  };
}

function cells(text: string): BufferCell[] {
  return [...text].map((character) => cell(character));
}

function wideCell(chars: string): BufferCell[] {
  return [cell(chars, 2), cell("", 0)];
}

function line(bufferCells: BufferCell[]): TerminalBufferLine {
  return {
    getCell: (index: number) => bufferCells[index],
    length: bufferCells.length,
    translateToString: () =>
      bufferCells
        .map((bufferCell) => {
          const chars = bufferCell.getChars();

          if (chars || bufferCell.getWidth() === 0) {
            return chars;
          }

          return " ";
        })
        .join(""),
  };
}
