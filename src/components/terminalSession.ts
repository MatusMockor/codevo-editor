import {
  terminalSessionId,
  type TerminalGateway,
  type TerminalOutputEvent,
  type TerminalSize,
  type TerminalUnsubscribeFn,
} from "../domain/terminal";
import { terminalFileLinks } from "../domain/terminalFileLinks";
import { TerminalShellIntegrationRegistry } from "../domain/terminalShellIntegration";

export interface TerminalBufferLine {
  readonly length: number;
  getCell(index: number): TerminalBufferCell | undefined;
  translateToString(trimRight?: boolean): string;
}

export interface TerminalBufferCell {
  getChars(): string;
  getWidth(): number;
}

export interface TerminalLink {
  activate(event: MouseEvent, text: string): void;
  range: {
    end: { x: number; y: number };
    start: { x: number; y: number };
  };
  text: string;
}

export interface TerminalLinkProvider {
  provideLinks(
    lineNumber: number,
    callback: (links: TerminalLink[] | undefined) => void,
  ): void;
}

export interface XtermTerminal {
  readonly buffer: {
    readonly active: {
      getLine(lineIndex: number): TerminalBufferLine | undefined;
    };
  };
  readonly cols: number;
  readonly rows: number;
  dispose(): void;
  loadAddon(addon: TerminalFitAddon): void;
  onData(listener: (data: string) => void): TerminalDisposable;
  onResize(listener: (size: TerminalSize) => void): TerminalDisposable;
  open(host: HTMLElement): void;
  registerLinkProvider(provider: TerminalLinkProvider): TerminalDisposable;
  write(data: string): void;
}

export interface TerminalFitAddon {
  fit(): void;
}

export interface TerminalDisposable {
  dispose(): void;
}

export interface TerminalResizeObserver {
  disconnect(): void;
  observe(host: HTMLElement): void;
}

export interface TerminalSession {
  dispose(): void;
  fit(): void;
}

export function terminalLinkRange(
  bufferLine: TerminalBufferLine,
  startIndex: number,
  length: number,
): { end: number; start: number } {
  const endIndex = startIndex + length;
  let cellColumn = 0;
  let stringOffset = 0;
  let startColumn: number | undefined;

  for (let index = 0; index < bufferLine.length; index += 1) {
    if (startColumn === undefined && stringOffset >= startIndex) {
      startColumn = cellColumn;
    }

    if (stringOffset >= endIndex) {
      return { end: cellColumn, start: (startColumn ?? cellColumn) + 1 };
    }

    const cell = bufferLine.getCell(index);

    if (!cell) {
      continue;
    }

    const width = cell.getWidth();

    if (width === 0) {
      continue;
    }

    stringOffset += cell.getChars().length || 1;
    cellColumn += width;
  }

  return { end: cellColumn, start: (startColumn ?? cellColumn) + 1 };
}

interface TerminalSessionOptions {
  cancelFrame(frameId: number): void;
  createResizeObserver(callback: ResizeObserverCallback): TerminalResizeObserver;
  fitAddon: TerminalFitAddon;
  gateway: TerminalGateway;
  host: HTMLElement;
  // Reports the backend session id once the terminal has started, and `null`
  // when this session is disposed. The workbench uses this to address the
  // active project terminal (e.g. "run test from gutter") without reaching into
  // xterm internals. Always scoped to a single mounted terminal, so it can
  // never leak another tab's session id.
  onSessionReady?(sessionId: number | null): void;
  onCwdChange?(cwd: string | null): void;
  onOpenLink?(path: string, line?: number, column?: number): void;
  profileId: string | null;
  rootPath: string | null;
  shellIntegrationEnabled: boolean;
  scheduleFrame(callback: FrameRequestCallback): number;
  terminal: XtermTerminal;
}

export function createTerminalSession({
  cancelFrame,
  createResizeObserver,
  fitAddon,
  gateway,
  host,
  onSessionReady,
  onCwdChange,
  onOpenLink,
  profileId,
  rootPath,
  shellIntegrationEnabled,
  scheduleFrame,
  terminal,
}: TerminalSessionOptions): TerminalSession {
  const pendingFrames = new Set<number>();
  const disposables: TerminalDisposable[] = [];
  const pendingInput: string[] = [];
  let disposed = false;
  let pendingResize: TerminalSize | null = null;
  let sessionId: number | null = null;
  let unsubscribeOutput: TerminalUnsubscribeFn = () => undefined;
  const shellIntegration = new TerminalShellIntegrationRegistry();

  const reportError = (error: unknown) => {
    terminal.write(`\r\n${String(error)}\r\n`);
  };
  const sendResize = (size: TerminalSize) => {
    if (!sessionId) {
      pendingResize = size;
      return;
    }

    void gateway.resize(sessionId, size).catch(reportError);
  };
  const flushPendingInput = () => {
    if (!sessionId) {
      return;
    }

    for (const data of pendingInput.splice(0)) {
      void gateway.writeInput(sessionId, data).catch(reportError);
    }
  };
  const flushPendingResize = () => {
    if (!sessionId) {
      return;
    }

    if (!pendingResize) {
      return;
    }

    const size = pendingResize;
    pendingResize = null;
    void gateway.resize(sessionId, size).catch(reportError);
  };
  const currentSize = () => ({
    cols: Math.max(1, terminal.cols || 80),
    rows: Math.max(1, terminal.rows || 24),
  });
  const scheduleFit = (afterFit?: () => void) => {
    const frameId = scheduleFrame(() => {
      pendingFrames.delete(frameId);
      fitTerminal(fitAddon);

      if (afterFit) {
        afterFit();
      }
    });
    pendingFrames.add(frameId);
  };
  const handleOutput = (event: TerminalOutputEvent) => {
    if (event.sessionId !== sessionId) {
      return;
    }

    if (rootPath) {
      const result = shellIntegration.feed(rootPath, event.sessionId, event.data);

      for (const shellEvent of result.events) {
        if (shellEvent.kind !== "cwd") {
          continue;
        }

        onCwdChange?.(shellEvent.cwd);
      }
    }

    terminal.write(event.data);
  };

  terminal.loadAddon(fitAddon);
  terminal.open(host);
  disposables.push(
    terminal.registerLinkProvider({
      provideLinks: (lineNumber, callback) => {
        const bufferLine = terminal.buffer.active.getLine(lineNumber - 1);

        if (!bufferLine) {
          callback(undefined);
          return;
        }

        const text = bufferLine.translateToString(true);
        const links = terminalFileLinks(text).map((link) => {
          const range = terminalLinkRange(
            bufferLine,
            link.startIndex,
            link.length,
          );

          return {
            activate: () => onOpenLink?.(link.path, link.line, link.column),
            range: {
              end: { x: range.end, y: lineNumber },
              start: { x: range.start, y: lineNumber },
            },
            text: text.slice(link.startIndex, link.startIndex + link.length),
          };
        });

        callback(links.length > 0 ? links : undefined);
      },
    }),
  );
  disposables.push(
    terminal.onData((data) => {
      if (!sessionId) {
        pendingInput.push(data);
        return;
      }

      void gateway.writeInput(sessionId, data).catch(reportError);
    }),
  );
  disposables.push(terminal.onResize(sendResize));

  const resizeObserver = createResizeObserver(() => {
    scheduleFit(() => sendResize(currentSize()));
  });
  resizeObserver.observe(host);

  if (!rootPath) {
    terminal.write("Open a trusted workspace to start a terminal.\r\n");
  }

  if (rootPath) {
    void gateway
      .subscribeOutput(handleOutput)
      .then((unsubscribe) => {
        if (disposed) {
          unsubscribe();
          return false;
        }

        unsubscribeOutput = unsubscribe;
        return true;
      })
      .then((ready) => {
        if (!ready) {
          return;
        }

        scheduleFit(() => {
          void gateway
            .start(
              rootPath,
              currentSize(),
              profileId || undefined,
              shellIntegrationEnabled,
            )
            .then((status) => {
              const startedSessionId = terminalSessionId(status);

              if (!startedSessionId) {
                reportError(`Terminal did not start: ${status.kind}`);
                return;
              }

              if (disposed) {
                void gateway.stop(startedSessionId).catch(reportError);
                return;
              }

              sessionId = startedSessionId;
              onSessionReady?.(startedSessionId);
              flushPendingInput();
              flushPendingResize();
            })
            .catch(reportError);
        });
      })
      .catch(reportError);
  }

  return {
    dispose: () => {
      disposed = true;
      onSessionReady?.(null);
      onCwdChange?.(null);

      for (const frameId of pendingFrames) {
        cancelFrame(frameId);
      }

      pendingFrames.clear();
      resizeObserver.disconnect();
      unsubscribeOutput();

      for (const disposable of disposables) {
        disposable.dispose();
      }

      const activeSessionId = sessionId;

      if (rootPath && activeSessionId) {
        shellIntegration.reset(rootPath, activeSessionId);
      }

      terminal.dispose();

      if (!activeSessionId) {
        return;
      }

      void gateway.stop(activeSessionId).catch(() => undefined);
    },
    fit: () => {
      scheduleFit(() => sendResize(currentSize()));
    },
  };
}

function fitTerminal(fitAddon: TerminalFitAddon) {
  try {
    fitAddon.fit();
  } catch {
    return;
  }
}
