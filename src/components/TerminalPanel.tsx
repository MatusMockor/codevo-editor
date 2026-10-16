import { useCallback, useEffect, useRef } from "react";
import type { TerminalTheme } from "../domain/settings";
import { terminalProfileKey, type TerminalGateway } from "../domain/terminal";
import type { TerminalRuntimeStatus, TerminalSize } from "../domain/terminal";
import { createTerminalSession } from "./terminalSession";
import { useXtermHost, type XtermBackend } from "./terminal/useXtermHost";
import { xtermTerminalPort } from "./terminal/xtermTerminalPort";

export { TERMINAL_SCROLLBACK_LINES } from "./terminal/useXtermHost";

interface TerminalPanelProps {
  labelledBy?: string;
  panelId?: string;
  isActive: boolean;
  isVisible?: boolean;
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
  isVisible = isActive,
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
  const profileIdRef = useRef(profileId);
  profileIdRef.current = profileId;
  const sessionProfileKey = terminalProfileKey(profileId);

  const backend = useCallback<XtermBackend>(
    (screen) => {
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
        fitAddon: screen.fitAddon,
        gateway: terminalGateway,
        host: screen.host,
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
          if (generationActive && mountedSemanticSession) semanticSessionId = sessionId;
          if (generationActive && rootPathRef.current === sessionRootPath) {
            onSessionReadyRef.current?.(sessionId);
          }
        },
        onSessionSettled: (sessionId, exitCode) => {
          semanticSessionId = null;
          void mountedSemanticSession?.settle(sessionId, exitCode);
        },
        onSessionStartFailed: () => mountedSemanticSession?.cancelStart(),
        profileId: profileIdRef.current,
        rootPath,
        shellIntegrationEnabled,
        startSession: mountedSemanticSession
          ? (size) => mountedSemanticSession.start(size)
          : undefined,
        stopSessionOnDispose: mountedSemanticSession === undefined,
        scheduleFrame: (callback) => requestAnimationFrame(callback),
        terminal: xtermTerminalPort(screen),
      });

      return {
        fit: () => session.fit(),
        dispose: () => {
          generationActive = false;
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
        },
      };
    },
    [rootPath, semanticSessionKey, shellIntegrationEnabled, terminalGateway],
  );
  const xterm = useXtermHost({
    backend,
    initialInput: "enabled",
    restartKey: sessionProfileKey,
    theme: terminalTheme,
  });
  const { fit, focus } = xterm;

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    fit();
  }, [fit, isVisible, layoutRevision]);

  useEffect(() => {
    if (!isActive || semanticSessionKey === null) return;
    focus();
  }, [focus, isActive, semanticSessionKey]);

  return (
    <div
      aria-label={labelledBy ? undefined : "Terminal"}
      aria-labelledby={labelledBy}
      className="terminal-panel"
      hidden={!isVisible}
      style={{ background: terminalTheme.background }}
      id={panelId}
      role="tabpanel"
    >
      <div className="terminal-viewport" ref={xterm.hostRef} />
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
