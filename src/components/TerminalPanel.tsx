import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import type { TerminalTheme } from "../domain/settings";
import type { TerminalGateway } from "../domain/terminal";
import {
  createTerminalSession,
  type TerminalSession,
} from "./terminalSession";
import "@xterm/xterm/css/xterm.css";

interface TerminalPanelProps {
  isActive: boolean;
  profileId: string | null;
  rootPath: string | null;
  terminalGateway: TerminalGateway;
  terminalTheme: TerminalTheme;
}

export function TerminalPanel({
  isActive,
  profileId,
  rootPath,
  terminalGateway,
  terminalTheme,
}: TerminalPanelProps) {
  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<TerminalSession | null>(null);
  const terminalRef = useRef<Terminal | null>(null);

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
      theme: terminalTheme,
    });
    terminalRef.current = terminal;
    const fitAddon = new FitAddon();
    const session = createTerminalSession({
      cancelFrame: (frameId) => cancelAnimationFrame(frameId),
      createResizeObserver: (callback) => new ResizeObserver(callback),
      fitAddon,
      gateway: terminalGateway,
      host,
      profileId,
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
      terminalRef.current = null;
      sessionRef.current = null;
      session.dispose();
    };
  }, [profileId, rootPath, terminalGateway]);

  useEffect(() => {
    const terminal = terminalRef.current;

    if (!terminal) {
      return;
    }

    terminal.options.theme = terminalTheme;
  }, [terminalTheme]);

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
