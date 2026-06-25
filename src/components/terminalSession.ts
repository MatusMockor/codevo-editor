import {
  terminalSessionId,
  type TerminalGateway,
  type TerminalOutputEvent,
  type TerminalSize,
  type TerminalUnsubscribeFn,
} from "../domain/terminal";

export interface XtermTerminal {
  readonly cols: number;
  readonly rows: number;
  dispose(): void;
  loadAddon(addon: TerminalFitAddon): void;
  onData(listener: (data: string) => void): TerminalDisposable;
  onResize(listener: (size: TerminalSize) => void): TerminalDisposable;
  open(host: HTMLElement): void;
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
  profileId: string | null;
  rootPath: string | null;
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
  profileId,
  rootPath,
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

    terminal.write(event.data);
  };

  terminal.loadAddon(fitAddon);
  terminal.open(host);
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
            .start(rootPath, currentSize(), profileId || undefined)
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
