import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { TerminalTheme } from "../../domain/appColorThemes";
import "@xterm/xterm/css/xterm.css";

export const TERMINAL_SCROLLBACK_LINES = 2_000;

const TERMINAL_FONT_FAMILY = "JetBrains Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace";

export type XtermInitialInput = "enabled" | "disabled";

export interface XtermScreen {
  readonly host: HTMLElement;
  readonly terminal: Terminal;
  readonly fitAddon: FitAddon;
  dispose(): void;
}

export interface XtermAttachment {
  fit(): void;
  dispose(): void;
}

export type XtermBackend = (screen: XtermScreen) => XtermAttachment;

export interface XtermHostOptions {
  readonly backend: XtermBackend;
  readonly initialInput: XtermInitialInput;
  readonly restartKey: string | number;
  readonly theme: TerminalTheme;
}

export interface XtermHost {
  readonly hostRef: RefObject<HTMLDivElement | null>;
  fit(): void;
  focus(): void;
}

export function useXtermHost({
  backend,
  initialInput,
  restartKey,
  theme,
}: XtermHostOptions): XtermHost {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const attachmentRef = useRef<XtermAttachment | null>(null);
  const themeRef = useRef(theme);
  themeRef.current = theme;

  useEffect(() => {
    const host = hostRef.current;

    if (!host) {
      return;
    }

    const screen = createXtermScreen(host, themeRef.current, initialInput);
    terminalRef.current = screen.terminal;
    const attachment = backend(screen);
    attachmentRef.current = attachment;

    return () => {
      terminalRef.current = null;
      attachmentRef.current = null;
      attachment.dispose();
      screen.dispose();
    };
  }, [backend, initialInput, restartKey]);

  useEffect(() => {
    const terminal = terminalRef.current;

    if (!terminal) {
      return;
    }

    terminal.options.theme = theme;
  }, [theme]);

  const fit = useCallback(() => attachmentRef.current?.fit(), []);
  const focus = useCallback(() => terminalRef.current?.focus(), []);

  return { hostRef, fit, focus };
}

export function observeXtermFit(screen: XtermScreen): XtermAttachment {
  const { fitAddon, host, terminal } = screen;
  let observing = true;
  const fit = () => {
    if (!observing) return;
    try {
      fitAddon.fit();
    } catch {
      /* A hidden panel has no dimensions yet. */
    }
  };
  terminal.loadAddon(fitAddon);
  terminal.open(host);
  fit();
  const observer = new ResizeObserver(fit);
  observer.observe(host);

  return {
    fit,
    dispose: () => {
      observing = false;
      observer.disconnect();
    },
  };
}

function createXtermScreen(
  host: HTMLElement,
  theme: TerminalTheme,
  initialInput: XtermInitialInput,
): XtermScreen {
  const terminal = new Terminal({
    cursorBlink: true,
    disableStdin: initialInput === "disabled",
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 13,
    lineHeight: 1.25,
    scrollback: TERMINAL_SCROLLBACK_LINES,
    theme,
  });
  const fitAddon = new FitAddon();
  let disposed = false;

  return {
    host,
    terminal,
    fitAddon,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      terminal.dispose();
    },
  };
}
