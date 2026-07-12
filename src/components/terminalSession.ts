import {
  terminalSessionId,
  type TerminalGateway,
  type TerminalOutputEvent,
  type TerminalSize,
  type TerminalUnsubscribeFn,
} from "../domain/terminal";
import { terminalFileLinks } from "../domain/terminalFileLinks";
import { terminalCommandDecoration } from "../domain/terminalCommandDecoration";
import {
  detectKeymapPlatform,
  matchesShortcut,
  type KeymapPlatform,
} from "../domain/keymap";
import {
  nextCommandMarkerLine,
  type TerminalCommandNavigationDirection,
} from "../domain/terminalCommandNavigation";
import {
  TerminalShellIntegrationRegistry,
  type TerminalShellIntegrationEvent,
} from "../domain/terminalShellIntegration";

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
      readonly type: "alternate" | "normal";
      readonly viewportY: number;
    };
  };
  readonly cols: number;
  readonly rows: number;
  attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void;
  dispose(): void;
  loadAddon(addon: TerminalFitAddon): void;
  onData(listener: (data: string) => void): TerminalDisposable;
  onResize(listener: (size: TerminalSize) => void): TerminalDisposable;
  open(host: HTMLElement): void;
  registerDecoration(
    options: TerminalDecorationOptions,
  ): TerminalDecoration | undefined;
  registerLinkProvider(provider: TerminalLinkProvider): TerminalDisposable;
  registerMarker(cursorYOffset?: number): TerminalMarker | undefined;
  scrollToLine(line: number): void;
  write(data: string, callback?: () => void): void;
}

export interface TerminalMarker extends TerminalDisposable {
  readonly isDisposed: boolean;
  readonly line: number;
}

export interface TerminalDecoration extends TerminalDisposable {}

export interface TerminalDecorationOptions {
  backgroundColor: string;
  foregroundColor?: string;
  marker: TerminalMarker;
  tooltip: string;
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

export const terminalCommandDecorationLimit = 200;

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
  platform?: KeymapPlatform;
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
  platform = detectKeymapPlatform(),
  profileId,
  rootPath,
  shellIntegrationEnabled,
  scheduleFrame,
  terminal,
}: TerminalSessionOptions): TerminalSession {
  const pendingFrames = new Set<number>();
  const disposables: TerminalDisposable[] = [];
  const pendingInput: string[] = [];
  const commandDecorations = new Set<TerminalDecoration>();
  const commandMarkers = new Set<TerminalMarker>();
  const completedCommandArtifacts: Array<{
    decoration: TerminalDecoration;
    marker: TerminalMarker;
  }> = [];
  const pendingShellEventWrites: Array<{
    completed: boolean;
    events: TerminalShellIntegrationEvent[];
  }> = [];
  let disposed = false;
  let activeCommandMarker: TerminalMarker | null = null;
  let activeCommandPreExecObserved = false;
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
  const registerCommandMarker = () => {
    if (activeCommandMarker) {
      return;
    }

    const marker = terminal.registerMarker();

    if (!marker) {
      return;
    }

    activeCommandMarker = marker;
    commandMarkers.add(marker);
  };
  const disposeCommandMarker = (marker: TerminalMarker) => {
    commandMarkers.delete(marker);
    marker.dispose();
  };
  const discardActiveCommandMarker = () => {
    const marker = activeCommandMarker;
    activeCommandMarker = null;

    if (!marker) {
      return;
    }

    disposeCommandMarker(marker);
  };
  const completeCommand = (exitCode: number | null) => {
    const marker = activeCommandMarker;
    const preExecObserved = activeCommandPreExecObserved;
    activeCommandMarker = null;
    activeCommandPreExecObserved = false;

    if (!marker) {
      return;
    }

    if (!preExecObserved || exitCode === null) {
      disposeCommandMarker(marker);
      return;
    }

    const decoration = terminal.registerDecoration({
      ...terminalCommandDecoration(exitCode),
      marker,
    });

    if (!decoration) {
      disposeCommandMarker(marker);
      return;
    }

    commandDecorations.add(decoration);
    completedCommandArtifacts.push({ decoration, marker });

    if (completedCommandArtifacts.length <= terminalCommandDecorationLimit) {
      return;
    }

    const oldest = completedCommandArtifacts.shift();

    if (!oldest) {
      return;
    }

    commandDecorations.delete(oldest.decoration);
    commandMarkers.delete(oldest.marker);
    oldest.decoration.dispose();
    oldest.marker.dispose();
  };
  const liveCommandMarkerLines = () =>
    [...commandMarkers]
      .filter((marker) => !marker.isDisposed)
      .map((marker) => marker.line)
      .sort((first, second) => first - second);
  const navigateCommandMarkers = (
    direction: TerminalCommandNavigationDirection,
  ) => {
    const markerLines = liveCommandMarkerLines();

    if (markerLines.length === 0) {
      return true;
    }

    const targetLine = nextCommandMarkerLine(
      markerLines,
      terminal.buffer.active.viewportY,
      direction,
    );

    if (targetLine !== null) {
      terminal.scrollToLine(targetLine);
    }

    return false;
  };
  const flushShellEvent = (shellEvent: TerminalShellIntegrationEvent) => {
    if (shellEvent.kind === "cwd") {
      onCwdChange?.(shellEvent.cwd);
      return;
    }

    if (shellEvent.kind === "promptStart") {
      discardActiveCommandMarker();
      activeCommandPreExecObserved = false;
      registerCommandMarker();
      return;
    }

    if (shellEvent.kind === "preExec") {
      activeCommandPreExecObserved = true;
      registerCommandMarker();
      return;
    }

    if (shellEvent.kind === "commandEnd") {
      completeCommand(shellEvent.exitCode);
    }
  };
  const flushCompletedShellEventWrites = () => {
    if (disposed) {
      pendingShellEventWrites.splice(0);
      return;
    }

    while (pendingShellEventWrites[0]?.completed) {
      const pendingWrite = pendingShellEventWrites.shift();

      if (!pendingWrite) {
        return;
      }

      for (const shellEvent of pendingWrite.events) {
        flushShellEvent(shellEvent);
      }
    }
  };
  const handleOutput = (event: TerminalOutputEvent) => {
    if (event.sessionId !== sessionId) {
      return;
    }

    const shellEvents = rootPath
      ? shellIntegration.feed(rootPath, event.sessionId, event.data).events
      : [];

    const pendingWrite = { completed: false, events: shellEvents };
    pendingShellEventWrites.push(pendingWrite);

    terminal.write(event.data, () => {
      pendingWrite.completed = true;
      flushCompletedShellEventWrites();
    });
  };

  terminal.loadAddon(fitAddon);
  terminal.open(host);
  terminal.attachCustomKeyEventHandler((event) => {
    if (event.type !== "keydown") {
      return true;
    }

    if (terminal.buffer.active.type === "alternate") {
      return true;
    }

    if (matchesShortcut(event, "Cmd+ArrowUp", platform)) {
      return navigateCommandMarkers("up");
    }

    if (matchesShortcut(event, "Cmd+ArrowDown", platform)) {
      return navigateCommandMarkers("down");
    }

    return true;
  });
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

      for (const decoration of commandDecorations) {
        decoration.dispose();
      }

      commandDecorations.clear();

      for (const marker of commandMarkers) {
        marker.dispose();
      }

      commandMarkers.clear();
      activeCommandMarker = null;
      activeCommandPreExecObserved = false;
      completedCommandArtifacts.splice(0);
      pendingShellEventWrites.splice(0);

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
