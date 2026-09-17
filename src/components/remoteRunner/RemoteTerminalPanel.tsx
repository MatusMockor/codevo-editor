import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import {
  createRemoteTerminalSession,
  type RemoteTerminalState,
} from "../../application/remoteTerminalSession";
import type {
  RemoteRunnerSurfacesGateway,
  RemoteSurfaceScope,
} from "../../domain/remoteRunnerSurfaces";
import { terminalThemeForAppTheme, type TerminalTheme } from "../../domain/settings";
import "@xterm/xterm/css/xterm.css";
import "./remoteTerminalPanel.css";

const DEFAULT_THEME = terminalThemeForAppTheme("dark");

interface Props {
  readonly scope: RemoteSurfaceScope;
  readonly gateway: RemoteRunnerSurfacesGateway;
  readonly terminalTheme?: TerminalTheme;
  readonly isActive: boolean;
  readonly layoutRevision?: number;
}

export function RemoteTerminalPanel({
  scope,
  gateway,
  terminalTheme = DEFAULT_THEME,
  isActive,
  layoutRevision = 0,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const theme = useRef(terminalTheme);
  theme.current = terminalTheme;
  const terminal = useRef<Terminal | null>(null);
  const fit = useRef<(() => void) | null>(null);
  const session = useRef<ReturnType<typeof createRemoteTerminalSession> | null>(null);
  const [state, setState] = useState<RemoteTerminalState>({ kind: "connecting" });
  const [revision, setRevision] = useState(0);
  const { serverId, runnerId, projectId, taskId } = scope;

  useEffect(() => {
    if (!host.current) return;
    const screen = new Terminal({
      cursorBlink: true,
      disableStdin: true,
      scrollback: 2_000,
      fontFamily: "JetBrains Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.25,
      theme: theme.current,
    });
    const addon = new FitAddon();
    screen.loadAddon(addon);
    screen.open(host.current);
    terminal.current = screen;
    let alive = true;
    let pendingWrite: (() => void) | null = null;
    const resize = () => {
      if (!alive) return;
      try {
        addon.fit();
      } catch {
        /* A hidden panel has no dimensions yet. */
      }
    };
    resize();
    const connection = createRemoteTerminalSession({
      gateway,
      scope: { serverId, runnerId, projectId, ...(taskId ? { taskId } : {}) },
      size: {
        cols: Math.max(2, Math.min(500, screen.cols)),
        rows: Math.max(1, Math.min(300, screen.rows)),
      },
      writeOutput: (data) =>
        new Promise<void>((resolve) => {
          if (!alive) {
            resolve();
            return;
          }
          pendingWrite = resolve;
          screen.write(data, () => {
            pendingWrite = null;
            resolve();
          });
        }),
      onState: (next) => {
        if (!alive) return;
        screen.options.disableStdin = next.kind !== "connected" && next.kind !== "error";
        setState(next);
      },
    });
    session.current = connection;
    fit.current = resize;
    const input = screen.onData((data) => connection.write(data));
    const dimensions = screen.onResize((next) => connection.resize(next));
    const observer = new ResizeObserver(resize);
    observer.observe(host.current);
    return () => {
      alive = false;
      pendingWrite?.();
      pendingWrite = null;
      connection.dispose();
      observer.disconnect();
      input.dispose();
      dimensions.dispose();
      screen.dispose();
      session.current = null;
      terminal.current = null;
      fit.current = null;
    };
  }, [gateway, projectId, revision, runnerId, serverId, taskId]);

  useEffect(() => {
    if (terminal.current) terminal.current.options.theme = terminalTheme;
  }, [terminalTheme]);
  useEffect(() => {
    if (isActive) {
      fit.current?.();
      terminal.current?.focus();
    }
  }, [isActive, layoutRevision, revision]);

  const ended = state.kind === "closed" || state.kind === "exited";
  return (
    <section className="remote-terminal-panel" aria-label="Server terminal">
      <div className="remote-terminal-toolbar">
        <span role="status">{terminalStatus(state)}</span>
        {state.kind === "reconnecting" && (
          <button type="button" onClick={() => setRevision((value) => value + 1)}>
            Reconnect
          </button>
        )}
        {ended ? (
          <button type="button" onClick={() => setRevision((value) => value + 1)}>
            New terminal
          </button>
        ) : (
          <button
            type="button"
            disabled={state.kind !== "connected" && state.kind !== "error"}
            onClick={() => {
              void session.current?.close();
            }}
          >
            Close terminal
          </button>
        )}
      </div>
      <div
        className="remote-terminal-viewport"
        ref={host}
        style={{ background: terminalTheme.background }}
      />
    </section>
  );
}

function terminalStatus(state: RemoteTerminalState): string {
  switch (state.kind) {
    case "connecting":
      return "Connecting to the server terminal…";
    case "reconnecting":
      return "Connection interrupted. Reconnecting to the same terminal…";
    case "connected":
      return "Server terminal";
    case "closing":
      return "Closing terminal…";
    case "closed":
      return "Terminal closed.";
    case "exited":
      return `Shell exited${state.exitCode === null ? "." : ` with code ${state.exitCode}.`}`;
    case "error":
      return state.message;
  }
}
