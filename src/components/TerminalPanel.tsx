import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import {
  createReadonlyTerminalSession,
  type ReadonlyTerminalSession,
} from "./terminalSession";
import "@xterm/xterm/css/xterm.css";

interface TerminalPanelProps {
  isActive: boolean;
}

export function TerminalPanel({ isActive }: TerminalPanelProps) {
  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<ReadonlyTerminalSession | null>(null);

  useEffect(() => {
    const host = terminalHostRef.current;

    if (!host) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      disableStdin: true,
      fontFamily: "JetBrains Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.25,
      scrollback: 2000,
      theme: {
        background: "#111418",
        black: "#15181d",
        blue: "#7aa2f7",
        brightBlack: "#58606b",
        brightBlue: "#9bbcff",
        brightCyan: "#9ed0c5",
        brightGreen: "#a7d08c",
        brightMagenta: "#d6a5dd",
        brightRed: "#f2a6a6",
        brightWhite: "#f3f6f8",
        brightYellow: "#e6c27a",
        cursor: "#d8dee9",
        cyan: "#7dc5bc",
        foreground: "#d8dee9",
        green: "#8fcb7f",
        magenta: "#c49ad4",
        red: "#e58b8b",
        selectionBackground: "#33414f",
        white: "#d8dee9",
        yellow: "#d7b56d",
      },
    });
    const fitAddon = new FitAddon();
    const session = createReadonlyTerminalSession({
      cancelFrame: (frameId) => cancelAnimationFrame(frameId),
      createResizeObserver: (callback) => new ResizeObserver(callback),
      fitAddon,
      host,
      scheduleFrame: (callback) => requestAnimationFrame(callback),
      terminal: {
        dispose: () => terminal.dispose(),
        loadAddon: (addon) => terminal.loadAddon(addon as FitAddon),
        open: (container) => terminal.open(container),
        write: (data) => terminal.write(data),
      },
    });
    sessionRef.current = session;

    return () => {
      sessionRef.current = null;
      session.dispose();
    };
  }, []);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    const session = sessionRef.current;

    if (!session) {
      return;
    }

    session.fit();
  }, [isActive]);

  return (
    <div
      aria-label="Terminal"
      className="terminal-panel"
      hidden={!isActive}
      role="tabpanel"
    >
      <div className="terminal-viewport" ref={terminalHostRef} />
    </div>
  );
}
