import { useCallback, useEffect, useRef, useState } from "react";
import {
  createRemoteTerminalSession,
  type RemoteTerminalState,
} from "../../application/remoteTerminalSession";
import type {
  RemoteRunnerSurfacesGateway,
  RemoteSurfaceScope,
} from "../../domain/remoteRunnerSurfaces";
import { classicTerminalTheme, type TerminalTheme } from "../../domain/appColorThemes";
import { observeXtermFit, useXtermHost, type XtermBackend } from "../terminal/useXtermHost";
import "./remoteTerminalPanel.css";

const DEFAULT_THEME = classicTerminalTheme("classicDark");

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
  const session = useRef<ReturnType<typeof createRemoteTerminalSession> | null>(null);
  const [state, setState] = useState<RemoteTerminalState>({ kind: "connecting" });
  const [revision, setRevision] = useState(0);
  const { serverId, runnerId, projectId, taskId } = scope;

  const backend = useCallback<XtermBackend>(
    (screen) => {
      const { terminal } = screen;
      const fitting = observeXtermFit(screen);
      let alive = true;
      let pendingWrite: (() => void) | null = null;
      const connection = createRemoteTerminalSession({
        gateway,
        scope: { serverId, runnerId, projectId, ...(taskId ? { taskId } : {}) },
        size: {
          cols: Math.max(2, Math.min(500, terminal.cols)),
          rows: Math.max(1, Math.min(300, terminal.rows)),
        },
        writeOutput: (data) =>
          new Promise<void>((resolve) => {
            if (!alive) {
              resolve();
              return;
            }
            pendingWrite = resolve;
            terminal.write(data, () => {
              pendingWrite = null;
              resolve();
            });
          }),
        onState: (next) => {
          if (!alive) return;
          terminal.options.disableStdin = next.kind !== "connected" && next.kind !== "error";
          setState(next);
        },
      });
      session.current = connection;
      const input = terminal.onData((data) => connection.write(data));
      const dimensions = terminal.onResize((next) => connection.resize(next));
      return {
        fit: fitting.fit,
        dispose: () => {
          alive = false;
          pendingWrite?.();
          pendingWrite = null;
          connection.dispose();
          fitting.dispose();
          input.dispose();
          dimensions.dispose();
          session.current = null;
        },
      };
    },
    [gateway, projectId, runnerId, serverId, taskId],
  );
  const xterm = useXtermHost({
    backend,
    initialInput: "disabled",
    restartKey: revision,
    theme: terminalTheme,
  });
  const { fit, focus } = xterm;

  useEffect(() => {
    if (isActive) {
      fit();
      focus();
    }
  }, [fit, focus, isActive, layoutRevision, revision]);

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
        ref={xterm.hostRef}
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
