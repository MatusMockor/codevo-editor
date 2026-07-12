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
}

export function TerminalPanel({
  isActive,
  onCwdChange,
  onOpenLink,
  onSessionReady,
  profileId,
  rootPath,
  terminalGateway,
  shellIntegrationEnabled,
  terminalTheme,
}: TerminalPanelProps) {
  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<TerminalSession | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
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
    const sessionRootPath = rootPath;
    const session = createTerminalSession({
      cancelFrame: (frameId) => cancelAnimationFrame(frameId),
      createResizeObserver: (callback) => new ResizeObserver(callback),
      fitAddon,
      gateway: terminalGateway,
      host,
      onCwdChange: (cwd) => onCwdChangeRef.current?.(cwd),
      onOpenLink: (path, line, column) => {
        if (!sessionRootPath) {
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
      onSessionReady: (sessionId) => onSessionReadyRef.current?.(sessionId),
      profileId,
      rootPath,
      shellIntegrationEnabled,
      scheduleFrame: (callback) => requestAnimationFrame(callback),
      terminal: {
        get cols() {
          return terminal.cols;
        },
        get rows() {
          return terminal.rows;
        },
        attachCustomKeyEventHandler: (handler) =>
          terminal.attachCustomKeyEventHandler(handler),
        dispose: () => terminal.dispose(),
        loadAddon: (addon) => terminal.loadAddon(addon as FitAddon),
        onData: (listener) => terminal.onData(listener),
        onResize: (listener) => terminal.onResize(listener),
        open: (container) => terminal.open(container),
        get buffer() {
          return terminal.buffer;
        },
        registerLinkProvider: (provider) =>
          terminal.registerLinkProvider(provider),
        registerMarker: (cursorYOffset) =>
          terminal.registerMarker(cursorYOffset),
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
      terminalRef.current = null;
      sessionRef.current = null;
      session.dispose();
    };
  }, [profileId, rootPath, shellIntegrationEnabled, terminalGateway]);

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

export function resolveTerminalLinkPath(
  rootPath: string,
  path: string,
): string | null {
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
