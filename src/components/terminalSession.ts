export interface ReadonlyTerminal {
  dispose(): void;
  loadAddon(addon: TerminalFitAddon): void;
  open(host: HTMLElement): void;
  write(data: string): void;
}

export interface TerminalFitAddon {
  fit(): void;
}

export interface TerminalResizeObserver {
  disconnect(): void;
  observe(host: HTMLElement): void;
}

export interface ReadonlyTerminalSession {
  dispose(): void;
  fit(): void;
}

interface ReadonlyTerminalSessionOptions {
  cancelFrame(frameId: number): void;
  createResizeObserver(callback: ResizeObserverCallback): TerminalResizeObserver;
  fitAddon: TerminalFitAddon;
  host: HTMLElement;
  prompt?: string;
  scheduleFrame(callback: FrameRequestCallback): number;
  terminal: ReadonlyTerminal;
}

export function createReadonlyTerminalSession({
  cancelFrame,
  createResizeObserver,
  fitAddon,
  host,
  prompt = "editor $ ",
  scheduleFrame,
  terminal,
}: ReadonlyTerminalSessionOptions): ReadonlyTerminalSession {
  const pendingFrames = new Set<number>();
  const scheduleFit = () => {
    const frameId = scheduleFrame(() => {
      pendingFrames.delete(frameId);
      fitTerminal(fitAddon);
    });
    pendingFrames.add(frameId);
  };

  terminal.loadAddon(fitAddon);
  terminal.open(host);
  terminal.write(prompt);

  const resizeObserver = createResizeObserver(() => {
    fitTerminal(fitAddon);
  });
  resizeObserver.observe(host);
  scheduleFit();

  return {
    dispose: () => {
      for (const frameId of pendingFrames) {
        cancelFrame(frameId);
      }

      pendingFrames.clear();
      resizeObserver.disconnect();
      terminal.dispose();
    },
    fit: () => {
      scheduleFit();
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
