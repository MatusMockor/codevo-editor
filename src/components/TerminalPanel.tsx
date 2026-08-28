import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import type { TerminalTheme } from "../domain/settings";
import type { TerminalGateway } from "../domain/terminal";
import type { TerminalRuntimeStatus, TerminalSize } from "../domain/terminal";
import { createTerminalSession, type TerminalSession } from "./terminalSession";
import "@xterm/xterm/css/xterm.css";

export const TERMINAL_SCROLLBACK_LINES = 2_000;

interface TerminalPanelProps {
  labelledBy?: string;
  panelId?: string;
  isActive: boolean;
  layoutRevision?: number;
  onCwdChange?: (cwd: string | null) => void;
  onOpenLink?: (path: string, line?: number, column?: number) => void;
  // Reports the backend session id of this terminal once it starts, and `null`
  // when it is torn down (workspace switch / unmount). Lets the workbench
  // address the active project terminal to run commands such as a gutter test
  // run. Per-workspace isolation is preserved by the panel remounting on
  // `rootPath` change, which fires `null` then a fresh id for the new project.
  onSessionReady?: (sessionId: number | null) => void;
  profileId: string | null;
  rootPath: string | null;
  terminalGateway: TerminalGateway;
  shellIntegrationEnabled: boolean;
  terminalTheme: TerminalTheme;
  semanticSession?: {
    readonly key: string;
    cancelStart(): void;
    start(size: TerminalSize): Promise<TerminalRuntimeStatus>;
    settle(sessionId: number, exitCode: number | null): Promise<void>;
  };
}

export function TerminalPanel({
  isActive,
  labelledBy,
  layoutRevision = 0,
  onCwdChange,
  onOpenLink,
  onSessionReady,
  panelId,
  profileId,
  rootPath,
  terminalGateway,
  shellIntegrationEnabled,
  terminalTheme,
  semanticSession,
}: TerminalPanelProps) {
  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<TerminalSession | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const terminalThemeRef = useRef(terminalTheme);
  terminalThemeRef.current = terminalTheme;
  // Keep the latest callback in a ref so the session effect (which must only
  // re-run on profile/root/gateway changes) always invokes the current handler
  // without listing it as a dependency and remounting the terminal.
  const onSessionReadyRef = useRef(onSessionReady);
  onSessionReadyRef.current = onSessionReady;
  const onOpenLinkRef = useRef(onOpenLink);
  onOpenLinkRef.current = onOpenLink;
  const onCwdChangeRef = useRef(onCwdChange);
  onCwdChangeRef.current = onCwdChange;
  const rootPathRef = useRef(rootPath);
  rootPathRef.current = rootPath;
  const semanticSessionRef = useRef(semanticSession);
  semanticSessionRef.current = semanticSession;
  const semanticSessionKey = semanticSession?.key ?? null;

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
      scrollback: TERMINAL_SCROLLBACK_LINES,
      theme: terminalThemeRef.current,
    });
    terminalRef.current = terminal;
    const fitAddon = new FitAddon();
    const sessionRootPath = rootPath;
    const mountedSemanticSession =
      semanticSessionRef.current?.key === semanticSessionKey
        ? semanticSessionRef.current
        : undefined;
    let semanticSessionId: number | null = null;
    let generationActive = true;
    const session = createTerminalSession({
      cancelFrame: (frameId) => cancelAnimationFrame(frameId),
      createResizeObserver: (callback) => new ResizeObserver(callback),
      fitAddon,
      gateway: terminalGateway,
      host,
      onCwdChange: (cwd) => {
        if (generationActive) onCwdChangeRef.current?.(cwd);
      },
      onOpenLink: (path, line, column) => {
        if (!generationActive || !sessionRootPath) {
          return;
        }

        if (rootPathRef.current !== sessionRootPath) {
          return;
        }

        const resolvedPath = resolveTerminalLinkPath(sessionRootPath, path);

        if (!resolvedPath) {
          return;
        }

        onOpenLinkRef.current?.(resolvedPath, line, column);
      },
      onSessionReady: (sessionId) => {
        if (generationActive) semanticSessionId = sessionId;
        if (generationActive && rootPathRef.current === sessionRootPath) {
          onSessionReadyRef.current?.(sessionId);
        }
      },
      onSessionSettled: (sessionId, exitCode) => {
        semanticSessionId = null;
        void mountedSemanticSession?.settle(sessionId, exitCode);
      },
      onSessionStartFailed: () => mountedSemanticSession?.cancelStart(),
      profileId,
      rootPath,
      shellIntegrationEnabled,
      startSession: mountedSemanticSession
        ? (size) => mountedSemanticSession.start(size)
        : undefined,
      stopSessionOnDispose: mountedSemanticSession === undefined,
      scheduleFrame: (callback) => requestAnimationFrame(callback),
      terminal: {
        get cols() {
          return terminal.cols;
        },
        get rows() {
          return terminal.rows;
        },
        attachCustomKeyEventHandler: (handler) => terminal.attachCustomKeyEventHandler(handler),
        dispose: () => terminal.dispose(),
        loadAddon: (addon) => terminal.loadAddon(addon as FitAddon),
        onData: (listener) => terminal.onData(listener),
        onResize: (listener) => terminal.onResize(listener),
        open: (container) => terminal.open(container),
        get buffer() {
          return terminal.buffer;
        },
        registerLinkProvider: (provider) => terminal.registerLinkProvider(provider),
        registerMarker: (cursorYOffset) => terminal.registerMarker(cursorYOffset),
        registerDecoration: (options) => {
          const decoration = terminal.registerDecoration({
            marker: options.marker as ReturnType<Terminal["registerMarker"]>,
          });

          if (!decoration) {
            return undefined;
          }

          decoration.onRender((element) => {
            element.classList.add("terminal-command-decoration");
            element.style.backgroundColor = options.backgroundColor;
            element.title = options.tooltip;

            if (!options.foregroundColor) {
              return;
            }

            element.style.color = options.foregroundColor;
          });

          return decoration;
        },
        scrollToLine: (line) => terminal.scrollToLine(line),
        write: (data, callback) => terminal.write(data, callback),
      },
    });
    sessionRef.current = session;

    return () => {
      generationActive = false;
      terminalRef.current = null;
      sessionRef.current = null;
      session.dispose();
      if (semanticSessionId !== null) {
        const sessionId = semanticSessionId;
        semanticSessionId = null;
        void terminalGateway
          .stop(sessionId)
          .then(() => mountedSemanticSession?.settle(sessionId, null))
          .catch(() => undefined);
      }
      onSessionReadyRef.current?.(null);
      onCwdChangeRef.current?.(null);
    };
  }, [profileId, rootPath, semanticSessionKey, shellIntegrationEnabled, terminalGateway]);

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
  }, [isActive, layoutRevision]);

  useEffect(() => {
    if (!isActive || semanticSessionKey === null) return;
    terminalRef.current?.focus();
  }, [isActive, semanticSessionKey]);

  return (
    <div
      aria-label={labelledBy ? undefined : "Terminal"}
      aria-labelledby={labelledBy}
      className="terminal-panel"
      hidden={!isActive}
      id={panelId}
      role="tabpanel"
    >
      <div className="terminal-viewport" ref={terminalHostRef} />
    </div>
  );
}

function resolveTerminalLinkPath(rootPath: string, path: string): string | null {
  const normalizedRoot = normalizeTerminalPath(rootPath);

  if (!normalizedRoot.startsWith("/")) {
    return null;
  }

  const normalizedPath = path.startsWith("/")
    ? normalizeTerminalPath(path)
    : normalizeTerminalPath(`${normalizedRoot}/${path}`);
  const rootPrefix = normalizedRoot === "/" ? "/" : `${normalizedRoot}/`;

  if (!normalizedPath.startsWith(rootPrefix)) {
    return null;
  }

  return normalizedPath;
}

function normalizeTerminalPath(path: string): string {
  const absolute = path.startsWith("/");
  const segments: string[] = [];

  for (const segment of path.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }

    if (segment === "..") {
      segments.pop();
      continue;
    }

    segments.push(segment);
  }

  return `${absolute ? "/" : ""}${segments.join("/")}`;
}
