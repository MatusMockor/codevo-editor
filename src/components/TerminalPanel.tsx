import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import type { TerminalGateway } from "../domain/terminal";
import {
  createTerminalSession,
  type TerminalSession,
} from "./terminalSession";
import "@xterm/xterm/css/xterm.css";

interface TerminalPanelProps {
  isActive: boolean;
  rootPath: string | null;
  terminalGateway: TerminalGateway;
}

export function TerminalPanel({
  isActive,
  rootPath,
  terminalGateway,
}: TerminalPanelProps) {
  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<TerminalSession | null>(null);

  useEffect(() => {
    const host = terminalHostRef.current;

    if (!host) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      disableStdin: false,
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
    const session = createTerminalSession({
      cancelFrame: (frameId) => cancelAnimationFrame(frameId),
      createResizeObserver: (callback) => new ResizeObserver(callback),
      fitAddon,
      gateway: terminalGateway,
      host,
      rootPath,
      scheduleFrame: (callback) => requestAnimationFrame(callback),
      terminal: {
        get cols() {
          return terminal.cols;
        },
        get rows() {
          return terminal.rows;
        },
        dispose: () => terminal.dispose(),
        loadAddon: (addon) => terminal.loadAddon(addon as FitAddon),
        onData: (listener) => terminal.onData(listener),
        onResize: (listener) => terminal.onResize(listener),
        open: (container) => terminal.open(container),
        write: (data) => terminal.write(data),
      },
    });
    sessionRef.current = session;

    return () => {
      sessionRef.current = null;
      session.dispose();
    };
  }, [rootPath, terminalGateway]);

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
